import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { CloudCredentialCipher } from "./credential-cipher.js";
import {
  PostgresAiTitleRepository,
  PostgresAiTitleSettingsRepository,
  WebAiTitleService,
} from "./ai-title-service.js";

test("AI title service requires a grant for regular users and lets admins use configured provider", async () => {
  const calls = [];
  const repository = {
    async hasGrant() { return false; },
  };
  const service = new WebAiTitleService({
    repository,
    mediaService: {},
    apiUrl: "https://example.test/v1/chat/completions",
    apiKey: "secret",
    model: "replace-me",
  });
  assert.equal((await service.capabilities({ context: { role: "operator", tenantId: "t", userId: "u" } })).visible, false);
  assert.equal((await service.capabilities({ context: { role: "admin", tenantId: "t", userId: "u" } })).visible, true);
  assert.equal(service.isConfigured(), true);
  assert.equal(calls.length, 0);
});

test("AI title service sends the main image to a configurable OpenAI-compatible endpoint and returns only the pattern", async () => {
  const calls = [];
  const service = new WebAiTitleService({
    repository: { async hasGrant() { return true; } },
    mediaService: {
      async readReadySheinImage() {
        return { fileBytes: Buffer.from("image"), mimeType: "image/jpeg" };
      },
    },
    apiUrl: "https://replace.example/v1/chat/completions",
    apiKey: "secret",
    modelUrl: "https://replace.example/models/qwen-vl",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ patternName: "复古波纹", confidence: 0.92 }) } }] }), { status: 200 });
    },
  });
  const result = await service.suggest({
    context: { role: "operator", tenantId: "tenant", userId: "user" },
    storeId: "store",
    input: {
      mainImageAssetId: "asset",
      titleRuleTemplateId: "title",
      titleRule: { prefix: "1pc", suffix: "Rug" },
      titleMaxLength: 250,
    },
  });
  assert.equal(result.patternName, "复古波纹");
  assert.equal(result.confidence, 0.92);
  assert.equal(calls[0].url, "https://replace.example/v1/chat/completions");
  assert.equal(calls[0].body.model, "https://replace.example/models/qwen-vl");
  assert.match(calls[0].body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.match(result.diagnostics.traceId, /^[0-9a-f-]{36}$/);
  assert.equal(result.diagnostics.phase, "provider");
  assert.equal(result.diagnostics.cacheHit, false);
  assert.equal(typeof result.diagnostics.durationMs, "number");
});

test("AI title diagnostics preserve a trace ID and failure phase for provider errors", async () => {
  const events = [];
  const service = new WebAiTitleService({
    repository: { async hasGrant() { return true; } },
    mediaService: {
      async readReadySheinImage() {
        return { fileBytes: Buffer.from("image"), mimeType: "image/jpeg" };
      },
    },
    apiUrl: "https://replace.example/v1/chat/completions",
    apiKey: "secret",
    model: "qwen-vl",
    diagnosticSink: (event) => events.push(event),
    fetchImpl: async () => new Response("upstream failure", { status: 502 }),
  });
  await assert.rejects(
    () => service.suggest({
      context: { role: "operator", tenantId: "tenant", userId: "user" },
      storeId: "store",
      input: {
        mainImageAssetId: "asset",
        titleRuleTemplateId: "title",
        titleRule: { prefix: "1pc", suffix: "Rug" },
      },
    }),
    (error) => {
      assert.equal(error.code, "AI_TITLE_PROVIDER_FAILED");
      assert.match(error.traceId, /^[0-9a-f-]{36}$/);
      assert.equal(error.diagnostics.phase, "provider");
      return true;
    },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "error");
  assert.equal(events[0].errorCode, "AI_TITLE_PROVIDER_FAILED");
  assert.equal(events[0].phase, "provider");
});

