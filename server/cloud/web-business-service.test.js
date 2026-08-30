import assert from "node:assert/strict";
import test from "node:test";
import { SheinWebReadService } from "./web-business-service.js";

function response(payload) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test("web product reads use encrypted store credentials without returning them", async () => {
  const calls = [];
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential(storeId) {
        assert.equal(storeId, "store-1");
        return {
          storeId,
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({
        code: "0",
        msg: "OK",
        info: {
          data: [
            {
              spuName: "SPU-1",
              skcList: [
                {
                  skcName: "SKC-1",
                  supplierCode: "RUG-1",
                  skcShelfStatus: 1,
                  skuList: [],
                },
              ],
            },
          ],
          meta: { count: 1 },
        },
      });
    },
  });

  const result = await service.listProducts({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    pageNum: 1,
    pageSize: 30,
  });

  assert.equal(result.products[0].skc, "SKC-1");
  assert.equal(result.total, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["x-lt-openKeyId"], "OPEN-1");
  assert.equal(JSON.stringify(result).includes("SECRET-1"), false);
  assert.equal(JSON.stringify(result).includes("OPEN-1"), false);
});

test("document state source-pending reads are locked before credentials or transport", async () => {
  let credentialReads = 0;
  let transportCalls = 0;
  let receiptWrites = 0;
  let reviewWrites = 0;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        credentialReads += 1;
        return null;
      },
    },
    publishExecutionRepository: {
      async appendDocumentStateReceipts() {
        receiptWrites += 1;
      },
    },
    productReviewRepository: {
      async saveDocumentStates() {
        reviewWrites += 1;
      },
    },
    fetchImpl: async () => {
      transportCalls += 1;
      return response({ code: "0", info: {} });
    },
  });

  await assert.rejects(
    service.queryDocumentState({
      context: { tenantId: "tenant-1" },
      storeId: "store-1",
      version: "VERSION-1",
      spuNames: ["SPU-1"],
    }),
    (error) => error.code === "ERP07_ADAPTER_SOURCE_PENDING_READ_DISABLED" && error.status === 409,
  );
  assert.equal(credentialReads, 0);
  assert.equal(transportCalls, 0);
  assert.equal(receiptWrites, 0);
  assert.equal(reviewWrites, 0);
});

test("business sync and publish preflight lock source-pending reads before credentials or transport", async () => {
  let credentialReads = 0;
  let transportCalls = 0;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        credentialReads += 1;
        return null;
      },
    },
    fetchImpl: async () => {
      transportCalls += 1;
      return response({ code: "0", info: {} });
    },
  });

  await assert.rejects(
    service.syncStoreBusiness({
      context: { tenantId: "tenant-1" },
      storeId: "store-1",
    }),
    (error) => error.code === "ERP07_ADAPTER_SOURCE_PENDING_READ_DISABLED" && error.status === 409,
  );
  await assert.rejects(
    service.preflightPublish({
      context: { tenantId: "tenant-1" },
      storeId: "store-1",
      supplierSkuList: [],
    }),
    (error) => error.code === "ERP07_ADAPTER_SOURCE_PENDING_READ_DISABLED" && error.status === 409,
  );
  assert.equal(credentialReads, 0);
  assert.equal(transportCalls, 0);
});

test("document state reads send the official version and spuList fields and persist normalized receipts", async () => {
  let requestBody = null;
  let persisted = null;
  let reviewState = null;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    sourcePendingDocumentStateReadEnabled: true,
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    publishExecutionRepository: {
      async appendDocumentStateReceipts(input) {
        persisted = input;
        return {
          matchedCount: 1,
          persistedCount: 1,
          ambiguousCount: 0,
          unmatchedCount: [],
        };
      },
    },
    productReviewRepository: {
      async saveDocumentStates(input) {
        reviewState = input;
      },
    },
    fetchImpl: async (url, options) => {
      assert.equal(
        new URL(url).pathname,
        "/open-api/goods/query-document-state",
      );
      requestBody = JSON.parse(options.body);
      return response({
        code: "0",
        msg: "OK",
        info: {
          data: [{
            spuName: "SPU-1",
            version: "VERSION-1",
            skcList: [{
              skcName: "SKC-1",
              documentSn: "DOC-1",
              documentState: 1,
              failedReason: null,
            }],
          }],
        },
        traceId: "state-trace",
      });
    },
  });

  const result = await service.queryDocumentState({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    version: "VERSION-1",
    spuNames: ["SPU-1"],
  });

  assert.deepEqual(requestBody, {
    version: "VERSION-1",
    spuList: [{ spuName: "SPU-1" }],
  });
  assert.equal(persisted.tenantId, "tenant-1");
  assert.equal(persisted.storeId, "store-1");
  assert.equal(persisted.records[0].version, "VERSION-1");
  assert.equal(reviewState.tenantId, "tenant-1");
  assert.equal(reviewState.storeId, "store-1");
  assert.equal(reviewState.records[0].version, "VERSION-1");
  assert.equal(result.projection.records[0].status, "pending");
  assert.equal(result.projection.persistence.persistedCount, 1);
  assert.equal(result.diagnostics.traceId, "state-trace");
  assert.equal(JSON.stringify(result).includes("SECRET-1"), false);
});

