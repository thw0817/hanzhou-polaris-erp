import {
  buildSkcCompliancePreflight,
  expectedAgencyType,
  isPerSkcFlammabilityCertificate,
} from "../compliance-workflow.js";
import { summarizeComplianceRow } from "../shein-compliance.js";
import { flattenComplianceRequirements } from "./compliance-sync-service.js";
import { deriveRugReportThresholdSources } from "../../src-v2/lib/rug-report-classification.js";
import { withTransaction } from "./postgres.js";
import { createRuleFingerprint } from "./rule-snapshot-service.js";

const SHEIN_SHELF_STATUS_LABELS = new Set([
  "待上架",
  "已上架",
  "已下架",
  "已售罄",
]);

export class ComplianceWorkspaceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ComplianceWorkspaceError";
    this.code = code;
    this.status = status;
  }
}

function requiredSkc(value) {
  const skc = String(value || "").trim();
  if (!skc || skc.length > 128) {
    throw new ComplianceWorkspaceError("INVALID_SKC", "SKC无效");
  }
  return skc;
}

function requiredReportDate(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new ComplianceWorkspaceError(
      "REPORT_DATE_REQUIRED",
      "1630/1631 报告生效日期必须填写为 YYYY-MM-DD",
    );
  }
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ComplianceWorkspaceError(
      "REPORT_DATE_INVALID",
      "1630/1631 报告生效日期无效",
    );
  }
  return date;
}

function requiredPreflightRunId(value) {
  const id = String(value || "").trim();
  if (!UUID_PATTERN.test(id)) {
    throw new ComplianceWorkspaceError(
      "INVALID_PREFLIGHT_RUN_ID",
      "预检记录标识无效",
    );
  }
  return id.toLowerCase();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function categoryPathParts(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item || "").split(/[>/\\|]/u))
    .map((item) => item.trim())
    .filter(Boolean);
}

function isCategoryPlaceholder(value) {
  return /^(?:类目\s*)?\d+$/u.test(String(value || "").trim());
}

function firstHttpUrl(values) {
  for (const value of values) {
    const candidates = [
      value,
      asObject(value).url,
      asObject(value).imageUrl,
      asObject(value).previewUrl,
    ];
    for (const candidate of candidates) {
      const text = String(candidate || "").trim();
      if (/^https?:\/\//iu.test(text)) return text;
    }
  }
  return "";
}

function publicShelfStatus(value) {
  const status = String(value || "").trim();
  return SHEIN_SHELF_STATUS_LABELS.has(status) ? status : null;
}

function normalizeDraftInputs(value) {
  const input = asObject(value);
  const normalized = {};
  for (const key of ["certificates", "agencies", "warnings", "photos"]) {
    if (input[key] !== undefined && !Array.isArray(input[key])) {
      throw new ComplianceWorkspaceError(
        "INVALID_DRAFT_INPUTS",
        "合规草稿资料结构无效",
      );
    }
    const assignments = asArray(input[key]);
    if (assignments.length > 100) {
      throw new ComplianceWorkspaceError(
        "INVALID_DRAFT_INPUTS",
        "单类合规草稿资料不能超过100项",
      );
    }
    normalized[key] = assignments;
  }
  return normalized;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mediaIdFromReference(value) {
  const reference = String(value || "").trim();
  if (!reference) return null;
  const candidate = reference.startsWith("media:")
    ? reference.slice("media:".length)
    : reference;
  return UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

function collectComplianceMediaReferences(inputs) {
  const assetIds = new Set();
  const invalidReferences = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, nestedValue] of Object.entries(value)) {
      if (["localAssetRef", "localAssetId", "mediaAssetId", "assetId"].includes(key)) {
        const reference = String(nestedValue || "").trim();
        if (!reference) continue;
        const assetId = mediaIdFromReference(reference);
        if (assetId) assetIds.add(assetId);
        else invalidReferences.add(reference);
        continue;
      }
      visit(nestedValue);
    }
  };
  visit(asObject(inputs));
  return {
    assetIds: Array.from(assetIds).sort(),
    invalidReferences: Array.from(invalidReferences),
  };
}

const COMPLIANCE_STATUSES = new Set([
  "未同步",
  "需修正",
  "待补充",
  "审核中",
  "待同步",
  "通过",
]);
const PREFLIGHT_REVIEW_STATUSES = new Set([
  "not_run",
  "stale",
  "pending",
  "reviewed",
]);

function positiveInteger(value, fallback, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, max);
}

function normalizeIssue(issue, fallbackCode) {
  if (typeof issue === "string") {
    const message = issue.trim();
    return message ? { code: fallbackCode, message } : null;
  }
  const value = asObject(issue);
  const code = String(value.code || fallbackCode).trim();
  const message = String(value.message || value.name || code).trim();
  return message ? { code, message } : null;
}

function uniqueIssues(issues) {
  return Array.from(
    new Map(
      issues
        .filter(Boolean)
        .map((issue) => [`${issue.code}:${issue.message}`, issue]),
    ).values(),
  );
}

function summarizeSavedPreflight(preflight) {
  const value = asObject(preflight);
  const plans = asArray(value.plans);
  const collect = (key, fallbackCode) => uniqueIssues([
    ...asArray(value[key]).map((issue) => normalizeIssue(issue, fallbackCode)),
    ...plans.flatMap((plan) =>
      asArray(asObject(plan)[key]).map((issue) =>
        normalizeIssue(issue, fallbackCode),
      ),
    ),
  ]);
  const blockers = collect("blockers", "PREFLIGHT_BLOCKER");
  const warnings = collect("warnings", "PREFLIGHT_WARNING");
  const waitingCount = plans.reduce(
    (total, plan) => total + asArray(asObject(plan).waiting).length,
    asArray(value.waiting).length,
  );
  return {
    evaluated: Object.keys(value).length > 0,
    savedExecutable: value.executable === true || value.passed === true,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    waitingCount,
    blockers,
    warnings,
  };
}

function publicDraftProjection(row) {
  if (!row?.id) return null;
  const preflight = summarizeSavedPreflight(row.preflight);
  return {
    id: row.id,
    status: row.status || "draft",
    updatedAt: row.updated_at || null,
    blockerCount: preflight.blockerCount,
    preflight,
  };
}

function draftProjectionFromListRow(row) {
  if (!row?.draft_id) return null;
  return publicDraftProjection({
    id: row.draft_id,
    status: row.draft_status,
    preflight: row.draft_preflight,
    updated_at: row.draft_updated_at,
  });
}

function publicCachedSkc(row) {
  if (!row?.id) return null;
  const raw = {
    ...asObject(row.spu_raw_data),
    ...asObject(row.raw_data),
  };
  const snapshots = [
    asObject(asObject(row.spu_raw_data).businessSnapshot),
    asObject(asObject(row.raw_data).businessSnapshot),
  ];
  const rawCategoryPath = [
    raw.categoryPath,
    raw.categoryNamePath,
    raw.categoryNames,
    raw.categoryNameList,
    asObject(raw.category).path,
    asObject(raw.category).names,
    asObject(raw.categoryInfo).path,
    asObject(raw.categoryInfo).names,
  ].map(categoryPathParts).find((path) => path.length > 0) || [];
  const storedCategoryName = String(row.category_name || "").trim();
  const categoryPath = rawCategoryPath.length
    ? rawCategoryPath
    : isCategoryPlaceholder(storedCategoryName)
      ? []
      : categoryPathParts(storedCategoryName);
  const imageUrl = firstHttpUrl([
    ...snapshots.flatMap((snapshot) => [
      snapshot.imageUrl,
      snapshot.image,
      snapshot.mainImageUrl,
      snapshot.mainImage,
      snapshot.main_image_url,
      snapshot.mainPicUrl,
      snapshot.mainPic,
      snapshot.skcMainPicUrl,
      snapshot.productImageUrl,
      asArray(asObject(snapshot.imageAssets).main)[0],
      asArray(asObject(snapshot.images).main)[0],
      asArray(snapshot.imageList)[0],
      asArray(snapshot.productImageList)[0],
    ]),
    raw.imageUrl,
    raw.image,
    raw.mainImageUrl,
    raw.mainImage,
    raw.main_image_url,
    raw.image_url,
    raw.mainPicUrl,
    raw.mainPic,
    raw.skcMainPicUrl,
    raw.productImageUrl,
    asArray(asObject(raw.imageAssets).main)[0],
    asArray(asObject(raw.images).main)[0],
    asArray(raw.imageList)[0],
    asArray(raw.productImageList)[0],
  ]);
  return {
    id: row.id,
    skc: row.skc_name,
    supplierCode: row.supplier_code || "",
    categoryId: row.category_id || "",
    categoryName: isCategoryPlaceholder(storedCategoryName) ? "" : storedCategoryName,
    categoryPath,
    imageUrl,
    // Only expose the label written by the official SHEIN readback projection.
    // Legacy numeric codes and inferred values are intentionally shown as unavailable.
    shelfStatus: publicShelfStatus(row.shelf_status),
    complianceStatus: row.compliance_status || "未同步",
    summary: row.compliance_summary || {},
    updatedAt: row.updated_at || null,
    reportDecision: publicReportDecision({
      complianceRow: asObject(row.requirement_payload),
    }),
    draft: draftProjectionFromListRow(row),
    serverPreflight: row.server_preflight_id
      ? {
          id: row.server_preflight_id,
          status: row.server_preflight_status,
          blockerCount: Number(row.server_preflight_blocker_count || 0),
          createdAt: row.server_preflight_created_at,
          currentForDraft: row.server_preflight_current_for_draft === true,
          currentForRules: row.server_preflight_current_for_rules === true,
          currentForMedia: row.server_preflight_current_for_media === true,
          reviewCount: Number(row.server_preflight_review_count || 0),
          reviewedAt: row.server_preflight_reviewed_at || null,
        }
      : null,
    snapshot: row.snapshot_fetched_at
      ? {
          fetchedAt: row.snapshot_fetched_at,
          expiresAt: row.snapshot_expires_at,
          traceId: row.snapshot_trace_id || null,
          fresh: row.snapshot_fresh === true,
        }
      : null,
  };
}

function publicAttributeSnapshot(row) {
  const raw = asObject(row?.raw_data);
  const snapshot = asObject(raw.attributeSnapshot);
  const schema = asObject(snapshot.attributeSchemaSnapshot);
  const fetchedAt = String(schema.fetchedAt || "").trim();
  if (!fetchedAt) return null;
  const assignments = asObject(snapshot.attributeValues);
  const fields = asArray(schema.fields).map((field) => {
    const id = String(field?.id || "").trim();
    const assignment = asObject(assignments[id]);
    const valueIds = asArray(assignment.valueIds)
      .map((valueId) => String(valueId || "").trim())
      .filter(Boolean);
    const valueLabels = valueIds.map((valueId) => {
      const option = asArray(field?.values).find(
        (value) => String(value?.id || "") === valueId,
      );
      return String(option?.label || `官方值 ID ${valueId}`);
    });
    const customValue = String(assignment.customValue || "").trim();
    return {
      id,
      name: String(field?.name || id),
      required: field?.required === true,
      mode: String(field?.mode || ""),
      assigned: valueIds.length > 0 || Boolean(customValue),
      valueIds,
      valueLabels,
      customValue,
    };
  }).filter((field) => field.id);
  return {
    fetchedAt,
    categoryId: String(schema.categoryId || ""),
    productTypeId: String(schema.productTypeId || ""),
    fieldCount: fields.length,
    assignedFieldCount: fields.filter((field) => field.assigned).length,
    fields,
    sourceEndpoint: String(asObject(snapshot.source).endpoint || ""),
    traceId: String(asObject(snapshot.source).traceId || "").trim() || null,
    reportSourcesConfigured: Object.keys(asObject(snapshot.rugReportSources)).length > 0 ||
      Boolean(deriveRugReportThresholdSources(asArray(schema.fields))),
  };
}

function buildReleaseGate({ item, draft, snapshots }) {
  const blockers = [];
  if (item.complianceStatus !== "通过") {
    blockers.push({
      code: "COMPLIANCE_NOT_PASSED",
      message: `当前合规状态为“${item.complianceStatus}”`,
    });
  }
  const coverage = item.summary?.sourceCoverage;
  if (
    coverage &&
    (
      coverage.requirementsReturned !== true ||
      coverage.photoRequirementsReturned !== true
    )
  ) {
    blockers.push({
      code: "SOURCE_COVERAGE_INCOMPLETE",
      message: "合规要求来源覆盖不完整",
    });
  }
  const requirementSnapshot = snapshots.find(
    (snapshot) => snapshot.ruleType === "compliance_requirement",
  );
  if (!requirementSnapshot) {
    blockers.push({
      code: "RULE_SNAPSHOT_MISSING",
      message: "缺少合规要求规则快照",
    });
  } else if (!requirementSnapshot.fresh) {
    blockers.push({
      code: "RULE_SNAPSHOT_STALE",
      message: "合规要求规则快照已过期",
    });
  }
  if (draft && !["ready", "submitted"].includes(draft.status)) {
    blockers.push({
      code: "DRAFT_NOT_READY",
      message: `合规草稿状态为“${draft.status}”`,
    });
  }
  blockers.push(...(draft?.preflight.blockers || []));
  const normalizedBlockers = uniqueIssues(blockers);
  return {
    publishingEnabled: false,
    blockerCount: normalizedBlockers.length,
    blockers: normalizedBlockers,
  };
}

function publicRecord(row) {
  return {
    id: row.id,
    requirementType: row.requirement_type,
    requirementKey: row.requirement_key,
    status: row.status || "待同步",
    required: row.required === true,
    data: row.requirement_data || {},
    traceId: row.source_trace_id || null,
    checkedAt: row.checked_at || null,
  };
}

function publicSnapshot(row) {
  return {
    ruleType: row.rule_type,
    payload: row.payload || {},
    traceId: row.source_trace_id || null,
    fetchedAt: row.fetched_at || null,
    expiresAt: row.expires_at || null,
    fresh: row.fresh === true,
  };
}

function normalizedDetectionAgencies(payload) {
  return asArray(asObject(payload).srmDetectionAgencyList)
    .map((item) => {
      const value = asObject(item);
      const agency = asObject(value.detectionAgency);
      const id = String(agency.detectionAgencyId ?? "").trim();
      if (!id) return null;
      return {
        id,
        name: String(agency.detectionAgencyName || id),
        laboratories: asArray(value.laboratoryList)
          .map((laboratory) => {
            const laboratoryId = String(laboratory?.laboratoryId ?? "").trim();
            return laboratoryId
              ? {
                  id: laboratoryId,
                  name: String(laboratory?.laboratoryName || laboratoryId),
                }
              : null;
          })
          .filter(Boolean),
      };
    })
    .filter(Boolean);
}

