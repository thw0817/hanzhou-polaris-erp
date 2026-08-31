import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  AUTHORIZED_STORE_LOOKUP_SQL,
  ERP07_READ_ONLY_EVIDENCE_RUNNER_VERSION,
  ERP07_READ_ONLY_CONFIRMATION,
  ERP07_SOURCE_PENDING_CONFIRMATION,
  resolveAuthorizedStoreFromDatabase,
  resolvePlatformIdentityFromDatabase,
  runErp07ReadOnlyEvidence,
  runErp07ReadOnlyEvidenceCli,
} from "./erp07-read-only-evidence-runner.js";
import { CloudCredentialCipher } from "./credential-cipher.js";

const scope = {
  tenantId: "tenant-1",
  storeId: "store-1",
  supplierId: "14152389",
};

function successfulPayload(path) {
  if (path === "/open-api/goods/spu-info") {
    return {
      code: "0",
      msg: "OK",
      traceId: "trace-spu-info",
      info: {
        spuName: "SPU-PRIVATE",
        skcInfoList: [
          {
            skcName: "sf260512004051439215577",
            skuInfoList: [
              { skuCode: "SKU-TARGET-1" },
              { skuCode: "SKU-TARGET-2" },
            ],
          },
          {
            skcName: "SKC-OTHER",
            skuInfoList: [{ skuCode: "SKU-OTHER" }],
          },
        ],
      },
    };
  }
  if (path === "/open-api/goods/query-sku-sales") {
    return {
      code: "0",
      msg: "OK",
      traceId: "trace-sales",
      info: {
        dataList: [{
          skuCode: "SKU-PRIVATE",
          realTimeSaleCnt: 1,
          cydSaleCnt: 2,
          c7dSaleCnt: 7,
          c30dSaleCnt: 30,
          dt: "20260830",
        }],
      },
    };
  }
  if (path === "/open-api/goods-publish-quotas/detail") {
    return {
      code: "0",
      msg: "OK",
      traceId: "trace-quota",
      info: {
        isControlled: true,
        totalQuota: 3,
        usedCount: 0,
        availableQuota: 3,
      },
    };
  }
  return {
    code: "0",
    msg: "OK",
    traceId: "trace-document",
    info: {
      data: [{
        spuName: "SPU-PRIVATE",
        version: "VERSION-PRIVATE",
        skcList: [{
          skcName: "SKC-PRIVATE",
          documentSn: "DOC-PRIVATE",
          documentState: 1,
          failedReason: [],
        }],
      }],
      meta: { count: 1, customObj: null },
    },
  };
}

function runnerOptions(overrides = {}) {
  const requests = [];
  return {
    supplierId: "14152389",
    skc: "sf260512004051439215577",
    documentStateIdentity: {
      spuName: "SPU-PRIVATE",
      version: "VERSION-PRIVATE",
    },
    apiBaseUrl: "https://openapi.sheincorp.cn",
    now: () => new Date("2026-08-30T12:00:00.000Z"),
    resolveAuthorization: async () => ({
      scope,
      credentials: {
        openKeyId: "OPEN-PRIVATE",
        secretKey: "SECRET-PRIVATE",
      },
    }),
    request: async (input) => {
      requests.push(input);
      return {
        status: 200,
        payload: successfulPayload(input.path),
      };
    },
    ...overrides,
    requests,
  };
}

test("ERP-07 evidence runner resolves target SKC SKU codes before sales read", async () => {
  const options = runnerOptions();
  await runErp07ReadOnlyEvidence(options);

  assert.deepEqual(
    options.requests.map(({ method, path, body }) => ({ method, path, body })),
    [
      {
        method: "POST",
        path: "/open-api/goods/spu-info",
        body: {
          languageList: ["zh-cn"],
          spuName: "SPU-PRIVATE",
        },
      },
      {
        method: "POST",
        path: "/open-api/goods/query-sku-sales",
        body: {
          skuCodeList: ["SKU-TARGET-1", "SKU-TARGET-2"],
        },
      },
      {
        method: "POST",
        path: "/open-api/goods-publish-quotas/detail",
        body: {},
      },
      {
        method: "POST",
        path: "/open-api/goods/query-document-state",
        body: {
          spuList: [{
            spuName: "SPU-PRIVATE",
            version: "VERSION-PRIVATE",
          }],
        },
      },
    ],
  );
});

