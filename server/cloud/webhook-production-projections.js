import { WebhookProcessingError } from "./webhook-event-processor.js";

const AUDIT_STATE_LABELS = new Map([
  [1, "pending"],
  [2, "passed"],
  [3, "failed"],
  [4, "withdrawn"],
]);

function asText(value, fieldName, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new WebhookProcessingError(
        "INVALID_PRODUCT_DOCUMENT_AUDIT_EVENT",
        `商品审核事件缺少 ${fieldName}`,
      );
    }
    return null;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_AUDIT_EVENT",
      `商品审核事件字段 ${fieldName} 类型无效`,
    );
  }
  return String(value);
}

function unwrapRecords(payload) {
  if (!payload || typeof payload !== "object") {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_AUDIT_EVENT",
      "商品审核事件 payload 不是对象或数组",
    );
  }
  if (Array.isArray(payload)) return payload;
  if (typeof payload.data === "string") {
    let parsed;
    try {
      parsed = JSON.parse(payload.data);
    } catch {
      throw new WebhookProcessingError(
        "INVALID_PRODUCT_DOCUMENT_AUDIT_EVENT",
        "商品审核事件 data JSON 字符串无效",
      );
    }
    return unwrapRecords({ data: parsed });
  }
  if (payload.data === undefined || payload.data === null) return [payload];
  if (Array.isArray(payload.data)) return payload.data;
  if (typeof payload.data === "object") return [payload.data];
  throw new WebhookProcessingError(
    "INVALID_PRODUCT_DOCUMENT_AUDIT_EVENT",
    "商品审核事件 data 不是对象或数组",
  );
}

function normalizeSkuList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_AUDIT_EVENT",
      "商品审核事件 sku_list 不是数组",
    );
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        throw new WebhookProcessingError(
          "INVALID_PRODUCT_DOCUMENT_AUDIT_EVENT",
          "商品审核事件 sku_list 项不是对象",
        );
      }
      return asText(item.sku_code, "sku_code");
    })
    .filter(Boolean);
}

function normalizeReceiveSkuList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_RECEIVE_EVENT",
      "商品接收事件 sku_list 不是数组",
    );
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        throw new WebhookProcessingError(
          "INVALID_PRODUCT_DOCUMENT_RECEIVE_EVENT",
          "商品接收事件 sku_list 项不是对象",
        );
      }
      return {
        supplierSku: asText(item.seller_sku, "seller_sku"),
        skuCode: asText(item.sku_code, "sku_code"),
      };
    })
    .filter((item) => item.supplierSku || item.skuCode);
}

function normalizeFailedReasons(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_AUDIT_EVENT",
      "商品审核事件 failed_reason 不是数组",
    );
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        throw new WebhookProcessingError(
          "INVALID_PRODUCT_DOCUMENT_AUDIT_EVENT",
          "商品审核事件 failed_reason 项不是对象",
        );
      }
      return {
        language: asText(item.language, "language"),
        content: asText(item.content, "content"),
      };
    })
    .filter((item) => item.language || item.content);
}

function normalizeReceiveFailedReasons(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_RECEIVE_EVENT",
      "商品接收事件 failed_reason 不是数组",
    );
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        throw new WebhookProcessingError(
          "INVALID_PRODUCT_DOCUMENT_RECEIVE_EVENT",
          "商品接收事件 failed_reason 项不是对象",
        );
      }
      return {
        language: item.language === undefined ? null : String(item.language),
        content: item.content === undefined ? null : String(item.content),
      };
    })
    .filter((item) => item.language || item.content);
}

function normalizeReceivedSuccess(value) {
  if (value === true || value === 1 || value === "1" || value === "true") {
    return true;
  }
  if (value === false || value === 0 || value === "0" || value === "false") {
    return false;
  }
  if (value === undefined || value === null || value === "") return null;
  throw new WebhookProcessingError(
    "INVALID_PRODUCT_DOCUMENT_RECEIVE_EVENT",
    "商品接收事件 received_success 类型无效",
  );
}