test("AI title service deduplicates concurrent requests and reuses a short-lived result cache", async () => {
  let providerCalls = 0;
  let releaseProvider;
  const providerReady = new Promise((resolve) => { releaseProvider = resolve; });
  const service = new WebAiTitleService({
    repository: { async hasGrant() { return true; } },
    mediaService: {
      async readReadySheinImage() {
        return { fileBytes: Buffer.from("image"), mimeType: "image/jpeg" };
      },
    },
    apiUrl: "https://replace.example/v1/chat/completions",
    apiKey: "secret",
    model: "qwen-vl",
    cacheTtlMs: 120_000,
    fetchImpl: async () => {
      providerCalls += 1;
      await providerReady;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ patternName: "复古波纹" }) } }] }), { status: 200 });
    },
  });
  const input = {
    mainImageAssetId: "asset",
    titleRuleTemplateId: "title",
    titleRule: { prefix: "1pc", suffix: "Rug" },
    titleMaxLength: 250,
  };
  const first = service.suggest({ context: { role: "operator", tenantId: "tenant", userId: "user" }, storeId: "store", input });
  const second = service.suggest({ context: { role: "operator", tenantId: "tenant", userId: "user" }, storeId: "store", input });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(providerCalls, 1);
  releaseProvider();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.patternName, "复古波纹");
  assert.deepEqual(secondResult, firstResult);
  const cached = await service.suggest({ context: { role: "operator", tenantId: "tenant", userId: "user" }, storeId: "store", input });
  assert.equal(cached.patternName, firstResult.patternName);
  assert.equal(cached.diagnostics.cacheHit, true);
  assert.equal(cached.diagnostics.source, "memory-cache");
  assert.match(cached.diagnostics.traceId, /^[0-9a-f-]{36}$/);
  assert.notEqual(cached.diagnostics.traceId, firstResult.diagnostics.traceId);
  assert.equal(providerCalls, 1);
});

test("AI title service reuses the same image read across different title requests", async () => {
  let imageReads = 0;
  let providerCalls = 0;
  let releaseImage;
  const imageReady = new Promise((resolve) => { releaseImage = resolve; });
  const service = new WebAiTitleService({
    repository: { async hasGrant() { return true; } },
    mediaService: {
      async readReadySheinImage() {
        imageReads += 1;
        await imageReady;
        return { fileBytes: Buffer.from("same-image"), mimeType: "image/jpeg" };
      },
    },
    apiUrl: "https://replace.example/v1/chat/completions",
    apiKey: "secret",
    model: "qwen-vl",
    fetchImpl: async () => {
      providerCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ patternName: "复用图案" }) } }] }), { status: 200 });
    },
  });
  const context = { role: "operator", tenantId: "tenant", userId: "user" };
  const baseInput = {
    mainImageAssetId: "asset",
    titleRuleTemplateId: "title",
    titleRule: { prefix: "1pc", suffix: "Rug" },
    titleMaxLength: 250,
  };
  const first = service.suggest({ context, storeId: "store", input: { ...baseInput, currentTitle: "旧标题1" } });
  const second = service.suggest({ context, storeId: "store", input: { ...baseInput, titleRuleTemplateId: "title-2", currentTitle: "旧标题2" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(imageReads, 1);
  releaseImage();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.patternName, "复用图案");
  assert.equal(secondResult.patternName, "复用图案");
  assert.equal(secondResult.diagnostics.imageCacheSource, "inflight");
  const cached = await service.suggest({ context, storeId: "store", input: { ...baseInput, titleRuleTemplateId: "title-3", currentTitle: "旧标题3" } });
  assert.equal(cached.patternName, "复用图案");
  assert.equal(cached.diagnostics.imageCacheHit, true);
  assert.equal(cached.diagnostics.imageCacheSource, "memory");
  assert.equal(providerCalls, 3);
});