test("ERP-07 evidence runner performs scoped SKU, quota, and document reads", async () => {
  const options = runnerOptions();
  const result = await runErp07ReadOnlyEvidence(options);

  assert.equal(result.runnerVersion, ERP07_READ_ONLY_EVIDENCE_RUNNER_VERSION);
  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.externalWrite, false);
  assert.equal(result.target.supplierIdDigestSha256.length, 64);
  assert.equal(result.target.skcDigestSha256.length, 64);
  assert.deepEqual(
    options.requests.map(({ method, path, body }) => ({ method, path, body })),
    [
      {
        method: "POST",
        path: "/open-api/goods/spu-info",
        body: {
          languageList: ["zh-cn"],
          spuName: "SPU-PRIVATE",
        },
      },
      {
        method: "POST",
        path: "/open-api/goods/query-sku-sales",
        body: { skuCodeList: ["SKU-TARGET-1", "SKU-TARGET-2"] },
      },
      {
        method: "POST",
        path: "/open-api/goods-publish-quotas/detail",
        body: {},
      },
      {
        method: "POST",
        path: "/open-api/goods/query-document-state",
        body: {
          spuList: [{
            spuName: "SPU-PRIVATE",
            version: "VERSION-PRIVATE",
          }],
        },
      },
    ],
  );
  assert.deepEqual(
    result.endpoints.map(({ endpoint, outcome }) => ({ endpoint, outcome })),
    [
      { endpoint: "product.spu_info", outcome: "read_success" },
      { endpoint: "sales.sku", outcome: "read_success" },
      { endpoint: "preflight.publish_quota", outcome: "read_success" },
      { endpoint: "review.document_state", outcome: "read_success" },
    ],
  );
});

test("ERP-07 evidence runner never returns credentials, scope, request body, or raw payload", async () => {
  const options = runnerOptions();
  const result = await runErp07ReadOnlyEvidence(options);
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /OPEN-PRIVATE|SECRET-PRIVATE|tenant-1|store-1/);
  assert.doesNotMatch(serialized, /SKU-PRIVATE|SPU-PRIVATE|SKC-PRIVATE|DOC-PRIVATE/);
  assert.doesNotMatch(serialized, /skcNameList/);
  assert.match(serialized, /responseDigestSha256/);
  assert.match(serialized, /sourceRefDigestSha256/);
  assert.match(serialized, /scopeDigestSha256/);
  assert.match(serialized, /fieldCoverage/);
});

test("ERP-07 evidence runner does not send document-state without SPU and version", async () => {
  const options = runnerOptions({ documentStateIdentity: null });
  const result = await runErp07ReadOnlyEvidence(options);

  assert.deepEqual(
    options.requests.map(({ path }) => path),
    [
      "/open-api/goods-publish-quotas/detail",
    ],
  );
  assert.equal(
    result.endpoints.find((endpoint) => endpoint.endpoint === "product.spu_info").outcome,
    "input_required",
  );
  assert.equal(
    result.endpoints.find((endpoint) => endpoint.endpoint === "sales.sku").outcome,
    "input_required",
  );
  assert.equal(
    result.endpoints.find((endpoint) => endpoint.endpoint === "sales.sku")
      .diagnostics.code,
    "ERP07_EVIDENCE_PLATFORM_IDENTITY_REQUIRED",
  );
  assert.equal(
    result.endpoints.find((endpoint) => endpoint.endpoint === "review.document_state").outcome,
    "input_required",
  );
  assert.equal(
    result.endpoints.find((endpoint) => endpoint.endpoint === "review.document_state")
      .diagnostics.code,
    "ERP07_EVIDENCE_PLATFORM_IDENTITY_REQUIRED",
  );
});

test("ERP-07 evidence runner blocks sales when SPU detail cannot map the target SKC", async () => {
  const options = runnerOptions({
    request: async (input) => {
      options.requests.push(input);
      if (input.path === "/open-api/goods/spu-info") {
        return {
          status: 200,
          payload: {
            code: "0",
            msg: "OK",
            traceId: "trace-spu-info-no-target",
            info: {
              spuName: "SPU-PRIVATE",
              skcInfoList: [{
                skcName: "SKC-OTHER",
                skuInfoList: [{ skuCode: "SKU-OTHER" }],
              }],
            },
          },
        };
      }
      return { status: 200, payload: successfulPayload(input.path) };
    },
  });
  const result = await runErp07ReadOnlyEvidence(options);

  assert.deepEqual(
    options.requests.map(({ path }) => path),
    [
      "/open-api/goods/spu-info",
      "/open-api/goods-publish-quotas/detail",
      "/open-api/goods/query-document-state",
    ],
  );
  assert.equal(
    result.endpoints.find((endpoint) => endpoint.endpoint === "sales.sku").outcome,
    "input_required",
  );
  assert.equal(
    result.endpoints.find((endpoint) => endpoint.endpoint === "sales.sku")
      .diagnostics.code,
    "ERP07_EVIDENCE_SKU_CODES_REQUIRED",
  );
});

test("ERP-07 evidence runner blocks sales when SPU detail read fails", async () => {
  const options = runnerOptions({
    request: async (input) => {
      options.requests.push(input);
      if (input.path === "/open-api/goods/spu-info") {
        return {
          status: 403,
          payload: {
            code: "openapi00001",
            msg: "无权限",
            traceId: "trace-spu-info-auth-failure",
          },
        };
      }
      return { status: 200, payload: successfulPayload(input.path) };
    },
  });
  const result = await runErp07ReadOnlyEvidence(options);

  assert.equal(
    options.requests.some(({ path }) => path === "/open-api/goods/query-sku-sales"),
    false,
  );
  assert.equal(
    result.endpoints.find((endpoint) => endpoint.endpoint === "sales.sku")
      .diagnostics.code,
    "ERP07_EVIDENCE_SKU_LOOKUP_FAILED",
  );
});