test("document state reads keep the official result when one local projection fails", async () => {
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    sourcePendingDocumentStateReadEnabled: true,
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    publishExecutionRepository: {
      async appendDocumentStateReceipts() {
        throw Object.assign(new Error("receipt projection unavailable"), {
          code: "RECEIPT_PROJECTION_FAILED",
        });
      },
    },
    productReviewRepository: {
      async saveDocumentStates() {
        return { savedCount: 1 };
      },
    },
    fetchImpl: async () => response({
      code: "0",
      msg: "OK",
      info: {
        data: [{
          spuName: "SPU-1",
          version: "VERSION-1",
          skcList: [{ skcName: "SKC-1", documentState: 3 }],
        }],
      },
      traceId: "official-trace-1",
    }),
  });

  const result = await service.queryDocumentState({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    version: "VERSION-1",
    spuNames: ["SPU-1"],
  });

  assert.equal(result.projection.records[0].status, "failed");
  assert.equal(result.projection.persistence.partial, true);
  assert.equal(result.projection.persistence.receiptState, "rejected");
  assert.equal(result.projection.persistence.reviewState, "fulfilled");
  assert.equal(result.projection.persistence.errors.receipts.code, "RECEIPT_PROJECTION_FAILED");
  assert.equal(result.diagnostics.traceId, "official-trace-1");
});

test("document state reads keep an official empty result non-fatal and do not persist a fake state", async () => {
  let persisted = false;
  let reviewed = false;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    sourcePendingDocumentStateReadEnabled: true,
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    publishExecutionRepository: {
      async appendDocumentStateReceipts() {
        persisted = true;
      },
    },
    productReviewRepository: {
      async saveDocumentStates() {
        reviewed = true;
      },
    },
    fetchImpl: async () => response({
      code: "0",
      msg: "OK",
      info: { data: [] },
      traceId: "empty-state-trace",
    }),
  });

  const result = await service.queryDocumentState({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    version: "VERSION-NOT-YET-RETURNED",
    spuNames: ["SPU-1"],
  });

  assert.equal(result.empty, true);
  assert.equal(result.summary.recordCount, 0);
  assert.equal(result.diagnostics.traceId, "empty-state-trace");
  assert.equal(persisted, false);
  assert.equal(reviewed, false);
});

test("document state reads reject a credential from another tenant before calling SHEIN", async () => {
  let fetches = 0;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    sourcePendingDocumentStateReadEnabled: true,
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-2",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    fetchImpl: async () => {
      fetches += 1;
      return response({ code: "0", info: {} });
    },
  });

  await assert.rejects(
    service.queryDocumentState({
      context: { tenantId: "tenant-1" },
      storeId: "store-1",
      version: "VERSION-1",
      spuNames: ["SPU-1"],
    }),
    (error) => error.code === "STORE_UNAVAILABLE",
  );
  assert.equal(fetches, 0);
});

test("credential decryption failure marks the store for reauthorization before any SHEIN read", async () => {
  let markedStoreId = null;
  let fetches = 0;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        const error = new Error("cannot decrypt");
        error.code = "CLOUD_CREDENTIAL_DECRYPT_FAILED";
        throw error;
      },
      async requireReauthorizationByStoreId(storeId) {
        markedStoreId = storeId;
      },
    },
    fetchImpl: async () => {
      fetches += 1;
      return response({ code: "0", info: {} });
    },
  });

  await assert.rejects(
    service.listProducts({
      context: { tenantId: "tenant-1" },
      storeId: "store-1",
    }),
    (error) => error.code === "STORE_REAUTHORIZATION_REQUIRED",
  );
  assert.equal(markedStoreId, "store-1");
  assert.equal(fetches, 0);
});

test("SHEIN signature rejection marks the store for reauthorization and hides the raw upstream error", async () => {
  let markedStoreId = null;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
      async requireReauthorizationByStoreId(storeId) {
        markedStoreId = storeId;
      },
    },
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async text() {
        return JSON.stringify({
          code: "openapi00001",
          msg: "签名错误:生成的签名不正确，请检查",
          traceId: "trace-signature",
        });
      },
    }),
  });

  await assert.rejects(
    service.listProducts({
      context: { tenantId: "tenant-1" },
      storeId: "store-1",
    }),
    (error) =>
      error.code === "STORE_REAUTHORIZATION_REQUIRED" &&
      error.status === 409 &&
      error.message.includes("重新授权"),
  );
  assert.equal(markedStoreId, "store-1");
});

test("reauthorization-required stores return an actionable message before SHEIN reads", async () => {
  let fetches = 0;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "reauthorization_required",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    fetchImpl: async () => {
      fetches += 1;
      return response({ code: "0", info: {} });
    },
  });

  await assert.rejects(
    service.getPublishCategories({
      context: { tenantId: "tenant-1" },
      storeId: "store-1",
    }),
    (error) =>
      error.code === "STORE_REAUTHORIZATION_REQUIRED" &&
      error.message.includes("重新授权"),
  );
  assert.equal(fetches, 0);
});

