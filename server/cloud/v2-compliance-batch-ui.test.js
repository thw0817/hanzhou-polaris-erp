import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../../src-v2/features/compliance/CompliancePage.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src-v2/lib/api.ts", import.meta.url),
  "utf8",
);
const serviceSource = readFileSync(
  new URL("./compliance-workspace-service.js", import.meta.url),
  "utf8",
);
const controlSource = readFileSync(
  new URL("./control-server.js", import.meta.url),
  "utf8",
);
const templateSource = readFileSync(
  new URL("./publish-template-service.js", import.meta.url),
  "utf8",
);

test("compliance workspace exposes real batch evidence draft workflow", () => {
  for (const label of [
    "批量合规资料",
    "1630/1631",
    "报告生效日期",
    "包装实拍图",
    "商品本体实拍图",
    "引用模板",
    "批量保存实拍图",
  ]) {
    assert.match(pageSource, new RegExp(label));
  }
  assert.match(pageSource, /multiple/);
  assert.match(pageSource, /categoryPath/);
  assert.match(pageSource, /imageUrl/);
  assert.match(apiSource, /saveComplianceBatchDraft/);
  assert.match(serviceSource, /async saveBatchDrafts\(/);
  assert.match(serviceSource, /spu\.raw_data AS spu_raw_data/);
  assert.match(serviceSource, /spu_raw_data/);
  assert.match(controlSource, /compliance-workspace\/batch-drafts/);
  assert.match(pageSource, /SHEIN 已返回/);
  assert.match(pageSource, /等待 SHEIN 返回报告类型/);
  assert.doesNotMatch(pageSource, /aria-label="报告类型"/);
});

test("compliance templates retain two package photos and one body photo", () => {
  assert.match(templateSource, /labelGroup === "2"/);
  assert.match(templateSource, /labelGroup === "1"/);
  assert.match(templateSource, /photoCounts/);
});