test("AI title result cache reuses image recognition across current title changes", async () => {
  let providerCalls = 0;
  const service = new WebAiTitleService({
    repository: { async hasGrant() { return true; } },
    mediaService: {
      async readReadySheinImage() {
        return { fileBytes: Buffer.from("same-image"), mimeType: "image/jpeg" };
      },
    },
    apiUrl: "https://replace.example/v1/chat/completions",
    apiKey: "secret",
    model: "qwen-vl",
    fetchImpl: async () => {
      providerCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ patternName: "复用图案" }) } }] }), { status: 200 });
    },
  });
  const context = { role: "operator", tenantId: "tenant", userId: "user" };
  const input = {
    mainImageAssetId: "asset",
    titleRuleTemplateId: "title",
    titleRule: { prefix: "1pc", suffix: "Rug" },
  };
  await service.suggest({ context, storeId: "store", input: { ...input, currentTitle: "旧标题1" } });
  const cached = await service.suggest({ context, storeId: "store", input: { ...input, currentTitle: "旧标题2" } });
  assert.equal(providerCalls, 1);
  assert.equal(cached.diagnostics.cacheHit, true);
  assert.equal(cached.diagnostics.source, "memory-cache");
});

test("AI title result cache is bounded and clears after provider settings change", async () => {
  let providerCalls = 0;
  let settings = {
    apiUrl: "https://replace.example/v1/chat/completions",
    apiKey: "secret",
    model: "qwen-vl",
    modelUrl: "",
    keyHint: "••••cret",
    updatedAt: null,
  };
  const service = new WebAiTitleService({
    repository: { async hasGrant() { return true; } },
    settingsRepository: {
      async get() { return settings; },
      async save({ apiUrl, model, modelUrl, apiKey }) {
        settings = { ...settings, apiUrl, model, modelUrl, apiKey: apiKey || settings.apiKey };
      },
    },
    mediaService: {
      async readReadySheinImage({ assetId }) {
        return { fileBytes: Buffer.from(String(assetId)), mimeType: "image/jpeg" };
      },
    },
    apiUrl: settings.apiUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    cacheMaxEntries: 1,
    fetchImpl: async () => {
      providerCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ patternName: "复用图案" }) } }] }), { status: 200 });
    },
  });
  const context = { role: "admin", tenantId: "tenant", userId: "admin" };
  const makeInput = (assetId) => ({
    mainImageAssetId: assetId,
    titleRuleTemplateId: "title",
    titleRule: { prefix: "1pc", suffix: "Rug" },
  });
  await service.suggest({ context, storeId: "store", input: makeInput("asset-1") });
  await service.suggest({ context, storeId: "store", input: makeInput("asset-2") });
  await service.suggest({ context, storeId: "store", input: makeInput("asset-1") });
  assert.equal(providerCalls, 3);
  await service.saveSettings({
    context,
    input: {
      apiUrl: settings.apiUrl,
      model: "qwen-vl-2",
      apiKey: "",
    },
  });
  await service.suggest({ context, storeId: "store", input: makeInput("asset-1") });
  assert.equal(providerCalls, 4);
});

test("AI title concurrency and queue settings stay hard-bounded", () => {
  const service = new WebAiTitleService({
    repository: { async hasGrant() { return true; } },
    mediaService: {},
    maxConcurrent: Number.POSITIVE_INFINITY,
    maxQueue: 10000,
  });
  assert.equal(service.maxConcurrent, 8);
  assert.equal(service.maxQueue, 64);
});

test("AI title image reuse is scoped by store and failed image reads are not cached", async () => {
  let imageReads = 0;
  let failNextRead = true;
  const service = new WebAiTitleService({
    repository: { async hasGrant() { return true; } },
    mediaService: {
      async readReadySheinImage() {
        imageReads += 1;
        if (failNextRead) {
          failNextRead = false;
          throw new Error("temporary object storage failure");
        }
        return { fileBytes: Buffer.from("same-image"), mimeType: "image/jpeg" };
      },
    },
    apiUrl: "https://replace.example/v1/chat/completions",
    apiKey: "secret",
    model: "qwen-vl",
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ patternName: "复用图案" }) } }] }), { status: 200 }),
  });
  const context = { role: "operator", tenantId: "tenant", userId: "user" };
  const input = {
    mainImageAssetId: "asset",
    titleRuleTemplateId: "title",
    titleRule: { prefix: "1pc" },
  };
  await assert.rejects(
    () => service.suggest({ context, storeId: "store-a", input }),
    /temporary object storage failure/,
  );
  const recovered = await service.suggest({ context, storeId: "store-a", input });
  assert.equal(recovered.patternName, "复用图案");
  await service.suggest({ context, storeId: "store-b", input });
  assert.equal(imageReads, 3);
});