test("SPU readback requires an approved local job and sends only official SHEIN fields", async () => {
  let requestBody = null;
  let persisted = null;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    publishExecutionRepository: {
      async findApprovedReadbackJob(input) {
        assert.deepEqual(input, {
          tenantId: "tenant-1",
          storeId: "store-1",
          spuName: "SPU-1",
          version: "VERSION-1",
        });
        return { id: "job-1" };
      },
      async appendSpuReadbackReceipt(input) {
        persisted = input;
        return { id: "receipt-1", deduplicated: false };
      },
    },
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).pathname, "/open-api/goods/spu-info");
      requestBody = JSON.parse(options.body);
      return response({
        code: "0",
        msg: "OK",
        info: {
          spuName: "SPU-1",
          categoryId: 3155,
          productTypeId: 991,
          skcInfoList: [{
            skcName: "SKC-1",
            skuInfoList: [{
              skuCode: "SKU-1",
              supplierSku: "SUPPLIER-SKU-1",
            }],
          }],
        },
        traceId: "spu-trace",
      });
    },
  });

  const result = await service.querySpuInfo({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    spuName: "SPU-1",
    version: "VERSION-1",
  });

  assert.deepEqual(requestBody, {
    languageList: ["zh-cn", "en"],
    spuName: "SPU-1",
  });
  assert.equal(persisted.jobId, "job-1");
  assert.equal(persisted.version, "VERSION-1");
  assert.equal(persisted.projection.skcs[0].skuList[0].skuCode, "SKU-1");
  assert.equal(result.projection.persistence.receiptId, "receipt-1");
  assert.equal(result.diagnostics.traceId, "spu-trace");
});

test("product attribute snapshots read official SPU details and attribute templates", async () => {
  const calls = [];
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(options.body);
      calls.push({ path, body });
      if (path === "/open-api/goods/spu-info") {
        return response({
          code: "0",
          msg: "OK",
          info: {
            spuName: "SPU-1",
            categoryId: 3155,
            productTypeId: 991,
            productAttributeInfoList: [
              { attributeId: 101, attributeValue: "180", attributeValueId: null },
              { attributeId: 201, attributeValue: null, attributeValueId: 99 },
            ],
            skcInfoList: [{
              skcName: "SKC-1",
              skuInfoList: [{ skuCode: "SKU-1" }],
            }],
          },
          traceId: "spu-trace",
        });
      }
      if (path === "/open-api/goods/query-attribute-template") {
        return response({
          code: "0",
          msg: "OK",
          info: {
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
                  attribute_id: 201,
                  attribute_name: "颜色",
                  attribute_status: 3,
                  attribute_type: 1,
                  attribute_mode: 3,
                  data_dimension: 1,
                  attribute_value_info_list: [],
                },
              ],
            }],
          },
        });
      }
      if (path === "/open-api/goods/query-publish-fill-in-standard") {
        return response({ code: "0", msg: "OK", info: { data: [] } });
      }
      if (path === "/open-api/goods/get-custom-attribute-permission-config") {
        return response({ code: "0", msg: "OK", info: { data: [] } });
      }
      throw new Error(`unexpected path ${path}`);
    },
  });

  const result = await service.syncProductAttributeSnapshots({
    context: { tenantId: "tenant-1", role: "admin" },
    storeId: "store-1",
    targets: [{
      skc_name: "SKC-1",
      spu_name: "SPU-1",
      raw_data: {
        attributeSnapshot: {
          rugReportSources: {
            longestEdge: [{ attributeId: "101", unit: "cm" }],
          },
        },
      },
    }],
  });

  assert.deepEqual(calls[0], {
    path: "/open-api/goods/spu-info",
    body: { languageList: ["zh-cn", "en"], spuName: "SPU-1" },
  });
  assert.deepEqual(
    result.snapshots[0].snapshot.attributeValues,
    { "101": { valueIds: [], customValue: "180" } },
  );
  assert.deepEqual(
    result.snapshots[0].snapshot.rugReportSources,
    { longestEdge: [{ attributeId: "101", unit: "cm" }] },
  );
  assert.deepEqual(result.failedSkcNames, []);
  assert.equal(
    result.snapshots[0].snapshot.source.endpoint,
    "/open-api/goods/spu-info",
  );
});

test("SPU readback does not call SHEIN when no approved job is uniquely associated", async () => {
  let fetches = 0;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    publishExecutionRepository: {
      async findApprovedReadbackJob() {
        return null;
      },
    },
    fetchImpl: async () => {
      fetches += 1;
      return response({ code: "0", info: {} });
    },
  });

  await assert.rejects(
    service.querySpuInfo({
      context: { tenantId: "tenant-1" },
      storeId: "store-1",
      spuName: "SPU-1",
      version: "VERSION-1",
    }),
    (error) => error.code === "SPU_READBACK_NOT_ALLOWED",
  );
  assert.equal(fetches, 0);
});

test("SPU readback converts ambiguous local task matches into a stable business error", async () => {
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    publishExecutionRepository: {
      async findApprovedReadbackJob() {
        throw new Error("SPU关系回读任务匹配不唯一");
      },
    },
    fetchImpl: async () => response({ code: "0", info: {} }),
  });

  await assert.rejects(
    service.querySpuInfo({
      context: { tenantId: "tenant-1" },
      storeId: "store-1",
      spuName: "SPU-1",
      version: "VERSION-1",
    }),
    (error) =>
      error.code === "SPU_READBACK_AMBIGUOUS" &&
      error.status === 409,
  );
});

