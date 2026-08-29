import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(
  new URL("../../src-v2/app/App.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../../src-v2/app/AppShell.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../../src-v2/features/overview/OverviewPage.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src-v2/lib/api.ts", import.meta.url),
  "utf8",
);

test("V2 overview only reads and refreshes the currently selected authorized store", () => {
  assert.match(appSource, /OverviewPage/);
  assert.match(appSource, /path="overview"/);
  assert.match(shellSource, /suffix: "overview"/);
  assert.match(shellSource, /label: "总览"/);
  assert.match(shellSource, /to="\/app\/overview"/);
  assert.match(shellSource, /filter\(isAuthorizedSheinStore\)/);
  assert.match(apiSource, /export function isAuthorizedSheinStore/);
  assert.match(pageSource, /const \{ currentStore(?:, session)? \} = useAppContext\(\)/);
  assert.match(pageSource, /useBusinessDashboard\(storeId\)/);
  assert.doesNotMatch(pageSource, /api\.businessDashboard\(storeId\)/);
  assert.doesNotMatch(pageSource, /api\.refreshBusinessDashboard\(storeId\)/);
  assert.doesNotMatch(pageSource, /useQueries/);
  assert.doesNotMatch(pageSource, /stores\.map\(\(store\)/);
  assert.doesNotMatch(pageSource, /Promise\.allSettled/);
  assert.match(pageSource, /refreshError/);
  assert.match(pageSource, /dataStatus/);
  assert.match(pageSource, /sourceCutoff/);
  assert.match(pageSource, /数据过期/);
  assert.match(pageSource, /部分失败/);
  assert.match(apiSource, /businessDashboard: \(storeId: string\)/);
});

test("V2 shell persists an authorized store selection across overview navigation and reload", () => {
  assert.match(shellSource, /CURRENT_STORE_STORAGE_KEY/);
  assert.match(shellSource, /localStorage\.getItem\(CURRENT_STORE_STORAGE_KEY\)/);
  assert.match(shellSource, /localStorage\.setItem\(CURRENT_STORE_STORAGE_KEY, currentStore\.id\)/);
  assert.match(shellSource, /new URLSearchParams\(location\.search\)\.get\("store"\)/);
  assert.match(shellSource, /\/app\/overview\?store=/);
  assert.match(shellSource, /stores\.some\(\(store\) => store\.id ===/);
});

test("overview keeps single-store period comparison and restock analysis inside trusted snapshot fields", () => {
  assert.match(pageSource, /当日/);
  assert.match(pageSource, /近 7 日/);
  assert.match(pageSource, /近 30 日/);
  assert.match(pageSource, /当前经营快照的周期聚合对比，不代表连续历史曲线/);
  assert.match(pageSource, /product\.replenishmentGap/);
  assert.match(pageSource, /建议备货/);
  assert.match(pageSource, /product\.daysOfCover/);
  assert.doesNotMatch(pageSource, /店铺对比/);
  assert.doesNotMatch(pageSource, /跨店铺/);
});

test("overview exposes official actual and transit inventory fields without deriving platform status", () => {
  assert.match(pageSource, /SHEIN stock-query 官方回读/);
  assert.match(pageSource, /snapshot\?\.totals\?\.actualInventory/);
  assert.match(pageSource, /snapshot\?\.totals\?\.transitInventory/);
});