function certificateIdentity(value) {
  const item = asObject(value);
  return String(
    item.certificateTypeId ?? item.certificateTypeCode ?? "",
  ).trim();
}

function editorCertificateField(field) {
  const value = asObject(field);
  return {
    id: String(value.presetId ?? ""),
    name: String(value.presetRemark || value.presetName || value.presetId || ""),
    inputType: Number(value.inputType),
    required: Number(value.isRequired) === 1,
    sourceFrom: String(value.sourceFrom || ""),
    unit: String(value.unit || ""),
    options: asArray(value.presetValueList)
      .filter((option) => Number(option?.isEnabled ?? 1) === 1)
      .map((option) => ({
        id: String(option.presetValueId),
        label: String(option.presetValue || option.presetValueId),
      })),
  };
}

function buildComplianceEditorModel(snapshotRows) {
  const requirementSnapshot = snapshotRows.find(
    (snapshot) => snapshot.rule_type === "compliance_requirement",
  );
  const certificateSnapshot = snapshotRows.find(
    (snapshot) => snapshot.rule_type === "certificate_schema",
  );
  const certificateLibrarySnapshot = snapshotRows.find(
    (snapshot) => snapshot.rule_type === "certificate_library",
  );
  const agencyLibrarySnapshot = snapshotRows.find(
    (snapshot) => snapshot.rule_type === "agency_library",
  );
  const warningRulesSnapshot = snapshotRows.find(
    (snapshot) => snapshot.rule_type === "warning_rules",
  );
  const requirementPayload = asObject(requirementSnapshot?.payload);
  const certificatePayload = asObject(certificateSnapshot?.payload);
  const certificateLibraryPayload = asObject(certificateLibrarySnapshot?.payload);
  const agencyLibraryPayload = asObject(agencyLibrarySnapshot?.payload);
  const warningRulesPayload = asObject(warningRulesSnapshot?.payload);
  const schemas = asArray(certificatePayload.certificateSchemas);
  const agencyLibraryRequired = asArray(requirementPayload.agencyRequirements).length > 0;
  const warningTypeCodes = new Set(
    asArray(requirementPayload.warningRequirements).map((requirement) =>
      String(requirement?.certificateTypeCode || "")
    ),
  );
  const warningRulesRequired = warningTypeCodes.size > 0;
  const certificateTypeCodes = new Set(
    asArray(requirementPayload.certificateRequirements).map((requirement) =>
      String(requirement?.certificateTypeCode || "")
    ),
  );
  const platformCapabilities = [];
  for (const requirement of asArray(requirementPayload.unsupportedRequirements)) {
    const typeId = String(requirement?.certificateTypeId ?? "");
    const code = String(requirement?.certificateTypeCode || "");
    const name = String(requirement?.certificateTypeName || "");
    const searchable = `${code} ${name}`.toLowerCase();
    const capabilityKey = typeId === "844" || searchable.includes("产品标识符") || searchable.includes("productidenti")
      ? "product_identifier"
      : searchable.includes("gcc")
        ? "gcc"
        : null;
    if (!capabilityKey || platformCapabilities.some((item) => item.capabilityKey === capabilityKey)) {
      continue;
    }
    platformCapabilities.push({
      capabilityKey,
      readEndpoint: "/open-api/goods-compliance-requirements/list",
      certificateTypeId: requirement?.certificateTypeId ?? null,
      certificateTypeCode: code,
      certificateTypeName: name || (capabilityKey === "gcc" ? "GCC" : "产品标识符"),
      complianceGroupCode: String(requirement?.complianceGroupCode || ""),
      isManualProductWarning: requirement?.isManualProductWarning ?? null,
      isAutoProductWarning: requirement?.isAutoProductWarning ?? null,
      isRequired: requirement?.isRequired ?? null,
      reviewState: requirement?.reviewState ?? null,
      editable: false,
      writeStatus: "unsupported_by_official_api",
      writeEndpoint: null,
      writeFields: null,
    });
  }
  return {
    certificateRulesFresh:
      requirementSnapshot?.fresh === true && certificateSnapshot?.fresh === true,
    certificates: asArray(requirementPayload.certificateRequirements).map(
      (requirement) => {
        const schema = schemas.find(
          (candidate) => certificateIdentity(candidate) === certificateIdentity(requirement),
        );
        const enabled = Number(schema?.isEnabled) === 1;
        const supported = Boolean(
          certificateSnapshot?.fresh === true &&
          schema &&
          enabled &&
          Number(schema.certificateLabel ?? 0) === 0 &&
          String(schema.certificateTypeId) !== "844",
        );
        return {
          key: certificateIdentity(requirement),
          certificateTypeId: requirement?.certificateTypeId ?? null,
          certificateTypeCode: String(requirement?.certificateTypeCode || ""),
          name: String(
            requirement?.certificateTypeName || schema?.certificateType || "资质证书",
          ),
          required: Number(requirement?.isRequired) === 1,
          perSkc: isPerSkcFlammabilityCertificate(requirement),
          supported,
          unsupportedReason: supported
            ? null
            : !certificateSnapshot?.fresh
              ? "CERTIFICATE_SCHEMA_STALE"
              : !schema
                ? "CERTIFICATE_SCHEMA_MISSING"
                : !enabled
                  ? "CERTIFICATE_SCHEMA_DISABLED"
                  : "CERTIFICATE_TYPE_UNSUPPORTED",
          certificateDimension: schema?.certificateDimension ?? null,
          fields: schema
            ? [
                ...asArray(schema.presetInfoList),
                ...asArray(schema.otherPresetInfoList),
              ]
                .filter((field) => Number(field?.isEnabled ?? 1) === 1)
                .map(editorCertificateField)
            : [],
        };
      },
    ),
    detectionAgencies: normalizedDetectionAgencies(certificatePayload),
    certificateLibraryFresh: certificateLibrarySnapshot?.fresh === true,
    certificateLibrary: certificateLibrarySnapshot?.fresh === true
      ? asArray(certificateLibraryPayload.certificates).flatMap((certificate) => {
          const poolSn = String(certificate?.poolSn || "");
          const certificateTypeCode = String(certificate?.certificateTypeCode || "");
          if (
            !poolSn ||
            Number(certificate?.status) !== 2 ||
            !certificateTypeCodes.has(certificateTypeCode)
          ) {
            return [];
          }
          return [{
            poolId: String(certificate?.poolId ?? ""),
            poolSn,
            certificateTypeId: String(certificate?.certificateTypeId ?? ""),
            certificateTypeCode,
            name: String(certificate?.certificateTypeName || "资质证书"),
            certificateDimension: certificate?.certificateDimension ?? null,
            effectiveTime: String(certificate?.effectiveTime || ""),
            invalidTime: String(certificate?.invalidTime || ""),
            alertTime: String(certificate?.alertTime || ""),
            bindSkcFlag: certificate?.bindSkcFlag ?? null,
            lastUpdateTime: String(certificate?.lastUpdateTime || ""),
            fileNames: asArray(certificate?.fileNames).map((fileName) => String(fileName)),
          }];
        })
      : [],
    agencyLibraryRequired,
    agencyRequirements: asArray(requirementPayload.agencyRequirements).map(
      (requirement) => ({
        key: certificateIdentity(requirement),
        certificateTypeId: requirement?.certificateTypeId ?? null,
        certificateTypeCode: String(requirement?.certificateTypeCode || ""),
        name: String(requirement?.certificateTypeName || "代理公司"),
        required: Number(requirement?.isRequired) === 1,
        agencyType: expectedAgencyType(requirement),
      }),
    ),
    agencyLibraryFresh:
      agencyLibraryRequired && agencyLibrarySnapshot?.fresh === true,
    agencyLibrary:
      agencyLibraryRequired && agencyLibrarySnapshot?.fresh === true
        ? asArray(agencyLibraryPayload.agencies).flatMap((agency) => {
            const agencyId = String(agency?.agencyId ?? "");
            if (
              !agencyId ||
              Number(agency?.agencyStatus) !== 0 ||
              ![1, 2].includes(Number(agency?.applyStatus))
            ) {
              return [];
            }
            return [{
              agencyId,
              name: String(agency?.agencyName || "代理公司"),
              agencyType: agency?.agencyType ?? null,
              agencySubType: agency?.agencySubType ?? null,
              agencyStartTime: String(agency?.agencyStartTime || ""),
              agencyEndTime: String(agency?.agencyEndTime || ""),
              coveredProductRange: agency?.coveredProductRange ?? null,
              updateTime: String(agency?.updateTime || ""),
            }];
          })
        : [],
    warningRulesRequired,
    warningRulesFresh:
      warningRulesRequired && warningRulesSnapshot?.fresh === true,
    warningRules:
      warningRulesRequired && warningRulesSnapshot?.fresh === true
        ? asArray(warningRulesPayload.warningRules).flatMap((rule) => {
            const certificateTypeCode = String(rule?.certificateTypeCode || "");
            if (!warningTypeCodes.has(certificateTypeCode)) return [];
            return [{
              certificateTypeId: String(rule?.certificateTypeId ?? ""),
              certificateTypeCode,
              name: String(rule?.certificateTypeName || "手动警示语"),
              fields: asArray(rule?.fields)
                .map((field) => ({
                  fieldCode: String(field?.fieldCode || ""),
                  name: String(field?.fieldName || field?.fieldCode || "字段"),
                  fieldType: Number(field?.fieldType),
                  fieldSort: Number(field?.fieldSort),
                  values: asArray(field?.values).map((value) => ({
                    id: String(value?.fieldValueId ?? ""),
                    label: String(value?.fieldValue || ""),
                    exclusionFieldValueIds: asArray(
                      value?.exclusionFieldValueIds,
                    ).map((valueId) => String(valueId)),
                    mappingPaths: asArray(value?.mappingPaths).map((path) =>
                      asArray(path?.fieldValueIds).map((valueId) => String(valueId))
                    ),
                  })),
                }))
                .sort((left, right) => left.fieldSort - right.fieldSort),
            }];
          })
        : [],
    platformCapabilities,
  };
}

function trustedCertificateInputs(
  inputs,
  requirementPayload,
  certificatePayload,
  certificateLibraryPayload,
) {
  const normalized = normalizeDraftInputs(inputs);
  const requirements = asArray(asObject(requirementPayload).certificateRequirements);
  const schemas = asArray(asObject(certificatePayload).certificateSchemas);
  const certificateLibrary = asArray(
    asObject(certificateLibraryPayload).certificates,
  );
  const trustedSrmAgencies = normalizedDetectionAgencies(certificatePayload).map(
    (agency) => ({
      detectionAgencyId: agency.id,
      laboratories: agency.laboratories.map((laboratory) => ({
        laboratoryId: laboratory.id,
      })),
    }),
  );
  return {
    ...normalized,
    certificates: normalized.certificates.flatMap((assignment) => {
      const requirement = requirements.find(
        (candidate) => certificateIdentity(candidate) === certificateIdentity(assignment),
      );
      if (!requirement) return [];
      const requestedPoolSn = String(asObject(assignment).poolSn || "");
      const trustedPool = requestedPoolSn
        ? certificateLibrary.find(
            (certificate) =>
              String(certificate?.poolSn || "") === requestedPoolSn &&
              Number(certificate?.status) === 2 &&
              certificateIdentity(certificate) === certificateIdentity(requirement),
          )
        : null;
      if (trustedPool) {
        return [{
          certificateTypeId: requirement.certificateTypeId ?? null,
          certificateTypeCode: requirement.certificateTypeCode || "",
          certificateTypeName: requirement.certificateTypeName || "",
          certificateDimension: trustedPool.certificateDimension ?? null,
          poolSn: String(trustedPool.poolSn),
          status: 2,
          files: [],
          fieldValues: {},
        }];
      }
      const schema = schemas.find(
        (candidate) => certificateIdentity(candidate) === certificateIdentity(requirement),
      );
      const trusted = {
        certificateTypeId: requirement.certificateTypeId ?? null,
        certificateTypeCode: requirement.certificateTypeCode || "",
        certificateTypeName: requirement.certificateTypeName || "",
        certificateDimension: schema?.certificateDimension ?? null,
        ...(isPerSkcFlammabilityCertificate(requirement)
          ? { skc: String(asObject(requirementPayload).skc || "") }
          : {}),
        schema: schema || {},
        trustedSrmAgencies,
        fieldValues: asObject(asObject(assignment).fieldValues),
        files: asArray(asObject(assignment).files).flatMap((file) => {
          const value = asObject(file);
          const assetId = mediaIdFromReference(
            value.localAssetRef || value.localAssetId,
          );
          return assetId
            ? [{
                localAssetRef: `media:${assetId}`,
                fileName: String(value.fileName || ""),
                mimeType: String(value.mimeType || ""),
                size: Number(value.size || 0),
              }]
            : [];
        }),
      };
      return [trusted];
    }),
  };
}

function trustedAgencyInputs(inputs, requirementPayload, agencyLibraryPayload) {
  const normalized = normalizeDraftInputs(inputs);
  const requirements = asArray(asObject(requirementPayload).agencyRequirements);
  const agencyLibrary = asArray(asObject(agencyLibraryPayload).agencies);
  return {
    ...normalized,
    agencies: normalized.agencies.flatMap((assignment) => {
      const requirement = requirements.find(
        (candidate) => certificateIdentity(candidate) === certificateIdentity(assignment),
      );
      if (!requirement) return [];
      const requiredAgencyType = expectedAgencyType(requirement);
      if (requiredAgencyType === null) return [];
      const requestedAgencyId = String(asObject(assignment).agencyId || "");
      const trustedAgency = agencyLibrary.find(
        (agency) =>
          String(agency?.agencyId ?? "") === requestedAgencyId &&
          Number(agency?.agencyStatus) === 0 &&
          [1, 2].includes(Number(agency?.applyStatus)) &&
          Number(agency?.agencyType) === requiredAgencyType,
      );
      if (!trustedAgency) return [];
      return [{
        certificateTypeId: requirement.certificateTypeId ?? null,
        certificateTypeCode: requirement.certificateTypeCode || "",
        certificateTypeName: requirement.certificateTypeName || "",
        agencyId: String(trustedAgency.agencyId),
        agencyStatus: 0,
        applyStatus: Number(trustedAgency.applyStatus),
        agencyType: Number(trustedAgency.agencyType),
        agencySubType: trustedAgency.agencySubType ?? null,
        coveredProductRange: trustedAgency.coveredProductRange ?? null,
      }];
    }),
  };
}

