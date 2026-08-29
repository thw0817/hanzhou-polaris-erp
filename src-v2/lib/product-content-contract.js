function text(value) {
  return String(value ?? "").trim();
}

function hasEmoji(value) {
  return /\p{Extended_Pictographic}/u.test(value);
}

function normalizedTitleLimit(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 2 && number <= 1000
    ? number
    : 1000;
}

export function resolveProductDetailPictureRule(fillInStandard = []) {
  const rules = Array.isArray(fillInStandard) ? fillInStandard : [];
  const rule = rules.find(
    (item) => item?.field_key === "product_detail_picture",
  ) || rules.find(
    (item) => item?.field_key === "product_detail_pic",
  );
  return {
    returned: Boolean(rule),
    show: rule?.show === true,
    required: rule?.show === true && rule?.required === true,
    fieldKey: String(rule?.field_key || ""),
  };
}

export function buildProductContentStage({
  title = "",
  description = "",
  defaultLanguage = "",
  titleMaxLength = null,
} = {}) {
  const normalizedTitle = text(title);
  const normalizedDescription = text(description);
  const language = text(defaultLanguage);
  const maxTitleLength = normalizedTitleLimit(titleMaxLength);
  const blockers = [];

  if (normalizedTitle.length < 2) {
    blockers.push({
      code: "PRODUCT_TITLE_REQUIRED",
      message: "商品标题至少需2个字符",
    });
  } else if (normalizedTitle.length > maxTitleLength) {
    blockers.push({
      code: "PRODUCT_TITLE_TOO_LONG",
      message: `当前默认语种的商品标题不能超过${maxTitleLength}个字符`,
    });
  }
  if (hasEmoji(normalizedTitle)) {
    blockers.push({
      code: "PRODUCT_TITLE_EMOJI_NOT_ALLOWED",
      message: "SHEIN商品标题不支持emoji",
    });
  }
  if (!language) {
    blockers.push({
      code: "DEFAULT_LANGUAGE_MISSING",
      message: "发布规范未返回默认语种，无法生成商品标题和描述",
    });
  }
  if (normalizedDescription.length > 5000) {
    blockers.push({
      code: "PRODUCT_DESCRIPTION_TOO_LONG",
      message: "商品描述不能超过5000个字符",
    });
  }
  if (hasEmoji(normalizedDescription)) {
    blockers.push({
      code: "PRODUCT_DESCRIPTION_EMOJI_NOT_ALLOWED",
      message: "SHEIN商品描述不支持emoji",
    });
  }

  return {
    valid: blockers.length === 0,
    blockers,
    defaultLanguage: language,
    titleMaxLength: maxTitleLength,
    multiLanguageNameList: language && normalizedTitle
      ? [{ language, name: normalizedTitle }]
      : [],
    multiLanguageDescList: language && normalizedDescription
      ? [{ language, name: normalizedDescription }]
      : [],
  };
}
