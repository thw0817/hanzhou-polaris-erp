import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../../src-v2/features/compliance/ComplianceDetailPage.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src-v2/lib/api.ts", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("../../src-v2/features/compliance/ComplianceDraftEditor.tsx", import.meta.url),
  "utf8",
);

test("compliance detail uses only the official SHEIN report requirement", () => {
  assert.match(pageSource, /SHEIN 官方报告要求/);
  assert.match(pageSource, /唯一依据/);
  assert.match(pageSource, /唯一判定来源/);
  assert.match(pageSource, /等待 SHEIN 返回/);
  assert.doesNotMatch(pageSource, /判定证据/);
  assert.doesNotMatch(pageSource, /RUG_REPORT_TYPE_MISMATCH/);
  assert.match(apiSource, /reportDecision\?:/);
});

test("compliance detail can trigger a scoped official SKC readback", () => {
  assert.match(pageSource, /autoRefreshRef/);
  assert.match(pageSource, /refreshCurrentSkc/);
  assert.match(pageSource, /rulesRefresh\.mutate\(\)/);
  assert.match(apiSource, /compliance-workspace\/\$\{encodeURIComponent\(skc\)\}\/rules\/refresh/);
});

test("compliance detail keeps the official report area visible while SHEIN is still reading", () => {
  assert.match(pageSource, /const reportNeedsAttention = Boolean\(item\)/);
  assert.match(pageSource, /等待 SHEIN 返回 1630\/1631 报告类型/);
  assert.match(pageSource, /上传同类型报告/);
});

test("compliance detail restores the SKC main-image thumbnail", () => {
  assert.match(pageSource, /item\?\.imageUrl \?/);
  assert.match(pageSource, /alt="商品主图"/);
  assert.match(pageSource, /loading="eager"/);
  assert.match(pageSource, /暂无商品主图/);
});

test("compliance photo editor shows only required body and package upload groups", () => {
  assert.match(editorSource, /仅展示 SHEIN 返回的必填合规项/);
  assert.match(editorSource, /records\.filter\(\(record\) => record\.requirementType === type && record\.required\)/);
  assert.doesNotMatch(editorSource, /fallbackKey/);
  assert.match(editorSource, /一次选择多张/);
  assert.match(editorSource, /最多 15 张/);
  assert.match(editorSource, /实拍图缩略图/);
  assert.match(editorSource, /multiple/);
  assert.doesNotMatch(editorSource, />内包装实拍图</);
  assert.doesNotMatch(editorSource, />外包装实拍图</);
  assert.doesNotMatch(editorSource, /一次选择内包装、外包装两张/);
  assert.match(editorSource, /提交实拍图审核/);
  assert.match(editorSource, /packageLableList/);
  assert.match(editorSource, /bodyLableList/);
  assert.match(editorSource, /不承诺删除平台历史图/);
  assert.match(editorSource, /!rulesFresh/);
  assert.match(editorSource, /missingRequiredPhoto/);
  assert.match(editorSource, /const requiredBodyPhoto = photoGroupNeedsSubmission\("body_photo"\)/);
  assert.match(editorSource, /const requiredPackagePhoto = photoGroupNeedsSubmission\("package_photo"\)/);
  assert.match(editorSource, /const hasRequiredPhotoGroup = requiredBodyPhoto \|\| requiredPackagePhoto/);
  assert.match(editorSource, /!hasRequiredPhotoGroup/);
  assert.match(editorSource, /groupStatus === "无需"/);
  assert.match(editorSource, /当前无需提交，仍可查看和补充/);
  assert.match(editorSource, /审核通过，仍可查看和补充/);
  assert.match(editorSource, /const visibleTargets = showAllShareTargets \? candidates : failedTargets/);
  assert.match(editorSource, /当前没有实拍失败或待补充的 SKC/);
  assert.doesNotMatch(editorSource, /showAllShareTargets \|\| !failedTargets\.length \? candidates : failedTargets/);
  assert.doesNotMatch(editorSource, /const requiredBodyPhoto = groupNeedsAttention/);
  assert.match(editorSource, /点击“提交实拍图审核”才会真实上传并绑定/);
  assert.doesNotMatch(editorSource, /photoRecords\.filter/);
});