test("AI title image cache expires on its configured TTL", async () => {
  let now = 0;
  let imageReads = 0;
  const service = new WebAiTitleService({
    repository: { async hasGrant() { return true; } },
    mediaService: {
      async readReadySheinImage() {
        imageReads += 1;
        return { fileBytes: Buffer.from("same-image"), mimeType: "image/jpeg" };
      },
    },
    apiUrl: "https://replace.example/v1/chat/completions",
    apiKey: "secret",
    model: "qwen-vl",
    imageCacheTtlMs: 10,
    now: () => now,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ patternName: "复用图案" }) } }] }), { status: 200 }),
  });
  const context = { role: "operator", tenantId: "tenant", userId: "user" };
  const input = {
    mainImageAssetId: "asset",
    titleRuleTemplateId: "title",
    titleRule: { prefix: "1pc" },
  };
  await service.suggest({ context, storeId: "store", input: { ...input, titleRuleTemplateId: "title-1", currentTitle: "标题1" } });
  now = 11;
  await service.suggest({ context, storeId: "store", input: { ...input, titleRuleTemplateId: "title-2", currentTitle: "标题2" } });
  assert.equal(imageReads, 2);
});

test("AI title service queues bounded work and never exceeds the configured provider concurrency", async () => {
  let activeProviders = 0;
  let maxActiveProviders = 0;
  let providerCalls = 0;
  const releases = [];
  const service = new WebAiTitleService({
    repository: { async hasGrant() { return true; } },
    mediaService: {
      async readReadySheinImage() {
        return { fileBytes: Buffer.from("image"), mimeType: "image/jpeg" };
      },
    },
    apiUrl: "https://replace.example/v1/chat/completions",
    apiKey: "secret",
    model: "qwen-vl",
    maxConcurrent: 2,
    maxQueue: 1,
    fetchImpl: async () => {
      providerCalls += 1;
      activeProviders += 1;
      maxActiveProviders = Math.max(maxActiveProviders, activeProviders);
      await new Promise((resolve) => releases.push(resolve));
      activeProviders -= 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ patternName: "复用图案" }) } }] }), { status: 200 });
    },
  });
  const context = { role: "operator", tenantId: "tenant", userId: "user" };
  const makeRequest = (currentTitle) => service.suggest({
    context,
    storeId: "store",
    input: {
      mainImageAssetId: "asset",
      titleRuleTemplateId: `title-${currentTitle}`,
      titleRule: { prefix: "1pc", suffix: "Rug" },
      currentTitle,
    },
  }).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));

  const requests = ["标题1", "标题2", "标题3"].map(makeRequest);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(providerCalls, 2);
  assert.equal(activeProviders, 2);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(providerCalls, 3);
  assert.equal(activeProviders, 2);
  releases.splice(0).forEach((release) => release());

  const results = await Promise.all(requests);
  assert.equal(results.every((result) => result.ok), true);
  assert.equal(maxActiveProviders, 2);
  assert.equal(typeof results[2].value.diagnostics.queueWaitMs, "number");
});

