import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductAttributeSnapshot,
  existingRugReportSources,
} from "./product-attribute-snapshot.js";

const schemaInfo = {
  data: [{
    product_type_id: 991,
    attribute_infos: [
      {
        attribute_id: 101,
        attribute_name: "长度",
        attribute_status: 3,
        attribute_type: 4,
        attribute_mode: 0,
        data_dimension: 1,
        attribute_value_info_list: [],
      },
      {
        attribute_id: 102,
        attribute_name: "材质",
        attribute_status: 2,
        attribute_type: 3,
        attribute_mode: 3,
        data_dimension: 1,
        attribute_value_info_list: [{
          attribute_value_id: 7,
          attribute_value: "超细纤维",
          is_show: 1,
        }],
      },
      {
        attribute_id: 201,
        attribute_name: "颜色",
        attribute_status: 3,
        attribute_type: 1,
        attribute_mode: 3,
        data_dimension: 1,
        attribute_value_info_list: [],
      },
      {
        attribute_id: 301,
        attribute_name: "SKU长度",
        attribute_status: 2,
        attribute_type: 4,
        attribute_mode: 0,
        data_dimension: 3,
        attribute_value_info_list: [],
      },
    ],
  }],
};

test("normalizes only official SKC product attributes from SPU details", () => {
  const snapshot = buildProductAttributeSnapshot({
    info: {
      spuName: "SPU-1",
      categoryId: 3155,
      productTypeId: 991,
      productAttributeInfoList: [
        {
          attributeId: 101,
          attributeValue: "180",
          attributeValueId: null,
        },
        {
          attributeId: 102,
          attributeValueId: 7,
          attributeValue: null,
        },
        {
          attributeId: 201,
          attributeValueId: 99,
          attributeValue: null,
        },
        {
          attributeId: 301,
          attributeValue: "181",
          attributeValueId: null,
        },
      ],
    },
    schemaInfo,
    rugReportSources: {
      longestEdge: [{ attributeId: "101", unit: "cm" }],
      area: [{ attributeId: "101", unit: "m2" }],
    },
    fetchedAt: "2026-08-07T08:00:00.000Z",
    sourceTraceId: "trace-1",
  });

  assert.deepEqual(snapshot.attributeValues, {
    "101": { valueIds: [], customValue: "180" },
    "102": { valueIds: ["7"], customValue: "" },
  });
  assert.equal(snapshot.attributeSchemaSnapshot.fields.length, 2);
  assert.deepEqual(snapshot.rugReportSources.longestEdge, [
    { attributeId: "101", unit: "cm" },
  ]);
  assert.equal(snapshot.source.endpoint, "/open-api/goods/spu-info");
  assert.equal(snapshot.source.traceId, "trace-1");
});

test("stores verified SHEIN threshold sources when the existing SKC snapshot has none", () => {
  const values = [
    { attribute_value_id: 459, attribute_value: "否", is_show: 1 },
    { attribute_value_id: 763, attribute_value: "是", is_show: 1 },
  ];
  const snapshot = buildProductAttributeSnapshot({
    info: {
      spuName: "SPU-1",
      categoryId: 3155,
      productTypeId: 991,
      productAttributeInfoList: [
        { attributeId: 1001889, attributeValueId: 459 },
        { attributeId: 1001890, attributeValueId: 459 },
      ],
    },
    schemaInfo: {
      data: [{
        product_type_id: 991,
        attribute_infos: [
          {
            attribute_id: 1001889,
            attribute_name: "是否面积大于2.16m²",
            attribute_status: 3,
            attribute_type: 4,
            attribute_mode: 3,
            data_dimension: 1,
            attribute_value_info_list: values,
          },
          {
            attribute_id: 1001890,
            attribute_name: "是否最长边大于1.8m",
            attribute_status: 3,
            attribute_type: 4,
            attribute_mode: 3,
            data_dimension: 1,
            attribute_value_info_list: values,
          },
        ],
      }],
    },
    fetchedAt: "2026-08-21T08:00:00.000Z",
  });

  assert.deepEqual(snapshot.rugReportSources, {
    thresholds: {
      longestEdge: {
        attributeId: "1001890",
        exceededValueId: "763",
        withinValueId: "459",
      },
      area: {
        attributeId: "1001889",
        exceededValueId: "763",
        withinValueId: "459",
      },
    },
  });
});

test("preserves existing source mappings without inventing them", () => {
  assert.deepEqual(
    existingRugReportSources({
      rugReportSources: { dimensions: [{ attributeId: "101", unit: "cm" }] },
    }),
    { dimensions: [{ attributeId: "101", unit: "cm" }] },
  );
  assert.deepEqual(
    existingRugReportSources({
      attributeSnapshot: {
        rugReportSources: { area: [{ attributeId: "101", unit: "m2" }] },
      },
      rugReportSources: { longestEdge: [{ attributeId: "101", unit: "cm" }] },
    }),
    { area: [{ attributeId: "101", unit: "m2" }] },
  );
});
