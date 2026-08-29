import { FileText, Save, Trash2, Upload } from "lucide-react";
import { Button } from "../../components/ui/button";
import type {
  ComplianceCertificateAssignment,
  ComplianceCertificateField,
  ComplianceEditorModel,
} from "../../lib/api";

const unsupportedLabels: Record<string, string> = {
  CERTIFICATE_SCHEMA_STALE: "证书 Schema 缺失或已过期",
  CERTIFICATE_SCHEMA_MISSING: "当前快照没有该证书 Schema",
  CERTIFICATE_SCHEMA_DISABLED: "该证书类型已被 SHEIN 停用",
  CERTIFICATE_TYPE_UNSUPPORTED: "当前开放平台不支持该证书类型",
};

function assignmentKey(assignment: ComplianceCertificateAssignment) {
  return String(assignment.certificateTypeId ?? assignment.certificateTypeCode);
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function CertificateField({
  field,
  value,
  agencies,
  disabled,
  onChange,
}: {
  field: ComplianceCertificateField;
  value: ComplianceCertificateAssignment["fieldValues"][string] | undefined;
  agencies: ComplianceEditorModel["detectionAgencies"];
  disabled: boolean;
  onChange: (value: ComplianceCertificateAssignment["fieldValues"][string]) => void;
}) {
  const fieldLabel = (
    <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">
      {field.name}{field.required && <span className="ml-1 text-[var(--danger)]">*</span>}
      {field.unit && <span className="ml-1 font-normal text-[var(--text-subtle)]">({field.unit})</span>}
    </span>
  );
  if (field.sourceFrom.toUpperCase() === "SRM") {
    const selectedAgency = agencies.find(
      (agency) => agency.id === String(value?.detectionAgencyId || ""),
    );
    return (
      <div className="min-w-0">
        {fieldLabel}
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            className="field px-2.5"
            disabled={disabled}
            onChange={(event) => onChange({
              detectionAgencyId: event.target.value,
              laboratoryId: "",
            })}
            value={value?.detectionAgencyId || ""}
          >
            <option value="">选择检测机构</option>
            {agencies.map((agency) => <option key={agency.id} value={agency.id}>{agency.name}</option>)}
          </select>
          <select
            className="field px-2.5"
            disabled={disabled || !selectedAgency}
            onChange={(event) => onChange({
              detectionAgencyId: selectedAgency?.id || "",
              laboratoryId: event.target.value,
            })}
            value={value?.laboratoryId || ""}
          >
            <option value="">选择实验室</option>
            {(selectedAgency?.laboratories || []).map((laboratory) => (
              <option key={laboratory.id} value={laboratory.id}>{laboratory.name}</option>
            ))}
          </select>
        </div>
      </div>
    );
  }
  if (field.inputType === 1) {
    return (
      <label className="min-w-0">
        {fieldLabel}
        <select
          className="field px-2.5"
          disabled={disabled}
          onChange={(event) => onChange({ valueIds: event.target.value ? [event.target.value] : [] })}
          value={value?.valueIds?.[0] || ""}
        >
          <option value="">请选择</option>
          {field.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
    );
  }
  if (field.inputType === 2) {
    const selected = new Set(value?.valueIds || []);
    return (
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-xs font-medium text-[var(--ink)]">
          {field.name}{field.required && <span className="ml-1 text-[var(--danger)]">*</span>}
        </legend>
        <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-[var(--line)] px-3 py-2">
          {field.options.map((option) => (
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]" key={option.id}>
              <input
                checked={selected.has(option.id)}
                disabled={disabled}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(option.id);
                  else next.delete(option.id);
                  onChange({ valueIds: Array.from(next) });
                }}
                type="checkbox"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if ([3, 4].includes(field.inputType)) {
    return (
      <label className="min-w-0">
        {fieldLabel}
        <input
          className="field px-3"
          disabled={disabled}
          onChange={(event) => onChange({ value: event.target.value })}
          type={field.inputType === 4 ? "date" : "text"}
          value={value?.value || ""}
        />
      </label>
    );
  }
  return <p className="text-xs text-[var(--danger)]">字段类型 {field.inputType} 尚未验证，不能填写。</p>;
}

export function ComplianceCertificateEditor({
  skc,
  model,
  assignments,
  canEdit,
  busyKey,
  saving,
  onChange,
  onUpload,
  directSaving,
  directSavedKey,
  onDirectSave,
  directSubmitting,
  onDirectSubmit,
  reportTemplates,
  selectedReportTemplateId,
  onSelectedReportTemplateId,
  onApplyReportTemplate,
  reportTemplateApplying,
  reportDateInheritedFromTemplate,
}: {
  skc: string;
  model: ComplianceEditorModel;
  assignments: ComplianceCertificateAssignment[];
  canEdit: boolean;
  busyKey: string;
  saving: boolean;
  onChange: (assignments: ComplianceCertificateAssignment[]) => void;
  onUpload: (rule: ComplianceEditorModel["certificates"][number], file?: File) => void;
  directSaving?: boolean;
  directSavedKey?: string;
  onDirectSave?: (rule: ComplianceEditorModel["certificates"][number]) => void;
  directSubmitting?: boolean;
  onDirectSubmit?: (rule: ComplianceEditorModel["certificates"][number]) => void;
  reportTemplates?: Array<{ id: string; name: string }>;
  selectedReportTemplateId?: string;
  onSelectedReportTemplateId?: (value: string) => void;
  onApplyReportTemplate?: () => void;
  reportTemplateApplying?: boolean;
  reportDateInheritedFromTemplate?: boolean;
}) {
  const replaceAssignment = (
    rule: ComplianceEditorModel["certificates"][number],
    update: Partial<ComplianceCertificateAssignment>,
  ) => {
    const current = assignments.find((assignment) => assignmentKey(assignment) === rule.key);
    const next: ComplianceCertificateAssignment = {
      certificateTypeId: rule.certificateTypeId,
      certificateTypeCode: rule.certificateTypeCode,
      certificateTypeName: rule.name,
      certificateDimension: rule.certificateDimension,
      ...(rule.perSkc ? { skc } : {}),
      files: current?.files || [],
      fieldValues: current?.fieldValues || {},
      ...current,
      ...update,
    };
    onChange([
      ...assignments.filter((assignment) => assignmentKey(assignment) !== rule.key),
      next,
    ]);
  };

  return (
    <>
      <div className="border-y border-[var(--line)] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold text-[var(--ink)]">证书资料</h3>
            <p className="mt-1 text-xs text-[var(--text-subtle)]">选择已生效证书，或按当前SKC的有效Schema准备新资料</p>
          </div>
          {onApplyReportTemplate && model.certificates.some((rule) => rule.perSkc) && (
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="选择1630/1631报告模板"
                className="field min-w-52 px-2.5"
                disabled={reportTemplateApplying}
                onChange={(event) => onSelectedReportTemplateId?.(event.target.value)}
                value={selectedReportTemplateId || ""}
              >
                <option value="">选择1630/1631报告模板</option>
                {(reportTemplates || []).map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
              <Button
                disabled={!selectedReportTemplateId || reportTemplateApplying}
                onClick={onApplyReportTemplate}
                size="sm"
                variant="outline"
              >
                {reportTemplateApplying ? "正在引用" : "引用报告模板"}
              </Button>
            </div>
          )}
        </div>
      </div>
      {model.certificates.length ? (
        <div className="divide-y divide-[var(--line)]">
          {model.certificates.map((rule) => {
            const assignment = assignments.find((item) => assignmentKey(item) === rule.key);
            const file = assignment?.files?.[0];
            const disabled = !canEdit || !model.certificateRulesFresh || saving || Boolean(busyKey) || Boolean(directSaving) || Boolean(directSubmitting) || Boolean(reportTemplateApplying);
            const libraryOptions = rule.perSkc ? [] : model.certificateLibrary.filter(
              (certificate) => rule.certificateTypeId != null && certificate.certificateTypeId
                ? String(certificate.certificateTypeId) === String(rule.certificateTypeId)
                : certificate.certificateTypeCode === rule.certificateTypeCode,
            );
            const selectedPool = libraryOptions.find(
              (certificate) => certificate.poolSn === assignment?.poolSn,
            );
            const usingPool = Boolean(selectedPool);
            const stalePool = Boolean(assignment?.poolSn && !selectedPool);
            const showPoolSelector = libraryOptions.length > 0 || Boolean(assignment?.poolSn);
            const poolDisabled = !canEdit || saving || Boolean(busyKey);
            return (
              <div className="px-4 py-4" key={rule.key}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm font-medium text-[var(--ink)]">{rule.name}</strong>
                      {rule.required && <span className="text-xs text-[var(--danger)]">必需</span>}
                      {rule.perSkc && <span className="status-badge">每个 SKC 单独资料</span>}
                    </div>
                    {!rule.supported && !usingPool && (
                      <p className="mt-1 text-xs text-[var(--danger)]">
                        {unsupportedLabels[rule.unsupportedReason || ""] || "当前证书规则不可编辑"}
                      </p>
                    )}
                    {rule.perSkc && (
                      <p className="mt-1 text-xs text-[var(--text-subtle)]">
                        {reportDateInheritedFromTemplate
                          ? "报告文件和报告日期已从模板带入，无需重复填写；提交时只绑定当前SKC。"
                          : "报告文件和报告日期均为必填；提交时只绑定当前SKC。"}
                      </p>
                    )}
                  </div>
                  {rule.supported && canEdit && !usingPool && (
                    <div className="flex items-center gap-2">
                      <label className={`inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--line-strong)] bg-white px-2.5 text-xs font-medium text-[var(--ink)] ${disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-[var(--surface-muted)]"}`}>
                        <Upload size={14} />
                        {busyKey === `cert:${rule.key}` ? "上传中" : file ? "替换文件" : rule.perSkc ? "选择报告" : "上传文件"}
                        <input
                          accept="application/pdf,image/png,image/jpeg"
                          className="sr-only"
                          disabled={disabled}
                          onChange={(event) => {
                            onUpload(rule, event.target.files?.[0]);
                            event.target.value = "";
                          }}
                          type="file"
                        />
                      </label>
                      {file && (
                        <Button
                          aria-label={`移除${rule.name}文件`}
                          disabled={disabled}
                          onClick={() => replaceAssignment(rule, { files: [] })}
                          size="icon"
                          title={`移除${rule.name}文件`}
                          variant="ghost"
                        >
                          <Trash2 size={15} />
                        </Button>
                      )}
                      {rule.perSkc && file && onDirectSave && (
                        <Button
                          disabled={disabled || directSaving}
                          onClick={() => onDirectSave(rule)}
                          size="sm"
                          variant="outline"
                        >
                          <Save size={14} />
                          {directSaving ? "保存中" : directSavedKey === rule.key ? "已保存" : "保存资料"}
                        </Button>
                      )}
                      {rule.perSkc && file && onDirectSubmit && (
                        <Button
                          disabled={disabled || directSubmitting}
                          onClick={() => onDirectSubmit(rule)}
                          size="sm"
                        >
                          <Upload size={14} />
                          {directSubmitting ? "正在提交" : "提交报告审核"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {showPoolSelector && (
                  <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    <label className="min-w-0">
                      <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">已生效证书</span>
                      <select
                        className="field px-2.5"
                        disabled={poolDisabled}
                        onChange={(event) => {
                          const certificate = libraryOptions.find(
                            (option) => option.poolSn === event.target.value,
                          );
                          replaceAssignment(rule, certificate ? {
                            poolSn: certificate.poolSn,
                            status: 2,
                            certificateDimension: certificate.certificateDimension,
                            files: [],
                            fieldValues: {},
                          } : {
                            poolSn: undefined,
                            status: undefined,
                            certificateDimension: rule.certificateDimension,
                          });
                        }}
                        value={assignment?.poolSn || ""}
                      >
                        <option value="">不使用证书库（上传新资料）</option>
                        {stalePool && <option value={assignment?.poolSn}>{assignment?.poolSn}（已失效）</option>}
                        {libraryOptions.map((certificate) => (
                          <option key={certificate.poolSn} value={certificate.poolSn}>
                            {certificate.poolSn} · {certificate.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedPool && (
                      <p className="pb-2 text-xs text-[var(--text-subtle)]">
                        {selectedPool.effectiveTime || "--"} 至 {selectedPool.invalidTime || "--"}
                      </p>
                    )}
                  </div>
                )}
                {stalePool && (
                  <p className="mt-2 text-xs text-[var(--danger)]">
                    {rule.perSkc
                      ? "该证书必须由当前 SKC 单独上传，不能复用证书库。"
                      : "草稿中的证书已不在当前有效证书库中，请重新选择或上传新资料。"}
                  </p>
                )}
                {!usingPool && file && (
                  <p className="mt-3 flex min-w-0 items-center gap-2 text-xs text-[var(--text-muted)]">
                    <FileText className="shrink-0 text-[var(--success)]" size={15} />
                    <span className="truncate" title={file.fileName}>{file.fileName} · {formatBytes(file.size)}</span>
                  </p>
                )}
                {!usingPool && rule.perSkc && file && (
                  <p className="mt-2 text-xs text-[var(--warning)]">
                    保存资料不会提交 SHEIN；引用模板只复制报告素材和日期，提交时仍会为当前 SKC 单独创建证书并绑定。
                  </p>
                )}
                {!usingPool && rule.supported && rule.fields.length > 0 && (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {rule.fields.map((field) => (
                      <CertificateField
                        agencies={model.detectionAgencies}
                        disabled={disabled}
                        field={rule.perSkc && field.inputType === 4
                          ? { ...field, required: true, name: `报告日期（SHEIN字段：${field.name}）` }
                          : field}
                        key={field.id}
                        onChange={(value) => replaceAssignment(rule, {
                          fieldValues: {
                            ...(assignment?.fieldValues || {}),
                            [field.id]: value,
                          },
                        })}
                        value={assignment?.fieldValues?.[field.id]}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-[var(--text-subtle)]">当前 SKC 没有证书要求</div>
      )}
    </>
  );
}