test("AI title service rejects only work beyond the bounded queue", async () => {
  let releaseProvider;
  const providerReady = new Promise((resolve) => { releaseProvider = resolve; });
  const service = new WebAiTitleService({
    repository: { async hasGrant() { return true; } },
    mediaService: {
      async readReadySheinImage() {
        return { fileBytes: Buffer.from("image"), mimeType: "image/jpeg" };
      },
    },
    apiUrl: "https://replace.example/v1/chat/completions",
    apiKey: "secret",
    model: "qwen-vl",
    maxConcurrent: 1,
    maxQueue: 1,
    fetchImpl: async () => {
      await providerReady;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ patternName: "复用图案" }) } }] }), { status: 200 });
    },
  });
  const context = { role: "operator", tenantId: "tenant", userId: "user" };
  const makeRequest = (currentTitle) => service.suggest({
    context,
    storeId: "store",
    input: {
      mainImageAssetId: "asset",
      titleRuleTemplateId: `title-${currentTitle}`,
      titleRule: { prefix: "1pc", suffix: "Rug" },
      currentTitle,
    },
  });
  const first = makeRequest("标题1");
  const second = makeRequest("标题2");
  const overflow = makeRequest("标题3").then(() => null, (error) => error);
  await new Promise((resolve) => setImmediate(resolve));
  const overflowError = await overflow;
  assert.equal(overflowError.code, "AI_TITLE_BUSY");
  releaseProvider();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.patternName, "复用图案");
  assert.equal(secondResult.patternName, "复用图案");
});

test("AI grant repository writes and removes tenant-scoped grants", async () => {
  const queries = [];
  const repository = new PostgresAiTitleRepository({
    pool: { query: async (query) => { queries.push(query); return { rows: [] }; } },
  });
  await repository.setGrant({ tenantId: "tenant", userId: "user", enabled: true, grantedBy: "admin" });
  await repository.setGrant({ tenantId: "tenant", userId: "user", enabled: false, grantedBy: "admin" });
  assert.equal(queries.length, 2);
  assert.match(queries[0].text, /INSERT INTO ai_feature_grants/);
  assert.match(queries[1].text, /DELETE FROM ai_feature_grants/);
});

test("AI settings repository encrypts the API key and preserves it on a blank update", async () => {
  const key = crypto.randomBytes(32).toString("base64");
  const cipher = new CloudCredentialCipher({ base64Key: key });
  const queries = [];
  const pool = {
    async query(query) {
      queries.push(query);
      if (query.text.includes("SELECT tenant_id, api_url")) return { rows: [] };
      return { rows: [] };
    },
  };
  const repository = new PostgresAiTitleSettingsRepository({ pool, cipher });
  await assert.rejects(
    () => repository.save({
      tenantId: "tenant",
      apiUrl: "https://example.test/v1/chat/completions",
      model: "replace-me",
      apiKey: "",
    }),
    (error) => error.code === "AI_TITLE_API_KEY_REQUIRED",
  );
  await repository.save({
    tenantId: "tenant",
    apiUrl: "https://example.test/v1/chat/completions",
    model: "replace-me",
    apiKey: "super-secret",
    configuredBy: "admin",
  });
  const insert = queries.find((query) => query.text.includes("INSERT INTO tenant_ai_title_settings"));
  assert.ok(insert);
  assert.equal(insert.values.includes("super-secret"), false);
  assert.equal(insert.values[4], "••••cret");
});

test("AI settings repository rejects malformed endpoints before touching storage", async () => {
  const key = crypto.randomBytes(32).toString("base64");
  const cipher = new CloudCredentialCipher({ base64Key: key });
  let queryCount = 0;
  const repository = new PostgresAiTitleSettingsRepository({
    cipher,
    pool: { query: async () => { queryCount += 1; return { rows: [] }; } },
  });
  await assert.rejects(
    () => repository.save({
      tenantId: "tenant",
      apiUrl: "http://example.test/v1/chat/completions",
      model: "qwen-vl",
      apiKey: "secret",
    }),
    (error) => error.code === "AI_TITLE_INVALID_API_URL",
  );
  await assert.rejects(
    () => repository.save({
      tenantId: "tenant",
      apiUrl: "https://example.test/v1/chat/completions",
      model: "",
      modelUrl: "",
      apiKey: "secret",
    }),
    (error) => error.code === "AI_TITLE_MODEL_REQUIRED",
  );
  assert.equal(queryCount, 0);
});
