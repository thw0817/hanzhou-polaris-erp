export interface SizeTemplateDraftRow {
  id?: string;
  sizeText?: string;
  lengthCm?: string | number;
  widthCm?: string | number;
}

export interface SizeTemplateRowErrors {
  sizeText?: string;
  lengthCm?: string;
  widthCm?: string;
}

export function sizeTemplatePaths(
  storeId: string,
  templateId?: string,
): {
  templates: string;
  template: string;
};

export function validateSizeTemplateDraft(input?: {
  name?: string;
  colorText?: string;
  rows?: SizeTemplateDraftRow[];
}): {
  valid: boolean;
  errors: {
    name?: string;
    colorText?: string;
    rowsMessage?: string;
    rows: SizeTemplateRowErrors[];
  };
  data: {
    name: string;
    colorText: string;
    rows: Array<{
      sizeText: string;
      lengthCm: number | null;
      widthCm: number | null;
    }>;
  };
};
