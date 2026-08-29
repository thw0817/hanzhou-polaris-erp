import crypto from "node:crypto";

import {
  ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
  ERP06_SHEIN_PUBLISH_ENDPOINT,
} from "./erp06-shein-publish-adapter-contract.js";
import { withTransaction } from "./postgres.js";

export const ERP06_PUBLISH_RESULT_EVENT_SCHEMA_VERSION = "erp06.publish.v1";
const ERP06_PUBLISH_RESULT_PRODUCER = "erp06-publish-result-repository";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_KEY_PATTERN =
  /(?:secret|token|password|credential|authorization|signature|private[_-]?key|access[_-]?key)/i;

function text(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function ensureUuid(value, fieldName) {
  const normalized = text(value, 100);
  if (!UUID_PATTERN.test(normalized)) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_IDENTITY_INVALID",
      `${fieldName} 不是有效 UUID`,
    );
  }
  return normalized;
}

function required(value, fieldName, max = 1000) {
  const normalized = text(value, max);
  if (!normalized) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_INPUT_INVALID",
      `${fieldName} 不能为空`,
    );
  }
  return normalized;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function sensitivePath(value, path = "result") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const match = sensitivePath(item, `${path}[${index}]`);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (key !== "requiresReauthorization" && SENSITIVE_KEY_PATTERN.test(key)) {
      return `${path}.${key}`;
    }
    const match = sensitivePath(child, `${path}.${key}`);
    if (match) return match;
  }
  return null;
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key === "requiresReauthorization" || !SENSITIVE_KEY_PATTERN.test(key))
      .map(([key, child]) => [key, redact(child)]),
  );
}

function hasCompleteAcceptedReceipt(receipt) {
  const value = object(receipt);
  const skcs = Array.isArray(value.skcs) ? value.skcs : [];
  return Boolean(
    text(value.spuName, 200) &&
    text(value.version, 200) &&
    skcs.length &&
    skcs.every((skc) => {
      const skcValue = object(skc);
      const skus = Array.isArray(skcValue.skus) ? skcValue.skus : [];
      return Boolean(
        text(skcValue.skcName, 200) &&
        skus.length &&
        skus.every((sku) => {
          const skuValue = object(sku);
          return Boolean(text(skuValue.skuCode, 200) && text(skuValue.supplierSku, 200));
        }),
      );
    }),
  );
}

function scope({ tenantId, storeId, commandId, publishAttemptId, claimId } = {}) {
  return {
    tenantId: ensureUuid(tenantId, "tenantId"),
    storeId: ensureUuid(storeId, "storeId"),
    commandId: ensureUuid(commandId, "commandId"),
    publishAttemptId: ensureUuid(publishAttemptId, "publishAttemptId"),
    claimId: required(claimId, "claimId", 200),
  };
}

function assertContextIdentity(context, expected, productVersionId = null) {
  if (!context) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_CONTEXT_NOT_FOUND",
      "ERP-06 发布命令或尝试不存在，拒绝写入结果",
      409,
    );
  }
  for (const [field, actual, expectedValue] of [
    ["tenant_id", context.tenant_id, expected.tenantId],
    ["store_id", context.store_id, expected.storeId],
    ["command_id", context.command_id, expected.commandId],
    ["publish_attempt_id", context.publish_attempt_id, expected.publishAttemptId],
  ]) {
    if (text(actual, 200) !== text(expectedValue, 200)) {
      throw new Erp06PublishResultRepositoryError(
        "ERP06_RESULT_SCOPE_MISMATCH",
        `${field} 与当前发布命令不一致，拒绝写入`,
        409,
      );
    }
  }
  if (productVersionId && text(context.product_version_id, 200) !== text(productVersionId, 200)) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_SCOPE_MISMATCH",
      "ProductVersion 与当前发布命令不一致，拒绝写入",
      409,
    );
  }
}

