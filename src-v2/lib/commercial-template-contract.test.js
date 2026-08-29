import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCommercialTemplate,
  commercialTemplatePaths,
  validateCommercialTemplateDraft,
} from "./commercial-template-contract.js";

test("commercial template paths reuse the publish template service", () => {
  assert.deepEqual(commercialTemplatePaths("store/1", "template/1"), {
    templates: "/v1/web/stores/store%2F1/publish-templates?type=commercial",
    template: "/v1/web/stores/store%2F1/publish-templates/template%2F1",
  });
});

test("commercial drafts keep only supply unit price and grams per square meter", () => {
  const result = validateCommercialTemplateDraft({
    name: "短绒地毯计价",
    pricePerSquareMeter: "25.5",
    gramsPerSquareMeter: "850",
    retailPrice: "99",
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    name: "短绒地毯计价",
    template: {
      pricePerSquareMeter: 25.5,
      gramsPerSquareMeter: 850,
    },
  });
});

test("commercial drafts reject missing or non-positive values", () => {
  const result = validateCommercialTemplateDraft({
    name: "",
    pricePerSquareMeter: "0",
    gramsPerSquareMeter: "bad",
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.name, "请填写模板名称");
  assert.equal(result.errors.pricePerSquareMeter, "每平方米供货单价必须大于0");
  assert.equal(result.errors.gramsPerSquareMeter, "每平方米克重必须大于0");
});

test("commercial template converts each SKU area into supply total and weight", () => {
  const rows = applyCommercialTemplate([
    { id: "a", lengthCm: 40, widthCm: 60 },
    { id: "b", lengthCm: 100, widthCm: 200 },
  ], {
    pricePerSquareMeter: 25,
    gramsPerSquareMeter: 800,
  });
  assert.deepEqual(rows, [
    {
      id: "a",
      lengthCm: 40,
      widthCm: 60,
      costPrice: "6.00",
      weightGrams: 192,
      weightSource: "area_estimate",
    },
    {
      id: "b",
      lengthCm: 100,
      widthCm: 200,
      costPrice: "50.00",
      weightGrams: 1600,
      weightSource: "area_estimate",
    },
  ]);
});
