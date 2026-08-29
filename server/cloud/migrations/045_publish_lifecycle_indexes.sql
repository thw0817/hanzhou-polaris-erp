-- Keep the draft-box lifecycle projection fast as publish history grows.
-- This migration only adds recoverable indexes; it does not rewrite product data.
CREATE INDEX IF NOT EXISTS publish_batch_items_product_draft_idx
  ON publish_batch_items (product_draft_id, batch_id);

CREATE INDEX IF NOT EXISTS publish_jobs_product_draft_scope_idx
  ON publish_jobs (tenant_id, store_id, product_draft_id);
