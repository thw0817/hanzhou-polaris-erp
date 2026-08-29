import type {
  AttributeTemplate,
  CommercialTemplate,
  PackagingTemplate,
  PublishSettingsTemplate,
  ProductDraft,
  SaveProductDraftInput,
  TailImageTemplate,
  TitleRuleTemplate,
  SizeTemplate,
} from "./api";

export interface BulkDraftTemplatePlanItem {
  draftId: string;
  name: string;
  sourceUpdatedAt: string;
  state: "ready" | "blocked" | "skipped";
  blockers: string[];
  changes: string[];
  input: SaveProductDraftInput | null;
}

export interface BulkDraftTemplatePlan {
  items: BulkDraftTemplatePlanItem[];
  readyCount: number;
  blockedCount: number;
  skippedCount: number;
  replaceExistingTemplates: boolean;
  externalWrite: false;
}

export function planBulkDraftTemplateApplication(options: {
  drafts?: ProductDraft[];
  attributeTemplate?: AttributeTemplate | null;
  sizeTemplate?: SizeTemplate | null;
  titleRuleTemplate?: TitleRuleTemplate | null;
  titleRuleTemplates?: TitleRuleTemplate[];
  commercialTemplate?: CommercialTemplate | null;
  publishSettingsTemplate?: PublishSettingsTemplate | null;
  businessMode?: string;
  packagingTemplate?: PackagingTemplate | null;
  packagingMaterial?: string;
  tailImageTemplate?: TailImageTemplate | null;
  schemaByCategory?: Record<string, {
    checkedAt: string;
    attributes: Record<string, unknown>;
    publishStandard: Record<string, unknown>;
    customAttributePermissions?: Record<string, unknown>;
  }>;
  generateSupplierCodes?: boolean;
  supplierCodePrefix?: string;
  inventoryValue?: string | number;
  autoMapSkuImages?: boolean;
  reservedSupplierCodes?: string[];
  /** Explicit re-reference mode: replace the selected template-managed fields. */
  replaceExistingTemplates?: boolean;
}): BulkDraftTemplatePlan;
