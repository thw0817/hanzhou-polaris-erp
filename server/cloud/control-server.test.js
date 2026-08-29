import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { DeviceAuthError } from "./device-auth.js";
import { createCloudControlRequestHandler } from "./control-server.js";

function createRequest({
  method = "GET",
  url = "/",
  headers = {},
  body = null,
  remoteAddress = "127.0.0.1",
} = {}) {
  const request = Readable.from(
    body === null ? [] : [Buffer.from(body, "utf8")],
  );
  Object.assign(request, {
    method,
    url,
    headers,
    socket: { remoteAddress },
  });
  return request;
}

function createResponse() {
  return {
    status: null,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.status = status;
      this.headers = { ...this.headers, ...headers };
    },
    end(body) {
      this.body = body || "";
    },
  };
}

test("cloud control exposes a trace id without exposing diagnostic data", async () => {
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
  });
  const response = await invokeRaw(handler, {
    method: "GET",
    url: "/health",
    headers: { "x-request-id": "ui-request-1" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers["X-Trace-Id"], "ui-request-1");
  assert.equal(response.body, JSON.stringify({ ok: true, service: "shein-cloud-control" }));
});

test("cloud control accepts authenticated diagnostic batches through a hidden API-only route", async () => {
  let received = null;
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    webAuth: {
      async authenticate(token) {
        assert.equal(token, "session-token");
        return { tenantId: "tenant-1", userId: "user-1", role: "operator" };
      },
    },
    diagnosticEvents: {
      async recordClientEvents(input) {
        received = input;
        return { recorded: input.events.length };
      },
    },
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/diagnostics/events",
    headers: { cookie: "shein_web_session=session-token" },
    body: JSON.stringify({ events: [{ kind: "ui.click", action: "刷新" }] }),
  });

  assert.equal(response.status, 202);
  assert.deepEqual(received.context, {
    tenantId: "tenant-1",
    userId: "user-1",
    role: "operator",
  });
  assert.equal(received.events[0].action, "刷新");
});

test("cloud control protects hidden diagnostic reads with administrator access", async () => {
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    webAuth: {
      async authenticate() {
        return { tenantId: "tenant-1", userId: "user-1", role: "viewer" };
      },
    },
    diagnosticEvents: {
      async list() {
        throw new Error("viewer must not query diagnostics");
      },
    },
  });

  const response = await invoke(handler, {
    method: "GET",
    url: "/v1/internal/diagnostics/events",
    headers: { cookie: "shein_web_session=session-token" },
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.code, "ADMIN_REQUIRED");
});

async function invoke(handler, requestOptions) {
  const response = createResponse();
  await handler(createRequest(requestOptions), response);
  return {
    status: response.status,
    headers: response.headers,
    body: JSON.parse(response.body),
  };
}

async function invokeRaw(handler, requestOptions) {
  const response = createResponse();
  await handler(createRequest(requestOptions), response);
  return response;
}

test("cloud control liveness does not depend on PostgreSQL or Redis", async () => {
  const handler = createCloudControlRequestHandler({
    readiness: {
      check() {
        throw new Error("health must not query dependencies");
      },
    },
  });
  const response = await invoke(handler, { url: "/health" });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    service: "shein-cloud-control",
  });
});

test("cloud control readiness reports healthy dependencies", async () => {
  const handler = createCloudControlRequestHandler({
    readiness: {
      async check() {
        return {
          ok: true,
          dependencies: { postgres: "up", redis: "up" },
        };
      },
    },
  });
  const response = await invoke(handler, { url: "/ready" });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.dependencies, {
    postgres: "up",
    redis: "up",
  });
});

test("cloud control readiness returns 503 without leaking errors", async () => {
  const handler = createCloudControlRequestHandler({
    readiness: {
      async check() {
        return {
          ok: false,
          dependencies: { postgres: "down", redis: "up" },
        };
      },
    },
  });
  const response = await invoke(handler, { url: "/ready" });

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    ok: false,
    service: "shein-cloud-control",
    dependencies: { postgres: "down", redis: "up" },
  });
});

test("public auth routes delegate registration and password reset without a session", async () => {
  const calls = [];
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webRegistrationTenantId: "tenant-1",
    webAuth: {
      async resolvePublicRegistrationTenant(tenantId) {
        calls.push(["tenant", tenantId]);
        return { id: tenantId, name: "涵舟工作室" };
      },
      async register(input) {
        calls.push(["register", input]);
        return { registered: true, tenant: { id: input.tenantId, name: "涵舟工作室" }, user: { role: "operator" } };
      },
      async requestPasswordReset(input) {
        calls.push(["request-reset", input]);
        return { accepted: true };
      },
      async resetPassword(token, password) {
        calls.push(["confirm-reset", token, password]);
        return { reset: true };
      },
    },
  });

  const registration = await invoke(handler, {
    method: "POST",
    url: "/v1/web/register",
    remoteAddress: "127.0.0.2",
    headers: { origin: "https://app.hanzhou.icu", "content-type": "application/json" },
    body: JSON.stringify({ email: "new@example.com", password: "StrongPassword!2026" }),
  });
  const requestReset = await invoke(handler, {
    method: "POST",
    url: "/v1/web/password-reset/request",
    remoteAddress: "127.0.0.3",
    headers: { origin: "https://app.hanzhou.icu", "content-type": "application/json" },
    body: JSON.stringify({ email: "new@example.com" }),
  });
  const confirmReset = await invoke(handler, {
    method: "POST",
    url: "/v1/web/password-reset/confirm",
    remoteAddress: "127.0.0.4",
    headers: { origin: "https://app.hanzhou.icu", "content-type": "application/json" },
    body: JSON.stringify({ token: "swr_test", password: "StrongPassword!2026" }),
  });

  assert.equal(registration.status, 201);
  assert.equal(requestReset.status, 202);
  assert.equal(confirmReset.status, 200);
  assert.equal(calls[1][0], "register");
  assert.equal(calls[1][1].tenantId, "tenant-1");
  assert.deepEqual(calls.slice(2), [
    ["request-reset", { email: "new@example.com" }],
    ["confirm-reset", "swr_test", "StrongPassword!2026"],
  ]);
});

test("cloud control exposes no image, webhook, or write routes", async () => {
  const handler = createCloudControlRequestHandler({
    readiness: {
      async check() {
        return { ok: true, dependencies: {} };
      },
    },
  });

  for (const requestOptions of [
    { method: "POST", url: "/health" },
    { method: "POST", url: "/images" },
    {
      method: "POST",
      url: "/internal/webhooks/shein/product_delete_audit",
    },
  ]) {
    const response = await invoke(handler, requestOptions);
    assert.equal(response.status, 404);
  }
});

