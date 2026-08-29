export interface CommercialTemplateData {
  pricePerSquareMeter: number;
  gramsPerSquareMeter: number;
}

export function commercialTemplatePaths(
  storeId: string,
  templateId?: string,
): { templates: string; template: string };

export function validateCommercialTemplateDraft(input?: {
  name?: string;
  pricePerSquareMeter?: string | number;
  gramsPerSquareMeter?: string | number;
  [key: string]: unknown;
}): {
  valid: boolean;
  errors: {
    name?: string;
    pricePerSquareMeter?: string;
    gramsPerSquareMeter?: string;
  };
  data: { name: string; template: CommercialTemplateData };
};

export function applyCommercialTemplate<T extends object>(
  rows: T[],
  template: Partial<CommercialTemplateData>,
): Array<T & {
  costPrice?: string;
  weightGrams?: number;
  weightSource?: "area_estimate";
}>;