function unwrapReceiveRecords(payload) {
  if (!payload || typeof payload !== "object") {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_RECEIVE_EVENT",
      "商品接收事件 payload 不是对象或数组",
    );
  }
  if (Array.isArray(payload)) return payload;
  if (typeof payload.data === "string") {
    let parsed;
    try {
      parsed = JSON.parse(payload.data);
    } catch {
      throw new WebhookProcessingError(
        "INVALID_PRODUCT_DOCUMENT_RECEIVE_EVENT",
        "商品接收事件 data JSON 字符串无效",
      );
    }
    return unwrapReceiveRecords({ data: parsed });
  }
  if (payload.data === undefined || payload.data === null) return [payload];
  if (Array.isArray(payload.data)) return payload.data;
  if (typeof payload.data === "object") return [payload.data];
  throw new WebhookProcessingError(
    "INVALID_PRODUCT_DOCUMENT_RECEIVE_EVENT",
    "商品接收事件 data 不是对象或数组",
  );
}

function normalizeReceiveRecord(record, index) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_RECEIVE_EVENT",
      `商品接收事件第 ${index + 1} 条记录不是对象`,
    );
  }
  const receivedSuccess = normalizeReceivedSuccess(record.received_success);
  const details = record.document_details;
  if (
    details !== undefined &&
    details !== null &&
    !Array.isArray(details)
  ) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_RECEIVE_EVENT",
      "商品接收事件 document_details 不是数组",
    );
  }
  const rows = Array.isArray(details) && details.length ? details : [record];
  return rows.map((detail, detailIndex) => {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
      throw new WebhookProcessingError(
        "INVALID_PRODUCT_DOCUMENT_RECEIVE_EVENT",
        `商品接收事件第 ${index + 1} 条 document_details 不是对象`,
      );
    }
    const skuList = normalizeReceiveSkuList(detail.sku_list);
    const projection = {
      spuName: asText(detail.spu_name ?? record.spu_name, "spu_name"),
      skcName: asText(detail.skc_name ?? record.skc_name, "skc_name"),
      skuCodes: skuList.map((item) => item.skuCode).filter(Boolean),
      supplierSkus: skuList.map((item) => item.supplierSku).filter(Boolean),
      documentSn: asText(detail.document_sn, "document_sn"),
      version: asText(detail.version ?? record.version, "version"),
      receivedSuccess,
      status:
        receivedSuccess === true
          ? "accepted"
          : receivedSuccess === false
            ? "failed"
            : "unknown",
      failedReasons: normalizeReceiveFailedReasons(
        detail.failed_reason ?? record.failed_reason,
      ),
    };
    if (
      !projection.documentSn &&
      !projection.version &&
      !projection.spuName &&
      !projection.skcName &&
      !projection.skuCodes.length &&
      !projection.supplierSkus.length
    ) {
      throw new WebhookProcessingError(
        "INVALID_PRODUCT_DOCUMENT_RECEIVE_EVENT",
        `商品接收事件第 ${index + 1} 条记录缺少可追踪的商品标识`,
      );
    }
    return { ...projection, detailIndex };
  });
}

function normalizeRecord(record, index) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_AUDIT_EVENT",
      `商品审核事件第 ${index + 1} 条记录不是对象`,
    );
  }
  const auditStateValue = asText(record.audit_state, "audit_state", {
    required: true,
  });
  const auditState = Number(auditStateValue);
  const auditStateLabel = AUDIT_STATE_LABELS.get(auditState);
  if (!auditStateLabel) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_AUDIT_EVENT",
      `商品审核事件 audit_state 不受支持: ${auditStateValue}`,
    );
  }

  const skuCodes = normalizeSkuList(record.sku_list);
  const projection = {
    spuName: asText(record.spu_name, "spu_name"),
    skcName: asText(record.skc_name, "skc_name"),
    skuCodes,
    documentSn: asText(record.document_sn, "document_sn"),
    version: asText(record.version, "version"),
    auditTime: asText(record.audit_time, "audit_time"),
    auditState,
    auditStateLabel,
    status: auditStateLabel,
    failedReasons: normalizeFailedReasons(record.failed_reason),
  };
  // Some SHEIN status-notice variants include the current workflow stage in
  // addition to audit_state. Preserve it verbatim here; the review projection
  // normalizes the value against the allow-list and never infers a stage from
  // a generic status label.
  const workflowStage = asText(
    record.workflow_stage ?? record.workflowStage ?? record.stage,
    "workflow_stage",
  );
  if (workflowStage) projection.workflowStage = workflowStage;
  if (
    !projection.spuName &&
    !projection.skcName &&
    !projection.documentSn &&
    projection.skuCodes.length === 0
  ) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_AUDIT_EVENT",
      "商品审核事件缺少可追踪的商品标识",
    );
  }
  return projection;
}

