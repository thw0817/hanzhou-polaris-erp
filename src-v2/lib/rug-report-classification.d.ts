import type {
  AttributeAssignmentValue,
  AttributeField,
} from "./attribute-template-contract.js";

export interface RugDimensionSource {
  attributeId: string;
  unit: "mm" | "cm" | "m" | "cm2" | "m2";
}

export interface RugThresholdSource {
  attributeId: string;
  exceededValueId: string;
  withinValueId: string;
}

export interface RugReportEvidence {
  attributeId: string;
  attributeName: string;
  rawValue: string;
  valueId: string;
  unit: string;
  normalizedUnit: "cm" | "m2" | "";
  normalizedValue: number | "是" | "否";
}

export interface RugReportBlocker {
  code: string;
  message: string;
  attributeId: string;
}

export interface RugReportClassification {
  reportType: "1630" | "1631" | null;
  longestEdgeCm: number | null;
  areaM2: number | null;
  evidence: RugReportEvidence[];
  blockers: RugReportBlocker[];
}

export function deriveRugReportThresholdSources(
  fields: AttributeField[],
): {
  longestEdge: RugThresholdSource;
  area: RugThresholdSource;
} | null;

export function classifyRugReportFromProductAttributes(input: {
  fields: AttributeField[];
  assignments: Record<string, AttributeAssignmentValue>;
  sources: {
    dimensions?: RugDimensionSource[];
    longestEdge?: RugDimensionSource[];
    area?: RugDimensionSource[];
    thresholds?: {
      longestEdge: RugThresholdSource;
      area: RugThresholdSource;
    };
  };
}): RugReportClassification;
