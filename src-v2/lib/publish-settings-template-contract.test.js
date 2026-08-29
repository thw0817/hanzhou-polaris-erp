import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPublishSettingsTemplate,
  publishSettingsTemplatePaths,
  validatePublishSettingsTemplateDraft,
} from "./publish-settings-template-contract.js";

test("publish settings templates use the generic scoped template endpoint", () => {
  assert.deepEqual(publishSettingsTemplatePaths("store / 1", "template / 1"), {
    templates: "/v1/web/stores/store%20%2F%201/publish-templates?type=publish_settings",
    template: "/v1/web/stores/store%20%2F%201/publish-templates/template%20%2F%201",
  });
});

test("publish settings templates keep reusable full-managed choices only", () => {
  const result = validatePublishSettingsTemplateDraft({
    name: "全托管自动上架",
    mallState: "1",
    stopPurchase: "1",
    shelfRequire: "0",
    shelfWay: "1",
    hopeOnSaleDate: "2026-09-01T10:00",
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.data.template, {
    mallState: "1",
    stopPurchase: "1",
    shelfRequire: "0",
    shelfWay: "1",
  });
  assert.equal("hopeOnSaleDate" in result.data.template, false);
});

test("scheduled publication is never stored as a reusable template", () => {
  const result = validatePublishSettingsTemplateDraft({
    name: "过期定时设置",
    mallState: "1",
    stopPurchase: "1",
    shelfRequire: "0",
    shelfWay: "2",
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.shelfWay, /只支持自动上架/);
});

test("template reuse is revalidated against current SHEIN rules", () => {
  const hiddenMallState = applyPublishSettingsTemplate({
    template: {
      mallState: "1",
      stopPurchase: "1",
      shelfRequire: "0",
      shelfWay: "1",
    },
    businessMode: "全托管",
    fillInStandard: [{ field_key: "mall_state", show: 0, required: 0 }],
  });
  assert.equal(hiddenMallState.valid, true);
  assert.equal(hiddenMallState.settings.hopeOnSaleDate, "");

  const unsupportedMode = applyPublishSettingsTemplate({
    template: hiddenMallState.settings,
    businessMode: "半托管",
    fillInStandard: [],
  });
  assert.equal(unsupportedMode.valid, false);
  assert.equal(unsupportedMode.blockers[0].code, "BUSINESS_MODE_UNSUPPORTED");
});
