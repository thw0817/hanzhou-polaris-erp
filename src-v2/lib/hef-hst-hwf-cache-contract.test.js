import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("HEF/HST dashboard caches are scoped to the authenticated tenant and user", async () => {
  const [hook, overview, todayWork] = await Promise.all([
    source("features/operations/use-business-dashboard.ts"),
    source("features/overview/OverviewPage.tsx"),
    source("features/overview/TodayWorkPage.tsx"),
  ]);

  assert.match(hook, /const queryScope = `\$\{session\.tenant\.id\}:\$\{session\.user\.id\}`/);
  assert.match(hook, /\["store", queryScope, storeId, "business-dashboard"\]/);
  assert.match(overview, /useBusinessDashboard\(storeId\)/);
  assert.doesNotMatch(overview, /queryKey: \["store", queryScope, storeId, "business-dashboard"\]/);
  assert.match(todayWork, /queryKey: \["today-work", queryScope, date, storeId\]/);
});

test("manual-refresh data caches have bounded retention and avoid focus/reconnect storms", async () => {
  const [hook, overview, todayWork] = await Promise.all([
    source("features/operations/use-business-dashboard.ts"),
    source("features/overview/OverviewPage.tsx"),
    source("features/overview/TodayWorkPage.tsx"),
  ]);

  for (const file of [hook, todayWork]) {
    assert.match(file, /gcTime: 10 \* 60_000/);
    assert.match(file, /refetchOnWindowFocus: false/);
    assert.match(file, /refetchOnReconnect: false/);
  }
  assert.match(overview, /useBusinessDashboard\(storeId\)/);
  assert.doesNotMatch(overview, /useQuery\(/);
});
