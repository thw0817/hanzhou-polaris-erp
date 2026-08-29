import assert from "node:assert/strict";
import test from "node:test";
import { classifyRugReportFromProductAttributes } from "./rug-report-classification.js";

const fields = [
  {
    id: "length",
    name: "长度 (cm)",
    typeCode: 4,
    dataDimension: 1,
    values: [],
  },
  {
    id: "width",
    name: "宽度 (cm)",
    typeCode: 4,
    dataDimension: 1,
    values: [],
  },
  {
    id: "area",
    name: "面积 (㎡)",
    typeCode: 4,
    dataDimension: 1,
    values: [],
  },
];

const sources = {
  longestEdge: [
    { attributeId: "length", unit: "cm" },
    { attributeId: "width", unit: "cm" },
  ],
  area: [{ attributeId: "area", unit: "m2" }],
};

test("classifies threshold-equal product attributes as 1631", () => {
  const result = classifyRugReportFromProductAttributes({
    fields,
    assignments: {
      length: { valueIds: [], customValue: "180" },
      width: { valueIds: [], customValue: "120" },
      area: { valueIds: [], customValue: "2.16" },
    },
    sources,
  });

  assert.equal(result.reportType, "1631");
  assert.equal(result.longestEdgeCm, 180);
  assert.equal(result.areaM2, 2.16);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(
    result.evidence.map((item) => [item.attributeId, item.normalizedValue]),
    [["length", 180], ["width", 120], ["area", 2.16]],
  );
});

test("classifies either exceeded product-attribute threshold as 1630", () => {
  const longEdge = classifyRugReportFromProductAttributes({
    fields,
    assignments: {
      length: { valueIds: [], customValue: "1.81" },
      width: { valueIds: [], customValue: "1.2" },
      area: { valueIds: [], customValue: "2.1" },
    },
    sources: {
      longestEdge: [
        { attributeId: "length", unit: "m" },
        { attributeId: "width", unit: "m" },
      ],
      area: [{ attributeId: "area", unit: "m2" }],
    },
  });
  const largeArea = classifyRugReportFromProductAttributes({
    fields,
    assignments: {
      length: { valueIds: [], customValue: "1800" },
      width: { valueIds: [], customValue: "1200" },
      area: { valueIds: [], customValue: "21601" },
    },
    sources: {
      longestEdge: [
        { attributeId: "length", unit: "mm" },
        { attributeId: "width", unit: "mm" },
      ],
      area: [{ attributeId: "area", unit: "cm2" }],
    },
  });

  assert.equal(longEdge.reportType, "1630");
  assert.equal(largeArea.reportType, "1630");
});

test("computes longest edge and area from two SKC product attributes", () => {
  const result = classifyRugReportFromProductAttributes({
    fields,
    assignments: {
      length: { valueIds: [], customValue: "180" },
      width: { valueIds: [], customValue: "120" },
    },
    sources: {
      dimensions: [
        { attributeId: "length", unit: "cm" },
        { attributeId: "width", unit: "cm" },
      ],
    },
  });

  assert.equal(result.reportType, "1631");
  assert.equal(result.longestEdgeCm, 180);
  assert.equal(result.areaM2, 2.16);
  assert.deepEqual(result.blockers, []);
});

test("reads a single official option label when the attribute uses a preset value", () => {
  const result = classifyRugReportFromProductAttributes({
    fields: [
      {
        id: "longest",
        name: "最长边 (cm)",
        typeCode: 4,
        dataDimension: 1,
        values: [{ id: "180", label: "180" }],
      },
      fields[2],
    ],
    assignments: {
      longest: { valueIds: ["180"], customValue: "" },
      area: { valueIds: [], customValue: "2.16" },
    },
    sources: {
      longestEdge: [{ attributeId: "longest", unit: "cm" }],
      area: [{ attributeId: "area", unit: "m2" }],
    },
  });

  assert.equal(result.reportType, "1631");
  assert.equal(result.evidence[0].valueId, "180");
});

const thresholdFields = [
  {
    id: "1001889",
    name: "是否面积大于2.16m²",
    typeCode: 4,
    dataDimension: 1,
    values: [
      { id: "459", label: "否" },
      { id: "763", label: "是" },
    ],
  },
  {
    id: "1001890",
    name: "是否最长边大于1.8m",
    typeCode: 4,
    dataDimension: 1,
    values: [
      { id: "459", label: "否" },
      { id: "763", label: "是" },
    ],
  },
];

const thresholdSources = {
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
};

