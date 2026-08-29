function text(value) {
  return String(value ?? "").trim();
}

function isActiveProduct(item) {
  const status = text(item.shelfStatus);
  return status === "1" || status.includes("上架") || status.includes("在售");
}

function sourceCoverageReady(item) {
  const coverage = item.summary?.sourceCoverage;
  return coverage?.requirementsReturned === true &&
    coverage?.photoRequirementsReturned === true;
}

function templateReportIdentity(template) {
  const abstractType = text(template?.data?.reportType);
  const certificates = Array.isArray(template?.data?.defaults?.certificates)
    ? template.data.defaults.certificates
    : [];
  return [abstractType, ...certificates.map((certificate) => [
    certificate?.certificateTypeId,
    certificate?.certificateTypeCode,
    certificate?.certificateTypeName,
  ].map(text).filter(Boolean).join(" ").toLowerCase())].filter(Boolean);
}

export function classifyComplianceTemplateOptions({ templates = [], reportType }) {
  const available = Array.isArray(templates) ? templates : [];
  const expectedReportType = ["1630", "1631"].includes(text(reportType))
    ? text(reportType)
    : "";

  return {
    complianceTemplates: available.filter((template) =>
      template?.data?.templateKind !== "rug_report"
    ),
    photoTemplates: available.filter((template) =>
      template?.data?.templateKind !== "rug_report" &&
      Array.isArray(template?.data?.defaults?.photos) &&
      template.data.defaults.photos.length > 0
    ),
    reportTemplates: expectedReportType
      ? available.filter((template) =>
          templateReportIdentity(template).some((identity) =>
            identity.includes(expectedReportType)
          )
        )
      : [],
  };
}

export function buildComplianceReusePlan({
  template,
  items = [],
  selectedSkcs = [],
}) {
  const selected = new Set(selectedSkcs.map(text).filter(Boolean));
  const activeItems = items.filter(
    (item) => isActiveProduct(item) && (!selected.size || selected.has(text(item.skc))),
  );

  if (!template) {
    return {
      valid: false,
      blockers: ["请先保存并选中一套合规模板"],
      items: [],
    };
  }

  const planItems = activeItems.map((item) => {
    const rulesFresh = item.snapshot?.fresh === true;
    const coverageReady = sourceCoverageReady(item);
    const blockers = [];

    if (!rulesFresh) {
      blockers.push("目标 SKC 的合规规则快照需要先同步");
    }
    if (!coverageReady) {
      blockers.push("目标 SKC 的合规来源覆盖不完整");
    }

    return {
      id: item.id,
      skc: text(item.skc),
      categoryId: text(item.categoryId),
      categoryMatch: true,
      rulesFresh,
      coverageReady,
      state: blockers.length ? "blocked" : "needs_skc_detail",
      blockers,
      nextStep: blockers.length
        ? "先处理阻断项"
        : "打开 SKC 详情，按当前商品级属性重新判断 1630/1631 后再保存",
    };
  });

  return {
    valid: true,
    blockers: [],
    items: planItems,
    summary: {
      requested: planItems.length,
      blocked: planItems.filter((item) => item.state === "blocked").length,
      needsSkcDetail: planItems.filter(
        (item) => item.state === "needs_skc_detail",
      ).length,
    },
  };
}
