import { attributeTemplatePaths } from "./attribute-template-contract.js";
import { commercialTemplatePaths } from "./commercial-template-contract.js";
import {
  complianceTemplatePaths,
  type ComplianceTemplateRequirement,
} from "./compliance-template-contract.js";
import { packagingTemplatePaths } from "./packaging-template-contract.js";
import { publishSettingsTemplatePaths } from "./publish-settings-template-contract.js";
import { sizeTemplatePaths } from "./size-template-contract.js";
import { tailImageTemplatePaths } from "./tail-image-template-contract.js";
import { titleRuleTemplatePaths } from "./title-rule-template-contract.js";
import { aiTitlePaths } from "./ai-title-contract.js";
import { recordDiagnosticEvent } from "./diagnostics.js";

export type UserRole = "owner" | "admin" | "operator" | "viewer";

export interface Session {
  authenticated: true;
  tenant: { id: string; name: string };
  user: {
    id: string;
    email: string;
    displayName: string;
    role: UserRole;
  };
  expiresAt: string;
}

export interface PublicRegistrationResult {
  registered: true;
  tenant: { id: string; name: string };
  user: {
    id: string;
    email: string;
    displayName: string;
    role: UserRole;
  };
}

export interface Store {
  id: string;
  supplierId: string | null;
  label: string;
  baseLabel?: string;
  adminAlias?: string | null;
  businessMode: string;
  status: "active" | "reauthorization_required" | "disabled";
  environment?: "production" | "demo";
  authorizedAt?: string | null;
  lastSyncedAt?: string | null;
}

export function isAuthorizedSheinStore(store: Store) {
  return Boolean(String(store.supplierId || "").trim());
}

export interface MemberStoreAccess {
  id: string;
  label: string;
  status: Store["status"];
}

export interface MemberSummary {
  id: string;
  email: string;
  displayName: string;
  adminAlias?: string | null;
  status: "active" | "disabled";
  role: UserRole;
  allStores: boolean;
  stores: MemberStoreAccess[];
  features?: { aiTitle: boolean };
  joinedAt: string | null;
}

export interface AiTitleCapability {
  feature: "ai_title";
  visible: boolean;
  configured: boolean;
  modelConfigured: boolean;
}

export interface AiTitleSuggestion {
  feature: "ai_title";
  patternName: string;
  confidence: number | null;
  warning: string;
  model: string;
  diagnostics?: {
    traceId?: string | null;
    phase?: string;
    source?: string;
    cacheHit?: boolean;
    imageDurationMs?: number | null;
    providerDurationMs?: number | null;
    queueWaitMs?: number | null;
    durationMs?: number;
  } | null;
}

export interface AiTitleSettings {
  feature: "ai_title";
  apiUrl: string;
  model: string;
  modelUrl: string;
  keyHint: string;
  configured: boolean;
  modelConfigured: boolean;
  updatedAt: string | null;
}

export type ManagedMemberRole = "operator" | "viewer";

export interface CreatedMemberInvitation {
  id: string;
  email: string;
  displayName: string;
  role: ManagedMemberRole;
  storeIds: string[];
  expiresAt: string;
}

export interface PublicMemberInvitation {
  id: string;
  email: string;
  displayName: string;
  role: ManagedMemberRole;
  storeCount: number;
  expiresAt: string;
  tenant: { id: string; name: string };
}

export interface ProductSku {
  skuCode?: string;
  supplierSku?: string;
  size?: string;
  sizeLabel?: string;
  actualInventory?: number;
  transitInventory?: number | null;
  outOfStockQty?: number;
  outOfStockUpdatedAt?: string | null;
  lockedInventory?: number;
  daysOfCover?: number | null;
  suggestedRestock?: number;
  replenishmentGap?: number;
  inventory?: number;
  sales?: ProductSales;
}

export interface ProductSales {
  today?: number;
  yesterday?: number;
  sales7?: number;
  sales30?: number;
}

export interface BusinessProduct {
  name?: string;
  title?: string;
  image?: string;
  imageUrl?: string;
  spu?: string;
  skc?: string;
  supplierCode?: string;
  state?: string;
  statusCode?: number | null;
  statusSource?: "shein_skc_label_list" | "unavailable" | string;
  listingDays?: number;
  actualInventory?: number;
  transitInventory?: number | null;
  daysOfCover?: number | null;
  replenishmentGap?: number;
  sales?: ProductSales;
  skus?: ProductSku[];
  sampleInfo?: {
    reserveSampleFlag?: number | string | null;
    spotFlag?: number | string | null;
    sampleJudgeType?: number | string | null;
    sampleCode?: string | null;
  } | null;
}

export interface BusinessWarning {
  id?: string;
  skc?: string;
  name?: string;
  title?: string;
  message?: string;
  tone?: "high" | "medium" | "low" | string;
  image?: string;
  inventory?: number;
}

export interface ProductQuotaSnapshot {
  availableLimit?: number | string | null;
  platformAvailableLimit?: number | string | null;
  localConsumedThisMonth?: number | null;
  quotaPeriod?: string | null;
  localQuotaUpdatedAt?: string | null;
  reason?: string | null;
  sendTimestamp?: string | null;
  receivedAt?: string | null;
}

export interface BusinessSnapshot {
  productCount?: number;
  productQuota?: ProductQuotaSnapshot | null;
  products?: BusinessProduct[];
  warnings?: BusinessWarning[];
  totals?: {
    today?: number;
    yesterday?: number;
    sales7?: number;
    sales30?: number;
    actualInventory?: number;
    transitInventory?: number | null;
    activeProductCount?: number;
    pendingProductCount?: number;
    offShelfProductCount?: number;
    soldOutProductCount?: number;
    highWarningCount?: number;
  };
}

export interface BusinessDashboard {
  state: "idle" | "refreshing" | "ready" | "failed";
  snapshot: BusinessSnapshot | null;
  stale: boolean;
  syncedAt: string | null;
  sourceCutoff: string;
  refreshStartedAt?: string | null;
  refreshCompletedAt?: string | null;
  lastError?: { code?: string; message?: string; occurredAt?: string } | null;
  webhookPending?: boolean;
  lastWebhookAt?: string | null;
  lastWebhookEventType?: string | null;
  lastWebhookEventId?: string | null;
  lastManualRefreshAt?: string | null;
  refreshControl?: {
    status: "started" | "active" | "cooldown";
    retryAfterSeconds?: number;
  } | null;
  refreshJob?: {
    id: string;
    jobType: "store_business_refresh";
    state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    requestedBy?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt?: string | null;
  } | null;
  storeId: string;
  refreshAfterSeconds?: number;
}

export interface TodayWorkStore {
  storeId: string;
  storeName: string;
  published: number;
  priceAccepted: number;
  rejected: number;
  sampled: number;
  categories: Array<{ name: string; published: number; rejected: number }>;
}

export interface TodayWorkActivity {
  storeId: string;
  storeName: string;
  type: string;
  title: string;
  occurredAt: string | null;
}

export interface TodayWorkSnapshot {
  date: string;
  timezone: string;
  refreshedAt: string;
  scope: "all" | "assigned" | "store";
  stores: TodayWorkStore[];
  totals: {
    published: number;
    priceAccepted: number;
    rejected: number;
    sampled: number;
  };
  activity: TodayWorkActivity[];
}

export type SyncJobState =
  | "queued"
  | "running"
  | "succeeded"
  // Legacy compliance endpoint terminal states. The cloud worker normalizes
  // these to succeeded/failed, but the direct SHEIN bridge can expose them.
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "cancelled";

export type SyncJobType =
  | "store_business_refresh"
  | "product_incremental_sync"
  | "sales_daily_sync"
  | "inventory_sync"
  | "compliance_sync"
  | "rule_refresh"
  | "webhook_reconcile";

export interface SyncJobFailedTarget {
  categoryId: string;
  productTypeId: string;
}

