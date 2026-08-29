import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssociatedAttributeRuleRequest,
  buildProductAttributePreflight,
  buildProductPublishCandidate,
  verifyProductPublishCandidate,
} from "./product-publish-candidate.js";

const attributeData = {
  attributeSchemaSnapshot: {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    categoryId: "3155",
    productTypeId: "991",
    fields: [
      {
        id: "material",
        name: "主要材质",
        required: true,
        typeCode: 4,
        dataDimension: 1,
        modeCode: 3,
        maxSelections: 1,
        values: [
          { id: "polyester", label: "聚酯纤维" },
          { id: "cotton", label: "棉" },
        ],
        ruleInfoList: [],
      },
      {
        id: "series",
        name: "系列",
        required: true,
        typeCode: 4,
        dataDimension: 2,
        modeCode: 0,
        maxSelections: 0,
        values: [],
        ruleInfoList: [],
      },
      {
        id: "features",
        name: "特征",
        required: false,
        typeCode: 4,
        dataDimension: 1,
        modeCode: 1,
        maxSelections: 2,
        values: [
          { id: "washable", label: "易清洗" },
          { id: "nonslip", label: "防滑" },
        ],
        ruleInfoList: [],
      },
    ],
  },
  attributeValues: {
    material: { valueIds: ["polyester"], customValue: "" },
    series: { valueIds: [], customValue: "HZ-RUG-01" },
    features: {
      valueIds: ["washable", "nonslip", "washable"],
      customValue: "",
    },
  },
};

test("builds the official associated-rule request only from known product attributes", () => {
  assert.deepEqual(
    buildAssociatedAttributeRuleRequest({
      ...attributeData,
      attributeValues: {
        ...attributeData.attributeValues,
        forged: { valueIds: ["forged-value"], customValue: "" },
      },
    }),
    [
      { attributeId: "material", attributeValueId: "polyester" },
      { attributeId: "series" },
      { attributeId: "features", attributeValueId: "washable" },
      { attributeId: "features", attributeValueId: "nonslip" },
    ],
  );
});

test("rebuilds product_attribute_list from the saved SHEIN schema and server linked rules", () => {
  const result = buildProductAttributePreflight({
    data: attributeData,
    categoryId: "3155",
    productTypeId: "991",
    associatedRuleResult: {
      checkedAt: "2026-08-05T01:00:00.000Z",
      traceId: "trace-linked-1",
      rules: [{
        attribute_id: "features",
        attribute_value_list: ["nonslip"],
        attribute_value_pre_fill_list: [],
      }],
    },
  });

  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.publishPreview.product_attribute_list, [
    { attribute_id: "material", attribute_value_id: "polyester" },
    { attribute_id: "series", attribute_extra_value: "HZ-RUG-01" },
    { attribute_id: "features", attribute_value_id: "washable" },
    { attribute_id: "features", attribute_value_id: "nonslip" },
  ]);
  assert.equal(result.associatedRulesCheckedAt, "2026-08-05T01:00:00.000Z");
  assert.equal(result.associatedRulesTraceId, "trace-linked-1");
});

test("fails closed for forged fields, invalid values, modes and linked-rule targets", () => {
  const result = buildProductAttributePreflight({
    data: {
      ...attributeData,
      attributeValues: {
        material: { valueIds: ["forged-value"], customValue: "forged-extra" },
        series: { valueIds: [], customValue: "" },
        features: {
          valueIds: ["washable", "nonslip", "third"],
          customValue: "",
        },
        forged: { valueIds: ["value"], customValue: "" },
      },
    },
    categoryId: "3155",
    productTypeId: "991",
    associatedRuleResult: {
      checkedAt: "2026-08-05T01:00:00.000Z",
      rules: [{
        attribute_id: "size-attribute",
        attribute_value_list: [],
        attribute_value_pre_fill_list: [],
      }],
    },
  });

  assert.deepEqual(
    result.blockers.map((item) => item.code),
    [
      "ATTRIBUTE_ID_INVALID",
      "ATTRIBUTE_VALUE_INVALID",
      "ATTRIBUTE_EXTRA_VALUE_NOT_ALLOWED",
      "REQUIRED_ATTRIBUTE_MISSING",
      "ATTRIBUTE_VALUE_INVALID",
      "TOO_MANY_ATTRIBUTE_VALUES",
      "ASSOCIATED_ATTRIBUTE_UNSUPPORTED",
    ],
  );
  assert.equal(
    JSON.stringify(result.publishPreview).includes("forged-value"),
    false,
  );
});

