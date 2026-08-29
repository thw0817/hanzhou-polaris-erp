import type { ProductDraft } from "./api";

export interface PublishBatchHandoffState {
  source: "product-drafts";
  storeId: string;
  draftIds: string[];
}

export function buildPublishBatchHandoff(input?: {
  drafts?: ProductDraft[];
  selectedIds?: string[];
  storeId?: string;
}): {
  selectedCount: number;
  readyDraftIds: string[];
  rejectedCount: number;
  externalWrite: false;
  state: PublishBatchHandoffState;
};

export function consumePublishBatchHandoff(input?: {
  state?: unknown;
  drafts?: ProductDraft[];
  storeId?: string;
}): {
  accepted: boolean;
  readyDraftIds: string[];
  rejectedCount: number;
  reason: string;
  externalWrite: false;
};
