import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresWebhookAuditRepository,
  WebhookAuditQueryError,
} from "./webhook-audit-repository.js";

test("lists only tenant-scoped production audit projections", async () => {
  let query = null;
  const repository = new PostgresWebhookAuditRepository({
    pool: {
      async query(text, values) {
        query = { text, values };
        return {
          rows: [
            {
              id: "event-1",
              event_type: "product_document_audit_status_notice",
              state: "processed",
              source: "production",
              attempt_count: 1,
              received_at: "2026-07-31T08:00:00.000Z",
              processed_at: "2026-07-31T08:00:01.000Z",
              projection_version: "product-document-audit-v1",
              projection: {
                eventFamily: "product_document_audit_status_notice",
                records: [
                  {
                    skcName: "SKC-1",
                    auditState: 3,
                    auditStateLabel: "failed",
                    failedReasons: [
                      { language: "zh", content: "材质标签缺失" },
                    ],
                  },
                ],
              },
              last_error: null,
              supplier_id: "123",
              store_label: "测试店铺",
            },
          ],
        };
      },
    },
  });

  const result = await repository.listProductAuditEvents({
    tenantId: "tenant-1",
    supplierId: "123",
    limit: 20,
  });

  assert.match(query.text, /we\.tenant_id = \$1/);
  assert.match(query.text, /s\.supplier_id = \$3/);
  assert.match(query.text, /we\.source = 'production'/);
  assert.doesNotMatch(query.text, /raw_payload|safe_headers/);
  assert.deepEqual(query.values, [
    "tenant-1",
    "product_document_audit_status_notice",
    "123",
    21,
  ]);
  assert.equal(result.items[0].projection.records[0].skcName, "SKC-1");
  assert.equal(JSON.stringify(result).includes("signature"), false);
});

test("rejects invalid supplier and limit filters before querying", async () => {
  const repository = new PostgresWebhookAuditRepository({
    pool: {
      async query() {
        throw new Error("invalid filters must not query");
      },
    },
  });

  await assert.rejects(
    repository.listProductAuditEvents({
      tenantId: "tenant-1",
      supplierId: "../other",
    }),
    (error) =>
      error instanceof WebhookAuditQueryError &&
      error.code === "INVALID_SUPPLIER_ID",
  );
  await assert.rejects(
    repository.listProductAuditEvents({
      tenantId: "tenant-1",
      limit: 101,
    }),
    (error) =>
      error instanceof WebhookAuditQueryError &&
      error.code === "INVALID_LIMIT",
  );
});
