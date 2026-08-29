import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function assertActiveJobPolling(source, queryName) {
  assert.match(source, new RegExp(`${queryName}[\\s\\S]{0,1400}refetchInterval:`));
  assert.match(source, /refetchIntervalInBackground:\s*false/);
  assert.match(source, /completed_with_errors/);
  assert.match(source, /cancelled/);
}

test("SRF-01 tracks compliance sync until terminal state, without page-wide polling", () => {
  const source = read("src-v2/features/compliance/CompliancePage.tsx");
  assertActiveJobPolling(source, "const complianceJob = useQuery");
  assert.match(source, /queryKey: \["store", queryScope, storeId, "compliance-sync-job", refreshJobId\]/);
});

test("SRF-01 tracks attribute schema sync and keeps schema cache user-scoped", () => {
  const source = read("src-v2/features/templates/AttributeTemplatesPage.tsx");
  assertActiveJobPolling(source, "const schemaSyncJob = useQuery");
  assert.match(source, /const queryScope = `\$\{session\.tenant\.id\}:\$\{session\.user\.id\}`/);
  assert.match(source, /"store",\s*queryScope,\s*storeId,\s*"publish-schema"/);
  assert.match(source, /completed_with_errors.*cancelled|cancelled.*completed_with_errors/);
});

test("SRF-01 tracks the selected sync-job detail only while it is active", () => {
  const source = read("src-v2/features/operations/SyncJobsPage.tsx");
  assertActiveJobPolling(source, "const detailQuery = useQuery");
  assert.match(source, /setSelectedJob\(\{ storeId, id: result\.job\.id \}\)/);
});
