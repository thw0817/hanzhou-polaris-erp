import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const refreshSource = readFileSync(
  new URL("../../src-v2/features/operations/refresh-state.ts", import.meta.url),
  "utf8",
);

test("SRF-08 keeps the server cooldown authoritative when it exceeds the local window", () => {
  assert.match(
    refreshSource,
    /const localRemaining = Math\.max\(0,\s*Math\.ceil\(\(timestamp \+ MANUAL_REFRESH_COOLDOWN_MS - now\) \/ 1000\)\);[\s\S]*return Math\.max\(fallback, localRemaining\);/,
  );
});

test("SRF-08 does not replace a server retry delay with a shorter timestamp window", () => {
  const refreshFunction = refreshSource.match(
    /export function refreshCooldownSeconds\([\s\S]*?\n}\n\n\/\*\*/,
  )?.[0] || "";
  assert.match(refreshFunction, /const fallback =/);
  assert.match(refreshFunction, /MANUAL_REFRESH_COOLDOWN_MS/);
  assert.match(refreshFunction, /Math\.max\(fallback/);
});
