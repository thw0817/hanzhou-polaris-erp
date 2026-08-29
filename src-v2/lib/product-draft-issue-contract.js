const SECTION_DEFINITIONS = Object.freeze([
  Object.freeze({ key: "basic", label: "基础资料", anchor: "draft-product-basic" }),
  Object.freeze({ key: "images", label: "图片", anchor: "draft-product-images" }),
  Object.freeze({ key: "sku", label: "SKU与包装", anchor: "draft-product-skus" }),
  Object.freeze({ key: "compliance", label: "合规", anchor: "draft-product-compliance" }),
]);

const SOURCE_TO_SECTION = Object.freeze({
  attributes: "basic",
  content: "basic",
  category: "basic",
  images: "images",
  sku: "sku",
  compliance: "compliance",
});

const FALLBACK_STAGE_SOURCES = Object.freeze([
  "attributes",
  "content",
  "images",
  "sku",
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sectionForSource(source) {
  return SOURCE_TO_SECTION[String(source || "")] || "basic";
}

export function productDraftSectionAnchor(section) {
  return SECTION_DEFINITIONS.find((item) => item.key === section)?.anchor || SECTION_DEFINITIONS[0].anchor;
}

function normalizeBlocker(blocker, source) {
  const value = object(blocker);
  const normalizedSource = String(value.source || source || "unknown").trim() || "unknown";
  const code = String(value.code || "PREFLIGHT_BLOCKED").trim() || "PREFLIGHT_BLOCKED";
  const message = typeof blocker === "string"
    ? blocker.trim()
    : String(value.message || "服务端预检未通过").trim();
  const section = sectionForSource(normalizedSource);
  return {
    source: normalizedSource,
    code,
    message: message || "服务端预检未通过",
    section,
    anchor: productDraftSectionAnchor(section),
  };
}

function fallbackBlockers(preflight) {
  const known = new Set(FALLBACK_STAGE_SOURCES);
  const sources = [
    ...FALLBACK_STAGE_SOURCES,
    ...Object.keys(preflight).filter((key) => !known.has(key) && !["publishCandidate", "compliance"].includes(key)),
  ];
  return sources.flatMap((source) => {
    const stage = object(preflight[source]);
    return Array.isArray(stage.blockers)
      ? stage.blockers.map((blocker) => normalizeBlocker(blocker, source))
      : [];
  });
}

export function collectProductDraftIssues(draft) {
  const preflight = object(draft?.preflight);
  const candidate = object(preflight.publishCandidate);
  const issues = Array.isArray(candidate.blockers)
    ? candidate.blockers
      .filter((blocker) => !["rugReport", "compliance"].includes(String(blocker?.source || "")))
      .map((blocker) => normalizeBlocker(blocker, "unknown"))
    : fallbackBlockers(preflight);
  const deduplicated = [];
  const seen = new Set();
  for (const issue of issues) {
    const key = `${issue.section}\u0000${issue.code}\u0000${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduplicated.push(issue);
  }
  const groups = SECTION_DEFINITIONS.map((definition) => {
    const groupIssues = deduplicated.filter((issue) => issue.section === definition.key);
    return { ...definition, count: groupIssues.length, issues: groupIssues };
  });
  return {
    total: deduplicated.length,
    issues: deduplicated,
    groups,
    firstIssue: groups.find((group) => group.count)?.issues[0] || null,
  };
}

const STATUS_PRIORITY = Object.freeze({
  blocked: 0,
  draft: 1,
  ready: 2,
  published: 3,
  archived: 4,
});

export function sortProductDraftsByActionPriority(drafts) {
  return [...(Array.isArray(drafts) ? drafts : [])].sort((left, right) => {
    const leftIssues = collectProductDraftIssues(left).total;
    const rightIssues = collectProductDraftIssues(right).total;
    const leftRank = leftIssues || left?.status === "blocked"
      ? 0
      : STATUS_PRIORITY[left?.status] ?? 5;
    const rightRank = rightIssues || right?.status === "blocked"
      ? 0
      : STATUS_PRIORITY[right?.status] ?? 5;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return Date.parse(String(right?.updatedAt || "")) - Date.parse(String(left?.updatedAt || ""));
  });
}
