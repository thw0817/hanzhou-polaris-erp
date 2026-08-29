import assert from "node:assert/strict";
import test from "node:test";
import { SheinApiError } from "../shein-client.js";
import {
  PRODUCT_PUBLISH_PATH,
  WebProductPublishExecutor,
} from "./product-publish-executor.js";
import {
  productRemotePublishCandidateFingerprint,
} from "./product-remote-preflight.js";

function candidate(overrides = {}) {
  const snapshot = {
    state: "ready_for_publish_confirmation",
    sourceCandidateFingerprint: "source-1",
    publishingEnabled: false,
    requestBody: {
      category_id: "20039882",
      spu_name: "",
      skc_list: [{
        skc_name: "",
        sku_list: [{ sku_code: "", supplier_sku: "SKU-001" }],
      }],
    },
    blockers: [],
    checks: {},
    ...overrides,
  };
  return {
    ...snapshot,
    fingerprint: productRemotePublishCandidateFingerprint(snapshot),
  };
}

function job(remoteCandidate) {
  return {
    tenant_id: "tenant-1",
    store_id: "store-1",
    state: "claimed",
    claim_id: "claim-1",
    source_candidate_fingerprint: "source-1",
    remote_candidate_fingerprint: remoteCandidate.fingerprint,
    executionEnabled: true,
    authorizesPublishing: true,
  };
}

function executor({ enabled = true, request, mediaService, uploadCompliancePhoto, complianceWritesEnabled } = {}) {
  return new WebProductPublishExecutor({
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
    apiBaseUrl: "https://openapi.sheincorp.com",
    executionEnabled: enabled,
    request: request || (async () => ({
      payload: {
        code: "0",
        msg: "OK",
        info: {
          success: true,
          spu_name: "SPU-1",
          version: "VERSION-1",
          skc_list: [{
            skc_name: "SKC-1",
            sku_list: [{ sku_code: "SKU-CODE-1", supplier_sku: "SKU-001" }],
          }],
          pre_valid_result: [],
          mcc_valid_result: [],
        },
        traceId: "trace-1",
      },
      diagnostics: { traceId: "trace-1" },
    })),
    mediaService,
    uploadCompliancePhoto,
    complianceWritesEnabled,
  });
}

test("keeps publish execution disabled without calling SHEIN", async () => {
  let calls = 0;
  const remoteCandidate = candidate();
  await assert.rejects(
    () => executor({
      enabled: false,
      request: async () => {
        calls += 1;
      },
    }).execute({
      tenantId: "tenant-1",
      storeId: "store-1",
      job: job(remoteCandidate),
      claimId: "claim-1",
      remoteCandidate,
    }),
    /真实发布执行尚未启用/,
  );
  assert.equal(calls, 0);
});

test("rejects unscoped jobs and forged candidates before calling SHEIN", async () => {
  let calls = 0;
  const remoteCandidate = candidate();
  const service = executor({ request: async () => { calls += 1; } });
  await assert.rejects(
    () => service.execute({
      tenantId: "tenant-1",
      storeId: "store-1",
      job: { ...job(remoteCandidate), store_id: "other-store" },
      claimId: "claim-1",
      remoteCandidate,
    }),
    /不属于当前租户店铺/,
  );
  await assert.rejects(
    () => service.execute({
      tenantId: "tenant-1",
      storeId: "store-1",
      job: job(remoteCandidate),
      claimId: "claim-1",
      remoteCandidate: {
        ...remoteCandidate,
        requestBody: { ...remoteCandidate.requestBody, category_id: "changed" },
      },
    }),
    /候选快照无效/,
  );
  assert.equal(calls, 0);
});

