import { requestShein } from "../shein-client.js";
import { syncStoreComplianceData } from "../shein-compliance.js";
import { fetchComplianceRuleBundle } from "../compliance-rules.js";
import { buildCompliancePreflight } from "../compliance-workflow.js";
import { runPublishPreflight } from "../publish-preflight.js";
import { normalizeProductSearch } from "../shein-product.js";
import { uploadSheinImageDirect } from "../shein-upload.js";
import { syncStoreBusinessData } from "../store-data-sync.js";
import { WebAuthError } from "./web-auth.js";
import { normalizeProductDocumentState } from "./document-state-projections.js";
import { normalizeSpuInfo } from "./spu-readback-projections.js";
import {
  buildProductAttributeSnapshot,
  existingRugReportSources,
} from "./product-attribute-snapshot.js";
import {
  buildComplianceRevalidation,
} from "./compliance-revalidation-projections.js";
import { buildPublishSchemaCoverage } from "../publish-schema-coverage.js";

const PRODUCT_SEARCH_PATH = "/open-api/goods/searchProduct";
const DOCUMENT_STATE_PATH = "/open-api/goods/query-document-state";
const SPU_INFO_PATH = "/open-api/goods/spu-info";
const MAX_PRODUCT_PAGE_SIZE = 10;
const MAX_COMPLIANCE_SKCS = 20;
const CATEGORY_TREE_PATH = "/open-api/goods/query-category-tree";
const ATTRIBUTE_TEMPLATE_PATH = "/open-api/goods/query-attribute-template";
const PUBLISH_STANDARD_PATH =
  "/open-api/goods/query-publish-fill-in-standard";
const CUSTOM_ATTRIBUTE_PERMISSION_PATH =
  "/open-api/goods/get-custom-attribute-permission-config";
const ASSOCIATED_ATTRIBUTE_RULES_PATH =
  "/open-api/goods/get-associated-attribute-rules";
const PRICE_DISCUSS_LIST_PATH = "/open-api/goods/discuss/query-discuss-list";
const PRICE_DISCUSS_PROCESS_PATH = "/open-api/goods/discuss/process-discuss";
const CATEGORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PUBLISH_SCHEMA_CACHE_TTL_MS = 30 * 60 * 1000;
const COMPLIANCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function isAdministrator(context) {
  return ["owner", "admin"].includes(context?.role);
}

function integerInRange(value, fallback, min, max) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized)) return fallback;
  return Math.min(max, Math.max(min, normalized));
}

function uniqueSkcs(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function publicProjectionError(error, fallbackMessage = "本地状态投影失败") {
  return {
    code: String(error?.code || "LOCAL_PROJECTION_FAILED").trim().slice(0, 100),
    message: String(error?.message || fallbackMessage).trim().slice(0, 500),
  };
}

function latestCostHistory(histories) {
  return (Array.isArray(histories) ? histories : [])
    .map((history) => ({
      serialNumber: Number(history?.serialNumber ?? -1),
      costPrice: history?.costPrice ?? null,
      currency: String(history?.currency || "").trim(),
    }))
    .filter((history) => history.serialNumber >= 0 && history.costPrice != null)
    .sort((left, right) => right.serialNumber - left.serialNumber)[0] || null;
}

function normalizePriceDiscussion(row) {
  const source = row && typeof row === "object" ? row : {};
  return {
    discussSn: String(source.discussSn || "").trim(),
    discussStatus: Number(source.discussStatus ?? 0),
    discussType: Number(source.discussType ?? 0),
    serialNumber: Number(source.serialNumber ?? 0),
    appealCount: Number(source.appealCount ?? 0),
    skcName: String(source.skcName || "").trim(),
    supplierCode: String(source.supplierCode || "").trim(),
    spuName: String(source.spuName || "").trim(),
    productTitle: String(source.productTitle || "").trim(),
    mainPicUrl: String(source.mainPicUrl || "").trim(),
    suggestCostPrice: source.skuCostPrices?.[0]?.suggestCostPrice ?? null,
    suggestCostCurrency: String(source.skuCostPrices?.[0]?.suggestCostCurrency || "").trim(),
    skuCostPrices: (Array.isArray(source.skuCostPrices) ? source.skuCostPrices : [])
      .map((sku) => {
        const latest = latestCostHistory(sku?.costPriceHistories);
        return {
          skuCode: String(sku?.skuCode || "").trim(),
          saleAttributeValues: Array.isArray(sku?.saleAttributeValues) ? sku.saleAttributeValues : [],
          latestCostPrice: sku?.latestCostPrice ?? latest?.costPrice ?? null,
          latestCurrency: latest?.currency || "",
          suggestCostPrice: sku?.suggestCostPrice ?? null,
          suggestCostCurrency: String(sku?.suggestCostCurrency || "").trim(),
        };
      }),
    appealReason: String(source.appealReason || "").trim(),
    isSizeSamePrice: Number(source.isSizeSamePrice ?? 0),
    occurredAt: source.occurredAt || null,
  };
}

function certificateLibrarySnapshot(certificates) {
  return (Array.isArray(certificates) ? certificates : [])
    .filter((certificate) => Number(certificate?.status) === 2)
    .map((certificate) => ({
      poolId: certificate.poolId ?? null,
      poolSn: String(certificate.poolSn || ""),
      certificateTypeId: certificate.certificateTypeId ?? null,
      certificateTypeCode: String(certificate.certificateTypeCode || ""),
      certificateTypeName: String(certificate.certificateTypeName || ""),
      status: 2,
      certificateDimension: certificate.certificateDimension ?? null,
      effectiveTime: String(certificate.effectiveTime || ""),
      invalidTime: String(certificate.invalidTime || ""),
      alertTime: String(certificate.alertTime || ""),
      bindSkcFlag: certificate.bindSkcFlag ?? null,
      lastUpdateTime: String(certificate.lastUpdateTime || ""),
      fileNames: (Array.isArray(certificate.fileList) ? certificate.fileList : [])
        .map((file) => String(file?.fileName || "").trim())
        .filter(Boolean),
    }));
}

function agencyLibrarySnapshot(agencies) {
  return (Array.isArray(agencies) ? agencies : [])
    .filter(
      (agency) =>
        Number(agency?.agencyStatus) === 0 &&
        [1, 2].includes(Number(agency?.applyStatus)),
    )
    .map((agency) => ({
      agencyId: agency.agencyId ?? null,
      agencyName: String(agency.agencyName || ""),
      agencyType: agency.agencyType ?? null,
      agencySubType: agency.agencySubType ?? null,
      agencyStartTime: String(agency.agencyStartTime || ""),
      agencyEndTime: String(agency.agencyEndTime || ""),
      agencyStatus: 0,
      applyStatus: Number(agency.applyStatus),
      coveredProductRange: agency.coveredProductRange ?? null,
      updateTime: String(agency.updateTime || ""),
    }));
}

function warningRulesSnapshot(rules) {
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => Number(rule?.presetInfo?.isEnabled ?? 1) === 1)
    .map((rule) => ({
      certificateTypeId: rule.certificateTypeId ?? null,
      certificateTypeCode: String(rule.certificateTypeCode || ""),
      certificateTypeName: String(rule.certificateTypeName || ""),
      fields: (Array.isArray(rule.presetInfo?.presetFields)
        ? rule.presetInfo.presetFields
        : [])
        .filter((field) => Number(field?.isEnabled ?? 1) === 1)
        .sort((left, right) => Number(left?.fieldSort) - Number(right?.fieldSort))
        .map((field) => ({
          fieldCode: String(field.fieldCode || ""),
          fieldName: String(field.fieldName || ""),
          fieldType: field.fieldType ?? null,
          fieldSort: field.fieldSort ?? null,
          values: (Array.isArray(field.presetFieldValues)
            ? field.presetFieldValues
            : [])
            .filter((value) => Number(value?.isEnabled ?? 1) === 1)
            .sort((left, right) => Number(left?.valueSort) - Number(right?.valueSort))
            .map((value) => ({
              fieldValueId: value.fieldValueId ?? null,
              fieldValue: String(value.fieldValue || ""),
              exclusionFieldValueIds: Array.isArray(value.exclusionFieldValueIds)
                ? value.exclusionFieldValueIds
                : [],
              mappingPaths: (Array.isArray(value.mappingPaths) ? value.mappingPaths : [])
                .map((path) => ({
                  fieldValueIds: Array.isArray(path?.fieldValueIds)
                    ? path.fieldValueIds
                    : [],
                })),
              valueSort: value.valueSort ?? null,
            })),
        })),
    }));
}

