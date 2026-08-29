import test from "node:test";
import assert from "node:assert/strict";
import {
  SHEIN_COMPLIANCE_BATCH_SIZE,
  SHEIN_COMPLIANCE_PATHS,
  normalizeComplianceRows,
  summarizeComplianceRow,
  syncStoreComplianceData,
} from "./shein-compliance.js";

test("normalizes SHEIN compliance and photo statuses without mixing enums", () => {
  const [row] = normalizeComplianceRows({
    skcNames: ["skc-1"],
    products: [{ skc: "skc-1", spu: "spu-1", name: "地毯", image: "rug.jpg" }],
    requirementRows: [
      {
        skcName: "skc-1",
        items: [
          {
            complianceGroupCode: "ZSZZL",
            certificateTypeName: "测试报告",
            isRequired: 1,
            reviewState: 0,
          },
          {
            complianceGroupCode: "GSL",
            isRequired: 1,
            reviewState: 2,
          },
          {
            complianceGroupCode: "HGXXL",
            isManualProductWarning: true,
            isRequired: 1,
            reviewState: 3,
          },
          {
            complianceGroupCode: "SPSMS",
            isRequired: 1,
            reviewState: 0,
          },
        ],
      },
    ],
    photoRows: [
      {
        skc: "skc-1",
        skcShelfStatus: 1,
        skcLabelInfoList: [
          { labelId: 10, labelGroup: "1", isRequired: 1, reviewStatus: 2 },
          { labelId: 11, labelGroup: "2", isRequired: 1, reviewStatus: 1 },
        ],
      },
    ],
  });

  assert.equal(row.name, "地毯");
  assert.equal(row.certificate, "待补充");
  assert.equal(row.agency, "通过");
  assert.equal(row.warning, "失败");
  assert.equal(row.bodyPhoto, "通过");
  assert.equal(row.packagePhoto, "通过");
  assert.equal(row.state, "需修正");
  assert.equal(row.unsupportedRequirements.length, 1);
  assert.deepEqual(row.sourceCoverage, {
    requirementsReturned: true,
    photoRequirementsReturned: true,
  });
  assert.equal("requirements" in row, false);
  assert.equal("photoRequirements" in row, false);
});

test("optional body-photo history cannot make the SKC require a body photo", () => {
  const [row] = normalizeComplianceRows({
    skcNames: ["skc-optional-body-photo"],
    requirementRows: [{ skcName: "skc-optional-body-photo", items: [] }],
    photoRows: [{
      skc: "skc-optional-body-photo",
      skcLabelInfoList: [
        { labelId: 254, labelGroup: "1", isRequired: 0, reviewStatus: 3, failReason: ["标签当前位于包装"] },
        { labelId: 3, labelGroup: "1", isRequired: 0, reviewStatus: 0 },
        { labelId: 16, labelGroup: "2", isRequired: 1, reviewStatus: 2 },
      ],
    }],
  });

  assert.equal(row.bodyPhoto, "无需");
  assert.equal(row.packagePhoto, "通过");
  assert.equal(row.state, "通过");
  assert.equal(row.bodyPhotoRequirements.length, 2);
  assert.equal("failReason" in row.bodyPhotoRequirements[0], false);
});

test("keeps photo failure reasons only for a currently required rejection", () => {
  const [row] = normalizeComplianceRows({
    skcNames: ["skc-photo-reasons"],
    requirementRows: [{ skcName: "skc-photo-reasons", items: [] }],
    photoRows: [{
      skc: "skc-photo-reasons",
      skcLabelInfoList: [
        { labelId: 1, labelGroup: "2", isRequired: 1, reviewStatus: 1, failReason: ["旧失败原因"] },
        { labelId: 2, labelGroup: "2", isRequired: 1, reviewStatus: 3, failReasonList: ["当前失败原因"] },
      ],
    }],
  });

  assert.equal("failReason" in row.packagePhotoRequirements[0], false);
  assert.deepEqual(row.packagePhotoRequirements[1].failReasonList, ["当前失败原因"]);
});

