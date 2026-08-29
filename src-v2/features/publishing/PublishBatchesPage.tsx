import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ChevronRight,
  Image as ImageIcon,
  LoaderCircle,
  PencilLine,
  RefreshCw,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import { OpsMetricStrip, OpsPageHeader, OpsTableShell, OpsToolbar } from "../../components/operations/OperationsPrimitives";
import { OperationsDataTable } from "../../components/operations/OperationsDataTable";
import { useAppContext } from "../../app/AppShell";
import {
  api,
  type BusinessProduct,
  type ProductDraft,
  type ProductReviewItem,
  type PublishBatch,
  type PublishBatchItem,
  type PublishBatchReadbackStatus,
} from "../../lib/api";
import {
  formatDiscussionMoney,
  pricePerSquareMeter,
  skuSizeLabel,
} from "../../lib/price-discussion-contract.js";
import { consumePublishBatchHandoff } from "../../lib/product-draft-publish-handoff-contract.js";
import { formatTime, PublishQuotaNotice } from "../operations/OperationsShared";
import { useBusinessDashboard } from "../operations/use-business-dashboard";

// virtualized operational list: 本地草稿量较大时由 TanStack Table + Virtual 控制 DOM 行数。
const publishingTableColumns = [
  { id: "select", header: "" },
  { id: "image", header: "主图" },
  { id: "product", header: "商品" },
  { id: "status", header: "流程状态" },
  { id: "reason", header: "驳回原因" },
  { id: "sample", header: "寄样信息" },
  { id: "actions", header: "操作" },
] satisfies Array<{ id: string; header: string }>;

const REFRESHABLE_READBACK_ITEM_STATES = [
  "queued",
  "preflighting",
  "ready",
  "submitted",
  "result_unknown",
] as const;
const READBACK_REQUEST_CONCURRENCY = 5;

function refreshErrorLabel(error: unknown) {
  const code = publishErrorCode(error);
  const message = actionablePublishMessage(error, "请求失败");
  const traceId = publishErrorTraceId(error);
  return [
    code && code !== "REQUEST_FAILED" ? code : "",
    message,
    traceId ? `Trace ${traceId}` : "",
  ].filter(Boolean).join(" · ");
}

function isRefreshableReadbackBatch(batch: PublishBatch) {
  return (batch.items || []).some((item) =>
    REFRESHABLE_READBACK_ITEM_STATES.includes(item.state as typeof REFRESHABLE_READBACK_ITEM_STATES[number]),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parsePublishError(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return asRecord(parsed);
    } catch {
      return {};
    }
  }
  return asRecord(value);
}

function publishErrorMessage(value: unknown) {
  const row = parsePublishError(value);
  if (value instanceof Error) return value.message.trim();
  return text(row.message) || (typeof value === "string" ? value.trim() : "");
}

function publishErrorCode(value: unknown) {
  return text(parsePublishError(value).code);
}

function publishErrorTraceId(value: unknown) {
  return text(parsePublishError(value).traceId);
}

function actionablePublishMessage(value: unknown, fallback = "请求失败") {
  const code = publishErrorCode(value);
  const message = publishErrorMessage(value) || fallback;
  if (code === "PRODUCT_PUBLISH_QUEUE_ENQUEUE_FAILED") {
    return "发布任务未入队，尚未调用SHEIN，请稍后重试";
  }
  if (code === "PRODUCT_PUBLISH_EXECUTION_DISABLED") {
    return "SHEIN真实发布执行未启用，请先启用发布执行服务";
  }
  if (code === "READBACK_STATUS_UNAVAILABLE") {
    return "SHEIN审核状态回读服务暂不可用，商品结果不能确认，请勿重复发布";
  }
  if (code === "REQUEST_TIMEOUT" || code === "SERVICE_UNAVAILABLE") {
    return `${message}；商品结果不能确认，请先刷新状态，不要重复发布`;
  }
  if (code === "20100" || /没有可用上架额度|额度为0|额度不足/.test(message)) {
    return "SHEIN拒绝发布：当前店铺可用上架额度为0，请先处理额度后再发布";
  }
  if (/保证金|保证金任务/.test(message)) {
    return "SHEIN拒绝发布：店铺保证金任务未完成，请先处理店铺任务";
  }
  return message;
}

function publishErrorLabel(value: unknown, fallback = "请求失败") {
  const message = actionablePublishMessage(value, fallback);
  const code = publishErrorCode(value);
  return code && code !== "REQUEST_FAILED"
    ? `${message}（错误码：${code}）`
    : message;
}

function titleOf(draft: ProductDraft) {
  const data = asRecord(draft.data);
  return text(data.title) || draft.name || "未命名商品";
}

function categoryOf(draft: ProductDraft) {
  const data = asRecord(draft.data);
  const rawPath = data.categoryPath;
  const path = Array.isArray(rawPath)
    ? rawPath.map(text).filter(Boolean)
    : text(rawPath)
        .split(/[/>]/)
        .map((part) => part.trim())
        .filter(Boolean);
  if (path.length >= 2) return path.slice(0, 2).join("-");
  if (path.length === 1) return path[0];
  return text(data.categoryName) || text(draft.categoryId) || "未设置类目";
}

function mainAssetIdOf(draft: ProductDraft) {
  const data = asRecord(draft.data);
  const assets = asRecord(data.imageAssets);
  const main = Array.isArray(assets.main) ? assets.main : [];
  const first = asRecord(main[0]);
  return text(first.assetId) || text(first.id);
}

function visibleError(item?: PublishBatchItem) {
  const preflight = asRecord(item?.preflight);
  const rawError = preflight.publishError || item?.lastError;
  const raw = publishErrorMessage(rawError);
  if (!raw) return "";
  if (raw.includes("/open-api/goods/query-shelf-quota")) {
    return "历史额度检查记录已失效，请重新发布";
  }
  return publishErrorLabel(rawError, raw);
}

function readbackError(readback?: ReadbackItem) {
  const rawError = readback?.lastError;
  return rawError ? publishErrorLabel(rawError, "发布结果读取失败") : "";
}

type ReadbackItem = PublishBatchReadbackStatus["items"][number];

function auditFailureText(readback?: ReadbackItem) {
  return (readback?.documentState.failedReasons || [])
    .map((reason) => text(reason.content))
    .filter(Boolean);
}

function compliancePhotoFailureText(readback?: ReadbackItem) {
  const submission = readback?.compliancePhotoSubmission;
  if (!submission || submission.status !== "failed") return "";
  return `商品提交已接受，但实拍图提交失败${submission.message ? `：${submission.message}` : "，请重试"}`;
}

function publishFailureDetailsFromError(value: unknown) {
  const error = parsePublishError(value);
  const details = Array.isArray(error.details) ? error.details : [];
  return details.flatMap((detail) => {
    const row = asRecord(detail);
    const location = text(row.location) || "SHEIN字段校验";
    const messages = Array.isArray(row.messages) ? row.messages.map(text).filter(Boolean) : [];
    return messages.map((message) => `${location}：${message}`);
  });
}

function publishFailureDetails(item?: PublishBatchItem) {
  const preflight = asRecord(item?.preflight);
  return publishFailureDetailsFromError(preflight.publishError || item?.lastError);
}

function latestItems(batches: PublishBatch[]) {
  const result = new Map<string, PublishBatchItem>();
  for (const batch of batches) {
    for (const item of batch.items || []) {
      const previous = result.get(item.draftId);
      if (!previous || String(item.updatedAt) > String(previous.updatedAt)) {
        result.set(item.draftId, item);
      }
    }
  }
  return result;
}

function isSubmissionPending(item?: PublishBatchItem, readback?: ReadbackItem) {
  // SHEIN can accept the submission first and return an official rejection
  // later while the transport job remains `submitted`. That audit result is
  // terminal for relaunch purposes and must not leave the row disabled.
  if (readback?.documentState.auditState === 3 || readback?.documentState.auditStateLabel === "failed") return false;
  if (["failed_terminal", "failed_retryable"].includes(readback?.jobState || "")) return false;
  if (["submitted", "result_unknown"].includes(readback?.jobState || "")) return true;
  return ["queued", "preflighting", "ready"].includes(item?.state || "");
}

function isPublishableDraft(draft: ProductDraft, item?: PublishBatchItem, readback?: ReadbackItem) {
  return draft.status === "ready" && !isSubmissionPending(item, readback) && item?.state !== "completed";
}

function publishProgressState(item: PublishBatchItem, readback?: ReadbackItem) {
  if (readback?.documentState.auditState === 3 || readback?.documentState.auditStateLabel === "failed") return "failed";
  if (["failed_terminal", "failed_retryable"].includes(readback?.jobState || "")) return "failed";
  if (readback?.jobState === "result_unknown") return "result_unknown";
  if (readback?.jobState === "submitted") return "submitted";
  if (readback?.jobState === "completed") return "completed";
  return item.state;
}

