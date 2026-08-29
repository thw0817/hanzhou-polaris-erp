export const SHEIN_COMPLIANCE_PATHS = Object.freeze({
  requirements: "/open-api/goods-compliance-requirements/list",
  photoRequirements: "/open-api/goods-compliance/skc-label-list",
});

export const SHEIN_COMPLIANCE_BATCH_SIZE = 20;

const ACTIONABLE_GROUPS = Object.freeze({
  certificate: "ZSZZL",
  agency: "GSL",
});
const PHOTO_FAILURE_REASON_FIELDS = Object.freeze([
  "failReason",
  "failReasonList",
]);

export function sanitizePhotoRequirement(item) {
  if (!item || typeof item !== "object") return item;
  const isCurrentRequiredFailure =
    Number(item.isRequired) === 1 && Number(item.reviewStatus) === 3;
  if (isCurrentRequiredFailure) return item;

  let sanitized = item;
  for (const field of PHOTO_FAILURE_REASON_FIELDS) {
    if (!Object.hasOwn(item, field)) continue;
    if (sanitized === item) sanitized = { ...item };
    delete sanitized[field];
  }
  return sanitized;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function uniqueSkcNames(values) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function requirementStatus(items) {
  if (!items.length) return "无需";
  if (items.some((item) => Number(item.reviewState) === 3)) return "失败";
  if (
    items.some(
      (item) =>
        Number(item.isRequired) === 1 && Number(item.reviewState) === 0,
    )
  ) {
    return "待补充";
  }
  if (items.some((item) => Number(item.reviewState) === 1)) return "审核中";
  if (items.some((item) => Number(item.isRequired) === 10)) return "待同步";
  if (items.some((item) => Number(item.reviewState) === 2)) return "通过";
  return "无需";
}

function photoStatus(items) {
  if (!items.length) return "无需";
  const requiredItems = items.filter((item) => Number(item.isRequired) === 1);
  if (requiredItems.some((item) => Number(item.reviewStatus) === 3)) return "失败";
  if (
    requiredItems.some((item) => Number(item.reviewStatus) === 0)
  ) {
    return "待补充";
  }
  if (items.some((item) => Number(item.isRequired) === 10)) return "待同步";
  if (
    requiredItems.some((item) =>
      [1, 2].includes(Number(item.reviewStatus)),
    )
  ) {
    return "通过";
  }
  return "无需";
}

function overallStatus(statuses) {
  if (statuses.includes("失败")) return "需修正";
  if (statuses.includes("待补充")) return "待补充";
  if (statuses.includes("审核中")) return "审核中";
  if (statuses.includes("待同步")) return "待同步";
  return "通过";
}

function compactDiagnostics(diagnostics) {
  return diagnostics.map((item) => ({
    endpoint: item.endpoint,
    traceId: item.traceId || "",
    durationMs: Number(item.durationMs || 0),
  }));
}

function compactBatchError(error) {
  return {
    message: error?.message || "SHEIN 合规批次查询失败",
    code: error?.code || null,
    traceId: error?.traceId || null,
  };
}

export function normalizeComplianceRows({
  skcNames,
  products = [],
  requirementRows = [],
  photoRows = [],
} = {}) {
  const productBySkc = new Map(
    products.map((product) => [String(product.skc || ""), product]),
  );
  const requirementsBySkc = new Map(
    requirementRows.map((row) => [String(row.skcName || ""), row]),
  );
  const photosBySkc = new Map(
    photoRows.map((row) => [String(row.skc || ""), row]),
  );

  return uniqueSkcNames(skcNames).map((skc) => {
    const product = productBySkc.get(skc) || {};
    const requirementSource = requirementsBySkc.get(skc);
    const photoSource = photosBySkc.get(skc);
    const requirements = Array.isArray(requirementSource?.items)
      ? requirementSource.items
      : [];
    const photoRequirements = Array.isArray(photoSource?.skcLabelInfoList)
      ? photoSource.skcLabelInfoList.map(sanitizePhotoRequirement)
      : [];
    const certificateRequirements = requirements.filter(
      (item) => item.complianceGroupCode === ACTIONABLE_GROUPS.certificate,
    );
    const agencyRequirements = requirements.filter(
      (item) => item.complianceGroupCode === ACTIONABLE_GROUPS.agency,
    );
    const warningRequirements = requirements.filter(
      (item) =>
        item.complianceGroupCode === "HGXXL" &&
        item.isManualProductWarning === true,
    );
    const unsupportedRequirements = requirements.filter(
      (item) =>
        ![
          ACTIONABLE_GROUPS.certificate,
          ACTIONABLE_GROUPS.agency,
        ].includes(item.complianceGroupCode) &&
        !(
          item.complianceGroupCode === "HGXXL" &&
          item.isManualProductWarning === true
        ),
    );
    const bodyPhotoRequirements = photoRequirements.filter(
      (item) => String(item.labelGroup || "") === "1",
    );
    const packagePhotoRequirements = photoRequirements.filter(
      (item) => String(item.labelGroup || "") === "2",
    );
    const certificate = requirementStatus(certificateRequirements);
    const agency = requirementStatus(agencyRequirements);
    const warning = requirementStatus(warningRequirements);
    const platformOnly = requirementStatus(unsupportedRequirements);
    const packagePhoto = photoStatus(packagePhotoRequirements);
    const bodyPhoto = photoStatus(bodyPhotoRequirements);

    return {
      id: skc,
      type: "compliance",
      skc,
      spu: product.spu || "",
      name: product.name || skc,
      image: product.image || "",
      state: overallStatus([
        certificate,
        agency,
        warning,
        platformOnly,
        packagePhoto,
        bodyPhoto,
      ]),
      certificate,
      agency,
      warning,
      platformOnly,
      packagePhoto,
      bodyPhoto,
      shelfStatus: photoSource?.skcShelfStatus ?? null,
      certificateRequirements,
      agencyRequirements,
      warningRequirements,
      packagePhotoRequirements,
      bodyPhotoRequirements,
      unsupportedRequirements,
      sourceCoverage: {
        requirementsReturned: Boolean(requirementSource),
        photoRequirementsReturned: Boolean(photoSource),
      },
    };
  });
}

export function summarizeComplianceRow(row = {}) {
  const certificate = row.certificate || "待同步";
  const agency = row.agency || "待同步";
  const warning = row.warning || "待同步";
  const platformOnly =
    row.platformOnly || requirementStatus(row.unsupportedRequirements || []);
  const packagePhoto = row.packagePhoto || "待同步";
  const bodyPhoto = row.bodyPhoto || "待同步";
  return {
    id: row.id || row.skc || "",
    type: "compliance",
    skc: row.skc || "",
    spu: row.spu || "",
    name: row.name || row.skc || "",
    image: row.image || "",
    state: overallStatus([
      certificate,
      agency,
      warning,
      platformOnly,
      packagePhoto,
      bodyPhoto,
    ]),
    certificate,
    agency,
    warning,
    platformOnly,
    packagePhoto,
    bodyPhoto,
    shelfStatus: row.shelfStatus ?? null,
    sourceCoverage: row.sourceCoverage || null,
  };
}

export async function syncStoreComplianceData({
  skcNames,
  products = [],
  request,
  onBatch,
  continueOnError = false,
} = {}) {
  if (typeof request !== "function") {
    throw new TypeError("request is required");
  }
  const normalizedSkcNames = uniqueSkcNames(skcNames);
  if (!normalizedSkcNames.length) {
    return {
      rows: [],
      count: 0,
      diagnostics: { batchCount: 0, requests: [] },
    };
  }

  const requirementRows = [];
  const photoRows = [];
  const diagnostics = [];
  const successfulSkcNames = [];
  const failedSkcNames = [];
  const batches = chunks(normalizedSkcNames, SHEIN_COMPLIANCE_BATCH_SIZE);

  for (const [batchIndex, skcBatch] of batches.entries()) {
    const batchDiagnostics = [];
    try {
      const requirementResult = await request({
        method: "POST",
        path: SHEIN_COMPLIANCE_PATHS.requirements,
        body: {
          pageNum: 1,
          pageSize: SHEIN_COMPLIANCE_BATCH_SIZE,
          skcNames: skcBatch,
        },
      });
      const batchRequirementRows = Array.isArray(
        requirementResult.payload.info?.data,
      )
        ? requirementResult.payload.info.data
        : [];
      requirementRows.push(...batchRequirementRows);
      batchDiagnostics.push({
        endpoint: SHEIN_COMPLIANCE_PATHS.requirements,
        ...requirementResult.diagnostics,
      });

      const photoResult = await request({
        method: "POST",
        path: SHEIN_COMPLIANCE_PATHS.photoRequirements,
        body: {
          pageNum: 1,
          pageSize: SHEIN_COMPLIANCE_BATCH_SIZE,
          skcList: skcBatch,
        },
      });
      const batchPhotoRows = Array.isArray(photoResult.payload.info)
        ? photoResult.payload.info
        : [];
      photoRows.push(...batchPhotoRows);
      successfulSkcNames.push(...skcBatch);
      batchDiagnostics.push({
        endpoint: SHEIN_COMPLIANCE_PATHS.photoRequirements,
        ...photoResult.diagnostics,
      });
      diagnostics.push(...batchDiagnostics);

      if (typeof onBatch === "function") {
        await onBatch({
          batchIndex,
          batchNumber: batchIndex + 1,
          batchCount: batches.length,
          skcNames: skcBatch,
          rows: normalizeComplianceRows({
            skcNames: skcBatch,
            products,
            requirementRows: batchRequirementRows,
            photoRows: batchPhotoRows,
          }),
          diagnostics: compactDiagnostics(batchDiagnostics),
          error: null,
        });
      }
    } catch (error) {
      failedSkcNames.push(...skcBatch);
      if (typeof onBatch === "function") {
        await onBatch({
          batchIndex,
          batchNumber: batchIndex + 1,
          batchCount: batches.length,
          skcNames: skcBatch,
          rows: [],
          diagnostics: compactDiagnostics(batchDiagnostics),
          error: compactBatchError(error),
        });
      }
      if (!continueOnError) throw error;
    }
  }

  const rows = normalizeComplianceRows({
    skcNames: successfulSkcNames,
    products,
    requirementRows,
    photoRows,
  });
  return {
    rows,
    count: rows.length,
    diagnostics: {
      batchCount: batches.length,
      requests: compactDiagnostics(diagnostics),
    },
    failedSkcNames,
  };
}