export class SheinWebReadService {
  constructor({
    storeRepository,
    ruleSnapshotRepository = null,
    apiBaseUrl,
    fetchImpl = fetch,
    now = () => new Date(),
    publishExecutionRepository = null,
    productReviewRepository = null,
  } = {}) {
    if (!storeRepository) {
      throw new Error("SheinWebReadService 缺少 storeRepository");
    }
    if (!apiBaseUrl) throw new Error("SheinWebReadService 缺少 apiBaseUrl");
    this.storeRepository = storeRepository;
    this.ruleSnapshotRepository = ruleSnapshotRepository;
    this.apiBaseUrl = apiBaseUrl;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.publishExecutionRepository = publishExecutionRepository;
    this.productReviewRepository = productReviewRepository;
    this.publishRuleCache = new Map();
  }

  async #cachedPublishRule(key, ttlMs, load, forceRefresh = false) {
    const now = this.now().getTime();
    if (forceRefresh) {
      // Full category refreshes can visit thousands of large schemas. The
      // authoritative snapshot is persisted below; retaining every forced
      // response here would exhaust the Worker heap before the queue ends.
      return load();
    }
    const cached = this.publishRuleCache.get(key);
    if (cached?.value && cached.expiresAt > now) {
      return cached.value;
    }
    if (cached?.promise) return cached.promise;
    const promise = Promise.resolve()
      .then(load)
      .then((value) => {
        this.publishRuleCache.set(key, {
          value,
          expiresAt: this.now().getTime() + ttlMs,
          promise: null,
        });
        return value;
      })
      .catch((error) => {
        this.publishRuleCache.delete(key);
        throw error;
      });
    this.publishRuleCache.set(key, { value: null, expiresAt: 0, promise });
    return promise;
  }

  async #persistentPublishRule({
    tenantId,
    storeId,
    ruleType,
    categoryId = "",
    productTypeId = "",
    ttlMs,
    forceRefresh = false,
    allowRemoteFetch = true,
    shareWithinTenant = false,
    load,
  }) {
    const repository = this.ruleSnapshotRepository;
    if (!repository) {
      if (!allowRemoteFetch) {
        throw new WebAuthError(
          "RULE_SYNC_REQUIRED",
          "当前类目和商品属性尚未由管理员同步，请联系管理员先完成同步",
          409,
        );
      }
      return load();
    }
    if (!forceRefresh) {
      const cached = await repository.getFresh({
        tenantId,
        storeId,
        ruleType,
        categoryId,
        productTypeId,
        subjectKey: "",
        shareWithinTenant,
        now: this.now(),
      });
      if (cached) {
        return {
          info: cached.payload || {},
          diagnostics: {
            traceId: cached.source_trace_id || "",
            durationMs: 0,
            source: "database-cache",
            fetchedAt: cached.fetched_at || null,
          },
        };
      }
    }
    if (!allowRemoteFetch) {
      throw new WebAuthError(
        "RULE_SYNC_REQUIRED",
        "当前类目和商品属性尚未由管理员同步，请联系管理员先完成同步",
        409,
      );
    }
    const result = await load();
    const fetchedAt = this.now();
    await repository.upsert({
      tenantId,
      storeId,
      ruleType,
      categoryId,
      productTypeId,
      subjectKey: "",
      payload: result.info || {},
      sourceTraceId: result.diagnostics?.traceId || null,
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + ttlMs),
    });
    return result;
  }

  async #credential(context, storeId) {
    let credential;
    try {
      credential = await this.storeRepository.getCredential(storeId);
    } catch (error) {
      if (error?.code !== "CLOUD_CREDENTIAL_DECRYPT_FAILED") throw error;
      await this.storeRepository.requireReauthorizationByStoreId?.(storeId);
      throw new WebAuthError(
        "STORE_REAUTHORIZATION_REQUIRED",
        "店铺授权凭证无法解密，请重新授权该店铺",
        409,
      );
    }
    if (
      !credential ||
      credential.tenantId !== context.tenantId ||
      credential.status !== "active"
    ) {
      if (
        credential?.tenantId === context.tenantId &&
        credential?.status === "reauthorization_required"
      ) {
        throw new WebAuthError(
          "STORE_REAUTHORIZATION_REQUIRED",
          "SHEIN店铺授权已失效，请先在店铺管理中重新授权该店铺",
          409,
        );
      }
      throw new WebAuthError(
        "STORE_UNAVAILABLE",
        "店铺凭证不存在、已失效或不属于当前工作空间",
        409,
      );
    }
    return credential;
  }

  async #requestShein(storeId, options) {
    try {
      return await requestShein(options);
    } catch (error) {
      if (error?.status === 401 && String(error?.code || "") === "openapi00001") {
        await this.storeRepository.requireReauthorizationByStoreId?.(storeId);
        throw new WebAuthError(
          "STORE_REAUTHORIZATION_REQUIRED",
          "SHEIN店铺授权凭证已失效（签名校验失败），请重新授权该店铺后重试",
          409,
        );
      }
      throw error;
    }
  }

  async listProducts({
    context,
    storeId,
    pageNum = 1,
    pageSize = 10,
    skc = "",
  } = {}) {
    const credential = await this.#credential(context, storeId);
    const normalizedPageNum = integerInRange(pageNum, 1, 1, 100000);
    const normalizedPageSize = integerInRange(
      pageSize,
      10,
      1,
      MAX_PRODUCT_PAGE_SIZE,
    );
    const normalizedSkc = String(skc || "").trim();
    const result = await this.#requestShein(storeId, {
      baseUrl: this.apiBaseUrl,
      method: "POST",
      path: PRODUCT_SEARCH_PATH,
      body: {
        pageNum: normalizedPageNum,
        pageSize: normalizedPageSize,
        languageList: ["zh-cn", "en"],
        ...(normalizedSkc ? { skcNameList: [normalizedSkc] } : {}),
      },
      openKeyId: credential.openKeyId,
      secretKey: credential.secretKey,
      timeoutMs: 30_000,
      fetchImpl: this.fetchImpl,
    });
    const products = normalizeProductSearch(
      result.payload.info,
      normalizedSkc,
    );
    return {
      products,
      count: products.length,
      total: Number(result.payload.info?.meta?.count || products.length),
      pageNum: normalizedPageNum,
      pageSize: normalizedPageSize,
      diagnostics: {
        traceId: result.diagnostics.traceId,
        durationMs: result.diagnostics.durationMs,
      },
    };
  }

  async queryDocumentState({
    context,
    storeId,
    version,
    spuNames,
    spuName,
  } = {}) {
    const normalizedVersion = String(version || "").trim();
    const normalizedSpuNames = Array.from(new Set([
      ...(Array.isArray(spuNames) ? spuNames : []),
      spuName,
    ].map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 100);
    if (!normalizedVersion || !normalizedSpuNames.length) {
      throw new WebAuthError(
        "INVALID_REQUEST",
        "version和spuNames不能为空",
        400,
      );
    }
    const credential = await this.#credential(context, storeId);
    const result = await this.#requestShein(storeId, {
      baseUrl: this.apiBaseUrl,
      method: "POST",
      path: DOCUMENT_STATE_PATH,
      body: {
        version: normalizedVersion,
        spuList: normalizedSpuNames.map((value) => ({ spuName: value })),
      },
      openKeyId: credential.openKeyId,
      secretKey: credential.secretKey,
      timeoutMs: 60_000,
      fetchImpl: this.fetchImpl,
    });
    const normalized = normalizeProductDocumentState(result.payload.info, {
      requestedVersion: normalizedVersion,
    });
    let persistence = null;
    if (!normalized.empty) {
      const receiptTask = this.publishExecutionRepository
        ? Promise.resolve().then(() => this.publishExecutionRepository.appendDocumentStateReceipts({
            tenantId: context.tenantId,
            storeId,
            records: normalized.projection.records,
          }))
        : null;
      const reviewTask = this.productReviewRepository
        ? Promise.resolve().then(() => this.productReviewRepository.saveDocumentStates({
            tenantId: context.tenantId,
            storeId,
            records: normalized.projection.records,
          }))
        : null;
      const [receiptResult, reviewResult] = await Promise.all([
        receiptTask === null
          ? Promise.resolve({ status: "skipped", value: null })
          : receiptTask.then(
              (value) => ({ status: "fulfilled", value }),
              (reason) => ({ status: "rejected", reason }),
            ),
        reviewTask === null
          ? Promise.resolve({ status: "skipped", value: null })
          : reviewTask.then(
              (value) => ({ status: "fulfilled", value }),
              (reason) => ({ status: "rejected", reason }),
            ),
      ]);
      const hasProjection = receiptResult.status !== "skipped" || reviewResult.status !== "skipped";
      if (hasProjection) {
        persistence = {
          ...(receiptResult.status === "fulfilled" && receiptResult.value
            ? receiptResult.value
            : {}),
          receiptState: receiptResult.status,
          reviewState: reviewResult.status,
          partial: receiptResult.status === "rejected" || reviewResult.status === "rejected",
          errors: {
            ...(receiptResult.status === "rejected"
              ? { receipts: publicProjectionError(receiptResult.reason, "本地回执投影失败") }
              : {}),
            ...(reviewResult.status === "rejected"
              ? { reviewState: publicProjectionError(reviewResult.reason, "审核状态投影失败") }
              : {}),
          },
        };
      }
    }
    return {
      ...normalized,
      projection: {
        ...normalized.projection,
        persistence,
      },
      diagnostics: {
        traceId: result.diagnostics.traceId,
        durationMs: result.diagnostics.durationMs,
      },
    };
  }

  async querySpuInfo({
    context,
    storeId,
    spuName,
    version,
  } = {}) {
    const normalizedSpuName = String(spuName || "").trim();
    const normalizedVersion = String(version || "").trim();
    if (!normalizedSpuName || !normalizedVersion) {
      throw new WebAuthError(
        "INVALID_REQUEST",
        "spuName和version不能为空",
        400,
      );
    }
    if (!this.publishExecutionRepository) {
      throw new WebAuthError(
        "SPU_READBACK_UNAVAILABLE",
        "SPU关系回读仓储尚未启用",
        503,
      );
    }
    let job;
    try {
      job = await this.publishExecutionRepository.findApprovedReadbackJob({
        tenantId: context.tenantId,
        storeId,
        spuName: normalizedSpuName,
        version: normalizedVersion,
      });
    } catch (error) {
      if (String(error?.message || "").includes("匹配不唯一")) {
        throw new WebAuthError(
          "SPU_READBACK_AMBIGUOUS",
          "SPU关系回读任务不唯一，请先明确版本关联",
          409,
        );
      }
      throw error;
    }
    if (!job) {
      throw new WebAuthError(
        "SPU_READBACK_NOT_ALLOWED",
        "只有审核通过且能唯一关联发布任务的SPU才能回读",
        409,
      );
    }
    const credential = await this.#credential(context, storeId);
    const result = await this.#requestShein(storeId, {
      baseUrl: this.apiBaseUrl,
      method: "POST",
      path: SPU_INFO_PATH,
      body: {
        languageList: ["zh-cn", "en"],
        spuName: normalizedSpuName,
      },
      openKeyId: credential.openKeyId,
      secretKey: credential.secretKey,
      timeoutMs: 60_000,
      fetchImpl: this.fetchImpl,
    });
    const normalized = normalizeSpuInfo(result.payload.info, {
      expectedSpuName: normalizedSpuName,
    });
    const persistence =
      await this.publishExecutionRepository.appendSpuReadbackReceipt({
        tenantId: context.tenantId,
        storeId,
        jobId: job.id,
        version: normalizedVersion,
        projection: normalized.projection,
        occurredAt: new Date().toISOString(),
      });
    if (!persistence) {
      throw new WebAuthError(
        "SPU_READBACK_NOT_ALLOWED",
        "SPU关系回读未通过审核状态校验",
        409,
      );
    }
    return {
      ...normalized,
      projection: {
        ...normalized.projection,
        persistence: {
          receiptId: persistence.id || null,
          deduplicated: persistence.deduplicated === true,
        },
      },
      diagnostics: {
        traceId: result.diagnostics.traceId,
        durationMs: result.diagnostics.durationMs,
      },
    };
  }

  async revalidatePublishCompliance({
    context,
    storeId,
    jobId,
    spuName,
    version,
  } = {}) {
    const normalizedJobId = String(jobId || "").trim();
    const normalizedSpuName = String(spuName || "").trim();
    const normalizedVersion = String(version || "").trim();
    if ((!normalizedJobId && !normalizedSpuName) || !normalizedVersion) {
      throw new WebAuthError(
        "INVALID_REQUEST",
        "spuName和version不能为空",
        400,
      );
    }
    if (!this.publishExecutionRepository?.getComplianceRevalidationSource) {
      throw new WebAuthError(
        "COMPLIANCE_REVALIDATION_UNAVAILABLE",
        "合规复验仓储尚未启用",
        503,
      );
    }
    let resolvedJobId = normalizedJobId;
    if (!resolvedJobId) {
      if (!this.publishExecutionRepository.findApprovedReadbackJob) {
        throw new WebAuthError(
          "COMPLIANCE_REVALIDATION_UNAVAILABLE",
          "SPU回读任务查询仓储尚未启用",
          503,
        );
      }
      try {
        const job =
          await this.publishExecutionRepository.findApprovedReadbackJob({
            tenantId: context.tenantId,
            storeId,
            spuName: normalizedSpuName,
            version: normalizedVersion,
          });
        resolvedJobId = String(job?.id || "").trim();
      } catch (error) {
        if (String(error?.message || "").includes("匹配不唯一")) {
          throw new WebAuthError(
            "COMPLIANCE_REVALIDATION_AMBIGUOUS",
            "当前 version 和 SPU 对应多个回读任务，请先明确版本关联",
            409,
          );
        }
        throw error;
      }
    }
    if (!resolvedJobId) {
      throw new WebAuthError(
        "COMPLIANCE_REVALIDATION_NOT_ALLOWED",
        "只有当前店铺已完成审核和SPU关系回读的任务才能复验合规",
        409,
      );
    }
    const source =
      await this.publishExecutionRepository.getComplianceRevalidationSource({
        tenantId: context.tenantId,
        storeId,
        jobId: resolvedJobId,
      });
    if (
      !source ||
      source.job?.shein_version !== normalizedVersion ||
      (
        normalizedSpuName &&
        (source.job?.effective_spu_name || source.job?.request_summary?.spuName) !== normalizedSpuName
      )
    ) {
      throw new WebAuthError(
        "COMPLIANCE_REVALIDATION_NOT_ALLOWED",
        "只有当前店铺已完成审核和SPU关系回读的任务才能复验合规",
        409,
      );
    }
    const projection = buildComplianceRevalidation({
      readback: source.readback,
      draftData: source.draftData,
      requirementRows: source.requirementRows,
      ruleSnapshotsBySkc: source.ruleSnapshotsBySkc,
      expectedSkcNames: source.job?.effective_skc_names || source.job?.request_summary?.skcNames || [],
      now: this.now(),
    });
    const persistence =
      await this.publishExecutionRepository.appendComplianceRevalidationReceipt({
        tenantId: context.tenantId,
        storeId,
        jobId: resolvedJobId,
        version: normalizedVersion,
        projection,
        occurredAt: this.now().toISOString(),
      });
    if (!persistence) {
      throw new WebAuthError(
        "COMPLIANCE_REVALIDATION_NOT_ALLOWED",
        "合规复验未通过任务、店铺或SPU回读状态校验",
        409,
      );
    }
    return {
      ...projection,
      persistence: {
        receiptId: persistence.id || null,
        deduplicated: persistence.deduplicated === true,
      },
    };
  }

  async syncStoreBusiness({ context, storeId, previousSnapshot = null } = {}) {
    const credential = await this.#credential(context, storeId);
    return syncStoreBusinessData({
      previousSnapshot,
      request: ({ method, path, body }) =>
        this.#requestShein(storeId, {
          baseUrl: this.apiBaseUrl,
          method,
          path,
          body,
          openKeyId: credential.openKeyId,
          secretKey: credential.secretKey,
          timeoutMs: 60_000,
          fetchImpl: this.fetchImpl,
        }),
    });
  }

  async syncCompliance({
    context,
    storeId,
    skcNames,
    onBatch,
    continueOnError = true,
  } = {}) {
    const normalizedSkcs = uniqueSkcs(skcNames);
    if (!normalizedSkcs.length) {
      throw new WebAuthError("INVALID_REQUEST", "至少选择一个SKC", 400);
    }
    const credential = await this.#credential(context, storeId);
    return syncStoreComplianceData({
      skcNames: normalizedSkcs,
      onBatch,
      continueOnError,
      request: ({ method, path, body }) =>
        this.#requestShein(storeId, {
          baseUrl: this.apiBaseUrl,
          method,
          path,
          body,
          openKeyId: credential.openKeyId,
          secretKey: credential.secretKey,
          timeoutMs: 60_000,
          fetchImpl: this.fetchImpl,
        }),
    });
  }

  async syncProductAttributeSnapshots({
    context,
    storeId,
    targets = [],
  } = {}) {
    const normalizedTargets = (Array.isArray(targets) ? targets : [])
      .map((target) => ({
        skc: String(target?.skc_name || target?.skc || "").trim(),
        spuName: String(target?.spu_name || "").trim(),
        rawData: target?.raw_data || {},
      }))
      .filter((target) => target.skc);
    const targetsBySpu = new Map();
    for (const target of normalizedTargets) {
      if (!target.spuName) continue;
      const list = targetsBySpu.get(target.spuName) || [];
      list.push(target);
      targetsBySpu.set(target.spuName, list);
    }
    const snapshots = [];
    const failedSkcNames = new Set(
      normalizedTargets
        .filter((target) => !target.spuName)
        .map((target) => target.skc),
    );
    const diagnostics = [];
    const credential = await this.#credential(context, storeId);
    for (const [spuName, spuTargets] of targetsBySpu) {
      try {
        const result = await this.#requestShein(storeId, {
          baseUrl: this.apiBaseUrl,
          method: "POST",
          path: SPU_INFO_PATH,
          body: {
            languageList: ["zh-cn", "en"],
            spuName,
          },
          openKeyId: credential.openKeyId,
          secretKey: credential.secretKey,
          timeoutMs: 60_000,
          fetchImpl: this.fetchImpl,
        });
        diagnostics.push(result.diagnostics);
        const info = result.payload.info || {};
        const schema = await this.getPublishSchema({
          context,
          storeId,
          categoryId: String(info.categoryId || ""),
          productTypeId: String(info.productTypeId || ""),
        });
        const detailsBySkc = new Map(
          (Array.isArray(info.skcInfoList) ? info.skcInfoList : [])
            .map((skc) => [String(skc?.skcName || ""), skc]),
        );
        for (const target of spuTargets) {
          const detail = detailsBySkc.get(target.skc);
          if (!detail) {
            failedSkcNames.add(target.skc);
            continue;
          }
          snapshots.push({
            skc: target.skc,
            sourceTraceId: result.diagnostics?.traceId || null,
            snapshot: buildProductAttributeSnapshot({
              info: { ...info, ...detail },
              schemaInfo: schema.attributes,
              rugReportSources: existingRugReportSources(target.rawData),
              fetchedAt: this.now().toISOString(),
              sourceTraceId: result.diagnostics?.traceId || null,
            }),
          });
        }
      } catch (error) {
        diagnostics.push({
          endpoint: SPU_INFO_PATH,
          traceId: error?.traceId || null,
          errorCode: String(error?.code || "SPU_ATTRIBUTE_SNAPSHOT_FAILED"),
          errorMessage: String(error?.message || "SHEIN商品属性回读失败"),
        });
        for (const target of spuTargets) failedSkcNames.add(target.skc);
      }
    }
    return {
      snapshots,
      failedSkcNames: Array.from(failedSkcNames),
      diagnostics,
    };
  }

  async queryCompliance({ context, storeId, skcNames } = {}) {
    const normalizedSkcs = uniqueSkcs(skcNames);
    if (normalizedSkcs.length > MAX_COMPLIANCE_SKCS) {
      throw new WebAuthError(
        "INVALID_REQUEST",
        `一次最多查询${MAX_COMPLIANCE_SKCS}个SKC`,
        400,
      );
    }
    return this.syncCompliance({
      context,
      storeId,
      skcNames: normalizedSkcs,
      continueOnError: true,
    });
  }

  async getComplianceBundle({ context, storeId, skc } = {}) {
    const normalizedSkc = String(skc || "").trim();
    if (!normalizedSkc) {
      throw new WebAuthError("INVALID_REQUEST", "SKC不能为空", 400);
    }
    const synced = await this.queryCompliance({
      context,
      storeId,
      skcNames: [normalizedSkc],
    });
    const row = synced.rows?.find((item) => item.skc === normalizedSkc);
    if (!row) {
      throw new WebAuthError(
        "COMPLIANCE_NOT_FOUND",
        "未读取到该SKC的合规要求",
        404,
      );
    }
    const credential = await this.#credential(context, storeId);
    const bundle = await fetchComplianceRuleBundle({
      row,
      continueOnError: true,
      request: ({ method, path, body }) =>
        this.#requestShein(storeId, {
          baseUrl: this.apiBaseUrl,
          method,
          path,
          body,
          openKeyId: credential.openKeyId,
          secretKey: credential.secretKey,
          timeoutMs: 60_000,
          fetchImpl: this.fetchImpl,
        }),
    });
    if (this.ruleSnapshotRepository) {
      const fetchedAt = this.now();
      const expiresAt = new Date(fetchedAt.getTime() + COMPLIANCE_CACHE_TTL_MS);
      const requirementTraceId = synced.diagnostics?.requests?.find(
        (item) => item.traceId,
      )?.traceId || null;
      if (
        row.sourceCoverage?.requirementsReturned === true &&
        row.sourceCoverage?.photoRequirementsReturned === true
      ) {
        await this.ruleSnapshotRepository.upsert({
          tenantId: context.tenantId,
          storeId,
          ruleType: "compliance_requirement",
          subjectKey: normalizedSkc,
          payload: row,
          sourceTraceId: requirementTraceId,
          fetchedAt,
          expiresAt,
        });
      }
      if (bundle.sourceCoverage?.certificateSchemas === true) {
        const schemaTraceId = bundle.diagnostics?.find(
          (item) =>
            item.endpoint === "/open-api/goods-certificate-schemas/detail" &&
            item.traceId,
        )?.traceId || null;
        await this.ruleSnapshotRepository.upsert({
          tenantId: context.tenantId,
          storeId,
          ruleType: "certificate_schema",
          subjectKey: normalizedSkc,
          payload: {
            skc: normalizedSkc,
            certificateSchemas: bundle.certificateSchemas || [],
            srmDetectionAgencyList: bundle.srmDetectionAgencyList || [],
            sourceCoverage: {
              certificateSchemas: true,
            },
          },
          sourceTraceId: schemaTraceId,
          fetchedAt,
          expiresAt,
        });
      }
      if (
        Array.isArray(row.certificateRequirements) &&
        row.certificateRequirements.length > 0 &&
        bundle.sourceCoverage?.certificateLibrary === true
      ) {
        const libraryTraceId = bundle.diagnostics?.find(
          (item) =>
            item.endpoint === "/open-api/goods-certificates/search" &&
            item.traceId,
        )?.traceId || null;
        await this.ruleSnapshotRepository.upsert({
          tenantId: context.tenantId,
          storeId,
          ruleType: "certificate_library",
          subjectKey: normalizedSkc,
          payload: {
            skc: normalizedSkc,
            certificates: certificateLibrarySnapshot(bundle.certificates),
            sourceCoverage: {
              certificateLibrary: true,
            },
          },
          sourceTraceId: libraryTraceId,
          fetchedAt,
          expiresAt,
        });
      }
      if (
        Array.isArray(row.agencyRequirements) &&
        row.agencyRequirements.length > 0 &&
        bundle.sourceCoverage?.agencies === true
      ) {
        const agencyTraceId = bundle.diagnostics?.find(
          (item) =>
            item.endpoint === "/open-api/goods-compliance/agency-list" &&
            item.traceId,
        )?.traceId || null;
        await this.ruleSnapshotRepository.upsert({
          tenantId: context.tenantId,
          storeId,
          ruleType: "agency_library",
          subjectKey: normalizedSkc,
          payload: {
            skc: normalizedSkc,
            agencies: agencyLibrarySnapshot(bundle.bindableAgencies),
            sourceCoverage: {
              agencies: true,
            },
          },
          sourceTraceId: agencyTraceId,
          fetchedAt,
          expiresAt,
        });
      }
      if (
        Array.isArray(row.warningRequirements) &&
        row.warningRequirements.length > 0 &&
        bundle.sourceCoverage?.warningRules === true
      ) {
        const warningTraceId = bundle.diagnostics?.find(
          (item) =>
            item.endpoint === "/open-api/goods-compliance/query-warning-certificate-rules" &&
            item.traceId,
        )?.traceId || null;
        await this.ruleSnapshotRepository.upsert({
          tenantId: context.tenantId,
          storeId,
          ruleType: "warning_rules",
          subjectKey: normalizedSkc,
          payload: {
            skc: normalizedSkc,
            warningRules: warningRulesSnapshot(bundle.warningRules),
            sourceCoverage: {
              warningRules: true,
            },
          },
          sourceTraceId: warningTraceId,
          fetchedAt,
          expiresAt,
        });
      }
    }
    return { row, bundle };
  }

  async preflightCompliance({
    context,
    storeId,
    skcNames,
    inputsBySkc = {},
    template = null,
  } = {}) {
    const synced = await this.queryCompliance({
      context,
      storeId,
      skcNames,
    });
    const preflight = buildCompliancePreflight({
      rows: synced.rows,
      inputsBySkc,
      template,
    });
    return {
      ...preflight,
      failedSkcNames: synced.failedSkcNames || [],
      generatedAt: new Date().toISOString(),
    };
  }

  async getPublishCategories({ context, storeId, forceRefresh = false } = {}) {
    const credential = await this.#credential(context, storeId);
    const tenantId = context.tenantId;
    return this.#cachedPublishRule(
      `categories:${tenantId}:${storeId}`,
      CATEGORY_CACHE_TTL_MS,
      () => this.#persistentPublishRule({
        tenantId,
        storeId,
        ruleType: "category_tree",
        ttlMs: CATEGORY_CACHE_TTL_MS,
        forceRefresh,
        allowRemoteFetch: isAdministrator(context),
        shareWithinTenant: true,
        load: async () => {
          const result = await this.#requestShein(storeId, {
            baseUrl: this.apiBaseUrl,
            method: "POST",
            path: CATEGORY_TREE_PATH,
            body: {},
            openKeyId: credential.openKeyId,
            secretKey: credential.secretKey,
            timeoutMs: 60_000,
            fetchImpl: this.fetchImpl,
          });
          return { info: result.payload.info || {}, diagnostics: result.diagnostics };
        },
      }),
      forceRefresh,
    );
  }

  async getPublishSchema({
    context,
    storeId,
    categoryId,
    productTypeId,
    forceRefresh = false,
  } = {}) {
    if (!categoryId || !productTypeId) {
      throw new WebAuthError(
        "INVALID_REQUEST",
        "categoryId和productTypeId不能为空",
        400,
      );
    }
    const credential = await this.#credential(context, storeId);
    const tenantId = context.tenantId;
    const key = `schema:${tenantId}:${storeId}:${categoryId}:${productTypeId}`;
    return this.#cachedPublishRule(key, PUBLISH_SCHEMA_CACHE_TTL_MS, async () => {
      const request = ({ path, body }) =>
        this.#requestShein(storeId, {
          baseUrl: this.apiBaseUrl,
          method: "POST",
          path,
          body,
          openKeyId: credential.openKeyId,
          secretKey: credential.secretKey,
          timeoutMs: 60_000,
          fetchImpl: this.fetchImpl,
        });
      const [attributes, standard] = await Promise.all([
        this.#persistentPublishRule({
          tenantId,
          storeId,
          ruleType: "attribute_template",
          productTypeId,
          ttlMs: PUBLISH_SCHEMA_CACHE_TTL_MS,
          forceRefresh,
          allowRemoteFetch: isAdministrator(context),
          shareWithinTenant: true,
          load: () => request({
            path: ATTRIBUTE_TEMPLATE_PATH,
            body: { product_type_id_list: [productTypeId] },
          }).then((result) => ({
            info: result.payload.info || {},
            diagnostics: result.diagnostics,
          })),
        }),
        this.#persistentPublishRule({
          tenantId,
          storeId,
          ruleType: "publish_standard",
          categoryId,
          ttlMs: PUBLISH_SCHEMA_CACHE_TTL_MS,
          forceRefresh,
          allowRemoteFetch: isAdministrator(context),
          shareWithinTenant: true,
          load: () => request({
            path: PUBLISH_STANDARD_PATH,
            body: { category_id: categoryId },
          }).then((result) => ({
            info: result.payload.info || {},
            diagnostics: result.diagnostics,
          })),
        }),
      ]);
      const productType = (Array.isArray(attributes.info?.data)
        ? attributes.info.data
        : []).find((item) =>
          String(item?.product_type_id || "") === String(productTypeId)
        );
      const saleAttributeIds = Array.from(new Set(
        (Array.isArray(productType?.attribute_infos)
          ? productType.attribute_infos
          : [])
          .filter((attribute) => Number(attribute?.attribute_type) === 1)
          .map((attribute) => attribute?.attribute_id)
          .filter((attributeId) => String(attributeId || "").trim()),
      ));
      const hasPersistedPermissions = Object.prototype.hasOwnProperty.call(
        standard.info || {},
        "__customAttributePermissions",
      );
      let permissionInfo = hasPersistedPermissions
        ? standard.info.__customAttributePermissions || {}
        : {};
      let permissionDiagnostics = null;
      if (saleAttributeIds.length && !hasPersistedPermissions) {
        if (!isAdministrator(context)) {
          throw new WebAuthError(
            "RULE_SYNC_REQUIRED",
            "当前类目的自定义属性权限尚未由管理员同步，请联系管理员先完成同步",
            409,
          );
        }
        const permissionResult = await request({
          path: CUSTOM_ATTRIBUTE_PERMISSION_PATH,
          body: {
            category_id_list: [categoryId],
            attribute_id_list: saleAttributeIds,
          },
        });
        permissionInfo = permissionResult.payload.info || {};
        permissionDiagnostics = permissionResult.diagnostics;
        if (this.ruleSnapshotRepository) {
          const fetchedAt = this.now();
          await this.ruleSnapshotRepository.upsert({
            tenantId,
            storeId,
            ruleType: "publish_standard",
            categoryId,
            productTypeId: "",
            subjectKey: "",
            payload: {
              ...(standard.info || {}),
              __customAttributePermissions: permissionInfo,
            },
            sourceTraceId: permissionDiagnostics?.traceId || null,
            fetchedAt,
            expiresAt: new Date(
              fetchedAt.getTime() + PUBLISH_SCHEMA_CACHE_TTL_MS,
            ),
          });
        }
      }
      const publishStandard = { ...(standard.info || {}) };
      delete publishStandard.__customAttributePermissions;
      return {
        attributes: attributes.info,
        publishStandard,
        customAttributePermissions: permissionInfo,
        diagnostics: [
          attributes.diagnostics,
          standard.diagnostics,
          permissionDiagnostics,
        ].filter(Boolean),
      };
    }, forceRefresh);
  }

  async getPublishSchemaCoverage({
    context,
    storeId,
    forceRefresh = false,
  } = {}) {
    const categories = await this.getPublishCategories({
      context,
      storeId,
      forceRefresh,
    });
    if (!this.ruleSnapshotRepository?.listFresh) {
      return {
        ...buildPublishSchemaCoverage({
          categoryInfo: categories.info,
        }),
        diagnostics: categories.diagnostics || [],
      };
    }
    const [attributes, publishStandards] = await Promise.all([
      this.ruleSnapshotRepository.listFresh({
        tenantId: context.tenantId,
        storeId,
        ruleType: "attribute_template",
        shareWithinTenant: true,
        now: this.now(),
      }),
      this.ruleSnapshotRepository.listFresh({
        tenantId: context.tenantId,
        storeId,
        ruleType: "publish_standard",
        shareWithinTenant: true,
        now: this.now(),
      }),
    ]);
    return {
      ...buildPublishSchemaCoverage({
        categoryInfo: categories.info,
        attributeSnapshots: attributes.map((snapshot) => ({
          productTypeId: snapshot.product_type_id,
          fetchedAt: snapshot.fetched_at,
        })),
        publishStandardSnapshots: publishStandards.map((snapshot) => ({
          categoryId: snapshot.category_id,
          fetchedAt: snapshot.fetched_at,
        })),
      }),
      diagnostics: categories.diagnostics || [],
    };
  }

  async getAssociatedAttributeRules({
    context,
    storeId,
    categoryId,
    productTypeId,
    attributeList = [],
  } = {}) {
    if (!categoryId || !productTypeId || !Array.isArray(attributeList)) {
      throw new WebAuthError("INVALID_REQUEST", "关联属性请求格式不正确", 400);
    }
    if (attributeList.length > 500) {
      throw new WebAuthError("INVALID_REQUEST", "关联属性数量过多", 400);
    }
    const credential = await this.#credential(context, storeId);
    const result = await this.#requestShein(storeId, {
      baseUrl: this.apiBaseUrl,
      method: "POST",
      path: ASSOCIATED_ATTRIBUTE_RULES_PATH,
      body: {
        get_linked_rule_req_list: [{
          group_id: "template",
          category_id: categoryId,
          product_type_id: productTypeId,
          attribute_list: attributeList.map((item) => ({
            attribute_id: item.attributeId,
            ...(item.attributeValueId
              ? { attribute_value_id: item.attributeValueId }
              : {}),
          })),
        }],
      },
      openKeyId: credential.openKeyId,
      secretKey: credential.secretKey,
      timeoutMs: 60_000,
      fetchImpl: this.fetchImpl,
    });
    return {
      info: result.payload.info || {},
      diagnostics: result.diagnostics,
    };
  }

  async listPriceDiscussions({
    context,
    storeId,
    discussStatus = 1,
    pageNum = 1,
    pageSize = 100,
  } = {}) {
    const credential = await this.#credential(context, storeId);
    const result = await this.#requestShein(storeId, {
      baseUrl: this.apiBaseUrl,
      method: "POST",
      path: PRICE_DISCUSS_LIST_PATH,
      body: {
        discussStatus: Number.isInteger(Number(discussStatus)) ? Number(discussStatus) : 1,
        pageNum: integerInRange(pageNum, 1, 1, 100000),
        pageSize: integerInRange(pageSize, 100, 1, 200),
      },
      openKeyId: credential.openKeyId,
      secretKey: credential.secretKey,
      timeoutMs: 30_000,
      fetchImpl: this.fetchImpl,
    });
    const info = result.payload?.info && typeof result.payload.info === "object"
      ? result.payload.info
      : {};
    return {
      count: Number(info.count || 0),
      discussions: (Array.isArray(info.data) ? info.data : [])
        .map(normalizePriceDiscussion)
        .filter((discussion) => discussion.discussSn),
      diagnostics: result.diagnostics,
    };
  }

  async #processPriceDiscussion({ context, storeId, discussSn } = {}, discussAuditType) {
    const normalizedDiscussSn = String(discussSn || "").trim();
    if (!normalizedDiscussSn) {
      throw new WebAuthError("INVALID_REQUEST", "核价单号不能为空", 400);
    }
    const credential = await this.#credential(context, storeId);
    const result = await this.#requestShein(storeId, {
      baseUrl: this.apiBaseUrl,
      method: "POST",
      path: PRICE_DISCUSS_PROCESS_PATH,
      body: {
        confirmInfos: [{
          discussAuditType,
          discussSn: normalizedDiscussSn,
        }],
      },
      openKeyId: credential.openKeyId,
      secretKey: credential.secretKey,
      timeoutMs: 30_000,
      fetchImpl: this.fetchImpl,
    });
    const info = result.payload?.info && typeof result.payload.info === "object"
      ? result.payload.info
      : {};
    return {
      discussSn: normalizedDiscussSn,
      successCount: Number(info.successCount || 0),
      failCount: Number(info.failCount || 0),
      failedList: Array.isArray(info.failedList) ? info.failedList : [],
      diagnostics: result.diagnostics,
    };
  }

  async acceptPriceDiscussion(input = {}) {
    return this.#processPriceDiscussion(input, "1");
  }

  async rejectPriceDiscussion(input = {}) {
    return this.#processPriceDiscussion(input, "2");
  }

  async preflightPublish({
    context,
    storeId,
    supplierSkuList,
    brandCode = "",
  } = {}) {
    const credential = await this.#credential(context, storeId);
    return runPublishPreflight({
      supplierSkuList,
      brandCode,
      request: ({ method, path, body }) =>
        this.#requestShein(storeId, {
          baseUrl: this.apiBaseUrl,
          method,
          path,
          body,
          openKeyId: credential.openKeyId,
          secretKey: credential.secretKey,
          timeoutMs: 60_000,
          fetchImpl: this.fetchImpl,
        }),
    });
  }

  async uploadProductImage({
    context,
    storeId,
    imageType,
    fileBytes,
    fileName,
    mimeType,
  } = {}) {
    const credential = await this.#credential(context, storeId);
    return uploadSheinImageDirect({
      baseUrl: this.apiBaseUrl,
      openKeyId: credential.openKeyId,
      secretKey: credential.secretKey,
      imageType,
      fileBytes,
      fileName,
      mimeType,
      fetchImpl: this.fetchImpl,
    });
  }
}
