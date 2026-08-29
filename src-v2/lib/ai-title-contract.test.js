import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_TITLE_DEFAULT_MAX_LENGTH,
  AI_TITLE_MAX_LENGTH,
  AI_PATTERN_MAX_LENGTH,
  buildAiTitleRequest,
  composeAiTitle,
  normalizeAiPatternName,
  validateAiTitleProviderSettings,
} from "./ai-title-contract.js";

test("AI title composition keeps the template structure and replaces the pattern slot", () => {
  const first = composeAiTitle({
    rule: { prefix: "1pc, Modern Area Rug", keywords: "Living Room", suffix: "Soft Decor" },
    patternName: "复古波纹",
    maxLength: 120,
  });
  const second = composeAiTitle({
    rule: { prefix: "1pc, Modern Area Rug", keywords: "Living Room", suffix: "Soft Decor" },
    patternName: "几何花卉",
    maxLength: 120,
  });
  assert.equal(first.title, "1pc, Modern Area Rug 复古波纹 Living Room Soft Decor");
  assert.equal(second.title, "1pc, Modern Area Rug 几何花卉 Living Room Soft Decor");
  assert.doesNotMatch(second.title, /复古波纹/);
});

test("AI pattern output is bounded and final title respects the official limit", () => {
  const pattern = normalizeAiPatternName("  复杂图案 `<script> 这是很长的命名1234567890  ");
  assert.ok(pattern.length <= AI_PATTERN_MAX_LENGTH);
  assert.doesNotMatch(pattern, /[<>`$]/);
  const result = composeAiTitle({
    rule: { prefix: "开头", suffix: "后缀" },
    patternName: pattern,
    maxLength: 8,
  });
  assert.equal(result.title.length, 8);
  assert.equal(result.valid, false);
  assert.equal(result.truncated, true);
});

test("AI title request requires a main image and title rule template", () => {
  assert.deepEqual(
    buildAiTitleRequest({ mainImageAssetId: "asset-1" }),
    { valid: false, code: "AI_TITLE_TEMPLATE_REQUIRED", error: "请先选择标题规则模板" },
  );
  const request = buildAiTitleRequest({
    mainImageAssetId: "asset-1",
    titleRuleTemplateId: "title-1",
    titleRule: { prefix: "1pc", suffix: "Rug" },
    currentTitle: "旧标题",
    titleMaxLength: 250,
  });
  assert.equal(request.valid, true);
  assert.equal(request.input.mainImageAssetId, "asset-1");
});

test("AI title request rejects incomplete or unsafe input instead of silently coercing it", () => {
  assert.deepEqual(
    buildAiTitleRequest({}),
    { valid: false, code: "AI_TITLE_MAIN_IMAGE_REQUIRED", error: "商品主图不能为空" },
  );
  assert.deepEqual(
    buildAiTitleRequest({
      mainImageAssetId: "asset-1",
      titleRuleTemplateId: "   ",
      titleRule: { prefix: "1pc" },
    }),
    { valid: false, code: "AI_TITLE_TEMPLATE_REQUIRED", error: "请先选择标题规则模板" },
  );
  assert.deepEqual(
    buildAiTitleRequest({
      mainImageAssetId: "asset-1",
      titleRuleTemplateId: "title-1",
      titleRule: {},
    }),
    { valid: false, code: "AI_TITLE_TEMPLATE_INVALID", error: "标题规则模板没有可用内容" },
  );
  assert.deepEqual(
    buildAiTitleRequest({
      mainImageAssetId: "asset-1",
      titleRuleTemplateId: "title-1",
      titleRule: { prefix: "1pc" },
      titleMaxLength: 0,
    }),
    { valid: false, code: "AI_TITLE_LENGTH_INVALID", error: `标题字符上限必须是2-${AI_TITLE_MAX_LENGTH}之间的整数` },
  );
  const defaults = buildAiTitleRequest({
    mainImageAssetId: "asset-1",
    titleRuleTemplateId: "title-1",
    titleRule: { prefix: "1pc" },
  });
  assert.equal(defaults.input.titleMaxLength, AI_TITLE_DEFAULT_MAX_LENGTH);
  assert.equal(defaults.input.locale, "zh-cn");
});

test("AI title provider settings require a valid HTTPS endpoint and model", () => {
  assert.equal(validateAiTitleProviderSettings({ apiUrl: "http://provider.test", model: "qwen" }).code, "AI_TITLE_INVALID_API_URL");
  assert.equal(validateAiTitleProviderSettings({ apiUrl: "https://", model: "qwen" }).code, "AI_TITLE_INVALID_API_URL");
  assert.equal(validateAiTitleProviderSettings({ apiUrl: "https://user:pass@provider.test/v1", model: "qwen" }).code, "AI_TITLE_INVALID_API_URL");
  assert.equal(validateAiTitleProviderSettings({ apiUrl: "https://provider.test/v1" }).code, "AI_TITLE_MODEL_REQUIRED");
  const valid = validateAiTitleProviderSettings({
    apiUrl: " https://provider.test/v1/chat/completions ",
    model: " qwen-vl ",
    apiKey: " key-123 ",
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.settings.apiUrl, "https://provider.test/v1/chat/completions");
  assert.equal(valid.settings.model, "qwen-vl");
  assert.equal(valid.settings.apiKey, "key-123");
});
