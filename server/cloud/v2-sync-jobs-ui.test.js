import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../../src-v2/features/operations/SyncJobsPage.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src-v2/lib/api.ts", import.meta.url),
  "utf8",
);

test("sync task center labels full-category schema jobs", () => {
  assert.match(pageSource, /function jobLabel/);
  assert.match(pageSource, /job\.jobType === "rule_refresh"/);
  assert.match(pageSource, /job\.progress\.scope === "all"/);
  assert.match(pageSource, /全类目 schema 同步/);
  assert.match(pageSource, /jobLabel\(job\)/);
  assert.match(pageSource, /jobLabel\(detail\)/);
  assert.match(apiSource, /scope\?: "referenced" \| "all"/);
  assert.match(pageSource, /失败类目/);
  assert.match(pageSource, /failedTargets/);
  assert.match(apiSource, /failedTargets\?: SyncJobFailedTarget\[\]/);
  assert.match(pageSource, /仅重试失败类目/);
  assert.match(pageSource, /api\.retryRuleRefresh\(storeId, jobId\)/);
  assert.match(apiSource, /retryRuleRefresh: \(storeId: string, jobId: string\)/);
  assert.match(pageSource, /const \[feedback, setFeedback\]/);
  assert.match(pageSource, /notice-success/);
  assert.match(pageSource, /规则刷新任务已创建/);
  assert.match(pageSource, /合规刷新任务已创建/);
  assert.match(pageSource, /失败类目重试任务已创建/);
  assert.match(pageSource, /\["owner", "admin"\]\.includes\(session\.user\.role\)/);
  assert.match(pageSource, /const hasJobFilter = Boolean/);
  assert.match(pageSource, /jobSearch/);
  assert.match(pageSource, /visibleJobs/);
  assert.match(pageSource, /搜索同步任务/);
  assert.match(pageSource, /job\.error\?\.message/);
  assert.match(pageSource, /没有匹配的同步任务/);
  assert.match(pageSource, /调整任务搜索、类型或状态筛选后重试/);
});
