import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editorSource = readFileSync(
  new URL("../../src-v2/features/publishing/NewProductPage.tsx", import.meta.url),
  "utf8",
);
const batchSource = readFileSync(
  new URL("../../src-v2/features/publishing/BatchProductCreatePage.tsx", import.meta.url),
  "utf8",
);
const reviewSource = readFileSync(
  new URL("../../src-v2/features/publishing/PublishBatchesPage.tsx", import.meta.url),
  "utf8",
);
const membersSource = readFileSync(
  new URL("../../src-v2/features/settings/MembersPage.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src-v2/lib/api.ts", import.meta.url),
  "utf8",
);
const contractSource = readFileSync(
  new URL("../../src-v2/lib/ai-title-contract.js", import.meta.url),
  "utf8",
);
const serviceSource = readFileSync(
  new URL("./ai-title-service.js", import.meta.url),
  "utf8",
);
const composeSource = readFileSync(
  new URL("../../deploy/docker-compose.cloud.yml", import.meta.url),
  "utf8",
);

test("single-product AI title is capability-gated and composes the template", () => {
  assert.match(editorSource, /aiTitleCapability/);
  assert.match(editorSource, /data\?\.visible/);
  assert.match(editorSource, /buildAiTitleRequest/);
  assert.match(editorSource, /api\.suggestAiTitle/);
  assert.match(editorSource, /composeAiTitle/);
  assert.match(editorSource, /mainImages\[0\]\?\.id/);
  assert.match(editorSource, /error\.traceId/);
});

test("batch product creation reuses the same AI title workflow and keeps uploads bounded", () => {
  assert.match(batchSource, /aiTitleCapability/);
  assert.match(batchSource, /generateBatchAiTitles/);
  assert.match(batchSource, /ensureAiMainAsset/);
  assert.match(batchSource, /api\.suggestAiTitle/);
  assert.match(batchSource, /selectedGroups\.length/);
  assert.match(batchSource, /aiPatternName/);
  assert.match(batchSource, /titleRuleBaseTitle/);
  assert.match(batchSource, /failureDetails/);
  assert.match(batchSource, /error\.traceId/);
});

test("batch AI title generation uses bounded parallel workers and visible progress", () => {
  assert.match(batchSource, /aiTitleProgress/);
  assert.match(batchSource, /Math\.min\(2, selectedGroups\.length\)/);
  assert.match(batchSource, /Promise\.all/);
  assert.match(batchSource, /并行识别中/);
});

test("商品审核中心 exposes AI title only to authorized members and opens template-based generation", () => {
  assert.match(reviewSource, /aiTitleCapability/);
  assert.match(reviewSource, /data\?\.visible/);
  assert.match(reviewSource, /aiTitle/);
  assert.match(reviewSource, /Sparkles/);
  assert.match(reviewSource, /重新编辑/);
});

test("AI title access is assigned per regular member and never shown as a role replacement", () => {
  assert.match(apiSource, /updateMemberFeatureAccess/);
  assert.match(apiSource, /aiTitleCapability/);
  assert.match(membersSource, /updateFeature/);
  assert.match(membersSource, /AI标题/);
  assert.match(membersSource, /\["owner", "admin"\]\.includes\(member\.role\)/);
});

test("administrators can configure the provider from web settings without exposing the key", () => {
  assert.match(apiSource, /aiTitleSettings/);
  assert.match(apiSource, /saveAiTitleSettings/);
  assert.match(membersSource, /AI 标题服务/);
  assert.match(membersSource, /API 密钥/);
  assert.match(membersSource, /keyHint/);
  assert.match(membersSource, /密钥仅在服务端加密存储/);
});

test("AI title API errors preserve the server trace and diagnostics for the UI", () => {
  assert.match(apiSource, /traceId: string \| null/);
  assert.match(apiSource, /payload\.traceId/);
  assert.match(apiSource, /payload\.diagnostics/);
});

test("title contract does not permit the model to replace the surrounding rule", () => {
  assert.match(contractSource, /parts = \[normalizedRule\.prefix, pattern, suffix\]/);
  assert.match(contractSource, /AI_PATTERN_MAX_LENGTH = 24/);
  assert.match(contractSource, /titleRuleTemplateId/);
});

test("AI title image reuse is bounded, store-scoped, and observable", () => {
  assert.match(serviceSource, /imageCacheTtlMs/);
  assert.match(serviceSource, /imageCacheMaxEntries/);
  assert.match(serviceSource, /imageCacheMaxBytes/);
  assert.match(serviceSource, /imagePending/);
  assert.match(serviceSource, /imageCacheSource = "memory"/);
  assert.match(serviceSource, /imageCacheSource = "inflight"/);
  assert.match(serviceSource, /tenantId: text\(context\?\.tenantId/);
  assert.match(serviceSource, /storeId: text\(storeId/);
});

test("cloud control passes the AI title queue limit through Compose", () => {
  assert.match(composeSource, /SHEIN_TITLE_AI_MAX_CONCURRENT/);
  assert.match(composeSource, /SHEIN_TITLE_AI_MAX_QUEUE/);
});
