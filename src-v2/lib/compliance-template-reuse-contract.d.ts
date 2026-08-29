export interface ComplianceReusePlanItem {
  id: string;
  skc: string;
  categoryId: string;
  categoryMatch: true;
  rulesFresh: boolean;
  coverageReady: boolean;
  state: "blocked" | "needs_skc_detail";
  blockers: string[];
  nextStep: string;
}

export interface ComplianceReusePlan {
  valid: boolean;
  blockers: string[];
  items: ComplianceReusePlanItem[];
  summary?: {
    requested: number;
    blocked: number;
    needsSkcDetail: number;
  };
}

export function classifyComplianceTemplateOptions<T extends {
  data?: {
    templateKind?: string;
    reportType?: string;
    defaults?: {
      photos?: unknown[];
      certificates?: Array<{
        certificateTypeId?: string | number | null;
        certificateTypeCode?: string;
        certificateTypeName?: string;
      }>;
    };
  };
}>(input: {
  templates?: T[];
  reportType?: "1630" | "1631" | null;
}): {
  complianceTemplates: T[];
  photoTemplates: T[];
  reportTemplates: T[];
};

export function buildComplianceReusePlan(input: {
  template: object | null;
  items: Array<{
    id: string;
    skc: string;
    categoryId: string | number;
    shelfStatus?: string | number | null;
    snapshot?: { fresh?: boolean } | null;
    summary?: {
      sourceCoverage?: {
        requirementsReturned?: boolean;
        photoRequirementsReturned?: boolean;
      } | null;
    };
  }>;
  selectedSkcs?: string[];
}): ComplianceReusePlan;
