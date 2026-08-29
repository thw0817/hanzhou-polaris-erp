export interface FillInStandardItem {
  field_key?: string;
  show?: boolean;
  required?: boolean;
}

export function resolveProductDetailPictureRule(
  fillInStandard?: FillInStandardItem[],
): {
  returned: boolean;
  show: boolean;
  required: boolean;
  fieldKey: string;
};

export function buildProductContentStage(input?: {
  title?: string;
  description?: string;
  defaultLanguage?: string;
  titleMaxLength?: number | string | null;
}): {
  valid: boolean;
  blockers: Array<{ code: string; message: string }>;
  defaultLanguage: string;
  titleMaxLength: number;
  multiLanguageNameList: Array<{ language: string; name: string }>;
  multiLanguageDescList: Array<{ language: string; name: string }>;
};
