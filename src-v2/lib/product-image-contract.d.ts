export interface ProductImageAssetInput {
  id?: string;
  assetId?: string;
  originalName?: string;
  name?: string;
  width?: number | null;
  height?: number | null;
}

export interface PictureConfigItem {
  field_key?: string;
  is_true?: boolean;
}

export function orderedTailTemplateImages(template: {
  data?: {
    assetIds?: string[];
    assets?: ProductImageAssetInput[];
  };
} | null): ProductImageAssetInput[];

export function buildProductImageStage(input?: {
  mainImages?: ProductImageAssetInput[];
  detailImages?: ProductImageAssetInput[];
  squareImages?: ProductImageAssetInput[];
  swatchImages?: ProductImageAssetInput[];
  descriptionImages?: ProductImageAssetInput[];
  tailTemplate?: {
    id?: string;
    name?: string;
    data?: {
      placement?: "append";
      assetIds?: string[];
      assets?: ProductImageAssetInput[];
    };
  } | null;
  pictureConfig?: PictureConfigItem[];
  fillInStandard?: Array<{
    field_key?: string;
    show?: boolean;
    required?: boolean;
  }>;
}): {
  valid: boolean;
  scheme: "new-spu" | "legacy-skc";
  isSpuPic: boolean;
  rules: {
    detailAllowed: boolean;
    detailRequired: boolean;
    siteDetailRuleReturned: boolean;
    siteDetailAllowed: boolean;
    siteDetailRequired: boolean;
    siteDetailFieldKey: string;
  };
  uploads: Array<{
    localId: string;
    name: string;
    source: "product" | "tail-template";
    templateId: string;
    targetLevel: "spu" | "skc" | "sku" | "site-detail";
    imageType: number;
    imageSort: number;
    slot: string;
    status: "local";
  }>;
  blockers: Array<{ code: string; message: string }>;
  counts: {
    main: number;
    productDetail: number;
    square: number;
    swatch: number;
    tail: number;
    detailTotal: number;
    siteDetail: number;
  };
};
