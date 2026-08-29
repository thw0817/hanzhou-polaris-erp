import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pageSource = fs.readFileSync(new URL("../../src-v2/features/overview/TodayWorkPage.tsx", import.meta.url), "utf8");
const shellSource = fs.readFileSync(new URL("../../src-v2/app/AppShell.tsx", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../../src-v2/app/App.tsx", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("../../src-v2/lib/api.ts", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("./control-server.js", import.meta.url), "utf8");

test("V2 exposes a permission-scoped today work dashboard with manual refresh", () => {
  assert.match(pageSource, /今日工作/);
  assert.match(pageSource, /手动刷新/);
  assert.doesNotMatch(pageSource, /refetchInterval/);
  assert.match(pageSource, /api\.todayWork/);
  assert.match(pageSource, /今日提交/);
  assert.match(pageSource, /已提交 SHEIN 的商品/);
  assert.doesNotMatch(pageSource, /label="今日上新"/);
  assert.match(pageSource, /核价通过/);
  assert.match(pageSource, /商品驳回/);
  assert.match(pageSource, /类目分布/);
  assert.match(shellSource, /path: "today-work"/);
  assert.match(appSource, /path="today-work"/);
  assert.match(apiSource, /\/v1\/web\/today-work/);
});

test("today work API scopes through the authenticated store list", () => {
  assert.match(serverSource, /url\.pathname === "\/v1\/web\/today-work"/);
  assert.match(serverSource, /const stores = await webAuth\.listStores\(context\)/);
  assert.match(serverSource, /STORE_FORBIDDEN/);
  assert.match(serverSource, /webTodayWork\.list/);
});
