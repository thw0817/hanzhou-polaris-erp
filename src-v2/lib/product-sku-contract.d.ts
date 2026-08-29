export interface SaleValueMapping {
  attributeId: string;
  attributeName: string;
  valueId: string;
  valueLabel: string;
  customValue?: string;
}

export interface SaleAttributeField {
  id: string;
  name: string;
  required: boolean;
  labelCode: number;
  attributeType: 1 | 2;
  modeCode: number;
  customValueAllowed: boolean;
  values: Array<{ id: string; label: string }>;
}

export interface SaleAttributeSchema {
  mainAttributeStatus: number;
  fields: SaleAttributeField[];
  sizeFields: SaleAttributeField[];
}

export interface ProductSkuRow {
  id: string;
  sizeText: string;
  lengthCm: number;
  widthCm: number;
  sizeMapping: SaleValueMapping | null;
  sizeAttributeValues?: Record<string, string>;
  areaSquareMeters?: number | null;
  packageLengthCm?: number | "";
  packageWidthCm?: number | "";
  packageHeightCm?: number | "";
  packageMatch?: "pending" | "matched" | "manual" | "missing";
  supplierSku?: string;
  costPrice?: string;
  inventoryNum?: string | number;
  weightGrams?: string | number;
  weightSource?: "area_estimate" | "manual";
  imageAssetId?: string;
  imageAssetSource?:
    | "shared_sku"
    | "shared_main"
    | "per_sku_ocr"
    | "per_sku_filename"
    | "per_sku_main"
    | "per_sku_manual"
    | "batch_main"
    | "batch_carousel"
    | "batch_manual"
    | "";
}

export function buildSaleAttributeSchema(
  info: Record<string, unknown>,
  productTypeId: string,
  customAttributePermissions?: Record<string, unknown>,
): SaleAttributeSchema;

export function resolveMainSaleAttributeValue(
  saleSchema: SaleAttributeSchema,
  value: string,
): SaleValueMapping | null;

export function reconcileSkuSizeMappings(
  rows: ProductSkuRow[],
  saleSchema: SaleAttributeSchema,
  colorMapping: SaleValueMapping | null,
): ProductSkuRow[];

export function formatHomeTextileCustomSize(
  sizeText: string,
  lengthCm: number,
  widthCm: number,
): string;

export function buildSkuStageFromSizeTemplate(
  template: {
    id: string;
    data?: {
      colorText?: string;
      rows?: Array<{
        sizeText: string;
        lengthCm: number;
        widthCm: number;
      }>;
    };
  },
  saleSchema: SaleAttributeSchema,
): {
  colorMapping: SaleValueMapping | null;
  rows: ProductSkuRow[];
};

export function applyPackagingTemplate(
  rows: ProductSkuRow[],
  template: {
    data?: {
      materials?: Record<string, Array<{
        widthCm: number;
        lengthCm: number;
        packageLengthCm: number;
        packageWidthCm: number;
        packageHeightCm: number;
        key?: string;
        rowNumber?: number;
      }>>;
    };
  } | null,
  material: string,
  options?: { overwrite?: boolean },
): ProductSkuRow[];

export function applyPricePerSquareMeter(
  rows: ProductSkuRow[],
  pricePerSquareMeter: string | number,
): ProductSkuRow[];

export function applyGramsPerSquareMeter(
  rows: ProductSkuRow[],
  gramsPerSquareMeter: string | number,
): ProductSkuRow[];

export function applyInventoryToAll(
  rows: ProductSkuRow[],
  inventory: string | number,
): ProductSkuRow[];

export function applySupplierSkuPrefix(
  rows: ProductSkuRow[],
  supplierCode: string,
): ProductSkuRow[];

export function ensureSupplierSkuRows(
  rows: ProductSkuRow[],
  supplierCode: string,
): ProductSkuRow[];

export function applySharedSkuImage(
  rows: ProductSkuRow[],
  assetId: string,
  source?: "shared_sku" | "shared_main",
): ProductSkuRow[];

export function assignSkuPreviewImage(
  rows: ProductSkuRow[],
  rowId: string,
  assetId: string,
  source?: "per_sku_manual" | "per_sku_main",
): ProductSkuRow[];

export function autoMapSkuPreviewImages(
  rows: ProductSkuRow[],
  images: Array<{
    id?: string;
    assetId?: string;
    originalName?: string;
    name?: string;
    recognizedText?: string;
  }>,
): {
  rows: ProductSkuRow[];
  unmatchedAssetIds: string[];
  ambiguousAssetIds: string[];
};

export function buildSkuPublishPreview(input: {
  supplierCode: string;
  colorMapping: SaleValueMapping | null;
  rows: ProductSkuRow[];
  sizeAttributeFields?: SaleAttributeField[];
  currency: string;
  skuSettings?: {
    mall_state?: number;
    stop_purchase?: number;
  };
  weightConfig?: unknown;
  dimensionConfig?: unknown;
}): {
  skc: {
    supplier_code: string;
    sale_attribute: {
      attribute_id: string | number;
      attribute_value_id: string | number;
    } | null;
    sku_list: Array<Record<string, unknown>>;
  };
  size_attribute_list: Array<Record<string, unknown>>;
  pendingImageUploads: Array<{
    rowId: string;
    assetId: string;
    supplierSku: string;
    targetLevel: "sku";
    imageType: 1;
    imageSort: 1;
  }>;
  blockers: string[];
};

export function validateSkuStage(input: {
  saleSchema: SaleAttributeSchema;
  supplierCode: string;
  sizeTemplateId: string;
  colorMapping: SaleValueMapping | null;
  rows: ProductSkuRow[];
  packagingTemplateId: string;
  packagingMaterial: string;
  currency?: string;
  weightRequired?: boolean;
}): {
  valid: boolean;
  blockers: Array<{
    code: string;
    message: string;
    rowId?: string;
  }>;
};
