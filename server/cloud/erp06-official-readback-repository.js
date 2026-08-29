import crypto from "node:crypto";

import {
  ERP06_DOCUMENT_STATE_READBACK_ENDPOINT,
  ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION,
  ERP06_SPU_INFO_READBACK_ENDPOINT,
} from "./erp06-shein-remote-boundary.js";
import { withTransaction } from "./postgres.js";

export const ERP06_OFFICIAL_READBACK_EVENT_SCHEMA_VERSION =
  "erp06.official-readback.v1";

const ERP06_OFFICIAL_READBACK_PRODUCER = "erp06-official-readback-repository";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_KEY_PATTERN =
  /(?:secret|token|password|credential|authorization|signature|private[_-]?key|access[_-]?key)/i;
const READABLE_ATTEMPT_STATES = new Set(["submitted", "result_unknown"]);

const STAGE_DEFINITIONS = Object.freeze({
  document_state: Object.freeze({
    path: ERP06_DOCUMENT_STATE_READBACK_ENDPOINT,
    eventType: "official_document_state_readback",
  }),
  spu_info: Object.freeze({
    path: ERP06_SPU_INFO_READBACK_ENDPOINT,
    eventType: "official_spu_info_readback",
  }),
});

function text(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function required(value, fieldName, max = 1000) {
  const normalized = text(value, max);
  if (!normalized) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_INPUT_INVALID",
      `${fieldName} 不能为空`,
    );
  }
  return normalized;
}

function ensureUuid(value, fieldName) {
  const normalized = required(value, fieldName, 100);
  if (!UUID_PATTERN.test(normalized)) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_INPUT_INVALID",
      `${fieldName} 不是有效 UUID`,
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
    if (SENSITIVE_KEY_PATTERN.test(key)) return `${path}.${key}`;
    const match = sensitivePath(child, `${path}.${key}`);
    if (match) return match;
  }
  return null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeDiagnostics(value) {
  const source = object(value);
  return {
    status: Number.isInteger(source.status) ? source.status : null,
    code: text(source.code, 100) || null,
    traceId: text(source.traceId, 200) || null,
    ...(Number.isFinite(source.durationMs)
      ? { durationMs: Math.max(0, Number(source.durationMs)) }
      : {}),
  };
}

function validTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_INPUT_INVALID",
      "official readback occurredAt 不是有效时间",
    );
  }
  return date;
}

function stageDefinition(stage) {
  const normalized = text(stage, 100);
  const definition = STAGE_DEFINITIONS[normalized];
  if (!definition) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_RESULT_INVALID",
      "只允许 document_state 或 spu_info 官方回读",
    );
  }
  return { stage: normalized, ...definition };
}

function assertReadbackResult({ result, expected }) {
  const value = object(result);
  const definition = stageDefinition(value.stage);
  if (
    text(value.contractVersion, 200) !==
      ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION ||
    text(value.commandId, 200) !== expected.commandId ||
    text(value.publishAttemptId, 200) !== expected.publishAttemptId ||
    text(value.productVersionId, 200) !== expected.productVersionId ||
    text(value.path, 200) !== definition.path ||
    text(value.method, 20) !== "POST" ||
    text(value.status, 100) !== "read" ||
    value.externalRead !== true ||
    typeof value.resolvesResultUnknown !== "boolean"
  ) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_RESULT_INVALID",
      "官方回读结果的契约、身份、endpoint 或状态不一致",
      409,
    );
  }
  if (sensitivePath(value)) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_SENSITIVE_FIELD",
      "官方回读结果包含禁止落账的敏感字段",
      409,
    );
  }
  const projection = object(value.projection);
  if (
    text(projection.mode, 100) !== "dry-run" ||
    projection.externalWrite !== false ||
    !text(projection.projectionVersion, 200) ||
    !projection.projection ||
    typeof projection.projection !== "object" ||
    !projection.summary ||
    typeof projection.summary !== "object"
  ) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_RESULT_INVALID",
      "官方回读缺少安全 projection，拒绝持久化原始响应",
      409,
    );
  }
  const expectedEventFamily = definition.stage === "document_state"
    ? "query-document-state"
    : "goods/spu-info";
  if (text(projection.projection.eventFamily, 100) !== expectedEventFamily) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_RESULT_INVALID",
      "官方回读 projection 类型与 endpoint 不一致",
      409,
    );
  }
  return {
    ...value,
    stage: definition.stage,
    eventType: definition.eventType,
    path: definition.path,
    projection: {
      projectionVersion: text(projection.projectionVersion, 200),
      mode: "dry-run",
      externalWrite: false,
      ...(projection.empty === true ? { empty: true } : {}),
      projection: cloneJson(projection.projection),
      summary: cloneJson(projection.summary),
    },
    diagnostics: safeDiagnostics(value.diagnostics),
  };
}