test("image-only mode freezes SHEIN web routes while leaving media routes available", async () => {
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    webSheinModulesEnabled: false,
  });
  const productResponse = await invoke(handler, {
    url: "/v1/web/stores/store-1/products",
  });
  const mediaResponse = await invoke(handler, {
    url: "/v1/web/stores/store-1/media",
  });

  assert.equal(productResponse.status, 404);
  assert.equal(productResponse.body.code, "SHEIN_WEB_MODULE_FROZEN");
  assert.equal(mediaResponse.status, 503);
  assert.equal(mediaResponse.body.code, "SERVICE_UNAVAILABLE");
});

test("store business dashboard stays read-only and available while SHEIN writes are frozen", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    webSheinModulesEnabled: false,
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess(received, storeId) {
        calls.push(["access", received.userId, storeId]);
      },
    },
    webStoreBusiness: {
      async startRefresh(input) {
        calls.push(["refresh", input.context.userId, input.storeId]);
        return {
          started: true,
          job: {
            id: "job-1",
            jobType: "store_business_refresh",
            state: "running",
          },
        };
      },
      async getDashboard(input) {
        calls.push(["dashboard", input.context.userId, input.storeId]);
        return { state: "refreshing", snapshot: null };
      },
    },
  });
  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/business-dashboard",
    headers: {
      cookie: "shein_web_session=session-token",
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: "{}",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    ["access", "user-1", "store-1"],
    ["refresh", "user-1", "store-1"],
    ["dashboard", "user-1", "store-1"],
  ]);
  assert.equal(response.body.refreshJob.id, "job-1");
});

test("V2 dashboard read opts out of the legacy empty-cache refresh", async () => {
  let dashboardInput = null;
  let refreshCalls = 0;
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess() {},
    },
    webStoreBusiness: {
      async startRefresh() { refreshCalls += 1; },
      async getDashboard(input) {
        dashboardInput = input;
        return { state: "idle", snapshot: null };
      },
    },
  });

  const response = await invoke(handler, {
    url: "/v1/web/stores/store-1/business-dashboard?refreshIfEmpty=0",
    headers: { cookie: "shein_web_session=session-token" },
  });

  assert.equal(response.status, 200);
  assert.equal(refreshCalls, 0);
  assert.equal(dashboardInput.refreshIfEmpty, false);
});

test("dashboard GET never starts an empty-cache refresh implicitly", async () => {
  let dashboardInput = null;
  let refreshCalls = 0;
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess() {},
    },
    webStoreBusiness: {
      async startRefresh() { refreshCalls += 1; },
      async getDashboard(input) {
        dashboardInput = input;
        return { state: "idle", snapshot: null };
      },
    },
  });

  const response = await invoke(handler, {
    url: "/v1/web/stores/store-1/business-dashboard",
    headers: { cookie: "shein_web_session=session-token" },
  });

  assert.equal(response.status, 200);
  assert.equal(refreshCalls, 0);
  assert.equal(dashboardInput.refreshIfEmpty, false);
});

test("sync job list and detail stay behind store access", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "viewer" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess(received, storeId) {
        calls.push(["access", received.tenantId, storeId]);
      },
    },
    webSyncJobs: {
      async list(input) {
        calls.push(["list", input.storeId, input.filters.state, input.filters.limit]);
        return { jobs: [{ id: "job-1" }], count: 1 };
      },
      async get(input) {
        calls.push(["detail", input.storeId, input.jobId]);
        return { job: { id: input.jobId, items: [] } };
      },
    },
  });

  const listResponse = await invoke(handler, {
    url: "/v1/web/stores/store-1/sync-jobs?state=failed&limit=20",
    headers: { cookie: "shein_web_session=session-token" },
  });
  const detailResponse = await invoke(handler, {
    url: "/v1/web/stores/store-1/sync-jobs/job-1",
    headers: { cookie: "shein_web_session=session-token" },
  });

  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.jobs[0].id, "job-1");
  assert.equal(detailResponse.status, 200);
  assert.equal(detailResponse.body.job.id, "job-1");
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["list", "store-1", "failed", "20"],
    ["access", "tenant-1", "store-1"],
    ["detail", "store-1", "job-1"],
  ]);
});

test("rule refresh endpoint checks store access and returns the queued job", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "admin" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess(received, storeId) {
        calls.push(["access", received.tenantId, storeId]);
      },
    },
    webRuleRefresh: {
      async startRefresh(input) {
        calls.push(["refresh", input.context.role, input.storeId]);
        return { started: true, job: { id: "job-1", jobType: "rule_refresh", state: "queued" } };
      },
    },
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/rules/refresh",
    headers: {
      cookie: "shein_web_session=session-token",
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: "{}",
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.job.id, "job-1");
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["refresh", "admin", "store-1"],
  ]);
});

test("rule and schema sync endpoints reject non-admin accounts after store access", async () => {
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  let refreshCalls = 0;
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess() {},
    },
    webRuleRefresh: {
      async startRefresh() { refreshCalls += 1; },
    },
  });

  for (const url of [
    "/v1/web/stores/store-1/rules/refresh",
    "/v1/web/stores/store-1/rules/refresh/retry",
    "/v1/web/stores/store-1/publish/schema-sync",
  ]) {
    const response = await invoke(handler, {
      method: "POST",
      url,
      headers: {
        cookie: "shein_web_session=session-token",
        origin: "https://app.hanzhou.icu",
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, "ADMIN_REQUIRED");
  }
  assert.equal(refreshCalls, 0);
});

test("rule refresh retry endpoint stays store-scoped and passes only the failed job id", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "admin" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess(received, storeId) {
        calls.push(["access", received.tenantId, storeId]);
      },
    },
    webRuleRefresh: {
      async startRefresh(input) {
        calls.push(["retry", input.storeId, input.retryJobId]);
        return { started: true, job: { id: "job-retry", jobType: "rule_refresh", state: "queued" } };
      },
    },
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/rules/refresh/retry",
    headers: {
      cookie: "shein_web_session=session-token",
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jobId: "job-failed" }),
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.job.id, "job-retry");
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["retry", "store-1", "job-failed"],
  ]);
});

