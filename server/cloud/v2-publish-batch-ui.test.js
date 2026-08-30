import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(
  new URL("../../src-v2/app/App.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../../src-v2/app/AppShell.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL(
    "../../src-v2/features/publishing/PublishBatchesPage.tsx",
    import.meta.url,
  ),
  "utf8",
);
const batchCreateSource = readFileSync(
  new URL("../../src-v2/features/publishing/BatchProductCreatePage.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src-v2/lib/api.ts", import.meta.url),
  "utf8",
);
const serviceSource = readFileSync(
  new URL("./publish-batch-service.js", import.meta.url),
  "utf8",
);
const repositorySource = readFileSync(
  new URL("./publish-execution-repository.js", import.meta.url),
  "utf8",
);
const reviewServiceSource = readFileSync(
  new URL("./product-review-service.js", import.meta.url),
  "utf8",
);
const executorSource = readFileSync(
  new URL("./product-publish-executor.js", import.meta.url),
  "utf8",
);

test("product review center remains store-scoped", () => {
  assert.match(appSource, /PublishBatchesPage/);
  assert.match(appSource, /path="operations\/:storeId\/publishing"/);
  assert.match(shellSource, /suffix: "publishing"/);
  assert.match(shellSource, /label: "商品审核中心"/);
  assert.match(pageSource, /const storeId = currentStore\?\.id \|\| ""/);
  assert.match(pageSource, /api\.productDrafts\(storeId, \{ includePublishHistory: true \}\)/);
  assert.match(pageSource, /api\.productReviews\(storeId\)/);
});

test("batch product creation exposes explicit watermark application", () => {
  assert.match(batchCreateSource, /applyWatermarkToSelected/);
  assert.match(batchCreateSource, /应用水印/);
  assert.match(batchCreateSource, /仅应用到已选商品/);
  assert.match(batchCreateSource, /aria-expanded=\{watermarkExpanded\}/);
  assert.match(batchCreateSource, /watermarking/);
  assert.match(batchCreateSource, /localStorage/);
});

test("review center keeps bulk and single publishing for trusted local drafts", () => {
  assert.match(pageSource, /审核流程商品/);
  assert.match(pageSource, /api\.publishNow\(storeId, draftIds, idempotencyKey\)/);
  assert.match(pageSource, /发布已选/);
  assert.match(pageSource, /确认直接提交/);
  assert.match(pageSource, /selectedReadyIds/);
  assert.match(pageSource, /全选可发布商品/);
  assert.doesNotMatch(pageSource, /运行远程预检/);
  assert.doesNotMatch(pageSource, /确认冻结快照/);
  assert.doesNotMatch(pageSource, /生成执行计划/);
  assert.doesNotMatch(pageSource, /创建商品批次/);
  assert.match(pageSource, /externalEligibleIds/);
  assert.match(pageSource, /canSelectRejected/);
  assert.match(pageSource, /选择后可批量重新发起或归档/);
  assert.doesNotMatch(pageSource, /选择重新发起/);
  assert.match(serviceSource, /allowRejectedPublished/);
  assert.match(serviceSource, /product_review_states/);
});

test("review center is compact, shows thumbnails, rejection reasons, sample data and archive", () => {
  assert.match(pageSource, /商品审核中心/);
  assert.match(pageSource, /主图/);
  assert.match(pageSource, /驳回原因/);
  assert.match(pageSource, /寄样信息/);
  assert.match(pageSource, /重新编辑/);
  assert.match(pageSource, /重新发布/);
  assert.match(pageSource, /归档/);
  assert.match(pageSource, /api\.archiveProductReview\(storeId, reviewKey\)/);
  assert.match(pageSource, /platformListedSkcs/);
  assert.match(pageSource, /state === "已上架"/);
  assert.match(pageSource, /size-12/);
  assert.match(pageSource, /text-xs/);
  assert.doesNotMatch(pageSource, /text-(3xl|4xl|5xl)/);
});

test("review center exposes visible publish progress and store-scoped batch archive", () => {
  assert.match(pageSource, /商品发布进度/);
  assert.match(pageSource, /aria-live="polite"/);
  assert.match(pageSource, /批量归档/);
  assert.match(pageSource, /全选审核记录/);
  assert.match(pageSource, /api\.archiveProductReviews\(storeId, reviewKeys\)/);
  assert.match(apiSource, /archiveProductReviews:/);
  assert.match(reviewServiceSource, /async archiveMany/);
});

