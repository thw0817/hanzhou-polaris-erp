import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overviewSource = readFileSync(
  new URL("../../src-v2/features/overview/OverviewPage.tsx", import.meta.url),
  "utf8",
);
const dashboardHookSource = readFileSync(
  new URL("../../src-v2/features/operations/use-business-dashboard.ts", import.meta.url),
  "utf8",
);
const publishCenterSource = readFileSync(
  new URL("../../src-v2/features/publishing/PublishBatchesPage.tsx", import.meta.url),
  "utf8",
);

test("overview and operations share one business dashboard refresh owner", () => {
  assert.match(overviewSource, /useBusinessDashboard/);
  assert.doesNotMatch(overviewSource, /api\.refreshBusinessDashboard/);
  assert.doesNotMatch(overviewSource, /useQuery\(/);
  assert.match(dashboardHookSource, /api\.refreshBusinessDashboard/);
  assert.match(dashboardHookSource, /invalidateQueries\(\{ queryKey, refetchType: "active" \}\)/);
  assert.match(publishCenterSource, /useBusinessDashboard/);
  assert.doesNotMatch(publishCenterSource, /api\.refreshBusinessDashboard/);
  assert.doesNotMatch(publishCenterSource, /businessQuery\.refetch\(\)/);
});