test("compliance revalidation uses server-owned readback and rule sources", async () => {
  let sourceInput = null;
  let persistedInput = null;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    now: () => new Date("2026-08-06T02:00:00.000Z"),
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    publishExecutionRepository: {
      async findApprovedReadbackJob(input) {
        assert.deepEqual(input, {
          tenantId: "tenant-1",
          storeId: "store-1",
          spuName: "SPU-1",
          version: "VERSION-1",
        });
        return { id: "job-1" };
      },
      async getComplianceRevalidationSource(input) {
        sourceInput = input;
        return {
          job: {
            shein_version: "VERSION-1",
            request_summary: { spuName: "SPU-1" },
          },
          readback: {
            spuName: "SPU-1",
            skcs: [{
              skcName: "SKC-1",
              skuList: [{ skuCode: "SKU-1" }],
            }],
          },
          draftData: {
            attributeSchemaSnapshot: {
              fetchedAt: "2026-08-06T00:00:00.000Z",
              fields: [
                {
                  id: "length",
                  name: "最长边",
                  typeCode: 3,
                  dataDimension: 1,
                  values: [],
                },
                {
                  id: "width",
                  name: "宽度",
                  typeCode: 3,
                  dataDimension: 1,
                  values: [],
                },
              ],
            },
            attributeValues: {
              length: { customValue: "100" },
              width: { customValue: "100" },
            },
            rugReportSources: {
              dimensions: [
                { attributeId: "length", unit: "cm" },
                { attributeId: "width", unit: "cm" },
              ],
            },
            complianceTemplateSnapshot: {
              data: {
                defaults: {
                  certificates: [{
                    certificateTypeName: "1631检测报告",
                    files: [{ localAssetRef: "media:asset-1631" }],
                  }],
                },
              },
            },
          },
          requirementRows: [{
            skc: "SKC-1",
            sourceCoverage: {
              requirementsReturned: true,
              photoRequirementsReturned: true,
            },
            certificateRequirements: [{
              certificateTypeName: "1631检测报告",
              isRequired: 1,
              reviewState: 2,
            }],
            unsupportedRequirements: [
              {
                certificateTypeCode: "GCCHGXX",
                certificateTypeName: "GCC",
                isRequired: 1,
                reviewState: 2,
              },
              {
                certificateTypeId: 844,
                certificateTypeName: "产品标识符",
                isRequired: 1,
                reviewState: 2,
              },
            ],
          }],
          ruleSnapshotsBySkc: {
            "SKC-1": {
              fetchedAt: "2026-08-06T01:00:00.000Z",
              expiresAt: "2026-08-07T01:00:00.000Z",
              fresh: true,
            },
          },
        };
      },
      async appendComplianceRevalidationReceipt(input) {
        persistedInput = input;
        return { id: "compliance-receipt-1", deduplicated: false };
      },
    },
  });

  const result = await service.revalidatePublishCompliance({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    spuName: "SPU-1",
    version: "VERSION-1",
  });

  assert.deepEqual(sourceInput, {
    tenantId: "tenant-1",
    storeId: "store-1",
    jobId: "job-1",
  });
  assert.equal(persistedInput.version, "VERSION-1");
  assert.equal(persistedInput.projection.status, "passed");
  assert.equal(result.persistence.receiptId, "compliance-receipt-1");
  assert.equal(result.completionEligible, true);
});

test("compliance revalidation rejects ambiguous SPU readback task matches", async () => {
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    publishExecutionRepository: {
      async findApprovedReadbackJob() {
        throw new Error("SPU关系回读任务匹配不唯一");
      },
      async getComplianceRevalidationSource() {
        throw new Error("should not read compliance source");
      },
    },
  });

  await assert.rejects(
    service.revalidatePublishCompliance({
      context: { tenantId: "tenant-1" },
      storeId: "store-1",
      spuName: "SPU-1",
      version: "VERSION-1",
    }),
    (error) =>
      error.code === "COMPLIANCE_REVALIDATION_AMBIGUOUS" &&
      error.status === 409,
  );
});

test("web compliance reads keep unsupported GCC items visible", async () => {
  let call = 0;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    fetchImpl: async () => {
      call += 1;
      if (call === 1) {
        return response({
          code: "0",
          msg: "OK",
          info: {
            data: [
              {
                skcName: "SKC-1",
                items: [
                  {
                    certificateTypeCode: "GCCHGXX",
                    certificateTypeName: "GCC合规信息",
                    complianceGroupCode: "HGXXL",
                    isManualProductWarning: false,
                    isRequired: 1,
                    reviewState: 0,
                  },
                ],
              },
            ],
          },
        });
      }
      return response({
        code: "0",
        msg: "OK",
        info: [{ skc: "SKC-1", skcLabelInfoList: [] }],
      });
    },
  });

  const result = await service.queryCompliance({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skcNames: ["SKC-1"],
  });

  assert.equal(result.rows[0].platformOnly, "待补充");
  assert.equal(
    result.rows[0].unsupportedRequirements[0].certificateTypeCode,
    "GCCHGXX",
  );
});

test("background compliance reads accept multiple official batches", async () => {
  const calls = [];
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    fetchImpl: async (url, options) => {
      calls.push(JSON.parse(options.body));
      const path = new URL(url).pathname;
      if (path.endsWith("/list")) {
        return response({ code: "0", msg: "OK", info: { data: [] } });
      }
      return response({ code: "0", msg: "OK", info: [] });
    },
  });

  await service.syncCompliance({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skcNames: Array.from({ length: 21 }, (_, index) => `SKC-${index + 1}`),
  });

  assert.equal(calls.length, 4);
  assert.equal(calls[0].skcNames.length, 20);
  assert.equal(calls[2].skcNames.length, 1);
});

