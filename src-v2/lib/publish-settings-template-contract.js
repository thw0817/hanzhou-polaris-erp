import { buildProductPublishSettingsStage } from "./product-publish-settings-contract.js";

function text(value, maxLength = 200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function enumValue(value, allowed) {
  const normalized = text(value, 10);
  return allowed.includes(normalized) ? normalized : "";
}

export function publishSettingsTemplatePaths(storeId, templateId = "") {
  const store = encodeURIComponent(String(storeId));
  const templates = `/v1/web/stores/${store}/publish-templates`;
  return {
    templates: `${templates}?type=publish_settings`,
    template: templateId
      ? `${templates}/${encodeURIComponent(String(templateId))}`
      : templates,
  };
}

export function validatePublishSettingsTemplateDraft(input = {}) {
  const name = text(input.name, 80);
  const template = {
    mallState: enumValue(input.mallState, ["1", "2"]),
    stopPurchase: enumValue(input.stopPurchase, ["1", "2"]),
    shelfRequire: enumValue(input.shelfRequire, ["0", "1"]),
    shelfWay: enumValue(input.shelfWay, ["1", "2"]),
  };
  const errors = {};
  if (!name) errors.name = "请填写模板名称";
  if (!template.mallState) errors.mallState = "请选择SKU商城销售状态";
  if (!template.stopPurchase) errors.stopPurchase = "请选择SKU采购状态";
  if (!template.shelfRequire) errors.shelfRequire = "请选择到仓上架要求";
  if (template.shelfWay !== "1") {
    errors.shelfWay = "发布设置模板只支持自动上架；定时日期请在单个商品中填写";
  }
  return {
    valid: !Object.keys(errors).length,
    errors,
    data: { name, template },
  };
}

export function applyPublishSettingsTemplate({
  template = {},
  businessMode = "",
  fillInStandard = [],
} = {}) {
  const settings = {
    mallState: text(template.mallState, 10),
    stopPurchase: text(template.stopPurchase, 10),
    shelfRequire: text(template.shelfRequire, 10),
    shelfWay: text(template.shelfWay, 10),
    hopeOnSaleDate: "",
  };
  if (settings.shelfWay !== "1") {
    return {
      valid: false,
      blockers: [{
        code: "PUBLISH_SETTINGS_TEMPLATE_SCHEDULED_UNSUPPORTED",
        field: "shelfWay",
        message: "发布设置模板不能复用定时上架日期，请改为自动上架",
      }],
      settings,
    };
  }
  const stage = buildProductPublishSettingsStage({
    businessMode,
    settings,
    fillInStandard,
  });
  return { valid: stage.valid, blockers: stage.blockers, settings };
}
