import { WebAuthError } from "./web-auth.js";

export const REVIEW_CENTER_SNAPSHOT_VERSION = "review-center-snapshot-v1";
const READBACK_CONCURRENCY = 5;

function publicError(error) {
  const code = String(error?.code || error?.response?.code || "SOURCE_FAILED")
    .trim()
    .slice(0, 100);
  const message = String(error?.message || "审核中心数据源读取失败")
    .trim()
    .slice(0, 500);
  return { code, message };
}

function sourceReady(value) {
  return { state: "ready", error: null, value };
}

function sourceFailed(error, value) {
  return { state: "failed", error: publicError(error), value };
}

function reviewCenterDefaults() {
  return {
    drafts: { drafts: [], count: 0 },
    batches: { batches: [], count: 0, publishingEnabled: false },
    readbacks: { items: [], count: 0, readOnly: true },
    reviews: {
      items: [],
      count: 0,
      archivedKeys: [],
      readOnly: true,
      externalWrite: false,
    },
  };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(values.length, 1)) },
      () => worker(),
    ),
  );
  return results;
}

export class WebReviewCenterSnapshotService {
  constructor({
    productDrafts,
    publishBatches,
    productReviews,
    now = () => new Date(),
  } = {}) {
    if (!productDrafts || typeof productDrafts.list !== "function") {
      throw new Error("审核中心快照服务缺少商品草稿读取服务");
    }
    if (!publishBatches || typeof publishBatches.list !== "function") {
      throw new Error("审核中心快照服务缺少发布批次读取服务");
    }
    if (!productReviews || typeof productReviews.list !== "function") {
      throw new Error("审核中心快照服务缺少商品审核读取服务");
    }
    this.productDrafts = productDrafts;
    this.publishBatches = publishBatches;
    this.productReviews = productReviews;
    this.now = now;
  }

  async get({ context, storeId } = {}) {
    if (!context?.tenantId || !storeId) {
      throw new WebAuthError("INVALID_REQUEST", "缺少当前店铺", 400);
    }

    const generatedAt = this.now().toISOString();
    const defaults = reviewCenterDefaults();
    const [draftsResult, batchesResult, reviewsResult] = await Promise.allSettled([
      this.productDrafts.list({ context, storeId, includePublishHistory: true }),
      this.publishBatches.list({ context, storeId }),
      this.productReviews.list({ context, storeId }),
    ]);

    const drafts = draftsResult.status === "fulfilled"
      ? draftsResult.value
      : defaults.drafts;
    const batches = batchesResult.status === "fulfilled"
      ? batchesResult.value
      : defaults.batches;
    const reviews = reviewsResult.status === "fulfilled"
      ? reviewsResult.value
      : defaults.reviews;
    const sourceStates = {
      drafts: draftsResult.status === "fulfilled"
        ? sourceReady(drafts)
        : sourceFailed(draftsResult.reason, defaults.drafts),
      batches: batchesResult.status === "fulfilled"
        ? sourceReady(batches)
        : sourceFailed(batchesResult.reason, defaults.batches),
      reviews: reviewsResult.status === "fulfilled"
        ? sourceReady(reviews)
        : sourceFailed(reviewsResult.reason, defaults.reviews),
    };

    const batchRows = Array.isArray(batches?.batches) ? batches.batches : [];
    const readbackServiceAvailable = typeof this.publishBatches.listReadbackStatus === "function";
    const readbackResults = batchesResult.status === "fulfilled"
      && readbackServiceAvailable
      ? await mapWithConcurrency(batchRows, READBACK_CONCURRENCY, async (batch) => {
          try {
            const result = await this.publishBatches.listReadbackStatus({
              context,
              storeId,
              batchId: batch.id,
            });
            return {
              state: "ready",
              batchId: batch.id,
              items: (Array.isArray(result?.items) ? result.items : []).map((item) => ({
                ...item,
                batchId: batch.id,
              })),
            };
          } catch (error) {
            return {
              state: "failed",
              batchId: batch.id,
              error: publicError(error),
              items: [],
            };
          }
        })
      : [];
    const readbackFailures = readbackResults.filter((result) => result.state === "failed");
    const readbackItems = readbackResults.flatMap((result) => result.items);
    const readbacks = {
      items: readbackItems,
      count: readbackItems.length,
      readOnly: true,
    };
    sourceStates.readbacks = batchesResult.status === "fulfilled" && !readbackServiceAvailable
      ? sourceFailed(
          Object.assign(new Error("发布回读状态服务尚未启用"), {
            code: "READBACK_STATUS_UNAVAILABLE",
          }),
          defaults.readbacks,
        )
      : readbackFailures.length
      ? {
          state: "partial",
          error: readbackFailures[0].error,
          failedBatchIds: readbackFailures.map((result) => result.batchId),
          value: readbacks,
        }
      : batchesResult.status === "fulfilled"
        ? sourceReady(readbacks)
        : sourceFailed(
            batchesResult.reason,
            defaults.readbacks,
          );

    const partial = Object.values(sourceStates).some((source) =>
      source.state !== "ready",
    );
    return {
      snapshotVersion: REVIEW_CENTER_SNAPSHOT_VERSION,
      storeId,
      generatedAt,
      consistency: {
        mode: "single-control-request",
        partial,
        sources: Object.fromEntries(
          Object.entries(sourceStates).map(([key, source]) => {
            const { value: _value, ...publicSource } = source;
            return [key, publicSource];
          }),
        ),
      },
      drafts,
      batches,
      readbacks,
      reviews,
    };
  }
}
