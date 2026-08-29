export const SHEIN_COMPLIANCE_RULE_PATHS = Object.freeze({
  certificateSchema: "/open-api/goods-certificate-schemas/detail",
  certificateSearch: "/open-api/goods-certificates/search",
  agencyList: "/open-api/goods-compliance/agency-list",
  warningRules:
    "/open-api/goods-compliance/query-warning-certificate-rules",
});

const CERTIFICATE_TYPE_BATCH_SIZE = 10;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return Array.from(
    new Set(
      asArray(values)
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function diagnostic(path, result) {
  return {
    endpoint: path,
    traceId: result?.diagnostics?.traceId || "",
    durationMs: Number(result?.diagnostics?.durationMs || 0),
  };
}

function compactError(path, error) {
  return {
    endpoint: path,
    code: error?.code || null,
    traceId: error?.traceId || null,
    message: error?.message || "SHEIN合规规则查询失败",
  };
}

async function fetchCertificateSchemas({ certificateTypeCodes, request }) {
  const data = [];
  const agencies = [];
  const diagnostics = [];
  for (const codeBatch of chunks(
    certificateTypeCodes,
    CERTIFICATE_TYPE_BATCH_SIZE,
  )) {
    const result = await request({
      method: "POST",
      path: SHEIN_COMPLIANCE_RULE_PATHS.certificateSchema,
      body: { certificateTypeCodes: codeBatch },
    });
    data.push(...asArray(result.payload.info?.certificateTypeInfoList));
    agencies.push(...asArray(result.payload.info?.srmDetectionAgencyList));
    diagnostics.push(
      diagnostic(SHEIN_COMPLIANCE_RULE_PATHS.certificateSchema, result),
    );
  }
  return {
    schemas: Array.from(
      new Map(
        data.map((schema) => [
          String(schema.certificateTypeId || schema.certificateType || ""),
          schema,
        ]),
      ).values(),
    ),
    srmDetectionAgencyList: Array.from(
      new Map(
        agencies.map((item) => [
          String(item.detectionAgency?.detectionAgencyId || ""),
          item,
        ]),
      ).values(),
    ),
    diagnostics,
  };
}

async function fetchCertificateLibrary({ certificateTypeCodes, request }) {
  const data = [];
  const diagnostics = [];
  for (const codeBatch of chunks(
    certificateTypeCodes,
    CERTIFICATE_TYPE_BATCH_SIZE,
  )) {
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum += 1) {
      const result = await request({
        method: "POST",
        path: SHEIN_COMPLIANCE_RULE_PATHS.certificateSearch,
        body: {
          pageNum,
          pageSize: PAGE_SIZE,
          certificateTypeCodeList: codeBatch,
          statusList: [2],
        },
      });
      const page = asArray(result.payload.info?.data);
      data.push(...page);
      diagnostics.push(
        diagnostic(SHEIN_COMPLIANCE_RULE_PATHS.certificateSearch, result),
      );
      if (page.length < PAGE_SIZE) break;
    }
  }
  return {
    certificates: Array.from(
      new Map(
        data.map((certificate) => [
          String(certificate.poolSn || certificate.poolId || ""),
          certificate,
        ]),
      ).values(),
    ),
    diagnostics,
  };
}

async function fetchAgencyLibrary({ request }) {
  const data = [];
  const diagnostics = [];
  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum += 1) {
    const result = await request({
      method: "POST",
      path: SHEIN_COMPLIANCE_RULE_PATHS.agencyList,
      body: { pageNum, pageSize: PAGE_SIZE },
    });
    const page = asArray(result.payload.info);
    data.push(...page);
    diagnostics.push(
      diagnostic(SHEIN_COMPLIANCE_RULE_PATHS.agencyList, result),
    );
    if (page.length < PAGE_SIZE) break;
  }
  const agencies = Array.from(
    new Map(
      data.map((agency) => [String(agency.agencyId || ""), agency]),
    ).values(),
  );
  return {
    agencies,
    bindableAgencies: agencies.filter(
      (agency) =>
        Number(agency.agencyStatus) === 0 &&
        [1, 2].includes(Number(agency.applyStatus)),
    ),
    diagnostics,
  };
}