test("publish schema coverage and all-category sync routes stay store-scoped", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "admin" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess(received, storeId) {
        calls.push(["access", received.tenantId, storeId]);
      },
    },
    webBusiness: {
      async getPublishSchemaCoverage(input) {
        calls.push(["coverage", input.context.userId, input.storeId]);
        return {
          summary: { total: 1, ready: 0 },
          categories: [{
            categoryId: "3155",
            productTypeId: "991",
            attributeReady: false,
            publishStandardReady: false,
            ready: false,
          }],
        };
      },
    },
    webRuleRefresh: {
      async startRefresh(input) {
        calls.push(["sync", input.context.userId, input.storeId, input.scope]);
        return {
          started: true,
          job: { id: "job-1", jobType: "rule_refresh", state: "queued" },
        };
      },
    },
  });
  const cookie = "shein_web_session=session-token";
  const coverage = await invoke(handler, {
    url: "/v1/web/stores/store-1/publish/schema-coverage",
    headers: { cookie },
  });
  const sync = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/publish/schema-sync",
    headers: {
      cookie,
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: "{}",
  });

  assert.equal(coverage.status, 200);
  assert.equal(coverage.body.summary.ready, 0);
  assert.equal(sync.status, 202);
  assert.equal(sync.body.job.id, "job-1");
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["coverage", "user-1", "store-1"],
    ["access", "tenant-1", "store-1"],
    ["sync", "user-1", "store-1", "all"],
  ]);
});

test("compliance refresh endpoint checks store access and returns the queued job", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess(received, storeId) {
        calls.push(["access", received.tenantId, storeId]);
      },
    },
    webComplianceSync: {
      async startSync(input) {
        calls.push(["sync", input.context.role, input.storeId]);
        return { started: true, job: { id: "job-1", jobType: "compliance_sync", state: "queued" } };
      },
    },
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/compliance/refresh",
    headers: {
      cookie: "shein_web_session=session-token",
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: "{}",
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.job.id, "job-1");
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["sync", "operator", "store-1"],
  ]);
});

test("compliance workspace list and detail stay behind store access", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "viewer" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess(received, storeId) {
        calls.push(["access", received.tenantId, storeId]);
      },
    },
    webComplianceWorkspace: {
      async listSkcs(input) {
        calls.push([
          "list",
          input.storeId,
          input.filters.query,
          input.filters.status,
          input.filters.reviewStatus,
        ]);
        return { items: [], pagination: { page: 1, pageSize: 50, total: 0, pageCount: 0 } };
      },
      async getSkcDetail(input) {
        calls.push(["detail", input.storeId, input.skc]);
        return { item: { skc: input.skc }, records: [], snapshots: [] };
      },
      async refreshSkc(input) {
        calls.push(["refresh", input.storeId, input.skc]);
        return { refreshed: true, detail: { item: { skc: input.skc } } };
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
  });

  const listResponse = await invoke(handler, {
    url: "/v1/web/stores/store-1/compliance-workspace?q=SKC&status=%E5%BE%85%E8%A1%A5%E5%85%85&reviewStatus=reviewed",
    headers: { cookie: "shein_web_session=session-token" },
  });
  const detailResponse = await invoke(handler, {
    url: "/v1/web/stores/store-1/compliance-workspace/SKC-1",
    headers: { cookie: "shein_web_session=session-token" },
  });
  const refreshResponse = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/compliance-workspace/SKC-1/rules/refresh",
    headers: {
      cookie: "shein_web_session=session-token",
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: "{}",
  });

  assert.equal(listResponse.status, 200);
  assert.equal(detailResponse.status, 200);
  assert.equal(refreshResponse.status, 200);
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["list", "store-1", "SKC", "待补充", "reviewed"],
    ["access", "tenant-1", "store-1"],
    ["detail", "store-1", "SKC-1"],
    ["access", "tenant-1", "store-1"],
    ["refresh", "store-1", "SKC-1"],
  ]);
});

test("server compliance preflight requires trusted origin and store access", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess(received, storeId) {
        calls.push(["access", received.tenantId, storeId]);
      },
    },
    webComplianceWorkspace: {
      async runPreflight(input) {
        calls.push(["preflight", input.storeId, input.skc, input.context.role]);
        return { preflight: { id: "run-1", publishingEnabled: false } };
      },
    },
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/compliance-workspace/SKC-1/preflight",
    headers: {
      cookie: "shein_web_session=session-token",
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: "{}",
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.preflight.publishingEnabled, false);
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["preflight", "store-1", "SKC-1", "operator"],
  ]);
});

test("batch compliance template application resolves the template server-side", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess(received, storeId) {
        calls.push(["access", received.tenantId, storeId]);
      },
    },
    webPublishTemplates: {
      async list(input) {
        calls.push(["templates", input.storeId, input.templateType]);
        return {
          templates: [{
            id: "template-1",
            categoryId: "3155",
            data: { defaults: { photos: [] } },
          }],
        };
      },
    },
    webBusiness: {
      async getComplianceBundle() {
        return { row: {} };
      },
    },
    webComplianceWorkspace: {
      async applyTemplate(input) {
        calls.push([
          "apply",
          input.storeId,
          input.template.id,
          input.skcNames,
          input.sections,
          typeof input.readCompliance,
        ]);
        return {
          templateId: input.template.id,
          externalWrite: false,
          items: [],
          summary: { requested: 1, saved: 0, blocked: 1, failed: 0 },
        };
      },
    },
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/compliance/templates/template-1/apply",
    headers: {
      cookie: "shein_web_session=session-token",
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({ skcNames: ["SKC-1"], sections: ["certificates"] }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.externalWrite, false);
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["templates", "store-1", "compliance"],
    ["apply", "store-1", "template-1", ["SKC-1"], ["certificates"], "function"],
  ]);
});

test("single-SKC compliance write routes require origin and store access", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess(received, storeId) {
        calls.push(["access", received.tenantId, storeId]);
      },
    },
    webComplianceWrites: {
      async checkReport(input) {
        calls.push(["report-check", input.storeId, input.skc, input.input.assignment.certificateTypeCode]);
        return { externalWrite: false, confirmationToken: "token-1" };
      },
      async submitPhotos(input) {
        calls.push(["photo-submit", input.storeId, input.skc, input.input.confirmationToken]);
        return { ok: true, externalWrite: true };
      },
    },
  });
  const headers = {
    cookie: "shein_web_session=session-token",
    origin: "https://app.hanzhou.icu",
    "content-type": "application/json",
  };
  const checked = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/compliance-workspace/SKC-1/reports/contract-check",
    headers,
    body: JSON.stringify({ assignment: { certificateTypeCode: "SmallCarpet1631" } }),
  });
  const submitted = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/compliance-workspace/SKC-1/photos/submit",
    headers,
    body: JSON.stringify({ confirmationToken: "token-2" }),
  });
  assert.equal(checked.status, 200);
  assert.equal(submitted.status, 200);
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["report-check", "store-1", "SKC-1", "SmallCarpet1631"],
    ["access", "tenant-1", "store-1"],
    ["photo-submit", "store-1", "SKC-1", "token-2"],
  ]);
});