test("classifies the live SHEIN no/no threshold attributes as 1631", () => {
  const result = classifyRugReportFromProductAttributes({
    fields: thresholdFields,
    assignments: {
      1001889: { valueIds: ["459"], customValue: "" },
      1001890: { valueIds: ["459"], customValue: "" },
    },
    sources: thresholdSources,
  });

  assert.equal(result.reportType, "1631");
  assert.equal(result.longestEdgeCm, null);
  assert.equal(result.areaM2, null);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(
    result.evidence.map((item) => [item.attributeId, item.normalizedValue]),
    [["1001890", "否"], ["1001889", "否"]],
  );
});

test("derives the verified live SHEIN threshold sources when an older snapshot has none", () => {
  const result = classifyRugReportFromProductAttributes({
    fields: thresholdFields,
    assignments: {
      1001889: { valueIds: ["459"], customValue: "" },
      1001890: { valueIds: ["459"], customValue: "" },
    },
    sources: {},
  });

  assert.equal(result.reportType, "1631");
  assert.deepEqual(result.blockers, []);
});

test("classifies either live SHEIN exceeded threshold attribute as 1630", () => {
  for (const exceededAttributeId of ["1001889", "1001890"]) {
    const result = classifyRugReportFromProductAttributes({
      fields: thresholdFields,
      assignments: {
        1001889: {
          valueIds: [exceededAttributeId === "1001889" ? "763" : "459"],
          customValue: "",
        },
        1001890: {
          valueIds: [exceededAttributeId === "1001890" ? "763" : "459"],
          customValue: "",
        },
      },
      sources: thresholdSources,
    });

    assert.equal(result.reportType, "1630");
    assert.deepEqual(result.blockers, []);
  }
});

test("fails closed when a threshold assignment is not one of the configured yes/no values", () => {
  const result = classifyRugReportFromProductAttributes({
    fields: [{
      ...thresholdFields[0],
      values: [...thresholdFields[0].values, { id: "999", label: "待确认" }],
    }, thresholdFields[1]],
    assignments: {
      1001889: { valueIds: ["999"], customValue: "" },
      1001890: { valueIds: ["459"], customValue: "" },
    },
    sources: thresholdSources,
  });

  assert.equal(result.reportType, null);
  assert.deepEqual(
    result.blockers.map((item) => item.code),
    ["ATTRIBUTE_THRESHOLD_VALUE_UNKNOWN"],
  );
});

test("fails closed when a configured source is missing or not an SKC product attribute", () => {
  const result = classifyRugReportFromProductAttributes({
    fields: [
      ...fields,
      {
        id: "sku-length",
        name: "SKU 长度",
        typeCode: 4,
        dataDimension: 3,
        values: [],
      },
    ],
    assignments: {
      length: { valueIds: [], customValue: "180" },
      area: { valueIds: [], customValue: "2.16" },
      "sku-length": { valueIds: [], customValue: "181" },
    },
    sources: {
      longestEdge: [
        { attributeId: "missing", unit: "cm" },
        { attributeId: "sku-length", unit: "cm" },
      ],
      area: [{ attributeId: "area", unit: "m2" }],
    },
  });

  assert.equal(result.reportType, null);
  assert.deepEqual(
    result.blockers.map((item) => item.code),
    ["ATTRIBUTE_NOT_IN_SCHEMA", "ATTRIBUTE_NOT_SKC_PRODUCT"],
  );
});

test("fails closed for missing, conflicting, unparseable, or unknown-unit values", () => {
  const result = classifyRugReportFromProductAttributes({
    fields: [
      {
        id: "length",
        name: "长度",
        typeCode: 4,
        dataDimension: 1,
        values: [
          { id: "a", label: "120" },
          { id: "b", label: "180" },
        ],
      },
      fields[1],
      fields[2],
    ],
    assignments: {
      length: { valueIds: ["a", "b"], customValue: "" },
      width: { valueIds: [], customValue: "120 x 180" },
      area: { valueIds: [], customValue: "" },
    },
    sources: {
      longestEdge: [
        { attributeId: "length", unit: "cm" },
        { attributeId: "width", unit: "inch" },
      ],
      area: [{ attributeId: "area", unit: "m2" }],
    },
  });

  assert.equal(result.reportType, null);
  assert.deepEqual(
    result.blockers.map((item) => item.code),
    [
      "ATTRIBUTE_VALUE_CONFLICT",
      "ATTRIBUTE_UNIT_UNSUPPORTED",
      "ATTRIBUTE_VALUE_MISSING",
    ],
  );
});
