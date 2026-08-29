import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("SRF-09 clears authenticated query and store-selection state after session expiry", () => {
  const source = read("src-v2/app/AppShell.tsx");
  assert.match(source, /const sessionError = sessionQuery\.error as ApiError \| null/);
  assert.match(source, /sessionError\?\.status !== 401/);
  assert.match(source, /queryClient\.clear\(\)/);
  assert.match(source, /removeItem\(CURRENT_STORE_STORAGE_KEY\)/);
});

test("SRF-09 installs a new login session only after discarding the old query cache", () => {
  const source = read("src-v2/features/auth/LoginPage.tsx");
  assert.match(source, /queryClient\.clear\(\);\s*queryClient\.setQueryData\(\[\"session\"\]/);
  assert.match(source, /getQueryState\(\[\"session\"\]\)/);
  assert.match(source, /status === \"success\"/);
});
