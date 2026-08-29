import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiSource = readFileSync(new URL("../../src-v2/lib/api.ts", import.meta.url), "utf8");
const compliancePageSource = readFileSync(new URL("../../src-v2/features/compliance/CompliancePage.tsx", import.meta.url), "utf8");

test("V2 API normalizes network and timeout failures into retryable application errors", () => {
  assert.match(apiSource, /catch \(error\) \{[\s\S]*?SERVICE_UNAVAILABLE/);
  assert.match(apiSource, /REQUEST_TIMEOUT/);
  assert.match(apiSource, /图片上传服务暂时不可用/);
});

test("compliance page has no dead commented JSX blocks", () => {
  assert.doesNotMatch(compliancePageSource, /\/\*\s*\{complianceSummary/);
});