test("compliance detail persists sanitized active certificate library", async () => {
  const snapshots = [];
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    ruleSnapshotRepository: {
      async upsert(input) { snapshots.push(input); },
    },
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("goods-compliance-requirements/list")) {
        return response({ code: "0", msg: "OK", info: { data: [{
          skcName: "SKC-1",
          items: [{
            certificateTypeCode: "CE",
            complianceGroupCode: "ZSZZL",
            isRequired: 1,
            reviewState: 0,
          }],
        }] }, traceId: "requirement-trace" });
      }
      if (path.endsWith("skc-label-list")) {
        return response({ code: "0", msg: "OK", info: [{
          skc: "SKC-1",
          skcLabelInfoList: [],
        }] });
      }
      if (path.endsWith("goods-certificate-schemas/detail")) {
        return response({ code: "0", msg: "OK", info: {
          certificateTypeInfoList: [{ certificateTypeId: "ce-id", name: "CE" }],
          srmDetectionAgencyList: [],
        }, traceId: "schema-trace" });
      }
      if (path.endsWith("goods-certificates/search")) {
        return response({ code: "0", msg: "OK", info: { data: [{
          poolId: 11482836,
          poolSn: "ocp3437520192426127360",
          certificateTypeId: 7,
          certificateTypeCode: "CE",
          certificateTypeName: "RSL Chemical Test Report",
          status: 2,
          certificateDimension: 1,
          effectiveTime: "2027-01-01 00:00:00",
          invalidTime: "2031-12-31 00:00:00",
          alertTime: "2031-12-01 00:00:00",
          bindSkcFlag: 0,
          lastUpdateTime: "2026-06-29 10:29:30",
          fileList: [{ fileName: "test.pdf", fileUrl: "https://private.example/test.pdf", fileMd5: "secret-md5" }],
          presetInfoList: [{ presetId: 175, valueList: [{ value: "secret-value" }] }],
        }] }, traceId: "library-trace" });
      }
      return response({ code: "0", msg: "OK", info: { data: [] } });
    },
  });

  await service.getComplianceBundle({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.deepEqual(snapshots.map((item) => item.ruleType), [
    "compliance_requirement",
    "certificate_schema",
    "certificate_library",
  ]);
  assert.equal(snapshots[1].subjectKey, "SKC-1");
  assert.equal(snapshots[1].payload.certificateSchemas.length, 1);
  assert.equal("certificates" in snapshots[1].payload, false);
  assert.equal(snapshots[2].sourceTraceId, "library-trace");
  assert.deepEqual(snapshots[2].payload.certificates, [{
    poolId: 11482836,
    poolSn: "ocp3437520192426127360",
    certificateTypeId: 7,
    certificateTypeCode: "CE",
    certificateTypeName: "RSL Chemical Test Report",
    status: 2,
    certificateDimension: 1,
    effectiveTime: "2027-01-01 00:00:00",
    invalidTime: "2031-12-31 00:00:00",
    alertTime: "2031-12-01 00:00:00",
    bindSkcFlag: 0,
    lastUpdateTime: "2026-06-29 10:29:30",
    fileNames: ["test.pdf"],
  }]);
  assert.equal(JSON.stringify(snapshots[2].payload).includes("fileUrl"), false);
  assert.equal(JSON.stringify(snapshots[2].payload).includes("fileMd5"), false);
  assert.equal(JSON.stringify(snapshots[2].payload).includes("secret-value"), false);
});

test("compliance detail persists only bindable agency metadata", async () => {
  const snapshots = [];
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    ruleSnapshotRepository: {
      async upsert(input) { snapshots.push(input); },
    },
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("goods-compliance-requirements/list")) {
        return response({ code: "0", msg: "OK", info: { data: [{
          skcName: "SKC-AGENCY",
          items: [{
            certificateTypeCode: "EuRespPerson",
            complianceGroupCode: "GSL",
            isRequired: 1,
            reviewState: 0,
          }],
        }] } });
      }
      if (path.endsWith("skc-label-list")) {
        return response({ code: "0", msg: "OK", info: [{
          skc: "SKC-AGENCY",
          skcLabelInfoList: [],
        }] });
      }
      if (path.endsWith("goods-compliance/agency-list")) {
        return response({ code: "0", msg: "OK", info: [{
          agencyId: 118021903,
          agencyName: "欧盟责任人A",
          agencyType: 0,
          agencySubType: 20,
          agencyStartTime: "2025-11-05",
          agencyEndTime: "2031-11-30",
          agencyStatus: 0,
          applyStatus: 2,
          coveredProductRange: 2,
          updateTime: "2025-11-05 17:48:00",
          agencyAgreementUrl: "https://private.example/agreement.pdf",
          contactName: "private contact",
          telephone: "18212340001",
          email: "private@example.com",
          agencyDetailAddress: "private address",
          supplierId: 38109363,
        }, {
          agencyId: 118021904,
          agencyName: "已过期公司",
          agencyStatus: 1,
          applyStatus: 2,
          coveredProductRange: 2,
        }], traceId: "agency-trace" });
      }
      return response({ code: "0", msg: "OK", info: [] });
    },
  });

  await service.getComplianceBundle({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skc: "SKC-AGENCY",
  });

  const snapshot = snapshots.find((item) => item.ruleType === "agency_library");
  assert.equal(snapshot.sourceTraceId, "agency-trace");
  assert.deepEqual(snapshot.payload.agencies, [{
    agencyId: 118021903,
    agencyName: "欧盟责任人A",
    agencyType: 0,
    agencySubType: 20,
    agencyStartTime: "2025-11-05",
    agencyEndTime: "2031-11-30",
    agencyStatus: 0,
    applyStatus: 2,
    coveredProductRange: 2,
    updateTime: "2025-11-05 17:48:00",
  }]);
  const serialized = JSON.stringify(snapshot.payload);
  for (const field of ["agencyAgreementUrl", "contactName", "telephone", "email", "agencyDetailAddress", "supplierId"]) {
    assert.equal(serialized.includes(field), false);
  }
});

