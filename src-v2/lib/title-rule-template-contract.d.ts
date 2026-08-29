export interface TitleRuleData {
  fullTitle: string;
  prefix: string;
  keywords: string;
  suffix: string;
}

export function titleRuleTemplatePaths(
  storeId: string,
  templateId?: string,
): { templates: string; template: string };

export function normalizeTitleRule(input?: Partial<TitleRuleData>): TitleRuleData;

export function applyTitleRule(
  currentTitle?: string,
  input?: Partial<TitleRuleData>,
): string;

export function stripTitleRuleFragments(
  currentTitle?: string,
  input?: Partial<TitleRuleData>,
): string;

export function validateTitleRuleTemplateDraft(input?: Partial<TitleRuleData> & {
  name?: string;
}): {
  valid: boolean;
  errors: { name?: string; rule?: string };
  data: { name: string; template: TitleRuleData };
};