async function fetchWarningRules({ certificateTypeCodes, request }) {
  const result = await request({
    method: "POST",
    path: SHEIN_COMPLIANCE_RULE_PATHS.warningRules,
    body: {},
  });
  const requestedCodes = new Set(certificateTypeCodes);
  return {
    warningRules: asArray(result.payload.info).filter((rule) =>
      requestedCodes.has(String(rule.certificateTypeCode || "")),
    ),
    diagnostics: [
      diagnostic(SHEIN_COMPLIANCE_RULE_PATHS.warningRules, result),
    ],
  };
}

export async function fetchComplianceRuleBundle({
  row,
  request,
  continueOnError = true,
} = {}) {
  if (!row?.skc) throw new TypeError("row with skc is required");
  if (typeof request !== "function") throw new TypeError("request is required");

  const certificateTypeCodes = unique(
    asArray(row.certificateRequirements).map(
      (item) => item.certificateTypeCode,
    ),
  );
  const warningTypeCodes = unique(
    asArray(row.warningRequirements).map(
      (item) => item.certificateTypeCode,
    ),
  );
  const needsAgencies = asArray(row.agencyRequirements).length > 0;
  const result = {
    skc: row.skc,
    requirements: {
      certificates: asArray(row.certificateRequirements),
      agencies: asArray(row.agencyRequirements),
      warnings: asArray(row.warningRequirements),
      bodyPhotos: asArray(row.bodyPhotoRequirements),
      packagePhotos: asArray(row.packagePhotoRequirements),
      unsupported: asArray(row.unsupportedRequirements),
    },
    certificateSchemas: [],
    srmDetectionAgencyList: [],
    certificates: [],
    agencies: [],
    bindableAgencies: [],
    warningRules: [],
    sourceCoverage: {
      certificateSchemas: certificateTypeCodes.length === 0,
      certificateLibrary: certificateTypeCodes.length === 0,
      agencies: !needsAgencies,
      warningRules: warningTypeCodes.length === 0,
    },
    diagnostics: [],
    errors: [],
  };

  const runSection = async (coverageKey, task, apply) => {
    try {
      const section = await task();
      apply(section);
      result.sourceCoverage[coverageKey] = true;
      result.diagnostics.push(...asArray(section.diagnostics));
    } catch (error) {
      result.errors.push(compactError(coverageKey, error));
      if (!continueOnError) throw error;
    }
  };

  if (certificateTypeCodes.length) {
    await runSection(
      "certificateSchemas",
      () =>
        fetchCertificateSchemas({
          certificateTypeCodes,
          request,
        }),
      (section) => {
        result.certificateSchemas = section.schemas;
        result.srmDetectionAgencyList = section.srmDetectionAgencyList;
      },
    );
    await runSection(
      "certificateLibrary",
      () =>
        fetchCertificateLibrary({
          certificateTypeCodes,
          request,
        }),
      (section) => {
        result.certificates = section.certificates;
      },
    );
  }

  if (needsAgencies) {
    await runSection(
      "agencies",
      () => fetchAgencyLibrary({ request }),
      (section) => {
        result.agencies = section.agencies;
        result.bindableAgencies = section.bindableAgencies;
      },
    );
  }

  if (warningTypeCodes.length) {
    await runSection(
      "warningRules",
      () =>
        fetchWarningRules({
          certificateTypeCodes: warningTypeCodes,
          request,
        }),
      (section) => {
        result.warningRules = section.warningRules;
      },
    );
  }

  result.complete = Object.values(result.sourceCoverage).every(Boolean);
  result.fetchedAt = new Date().toISOString();
  return result;
}
