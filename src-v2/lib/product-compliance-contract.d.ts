import type {
  ComplianceCertificateAssignment,
  CompliancePhotoAssignment,
  ComplianceTemplate,
} from "./api";

export function buildProductComplianceStage(input?: {
  template?: ComplianceTemplate | null;
  reportTemplate?: ComplianceTemplate | null;
  categoryId?: string;
  report?: { reportType?: "1630" | "1631" | null } | null;
  photoSourceMode?: "template" | "manual";
  manualPhotos?: CompliancePhotoAssignment[];
  now?: Date | string | number;
}): {
  valid: boolean;
  blockers: Array<{ code: string; message: string }>;
  advisories: Array<{ code: string; message: string }>;
  postPublishTasks: Array<{ code: string; message: string }>;
  expectedReport: "1630" | "1631" | null;
  reportMaterial: ComplianceCertificateAssignment | null;
  reportDate: string | null;
  photos: {
    body: CompliancePhotoAssignment | null;
    bodyList: CompliancePhotoAssignment[];
    package: CompliancePhotoAssignment | null;
    packageList: CompliancePhotoAssignment[];
  };
  manualQueue: Array<"gcc" | "product_identifier">;
  assetIds: string[];
  requiresSkcRevalidation: true;
};
