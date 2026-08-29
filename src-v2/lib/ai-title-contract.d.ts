export declare const AI_TITLE_FEATURE: "ai_title";
export declare const AI_PATTERN_MAX_LENGTH: number;
export declare const AI_TITLE_DEFAULT_MAX_LENGTH: number;
export declare const AI_TITLE_MAX_LENGTH: number;

export type AiTitleRule = {
  prefix?: string;
  keywords?: string;
  suffix?: string;
};

export type AiTitleRequestInput = {
  mainImageAssetId: string;
  titleRuleTemplateId: string;
  titleRule: AiTitleRule;
  currentTitle: string;
  titleMaxLength: number;
  locale: string;
};

export declare function aiTitlePaths(storeId: string): {
  capability: string;
  suggest: string;
};
export declare function normalizeAiPatternName(value: unknown): string;
export declare function validateAiTitleProviderSettings(input: {
  apiUrl?: unknown;
  model?: unknown;
  modelUrl?: unknown;
  apiKey?: unknown;
  requireApiKey?: boolean;
}):
  | {
      valid: true;
      settings: {
        apiUrl: string;
        model: string;
        modelUrl: string;
        apiKey: string;
      };
    }
  | { valid: false; code: string; error: string };
export declare function composeAiTitle(input: {
  rule?: AiTitleRule;
  patternName?: string;
  maxLength?: number;
}): {
  title: string;
  patternName: string;
  truncated: boolean;
  valid: boolean;
};
export declare function buildAiTitleRequest(input: {
  mainImageAssetId?: unknown;
  titleRuleTemplateId?: string;
  titleRule?: AiTitleRule;
  currentTitle?: string;
  titleMaxLength?: number;
  locale?: string;
}):
  | { valid: true; input: AiTitleRequestInput }
  | { valid: false; code: string; error: string };
