import assert from "node:assert/strict";
import test from "node:test";
import { PostgresWebhookStoreResolver } from "./webhook-store-resolver.js";

test("webhook store resolver maps openKeyId to tenant and store", async () => {
  const calls = [];
  const resolver = new PostgresWebhookStoreResolver({
    pool: {
      async query(sql, params) {
        calls.push([sql, params]);
        return {
          rowCount: 1,
          rows: [
            {
              id: "store-1",
              tenant_id: "tenant-1",
              status: "active",
            },
          ],
        };
      },
    },
  });

  assert.deepEqual(await resolver.findByOpenKeyId("OPEN-1"), {
    storeId: "store-1",
    tenantId: "tenant-1",
    status: "active",
  });
  assert.deepEqual(calls[0][1], ["OPEN-1"]);
});

test("webhook store resolver permits application-level events", async () => {
  const resolver = new PostgresWebhookStoreResolver({
    pool: {
      async query() {
        return { rowCount: 0, rows: [] };
      },
    },
  });

  assert.equal(await resolver.findByOpenKeyId("UNKNOWN"), null);
});
