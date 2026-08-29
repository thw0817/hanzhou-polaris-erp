import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const hookSource = readFileSync(
  fileURLToPath(new URL("../../src-v2/features/operations/use-business-dashboard.ts", import.meta.url)),
  "utf8",
);
const complianceSource = readFileSync(
  fileURLToPath(new URL("../../src-v2/features/compliance/CompliancePage.tsx", import.meta.url)),
  "utf8",
);
const jobsSource = readFileSync(
  fileURLToPath(new URL("../../src-v2/features/operations/SyncJobsPage.tsx", import.meta.url)),
  "utf8",
);

test("SRF-06 never reuses a business refresh job after the store scope changes", () => {
  assert.match(hookSource, /activeJob\?\.scopeKey\s*===\s*scopeKey/);
  assert.match(hookSource, /const scopeKey\s*=\s*`\$\{queryScope\}:\$\{storeId\}`/);
  assert.match(hookSource, /setActiveJob\(/);
});

test("SRF-06 clears selected compliance and sync-job details when the store changes", () => {
  assert.match(complianceSource, /refreshJobSelection\?\.storeId === storeId/);
  assert.match(complianceSource, /\}, \[storeId\]\);/);
  assert.match(jobsSource, /selectedJob\?\.storeId === storeId/);
  assert.match(jobsSource, /setSelectedJob\(null\)/);
  assert.match(jobsSource, /\}, \[storeId\]\);/);
});