function isPublishOutcomeUncertain(error: unknown) {
  const row = asRecord(error);
  const code = text(row.code);
  const status = Number(row.status);
  if (["PRODUCT_PUBLISH_QUEUE_ENQUEUE_FAILED", "PRODUCT_PUBLISH_EXECUTION_DISABLED", "PRODUCT_PUBLISH_CONFIRMATION_REQUIRED"].includes(code)) {
    return false;
  }
  return !code || code === "REQUEST_FAILED" || status >= 500;
}

function statusLabel(draft: ProductDraft, item?: PublishBatchItem, readback?: ReadbackItem) {
  // An official SHEIN audit result always outranks the local submission
  // projection. A submitted job can still receive a rejection on the next
  // readback and must not remain in the awaiting-review bucket.
  if (readback?.documentState.auditState === 3 || readback?.documentState.auditStateLabel === "failed") return "已驳回";
  if (["failed_terminal", "failed_retryable"].includes(readback?.jobState || "")) return "发布失败";
  if (readback?.compliancePhotoSubmission?.status === "failed") return "实拍图失败";
  const explicit = workflowLabel(readback?.documentState.workflowStage);
  if (explicit && explicit !== "审核通过") return explicit;
  if (readback?.documentState.auditStateLabel === "pending") return "审核中";
  if (readback?.pendingTooLong) return "回读超时";
  // A local draft may retain a legacy `published` status after a previous
  // attempt. Only use the local submitted/unknown projection when no current
  // official document-state result is available.
  if (readback?.jobState === "result_unknown") return "结果待确认";
  if (readback?.jobState === "submitted") return "已提交，待回读";
  if (item?.state === "completed" || readback?.jobState === "completed") return "已发布";
  if (readback?.documentState.auditStateLabel === "passed") return "审核通过";
  if (item?.state === "queued" || item?.state === "preflighting") return "提交中";
  if (item?.state === "ready") return "排队中，待发送 SHEIN";
  if (item?.state === "failed") return "发布失败";
  if (draft.status === "blocked") return "需处理";
  return draft.status === "ready" ? "待发布" : "待完善";
}

type ReviewTab = "all" | "awaiting_review" | "awaiting_price" | "awaiting_sample" | "awaiting_version_review" | "awaiting_sample_review" | "awaiting_final_review" | "needs_action" | "rejected";

const REVIEW_TABS: Array<{ key: ReviewTab; label: string }> = [
  { key: "all", label: "全部" },
  { key: "awaiting_review", label: "待审核" },
  { key: "awaiting_price", label: "待核价" },
  { key: "awaiting_sample", label: "待寄样" },
  { key: "awaiting_version_review", label: "待审版" },
  { key: "awaiting_sample_review", label: "待核样" },
  { key: "awaiting_final_review", label: "待终审" },
  { key: "needs_action", label: "需处理" },
  { key: "rejected", label: "已驳回" },
];

function workflowLabel(stage: string | null | undefined) {
  return ({
    awaiting_review: "待审核",
    awaiting_price: "待核价",
    awaiting_sample: "待寄样",
    awaiting_version_review: "待审版",
    awaiting_sample_review: "待核样",
    awaiting_final_review: "待终审",
    rejected: "已驳回",
    passed: "审核通过",
  } as Record<string, string>)[stage || ""] || "";
}

function workflowKeyFromLabel(label: string): ReviewTab | null {
  if (["已驳回", "审核失败"].includes(label)) return "rejected";
  if (["发布失败", "实拍图失败", "需处理", "接收失败", "回读超时", "结果待确认"].includes(label)) return "needs_action";
  if (["提交中", "排队中，待发送 SHEIN", "已提交，待回读", "已提交，待审核", "审核中", "已接收，待审核"].includes(label)) return "awaiting_review";
  if (label === "待核价") return "awaiting_price";
  if (label === "待寄样") return "awaiting_sample";
  if (label === "待审版") return "awaiting_version_review";
  if (label === "待核样") return "awaiting_sample_review";
  if (label === "待终审") return "awaiting_final_review";
  return null;
}

function workflowKeyForDraft(
  draft: ProductDraft,
  item: PublishBatchItem | undefined,
  readback: ReadbackItem | undefined,
  priceDiscussionSkcs: Set<string>,
): ReviewTab | null {
  const primarySkc = readback?.skcNames[0] || "";
  const label = statusLabel(draft, item, readback);
  if (label === "审核通过" && priceDiscussionSkcs.has(primarySkc)) {
    return "awaiting_price";
  }
  return workflowKeyFromLabel(label);
}

function reviewIdentityForDraft(draftId: string) {
  return `draft:${draftId}`;
}

function reviewIdentityForExternal(review: ProductReviewItem) {
  return review.localDraftId
    ? reviewIdentityForDraft(review.localDraftId)
    : `review:${review.reviewKey}`;
}

function isRejectedExternalReview(review: ProductReviewItem) {
  return review.resolution?.code === "official_rejected"
    || review.workflowStage === "rejected"
    || review.auditState === 3
    || review.auditStateLabel === "failed";
}

function externalReviewTab(item: ProductReviewItem): ReviewTab | null {
  return item.resolution?.tab || workflowKeyFromLabel(externalStatusLabel(item));
}

function externalStatusLabel(item: ProductReviewItem) {
  if (item.resolution?.displayLabel) return item.resolution.displayLabel;
  // An official SHEIN audit result always outranks a local publish/readback
  // hint. Otherwise a delayed worker flag can mask a real rejection and place
  // the SKC in 待审核 until the next refresh.
  if (item.auditState === 3 || ["failed", "rejected", "reject", "审核失败", "驳回", "已驳回"].includes(item.auditStateLabel.toLowerCase())) return "已驳回";
  const explicit = workflowLabel(item.workflowStage);
  if (explicit) return explicit;
  if (item.submissionState === "awaiting_readback") return "已提交，待审核";
  if (item.reviewStage === "received" && item.receiveStatus === "failed") return "接收失败";
  if (item.reviewStage === "received" && item.receiveStatus === "accepted") return "已接收，待审核";
  if (item.auditStateLabel === "failed") return "审核失败";
  if (item.auditStateLabel === "pending") return "审核中";
  if (item.auditStateLabel === "passed") return "审核通过";
  if (item.auditStateLabel === "withdrawn") return "已撤回";
  return "待同步";
}

function sampleInfoText(sample?: BusinessProduct["sampleInfo"] | ProductReviewItem["sample"] | null) {
  if (!sample) return "暂无官方寄样信息";
  const parts = [];
  if (String(sample.reserveSampleFlag) === "1") parts.push("需留样");
  if (String(sample.reserveSampleFlag) === "2") parts.push("无需留样");
  if (sample.sampleCode) parts.push(`样品码 ${sample.sampleCode}`);
  if (sample.sampleJudgeType !== null && sample.sampleJudgeType !== undefined) {
    parts.push(`审版类型 ${sample.sampleJudgeType}`);
  }
  return parts.join(" · ") || "SHEIN 已返回样品字段";
}

function businessSample(product?: BusinessProduct) {
  return product?.sampleInfo || null;
}

function statusClass(label: string) {
  if (label === "已发布" || label === "审核通过") {
    return "bg-[var(--success-soft)] text-[var(--success)]";
  }
  if (["需处理", "发布失败", "审核失败", "接收失败", "实拍图失败"].includes(label)) return "bg-[var(--danger-soft)] text-[var(--danger)]";
  if (label === "回读超时") return "bg-[var(--warning-soft)] text-[var(--warning)]";
  if (["提交中", "排队中，待发送 SHEIN", "已提交，待回读", "已提交，待审核", "审核中", "已接收，待审核", "结果待确认", "待核价", "寄样"].includes(label)) return "bg-[var(--warning-soft)] text-[var(--warning)]";
  return "bg-[var(--surface-muted)] text-[var(--text-muted)]";
}

function shortTitle(value: string) {
  return value.length > 48 ? `${value.slice(0, 48)}…` : value;
}

function removeDraftsFromDraftBox(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: readonly unknown[],
  draftIds: string[],
) {
  const ids = new Set(draftIds.map((draftId) => text(draftId)).filter(Boolean));
  if (!ids.size) return;
  queryClient.setQueryData<{
    drafts: ProductDraft[];
    count: number;
    quota?: unknown;
  }>(queryKey, (current) => {
    if (!current) return current;
    const drafts = current.drafts.filter((draft) => !ids.has(draft.id));
    return {
      ...current,
      drafts,
      count: Math.max(0, Number(current.count || current.drafts.length) - (current.drafts.length - drafts.length)),
    };
  });
}