test("preflight review requires trusted origin and store access", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "admin-1", role: "admin" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess(received, storeId) {
        calls.push(["access", received.tenantId, storeId]);
      },
    },
    webComplianceWorkspace: {
      async reviewPreflight(input) {
        calls.push([
          "review",
          input.storeId,
          input.skc,
          input.preflightRunId,
          input.context.role,
        ]);
        return {
          review: {
            id: "review-1",
            preflightRunId: input.preflightRunId,
            authorizesPublishing: false,
          },
        };
      },
    },
  });
  const preflightRunId = "55555555-5555-4555-8555-555555555555";

  const response = await invoke(handler, {
    method: "POST",
    url: `/v1/web/stores/store-1/compliance-workspace/SKC-1/preflight/${preflightRunId}/review`,
    headers: {
      cookie: "shein_web_session=session-token",
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: "{}",
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.review.authorizesPublishing, false);
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["review", "store-1", "SKC-1", preflightRunId, "admin"],
  ]);
});

test("retired image generation settings and usage routes are unavailable", async () => {
  const context = { tenantId: "tenant-1", userId: "owner-1", role: "owner" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: { async authenticate() { return context; } },
  });

  const settings = await invoke(handler, {
    method: "GET",
    url: "/v1/web/settings/image-provider",
    headers: { origin: "https://app.hanzhou.icu", cookie: "shein_web_session=session-token" },
  });
  const usage = await invoke(handler, {
    method: "GET",
    url: "/v1/web/admin/member-usage?range=month&month=2026-08",
    headers: { cookie: "shein_web_session=session-token" },
  });

  assert.equal(settings.status, 404);
  assert.equal(usage.status, 404);
});

test("administrator lists members and replaces a member store allowlist", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "owner-1", role: "owner" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: {
      async authenticate(token) {
        calls.push(["authenticate", token]);
        return context;
      },
      async listMembers(receivedContext) {
        calls.push(["list", receivedContext.userId]);
        return { members: [], count: 0 };
      },
      async updateMemberStoreAccess(receivedContext, userId, storeIds) {
        calls.push(["update", receivedContext.userId, userId, storeIds]);
        return { member: { id: userId, stores: [] } };
      },
      async updateManagedMember(receivedContext, userId, input) {
        calls.push(["profile", receivedContext.userId, userId, input]);
        return { member: { id: userId, role: input.role, status: input.status } };
      },
      async updateMemberAdminAlias(receivedContext, userId, alias) {
        calls.push(["alias", receivedContext.userId, userId, alias]);
        return { member: { id: userId, adminAlias: alias } };
      },
    },
  });
  const cookie = "shein_web_session=session-token";
  const members = await invoke(handler, {
    url: "/v1/web/admin/members",
    headers: { cookie },
  });
  const updated = await invoke(handler, {
    method: "PUT",
    url: "/v1/web/admin/members/member-1/store-access",
    headers: {
      cookie,
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({ storeIds: ["store-1"] }),
  });
  const profile = await invoke(handler, {
    method: "PATCH",
    url: "/v1/web/admin/members/member-1",
    headers: {
      cookie,
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({ role: "viewer", status: "disabled" }),
  });
  const alias = await invoke(handler, {
    method: "PATCH",
    url: "/v1/web/admin/members/member-1/alias",
    headers: {
      cookie,
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({ alias: "家居运营" }),
  });

  assert.equal(members.status, 200);
  assert.equal(updated.status, 200);
  assert.equal(profile.status, 200);
  assert.equal(alias.status, 200);
  assert.deepEqual(calls, [
    ["authenticate", "session-token"],
    ["list", "owner-1"],
    ["authenticate", "session-token"],
    ["update", "owner-1", "member-1", ["store-1"]],
    ["authenticate", "session-token"],
    ["profile", "owner-1", "member-1", { role: "viewer", status: "disabled" }],
    ["authenticate", "session-token"],
    ["alias", "owner-1", "member-1", "家居运营"],
  ]);
});

test("member invitation routes separate admin creation from public acceptance", async () => {
  const calls = [];
  const token = `swi_${"a".repeat(43)}`;
  const context = { tenantId: "tenant-1", userId: "owner-1", role: "owner" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: {
      async authenticate(receivedToken) {
        calls.push(["authenticate", receivedToken]);
        return context;
      },
      async createMemberInvitation(receivedContext, input) {
        calls.push(["create", receivedContext.userId, input]);
        return { invitation: { id: "invitation-1" }, token };
      },
      async getMemberInvitation(receivedToken) {
        calls.push(["get", receivedToken]);
        return { invitation: { id: "invitation-1" } };
      },
      async acceptMemberInvitation(receivedToken, password) {
        calls.push(["accept", receivedToken, password]);
        return { accepted: true };
      },
    },
  });
  const cookie = "shein_web_session=session-token";
  const created = await invoke(handler, {
    method: "POST",
    url: "/v1/web/admin/invitations",
    headers: {
      cookie,
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: "new@example.com", role: "operator", storeIds: [] }),
  });
  const invitation = await invoke(handler, {
    url: `/v1/web/invitations/${token}`,
  });
  const accepted = await invoke(handler, {
    method: "POST",
    url: `/v1/web/invitations/${token}/accept`,
    headers: {
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({ password: "StrongPassword!2026" }),
  });

  assert.equal(created.status, 201);
  assert.equal(invitation.status, 200);
  assert.equal(accepted.status, 200);
  assert.deepEqual(calls, [
    ["authenticate", "session-token"],
    ["create", "owner-1", { email: "new@example.com", role: "operator", storeIds: [] }],
    ["get", token],
    ["accept", token, "StrongPassword!2026"],
  ]);
});

test("cloud control creates an HttpOnly browser session without exposing its token", async () => {
  let received = null;
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async login(input) {
        received = input;
        return {
          token: "sws_browser_secret",
          expiresAt: "2099-08-01T00:00:00.000Z",
          tenant: { id: "tenant-1", name: "测试租户" },
          user: {
            id: "user-1",
            email: "owner@example.com",
            displayName: "店铺负责人",
            role: "owner",
          },
        };
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webCookieSecure: true,
  });
  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/login",
    headers: {
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "owner@example.com",
      password: "StrongPassword!2026",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    email: "owner@example.com",
    password: "StrongPassword!2026",
  });
  assert.match(response.headers["Set-Cookie"], /HttpOnly/);
  assert.match(response.headers["Set-Cookie"], /Secure/);
  assert.match(response.headers["Set-Cookie"], /SameSite=Strict/);
  assert.equal(JSON.stringify(response.body).includes("sws_browser_secret"), false);
});

