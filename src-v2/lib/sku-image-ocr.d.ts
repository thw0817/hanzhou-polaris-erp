import type { ProductSkuRow } from "./product-sku-contract.js";

export function skuImageOcrSearchText(value: unknown): string;
export function extractSkuImageDimensionTokens(value: unknown): Set<string>;
export function autoMapSkuPreviewImagesByOcr(
  rows: ProductSkuRow[],
  images: Array<Record<string, any>>,
): { rows: ProductSkuRow[]; unmatchedAssetIds: string[]; ambiguousAssetIds: string[] };
export function recognizeSkuImageText(file: File | Blob): Promise<string>;
