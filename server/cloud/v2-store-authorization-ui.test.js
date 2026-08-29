import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../../src-v2/features/settings/StoresPage.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src-v2/lib/api.ts", import.meta.url),
  "utf8",
);
const controlSource = readFileSync(
  new URL("./control-server.js", import.meta.url),
  "utf8",
);
const demoSource = readFileSync(
  new URL("./web-demo-server.js", import.meta.url),
  "utf8",
);

test("V2 store management can start and display SHEIN reauthorization", () => {
  assert.match(pageSource, /api\.startSheinAuthorization/);
  assert.match(pageSource, /授权或重新授权/);
  assert.match(pageSource, /sheinAuthorized/);
  assert.match(pageSource, /sheinAuthError/);
  assert.match(pageSource, /const storesQueryKey = \["stores", `\$\{session\.tenant\.id\}:\$\{session\.user\.id\}`\] as const/);
  assert.match(pageSource, /invalidateQueries\(\{ queryKey: storesQueryKey \}\)/);
  assert.match(apiSource, /\/v1\/web\/shein\/auth\/start/);
});

test("V2 store management can revoke authorization with a history-preserving confirmation", () => {
  assert.match(pageSource, /api\.revokeStoreAuthorization/);
  assert.match(pageSource, /确定删除.*店铺授权吗/);
  assert.doesNotMatch(pageSource, /请输入完整店铺名称以继续/);
  assert.match(pageSource, /授权已删除/);
  assert.match(apiSource, /method: "DELETE"/);
  assert.match(controlSource, /revokeStoreAuthorization/);
  assert.match(demoSource, /request\.method === "DELETE"/);
});

test("web authorization returns to the V2 store page and demo fails closed", () => {
  assert.match(
    controlSource,
    /new URL\("\/app\/settings\/stores", webAppBaseUrl\)/,
  );
  assert.match(demoSource, /SHEIN_AUTHORIZATION_UNAVAILABLE/);
  assert.match(demoSource, /演示环境未连接真实 SHEIN 授权服务/);
  assert.match(demoSource, /environment: "demo"/);
});

test("V2 store management only renders authorized SHEIN stores", () => {
  assert.doesNotMatch(pageSource, /demoStore/);
  assert.doesNotMatch(pageSource, /进入本地字段演示/);
  assert.match(pageSource, /当前账号可访问 \{stores\.length\} 家 SHEIN 店铺/);
  assert.match(pageSource, /stores\.map\(\(store\)/);
});

test("V2 store management distinguishes the administrator alias from the member label", () => {
  assert.match(pageSource, /管理员店铺别名/);
  assert.match(pageSource, /成员看到/);
  assert.match(pageSource, /adminAlias/);
  assert.match(apiSource, /adminAlias/);
});
