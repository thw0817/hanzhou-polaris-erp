const REPORT_TYPES = new Set(["1630", "1631"]);
const OFFICIAL_CAPABILITIES = ["gcc", "product_identifier"];

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function issue(code, message, extra = {}) {
  return { code, message, ...extra };
}

function requirementIdentity(requirement) {
  const value = asObject(requirement);
  return [
    value.certificateTypeId,
    value.certificateTypeCode,
    value.certificateTypeName,
  ]
    .map(text)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isCapabilityRequirement(requirement, capabilityKey) {
  const value = asObject(requirement);
  const identity = requirementIdentity(value);
  if (capabilityKey === "product_identifier") {
    return (
      text(value.certificateTypeId) === "844" ||
      identity.includes("产品标识符") ||
      identity.includes("productidentifier") ||
      identity.includes("product identifier")
    );
  }
  return identity.includes("gcc");
}

function requirementStatus(requirement) {
  const value = asObject(requirement);
  const required = Number(value.isRequired) === 1;
  if (!required) return "not_required";
  const reviewState = Number(value.reviewState);
  if (reviewState === 2) return "passed";
  if (reviewState === 1) return "reviewing";
  if (reviewState === 3) return "failed";
  if (reviewState === 0) return "missing";
  return "unknown";
}

function capabilityProjection(requirements, capabilityKey) {
  const matches = asArray(requirements).filter((requirement) =>
    isCapabilityRequirement(requirement, capabilityKey),
  );
  const requirement = matches[0] || null;
  const status = requirement ? requirementStatus(requirement) : "not_required";
  return {
    capabilityKey,
    required: status !== "not_required",
    status,
    reviewState: requirement?.reviewState ?? null,
    certificateTypeId: requirement?.certificateTypeId ?? null,
    certificateTypeCode: text(requirement?.certificateTypeCode),
    certificateTypeName: text(requirement?.certificateTypeName),
    editable: false,
    writeStatus: "unsupported_by_official_api",
    writeEndpoint: null,
    writeFields: null,
  };
}

function reportMaterialFor(reportType, draftData) {
  const source = asObject(draftData);
  const reportTemplateData = asObject(
    asObject(source.reportTemplateSnapshot).data,
  );
  const hasIndependentTemplate = Object.keys(reportTemplateData).length > 0;
  if (
    hasIndependentTemplate &&
    (
      text(reportTemplateData.templateKind) !== "rug_report" ||
      text(reportTemplateData.reportType) !== text(reportType)
    )
  ) {
    return null;
  }
  const templateData = hasIndependentTemplate
    ? reportTemplateData
    : asObject(asObject(source.complianceTemplateSnapshot).data);
  const defaults = asObject(templateData.defaults);
  return asArray(defaults.certificates).find((certificate) => {
    const identity = requirementIdentity(certificate);
    if (!identity.includes(reportType)) return false;
    if (text(certificate.poolSn)) return true;
    return asArray(certificate.files).some((file) =>
      text(file?.localAssetRef || file?.localAssetId),
    );
  }) || null;
}

function currentRequirementsBySkc(requirementRows) {
  return new Map(
    asArray(requirementRows)
      .map((row) => [text(row?.skc), row])
      .filter(([skc]) => skc),
  );
}

function officialReportType(requirement) {
  const identity = requirementIdentity(requirement);
  if (identity.includes("1631")) return "1631";
  if (identity.includes("1630")) return "1630";
  if (identity.includes("smallcarpet")) return "1631";
  if (identity.includes("largecarpet")) return "1630";
  return null;
}

function officialReportTypes(row) {
  return Array.from(new Set(
    asArray(row?.certificateRequirements)
      .filter((requirement) => Number(requirement?.isRequired) === 1 || Number(requirement?.reviewState) === 3)
      .map(officialReportType)
      .filter(Boolean),
  ));
}

function validateCapabilityStatus(capability, blockers) {
  if (!capability.required || capability.status === "passed") return;
  const message = capability.status === "unknown"
    ? `${capability.capabilityKey}官方状态未知，不能完成合规复验`
    : `${capability.capabilityKey}官方状态为“${capability.status}”，不能完成合规复验`;
  blockers.push(issue(
    "OFFICIAL_CAPABILITY_NOT_PASSED",
    message,
    { capabilityKey: capability.capabilityKey },
  ));
}

function validateRuleSnapshot(ruleSnapshot, now) {
  const snapshot = asObject(ruleSnapshot);
  if (snapshot.fresh !== true) {
    return issue(
      "RULE_SNAPSHOT_STALE",
      "当前SHEIN合规要求规则快照已过期或未确认新鲜度",
    );
  }
  const expiresAt = Date.parse(text(snapshot.expiresAt));
  if (Number.isFinite(expiresAt) && expiresAt <= new Date(now).getTime()) {
    return issue(
      "RULE_SNAPSHOT_STALE",
      "当前SHEIN合规要求规则快照已过期",
    );
  }
  if (!text(snapshot.fetchedAt)) {
    return issue(
      "RULE_SNAPSHOT_MISSING",
      "当前SHEIN合规要求规则快照缺少读取时间",
    );
  }
  return null;
}

export function buildComplianceRevalidation({
  readback = {},
  draftData = {},
  requirementRows = [],
  ruleSnapshot = {},
  ruleSnapshotsBySkc = {},
  expectedSkcNames = [],
  now = new Date(),
} = {}) {
  const normalizedReadback = asObject(readback);
  const skcs = asArray(normalizedReadback.skcs);
  const expectedSkcs = Array.from(
    new Set(asArray(expectedSkcNames).map(text).filter(Boolean)),
  );
  const readbackSkcs = new Set(skcs.map((skc) => text(skc?.skcName)));
  const rowsBySkc = currentRequirementsBySkc(requirementRows);
  const projections = skcs.map((skc) => {
    const skcName = text(skc?.skcName);
    const row = rowsBySkc.get(skcName);
    const blockers = [];
    if (!skcName) {
      blockers.push(issue("SPU_READBACK_SKC_INVALID", "SPU回读包含无效SKC"));
    }
    if (!row) {
      blockers.push(issue(
        "REQUIREMENTS_MISSING",
        `未读取到SKC ${skcName || "--"} 的当前SHEIN合规要求`,
      ));
    } else if (
      row.sourceCoverage?.requirementsReturned !== true ||
      row.sourceCoverage?.photoRequirementsReturned !== true
    ) {
      blockers.push(issue(
        "REQUIREMENTS_INCOMPLETE",
        `SKC ${skcName} 的SHEIN合规要求来源覆盖不完整`,
      ));
    }
    const currentRuleSnapshot =
      asObject(ruleSnapshotsBySkc)[skcName] || ruleSnapshot;
    const currentSnapshotBlocker = validateRuleSnapshot(
      currentRuleSnapshot,
      now,
    );
    if (currentSnapshotBlocker) blockers.push(currentSnapshotBlocker);
    const reportTypes = officialReportTypes(row);
    const reportType = reportTypes.length === 1 ? reportTypes[0] : null;
    if (reportTypes.length > 1) {
      blockers.push(issue(
        "OFFICIAL_REPORT_REQUIREMENT_AMBIGUOUS",
        `SKC ${skcName || "--"} 当前同时返回${reportTypes.join("、")}报告要求`,
      ));
    } else if (reportType && !reportMaterialFor(reportType, draftData)
    ) {
      blockers.push(issue(
        "REPORT_MATERIAL_MISSING",
        `SKC ${skcName} 缺少SHEIN官方要求的${reportType}报告材料`,
      ));
    }

    const requirements = [
      ...asArray(row?.certificateRequirements),
      ...asArray(row?.agencyRequirements),
      ...asArray(row?.warningRequirements),
      ...asArray(row?.unsupportedRequirements),
    ];
    const capabilities = Object.fromEntries(
      OFFICIAL_CAPABILITIES.map((capabilityKey) => {
        const capability = capabilityProjection(requirements, capabilityKey);
        validateCapabilityStatus(capability, blockers);
        return [capabilityKey, capability];
      }),
    );
    return {
      skcName,
      skuCodes: asArray(skc?.skuList)
        .map((sku) => text(sku?.skuCode))
        .filter(Boolean),
      report: {
        reportType: REPORT_TYPES.has(text(reportType)) ? reportType : null,
        longestEdgeCm: null,
        areaM2: null,
        evidence: [],
      },
      capabilities,
      status: blockers.length ? "blocked" : "passed",
      blockers,
    };
  });

  const blockers = projections.flatMap((projection) =>
    projection.blockers.map((item) => ({
      ...item,
      skcName: projection.skcName,
    })),
  );
  if (!skcs.length) {
    blockers.push(issue(
      "SPU_READBACK_SKC_MISSING",
      "SPU回读缺少SKC关系，不能完成合规复验",
    ));
  }
  for (const skcName of expectedSkcs) {
    if (!readbackSkcs.has(skcName)) {
      blockers.push(issue(
        "SPU_READBACK_SKC_COVERAGE_INCOMPLETE",
        `SPU回读缺少任务原计划中的SKC ${skcName}`,
        { skcName },
      ));
    }
  }
  for (const skcName of readbackSkcs) {
    if (expectedSkcs.length && !expectedSkcs.includes(skcName)) {
      blockers.push(issue(
        "SPU_READBACK_SKC_UNEXPECTED",
        `SPU回读包含任务原计划之外的SKC ${skcName}`,
        { skcName },
      ));
    }
  }

  return {
    projectionVersion: "compliance-revalidation-v1",
    mode: "dry-run",
    externalWrite: false,
    status: blockers.length ? "blocked" : "passed",
    completionEligible: blockers.length === 0,
    spuName: text(normalizedReadback.spuName) || null,
    ruleSnapshot: {
      fetchedAt: text(ruleSnapshot.fetchedAt) || null,
      expiresAt: text(ruleSnapshot.expiresAt) || null,
      fresh: ruleSnapshot.fresh === true,
    },
    ruleSnapshotsBySkc: Object.fromEntries(
      Object.entries(asObject(ruleSnapshotsBySkc)).map(([skcName, snapshot]) => [
        skcName,
        {
          fetchedAt: text(snapshot?.fetchedAt) || null,
          expiresAt: text(snapshot?.expiresAt) || null,
          fresh: snapshot?.fresh === true,
        },
      ]),
    ),
    skcs: projections,
    blockers,
    summary: {
      skcCount: projections.length,
      skuCount: projections.reduce(
        (total, projection) => total + projection.skuCodes.length,
        0,
      ),
      passedSkcCount: projections.filter((item) => item.status === "passed").length,
      blockedSkcCount: projections.filter((item) => item.status === "blocked").length,
      disposition: blockers.length
        ? "compliance-revalidation-blocked"
        : "compliance-revalidation-passed",
    },
  };
}