function trustedWarningInputs(inputs, requirementPayload, warningRulesPayload) {
  const normalized = normalizeDraftInputs(inputs);
  const requirements = asArray(asObject(requirementPayload).warningRequirements);
  const warningRules = asArray(asObject(warningRulesPayload).warningRules);
  return {
    ...normalized,
    warnings: normalized.warnings.flatMap((assignment) => {
      const requirement = requirements.find(
        (candidate) => certificateIdentity(candidate) === certificateIdentity(assignment),
      );
      if (!requirement) return [];
      const rule = warningRules.find(
        (candidate) => certificateIdentity(candidate) === certificateIdentity(requirement),
      );
      if (!rule) return [];
      const selectedInput = asObject(asObject(assignment).selectedByField);
      const fields = asArray(rule.fields).map((field) => ({
        fieldCode: String(field?.fieldCode || ""),
        fieldName: String(field?.fieldName || ""),
        fieldType: field?.fieldType ?? null,
        fieldSort: field?.fieldSort ?? null,
        isEnabled: 1,
        presetFieldValues: asArray(field?.values).map((value) => ({
          fieldValueId: value?.fieldValueId ?? null,
          fieldValue: String(value?.fieldValue || ""),
          exclusionFieldValueIds: asArray(value?.exclusionFieldValueIds),
          mappingPaths: asArray(value?.mappingPaths).map((path) => ({
            fieldValueIds: asArray(path?.fieldValueIds),
          })),
          valueSort: value?.valueSort ?? null,
          isEnabled: 1,
        })),
      }));
      return [{
        certificateTypeId: requirement.certificateTypeId ?? null,
        certificateTypeCode: requirement.certificateTypeCode || "",
        certificateTypeName: requirement.certificateTypeName || "",
        selectedByField: Object.fromEntries(
          fields.map((field) => [
            field.fieldCode,
            asArray(selectedInput[field.fieldCode]).map((valueId) => String(valueId)),
          ]),
        ),
        rules: {
          certificateTypeId: rule.certificateTypeId ?? null,
          certificateTypeCode: rule.certificateTypeCode || "",
          certificateTypeName: rule.certificateTypeName || "",
          presetInfo: {
            isEnabled: 1,
            presetFields: fields,
          },
        },
      }];
    }),
  };
}

function publicPreflightRun(row) {
  if (!row?.id) return null;
  const plan = asObject(row.plan);
  const blockers = uniqueIssues(
    asArray(plan.blockers).map((issue) =>
      normalizeIssue(issue, "PREFLIGHT_BLOCKER"),
    ),
  );
  const warnings = uniqueIssues(
    asArray(plan.warnings).map((issue) =>
      normalizeIssue(issue, "PREFLIGHT_WARNING"),
    ),
  );
  const waiting = asArray(plan.waiting);
  const actionTypes = Array.from(
    new Set(
      asArray(plan.actions)
        .map((item) => String(asObject(item).type || "").trim())
        .filter(Boolean),
    ),
  );
  const actionSummaries = asArray(plan.actions).flatMap(publicPreflightAction);
  const ruleSnapshots = asArray(plan.audit?.ruleSnapshots).flatMap((snapshot) => {
    const value = asObject(snapshot);
    const ruleType = String(value.ruleType || "").trim();
    if (![
      "compliance_requirement",
      "certificate_schema",
      "certificate_library",
      "agency_library",
      "warning_rules",
    ].includes(ruleType)) {
      return [];
    }
    return [{
      ruleType,
      fingerprint: String(value.fingerprint || ""),
      fetchedAt: value.fetchedAt || null,
      expiresAt: value.expiresAt || null,
    }];
  });
  return {
    id: row.id,
    skc: row.skc_name,
    status: row.status,
    executable: row.executable === true,
    counts: {
      actions: Number(plan.counts?.actions ?? asArray(plan.actions).length),
      blockers: Number(plan.counts?.blockers ?? blockers.length),
      warnings: Number(plan.counts?.warnings ?? warnings.length),
      waiting: Number(plan.counts?.waiting ?? waiting.length),
    },
    blockers,
    warnings,
    waitingCount: waiting.length,
    actionTypes,
    actionSummaries,
    ruleSnapshots,
    inputFingerprint: row.input_fingerprint,
    ruleFingerprint: row.rule_fingerprint,
    mediaFingerprint: row.media_fingerprint,
    requirementRuleSnapshotId: row.requirement_rule_snapshot_id,
    certificateRuleSnapshotId: row.certificate_rule_snapshot_id || null,
    createdAt: row.created_at,
    ...(typeof row.current_for_draft === "boolean"
      ? { currentForDraft: row.current_for_draft }
      : {}),
    ...(typeof row.current_for_rules === "boolean"
      ? { currentForRules: row.current_for_rules }
      : {}),
    ...(typeof row.current_for_media === "boolean"
      ? { currentForMedia: row.current_for_media }
      : {}),
    publishingEnabled: false,
  };
}

function preflightCurrentForDraft(run, draft) {
  if (!run?.id || !draft?.id || run.draft_id !== draft.id) return false;
  const runCreatedAt = new Date(run.created_at).getTime();
  const draftUpdatedAt = new Date(draft.updated_at).getTime();
  return Number.isFinite(runCreatedAt) &&
    Number.isFinite(draftUpdatedAt) &&
    draftUpdatedAt <= runCreatedAt;
}

function preflightCurrentForRules(run, snapshots, now) {
  if (!run?.id) return false;
  const nowTime = new Date(now).getTime();
  if (!Number.isFinite(nowTime)) return false;
  const auditedSnapshots = asArray(asObject(asObject(run.plan).audit).ruleSnapshots);
  if (!auditedSnapshots.length) return false;
  const currentByType = new Map(
    snapshots.map((snapshot) => [String(snapshot.rule_type || ""), snapshot]),
  );
  const seenTypes = new Set();
  return auditedSnapshots.every((auditedSnapshot) => {
    const audited = asObject(auditedSnapshot);
    const ruleType = String(audited.ruleType || "");
    const snapshotId = String(audited.id || "");
    const fingerprint = String(audited.fingerprint || "");
    if (!ruleType || !snapshotId || !fingerprint || seenTypes.has(ruleType)) {
      return false;
    }
    seenTypes.add(ruleType);
    const current = currentByType.get(ruleType);
    const expiresAt = new Date(current?.expires_at).getTime();
    return String(current?.id || "") === snapshotId &&
      String(current?.fingerprint || "") === fingerprint &&
      Number.isFinite(expiresAt) &&
      expiresAt > nowTime;
  });
}

function preflightMediaIds(run) {
  if (!Array.isArray(run?.media_assets)) return [];
  return Array.from(new Set(
    run.media_assets
      .map((asset) => String(asObject(asset).id || "").toLowerCase())
      .filter((id) => UUID_PATTERN.test(id)),
  )).sort();
}

function preflightCurrentForMedia(run, mediaRows) {
  if (!run?.id || !Array.isArray(run.media_assets)) return false;
  const currentById = new Map(
    mediaRows.map((asset) => [String(asset.id || "").toLowerCase(), asset]),
  );
  const seenIds = new Set();
  return run.media_assets.every((auditedAsset) => {
    const audited = asObject(auditedAsset);
    const id = String(audited.id || "").toLowerCase();
    const sha256 = String(audited.sha256 || "");
    if (!UUID_PATTERN.test(id) || !sha256 || seenIds.has(id)) return false;
    seenIds.add(id);
    const current = currentById.get(id);
    return ["ready", "referenced"].includes(current?.status) &&
      current?.purpose === "compliance_evidence" &&
      String(current?.sha256 || "") === sha256;
  });
}

function publicPreflightReview(row) {
  if (!row?.id) return null;
  return {
    id: row.id,
    preflightRunId: row.preflight_run_id,
    skc: row.skc_name,
    reviewedBy: row.reviewed_by || null,
    reviewerDisplayName: row.reviewer_display_name,
    reviewedAt: row.reviewed_at,
    snapshot: {
      status: row.reviewed_status,
      counts: {
        actions: Number(row.action_count || 0),
        blockers: Number(row.blocker_count || 0),
        warnings: Number(row.warning_count || 0),
      },
      inputFingerprint: row.input_fingerprint,
      ruleFingerprint: row.rule_fingerprint,
      mediaFingerprint: row.media_fingerprint,
    },
    authorizesPublishing: false,
  };
}

function publicPreflightAction(action) {
  const value = asObject(action);
  const type = String(value.type || "").trim();
  const requirementKey = String(value.requirementKey || "").trim();
  if (!type || !requirementKey) return [];
  const base = { type, requirementKey };
  if (type === "photo.upload_and_bind") {
    return [{
      ...base,
      ...(value.labelId != null ? { labelId: value.labelId } : {}),
      ...(value.labelGroup ? { labelGroup: String(value.labelGroup) } : {}),
      ...(value.fileName ? { fileName: String(value.fileName) } : {}),
      ...(value.size != null ? { size: Number(value.size) } : {}),
    }];
  }
  if (type === "certificate.bind_existing") {
    return [{
      ...base,
      ...(value.certificateTypeCode
        ? { certificateTypeCode: String(value.certificateTypeCode) }
        : {}),
      ...(value.certificateTypeId != null
        ? { certificateTypeId: value.certificateTypeId }
        : {}),
      poolSn: String(value.poolSn || ""),
    }];
  }
  if (type === "certificate.recheck_store_scope") {
    return [{
      ...base,
      ...(value.certificateTypeCode
        ? { certificateTypeCode: String(value.certificateTypeCode) }
        : {}),
      ...(value.certificateTypeId != null
        ? { certificateTypeId: value.certificateTypeId }
        : {}),
    }];
  }
  if (type === "certificate.create_and_bind") {
    return [{
      ...base,
      ...(value.certificateTypeCode
        ? { certificateTypeCode: String(value.certificateTypeCode) }
        : {}),
      ...(value.certificateTypeId != null
        ? { certificateTypeId: value.certificateTypeId }
        : {}),
      ...(value.certificateDimension != null
        ? { certificateDimension: value.certificateDimension }
        : {}),
      fileCount: asArray(value.files).length,
      fieldCount: Object.keys(asObject(value.fieldValues)).length,
    }];
  }
  if (type === "agency.bind" || type === "agency.recheck_store_scope") {
    return [{
      ...base,
      ...(value.certificateTypeCode
        ? { certificateTypeCode: String(value.certificateTypeCode) }
        : {}),
      ...(value.certificateTypeId != null
        ? { certificateTypeId: value.certificateTypeId }
        : {}),
      agencyId: String(value.agencyId || ""),
      ...(value.agencyType != null ? { agencyType: value.agencyType } : {}),
    }];
  }
  if (type === "warning.update") {
    return [{
      ...base,
      ...(value.certificateTypeCode
        ? { certificateTypeCode: String(value.certificateTypeCode) }
        : {}),
      ...(value.certificateTypeId != null
        ? { certificateTypeId: value.certificateTypeId }
        : {}),
      selectedByField: Object.fromEntries(
        Object.entries(asObject(value.selectedByField)).map(([fieldCode, valueIds]) => [
          fieldCode,
          asArray(valueIds).map((valueId) => String(valueId)),
        ]),
      ),
      autoMappedWarningValueIds: asArray(value.autoMappedWarningValueIds).map(
        (valueId) => String(valueId),
      ),
    }];
  }
  return [base];
}

function sanitizeTemplateDefaults(defaults) {
  const value = asObject(defaults);
  const certificates = Array.isArray(value.certificates)
    ? value.certificates.filter(
        (assignment) => isPerSkcFlammabilityCertificate(assignment),
      )
    : [];
  return {
    certificates,
    agencies: [],
    warnings: [],
    photos: Array.isArray(value.photos)
      ? value.photos.filter(
          (photo) =>
            photo.templateReusable === true &&
            ["1", "2"].includes(String(photo.labelGroup || "")),
        )
      : [],
  };
}

function complianceReportType(value) {
  const identity = [
    value?.reportType,
    value?.certificateTypeId,
    value?.certificateTypeCode,
    value?.certificateTypeName,
    value?.name,
  ].map((item) => String(item ?? "").toLowerCase()).join(" ");
  if (identity.includes("1631")) return "1631";
  if (identity.includes("1630")) return "1630";
  if (identity.includes("smallcarpet")) return "1631";
  if (identity.includes("largecarpet")) return "1630";
  return null;
}

function requirementIdentityMatches(left, right) {
  return certificateIdentity(left) === certificateIdentity(right);
}

function reportDateFieldsForRequirement(certificateSchemas, requirement) {
  const reportType = complianceReportType(requirement);
  const schema = asArray(certificateSchemas).find((candidate) =>
    requirementIdentityMatches(candidate, requirement) ||
    (reportType && complianceReportType(candidate) === reportType),
  );
  return [
    ...asArray(schema?.presetInfoList),
    ...asArray(schema?.otherPresetInfoList),
  ].filter(
    (field) => Number(field?.isEnabled ?? 1) === 1 && Number(field?.inputType) === 4,
  );
}

function reportTemplateDate(report, dateFields, templateData = {}) {
  const abstractDate = String(asObject(templateData).reportDate || "").trim();
  if (
    asObject(templateData).templateKind === "rug_report" &&
    complianceReportType(templateData) === complianceReportType(report) &&
    abstractDate
  ) {
    return abstractDate;
  }
  const fieldValues = asObject(report?.fieldValues);
  return dateFields.map((field) =>
    String(asObject(fieldValues[String(field?.presetId)]).value || "").trim(),
  ).find(Boolean) || "";
}

function photoForGroup(inputs, labelGroup) {
  return asArray(inputs?.photos).find((photo) =>
    String(photo?.labelGroup || "") === String(labelGroup || ""),
  ) || null;
}

function certificateForRequirement(inputs, requirement) {
  return asArray(inputs?.certificates).find((certificate) =>
    requirementIdentityMatches(certificate, requirement),
  ) || null;
}

function requirementNeedsInput(requirement) {
  const reviewState = Number(requirement?.reviewState);
  return Number(requirement?.isRequired) === 1 || reviewState === 3;
}

