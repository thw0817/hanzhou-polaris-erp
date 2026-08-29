import type {
  ComplianceDraftInputs,
  ComplianceEditorModel,
  ComplianceRequirementRecord,
} from "./api";

export type ComplianceRequiredState = 0 | 1 | 10;

export interface ComplianceTemplateRequirement {
  key: string;
  type: string;
  name: string;
  certificateTypeId: string | number | null;
  certificateTypeCode: string;
  complianceGroupCode: string;
  labelId: string | null;
  labelGroup: string;
  isManualProductWarning: boolean;
  isAutoProductWarning: boolean;
  isRequired: ComplianceRequiredState;
  reviewState: number | null;
  siteList: string[];
  reusable: boolean;
}

export function complianceTemplatePaths(
  storeId: string,
  templateId?: string,
): {
  templates: string;
  template: string;
};

export function buildComplianceTemplateCatalog(
  records?: ComplianceRequirementRecord[],
): ComplianceTemplateRequirement[];

export function validateComplianceTemplateDraft(input?: {
  name?: string;
  catalog?: ComplianceTemplateRequirement[];
  defaults?: Partial<ComplianceDraftInputs>;
  reportRules?: ComplianceEditorModel["certificates"];
}): {
  valid: boolean;
  errors: {
    name?: string;
    requirements: string[];
  };
  data: {
    name: string;
    catalog: ComplianceTemplateRequirement[];
    defaults: ComplianceDraftInputs;
  };
};
