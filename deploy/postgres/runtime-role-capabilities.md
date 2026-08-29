# PostgreSQL Runtime Role Capability Matrix

Generated from the import graph of these long-running cloud entrypoints:

- `compliance-sync-worker-server.js`
- `control-server.js`
- `media-cleanup-worker-server.js`
- `outbox-dispatcher.js`
- `product-publish-worker-server.js`
- `rule-refresh-worker-server.js`
- `store-business-refresh-worker-server.js`
- `webhook-server.js`
- `webhook-worker-server.js`

This is a review inventory only. It does not create roles, change privileges, or modify database objects.

| Object | Kind | Operations | Runtime SQL sources |
| --- | --- | --- | --- |
| `api_audit_logs_id_seq` | sequence | USAGE | `server/cloud/compliance-sync-service.js`<br>`server/cloud/device-auth.js`<br>`server/cloud/diagnostic-events.js`<br>`server/cloud/rule-refresh-service.js`<br>`server/cloud/store-business-service.js`<br>`server/cloud/today-work-service.js`<br>`server/cloud/web-auth.js` |
| `ai_feature_grants` | table | SELECT, INSERT, UPDATE, DELETE | `server/cloud/ai-title-service.js`<br>`server/cloud/web-auth.js` |
| `api_audit_logs` | table | SELECT, INSERT | `server/cloud/compliance-sync-service.js`<br>`server/cloud/device-auth.js`<br>`server/cloud/diagnostic-events.js`<br>`server/cloud/rule-refresh-service.js`<br>`server/cloud/store-business-service.js`<br>`server/cloud/today-work-service.js`<br>`server/cloud/web-auth.js` |
| `compliance_drafts` | table | SELECT, INSERT, UPDATE | `server/cloud/compliance-workspace-service.js` |
| `compliance_preflight_reviews` | table | SELECT, INSERT | `server/cloud/compliance-workspace-service.js` |
| `compliance_preflight_runs` | table | SELECT, INSERT | `server/cloud/compliance-workspace-service.js` |
| `compliance_templates` | table | SELECT, INSERT, UPDATE | `server/cloud/compliance-workspace-service.js` |
| `desktop_devices` | table | SELECT, INSERT, UPDATE | `server/cloud/device-auth.js`<br>`server/cloud/shein-device-authorization.js` |
| `device_enrollment_codes` | table | SELECT, INSERT, UPDATE | `server/cloud/device-auth.js` |
| `device_sessions` | table | SELECT, INSERT, UPDATE | `server/cloud/device-auth.js` |
| `media_asset_references` | table | SELECT, INSERT, DELETE | `server/cloud/media-cleanup-worker.js`<br>`server/cloud/product-draft-service.js`<br>`server/cloud/publish-execution-repository.js`<br>`server/cloud/publish-template-service.js` |
| `media_assets` | table | SELECT, INSERT, UPDATE | `server/cloud/compliance-workspace-service.js`<br>`server/cloud/media-cleanup-worker.js`<br>`server/cloud/media-service.js`<br>`server/cloud/product-draft-service.js`<br>`server/cloud/publish-execution-repository.js`<br>`server/cloud/publish-template-service.js` |
| `member_invitations` | table | SELECT, INSERT, UPDATE | `server/cloud/web-auth.js` |
| `membership_store_access` | table | SELECT, INSERT, UPDATE, DELETE | `server/cloud/web-auth.js`<br>`server/cloud/web-shein-authorization.js` |
| `memberships` | table | SELECT, INSERT, UPDATE | `server/cloud/compliance-workspace-service.js`<br>`server/cloud/web-auth.js` |
| `password_reset_tokens` | table | SELECT, INSERT, UPDATE | `server/cloud/web-auth.js` |
| `product_drafts` | table | SELECT, INSERT, UPDATE | `server/cloud/product-draft-service.js`<br>`server/cloud/product-review-service.js`<br>`server/cloud/publish-batch-service.js`<br>`server/cloud/publish-execution-repository.js`<br>`server/cloud/rule-refresh-service.js`<br>`server/cloud/today-work-service.js` |
| `product_review_states` | table | SELECT, INSERT, UPDATE | `server/cloud/product-review-service.js`<br>`server/cloud/publish-batch-service.js`<br>`server/cloud/today-work-service.js` |
| `publish_batch_items` | table | SELECT, INSERT, UPDATE | `server/cloud/publish-batch-service.js`<br>`server/cloud/publish-execution-repository.js` |
| `publish_batches` | table | SELECT, INSERT, UPDATE | `server/cloud/publish-batch-service.js`<br>`server/cloud/publish-execution-repository.js` |
| `publish_execution_runs` | table | SELECT, INSERT, UPDATE | `server/cloud/publish-batch-service.js`<br>`server/cloud/publish-execution-repository.js`<br>`server/cloud/web-auth.js` |
| `publish_jobs` | table | SELECT, INSERT, UPDATE | `server/cloud/outbox-dispatcher.js`<br>`server/cloud/product-draft-service.js`<br>`server/cloud/product-review-service.js`<br>`server/cloud/publish-batch-service.js`<br>`server/cloud/publish-execution-repository.js`<br>`server/cloud/today-work-service.js`<br>`server/cloud/web-auth.js` |
| `publish_outbox_events` | table | SELECT, INSERT, UPDATE | `server/cloud/outbox-dispatcher.js` |
| `publish_receipts` | table | SELECT, INSERT | `server/cloud/product-review-service.js`<br>`server/cloud/publish-batch-service.js`<br>`server/cloud/publish-execution-repository.js` |
| `publish_templates` | table | SELECT, INSERT, UPDATE, DELETE | `server/cloud/product-draft-service.js`<br>`server/cloud/publish-template-service.js`<br>`server/cloud/rule-refresh-service.js` |
| `shein_authorization_attempts` | table | SELECT, INSERT, UPDATE | `server/cloud/shein-device-authorization.js`<br>`server/cloud/web-shein-authorization.js` |
| `shein_rule_snapshots` | table | SELECT, INSERT, UPDATE | `server/cloud/compliance-sync-service.js`<br>`server/cloud/compliance-workspace-service.js`<br>`server/cloud/publish-execution-repository.js`<br>`server/cloud/rule-refresh-scheduler.js`<br>`server/cloud/rule-snapshot-service.js` |
| `skc_compliance_records` | table | SELECT, INSERT, DELETE | `server/cloud/compliance-sync-service.js`<br>`server/cloud/compliance-workspace-service.js` |
| `skcs` | table | SELECT, INSERT, UPDATE | `server/cloud/compliance-sync-service.js`<br>`server/cloud/compliance-workspace-service.js`<br>`server/cloud/product-review-service.js`<br>`server/cloud/store-business-service.js`<br>`server/cloud/webhook-business-state-repository.js` |
| `spus` | table | SELECT, INSERT, UPDATE | `server/cloud/compliance-sync-service.js`<br>`server/cloud/compliance-workspace-service.js`<br>`server/cloud/product-review-service.js`<br>`server/cloud/store-business-service.js` |
| `store_business_snapshots` | table | SELECT, INSERT, UPDATE | `server/cloud/publish-execution-repository.js`<br>`server/cloud/store-business-refresh-scheduler.js`<br>`server/cloud/store-business-service.js`<br>`server/cloud/webhook-business-state-repository.js` |
| `store_credentials` | table | SELECT, INSERT, UPDATE, DELETE | `server/cloud/rule-refresh-scheduler.js`<br>`server/cloud/store-business-refresh-scheduler.js`<br>`server/cloud/store-repository.js`<br>`server/cloud/web-auth.js` |
| `store_sales_daily` | table | SELECT, INSERT, UPDATE | `server/cloud/store-business-service.js` |
| `stores` | table | SELECT, INSERT, UPDATE | `server/cloud/compliance-sync-service.js`<br>`server/cloud/rule-refresh-scheduler.js`<br>`server/cloud/rule-refresh-service.js`<br>`server/cloud/rule-snapshot-service.js`<br>`server/cloud/shein-device-authorization.js`<br>`server/cloud/store-business-refresh-scheduler.js`<br>`server/cloud/store-business-service.js`<br>`server/cloud/store-repository.js`<br>`server/cloud/web-auth.js`<br>`server/cloud/webhook-audit-repository.js`<br>`server/cloud/webhook-business-state-repository.js`<br>`server/cloud/webhook-store-resolver.js` |
| `sync_job_items` | table | SELECT, INSERT, UPDATE | `server/cloud/compliance-sync-service.js`<br>`server/cloud/sync-job-service.js` |
| `sync_jobs` | table | SELECT, INSERT, UPDATE | `server/cloud/compliance-sync-service.js`<br>`server/cloud/rule-refresh-scheduler.js`<br>`server/cloud/rule-refresh-service.js`<br>`server/cloud/store-business-service.js`<br>`server/cloud/sync-job-service.js` |
| `tenant_ai_title_settings` | table | SELECT, INSERT, UPDATE | `server/cloud/ai-title-service.js` |
| `tenants` | table | SELECT, INSERT, DELETE | `server/cloud/device-auth.js`<br>`server/cloud/rule-refresh-scheduler.js`<br>`server/cloud/shein-device-authorization.js`<br>`server/cloud/store-business-refresh-scheduler.js`<br>`server/cloud/web-auth.js` |
| `users` | table | SELECT, INSERT, UPDATE | `server/cloud/compliance-workspace-service.js`<br>`server/cloud/sync-job-service.js`<br>`server/cloud/web-auth.js` |
| `web_sessions` | table | SELECT, INSERT, UPDATE | `server/cloud/web-auth.js` |
| `webhook_events` | table | SELECT, INSERT, UPDATE | `server/cloud/product-review-service.js`<br>`server/cloud/today-work-service.js`<br>`server/cloud/webhook-audit-repository.js`<br>`server/cloud/webhook-event-store.js` |

Tables: 40. Sequences: 1.