test("cloud control returns the current web user and tenant stores from a cookie", async () => {
  const calls = [];
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async authenticate(token) {
        calls.push(["authenticate", token]);
        return {
          sessionId: "session-1",
          tenantId: "tenant-1",
          tenantName: "测试租户",
          userId: "user-1",
          email: "owner@example.com",
          displayName: "店铺负责人",
          role: "owner",
          expiresAt: "2099-08-01T00:00:00.000Z",
        };
      },
      async listStores(context) {
        calls.push(["stores", context.tenantId, context.userId]);
        return [
          {
            id: "store-1",
            supplierId: "123",
            label: "地毯一店",
            businessMode: "全托管",
            status: "active",
          },
        ];
      },
      async renameStore(context, storeId, label) {
        calls.push(["rename", context.userId, storeId, label]);
        return { id: storeId, label };
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
  });
  const cookie = "shein_web_session=sws_browser_secret";
  const session = await invoke(handler, {
    method: "GET",
    url: "/v1/web/session",
    headers: { cookie },
  });
  const stores = await invoke(handler, {
    method: "GET",
    url: "/v1/web/stores",
    headers: { cookie },
  });
  const renamed = await invoke(handler, {
    method: "PATCH",
    url: "/v1/web/stores/store-1",
    headers: {
      cookie,
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({ label: "地毯主店" }),
  });

  assert.equal(session.status, 200);
  assert.equal(session.body.user.role, "owner");
  assert.equal(stores.status, 200);
  assert.equal(stores.body.stores[0].label, "地毯一店");
  assert.equal(renamed.body.store.label, "地毯主店");
  assert.deepEqual(calls, [
    ["authenticate", "sws_browser_secret"],
    ["authenticate", "sws_browser_secret"],
    ["stores", "tenant-1", "user-1"],
    ["authenticate", "sws_browser_secret"],
    ["rename", "user-1", "store-1", "地毯主店"],
  ]);
});

test("cloud control exposes an administrator-only store authorization revoke route", async () => {
  const calls = [];
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async authenticate(token) {
        calls.push(["authenticate", token]);
        return { tenantId: "tenant-1", userId: "owner-1", role: "owner" };
      },
      async revokeStoreAuthorization(context, storeId) {
        calls.push(["revoke", context.userId, storeId]);
        return {
          id: storeId,
          label: "测试店铺",
          status: "disabled",
          supplierId: null,
        };
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
  });

  const response = await invoke(handler, {
    method: "DELETE",
    url: "/v1/web/stores/store-1",
    headers: {
      cookie: "shein_web_session=sws_browser_secret",
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: "{}",
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.store.status, "disabled");
  assert.deepEqual(calls, [
    ["authenticate", "sws_browser_secret"],
    ["revoke", "owner-1", "store-1"],
  ]);
});

test("cloud control scopes web product and compliance reads to the authorized store", async () => {
  const calls = [];
  const context = {
    tenantId: "tenant-1",
    userId: "user-1",
    role: "operator",
  };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async authenticate(token) {
        assert.equal(token, "sws_browser_secret");
        return context;
      },
      async requireStoreAccess(receivedContext, storeId) {
        calls.push(["access", receivedContext.tenantId, storeId]);
        return { id: storeId };
      },
    },
    webBusiness: {
      async listProducts(input) {
        calls.push(["products", input.storeId, input.pageSize]);
        return { products: [{ skc: "SKC-1" }], total: 1 };
      },
      async queryCompliance(input) {
        calls.push(["compliance", input.storeId, input.skcNames]);
        return { rows: [{ skc: "SKC-1", state: "通过" }] };
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
  });
  const cookie = "shein_web_session=sws_browser_secret";
  const products = await invoke(handler, {
    method: "GET",
    url: "/v1/web/stores/store-1/products?pageSize=30",
    headers: { cookie },
  });
  const compliance = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/compliance/query",
    headers: {
      cookie,
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({ skcNames: ["SKC-1"] }),
  });

  assert.equal(products.status, 200);
  assert.equal(products.body.products[0].skc, "SKC-1");
  assert.equal(compliance.status, 200);
  assert.equal(compliance.body.rows[0].state, "通过");
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["products", "store-1", "30"],
    ["access", "tenant-1", "store-1"],
    ["compliance", "store-1", ["SKC-1"]],
  ]);
});

test("cloud control scopes SPU relationship readback to the authorized store", async () => {
  const calls = [];
  const context = {
    tenantId: "tenant-1",
    userId: "user-1",
    role: "operator",
  };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async authenticate() {
        return context;
      },
      async requireStoreAccess(receivedContext, storeId) {
        calls.push(["access", receivedContext.tenantId, storeId]);
      },
    },
    webBusiness: {
      async querySpuInfo(input) {
        calls.push(["spu-info", input.storeId, input.spuName, input.version]);
        return { summary: { disposition: "read-only" } };
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/publish/spu-info",
    headers: {
      cookie: "shein_web_session=sws_browser_secret",
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({ spuName: "SPU-1", version: "VERSION-1" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["spu-info", "store-1", "SPU-1", "VERSION-1"],
  ]);
});

test("cloud control forwards version and SPU names for document-state reads", async () => {
  const calls = [];
  const context = {
    tenantId: "tenant-1",
    userId: "user-1",
    role: "operator",
  };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async authenticate() {
        return context;
      },
      async requireStoreAccess(receivedContext, storeId) {
        calls.push(["access", receivedContext.tenantId, storeId]);
      },
    },
    webBusiness: {
      async queryDocumentState(input) {
        calls.push([
          "document-state",
          input.storeId,
          input.version,
          input.spuNames,
        ]);
        return { summary: { disposition: "read-only" } };
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/publish/document-state",
    headers: {
      cookie: "shein_web_session=sws_browser_secret",
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      version: "VERSION-1",
      spuNames: ["SPU-1"],
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["document-state", "store-1", "VERSION-1", ["SPU-1"]],
  ]);
});

test("cloud control scopes compliance revalidation to the authorized store", async () => {
  const calls = [];
  const context = {
    tenantId: "tenant-1",
    userId: "user-1",
    role: "operator",
  };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async authenticate() {
        return context;
      },
      async requireStoreAccess(receivedContext, storeId) {
        calls.push(["access", receivedContext.tenantId, storeId]);
      },
    },
    webBusiness: {
      async revalidatePublishCompliance(input) {
        calls.push([
          "compliance-revalidation",
          input.storeId,
          input.spuName,
          input.version,
        ]);
        return { status: "passed", completionEligible: true };
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/publish/compliance-revalidation",
    headers: {
      cookie: "shein_web_session=sws_browser_secret",
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({ spuName: "SPU-1", version: "VERSION-1" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["compliance-revalidation", "store-1", "SPU-1", "VERSION-1"],
  ]);
});

test("workspace usage is authenticated and store-scoped", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() { return { ok: true, dependencies: {} }; } },
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess(received, storeId) {
        calls.push([received.tenantId, storeId]);
      },
    },
    webWorkspaceUsage: {
      async get(input) {
        calls.push(["usage", input.context.tenantId, input.storeId]);
        return { drafts: { storeUsed: 1 }, media: { storeUsed: 2 }, alerts: [] };
      },
    },
  });

  const response = await invoke(handler, {
    url: "/v1/web/stores/store-1/workspace-usage",
    headers: { cookie: "shein_web_session=session-token" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.media.storeUsed, 2);
  assert.deepEqual(calls, [
    ["tenant-1", "store-1"],
    ["usage", "tenant-1", "store-1"],
  ]);
});

test("cloud control creates, completes and lists tenant-scoped web media", async () => {
  const calls = [];
  const context = {
    tenantId: "tenant-1",
    userId: "user-1",
    role: "operator",
  };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async authenticate(token) {
        assert.equal(token, "sws_browser_secret");
        return context;
      },
      async requireStoreAccess(receivedContext, storeId) {
        calls.push(["access", receivedContext.tenantId, storeId]);
      },
    },
    webMedia: {
      async createUploadTicket(input) {
        calls.push([
          "ticket",
          input.storeId,
          input.input.originalName,
        ]);
        return {
          asset: { id: "asset-1", status: "uploading" },
          upload: {
            method: "PUT",
            url: "https://upload.example.test/signed",
            headers: { "Content-Type": "image/jpeg" },
          },
        };
      },
      async completeUpload(input) {
        calls.push(["complete", input.storeId, input.assetId]);
        return {
          asset: { id: input.assetId, status: "ready" },
        };
      },
      async listAssets(input) {
        calls.push(["list", input.storeId, input.limit]);
        return {
          assets: [{ id: "asset-1", status: "ready" }],
          count: 1,
        };
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
  });
  const headers = {
    cookie: "shein_web_session=sws_browser_secret",
    origin: "https://app.hanzhou.icu",
    "content-type": "application/json",
  };
  const ticket = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/media/upload-ticket",
    headers,
    body: JSON.stringify({
      originalName: "rug.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1024,
    }),
  });
  const completed = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/media/asset-1/complete",
    headers,
    body: JSON.stringify({ width: 1600, height: 1600 }),
  });
  const listed = await invoke(handler, {
    method: "GET",
    url: "/v1/web/stores/store-1/media?limit=25",
    headers: {
      cookie: "shein_web_session=sws_browser_secret",
    },
  });

  assert.equal(ticket.status, 201);
  assert.equal(ticket.body.upload.method, "PUT");
  assert.equal(completed.status, 200);
  assert.equal(completed.body.asset.status, "ready");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 1);
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["ticket", "store-1", "rug.jpg"],
    ["access", "tenant-1", "store-1"],
    ["complete", "store-1", "asset-1"],
    ["access", "tenant-1", "store-1"],
    ["list", "store-1", "25"],
  ]);
});