test("queries compliance in conservative batches using documented field names", async () => {
  const skcNames = Array.from(
    { length: SHEIN_COMPLIANCE_BATCH_SIZE + 1 },
    (_, index) => `skc-${index}`,
  );
  const calls = [];
  const batches = [];
  const result = await syncStoreComplianceData({
    skcNames,
    onBatch: async (batch) => batches.push(batch),
    request: async (options) => {
      calls.push(options);
      if (options.path === SHEIN_COMPLIANCE_PATHS.requirements) {
        return {
          payload: {
            info: {
              data: options.body.skcNames.map((skcName) => ({
                skcName,
                items: [],
              })),
            },
          },
          diagnostics: { traceId: `requirements-${calls.length}` },
        };
      }
      return {
        payload: {
          info: options.body.skcList.map((skc) => ({
            skc,
            skcLabelInfoList: [],
          })),
        },
        diagnostics: { traceId: `photos-${calls.length}` },
      };
    },
  });

  assert.equal(result.count, 21);
  assert.equal(result.diagnostics.batchCount, 2);
  assert.equal(calls.length, 4);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].rows.length, 20);
  assert.equal(batches[1].rows.length, 1);
  assert.equal(batches[1].batchNumber, 2);
  assert.deepEqual(calls[0].body, {
    pageNum: 1,
    pageSize: 20,
    skcNames: skcNames.slice(0, 20),
  });
  assert.deepEqual(calls[1].body, {
    pageNum: 1,
    pageSize: 20,
    skcList: skcNames.slice(0, 20),
  });
  assert.equal(result.rows[20].state, "通过");
});

test("builds a lightweight compliance list row without dropping status fields", () => {
  const row = summarizeComplianceRow({
    skc: "skc-1",
    name: "地毯",
    state: "需修正",
    certificate: "失败",
    agency: "通过",
    warning: "无需",
    platformOnly: "审核中",
    packagePhoto: "待补充",
    bodyPhoto: "通过",
    requirements: [{ certificateTypeId: 1 }],
    packagePhotoRequirements: [{ labelId: 2 }],
  });

  assert.deepEqual(
    {
      skc: row.skc,
      name: row.name,
      state: row.state,
      certificate: row.certificate,
      platformOnly: row.platformOnly,
      packagePhoto: row.packagePhoto,
    },
    {
      skc: "skc-1",
      name: "地毯",
      state: "需修正",
      certificate: "失败",
      platformOnly: "审核中",
      packagePhoto: "待补充",
    },
  );
  assert.equal("requirements" in row, false);
  assert.equal("packagePhotoRequirements" in row, false);
});

test("includes GCC and product identifiers in platform-only status", () => {
  const [row] = normalizeComplianceRows({
    skcNames: ["rug-gcc"],
    requirementRows: [
      {
        skcName: "rug-gcc",
        items: [
          {
            certificateTypeCode: "GCCHGXX",
            certificateTypeId: 1188,
            certificateTypeName: "GCC合规信息",
            complianceGroupCode: "HGXXL",
            isManualProductWarning: false,
            isAutoProductWarning: false,
            isRequired: 1,
            reviewState: 3,
          },
          {
            certificateTypeCode: "ProductIdenti",
            certificateTypeId: 844,
            certificateTypeName: "产品标识符",
            complianceGroupCode: "HGXXL",
            isManualProductWarning: false,
            isAutoProductWarning: false,
            isRequired: 0,
            reviewState: 2,
          },
        ],
      },
    ],
    photoRows: [{ skc: "rug-gcc", skcLabelInfoList: [] }],
  });

  assert.equal(row.unsupportedRequirements.length, 2);
  assert.equal(row.platformOnly, "失败");
  assert.equal(row.state, "需修正");
});

test("keeps successful compliance batches when a later batch fails", async () => {
  const skcNames = Array.from(
    { length: SHEIN_COMPLIANCE_BATCH_SIZE + 1 },
    (_, index) => `skc-${index}`,
  );
  const batches = [];
  const result = await syncStoreComplianceData({
    skcNames,
    continueOnError: true,
    onBatch: async (batch) => batches.push(batch),
    request: async (options) => {
      const values = options.body.skcNames || options.body.skcList;
      if (values.includes("skc-20")) {
        const error = new Error("upstream timeout");
        error.code = "TIMEOUT";
        throw error;
      }
      if (options.path === SHEIN_COMPLIANCE_PATHS.requirements) {
        return {
          payload: {
            info: {
              data: values.map((skcName) => ({ skcName, items: [] })),
            },
          },
          diagnostics: { traceId: "requirements-ok" },
        };
      }
      return {
        payload: {
          info: values.map((skc) => ({ skc, skcLabelInfoList: [] })),
        },
        diagnostics: { traceId: "photos-ok" },
      };
    },
  });

  assert.equal(result.rows.length, 20);
  assert.deepEqual(result.failedSkcNames, ["skc-20"]);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].error, null);
  assert.equal(batches[1].error.code, "TIMEOUT");
});
