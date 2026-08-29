import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompliancePreflight,
  buildSkcCompliancePreflight,
  validateAgencyAssignment,
  validateCertificateAssignment,
  validateWarningAssignment,
} from "./compliance-workflow.js";

test("blocks unsupported required compliance instead of inventing an API action", () => {
  const plan = buildSkcCompliancePreflight({
    row: {
      skc: "rug-1",
      sourceCoverage: {
        requirementsReturned: true,
        photoRequirementsReturned: true,
      },
      unsupportedRequirements: [
        {
          certificateTypeCode: "MANUAL",
          certificateTypeName: "说明书",
          complianceGroupCode: "SPSMS",
          isRequired: 1,
          reviewState: 0,
        },
      ],
    },
  });

  assert.equal(plan.status, "blocked");
  assert.equal(plan.executable, false);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.blockers[0].code, "API_UNSUPPORTED_REQUIREMENT");
  assert.equal(plan.blockers[0].handlingMode, "shein_backstage_only");
  assert.match(plan.blockers[0].message, /SHEIN商品合规管理后台/);
});

test("treats isRequired=10 as rules pending and requires a fresh query", () => {
  const plan = buildSkcCompliancePreflight({
    row: {
      skc: "rug-2",
      sourceCoverage: {
        requirementsReturned: true,
        photoRequirementsReturned: true,
      },
      certificateRequirements: [
        {
          certificateTypeCode: "TEST",
          certificateTypeName: "测试报告",
          complianceGroupCode: "ZSZZL",
          isRequired: 10,
          reviewState: 0,
        },
      ],
    },
  });

  assert.equal(plan.status, "rules_pending");
  assert.equal(plan.blockers[0].code, "REQUIREMENT_STATE_UNKNOWN");
});

test("validates dynamic certificate fields by inputType", () => {
  const result = validateCertificateAssignment({
    requirement: {
      certificateTypeId: 101,
      certificateTypeName: "地毯测试报告",
    },
    assignment: {
      files: [{ localAssetRef: "file-1" }],
      schema: {
        certificateTypeId: 101,
        certificateLabel: 0,
        isEnabled: 1,
        presetInfoList: [
          {
            presetId: 1,
            presetName: "机构",
            inputType: 1,
            isRequired: 1,
            presetValueList: [{ presetValueId: 9001, presetValue: "SGS" }],
          },
          { presetId: 2, presetName: "编号", inputType: 3, isRequired: 1 },
          { presetId: 3, presetName: "失效日", inputType: 4, isRequired: 1 },
        ],
      },
      fieldValues: {
        1: { valueIds: [9001] },
        2: { value: "CERT-2026-1" },
        3: { value: "2027-07-30" },
      },
    },
  });

  assert.equal(result.valid, true);
  assert.equal(result.mode, "create");
  assert.equal(result.blockers.length, 0);
});

test("rejects certificate option ids outside the current schema", () => {
  const result = validateCertificateAssignment({
    requirement: { certificateTypeId: 101, certificateTypeName: "地毯测试报告" },
    assignment: {
      files: [{ localAssetRef: "media:file" }],
      schema: {
        certificateTypeId: 101,
        certificateLabel: 0,
        isEnabled: 1,
        presetInfoList: [{
          presetId: 1,
          inputType: 1,
          isRequired: 1,
          presetValueList: [{ presetValueId: 11, presetValue: "通过" }],
        }],
      },
      fieldValues: { 1: { valueIds: [999] } },
    },
  });

  assert.equal(result.valid, false);
  assert.ok(result.blockers.some((item) => item.code === "CERTIFICATE_VALUE_INVALID"));
});

test("accepts a valid SRM detection agency and laboratory field", () => {
  const result = validateCertificateAssignment({
    requirement: { certificateTypeId: 101, certificateTypeName: "地毯测试报告" },
    assignment: {
      files: [{ localAssetRef: "media:file" }],
      schema: {
        certificateTypeId: 101,
        certificateLabel: 0,
        isEnabled: 1,
        otherPresetInfoList: [{
          presetId: 183,
          inputType: 1,
          sourceFrom: "SRM",
          isRequired: 1,
        }],
      },
      trustedSrmAgencies: [{
        detectionAgencyId: 16886285,
        laboratories: [{ laboratoryId: 16997191 }],
      }],
      fieldValues: {
        183: { detectionAgencyId: 16886285, laboratoryId: 16997191 },
      },
    },
  });

  assert.equal(result.valid, true);
});