export function projectProductDocumentReceiveStatusNotice(payload) {
  const records = unwrapReceiveRecords(payload).flatMap(normalizeReceiveRecord);
  if (!records.length) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_RECEIVE_EVENT",
      "商品接收事件没有可处理记录",
    );
  }
  const statuses = [...new Set(records.map((record) => record.status))];
  return {
    projectionVersion: "product-document-receive-v1",
    mode: "dry-run",
    externalWrite: false,
    projection: {
      eventFamily: "product_document_receive_status_notice",
      records,
    },
    summary: {
      disposition: "read-only-receive-projection",
      recordCount: records.length,
      statuses,
      acceptedRecordCount: records.filter(
        (record) => record.status === "accepted",
      ).length,
    },
  };
}

export function projectProductDocumentAuditStatusNotice(payload) {
  const records = unwrapRecords(payload).map(normalizeRecord);
  if (records.length === 0) {
    throw new WebhookProcessingError(
      "INVALID_PRODUCT_DOCUMENT_AUDIT_EVENT",
      "商品审核事件没有可处理记录",
    );
  }
  const states = [...new Set(records.map((record) => record.auditStateLabel))];
  const failedRecordCount = records.filter(
    (record) => record.auditStateLabel === "failed",
  ).length;
  return {
    projectionVersion: "product-document-audit-v1",
    mode: "dry-run",
    externalWrite: false,
    projection: {
      eventFamily: "product_document_audit_status_notice",
      records,
    },
    summary: {
      disposition: "read-only-audit-projection",
      recordCount: records.length,
      states,
      failedRecordCount,
      skuCount: records.reduce(
        (total, record) => total + record.skuCodes.length,
        0,
      ),
    },
  };
}

function withReceiptPersistence(
  handler,
  { publishExecutionRepository, receiptType } = {},
) {
  if (!publishExecutionRepository) return handler;
  return async (payload, event) => {
    const result = await handler(payload);
    const tenantId = event?.tenant_id || event?.tenantId;
    const storeId = event?.store_id || event?.storeId;
    const webhookEventId = event?.id;
    if (!tenantId || !storeId || !webhookEventId) {
      if (
        webhookEventId &&
        typeof publishExecutionRepository.appendUnscopedWebhookReceipts ===
          "function"
      ) {
        const persistence =
          await publishExecutionRepository.appendUnscopedWebhookReceipts({
            webhookEventId,
            receiptType,
            records: result.projection.records,
          });
        return {
          ...result,
          projection: {
            ...result.projection,
            persistence: {
              matchedCount: persistence.matchedCount,
              persistedCount: persistence.persistedCount,
              ambiguousCount: persistence.ambiguousCount,
              unmatchedCount: persistence.unmatchedCount.length,
              scopeFallback: true,
            },
          },
          summary: {
            ...result.summary,
            matchedCount: persistence.matchedCount,
            persistedCount: persistence.persistedCount,
            ambiguousCount: persistence.ambiguousCount,
            unmatchedCount: persistence.unmatchedCount.length,
            persistenceSkipped: false,
            scopeFallback: true,
          },
        };
      }
      return {
        ...result,
        projection: {
          ...result.projection,
          persistence: {
            matchedCount: 0,
            persistedCount: 0,
            ambiguousCount: 0,
            unmatchedCount: result.projection.records.length,
            skipped: true,
            reason: "WEBHOOK_EVENT_SCOPE_UNAVAILABLE",
          },
        },
        summary: {
          ...result.summary,
          matchedCount: 0,
          persistedCount: 0,
          ambiguousCount: 0,
          unmatchedCount: result.projection.records.length,
          persistenceSkipped: true,
        },
      };
    }
    const persistence = await publishExecutionRepository.appendWebhookReceipts({
      tenantId,
      storeId,
      webhookEventId,
      receiptType,
      records: result.projection.records,
    });
    return {
      ...result,
      projection: {
        ...result.projection,
        persistence: {
          matchedCount: persistence.matchedCount,
          persistedCount: persistence.persistedCount,
          ambiguousCount: persistence.ambiguousCount,
          unmatchedCount: persistence.unmatchedCount.length,
        },
      },
      summary: {
        ...result.summary,
        matchedCount: persistence.matchedCount,
        persistedCount: persistence.persistedCount,
        ambiguousCount: persistence.ambiguousCount,
        unmatchedCount: persistence.unmatchedCount.length,
      },
    };
  };
}

