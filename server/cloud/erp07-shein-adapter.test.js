import assert from "node:assert/strict";
import test from "node:test";
import {
  ERP07_SHEIN_ADAPTER_CONTRACT_VERSION,
  Erp07SheinAdapter,
} from "./erp07-shein-adapter.js";

const scope = {
  tenantId: "tenant-1",
  storeId: "store-1",
  supplierId: "supplier-1",
};

const searchBody = { pageNum: 1, pageSize: 10 };
const publishBody = {
  category_id: "3155",
  skc_list: [{ skc_name: "SKC-1", sku_list: [] }],
};

function adapter(overrides = {}) {
  return new Erp07SheinAdapter({
    apiBaseUrl: "https://openapi.example",
    resolveCredentials: async () => ({
      openKeyId: "OPEN-1",
      secretKey: "SECRET-1",
    }),
    readEnabled: true,
    ...overrides,
  });
}

test("ERP-07 adapter is disabled by default and performs zero credential or transport calls", async () => {
  let credentialCalls = 0;
  let transportCalls = 0;
  const remote = new Erp07SheinAdapter({
    resolveCredentials: async () => {
      credentialCalls += 1;
      return { openKeyId: "OPEN-1", secretKey: "SECRET-1" };
    },
    request: async () => {
      transportCalls += 1;
    },
  });

  await assert.rejects(
    remote.execute({
      endpoint: "product.search",
      body: searchBody,
      scope,
      traceId: "trace-disabled",
    }),
    (error) => error.code === "ERP07_ADAPTER_REMOTE_DISABLED",
  );
  assert.equal(credentialCalls, 0);
  assert.equal(transportCalls, 0);
});

test("ERP-07 adapter validates request schema before credentials or transport", async () => {
  let credentialCalls = 0;
  let transportCalls = 0;
  const remote = adapter({
    resolveCredentials: async () => {
      credentialCalls += 1;
      return { openKeyId: "OPEN-1", secretKey: "SECRET-1" };
    },
    request: async () => {
      transportCalls += 1;
    },
  });

  await assert.rejects(
    remote.execute({
      endpoint: "product.search",
      body: { pageNum: 1 },
      scope,
      traceId: "trace-invalid-request",
    }),
    (error) => error.code === "ERP07_ADAPTER_REQUEST_SCHEMA_INVALID",
  );
  assert.equal(credentialCalls, 0);
  assert.equal(transportCalls, 0);
});

test("ERP-07 adapter blocks frozen endpoints before credentials or transport", async () => {
  let credentialCalls = 0;
  let transportCalls = 0;
  const remote = adapter({
    resolveCredentials: async () => {
      credentialCalls += 1;
      return { openKeyId: "OPEN-1", secretKey: "SECRET-1" };
    },
    request: async () => {
      transportCalls += 1;
    },
  });

  await assert.rejects(
    remote.execute({
      endpoint: "pricing.discussion_list",
      body: {},
      scope,
      traceId: "trace-blocked",
    }),
    (error) => error.code === "ERP07_ENDPOINT_STATUS_BLOCKED",
  );
  assert.equal(credentialCalls, 0);
  assert.equal(transportCalls, 0);
});

test("ERP-07 adapter sends one schema-validated read request and returns no credentials", async () => {
  const requests = [];
  const remote = adapter({
    request: async (input) => {
      requests.push(input);
      return {
        status: 200,
        payload: {
          code: "0",
          msg: "OK",
          traceId: "trace-read-success",
          info: { count: 1, data: [{ spuName: "SPU-1" }] },
        },
        diagnostics: {
          status: 200,
          code: "0",
          traceId: "trace-read-success",
          durationMs: 12,
        },
      };
    },
  });

  const result = await remote.execute({
    endpoint: "product.search",
    body: searchBody,
    scope,
    traceId: "trace-read-success",
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    baseUrl: "https://openapi.example",
    method: "POST",
    path: "/open-api/goods/searchProduct",
    body: searchBody,
    openKeyId: "OPEN-1",
    secretKey: "SECRET-1",
    language: "zh-cn",
    timeoutMs: 15_000,
  });
  assert.equal(result.adapterContractVersion, ERP07_SHEIN_ADAPTER_CONTRACT_VERSION);
  assert.equal(result.outcome, "read_success");
  assert.equal(result.payload.info.count, 1);
  assert.equal(result.diagnostics.durationMs, 12);
  assert.doesNotMatch(JSON.stringify(result), /OPEN-1|SECRET-1/);
});