test("review center uses one scoped selection per review row", () => {
  assert.match(pageSource, /const toggleAllReviewRows = \(\) =>/);
  assert.match(pageSource, /aria-label=\{`选择 \$\{review\.title\}`\}/);
  assert.match(pageSource, /selectedExternalRelaunchIds/);
  assert.doesNotMatch(pageSource, /aria-label=\{`归档 \$\{review\.title\}`\}/);
});

test("review center scopes publish selection and count to the active workflow tab", () => {
  assert.match(pageSource, /const filteredEligibleIds = useMemo\([\s\S]{0,80}filteredByWorkflowDrafts/);
  assert.match(pageSource, /selectedIds\.filter\(\(id\) => filteredEligibleIds\.includes\(id\)\)/);
  assert.doesNotMatch(pageSource, /const eligibleIds = useMemo/);
});

test("review center uses manual refresh instead of background sync", () => {
  assert.match(pageSource, /手动刷新审核状态/);
  assert.doesNotMatch(pageSource, /visibilitychange/);
  assert.doesNotMatch(pageSource, /setTimeout/);
  assert.doesNotMatch(pageSource, /window\.addEventListener\("focus"/);
});

test("review center clears publish and archive selections on store switch", () => {
  assert.match(pageSource, /Selection is UI state, not server state/);
  assert.match(pageSource, /setSelectedIds\(\[\]\)/);
  assert.match(pageSource, /setSelectedReviewKeys\(\[\]\)/);
  assert.match(pageSource, /\}, \[storeId\]\);/);
});

test("successful relaunch clears the shared review selection", () => {
  assert.match(pageSource, /publishAttemptRef\.current = null;\s*setSelectedIds\(\[\]\);\s*setSelectedReviewKeys\(\[\]\);/);
  assert.match(pageSource, /setRelaunchingDraftIds/);
  assert.match(pageSource, /reviewsQuery\.refetch\(\)/);
});

test("publish rows show compact product identity and main image", () => {
  assert.match(pageSource, /mainAssetIdOf/);
  assert.match(pageSource, /api\.mediaContentUrl\(storeId, assetId\)/);
  assert.match(pageSource, /localMainAssetId/);
  assert.match(pageSource, /reviewImageUrl/);
  assert.match(pageSource, /商品主图/);
  assert.match(pageSource, /function shortTitle/);
  assert.match(pageSource, /function categoryOf/);
  assert.match(pageSource, /path\.slice\(0, 2\)\.join\("-"\)/);
  assert.match(pageSource, /item\?\.taskId/);
  assert.doesNotMatch(pageSource, /商品类型/);
});

test("persisted review thumbnails reuse stable same-origin media URLs", () => {
  assert.doesNotMatch(pageSource, /mediaDownloadTicket\(storeId, assetId\)/);
  assert.match(apiSource, /mediaContentUrl: \(storeId: string, assetId: string\)/);
  assert.match(apiSource, /\/content/);
});

test("price discussions show one readable size row with unit economics and both decisions", () => {
  assert.match(pageSource, /saleAttributeValues/);
  assert.match(pageSource, /平台建议价/);
  assert.match(pageSource, /反算单价/);
  assert.match(pageSource, /每平方米/);
  assert.match(pageSource, /一键接受核价/);
  assert.match(pageSource, /一键拒绝核价/);
  assert.match(pageSource, /variant="danger"/);
  assert.match(pageSource, /api\.rejectPriceDiscussion\(storeId, discussSn\)/);
  assert.doesNotMatch(pageSource, /这里不把总价擅自拆分/);
  assert.match(apiSource, /rejectPriceDiscussion:/);
  assert.match(apiSource, /price-discussions\/\$\{encodeURIComponent\(discussSn\)\}\/reject/);
});

