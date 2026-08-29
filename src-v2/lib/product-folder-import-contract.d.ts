export type ProductFolderImageSlot =
  | "unassigned"
  | "main"
  | "detail"
  | "description"
  | "sku";

export interface ProductFolderFileLike {
  name: string;
  type?: string;
  size?: number;
  webkitRelativePath?: string;
}

export interface ProductFolderImportEntry<T extends ProductFolderFileLike = ProductFolderFileLike> {
  id: string;
  file: T;
  path: string;
  suggestedSlot: ProductFolderImageSlot;
}

export interface ProductFolderImportGroup<T extends ProductFolderFileLike = ProductFolderFileLike> {
  id: string;
  name: string;
  files: Array<ProductFolderImportEntry<T>>;
}

export function isSupportedProductImage(file: ProductFolderFileLike): boolean;
export function suggestProductImageSlot(file: ProductFolderFileLike): ProductFolderImageSlot;
export function productFolderName(file: ProductFolderFileLike): string;
export function buildProductFolderImportGroups<T extends ProductFolderFileLike>(files: T[]): {
  groups: Array<ProductFolderImportGroup<T>>;
  ignoredCount: number;
};
export function validateProductFolderMappings(
  entries: Array<{ slot: ProductFolderImageSlot }>,
  options?: { existingDetailCount?: number; existingDescriptionCount?: number },
): {
  selectedCount: number;
  blockers: string[];
  counts: Record<ProductFolderImageSlot, number>;
};

export function buildProductFolderDraftShell(input: {
  name: string;
  uploadedImages: Array<{
    slot: ProductFolderImageSlot;
    asset: {
      id?: string;
      assetId?: string;
      originalName?: string;
      contentType?: string;
      width?: number | null;
      height?: number | null;
      sizeBytes?: number;
    };
  }>;
}): {
  input: {
    name: string;
    categoryId: "";
    productTypeId: "";
    data: {
      title: string;
      description: "";
      imageAssets: {
        main: Array<Record<string, unknown>>;
        detail: Array<Record<string, unknown>>;
        description: Array<Record<string, unknown>>;
        tail: [];
      };
      skuPreviewImages: Array<Record<string, unknown>>;
      skuRows: [];
    };
    preflight: Record<string, never>;
    status: "blocked";
  };
  externalWrite: false;
};