function assertContext(
  context,
  expected,
  { productVersionId = null, requireSendStarted = false } = {},
) {
  assertContextIdentity(context, expected, productVersionId);
  if (context.command_state !== "dispatching") {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_COMMAND_NOT_CLAIMED",
      "发布命令不处于当前 Worker claim 的 dispatching 状态",
      409,
    );
  }
  if (text(context.worker_claim_id, 200) !== expected.claimId) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_CLAIM_MISMATCH",
      "当前 Worker claim 已失效，拒绝写入发布结果",
      409,
    );
  }
  if (["result_unknown", "superseded_by_new_attempt"].includes(context.attempt_state)) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_UNKNOWN_IMMUTABLE",
      "result_unknown 或已被新尝试替代的 Attempt 不得被远端结果覆盖",
      409,
    );
  }
  if (requireSendStarted && (context.attempt_state !== "dispatched" || !context.send_started_at)) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_SEND_STARTED_REQUIRED",
      "必须先持久化 send_started，才能记录 SHEIN 发布结果",
      409,
    );
  }
}

async function loadContext(client, expected) {
  const result = await client.query({
    text: `
      SELECT command.tenant_id, command.store_id,
             command.id AS command_id,
             command.state AS command_state,
             command.worker_claim_id,
             command.send_started_at,
             command.result_recorded_at,
             command.publish_attempt_id,
             attempt.state AS attempt_state,
             attempt.product_version_id,
             pv.source_draft_revision_id
      FROM publish_commands AS command
      JOIN publish_attempts AS attempt
        ON attempt.tenant_id=command.tenant_id
       AND attempt.store_id=command.store_id
       AND attempt.id=command.publish_attempt_id
      JOIN product_versions AS pv
        ON pv.tenant_id=attempt.tenant_id
       AND pv.store_id=attempt.store_id
       AND pv.id=attempt.product_version_id
      WHERE command.tenant_id=$1
        AND command.store_id=$2
        AND command.id=$3
        AND command.publish_attempt_id=$4
      FOR UPDATE OF command, attempt
    `,
    values: [expected.tenantId, expected.storeId, expected.commandId, expected.publishAttemptId],
  });
  return result.rows[0] || null;
}

async function findEvent(client, expected, dedupeKey) {
  const result = await client.query({
    text: `SELECT id, event_version, event_type, payload
           FROM product_events
           WHERE tenant_id=$1 AND store_id=$2
             AND aggregate_type='publish_attempt'
             AND aggregate_id=$3 AND dedupe_key=$4
           LIMIT 1`,
    values: [expected.tenantId, expected.storeId, expected.publishAttemptId, dedupeKey],
  });
  return result.rows[0] || null;
}

async function nextEventVersion(client, expected) {
  const result = await client.query({
    text: `SELECT COALESCE(MAX(event_version), 0) + 1 AS event_version
           FROM product_events
           WHERE tenant_id=$1 AND store_id=$2
             AND aggregate_type='publish_attempt'
             AND aggregate_id=$3`,
    values: [expected.tenantId, expected.storeId, expected.publishAttemptId],
  });
  const version = Number(result.rows[0]?.event_version || 0);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_EVENT_VERSION_INVALID",
      "发布事件版本号不可用",
      500,
    );
  }
  return version;
}

async function insertEvent(client, expected, {
  eventType,
  eventVersion,
  dedupeKey,
  payload,
  occurredAt,
}) {
  const result = await client.query({
    text: `INSERT INTO product_events
             (tenant_id, store_id, aggregate_type, aggregate_id,
              event_type, schema_version, event_version, occurred_at,
              producer, dedupe_key, payload, payload_sha256)
           VALUES ($1,$2,'publish_attempt',$3,$4,$5,$6,$7::timestamptz,
                   $8,$9,$10::jsonb,$11)
           RETURNING id, event_version`,
    values: [
      expected.tenantId,
      expected.storeId,
      expected.publishAttemptId,
      eventType,
      ERP06_PUBLISH_RESULT_EVENT_SCHEMA_VERSION,
      eventVersion,
      occurredAt,
      ERP06_PUBLISH_RESULT_PRODUCER,
      dedupeKey,
      JSON.stringify(payload),
      fingerprint(payload),
    ],
  });
  const row = result.rows[0] || null;
  if (!row) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_EVENT_INSERT_FAILED",
      "ERP-06 发布事件未生成，事务已回滚",
      500,
    );
  }
  return row;
}