test("cloud control image generation routes are unavailable", async () => {
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: { async authenticate() { return context; } },
  });
  const response = await invoke(handler, {
    method: "GET",
    url: "/v1/web/stores/store-1/image-generation/jobs",
    headers: { cookie: "shein_web_session=sws_browser_secret" },
  });
  assert.equal(response.status, 404);
});

test("cloud control creates and controls tenant-scoped publish batches", async () => {
  const calls = [];
  const context = {
    tenantId: "tenant-1",
    userId: "user-1",
    role: "operator",
  };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async authenticate(token) {
        assert.equal(token, "sws_browser_secret");
        return context;
      },
      async requireStoreAccess(receivedContext, storeId) {
        calls.push(["access", receivedContext.tenantId, storeId]);
      },
    },
    webPublishBatches: {
      async create(input) {
        calls.push(["create", input.storeId, input.input.draftIds]);
        return { batch: { id: "batch-1", state: "queued" } };
      },
      async publishNow(input) {
        calls.push(["publish-now", input.storeId, input.input.draftIds]);
        return {
          batch: { id: "batch-direct-1", itemCount: input.input.draftIds.length },
          publishingEnabled: true,
          executionQueued: true,
        };
      },
      async act(input) {
        calls.push(["act", input.storeId, input.batchId, input.action]);
        return { batch: { id: input.batchId, state: "ready" } };
      },
      async listReadbackStatus(input) {
        calls.push(["readback-status", input.storeId, input.batchId]);
        return {
          batchId: input.batchId,
          items: [],
          readOnly: true,
        };
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
  });
  const headers = {
    cookie: "shein_web_session=sws_browser_secret",
    origin: "https://app.hanzhou.icu",
    "content-type": "application/json",
  };
  const created = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/publish-batches",
    headers,
    body: JSON.stringify({
      name: "首批",
      idempotencyKey: "batch:20260731:1",
      draftIds: ["draft-1"],
    }),
  });
  const preflighted = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/publish-batches/batch-1/actions",
    headers,
    body: JSON.stringify({ action: "preflight" }),
  });
  const publishedNow = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/publish-now",
    headers,
    body: JSON.stringify({
      draftIds: ["draft-1"],
      confirmation: "CONFIRM_SHEIN_PRODUCT_PUBLISH",
    }),
  });
  const readbackStatus = await invoke(handler, {
    method: "GET",
    url: "/v1/web/stores/store-1/publish-batches/batch-1/readback-status",
    headers,
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.batch.state, "queued");
  assert.equal(preflighted.status, 200);
  assert.equal(preflighted.body.batch.state, "ready");
  assert.equal(publishedNow.status, 200);
  assert.equal(publishedNow.body.executionQueued, true);
  assert.equal(readbackStatus.status, 200);
  assert.equal(readbackStatus.body.readOnly, true);
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["create", "store-1", ["draft-1"]],
    ["access", "tenant-1", "store-1"],
    ["act", "store-1", "batch-1", "preflight"],
    ["access", "tenant-1", "store-1"],
    ["publish-now", "store-1", ["draft-1"]],
    ["access", "tenant-1", "store-1"],
    ["readback-status", "store-1", "batch-1"],
  ]);
});

test("cloud control serves the tenant-scoped review center snapshot", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async authenticate(token) {
        assert.equal(token, "sws_browser_secret");
        return context;
      },
      async requireStoreAccess(receivedContext, storeId) {
        calls.push(["access", receivedContext.tenantId, storeId]);
      },
    },
    webReviewCenterSnapshot: {
      async get(input) {
        calls.push(["snapshot", input.storeId, input.context.tenantId]);
        return {
          snapshotVersion: "review-center-snapshot-v1",
          storeId: input.storeId,
          generatedAt: "2026-08-28T06:00:00.000Z",
          consistency: { mode: "single-control-request", partial: false, sources: {} },
          drafts: { drafts: [], count: 0 },
          batches: { batches: [], count: 0, publishingEnabled: false },
          readbacks: { items: [], count: 0, readOnly: true },
          reviews: { items: [], count: 0, archivedKeys: [], readOnly: true, externalWrite: false },
        };
      },
    },
  });

  const response = await invoke(handler, {
    method: "GET",
    url: "/v1/web/stores/store-1/review-center/snapshot",
    headers: { cookie: "shein_web_session=sws_browser_secret" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.snapshotVersion, "review-center-snapshot-v1");
  assert.equal(response.body.storeId, "store-1");
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["snapshot", "store-1", "tenant-1"],
  ]);
});

