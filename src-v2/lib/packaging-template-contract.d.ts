import type { Sheet } from "read-excel-file/browser";

export interface PackagingTemplateRow {
  widthCm: number;
  lengthCm: number;
  packageLengthCm: number;
  packageWidthCm: number;
  packageHeightCm: number;
  key?: string;
  rowNumber?: number;
}

export interface PackagingWorkbook {
  fileName?: string;
  importedAt?: string;
  materials: Record<string, PackagingTemplateRow[]>;
  issues?: string[];
  materialCount?: number;
  sizeCount?: number;
  rowCount?: number;
  recordCount?: number;
  overwrittenCount?: number;
}

export function normalizePackagingWorkbook(
  sheets?: Sheet[],
): PackagingWorkbook & {
  issues: string[];
  materialCount: number;
  sizeCount: number;
  rowCount: number;
  overwrittenCount: number;
};

export function packagingTemplatePaths(
  storeId: string,
  templateId?: string,
): {
  templates: string;
  template: string;
};

export function validatePackagingTemplateDraft(input?: {
  name?: string;
  workbook?: PackagingWorkbook | null;
}): {
  valid: boolean;
  errors: {
    name?: string;
    workbook?: string;
  };
  data: {
    name: string;
    workbook: {
      fileName: string;
      importedAt: string;
      materials: Record<string, PackagingTemplateRow[]>;
      overwrittenCount: number;
    } | null;
  };
};