function assertAdapterResult(expected, result) {
  const value = object(result);
  if (text(value.commandId, 200) !== expected.commandId ||
      text(value.publishAttemptId, 200) !== expected.publishAttemptId) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_IDENTITY_MISMATCH",
      "adapter 结果与当前 Command/Attempt 不一致，拒绝持久化",
      409,
    );
  }
  if (value.remoteCallMade !== true || value.sendStarted !== true) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_NOT_SENT",
      "未实际发送的结果不能推进 ERP-06 发布事实",
      409,
    );
  }
  const outcome = text(value.outcome, 100);
  if (!['accepted', 'failed', 'unknown'].includes(outcome)) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_OUTCOME_INVALID",
      "只允许 accepted、failed 或 unknown 结果",
    );
  }
  const expectedState = outcome === "accepted"
    ? "submitted"
    : outcome === "unknown" ? "result_unknown" : "failed";
  if (text(value.state, 100) !== expectedState) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_STATE_INVALID",
      "adapter outcome 与 state 不匹配",
    );
  }
  if (text(value.contractVersion, 100) !== ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_CONTRACT_VERSION_INVALID",
      "adapter 结果契约版本不匹配",
      409,
    );
  }
  if (outcome === "unknown" && value.retryable === true) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_UNKNOWN_RETRY_FORBIDDEN",
      "result_unknown 必须禁止自动重试",
      409,
    );
  }
  if (outcome === "accepted" && !hasCompleteAcceptedReceipt(value.receipt)) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_ACCEPTED_RECEIPT_MISSING",
      "accepted 结果缺少完整平台回执",
      409,
    );
  }
  if (outcome !== "accepted" && !object(value.error).message) {
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_ERROR_MISSING",
      "failed/unknown 结果缺少受控错误信息",
      409,
    );
  }
  for (const [label, candidate] of [["receipt", value.receipt], ["error", value.error]]) {
    const sensitive = sensitivePath(candidate, label);
    if (!sensitive) continue;
    throw new Erp06PublishResultRepositoryError(
      "ERP06_RESULT_SENSITIVE_FIELD",
      `adapter 结果包含禁止持久化的敏感字段: ${sensitive}`,
      409,
    );
  }
  const payload = redact({
    contractVersion: text(value.contractVersion, 100),
    commandId: expected.commandId,
    publishAttemptId: expected.publishAttemptId,
    outcome,
    state: expectedState,
    retryable: value.retryable === true,
    ...(outcome === "accepted"
      ? { receipt: value.receipt }
      : { error: value.error }),
  });
  return {
    outcome,
    attemptState: outcome === "accepted"
      ? "submitted"
      : outcome === "unknown"
        ? "result_unknown"
        : value.retryable === true ? "known_failed" : "failed_terminal",
    commandState: outcome === "accepted" ? "succeeded" : outcome === "unknown" ? "result_unknown" : "failed",
    retryable: value.retryable === true,
    receiptType: outcome === "accepted" ? "accepted" : "submitted",
    receiptStatus: outcome === "accepted" ? "accepted" : outcome === "unknown" ? "unknown" : "failed",
    eventType: outcome === "unknown" ? "attempt_result_unknown" : "platform_receipt_recorded",
    payload,
    traceId: text(value.receipt?.traceId || value.error?.traceId, 200) || null,
    platformVersion: text(value.receipt?.version, 200) || null,
    platformDocumentSn: text(value.receipt?.documentSn, 200) || null,
  };
}

export class Erp06PublishResultRepositoryError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "Erp06PublishResultRepositoryError";
    this.code = code;
    this.status = status;
  }
}

