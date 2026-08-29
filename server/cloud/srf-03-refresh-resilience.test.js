import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeJobRefetchInterval } from "../../src-v2/lib/refresh-state.js";
import {
  buildComplianceSyncWorkerOptions,
  COMPLIANCE_SYNC_WORKER_LOCK_DURATION_MS,
  COMPLIANCE_SYNC_WORKER_LOCK_RENEW_TIME_MS,
  COMPLIANCE_SYNC_WORKER_STALLED_INTERVAL_MS,
} from "./compliance-sync-worker.js";
import { PostgresSyncJobRepository } from "./sync-job-service.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("SRF-03 backs off active task polling as a job ages", () => {
  const now = Date.now();
  assert.equal(activeJobRefetchInterval({ state: { status: "pending", data: null } }, now), false);
  assert.equal(activeJobRefetchInterval({ state: { status: "success", data: { job: { state: "running", startedAt: new Date(now - 12_000).toISOString() } } } }, now), 3_000);
  assert.equal(activeJobRefetchInterval({ state: { status: "success", data: { job: { state: "running", startedAt: new Date(now - 45_000).toISOString() } } } }, now), 5_000);
  assert.equal(activeJobRefetchInterval({ state: { status: "success", data: { job: { state: "running", startedAt: new Date(now - 120_000).toISOString() } } } }, now), 10_000);
  assert.equal(activeJobRefetchInterval({ state: { status: "success", data: { job: { state: "succeeded" } } } }, now), false);
});

test("SRF-03 compliance worker keeps long reads from being marked stalled", () => {
  const options = buildComplianceSyncWorkerOptions({ concurrency: 1 });
  assert.equal(options.lockDuration, COMPLIANCE_SYNC_WORKER_LOCK_DURATION_MS);
  assert.equal(options.lockRenewTime, COMPLIANCE_SYNC_WORKER_LOCK_RENEW_TIME_MS);
  assert.equal(options.stalledInterval, COMPLIANCE_SYNC_WORKER_STALLED_INTERVAL_MS);
  assert.ok(options.lockDuration > options.lockRenewTime);
});

test("SRF-03 restores persisted active jobs after a hard reload", () => {
  const compliance = read("src-v2/features/compliance/CompliancePage.tsx");
  const templates = read("src-v2/features/templates/AttributeTemplatesPage.tsx");
  for (const source of [compliance, templates]) {
    assert.match(source, /api\.syncJobs\(storeId/);
    assert.match(source, /(?:state|job\.state) === "queued" \|\| (?:state|job\.state) === "running"/);
    assert.match(source, /if \(\w+JobId\) return;/);
  }
});

test("SRF-03 reconciles stale compliance and rule jobs before listing", async () => {
  let query = null;
  const repository = new PostgresSyncJobRepository({
    pool: { async query(input) { query = input; return { rowCount: 0, rows: [] }; } },
  });
  await repository.reconcileStale({ tenantId: "tenant-1", storeId: "store-1", now: new Date("2026-08-27T00:00:00.000Z") });
  assert.match(query.text, /UPDATE sync_jobs/);
  assert.match(query.text, /compliance_sync/);
  assert.match(query.text, /rule_refresh/);
  assert.match(query.text, /SYNC_JOB_TIMEOUT/);
  assert.deepEqual(query.values.slice(0, 2), ["tenant-1", "store-1"]);
});
