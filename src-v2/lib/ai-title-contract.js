export const AI_TITLE_FEATURE = "ai_title";
export const AI_PATTERN_MAX_LENGTH = 24;
export const AI_TITLE_DEFAULT_MAX_LENGTH = 250;
export const AI_TITLE_MAX_LENGTH = 1000;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function aiTitlePaths(storeId) {
  const store = encodeURIComponent(String(storeId));
  const base = `/v1/web/stores/${store}/ai/title`;
  return {
    capability: `${base}/capability`,
    suggest: `${base}/suggest`,
  };
}

function text(value, maxLength = 500) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function configuredText(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function hasControlCharacters(value) {
  return CONTROL_CHARACTERS.test(String(value ?? ""));
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeRule(rule = {}) {
  return {
    prefix: text(rule.prefix, 300),
    keywords: text(rule.keywords, 500),
    suffix: text(rule.suffix, 300),
  };
}

export function normalizeAiPatternName(value) {
  return text(value, AI_PATTERN_MAX_LENGTH)
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[<>`$]/g, "")
    .trim();
}

export function composeAiTitle({ rule = {}, patternName = "", maxLength = 250 } = {}) {
  const normalizedRule = normalizeRule(rule);
  const pattern = normalizeAiPatternName(patternName);
  const limit = Number.isInteger(Number(maxLength)) && Number(maxLength) > 0
    ? Number(maxLength)
    : 250;
  const suffix = [normalizedRule.keywords, normalizedRule.suffix]
    .filter(Boolean)
    .join(" ");
  const parts = [normalizedRule.prefix, pattern, suffix].filter(Boolean);
  const title = parts.join(" ").replace(/\s+/g, " ").trim();
  return {
    title: title.slice(0, limit),
    patternName: pattern,
    truncated: title.length > limit,
    valid: Boolean(title) && title.length <= limit,
  };
}

/**
 * Validate tenant-configured provider settings without constraining which
 * OpenAI-compatible provider/model the administrator chooses.
 */
export function validateAiTitleProviderSettings({
  apiUrl = "",
  model = "",
  modelUrl = "",
  apiKey = "",
  requireApiKey = false,
} = {}) {
  const normalizedApiUrl = configuredText(apiUrl);
  const normalizedModel = configuredText(model, 200);
  const normalizedModelUrl = configuredText(modelUrl);
  const normalizedApiKey = configuredText(apiKey);

  if (!normalizedApiUrl) {
    return { valid: false, code: "AI_TITLE_INVALID_API_URL", error: "请填写 AI API 地址" };
  }
  if (hasControlCharacters(normalizedApiUrl)) {
    return { valid: false, code: "AI_TITLE_INVALID_API_URL", error: "API 地址包含非法控制字符" };
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedApiUrl);
  } catch {
    return { valid: false, code: "AI_TITLE_INVALID_API_URL", error: "API 地址必须是有效的 HTTPS 地址" };
  }
  if (
    parsedUrl.protocol !== "https:" ||
    !parsedUrl.hostname ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.hash
  ) {
    return { valid: false, code: "AI_TITLE_INVALID_API_URL", error: "API 地址必须使用 HTTPS 且不能包含账号信息" };
  }
  if (hasControlCharacters(normalizedModel) || hasControlCharacters(normalizedModelUrl)) {
    return { valid: false, code: "AI_TITLE_MODEL_INVALID", error: "模型名称或地址包含非法控制字符" };
  }
  if (!normalizedModel && !normalizedModelUrl) {
    return { valid: false, code: "AI_TITLE_MODEL_REQUIRED", error: "请填写模型名称或模型地址" };
  }
  if (hasControlCharacters(normalizedApiKey)) {
    return { valid: false, code: "AI_TITLE_API_KEY_INVALID", error: "API 密钥包含非法控制字符" };
  }
  if (requireApiKey && !normalizedApiKey) {
    return { valid: false, code: "AI_TITLE_API_KEY_REQUIRED", error: "首次保存必须填写 API 密钥" };
  }
  return {
    valid: true,
    settings: {
      apiUrl: normalizedApiUrl,
      model: normalizedModel,
      modelUrl: normalizedModelUrl,
      apiKey: normalizedApiKey,
    },
  };
}

export function buildAiTitleRequest({
  mainImageAssetId,
  titleRuleTemplateId,
  titleRule,
  currentTitle = "",
  titleMaxLength,
  locale = "zh-cn",
} = {}) {
  const assetId = text(mainImageAssetId, 100);
  if (!assetId) return { valid: false, code: "AI_TITLE_MAIN_IMAGE_REQUIRED", error: "商品主图不能为空" };
  const templateId = text(titleRuleTemplateId, 100);
  if (!templateId || !isPlainObject(titleRule)) {
    return { valid: false, code: "AI_TITLE_TEMPLATE_REQUIRED", error: "请先选择标题规则模板" };
  }
  const normalizedTitleRule = normalizeRule(titleRule);
  if (!normalizedTitleRule.prefix && !normalizedTitleRule.keywords && !normalizedTitleRule.suffix) {
    return { valid: false, code: "AI_TITLE_TEMPLATE_INVALID", error: "标题规则模板没有可用内容" };
  }
  let normalizedTitleMaxLength = AI_TITLE_DEFAULT_MAX_LENGTH;
  if (titleMaxLength !== undefined && titleMaxLength !== null && titleMaxLength !== "") {
    const parsedLength = Number(titleMaxLength);
    if (!Number.isInteger(parsedLength) || parsedLength < 2 || parsedLength > AI_TITLE_MAX_LENGTH) {
      return {
        valid: false,
        code: "AI_TITLE_LENGTH_INVALID",
        error: `标题字符上限必须是2-${AI_TITLE_MAX_LENGTH}之间的整数`,
      };
    }
    normalizedTitleMaxLength = parsedLength;
  }
  const normalizedLocale = configuredText(locale, 30).replace(/_/g, "-").toLowerCase() || "zh-cn";
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(normalizedLocale)) {
    return { valid: false, code: "AI_TITLE_LOCALE_INVALID", error: "AI标题语种格式不正确" };
  }
  return {
    valid: true,
    input: {
      mainImageAssetId: assetId,
      titleRuleTemplateId: templateId,
      titleRule: normalizedTitleRule,
      currentTitle: text(currentTitle, 1000),
      titleMaxLength: normalizedTitleMaxLength,
      locale: normalizedLocale,
    },
  };
}
