import type { ProductPublishSettings } from "./product-publish-settings-contract.js";

export interface PublishSettingsTemplateData {
  mallState: "1" | "2";
  stopPurchase: "1" | "2";
  shelfRequire: "0" | "1";
  shelfWay: "1";
}

export function publishSettingsTemplatePaths(
  storeId: string,
  templateId?: string,
): { templates: string; template: string };

export function validatePublishSettingsTemplateDraft(input?: {
  name?: string;
  mallState?: string;
  stopPurchase?: string;
  shelfRequire?: string;
  shelfWay?: string;
  [key: string]: unknown;
}): {
  valid: boolean;
  errors: Partial<Record<"name" | "mallState" | "stopPurchase" | "shelfRequire" | "shelfWay", string>>;
  data: { name: string; template: PublishSettingsTemplateData };
};

export function applyPublishSettingsTemplate(input?: {
  template?: Partial<PublishSettingsTemplateData>;
  businessMode?: string;
  fillInStandard?: Array<Record<string, unknown>>;
}): {
  valid: boolean;
  blockers: Array<{ code: string; message: string; field: string }>;
  settings: ProductPublishSettings;
};