test("submits one verified frozen candidate and returns a sanitized receipt", async () => {
  const calls = [];
  const remoteCandidate = candidate();
  const result = await executor({
    request: async (input) => {
      calls.push(input);
      return {
        payload: {
          code: "0",
          msg: "OK",
          info: {
            success: true,
            spu_name: "SPU-1",
            version: "VERSION-1",
            skc_list: [{
              skc_name: "SKC-1",
              sku_list: [{ sku_code: "SKU-CODE-1", supplier_sku: "SKU-001" }],
            }],
          },
          traceId: "trace-1",
        },
        diagnostics: { traceId: "trace-1" },
      };
    },
  }).execute({
    tenantId: "tenant-1",
    storeId: "store-1",
    job: job(remoteCandidate),
    claimId: "claim-1",
    remoteCandidate,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, PRODUCT_PUBLISH_PATH);
  assert.equal(calls[0].body, remoteCandidate.requestBody);
  assert.deepEqual(result, {
    outcome: "accepted",
    retryable: false,
    receipt: {
      success: true,
      spuName: "SPU-1",
      version: "VERSION-1",
      skcs: [{
        skcName: "SKC-1",
        skus: [{ skuCode: "SKU-CODE-1", supplierSku: "SKU-001" }],
      }],
      traceId: "trace-1",
    },
  });
  assert.equal("requestBody" in result.receipt, false);
});

test("keeps explicit SHEIN rejections separate from unknown transport results", async () => {
  const remoteCandidate = candidate();
  const rejected = await executor({
    request: async () => {
      throw new SheinApiError("流量保护", {
        status: 429,
        code: "4000004",
        traceId: "trace-rate",
        response: { code: "4000004", msg: "流量保护", traceId: "trace-rate" },
      });
    },
  }).execute({
    tenantId: "tenant-1",
    storeId: "store-1",
    job: job(remoteCandidate),
    claimId: "claim-1",
    remoteCandidate,
  });
  assert.deepEqual(rejected, {
    outcome: "failed",
    retryable: true,
    error: { code: "4000004", message: "流量保护", traceId: "trace-rate" },
  });

  const unknown = await executor({
    request: async () => {
      throw new SheinApiError("SHEIN 请求超时", { status: 504 });
    },
  }).execute({
    tenantId: "tenant-1",
    storeId: "store-1",
    job: job(remoteCandidate),
    claimId: "claim-1",
    remoteCandidate,
  });
  assert.deepEqual(unknown, {
    outcome: "unknown",
    retryable: false,
    error: { code: null, message: "SHEIN 请求超时", traceId: null },
  });
});

test("submits selected body and package compliance photos after SHEIN accepts the product", async () => {
  const calls = [];
  const remoteCandidate = candidate({
    postPublishCompliancePhotos: {
      package: [{ assetId: "photo-1", name: "package.jpg" }],
      body: [{ assetId: "photo-2", name: "body.jpg" }],
    },
  });
  const result = await executor({
    complianceWritesEnabled: true,
    mediaService: {
      async readReadyComplianceEvidence(input) {
        assert.deepEqual(input.context, { tenantId: "tenant-1" });
        assert.equal(input.storeId, "store-1");
        assert.equal(input.kind, "photo");
        assert.ok(["photo-1", "photo-2"].includes(input.assetId));
        const isBody = input.assetId === "photo-2";
        return {
          fileBytes: Buffer.from("fake-image"),
          fileName: isBody ? "body.jpg" : "package.jpg",
          mimeType: "image/jpeg",
          width: 1200,
          height: 1200,
        };
      },
    },
    uploadCompliancePhoto: async (input) => {
      assert.equal(input.mimeType, "image/jpeg");
      return {
        payload: {
          code: "0",
          info: {
            imageUrl: `https://shein.example/${input.fileName}`,
            imageMd5: `md5-${input.fileName}`,
          },
          traceId: `${input.fileName}-trace`,
        },
        diagnostics: { traceId: `${input.fileName}-trace` },
      };
    },
    request: async (input) => {
      calls.push(input);
      if (input.path === PRODUCT_PUBLISH_PATH) {
        return {
          payload: {
            code: "0",
            msg: "OK",
            info: {
              success: true,
              spu_name: "SPU-1",
              version: "VERSION-1",
              skc_list: [{
                skc_name: "SKC-1",
                sku_list: [{ sku_code: "SKU-CODE-1", supplier_sku: "SKU-001" }],
              }],
            },
            traceId: "product-trace",
          },
          diagnostics: { traceId: "product-trace" },
        };
      }
      assert.equal(input.path, "/open-api/goods-compliance/skc-save-label");
      return {
        payload: { code: "0", msg: "OK", traceId: "bind-trace" },
        diagnostics: { traceId: "bind-trace" },
      };
    },
  }).execute({
    tenantId: "tenant-1",
    storeId: "store-1",
    job: job(remoteCandidate),
    claimId: "claim-1",
    remoteCandidate,
  });

  assert.equal(result.outcome, "accepted");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, {
    skcList: ["SKC-1"],
    packageLableList: [{
      imageUrl: "https://shein.example/package.jpg",
      imageMd5: "md5-package.jpg",
    }],
    bodyLableList: [{
      imageUrl: "https://shein.example/body.jpg",
      imageMd5: "md5-body.jpg",
    }],
  });
  assert.deepEqual(result.receipt.compliancePhotoSubmission, {
    status: "passed",
    packageCount: 1,
    bodyCount: 1,
    skcCount: 1,
    uploadTraceIds: ["package.jpg-trace", "body.jpg-trace"],
    bindTraceId: "bind-trace",
  });
});