test("cloud control routes price discussion rejection through the store-scoped service", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async authenticate(token) {
        assert.equal(token, "sws_browser_secret");
        return context;
      },
      async requireStoreAccess(receivedContext, storeId) {
        calls.push(["access", receivedContext.tenantId, storeId]);
      },
    },
    webBusiness: {
      async rejectPriceDiscussion(input) {
        calls.push(["reject", input.storeId, input.discussSn]);
        return { discussSn: input.discussSn, successCount: 1, failCount: 0, failedList: [] };
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
  });
  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/stores/store-1/price-discussions/DISCUSS-1/reject",
    headers: {
      cookie: "shein_web_session=sws_browser_secret",
      origin: "https://app.hanzhou.icu",
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.successCount, 1);
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["reject", "store-1", "DISCUSS-1"],
  ]);
});

test("cloud control lists and locally archives store-scoped product reviews", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async authenticate(token) {
        assert.equal(token, "sws_browser_secret");
        return context;
      },
      async requireStoreAccess(receivedContext, storeId) {
        calls.push(["access", receivedContext.tenantId, storeId]);
      },
    },
    webProductReviews: {
      async list(input) {
        calls.push(["list", input.storeId]);
        return { items: [], count: 0, archivedKeys: [], readOnly: true, externalWrite: false };
      },
      async archive(input) {
        calls.push(["archive", input.storeId, input.reviewKey]);
        return { reviewKey: input.reviewKey, archived: true, externalWrite: false };
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
  });
  const cookie = { cookie: "shein_web_session=sws_browser_secret" };
  const listed = await invoke(handler, {
    method: "GET",
    url: "/v1/web/stores/store-1/product-reviews",
    headers: cookie,
  });
  const archived = await invoke(handler, {
    method: "DELETE",
    url: "/v1/web/stores/store-1/product-reviews/version%3AVERSION-1",
    headers: { ...cookie, origin: "https://app.hanzhou.icu" },
  });

  assert.equal(listed.body.readOnly, true);
  assert.equal(archived.body.archived, true);
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["list", "store-1"],
    ["access", "tenant-1", "store-1"],
    ["archive", "store-1", "version:VERSION-1"],
  ]);
});

test("cloud control batch archives selected product reviews within the current store", async () => {
  const calls = [];
  const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async authenticate() { return context; },
      async requireStoreAccess(receivedContext, storeId) {
        calls.push(["access", receivedContext.tenantId, storeId]);
      },
    },
    webProductReviews: {
      async archiveMany(input) {
        calls.push(["archiveMany", input.storeId, input.reviewKeys]);
        return { archived: true, count: input.reviewKeys.length, externalWrite: false };
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
  });

  const response = await invoke(handler, {
    method: "DELETE",
    url: "/v1/web/stores/store-1/product-reviews",
    headers: {
      cookie: "shein_web_session=sws_browser_secret",
      origin: "https://app.hanzhou.icu",
    },
    body: JSON.stringify({ reviewKeys: ["version:VERSION-1", "skc:SKC-2"] }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.count, 2);
  assert.deepEqual(calls, [
    ["access", "tenant-1", "store-1"],
    ["archiveMany", "store-1", ["version:VERSION-1", "skc:SKC-2"]],
  ]);
});

test("cloud control rejects web login from an untrusted origin", async () => {
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAuth: {
      async login() {
        throw new Error("untrusted request must not authenticate");
      },
    },
    allowedOrigins: ["https://app.hanzhou.icu"],
  });
  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/login",
    headers: {
      origin: "https://malicious.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "owner@example.com",
      password: "StrongPassword!2026",
    }),
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.code, "ORIGIN_NOT_ALLOWED");
});

test("cloud control enrolls a desktop with a one-time code", async () => {
  let received = null;
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    deviceAuth: {
      async enroll(input) {
        received = input;
        return {
          accessToken: "scs_once",
          tokenType: "Bearer",
          tenant: { id: "tenant-1", name: "测试租户" },
          device: { id: "device-1", name: input.deviceName },
        };
      },
    },
  });
  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/auth/enroll",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "SHEIN-test",
      deviceName: "测试电脑",
      installationId: "install-1",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.accessToken, "scs_once");
  assert.deepEqual(received, {
    code: "SHEIN-test",
    deviceName: "测试电脑",
    installationId: "install-1",
  });
});

test("cloud control starts and completes SHEIN authorization", async () => {
  const calls = [];
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    sheinAuthorization: {
      async start(input) {
        calls.push(["start", input]);
        return {
          authorizationUrl: "https://authorize.example.test",
          state: "sha-state",
        };
      },
      async complete(input) {
        calls.push(["complete", input]);
        return {
          accessToken: "scs-secret",
          store: {
            openKeyId: "OPEN-1",
            secretKey: "STORE-SECRET",
          },
        };
      },
    },
  });
  const started = await invoke(handler, {
    method: "POST",
    url: "/v1/shein/auth/start",
    body: JSON.stringify({
      installationId: "install-1",
      deviceName: "测试电脑",
    }),
  });
  const completed = await invoke(handler, {
    method: "POST",
    url: "/v1/shein/auth/complete",
    body: JSON.stringify({
      installationId: "install-1",
      deviceName: "测试电脑",
      state: "sha-state",
      tempToken: "temp-token",
    }),
  });

  assert.equal(started.status, 200);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.store.secretKey, "STORE-SECRET");
  assert.deepEqual(calls, [
    [
      "start",
      {
        installationId: "install-1",
        deviceName: "测试电脑",
        tenantId: null,
      },
    ],
    [
      "complete",
      {
        installationId: "install-1",
        deviceName: "测试电脑",
        state: "sha-state",
        tempToken: "temp-token",
      },
    ],
  ]);
});

test("cloud control reuses the authenticated tenant when authorizing another store", async () => {
  let received = null;
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    deviceAuth: {
      async authenticate(token) {
        assert.equal(token, "scs-existing");
        return { tenantId: "tenant-existing" };
      },
    },
    sheinAuthorization: {
      async start(input) {
        received = input;
        return { authorizationUrl: "https://authorize.example.test" };
      },
    },
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/shein/auth/start",
    headers: { authorization: "Bearer scs-existing" },
    body: JSON.stringify({
      installationId: "install-1",
      deviceName: "测试电脑",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    installationId: "install-1",
    deviceName: "测试电脑",
    tenantId: "tenant-existing",
  });
});