function withProductReviewPersistence(
  handler,
  { productReviewRepository } = {},
) {
  if (!productReviewRepository) return handler;
  return async (payload, event) => {
    const result = await handler(payload, event);
    const tenantId = event?.tenant_id || event?.tenantId || null;
    const storeId = event?.store_id || event?.storeId || null;
    const records = Array.isArray(result?.projection?.records)
      ? result.projection.records
      : [];
    if (!tenantId || !storeId || !records.length) {
      return {
        ...result,
        projection: {
          ...result.projection,
          reviewStatePersistence: {
            savedCount: 0,
            skipped: true,
            reason: !tenantId || !storeId
              ? "WEBHOOK_EVENT_SCOPE_UNAVAILABLE"
              : "NO_REVIEW_RECORDS",
          },
        },
        summary: {
          ...result.summary,
          reviewStatePersistenceSkipped: true,
        },
      };
    }
    const persistence = await productReviewRepository.saveDocumentStates({
      tenantId,
      storeId,
      records,
    });
    return {
      ...result,
      projection: {
        ...result.projection,
        reviewStatePersistence: {
          savedCount: Number(persistence?.savedCount || 0),
          skipped: false,
        },
      },
      summary: {
        ...result.summary,
        reviewStateSavedCount: Number(persistence?.savedCount || 0),
      },
    };
  };
}

function withLocalBusinessProjection(
  handler,
  { stateRepository, applyRecord, disposition, resultField } = {},
) {
  if (!stateRepository) return handler;
  return async (payload, event) => {
    const result = await handler(payload, event);
    const tenantId = event?.tenant_id || event?.tenantId || null;
    const storeId = event?.store_id || event?.storeId || null;
    // Business projections are only safe after the ingress resolver has
    // attached an authenticated tenant/store scope. Keep the event stored for
    // replay, but never fan an unscoped payload out to every matching store.
    if (!tenantId || !storeId) {
      const skippedCount = result.projection.records.length;
      return {
        ...result,
        mode: "projected",
        projection: {
          ...result.projection,
          localState: { appliedCount: 0, skippedCount, outcomes: [] },
        },
        summary: {
          ...result.summary,
          disposition,
          [resultField]: 0,
          localStateAppliedCount: 0,
          localStateSkippedCount: skippedCount,
          scopeRequired: true,
        },
      };
    }
    const outcomes = [];
    for (const record of result.projection.records) {
      outcomes.push(await applyRecord({
        stateRepository,
        record,
        eventId: event?.id || null,
        tenantId: event?.tenant_id || event?.tenantId || null,
        storeId: event?.store_id || event?.storeId || null,
      }));
    }
    const appliedCount = outcomes.reduce(
      (total, outcome) => total + Number(outcome?.matchedCount || 0),
      0,
    );
    const skippedCount = outcomes.filter((outcome) => outcome?.skipped).length;
    return {
      ...result,
      mode: "projected",
      projection: {
        ...result.projection,
        localState: { appliedCount, skippedCount, outcomes },
      },
      summary: {
        ...result.summary,
        disposition,
        [resultField]: appliedCount,
        localStateAppliedCount: appliedCount,
        localStateSkippedCount: skippedCount,
      },
    };
  };
}

