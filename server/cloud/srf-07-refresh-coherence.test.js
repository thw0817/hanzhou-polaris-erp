import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const refreshSource = readFileSync(
  new URL("../../src-v2/features/operations/refresh-state.ts", import.meta.url),
  "utf8",
);
const publishingSource = readFileSync(
  new URL("../../src-v2/features/publishing/PublishBatchesPage.tsx", import.meta.url),
  "utf8",
);

test("SRF-07 keeps the local cooldown ticking when retryAfter is zero", () => {
  assert.match(refreshSource, /export function refreshCooldownActive\(/);
  assert.match(
    refreshSource,
    /const cooling = refreshCooldownActive\(retryAfterSeconds, lastManualRefreshAt\)/,
  );
  assert.match(
    refreshSource,
    /refreshCooldownSeconds\(\{ retryAfterSeconds, lastManualRefreshAt, now \}\) > 0/,
  );
});

test("SRF-07 keeps the publishing route handoff idempotent", () => {
  const handoffNavigations = publishingSource.match(
    /navigate\(\`\$\{location\.pathname\}\$\{location\.search\}\`, \{ replace: true, state: null \}\);/g,
  ) || [];
  assert.equal(handoffNavigations.length, 1);
});