test("cloud control starts web SHEIN authorization from the authenticated user", async () => {
  let received = null;
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    allowedOrigins: ["https://app.hanzhou.icu"],
    webAuth: {
      async authenticate(token) {
        assert.equal(token, "web-session");
        return {
          tenantId: "tenant-1",
          userId: "user-1",
          role: "operator",
        };
      },
    },
    webSheinAuthorization: {
      async start(context) {
        received = context;
        return { authorizationUrl: "https://authorize.example.test" };
      },
    },
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/web/shein/auth/start",
    headers: {
      origin: "https://app.hanzhou.icu",
      cookie: "shein_web_session=web-session",
    },
    body: "{}",
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.authorizationUrl, "https://authorize.example.test");
  assert.equal(received.tenantId, "tenant-1");
  assert.equal(received.userId, "user-1");
  assert.equal(received.role, "operator");
});

test("web SHEIN callback redirects without exposing store credentials", async () => {
  let received = null;
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    webAppBaseUrl: "https://app.hanzhou.icu",
    webSheinAuthorization: {
      async complete(input) {
        received = input;
        return {
          store: { label: "SHEIN 店铺 123" },
        };
      },
    },
  });

  const response = await invokeRaw(handler, {
    method: "GET",
    url: "/v1/web/shein/auth/callback?state=shw-state&tempToken=temp-token",
  });

  assert.equal(response.status, 303);
  assert.deepEqual(received, { state: "shw-state", tempToken: "temp-token" });
  assert.match(
    response.headers.Location,
    /^https:\/\/app\.hanzhou\.icu\/app\/settings\/stores\?/,
  );
  assert.match(response.headers.Location, /sheinAuthorized=1/);
  assert.equal(response.headers.Location.includes("temp-token"), false);
  assert.equal(response.body, "");
});

test("cloud control validates bearer sessions without exposing tokens", async () => {
  let receivedToken = null;
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    deviceAuth: {
      async authenticate(token) {
        receivedToken = token;
        return {
          tenantId: "tenant-1",
          tenantName: "测试租户",
          deviceId: "device-1",
          deviceName: "测试电脑",
          expiresAt: "2026-08-30T00:00:00.000Z",
        };
      },
    },
  });
  const response = await invoke(handler, {
    method: "GET",
    url: "/v1/session",
    headers: { authorization: "Bearer scs_secret" },
  });

  assert.equal(response.status, 200);
  assert.equal(receivedToken, "scs_secret");
  assert.equal(response.body.authenticated, true);
  assert.equal(JSON.stringify(response.body).includes("scs_secret"), false);
});

test("cloud control returns tenant-scoped webhook audit projections", async () => {
  let received = null;
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    deviceAuth: {
      async authenticate(token) {
        assert.equal(token, "scs_secret");
        return { tenantId: "tenant-1" };
      },
    },
    webhookAudits: {
      async listProductAuditEvents(input) {
        received = input;
        return {
          items: [
            {
              id: "event-1",
              projection: {
                records: [{ skcName: "SKC-1", auditStateLabel: "failed" }],
              },
            },
          ],
          hasMore: false,
          limit: 25,
        };
      },
    },
  });

  const response = await invoke(handler, {
    method: "GET",
    url: "/v1/webhook-audits?supplierId=123&limit=25",
    headers: { authorization: "Bearer scs_secret" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    tenantId: "tenant-1",
    supplierId: "123",
    limit: "25",
  });
  assert.equal(response.body.items[0].projection.records[0].skcName, "SKC-1");
  assert.equal(typeof response.body.generatedAt, "string");
  assert.equal(JSON.stringify(response.body).includes("scs_secret"), false);
});

test("cloud control requires authentication for webhook audit projections", async () => {
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    deviceAuth: {
      async authenticate() {
        throw new DeviceAuthError("UNAUTHORIZED", "缺少访问令牌", 401);
      },
    },
    webhookAudits: {
      async listProductAuditEvents() {
        throw new Error("unauthorized request must not query");
      },
    },
  });

  const response = await invoke(handler, {
    method: "GET",
    url: "/v1/webhook-audits",
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.code, "UNAUTHORIZED");
});

test("cloud control returns a sanitized authentication error", async () => {
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    deviceAuth: {
      async authenticate() {
        throw new DeviceAuthError(
          "UNAUTHORIZED",
          "访问令牌无效、已过期或已撤销",
          401,
        );
      },
    },
  });
  const response = await invoke(handler, {
    method: "GET",
    url: "/v1/session",
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    code: "UNAUTHORIZED",
    msg: "访问令牌无效、已过期或已撤销",
  });
});

test("cloud control rate limits enrollment attempts by client address", async () => {
  let clientKey = null;
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    enrollmentLimiter: {
      consume(key) {
        clientKey = key;
        return { allowed: false, retryAfterSeconds: 60 };
      },
    },
    deviceAuth: {
      async enroll() {
        throw new Error("rate-limited request must not enroll");
      },
    },
  });
  const response = await invoke(handler, {
    method: "POST",
    url: "/v1/auth/enroll",
    headers: { "x-real-ip": "203.0.113.18" },
    body: "{}",
    remoteAddress: "127.0.0.1",
  });

  assert.equal(response.status, 429);
  assert.equal(clientKey, "203.0.113.18");
  assert.equal(response.headers["Retry-After"], "60");
  assert.equal(response.body.code, "RATE_LIMITED");
});

test("cloud control ignores malformed forwarded client addresses", async () => {
  let clientKey = null;
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    enrollmentLimiter: {
      consume(key) {
        clientKey = key;
        return { allowed: false, retryAfterSeconds: 60 };
      },
    },
    deviceAuth: {
      async enroll() {
        throw new Error("rate-limited request must not enroll");
      },
    },
  });

  await invoke(handler, {
    method: "POST",
    url: "/v1/auth/enroll",
    headers: { "x-real-ip": "203.0.113.18, 198.51.100.4" },
    body: "{}",
    remoteAddress: "127.0.0.1",
  });

  assert.equal(clientKey, "127.0.0.1");
});

test("cloud control only grants CORS to configured browser origins", async () => {
  const handler = createCloudControlRequestHandler({
    readiness: { async check() {} },
    allowedOrigins: ["http://127.0.0.1:5173"],
  });
  const allowed = await invoke(handler, {
    method: "GET",
    url: "/health",
    headers: { origin: "http://127.0.0.1:5173" },
  });
  const rejected = await invoke(handler, {
    method: "GET",
    url: "/health",
    headers: { origin: "https://malicious.example" },
  });

  assert.equal(
    allowed.headers["Access-Control-Allow-Origin"],
    "http://127.0.0.1:5173",
  );
  assert.equal(allowed.headers["Access-Control-Expose-Headers"], "X-Trace-Id");
  assert.equal(rejected.headers["Access-Control-Allow-Origin"], undefined);
});
