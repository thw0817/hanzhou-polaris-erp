import assert from "node:assert/strict";
import test from "node:test";
import {
  ComplianceWriteError,
  WebComplianceWriteService,
} from "./compliance-write-service.js";

const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };

function createService({
  reportDate = "2026-08-21",
  photoRecords = true,
  photoRequired = true,
  executionEnabled = true,
} = {}) {
  const requests = [];
  const mediaReads = [];
  const draft = {
    updated_at: "2026-08-21T03:00:00.000Z",
    inputs: {
      photos: [{
        labelGroup: "2",
        localAssetRef: "media:11111111-1111-4111-8111-111111111111",
        fileName: "package.jpg",
      }],
    },
  };
  const snapshots = [{
    rule_type: "compliance_requirement",
    fresh: true,
    fingerprint: "requirements-v1",
    payload: {
      skc: "SKC-1",
      certificateRequirements: [{
        certificateTypeId: 531,
        certificateTypeCode: "SmallCarpet1631",
        certificateTypeName: "16 CFR 1631 检测报告",
        isRequired: 1,
        reviewState: 3,
      }],
    },
  }, {
    rule_type: "certificate_schema",
    fresh: true,
    fingerprint: "schema-v1",
    payload: {
      certificateSchemas: [{
        certificateTypeId: 531,
        certificateTypeCode: "SmallCarpet1631",
        certificateType: "16 CFR 1631 检测报告",
        certificateDimension: 1,
        isEnabled: 1,
        presetInfoList: [{
          presetId: 175,
          presetName: "报告日期",
          inputType: 4,
          isEnabled: 1,
          isRequired: 1,
        }],
        otherPresetInfoList: [],
      }],
    },
  }];
  const workspaceRepository = {
    async getSkc() {
      return { id: "skc-id-1", skc_name: "SKC-1" };
    },
    async listRecords() {
      return photoRecords ? [{
        requirement_type: "package_photo",
        status: "失败",
        required: photoRequired,
        requirement_data: { labelGroup: "2", labelId: 8 },
      }] : [];
    },
    async listSnapshots() {
      return snapshots;
    },
    async getDraft() {
      return draft;
    },
  };
  const service = new WebComplianceWriteService({
    workspaceRepository,
    storeRepository: {
      async getCredential() {
        return {
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "open-key",
          secretKey: "secret-key",
        };
      },
    },
    mediaService: {
      async readReadyComplianceEvidence(input) {
        mediaReads.push(input);
        return input.kind === "photo" ? {
          fileBytes: Buffer.from("photo"),
          fileName: "package.jpg",
          mimeType: "image/jpeg",
          width: 1200,
          height: 1200,
        } : {
          fileBytes: Buffer.from("report"),
          fileName: "1631.pdf",
          mimeType: "application/pdf",
        };
      },
    },
    complianceSync: {
      async startSync() {
        return { job: { id: "sync-job-1" } };
      },
    },
    apiBaseUrl: "https://openapi.example.test",
    confirmationSecret: "a".repeat(32),
    executionEnabled,
    now: () => new Date("2026-08-21T04:00:00.000Z"),
    async uploadPhoto() {
      return {
        payload: { info: { imageUrl: "https://shein.example/photo", imageMd5: "photo-md5" } },
        diagnostics: { traceId: "photo-upload-trace" },
      };
    },
    async uploadCertificate() {
      return {
        payload: { info: { fileUrl: "https://shein.example/report", fileMd5: "report-md5", fileName: "1631.pdf" } },
        diagnostics: { traceId: "report-upload-trace" },
      };
    },
    async request(input) {
      requests.push(input);
      if (input.path.endsWith("skc-save-label")) {
        return {
          payload: {
            code: "0",
            info: { totalCount: 1, successCount: 1, faildCount: 0, faildList: [] },
            traceId: "photo-bind-trace",
          },
        };
      }
      if (input.path.endsWith("goods-certificates/save")) {
        return {
          payload: {
            code: "0",
            info: { code: "0", poolSn: "ocp-1" },
            traceId: "report-save-trace",
          },
        };
      }
      return { payload: { code: "0", info: {}, traceId: "report-bind-trace" } };
    },
  });
  const assignment = {
    certificateTypeId: 531,
    certificateTypeCode: "SmallCarpet1631",
    certificateTypeName: "16 CFR 1631 检测报告",
    certificateDimension: 1,
    files: [{
      localAssetRef: "media:22222222-2222-4222-8222-222222222222",
      fileName: "1631.pdf",
      mimeType: "application/pdf",
      size: 1024,
    }],
    fieldValues: reportDate ? { 175: { value: reportDate } } : {},
  };
  return { service, requests, mediaReads, assignment };
}