function officialTargetReport({ complianceRow }) {
  const requirements = asArray(complianceRow?.certificateRequirements).filter(
    (requirement) => complianceReportType(requirement),
  );
  if (!requirements.length) return { requirements, reportTypes: [], blockers: [] };
  const actionable = requirements.filter(requirementNeedsInput);
  const current = actionable.length ? actionable : requirements;
  const reportTypes = Array.from(new Set(
    current.map(complianceReportType).filter(Boolean),
  ));
  return {
    requirements,
    reportTypes,
    blockers: reportTypes.length > 1
      ? [{
          code: "OFFICIAL_REPORT_REQUIREMENT_AMBIGUOUS",
          message: `SHEIN 当前同时返回 ${reportTypes.join("、")} 报告要求，请分别处理`,
        }]
      : [],
  };
}

function publicReportDecision({ complianceRow }) {
  const result = officialTargetReport({ complianceRow });
  if (!result.requirements.length) return null;
  return {
    reportType: result.reportTypes.length === 1 ? result.reportTypes[0] : null,
    longestEdgeCm: null,
    areaM2: null,
    evidence: [],
    blockers: result.blockers.map((blocker) => ({
      code: String(blocker?.code || "RUG_REPORT_CLASSIFICATION_BLOCKED"),
      message: String(blocker?.message || "1630/1631判定被阻断"),
    })),
  };
}

function buildTemplateReuseDraft({
  row,
  productRow,
  currentInputs,
  templateDefaults,
  templateData = {},
  certificateSchemas,
  templateId,
  evaluatedAt,
  sections = null,
}) {
  const inputs = normalizeDraftInputs(currentInputs);
  const blockers = [];
  const warnings = [];
  const actions = [];
  const scopedSections = Array.isArray(sections) && sections.length
    ? new Set(sections)
    : null;
  const applyReports = !scopedSections || scopedSections.has("certificates");
  const applyPhotos = !scopedSections || scopedSections.has("photos");
  const fullTemplate = !scopedSections;
  const reportCheck = applyReports
    ? officialTargetReport({ complianceRow: row })
    : { requirements: [], reportTypes: [], blockers: [] };
  const reportRequirements = reportCheck.requirements;
  blockers.push(...reportCheck.blockers);

  if (applyReports) {
    const templateReports = asArray(templateDefaults?.certificates).filter(
      (certificate) => complianceReportType(certificate),
    );
    for (const requirement of reportRequirements) {
      if (!requirementNeedsInput(requirement)) continue;
      const existing = certificateForRequirement(inputs, requirement);
      const existingEvidence = asArray(existing?.files).length > 0 || Boolean(existing?.poolSn);
      if (existingEvidence && String(existing?.skc || "") === String(row.skc || "")) {
        actions.push({
          type: "certificate.keep_target_report",
          reportType: complianceReportType(requirement),
          requirementKey: certificateIdentity(requirement),
        });
        continue;
      }
      const requiredReportType = complianceReportType(requirement);
      const reusable = templateReports.find(
        (certificate) => complianceReportType(certificate) === requiredReportType,
      );
      if (!reusable || !asArray(reusable.files).length) {
        blockers.push({
          code: "REPORT_TEMPLATE_MISSING",
          message: `${requirement.certificateTypeName || requiredReportType + "报告"}没有可引用的同类型报告模板`,
          requirementKey: certificateIdentity(requirement),
        });
        continue;
      }
      const dateFields = reportDateFieldsForRequirement(certificateSchemas, requirement);
      if (!dateFields.length) {
        blockers.push({
          code: "REPORT_TEMPLATE_DATE_SCHEMA_MISSING",
          message: `${requirement.certificateTypeName || requiredReportType + "报告"}缺少SHEIN报告日期字段，不能引用模板`,
          requirementKey: certificateIdentity(requirement),
        });
        continue;
      }
      const reportDate = reportTemplateDate(reusable, dateFields, templateData);
      if (!reportDate) {
        blockers.push({
          code: "REPORT_TEMPLATE_DATE_MISSING",
          message: `${requirement.certificateTypeName || requiredReportType + "报告"}模板没有报告日期，请先补齐模板`,
          requirementKey: certificateIdentity(requirement),
        });
        continue;
      }
      inputs.certificates = [
        ...inputs.certificates.filter((certificate) =>
          !requirementIdentityMatches(certificate, requirement),
        ),
        {
          ...reusable,
          certificateTypeId: requirement.certificateTypeId ?? reusable.certificateTypeId ?? null,
          certificateTypeCode: String(requirement.certificateTypeCode || reusable.certificateTypeCode || ""),
          certificateTypeName: String(requirement.certificateTypeName || reusable.certificateTypeName || ""),
          skc: String(row.skc || ""),
          poolSn: "",
          fieldValues: Object.fromEntries(dateFields.map((field) => [
            String(field.presetId),
            {
              ...asObject(asObject(reusable.fieldValues)[String(field.presetId)]),
              value: reportDate,
            },
          ])),
        },
      ];
      actions.push({
        type: "certificate.map_report_template",
        reportType: requiredReportType,
        requirementKey: certificateIdentity(requirement),
      });
    }
  }

  if (fullTemplate) {
    for (const requirement of asArray(row?.certificateRequirements)) {
      if (complianceReportType(requirement) || !requirementNeedsInput(requirement)) continue;
      if (!certificateForRequirement(inputs, requirement)) {
        blockers.push({
          code: "CERTIFICATE_REQUIRES_TARGET_INPUT",
          message: `${requirement.certificateTypeName || "证书"}需要在目标 SKC 中单独维护`,
          requirementKey: certificateIdentity(requirement),
        });
      }
    }

    for (const requirement of asArray(row?.warningRequirements)) {
      if (requirementNeedsInput(requirement) && Number(requirement?.reviewState) !== 2) {
        if (!asArray(inputs.warnings).some((warning) =>
          requirementIdentityMatches(warning, requirement),
        )) {
          blockers.push({
            code: "WARNING_REQUIRES_TARGET_INPUT",
            message: `${requirement.certificateTypeName || "手动警示语"}需要在目标 SKC 中单独维护`,
            requirementKey: certificateIdentity(requirement),
          });
        }
      }
    }

    for (const requirement of asArray(row?.unsupportedRequirements)) {
      if (requirementNeedsInput(requirement) && Number(requirement?.reviewState) !== 2) {
        blockers.push({
          code: "API_UNSUPPORTED_REQUIREMENT",
          message: `${requirement.certificateTypeName || requirement.complianceGroupCode || "平台合规项"}当前仍需在 SHEIN 后台处理`,
          requirementKey: certificateIdentity(requirement),
        });
      }
    }
  }

  if (applyPhotos) {
    for (const [labelGroup, requirements] of [
      ["1", asArray(row?.bodyPhotoRequirements)],
      ["2", asArray(row?.packagePhotoRequirements)],
    ]) {
      const targetRequirements = requirements.filter(requirementNeedsInput);
      if (!targetRequirements.length) continue;
      const existing = asArray(inputs.photos).filter((photo) =>
        String(photo?.labelGroup || "") === labelGroup &&
        (photo?.localAssetRef || photo?.uploadedPictureId),
      );
      if (existing.length) continue;
      const limit = labelGroup === "2" ? 2 : 1;
      const seen = new Set();
      const reusablePhotos = asArray(templateDefaults?.photos).filter((photo) => {
        const ref = String(photo?.localAssetRef || "").trim();
        if (
          String(photo?.labelGroup || "") !== labelGroup ||
          photo?.templateReusable !== true ||
          !ref ||
          seen.has(ref)
        ) return false;
        seen.add(ref);
        return true;
      }).slice(0, limit);
      if (!reusablePhotos.length) {
        blockers.push({
          code: "PHOTO_TEMPLATE_MISSING",
          message: `${labelGroup === "2" ? "包装" : "商品本体"}实拍图没有可引用的通用图片`,
          labelGroup,
        });
        continue;
      }
      inputs.photos = [
        ...inputs.photos.filter((photo) => String(photo?.labelGroup || "") !== labelGroup),
        ...reusablePhotos.map((reusable, index) => {
          const requirement = targetRequirements[Math.min(index, targetRequirements.length - 1)];
          actions.push({
            type: "photo.map_template_asset",
            labelId: requirement.labelId,
            labelGroup,
            localAssetRef: reusable.localAssetRef,
          });
          return {
            ...reusable,
            labelId: String(requirement.labelId ?? ""),
            labelGroup,
            labelName: String(requirement.labelName || reusable.labelName || ""),
            templateReusable: true,
          };
        }),
      ];
    }
  }

  const reportTypes = reportCheck.reportTypes;
  if (reportTypes.length) {
    actions.push({
      type: "certificate.use_official_report_requirement",
      reportTypes,
      source: "shein_compliance_requirement",
    });
  }

  const preflight = {
    mode: "template_reuse",
    templateId,
    evaluatedAt,
    executable: false,
    passed: blockers.length === 0,
    blockers,
    warnings,
    actions,
    reportTypes,
    externalWrite: false,
  };
  return {
    inputs,
    preflight,
    blockers,
    warnings,
  };
}

