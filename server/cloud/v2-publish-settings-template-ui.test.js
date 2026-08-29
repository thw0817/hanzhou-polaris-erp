import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../../src-v2/app/App.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../../src-v2/app/AppShell.tsx", import.meta.url), "utf8");
const editorSource = readFileSync(new URL("../../src-v2/features/publishing/NewProductPage.tsx", import.meta.url), "utf8");
const draftsSource = readFileSync(new URL("../../src-v2/features/publishing/ProductDraftsPage.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../../src-v2/lib/product-publish-settings-contract.js", import.meta.url), "utf8");

test("V2 removes the standalone publish settings UI and template reuse", () => {
  assert.doesNotMatch(appSource, /PublishSettingsTemplatesPage/);
  assert.doesNotMatch(appSource, /templates\/:storeId\/publish-settings/);
  assert.doesNotMatch(shellSource, /发布设置/);
  assert.doesNotMatch(shellSource, /\/publish-settings/);
  assert.doesNotMatch(editorSource, /publishSettingsTemplate/);
  assert.doesNotMatch(draftsSource, /publishSettingsTemplates/);
});

test("publish settings use the four fixed SHEIN defaults in every payload", () => {
  assert.match(settingsSource, /mallState: "1"/);
  assert.match(settingsSource, /stopPurchase: "1"/);
  assert.match(settingsSource, /shelfRequire: "0"/);
  assert.match(settingsSource, /shelfWay: "1"/);
  assert.match(settingsSource, /visible: false, required: false/);
  assert.match(settingsSource, /mall_state: Number\(DEFAULT_PRODUCT_PUBLISH_SETTINGS\.mallState\)/);
  assert.match(settingsSource, /stop_purchase: Number\(DEFAULT_PRODUCT_PUBLISH_SETTINGS\.stopPurchase\)/);
  assert.match(settingsSource, /shelf_require: DEFAULT_PRODUCT_PUBLISH_SETTINGS\.shelfRequire/);
  assert.match(settingsSource, /shelf_way: DEFAULT_PRODUCT_PUBLISH_SETTINGS\.shelfWay/);
});
