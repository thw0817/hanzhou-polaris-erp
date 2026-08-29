import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTitleRule,
  stripTitleRuleFragments,
  titleRuleTemplatePaths,
  validateTitleRuleTemplateDraft,
} from "./title-rule-template-contract.js";

test("title rule template paths reuse the publish template service", () => {
  assert.deepEqual(titleRuleTemplatePaths("store/1", "template/1"), {
    templates: "/v1/web/stores/store%2F1/publish-templates?type=title_rule",
    template: "/v1/web/stores/store%2F1/publish-templates/template%2F1",
  });
});

test("title rules prefer a complete replacement title", () => {
  const result = applyTitleRule("旧标题", {
    fullTitle: "现代抽象客厅地毯",
    prefix: "前缀",
    keywords: "关键词",
    suffix: "后缀",
  });
  assert.equal(result, "现代抽象客厅地毯");
});

test("title rules compose reusable fragments around the current product title", () => {
  assert.equal(
    applyTitleRule("几何地毯", {
      prefix: "现代",
      keywords: "防滑 可机洗",
      suffix: "客厅卧室适用",
    }),
    "现代 几何地毯 防滑 可机洗 客厅卧室适用",
  );
});

test("title re-reference strips every repeated old fragment before applying a new rule", () => {
  const base = stripTitleRuleFragments(
    "前缀 几何地毯 旧词 前缀 旧词 前缀",
    { prefix: "前缀", keywords: "旧词" },
  );
  assert.equal(base, "几何地毯");
  assert.equal(
    applyTitleRule(base, { prefix: "新前缀", keywords: "新词" }),
    "新前缀 几何地毯 新词",
  );
});

test("title rule drafts require a name and at least one reusable rule", () => {
  const invalid = validateTitleRuleTemplateDraft({ name: "", prefix: "" });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.name, "请填写模板名称");
  assert.equal(invalid.errors.rule, "请至少填写一项标题规则");

  const valid = validateTitleRuleTemplateDraft({
    name: "地毯常用标题",
    prefix: "现代",
    keywords: "防滑\n可机洗",
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.data.template, {
    fullTitle: "",
    prefix: "现代",
    keywords: "防滑 可机洗",
    suffix: "",
  });
});
