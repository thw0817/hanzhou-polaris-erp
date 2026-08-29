import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExecutionPayloadPreviews,
} from "../../src-v2/lib/publish-execution-preview-contract.js";

function batch() {
  return {
    preflight: {
      executionPlan: {
        state: "ready_for_execution_confirmation",
        requestCount: 1,
        requests: [{
          itemId: "item-1",
          draftId: "draft-1",
          requestKey: "request-1",
          sourceCandidateFingerprint: "source-1",
          remoteCandidateFingerprint: "remote-1",
          skcCount: 1,
          skuCount: 2,
        }],
      },
    },
    items: [{
      id: "item-1",
      draftName: "商品一",
      preflight: {
        publishCandidateFingerprint: "source-1",
        remotePublishCandidate: {
          state: "ready_for_publish_confirmation",
          publishingEnabled: false,
          sourceCandidateFingerprint: "source-1",
          fingerprint: "remote-1",
          requestBody: { category_id: "100", skc_list: [{ sku_list: [{}, {}] }] },
        },
      },
    }],
  };
}

test("previews the exact frozen request only when all item links match", () => {
  const result = buildExecutionPayloadPreviews(batch());

  assert.equal(result.ready, true);
  assert.equal(result.externalWrite, false);
  assert.equal(result.previews[0].item.draftName, "商品一");
  assert.equal(result.previews[0].requestBody.category_id, "100");
});

test("fails closed when a fingerprint or request body is missing", () => {
  const fingerprintMismatch = batch();
  fingerprintMismatch.items[0].preflight.remotePublishCandidate.fingerprint = "changed";
  const mismatched = buildExecutionPayloadPreviews(fingerprintMismatch);
  assert.equal(mismatched.ready, false);
  assert.equal(mismatched.previews[0].requestBody, null);
  assert.equal(mismatched.previews[0].issue, "载荷缺失或指纹不一致");

  const bodyMissing = batch();
  bodyMissing.items[0].preflight.remotePublishCandidate.requestBody = null;
  assert.equal(buildExecutionPayloadPreviews(bodyMissing).ready, false);
});

test("fails closed when declared request count or request identity is inconsistent", () => {
  const countMismatch = batch();
  countMismatch.preflight.executionPlan.requestCount = 2;
  assert.equal(buildExecutionPayloadPreviews(countMismatch).ready, false);

  const duplicate = batch();
  duplicate.preflight.executionPlan.requestCount = 2;
  duplicate.preflight.executionPlan.requests.push({
    ...duplicate.preflight.executionPlan.requests[0],
  });
  const result = buildExecutionPayloadPreviews(duplicate);
  assert.equal(result.ready, false);
  assert.equal(result.previews[1].valid, false);
});
