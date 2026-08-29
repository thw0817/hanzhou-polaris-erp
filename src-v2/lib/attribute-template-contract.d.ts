export interface PublishCategoryOption {
  categoryId: string;
  productTypeId: string;
  name: string;
  path: string[];
}

export interface PublishCategoryNode {
  categoryId: string;
  productTypeId: string;
  name: string;
  lastCategory: boolean;
  children: PublishCategoryNode[];
}

export interface AttributeAssignmentValue {
  valueIds: string[];
  customValue: string;
}

export interface AttributeField {
  id: string;
  name: string;
  required: boolean;
  typeCode: number;
  dataDimension: number;
  modeCode: number;
  mode: string;
  maxSelections: number;
  remarks: string[];
  values: Array<{ id: string; label: string }>;
  ruleInfoList: Array<{
    id: string;
    conditionType: number;
    conditionOperator: number;
    value: string;
  }>;
}

export function attributeTemplatePaths(
  storeId: string,
  templateId?: string,
): {
  categories: string;
  schema: string;
  schemaCoverage: string;
  schemaSync: string;
  associatedRules: string;
  templates: string;
  template: string;
};

export function flattenLeafCategories(
  info?: Record<string, unknown>,
): PublishCategoryOption[];

export function normalizeCategoryTree(
  info?: Record<string, unknown>,
): PublishCategoryNode[];

export function buildAttributeFields(
  info: Record<string, unknown>,
  productTypeId: string,
): AttributeField[];

export function isCompositionPercentageField(
  field: Pick<AttributeField, "name" | "dataDimension" | "modeCode">,
): boolean;

export function validateAttributeAssignments(
  fields: Array<Pick<AttributeField, "id" | "name" | "required" | "dataDimension" | "modeCode">>,
  assignments: Record<string, AttributeAssignmentValue>,
): {
  missingFieldIds: string[];
  missingFieldNames: string[];
  invalidFieldIds: string[];
  invalidFieldNames: string[];
  missingReasons: Record<string, string>;
};
