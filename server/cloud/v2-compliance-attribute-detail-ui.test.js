import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../../src-v2/features/compliance/ComplianceDetailPage.tsx", import.meta.url),
  "utf8",
);
const serviceSource = readFileSync(
  new URL("./compliance-workspace-service.js", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src-v2/lib/api.ts", import.meta.url),
  "utf8",
);

test("compliance detail keeps saved attributes out of the official report decision", () => {
  assert.doesNotMatch(pageSource, /全部商品属性/);
  assert.doesNotMatch(pageSource, /field\.required \? "必填" : "选填"/);
  assert.match(pageSource, /SHEIN 官方报告要求/);
  assert.match(pageSource, /唯一依据/);
  assert.match(serviceSource, /fields = asArray\(schema\.fields\)\.map/);
  assert.match(serviceSource, /valueLabels/);
  assert.match(apiSource, /fields: Array<\{/);
});