test("ERP-07 adapter keeps business writes disabled even when reads are enabled", async () => {
  let transportCalls = 0;
  const remote = adapter({
    request: async () => {
      transportCalls += 1;
      return { status: 200, payload: { code: "0", traceId: "trace-write" } };
    },
  });

  await assert.rejects(
    remote.execute({
      endpoint: "product.publish_or_edit",
      body: publishBody,
      scope,
      traceId: "trace-write-disabled",
      allowWrite: true,
    }),
    (error) => error.code === "ERP07_ADAPTER_BUSINESS_WRITE_DISABLED",
  );
  assert.equal(transportCalls, 0);
});

test("ERP-07 adapter permits an explicitly enabled one-time write and still requires evidence", async () => {
  const remote = adapter({
    writeEnabled: true,
    request: async () => ({
      status: 200,
      payload: {
        code: "0",
        msg: "OK",
        traceId: "trace-write-accepted",
        info: { success: true },
      },
    }),
  });

  const result = await remote.execute({
    endpoint: "product.publish_or_edit",
    body: publishBody,
    scope,
    traceId: "trace-write-accepted",
    allowWrite: true,
    acceptedEvidence: true,
    sendBoundary: "after_send",
  });

  assert.equal(result.outcome, "accepted");
  assert.equal(result.effective, false);
  assert.equal(result.payload.info.success, true);
});

test("ERP-07 adapter converts missing write evidence to result_unknown and never retries", async () => {
  let transportCalls = 0;
  const remote = adapter({
    writeEnabled: true,
    request: async () => {
      transportCalls += 1;
      return {
        status: 200,
        payload: { code: "0", msg: "OK", traceId: "trace-write-unknown", info: {} },
      };
    },
  });

  const result = await remote.execute({
    endpoint: "product.publish_or_edit",
    body: publishBody,
    scope,
    traceId: "trace-write-unknown",
    allowWrite: true,
    sendBoundary: "after_send",
  });

  assert.equal(transportCalls, 1);
  assert.equal(result.outcome, "result_unknown");
  assert.equal(result.retryClass, "readback_only");
  assert.equal(result.payload, undefined);
});

test("ERP-07 adapter preserves transient upstream identity as result_unknown after send", async () => {
  const upstream = Object.assign(new Error("网关超时"), {
    status: 504,
    code: "NETWORK_TIMEOUT",
    traceId: "trace-timeout",
  });
  const remote = adapter({
    writeEnabled: true,
    request: async () => {
      throw upstream;
    },
  });

  const result = await remote.execute({
    endpoint: "product.publish_or_edit",
    body: publishBody,
    scope,
    traceId: "trace-timeout",
    allowWrite: true,
    sendBoundary: "after_send",
  });

  assert.equal(result.outcome, "result_unknown");
  assert.equal(result.code, "NETWORK_TIMEOUT");
  assert.equal(result.traceId, "trace-timeout");
  assert.equal(result.retryClass, "readback_only");
});

test("ERP-07 adapter preserves terminal upstream failure classification", async () => {
  const remote = adapter({
    request: async () => ({
      status: 200,
      payload: {
        code: "BUSINESS_REJECTED",
        msg: "业务条件不满足",
        traceId: "trace-business-failure",
      },
    }),
  });

  const result = await remote.execute({
    endpoint: "product.search",
    body: searchBody,
    scope,
    traceId: "trace-business-failure",
  });

  assert.equal(result.outcome, "known_failed");
  assert.equal(result.code, "BUSINESS_REJECTED");
  assert.equal(result.traceId, "trace-business-failure");
  assert.equal(result.message, "业务条件不满足");
});

test("ERP-07 adapter rejects an invalid response schema without exposing the response", async () => {
  const remote = adapter({
    request: async () => ({
      status: 200,
      payload: {
        code: "0",
        traceId: "trace-invalid-response",
        info: "not-an-object-or-array",
      },
    }),
  });

  await assert.rejects(
    remote.execute({
      endpoint: "product.search",
      body: searchBody,
      scope,
      traceId: "trace-invalid-response",
    }),
    (error) => error.code === "ERP07_ADAPTER_RESPONSE_SCHEMA_INVALID" &&
      !/not-an-object-or-array/.test(JSON.stringify(error)),
  );
});

test("ERP-07 adapter rejects an invalid send boundary instead of guessing", async () => {
  const remote = adapter({ request: async () => ({}) });

  await assert.rejects(
    remote.execute({
      endpoint: "product.search",
      body: searchBody,
      scope,
      traceId: "trace-invalid-boundary",
      sendBoundary: "sent-somehow",
    }),
    (error) => error.code === "ERP07_ADAPTER_SEND_BOUNDARY_INVALID",
  );
});

test("ERP-07 adapter requires an injected transport when enabled", async () => {
  const remote = adapter({ request: null });

  await assert.rejects(
    remote.execute({
      endpoint: "product.search",
      body: searchBody,
      scope,
      traceId: "trace-no-transport",
    }),
    (error) => error.code === "ERP07_ADAPTER_TRANSPORT_REQUIRED",
  );
});