export interface SyncJobSummary {
  id: string;
  jobType: SyncJobType;
  state: SyncJobState;
  progress: Partial<Record<
    "total" | "processed" | "succeeded" | "failed" | "skipped",
    number
  >> & {
    snapshotStored?: boolean;
    scope?: "referenced" | "all";
    failedTargets?: SyncJobFailedTarget[];
  };
  error: { code: string; message: string } | null;
  requestedBy: { name: string; me: boolean } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SyncJobDetail extends SyncJobSummary {
  items: Array<{
    id: string;
    itemKey: string;
    state: SyncJobState | "skipped";
    attemptCount: number;
    traceId: string | null;
    error: { code: string; message: string } | null;
    startedAt: string | null;
    completedAt: string | null;
  }>;
}

export type ComplianceStatus =
  | "未同步"
  | "需修正"
  | "待补充"
  | "审核中"
  | "待同步"
  | "通过";

export interface ComplianceSnapshotStatus {
  fetchedAt: string;
  expiresAt: string;
  traceId: string | null;
  fresh: boolean;
}

export interface CompliancePreflightIssue {
  code: string;
  message: string;
}

export interface ComplianceDraftProjection {
  id: string;
  status: "draft" | "blocked" | "ready" | "waiting_review" | "submitted" | "archived";
  updatedAt: string | null;
  blockerCount: number;
  preflight: {
    evaluated: boolean;
    savedExecutable: boolean;
    blockerCount: number;
    warningCount: number;
    waitingCount: number;
    blockers: CompliancePreflightIssue[];
    warnings: CompliancePreflightIssue[];
  };
}

export interface ComplianceWorkspaceItem {
  id: string;
  skc: string;
  supplierCode: string;
  categoryId: string;
  categoryName: string;
  categoryPath?: string[];
  imageUrl?: string;
  shelfStatus: string | null;
  complianceStatus: ComplianceStatus;
  summary: Partial<Record<
    "certificate" | "agency" | "warning" | "platformOnly" | "packagePhoto" | "bodyPhoto",
    string
  >> & {
    sourceCoverage?: {
      requirementsReturned?: boolean;
      photoRequirementsReturned?: boolean;
    } | null;
  };
  updatedAt: string | null;
  snapshot: ComplianceSnapshotStatus | null;
  attributeSnapshot?: {
    fetchedAt: string;
    categoryId: string;
    productTypeId: string;
    fieldCount: number;
    assignedFieldCount: number;
    fields: Array<{
      id: string;
      name: string;
      required: boolean;
      mode: string;
      assigned: boolean;
      valueIds: string[];
      valueLabels: string[];
      customValue: string;
    }>;
    sourceEndpoint: string;
    traceId: string | null;
    reportSourcesConfigured: boolean;
  } | null;
  reportDecision?: {
    reportType: "1630" | "1631" | null;
    longestEdgeCm: number | null;
    areaM2: number | null;
    evidence: Array<{
      attributeId: string;
      attributeName: string;
      rawValue: string;
      valueId: string;
      unit: string;
      normalizedUnit: string;
      normalizedValue: number | string;
    }>;
    blockers: CompliancePreflightIssue[];
  } | null;
  draft: ComplianceDraftProjection | null;
  serverPreflight: {
    id: string;
    status: ComplianceServerPreflight["status"];
    blockerCount: number;
    createdAt: string;
    currentForDraft: boolean;
    currentForRules: boolean;
    currentForMedia: boolean;
    reviewCount: number;
    reviewedAt: string | null;
  } | null;
}

export interface ComplianceAuditSummary {
  notRun: number;
  needsRerun: number;
  pending: number;
  reviewed: number;
}

export interface ComplianceSummary {
  total: number;
  nonCompliant: number;
  inProgress: number;
  passed: number;
}

export interface ComplianceRemotePreflightPlan {
  skc: string;
  status: string;
  executable: boolean;
  actions: Array<Record<string, unknown>>;
  blockers: CompliancePreflightIssue[];
  warnings: CompliancePreflightIssue[];
  waiting: Array<Record<string, unknown>>;
  counts: {
    actions: number;
    blockers: number;
    warnings: number;
    waiting: number;
  };
}

export interface ComplianceRemotePreflight {
  dryRun: true;
  executable: boolean;
  plans: ComplianceRemotePreflightPlan[];
  summary: {
    total: number;
    ready: number;
    compliant: number;
    waitingReview: number;
    rulesPending: number;
    blocked: number;
    actionCount: number;
    blockerCount: number;
  };
  failedSkcNames: string[];
  generatedAt: string;
}

export interface ComplianceTemplateApplyResult {
  templateId: string;
  generatedAt: string;
  externalWrite: false;
  items: Array<{
    skc: string;
    status: "saved" | "blocked" | "failed";
    draft?: ComplianceDraft;
    blockers: CompliancePreflightIssue[];
    warnings: CompliancePreflightIssue[];
    preflight?: Record<string, unknown>;
  }>;
  summary: {
    requested: number;
    saved: number;
    blocked: number;
    failed: number;
  };
}

export interface ComplianceBatchDraftResult {
  generatedAt: string;
  externalWrite: false;
  message: string;
  items: Array<{
    skc: string;
    status: "saved" | "blocked" | "failed";
    draft?: ComplianceDraft;
    blockers?: CompliancePreflightIssue[];
    warnings?: CompliancePreflightIssue[];
  }>;
  summary: {
    requested: number;
    saved: number;
    blocked: number;
    failed: number;
  };
}

export interface ComplianceRequirementRecord {
  id: string;
  requirementType: string;
  requirementKey: string;
  status: string;
  required: boolean;
  data: Record<string, unknown>;
  traceId: string | null;
  checkedAt: string | null;
}

export interface ComplianceRuleSnapshot {
  ruleType: "compliance_requirement" | "certificate_schema" | "certificate_library" | "agency_library" | "warning_rules";
  payload: Record<string, unknown>;
  traceId: string | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  fresh: boolean;
}

export interface ComplianceServerPreflight {
  id: string;
  skc: string;
  status: "compliant" | "blocked" | "rules_pending" | "ready" | "waiting_review";
  executable: boolean;
  counts: {
    actions: number;
    blockers: number;
    warnings: number;
    waiting: number;
  };
  blockers: CompliancePreflightIssue[];
  warnings: CompliancePreflightIssue[];
  waitingCount: number;
  actionTypes: string[];
  actionSummaries: Array<{
    type: string;
    requirementKey: string;
    certificateTypeCode?: string;
    certificateTypeId?: string | number;
    poolSn?: string;
    agencyId?: string;
    agencyType?: string | number;
    labelId?: string | number;
    labelGroup?: string;
    fileName?: string;
    size?: number;
    certificateDimension?: string | number;
    fileCount?: number;
    fieldCount?: number;
    selectedByField?: Record<string, string[]>;
    autoMappedWarningValueIds?: string[];
  }>;
  ruleSnapshots: Array<{
    ruleType: ComplianceRuleSnapshot["ruleType"];
    fingerprint: string;
    fetchedAt: string | null;
    expiresAt: string | null;
  }>;
  inputFingerprint: string;
  ruleFingerprint: string;
  mediaFingerprint: string;
  requirementRuleSnapshotId: string;
  certificateRuleSnapshotId: string | null;
  createdAt: string;
  currentForDraft?: boolean;
  currentForRules?: boolean;
  currentForMedia?: boolean;
  publishingEnabled: false;
}

export interface CompliancePreflightReview {
  id: string;
  preflightRunId: string;
  skc: string;
  reviewedBy: string | null;
  reviewerDisplayName: string;
  reviewedAt: string;
  snapshot: {
    status: ComplianceServerPreflight["status"];
    counts: {
      actions: number;
      blockers: number;
      warnings: number;
    };
    inputFingerprint: string;
    ruleFingerprint: string;
    mediaFingerprint: string;
  };
  authorizesPublishing: false;
}

export interface ComplianceWorkspaceDetail {
  item: ComplianceWorkspaceItem;
  records: ComplianceRequirementRecord[];
  snapshots: ComplianceRuleSnapshot[];
  draft: ComplianceDraftProjection | null;
  editorModel: ComplianceEditorModel;
  workspaceCapabilities?: ComplianceWorkspaceCapabilities;
  latestPreflight: ComplianceServerPreflight | null;
  preflightHistory: ComplianceServerPreflight[];
  latestPreflightReviews: CompliancePreflightReview[];
  releaseGate: {
    publishingEnabled: false;
    blockerCount: number;
    blockers: CompliancePreflightIssue[];
  };
}

export interface ComplianceWorkspaceCapabilities {
  mode: "local_direct" | "cloud_cached";
  refreshCurrentSkc: boolean;
  directReportStorage: boolean;
  photoTemplateApply: boolean;
  reportTemplateApply: boolean;
  photoShare: boolean;
  photoBindingDiagnostic: boolean;
  photoSubmit: boolean;
  reportSubmit: boolean;
}

export interface CompliancePhotoAssignment {
  labelId: string | number;
  labelGroup: string;
  labelName?: string;
  localAssetRef: string;
  fileName: string;
  mimeType: string;
  size: number;
  width?: number | null;
  height?: number | null;
  uploadedPictureId?: string | number | null;
  sheinImageUrl?: string | null;
  templateReusable?: boolean;
  photoSlot?: "inner_package" | "outer_package" | "product";
}

export interface ComplianceCertificateFile {
  localAssetRef: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface ComplianceCertificateAssignment {
  certificateTypeId: string | number | null;
  certificateTypeCode: string;
  certificateTypeName: string;
  certificateDimension: string | number | null;
  poolSn?: string;
  status?: number;
  skc?: string;
  files: ComplianceCertificateFile[];
  fieldValues: Record<string, {
    valueIds?: string[];
    value?: string;
    detectionAgencyId?: string;
    laboratoryId?: string;
  }>;
}

export interface ComplianceDirectReport {
  skc: string;
  assignment: ComplianceCertificateAssignment;
  updatedAt: string;
}

export interface ComplianceCertificateField {
  id: string;
  name: string;
  inputType: number;
  required: boolean;
  sourceFrom: string;
  unit: string;
  options: Array<{ id: string; label: string }>;
}

export interface ComplianceAgencyAssignment {
  certificateTypeId: string | number | null;
  certificateTypeCode: string;
  certificateTypeName: string;
  agencyId: string;
}

export interface ComplianceWarningAssignment {
  certificateTypeId: string | number | null;
  certificateTypeCode: string;
  certificateTypeName: string;
  selectedByField: Record<string, string[]>;
}

export interface ComplianceEditorModel {
  certificateRulesFresh: boolean;
  certificateLibraryFresh: boolean;
  certificateLibrary: Array<{
    poolId: string;
    poolSn: string;
    certificateTypeId: string;
    certificateTypeCode: string;
    name: string;
    certificateDimension: string | number | null;
    effectiveTime: string;
    invalidTime: string;
    alertTime: string;
    bindSkcFlag: string | number | null;
    lastUpdateTime: string;
    fileNames: string[];
  }>;
  agencyLibraryRequired: boolean;
  agencyRequirements: Array<{
    key: string;
    certificateTypeId: string | number | null;
    certificateTypeCode: string;
    name: string;
    required: boolean;
    agencyType: number | null;
  }>;
  agencyLibraryFresh: boolean;
  agencyLibrary: Array<{
    agencyId: string;
    name: string;
    agencyType: string | number | null;
    agencySubType: string | number | null;
    agencyStartTime: string;
    agencyEndTime: string;
    coveredProductRange: string | number | null;
    updateTime: string;
  }>;
  warningRulesRequired: boolean;
  warningRulesFresh: boolean;
  warningRules: Array<{
    certificateTypeId: string;
    certificateTypeCode: string;
    name: string;
    fields: Array<{
      fieldCode: string;
      name: string;
      fieldType: number;
      fieldSort: number;
      values: Array<{
        id: string;
        label: string;
        exclusionFieldValueIds: string[];
        mappingPaths: string[][];
      }>;
    }>;
  }>;
  certificates: Array<{
    key: string;
    certificateTypeId: string | number | null;
    certificateTypeCode: string;
    name: string;
    required: boolean;
    perSkc: boolean;
    supported: boolean;
    unsupportedReason: string | null;
    certificateDimension: string | number | null;
    fields: ComplianceCertificateField[];
  }>;
  detectionAgencies: Array<{
    id: string;
    name: string;
    laboratories: Array<{ id: string; name: string }>;
  }>;
  platformCapabilities: Array<{
    capabilityKey: "gcc" | "product_identifier";
    readEndpoint: "/open-api/goods-compliance-requirements/list";
    certificateTypeId: string | number | null;
    certificateTypeCode: string;
    certificateTypeName: string;
    complianceGroupCode: string;
    isManualProductWarning: boolean | null;
    isAutoProductWarning: boolean | null;
    isRequired: number | null;
    reviewState: number | null;
    editable: false;
    writeStatus: "unsupported_by_official_api";
    writeEndpoint: null;
    writeFields: null;
  }>;
}

export interface ComplianceDraftInputs {
  certificates: ComplianceCertificateAssignment[];
  agencies: ComplianceAgencyAssignment[];
  warnings: ComplianceWarningAssignment[];
  photos: CompliancePhotoAssignment[];
  platformPhotoActions?: Array<{
    photoSlot: NonNullable<CompliancePhotoAssignment["photoSlot"]>;
    action: "keep" | "delete_requested" | "replace_requested";
    replacementMediaRef?: string | null;
    replacementFileName?: string | null;
  }>;
}

export interface ComplianceDraft {
  id: string;
  storeId: string;
  skc: string;
  templateId: string | null;
  requirementSnapshot: Record<string, unknown>;
  inputs: ComplianceDraftInputs;
  preflight: Record<string, unknown>;
  status: ComplianceDraftProjection["status"];
  updatedAt: string;
}

export interface MediaAsset {
  id: string;
  storeId: string | null;
  purpose: string;
  status: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  referenceCount: number;
  expiresAt: string | null;
  createdAt: string | null;
}

export interface WorkspaceUsage {
  drafts: {
    storeUsed: number;
    storeLimit: number;
    tenantUsed: number;
    tenantLimit: number;
    storeRemaining: number;
    tenantRemaining: number;
    blocked: boolean;
  };
  media: {
    storeUsed: number;
    storeLimit: number;
    tenantUsed: number;
    tenantLimit: number;
    storeBytesUsed: number;
    storeBytesLimit: number;
    tenantBytesUsed: number;
    tenantBytesLimit: number;
    storeRemaining: number;
    tenantRemaining: number;
    storeBytesRemaining: number;
    tenantBytesRemaining: number;
    blocked: boolean;
  };
  alerts: Array<{ code: string; level: "warning" | "error"; message: string }>;
  generatedAt: string;
}

export interface PublishCategoryResponse {
  info: Record<string, unknown>;
}

export interface PublishSchemaCoverageCategory {
  categoryId: string;
  productTypeId: string;
  name: string;
  path: string[];
  attributeReady: boolean;
  publishStandardReady: boolean;
  ready: boolean;
  attributeFetchedAt: string | null;
  publishStandardFetchedAt: string | null;
}

export interface PublishSchemaCoverageResponse {
  categories: PublishSchemaCoverageCategory[];
  summary: {
    total: number;
    ready: number;
    pending: number;
    attributeReady: number;
    publishStandardReady: number;
  };
  snapshot?: {
    cachedAt: string | null;
    source: string;
  };
  diagnostics?: unknown;
}

export interface PublishSchemaResponse {
  attributes: Record<string, unknown>;
  publishStandard: Record<string, unknown>;
  customAttributePermissions?: Record<string, unknown>;
  diagnostics?: unknown[];
}

export interface AttributeTemplateAssignment {
  attributeId: string;
  valueIds: string[];
  customValue: string;
}

export interface RugReportSources {
  dimensions?: Array<{
    attributeId: string;
    unit: "mm" | "cm" | "m";
  }>;
  thresholds?: {
    longestEdge: {
      attributeId: string;
      exceededValueId: string;
      withinValueId: string;
    };
    area: {
      attributeId: string;
      exceededValueId: string;
      withinValueId: string;
    };
  };
}

export interface ProductDraft {
  id: string;
  storeId: string;
  name: string;
  categoryId: string;
  productTypeId: string;
  data: Record<string, unknown>;
  preflight: {
    rugReport?: {
      reportType: "1630" | "1631" | null;
      longestEdgeCm: number | null;
      areaM2: number | null;
      blockers: Array<{ code: string; message: string; attributeId?: string }>;
      source: "product_attributes";
      schemaFetchedAt: string;
      requiresSkcReadback: true;
    };
    [key: string]: unknown;
  };
  status: "draft" | "blocked" | "ready" | "published" | "archived";
  updatedAt: string;
}

export interface DirectPublishResult {
  batch: PublishBatch;
  publishingEnabled: boolean;
  executionQueued?: boolean;
  executionStage?: "queued" | "accepted" | "result_unknown" | "failed";
  fastAck?: {
    stage: "queued" | "accepted" | "result_unknown" | "failed";
    handoffDraftIds: string[];
    acceptedDraftIds: string[];
    failedDraftIds: string[];
    uncertainDraftIds: string[];
    partial?: boolean;
    timedOut?: boolean;
    readbackError?: PublishFailure;
  };
  idempotentReplay?: boolean;
}

export interface SaveProductDraftInput {
  id?: string;
  name: string;
  categoryId: string;
  productTypeId: string;
  data: Record<string, unknown>;
  preflight: Record<string, unknown>;
  status: Exclude<ProductDraft["status"], "published">;
}

export interface PublishBatchConfirmation {
  state: "confirmed";
  confirmedAt: string;
  confirmedBy: string;
  batchFingerprint: string;
  items: Array<{
    itemId: string;
    draftId: string;
    sourceCandidateFingerprint: string;
    remoteCandidateFingerprint: string;
  }>;
  authorizesPublishing: false;
}

export interface PublishExecutionPlan {
  state: "ready_for_execution_confirmation";
  plannedAt: string;
  plannedBy: string;
  batchFingerprint: string;
  fingerprint: string;
  requestCount: number;
  skcCount: number;
  skuCount: number;
  requests: Array<{
    itemId: string;
    draftId: string;
    requestKey: string;
    sourceCandidateFingerprint: string;
    remoteCandidateFingerprint: string;
    categoryId: string;
    supplierCode: string;
    skcCount: number;
    skuCount: number;
  }>;
  receiptContract: {
    immediate: string[];
    receiveWebhook: string;
    auditWebhook: string;
  };
  readbackPlan: Array<{
    order: number;
    source: string;
    purpose: string;
  }>;
  executionEnabled: false;
  authorizesPublishing: false;
}

export interface PublishExecutionProtocol {
  state: "issued" | "running" | "completed";
  batchId: string;
  executionPlanFingerprint: string;
  authorizationId: string;
  fingerprint: string;
  authorizedAt: string;
  expiresAt: string;
  authorizedBy: string;
  singleUse: true;
  consumedAt: string | null;
  executionRunId: string | null;
  completedAt: string | null;
  requestClaimTtlMs: number;
  requests: Array<{
    requestKey: string;
    itemId: string;
    draftId: string;
    state:
      | "authorized"
      | "claimed"
      | "submitted"
      | "result_unknown"
      | "failed_retryable"
      | "failed_terminal"
      | "completed";
    attemptCount: number;
    readback: {
      receive: string;
      audit: string;
      documentStateQuery: string;
      spu: string;
      compliance: string;
    };
  }>;
  retryPolicy: {
    knownFailure: "retry_failed_request_only";
    unknownResult: "recover_by_webhook_or_query_document_state";
    automaticRetryAfterUnknownResult: false;
  };
  completionCriteria: string[];
  executionEnabled: false;
  authorizesPublishing: false;
}

export type ReviewCenterTab =
  | "all"
  | "awaiting_review"
  | "awaiting_price"
  | "awaiting_sample"
  | "awaiting_version_review"
  | "awaiting_sample_review"
  | "awaiting_final_review"
  | "needs_action"
  | "rejected";

export interface ReviewCenterResolution {
  code: string;
  displayLabel: string;
  tab: ReviewCenterTab;
  actionability: string;
  confidence: "low" | "medium" | "high";
  asOf: string | null;
}

export interface ProductDocumentState {
  projectionVersion: "product-document-state-v1";
  mode: "dry-run";
  externalWrite: false;
  empty?: true;
  projection: {
    eventFamily: "query-document-state";
    records: Array<{
      spuName: string | null;
      skcName: string | null;
      skuCodes: string[];
      documentSn: string | null;
      version: string | null;
      auditTime: string | null;
      auditState: number | null;
      auditStateLabel: "pending" | "passed" | "failed" | "withdrawn" | "unknown";
      status: "pending" | "passed" | "failed" | "withdrawn" | "unknown";
      failedReasons: Array<{
        language: string | null;
        content: string | null;
      }>;
    }>;
    persistence?: {
      matchedCount?: number;
      persistedCount?: number;
      ambiguousCount?: number;
      unmatchedCount?: number[];
      receiptState?: "fulfilled" | "rejected" | "skipped";
      reviewState?: "fulfilled" | "rejected" | "skipped";
      partial?: boolean;
      errors?: Record<string, { code: string; message: string }>;
    } | null;
  };
  summary: {
    disposition:
      | "read-only-document-state-projection"
      | "read-only-document-state-empty";
    recordCount: number;
    states: string[];
    passedRecordCount: number;
    failedRecordCount: number;
  };
  diagnostics?: {
    traceId: string | null;
    durationMs: number;
  };
}

export interface SpuRelationshipReadback {
  projectionVersion: "spu-readback-v1";
  mode: "dry-run";
  externalWrite: false;
  projection: {
    eventFamily: "goods/spu-info";
    spuName: string;
    categoryId: string | number | null;
    productTypeId: string | number | null;
    supplierCode: string | null;
    skcs: Array<{
      skcName: string;
      supplierCode: string | null;
      skuList: Array<{
        skuCode: string;
        supplierSku: string | null;
      }>;
    }>;
    persistence?: {
      receiptId: string | null;
      deduplicated: boolean;
    } | null;
  };
  summary: {
    disposition: "read-only-spu-relationship-readback";
    spuName: string;
    skcCount: number;
    skuCount: number;
  };
  diagnostics?: {
    traceId: string | null;
    durationMs: number;
  };
}

export interface RemotePublishCandidate {
  state: "ready_for_publish_confirmation" | "blocked" | string;
  sourceCandidateFingerprint?: string;
  fingerprint: string;
  publishingEnabled: false;
  requestBody?: Record<string, unknown> | null;
  blockers: Array<{ code?: string; message: string }>;
  checks?: {
    permission?: { state?: string };
    shelfQuota?: { state?: string; availableLimit?: number | null };
    supplierSkuRepeated?: {
      state?: string;
      checkedCount?: number;
      supplierSkus?: string[];
      repeatedSkus?: string[];
    };
    uploadPic?: {
      state?: string;
      requestedCount?: number;
      uploadedCount?: number;
      reusedCount?: number;
    };
  };
}

export interface PublishFailureDetail {
  source: string;
  location: string;
  messages: string[];
}

export interface PublishFailure {
  code: string | null;
  message: string;
  traceId: string | null;
  details?: PublishFailureDetail[];
}

export interface PublishBatchItem {
  id: string;
  taskId?: string;
  draftId: string;
  draftName: string;
  state: "queued" | "preflighting" | "ready" | "paused" | "failed" | "completed";
  attemptCount: number;
  preflight: {
    passed?: boolean;
    blockers?: string[];
    supplierSkus?: string[];
    publishCandidateFingerprint?: string;
    remotePublishCandidate?: RemotePublishCandidate;
    confirmation?: Omit<PublishBatchConfirmation, "items">;
  };
  lastError: string | PublishFailure | null;
  updatedAt: string;
}

export interface PublishBatch {
  id: string;
  storeId: string;
  name: string;
  idempotencyKey: string;
  state: PublishBatchItem["state"];
  confirmationState: "pending" | "confirmed";
  executionState:
    | "pending"
    | "planned"
    | "authorized"
    | "running"
    | "completed"
    | "expired"
    | "failed";
  preflight: {
    passed?: boolean;
    blockers?: string[];
    warnings?: string[];
    publishingEnabled?: false;
    confirmation?: PublishBatchConfirmation;
    executionPlan?: PublishExecutionPlan;
    executionProtocol?: PublishExecutionProtocol;
  };
  lastError: string | PublishFailure | null;
  items: PublishBatchItem[];
  itemCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface PublishComplianceCapability {
  capabilityKey: "gcc" | "product_identifier";
  required: boolean;
  status: string;
  editable: false;
  writeStatus: "unsupported_by_official_api";
  certificateTypeId: string | number | null;
  certificateTypeCode: string;
  certificateTypeName: string;
}

export interface PublishComplianceRevalidation {
  projectionVersion: "compliance-revalidation-v1";
  status: "passed" | "blocked";
  completionEligible: boolean;
  spuName: string | null;
  skcs: Array<{
    skcName: string;
    skuCodes: string[];
    report: {
      reportType: "1630" | "1631" | null;
      longestEdgeCm: number | null;
      areaM2: number | null;
    };
    capabilities: {
      gcc: PublishComplianceCapability;
      product_identifier: PublishComplianceCapability;
    };
    status: "passed" | "blocked";
    blockers: Array<{ code: string; message: string }>;
  }>;
  blockers: Array<{ code: string; message: string; skcName?: string }>;
  persistence?: {
    receiptId: string | null;
    deduplicated: boolean;
  };
}

export interface PublishBatchReadbackStatus {
  batchId: string;
  readOnly: true;
  items: Array<{
    id: string;
    draftId: string | null;
    requestKey: string;
    jobState: string;
    submittedAt: string | null;
    pendingTooLong: boolean;
    spuName: string | null;
    skcNames: string[];
    version: string | null;
    documentSn: string | null;
    documentState: {
      status: string;
      occurredAt: string | null;
      auditState: number | null;
      auditStateLabel: string | null;
      workflowStage?: string | null;
      failedReasons: Array<{ language: string; content: string }>;
      traceId: string | null;
    };
    resolution: ReviewCenterResolution;
    relationship: {
      status: string;
      occurredAt: string | null;
      skcCount: number;
      skuCount: number;
    };
    compliance: {
      status: string;
      occurredAt: string | null;
      blockerCount: number;
    };
    compliancePhotoSubmission: {
      status: string;
      occurredAt: string | null;
      packageCount: number;
      bodyCount: number;
      skcCount: number;
      message: string | null;
      code: string | null;
      traceId: string | null;
    };
    lastError: unknown;
    updatedAt: string;
  }>;
}

export interface ProductReviewItem {
  reviewKey: string;
  source: "shein_backend" | "open_api";
  reviewStage: "received" | "audited" | "document_state";
  receiveStatus: "accepted" | "failed" | "unknown" | null;
  version: string | null;
  documentSn: string | null;
  spuName: string | null;
  skcName: string | null;
  skuCodes: string[];
  auditState: number | null;
  auditStateLabel: "pending" | "passed" | "failed" | "withdrawn" | "unknown";
  workflowStage: string | null;
  resolution: ReviewCenterResolution;
  failedReasons: Array<{ language: string | null; content: string | null }>;
  title: string;
  imageUrl: string;
  sample: {
    reserveSampleFlag: number | string | null;
    spotFlag: number | string | null;
    sampleJudgeType: number | string | null;
    sampleCode: string | null;
  } | null;
  localDraftId: string | null;
  localMainAssetId: string | null;
  taskId: string;
  launchCount: number;
  rejectionCount: number;
  currentAttempt: boolean;
  attempt: ProductReviewAttempt | null;
  attemptHistory: ProductReviewAttempt[];
  canRelaunch: boolean;
  submissionState: "awaiting_readback" | "confirmed" | null;
  updatedAt: string | null;
}

export interface ProductReviewAttempt {
  businessAttemptId: string | null;
  businessAttemptNo: number;
  current: boolean;
  reason: string | null;
  reasonSource: "persisted" | "unavailable";
  parentAttemptId: string | null;
  supersedesAttemptId: string | null;
  localAttemptId: string | null;
  requestKey: string | null;
  idempotencyKey: string | null;
  sourceCandidateFingerprint: string | null;
  remoteCandidateFingerprint: string | null;
  publishJobId: string | null;
  publishBatchId: string | null;
  executionRunId: string | null;
  sheinVersion: string | null;
  sheinDocumentSn: string | null;
  reviewKey: string | null;
  executionState: string | null;
  executionAttemptCount: number;
  preflightAttemptCount: number | null;
  submittedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProductReviewList {
  items: ProductReviewItem[];
  count: number;
  archivedKeys: string[];
  readOnly: true;
  externalWrite: false;
}

export interface ReviewCenterSnapshotSource {
  state: "ready" | "partial" | "failed";
  error: { code: string; message: string } | null;
  failedBatchIds?: string[];
}

export interface ReviewCenterSnapshot {
  snapshotVersion: "review-center-snapshot-v1";
  storeId: string;
  generatedAt: string;
  consistency: {
    mode: "single-control-request";
    partial: boolean;
    sources: {
      drafts: ReviewCenterSnapshotSource;
      batches: ReviewCenterSnapshotSource;
      readbacks: ReviewCenterSnapshotSource;
      reviews: ReviewCenterSnapshotSource;
    };
  };
  drafts: {
    drafts: ProductDraft[];
    count: number;
    quota?: WorkspaceUsage["drafts"];
  };
  batches: {
    batches: PublishBatch[];
    count: number;
    publishingEnabled: boolean;
  };
  readbacks: {
    items: Array<PublishBatchReadbackStatus["items"][number] & { batchId: string }>;
    count: number;
    readOnly: true;
  };
  reviews: ProductReviewList;
}

export interface PriceDiscussion {
  discussSn: string;
  discussStatus: number;
  discussType: number;
  serialNumber: number;
  appealCount: number;
  skcName: string;
  supplierCode: string;
  spuName: string;
  productTitle: string;
  mainPicUrl: string;
  suggestCostPrice: number | null;
  suggestCostCurrency: string;
  skuCostPrices: Array<{
    skuCode: string;
    saleAttributeValues: string[];
    latestCostPrice: number | null;
    latestCurrency: string;
    suggestCostPrice: number | null;
    suggestCostCurrency: string;
  }>;
  appealReason: string;
  isSizeSamePrice: number;
  occurredAt: string | null;
}

export interface PriceDiscussionList {
  count: number;
  discussions: PriceDiscussion[];
}

export interface PriceDiscussionAcceptResult {
  discussSn: string;
  successCount: number;
  failCount: number;
  failedList: unknown[];
}

export type PublishBatchAction =
  | "preflight"
  | "confirm"
  | "plan-execution"
  | "authorize-execution"
  | "execute"
  | "pause"
  | "resume"
  | "retry";

export interface AttributeTemplate {
  id: string;
  storeId: string;
  scope: "tenant" | "user" | "store";
  scopeLabel: string;
  ownerUserId: string | null;
  canManage: boolean;
  templateType: "attribute";
  name: string;
  categoryId: string;
  productTypeId: string;
  schemaFingerprint: string;
  data: {
    categoryName?: string;
    categoryPath?: string[];
    schemaFetchedAt?: string;
    assignments?: AttributeTemplateAssignment[];
    rugReportSources?: RugReportSources;
    associatedRuleCheck?: {
      checkedAt: string;
      attributeIds: string[];
    };
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TitleRuleTemplate {
  id: string;
  storeId: string;
  scope: "tenant" | "user" | "store";
  scopeLabel: string;
  ownerUserId: string | null;
  canManage: boolean;
  templateType: "title_rule";
  name: string;
  categoryId: string;
  productTypeId: string;
  schemaFingerprint: string;
  data: {
    fullTitle?: string;
    prefix?: string;
    keywords?: string;
    suffix?: string;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveTitleRuleTemplateInput {
  name: string;
  data: {
    fullTitle: string;
    prefix: string;
    keywords: string;
    suffix: string;
  };
}

export interface CommercialTemplate {
  id: string;
  storeId: string;
  scope: "tenant" | "user" | "store";
  scopeLabel: string;
  ownerUserId: string | null;
  canManage: boolean;
  templateType: "commercial";
  name: string;
  categoryId: string;
  productTypeId: string;
  schemaFingerprint: string;
  data: {
    pricePerSquareMeter: number;
    gramsPerSquareMeter: number;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveCommercialTemplateInput {
  name: string;
  data: {
    pricePerSquareMeter: number;
    gramsPerSquareMeter: number;
  };
}

export interface PublishSettingsTemplate {
  id: string;
  storeId: string;
  scope: "tenant" | "user" | "store";
  scopeLabel: string;
  ownerUserId: string | null;
  canManage: boolean;
  templateType: "publish_settings";
  name: string;
  categoryId: string;
  productTypeId: string;
  schemaFingerprint: string;
  data: {
    mallState: "1" | "2";
    stopPurchase: "1" | "2";
    shelfRequire: "0" | "1";
    shelfWay: "1";
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavePublishSettingsTemplateInput {
  name: string;
  data: PublishSettingsTemplate["data"];
}

export interface SaveAttributeTemplateInput {
  name: string;
  categoryId: string;
  productTypeId: string;
  data: {
    categoryName: string;
    categoryPath: string[];
    schemaFetchedAt: string;
    assignments: AttributeTemplateAssignment[];
    rugReportSources?: RugReportSources;
    associatedRuleCheck: {
      checkedAt: string;
      attributeIds: string[];
    };
  };
  schemaSnapshot: {
    category: {
      categoryId: string;
      productTypeId: string;
    };
    fields: Array<{
      id: string;
      name: string;
      typeCode: number;
      dataDimension: number;
      modeCode: number;
      required: boolean;
      maxSelections: number;
      values: Array<{ id: string; label: string }>;
    }>;
  };
}

export interface SizeTemplateRow {
  sizeText: string;
  lengthCm: number;
  widthCm: number;
}

export interface SizeTemplate {
  id: string;
  storeId: string;
  scope: "tenant" | "user" | "store";
  scopeLabel: string;
  ownerUserId: string | null;
  canManage: boolean;
  templateType: "size";
  name: string;
  categoryId: string;
  productTypeId: string;
  schemaFingerprint: string;
  data: {
    colorText?: string;
    matchingPolicy?: "match_current_shein_schema_on_publish";
    rows?: SizeTemplateRow[];
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveSizeTemplateInput {
  name: string;
  data: {
    colorText: string;
    rows: SizeTemplateRow[];
  };
}

export interface PackagingTemplateRow {
  widthCm: number;
  lengthCm: number;
  packageLengthCm: number;
  packageWidthCm: number;
  packageHeightCm: number;
  key?: string;
  rowNumber?: number;
}

export interface PackagingTemplateData {
  fileName?: string;
  importedAt?: string;
  materials?: Record<string, PackagingTemplateRow[]>;
  materialCount?: number;
  sizeCount?: number;
  rowCount?: number;
  recordCount?: number;
  overwrittenCount?: number;
  issues?: string[];
}

export interface PackagingTemplate {
  id: string;
  storeId: string;
  scope: "tenant" | "user" | "store";
  scopeLabel: string;
  ownerUserId: string | null;
  canManage: boolean;
  templateType: "packaging";
  name: string;
  categoryId: string;
  productTypeId: string;
  schemaFingerprint: string;
  data: PackagingTemplateData;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavePackagingTemplateInput {
  name: string;
  data: {
    fileName: string;
    importedAt: string;
    materials: Record<string, PackagingTemplateRow[]>;
    overwrittenCount: number;
  };
}

export interface TailImageCropMetadata {
  mode: "original" | "cropped";
  presetId: "portrait" | "square";
  sourceWidth: number | null;
  sourceHeight: number | null;
  outputWidth: number | null;
  outputHeight: number | null;
}

export interface TailImageTemplateAsset {
  id: string;
  storeId: string;
  originalName: string;
  contentType: string;
  width: number | null;
  height: number | null;
  crop: TailImageCropMetadata;
}

export interface TailImageTemplate {
  id: string;
  storeId: string;
  scope: "tenant" | "user" | "store";
  scopeLabel: string;
  ownerUserId: string | null;
  canManage: boolean;
  templateType: "tail_image";
  name: string;
  categoryId: string;
  productTypeId: string;
  schemaFingerprint: string;
  data: {
    placement?: "append";
    assetIds?: string[];
    assets?: TailImageTemplateAsset[];
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveTailImageTemplateInput {
  name: string;
  data: {
    placement: "append";
    assetIds: string[];
    assets: TailImageTemplateAsset[];
  };
}

export interface ComplianceTemplate {
  id: string;
  storeId: string;
  scope: "store";
  scopeLabel: string;
  ownerUserId: string | null;
  canManage: boolean;
  templateType: "compliance";
  name: string;
  data: {
    templateKind?: "rug_report";
    reportType?: "1630" | "1631";
    reportDate?: string;
    reportFile?: {
      localAssetRef: string;
      fileName: string;
      mimeType: string;
      size: number;
    };
    requirements?: ComplianceTemplateRequirement[];
    defaults?: ComplianceDraftInputs;
    storeScoped?: true;
    revalidateOnUse?: true;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveComplianceTemplateInput {
  name: string;
  data: {
    templateKind?: "rug_report";
    reportType?: "1630" | "1631";
    reportDate?: string;
    reportFile?: {
      localAssetRef: string;
      fileName: string;
      mimeType: string;
      size: number;
    };
    requirements?: ComplianceTemplateRequirement[];
    defaults?: ComplianceDraftInputs;
  };
}

export class ApiError extends Error {
  status: number;
  code: string;
  traceId: string | null;
  diagnostics: Record<string, unknown> | null;

  constructor(
    status: number,
    code: string,
    message: string,
    traceId: string | null = null,
    diagnostics: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.traceId = traceId;
    this.diagnostics = diagnostics;
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json;charset=UTF-8");
  }
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    recordDiagnosticEvent({
      kind: "api.error",
      method,
      path,
      metadata: { errorName: aborted ? "AbortError" : "FetchError" },
    });
    throw new ApiError(
      aborted ? 504 : 503,
      aborted ? "REQUEST_TIMEOUT" : "SERVICE_UNAVAILABLE",
      aborted ? "请求超时，请稍后重试" : "服务暂时不可用，请稍后重试",
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    recordDiagnosticEvent({
      kind: "api.error",
      method,
      path,
      statusCode: response.status,
      traceId: response.headers.get("x-trace-id") || payload.traceId || null,
      metadata: { errorCode: String(payload.code || "REQUEST_FAILED") },
    });
    throw new ApiError(
      response.status,
      String(payload.code || "REQUEST_FAILED"),
      String(payload.msg || payload.message || "请求失败，请稍后重试"),
      payload.traceId ? String(payload.traceId) : null,
      payload.diagnostics && typeof payload.diagnostics === "object" ? payload.diagnostics : null,
    );
  }
  return payload as T;
}

async function uploadMediaFile(
  storeId: string,
  file: File,
  purpose: "compliance_evidence" | "selected_unpublished",
  dimensions: { width?: number | null; height?: number | null } = {},
) {
  const ticket = await requestJson<{
    asset: MediaAsset;
    upload: {
      method: "PUT";
      url: string;
      headers: Record<string, string>;
      expiresAt: string;
    };
  }>(`/v1/web/stores/${encodeURIComponent(storeId)}/media/upload-ticket`, {
    method: "POST",
    body: JSON.stringify({
      originalName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      purpose,
    }),
  });
  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(ticket.upload.url, {
      method: ticket.upload.method,
      headers: ticket.upload.headers,
      body: file,
    });
  } catch {
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "图片上传服务暂时不可用，请稍后重试");
  }
  if (!uploadResponse.ok) {
    throw new ApiError(
      uploadResponse.status,
      "MEDIA_UPLOAD_FAILED",
      "图片上传失败，请重试",
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return requestJson<{ asset: MediaAsset; alreadyCompleted: boolean }>(
    `/v1/web/stores/${encodeURIComponent(storeId)}/media/${encodeURIComponent(ticket.asset.id)}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ ...dimensions, sha256 }),
    },
  );
}

async function uploadComplianceEvidence(storeId: string, file: File) {
  let dimensions: { width?: number; height?: number } = {};
  if (file.type === "image/jpeg" || file.type === "image/png") {
    const bitmap = await createImageBitmap(file);
    try {
      dimensions = { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }
  return uploadMediaFile(storeId, file, "compliance_evidence", dimensions);
}

async function uploadTailImage(
  storeId: string,
  file: File,
  dimensions: { width: number; height: number },
) {
  return uploadMediaFile(storeId, file, "selected_unpublished", dimensions);
}

async function uploadSkuImage(
  storeId: string,
  file: File,
  dimensions: { width: number; height: number },
) {
  return uploadMediaFile(storeId, file, "selected_unpublished", dimensions);
}

async function uploadProductImage(
  storeId: string,
  file: File,
  dimensions: { width: number; height: number },
) {
  return uploadMediaFile(storeId, file, "selected_unpublished", dimensions);
}

export const api = {
  session: () => requestJson<Session>("/v1/web/session"),
  stores: () =>
    requestJson<{ stores: Store[]; count: number }>("/v1/web/stores"),
  startSheinAuthorization: () =>
    requestJson<{ authorizationUrl: string; expiresAt: string }>(
      "/v1/web/shein/auth/start",
      {
        method: "POST",
        body: "{}",
      },
    ),
  renameStore: (storeId: string, label: string) =>
    requestJson<{ store: Store }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ label }),
      },
    ),
  revokeStoreAuthorization: (storeId: string) =>
    requestJson<{ store: Store & { authorizationRevoked?: boolean } }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}`,
      {
        method: "DELETE",
        body: "{}",
      },
    ),
  members: () =>
    requestJson<{ members: MemberSummary[]; count: number }>(
      "/v1/web/admin/members",
    ),
  updateMemberStoreAccess: (userId: string, storeIds: string[]) =>
    requestJson<{ member: MemberSummary }>(
      `/v1/web/admin/members/${encodeURIComponent(userId)}/store-access`,
      {
        method: "PUT",
        body: JSON.stringify({ storeIds }),
      },
    ),
  updateMemberFeatureAccess: (userId: string, feature: "ai_title", enabled: boolean) =>
    requestJson<{ member: MemberSummary }>(
      `/v1/web/admin/members/${encodeURIComponent(userId)}/feature-access`,
      {
        method: "PUT",
        body: JSON.stringify({ feature, enabled }),
      },
    ),
  aiTitleSettings: () =>
    requestJson<AiTitleSettings>("/v1/web/admin/ai-title-settings"),
  saveAiTitleSettings: (input: {
    apiUrl: string;
    model: string;
    modelUrl: string;
    apiKey?: string;
  }) =>
    requestJson<AiTitleSettings>("/v1/web/admin/ai-title-settings", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  updateManagedMember: (
    userId: string,
    input: { role?: ManagedMemberRole; status?: "active" | "disabled" },
  ) =>
    requestJson<{ member: MemberSummary }>(
      `/v1/web/admin/members/${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    ),
  updateMemberAdminAlias: (userId: string, alias: string) =>
    requestJson<{ member: MemberSummary }>(
      `/v1/web/admin/members/${encodeURIComponent(userId)}/alias`,
      {
        method: "PATCH",
        body: JSON.stringify({ alias }),
      },
    ),
  createMemberInvitation: (input: {
    email: string;
    displayName: string;
    role: ManagedMemberRole;
    storeIds: string[];
  }) =>
    requestJson<{ invitation: CreatedMemberInvitation; token: string }>(
      "/v1/web/admin/invitations",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  memberInvitation: (token: string) =>
    requestJson<{ invitation: PublicMemberInvitation }>(
      `/v1/web/invitations/${encodeURIComponent(token)}`,
    ),
  acceptMemberInvitation: (token: string, password: string) =>
    requestJson<{
      accepted: true;
      tenant: { id: string; name: string };
      user: {
        id: string;
        email: string;
        displayName: string;
        role: ManagedMemberRole;
      };
    }>(`/v1/web/invitations/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  login: (input: { email: string; password: string }) =>
    requestJson<Session>("/v1/web/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  register: (input: {
    email: string;
    displayName?: string;
    password: string;
  }) =>
    requestJson<PublicRegistrationResult>("/v1/web/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  requestPasswordReset: (email: string) =>
    requestJson<{ accepted: true }>("/v1/web/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    requestJson<{ reset: true }>("/v1/web/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),
  logout: () =>
    requestJson<{ ok: true }>("/v1/web/logout", {
      method: "POST",
      body: "{}",
    }),
  publishCategories: (storeId: string) =>
    requestJson<PublishCategoryResponse>(
      attributeTemplatePaths(storeId).categories,
    ),
  publishSchemaCoverage: (storeId: string) =>
    requestJson<PublishSchemaCoverageResponse>(
      attributeTemplatePaths(storeId).schemaCoverage,
    ),
  syncPublishSchemas: (storeId: string) =>
    requestJson<{
      started: boolean;
      job: { id: string; jobType: "rule_refresh"; state: SyncJobState };
    }>(
      attributeTemplatePaths(storeId).schemaSync,
      { method: "POST", body: "{}" },
    ),
  publishSchema: (
    storeId: string,
    input: { categoryId: string; productTypeId: string },
  ) =>
    requestJson<PublishSchemaResponse>(
      attributeTemplatePaths(storeId).schema,
      { method: "POST", body: JSON.stringify(input) },
    ),
  associatedAttributeRules: (
    storeId: string,
    input: {
      categoryId: string;
      productTypeId: string;
      attributeList: Array<{
        attributeId: string;
        attributeValueId?: string;
      }>;
    },
  ) =>
    requestJson<{ info: Record<string, unknown> }>(
      attributeTemplatePaths(storeId).associatedRules,
      { method: "POST", body: JSON.stringify(input) },
    ),
  attributeTemplates: (storeId: string) =>
    requestJson<{ templates: AttributeTemplate[]; count: number }>(
      attributeTemplatePaths(storeId).templates,
    ),
  saveAttributeTemplate: (
    storeId: string,
    input: SaveAttributeTemplateInput,
    templateId = "",
  ) =>
    requestJson<{ template: AttributeTemplate }>(
      attributeTemplatePaths(storeId, templateId).template,
      {
        method: templateId ? "PUT" : "POST",
        body: JSON.stringify({ templateType: "attribute", ...input }),
      },
    ),
  deleteAttributeTemplate: (storeId: string, templateId: string) =>
    requestJson<{ ok: true; id: string }>(
      attributeTemplatePaths(storeId, templateId).template,
      { method: "DELETE" },
    ),
  titleRuleTemplates: (storeId: string) =>
    requestJson<{ templates: TitleRuleTemplate[]; count: number }>(
      titleRuleTemplatePaths(storeId).templates,
    ),
  saveTitleRuleTemplate: (
    storeId: string,
    input: SaveTitleRuleTemplateInput,
    templateId = "",
  ) =>
    requestJson<{ template: TitleRuleTemplate }>(
      titleRuleTemplatePaths(storeId, templateId).template,
      {
        method: templateId ? "PUT" : "POST",
        body: JSON.stringify({ templateType: "title_rule", ...input }),
      },
    ),
  deleteTitleRuleTemplate: (storeId: string, templateId: string) =>
    requestJson<{ ok: true; id: string }>(
      titleRuleTemplatePaths(storeId, templateId).template,
      { method: "DELETE" },
    ),
  aiTitleCapability: (storeId: string) =>
    requestJson<AiTitleCapability>(aiTitlePaths(storeId).capability),
  suggestAiTitle: (
    storeId: string,
    input: {
      mainImageAssetId: string;
      titleRuleTemplateId: string;
      titleRule: { prefix?: string; keywords?: string; suffix?: string };
      currentTitle?: string;
      titleMaxLength?: number;
      locale?: string;
    },
  ) =>
    requestJson<AiTitleSuggestion>(aiTitlePaths(storeId).suggest, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  commercialTemplates: (storeId: string) =>
    requestJson<{ templates: CommercialTemplate[]; count: number }>(
      commercialTemplatePaths(storeId).templates,
    ),
  saveCommercialTemplate: (
    storeId: string,
    input: SaveCommercialTemplateInput,
    templateId = "",
  ) =>
    requestJson<{ template: CommercialTemplate }>(
      commercialTemplatePaths(storeId, templateId).template,
      {
        method: templateId ? "PUT" : "POST",
        body: JSON.stringify({ templateType: "commercial", ...input }),
      },
    ),
  deleteCommercialTemplate: (storeId: string, templateId: string) =>
    requestJson<{ ok: true; id: string }>(
      commercialTemplatePaths(storeId, templateId).template,
      { method: "DELETE" },
    ),
  publishSettingsTemplates: (storeId: string) =>
    requestJson<{ templates: PublishSettingsTemplate[]; count: number }>(
      publishSettingsTemplatePaths(storeId).templates,
    ),
  savePublishSettingsTemplate: (
    storeId: string,
    input: SavePublishSettingsTemplateInput,
    templateId = "",
  ) =>
    requestJson<{ template: PublishSettingsTemplate }>(
      publishSettingsTemplatePaths(storeId, templateId).template,
      {
        method: templateId ? "PUT" : "POST",
        body: JSON.stringify({ templateType: "publish_settings", ...input }),
      },
    ),
  deletePublishSettingsTemplate: (storeId: string, templateId: string) =>
    requestJson<{ ok: true; id: string }>(
      publishSettingsTemplatePaths(storeId, templateId).template,
      { method: "DELETE" },
    ),
  productDrafts: (storeId: string, options: { includePublishHistory?: boolean } = {}) =>
    requestJson<{
      drafts: ProductDraft[];
      count: number;
      quota?: WorkspaceUsage["drafts"];
    }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/product-drafts${options.includePublishHistory ? "?includePublishHistory=1" : ""}`,
    ),
  saveProductDraft: (storeId: string, input: SaveProductDraftInput) =>
    requestJson<{ draft: ProductDraft }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/product-drafts`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  revalidateProductDrafts: (storeId: string, draftIds: string[] = [], options: { force?: boolean } = {}) =>
    requestJson<{ drafts: ProductDraft[]; count: number; skippedCount?: number }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/product-drafts/revalidate`,
      {
        method: "POST",
        body: JSON.stringify({ draftIds, force: options.force === true }),
      },
    ),
  archiveProductDraft: (storeId: string, draftId: string) =>
    requestJson<{ draft: ProductDraft }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/product-drafts/${encodeURIComponent(draftId)}`,
      { method: "DELETE" },
    ),
  archiveProductDrafts: (storeId: string, draftIds: string[]) =>
    requestJson<{ drafts: ProductDraft[]; count: number; skippedCount?: number }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/product-drafts`,
      {
        method: "DELETE",
        body: JSON.stringify({ draftIds }),
      },
    ),
  workspaceUsage: (storeId: string) =>
    requestJson<WorkspaceUsage>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/workspace-usage`,
    ),
  publishBatches: (storeId: string) =>
    requestJson<{
      batches: PublishBatch[];
      count: number;
      publishingEnabled: boolean;
    }>(`/v1/web/stores/${encodeURIComponent(storeId)}/publish-batches`),
  reviewCenterSnapshot: (storeId: string) =>
    requestJson<ReviewCenterSnapshot>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/review-center/snapshot`,
    ),
  productReviews: (storeId: string) =>
    requestJson<ProductReviewList>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/product-reviews`,
    ),
  archiveProductReview: (storeId: string, reviewKey: string) =>
    requestJson<{
      reviewKey: string;
      archivedAt: string;
      archived: true;
      externalWrite: false;
    }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/product-reviews/${encodeURIComponent(reviewKey)}`,
      { method: "DELETE" },
    ),
  archiveProductReviews: (storeId: string, reviewKeys: string[]) =>
    requestJson<{
      archived: true;
      count: number;
      reviewKeys: string[];
      externalWrite: false;
    }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/product-reviews`,
      { method: "DELETE", body: JSON.stringify({ reviewKeys }) },
    ),
  publishNow: (storeId: string, draftIds: string[], idempotencyKey: string) =>
    requestJson<DirectPublishResult>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/publish-now`,
      {
        method: "POST",
        body: JSON.stringify({
          draftIds,
          idempotencyKey,
          confirmation: "CONFIRM_SHEIN_PRODUCT_PUBLISH",
        }),
      },
    ),
  queryProductDocumentState: (
    storeId: string,
    input: { version: string; spuNames: string[] },
  ) =>
    requestJson<ProductDocumentState>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/publish/document-state`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  querySpuInfo: (
    storeId: string,
    input: { spuName: string; version: string },
  ) =>
    requestJson<SpuRelationshipReadback>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/publish/spu-info`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  publishBatchReadbackStatus: (storeId: string, batchId: string) =>
    requestJson<PublishBatchReadbackStatus>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/publish-batches/${encodeURIComponent(batchId)}/readback-status`,
    ),
  priceDiscussions: (storeId: string) =>
    requestJson<PriceDiscussionList>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/price-discussions?status=1`,
    ),
  acceptPriceDiscussion: (storeId: string, discussSn: string) =>
    requestJson<PriceDiscussionAcceptResult>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/price-discussions/${encodeURIComponent(discussSn)}/accept`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  rejectPriceDiscussion: (storeId: string, discussSn: string) =>
    requestJson<PriceDiscussionAcceptResult>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/price-discussions/${encodeURIComponent(discussSn)}/reject`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  revalidatePublishCompliance: (
    storeId: string,
    input: { spuName: string; version: string },
  ) =>
    requestJson<PublishComplianceRevalidation>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/publish/compliance-revalidation`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  preflightCompliance: (
    storeId: string,
    input: {
      skcNames: string[];
      template: {
        ruleSnapshotAt?: string;
        defaults?: ComplianceDraftInputs;
      };
    },
  ) =>
    requestJson<ComplianceRemotePreflight>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/compliance/preflight`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  applyComplianceTemplate: (
    storeId: string,
    templateId: string,
    input: { skcNames: string[]; sections?: Array<"certificates" | "photos"> },
  ) =>
    requestJson<ComplianceTemplateApplyResult>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/compliance/templates/${encodeURIComponent(templateId)}/apply`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  saveComplianceBatchDraft: (
    storeId: string,
    input: {
      skcNames: string[];
      photos?: CompliancePhotoAssignment[];
      reports?: Array<ComplianceCertificateAssignment & {
        reportType: "1630" | "1631";
        reportDate: string;
      }>;
    },
  ) => requestJson<ComplianceBatchDraftResult>(
    `/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace/batch-drafts`,
    { method: "POST", body: JSON.stringify(input) },
  ),
  applyCompliancePhotoTemplate: (
    storeId: string,
    templateId: string,
    input: { skc: string },
  ) => requestJson<{ templateId: string; skc: string; externalWrite: false; photos: CompliancePhotoAssignment[] }>(
    `/v1/web/stores/${encodeURIComponent(storeId)}/compliance/photo-templates/${encodeURIComponent(templateId)}/apply`,
    { method: "POST", body: JSON.stringify(input) },
  ),
  createPublishBatch: (
    storeId: string,
    input: { name: string; idempotencyKey: string; draftIds: string[] },
  ) =>
    requestJson<{ batch: PublishBatch; publishingEnabled: boolean }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/publish-batches`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  actPublishBatch: (
    storeId: string,
    batchId: string,
    action: PublishBatchAction,
  ) =>
    requestJson<{
      batch: PublishBatch;
      publishingEnabled: boolean;
      executionQueued?: boolean;
      executionStage?: "queued" | "accepted" | "result_unknown" | "failed";
      fastAck?: DirectPublishResult["fastAck"];
    }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/publish-batches/${encodeURIComponent(batchId)}/actions`,
      {
        method: "POST",
        body: JSON.stringify({
          action,
          ...(action === "execute"
            ? { confirmation: "CONFIRM_SHEIN_PRODUCT_PUBLISH" }
            : {}),
        }),
      },
    ),
  sizeTemplates: (storeId: string) =>
    requestJson<{ templates: SizeTemplate[]; count: number }>(
      sizeTemplatePaths(storeId).templates,
    ),
  saveSizeTemplate: (
    storeId: string,
    input: SaveSizeTemplateInput,
    templateId = "",
  ) =>
    requestJson<{ template: SizeTemplate }>(
      sizeTemplatePaths(storeId, templateId).template,
      {
        method: templateId ? "PUT" : "POST",
        body: JSON.stringify({ templateType: "size", ...input }),
      },
    ),
  deleteSizeTemplate: (storeId: string, templateId: string) =>
    requestJson<{ ok: true; id: string }>(
      sizeTemplatePaths(storeId, templateId).template,
      { method: "DELETE" },
    ),
  packagingTemplates: (storeId: string) =>
    requestJson<{ templates: PackagingTemplate[]; count: number }>(
      packagingTemplatePaths(storeId).templates,
    ),
  savePackagingTemplate: (
    storeId: string,
    input: SavePackagingTemplateInput,
    templateId = "",
  ) =>
    requestJson<{ template: PackagingTemplate }>(
      packagingTemplatePaths(storeId, templateId).template,
      {
        method: templateId ? "PUT" : "POST",
        body: JSON.stringify({ templateType: "packaging", ...input }),
      },
    ),
  deletePackagingTemplate: (storeId: string, templateId: string) =>
    requestJson<{ ok: true; id: string }>(
      packagingTemplatePaths(storeId, templateId).template,
      { method: "DELETE" },
    ),
  tailImageTemplates: (storeId: string) =>
    requestJson<{ templates: TailImageTemplate[]; count: number }>(
      tailImageTemplatePaths(storeId).templates,
    ),
  saveTailImageTemplate: (
    storeId: string,
    input: SaveTailImageTemplateInput,
    templateId = "",
  ) =>
    requestJson<{ template: TailImageTemplate }>(
      tailImageTemplatePaths(storeId, templateId).template,
      {
        method: templateId ? "PUT" : "POST",
        body: JSON.stringify({ templateType: "tail_image", ...input }),
      },
    ),
  deleteTailImageTemplate: (storeId: string, templateId: string) =>
    requestJson<{ ok: true; id: string }>(
      tailImageTemplatePaths(storeId, templateId).template,
      { method: "DELETE" },
    ),
  complianceTemplates: (storeId: string) =>
    requestJson<{ templates: ComplianceTemplate[]; count: number }>(
      complianceTemplatePaths(storeId).templates,
    ),
  saveComplianceTemplate: (
    storeId: string,
    input: SaveComplianceTemplateInput,
    templateId = "",
  ) =>
    requestJson<{ template: ComplianceTemplate }>(
      complianceTemplatePaths(storeId, templateId).template,
      {
        method: templateId ? "PUT" : "POST",
        body: JSON.stringify({ templateType: "compliance", ...input }),
      },
    ),
  deleteComplianceTemplate: (storeId: string, templateId: string) =>
    requestJson<{ ok: true; id: string }>(
      complianceTemplatePaths(storeId, templateId).template,
      { method: "DELETE" },
    ),
  uploadTailImage,
  uploadSkuImage,
  uploadProductImage,
  tailImagePreviewTicket: (
    storeId: string,
    templateId: string,
    assetId: string,
  ) =>
    requestJson<{
      asset: MediaAsset;
      download: {
        method: "GET";
        url: string;
        headers: Record<string, string>;
        expiresAt: string;
      };
    }>(
      tailImageTemplatePaths(storeId, templateId, assetId).templateMedia,
    ),
  tailImagePreviewUrl: (storeId: string, templateId: string, assetId: string) =>
    tailImageTemplatePaths(storeId, templateId, assetId).templateMedia.replace(
      /\/download-ticket$/,
      "/content",
    ),
  mediaDownloadTicket: (storeId: string, assetId: string) =>
    requestJson<{
      asset: MediaAsset;
      download: {
        method: "GET";
        url: string;
        headers: Record<string, string>;
        expiresAt: string;
      };
    }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/media/${encodeURIComponent(assetId)}/download-ticket`,
    ),
  /**
   * Stable same-origin preview URL for persisted media. Unlike a download
   * ticket this URL does not contain a short-lived signature, so browser and
   * React Query caches can reuse the image across pages. Download tickets
   * remain reserved for file transfers/publish operations.
   */
  mediaContentUrl: (storeId: string, assetId: string) =>
    `/v1/web/stores/${encodeURIComponent(storeId)}/media/${encodeURIComponent(assetId)}/content`,
  businessDashboard: (storeId: string) =>
    requestJson<BusinessDashboard>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/business-dashboard?refreshIfEmpty=0`,
    ),
  todayWork: (input: { date?: string; storeId?: string } = {}) => {
    const params = new URLSearchParams();
    if (input.date) params.set("date", input.date);
    if (input.storeId) params.set("storeId", input.storeId);
    const query = params.toString();
    return requestJson<TodayWorkSnapshot>(`/v1/web/today-work${query ? `?${query}` : ""}`);
  },
  refreshBusinessDashboard: (storeId: string) =>
    requestJson<BusinessDashboard>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/business-dashboard`,
      { method: "POST", body: "{}" },
    ),
  refreshRules: (storeId: string) =>
    requestJson<{
      started: boolean;
      job: { id: string; jobType: "rule_refresh"; state: SyncJobState };
    }>(`/v1/web/stores/${encodeURIComponent(storeId)}/rules/refresh`, {
      method: "POST",
      body: "{}",
    }),
  retryRuleRefresh: (storeId: string, jobId: string) =>
    requestJson<{
      started: boolean;
      job: { id: string; jobType: "rule_refresh"; state: SyncJobState };
    }>(`/v1/web/stores/${encodeURIComponent(storeId)}/rules/refresh/retry`, {
      method: "POST",
      body: JSON.stringify({ jobId }),
    }),
  refreshCompliance: (storeId: string) =>
    requestJson<{
      started: boolean;
      job: { id: string; jobType: "compliance_sync"; state: SyncJobState } | null;
      refreshControl?: {
        status: "started" | "active" | "cooldown";
        retryAfterSeconds?: number;
      } | null;
    }>(`/v1/web/stores/${encodeURIComponent(storeId)}/compliance/refresh`, {
      method: "POST",
      body: "{}",
    }),
  complianceWorkspace: (
    storeId: string,
    filters: {
      query?: string;
      status?: ComplianceStatus | "";
      reviewStatus?: "" | "not_run" | "stale" | "pending" | "reviewed";
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const search = new URLSearchParams({
      page: String(filters.page || 1),
      pageSize: String(filters.pageSize || 50),
    });
    if (filters.query) search.set("q", filters.query);
    if (filters.status) search.set("status", filters.status);
    if (filters.reviewStatus) search.set("reviewStatus", filters.reviewStatus);
    return requestJson<{
      items: ComplianceWorkspaceItem[];
      auditSummary: ComplianceAuditSummary;
      complianceSummary: ComplianceSummary;
      pagination: { page: number; pageSize: number; total: number; pageCount: number };
    }>(`/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace?${search}`);
  },
  complianceWorkspaceItem: (storeId: string, skc: string) =>
    requestJson<ComplianceWorkspaceDetail>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace/${encodeURIComponent(skc)}`,
    ),
  refreshComplianceWorkspaceRules: (storeId: string, skc: string) =>
    requestJson<{
      refreshed: true;
      detail: ComplianceWorkspaceDetail;
    }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace/${encodeURIComponent(skc)}/rules/refresh`,
      { method: "POST", body: "{}" },
    ),
  runCompliancePreflight: (storeId: string, skc: string) =>
    requestJson<{ preflight: ComplianceServerPreflight }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace/${encodeURIComponent(skc)}/preflight`,
      { method: "POST", body: "{}" },
    ),
  reviewCompliancePreflight: (storeId: string, skc: string, preflightRunId: string) =>
    requestJson<{ review: CompliancePreflightReview }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace/${encodeURIComponent(skc)}/preflight/${encodeURIComponent(preflightRunId)}/review`,
      { method: "POST", body: "{}" },
    ),
  complianceDraft: (storeId: string, skc: string) =>
    requestJson<{ draft: ComplianceDraft | null }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/compliance/drafts/${encodeURIComponent(skc)}`,
    ),
  complianceReport: (storeId: string, skc: string) =>
    requestJson<{ report: ComplianceDirectReport | null }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/compliance/reports/${encodeURIComponent(skc)}`,
    ),
  testCompliancePhotoBinding: (
    storeId: string,
    skc: string,
    input: { photos: CompliancePhotoAssignment[] },
  ) => requestJson<{
    externalWrite: false;
    requestPath: "/open-api/goods-compliance/skc-save-label";
    status: "blocked" | "candidate_only";
    fields: Record<string, unknown>;
    missingOfficialFields: string[];
    checks: Array<{
      officialGroup: "product" | "package";
      label: string;
      labelGroup: string;
      labelIds: Array<string | number>;
      localPhotoCount: number;
      status: string;
      message: string;
    }>;
  }>(
    `/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace/${encodeURIComponent(skc)}/photos/bind-contract-check`,
    { method: "POST", body: JSON.stringify(input) },
  ),
  submitCompliancePhotos: async (storeId: string, skc: string) => {
    const checked = await requestJson<{
      confirmationToken: string;
      confirmation: string;
    }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace/${encodeURIComponent(skc)}/photos/bind-contract-check`,
      { method: "POST", body: "{}" },
    );
    return requestJson<{
      ok: true;
      externalWrite: true;
      mode: "executed";
      info: {
        totalCount: number;
        successCount: number;
        faildCount: number;
        faildList: Array<{ skc: string; code: string; reason: string }>;
      };
      traceId: string | null;
      uploads: Array<{ photoSlot: string | null; fileName: string; traceId: string | null }>;
      readback: unknown;
      readbackWarning: string | null;
      historyMutation: "not_documented";
    }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace/${encodeURIComponent(skc)}/photos/submit`,
      {
        method: "POST",
        body: JSON.stringify({
          confirmation: checked.confirmation,
          confirmationToken: checked.confirmationToken,
        }),
      },
    );
  },
  submitComplianceReport: async (
    storeId: string,
    skc: string,
    assignment: ComplianceCertificateAssignment,
  ) => {
    const checked = await requestJson<{
      confirmationToken: string;
      confirmation: string;
      reportType: string;
      fileCount: number;
      fieldCount: number;
    }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace/${encodeURIComponent(skc)}/reports/contract-check`,
      { method: "POST", body: JSON.stringify({ assignment }) },
    );
    return requestJson<{
      ok: true;
      externalWrite: true;
      mode: "executed";
      skc: string;
      poolSn: string;
      uploads: Array<{ fileName: string; traceId: string | null }>;
      saveTraceId: string | null;
      bindTraceId: string | null;
      readbackJob: unknown;
      readbackWarning: string | null;
    }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace/${encodeURIComponent(skc)}/reports/submit`,
      {
        method: "POST",
        body: JSON.stringify({
          assignment,
          confirmation: checked.confirmation,
          confirmationToken: checked.confirmationToken,
        }),
      },
    );
  },
  saveComplianceReport: (
    storeId: string,
    skc: string,
    assignment: ComplianceCertificateAssignment,
  ) => requestJson<{ report: ComplianceDirectReport }>(
    `/v1/web/stores/${encodeURIComponent(storeId)}/compliance/reports/${encodeURIComponent(skc)}`,
    { method: "PUT", body: JSON.stringify({ assignment }) },
  ),
  shareCompliancePhotos: (
    storeId: string,
    sourceSkc: string,
    input: { targetSkcs: string[]; photos: CompliancePhotoAssignment[] },
  ) => requestJson<{
    externalWrite: false;
    items: Array<{ skc: string; status: "saved" | "failed"; message?: string }>;
  }>(
    `/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace/${encodeURIComponent(sourceSkc)}/photos/share`,
    { method: "POST", body: JSON.stringify(input) },
  ),
  saveComplianceDraft: (
    storeId: string,
    skc: string,
    input: {
      expectedUpdatedAt: string | null;
      requirementSnapshot: Record<string, unknown>;
      inputs: ComplianceDraftInputs;
      preflight: Record<string, unknown>;
      status: ComplianceDraftProjection["status"];
    },
  ) => requestJson<{ draft: ComplianceDraft }>(
    `/v1/web/stores/${encodeURIComponent(storeId)}/compliance/drafts/${encodeURIComponent(skc)}`,
    { method: "PUT", body: JSON.stringify(input) },
  ),
  uploadComplianceEvidence,
  syncJobs: (
    storeId: string,
    filters: { state?: SyncJobState | ""; jobType?: SyncJobType | "" } = {},
  ) => {
    const search = new URLSearchParams({ limit: "50" });
    if (filters.state) search.set("state", filters.state);
    if (filters.jobType) search.set("jobType", filters.jobType);
    return requestJson<{ jobs: SyncJobSummary[]; count: number }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/sync-jobs?${search}`,
    );
  },
  syncJob: (storeId: string, jobId: string) =>
    requestJson<{ job: SyncJobDetail }>(
      `/v1/web/stores/${encodeURIComponent(storeId)}/sync-jobs/${encodeURIComponent(jobId)}`,
    ),
};