function publicDraft(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    skc: row.skc_name,
    templateId: row.template_id,
    requirementSnapshot: row.requirement_snapshot || {},
    inputs: row.inputs || {},
    preflight: row.preflight || {},
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function publicTemplate(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    defaults: row.defaults || {},
    ruleSnapshot: row.rule_snapshot || {},
    ruleSnapshotAt: row.rule_snapshot_at,
    status: row.status,
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
}

export class PostgresComplianceWorkspaceRepository {
  constructor({ pool } = {}) {
    if (!pool) {
      throw new Error("PostgresComplianceWorkspaceRepository 缺少 pool");
    }
    this.pool = pool;
  }

  async listSkcs({
    tenantId,
    storeId,
    query,
    status,
    reviewStatus,
    limit,
    offset,
  }) {
    const result = await this.pool.query({
      text: `
        WITH enriched AS (
          SELECT skc.id, skc.skc_name, skc.supplier_code, skc.shelf_status,
                 skc.raw_data, spu.raw_data AS spu_raw_data,
                 spu.category_id, spu.category_name,
                 skc.compliance_status, skc.compliance_summary, skc.updated_at,
                 snapshot.payload AS requirement_payload,
                 snapshot.fetched_at AS snapshot_fetched_at,
                 snapshot.expires_at AS snapshot_expires_at,
                 snapshot.source_trace_id AS snapshot_trace_id,
                 snapshot.expires_at > now() AS snapshot_fresh,
                 draft.id AS draft_id, draft.status AS draft_status,
                 draft.preflight AS draft_preflight,
                 draft.updated_at AS draft_updated_at,
                 server_preflight.id AS server_preflight_id,
                 server_preflight.status AS server_preflight_status,
                 COALESCE(
                   NULLIF(server_preflight.plan #>> '{counts,blockers}', '')::integer,
                   jsonb_array_length(
                     CASE WHEN jsonb_typeof(server_preflight.plan->'blockers') = 'array'
                       THEN server_preflight.plan->'blockers' ELSE '[]'::jsonb END
                   )
                 ) AS server_preflight_blocker_count,
                 server_preflight.created_at AS server_preflight_created_at,
                 CASE
                   WHEN server_preflight.id IS NULL THEN NULL
                   ELSE COALESCE(
                     draft.id = server_preflight.draft_id
                       AND draft.updated_at <= server_preflight.created_at,
                     false
                   )
                 END AS server_preflight_current_for_draft,
                 CASE
                   WHEN server_preflight.id IS NULL THEN NULL
                   ELSE COALESCE(preflight_rule_state.current_for_rules, false)
                 END AS server_preflight_current_for_rules,
                 CASE
                   WHEN server_preflight.id IS NULL THEN NULL
                   ELSE COALESCE(preflight_media_state.current_for_media, false)
                 END AS server_preflight_current_for_media,
                 COALESCE(preflight_review.review_count, 0)
                   AS server_preflight_review_count,
                 preflight_review.reviewed_at AS server_preflight_reviewed_at
          FROM skcs skc
          LEFT JOIN spus spu
            ON spu.id = skc.spu_id
            AND spu.tenant_id = $1
            AND spu.store_id = $2
          LEFT JOIN LATERAL (
            SELECT payload, fetched_at, expires_at, source_trace_id
            FROM shein_rule_snapshots
            WHERE tenant_id = $1 AND store_id = $2
              AND rule_type = 'compliance_requirement'
              AND subject_key = skc.skc_name
            ORDER BY fetched_at DESC
            LIMIT 1
          ) snapshot ON true
          LEFT JOIN compliance_drafts draft
            ON draft.tenant_id = $1 AND draft.store_id = $2
            AND draft.skc_name = skc.skc_name
          LEFT JOIN LATERAL (
            SELECT id, draft_id, status, plan, media_assets, created_at
            FROM compliance_preflight_runs
            WHERE tenant_id = $1 AND store_id = $2
              AND skc_name = skc.skc_name
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          ) server_preflight ON true
          LEFT JOIN LATERAL (
            SELECT
              jsonb_array_length(rule_set.rules) > 0
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(rule_set.rules)
                  AS audited_snapshot(value)
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM shein_rule_snapshots current_snapshot
                  WHERE current_snapshot.tenant_id = $1
                    AND current_snapshot.store_id = $2
                    AND current_snapshot.subject_key = skc.skc_name
                    AND current_snapshot.id::text =
                      audited_snapshot.value->>'id'
                    AND current_snapshot.rule_type =
                      audited_snapshot.value->>'ruleType'
                    AND current_snapshot.fingerprint =
                      audited_snapshot.value->>'fingerprint'
                    AND current_snapshot.expires_at > now()
                    AND NOT EXISTS (
                      SELECT 1
                      FROM shein_rule_snapshots newer_snapshot
                      WHERE newer_snapshot.tenant_id = $1
                        AND newer_snapshot.store_id = $2
                        AND newer_snapshot.subject_key = skc.skc_name
                        AND newer_snapshot.rule_type =
                          current_snapshot.rule_type
                        AND (newer_snapshot.fetched_at, newer_snapshot.id) >
                          (current_snapshot.fetched_at, current_snapshot.id)
                    )
                )
              ) AS current_for_rules
            FROM (
              SELECT CASE
                WHEN jsonb_typeof(
                  server_preflight.plan #> '{audit,ruleSnapshots}'
                ) = 'array'
                THEN server_preflight.plan #> '{audit,ruleSnapshots}'
                ELSE '[]'::jsonb
              END AS rules
            ) rule_set
          ) preflight_rule_state ON server_preflight.id IS NOT NULL
          LEFT JOIN LATERAL (
            SELECT
              media_set.valid_array
              AND jsonb_array_length(media_set.assets) = (
                SELECT count(DISTINCT audited_media.value->>'id')
                FROM jsonb_array_elements(media_set.assets)
                  AS audited_media(value)
              )
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(media_set.assets)
                  AS audited_media(value)
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM media_assets current_media
                  WHERE current_media.tenant_id = $1
                    AND current_media.store_id = $2
                    AND current_media.id::text =
                      audited_media.value->>'id'
                    AND current_media.status IN ('ready', 'referenced')
                    AND current_media.purpose = 'compliance_evidence'
                    AND current_media.sha256 =
                      audited_media.value->>'sha256'
                )
              ) AS current_for_media
            FROM (
              SELECT
                jsonb_typeof(server_preflight.media_assets) = 'array'
                  AS valid_array,
                CASE
                  WHEN jsonb_typeof(server_preflight.media_assets) = 'array'
                  THEN server_preflight.media_assets
                  ELSE '[]'::jsonb
                END AS assets
            ) media_set
          ) preflight_media_state ON server_preflight.id IS NOT NULL
          LEFT JOIN LATERAL (
            SELECT count(*) AS review_count, max(reviewed_at) AS reviewed_at
            FROM compliance_preflight_reviews
            WHERE tenant_id = $1 AND store_id = $2
              AND skc_name = skc.skc_name
              AND preflight_run_id = server_preflight.id
          ) preflight_review ON server_preflight.id IS NOT NULL
          WHERE skc.tenant_id = $1 AND skc.store_id = $2
            AND (
              $3 = '' OR skc.skc_name ILIKE '%' || $3 || '%'
              OR COALESCE(skc.supplier_code, '') ILIKE '%' || $3 || '%'
            )
            AND (
              $4 = '' OR ($4 = '未同步' AND skc.compliance_status IS NULL)
              OR skc.compliance_status = $4
            )
        ),
        filtered AS (
          SELECT *
          FROM enriched
          WHERE (
              $5 = ''
              OR ($5 = 'not_run' AND server_preflight_id IS NULL)
              OR (
                $5 = 'stale'
                AND server_preflight_id IS NOT NULL
                AND (
                  server_preflight_current_for_draft = false
                  OR server_preflight_current_for_rules = false
                  OR server_preflight_current_for_media = false
                )
              )
              OR (
                $5 = 'pending'
                AND server_preflight_current_for_draft = true
                AND server_preflight_current_for_rules = true
                AND server_preflight_current_for_media = true
                AND server_preflight_review_count = 0
              )
              OR (
                $5 = 'reviewed'
                AND server_preflight_current_for_draft = true
                AND server_preflight_current_for_rules = true
                AND server_preflight_current_for_media = true
                AND server_preflight_review_count > 0
              )
          )
        ),
        paged AS (
          SELECT * FROM filtered
          ORDER BY CASE compliance_status
            WHEN '需修正' THEN 0
            WHEN '待补充' THEN 1
            WHEN '审核中' THEN 2
            WHEN '待同步' THEN 3
            WHEN '通过' THEN 5
            ELSE 4
          END, skc_name
          LIMIT $6 OFFSET $7
        ),
        audit_summary AS (
          SELECT
            count(*) FILTER (WHERE server_preflight_id IS NULL) AS not_run_count,
            count(*) FILTER (
              WHERE server_preflight_id IS NOT NULL
                AND (
                  server_preflight_current_for_draft = false
                  OR server_preflight_current_for_rules = false
                  OR server_preflight_current_for_media = false
                )
            ) AS needs_rerun_count,
            count(*) FILTER (
              WHERE server_preflight_current_for_draft = true
                AND server_preflight_current_for_rules = true
                AND server_preflight_current_for_media = true
                AND server_preflight_review_count = 0
            ) AS pending_count,
            count(*) FILTER (
              WHERE server_preflight_current_for_draft = true
                AND server_preflight_current_for_rules = true
                AND server_preflight_current_for_media = true
                AND server_preflight_review_count > 0
            ) AS reviewed_count
          FROM enriched
        ),
        compliance_summary AS (
          SELECT
            count(*) AS total_count,
            count(*) FILTER (WHERE compliance_status IN ('需修正', '待补充')) AS non_compliant_count,
            count(*) FILTER (WHERE compliance_status IN ('审核中', '待同步')) AS in_progress_count,
            count(*) FILTER (WHERE compliance_status = '通过') AS passed_count
          FROM enriched
        )
        SELECT paged.*, totals.total_count,
               audit_summary.not_run_count AS audit_not_run_count,
               audit_summary.needs_rerun_count AS audit_needs_rerun_count,
               audit_summary.pending_count AS audit_pending_count,
               audit_summary.reviewed_count AS audit_reviewed_count,
               compliance_summary.total_count AS compliance_total_count,
               compliance_summary.non_compliant_count AS compliance_non_compliant_count,
               compliance_summary.in_progress_count AS compliance_in_progress_count,
               compliance_summary.passed_count AS compliance_passed_count
        FROM (SELECT count(*) AS total_count FROM filtered) totals
        CROSS JOIN audit_summary
        CROSS JOIN compliance_summary
        LEFT JOIN paged ON true
        ORDER BY CASE paged.compliance_status
          WHEN '需修正' THEN 0
          WHEN '待补充' THEN 1
          WHEN '审核中' THEN 2
          WHEN '待同步' THEN 3
          WHEN '通过' THEN 5
          ELSE 4
        END, paged.skc_name
      `,
      values: [
        tenantId,
        storeId,
        query,
        status,
        reviewStatus,
        limit,
        offset,
      ],
    });
    return {
      rows: result.rows.filter((row) => row.id),
      total: Number(result.rows[0]?.total_count || 0),
      auditSummary: {
        notRun: Number(result.rows[0]?.audit_not_run_count || 0),
        needsRerun: Number(result.rows[0]?.audit_needs_rerun_count || 0),
        pending: Number(result.rows[0]?.audit_pending_count || 0),
        reviewed: Number(result.rows[0]?.audit_reviewed_count || 0),
      },
      complianceSummary: {
        total: Number(result.rows[0]?.compliance_total_count || 0),
        nonCompliant: Number(result.rows[0]?.compliance_non_compliant_count || 0),
        inProgress: Number(result.rows[0]?.compliance_in_progress_count || 0),
        passed: Number(result.rows[0]?.compliance_passed_count || 0),
      },
    };
  }

  async getSkc({ tenantId, storeId, skc }) {
    const result = await this.pool.query({
      text: `SELECT skc.id, skc.skc_name, skc.supplier_code, skc.shelf_status,
                    skc.compliance_status, skc.compliance_summary, skc.raw_data,
                    spu.raw_data AS spu_raw_data,
                    skc.updated_at, spu.category_id, spu.category_name
             FROM skcs skc
             LEFT JOIN spus spu
               ON spu.id = skc.spu_id
              AND spu.tenant_id = $1
              AND spu.store_id = $2
             WHERE skc.tenant_id = $1 AND skc.store_id = $2 AND skc.skc_name = $3
             LIMIT 1`,
      values: [tenantId, storeId, skc],
    });
    return result.rows[0] || null;
  }

  async saveComplianceReadback({
    tenantId,
    storeId,
    row,
    traceId = null,
    checkedAt = new Date(),
  }) {
    const skc = String(row?.skc || "").trim();
    if (!skc) return false;
    const summary = summarizeComplianceRow(row);
    let updated = false;
    await withTransaction(this.pool, async (client) => {
      const skcResult = await client.query({
        text: `UPDATE skcs
               SET compliance_status=$4, compliance_summary=$5::jsonb,
                   updated_at=now()
               WHERE tenant_id=$1 AND store_id=$2 AND skc_name=$3
               RETURNING id`,
        values: [tenantId, storeId, skc, summary.state, JSON.stringify(summary)],
      });
      const skcId = skcResult.rows[0]?.id;
      if (!skcId) return;
      updated = true;
      await client.query({
        text: `DELETE FROM skc_compliance_records
               WHERE tenant_id=$1 AND store_id=$2 AND skc_id=$3`,
        values: [tenantId, storeId, skcId],
      });
      for (const record of flattenComplianceRequirements(row)) {
        await client.query({
          text: `INSERT INTO skc_compliance_records (
                   tenant_id, store_id, skc_id, requirement_type,
                   requirement_key, status, required, requirement_data,
                   source_trace_id, checked_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
          values: [
            tenantId, storeId, skcId, record.requirementType,
            record.requirementKey, record.status, record.required,
            JSON.stringify(record.data), traceId, checkedAt,
          ],
        });
      }
    });
    return updated;
  }

  async listRecords({ tenantId, storeId, skcId }) {
    const result = await this.pool.query({
      text: `SELECT id, requirement_type, requirement_key, status, required,
                    requirement_data, source_trace_id, checked_at
             FROM skc_compliance_records
             WHERE tenant_id = $1 AND store_id = $2 AND skc_id = $3
             ORDER BY requirement_type, requirement_key`,
      values: [tenantId, storeId, skcId],
    });
    return result.rows;
  }

  async listSnapshots({ tenantId, storeId, skc }) {
    const result = await this.pool.query({
      text: `SELECT DISTINCT ON (rule_type)
                    id, rule_type, fingerprint, payload, source_trace_id,
                    fetched_at, expires_at,
                    expires_at > now() AS fresh
             FROM shein_rule_snapshots
             WHERE tenant_id = $1 AND store_id = $2 AND subject_key = $3
               AND rule_type IN ('compliance_requirement', 'certificate_schema', 'certificate_library', 'agency_library', 'warning_rules')
             ORDER BY rule_type, fetched_at DESC, id DESC`,
      values: [tenantId, storeId, skc],
    });
    return result.rows;
  }

  async getDraft({ tenantId, storeId, skc }) {
    const result = await this.pool.query({
      text: `
        SELECT *
        FROM compliance_drafts
        WHERE tenant_id = $1 AND store_id = $2 AND skc_name = $3
        LIMIT 1
      `,
      values: [tenantId, storeId, skc],
    });
    return result.rows[0] || null;
  }

  async listFreshPreflightSnapshots({ tenantId, storeId, skc, now }) {
    const result = await this.pool.query({
      text: `SELECT DISTINCT ON (rule_type)
                    id, rule_type, fingerprint, payload, source_trace_id,
                    fetched_at, expires_at
             FROM shein_rule_snapshots
             WHERE tenant_id = $1 AND store_id = $2 AND subject_key = $3
               AND expires_at > $4
               AND rule_type IN ('compliance_requirement', 'certificate_schema', 'certificate_library', 'agency_library', 'warning_rules')
             ORDER BY rule_type, fetched_at DESC`,
      values: [tenantId, storeId, skc, now],
    });
    return result.rows;
  }

  async listMediaAssets({ tenantId, storeId, assetIds }) {
    if (!assetIds.length) return [];
    const result = await this.pool.query({
      text: `SELECT id, status, purpose, sha256, size_bytes, content_type
             FROM media_assets
             WHERE tenant_id = $1 AND store_id = $2
               AND id = ANY($3::uuid[])
             ORDER BY id`,
      values: [tenantId, storeId, assetIds],
    });
    return result.rows;
  }

  async listPreflightRuns({ tenantId, storeId, skc, limit = 5 }) {
    const result = await this.pool.query({
      text: `SELECT id, draft_id, skc_name, status, executable, plan,
                    media_assets,
                    input_fingerprint, rule_fingerprint, media_fingerprint,
                    requirement_rule_snapshot_id, certificate_rule_snapshot_id,
                    created_at
             FROM compliance_preflight_runs
             WHERE tenant_id = $1 AND store_id = $2 AND skc_name = $3
             ORDER BY created_at DESC, id DESC
             LIMIT $4`,
      values: [tenantId, storeId, skc, positiveInteger(limit, 5, 5)],
    });
    return result.rows;
  }

  async getLatestPreflightRun({ tenantId, storeId, skc }) {
    const rows = await this.listPreflightRuns({ tenantId, storeId, skc, limit: 1 });
    return rows[0] || null;
  }

  async listPreflightReviews({ tenantId, storeId, skc, preflightRunId }) {
    const result = await this.pool.query({
      text: `SELECT id, preflight_run_id, skc_name, reviewed_by,
                    reviewer_display_name, reviewed_status,
                    action_count, blocker_count, warning_count,
                    input_fingerprint, rule_fingerprint, media_fingerprint,
                    reviewed_at
             FROM compliance_preflight_reviews
             WHERE tenant_id = $1 AND store_id = $2
               AND skc_name = $3 AND preflight_run_id = $4
             ORDER BY reviewed_at ASC, id ASC`,
      values: [tenantId, storeId, skc, preflightRunId],
    });
    return result.rows;
  }

  async createPreflightReview({
    tenantId,
    storeId,
    skc,
    preflightRunId,
    userId,
    reviewedAt,
  }) {
    const result = await this.pool.query({
      text: `INSERT INTO compliance_preflight_reviews (
               tenant_id, store_id, skc_id, skc_name, preflight_run_id,
               reviewed_by, reviewer_display_name, reviewed_status,
               action_count, blocker_count, warning_count,
               input_fingerprint, rule_fingerprint, media_fingerprint,
               reviewed_at
             )
             SELECT $1, $2, run.skc_id, run.skc_name, run.id,
                    user_row.id,
                    COALESCE(NULLIF(user_row.display_name, ''), user_row.email),
                    run.status,
                    COALESCE(
                      NULLIF(run.plan #>> '{counts,actions}', '')::integer,
                      jsonb_array_length(
                        CASE WHEN jsonb_typeof(run.plan->'actions') = 'array'
                          THEN run.plan->'actions' ELSE '[]'::jsonb END
                      )
                    ),
                    COALESCE(
                      NULLIF(run.plan #>> '{counts,blockers}', '')::integer,
                      jsonb_array_length(
                        CASE WHEN jsonb_typeof(run.plan->'blockers') = 'array'
                          THEN run.plan->'blockers' ELSE '[]'::jsonb END
                      )
                    ),
                    COALESCE(
                      NULLIF(run.plan #>> '{counts,warnings}', '')::integer,
                      jsonb_array_length(
                        CASE WHEN jsonb_typeof(run.plan->'warnings') = 'array'
                          THEN run.plan->'warnings' ELSE '[]'::jsonb END
                      )
                    ),
                    run.input_fingerprint, run.rule_fingerprint,
                    run.media_fingerprint, $6
             FROM compliance_preflight_runs run
             JOIN compliance_drafts current_draft
               ON current_draft.id = run.draft_id
              AND current_draft.tenant_id = $1
              AND current_draft.store_id = $2
              AND current_draft.skc_name = $3
              AND current_draft.updated_at <= run.created_at
             JOIN LATERAL (
               SELECT
                 jsonb_array_length(rule_set.rules) > 0
                 AND NOT EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements(rule_set.rules)
                     AS audited_snapshot(value)
                   WHERE NOT EXISTS (
                     SELECT 1
                     FROM shein_rule_snapshots current_snapshot
                     WHERE current_snapshot.tenant_id = $1
                       AND current_snapshot.store_id = $2
                       AND current_snapshot.subject_key = $3
                       AND current_snapshot.id::text =
                         audited_snapshot.value->>'id'
                       AND current_snapshot.rule_type =
                         audited_snapshot.value->>'ruleType'
                       AND current_snapshot.fingerprint =
                         audited_snapshot.value->>'fingerprint'
                       AND current_snapshot.expires_at > $6
                       AND NOT EXISTS (
                         SELECT 1
                         FROM shein_rule_snapshots newer_snapshot
                         WHERE newer_snapshot.tenant_id = $1
                           AND newer_snapshot.store_id = $2
                           AND newer_snapshot.subject_key = $3
                           AND newer_snapshot.rule_type =
                             current_snapshot.rule_type
                           AND (newer_snapshot.fetched_at, newer_snapshot.id) >
                             (current_snapshot.fetched_at, current_snapshot.id)
                       )
                   )
                 ) AS current_for_rules
               FROM (
                 SELECT CASE
                   WHEN jsonb_typeof(
                     run.plan #> '{audit,ruleSnapshots}'
                   ) = 'array'
                   THEN run.plan #> '{audit,ruleSnapshots}'
                   ELSE '[]'::jsonb
                 END AS rules
               ) rule_set
             ) current_rule_state ON current_rule_state.current_for_rules
             JOIN LATERAL (
               SELECT
                 media_set.valid_array
                 AND jsonb_array_length(media_set.assets) = (
                   SELECT count(DISTINCT audited_media.value->>'id')
                   FROM jsonb_array_elements(media_set.assets)
                     AS audited_media(value)
                 )
                 AND NOT EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements(media_set.assets)
                     AS audited_media(value)
                   WHERE NOT EXISTS (
                     SELECT 1
                     FROM media_assets current_media
                     WHERE current_media.tenant_id = $1
                       AND current_media.store_id = $2
                       AND current_media.id::text =
                         audited_media.value->>'id'
                       AND current_media.status IN ('ready', 'referenced')
                       AND current_media.purpose = 'compliance_evidence'
                       AND current_media.sha256 =
                         audited_media.value->>'sha256'
                   )
                 ) AS current_for_media
               FROM (
                 SELECT
                   jsonb_typeof(run.media_assets) = 'array' AS valid_array,
                   CASE
                     WHEN jsonb_typeof(run.media_assets) = 'array'
                     THEN run.media_assets
                     ELSE '[]'::jsonb
                   END AS assets
               ) media_set
             ) current_media_state ON current_media_state.current_for_media
             JOIN memberships membership
               ON membership.tenant_id = $1
              AND membership.user_id = $5
              AND membership.role IN ('owner', 'admin')
             JOIN users user_row
               ON user_row.id = membership.user_id
              AND user_row.status = 'active'
             WHERE run.tenant_id = $1 AND run.store_id = $2
               AND run.skc_name = $3 AND run.id = $4
               AND NOT EXISTS (
                 SELECT 1
                 FROM compliance_preflight_runs newer
                 WHERE newer.tenant_id = $1 AND newer.store_id = $2
                   AND newer.skc_name = $3
                   AND (newer.created_at, newer.id) > (run.created_at, run.id)
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM compliance_preflight_reviews existing_review
                 WHERE existing_review.preflight_run_id = run.id
                   AND existing_review.reviewed_by = $5
               )
             RETURNING id, preflight_run_id, skc_name, reviewed_by,
                       reviewer_display_name, reviewed_status,
                       action_count, blocker_count, warning_count,
                       input_fingerprint, rule_fingerprint, media_fingerprint,
                       reviewed_at`,
      values: [
        tenantId,
        storeId,
        skc,
        preflightRunId,
        userId,
        reviewedAt,
      ],
    });
    return result.rows[0] || null;
  }

  async createPreflightRun({
    tenantId,
    storeId,
    skcId,
    skc,
    draftId,
    requirementRuleSnapshotId,
    certificateRuleSnapshotId,
    certificateLibrarySnapshotId,
    agencyLibrarySnapshotId,
    warningRulesSnapshotId,
    inputFingerprint,
    ruleFingerprint,
    mediaFingerprint,
    plan,
    mediaAssets,
    userId,
    createdAt,
  }) {
    const result = await this.pool.query({
      text: `INSERT INTO compliance_preflight_runs (
               tenant_id, store_id, skc_id, skc_name, draft_id,
               requirement_rule_snapshot_id, certificate_rule_snapshot_id,
               input_fingerprint, rule_fingerprint, media_fingerprint,
               status, executable, plan, media_assets, requested_by, created_at
             )
             SELECT $1, $2, skc.id, skc.skc_name, draft.id,
                    requirement_snapshot.id, certificate_snapshot.id,
                    $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15, $16
             FROM skcs skc
             JOIN compliance_drafts draft
               ON draft.id = $5 AND draft.tenant_id = $1
              AND draft.store_id = $2 AND draft.skc_name = $4
             JOIN shein_rule_snapshots requirement_snapshot
               ON requirement_snapshot.id = $6
              AND requirement_snapshot.tenant_id = $1
              AND requirement_snapshot.store_id = $2
              AND requirement_snapshot.subject_key = $4
              AND requirement_snapshot.rule_type = 'compliance_requirement'
              AND requirement_snapshot.expires_at > $16
             LEFT JOIN shein_rule_snapshots certificate_snapshot
               ON certificate_snapshot.id = $7
              AND certificate_snapshot.tenant_id = $1
              AND certificate_snapshot.store_id = $2
              AND certificate_snapshot.subject_key = $4
              AND certificate_snapshot.rule_type = 'certificate_schema'
              AND certificate_snapshot.expires_at > $16
             WHERE skc.tenant_id = $1 AND skc.store_id = $2
               AND skc.id = $3 AND skc.skc_name = $4
               AND ($7::uuid IS NULL OR certificate_snapshot.id IS NOT NULL)
               AND (
                 $17::uuid IS NULL OR EXISTS (
                   SELECT 1
                   FROM shein_rule_snapshots certificate_library_snapshot
                   WHERE certificate_library_snapshot.id = $17
                     AND certificate_library_snapshot.tenant_id = $1
                     AND certificate_library_snapshot.store_id = $2
                     AND certificate_library_snapshot.subject_key = $4
                     AND certificate_library_snapshot.rule_type = 'certificate_library'
                     AND certificate_library_snapshot.expires_at > $16
                 )
               )
               AND (
                 $18::uuid IS NULL OR EXISTS (
                   SELECT 1
                   FROM shein_rule_snapshots agency_library_snapshot
                   WHERE agency_library_snapshot.id = $18
                     AND agency_library_snapshot.tenant_id = $1
                     AND agency_library_snapshot.store_id = $2
                     AND agency_library_snapshot.subject_key = $4
                     AND agency_library_snapshot.rule_type = 'agency_library'
                     AND agency_library_snapshot.expires_at > $16
                 )
               )
               AND (
                 $19::uuid IS NULL OR EXISTS (
                   SELECT 1
                   FROM shein_rule_snapshots warning_rules_snapshot
                   WHERE warning_rules_snapshot.id = $19
                     AND warning_rules_snapshot.tenant_id = $1
                     AND warning_rules_snapshot.store_id = $2
                     AND warning_rules_snapshot.subject_key = $4
                     AND warning_rules_snapshot.rule_type = 'warning_rules'
                     AND warning_rules_snapshot.expires_at > $16
                 )
               )
             RETURNING id, skc_name, status, executable, plan,
                       input_fingerprint, rule_fingerprint, media_fingerprint,
                       requirement_rule_snapshot_id, certificate_rule_snapshot_id,
                       created_at`,
      values: [
        tenantId,
        storeId,
        skcId,
        skc,
        draftId,
        requirementRuleSnapshotId,
        certificateRuleSnapshotId,
        inputFingerprint,
        ruleFingerprint,
        mediaFingerprint,
        plan.status,
        plan.executable === true,
        JSON.stringify(plan),
        JSON.stringify(mediaAssets),
        userId || null,
        createdAt,
        certificateLibrarySnapshotId || null,
        agencyLibrarySnapshotId || null,
        warningRulesSnapshotId || null,
      ],
    });
    return result.rows[0] || null;
  }

  async saveDraft({
    tenantId,
    storeId,
    skc,
    templateId,
    requirementSnapshot,
    inputs,
    preflight,
    status,
    userId,
    expectedUpdatedAt,
  }) {
    const result = await this.pool.query({
      text: `
        INSERT INTO compliance_drafts (
          tenant_id, store_id, skc_name, template_id,
          requirement_snapshot, inputs, preflight, status,
          created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $9)
        ON CONFLICT (store_id, skc_name)
        DO UPDATE SET
          template_id = EXCLUDED.template_id,
          requirement_snapshot = EXCLUDED.requirement_snapshot,
          inputs = EXCLUDED.inputs,
          preflight = EXCLUDED.preflight,
          status = EXCLUDED.status,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        WHERE compliance_drafts.tenant_id = EXCLUDED.tenant_id
          AND (
            $10::timestamptz IS NULL
            OR compliance_drafts.updated_at = $10
          )
        RETURNING *
      `,
      values: [
        tenantId,
        storeId,
        skc,
        templateId,
        JSON.stringify(requirementSnapshot),
        JSON.stringify(inputs),
        JSON.stringify(preflight),
        status,
        userId,
        expectedUpdatedAt,
      ],
    });
    return result.rows[0] || null;
  }

  async listTemplates({ tenantId, storeId }) {
    const result = await this.pool.query({
      text: `
        SELECT *
        FROM compliance_templates
        WHERE tenant_id = $1
          AND (store_id = $2 OR store_id IS NULL)
          AND status = 'active'
        ORDER BY updated_at DESC
      `,
      values: [tenantId, storeId],
    });
    return result.rows;
  }

  async saveTemplate({
    tenantId,
    storeId,
    name,
    defaults,
    ruleSnapshot,
    ruleSnapshotAt,
    userId,
  }) {
    const result = await this.pool.query({
      text: `
        INSERT INTO compliance_templates (
          tenant_id, store_id, name, defaults,
          rule_snapshot, rule_snapshot_at, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $7)
        ON CONFLICT (tenant_id, store_id, name)
        DO UPDATE SET
          defaults = EXCLUDED.defaults,
          rule_snapshot = EXCLUDED.rule_snapshot,
          rule_snapshot_at = EXCLUDED.rule_snapshot_at,
          version = compliance_templates.version + 1,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        RETURNING *
      `,
      values: [
        tenantId,
        storeId,
        name,
        JSON.stringify(defaults),
        JSON.stringify(ruleSnapshot),
        ruleSnapshotAt,
        userId,
      ],
    });
    return result.rows[0];
  }
}

export class WebComplianceWorkspaceService {
  constructor({
    repository,
    now = () => new Date(),
    capabilityProvider = () => ({}),
    readCompliance = null,
  } = {}) {
    if (!repository) {
      throw new Error("WebComplianceWorkspaceService 缺少 repository");
    }
    this.repository = repository;
    this.now = now;
    this.capabilityProvider = capabilityProvider;
    this.readCompliance = readCompliance;
  }

  async listSkcs({ context, storeId, filters = {} }) {
    const query = String(filters.query || "").trim();
    if (query.length > 128) {
      throw new ComplianceWorkspaceError("INVALID_QUERY", "搜索内容不能超过128个字符");
    }
    const status = String(filters.status || "").trim();
    if (status && !COMPLIANCE_STATUSES.has(status)) {
      throw new ComplianceWorkspaceError(
        "INVALID_COMPLIANCE_STATUS",
        "合规状态筛选无效",
      );
    }
    const reviewStatus = String(filters.reviewStatus || "").trim();
    if (reviewStatus && !PREFLIGHT_REVIEW_STATUSES.has(reviewStatus)) {
      throw new ComplianceWorkspaceError(
        "INVALID_PREFLIGHT_REVIEW_STATUS",
        "预检审阅状态筛选无效",
      );
    }
    const page = positiveInteger(filters.page, 1, 100000);
    const pageSize = positiveInteger(filters.pageSize, 50, 100);
    const result = await this.repository.listSkcs({
      tenantId: context.tenantId,
      storeId,
      query,
      status,
      reviewStatus,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const total = Number(result.total || 0);
    return {
      items: result.rows.map(publicCachedSkc).filter(Boolean),
      auditSummary: {
        notRun: Number(result.auditSummary?.notRun || 0),
        needsRerun: Number(result.auditSummary?.needsRerun || 0),
        pending: Number(result.auditSummary?.pending || 0),
        reviewed: Number(result.auditSummary?.reviewed || 0),
      },
      complianceSummary: {
        total: Number(result.complianceSummary?.total || 0),
        nonCompliant: Number(result.complianceSummary?.nonCompliant || 0),
        inProgress: Number(result.complianceSummary?.inProgress || 0),
        passed: Number(result.complianceSummary?.passed || 0),
      },
      pagination: {
        page,
        pageSize,
        total,
        pageCount: total ? Math.ceil(total / pageSize) : 0,
      },
    };
  }

  async getSkcDetail({ context, storeId, skc }) {
    const normalizedSkc = requiredSkc(skc);
    const row = await this.repository.getSkc({
      tenantId: context.tenantId,
      storeId,
      skc: normalizedSkc,
    });
    if (!row) {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_SKC_NOT_FOUND",
        "当前店铺不存在该SKC合规缓存",
        404,
      );
    }
    const [records, snapshotRows, draftRow, preflightRows] = await Promise.all([
      this.repository.listRecords({
        tenantId: context.tenantId,
        storeId,
        skcId: row.id,
      }),
      this.repository.listSnapshots({
        tenantId: context.tenantId,
        storeId,
        skc: normalizedSkc,
      }),
      this.repository.getDraft({
        tenantId: context.tenantId,
        storeId,
        skc: normalizedSkc,
      }),
      this.repository.listPreflightRuns
        ? this.repository.listPreflightRuns({
            tenantId: context.tenantId,
            storeId,
            skc: normalizedSkc,
            limit: 5,
          })
        : this.repository.getLatestPreflightRun
          ? this.repository.getLatestPreflightRun({
              tenantId: context.tenantId,
              storeId,
              skc: normalizedSkc,
            }).then((row) => row ? [row] : [])
          : [],
    ]);
    const item = publicCachedSkc(row);
    const snapshots = snapshotRows.map(publicSnapshot);
    const requirementSnapshotRow = snapshotRows.find(
      (snapshot) => snapshot.rule_type === "compliance_requirement",
    );
    item.attributeSnapshot = publicAttributeSnapshot(row);
    item.reportDecision = publicReportDecision({
      complianceRow: requirementSnapshotRow?.payload || {},
    });
    const draft = publicDraftProjection(draftRow);
    const latestPreflightMediaIds = preflightMediaIds(preflightRows[0]);
    const [latestPreflightReviews, latestPreflightMediaRows] = await Promise.all([
      preflightRows[0]?.id && this.repository.listPreflightReviews
        ? this.repository.listPreflightReviews({
            tenantId: context.tenantId,
            storeId,
            skc: normalizedSkc,
            preflightRunId: preflightRows[0].id,
          })
        : [],
      latestPreflightMediaIds.length && this.repository.listMediaAssets
        ? this.repository.listMediaAssets({
            tenantId: context.tenantId,
            storeId,
            assetIds: latestPreflightMediaIds,
          })
        : [],
    ]);
    const currentTime = this.now();
    const projectedPreflights = preflightRows
      .map((run, index) => publicPreflightRun(
        index === 0
          ? {
              ...run,
              current_for_draft: preflightCurrentForDraft(run, draftRow),
              current_for_rules: preflightCurrentForRules(
                run,
                snapshotRows,
                currentTime,
              ),
              current_for_media: preflightCurrentForMedia(
                run,
                latestPreflightMediaRows,
              ),
            }
          : run,
      ))
      .filter(Boolean);
    return {
      item,
      records: records.map(publicRecord),
      snapshots,
      draft,
      workspaceCapabilities: {
        mode: "cloud_cached",
        refreshCurrentSkc: false,
        directReportStorage: false,
        photoTemplateApply: false,
        reportTemplateApply: false,
        photoShare: false,
        photoBindingDiagnostic: false,
        photoSubmit: false,
        reportSubmit: false,
        ...asObject(this.capabilityProvider()),
      },
      editorModel: buildComplianceEditorModel(snapshotRows),
      latestPreflight: projectedPreflights[0] || null,
      preflightHistory: projectedPreflights,
      latestPreflightReviews: latestPreflightReviews
        .map(publicPreflightReview)
        .filter(Boolean),
      releaseGate: buildReleaseGate({ item, draft, snapshots }),
    };
  }

  async refreshSkc({ context, storeId, skc }) {
    const normalizedSkc = requiredSkc(skc);
    if (typeof this.readCompliance !== "function") {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_READBACK_UNAVAILABLE",
        "当前环境暂未启用单 SKC 官方合规回读",
        503,
      );
    }
    const result = await this.readCompliance({
      context,
      storeId,
      skc: normalizedSkc,
    });
    const row = result?.row;
    if (!row || String(row.skc || "") !== normalizedSkc) {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_READBACK_EMPTY",
        "SHEIN 未返回当前 SKC 的合规要求",
        502,
      );
    }
    if (typeof this.repository.saveComplianceReadback === "function") {
      const saved = await this.repository.saveComplianceReadback({
        tenantId: context.tenantId,
        storeId,
        row,
        traceId: result?.diagnostics?.traceId || row?.traceId || null,
        checkedAt: this.now(),
      });
      if (saved === false) {
        throw new ComplianceWorkspaceError(
          "COMPLIANCE_SKC_NOT_FOUND",
          "当前店铺不存在该SKC合规缓存",
          404,
        );
      }
    }
    return {
      refreshed: true,
      detail: await this.getSkcDetail({
        context,
        storeId,
        skc: normalizedSkc,
      }),
    };
  }

  async reviewPreflight({ context, storeId, skc, preflightRunId }) {
    if (!["owner", "admin"].includes(context?.role)) {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_PREFLIGHT_REVIEW_FORBIDDEN",
        "仅管理员可以确认已审阅服务端预检",
        403,
      );
    }
    const normalizedSkc = requiredSkc(skc);
    const normalizedPreflightRunId = requiredPreflightRunId(preflightRunId);
    const row = await this.repository.createPreflightReview({
      tenantId: context.tenantId,
      storeId,
      skc: normalizedSkc,
      preflightRunId: normalizedPreflightRunId,
      userId: context.userId,
      reviewedAt: this.now(),
    });
    if (!row) {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_PREFLIGHT_REVIEW_CONFLICT",
        "该预检已被当前账号审阅，或已不是最新记录",
        409,
      );
    }
    return { review: publicPreflightReview(row) };
  }

  async runPreflight({ context, storeId, skc }) {
    if (context.role === "viewer") {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_PREFLIGHT_FORBIDDEN",
        "当前角色不能运行服务端合规预检",
        403,
      );
    }
    const normalizedSkc = requiredSkc(skc);
    const createdAt = this.now();
    const scope = {
      tenantId: context.tenantId,
      storeId,
      skc: normalizedSkc,
    };
    const [skcRow, draftRow, snapshots] = await Promise.all([
      this.repository.getSkc(scope),
      this.repository.getDraft(scope),
      this.repository.listFreshPreflightSnapshots({ ...scope, now: createdAt }),
    ]);
    if (!skcRow) {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_SKC_NOT_FOUND",
        "当前店铺不存在该SKC合规缓存",
        404,
      );
    }
    if (!draftRow) {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_DRAFT_REQUIRED",
        "请先保存当前SKC的合规草稿",
        409,
      );
    }
    const requirementSnapshot = snapshots.find(
      (snapshot) => snapshot.rule_type === "compliance_requirement",
    );
    if (!requirementSnapshot) {
      throw new ComplianceWorkspaceError(
        "FRESH_RULE_SNAPSHOT_REQUIRED",
        "缺少未过期的SHEIN合规要求快照，请先刷新合规数据",
        409,
      );
    }
    const requirementPayload = asObject(requirementSnapshot.payload);
    if (String(requirementPayload.skc || "") !== normalizedSkc) {
      throw new ComplianceWorkspaceError(
        "RULE_SNAPSHOT_SUBJECT_MISMATCH",
        "合规要求快照与当前SKC不匹配，请重新同步",
        409,
      );
    }

    const references = collectComplianceMediaReferences(draftRow.inputs);
    if (references.invalidReferences.length) {
      throw new ComplianceWorkspaceError(
        "UNPROTECTED_COMPLIANCE_MEDIA",
        "草稿包含未受服务器媒体库保护的本地文件",
        409,
      );
    }
    const mediaRows = references.assetIds.length
      ? await this.repository.listMediaAssets({
          tenantId: context.tenantId,
          storeId,
          assetIds: references.assetIds,
        })
      : [];
    const protectedAssets = mediaRows
      .map((row) => ({
        id: String(row.id).toLowerCase(),
        status: row.status,
        purpose: row.purpose,
        sha256: row.sha256 || null,
        sizeBytes: Number(row.size_bytes || 0),
        contentType: row.content_type || "",
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const protectedIds = new Set(protectedAssets.map((asset) => asset.id));
    const mediaInvalid =
      references.assetIds.some((assetId) => !protectedIds.has(assetId)) ||
      protectedAssets.some(
        (asset) =>
          !["ready", "referenced"].includes(asset.status) ||
          asset.purpose !== "compliance_evidence" ||
          !asset.sha256,
      );
    if (mediaInvalid) {
      throw new ComplianceWorkspaceError(
        "UNPROTECTED_COMPLIANCE_MEDIA",
        "草稿媒体缺失、未就绪或不属于当前店铺的合规证据",
        409,
      );
    }

    const certificateSnapshot = snapshots.find(
      (snapshot) => snapshot.rule_type === "certificate_schema",
    );
    const certificateLibrarySnapshot = snapshots.find(
      (snapshot) => snapshot.rule_type === "certificate_library",
    );
    const agencyLibrarySnapshot = snapshots.find(
      (snapshot) => snapshot.rule_type === "agency_library",
    );
    const warningRulesSnapshot = snapshots.find(
      (snapshot) => snapshot.rule_type === "warning_rules",
    );
    const certificateInputs = trustedCertificateInputs(
      draftRow.inputs,
      requirementPayload,
      certificateSnapshot?.payload,
      certificateLibrarySnapshot?.payload,
    );
    const agencyInputs = trustedAgencyInputs(
      certificateInputs,
      requirementPayload,
      agencyLibrarySnapshot?.payload,
    );
    const trustedInputs = trustedWarningInputs(
      agencyInputs,
      requirementPayload,
      warningRulesSnapshot?.payload,
    );
    const plan = buildSkcCompliancePreflight({
      row: requirementPayload,
      input: trustedInputs,
      now: createdAt.getTime(),
    });
    const selectedSnapshots = snapshots
      .map((snapshot) => ({
        id: snapshot.id,
        ruleType: snapshot.rule_type,
        fingerprint: snapshot.fingerprint,
        fetchedAt: snapshot.fetched_at,
        expiresAt: snapshot.expires_at,
      }))
      .sort((left, right) => left.ruleType.localeCompare(right.ruleType));
    plan.audit = {
      ruleSnapshots: selectedSnapshots,
    };
    const row = await this.repository.createPreflightRun({
      ...scope,
      skcId: skcRow.id,
      draftId: draftRow.id,
      requirementRuleSnapshotId: requirementSnapshot.id,
      certificateRuleSnapshotId: certificateSnapshot?.id || null,
      certificateLibrarySnapshotId: certificateLibrarySnapshot?.id || null,
      agencyLibrarySnapshotId: agencyLibrarySnapshot?.id || null,
      warningRulesSnapshotId: warningRulesSnapshot?.id || null,
      inputFingerprint: createRuleFingerprint(asObject(draftRow.inputs)),
      ruleFingerprint: createRuleFingerprint(selectedSnapshots),
      mediaFingerprint: createRuleFingerprint(protectedAssets),
      plan,
      mediaAssets: protectedAssets,
      userId: context.userId,
      createdAt,
    });
    if (!row) {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_PREFLIGHT_CONFLICT",
        "合规数据或规则快照已变化，请重新读取后再预检",
        409,
      );
    }
    return { preflight: publicPreflightRun(row) };
  }

  async getDraft({ context, storeId, skc }) {
    const row = await this.repository.getDraft({
      tenantId: context.tenantId,
      storeId,
      skc: requiredSkc(skc),
    });
    return { draft: publicDraft(row) };
  }

  async saveDraft({ context, storeId, skc, input = {} }) {
    if (context.role === "viewer") {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_DRAFT_FORBIDDEN",
        "当前角色不能修改合规草稿",
        403,
      );
    }
    const normalizedSkc = requiredSkc(skc);
    const status = String(input.status || "draft");
    if (
      ![
        "draft",
        "blocked",
        "ready",
        "waiting_review",
        "submitted",
        "archived",
      ].includes(status)
    ) {
      throw new ComplianceWorkspaceError(
        "INVALID_DRAFT_STATUS",
        "合规草稿状态无效",
      );
    }
    const expectedUpdatedAt = input.expectedUpdatedAt
      ? String(input.expectedUpdatedAt).trim()
      : null;
    if (expectedUpdatedAt && Number.isNaN(Date.parse(expectedUpdatedAt))) {
      throw new ComplianceWorkspaceError(
        "INVALID_DRAFT_VERSION",
        "合规草稿版本无效，请重新读取",
      );
    }
    const row = await this.repository.saveDraft({
      tenantId: context.tenantId,
      storeId,
      skc: normalizedSkc,
      templateId: input.templateId || null,
      requirementSnapshot: asObject(input.requirementSnapshot),
      inputs: normalizeDraftInputs(input.inputs),
      preflight: asObject(input.preflight),
      status,
      userId: context.userId,
      expectedUpdatedAt,
    });
    if (!row) {
      throw new ComplianceWorkspaceError(
        "DRAFT_CONFLICT",
        "合规草稿保存冲突",
        409,
      );
    }
    return { draft: publicDraft(row) };
  }

  async saveBatchDrafts({
    context,
    storeId,
    skcNames,
    photos = [],
    reports = [],
    readCompliance,
  }) {
    if (context.role === "viewer") {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_DRAFT_FORBIDDEN",
        "当前角色不能批量修改合规草稿",
        403,
      );
    }
    if (typeof readCompliance !== "function") {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_REUSE_UNAVAILABLE",
        "当前环境未启用官方合规读取服务",
        503,
      );
    }
    const normalizedSkcs = Array.from(new Set(asArray(skcNames).map(requiredSkc)));
    if (!normalizedSkcs.length) {
      throw new ComplianceWorkspaceError("INVALID_REQUEST", "至少选择一个 SKC");
    }
    if (normalizedSkcs.length > 50) {
      throw new ComplianceWorkspaceError("INVALID_REQUEST", "一次最多处理 50 个 SKC");
    }
    const requestedPhotos = asArray(photos).map((photo) => asObject(photo));
    const requestedReports = asArray(reports).map((report) => asObject(report));
    if (!requestedPhotos.length && !requestedReports.length) {
      throw new ComplianceWorkspaceError("INVALID_BATCH_MATERIALS", "请先选择实拍图或 1630/1631 报告");
    }
    if (requestedPhotos.length > 10 || requestedReports.length > 2) {
      throw new ComplianceWorkspaceError("INVALID_BATCH_MATERIALS", "批量资料数量超出限制，请分批处理");
    }

    const results = [];
    for (const skc of normalizedSkcs) {
      try {
        const [skcRow, currentDraft, currentCompliance] = await Promise.all([
          this.repository.getSkc({ tenantId: context.tenantId, storeId, skc }),
          this.repository.getDraft({ tenantId: context.tenantId, storeId, skc }),
          readCompliance({ context, storeId, skc }),
        ]);
        const row = currentCompliance?.row;
        if (!skcRow || !row) {
          results.push({ skc, status: "blocked", blockers: [{
            code: "COMPLIANCE_SKC_NOT_FOUND",
            message: "未读取到当前 SKC 的官方合规要求",
          }] });
          continue;
        }
        if (
          row.sourceCoverage?.requirementsReturned !== true ||
          row.sourceCoverage?.photoRequirementsReturned !== true
        ) {
          results.push({ skc, status: "blocked", blockers: [{
            code: "REQUIREMENTS_INCOMPLETE",
            message: "目标 SKC 的官方合规要求尚未完整同步",
          }] });
          continue;
        }
        const inputs = normalizeDraftInputs(currentDraft?.inputs);
        const actions = [];
        const blockers = [];
        const selectedPhotos = [];

        for (const group of ["1", "2"]) {
          const groupPhotos = requestedPhotos.filter((photo) => String(photo.labelGroup || "") === group);
          if (!groupPhotos.length) continue;
          const requirements = group === "2"
            ? asArray(row.packagePhotoRequirements)
            : asArray(row.bodyPhotoRequirements);
          const targetRequirements = requirements.filter(requirementNeedsInput);
          if (!targetRequirements.length) {
            blockers.push({
              code: "PHOTO_REQUIREMENT_NOT_FOUND",
              message: `${group === "2" ? "包装" : "商品本体"}实拍图当前没有可上传的官方要求`,
              labelGroup: group,
            });
            continue;
          }
          const limit = group === "2" ? 2 : 1;
          const uniquePhotos = [];
          const refs = new Set();
          for (const photo of groupPhotos) {
            const localAssetRef = String(photo.localAssetRef || "").trim();
            if (!localAssetRef || refs.has(localAssetRef)) continue;
            refs.add(localAssetRef);
            uniquePhotos.push(photo);
          }
          if (uniquePhotos.length > limit) {
            blockers.push({
              code: "PHOTO_COUNT_EXCEEDED",
              message: `${group === "2" ? "包装" : "商品本体"}实拍图最多 ${limit} 张`,
              labelGroup: group,
            });
            continue;
          }
          uniquePhotos.forEach((photo, index) => {
            const requirement = targetRequirements[Math.min(index, targetRequirements.length - 1)];
            const localAssetRef = String(photo.localAssetRef || "").trim();
            selectedPhotos.push({
              ...photo,
              labelId: String(requirement.labelId ?? photo.labelId ?? ""),
              labelGroup: group,
              labelName: String(requirement.labelName || photo.labelName || ""),
              templateReusable: false,
            });
            actions.push({ type: "photo.save_batch_upload", labelGroup: group, labelId: requirement.labelId, localAssetRef });
          });
        }

        const selectedReports = [];
        for (const report of requestedReports) {
          const reportType = String(report.reportType || complianceReportType(report) || "");
          if (!["1630", "1631"].includes(reportType)) {
            blockers.push({ code: "REPORT_TYPE_REQUIRED", message: "报告必须指定 1630 或 1631" });
            continue;
          }
          const date = requiredReportDate(report.reportDate);
          const requirement = asArray(row.certificateRequirements).find((candidate) =>
            complianceReportType(candidate) === reportType && requirementNeedsInput(candidate),
          );
          if (!requirement) {
            blockers.push({ code: "REPORT_REQUIREMENT_NOT_FOUND", message: `当前 SKC 没有待处理的 ${reportType} 报告要求` });
            continue;
          }
          const files = asArray(report.files).map((file) => ({
            ...asObject(file),
            localAssetRef: String(file?.localAssetRef || "").trim(),
          })).filter((file) => file.localAssetRef);
          if (!files.length) {
            blockers.push({ code: "REPORT_FILE_REQUIRED", message: `${reportType} 报告尚未上传文件` });
            continue;
          }
          const dateFields = reportDateFieldsForRequirement(
            currentCompliance.bundle?.certificateSchemas,
            requirement,
          );
          if (!dateFields.length) {
            blockers.push({ code: "REPORT_DATE_FIELD_NOT_FOUND", message: `${reportType} 报告当前规则没有可写入的生效日期字段` });
            continue;
          }
          const fieldValues = asObject(report.fieldValues);
          selectedReports.push({
            ...report,
            reportType,
            reportDate: date,
            certificateTypeId: requirement.certificateTypeId ?? report.certificateTypeId ?? null,
            certificateTypeCode: String(requirement.certificateTypeCode || report.certificateTypeCode || ""),
            certificateTypeName: String(requirement.certificateTypeName || report.certificateTypeName || `16 CFR ${reportType} 检测报告`),
            certificateDimension: requirement.certificateDimension ?? report.certificateDimension ?? null,
            poolSn: "",
            skc,
            files,
            fieldValues: Object.fromEntries(dateFields.map((field) => [
              String(field.presetId),
              { ...asObject(fieldValues[String(field.presetId)]), value: date },
            ])),
          });
          actions.push({ type: "certificate.save_batch_report", reportType, reportDate: date });
        }

        if (blockers.length) {
          results.push({ skc, status: "blocked", blockers, warnings: [] });
          continue;
        }
        if (selectedPhotos.length) {
          const groups = new Set(selectedPhotos.map((photo) => String(photo.labelGroup)));
          inputs.photos = [
            ...inputs.photos.filter((photo) => !groups.has(String(photo.labelGroup || ""))),
            ...selectedPhotos,
          ];
        }
        if (selectedReports.length) {
          const identities = new Set(selectedReports.map(certificateIdentity));
          inputs.certificates = [
            ...inputs.certificates.filter((certificate) => !identities.has(certificateIdentity(certificate))),
            ...selectedReports,
          ];
        }
        const references = collectComplianceMediaReferences(inputs);
        if (references.invalidReferences.length) {
          results.push({ skc, status: "blocked", blockers: [{ code: "UNPROTECTED_COMPLIANCE_MEDIA", message: "批量资料包含未受服务器媒体库保护的文件" }], warnings: [] });
          continue;
        }
        if (references.assetIds.length && this.repository.listMediaAssets) {
          const mediaRows = await this.repository.listMediaAssets({ tenantId: context.tenantId, storeId, assetIds: references.assetIds });
          const validIds = new Set(mediaRows.filter((asset) =>
            ["ready", "referenced"].includes(asset.status) && asset.purpose === "compliance_evidence",
          ).map((asset) => String(asset.id).toLowerCase()));
          if (references.assetIds.some((assetId) => !validIds.has(assetId))) {
            results.push({ skc, status: "blocked", blockers: [{ code: "UNPROTECTED_COMPLIANCE_MEDIA", message: "批量资料缺失、未就绪或不属于当前店铺" }], warnings: [] });
            continue;
          }
        }
        const saved = await this.saveDraft({
          context,
          storeId,
          skc,
          input: {
            expectedUpdatedAt: currentDraft?.updated_at || null,
            templateId: null,
            requirementSnapshot: row,
            inputs,
            preflight: {
              mode: "batch_manual",
              evaluatedAt: this.now().toISOString(),
              executable: false,
              passed: false,
              blockers: [],
              warnings: [],
              actions,
              externalWrite: false,
            },
            status: "draft",
          },
        });
        results.push({ skc, status: "saved", draft: saved.draft, blockers: [], warnings: [] });
      } catch (error) {
        results.push({
          skc,
          status: "failed",
          blockers: [{ code: String(error?.code || "COMPLIANCE_BATCH_FAILED"), message: String(error?.message || "批量合规资料保存失败") }],
          warnings: [],
        });
      }
    }
    return {
      generatedAt: this.now().toISOString(),
      externalWrite: false,
      message: "批量资料已保存到各 SKC 草稿，进入单个 SKC 详情后执行真实提交",
      items: results,
      summary: {
        requested: results.length,
        saved: results.filter((item) => item.status === "saved").length,
        blocked: results.filter((item) => item.status === "blocked").length,
        failed: results.filter((item) => item.status === "failed").length,
      },
    };
  }

  async applyTemplate({
    context,
    storeId,
    skcNames,
    template,
    readCompliance,
    sections = null,
  }) {
    if (context.role === "viewer") {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_DRAFT_FORBIDDEN",
        "当前角色不能批量应用合规模板",
        403,
      );
    }
    if (typeof readCompliance !== "function") {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_REUSE_UNAVAILABLE",
        "当前环境未启用官方合规读取服务",
        503,
      );
    }
    const normalizedSkcs = Array.from(
      new Set(asArray(skcNames).map(requiredSkc)),
    );
    if (!normalizedSkcs.length) {
      throw new ComplianceWorkspaceError(
        "INVALID_REQUEST",
        "至少选择一个SKC",
      );
    }
    if (normalizedSkcs.length > 20) {
      throw new ComplianceWorkspaceError(
        "INVALID_REQUEST",
        "一次最多应用20个SKC",
      );
    }
    if (!template?.id || !template?.data) {
      throw new ComplianceWorkspaceError(
        "COMPLIANCE_TEMPLATE_REQUIRED",
        "合规模板不存在或不可用",
        404,
      );
    }

    const results = [];
    for (const skc of normalizedSkcs) {
      try {
        const [skcRow, currentDraft, currentCompliance] = await Promise.all([
          this.repository.getSkc({
            tenantId: context.tenantId,
            storeId,
            skc,
          }),
          this.repository.getDraft({
            tenantId: context.tenantId,
            storeId,
            skc,
          }),
          readCompliance({ context, storeId, skc }),
        ]);
        if (!skcRow || !currentCompliance?.row) {
          results.push({
            skc,
            status: "blocked",
            blockers: [{
              code: "COMPLIANCE_SKC_NOT_FOUND",
              message: "未读取到当前 SKC 的官方合规要求",
            }],
            warnings: [],
          });
          continue;
        }
        if (
          template.categoryId &&
          skcRow.category_id &&
          String(template.categoryId) !== String(skcRow.category_id)
        ) {
          results.push({
            skc,
            status: "blocked",
            blockers: [{
              code: "TEMPLATE_CATEGORY_MISMATCH",
              message: "目标 SKC 类目与合规模板类目不一致",
            }],
            warnings: [],
          });
          continue;
        }
        const row = currentCompliance.row;
        if (
          row.sourceCoverage?.requirementsReturned !== true ||
          row.sourceCoverage?.photoRequirementsReturned !== true
        ) {
          results.push({
            skc,
            status: "blocked",
            blockers: [{
              code: "REQUIREMENTS_INCOMPLETE",
              message: "目标 SKC 的官方合规要求来源覆盖不完整",
            }],
            warnings: [],
          });
          continue;
        }

        const evaluatedAt = this.now().toISOString();
        const normalizedSections = Array.isArray(sections)
          ? sections.filter((section) => ["certificates", "photos"].includes(section))
          : null;
        const reuse = buildTemplateReuseDraft({
          row,
          productRow: skcRow,
          currentInputs: currentDraft?.inputs,
          templateDefaults: template.data.defaults,
          templateData: template.data,
          certificateSchemas: currentCompliance.bundle?.certificateSchemas,
          sections: normalizedSections,
          templateId: template.id,
          evaluatedAt,
        });
        const references = collectComplianceMediaReferences(reuse.inputs);
        if (references.invalidReferences.length) {
          reuse.blockers.push({
            code: "UNPROTECTED_COMPLIANCE_MEDIA",
            message: "模板或目标草稿包含未受服务器媒体库保护的文件",
          });
          reuse.preflight.passed = false;
          reuse.preflight.blockers = reuse.blockers;
        } else if (references.assetIds.length && this.repository.listMediaAssets) {
          const mediaRows = await this.repository.listMediaAssets({
            tenantId: context.tenantId,
            storeId,
            assetIds: references.assetIds,
          });
          const validIds = new Set(
            mediaRows
              .filter((asset) =>
                ["ready", "referenced"].includes(asset.status) &&
                asset.purpose === "compliance_evidence",
              )
              .map((asset) => String(asset.id).toLowerCase()),
          );
          if (references.assetIds.some((assetId) => !validIds.has(assetId))) {
            reuse.blockers.push({
              code: "UNPROTECTED_COMPLIANCE_MEDIA",
              message: "模板或目标草稿包含缺失、未就绪或不属于当前店铺的合规素材",
            });
            reuse.preflight.passed = false;
            reuse.preflight.blockers = reuse.blockers;
          }
        }
        if (reuse.blockers.length) {
          results.push({
            skc,
            status: "blocked",
            blockers: reuse.blockers,
            warnings: reuse.warnings,
            preflight: reuse.preflight,
          });
          continue;
        }
        const saved = await this.saveDraft({
          context,
          storeId,
          skc,
          input: {
            expectedUpdatedAt: currentDraft?.updated_at || null,
            templateId: template.id,
            requirementSnapshot: row,
            inputs: reuse.inputs,
            preflight: reuse.preflight,
            status: "draft",
          },
        });
        results.push({
          skc,
          status: "saved",
          draft: saved.draft,
          blockers: [],
          warnings: reuse.warnings,
          preflight: reuse.preflight,
        });
      } catch (error) {
        if (error instanceof ComplianceWorkspaceError) {
          results.push({
            skc,
            status: "failed",
            blockers: [{ code: error.code, message: error.message }],
            warnings: [],
          });
          continue;
        }
        results.push({
          skc,
          status: "failed",
          blockers: [{
            code: String(error?.code || "COMPLIANCE_REUSE_FAILED"),
            message: String(error?.message || "批量应用合规模板失败"),
          }],
          warnings: [],
        });
      }
    }
    return {
      templateId: template.id,
      generatedAt: this.now().toISOString(),
      externalWrite: false,
      items: results,
      summary: {
        requested: results.length,
        saved: results.filter((item) => item.status === "saved").length,
        blocked: results.filter((item) => item.status === "blocked").length,
        failed: results.filter((item) => item.status === "failed").length,
      },
    };
  }

  async listTemplates({ context, storeId }) {
    const rows = await this.repository.listTemplates({
      tenantId: context.tenantId,
      storeId,
    });
    return { templates: rows.map(publicTemplate), count: rows.length };
  }

  async saveTemplate({ context, storeId, input = {} }) {
    const name = String(input.name || "").trim();
    if (!name || name.length > 100) {
      throw new ComplianceWorkspaceError(
        "INVALID_TEMPLATE_NAME",
        "模板名称不能为空且不能超过100个字符",
      );
    }
    const defaults = sanitizeTemplateDefaults(input.defaults);
    if (!defaults.photos.length) {
      throw new ComplianceWorkspaceError(
        "INVALID_TEMPLATE_MATERIALS",
        "至少上传一张通用实拍图",
      );
    }
    const row = await this.repository.saveTemplate({
      tenantId: context.tenantId,
      storeId,
      name,
      defaults,
      ruleSnapshot: asObject(input.ruleSnapshot),
      ruleSnapshotAt: input.ruleSnapshotAt || null,
      userId: context.userId,
    });
    return { template: publicTemplate(row) };
  }
}
