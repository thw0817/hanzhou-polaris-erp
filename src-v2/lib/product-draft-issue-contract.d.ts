export type ProductDraftIssueSection = "basic" | "images" | "sku" | "publish" | "compliance";

export interface ProductDraftIssue {
  source: string;
  code: string;
  message: string;
  section: ProductDraftIssueSection;
  anchor: string;
}

export interface ProductDraftIssueGroup {
  key: ProductDraftIssueSection;
  label: string;
  anchor: string;
  count: number;
  issues: ProductDraftIssue[];
}

export interface ProductDraftIssueSummary {
  total: number;
  issues: ProductDraftIssue[];
  groups: ProductDraftIssueGroup[];
  firstIssue: ProductDraftIssue | null;
}

interface ProductDraftLike {
  status?: string;
  updatedAt?: string;
  preflight?: Record<string, unknown>;
}

export function productDraftSectionAnchor(section: string): string;
export function collectProductDraftIssues(draft: ProductDraftLike): ProductDraftIssueSummary;
export function sortProductDraftsByActionPriority<T extends ProductDraftLike>(drafts: T[]): T[];