function unwrapGenericRecords(payload, errorCode, eventLabel) {
  if (!payload || typeof payload !== "object") {
    throw new WebhookProcessingError(
      errorCode,
      `${eventLabel} payload 不是对象或数组`,
    );
  }
  if (Array.isArray(payload)) return payload;
  if (typeof payload.data === "string") {
    let parsed;
    try {
      parsed = JSON.parse(payload.data);
    } catch {
      throw new WebhookProcessingError(
        errorCode,
        `${eventLabel} data JSON 字符串无效`,
      );
    }
    return unwrapGenericRecords(parsed, errorCode, eventLabel);
  }
  if (payload.data === undefined || payload.data === null) return [payload];
  if (Array.isArray(payload.data)) return payload.data;
  if (typeof payload.data === "object") return [payload.data];
  throw new WebhookProcessingError(
    errorCode,
    `${eventLabel} data 不是对象或数组`,
  );
}

function eventText(value, fieldName, errorCode, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new WebhookProcessingError(
        errorCode,
        `事件缺少 ${fieldName}`,
      );
    }
    return null;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new WebhookProcessingError(
      errorCode,
      `事件字段 ${fieldName} 类型无效`,
    );
  }
  return String(value);
}

function eventRecord(record, index, errorCode, eventLabel) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new WebhookProcessingError(
      errorCode,
      `${eventLabel} 第 ${index + 1} 条记录不是对象`,
    );
  }
  return record;
}

export function projectProductQuotaChangeNotice(payload) {
  const errorCode = "INVALID_PRODUCT_QUOTA_CHANGE_EVENT";
  const eventLabel = "商品额度变更事件";
  const records = unwrapGenericRecords(payload, errorCode, eventLabel).map(
    (item, index) => {
      const record = eventRecord(item, index, errorCode, eventLabel);
      return {
        supplierId: eventText(
          record.supplierId ?? record.supplier_id,
          "supplierId",
          errorCode,
          { required: true },
        ),
        reason: eventText(record.reason, "reason", errorCode, {
          required: true,
        }),
        availableLimit: eventText(
          record.availableLimit ?? record.available_limit,
          "availableLimit",
          errorCode,
          { required: true },
        ),
        sendTimestamp: eventText(
          record.sendTimeStamp ?? record.sendTimestamp ?? record.send_timestamp,
          "sendTimeStamp",
          errorCode,
          { required: true },
        ),
      };
    },
  );
  return {
    projectionVersion: "product-quota-change-v1",
    mode: "dry-run",
    externalWrite: false,
    projection: {
      eventFamily: "product_quota_change_notice",
      records,
    },
    summary: {
      disposition: "read-only-quota-projection",
      recordCount: records.length,
    },
  };
}