test("photo binding preview stays available without a fresh rule snapshot", () => {
  assert.match(editorSource, /disabled=\{testPhotoBinding\.isPending\}/);
  assert.doesNotMatch(editorSource, /disabled=\{testPhotoBinding\.isPending \|\| !rulesFresh\}/);
  assert.match(editorSource, /生成并检查当前 SKC 的提交字段，不调用 SHEIN/);
});

test("photo binding preview exposes the submission fields for contract review", () => {
  assert.match(editorSource, /提交字段详情/);
  assert.match(editorSource, /const submissionPhotos = inputs\.photos\.filter/);
  assert.match(editorSource, /photos: submissionPhotos/);
  assert.doesNotMatch(editorSource, /testCompliancePhotoBinding\(storeId, skc, \{ photos: inputs\.photos \}\)/);
  assert.match(editorSource, /photoBindDiagnostic\.requestPath/);
  assert.match(editorSource, /photoBindDiagnostic\.fields/);
  assert.match(editorSource, /photoBindDiagnostic\.externalWrite/);
});

test("per-SKC 1630 and 1631 controls do not claim a local save is a SHEIN upload", () => {
  const certificateSource = readFileSync(
    new URL("../../src-v2/features/compliance/ComplianceCertificateEditor.tsx", import.meta.url),
    "utf8",
  );
  assert.match(certificateSource, /rule\.perSkc \? "选择报告" : "上传文件"/);
  assert.match(certificateSource, /保存资料/);
  assert.match(certificateSource, /保存资料不会提交 SHEIN/);
  assert.doesNotMatch(certificateSource, /rule\.perSkc \? "直接上传"/);
  assert.match(certificateSource, /报告文件和报告日期已从模板带入，无需重复填写/);
  assert.match(editorSource, /certificate\.map_report_template/);
});

test("per-SKC template selectors separate photos from the decided report type", () => {
  assert.match(pageSource, /classifyComplianceTemplateOptions/);
  assert.match(pageSource, /reportType: item\?\.reportDecision\?\.reportType/);
  assert.match(pageSource, /photoTemplates=\{templateOptions\.photoTemplates\}/);
  assert.match(pageSource, /reportTemplates=\{templateOptions\.reportTemplates\}/);
  assert.match(editorSource, /reportTemplates\?: Array/);
  assert.match(editorSource, /reportTemplates=\{reportTemplates\}/);
  assert.doesNotMatch(editorSource, /reportTemplates=\{photoTemplates\}/);
});

test("compliance detail keeps user-action content without exposing technical audit panels", () => {
  assert.match(pageSource, /function needsUserAction\(value\?: string\)/);
  assert.match(pageSource, /\["需修正", "待补充", "失败"\]\.includes/);
  assert.match(pageSource, /const hasActionableSummary = requiredSummaryStatuses\.some\(needsUserAction\)/);
  assert.match(pageSource, /requiredRecords = requirementRecords\.filter\(\(record\) => record\.required === true\)/);
  assert.doesNotMatch(pageSource, /showAuditDetails|显示审计信息|隐藏审计信息/);
  assert.match(pageSource, /\{reportNeedsAttention && <section className="data-panel">/);
  assert.match(pageSource, /\{showEditor && <ComplianceDraftEditor/);
  assert.match(pageSource, /SHEIN 官方报告要求/);
  assert.match(pageSource, /失败原因来自 SHEIN 当前回读/);
  assert.match(pageSource, /当前没有需要修改的项目/);
  assert.match(pageSource, /审核中的资料请等待 SHEIN 结果/);
  assert.doesNotMatch(pageSource, /合规预检记录|草稿预检与发布阻断|规则来源/);
});

test("compliance detail colors user-action, processing and resolved statuses consistently", () => {
  assert.match(pageSource, /function detailStatusClass\(value\?: string\)/);
  assert.match(pageSource, /needsUserAction\(value\).*compliance-status-danger/s);
  assert.match(pageSource, /\["审核中", "待同步"\]\.includes.*compliance-status-warning/s);
  assert.match(pageSource, /\["通过", "无需", "审核成功", "审核通过"\]\.includes.*compliance-status-success/s);
  assert.match(pageSource, /status-badge \$\{detailStatusClass\(value\)\}/);
  assert.match(pageSource, /status-badge \$\{detailStatusClass\(item\.complianceStatus\)\}/);
});
