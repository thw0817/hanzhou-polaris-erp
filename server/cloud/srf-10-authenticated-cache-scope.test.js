import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("SRF-10 scopes the authenticated store query by tenant and user", () => {
  const appShell = read("src-v2/app/AppShell.tsx");
  const storesPage = read("src-v2/features/settings/StoresPage.tsx");
  assert.match(appShell, /const sessionScope = sessionQuery\.data\s*\?\s*`\$\{sessionQuery\.data\.tenant\.id\}:\$\{sessionQuery\.data\.user\.id\}`\s*:\s*"anonymous"/);
  assert.match(appShell, /const storesQueryKey = \["stores", sessionScope\] as const/);
  assert.match(appShell, /queryKey: storesQueryKey/);
  assert.match(storesPage, /const storesQueryKey = \["stores", `\$\{session\.tenant\.id\}:\$\{session\.user\.id\}`\] as const/);
  assert.match(storesPage, /invalidateQueries\(\{ queryKey: storesQueryKey \}\)/);
});

test("SRF-10 scopes member and AI settings caches instead of using global keys", () => {
  const source = read("src-v2/features/settings/MembersPage.tsx");
  assert.match(source, /const queryScope = `\$\{session\.tenant\.id\}:\$\{session\.user\.id\}`/);
  assert.match(source, /const membersQueryKey = \["tenant", queryScope, "members"\] as const/);
  assert.match(source, /const aiTitleSettingsQueryKey = \["tenant", session\.tenant\.id, "ai-title-settings"\] as const/);
  assert.doesNotMatch(source, /queryKey: \["members"\]/);
  assert.doesNotMatch(source, /queryKey: \["ai-title-settings"\]/);
  assert.match(source, /setQueryData<[^>]+>\(\s*membersQueryKey/);
  assert.match(source, /setQueryData\(aiTitleSettingsQueryKey/);
});
