import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../../src-v2/features/settings/MembersPage.tsx", import.meta.url),
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
const authSource = readFileSync(
  new URL("./web-auth.js", import.meta.url),
  "utf8",
);

test("管理员账户别名只在成员管理视图编辑", () => {
  assert.match(pageSource, /管理员账户别名（仅管理员可见）/);
  assert.match(pageSource, /api\.updateMemberAdminAlias/);
  assert.match(pageSource, /清空后恢复显示该用户真实账户名/);
  assert.match(apiSource, /\/alias/);
  assert.match(controlSource, /updateMemberAdminAlias/);
  assert.match(authSource, /web\.member\.admin_alias\.update/);
});