function receiptStatus(readback) {
  if (readback.stage === "spu_info") return "accepted";
  const records = Array.isArray(readback.projection.projection.records)
    ? readback.projection.projection.records
    : [];
  if (!records.length) return "unknown";
  const states = new Set(records.map((record) => text(record.status, 100)));
  if (states.has("failed")) return "failed";
  if (states.has("withdrawn")) return "withdrawn";
  if (states.has("pending")) return "pending";
  if (states.size === 1 && states.has("passed")) return "accepted";
  return "unknown";
}

function platformVersion(readback, requestedVersion) {
  if (readback.stage === "spu_info") return requestedVersion;
  const versions = new Set(
    (readback.projection.projection.records || [])
      .map((record) => text(record.version, 200))
      .filter(Boolean),
  );
  return versions.size === 1 ? [...versions][0] : null;
}

function documentSn(readback) {
  if (readback.stage !== "document_state") return null;
  const values = new Set(
    (readback.projection.projection.records || [])
      .map((record) => text(record.documentSn, 200))
      .filter(Boolean),
  );
  return values.size === 1 ? [...values][0] : null;
}

function scope({
  tenantId,
  storeId,
  commandId,
  publishAttemptId,
  productVersionId,
  version,
  versionFingerprint,
}) {
  return {
    tenantId: ensureUuid(tenantId, "tenantId"),
    storeId: ensureUuid(storeId, "storeId"),
    commandId: ensureUuid(commandId, "commandId"),
    publishAttemptId: ensureUuid(publishAttemptId, "publishAttemptId"),
    productVersionId: ensureUuid(productVersionId, "productVersionId"),
    version: required(version, "version", 200),
    versionFingerprint: required(versionFingerprint, "versionFingerprint", 500),
  };
}

function assertContext(context, expected) {
  if (!context) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_CONTEXT_NOT_FOUND",
      "发布命令或尝试不存在，拒绝写入官方回读事实",
      409,
    );
  }
  for (const [field, actual, expectedValue] of [
    ["tenant_id", context.tenant_id, expected.tenantId],
    ["store_id", context.store_id, expected.storeId],
    ["command_id", context.command_id, expected.commandId],
    ["publish_attempt_id", context.publish_attempt_id, expected.publishAttemptId],
    ["product_version_id", context.product_version_id, expected.productVersionId],
    ["version_fingerprint", context.version_fingerprint, expected.versionFingerprint],
  ]) {
    if (text(actual, 500) !== text(expectedValue, 500)) {
      throw new Erp06OfficialReadbackRepositoryError(
        "ERP06_READBACK_SCOPE_MISMATCH",
        `${field} 与当前 ProductVersion/PublishAttempt 不一致，拒绝落账`,
        409,
      );
    }
  }
  if (!READABLE_ATTEMPT_STATES.has(text(context.attempt_state, 100))) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_ATTEMPT_NOT_READABLE",
      "只有 submitted 或 result_unknown Attempt 可以接收官方回读",
      409,
    );
  }
  if (!["succeeded", "result_unknown"].includes(text(context.command_state, 100))) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_COMMAND_NOT_SETTLED",
      "PublishCommand 尚未进入可回读的已发送或结果未知状态",
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
             command.publish_attempt_id,
             attempt.state AS attempt_state,
             attempt.product_version_id,
             pv.source_draft_revision_id,
             pv.version_fingerprint
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
    values: [
      expected.tenantId,
      expected.storeId,
      expected.commandId,
      expected.publishAttemptId,
    ],
  });
  return result.rows[0] || null;
}

async function findEvent(client, expected, dedupeKey) {
  const result = await client.query({
    text: `SELECT id, event_version, event_type
           FROM product_events
           WHERE tenant_id=$1 AND store_id=$2
             AND aggregate_type='publish_attempt'
             AND aggregate_id=$3 AND dedupe_key=$4
           LIMIT 1`,
    values: [
      expected.tenantId,
      expected.storeId,
      expected.publishAttemptId,
      dedupeKey,
    ],
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
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_EVENT_VERSION_INVALID",
      "官方回读事件版本号不可用",
      500,
    );
  }
  return version;
}