test("rejects an agency whose platform type does not match the requirement", () => {
  const result = validateAgencyAssignment({
    requirement: {
      certificateTypeCode: "Manufacturer",
      certificateTypeName: "制造商信息",
    },
    assignment: {
      agencyId: 10,
      agencyStatus: 0,
      applyStatus: 2,
      coveredProductRange: 2,
      agencyType: 0,
    },
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.blockers.some(
      (blocker) => blocker.code === "AGENCY_TYPE_MISMATCH",
    ),
  );
});

test("auto-adds mapped warnings and rejects mutually exclusive values", () => {
  const rules = {
    certificateTypeCode: "RUG_WARNING",
    presetInfo: {
      presetFields: [
        {
          fieldCode: "RUG_ATTR",
          fieldName: "商品属性",
          fieldType: 0,
          fieldSort: 0,
          isEnabled: 1,
          presetFieldValues: [
            {
              fieldValueId: 1,
              fieldValue: "可机洗",
              exclusionFieldValueIds: [2],
              isEnabled: 1,
            },
            {
              fieldValueId: 2,
              fieldValue: "不可机洗",
              exclusionFieldValueIds: [1],
              isEnabled: 1,
            },
          ],
        },
        {
          fieldCode: "WARNING",
          fieldName: "警告语",
          fieldType: 2,
          fieldSort: 9,
          isEnabled: 1,
          presetFieldValues: [
            {
              fieldValueId: 10,
              fieldValue: "请按说明清洗",
              mappingPaths: [{ fieldValueIds: [1] }],
              isEnabled: 1,
            },
          ],
        },
      ],
    },
  };

  const valid = validateWarningAssignment({
    requirement: {
      certificateTypeCode: "RUG_WARNING",
      certificateTypeName: "地毯警告语",
    },
    assignment: {
      rules,
      selectedByField: { RUG_ATTR: [1] },
    },
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.selectedByField.WARNING, ["10"]);

  const invalid = validateWarningAssignment({
    requirement: {
      certificateTypeCode: "RUG_WARNING",
      certificateTypeName: "地毯警告语",
    },
    assignment: {
      rules,
      selectedByField: { RUG_ATTR: [1, 2] },
    },
  });
  assert.equal(invalid.valid, false);
  assert.ok(
    invalid.blockers.some((blocker) => blocker.code === "WARNING_VALUES_CONFLICT"),
  );
});

test("builds an executable dry-run without calling a write endpoint", () => {
  const result = buildCompliancePreflight({
    rows: [
      {
        skc: "rug-3",
        sourceCoverage: {
          requirementsReturned: true,
          photoRequirementsReturned: true,
        },
        certificateRequirements: [
          {
            certificateTypeCode: "CERT",
            certificateTypeName: "测试报告",
            complianceGroupCode: "ZSZZL",
            isRequired: 1,
            reviewState: 0,
          },
        ],
        bodyPhotoRequirements: [
          {
            labelId: 88,
            labelName: "商品本体标签",
            labelGroup: "1",
            isRequired: 1,
            reviewStatus: 0,
          },
        ],
      },
    ],
    inputsBySkc: {
      "rug-3": {
        certificates: [
          {
            certificateTypeCode: "CERT",
            poolSn: "POOL-1",
            status: 2,
            certificateDimension: 1,
          },
        ],
        photos: [
          { labelId: 88, labelGroup: "1", localAssetRef: "local-photo-1" },
        ],
      },
    },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.executable, true);
  assert.equal(result.summary.ready, 1);
  assert.deepEqual(
    result.plans[0].actions.map((item) => item.type),
    ["certificate.bind_existing", "photo.upload_and_bind"],
  );
});

test("requires 1630 and 1631 reports to be uploaded separately for each SKC", () => {
  const row = {
    skc: "rug-1631",
    sourceCoverage: {
      requirementsReturned: true,
      photoRequirementsReturned: true,
    },
    certificateRequirements: [
      {
        certificateTypeCode: "SmallCarpet",
        certificateTypeId: 1631,
        certificateTypeName: "16 CFR 1631 检测报告",
        complianceGroupCode: "ZSZZL",
        isRequired: 1,
        reviewState: 0,
      },
    ],
  };

  const reused = buildSkcCompliancePreflight({
    row,
    input: {
      certificates: [
        {
          certificateTypeCode: "SmallCarpet",
          skc: "rug-1631",
          poolSn: "POOL-SHARED",
          status: 2,
          certificateDimension: 1,
        },
      ],
    },
  });
  assert.ok(
    reused.blockers.some(
      (blocker) => blocker.code === "CERTIFICATE_POOL_REUSE_NOT_ALLOWED",
    ),
  );

  const localOnly = buildSkcCompliancePreflight({
    row,
    input: {
      certificates: [
        {
          certificateTypeCode: "SmallCarpet",
          skc: "rug-1631",
          schema: {
            certificateTypeId: 1631,
            certificateDimension: 1,
            certificateLabel: 0,
            isEnabled: 1,
          },
          files: [{ fileName: "1631.pdf", localAssetRef: "local:1631.pdf" }],
        },
      ],
    },
  });
  assert.ok(
    localOnly.blockers.some(
      (blocker) => blocker.code === "CERTIFICATE_DIRECT_UPLOAD_REQUIRED",
    ),
  );

  const uploaded = buildSkcCompliancePreflight({
    row,
    input: {
      certificates: [
        {
          certificateTypeCode: "SmallCarpet",
          skc: "rug-1631",
          schema: {
            certificateTypeId: 1631,
            certificateDimension: 1,
            certificateLabel: 0,
            isEnabled: 1,
          },
          files: [
            {
              fileName: "1631.pdf",
              fileUrl: "https://file.example/1631.pdf",
              fileMd5: "2230eacf3617c2a4604758ea3ae871b9",
            },
          ],
        },
      ],
    },
  });
  assert.equal(uploaded.status, "ready");
  assert.equal(uploaded.actions[0].type, "certificate.create_and_bind");
});

test("treats photo reviewStatus=1 as passed and keeps body/package slots separate", () => {
  const passed = buildSkcCompliancePreflight({
    row: {
      skc: "rug-4",
      sourceCoverage: {
        requirementsReturned: true,
        photoRequirementsReturned: true,
      },
      packagePhotoRequirements: [
        {
          labelId: 12,
          labelGroup: "2",
          labelName: "英代信息",
          isRequired: 1,
          reviewStatus: 1,
        },
      ],
    },
  });
  assert.equal(passed.status, "compliant");

  const separated = buildSkcCompliancePreflight({
    row: {
      skc: "rug-5",
      sourceCoverage: {
        requirementsReturned: true,
        photoRequirementsReturned: true,
      },
      bodyPhotoRequirements: [
        {
          labelId: 12,
          labelGroup: "1",
          labelName: "英代信息",
          isRequired: 1,
          reviewStatus: 3,
        },
      ],
      packagePhotoRequirements: [
        {
          labelId: 12,
          labelGroup: "2",
          labelName: "英代信息",
          isRequired: 1,
          reviewStatus: 3,
        },
      ],
    },
    input: {
      photos: [
        {
          labelId: 12,
          labelGroup: "1",
          localAssetRef: "body-photo",
        },
      ],
    },
  });
  assert.equal(separated.actions.length, 1);
  assert.equal(separated.actions[0].requirementKey, "12:1");
  assert.equal(separated.blockers[0].labelGroup, "2");
});

test("maps a reusable photo template to the target label within the same group", () => {
  const plan = buildSkcCompliancePreflight({
    row: {
      skc: "rug-eu-photo",
      sourceCoverage: {
        requirementsReturned: true,
        photoRequirementsReturned: true,
      },
      packagePhotoRequirements: [
        {
          labelId: 11,
          labelGroup: "2",
          labelName: "欧盟责任人/欧代信息",
          isRequired: 1,
          reviewStatus: 0,
        },
      ],
    },
    input: {
      photos: [
        {
          labelId: 99,
          labelGroup: "2",
          templateReusable: true,
          localAssetRef: "/api/local-assets/main-images/package.jpg",
          fileName: "package.jpg",
          mimeType: "image/jpeg",
          size: 1024,
          width: 1200,
          height: 1200,
        },
      ],
    },
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.actions[0].type, "photo.upload_and_bind");
  assert.equal(plan.actions[0].labelGroup, "2");
});

test("allows a batch containing both ready and already compliant SKCs", () => {
  const result = buildCompliancePreflight({
    rows: [
      {
        skc: "ready-rug",
        sourceCoverage: {
          requirementsReturned: true,
          photoRequirementsReturned: true,
        },
        certificateRequirements: [
          {
            certificateTypeCode: "CERT",
            complianceGroupCode: "ZSZZL",
            isRequired: 1,
            reviewState: 0,
          },
        ],
      },
      {
        skc: "compliant-rug",
        sourceCoverage: {
          requirementsReturned: true,
          photoRequirementsReturned: true,
        },
      },
    ],
    inputsBySkc: {
      "ready-rug": {
        certificates: [
          {
            certificateTypeCode: "CERT",
            poolSn: "POOL-2",
            status: 2,
            certificateDimension: 1,
          },
        ],
      },
    },
  });

  assert.equal(result.executable, true);
  assert.equal(result.summary.ready, 1);
  assert.equal(result.summary.compliant, 1);
});

test("blocks legacy compliance templates without a rule snapshot timestamp", () => {
  const result = buildCompliancePreflight({
    rows: [
      {
        skc: "rug-legacy-template",
        sourceCoverage: {
          requirementsReturned: true,
          photoRequirementsReturned: true,
        },
      },
    ],
    template: {
      id: "legacy-template",
      defaults: {},
    },
  });

  assert.equal(result.summary.rulesPending, 1);
  assert.equal(
    result.plans[0].blockers[0].code,
    "RULE_SNAPSHOT_MISSING",
  );
});