export class PostgresErp06PublishResultRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresErp06PublishResultRepository 缺少 pool");
    this.pool = pool;
  }

  async recordSendStarted({
    tenantId,
    storeId,
    commandId,
    publishAttemptId,
    claimId,
    productVersionId,
    versionFingerprint,
    path = ERP06_SHEIN_PUBLISH_ENDPOINT,
    occurredAt = new Date(),
  } = {}) {
    const expected = scope({ tenantId, storeId, commandId, publishAttemptId, claimId });
    const version = ensureUuid(productVersionId, "productVersionId");
    const frozenFingerprint = required(versionFingerprint, "versionFingerprint", 500);
    const endpoint = required(path, "path", 200);
    if (endpoint !== ERP06_SHEIN_PUBLISH_ENDPOINT) {
      throw new Erp06PublishResultRepositoryError(
        "ERP06_SEND_ENDPOINT_INVALID",
        "send_started 只能绑定官方 publishOrEdit 接口",
      );
    }
    const dedupeKey = `erp06:${commandId}:send_started:${fingerprint({ version, frozenFingerprint, endpoint })}`;
    const payload = {
      contractVersion: ERP06_PUBLISH_RESULT_EVENT_SCHEMA_VERSION,
      commandId,
      publishAttemptId,
      productVersionId: version,
      versionFingerprint: frozenFingerprint,
      path: endpoint,
    };
    return withTransaction(this.pool, async (client) => {
      const context = await loadContext(client, expected);
      assertContextIdentity(context, expected, version);
      const existing = await findEvent(client, expected, dedupeKey);
      if (existing) {
        if (existing.event_type !== "publish_send_started") {
          throw new Erp06PublishResultRepositoryError(
            "ERP06_SEND_STARTED_EVENT_CONFLICT",
            "send_started dedupe key 对应了其他事件类型",
            409,
          );
        }
        return {
          idempotent: true,
          commandId,
          publishAttemptId,
          eventId: existing.id,
          eventVersion: Number(existing.event_version),
          attemptState: context.attempt_state,
          commandState: context.command_state,
          schemaVersion: ERP06_PUBLISH_RESULT_EVENT_SCHEMA_VERSION,
        };
      }
      assertContext(context, expected, { productVersionId: version });
      if (context.send_started_at) {
        throw new Erp06PublishResultRepositoryError(
          "ERP06_SEND_STARTED_EVENT_INCONSISTENT",
          "Command 已有 send_started 时间但缺少可幂等核对的事件",
          409,
        );
      }
      const eventVersion = await nextEventVersion(client, expected);
      const updatedAttempt = await client.query({
        text: `UPDATE publish_attempts
               SET state='dispatched', updated_at=$5::timestamptz
               WHERE tenant_id=$1 AND store_id=$2 AND id=$3
                 AND product_version_id=$4
                 AND state IN ('created','preflight_passed','authorized')
               RETURNING state`,
        values: [expected.tenantId, expected.storeId, expected.publishAttemptId, version, occurredAt],
      });
      if (!updatedAttempt.rows[0]) {
        throw new Erp06PublishResultRepositoryError(
          "ERP06_SEND_STARTED_ATTEMPT_UPDATE_FAILED",
          "PublishAttempt 未能进入 dispatched，事务已回滚",
          409,
        );
      }
      const event = await insertEvent(client, expected, {
        eventType: "publish_send_started",
        eventVersion,
        dedupeKey,
        payload,
        occurredAt,
      });
      const updatedCommand = await client.query({
        text: `UPDATE publish_commands
               SET send_started_at=$5::timestamptz, updated_at=$5::timestamptz
               WHERE tenant_id=$1 AND store_id=$2 AND id=$3
                 AND publish_attempt_id=$4 AND state='dispatching'
                 AND worker_claim_id=$6
               RETURNING state`,
        values: [expected.tenantId, expected.storeId, expected.commandId, expected.publishAttemptId, occurredAt, expected.claimId],
      });
      if (!updatedCommand.rows[0]) {
        throw new Erp06PublishResultRepositoryError(
          "ERP06_SEND_STARTED_COMMAND_UPDATE_FAILED",
          "PublishCommand 未能保存 send_started，事务已回滚",
          409,
        );
      }
      return {
        idempotent: false,
        commandId,
        publishAttemptId,
        eventId: event.id,
        eventVersion: Number(event.event_version),
        attemptState: "dispatched",
        commandState: "dispatching",
        schemaVersion: ERP06_PUBLISH_RESULT_EVENT_SCHEMA_VERSION,
      };
    });
  }

  async recordPublishResult({
    tenantId,
    storeId,
    commandId,
    publishAttemptId,
    claimId,
    productVersionId,
    result,
    occurredAt = new Date(),
  } = {}) {
    const expected = scope({ tenantId, storeId, commandId, publishAttemptId, claimId });
    ensureUuid(productVersionId, "productVersionId");
    const normalized = assertAdapterResult(expected, result);
    const dedupeKey = `erp06:${commandId}:result:${fingerprint(normalized.payload)}`;
    return withTransaction(this.pool, async (client) => {
      const context = await loadContext(client, expected);
      assertContextIdentity(context, expected, productVersionId);
      const existing = await findEvent(client, expected, dedupeKey);
      if (existing) {
        if (existing.event_type !== normalized.eventType) {
          throw new Erp06PublishResultRepositoryError(
            "ERP06_RESULT_EVENT_CONFLICT",
            "结果 dedupe key 对应了其他事件类型",
            409,
          );
        }
        return {
          idempotent: true,
          commandId,
          publishAttemptId,
          outcome: normalized.outcome,
          attemptState: normalized.attemptState,
          commandState: normalized.commandState,
          receiptType: normalized.receiptType,
          receiptStatus: normalized.receiptStatus,
          eventType: normalized.eventType,
          eventId: existing.id,
          eventVersion: Number(existing.event_version),
          retryable: normalized.retryable,
        };
      }
      assertContext(context, expected, { productVersionId, requireSendStarted: true });
      const eventVersion = await nextEventVersion(client, expected);
      const updatedAttempt = await client.query({
        text: `UPDATE publish_attempts
               SET state=$4,
                   result_unknown_at=CASE WHEN $4='result_unknown' THEN $5::timestamptz ELSE result_unknown_at END,
                   updated_at=$5::timestamptz
               WHERE tenant_id=$1 AND store_id=$2 AND id=$3
                 AND state='dispatched'
               RETURNING state`,
        values: [expected.tenantId, expected.storeId, expected.publishAttemptId, normalized.attemptState, occurredAt],
      });
      if (!updatedAttempt.rows[0]) {
        throw new Erp06PublishResultRepositoryError(
          "ERP06_RESULT_ATTEMPT_UPDATE_FAILED",
          "PublishAttempt 未能记录结果，事务已回滚",
          409,
        );
      }
      const receipt = await client.query({
        text: `INSERT INTO product_publish_receipts
                 (tenant_id, store_id, publish_attempt_id, receipt_type,
                  evidence_source, dedupe_key, status,
                  platform_document_sn, platform_version, trace_id,
                  payload, payload_sha256, occurred_at)
               VALUES ($1,$2,$3,$4,'shein_api_response',$5,$6,$7,$8,$9,$10::jsonb,$11,$12::timestamptz)
               ON CONFLICT (tenant_id, store_id, publish_attempt_id, receipt_type, dedupe_key)
               DO NOTHING
               RETURNING id`,
        values: [
          expected.tenantId,
          expected.storeId,
          expected.publishAttemptId,
          normalized.receiptType,
          dedupeKey,
          normalized.receiptStatus,
          normalized.platformDocumentSn,
          normalized.platformVersion,
          normalized.traceId,
          JSON.stringify(normalized.payload),
          fingerprint(normalized.payload),
          occurredAt,
        ],
      });
      if (!receipt.rows[0]) {
        throw new Erp06PublishResultRepositoryError(
          "ERP06_RECEIPT_INSERT_FAILED",
          "平台回执未生成，事务已回滚",
          500,
        );
      }
      const event = await insertEvent(client, expected, {
        eventType: normalized.eventType,
        eventVersion,
        dedupeKey,
        payload: normalized.payload,
        occurredAt,
      });
      const updatedCommand = await client.query({
        text: `UPDATE publish_commands
               SET state=$4, result_recorded_at=$5::timestamptz,
                   worker_id=NULL, worker_claim_id=NULL,
                   worker_claimed_at=NULL, worker_lease_expires_at=NULL,
                   updated_at=$5::timestamptz
               WHERE tenant_id=$1 AND store_id=$2 AND id=$3
                 AND publish_attempt_id=$6 AND state='dispatching'
                 AND worker_claim_id=$7
               RETURNING state`,
        values: [expected.tenantId, expected.storeId, expected.commandId, normalized.commandState, occurredAt, expected.publishAttemptId, expected.claimId],
      });
      if (!updatedCommand.rows[0]) {
        throw new Erp06PublishResultRepositoryError(
          "ERP06_RESULT_COMMAND_UPDATE_FAILED",
          "PublishCommand 未能记录结果，事务已回滚",
          409,
        );
      }
      return {
        idempotent: false,
        commandId,
        publishAttemptId,
        outcome: normalized.outcome,
        attemptState: normalized.attemptState,
        commandState: normalized.commandState,
        receiptId: receipt.rows[0].id,
        receiptType: normalized.receiptType,
        receiptStatus: normalized.receiptStatus,
        eventType: normalized.eventType,
        eventId: event.id,
        eventVersion: Number(event.event_version),
        retryable: normalized.retryable,
      };
    });
  }
}