test("ERP-07 evidence runner fails closed for an incomplete authorization scope", async () => {
  await assert.rejects(
    runErp07ReadOnlyEvidence(runnerOptions({
      resolveAuthorization: async () => ({
        scope: { ...scope, storeId: "" },
        credentials: { openKeyId: "OPEN-PRIVATE", secretKey: "SECRET-PRIVATE" },
      }),
    })),
    (error) => error.code === "ERP07_EVIDENCE_SCOPE_MISMATCH",
  );
});

test("ERP-07 evidence runner never constructs a writable endpoint", async () => {
  const options = runnerOptions({
    request: async (input) => {
      assert.equal(input.method, "POST");
      assert.match(
        input.path,
        /^\/open-api\/(goods\/spu-info|goods\/query-sku-sales|goods-publish-quotas\/detail|goods\/query-document-state)$/,
      );
      return { status: 200, payload: successfulPayload(input.path) };
    },
  });

  await runErp07ReadOnlyEvidence(options);
});

test("ERP-07 database resolver performs one read-only scoped lookup and decrypts in process", async () => {
  const cipher = new CloudCredentialCipher({
    base64Key: crypto.randomBytes(32).toString("base64"),
  });
  const encrypted = cipher.encrypt("SECRET-PRIVATE", {
    storeId: "store-1",
    openKeyId: "OPEN-PRIVATE",
  });
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return {
        rowCount: 1,
        rows: [{
          id: "store-1",
          tenant_id: "tenant-1",
          supplier_id: "14152389",
          open_key_id: "OPEN-PRIVATE",
          status: "active",
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          auth_tag: encrypted.authTag,
          key_version: encrypted.keyVersion,
        }],
      };
    },
  };

  const authorization = await resolveAuthorizedStoreFromDatabase({
    pool,
    cipher,
    supplierId: "14152389",
    apiBaseUrl: "https://openapi.sheincorp.cn",
  });

  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, ["14152389"]);
  assert.match(queries[0].sql, /^\s*SELECT\b/i);
  assert.doesNotMatch(queries[0].sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  assert.deepEqual(authorization.scope, scope);
  assert.equal(authorization.credentials.openKeyId, "OPEN-PRIVATE");
  assert.equal(authorization.credentials.secretKey, "SECRET-PRIVATE");
});

test("ERP-07 database resolver fails closed when Supplier ID is ambiguous", async () => {
  const cipher = new CloudCredentialCipher({
    base64Key: crypto.randomBytes(32).toString("base64"),
  });
  await assert.rejects(
    resolveAuthorizedStoreFromDatabase({
      pool: {
        query: async () => ({ rowCount: 2, rows: [{}, {}] }),
      },
      cipher,
      supplierId: "14152389",
      apiBaseUrl: "https://openapi.sheincorp.cn",
    }),
    (error) => error.code === "ERP07_EVIDENCE_STORE_AMBIGUOUS",
  );
});

test("ERP-07 platform identity resolver only accepts one scoped SPU/version pair", async () => {
  const queries = [];
  const identity = await resolvePlatformIdentityFromDatabase({
    pool: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        return {
          rowCount: 1,
          rows: [{ spu_name: "SPU-PRIVATE", version: "VERSION-PRIVATE" }],
        };
      },
    },
    scope,
    skc: "sf260512004051439215577",
  });

  assert.deepEqual(identity, {
    spuName: "SPU-PRIVATE",
    version: "VERSION-PRIVATE",
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /^\s*SELECT\b/i);
  assert.doesNotMatch(queries[0].sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  assert.deepEqual(queries[0].params, [
    "tenant-1",
    "store-1",
    "sf260512004051439215577",
  ]);
});

test("ERP-07 CLI requires both exact read-only confirmations before runtime access", async () => {
  await assert.rejects(
    runErp07ReadOnlyEvidenceCli({
      env: {
        ERP07_EVIDENCE_SUPPLIER_ID: "14152389",
        ERP07_EVIDENCE_SKC: "sf260512004051439215577",
      },
    }),
    (error) => error.code === "ERP07_EVIDENCE_CONFIRMATION_REQUIRED",
  );
  assert.equal(ERP07_READ_ONLY_CONFIRMATION, "I_UNDERSTAND_READ_ONLY");
  assert.equal(ERP07_SOURCE_PENDING_CONFIRMATION, "I_UNDERSTAND_EVIDENCE");
  assert.match(AUTHORIZED_STORE_LOOKUP_SQL, /^\s*SELECT\b/i);
});
