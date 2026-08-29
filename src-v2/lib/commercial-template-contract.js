import {
  applyGramsPerSquareMeter,
  applyPricePerSquareMeter,
} from "./product-sku-contract.js";

function text(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function commercialTemplatePaths(storeId, templateId = "") {
  const store = encodeURIComponent(String(storeId));
  const templates = `/v1/web/stores/${store}/publish-templates`;
  return {
    templates: `${templates}?type=commercial`,
    template: templateId
      ? `${templates}/${encodeURIComponent(String(templateId))}`
      : templates,
  };
}

export function validateCommercialTemplateDraft(input = {}) {
  const name = text(input.name, 80);
  const pricePerSquareMeter = positive(input.pricePerSquareMeter);
  const gramsPerSquareMeter = positive(input.gramsPerSquareMeter);
  const errors = {};
  if (!name) errors.name = "请填写模板名称";
  if (pricePerSquareMeter === null || pricePerSquareMeter > 100000) {
    errors.pricePerSquareMeter = pricePerSquareMeter !== null
      ? "每平方米供货单价不能超过100000"
      : "每平方米供货单价必须大于0";
  }
  if (gramsPerSquareMeter === null || gramsPerSquareMeter > 100000) {
    errors.gramsPerSquareMeter = gramsPerSquareMeter !== null
      ? "每平方米克重不能超过100000"
      : "每平方米克重必须大于0";
  }
  return {
    valid: !Object.keys(errors).length,
    errors,
    data: {
      name,
      template: {
        pricePerSquareMeter,
        gramsPerSquareMeter,
      },
    },
  };
}

export function applyCommercialTemplate(rows = [], template = {}) {
  return applyGramsPerSquareMeter(
    applyPricePerSquareMeter(rows, template.pricePerSquareMeter),
    template.gramsPerSquareMeter,
  );
}
