export interface BatchSkuRow {
  id: string;
  sizeText: string;
  widthCm: number;
  lengthCm: number;
  sizeMapping: import("./product-sku-contract.js").SaleValueMapping | null;
  sizeAttributeValues?: Record<string, string>;
  imageAssetId: string;
  imageAssetSource: import("./product-sku-contract.js").ProductSkuRow["imageAssetSource"];
  costPrice: string;
  weightGrams: number | null;
  inventoryNum: number;
  [key: string]: unknown;
}

export function buildDefaultBatchSupplierCode(index: number, now?: Date): string;
export function buildBatchDraftName(title: unknown, fallback?: unknown): string;
export function buildBatchSkuRows(template: { data?: { rows?: Array<{ sizeText?: string; lengthCm?: number; widthCm?: number }> } } | null, groupId: string): BatchSkuRow[];
export function buildBatchSkuStage(template: { id: string; data?: Record<string, unknown> } | null, groupId: string, saleSchema: import("./product-sku-contract.js").SaleAttributeSchema): { colorMapping: import("./product-sku-contract.js").SaleValueMapping | null; rows: BatchSkuRow[] };
export function applyBatchSkuSettings(rows: BatchSkuRow[], options?: Record<string, unknown>): BatchSkuRow[];
export function mapBatchSkuPreviews(rows: BatchSkuRow[], images: Array<{ id?: string; assetId?: string }>, mode?: "none" | "carousel" | "main"): BatchSkuRow[];
export function reorderBatchImages<T extends { id?: string }>(images: T[], activeId: string, overId: string): T[];
export function applyBatchAttributeTemplate(template: { data?: { assignments?: Array<{ attributeId?: string; valueIds?: Array<string | number>; customValue?: string }> } } | null): Record<string, { valueIds: string[]; customValue: string }>;
export function summarizeBatchProduct(row: { title?: string; titleMaxLength?: number | null; attributeTemplateId?: string; sizeTemplateId?: string; skuRows?: BatchSkuRow[] }): { skuCount: number; withPrice: number; withWeight: number; withPreview: number; blockers: string[]; readyForDetail: boolean };