async function insertOfficialInbox(client, expected, {
  source,
  sourceEventId,
  eventType,
  dedupeKey,
  payload,
  verificationState,
  receivedAt,
}) {
  const result = await client.query({
    text: `INSERT INTO official_event_inbox
             (tenant_id, store_id, source, source_event_id, event_type,
              dedupe_key, payload, payload_sha256, verification_state,
              error_code, received_at, verified_at, processed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,NULL,$10::timestamptz,
                   CASE WHEN $9='accepted' THEN $10::timestamptz ELSE NULL END,
                   NULL)
           ON CONFLICT (tenant_id, store_id, dedupe_key)
           DO NOTHING
           RETURNING id`,
    values: [
      expected.tenantId,
      expected.storeId,
      source,
      sourceEventId,
      eventType,
      dedupeKey,
      JSON.stringify(payload),
      fingerprint(payload),
      verificationState,
      receivedAt,
    ],
  });
  if (result.rows[0]?.id) return result.rows[0].id;
  const existing = await client.query({
    text: `SELECT id, event_type
           FROM official_event_inbox
           WHERE tenant_id=$1 AND store_id=$2 AND dedupe_key=$3
           LIMIT 1`,
    values: [expected.tenantId, expected.storeId, dedupeKey],
  });
  if (!existing.rows[0] || existing.rows[0].event_type !== eventType) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_INBOX_CONFLICT",
      "官方回读 Inbox 已存在冲突事实，拒绝覆盖",
      409,
    );
  }
  return existing.rows[0].id;
}

async function insertReceipt(client, expected, {
  dedupeKey,
  status,
  payload,
  platformDocumentSn,
  platformVersion,
  traceId,
  occurredAt,
}) {
  const result = await client.query({
    text: `INSERT INTO product_publish_receipts
             (tenant_id, store_id, publish_attempt_id, receipt_type,
              evidence_source, dedupe_key, status, platform_document_sn,
              platform_version, trace_id, payload, payload_sha256, occurred_at)
           VALUES ($1,$2,$3,'readback','official_readback',$4,$5,$6,$7,$8,
                   $9::jsonb,$10,$11::timestamptz)
           ON CONFLICT (tenant_id, store_id, publish_attempt_id, receipt_type, dedupe_key)
           DO NOTHING
           RETURNING id`,
    values: [
      expected.tenantId,
      expected.storeId,
      expected.publishAttemptId,
      dedupeKey,
      status,
      platformDocumentSn,
      platformVersion,
      traceId,
      JSON.stringify(payload),
      fingerprint(payload),
      occurredAt,
    ],
  });
  if (result.rows[0]?.id) return result.rows[0].id;
  const existing = await client.query({
    text: `SELECT id
           FROM product_publish_receipts
           WHERE tenant_id=$1 AND store_id=$2
             AND publish_attempt_id=$3 AND receipt_type='readback'
             AND dedupe_key=$4
           LIMIT 1`,
    values: [
      expected.tenantId,
      expected.storeId,
      expected.publishAttemptId,
      dedupeKey,
    ],
  });
  if (!existing.rows[0]?.id) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_RECEIPT_CONFLICT",
      "官方回读回执未生成，事务已回滚",
      500,
    );
  }
  return existing.rows[0].id;
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
      ERP06_OFFICIAL_READBACK_EVENT_SCHEMA_VERSION,
      eventVersion,
      occurredAt,
      ERP06_OFFICIAL_READBACK_PRODUCER,
      dedupeKey,
      JSON.stringify(payload),
      fingerprint(payload),
    ],
  });
  const row = result.rows[0] || null;
  if (!row) {
    throw new Erp06OfficialReadbackRepositoryError(
      "ERP06_READBACK_EVENT_INSERT_FAILED",
      "官方回读事件未生成，事务已回滚",
      500,
    );
  }
  return row;
}

export class Erp06OfficialReadbackRepositoryError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "Erp06OfficialReadbackRepositoryError";
    this.code = code;
    this.status = status;
  }
}