test("keeps accepted product state when compliance photo binding fails and returns the failure", async () => {
  const remoteCandidate = candidate({
    postPublishCompliancePhotos: {
      package: [{ assetId: "photo-1", name: "package.jpg" }],
      body: [],
    },
  });
  const result = await executor({
    complianceWritesEnabled: true,
    mediaService: {
      async readReadyComplianceEvidence() {
        return {
          fileBytes: Buffer.from("fake-image"),
          fileName: "package.jpg",
          mimeType: "image/jpeg",
          width: 1200,
          height: 1200,
        };
      },
    },
    uploadCompliancePhoto: async () => ({
      payload: {
        code: "0",
        info: { imageUrl: "https://shein.example/package.jpg", imageMd5: "md5-package" },
      },
      diagnostics: { traceId: "photo-upload-trace" },
    }),
    request: async (input) => {
      if (input.path === PRODUCT_PUBLISH_PATH) {
        return {
          payload: {
            code: "0",
            info: {
              success: true,
              spu_name: "SPU-1",
              version: "VERSION-1",
              skc_list: [{
                skc_name: "SKC-1",
                sku_list: [{ sku_code: "SKU-CODE-1", supplier_sku: "SKU-001" }],
              }],
            },
          },
        };
      }
      throw new SheinApiError("实拍图绑定失败", {
        status: 400,
        code: "PHOTO_BIND_FAILED",
        traceId: "bind-trace",
        response: { code: "PHOTO_BIND_FAILED", msg: "实拍图绑定失败" },
      });
    },
  }).execute({
    tenantId: "tenant-1",
    storeId: "store-1",
    job: job(remoteCandidate),
    claimId: "claim-1",
    remoteCandidate,
  });

  assert.equal(result.outcome, "accepted");
  assert.equal(result.receipt.compliancePhotoSubmission.status, "failed");
  assert.equal(result.receipt.compliancePhotoSubmission.code, "PHOTO_BIND_FAILED");
  assert.equal(result.receipt.compliancePhotoSubmission.traceId, "bind-trace");
});

test("uses SHEIN validation blockers when top-level code is zero but publish fails", async () => {
  const remoteCandidate = candidate();
  const result = await executor({
    request: async () => ({
      payload: {
        code: "0",
        msg: "OK",
        info: {
          success: false,
          pre_valid_result: [{
            form: "attribute",
            module: "material",
            field_name: "成分",
            messages: ["Material is required"],
          }],
          mcc_valid_result: [{ type: 1, message: "可忽略预警" }, {
            type: 2,
            message: "治理规则阻断",
          }],
        },
        traceId: "trace-validation",
      },
      diagnostics: { traceId: "trace-validation" },
    }),
  }).execute({
    tenantId: "tenant-1",
    storeId: "store-1",
    job: job(remoteCandidate),
    claimId: "claim-1",
    remoteCandidate,
  });

  assert.deepEqual(result, {
    outcome: "failed",
    retryable: false,
    error: {
      code: "0",
      message: "Material is required；治理规则阻断",
      traceId: "trace-validation",
      details: [
        {
          source: "pre_valid_result",
          location: "attribute / material / 成分",
          messages: ["Material is required"],
        },
        {
          source: "mcc_valid_result",
          location: "type=2",
          messages: ["治理规则阻断"],
        },
      ],
    },
  });
});

test("treats an incomplete success response as unknown instead of retrying", async () => {
  const remoteCandidate = candidate();
  const result = await executor({
    request: async () => ({
      payload: { code: "0", msg: "OK", info: { success: true }, traceId: "trace-2" },
      diagnostics: { traceId: "trace-2" },
    }),
  }).execute({
    tenantId: "tenant-1",
    storeId: "store-1",
    job: job(remoteCandidate),
    claimId: "claim-1",
    remoteCandidate,
  });
  assert.equal(result.outcome, "unknown");
  assert.equal(result.retryable, false);
  assert.equal(result.error.traceId, "trace-2");
});
