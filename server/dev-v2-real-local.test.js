import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./dev-v2-real-local.js", import.meta.url), "utf8");

test("real local V2 launcher sends authorization through the local callback", () => {
  assert.match(source, /SHEIN_LOCAL_DIRECT_AUTH: "true"/);
  assert.match(source, /SHEIN_REDIRECT_URL: `http:\/\/127\.0\.0\.1:\$\{webPort\}\/app\/settings\/stores`/);
  assert.match(source, /SHEIN_DESKTOP_REDIRECT_URL/);
  assert.match(source, /`http:\/\/127\.0\.0\.1:\$\{proxyPort\}\/api\/shein\/auth\/callback`/);
});