test("SHEIN failures stay attached to the product and link back to editing", () => {
  assert.match(pageSource, /function visibleError/);
  assert.match(pageSource, /商家可用发品额度/);
  assert.doesNotMatch(pageSource, /query-shelf-quota|shelfQuota|上架额度/);
  assert.match(pageSource, /需处理/);
  assert.match(pageSource, /products\/new\?draft=/);
  assert.match(pageSource, /已驳回且关联草稿的商品可直接重新发起/);
  assert.doesNotMatch(pageSource, /refetchInterval: (8000|15000)/);
  assert.match(pageSource, /useQueries/);
  assert.match(pageSource, /spuNames: \[\.\.\.\(targets\.get\(version\) \|\| \[\]\)\]/);
  assert.match(pageSource, /api\.queryProductDocumentState\(storeId, \{/);
  assert.match(pageSource, /已接收，待审核/);
  assert.match(pageSource, /手动刷新审核状态/);
  assert.match(pageSource, /failedReasons/);
  assert.match(pageSource, /审核失败/);
  assert.match(pageSource, /实拍图失败/);
  assert.match(pageSource, /处理实拍图/);
  assert.match(pageSource, /compliancePhotoSubmission\?\.status/);
  assert.match(pageSource, /traceId/);
  assert.match(pageSource, /商品未提交：\$\{blockedReason\}/);
  assert.match(pageSource, /visibleError\(result\.batch\.items\.find/);
});

test("a failed batch item is shown as a publish failure and remains retryable after editing", () => {
  assert.match(pageSource, /if \(item\?\.state === "failed"\) return "发布失败"/);
  assert.match(pageSource, /draft\.status === "ready" && !isSubmissionPending\(item, readback\)/);
});

test("queued and unknown publish jobs are not presented as SHEIN accepted", () => {
  assert.match(pageSource, /function isSubmissionPending/);
  assert.match(pageSource, /if \(item\?\.state === "ready"\) return "排队中，待发送 SHEIN"/);
  assert.match(pageSource, /if \(readback\?\.jobState === "result_unknown"\) return "结果待确认"/);
  assert.match(pageSource, /已进入发布队列 .*等待发送至 SHEIN/);
  assert.match(pageSource, /isSubmissionPending\(item, readback\)/);
  assert.match(pageSource, /发布结果未知，不能确认是否已发送至 SHEIN/);
  assert.match(pageSource, /publishOutcomeUncertain/);
});

test("publish response removes handed-off drafts from the draft-box cache and distinguishes fast acknowledgement stages", () => {
  assert.match(pageSource, /function removeDraftsFromDraftBox/);
  assert.match(pageSource, /product-drafts\", \"draft-box/);
  assert.match(pageSource, /fastAck\?\.stage === "accepted"/);
  assert.match(pageSource, /fastAck\?\.stage === "result_unknown"/);
  assert.match(pageSource, /fastAck\?\.stage === "failed"/);
  assert.match(pageSource, /fastAck\?\.partial/);
  assert.match(pageSource, /已提交 SHEIN/);
  assert.match(pageSource, /发布结果待确认/);
  assert.doesNotMatch(pageSource, /invalidateQueries\(\{ queryKey: \["store", queryScope, storeId, "product-drafts"\] \}\)/);
});

test("submitted or unknown jobs cannot be shown as locally published", () => {
  const statusStart = pageSource.indexOf("function statusLabel(");
  const statusEnd = pageSource.indexOf("type ReviewTab", statusStart);
  const statusSource = pageSource.slice(statusStart, statusEnd);
  assert.ok(statusStart >= 0 && statusEnd > statusStart, "statusLabel must remain a dedicated helper");
  assert.match(statusSource, /readback\?\.jobState === "submitted"/);
  assert.match(statusSource, /readback\?\.jobState === "result_unknown"/);
  assert.ok(
    statusSource.indexOf("已驳回") < statusSource.indexOf("已提交，待回读"),
    "official rejection must resolve before local submitted state",
  );
  assert.ok(
    statusSource.indexOf("已提交，待回读") < statusSource.indexOf("item\?\.state === " + '"completed"'),
    "submitted jobs must resolve before completed/local draft labels",
  );
  assert.doesNotMatch(statusSource, /draft\.status === "published" \|\|/);
});

test("official rejection readback re-enables relaunch selection while transport stays submitted", () => {
  const pendingStart = pageSource.indexOf("function isSubmissionPending");
  const pendingEnd = pageSource.indexOf("function isPublishableDraft", pendingStart);
  const pendingSource = pageSource.slice(pendingStart, pendingEnd);
  assert.match(pendingSource, /documentState\.auditState === 3/);
  assert.ok(
    pendingSource.indexOf("documentState.auditState === 3") < pendingSource.indexOf("jobState || \"\"\)\) return true"),
    "official rejection must be resolved before submitted transport state",
  );
  assert.match(pageSource, /documentState\.auditState === 3[\s\S]{0,140}return \"failed\"/);
});

test("review center maps every official workflow stage to its own tab", () => {
  for (const label of ["待核价", "待寄样", "待审版", "待核样", "待终审"]) {
    assert.match(pageSource, new RegExp(`label === "${label}"`));
  }
});

test("post-submit compliance photo failures do not claim the product is published", () => {
  assert.match(pageSource, /商品提交已接受，但实拍图提交失败/);
  assert.doesNotMatch(pageSource, /商品已发布，但实拍图提交失败/);
  assert.match(executorSource, /商品提交已接受，但合规实拍图未能提交/);
  assert.doesNotMatch(executorSource, /商品已发布，但合规实拍图未能提交/);
});

test("accepted publish jobs refresh the scoped quota snapshot", () => {
  assert.match(pageSource, /queryClient\.invalidateQueries\(\{ queryKey: \["store", queryScope, storeId, "business-dashboard"\]/);
  assert.match(pageSource, /发布成功或进入待确认态后，额度必须立即重新读取/);
});

test("review center caches per user and store and never polls automatically", () => {
  assert.match(pageSource, /const queryScope = `\$\{session\.tenant\.id\}:\$\{session\.user\.id\}`/);
  assert.match(pageSource, /queryKey: \["store", queryScope, storeId, "product-reviews"\]/);
  assert.match(pageSource, /staleTime: 60_000/);
  assert.match(pageSource, /refetchOnWindowFocus: false/);
  assert.match(pageSource, /refetchOnReconnect: false/);
  assert.doesNotMatch(pageSource, /refetchInterval:/);
});

test("review center defers secondary reads and only revalidates on manual refresh", () => {
  assert.match(pageSource, /secondaryQueriesEnabled/);
  assert.match(pageSource, /enabled: Boolean\(storeId && secondaryQueriesEnabled\)/);
  assert.match(pageSource, /const readbackBatches = useMemo/);
  assert.match(pageSource, /\.slice\(0, 20\)/);
  assert.doesNotMatch(pageSource, /revalidatedStoreRef/);
  assert.match(pageSource, /await api\.revalidateProductDrafts\(storeId, staleDraftIds\)/);
  assert.match(pageSource, /loading="lazy" decoding="async"/);
});

test("manual review refresh uses fresh batches and keeps submitted jobs in the readback set", () => {
  assert.match(pageSource, /const REFRESHABLE_READBACK_ITEM_STATES/);
  assert.match(pageSource, /"submitted", "result_unknown"/);
  assert.match(pageSource, /batchesQuery\.refetch\(\)/);
  assert.match(pageSource, /freshBatchReadbacks/);
  assert.match(pageSource, /queryClient\.setQueryData/);
  assert.doesNotMatch(pageSource, /const readbackBatches = useMemo\(\s*\(\) => \(batchesQuery\.data\?\.batches \|\| \[\]\)\s*\.filter\(\(batch\) => batch\.items\.some\(\(item\) => \["queued", "preflighting", "ready"\]/);
});

test("review list and metrics share one status-key projection and metrics ignore search filtering", () => {
  assert.match(pageSource, /function workflowKeyForDraft/);
  assert.match(pageSource, /const activeLocalDraftIds = useMemo/);
  assert.match(pageSource, /const allExternalReviews = useMemo/);
  assert.match(pageSource, /activeLocalDraftIds\.has\(item\.localDraftId\)/);
  assert.match(pageSource, /const reviewMetrics = useMemo/);
  const metricStart = pageSource.indexOf('<p className="text-xs text-[var(--text-muted)]">审核中</p>');
  const metricEnd = pageSource.indexOf('<p className="text-xs text-[var(--text-muted)]">需处理</p>', metricStart);
  const metricSource = pageSource.slice(metricStart, metricEnd);
  assert.ok(metricStart >= 0 && metricEnd > metricStart, "reviewing metric must remain a dedicated block");
  assert.match(metricSource, /reviewMetrics\.reviewing/);
  assert.doesNotMatch(metricSource, /externalReviews\.filter/);
});

test("publish success immediately projects the new batch into the active query cache", () => {
  assert.match(pageSource, /setQueryData<\{\s*batches: PublishBatch\[\]\s*;/);
  assert.match(pageSource, /result\.batch/);
  assert.match(pageSource, /batches\.filter\(\(batch\) => batch\.id !== result\.batch\.id\)/);
});

test("manual review refresh reports partial failures with upstream code and trace instead of failing the whole refresh", () => {
  assert.match(pageSource, /function refreshErrorLabel/);
  assert.match(pageSource, /remoteSuccessCount/);
  assert.match(pageSource, /remoteEmptyCount/);
  assert.match(pageSource, /revalidationSkippedCount/);
  const refreshStart = pageSource.indexOf("const refresh = async () =>");
  const refreshEnd = pageSource.indexOf("const publish = (draftIds", refreshStart);
  const refreshSource = pageSource.slice(refreshStart, refreshEnd);
  assert.match(refreshSource, /reviewsQuery\.refetch\(\)/);
  assert.doesNotMatch(refreshSource, /const staleDraftIds[\s\S]*?\.map\(\(draft\) => draft\.id\)[\s\S]*?\.slice\(0, 20\)/);
  assert.match(pageSource, /partialRefreshMessage/);
  assert.match(pageSource, /traceId/);
  assert.doesNotMatch(pageSource, /if \(remoteFailures\.length \|\| revalidationFailed\) \{\s*const messages/);
});

test("review center uses the server resolution for external tabs, labels and relaunch eligibility", () => {
  assert.match(pageSource, /function externalReviewTab\(item: ProductReviewItem\)/);
  assert.match(pageSource, /item\.resolution\?\.displayLabel/);
  assert.match(pageSource, /externalReviewTab\(review\)/);
  assert.match(pageSource, /review\.resolution\?\.code === "official_rejected"/);
});

test("official rejected drafts stay selectable in the external review list", () => {
  assert.match(pageSource, /function isRejectedExternalReview\(review: ProductReviewItem\)/);
  assert.match(pageSource, /const officialRejectedLocalDraftIds = useMemo/);
  assert.match(pageSource, /officialRejectedLocalDraftIds\.has\(draft\.id\)/);
  assert.match(pageSource, /const canSelectRejected = isRejectedExternalReview\(review\)/);
  const externalFilterStart = pageSource.indexOf("const allExternalReviews = useMemo");
  const externalFilterEnd = pageSource.indexOf("const externalReviews = useMemo", externalFilterStart);
  assert.ok(externalFilterStart >= 0 && externalFilterEnd > externalFilterStart);
  const externalFilterSource = pageSource.slice(externalFilterStart, externalFilterEnd);
  assert.match(
    externalFilterSource,
    /localVersions\.has\(item\.version\)[\s\S]*!isRejectedExternalReview\(item\)/,
  );
  assert.match(
    externalFilterSource,
    /failedDraftIds\.has\(item\.localDraftId\)\s*\n\s*&& !isRejectedExternalReview\(item\)/,
  );
  assert.match(
    externalFilterSource,
    /activeLocalDraftIds\.has\(item\.localDraftId\)\s*\n\s*&& !isRejectedExternalReview\(item\)/,
  );
});

test("navigation warms heavy operational route chunks before click", () => {
  assert.match(shellSource, /const navPrefetchers/);
  assert.match(shellSource, /PublishBatchesPage/);
  assert.match(shellSource, /onMouseEnter=\{\(\) => prefetchNavRoute\(item\.path\)\}/);
});

test("terminal publish jobs show failure details and are retryable", () => {
  assert.match(pageSource, /failed_terminal/);
  assert.match(pageSource, /发布失败/);
  assert.match(pageSource, /readbackError/);
  assert.match(apiSource, /lastError: unknown/);
  assert.match(serviceSource, /lastError: row\.last_error/);
});

test("publish result errors preserve structured code, details and trace across readback", () => {
  assert.match(pageSource, /function parsePublishError/);
  assert.match(pageSource, /publishErrorTraceId/);
  assert.match(pageSource, /readback\?\.lastError/);
  assert.match(pageSource, /publishFailureDetails/);
  assert.match(repositorySource, /job\.last_error/);
  assert.match(repositorySource, /job\.trace_id/);
});

test("publish and refresh failures use actionable preserved error labels", () => {
  assert.match(pageSource, /function actionablePublishMessage/);
  assert.match(pageSource, /refreshErrorLabel\(error\)/);
  assert.match(pageSource, /PRODUCT_PUBLISH_QUEUE_ENQUEUE_FAILED/);
  assert.match(pageSource, /READBACK_STATUS_UNAVAILABLE/);
  assert.match(pageSource, /不要重复发布/);
});

test("terminal publish failures cannot be masked by workflow or price labels", () => {
  const statusStart = pageSource.indexOf("function statusLabel(");
  const statusEnd = pageSource.indexOf("type ReviewTab", statusStart);
  const statusSource = pageSource.slice(statusStart, statusEnd);
  assert.ok(statusStart >= 0 && statusEnd > statusStart, "statusLabel must remain a dedicated helper");
  assert.ok(
    statusSource.indexOf("failed_terminal") < statusSource.indexOf("workflowLabel"),
    "terminal job failure must be resolved before workflow stage",
  );
  assert.doesNotMatch(pageSource, /: workflowLabel\(readback\?\.documentState\.workflowStage\) \|\| baseLabel/);
  assert.doesNotMatch(pageSource, /: workflowLabel\(review\.workflowStage\) \|\| baseLabel/);
  assert.match(pageSource, /baseLabel === "审核通过" && priceDiscussionSkcs\.has/);
  assert.match(pageSource, /function publishProgressState\(/);
  assert.match(pageSource, /publishProgressState\(item, readbackByDraft\.get\(item\.draftId\)\)/);
});

test("local publish failures have their own action category and mask an old rejected review row", () => {
  assert.match(pageSource, /type ReviewTab = [^;]*"needs_action"/);
  assert.match(pageSource, /\{ key: "needs_action", label: "需处理" \}/);
  const mapperStart = pageSource.indexOf("function workflowKeyFromLabel");
  const mapperEnd = pageSource.indexOf("function externalStatusLabel", mapperStart);
  const mapperSource = pageSource.slice(mapperStart, mapperEnd);
  assert.ok(mapperStart >= 0 && mapperEnd > mapperStart, "workflow label mapper must remain a dedicated helper");
  assert.match(mapperSource, /"发布失败"/);
  assert.match(mapperSource, /"发布失败"/);
  assert.match(pageSource, /const failedDraftIds = useMemo/);
  assert.match(pageSource, /failedDraftIds\.has\(item\.localDraftId/);
});

test("rejected external reviews are not double-counted as needs action", () => {
  const metricStart = pageSource.indexOf('<p className="text-xs text-[var(--text-muted)]">需处理</p>');
  const metricEnd = pageSource.indexOf('<p className="text-xs text-[var(--text-muted)]">待核价 / 寄样</p>', metricStart);
  const metricSource = pageSource.slice(metricStart, metricEnd);
  assert.ok(metricStart >= 0 && metricEnd > metricStart, "needs-action metric must remain a dedicated block");
  assert.match(metricSource, /reviewMetrics\.needsAction/);
  assert.doesNotMatch(metricSource, /externalReviews\.filter\(\(item\) => item\.auditStateLabel === "failed"\)/);
});

test("server keeps guarded execution behind the direct publish endpoint", () => {
  assert.match(apiSource, /publishNow:/);
  assert.match(apiSource, /publish-now/);
  assert.match(apiSource, /CONFIRM_SHEIN_PRODUCT_PUBLISH/);
  assert.match(serviceSource, /async publishNow/);
  assert.match(serviceSource, /PRODUCT_PUBLISH_EXECUTION_CONFIRMATION/);
  assert.match(serviceSource, /this\.act\(\{[\s\S]{0,400}action: "execute"/);
  assert.match(serviceSource, /createPublishOutboxEvents/);
  assert.doesNotMatch(serviceSource, /this\.executionQueue\.add/);
  assert.match(serviceSource, /taskId:/);
});