export class PostgresErp06OfficialReadbackRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresErp06OfficialReadbackRepository 缺少 pool");
    this.pool = pool;
  }

  async recordReadback({
    tenantId,
    storeId,
    commandId,
    publishAttemptId,
    productVersionId,
    version,
    versionFingerprint,
    result,
    occurredAt = new Date(),
  } = {}) {
    const expected = scope({
      tenantId,
      storeId,
      commandId,
      publishAttemptId,
      productVersionId,
      version,
      versionFingerprint,
    });
    const normalizedResult = assertReadbackResult({ result, expected });
    const timestamp = validTimestamp(occurredAt);
    const status = receiptStatus(normalizedResult);
    const payload = {
      contractVersion: ERP06_OFFICIAL_READBACK_EVENT_SCHEMA_VERSION,
      boundaryContractVersion: ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION,
      stage: normalizedResult.stage,
      method: "POST",
      path: normalizedResult.path,
      commandId: expected.commandId,
      publishAttemptId: expected.publishAttemptId,
      productVersionId: expected.productVersionId,
      requestedVersion: expected.version,
      versionFingerprint: expected.versionFingerprint,
      resolvesResultUnknown: normalizedResult.resolvesResultUnknown,
      projection: normalizedResult.projection,
      diagnostics: normalizedResult.diagnostics,
    };
    const evidenceFingerprint = fingerprint(payload);
    const dedupeKey = `erp06:${expected.commandId}:official-readback:${normalizedResult.stage}:${evidenceFingerprint}`;
    const sourceEventId = `erp06:${expected.commandId}:${normalizedResult.stage}:${evidenceFingerprint}`;
    const verificationState = normalizedResult.resolvesResultUnknown
      ? "accepted"
      : "unknown";
    return withTransaction(this.pool, async (client) => {
      const context = await loadContext(client, expected);
      assertContext(context, expected);
      const existingEvent = await findEvent(client, expected, dedupeKey);
      if (existingEvent) {
        if (existingEvent.event_type !== normalizedResult.eventType) {
          throw new Erp06OfficialReadbackRepositoryError(
            "ERP06_READBACK_EVENT_CONFLICT",
            "官方回读 dedupe key 对应了其他事件类型",
            409,
          );
        }
        return {
          idempotent: true,
          commandId: expected.commandId,
          publishAttemptId: expected.publishAttemptId,
          stage: normalizedResult.stage,
          eventId: existingEvent.id,
          eventVersion: Number(existingEvent.event_version),
          receiptStatus: status,
          attemptState: context.attempt_state,
          resolvesResultUnknown: normalizedResult.resolvesResultUnknown,
          eventSchemaVersion: ERP06_OFFICIAL_READBACK_EVENT_SCHEMA_VERSION,
        };
      }

      const inboxId = await insertOfficialInbox(client, expected, {
        source: "shein_official_readback",
        sourceEventId,
        eventType: normalizedResult.eventType,
        dedupeKey,
        payload,
        verificationState,
        receivedAt: timestamp,
      });
      const receiptId = await insertReceipt(client, expected, {
        dedupeKey,
        status,
        payload,
        platformDocumentSn: documentSn(normalizedResult),
        platformVersion: platformVersion(normalizedResult, expected.version),
        traceId: normalizedResult.diagnostics.traceId,
        occurredAt: timestamp,
      });
      const eventVersion = await nextEventVersion(client, expected);
      const event = await insertEvent(client, expected, {
        eventType: normalizedResult.eventType,
        eventVersion,
        dedupeKey,
        payload,
        occurredAt: timestamp,
      });

      let attemptState = text(context.attempt_state, 100);
      if (normalizedResult.resolvesResultUnknown && attemptState === "result_unknown") {
        const updated = await client.query({
          text: `UPDATE publish_attempts
                 SET state='resolved_by_official_readback',
                     resolved_at=$4::timestamptz, updated_at=$4::timestamptz
                 WHERE tenant_id=$1 AND store_id=$2 AND id=$3
                   AND state='result_unknown'
                 RETURNING state`,
          values: [
            expected.tenantId,
            expected.storeId,
            expected.publishAttemptId,
            timestamp,
          ],
        });
        if (!updated.rows[0]) {
          throw new Erp06OfficialReadbackRepositoryError(
            "ERP06_READBACK_RESOLUTION_FAILED",
            "result_unknown 未能由当前官方证据原子解除，事务已回滚",
            409,
          );
        }
        attemptState = "resolved_by_official_readback";
      }
      return {
        idempotent: false,
        commandId: expected.commandId,
        publishAttemptId: expected.publishAttemptId,
        stage: normalizedResult.stage,
        inboxId,
        receiptId,
        eventId: event.id,
        eventVersion: Number(event.event_version),
        receiptStatus: status,
        attemptState,
        resolvesResultUnknown: normalizedResult.resolvesResultUnknown,
        eventSchemaVersion: ERP06_OFFICIAL_READBACK_EVENT_SCHEMA_VERSION,
      };
    });
  }
}