test("compliance detail persists only enabled warning rules for the SKC", async () => {
  const snapshots = [];
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    ruleSnapshotRepository: {
      async upsert(input) { snapshots.push(input); },
    },
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("goods-compliance-requirements/list")) {
        return response({ code: "0", msg: "OK", info: { data: [{
          skcName: "SKC-WARNING",
          items: [{
            certificateTypeId: 900,
            certificateTypeCode: "RUG-WARNING",
            certificateTypeName: "地毯警示语",
            complianceGroupCode: "HGXXL",
            isManualProductWarning: true,
            isRequired: 1,
            reviewState: 0,
          }],
        }] } });
      }
      if (path.endsWith("skc-label-list")) {
        return response({ code: "0", msg: "OK", info: [{
          skc: "SKC-WARNING",
          skcLabelInfoList: [],
        }] });
      }
      if (path.endsWith("query-warning-certificate-rules")) {
        return response({ code: "0", msg: "OK", info: [{
          certificateTypeId: 900,
          certificateTypeCode: "RUG-WARNING",
          certificateTypeName: "地毯警示语",
          presetInfo: {
            isEnabled: 1,
            presetFields: [{
              fieldCode: "MATERIAL",
              fieldName: "商品属性",
              fieldType: 0,
              fieldSort: 0,
              isEnabled: 1,
              presetFieldValues: [{
                fieldValueId: 10,
                fieldValue: "含防滑背衬",
                exclusionFieldValueIds: [11],
                mappingPaths: null,
                valueSort: 0,
                isEnabled: 1,
              }, {
                fieldValueId: 11,
                fieldValue: "已停用值",
                isEnabled: 0,
              }],
            }, {
              fieldCode: "WARNING",
              fieldName: "警示语",
              fieldType: 2,
              fieldSort: 1,
              isEnabled: 1,
              presetFieldValues: [{
                fieldValueId: 20,
                fieldValue: "注意防滑",
                exclusionFieldValueIds: null,
                mappingPaths: [{ fieldValueIds: [10] }],
                valueSort: 0,
                isEnabled: 1,
              }],
            }, {
              fieldCode: "DISABLED",
              fieldName: "停用字段",
              fieldSort: 2,
              isEnabled: 0,
              presetFieldValues: [],
            }],
          },
        }, {
          certificateTypeId: 901,
          certificateTypeCode: "OTHER-WARNING",
          presetInfo: { isEnabled: 1, presetFields: [] },
        }], traceId: "warning-trace" });
      }
      return response({ code: "0", msg: "OK", info: [] });
    },
  });

  await service.getComplianceBundle({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skc: "SKC-WARNING",
  });

  const snapshot = snapshots.find((item) => item.ruleType === "warning_rules");
  assert.equal(snapshot.sourceTraceId, "warning-trace");
  assert.deepEqual(snapshot.payload.warningRules, [{
    certificateTypeId: 900,
    certificateTypeCode: "RUG-WARNING",
    certificateTypeName: "地毯警示语",
    fields: [{
      fieldCode: "MATERIAL",
      fieldName: "商品属性",
      fieldType: 0,
      fieldSort: 0,
      values: [{
        fieldValueId: 10,
        fieldValue: "含防滑背衬",
        exclusionFieldValueIds: [11],
        mappingPaths: [],
        valueSort: 0,
      }],
    }, {
      fieldCode: "WARNING",
      fieldName: "警示语",
      fieldType: 2,
      fieldSort: 1,
      values: [{
        fieldValueId: 20,
        fieldValue: "注意防滑",
        exclusionFieldValueIds: [],
        mappingPaths: [{ fieldValueIds: [10] }],
        valueSort: 0,
      }],
    }],
  }]);
});

test("associated attribute rules use the official linked-rule request contract", async () => {
  let request;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ code: "0", msg: "OK", info: { data: [] } });
    },
  });

  await service.getAssociatedAttributeRules({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    categoryId: "3155",
    productTypeId: "991",
    attributeList: [
      { attributeId: "10", attributeValueId: "20" },
      { attributeId: "11" },
    ],
  });

  assert.equal(
    new URL(request.url).pathname,
    "/open-api/goods/get-associated-attribute-rules",
  );
  assert.deepEqual(
    JSON.parse(request.options.body).get_linked_rule_req_list,
    [{
      group_id: "template",
      category_id: "3155",
      product_type_id: "991",
      attribute_list: [
        { attribute_id: "10", attribute_value_id: "20" },
        { attribute_id: "11" },
      ],
    }],
  );
});

test("publish category and schema rules are cached and concurrent reads are deduplicated", async () => {
  const calls = [];
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    fetchImpl: async (url) => {
      calls.push(new URL(url).pathname);
      return response({ code: "0", msg: "OK", info: { data: [] } });
    },
  });
  const context = { tenantId: "tenant-1", role: "admin" };

  await Promise.all([
    service.getPublishCategories({ context, storeId: "store-1" }),
    service.getPublishCategories({ context, storeId: "store-1" }),
  ]);
  await Promise.all([
    service.getPublishSchema({ context, storeId: "store-1", categoryId: "3155", productTypeId: "991" }),
    service.getPublishSchema({ context, storeId: "store-1", categoryId: "3155", productTypeId: "991" }),
  ]);
  await service.getPublishCategories({ context, storeId: "store-1" });
  await service.getPublishSchema({ context, storeId: "store-1", categoryId: "3155", productTypeId: "991" });

  assert.deepEqual(calls, [
    "/open-api/goods/query-category-tree",
    "/open-api/goods/query-attribute-template",
    "/open-api/goods/query-publish-fill-in-standard",
  ]);
});