export function PublishBatchesPage() {
  const { currentStore, session } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const storeId = currentStore?.id || "";
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [publishOutcomeUncertain, setPublishOutcomeUncertain] = useState(false);
  const [publishQueued, setPublishQueued] = useState(false);
  const [relaunchingDraftIds, setRelaunchingDraftIds] = useState<string[]>([]);
  const relaunchStartedAtRef = useRef(new Map<string, number>());
  const publishAttemptRef = useRef<{ draftKey: string; idempotencyKey: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Keep the first route transition responsive: drafts/reviews render the
  // workflow shell first, while metrics and batch/readback data are fetched
  // during an idle window instead of creating a request waterfall on entry.
  // Secondary data may load on entry, but it never refreshes in the
  // background. Official SHEIN status is still read only by the manual
  // refresh action below.
  const [secondaryQueriesEnabled, setSecondaryQueriesEnabled] = useState(true);
  const [reviewTab, setReviewTab] = useState<ReviewTab>("all");
  const [selectedReviewKeys, setSelectedReviewKeys] = useState<string[]>([]);

  // Selection is UI state, not server state. Never carry a draft/review
  // selection across stores: the publish endpoint is correctly store-scoped,
  // so stale selections would otherwise look like a failed relaunch in the
  // newly selected store.
  useEffect(() => {
    setSelectedIds([]);
    setSelectedReviewKeys([]);
    setFeedback("");
    setRefreshError("");
    setPublishOutcomeUncertain(false);
    setPublishQueued(false);
    relaunchStartedAtRef.current.clear();
    setRelaunchingDraftIds([]);
  }, [storeId]);

  const draftsQuery = useQuery({
    queryKey: ["store", queryScope, storeId, "product-drafts"],
    queryFn: () => api.productDrafts(storeId, { includePublishHistory: true }),
    enabled: Boolean(storeId),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
  const aiTitleCapability = useQuery({
    queryKey: ["store", queryScope, storeId, "ai-title-capability"],
    queryFn: () => api.aiTitleCapability(storeId),
    enabled: Boolean(storeId),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
  const batchesQuery = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-batches"],
    queryFn: () => api.publishBatches(storeId),
    enabled: Boolean(storeId && secondaryQueriesEnabled),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
  const priceQuery = useQuery({
    queryKey: ["store", queryScope, storeId, "price-discussions"],
    queryFn: () => api.priceDiscussions(storeId),
    enabled: Boolean(storeId && secondaryQueriesEnabled),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
  const reviewsQuery = useQuery({
    queryKey: ["store", queryScope, storeId, "product-reviews"],
    queryFn: () => api.productReviews(storeId),
    enabled: Boolean(storeId),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
  const businessQuery = useBusinessDashboard(storeId);
  const businessRefreshing = businessQuery.refresh.isPending;
  const readbackBatches = useMemo(
    () => (batchesQuery.data?.batches || [])
      // Keep the mounted readback query set bounded. The explicit manual
      // refresh below still reads every fresh refreshable batch.
      .filter(isRefreshableReadbackBatch)
      .slice(0, 20),
    [batchesQuery.data?.batches],
  );
  const readbackQueries = useQueries({
    queries: readbackBatches.map((batch) => ({
      queryKey: ["store", queryScope, storeId, "publish-readback", batch.id],
      queryFn: () => api.publishBatchReadbackStatus(storeId, batch.id),
      enabled: Boolean(storeId && secondaryQueriesEnabled && batch.id),
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
    })),
  });

  const drafts = draftsQuery.data?.drafts || [];

  useEffect(() => {
    if (!draftsQuery.isSuccess || !location.state) return;
    const handoff = consumePublishBatchHandoff({
      state: location.state,
      drafts,
      storeId,
    });
    if (handoff.accepted) {
      setSelectedIds(handoff.readyDraftIds);
      setFeedback(handoff.readyDraftIds.length
        ? `已带入 ${handoff.readyDraftIds.length} 个可发布商品${handoff.rejectedCount ? `；${handoff.rejectedCount} 个仍需完善` : ""}`
        : "本次保存的商品仍需完善，请查看对应阻断原因");
    }
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [drafts, draftsQuery.isSuccess, location.pathname, location.search, location.state, navigate, storeId]);

  const itemByDraft = useMemo(
    () => latestItems(batchesQuery.data?.batches || []),
    [batchesQuery.data?.batches],
  );
  const readbackByDraft = useMemo(() => {
    const result = new Map<string, ReadbackItem>();
    for (const query of readbackQueries) {
      for (const item of query.data?.items || []) {
        if (item.draftId) result.set(item.draftId, item);
      }
    }
    return result;
  }, [readbackQueries]);
  const failedDraftIds = useMemo(
    () => new Set(
      Array.from(itemByDraft.entries())
        .filter(([draftId, item]) => item.state === "failed" || ["failed_terminal", "failed_retryable"].includes(readbackByDraft.get(draftId)?.jobState || ""))
        .map(([draftId]) => draftId),
    ),
    [itemByDraft, readbackByDraft],
  );
  const platformProducts = businessQuery.data?.snapshot?.products || [];
  const platformListedSkcs = useMemo(
    () => new Set(platformProducts
      .filter((product) => product.state === "已上架")
      .map((product) => text(product.skc))
      .filter(Boolean)),
    [platformProducts],
  );
  const platformProductBySkc = useMemo(
    () => new Map(platformProducts
      .map((product) => [text(product.skc), product] as const)
      .filter(([skc]) => Boolean(skc))),
    [platformProducts],
  );
  const archivedKeys = useMemo(
    () => new Set(reviewsQuery.data?.archivedKeys || []),
    [reviewsQuery.data?.archivedKeys],
  );
  const priceDiscussionSkcs = useMemo(
    () => new Set((priceQuery.data?.discussions || []).map((item) => item.skcName).filter(Boolean)),
    [priceQuery.data?.discussions],
  );
  const localVersions = useMemo(
    () => new Set(Array.from(readbackByDraft.values()).map((item) => text(item.version)).filter(Boolean)),
    [readbackByDraft],
  );
  const officialRejectedLocalDraftIds = useMemo(
    () => new Set(
      (reviewsQuery.data?.items || [])
        .filter((review) => Boolean(review.localDraftId) && isRejectedExternalReview(review))
        .map((review) => review.localDraftId as string),
    ),
    [reviewsQuery.data?.items],
  );
  const visibleDrafts = useMemo(() => drafts.filter((draft) => {
    const item = itemByDraft.get(draft.id);
    const readback = readbackByDraft.get(draft.id);
    if (archivedKeys.has(`draft:${draft.id}`)) return false;
    if (officialRejectedLocalDraftIds.has(draft.id)) return false;
    if (readback?.skcNames.some((skc) => platformListedSkcs.has(skc))) return false;
    return draft.status !== "draft" || Boolean(item);
  }), [archivedKeys, drafts, itemByDraft, officialRejectedLocalDraftIds, platformListedSkcs, readbackByDraft]);
  const filteredDrafts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return visibleDrafts.filter((draft) => {
      if (!query) return true;
      const readback = readbackByDraft.get(draft.id);
      return [titleOf(draft), categoryOf(draft), draft.id, ...(readback?.skcNames || [])]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [readbackByDraft, search, visibleDrafts]);
  const activeLocalDraftIds = useMemo(
    () => new Set(
      visibleDrafts
        .filter((draft) => itemByDraft.has(draft.id) || readbackByDraft.has(draft.id))
        .map((draft) => draft.id),
    ),
    [itemByDraft, readbackByDraft, visibleDrafts],
  );
  const allExternalReviews = useMemo(() => (reviewsQuery.data?.items || []).filter((item) => {
      if (item.localDraftId && relaunchingDraftIds.includes(item.localDraftId)) return false;
      if (
        item.localDraftId
        && failedDraftIds.has(item.localDraftId)
        && !isRejectedExternalReview(item)
      ) return false;
      if (
        item.localDraftId
        && activeLocalDraftIds.has(item.localDraftId)
        && !isRejectedExternalReview(item)
      ) return false;
      if (
        item.version
        && localVersions.has(item.version)
        && !isRejectedExternalReview(item)
      ) return false;
      return true;
    }), [activeLocalDraftIds, failedDraftIds, localVersions, relaunchingDraftIds, reviewsQuery.data?.items]);
  const externalReviews = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allExternalReviews.filter((item) => {
      if (!query) return true;
      return [item.title, item.skcName, item.spuName, item.documentSn, item.version]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [allExternalReviews, search]);
  const reviewByDraftId = useMemo(
    () => new Map((reviewsQuery.data?.items || []).filter((review) => review.localDraftId).map((review) => [review.localDraftId as string, review])),
    [reviewsQuery.data?.items],
  );
  useEffect(() => {
    if (!relaunchingDraftIds.length) return;
    const resolved = relaunchingDraftIds.filter((draftId) => {
      const startedAt = relaunchStartedAtRef.current.get(draftId);
      const review = reviewByDraftId.get(draftId);
      if (!startedAt || !review?.currentAttempt) return true;
      const attemptTime = Date.parse(String(
        review.attempt?.updatedAt || review.updatedAt || "",
      ));
      return !Number.isFinite(attemptTime) || attemptTime < startedAt - 5_000;
    });
    if (resolved.length === relaunchingDraftIds.length) return;
    resolved.forEach((draftId) => relaunchStartedAtRef.current.delete(draftId));
    setRelaunchingDraftIds(resolved);
  }, [relaunchingDraftIds, reviewByDraftId]);
  const matchesTab = (key: ReviewTab) => reviewTab === "all" || key === reviewTab;
  const filteredByWorkflowDrafts = useMemo(() => filteredDrafts.filter((draft) => {
    const item = itemByDraft.get(draft.id);
    const readback = readbackByDraft.get(draft.id);
    const key = workflowKeyForDraft(
      draft,
      item,
      readback,
      priceDiscussionSkcs,
    ) || "all";
    return matchesTab(key);
  }), [filteredDrafts, itemByDraft, priceDiscussionSkcs, readbackByDraft, reviewTab]);
  const filteredExternalReviews = useMemo(() => externalReviews.filter((review) => {
    // Price discussions are shown in their own panel. They must not rewrite
    // the official SHEIN workflow stage of an external review record.
    const key = externalReviewTab(review) || "all";
    return matchesTab(key);
  }), [externalReviews, priceDiscussionSkcs, reviewTab]);
  const filteredEligibleIds = useMemo(
    () => filteredByWorkflowDrafts
      .filter((draft) => isPublishableDraft(draft, itemByDraft.get(draft.id), readbackByDraft.get(draft.id)))
      .map((draft) => draft.id),
    [filteredByWorkflowDrafts, itemByDraft, readbackByDraft],
  );
  const externalEligibleIds = useMemo(
    // Rejected products may have a published local draft that is intentionally
    // hidden from the normal draft list. The review API is the source of truth
    // for the scoped relaunch link; the server still validates tenant/store and
    // the rejected review state before accepting the batch.
    () => filteredExternalReviews
      .filter((review) => (review.resolution?.code === "official_rejected" || externalReviewTab(review) === "rejected") && review.canRelaunch && review.localDraftId)
      .map((review) => review.localDraftId as string),
    [filteredExternalReviews],
  );
  const selectedExternalRelaunchIds = useMemo(
    () => filteredExternalReviews
      .filter((review) => selectedReviewKeys.includes(review.reviewKey) && externalEligibleIds.includes(review.localDraftId || ""))
      .map((review) => review.localDraftId as string),
    [externalEligibleIds, filteredExternalReviews, selectedReviewKeys],
  );
  const selectedReadyIds = Array.from(new Set([
    ...selectedIds.filter((id) => filteredEligibleIds.includes(id)),
    ...selectedExternalRelaunchIds,
  ]));
  const mainAssetIds = useMemo(
    () => Array.from(new Set([
      ...filteredDrafts.map(mainAssetIdOf),
      ...filteredExternalReviews.map((review) => text(review.localMainAssetId)),
    ].filter(Boolean))),
    [filteredDrafts, filteredExternalReviews],
  );
  const thumbnailKey = useMemo(() => [...mainAssetIds].sort(), [mainAssetIds]);
  const thumbnailsQuery = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-thumbnails", thumbnailKey],
    queryFn: () => Object.fromEntries(
      mainAssetIds.map((assetId) => [assetId, api.mediaContentUrl(storeId, assetId)]),
    ),
    enabled: Boolean(storeId && mainAssetIds.length),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const publishMutation = useMutation({
    mutationFn: ({ draftIds, idempotencyKey }: { draftIds: string[]; idempotencyKey: string }) =>
      api.publishNow(storeId, draftIds, idempotencyKey),
    onSuccess: (result) => {
      publishAttemptRef.current = null;
      setSelectedIds([]);
      setSelectedReviewKeys([]);
      setRefreshError("");
      setPublishOutcomeUncertain(false);
      queryClient.setQueryData<{
        batches: PublishBatch[];
        count: number;
        publishingEnabled: boolean;
      }>(["store", queryScope, storeId, "publish-batches"], (current) => {
        if (!current) return current;
        const batches = [
          result.batch,
          ...current.batches.filter((batch) => batch.id !== result.batch.id),
        ];
        return { ...current, batches, count: batches.length };
      });
      const fastAck = result.fastAck;
      const handoffDraftIds = fastAck?.handoffDraftIds || (
        result.executionStage === "queued" || result.executionQueued
          ? result.batch.items.map((item) => item.draftId)
          : []
      );
      removeDraftsFromDraftBox(
        queryClient,
        ["store", queryScope, storeId, "product-drafts", "draft-box"],
        handoffDraftIds,
      );
      if (fastAck?.stage === "accepted") {
        setPublishQueued(false);
        setFeedback(fastAck.partial
          ? `部分商品已提交 SHEIN：已接收 ${fastAck.acceptedDraftIds.length} 个，仍有 ${fastAck.failedDraftIds.length + fastAck.uncertainDraftIds.length} 个需要处理；请查看每行状态`
          : `已提交 SHEIN ${fastAck.acceptedDraftIds.length || result.batch.itemCount} 个商品，等待审核状态回读`);
      } else if (fastAck?.stage === "result_unknown") {
        setPublishQueued(false);
        setPublishOutcomeUncertain(true);
        setFeedback(fastAck.readbackError
          ? "发布请求已交接，但结果回读暂不可用；请点击“手动刷新审核状态”，不要重复发布。"
          : "发布结果待确认；请点击“手动刷新审核状态”，不要重复发布。\n已交接的商品已从草稿箱移出。");
      } else if (fastAck?.stage === "failed") {
        setPublishQueued(false);
        const blockedReason = visibleError(result.batch.items.find((item) => item.state === "failed"));
        setRefreshError(
          blockedReason
            ? `SHEIN未接受商品：${blockedReason}`
            : `SHEIN未接受 ${fastAck.failedDraftIds.length || result.batch.itemCount} 个商品，请查看审核中心逐项处理后重试。`,
        );
      } else if (result.executionStage === "queued" || result.executionQueued) {
        setPublishQueued(true);
        const acceptedDraftIds = handoffDraftIds;
        const relaunchStartedAt = Date.now();
        acceptedDraftIds.forEach((draftId) => relaunchStartedAtRef.current.set(draftId, relaunchStartedAt));
        setRelaunchingDraftIds((current) => Array.from(new Set([
          ...current,
          ...acceptedDraftIds,
        ])));
        setFeedback(fastAck?.partial
          ? `发布批次已交接：${fastAck.acceptedDraftIds.length ? `SHEIN已接收 ${fastAck.acceptedDraftIds.length} 个，` : ""}${fastAck.failedDraftIds.length ? `失败 ${fastAck.failedDraftIds.length} 个，` : ""}其余 ${fastAck.uncertainDraftIds.length} 个仍待确认；请手动刷新，不要重复发布`
          : `已进入发布队列 ${result.batch.itemCount} 个商品，等待发送至 SHEIN；请勿重复发布`);
      } else {
        setPublishQueued(false);
        setFeedback("");
        const blockedReason = visibleError(result.batch.items.find((item) => item.state === "failed"));
        setRefreshError(
          blockedReason
            ? `商品未提交：${blockedReason}`
            : "商品未提交，请查看每个商品的阻断原因并修正后再发布。",
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "publish-batches"] });
      void reviewsQuery.refetch();
      // 发布成功或进入待确认态后，额度必须立即重新读取，避免用户在草稿、
      // 批量建品和审核中心继续看到已扣减前的旧额度。
      void queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "business-dashboard"] });
    },
    onError: (error) => {
      const uncertain = isPublishOutcomeUncertain(error);
      setPublishOutcomeUncertain(uncertain);
      setPublishQueued(false);
      if (uncertain) {
        setRefreshError("");
        setFeedback("发布结果未知，不能确认是否已发送至 SHEIN；请点击“手动刷新审核状态”，不要重复发布。");
      } else {
        setFeedback("");
        setRefreshError(refreshErrorLabel(error));
      }
      void queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "publish-batches"] });
    },
  });
  const acceptPriceMutation = useMutation({
    mutationFn: (discussSn: string) => api.acceptPriceDiscussion(storeId, discussSn),
    onSuccess: (result) => {
      setFeedback(result.failCount ? "部分核价单接受失败，请查看 SHEIN 返回结果" : "已接受平台核价，等待 SHEIN 回读");
      void priceQuery.refetch();
    },
  });
  const rejectPriceMutation = useMutation({
    mutationFn: (discussSn: string) => api.rejectPriceDiscussion(storeId, discussSn),
    onSuccess: (result) => {
      setFeedback(result.failCount ? "核价单拒绝失败，请查看 SHEIN 返回结果" : "已拒绝平台核价，等待 SHEIN 回读");
      void priceQuery.refetch();
    },
    onError: (error) => {
      setRefreshError(error instanceof Error ? error.message : "拒绝核价失败，请稍后重试");
    },
  });
  const archiveMutation = useMutation({
    mutationFn: (reviewKey: string) => api.archiveProductReview(storeId, reviewKey),
    onSuccess: () => {
      setFeedback("已从商品审核中心归档；SHEIN 商品未被删除或修改");
      void reviewsQuery.refetch();
    },
    onError: (error) => {
      setRefreshError(error instanceof Error ? error.message : "归档失败，请稍后重试");
    },
  });
  const archiveManyMutation = useMutation({
    mutationFn: (reviewKeys: string[]) => api.archiveProductReviews(storeId, reviewKeys),
    onSuccess: (result) => {
      setSelectedReviewKeys([]);
      setFeedback(`已批量归档 ${result.count} 条审核记录；SHEIN 商品未被删除或修改`);
      void reviewsQuery.refetch();
    },
    onError: (error) => {
      setRefreshError(error instanceof Error ? error.message : "批量归档失败，请稍后重试");
    },
  });

  if (!currentStore) return null;

  const refresh = async () => {
    if (refreshing || businessRefreshing) return;
    setRefreshing(true);
    setRefreshError("");
    setFeedback("");
    setPublishOutcomeUncertain(false);
    setPublishQueued(false);
    try {
      // Revalidation is an explicit user action. It is intentionally not
      // triggered on route entry, which used to add a POST beside the first
      // page load and make the review center appear stuck.
      setSecondaryQueriesEnabled(true);
      const initialResults = await Promise.allSettled([
        draftsQuery.refetch(),
        batchesQuery.refetch(),
        reviewsQuery.refetch(),
      ]);
      const freshDrafts = initialResults[0].status === "fulfilled"
        ? initialResults[0].value.data?.drafts || []
        : drafts;
      const freshBatches = initialResults[1].status === "fulfilled"
        ? initialResults[1].value.data?.batches || []
        : batchesQuery.data?.batches || [];
      const freshReviews = initialResults[2].status === "fulfilled"
        ? initialResults[2].value.data?.items || []
        : reviewsQuery.data?.items || [];
      const staleDraftIds = freshDrafts
        .filter((draft) => draft.status === "blocked")
        .map((draft) => draft.id);
      let revalidationFailed = false;
      let revalidationSkippedCount = 0;
      if (staleDraftIds.length) {
        try {
          const revalidated = await api.revalidateProductDrafts(storeId, staleDraftIds);
          revalidationSkippedCount = Number(revalidated.skippedCount || 0);
        } catch {
          revalidationFailed = true;
        }
      }
      const refreshableBatches = freshBatches.filter(isRefreshableReadbackBatch);
      const freshBatchReadbacks: PromiseSettledResult<PublishBatchReadbackStatus>[] = [];
      for (let index = 0; index < refreshableBatches.length; index += READBACK_REQUEST_CONCURRENCY) {
        freshBatchReadbacks.push(...await Promise.allSettled(
          refreshableBatches.slice(index, index + READBACK_REQUEST_CONCURRENCY).map((batch) =>
            api.publishBatchReadbackStatus(storeId, batch.id),
          ),
        ));
      }
      freshBatchReadbacks.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const batch = refreshableBatches[index];
        if (!batch) return;
        queryClient.setQueryData<PublishBatchReadbackStatus>(
          ["store", queryScope, storeId, "publish-readback", batch.id],
          result.value,
        );
      });
      const currentReadbacks = freshBatchReadbacks.filter(
        (result): result is PromiseFulfilledResult<PublishBatchReadbackStatus> => result.status === "fulfilled",
      );
      const targets = new Map<string, Set<string>>();
      const addTarget = (versionValue: unknown, spuValue: unknown) => {
        const version = text(versionValue);
        const spuName = text(spuValue);
        if (!version || !spuName) return;
        const names = targets.get(version) || new Set<string>();
        names.add(spuName);
        targets.set(version, names);
      };
      currentReadbacks
        .flatMap((result) => result.value.items || [])
        .forEach((item) => addTarget(item.version, item.spuName));
      freshReviews.forEach((item) => addTarget(item.version, item.spuName));
      const versions = [...targets.keys()];
      const remoteResults: PromiseSettledResult<unknown>[] = [];
      for (let index = 0; index < versions.length; index += READBACK_REQUEST_CONCURRENCY) {
        remoteResults.push(...await Promise.allSettled(
          versions.slice(index, index + READBACK_REQUEST_CONCURRENCY).map((version) => api.queryProductDocumentState(storeId, {
            version,
            spuNames: [...(targets.get(version) || [])],
          })),
        ));
      }
      const remoteFailures = remoteResults.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      const remoteSuccessCount = remoteResults.filter((result) =>
        result.status === "fulfilled" && asRecord(result.value).empty !== true,
      ).length;
      const remoteEmptyCount = remoteResults.filter((result) =>
        result.status === "fulfilled" && asRecord(result.value).empty === true,
      ).length;
      const remotePersistenceFailures = remoteResults.filter((result) => {
        if (result.status !== "fulfilled") return false;
        const projection = asRecord(asRecord(result.value).projection);
        return asRecord(projection.persistence).partial === true;
      });
      const localReadbackFailures = freshBatchReadbacks.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      const initialQueryFailures = initialResults.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      const refreshResults = await Promise.allSettled([
        businessQuery.refresh.mutateAsync(),
        priceQuery.refetch(),
        // The document-state query persists the official result. Read the
        // review projection once more in the same manual refresh so a new
        // rejection/awaiting stage appears without a second click.
        reviewsQuery.refetch(),
        ...(staleDraftIds.length ? [draftsQuery.refetch()] : []),
      ]);
      const localQueryFailures = refreshResults.filter((result) => result.status === "rejected");
      const refreshedCount = remoteSuccessCount + remoteEmptyCount;
      const partialRefreshMessage = [
        remoteFailures.length
          ? `SHEIN审核回读失败 ${remoteFailures.length} 项（${refreshErrorLabel(remoteFailures[0].reason)}）`
          : "",
        remotePersistenceFailures.length
          ? `本地审核投影部分失败 ${remotePersistenceFailures.length} 项（官方结果已读取，请再次刷新）`
          : "",
        localReadbackFailures.length
          ? `本地发布回读失败 ${localReadbackFailures.length} 个批次（${refreshErrorLabel(localReadbackFailures[0].reason)}）`
          : "",
        initialQueryFailures.length
          ? `审核基础数据读取失败 ${initialQueryFailures.length} 项（${refreshErrorLabel(initialQueryFailures[0].reason)}）`
          : "",
        revalidationFailed ? "部分草稿校验失败" : "",
        revalidationSkippedCount ? `有 ${revalidationSkippedCount} 个草稿未完成校验` : "",
        localQueryFailures.length ? "部分本地统计暂时不可用" : "",
      ].filter(Boolean).join("；");
      if (partialRefreshMessage) {
        if (refreshedCount > 0 || initialResults.some((result) => result.status === "fulfilled")) {
          const refreshHeadline = refreshedCount
            ? `审核状态已刷新 ${refreshedCount} 个版本${remoteEmptyCount ? `，${remoteEmptyCount} 个版本暂未返回官方记录` : ""}`
            : "已读取最新审核基础数据，但暂未成功取得 SHEIN 官方审核结果";
          setFeedback(`${refreshHeadline}；${partialRefreshMessage}`);
        } else {
          setRefreshError(`${partialRefreshMessage}，请稍后重试`);
        }
      } else {
        setFeedback(
          versions.length
            ? `已从 SHEIN 重新读取 ${versions.length} 个商品审核状态`
            : "已刷新发布与审核状态；当前没有可回读的商品版本",
        );
      }
    } catch (error) {
      setRefreshError(refreshErrorLabel(error));
    } finally {
      setRefreshing(false);
    }
  };
  const publish = (draftIds: string[]) => {
    if (!draftIds.length || publishMutation.isPending) return;
    if (!window.confirm(`确认直接提交 ${draftIds.length} 个商品到 SHEIN？`)) return;
    setFeedback("");
    setRefreshError("");
    setPublishOutcomeUncertain(false);
    setPublishQueued(false);
    const draftKey = [...draftIds].sort().join(":");
    const previous = publishAttemptRef.current;
    const idempotencyKey = previous?.draftKey === draftKey
      ? previous.idempotencyKey
      : crypto.randomUUID();
    publishAttemptRef.current = { draftKey, idempotencyKey };
    publishMutation.mutate({ draftIds, idempotencyKey });
  };
  const archiveReview = (reviewKey: string) => {
    if (archiveMutation.isPending) return;
    if (!window.confirm("确认从商品审核中心归档？这不会删除或修改 SHEIN 商品。")) return;
    archiveMutation.mutate(reviewKey);
  };
  const archiveReviews = () => {
    if (!selectedReviewKeys.length || archiveManyMutation.isPending) return;
    if (!window.confirm(`确认归档选中的 ${selectedReviewKeys.length} 条审核记录？这不会删除或修改 SHEIN 商品。`)) return;
    archiveManyMutation.mutate(selectedReviewKeys);
  };
  const openAiTitleEditor = (draftId: string) => {
    const params = new URLSearchParams({ draft: draftId, aiTitle: "1" });
    navigate(`/app/operations/${encodeURIComponent(storeId)}/products/new?${params.toString()}`);
  };
  const toggleAll = () => {
    const allEligibleIds = Array.from(new Set([...filteredEligibleIds, ...externalEligibleIds]));
    setSelectedIds((current) =>
      allEligibleIds.every((id) => current.includes(id))
        ? current.filter((id) => !allEligibleIds.includes(id))
      : Array.from(new Set([...current, ...allEligibleIds])),
    );
  };
  const toggleAllReviewRows = () => {
    const reviewKeys = filteredExternalReviews.map((review) => review.reviewKey);
    const allDraftsSelected = filteredEligibleIds.every((id) => selectedIds.includes(id));
    const allReviewsSelected = reviewKeys.every((key) => selectedReviewKeys.includes(key));
    const shouldSelect = !(allDraftsSelected && allReviewsSelected);
    setSelectedIds((current) => shouldSelect
      ? Array.from(new Set([...current, ...filteredEligibleIds]))
      : current.filter((id) => !filteredEligibleIds.includes(id)));
    setSelectedReviewKeys((current) => shouldSelect
      ? Array.from(new Set([...current, ...reviewKeys]))
      : current.filter((key) => !reviewKeys.includes(key)));
  };
  const publishableCount = visibleDrafts.filter((draft) => isPublishableDraft(draft, itemByDraft.get(draft.id), readbackByDraft.get(draft.id))).length;
  const reviewMetrics = useMemo(() => {
    const counted = new Set<string>();
    const pendingPriceSample = new Set<string>();
    let reviewing = 0;
    let needsAction = 0;
    const addReview = (identity: string, key: ReviewTab | null, stageIdentity = identity) => {
      if (counted.has(identity)) return;
      counted.add(identity);
      if (key === "awaiting_review") reviewing += 1;
      if (key === "needs_action") needsAction += 1;
      if (key === "awaiting_price" || key === "awaiting_sample") {
        pendingPriceSample.add(stageIdentity);
      }
    };
    for (const draft of visibleDrafts) {
      const readback = readbackByDraft.get(draft.id);
      addReview(
        reviewIdentityForDraft(draft.id),
        workflowKeyForDraft(
          draft,
          itemByDraft.get(draft.id),
          readback,
          priceDiscussionSkcs,
        ),
        readback?.skcNames[0] ? `skc:${readback.skcNames[0]}` : reviewIdentityForDraft(draft.id),
      );
    }
    for (const review of allExternalReviews) {
      addReview(
        reviewIdentityForExternal(review),
        externalReviewTab(review),
        review.skcName ? `skc:${review.skcName}` : reviewIdentityForExternal(review),
      );
    }
    for (const discussion of priceQuery.data?.discussions || []) {
      pendingPriceSample.add(
        discussion.skcName
          ? `skc:${discussion.skcName}`
          : `discussion:${discussion.discussSn}`,
      );
    }
    return { reviewing, needsAction, priceOrSample: pendingPriceSample.size };
  }, [allExternalReviews, itemByDraft, priceDiscussionSkcs, priceQuery.data?.discussions, readbackByDraft, visibleDrafts]);
  const publishProgress = useMemo(() => {
    const items = Array.from(itemByDraft.values()).filter((item) => [
      "queued", "preflighting", "ready", "submitted", "completed", "failed",
    ].includes(item.state));
    const counts = {
      total: items.length,
      queued: items.filter((item) => ["queued", "preflighting", "ready"].includes(publishProgressState(item, readbackByDraft.get(item.draftId)))).length,
      submitted: items.filter((item) => ["submitted", "completed"].includes(publishProgressState(item, readbackByDraft.get(item.draftId)))).length,
      unknown: items.filter((item) => publishProgressState(item, readbackByDraft.get(item.draftId)) === "result_unknown").length,
      failed: items.filter((item) => publishProgressState(item, readbackByDraft.get(item.draftId)) === "failed").length,
    };
    return { ...counts, active: publishMutation.isPending || counts.queued > 0 };
  }, [itemByDraft, publishMutation.isPending, readbackByDraft]);

  return (
    <div className="ops-page publishing-page">
      <OpsPageHeader
        eyebrow="经营中心"
        title="商品审核中心"
        description={`${currentStore.label} · 监控待审核、驳回、核价与寄样；已上架商品自动移出`}
        action={(
          <div className="publishing-refresh-actions">
            <span
              className="cache-chip"
              title="审核列表使用当前缓存；只有手动刷新才会读取 SHEIN 状态"
            >
              缓存 {batchesQuery.dataUpdatedAt ? formatTime(new Date(batchesQuery.dataUpdatedAt).toISOString()) : "尚未读取"}
            </span>
            <Button aria-label="手动刷新审核状态" variant="outline" onClick={() => void refresh()} disabled={refreshing || businessRefreshing || draftsQuery.isFetching || batchesQuery.isFetching}>
              <RefreshCw size={15} className={refreshing || businessRefreshing ? "animate-spin" : ""} />
              {refreshing || businessRefreshing ? "正在读取 SHEIN 状态" : "手动刷新审核状态"}
            </Button>
          </div>
        )}
      />

      <PublishQuotaNotice
        compact
        loading={businessQuery.isLoading}
        quota={businessQuery.data?.snapshot?.productQuota}
      />

      <OpsMetricStrip className="publishing-metric-strip">
        <div className="rounded-lg border border-[var(--line)] bg-white px-4 py-3">
          <p className="text-xs text-[var(--text-muted)]">待发布</p>
          <p className="mt-1 text-xl font-semibold text-[var(--ink)]">
            {publishableCount}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-white px-4 py-3">
          <p className="text-xs text-[var(--text-muted)]">审核中</p>
          <p className="mt-1 text-xl font-semibold text-[var(--ink)]">
            {reviewMetrics.reviewing}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-white px-4 py-3">
          <p className="text-xs text-[var(--text-muted)]">需处理</p>
          <p className="mt-1 text-xl font-semibold text-[var(--danger)]">
            {reviewMetrics.needsAction}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-white px-4 py-3">
          <p className="text-xs text-[var(--text-muted)]">待核价 / 寄样</p>
          <p className="mt-1 text-xl font-semibold text-[var(--ink)]">
            {reviewMetrics.priceOrSample}
          </p>
        </div>
      </OpsMetricStrip>

      {publishProgress.active && (
        <section className="mb-4 rounded-xl border border-[var(--line)] bg-white px-5 py-4 shadow-sm" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <LoaderCircle size={16} className="animate-spin text-[var(--warning)]" />
              <div>
                <h2 className="text-sm font-semibold text-[var(--ink)]">商品发布进度</h2>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">状态以当前店铺缓存为准，手动刷新后读取 SHEIN 官方回读</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[var(--text-muted)]">总计 {publishProgress.total}</span>
              <span className="rounded-full bg-[var(--warning-soft)] px-2.5 py-1 text-[var(--warning)]">排队 {publishProgress.queued}</span>
              <span className="rounded-full bg-[var(--success-soft)] px-2.5 py-1 text-[var(--success)]">SHEIN已接收 {publishProgress.submitted}</span>
              {publishProgress.unknown > 0 && <span className="rounded-full bg-[var(--warning-soft)] px-2.5 py-1 text-[var(--warning)]">结果待确认 {publishProgress.unknown}</span>}
              {publishProgress.failed > 0 && <span className="rounded-full bg-[var(--danger-soft)] px-2.5 py-1 text-[var(--danger)]">失败 {publishProgress.failed}</span>}
            </div>
          </div>
        </section>
      )}

      <OpsTableShell><section className="data-panel publishing-review-panel">
        <OpsToolbar>
          <div>
            <h2 className="text-base font-semibold text-[var(--ink)]">审核流程商品</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              已驳回且关联草稿的商品可直接重新发起；无本地草稿或未完成预检的记录需先重新编辑。
            </p>
          </div>
          <div className="publishing-review-actions flex flex-wrap items-center gap-2">
            <label className="flex h-9 min-w-52 items-center gap-2 rounded-md border border-[var(--line-strong)] px-3 text-sm text-[var(--text-muted)]">
              <Search size={15} />
              <input
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--text-subtle)]"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索标题、SKC、SPU"
              />
            </label>
            <Button disabled={!selectedReadyIds.length || publishMutation.isPending} onClick={() => publish(selectedReadyIds)}>
              {publishMutation.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />}
              发布已选 {selectedReadyIds.length ? `(${selectedReadyIds.length})` : ""}
            </Button>
            <Button
              variant="outline"
              disabled={!selectedReviewKeys.length || archiveManyMutation.isPending}
              onClick={archiveReviews}
            >
              {archiveManyMutation.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Archive size={15} />}
              批量归档 {selectedReviewKeys.length ? `(${selectedReviewKeys.length})` : ""}
            </Button>
          </div>
        </OpsToolbar>
        {(draftsQuery.isFetching || batchesQuery.isFetching) && (
          <div className="ops-fetching-banner" role="status">
            <LoaderCircle className="animate-spin" size={15} />
            正在读取当前店铺的审核缓存，列表保持可用
          </div>
        )}
        <div className="publishing-review-tabs flex gap-1 overflow-x-auto border-b border-[var(--line)] px-5 py-2">
          {REVIEW_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs ${reviewTab === tab.key ? "bg-[var(--ink)] text-white" : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"}`}
              onClick={() => startTransition(() => setReviewTab(tab.key))}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {feedback && (
          <div className={`flex items-center gap-2 border-b border-[var(--line)] px-5 py-3 text-sm ${publishOutcomeUncertain || publishQueued ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--success-soft)] text-[var(--success)]"}`}>
            {publishOutcomeUncertain || publishQueued ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />} {feedback}
          </div>
        )}
        {refreshError && (
          <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--danger-soft)] px-5 py-3 text-sm text-[var(--danger)]">
            <AlertCircle size={16} /> {refreshError}
          </div>
        )}
        {publishMutation.isError && !publishOutcomeUncertain && !refreshError && (
          <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--danger-soft)] px-5 py-3 text-sm text-[var(--danger)]">
            <AlertCircle size={16} /> {refreshErrorLabel(publishMutation.error)}
          </div>
        )}

        {filteredExternalReviews.length === 0 && <OperationsDataTable
          ariaLabel="商品审核流程列表"
          data={filteredByWorkflowDrafts}
          columns={publishingTableColumns}
          getRowId={(draft) => draft.id}
          estimateRowHeight={104}
          renderHeader={(columnId) => columnId === "select" ? <input type="checkbox" aria-label="全选可发布商品" checked={[...filteredEligibleIds, ...externalEligibleIds].length > 0 && [...filteredEligibleIds, ...externalEligibleIds].every((id) => selectedIds.includes(id))} onChange={toggleAll} /> : null}
          renderRow={(draft, _index, rowId, style) => {
            const item = itemByDraft.get(draft.id);
            const readback = readbackByDraft.get(draft.id);
            const linkedReview = reviewByDraftId.get(draft.id);
            const baseLabel = statusLabel(draft, item, readback);
            const primarySkc = readback?.skcNames[0] || "";
            const sample = businessSample(platformProductBySkc.get(primarySkc));
            const label = baseLabel === "审核通过" && priceDiscussionSkcs.has(primarySkc)
              ? "待核价"
              : baseLabel;
            const reasons = [visibleError(item), readbackError(readback), compliancePhotoFailureText(readback), ...publishFailureDetails(item), ...publishFailureDetailsFromError(readback?.lastError), ...auditFailureText(readback)].filter(Boolean);
            const ready = isPublishableDraft(draft, item, readback);
            const assetId = mainAssetIdOf(draft);
            const imageUrl = assetId ? thumbnailsQuery.data?.[assetId] : "";
            const wasSubmitted = Boolean(item || readback);
            return <tr key={rowId} style={style} className="align-middle hover:bg-[var(--surface-muted)]/55">
              <td><input type="checkbox" aria-label={`选择 ${titleOf(draft)}`} checked={selectedIds.includes(draft.id)} disabled={!ready} onChange={() => setSelectedIds((current) => current.includes(draft.id) ? current.filter((id) => id !== draft.id) : [...current, draft.id])} /></td>
              <td><div className="grid size-12 place-items-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface-muted)]">{imageUrl ? <img src={imageUrl} alt="商品主图" loading="lazy" decoding="async" className="size-full object-cover" /> : <ImageIcon size={18} className="text-[var(--text-subtle)]" />}</div></td>
              <td><p className="truncate text-sm font-medium text-[var(--ink)]" title={titleOf(draft)}>{shortTitle(titleOf(draft))}</p><p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">{primarySkc ? `SKC：${primarySkc}` : categoryOf(draft)} · 本地草稿</p><p className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-subtle)]">任务 {linkedReview?.taskId || readback?.version || item?.taskId || draft.id} · 发起 {linkedReview?.launchCount || (item ? 1 : 0)} 次 · 驳回 {linkedReview?.rejectionCount || 0} 次</p></td>
              <td><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusClass(label)}`}>{label}</span></td>
              <td>{reasons.length ? <div className="space-y-0.5 text-[var(--danger)]">{reasons.slice(0, 3).map((reason, index) => <p className="line-clamp-2" key={`${draft.id}-reason-${index}`}>{index === 0 && label === "审核失败" ? "驳回原因：" : ""}{reason}</p>)}</div> : <span className="text-[var(--text-subtle)]">—</span>}</td>
              <td className="text-[var(--text-muted)]">{sampleInfoText(sample)}</td>
              <td><div className="flex flex-wrap justify-end gap-1.5">{aiTitleCapability.data?.visible && <Button aria-label={`为 ${titleOf(draft)} 生成AI标题`} variant="outline" size="sm" onClick={() => openAiTitleEditor(draft.id)}><Sparkles size={13} />AI标题</Button>}{(label === "需处理" || label === "发布失败" || label === "审核失败") && <Button variant="outline" size="sm" onClick={() => navigate(`/app/operations/${encodeURIComponent(storeId)}/products/new?draft=${encodeURIComponent(draft.id)}`)}><PencilLine size={13} />重新编辑</Button>}{ready && <Button size="sm" disabled={publishMutation.isPending} onClick={() => publish([draft.id])}><Send size={13} />{wasSubmitted ? "重新发布" : "发布"}</Button>}<Button variant="ghost" size="sm" disabled={archiveMutation.isPending} onClick={() => archiveReview(`draft:${draft.id}`)}><Archive size={13} />归档</Button></div></td>
            </tr>;
          }}
        />}
        {filteredExternalReviews.length > 0 && <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] table-fixed text-xs">
            <thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="w-16 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="全选审核记录"
                      checked={(
                      (filteredEligibleIds.length + filteredExternalReviews.length > 0)
                      && filteredEligibleIds.every((id) => selectedIds.includes(id))
                      && filteredExternalReviews.every((review) => selectedReviewKeys.includes(review.reviewKey))
                    )}
                    onChange={toggleAllReviewRows}
                  />
                </th>
                <th className="w-14 px-2 py-2.5">主图</th>
                <th className="w-[25%] px-3 py-2.5">商品</th>
                <th className="w-24 px-3 py-2.5">流程状态</th>
                <th className="w-[20%] px-3 py-2.5">驳回原因</th>
                <th className="w-36 px-3 py-2.5">寄样信息</th>
                <th className="w-48 px-3 py-2.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filteredByWorkflowDrafts.map((draft) => {
                const item = itemByDraft.get(draft.id);
                const readback = readbackByDraft.get(draft.id);
                const linkedReview = reviewByDraftId.get(draft.id);
                const baseLabel = statusLabel(draft, item, readback);
                const primarySkc = readback?.skcNames[0] || "";
                const sample = businessSample(platformProductBySkc.get(primarySkc));
                const label = baseLabel === "审核通过" && priceDiscussionSkcs.has(primarySkc)
                  ? "待核价"
                  : baseLabel;
                const error = visibleError(item) || readbackError(readback);
                const auditReasons = auditFailureText(readback);
                const photoFailure = compliancePhotoFailureText(readback);
                const detailReasons = [
                  ...publishFailureDetails(item),
                  ...publishFailureDetailsFromError(readback?.lastError),
                ];
                const reasons = [
                  error,
                  readback?.pendingTooLong ? "已提交超过24小时仍未收到 SHEIN 回读，请先刷新审核状态，不要重复发布" : "",
                  photoFailure,
                  ...detailReasons,
                  ...auditReasons,
                ].filter(Boolean);
                const traceId = readback?.documentState.traceId
                  || publishErrorTraceId(readback?.lastError)
                  || publishErrorTraceId(item?.lastError)
                  || publishErrorTraceId(asRecord(item?.preflight).publishError);
                const assetId = mainAssetIdOf(draft);
                const imageUrl = assetId ? thumbnailsQuery.data?.[assetId] : "";
                const ready = isPublishableDraft(draft, item, readback);
                const wasSubmitted = Boolean(item || readback);
                return (
                  <tr key={draft.id} className="align-middle hover:bg-[var(--surface-muted)]/55">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${titleOf(draft)}`}
                        checked={selectedIds.includes(draft.id)}
                    disabled={!ready}
                        onChange={() => setSelectedIds((current) => current.includes(draft.id)
                          ? current.filter((id) => id !== draft.id)
                          : [...current, draft.id])}
                      />
                    </td>
                    <td className="px-2 py-3">
                      <div className="grid size-12 place-items-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface-muted)]">
                        {imageUrl ? <img src={imageUrl} alt="商品主图" loading="lazy" decoding="async" className="size-full object-cover" /> : <ImageIcon size={18} className="text-[var(--text-subtle)]" />}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <p className="truncate text-sm font-medium text-[var(--ink)]" title={titleOf(draft)}>{shortTitle(titleOf(draft))}</p>
                      <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
                        {primarySkc ? `SKC：${primarySkc}` : categoryOf(draft)} · 本地草稿
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-subtle)]">任务 {linkedReview?.taskId || readback?.version || item?.taskId || draft.id} · 发起 {linkedReview?.launchCount || (item ? 1 : 0)} 次 · 驳回 {linkedReview?.rejectionCount || 0} 次</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusClass(label)}`}>{label}</span>
                    </td>
                    <td className="px-3 py-3 leading-5">
                      {reasons.length || traceId ? (
                        <div className="space-y-0.5 text-[var(--danger)]">
                          {reasons.slice(0, 3).map((reason, index) => <p className="line-clamp-2" key={`${draft.id}-reason-${index}`}>{index === 0 && label === "审核失败" ? "驳回原因：" : ""}{reason}</p>)}
                          {traceId && <p className="truncate font-mono text-[10px] text-[var(--text-subtle)]">traceId: {traceId}</p>}
                        </div>
                      ) : <span className="text-[var(--text-subtle)]">—</span>}
                    </td>
                    <td className="px-3 py-3 leading-5 text-[var(--text-muted)]">{sampleInfoText(sample)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {aiTitleCapability.data?.visible && (
                          <Button aria-label={`为 ${titleOf(draft)} 生成AI标题`} variant="outline" size="sm" onClick={() => openAiTitleEditor(draft.id)}>
                            <Sparkles size={13} />AI标题
                          </Button>
                        )}
                        {(label === "需处理" || label === "发布失败" || label === "审核失败") && (
                          <Button variant="outline" size="sm" onClick={() => navigate(`/app/operations/${encodeURIComponent(storeId)}/products/new?draft=${encodeURIComponent(draft.id)}`)}>
                            <PencilLine size={13} />重新编辑
                          </Button>
                        )}
                        {label === "实拍图失败" && (
                          <Button variant="outline" size="sm" onClick={() => navigate(`/app/operations/${encodeURIComponent(storeId)}/compliance`)}>处理实拍图 <ChevronRight size={13} /></Button>
                        )}
                        {ready && (
                          <Button size="sm" disabled={publishMutation.isPending} onClick={() => publish([draft.id])}>
                            <Send size={13} />{wasSubmitted ? "重新发布" : "发布"}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" disabled={archiveMutation.isPending} onClick={() => archiveReview(`draft:${draft.id}`)}>
                          <Archive size={13} />归档
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredExternalReviews.map((review) => {
                const baseLabel = externalStatusLabel(review);
                const label = baseLabel === "审核通过" && review.skcName && priceDiscussionSkcs.has(review.skcName)
                  ? "待核价"
                  : baseLabel;
                const reasons = review.failedReasons.map((reason) => text(reason.content)).filter(Boolean);
                const reviewImageUrl = review.localMainAssetId
                  ? thumbnailsQuery.data?.[review.localMainAssetId] || review.imageUrl
                  : review.imageUrl;
                const canSelectRejected = isRejectedExternalReview(review) || label === "已驳回";
                const canDirectRelaunch = Boolean(
                  canSelectRejected && review.canRelaunch && review.localDraftId,
                );
                return (
                  <tr key={review.reviewKey} className="align-middle hover:bg-[var(--surface-muted)]/55">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${review.title}`}
                        checked={selectedReviewKeys.includes(review.reviewKey)}
                        disabled={archiveManyMutation.isPending}
                        title={canDirectRelaunch ? "选择后可批量重新发起或归档" : "选择后可批量归档"}
                        onChange={() => setSelectedReviewKeys((current) => current.includes(review.reviewKey)
                          ? current.filter((key) => key !== review.reviewKey)
                          : [...current, review.reviewKey])}
                      />
                    </td>
                    <td className="px-2 py-3">
                      <div className="grid size-12 place-items-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface-muted)]">
                        {reviewImageUrl ? <img src={reviewImageUrl} alt="商品主图" loading="lazy" decoding="async" className="size-full object-cover" /> : <ImageIcon size={18} className="text-[var(--text-subtle)]" />}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <p className="truncate text-sm font-medium text-[var(--ink)]" title={review.title}>{shortTitle(review.title)}</p>
                      <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">SKC：{review.skcName || "待生成"} · {review.source === "shein_backend" ? "SHEIN 后台" : "OpenAPI"}</p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-subtle)]">{review.version || review.documentSn || review.reviewKey}</p>
                      <p className="mt-0.5 truncate text-[10px] text-[var(--text-subtle)]">任务 {review.taskId} · 发起 {review.launchCount} 次 · 驳回 {review.rejectionCount} 次</p>
                    </td>
                    <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusClass(label)}`}>{label}</span></td>
                    <td className="px-3 py-3 leading-5">
                      {reasons.length ? <div className="space-y-0.5 text-[var(--danger)]">{reasons.slice(0, 3).map((reason, index) => <p className="line-clamp-2" key={`${review.reviewKey}-${index}`}>{index === 0 ? "驳回原因：" : ""}{reason}</p>)}</div>
                        : review.auditStateLabel === "failed" ? <span className="text-[var(--warning)]">请点击刷新读取 SHEIN 驳回原因</span>
                          : <span className="text-[var(--text-subtle)]">—</span>}
                    </td>
                    <td className="px-3 py-3 leading-5 text-[var(--text-muted)]">{sampleInfoText(review.sample)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {review.auditStateLabel === "failed" && review.localDraftId && !canDirectRelaunch && (
                          <Button variant="outline" size="sm" onClick={() => navigate(`/app/operations/${encodeURIComponent(storeId)}/products/new?draft=${encodeURIComponent(review.localDraftId || "")}`)}><PencilLine size={13} />重新编辑</Button>
                        )}
                        {canDirectRelaunch && (
                          <Button size="sm" disabled={publishMutation.isPending} onClick={() => publish([review.localDraftId || ""])}><Send size={13} />重新发起</Button>
                        )}
                        <Button variant="ghost" size="sm" disabled={archiveMutation.isPending} onClick={() => archiveReview(review.reviewKey)}><Archive size={13} />归档</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>}
        {!filteredDrafts.length && !externalReviews.length && (
          <div className="ops-empty-state">
            <span className="ops-empty-state__icon"><Archive size={22} /></span>
            <strong>{search ? "没有匹配的审核商品" : "当前店铺暂无审核商品"}</strong>
            <span>{search ? "请调整搜索条件后重试" : "商品提交后会在这里显示待审核、驳回、核价与寄样状态"}</span>
          </div>
        )}
      </section></OpsTableShell>
      {(priceQuery.data?.discussions || []).length > 0 && (
        <section className="price-discussion-panel overflow-hidden rounded-xl border border-[var(--line)] bg-white">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
            <h2 className="text-base font-semibold text-[var(--ink)]">待处理核价</h2>
            <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
              {priceQuery.data?.discussions.length || 0} 个商品
            </span>
          </div>
          <div className="space-y-4 bg-[var(--surface-muted)]/45 p-4">
            {(priceQuery.data?.discussions || []).map((discussion) => (
              <article className="price-discussion-card overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-sm" key={discussion.discussSn}>
                <div className="flex flex-col gap-4 border-b border-[var(--line)] p-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                  {discussion.mainPicUrl ? <img alt="核价商品主图" loading="lazy" decoding="async" className="size-16 shrink-0 rounded-lg border border-[var(--line)] object-cover" src={discussion.mainPicUrl} /> : <div className="size-16 shrink-0 rounded-lg bg-[var(--surface-muted)]" />}
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-semibold leading-6 text-[var(--ink)]">{shortTitle(discussion.productTitle || discussion.skcName)}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">SKC：{discussion.skcName}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-[var(--text-subtle)]">议价单：{discussion.discussSn}</p>
                  </div>
                </div>
                  <div className="price-discussion-actions flex shrink-0 flex-wrap gap-2 lg:justify-end">
                    <Button
                      disabled={acceptPriceMutation.isPending || rejectPriceMutation.isPending}
                      onClick={() => {
                        if (window.confirm("确认接受 SHEIN 当前核价建议？接受后商品成本价将按平台建议价变更。")) {
                          acceptPriceMutation.mutate(discussion.discussSn);
                        }
                      }}
                      size="sm"
                    >
                      一键接受核价
                    </Button>
                    <Button
                      disabled={acceptPriceMutation.isPending || rejectPriceMutation.isPending}
                      onClick={() => {
                        if (window.confirm("确认拒绝当前核价？拒绝后该商品无法上架，也不能再次报价。")) {
                          rejectPriceMutation.mutate(discussion.discussSn);
                        }
                      }}
                      size="sm"
                      variant="danger"
                    >
                      一键拒绝核价
                    </Button>
                  </div>
                </div>
                <div>
                  <div className="price-discussion-sku-heading hidden grid-cols-[minmax(160px,1.3fr)_minmax(120px,1fr)_minmax(150px,1fr)] gap-4 bg-[var(--surface-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-muted)] sm:grid">
                    <span>SKU 尺寸</span>
                    <span>平台建议价</span>
                    <span>反算单价（每平方米）</span>
                  </div>
                  <div className="divide-y divide-[var(--line)]">
                    {discussion.skuCostPrices.map((sku, index) => {
                      const unitPrice = pricePerSquareMeter(sku.suggestCostPrice, sku.saleAttributeValues);
                      return (
                        <div className="price-discussion-sku-row grid gap-3 px-4 py-3 sm:grid-cols-[minmax(160px,1.3fr)_minmax(120px,1fr)_minmax(150px,1fr)] sm:items-center sm:gap-4" key={`${sku.skuCode}-${index}`}>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--ink)]">{skuSizeLabel(sku.saleAttributeValues)}</p>
                            <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-subtle)]" title={sku.skuCode}>SHEIN SKU：{sku.skuCode}</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-[var(--text-subtle)] sm:hidden">平台建议价</p>
                            <p className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--ink)]">{formatDiscussionMoney(sku.suggestCostPrice, sku.suggestCostCurrency)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-[var(--text-subtle)] sm:hidden">反算单价（每平方米）</p>
                            <p className="mt-0.5 text-sm font-medium tabular-nums text-[var(--text-muted)]">{formatDiscussionMoney(unitPrice, sku.suggestCostCurrency)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
