import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  FileImage,
  ListChecks,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  api,
  type ComplianceAgencyAssignment,
  type ComplianceDraftInputs,
  type ComplianceEditorModel,
  type CompliancePhotoAssignment,
  type ComplianceRequirementRecord,
  type ComplianceRuleSnapshot,
  type ComplianceWarningAssignment,
  type ComplianceWorkspaceCapabilities,
  type UserRole,
} from "../../lib/api";
import { formatTime } from "../operations/OperationsShared";
import { ComplianceCertificateEditor } from "./ComplianceCertificateEditor";

const EMPTY_INPUTS: ComplianceDraftInputs = {
  certificates: [],
  agencies: [],
  warnings: [],
  photos: [],
  platformPhotoActions: [],
};

const reviewStateLabels: Record<number, string> = {
  0: "未审核",
  1: "待审核",
  2: "审核成功",
  3: "审核驳回",
};

const agencyTypeLabels: Record<number, string> = {
  0: "欧盟责任人",
  1: "英国代理",
  2: "美国代理",
  3: "制造商",
  4: "土耳其责任人",
};

function normalizeInputs(value?: Partial<ComplianceDraftInputs>): ComplianceDraftInputs {
  return {
    certificates: Array.isArray(value?.certificates) ? value.certificates : [],
    agencies: Array.isArray(value?.agencies) ? value.agencies : [],
    warnings: Array.isArray(value?.warnings) ? value.warnings : [],
    photos: Array.isArray(value?.photos) ? value.photos : [],
    platformPhotoActions: Array.isArray(value?.platformPhotoActions) ? value.platformPhotoActions : [],
  };
}

function requirementValue(record: ComplianceRequirementRecord, key: string) {
  return String(record.data[key] ?? "");
}

function agencyAssignmentKey(assignment: ComplianceAgencyAssignment) {
  return String(assignment.certificateTypeId ?? assignment.certificateTypeCode);
}