test("publish schema locks the source-pending custom sale-value permission read", async () => {
  const calls = [];
  const writes = [];
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    ruleSnapshotRepository: {
      async getFresh(input) {
        if (input.ruleType === "publish_standard") {
          return {
            payload: {
              __customAttributePermissions: {
                data: [{ attribute_id: 27, allow_custom_value: true }],
              },
            },
          };
        }
        return null;
      },
      async upsert(input) { writes.push(input); },
    },
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      calls.push({ path, body: JSON.parse(options.body) });
      if (path.endsWith("query-attribute-template")) {
        return response({
          code: "0",
          msg: "OK",
          info: {
            data: [{
              product_type_id: "8658",
              attribute_infos: [
                { attribute_id: 27, attribute_type: 1 },
                { attribute_id: 87, attribute_type: 1 },
                { attribute_id: 55, attribute_type: 2 },
              ],
            }],
          },
        });
      }
      return response({ code: "0", msg: "OK", info: {} });
    },
  });

  const result = await service.getPublishSchema({
    context: { tenantId: "tenant-1", role: "admin" },
    storeId: "store-1",
    categoryId: "11932",
    productTypeId: "8658",
  });

  assert.deepEqual(result.customAttributePermissions, {});
  assert.equal(
    calls.some((call) => call.path.endsWith("get-custom-attribute-permission-config")),
    false,
  );
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "ERP07_ADAPTER_SOURCE_PENDING_READ_DISABLED"));
  assert.equal(
    writes.some((write) => write.ruleType === "custom_attribute_permission"),
    false,
  );
  assert.equal(
    Object.hasOwn(
      writes.filter((write) => write.ruleType === "publish_standard").at(-1)
        ?.payload || {},
      "__customAttributePermissions",
    ),
    false,
  );
});

test("publish rules reuse persistent snapshots across service instances", async () => {
  const snapshots = new Map();
  const key = (input) => [
    input.tenantId,
    input.storeId,
    input.ruleType,
    input.categoryId || "",
    input.productTypeId || "",
    input.subjectKey || "",
  ].join(":");
  const ruleSnapshotRepository = {
    async getFresh(input) { return snapshots.get(key(input)) || null; },
    async upsert(input) {
      snapshots.set(key(input), {
        payload: input.payload,
        source_trace_id: input.sourceTraceId,
        fetched_at: input.fetchedAt,
      });
    },
  };
  const storeRepository = {
    async getCredential() {
      return {
        storeId: "store-1",
        tenantId: "tenant-1",
        status: "active",
        openKeyId: "OPEN-1",
        secretKey: "SECRET-1",
      };
    },
  };
  const calls = [];
  const first = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository,
    ruleSnapshotRepository,
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      calls.push(path);
      return response({ code: "0", msg: "OK", info: { path } });
    },
  });
  const context = { tenantId: "tenant-1", role: "admin" };
  await first.getPublishCategories({ context, storeId: "store-1" });
  await first.getPublishSchema({
    context,
    storeId: "store-1",
    categoryId: "3155",
    productTypeId: "991",
  });

  const second = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository,
    ruleSnapshotRepository,
    fetchImpl: async () => { throw new Error("persistent cache missed"); },
  });
  const categories = await second.getPublishCategories({ context, storeId: "store-1" });
  const schema = await second.getPublishSchema({
    context,
    storeId: "store-1",
    categoryId: "3155",
    productTypeId: "991",
  });

  assert.equal(categories.info.path, "/open-api/goods/query-category-tree");
  assert.equal(schema.attributes.path, "/open-api/goods/query-attribute-template");
  assert.equal(schema.publishStandard.path, "/open-api/goods/query-publish-fill-in-standard");
  assert.equal(snapshots.size, 3);
  assert.equal(calls.length, 3);
});

test("non-admin stores reuse administrator-synced publish rules within the tenant", async () => {
  const snapshots = new Map();
  const key = (input) => [
    input.tenantId,
    input.ruleType,
    input.categoryId || "",
    input.productTypeId || "",
    input.subjectKey || "",
  ].join(":");
  const ruleSnapshotRepository = {
    async getFresh(input) {
      if (input.shareWithinTenant) return snapshots.get(key(input)) || null;
      return snapshots.get(`${key(input)}:${input.storeId}`) || null;
    },
    async upsert(input) {
      snapshots.set(key(input), {
        payload: input.payload,
        source_trace_id: input.sourceTraceId,
        fetched_at: input.fetchedAt,
      });
    },
  };
  const storeRepository = {
    async getCredential(storeId) {
      return {
        storeId,
        tenantId: "tenant-1",
        status: "active",
        openKeyId: "OPEN-1",
        secretKey: "SECRET-1",
      };
    },
  };
  const first = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository,
    ruleSnapshotRepository,
    fetchImpl: async (url) => response({
      code: "0",
      msg: "OK",
      info: { path: new URL(url).pathname },
    }),
  });
  const adminContext = { tenantId: "tenant-1", role: "admin" };
  await first.getPublishCategories({ context: adminContext, storeId: "store-1" });
  await first.getPublishSchema({
    context: adminContext,
    storeId: "store-1",
    categoryId: "3155",
    productTypeId: "991",
  });

  const second = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository,
    ruleSnapshotRepository,
    fetchImpl: async () => { throw new Error("member must not fetch SHEIN"); },
  });
  const memberContext = { tenantId: "tenant-1", role: "operator" };
  const categories = await second.getPublishCategories({
    context: memberContext,
    storeId: "store-2",
  });
  const schema = await second.getPublishSchema({
    context: memberContext,
    storeId: "store-2",
    categoryId: "3155",
    productTypeId: "991",
  });

  assert.equal(categories.diagnostics.source, "database-cache");
  assert.ok(schema.diagnostics.every((diagnostic) => diagnostic.source === "database-cache"));
});

