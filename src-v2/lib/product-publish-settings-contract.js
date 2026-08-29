function text(value) {
  return String(value ?? "").trim();
}

function fullManagedMode(value) {
  const mode = text(value).toLowerCase();
  return mode === "full" || mode.includes("全托管");
}

export const DEFAULT_PRODUCT_PUBLISH_SETTINGS = Object.freeze({
  mallState: "1",
  stopPurchase: "1",
  shelfRequire: "0",
  shelfWay: "1",
  hopeOnSaleDate: "",
});

export function buildProductPublishSettingsStage({
  businessMode = "全托管",
  settings = {},
  fillInStandard = [],
} = {}) {
  const blockers = [];
  if (!fullManagedMode(businessMode)) {
    blockers.push({
      code: "BUSINESS_MODE_UNSUPPORTED",
      message: "当前阶段只支持SHEIN全托管商品发布设置",
      field: "businessMode",
    });
  }
  // These four values are fixed product defaults. Keep the arguments for
  // historical draft/preflight compatibility, but never let them override the
  // payload or create a user-facing blocker.
  void settings;
  void fillInStandard;
  const fields = {
    mallState: { visible: false, required: false },
    stopPurchase: { visible: false, required: false },
    shelfRequire: { visible: false, required: false },
    shelfWay: { visible: false, required: false },
  };

  return {
    valid: blockers.length === 0,
    blockers,
    fields,
    payload: {
      root: { shelf_require: DEFAULT_PRODUCT_PUBLISH_SETTINGS.shelfRequire },
      skc: { shelf_way: DEFAULT_PRODUCT_PUBLISH_SETTINGS.shelfWay },
      sku: {
        mall_state: Number(DEFAULT_PRODUCT_PUBLISH_SETTINGS.mallState),
        stop_purchase: Number(DEFAULT_PRODUCT_PUBLISH_SETTINGS.stopPurchase),
      },
    },
  };
}