export function projectProductComplianceChangeNotice(payload) {
  const errorCode = "INVALID_PRODUCT_COMPLIANCE_CHANGE_EVENT";
  const eventLabel = "商品合规变更事件";
  const records = unwrapGenericRecords(payload, errorCode, eventLabel).map(
    (item, index) => {
      const record = eventRecord(item, index, errorCode, eventLabel);
      const skc = eventText(record.skc ?? record.skc_name, "skc", errorCode);
      const supplierId = eventText(
        record.supplierId ?? record.supplier_id,
        "supplierId",
        errorCode,
      );
      if (!skc && !supplierId) {
        throw new WebhookProcessingError(
          errorCode,
          "商品合规变更事件缺少 skc 或 supplierId",
        );
      }
      return {
        skc,
        complianceTypeId: eventText(
          record.complianceTypeId ?? record.compliance_type_id,
          "complianceTypeId",
          errorCode,
        ),
        isMiss: eventText(record.isMiss ?? record.is_miss, "isMiss", errorCode),
        isRequired: eventText(
          record.isRequired ?? record.is_required,
          "isRequired",
          errorCode,
        ),
        updateTime: eventText(
          record.updateTime ?? record.update_time,
          "updateTime",
          errorCode,
        ),
        supplierId,
      };
    },
  );
  return {
    projectionVersion: "product-compliance-change-v1",
    mode: "dry-run",
    externalWrite: false,
    projection: {
      eventFamily: "product_compliance_change_notice",
      records,
    },
    summary: {
      disposition: "read-only-compliance-change-projection",
      recordCount: records.length,
      invalidationCount: records.filter((record) => record.isMiss === "1").length,
    },
  };
}

export function projectAuthorizationChangeNotice(payload) {
  const errorCode = "INVALID_AUTHORIZATION_CHANGE_EVENT";
  const eventLabel = "店铺授权变更事件";
  const records = unwrapGenericRecords(payload, errorCode, eventLabel).map(
    (item, index) => {
      const record = eventRecord(item, index, errorCode, eventLabel);
      const type = eventText(record.type, "type", errorCode, { required: true });
      if (!new Set(["1", "2", "3", "4", "5", "6"]).has(type)) {
        throw new WebhookProcessingError(
          errorCode,
          `店铺授权变更事件 type 不受支持: ${type}`,
        );
      }
      return {
        type,
        srmSupplierId: eventText(
          record.srmSupplierId ?? record.srm_supplier_id,
          "srmSupplierId",
          errorCode,
        ),
        message: eventText(record.message, "message", errorCode),
      };
    },
  );
  return {
    projectionVersion: "authorization-change-v1",
    mode: "dry-run",
    externalWrite: false,
    projection: {
      eventFamily: "authorization_change_notice",
      records,
    },
    summary: {
      disposition: "read-only-authorization-change-projection",
      recordCount: records.length,
      requiresReauthorization: records.filter((record) =>
        new Set(["1", "2", "3", "4", "5", "6"]).has(record.type),
      ).length,
    },
  };
}

export function projectOutOfStockNotice(payload) {
  const errorCode = "INVALID_OUT_OF_STOCK_EVENT";
  const eventLabel = "商品缺货事件";
  const records = unwrapGenericRecords(payload, errorCode, eventLabel).map(
    (item, index) => {
      const record = eventRecord(item, index, errorCode, eventLabel);
      const skcName = eventText(record.skcName ?? record.skc_name, "skcName", errorCode);
      const skuCode = eventText(record.skuCode ?? record.sku_code, "skuCode", errorCode);
      if (!skcName && !skuCode) {
        throw new WebhookProcessingError(errorCode, "商品缺货事件缺少 skcName 或 skuCode");
      }
      const quantity = Number(record.outOfStockQty ?? record.out_of_stock_qty ?? 0);
      const tempLockExceptionQty = Number(
        record.tempLockExceptionQty ?? record.temp_lock_exception_qty ?? 0,
      );
      if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(tempLockExceptionQty) || tempLockExceptionQty < 0) {
        throw new WebhookProcessingError(errorCode, "商品缺货事件数量无效");
      }
      return {
        skcName,
        skuCode,
        outOfStockQty: quantity,
        tempLockExceptionQty,
        sendTimestamp: eventText(
          record.sendTimestamp ?? record.send_timestamp,
          "sendTimestamp",
          errorCode,
        ),
      };
    },
  );
  return {
    projectionVersion: "out-of-stock-v1",
    mode: "projected",
    externalWrite: false,
    projection: { eventFamily: "out_of_stock_notice", records },
    summary: {
      disposition: "local-out-of-stock-projection",
      recordCount: records.length,
      skuCount: records.filter((record) => record.skuCode).length,
    },
  };
}

