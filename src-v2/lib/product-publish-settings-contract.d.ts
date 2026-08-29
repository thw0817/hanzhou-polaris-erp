export interface ProductPublishSettings {
  mallState: "" | "1" | "2";
  stopPurchase: "" | "1" | "2";
  shelfRequire: "" | "0" | "1";
  shelfWay: "" | "1" | "2";
  hopeOnSaleDate: string;
}

export interface ProductPublishSettingsStage {
  valid: boolean;
  blockers: Array<{ code: string; message: string; field: string }>;
  fields: Record<
    "mallState" | "stopPurchase" | "shelfRequire" | "shelfWay",
    { visible: boolean; required: boolean }
  >;
  payload: {
    root: { shelf_require?: string };
    skc: { shelf_way?: string; hope_on_sale_date?: string };
    sku: { mall_state?: number; stop_purchase?: number };
  };
}

export const DEFAULT_PRODUCT_PUBLISH_SETTINGS: ProductPublishSettings;

export function buildProductPublishSettingsStage(input?: {
  businessMode?: string;
  settings?: Partial<ProductPublishSettings>;
  fillInStandard?: Array<Record<string, unknown>>;
}): ProductPublishSettingsStage;
