import type { PublishBatch, PublishBatchItem, PublishExecutionPlan } from "./api";

export function buildExecutionPayloadPreviews(batch: PublishBatch | null | undefined): {
  previews: Array<{
    request: PublishExecutionPlan["requests"][number];
    item: PublishBatchItem | null;
    requestBody: Record<string, unknown> | null;
    valid: boolean;
    issue: string;
  }>;
  ready: boolean;
  externalWrite: false;
};