function warningAssignmentKey(assignment: ComplianceWarningAssignment) {
  return String(assignment.certificateTypeId ?? assignment.certificateTypeCode);
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function photoLabelGroup(photo: CompliancePhotoAssignment) {
  if (photo.photoSlot === "product") return "1";
  if (photo.photoSlot === "inner_package" || photo.photoSlot === "outer_package") return "2";
  return String(photo.labelGroup || "");
}

function localPhotoPreviewUrl(storeId: string, photo: CompliancePhotoAssignment) {
  const assetId = String(photo.localAssetRef || "").replace(/^media:/, "");
  if (!assetId.startsWith("local-media-")) return null;
  return `/v1/web/stores/${encodeURIComponent(storeId)}/media/${encodeURIComponent(assetId)}/content`;
}

function isResolvedStatus(value: string | undefined) {
  return ["通过", "无需", "审核成功", "审核通过"].includes(String(value || ""));
}

function isPhotoSubmissionStatus(value: string | undefined) {
  return ["失败", "待补充"].includes(String(value || ""));
}

function matchesRule(record: ComplianceRequirementRecord, rule: { certificateTypeId?: string | number | null; certificateTypeCode?: string; key?: string }) {
  const data = record.data;
  return [rule.key, rule.certificateTypeId, rule.certificateTypeCode]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .some((value) => [data.certificateTypeId, data.certificateTypeCode, record.requirementKey]
      .some((candidate) => String(candidate ?? "") === String(value)));
}

function reportRuleMatchesType(rule: { name?: string; key?: string; certificateTypeCode?: string }, reportType?: "1630" | "1631" | null) {
  if (!reportType) return false;
  return [rule.name, rule.key, rule.certificateTypeCode]
    .map((value) => String(value || ""))
    .some((value) => value.includes(reportType));
}

export function ComplianceDraftEditor({
  storeId,
  queryScope: queryScopeValue,
  skc,
  role,
  records,
  availableSkcs,
  photoTemplates,
  reportTemplates,
  selectedPhotoTemplateId,
  onSelectedPhotoTemplateId,
  onApplyPhotoTemplate,
  photoTemplateApplying,
  selectedReportTemplateId,
  onSelectedReportTemplateId,
  onApplyReportTemplate,
  reportTemplateApplying,
  photoTemplateError,
  reportTemplateError,
  bodyPhotoStatus,
  certificateStatus,
  agencyStatus,
  warningStatus,
  packagePhotoStatus,
  platformOnlyStatus,
  officialReportType,
  requirementSnapshot,
  editorModel,
  workspaceCapabilities,
  onSaved,
  onPreflight,
  preflightPending,
}: {
  storeId: string;
  queryScope: string;
  skc: string;
  role: UserRole;
  records: ComplianceRequirementRecord[];
  availableSkcs?: Array<{ skc: string; packagePhoto?: string; bodyPhoto?: string }>;
  photoTemplates?: Array<{ id: string; name: string; data?: { defaults?: ComplianceDraftInputs } }>;
  reportTemplates?: Array<{ id: string; name: string; data?: { defaults?: ComplianceDraftInputs } }>;
  selectedPhotoTemplateId?: string;
  onSelectedPhotoTemplateId?: (value: string) => void;
  onApplyPhotoTemplate?: () => void;
  photoTemplateApplying?: boolean;
  selectedReportTemplateId?: string;
  onSelectedReportTemplateId?: (value: string) => void;
  onApplyReportTemplate?: () => void;
  reportTemplateApplying?: boolean;
  photoTemplateError?: string;
  reportTemplateError?: string;
  bodyPhotoStatus?: string;
  certificateStatus?: string;
  agencyStatus?: string;
  warningStatus?: string;
  packagePhotoStatus?: string;
  platformOnlyStatus?: string;
  officialReportType?: "1630" | "1631" | null;
  requirementSnapshot: ComplianceRuleSnapshot | null;
  editorModel: ComplianceEditorModel;
  workspaceCapabilities?: ComplianceWorkspaceCapabilities;
  onSaved: () => void;
  onPreflight: () => void;
  preflightPending: boolean;
}) {
  const queryClient = useQueryClient();
  const queryScope = queryScopeValue;
  const queryKey = ["store", queryScope, storeId, "compliance-draft", skc];
  const draftQuery = useQuery({
    queryKey,
    queryFn: () => api.complianceDraft(storeId, skc),
    enabled: Boolean(storeId && skc),
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const directReportQuery = useQuery({
    queryKey: ["store", queryScope, storeId, "compliance-report", skc],
    queryFn: () => api.complianceReport(storeId, skc),
    enabled: Boolean(storeId && skc && workspaceCapabilities?.directReportStorage),
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const [inputs, setInputs] = useState<ComplianceDraftInputs>(EMPTY_INPUTS);
  const [dirty, setDirty] = useState(false);
  const [uploadingKey, setUploadingKey] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [directSavedKey, setDirectSavedKey] = useState("");
  const [photoBindDiagnostic, setPhotoBindDiagnostic] = useState<{
    externalWrite: false;
    requestPath: string;
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
  } | null>(null);
  const [photoSubmitResult, setPhotoSubmitResult] = useState<{
    successCount: number;
    traceId: string | null;
    readbackWarning: string | null;
  } | null>(null);
  const [reportSubmitResult, setReportSubmitResult] = useState<{
    poolSn: string;
    saveTraceId: string | null;
    bindTraceId: string | null;
    readbackWarning: string | null;
  } | null>(null);
  const initializedVersion = useRef<string | null>(null);
  const draft = draftQuery.data?.draft || null;
  const reportDateInheritedFromTemplate = Boolean(
    draft?.templateId &&
    Array.isArray(draft.preflight?.actions) &&
    draft.preflight.actions.some((action) =>
      action && typeof action === "object" && action.type === "certificate.map_report_template"
    ),
  );
  const canEdit = role !== "viewer";
  const isCloudCached = workspaceCapabilities?.mode === "cloud_cached";
  const rulesFresh = requirementSnapshot?.fresh === true;
  const [showResolved, setShowResolved] = useState(false);
  const resolvedStatusByType: Record<string, string | undefined> = {
    certificate: certificateStatus,
    agency: agencyStatus,
    warning: warningStatus,
    package_photo: packagePhotoStatus,
    body_photo: bodyPhotoStatus,
    unsupported: platformOnlyStatus,
  };
  const ruleNeedsAttention = (type: string, rule: { certificateTypeId?: string | number | null; certificateTypeCode?: string; key?: string }) => {
    if (isResolvedStatus(resolvedStatusByType[type])) return false;
    const matchingRecords = records.filter((record) => record.requirementType === type && matchesRule(record, rule));
    return matchingRecords.length
      ? matchingRecords.some((record) => !isResolvedStatus(record.status))
      : groupNeedsAttention(type);
  };
  const groupNeedsAttention = (type: string) => {
    if (isResolvedStatus(resolvedStatusByType[type])) return false;
    const groupRecords = records.filter((record) => record.requirementType === type);
    return groupRecords.some((record) => record.required && !isResolvedStatus(record.status));
  };
  const certificateIsOfficialReport = (rule: ComplianceEditorModel["certificates"][number]) =>
    Boolean(rule.perSkc && reportRuleMatchesType(rule, officialReportType));
  const requiredEditorModel = {
    ...editorModel,
    certificates: editorModel.certificates.filter((rule) =>
      rule.required || certificateIsOfficialReport(rule),
    ),
    agencyRequirements: editorModel.agencyRequirements.filter((rule) =>
      rule.required,
    ),
    warningRules: editorModel.warningRules.filter((rule) =>
      records.some((record) => record.required && record.requirementType === "warning" && matchesRule(record, rule)),
    ),
    platformCapabilities: editorModel.platformCapabilities.filter((capability) => {
      if (capability.isRequired !== 1) return false;
      return true;
    }),
  };
  const visibleEditorModel = showResolved ? requiredEditorModel : {
    ...requiredEditorModel,
    certificates: requiredEditorModel.certificates.filter((rule) => ruleNeedsAttention("certificate", rule)),
    agencyRequirements: requiredEditorModel.agencyRequirements.filter((rule) => ruleNeedsAttention("agency", rule)),
    warningRules: requiredEditorModel.warningRules.filter((rule) => ruleNeedsAttention("warning", rule)),
    platformCapabilities: requiredEditorModel.platformCapabilities.filter((capability) => {
      if (isResolvedStatus(platformOnlyStatus)) return false;
      const matchingRecords = records.filter((record) => record.requirementType === "unsupported" && matchesRule(record, capability));
      return matchingRecords.length
        ? matchingRecords.some((record) => !isResolvedStatus(record.status))
        : groupNeedsAttention("unsupported");
    }),
  };
  const hiddenResolvedCount = [
    editorModel.certificates.length > visibleEditorModel.certificates.length,
    editorModel.agencyRequirements.length > visibleEditorModel.agencyRequirements.length,
    editorModel.warningRules.length > visibleEditorModel.warningRules.length,
    editorModel.platformCapabilities.length > visibleEditorModel.platformCapabilities.length,
  ].filter(Boolean).length;
  const photoGroupNeedsSubmission = (type: "body_photo" | "package_photo") => {
    const groupRecords = records.filter((record) => record.requirementType === type);
    return groupRecords.some((record) => record.required && isPhotoSubmissionStatus(record.status));
  };
  const requiredBodyPhoto = photoGroupNeedsSubmission("body_photo");
  const requiredPackagePhoto = photoGroupNeedsSubmission("package_photo");
  const hasRequiredPhotoGroup = requiredBodyPhoto || requiredPackagePhoto;
  const hasBodyPhoto = inputs.photos.some((photo) => photoLabelGroup(photo) === "1");
  const hasPackagePhoto = inputs.photos.some((photo) => photoLabelGroup(photo) === "2");
  const missingRequiredPhoto =
    (requiredBodyPhoto && !hasBodyPhoto) ||
    (requiredPackagePhoto && !hasPackagePhoto);
  const submissionPhotos = inputs.photos.filter((photo) => {
    const labelGroup = photoLabelGroup(photo);
    return (labelGroup === "1" && requiredBodyPhoto) ||
      (labelGroup === "2" && requiredPackagePhoto);
  });

  useEffect(() => {
    if (!draftQuery.isSuccess) return;
    const version = draft?.updatedAt || "empty";
    if (initializedVersion.current === version) return;
    setInputs(normalizeInputs(draft?.inputs));
    setDirty(false);
    initializedVersion.current = version;
  }, [draft, draftQuery.isSuccess]);

  useEffect(() => {
    const assignment = directReportQuery.data?.report?.assignment;
    if (!assignment || inputs.certificates.some((item) => String(item.certificateTypeId ?? item.certificateTypeCode) === String(assignment.certificateTypeId ?? assignment.certificateTypeCode))) return;
    setInputs((current) => ({
      ...current,
      certificates: [
        ...current.certificates.filter((item) => String(item.certificateTypeId ?? item.certificateTypeCode) !== String(assignment.certificateTypeId ?? assignment.certificateTypeCode)),
        assignment,
      ],
    }));
  }, [directReportQuery.data, inputs.certificates]);

  const saveDraft = useMutation({
    mutationFn: () => api.saveComplianceDraft(storeId, skc, {
      expectedUpdatedAt: draft?.updatedAt || null,
      requirementSnapshot: requirementSnapshot?.payload || {},
      inputs,
      preflight: {},
      status: "draft",
    }),
    onSuccess: (result) => {
      initializedVersion.current = result.draft.updatedAt;
      setInputs(normalizeInputs(result.draft.inputs));
      setDirty(false);
      queryClient.setQueryData(queryKey, result);
      onSaved();
    },
  });

  const saveDirectReport = useMutation({
    mutationFn: (rule: ComplianceEditorModel["certificates"][number]) => {
      const assignment = inputs.certificates.find((item) =>
        String(item.certificateTypeId ?? item.certificateTypeCode) === rule.key,
      );
      if (!assignment?.files?.length) throw new Error("请先上传当前 SKC 的 1630/1631 报告");
      return api.saveComplianceReport(storeId, skc, assignment);
    },
    onSuccess: (result) => {
      setDirectSavedKey(String(result.report.assignment.certificateTypeId ?? result.report.assignment.certificateTypeCode));
      void directReportQuery.refetch();
    },
  });
  const submitReport = useMutation({
    mutationFn: (rule: ComplianceEditorModel["certificates"][number]) => {
      const assignment = inputs.certificates.find((item) =>
        String(item.certificateTypeId ?? item.certificateTypeCode) === rule.key,
      );
      if (!assignment?.files?.length) {
        throw new Error("请先上传当前SKC的1630/1631报告");
      }
      const dateField = rule.fields.find((field) => field.inputType === 4);
      if (!dateField || !assignment.fieldValues?.[dateField.id]?.value) {
        throw new Error("请填写1630/1631报告日期");
      }
      return api.submitComplianceReport(storeId, skc, assignment);
    },
    onSuccess: (result) => {
      setReportSubmitResult({
        poolSn: result.poolSn,
        saveTraceId: result.saveTraceId,
        bindTraceId: result.bindTraceId,
        readbackWarning: result.readbackWarning,
      });
      onSaved();
    },
  });

  const sharePhotos = useMutation({
    mutationFn: (targetSkcs: string[]) => api.shareCompliancePhotos(storeId, skc, {
      targetSkcs,
      photos: inputs.photos,
    }),
    onSuccess: () => setSelectedSkcs([]),
  });
  const testPhotoBinding = useMutation({
    mutationFn: () => api.testCompliancePhotoBinding(storeId, skc, { photos: submissionPhotos }),
    onSuccess: (result) => setPhotoBindDiagnostic(result),
  });
  const submitPhotos = useMutation({
    mutationFn: () => api.submitCompliancePhotos(storeId, skc),
    onSuccess: (result) => {
      setPhotoSubmitResult({
        successCount: Number(result.info?.successCount || 0),
        traceId: result.traceId || null,
        readbackWarning: result.readbackWarning || null,
      });
      setPhotoBindDiagnostic(null);
      onSaved();
    },
  });
  const [selectedSkcs, setSelectedSkcs] = useState<string[]>([]);
  const [showAllShareTargets, setShowAllShareTargets] = useState(false);

  // 实拍图只按 SHEIN 官方回读的必填记录呈现；没有官方必填记录时不创建本地兜底槽位。
  const photoGroups: Array<["body_photo" | "package_photo", ComplianceRequirementRecord[]]> =
    (["body_photo", "package_photo"] as const)
      .map((type) => [type, records.filter((record) => record.requirementType === type && record.required)] as ["body_photo" | "package_photo", ComplianceRequirementRecord[]])
      .filter(([type, groupRecords]) => groupRecords.length > 0 && photoGroupNeedsSubmission(type));
  const removePhoto = (target: CompliancePhotoAssignment) => {
    setInputs((current) => ({
      ...current,
      photos: current.photos.filter((photo) => photo !== target),
      platformPhotoActions: (current.platformPhotoActions || []).filter((item) =>
        !target.photoSlot || item.photoSlot !== target.photoSlot
      ),
    }));
    setDirty(true);
  };

  const uploadPhotos = async (
    groupType: "body_photo" | "package_photo",
    record: ComplianceRequirementRecord,
    files: File[],
  ) => {
    if (!files.length) return;
    const labelGroup = groupType === "body_photo" ? "1" : "2";
    const existingCount = inputs.photos.filter((photo) => photoLabelGroup(photo) === labelGroup).length;
    if (existingCount + files.length > 15) {
      setUploadError(`${groupType === "body_photo" ? "商品本体" : "商品包装"}实拍图每组最多 15 张`);
      return;
    }
    if (files.some((file) => !["image/jpeg", "image/png"].includes(file.type))) {
      setUploadError("实拍图只支持 JPG、JPEG 或 PNG 格式");
      return;
    }
    setUploadingKey(groupType);
    setUploadError("");
    try {
      const uploaded: CompliancePhotoAssignment[] = [];
      for (const file of files) {
        const result = await api.uploadComplianceEvidence(storeId, file);
        uploaded.push({
          labelId: requirementValue(record, "labelId"),
          labelGroup,
          labelName: requirementValue(record, "labelName"),
          localAssetRef: `media:${result.asset.id}`,
          fileName: result.asset.originalName,
          mimeType: result.asset.contentType,
          size: result.asset.sizeBytes,
          width: result.asset.width,
          height: result.asset.height,
          templateReusable: true,
        });
      }
      setInputs((current) => ({ ...current, photos: [...current.photos, ...uploaded] }));
      setDirty(true);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "合规证据上传失败");
    } finally {
      setUploadingKey("");
    }
  };

  const uploadCertificate = async (
    rule: ComplianceEditorModel["certificates"][number],
    file?: File,
  ) => {
    if (!file) return;
    setUploadingKey(`cert:${rule.key}`);
    setUploadError("");
    try {
      const result = await api.uploadComplianceEvidence(storeId, file);
      const current = inputs.certificates.find((assignment) =>
        String(assignment.certificateTypeId ?? assignment.certificateTypeCode) === rule.key
      );
      setInputs((value) => ({
        ...value,
        certificates: [
          ...value.certificates.filter((assignment) =>
            String(assignment.certificateTypeId ?? assignment.certificateTypeCode) !== rule.key
          ),
          {
            certificateTypeId: rule.certificateTypeId,
            certificateTypeCode: rule.certificateTypeCode,
            certificateTypeName: rule.name,
            certificateDimension: rule.certificateDimension,
            ...(rule.perSkc ? { skc } : {}),
            files: [{
              localAssetRef: `media:${result.asset.id}`,
              fileName: result.asset.originalName,
              mimeType: result.asset.contentType,
              size: result.asset.sizeBytes,
            }],
            fieldValues: current?.fieldValues || {},
          },
        ],
      }));
      setDirty(true);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "证书文件暂存失败");
    } finally {
      setUploadingKey("");
    }
  };

  if (draftQuery.isLoading) {
    return (
      <section className="data-panel grid min-h-48 place-items-center text-sm text-[var(--text-subtle)]">
        正在读取合规草稿
      </section>
    );
  }

  return (
    <section className="data-panel">
      <header className="data-toolbar flex-wrap">
        <div>
          <h2>合规草稿</h2>
          <p>
            {draft ? `上次保存于 ${formatTime(draft.updatedAt)}` : "尚未建立草稿"} · 仅展示 SHEIN 返回的必填合规项
            {dirty ? " · 有未保存修改" : ""}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!rulesFresh || saveDraft.isPending || Boolean(uploadingKey) || (!dirty && Boolean(draft))}
              onClick={() => saveDraft.mutate()}
              size="sm"
            >
              <Save size={15} />
              {saveDraft.isPending ? "正在保存" : draft ? "保存草稿" : "建立草稿"}
            </Button>
            <Button
              disabled={!rulesFresh || !draft || dirty || preflightPending || saveDraft.isPending}
              onClick={onPreflight}
              size="sm"
              variant="outline"
            >
              <ListChecks size={15} />
              {preflightPending ? "正在预检" : "运行合规预检"}
            </Button>
          </div>
        )}
      </header>

      {!rulesFresh && (
        <div className="notice notice-warning m-4" role="status">
          <AlertCircle size={16} />
          <span>缺少有效合规要求快照，请先刷新合规数据后再编辑。</span>
        </div>
      )}
      {(draftQuery.error || directReportQuery.error || saveDraft.error || saveDirectReport.error || submitReport.error || photoTemplateError || reportTemplateError || uploadError) && (
        <div className="notice notice-danger m-4" role="alert">
          <AlertCircle size={16} />
          <span>{draftQuery.error?.message || directReportQuery.error?.message || saveDraft.error?.message || saveDirectReport.error?.message || submitReport.error?.message || reportTemplateError || photoTemplateError || uploadError}</span>
        </div>
      )}
      {saveDraft.isSuccess && !dirty && (
        <div className="notice notice-success m-4" role="status">
          <CheckCircle2 size={16} />
          <span>草稿已保存，尚未向 SHEIN 提交。</span>
        </div>
      )}

      {hiddenResolvedCount > 0 && (
        <div className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text-muted)]">
          <span>已通过资料默认隐藏，仅展示失败、待补充和审核中的项目。</span>
          <Button onClick={() => setShowResolved((value) => !value)} size="sm" variant="ghost">
            {showResolved ? "隐藏已通过资料" : "查看已通过资料"}
          </Button>
        </div>
      )}

      {visibleEditorModel.certificates.length > 0 && <ComplianceCertificateEditor
        assignments={inputs.certificates}
        busyKey={uploadingKey}
        canEdit={canEdit}
        model={visibleEditorModel}
        onChange={(certificates) => {
          setInputs((current) => ({ ...current, certificates }));
          setDirty(true);
        }}
        onUpload={(rule, file) => { void uploadCertificate(rule, file); }}
        directSavedKey={directSavedKey}
        directSaving={saveDirectReport.isPending}
        onDirectSave={workspaceCapabilities?.directReportStorage ? (rule) => saveDirectReport.mutate(rule) : undefined}
        directSubmitting={submitReport.isPending}
        onDirectSubmit={workspaceCapabilities?.reportSubmit ? (rule) => {
          if (window.confirm(`确认把当前SKC ${skc} 的${rule.name}、报告日期和文件真实提交到SHEIN？\n\n系统将先上传文件，再创建证书池，最后只绑定当前SKC。`)) {
            setReportSubmitResult(null);
            submitReport.mutate(rule);
          }
        } : undefined}
        reportTemplates={reportTemplates}
        selectedReportTemplateId={selectedReportTemplateId}
        onSelectedReportTemplateId={onSelectedReportTemplateId}
        onApplyReportTemplate={onApplyReportTemplate}
        reportTemplateApplying={reportTemplateApplying}
        reportDateInheritedFromTemplate={reportDateInheritedFromTemplate}
        saving={saveDraft.isPending}
        skc={skc}
      />}
      {reportSubmitResult && (
        <div className="notice notice-success m-4" role="status">
          <CheckCircle2 size={16} />
          <div>
            <strong className="block">SHEIN已接收当前SKC的阻燃报告</strong>
            <p className="mt-1 text-xs">
              证书编号 {reportSubmitResult.poolSn}
              {reportSubmitResult.saveTraceId ? ` · 创建traceId ${reportSubmitResult.saveTraceId}` : ""}
              {reportSubmitResult.bindTraceId ? ` · 绑定traceId ${reportSubmitResult.bindTraceId}` : ""}
              {reportSubmitResult.readbackWarning ? ` · 状态同步提示：${reportSubmitResult.readbackWarning}` : " · 已启动状态回读"}
            </p>
          </div>
        </div>
      )}

      {visibleEditorModel.agencyLibraryRequired && visibleEditorModel.agencyRequirements.length > 0 && (
        <>
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h3 className="text-xs font-semibold text-[var(--ink)]">可绑定代理公司</h3>
            <p className="mt-1 text-xs text-[var(--text-subtle)]">为每条责任人要求选择当前店铺的有效记录</p>
          </div>
          {!editorModel.agencyLibraryFresh ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--text-subtle)]">代理公司快照缺失或已过期</div>
          ) : (
            <div className="divide-y divide-[var(--line)]">
            {visibleEditorModel.agencyRequirements.map((requirement) => {
                const assignment = inputs.agencies.find(
                  (agency) => agencyAssignmentKey(agency) === requirement.key,
                );
                const options = editorModel.agencyLibrary.filter(
                  (agency) => Number(agency.agencyType) === requirement.agencyType,
                );
                const selected = options.find(
                  (agency) => agency.agencyId === assignment?.agencyId,
                );
                const stale = Boolean(assignment?.agencyId && !selected);
                const disabled = !canEdit || saveDraft.isPending || Boolean(uploadingKey);
                return (
                  <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,0.7fr)_minmax(260px,1fr)] md:items-end" key={requirement.key}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm font-medium text-[var(--ink)]">{requirement.name}</strong>
                        {requirement.required && <span className="text-xs text-[var(--danger)]">必需</span>}
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-subtle)]">
                        {requirement.agencyType === null
                          ? "当前开放平台未提供可验证的类型映射"
                          : agencyTypeLabels[requirement.agencyType] || "代理公司"}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <select
                        aria-label={`选择${requirement.name}`}
                        className="field px-2.5"
                        disabled={disabled || requirement.agencyType === null}
                        onChange={(event) => {
                          const agency = options.find(
                            (option) => option.agencyId === event.target.value,
                          );
                          setInputs((current) => ({
                            ...current,
                            agencies: agency ? [
                              ...current.agencies.filter(
                                (item) => agencyAssignmentKey(item) !== requirement.key,
                              ),
                              {
                                certificateTypeId: requirement.certificateTypeId,
                                certificateTypeCode: requirement.certificateTypeCode,
                                certificateTypeName: requirement.name,
                                agencyId: agency.agencyId,
                              },
                            ] : current.agencies.filter(
                              (item) => agencyAssignmentKey(item) !== requirement.key,
                            ),
                          }));
                          setDirty(true);
                        }}
                        value={assignment?.agencyId || ""}
                      >
                        <option value="">尚未选择</option>
                        {stale && <option value={assignment?.agencyId}>{assignment?.agencyId}（已失效）</option>}
                        {options.map((agency) => (
                          <option key={agency.agencyId} value={agency.agencyId}>
                            {agency.name} · {Number(agency.coveredProductRange) === 1 ? "全店覆盖" : `ID ${agency.agencyId}`}
                          </option>
                        ))}
                      </select>
                      {selected && (
                        <p className="mt-1.5 text-xs text-[var(--text-subtle)]">
                          {selected.agencyStartTime || "--"} 至 {selected.agencyEndTime || "--"}
                          {Number(selected.coveredProductRange) === 1 ? " · 全店自动覆盖" : " · 可绑定 SKC"}
                        </p>
                      )}
                      {stale && (
                        <p className="mt-1.5 text-xs text-[var(--danger)]">草稿中的代理公司已不在当前同类型有效列表中。</p>
                      )}
                      {!stale && options.length === 0 && requirement.agencyType !== null && (
                        <p className="mt-1.5 text-xs text-[var(--danger)]">当前类型没有可绑定代理公司。</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {visibleEditorModel.warningRulesRequired && visibleEditorModel.warningRules.length > 0 && (
        <>
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h3 className="text-xs font-semibold text-[var(--ink)]">手动警示语</h3>
            <p className="mt-1 text-xs text-[var(--text-subtle)]">按当前启用规则选择字段值，保存后运行合规预检</p>
          </div>
          {!editorModel.warningRulesFresh ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--text-subtle)]">警示语规则快照缺失或已过期</div>
          ) : (
            <div className="divide-y divide-[var(--line)]">
            {visibleEditorModel.warningRules.map((rule) => {
                const key = String(rule.certificateTypeId || rule.certificateTypeCode);
                const assignment = inputs.warnings.find(
                  (warning) => warningAssignmentKey(warning) === key,
                );
                const selectedByField = assignment?.selectedByField || {};
                const warningField = rule.fields[rule.fields.length - 1];
                const selectedRegularIds = new Set(
                  rule.fields.slice(0, -1).flatMap(
                    (field) => selectedByField[field.fieldCode] || [],
                  ),
                );
                const autoMappedIds = new Set(
                  (warningField?.values || []).flatMap((value) =>
                    value.mappingPaths.some((path) =>
                      path.some((valueId) => selectedRegularIds.has(valueId))
                    ) ? [value.id] : []
                  ),
                );
                const conflictIds = new Set(
                  rule.fields.slice(0, -1).flatMap((field) =>
                    field.values.flatMap((value) =>
                      selectedRegularIds.has(value.id) &&
                      value.exclusionFieldValueIds.some(
                        (valueId) => selectedRegularIds.has(valueId),
                      )
                        ? [value.id, ...value.exclusionFieldValueIds]
                        : []
                    )
                  ),
                );
                const validValueIds = new Set(
                  rule.fields.flatMap((field) => field.values.map((value) => value.id)),
                );
                const staleIds = Object.values(selectedByField)
                  .flat()
                  .filter((valueId) => !validValueIds.has(valueId));
                const disabled = !canEdit || saveDraft.isPending || Boolean(uploadingKey);
                const saveWarningSelection = (
                  nextSelectedByField: Record<string, string[]>,
                ) => {
                  const next: ComplianceWarningAssignment = {
                    certificateTypeId: rule.certificateTypeId || null,
                    certificateTypeCode: rule.certificateTypeCode,
                    certificateTypeName: rule.name,
                    selectedByField: nextSelectedByField,
                  };
                  setInputs((current) => ({
                    ...current,
                    warnings: [
                      ...current.warnings.filter(
                        (warning) => warningAssignmentKey(warning) !== key,
                      ),
                      next,
                    ],
                  }));
                  setDirty(true);
                };
                const updateField = (fieldCode: string, valueIds: string[]) => {
                  saveWarningSelection({
                    ...selectedByField,
                    [fieldCode]: valueIds,
                  });
                };
                return (
                  <div className="px-4 py-4" key={rule.certificateTypeCode}>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm font-medium text-[var(--ink)]">{rule.name}</strong>
                      <span className="status-badge">草稿编辑</span>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      {rule.fields.map((field) => {
                        const selected = new Set(selectedByField[field.fieldCode] || []);
                        const isWarningField = field.fieldCode === warningField?.fieldCode;
                        if (field.fieldType === 1 && !isWarningField) {
                          const selectedId = Array.from(selected)[0] || "";
                          return (
                            <label className="min-w-0" key={field.fieldCode}>
                              <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">{field.name}</span>
                              <select
                                className="field px-2.5"
                                disabled={disabled}
                                onChange={(event) => updateField(
                                  field.fieldCode,
                                  event.target.value ? [event.target.value] : [],
                                )}
                                value={selectedId}
                              >
                                <option value="">请选择</option>
                                {selectedId && !field.values.some((value) => value.id === selectedId) && (
                                  <option value={selectedId}>{selectedId}（已失效）</option>
                                )}
                                {field.values.map((value) => (
                                  <option key={value.id} value={value.id}>{value.label}</option>
                                ))}
                              </select>
                            </label>
                          );
                        }
                        return (
                          <fieldset className="min-w-0" key={field.fieldCode}>
                            <legend className="mb-1.5 text-xs font-medium text-[var(--ink)]">{field.name}</legend>
                            <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-[var(--line)] px-3 py-2">
                              {field.values.map((value) => {
                                const autoMapped = isWarningField && autoMappedIds.has(value.id);
                                const checked = selected.has(value.id) || autoMapped;
                                return (
                                  <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]" key={value.id}>
                                    <input
                                      checked={checked}
                                      disabled={disabled || autoMapped}
                                      onChange={(event) => {
                                        const next = new Set(selected);
                                        if (event.target.checked) next.add(value.id);
                                        else next.delete(value.id);
                                        updateField(field.fieldCode, Array.from(next));
                                      }}
                                      type="checkbox"
                                    />
                                    <span>
                                      {value.label}
                                      {autoMapped ? "（自动匹配）" : ""}
                                    </span>
                                  </label>
                                );
                              })}
                              {!field.values.length && (
                                <span className="text-xs text-[var(--text-subtle)]">当前字段没有启用选项</span>
                              )}
                            </div>
                          </fieldset>
                        );
                      })}
                    </div>
                    {conflictIds.size > 0 && (
                      <p className="mt-2 text-xs text-[var(--danger)]">当前选择包含互斥字段值，请保留其中一项。</p>
                    )}
                    {staleIds.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <p className="text-xs text-[var(--danger)]">草稿包含已停用或不存在的警示语值。</p>
                        {canEdit && (
                          <Button
                            disabled={disabled}
                            onClick={() => saveWarningSelection(
                              Object.fromEntries(rule.fields.map((field) => {
                                const enabledIds = new Set(
                                  field.values.map((value) => value.id),
                                );
                                return [
                                  field.fieldCode,
                                  (selectedByField[field.fieldCode] || []).filter(
                                    (valueId) => enabledIds.has(valueId),
                                  ),
                                ];
                              })),
                            )}
                            size="sm"
                            variant="ghost"
                          >
                            移除失效值
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {visibleEditorModel.platformCapabilities.length > 0 && (
        <>
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h3 className="text-xs font-semibold text-[var(--ink)]">官方合规字段</h3>
            <p className="mt-1 text-xs text-[var(--text-subtle)]">要求与审核状态已同步，当前仅支持查看</p>
          </div>
          <div className="divide-y divide-[var(--line)]">
            {visibleEditorModel.platformCapabilities.map((capability) => (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" key={capability.capabilityKey}>
                <div className="min-w-0">
                  <strong className="text-sm font-medium text-[var(--ink)]">{capability.certificateTypeName}</strong>
                  <p className="mt-1 text-xs text-[var(--text-subtle)]">
                    {capability.isRequired === 1 ? "必需" : capability.isRequired === 10 ? "规则确认中" : "非必需"}
                    {capability.reviewState !== null ? ` · ${reviewStateLabels[capability.reviewState] || "状态未知"}` : ""}
                  </p>
                </div>
                <span className="status-badge">仅查看</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="border-b border-[var(--line)] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold text-[var(--ink)]">实拍图处理</h3>
            <p className="mt-1 text-xs text-[var(--text-subtle)]">按官方接口分为商品本体、商品包装两组；每组可一次选择多张图片，上传后直接显示缩略图。</p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!rulesFresh || saveDraft.isPending || Boolean(uploadingKey) || (!dirty && Boolean(draft))}
                onClick={() => saveDraft.mutate()}
                size="sm"
                variant="outline"
              >
                <Save size={15} />
                {saveDraft.isPending ? "正在保存" : "保存实拍图资料"}
              </Button>
              {workspaceCapabilities?.photoSubmit && <Button
                  disabled={
                    !rulesFresh ||
                    !hasRequiredPhotoGroup ||
                    dirty ||
                    !draft ||
                    missingRequiredPhoto ||
                    Boolean(uploadingKey) ||
                    submitPhotos.isPending
                  }
                  onClick={() => {
                    if (window.confirm(`确认把当前 SKC ${skc} 已保存的实拍图上传并绑定到 SHEIN？\n\n包装图只进入 packageLableList，商品本体图只进入 bodyLableList。此操作不承诺删除平台历史图。`)) {
                      setPhotoSubmitResult(null);
                      submitPhotos.mutate();
                    }
                  }}
                  size="sm"
                  title={
                    !rulesFresh
                      ? "请先刷新当前 SKC 的有效合规规则"
                      : !hasRequiredPhotoGroup
                        ? "当前没有失败或待补充的实拍图分组"
                      : missingRequiredPhoto
                        ? "请先补齐失败分组所需的实拍图"
                      : dirty
                        ? "请先保存当前实拍图资料"
                      : "上传图片并绑定当前 SKC"
                  }
                  variant="outline"
                >
                  {submitPhotos.isPending ? "正在提交" : "提交实拍图审核"}
                </Button>}
              {workspaceCapabilities?.photoBindingDiagnostic && <Button
                  disabled={testPhotoBinding.isPending}
                  onClick={() => testPhotoBinding.mutate()}
                  size="sm"
                  title="生成并检查当前 SKC 的提交字段，不调用 SHEIN"
                  variant="ghost"
                >
                  {testPhotoBinding.isPending ? "正在生成" : "生成提交预览"}
                </Button>}
            </div>
          )}
        </div>
        <div className="notice notice-warning mt-3" role="status">
          <AlertCircle size={16} />
          <span>{isCloudCached && !workspaceCapabilities?.photoSubmit
            ? "当前支持保存草稿、上传素材和合规预检；SHEIN 实拍图提交暂不可用。"
            : "保存只写入当前工作台资料；点击“提交实拍图审核”才会真实上传并绑定。官方接口未提供删除字段，也未承诺覆盖历史图。"}</span>
        </div>
        {rulesFresh && missingRequiredPhoto && (
          <div className="notice notice-error mt-3" role="alert">
            <AlertCircle size={16} />
            <span>
              当前只提交失败/待补充分组；
              {requiredBodyPhoto && !hasBodyPhoto ? "请上传商品本体实拍图。" : ""}
              {requiredPackagePhoto && !hasPackagePhoto
                ? "请上传商品包装实拍图。"
                : ""}
            </span>
          </div>
        )}
        {submitPhotos.error && (
          <div className="notice notice-error mt-3" role="alert">
            <AlertCircle size={16} />
            <span>{submitPhotos.error instanceof Error ? submitPhotos.error.message : "实拍图提交失败"}</span>
          </div>
        )}
        {photoSubmitResult && (
          <div className="notice notice-success mt-3" role="status">
            <div>
              <strong className="block">SHEIN 已接收当前 SKC 的实拍图绑定请求</strong>
              <p className="mt-1 text-xs">
                成功任务 {photoSubmitResult.successCount} 个
                {photoSubmitResult.traceId ? ` · traceId ${photoSubmitResult.traceId}` : ""}
                {photoSubmitResult.readbackWarning ? ` · 状态同步提示：${photoSubmitResult.readbackWarning}` : " · 已启动状态回读"}
              </p>
            </div>
          </div>
        )}
        {onApplyPhotoTemplate && (
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              aria-label="选择实拍图模板"
              className="field min-w-56 px-2.5"
              disabled={photoTemplateApplying}
              onChange={(event) => onSelectedPhotoTemplateId?.(event.target.value)}
              value={selectedPhotoTemplateId || ""}
            >
              <option value="">选择实拍图模板</option>
              {(photoTemplates || []).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            <Button
              disabled={!selectedPhotoTemplateId || photoTemplateApplying}
              onClick={onApplyPhotoTemplate}
              size="sm"
              variant="outline"
            >
              {photoTemplateApplying ? "正在引用" : "引用实拍图模板"}
            </Button>
          </div>
        )}
        {photoBindDiagnostic && (
          <div className="notice notice-warning mt-3" role="status">
            <AlertCircle size={16} />
            <div className="min-w-0">
              <strong className="block">提交预览已生成</strong>
              <p className="mt-1 text-xs">已按官方字段生成当前 SKC 的提交摘要；本次操作未调用 SHEIN。</p>
              <ul className="mt-2 list-disc pl-5 text-xs">
                {photoBindDiagnostic.checks.map((check) => (
                  <li key={check.officialGroup}>
                    {check.label}（labelGroup={check.labelGroup}）：{check.message}
                    {check.localPhotoCount ? `（已选素材 ${check.localPhotoCount} 张）` : ""}
                    {check.labelIds.length ? `（labelId ${check.labelIds.join("、")}）` : ""}
                  </li>
                ))}
                {photoBindDiagnostic.missingOfficialFields.map((field) => <li key={field}>仍缺少：{field}</li>)}
              </ul>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer font-medium">提交字段详情</summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-white/70 p-3 text-[11px] leading-5 text-[var(--ink)]">
                  {JSON.stringify({
                    externalWrite: photoBindDiagnostic.externalWrite,
                    requestPath: photoBindDiagnostic.requestPath,
                    fields: photoBindDiagnostic.fields,
                  }, null, 2)}
                </pre>
              </details>
            </div>
          </div>
        )}
      </div>
      {photoGroups.length ? (
        <div className="divide-y divide-[var(--line)]">
          {photoGroups.map(([groupType, groupRecords]) => {
            const labelGroup = groupType === "body_photo" ? "1" : "2";
            const groupPhotos = inputs.photos.filter((photo) => photoLabelGroup(photo) === labelGroup);
            const failed = groupRecords.filter((record) => record.status === "失败").length;
            const labels = groupRecords.map((record) => requirementValue(record, "labelName") || record.requirementKey);
            const allResolved = groupRecords.every((record) => isResolvedStatus(record.status));
            const hasFailure = groupRecords.some((record) => record.status === "失败");
            const groupStatus = String(resolvedStatusByType[groupType] || groupRecords[0]?.status || "未同步");
            const groupRequired = groupRecords.some((item) => item.required);
            const label = groupType === "body_photo" ? "商品本体实拍图" : "商品包装实拍图";
            const record = groupRecords[0];
            return (
              <div className="px-4 py-4" key={groupType}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm font-medium text-[var(--ink)]">{label}</strong>
                    {!groupRequired
                      ? <span className="text-xs font-medium text-[var(--text-subtle)]">当前非必传，不会提交</span>
                      : groupStatus === "无需"
                      ? <span className="text-xs font-medium text-[var(--text-subtle)]">当前无需提交，仍可查看和补充</span>
                      : allResolved
                        ? <span className="text-xs font-medium text-[var(--success)]">审核通过，仍可查看和补充</span>
                      : hasFailure && <span className="text-xs font-medium text-[var(--danger)]">{failed} 项失败，需处理</span>}
                  </div>
                  <span className="text-xs text-[var(--text-subtle)]">已选择 {groupPhotos.length}/15 张</span>
                </div>
                <p className="mb-3 truncate text-xs text-[var(--text-subtle)]" title={labels.join("、")}>平台识别内容：{labels.slice(0, 3).join("、")}{labels.length > 3 ? ` 等 ${labels.length} 项` : ""}</p>
                <div className="flex flex-wrap gap-3">
                  {groupPhotos.map((assignment, index) => {
                    const previewUrl = localPhotoPreviewUrl(storeId, assignment);
                    return (
                      <div className="w-36 overflow-hidden rounded-md border border-[var(--line)] bg-white" key={`${assignment.localAssetRef}:${assignment.fileName}:${index}`}>
                        {previewUrl ? (
                          <img
                            alt={`${label}实拍图缩略图 ${index + 1}`}
                            className="aspect-square w-full bg-[var(--surface-muted)] object-cover"
                            loading="lazy"
                            src={previewUrl}
                          />
                        ) : (
                          <div aria-label={`${label}实拍图缩略图 ${index + 1}`} className="flex aspect-square items-center justify-center bg-[var(--surface-muted)] text-[var(--text-subtle)]">
                            <FileImage size={28} />
                          </div>
                        )}
                        <div className="p-2">
                          <p className="truncate text-xs text-[var(--ink)]" title={assignment.fileName}>{assignment.fileName}</p>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="text-[11px] text-[var(--text-subtle)]">{formatBytes(assignment.size)}</span>
                            {canEdit && (
                              <Button aria-label={`移除${label}${index + 1}`} disabled={!rulesFresh || Boolean(uploadingKey)} onClick={() => removePhoto(assignment)} size="icon" title="移除图片" variant="ghost"><Trash2 size={14} /></Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {canEdit && groupPhotos.length < 15 && (
                    <label className={`flex min-h-36 w-36 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--line-strong)] px-3 text-center text-xs font-medium text-[var(--text-muted)] ${!rulesFresh || uploadingKey || saveDraft.isPending ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-[var(--surface-muted)]"}`}>
                      <Upload size={22} />
                      <span>{uploadingKey === groupType ? "上传中" : "添加图片"}</span>
                      <span className="text-[11px] font-normal text-[var(--text-subtle)]">一次选择多张</span>
                      <input
                        accept="image/jpeg,image/png"
                        className="sr-only"
                        disabled={!rulesFresh || Boolean(uploadingKey) || saveDraft.isPending}
                        multiple
                        onChange={(event) => {
                          void uploadPhotos(groupType, record, Array.from(event.target.files || []));
                          event.target.value = "";
                        }}
                        type="file"
                      />
                    </label>
                  )}
                </div>
                {groupType === "body_photo" && (
                  <p className="mt-2 text-xs text-[var(--warning)]">SHEIN 当前只回读平台状态和失败原因，不返回历史图片原图或可删除的图片 ID；新图只有点击“提交实拍图审核”并确认后才会写入 bodyLableList，且不能保证旧图被删除。</p>
                )}
                {groupType === "package_photo" && (
                  <p className="mt-2 text-xs text-[var(--text-subtle)]">可一次选择多张，也可继续追加；每组最多 15 张。保存资料后，点击“提交实拍图审核”并确认才会写入 packageLableList。</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-[var(--text-subtle)]">当前没有待展示的实拍要求；如平台失败原因尚未返回明细，请先刷新合规数据。</div>
      )}
      {workspaceCapabilities?.photoShare && canEdit && inputs.photos.length > 0 && (availableSkcs || []).filter((target) => target.skc !== skc).length > 0 && (
        <div className="border-t border-[var(--line)] px-4 py-4">
          {(() => {
            const candidates = (availableSkcs || []).filter((target) => target.skc !== skc);
            const failedTargets = candidates.filter((target) => [target.packagePhoto, target.bodyPhoto].some((status) => ["失败", "待补充"].includes(String(status))));
            const failedTargetSkcs = new Set(failedTargets.map((target) => target.skc));
            const visibleTargets = showAllShareTargets ? candidates : failedTargets;
            const toggleShareTargets = () => {
              if (showAllShareTargets) {
                setSelectedSkcs((current) => current.filter((item) => failedTargetSkcs.has(item)));
              }
              setShowAllShareTargets((value) => !value);
            };
            return (
              <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-semibold text-[var(--ink)]">实拍图批量复用</h4>
              <p className="mt-1 text-xs text-[var(--text-subtle)]">优先列出实拍失败/待补充的 SKC；复用只保存到当前工作台，不会写入 SHEIN。</p>
            </div>
            <div className="flex items-center gap-2">
              {candidates.length > failedTargets.length && <Button onClick={toggleShareTargets} size="sm" variant="ghost">{showAllShareTargets ? "只看待处理" : `查看全部（${candidates.length}）`}</Button>}
              <Button disabled={!selectedSkcs.length || sharePhotos.isPending} onClick={() => sharePhotos.mutate(selectedSkcs)} size="sm" variant="outline">
                {sharePhotos.isPending ? "正在复用" : `复用到 ${selectedSkcs.length || 0} 个 SKC`}
              </Button>
            </div>
          </div>
          <div className="mt-3 flex max-h-28 flex-wrap gap-x-4 gap-y-2 overflow-auto text-xs text-[var(--text-muted)]">
            {visibleTargets.length > 0 ? visibleTargets.map((target) => (
              <label className="inline-flex items-center gap-1.5" key={target.skc}>
                <input
                  checked={selectedSkcs.includes(target.skc)}
                  onChange={(event) => setSelectedSkcs((current) => event.target.checked ? [...current, target.skc] : current.filter((item) => item !== target.skc))}
                  type="checkbox"
                />
                <span className={target.packagePhoto === "失败" || target.bodyPhoto === "失败" ? "text-[var(--danger)]" : ""}>{target.skc}</span>
              </label>
            )) : <p>当前没有实拍失败或待补充的 SKC</p>}
          </div>
              </>
            );
          })()}
        </div>
      )}

    </section>
  );
}