test("non-admin rule reads never fetch SHEIN when the persistent snapshot is missing", async () => {
  let fetches = 0;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    ruleSnapshotRepository: {
      async getFresh() { return null; },
      async upsert() { throw new Error("must not write a remote result"); },
    },
    fetchImpl: async () => {
      fetches += 1;
      return response({ code: "0", msg: "OK", info: {} });
    },
  });

  await assert.rejects(
    service.getPublishCategories({
      context: { tenantId: "tenant-1", role: "operator" },
      storeId: "store-1",
    }),
    (error) =>
      error.code === "RULE_SYNC_REQUIRED" &&
      error.status === 409 &&
      error.message.includes("管理员"),
  );
  assert.equal(fetches, 0);
});

test("publish rule memory cache never bypasses tenant ownership validation", async () => {
  let tenantId = "tenant-1";
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId,
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    fetchImpl: async () => response({ code: "0", msg: "OK", info: { data: [] } }),
  });

  await service.getPublishCategories({
    context: { tenantId: "tenant-1", role: "admin" },
    storeId: "store-1",
  });
  await assert.rejects(
    service.getPublishCategories({
      context: { tenantId: "tenant-2" },
      storeId: "store-1",
    }),
    (error) => error.code === "STORE_UNAVAILABLE",
  );
});

test("forced category refresh bypasses memory and persistent cache", async () => {
  let fetches = 0;
  let writes = 0;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    ruleSnapshotRepository: {
      async getFresh() {
        return { payload: { source: "old" }, source_trace_id: "old-trace" };
      },
      async upsert() { writes += 1; },
    },
    fetchImpl: async () => {
      fetches += 1;
      return response({ code: "0", msg: "OK", info: { source: "live" } });
    },
  });
  const input = { context: { tenantId: "tenant-1", role: "admin" }, storeId: "store-1" };

  assert.equal((await service.getPublishCategories(input)).info.source, "old");
  assert.equal((await service.getPublishCategories({ ...input, forceRefresh: true })).info.source, "live");
  assert.equal(fetches, 1);
  assert.equal(writes, 1);
});

test("forced category refresh does not retain its large payload in memory", async () => {
  let fetches = 0;
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    ruleSnapshotRepository: {
      async getFresh() { return null; },
      async upsert() {},
    },
    fetchImpl: async () => {
      fetches += 1;
      return response({ code: "0", msg: "OK", info: { fetches } });
    },
  });
  const input = { context: { tenantId: "tenant-1", role: "admin" }, storeId: "store-1" };

  assert.equal(
    (await service.getPublishCategories({ ...input, forceRefresh: true })).info.fetches,
    1,
  );
  assert.equal(
    (await service.getPublishCategories(input)).info.fetches,
    2,
  );
});

test("price discussions preserve official per-SKU sizes and suggested prices, then accept or reject with confirmInfos", async () => {
  const calls = [];
  const service = new SheinWebReadService({
    apiBaseUrl: "https://openapi.example",
    storeRepository: {
      async getCredential() {
        return {
          storeId: "store-1",
          tenantId: "tenant-1",
          status: "active",
          openKeyId: "OPEN-1",
          secretKey: "SECRET-1",
        };
      },
    },
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      calls.push({ path, body: JSON.parse(options.body) });
      if (path.endsWith("query-discuss-list")) {
        return response({
          code: "0",
          info: {
            count: 1,
            data: [{
              discussSn: "DISCUSS-1",
              discussStatus: 1,
              skcName: "SKC-1",
              skuCostPrices: [{
                skuCode: "SKU-1",
                saleAttributeValues: ["40*60"],
                suggestCostPrice: 12.5,
                suggestCostCurrency: "EUR",
                costPriceHistories: [{ serialNumber: 1, costPrice: 14, currency: "EUR" }],
              }],
            }],
          },
        });
      }
      return response({ code: "0", info: { successCount: 1, failCount: 0 } });
    },
  });
  const list = await service.listPriceDiscussions({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
  });
  assert.equal(list.discussions[0].skuCostPrices[0].suggestCostPrice, 12.5);
  assert.equal(list.discussions[0].skuCostPrices[0].latestCostPrice, 14);
  assert.deepEqual(list.discussions[0].skuCostPrices[0].saleAttributeValues, ["40*60"]);
  const accepted = await service.acceptPriceDiscussion({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    discussSn: "DISCUSS-1",
  });
  assert.equal(accepted.successCount, 1);
  const rejected = await service.rejectPriceDiscussion({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    discussSn: "DISCUSS-2",
  });
  assert.equal(rejected.successCount, 1);
  assert.deepEqual(calls[0].body, { discussStatus: 1, pageNum: 1, pageSize: 100 });
  assert.deepEqual(calls[1].body, {
    confirmInfos: [{ discussAuditType: "1", discussSn: "DISCUSS-1" }],
  });
  assert.deepEqual(calls[2].body, {
    confirmInfos: [{ discussAuditType: "2", discussSn: "DISCUSS-2" }],
  });
});
