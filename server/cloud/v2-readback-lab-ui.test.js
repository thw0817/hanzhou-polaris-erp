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
const apiSource = readFileSync(
  new URL("../../src-v2/lib/api.ts", import.meta.url),
  "utf8",
);

test("standalone readback lab UI is removed while internal readback APIs remain", () => {
  assert.doesNotMatch(appSource, /ReadbackLabPage/);
  assert.doesNotMatch(appSource, /path="operations\/:storeId\/readback"/);
  assert.doesNotMatch(shellSource, /只读联调/);
  assert.match(apiSource, /\/publish\/document-state/);
  assert.match(apiSource, /\/publish\/spu-info/);
  assert.match(apiSource, /\/publish\/compliance-revalidation/);
});
