import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchComplianceRuleBundle,
  SHEIN_COMPLIANCE_RULE_PATHS,
} from "./compliance-rules.js";

test("loads only the dynamic rule sources required by the target SKC", async () => {
  const calls = [];
  const result = await fetchComplianceRuleBundle({
    row: {
      skc: "rug-1",
      certificateRequirements: [
        { certificateTypeCode: "CERT-A", certificateTypeId: 1 },
      ],
      agencyRequirements: [
        { certificateTypeCode: "Manufacturer", certificateTypeId: 2 },
      ],
      warningRequirements: [
        { certificateTypeCode: "WARN-A", certificateTypeId: 3 },
      ],
      bodyPhotoRequirements: [{ labelId: 8, labelGroup: 1 }],
      packagePhotoRequirements: [],
      unsupportedRequirements: [],
    },
    request: async (options) => {
      calls.push(options);
      if (options.path === SHEIN_COMPLIANCE_RULE_PATHS.certificateSchema) {
        return {
          payload: {
            info: {
              certificateTypeInfoList: [
                {
                  certificateTypeId: 1,
                  certificateType: "测试报告",
                  isEnabled: 1,
                },
              ],
              srmDetectionAgencyList: [],
            },
          },
          diagnostics: { traceId: "schema" },
        };
      }
      if (options.path === SHEIN_COMPLIANCE_RULE_PATHS.certificateSearch) {
        return {
          payload: {
            info: {
              data: [
                {
                  poolSn: "POOL-1",
                  certificateTypeCode: "CERT-A",
                  status: 2,
                },
              ],
            },
          },
          diagnostics: { traceId: "certificate-search" },
        };
      }
      if (options.path === SHEIN_COMPLIANCE_RULE_PATHS.agencyList) {
        return {
          payload: {
            info: [
              {
                agencyId: 10,
                agencyStatus: 0,
                applyStatus: 2,
                coveredProductRange: 2,
              },
              {
                agencyId: 11,
                agencyStatus: 1,
                applyStatus: 2,
                coveredProductRange: 2,
              },
            ],
          },
          diagnostics: { traceId: "agencies" },
        };
      }
      return {
        payload: {
          info: [
            { certificateTypeCode: "WARN-A", presetInfo: {} },
            { certificateTypeCode: "WARN-OTHER", presetInfo: {} },
          ],
        },
        diagnostics: { traceId: "warnings" },
      };
    },
  });

  assert.equal(result.complete, true);
  assert.equal(result.certificateSchemas.length, 1);
  assert.equal(result.certificates[0].poolSn, "POOL-1");
  assert.equal(result.bindableAgencies.length, 1);
  assert.equal(result.bindableAgencies[0].agencyId, 10);
  assert.deepEqual(
    result.warningRules.map((rule) => rule.certificateTypeCode),
    ["WARN-A"],
  );
  assert.deepEqual(
    calls.map((call) => call.path),
    [
      SHEIN_COMPLIANCE_RULE_PATHS.certificateSchema,
      SHEIN_COMPLIANCE_RULE_PATHS.certificateSearch,
      SHEIN_COMPLIANCE_RULE_PATHS.agencyList,
      SHEIN_COMPLIANCE_RULE_PATHS.warningRules,
    ],
  );
  assert.deepEqual(
    calls.find((call) => call.path === SHEIN_COMPLIANCE_RULE_PATHS.certificateSearch)?.body,
    {
      pageNum: 1,
      pageSize: 100,
      certificateTypeCodeList: ["CERT-A"],
      statusList: [2],
    },
  );
});

test("returns a partial bundle when one optional source fails", async () => {
  const result = await fetchComplianceRuleBundle({
    row: {
      skc: "rug-2",
      certificateRequirements: [
        { certificateTypeCode: "CERT-A", certificateTypeId: 1 },
      ],
    },
    request: async (options) => {
      if (options.path === SHEIN_COMPLIANCE_RULE_PATHS.certificateSchema) {
        const error = new Error("schema unavailable");
        error.code = "UPSTREAM";
        throw error;
      }
      return {
        payload: { info: { data: [] } },
        diagnostics: { traceId: "certificate-search" },
      };
    },
  });

  assert.equal(result.complete, false);
  assert.equal(result.sourceCoverage.certificateSchemas, false);
  assert.equal(result.sourceCoverage.certificateLibrary, true);
  assert.equal(result.errors[0].code, "UPSTREAM");
});
