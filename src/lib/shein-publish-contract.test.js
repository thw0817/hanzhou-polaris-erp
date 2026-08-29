import test from "node:test";
import assert from "node:assert/strict";
import {
  SHEIN_PUBLISH_ENDPOINTS,
  createPublishPreflightPlan,
  getVisiblePublishFields,
  normalizeFillStandard,
  validateNewProductDraft,
} from "./shein-publish-contract.js";

test("publishing endpoint paths match the supplied SHEIN documentation", () => {
  assert.equal(
    SHEIN_PUBLISH_ENDPOINTS.publishOrEdit.path,
    "/open-api/goods/product/publishOrEdit",
  );
  assert.equal(
    SHEIN_PUBLISH_ENDPOINTS.publishStandard.path,
    "/open-api/goods/query-publish-fill-in-standard",
  );
  assert.equal(
    SHEIN_PUBLISH_ENDPOINTS.associatedAttributeRules.path,
    "/open-api/goods/get-associated-attribute-rules",
  );
});

test("fill standard response becomes a dynamic field rule map", () => {
  const normalized = normalizeFillStandard({
    default_language: "en",
    currency: "USD",
    fill_in_standard_list: [
      { field_key: "brand_code", module: "basic_info", required: true, show: true },
      {
        field_key: "reference_product_link",
        module: "reference_info",
        required: false,
        show: false,
      },
    ],
  });

  assert.equal(normalized.defaultLanguage, "en");
  assert.equal(normalized.standards.brand_code.required, true);
  assert.equal(normalized.standards.brand_code.payloadField, "brand_code");
  assert.equal(
    normalized.standards.reference_product_link.payloadField,
    "competing_product_link",
  );
});

test("dynamic hidden fields are excluded from the visible contract", () => {
  const groups = getVisiblePublishFields({
    fillStandard: normalizeFillStandard({
      fill_in_standard_list: [
        { field_key: "brand_code", required: false, show: false },
        { field_key: "ip_character", required: false, show: true },
      ],
    }),
  });
  const fieldKeys = groups.flatMap((group) => group.fields.map((field) => field.key));

  assert.equal(fieldKeys.includes("brand_code"), false);
  assert.equal(fieldKeys.includes("ip_character_list"), true);
});

test("full-managed new product validation enforces documented supply fields", () => {
  const errors = validateNewProductDraft(
    {
      categoryId: "20039919",
      productTypeId: "2147503231",
      title: "Modern rug",
      supplierCode: "RUG-BLUE",
      supplierSku: "RUG-BLUE-01",
      mainImageCount: 1,
      detailImageCount: 4,
      productAttributesReady: true,
      saleAttributesReady: true,
      length: "120",
      width: "20",
      height: "20",
      weight: "850",
      costPrice: "",
      currency: "",
      shelfWay: "",
      stopPurchase: "",
      shelfRequire: "",
    },
    { businessMode: "full" },
  );

  assert.deepEqual(
    errors.map((error) => error.key),
    ["costPrice", "currency", "shelfWay", "stopPurchase", "shelfRequire"],
  );
});

test("preflight plan keeps final publish behind permission and rule checks", () => {
  const plan = createPublishPreflightPlan({
    businessMode: "full",
    hasCategory: true,
    hasAttributes: true,
    hasImages: true,
  });

  assert.equal(plan[0].endpoint, "publishPermission");
  assert.equal(plan.at(-1).endpoint, "publishOrEdit");
  assert.ok(
    plan.findIndex((step) => step.endpoint === "supplierSkuRepeated") <
      plan.findIndex((step) => step.endpoint === "publishOrEdit"),
  );
  assert.equal(plan.some((step) => step.endpoint === "siteList"), false);
});