export function projectUndocumentedWebhookEvent(
  payload,
  eventFamily = "product_document_audit_status_notice_all_channels",
) {
  if (!payload || typeof payload !== "object") {
    throw new WebhookProcessingError(
      "INVALID_UNDOCUMENTED_WEBHOOK_EVENT",
      "未完备字段契约的 Webhook payload 不是对象或数组",
    );
  }
  return {
    projectionVersion: "stored-only-v1",
    mode: "stored-only",
    externalWrite: false,
    projection: {
      eventFamily,
      records: [],
    },
    summary: {
      disposition: "stored-only-undocumented-payload",
      recordCount: 0,
    },
  };
}

export function createDefaultWebhookProductionHandlers({
  publishExecutionRepository = null,
  stateRepository = null,
  productReviewRepository = null,
} = {}) {
  const auditHandler = withProductReviewPersistence(
    withReceiptPersistence(projectProductDocumentAuditStatusNotice, {
      publishExecutionRepository,
      receiptType: "audited",
    }),
    { productReviewRepository },
  );
  return {
    product_document_receive_status_notice: withReceiptPersistence(
      projectProductDocumentReceiveStatusNotice,
      {
        publishExecutionRepository,
        receiptType: "received",
      },
    ),
    product_document_audit_status_notice: auditHandler,
    product_quota_change_notice: withLocalBusinessProjection(
      projectProductQuotaChangeNotice,
      {
        stateRepository,
        disposition: "local-quota-projection",
        resultField: "quotaStoreCount",
        applyRecord: ({ stateRepository: repository, record, eventId, tenantId, storeId }) =>
          repository.saveQuotaProjection({
            ...record,
            tenantId,
            storeId,
            webhookEventId: eventId,
          }),
      },
    ),
    product_compliance_change_notice: withLocalBusinessProjection(
      projectProductComplianceChangeNotice,
      {
        stateRepository,
        disposition: "local-compliance-invalidation-projection",
        resultField: "complianceSkcCount",
        applyRecord: ({ stateRepository: repository, record, eventId, tenantId, storeId }) =>
          repository.markComplianceInvalidated({
            ...record,
            tenantId,
            storeId,
            webhookEventId: eventId,
          }),
      },
    ),
    authorization_change_notice: withLocalBusinessProjection(
      projectAuthorizationChangeNotice,
      {
        stateRepository,
        disposition: "local-authorization-projection",
        resultField: "reauthorizationStoreCount",
        applyRecord: ({ stateRepository: repository, record, eventId, tenantId, storeId }) => {
          if (!record.srmSupplierId) {
            return Promise.resolve({ matchedCount: 0, storeIds: [], skipped: true });
          }
          return repository.requireReauthorizationBySupplierId(
            {
              supplierId: record.srmSupplierId,
              tenantId,
              storeId,
              webhookEventId: eventId,
            },
          ).then((storeIds) => ({
            matchedCount: storeIds.length,
            storeIds,
            skipped: false,
          }));
        },
      },
    ),
    out_of_stock_notice: withLocalBusinessProjection(
      projectOutOfStockNotice,
      {
        stateRepository,
        disposition: "local-out-of-stock-projection",
        resultField: "outOfStockSkuCount",
        applyRecord: ({ stateRepository: repository, record, eventId, tenantId, storeId }) =>
          repository.saveOutOfStockProjection({
            ...record,
            tenantId,
            storeId,
            webhookEventId: eventId,
          }),
      },
    ),
    product_video_conversion_completed: (payload) =>
      projectUndocumentedWebhookEvent(payload, "product_video_conversion_completed"),
    // The payload is structurally compatible with the documented audit
    // notice (audit_state, version/SKC, audit_time, failed_reason). It must
    // enter the same projection so an all-channel notice cannot leave the
    // current review state stale.
    product_document_audit_status_notice_all_channels: withProductReviewPersistence(
      withReceiptPersistence(projectProductDocumentAuditStatusNotice, {
        publishExecutionRepository,
        receiptType: "audited",
      }),
      { productReviewRepository },
    ),
  };
}
