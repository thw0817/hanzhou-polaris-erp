import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../src-v2/features/", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("SRF-02 keeps cooldown countdown local and request-free", () => {
  const source = read("operations/refresh-state.ts");
  assert.match(source, /setInterval\(\(\) => setNow\(Date\.now\(\)\), 1_000\)/);
  assert.match(source, /lastManualRefreshAt/);
  assert.doesNotMatch(source, /fetch\(|api\./);
});

test("SRF-02 revalidates the shared dashboard after an active job reaches a terminal state", () => {
  const source = read("operations/use-business-dashboard.ts");
  assert.match(source, /business-dashboard-refresh-job/);
  assert.match(source, /refetchInterval:/);
  assert.match(source, /refetchIntervalInBackground: false/);
  assert.match(source, /persistedJobId/);
  assert.match(source, /invalidateQueries\(\{ queryKey, refetchType: "active" \}\)/);
  // The active job must be stored with its tenant/user/store scope so a
  // shared hook instance cannot poll a previous store after switching.
  assert.match(source, /setActiveJob\(jobId \? \{ scopeKey, id: jobId \} : null\)/);
});

test("SRF-02 applies active-job revalidation to the overview without global polling", () => {
  const source = read("overview/OverviewPage.tsx");
  assert.match(source, /useBusinessDashboard\(storeId\)/);
  assert.doesNotMatch(source, /refetchInterval:/);
  assert.doesNotMatch(source, /setQueryData/);
  assert.match(source, /useRefreshCooldown/);
  assert.doesNotMatch(source, /api\.refreshBusinessDashboard/);
});
