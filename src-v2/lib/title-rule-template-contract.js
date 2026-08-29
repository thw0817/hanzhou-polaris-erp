function text(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function titleRuleTemplatePaths(storeId, templateId = "") {
  const store = encodeURIComponent(String(storeId));
  const templates = `/v1/web/stores/${store}/publish-templates`;
  return {
    templates: `${templates}?type=title_rule`,
    template: templateId
      ? `${templates}/${encodeURIComponent(String(templateId))}`
      : templates,
  };
}

export function normalizeTitleRule(input = {}) {
  return {
    fullTitle: text(input.fullTitle, 1000),
    prefix: text(input.prefix, 300),
    keywords: text(input.keywords, 500),
    suffix: text(input.suffix, 300),
  };
}

export function applyTitleRule(currentTitle = "", input = {}) {
  const rule = normalizeTitleRule(input);
  if (rule.fullTitle) return rule.fullTitle;
  return [rule.prefix, text(currentTitle, 1000), rule.keywords, rule.suffix]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function removeFragment(source, fragment, mode = "any") {
  const value = text(fragment, 1000);
  if (!value) return source;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (mode === "prefix") {
    let result = source;
    const pattern = new RegExp("^" + escaped + "(?:\\s+|$)");
    while (pattern.test(result)) result = result.replace(pattern, "").trim();
    return result;
  }
  if (mode === "suffix") {
    let result = source;
    const pattern = new RegExp("(?:\\s+|^)" + escaped + "$");
    while (pattern.test(result)) result = result.replace(pattern, "").trim();
    return result;
  }
  return source
    .replace(new RegExp("(?:^|\\s)" + escaped + "(?=\\s|$)", "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Recover the title before a previously applied fragment rule. */
export function stripTitleRuleFragments(currentTitle = "", input = {}) {
  const rule = normalizeTitleRule(input);
  if (rule.fullTitle) return text(currentTitle, 1000);
  let result = text(currentTitle, 1000);
  result = removeFragment(result, rule.prefix, "prefix");
  result = removeFragment(result, rule.prefix);
  result = removeFragment(result, rule.suffix, "suffix");
  result = removeFragment(result, rule.suffix);
  result = removeFragment(result, rule.keywords);
  return result;
}

export function validateTitleRuleTemplateDraft(input = {}) {
  const name = text(input.name, 80);
  const template = normalizeTitleRule(input);
  const errors = {};
  if (!name) errors.name = "请填写模板名称";
  if (!Object.values(template).some(Boolean)) {
    errors.rule = "请至少填写一项标题规则";
  }
  return {
    valid: !errors.name && !errors.rule,
    errors,
    data: { name, template },
  };
}
