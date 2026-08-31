import { WebhookProcessingError } from "./webhook-event-processor.js";

const AUDIT_STATE_LABELS = new Map([
  [-1, "acceptance_failed"],
  [1, "pending"],
  [2, "passed"],
  [3, "failed"],
  [4, "withdrawn"],
  [5, "appeal_in_progress"],
]);

function asText(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_STATE",
      `商品文档状态字段 ${fieldName} 类型无效`,
    );
  }
  return String(value);
}

function parseJson(value, fieldName) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_STATE",
      `商品文档状态 ${fieldName} JSON 字符串无效`,
    );
  }
}

function unwrapRecords(payload) {
  const parsed = parseJson(payload, "payload");
  if (!parsed || typeof parsed !== "object") {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_STATE",
      "商品文档状态响应不是对象或数组",
    );
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed.info !== undefined && parsed.info !== parsed) {
    return unwrapRecords(parsed.info);
  }
  if (parsed.data !== undefined && parsed.data !== parsed) {
    const data = parseJson(parsed.data, "data");
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") return [data];
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_STATE",
      "商品文档状态 data 不是对象或数组",
    );
  }
  return [parsed];
}

function normalizeSkuCodes(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_STATE",
      "商品文档状态 sku_list 不是数组",
    );
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new WebhookProcessingError(
          "INVALID_PRODUCT_DOCUMENT_STATE",
          "商品文档状态 sku_list 项不是对象",
        );
      }
      return asText(item.sku_code ?? item.skuCode, "sku_code");
    })
    .filter(Boolean);
}

function normalizeFailedReasons(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_STATE",
      "商品文档状态 failed_reason 不是数组",
    );
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new WebhookProcessingError(
          "INVALID_PRODUCT_DOCUMENT_STATE",
          "商品文档状态 failed_reason 项不是对象",
        );
      }
      return {
        language: asText(item.language, "language"),
        content: asText(item.content, "content"),
      };
    })
    .filter((item) => item.language || item.content);
}

function normalizeRecord(record, requestedVersion, index) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_STATE",
      `商品文档状态第 ${index + 1} 条记录不是对象`,
    );
  }
  const version = asText(record.version, "version") || requestedVersion;
  const auditStateValue = asText(
    record.audit_state ?? record.documentState,
    "audit_state",
  );
  const auditState = auditStateValue === null ? null : Number(auditStateValue);
  const auditStateLabel =
    auditState === null ? "unknown" : AUDIT_STATE_LABELS.get(auditState);
  if (auditStateValue !== null && !auditStateLabel) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_STATE",
      `商品文档状态 audit_state 不受支持: ${auditStateValue}`,
    );
  }
  const recordProjection = {
    spuName: asText(record.spu_name ?? record.spuName, "spu_name"),
    skcName: asText(record.skc_name ?? record.skcName, "skc_name"),
    skuCodes: normalizeSkuCodes(record.sku_list ?? record.skuList),
    documentSn: asText(record.document_sn ?? record.documentSn, "document_sn"),
    version,
    auditTime: asText(record.audit_time ?? record.auditTime, "audit_time"),
    auditState,
    auditStateLabel,
    status: auditStateLabel,
    failedReasons: normalizeFailedReasons(
      record.failed_reason ?? record.failedReason,
    ),
    occurredAt: asText(record.audit_time ?? record.auditTime, "audit_time"),
  };
  const stage = asText(record.workflow_stage ?? record.workflowStage ?? record.stage, "workflow_stage");
  if (stage) recordProjection.workflowStage = stage;
  if (
    !recordProjection.version &&
    !recordProjection.documentSn &&
    !recordProjection.spuName &&
    !recordProjection.skcName &&
    !recordProjection.skuCodes.length
  ) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_STATE",
      `商品文档状态第 ${index + 1} 条记录缺少可追踪的商品标识`,
    );
  }
  return recordProjection;
}

export function normalizeProductDocumentState(
  payload,
  { requestedVersion = "" } = {},
) {
  const version = String(requestedVersion || "").trim() || null;
  const expanded = unwrapRecords(payload).flatMap((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return [record];
    }
    if (record.skcList === undefined && record.skc_list === undefined) {
      return [record];
    }
    const skcList = record.skcList ?? record.skc_list;
    if (!Array.isArray(skcList)) {
      throw new WebhookProcessingError(
        "INVALID_PRODUCT_DOCUMENT_STATE",
        `商品文档状态第 ${index + 1} 条记录 skcList 不是数组`,
      );
    }
    return skcList.map((skc) => ({
      ...skc,
      spuName: skc?.spuName ?? skc?.spu_name ?? record.spuName ?? record.spu_name,
      version: skc?.version ?? record.version,
    }));
  });
  const records = expanded.map((record, index) =>
    normalizeRecord(record, version, index),
  );
  if (!records.length) {
    return {
      projectionVersion: "product-document-state-v1",
      mode: "dry-run",
      externalWrite: false,
      empty: true,
      projection: {
        eventFamily: "query-document-state",
        records: [],
      },
      summary: {
        disposition: "read-only-document-state-empty",
        recordCount: 0,
        states: [],
        passedRecordCount: 0,
        failedRecordCount: 0,
      },
    };
  }
  return {
    projectionVersion: "product-document-state-v1",
    mode: "dry-run",
    externalWrite: false,
    projection: {
      eventFamily: "query-document-state",
      records,
    },
    summary: {
      disposition: "read-only-document-state-projection",
      recordCount: records.length,
      states: [...new Set(records.map((record) => record.status))],
      passedRecordCount: records.filter((record) => record.status === "passed")
        .length,
      failedRecordCount: records.filter((record) => record.status === "failed")
        .length,
    },
  };
}
