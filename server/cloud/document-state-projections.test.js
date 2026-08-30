import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProductDocumentState } from "./document-state-projections.js";

test("normalizes the version-scoped document state response and maps audit state", () => {
  const result = normalizeProductDocumentState(
    {
      info: {
        data: [{
          spu_name: "SPU-1",
          skc_name: "SKC-1",
          sku_list: [{ sku_code: "SKU-1" }],
          document_sn: "DOC-1",
          audit_state: 2,
          audit_time: "2026-08-06 01:00:00",
        }],
      },
    },
    { requestedVersion: "VERSION-1" },
  );

  assert.equal(result.projectionVersion, "product-document-state-v1");
  assert.equal(result.summary.passedRecordCount, 1);
  assert.deepEqual(result.projection.records[0], {
    spuName: "SPU-1",
    skcName: "SKC-1",
    skuCodes: ["SKU-1"],
    documentSn: "DOC-1",
    version: "VERSION-1",
    auditTime: "2026-08-06 01:00:00",
    auditState: 2,
    auditStateLabel: "passed",
    status: "passed",
    failedReasons: [],
    occurredAt: "2026-08-06 01:00:00",
  });
});

test("accepts data JSON strings and preserves withdrawn state", () => {
  const result = normalizeProductDocumentState({
    data: JSON.stringify({
      document_sn: "DOC-2",
      version: "VERSION-2",
      audit_state: "4",
    }),
  });

  assert.equal(result.projection.records[0].auditStateLabel, "withdrawn");
  assert.equal(result.projection.records[0].status, "withdrawn");
});

test("keeps official audit failure reasons in the read-only projection", () => {
  const result = normalizeProductDocumentState(
    {
      data: [{
        spu_name: "SPU-3",
        skc_name: "SKC-3",
        sku_list: [{ sku_code: "SKU-3" }],
        document_sn: "DOC-3",
        version: "VERSION-3",
        audit_state: 3,
        audit_time: "2026-08-07 09:30:00",
        failed_reason: [
          { language: "zh-cn", content: "商品属性缺少必填值" },
          { language: "en", content: "A required product attribute is missing" },
        ],
      }],
    },
    { requestedVersion: "VERSION-3" },
  );

  assert.deepEqual(result.projection.records[0].failedReasons, [
    { language: "zh-cn", content: "商品属性缺少必填值" },
    { language: "en", content: "A required product attribute is missing" },
  ]);
  assert.equal(result.projection.records[0].status, "failed");
});

test("normalizes the current SHEIN spuList document-state response", () => {
  const result = normalizeProductDocumentState(
    {
      info: {
        meta: { count: 1, customObj: null },
        data: [{
          spuName: "SPU-CURRENT",
          version: "VERSION-CURRENT",
          skcList: [{
            skcName: "SKC-CURRENT",
            documentSn: "DOC-CURRENT",
            documentState: 3,
            failedReason: null,
          }],
        }],
      },
    },
    { requestedVersion: "VERSION-CURRENT" },
  );

  assert.equal(result.projection.records.length, 1);
  assert.deepEqual(result.projection.records[0], {
    spuName: "SPU-CURRENT",
    skcName: "SKC-CURRENT",
    skuCodes: [],
    documentSn: "DOC-CURRENT",
    version: "VERSION-CURRENT",
    auditTime: null,
    auditState: 3,
    auditStateLabel: "failed",
    status: "failed",
    failedReasons: [],
    occurredAt: null,
  });
});

test("treats an official empty document-state result as an honest empty readback", () => {
  const result = normalizeProductDocumentState(
    { info: { data: [] } },
    { requestedVersion: "VERSION-NOT-YET-RETURNED" },
  );

  assert.equal(result.empty, true);
  assert.deepEqual(result.projection.records, []);
  assert.equal(result.summary.recordCount, 0);
  assert.equal(result.summary.disposition, "read-only-document-state-empty");
});

test("fails closed on unsupported states and untraceable responses", () => {
  assert.throws(
    () =>
      normalizeProductDocumentState({
        data: [{ version: "VERSION-1", audit_state: 99 }],
      }),
    /audit_state 不受支持/,
  );
  assert.throws(
    () => normalizeProductDocumentState({ data: [{}] }),
    /缺少可追踪的商品标识/,
  );
});