test("routes linked type-2 dimensions through size_attribute_list instead of product blockers", () => {
  const result = buildProductAttributePreflight({
    data: {
      ...attributeData,
      salesSchemaSnapshot: {
        sizeFields: [{ id: "55", name: "长度" }, { id: "118", name: "宽度" }],
      },
    },
    categoryId: "3155",
    productTypeId: "991",
    associatedRuleResult: {
      checkedAt: "2026-08-05T01:00:00.000Z",
      rules: [
        { attribute_id: "55", attribute_value_list: [] },
        { attribute_id: "118", attribute_value_list: [] },
      ],
    },
  });

  assert.deepEqual(result.blockers, []);
});

test("requires category-bound schema metadata and a server linked-rule result", () => {
  const result = buildProductAttributePreflight({
    data: {
      attributeSchemaSnapshot: {
        fetchedAt: "2026-08-05T00:00:00.000Z",
        categoryId: "other-category",
        productTypeId: "991",
        fields: [{
          id: "material",
          name: "主要材质",
          typeCode: 4,
          dataDimension: 1,
          values: [],
        }],
      },
      attributeValues: {},
    },
    categoryId: "3155",
    productTypeId: "991",
    associatedRuleError: "SHEIN关联属性规则读取失败",
  });

  assert.deepEqual(
    result.blockers.map((item) => item.code),
    [
      "ATTRIBUTE_SCHEMA_CATEGORY_MISMATCH",
      "ATTRIBUTE_SCHEMA_METADATA_MISSING",
      "ASSOCIATED_RULES_UNAVAILABLE",
    ],
  );
});

test("treats a zero-decimal custom rule as an integer without throwing", () => {
  const result = buildProductAttributePreflight({
    data: {
      attributeSchemaSnapshot: {
        fetchedAt: "2026-08-05T00:00:00.000Z",
        categoryId: "3155",
        productTypeId: "991",
        fields: [{
          id: "count",
          name: "数量",
          required: true,
          typeCode: 4,
          dataDimension: 1,
          modeCode: 0,
          maxSelections: 0,
          values: [],
          ruleInfoList: [{
            id: "rule-1",
            conditionType: 3,
            conditionOperator: 0,
            value: "0",
          }],
        }],
      },
      attributeValues: {
        count: { valueIds: [], customValue: "12" },
      },
    },
    categoryId: "3155",
    productTypeId: "991",
    associatedRuleResult: {
      checkedAt: "2026-08-05T01:00:00.000Z",
      rules: [],
    },
  });

  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.publishPreview.product_attribute_list, [{
    attribute_id: "count",
    attribute_extra_value: "12",
  }]);
});

const readyPreflight = {
  attributes: {
    blockers: [],
    checkedAt: "2026-08-05T00:00:00.000Z",
    associatedRulesCheckedAt: "2026-08-05T01:00:00.000Z",
    publishPreview: {
      product_attribute_list: [
        { attribute_id: "material", attribute_value_id: "polyester" },
      ],
    },
  },
  content: {
    blockers: [],
    checkedAt: "2026-08-05T00:00:00.000Z",
    publishPreview: {
      multi_language_name_list: [{ language: "zh-cn", name: "现代装饰地毯" }],
      multi_language_desc_list: [{ language: "zh-cn", name: "短绒防滑地毯" }],
    },
  },
  images: {
    blockers: [],
    checkedAt: "2026-08-05T00:00:00.000Z",
    scheme: "legacy-skc",
    uploads: [{
      localId: "asset-main",
      targetLevel: "skc",
      imageType: 1,
      imageSort: 1,
    }],
  },
  sku: {
    blockers: [],
    checkedAt: "2026-08-05T00:00:00.000Z",
    publishPreview: {
      skc: {
        supplier_code: "RUG-001",
        sale_attribute: {
          attribute_id: "color",
          attribute_value_id: "multicolor",
        },
        sku_list: [{
          supplier_sku: "RUG-001-40X60",
          sale_attribute_list: [{
            attribute_id: "size",
            attribute_value_id: "40x60",
          }],
        }],
      },
      pendingImageUploads: [{
        rowId: "row-1",
        assetId: "asset-sku",
        supplierSku: "RUG-001-40X60",
        targetLevel: "sku",
        imageType: 1,
        imageSort: 1,
      }],
    },
  },
  publishSettings: {
    blockers: [],
    checkedAt: "2026-08-05T00:00:00.000Z",
    payload: {
      root: { shelf_require: "1" },
      skc: { shelf_way: "1" },
      sku: { mall_state: 1, stop_purchase: 1 },
    },
  },
  rugReport: { blockers: [], reportType: "1630" },
  compliance: {
    blockers: [],
    checkedAt: "2026-08-05T00:00:00.000Z",
    expectedReport: "1630",
    requiresSkcRevalidation: true,
  },
};