test("checks and executes a single-SKC package photo upload and bind", async () => {
  const { service, requests, mediaReads } = createService();
  const checked = await service.checkPhotos({ context, storeId: "store-1", skc: "SKC-1" });
  assert.deepEqual(checked.groups, { body: 0, package: 1 });
  const result = await service.submitPhotos({
    context,
    storeId: "store-1",
    skc: "SKC-1",
    input: {
      confirmation: checked.confirmation,
      confirmationToken: checked.confirmationToken,
    },
  });
  assert.equal(result.info.successCount, 1);
  assert.equal(result.readbackJob.id, "sync-job-1");
  assert.equal(mediaReads[0].kind, "photo");
  assert.deepEqual(requests[0].body, {
    skcList: ["SKC-1"],
    packageLableList: [{
      imageUrl: "https://shein.example/photo",
      imageMd5: "photo-md5",
    }],
  });
});

test("checks and executes 1631 upload, save and single-SKC bind with report date", async () => {
  const { service, requests, assignment } = createService();
  const checked = await service.checkReport({
    context,
    storeId: "store-1",
    skc: "SKC-1",
    input: { assignment },
  });
  const result = await service.submitReport({
    context,
    storeId: "store-1",
    skc: "SKC-1",
    input: {
      assignment,
      confirmation: checked.confirmation,
      confirmationToken: checked.confirmationToken,
    },
  });
  assert.equal(result.poolSn, "ocp-1");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].body.presetInfoList, [{
    presetId: 175,
    valueList: [{ value: "2026-08-21 00:00:00" }],
  }]);
  assert.deepEqual(requests[1].body, { poolSn: "ocp-1", skcNames: ["SKC-1"] });
});

test("blocks 1630/1631 submission without the official report date field value", async () => {
  const { service, assignment } = createService({ reportDate: "" });
  await assert.rejects(
    service.checkReport({
      context,
      storeId: "store-1",
      skc: "SKC-1",
      input: { assignment },
    }),
    (error) => error instanceof ComplianceWriteError && error.code === "REPORT_DATE_REQUIRED",
  );
});

test("does not submit an optional failed body or package photo group", async () => {
  const { service } = createService({ photoRequired: false });
  await assert.rejects(
    service.checkPhotos({ context, storeId: "store-1", skc: "SKC-1" }),
    (error) => error instanceof ComplianceWriteError && error.code === "PHOTO_NO_FAILED_GROUP",
  );
});

test("keeps the documented photo payload diagnostic available while writes are disabled", async () => {
  const { service } = createService({ executionEnabled: false });
  assert.deepEqual(service.capabilities(), {
    photoBindingDiagnostic: true,
    photoSubmit: false,
    reportSubmit: false,
  });

  const checked = await service.checkPhotos({
    context,
    storeId: "store-1",
    skc: "SKC-1",
  });
  assert.equal(checked.externalWrite, false);
  assert.deepEqual(checked.groups, { body: 0, package: 1 });
  assert.equal("confirmationToken" in checked, false);

  await assert.rejects(
    service.submitPhotos({ context, storeId: "store-1", skc: "SKC-1" }),
    (error) => error instanceof ComplianceWriteError && error.code === "COMPLIANCE_WRITE_DISABLED",
  );
});