test("builds a deterministic non-executable publish candidate from trusted preflight sections", () => {
  const input = {
    data: {
      supplierCode: "RUG-001",
      contentPreview: { forged: true },
      publishSettings: { forged: true },
    },
    categoryId: "3155",
    productTypeId: "991",
    preflight: readyPreflight,
    generatedAt: "2026-08-05T02:00:00.000Z",
  };
  const first = buildProductPublishCandidate(input);
  const second = buildProductPublishCandidate({
    ...input,
    generatedAt: "2026-08-05T03:00:00.000Z",
  });

  assert.equal(first.state, "ready_for_remote_preflight");
  assert.equal(first.publishingEnabled, false);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.endpoint, "/open-api/goods/product/publishOrEdit");
  assert.deepEqual(first.requestBody, {
    category_id: "3155",
    product_type_id: "991",
    source_system: "OpenAPI",
    suit_flag: 0,
    is_spu_pic: false,
    supplier_code: "RUG-001",
    shelf_require: "1",
    multi_language_name_list: [
      { language: "zh-cn", name: "现代装饰地毯" },
    ],
    multi_language_desc_list: [
      { language: "zh-cn", name: "短绒防滑地毯" },
    ],
    product_attribute_list: [
      { attribute_id: "material", attribute_value_id: "polyester" },
    ],
    skc_list: [{
      supplier_code: "RUG-001",
      sale_attribute: {
        attribute_id: "color",
        attribute_value_id: "multicolor",
      },
      sku_list: [{
        supplier_sku: "RUG-001-40X60",
        sale_attribute_list: [{
          attribute_id: "size",
          attribute_value_id: "40x60",
        }],
      }],
      shelf_way: "1",
    }],
  });
  assert.equal(first.pendingImageUploads.length, 2);
  assert.equal(first.requiresSkcComplianceReadback, true);
  assert.equal(first.remoteChecks.includes("check-publish-permission"), true);
  assert.equal(verifyProductPublishCandidate(first), true);
  assert.equal(
    verifyProductPublishCandidate({
      ...first,
      requestBody: { ...first.requestBody, category_id: "forged" },
    }),
    false,
  );
});

test("writes the V2 size preview to the official root size_attribute_list", () => {
  const candidate = buildProductPublishCandidate({
    data: { supplierCode: "RUG-001" },
    categoryId: "3155",
    productTypeId: "991",
    preflight: {
      ...readyPreflight,
      sku: {
        ...readyPreflight.sku,
        publishPreview: {
          ...readyPreflight.sku.publishPreview,
          size_attribute_list: [{
            attribute_id: 118,
            attribute_extra_value: "40",
            relate_sale_attribute_id: 87,
            relate_sale_attribute_value_id: 201,
          }],
        },
      },
    },
  });

  assert.deepEqual(candidate.requestBody.size_attribute_list, [{
    attribute_id: 118,
    attribute_extra_value: "40",
    relate_sale_attribute_id: 87,
    relate_sale_attribute_value_id: 201,
  }]);
});

test("does not expose a request body when any trusted section is blocked", () => {
  const candidate = buildProductPublishCandidate({
    data: { supplierCode: "RUG-001" },
    categoryId: "3155",
    productTypeId: "991",
    preflight: {
      ...readyPreflight,
      attributes: {
        ...readyPreflight.attributes,
        blockers: [{
          code: "REQUIRED_ATTRIBUTE_MISSING",
          message: "必填属性未填写",
        }],
      },
    },
    generatedAt: "2026-08-05T02:00:00.000Z",
  });

  assert.equal(candidate.state, "blocked");
  assert.equal(candidate.requestBody, null);
  assert.equal(candidate.fingerprint, "");
  assert.deepEqual(candidate.blockers, [{
    source: "attributes",
    code: "REQUIRED_ATTRIBUTE_MISSING",
    message: "必填属性未填写",
  }]);
});

test("keeps unresolved 1630/1631 work as a post-publish task", () => {
  const candidate = buildProductPublishCandidate({
    data: { supplierCode: "RUG-001" },
    categoryId: "3155",
    productTypeId: "991",
    preflight: {
      ...readyPreflight,
      rugReport: {
        blockers: [{
          code: "ATTRIBUTE_VALUE_MISSING",
          message: "商品属性尚未完成1630/1631判定",
        }],
        reportType: null,
      },
      compliance: {
        ...readyPreflight.compliance,
        expectedReport: null,
        postPublishTasks: [{
          code: "RUG_REPORT_NOT_CLASSIFIED",
          message: "SKC生成后处理1630/1631",
        }],
      },
    },
  });

  assert.equal(candidate.state, "ready_for_remote_preflight");
  assert.deepEqual(candidate.blockers, []);
  assert.equal(candidate.postPublishTasks.length, 1);
  assert.equal(candidate.requestBody.supplier_code, "RUG-001");
});
