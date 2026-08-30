import assert from "node:assert/strict";
import test from "node:test";
import {
  productPublishCandidateFingerprint,
} from "./product-publish-candidate.js";
import {
  runProductRemotePreflight,
  verifyProductRemotePublishCandidate,
} from "./product-remote-preflight.js";

function candidate(overrides = {}) {
  const source = {
    state: "ready_for_remote_preflight",
    requestBody: {
      category_id: "3155",
      product_type_id: "991",
      source_system: "OpenAPI",
      suit_flag: 0,
      is_spu_pic: false,
      skc_list: [{
        supplier_code: "RUG-001",
        sku_list: [
          { supplier_sku: "RUG-001-40X60" },
          { supplier_sku: "RUG-001-50X80" },
        ],
      }],
    },
    pendingImageUploads: [
      {
        localId: "asset-main",
        name: "main.jpg",
        targetLevel: "skc",
        imageType: 1,
        imageSort: 1,
      },
      {
        localId: "asset-detail",
        name: "detail.jpg",
        templateId: "template-shared-carousel",
        targetLevel: "skc",
        imageType: 2,
        imageSort: 2,
      },
      {
        assetId: "asset-shared-sku",
        supplierSku: "RUG-001-40X60",
        targetLevel: "sku",
        imageType: 1,
        imageSort: 1,
      },
      {
        assetId: "asset-shared-sku",
        supplierSku: "RUG-001-50X80",
        targetLevel: "sku",
        imageType: 1,
        imageSort: 1,
      },
      {
        localId: "asset-description",
        targetLevel: "site-detail",
        imageType: 7,
        imageSort: 1,
      },
    ],
    audit: { categoryId: "3155" },
    remoteChecks: [
      "check-publish-permission",
      "goods/query-shelf-quota",
      "check-supplierSku-repeated",
      "upload-pic",
      "transform-pic",
      "goods-compliance-requirements/list",
    ],
    requiresSkcComplianceReadback: true,
    publishingEnabled: false,
    ...overrides,
  };
  source.fingerprint = productPublishCandidateFingerprint(source);
  return source;
}

function passedPreflight(overrides = {}) {
  return {
    permission: {
      canPublishProduct: true,
      reason: "",
      diagnostics: { traceId: "permission-trace" },
    },
    shelfQuota: {
      availableLimit: 9,
      diagnostics: { traceId: "quota-trace" },
    },
    supplierSkuCheck: {
      results: [
        { supplierSku: "RUG-001-40X60", repeated: false },
        { supplierSku: "RUG-001-50X80", repeated: false },
      ],
      diagnostics: [{ traceId: "sku-trace" }],
    },
    ...overrides,
  };
}

test("uploads local images once per asset and type, then freezes the official request body", async () => {
  const calls = [];
  const result = await runProductRemotePreflight({
    candidate: candidate(),
    publishPreflight: passedPreflight(),
    checkedAt: "2026-08-05T08:00:00.000Z",
    uploadImage: async (input) => {
      calls.push(input);
      return {
        imageUrl: `https://img.example/${input.assetId}-${input.imageType}.jpg`,
        diagnostics: { traceId: `trace-${input.assetId}` },
      };
    },
  });

  assert.equal(result.state, "ready_for_publish_confirmation");
  assert.equal(result.publishingEnabled, false);
  assert.ok(result.fingerprint);
  assert.equal(verifyProductRemotePublishCandidate(result), true);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.find((item) => item.assetId === "asset-detail"), {
    assetId: "asset-detail",
    templateId: "template-shared-carousel",
    imageType: 2,
    name: "detail.jpg",
  });
  assert.equal(result.checks.uploadPic.requestedCount, 5);
  assert.equal(result.checks.uploadPic.uploadedCount, 4);
  assert.equal(result.checks.uploadPic.reusedCount, 1);
  assert.equal(result.checks.transformPic.state, "skipped");
  assert.equal(
    result.requestBody.skc_list[0].image_info.image_info_list.length,
    2,
  );
  assert.equal(
    result.requestBody.skc_list[0].sku_list[0].image_info
      .image_info_list[0].image_url,
    "https://img.example/asset-shared-sku-1.jpg",
  );
  assert.deepEqual(result.requestBody.site_detail_image_info_list, [{
    image_info_list: [{
      image_sort: 1,
      image_url: "https://img.example/asset-description-7.jpg",
    }],
  }]);
});

test("reuses verified SHEIN image uploads while refreshing every remote check", async () => {
  const source = candidate();
  const first = await runProductRemotePreflight({
    candidate: source,
    publishPreflight: passedPreflight(),
    checkedAt: "2026-08-05T08:00:00.000Z",
    uploadImage: async ({ assetId, imageType }) => ({
      imageUrl: `https://img.example/${assetId}-${imageType}.jpg`,
      diagnostics: { traceId: `first-${assetId}-${imageType}` },
    }),
  });
  let repeatedUpload = false;

  const second = await runProductRemotePreflight({
    candidate: source,
    publishPreflight: passedPreflight({
      shelfQuota: {
        availableLimit: 8,
        diagnostics: { traceId: "fresh-quota-trace" },
      },
    }),
    previousRemoteCandidate: first,
    checkedAt: "2026-08-05T08:05:00.000Z",
    uploadImage: async () => {
      repeatedUpload = true;
      throw new Error("unchanged images must not be uploaded again");
    },
  });

  assert.equal(repeatedUpload, false);
  assert.equal(second.state, "ready_for_publish_confirmation");
  assert.equal(second.checkedAt, "2026-08-05T08:05:00.000Z");
  assert.equal(second.checks.shelfQuota.availableLimit, 8);
  assert.equal(second.checks.shelfQuota.traceId, "fresh-quota-trace");
  assert.equal(second.checks.uploadPic.uploadedCount, 0);
  assert.equal(second.checks.uploadPic.reusedCount, 5);
  assert.equal(verifyProductRemotePublishCandidate(second), true);
});

test("never reuses image receipts from a forged previous remote candidate", async () => {
  const source = candidate();
  const previous = await runProductRemotePreflight({
    candidate: source,
    publishPreflight: passedPreflight(),
    uploadImage: async ({ assetId, imageType }) => ({
      imageUrl: `https://img.example/${assetId}-${imageType}.jpg`,
      diagnostics: {},
    }),
  });
  previous.requestBody.category_id = "forged";
  let uploadCount = 0;

  const refreshed = await runProductRemotePreflight({
    candidate: source,
    publishPreflight: passedPreflight(),
    previousRemoteCandidate: previous,
    uploadImage: async ({ assetId, imageType }) => {
      uploadCount += 1;
      return {
        imageUrl: `https://img.example/fresh-${assetId}-${imageType}.jpg`,
        diagnostics: {},
      };
    },
  });

  assert.equal(uploadCount, 4);
  assert.equal(refreshed.checks.uploadPic.uploadedCount, 4);
  assert.equal(refreshed.checks.uploadPic.reusedCount, 1);
  assert.equal(verifyProductRemotePublishCandidate(refreshed), true);
});

test("detects a changed frozen request body before execution planning", async () => {
  const result = await runProductRemotePreflight({
    candidate: candidate({ pendingImageUploads: [] }),
    publishPreflight: passedPreflight(),
  });
  result.requestBody.category_id = "forged";

  assert.equal(verifyProductRemotePublishCandidate(result), false);
});

test("rejects a forged candidate before any remote image action", async () => {
  let called = false;
  const forged = candidate();
  forged.requestBody.category_id = "forged-category";

  const result = await runProductRemotePreflight({
    candidate: forged,
    publishPreflight: passedPreflight(),
    uploadImage: async () => {
      called = true;
    },
  });

  assert.equal(result.state, "blocked");
  assert.equal(result.requestBody, null);
  assert.equal(called, false);
  assert.equal(
    result.blockers[0].code,
    "PUBLISH_CANDIDATE_FINGERPRINT_INVALID",
  );
});

test("does not upload images when permission, quota or SKU checks are blocked", async () => {
  let called = false;
  const result = await runProductRemotePreflight({
    candidate: candidate(),
    publishPreflight: passedPreflight({
      permission: {
        canPublishProduct: false,
        reason: "店铺当前不可发品",
        diagnostics: {},
      },
      shelfQuota: { availableLimit: 0, diagnostics: {} },
      supplierSkuCheck: {
        results: [
          { supplierSku: "RUG-001-40X60", repeated: true },
        ],
        diagnostics: [],
      },
    }),
    uploadImage: async () => {
      called = true;
    },
  });

  assert.equal(result.state, "blocked");
  assert.equal(called, false);
  assert.deepEqual(
    result.blockers.map((blocker) => blocker.code),
    [
      "PUBLISH_PERMISSION_DENIED",
      "SHELF_QUOTA_EXHAUSTED",
      "SUPPLIER_SKU_CHECK_INCOMPLETE",
      "SUPPLIER_SKU_REPEATED",
    ],
  );
});

test("does not block a publish candidate when quota lookup is unavailable by permission", async () => {
  const result = await runProductRemotePreflight({
    candidate: candidate({ pendingImageUploads: [] }),
    publishPreflight: passedPreflight({
      shelfQuota: {
        availableLimit: null,
        availability: "unavailable",
        reason: "应用没有该接口访问权限",
        diagnostics: { traceId: "quota-denied-trace" },
      },
    }),
  });

  assert.equal(result.state, "ready_for_publish_confirmation");
  assert.equal(result.checks.shelfQuota.state, "unavailable");
  assert.deepEqual(result.blockers, []);
});

test("does not block a publish candidate when SHEIN declares quota control disabled", async () => {
  const result = await runProductRemotePreflight({
    candidate: candidate({ pendingImageUploads: [] }),
    publishPreflight: passedPreflight({
      shelfQuota: {
        availableLimit: null,
        availability: "unlimited",
        diagnostics: { traceId: "unlimited-quota-trace" },
      },
    }),
  });

  assert.equal(result.state, "ready_for_publish_confirmation");
  assert.equal(result.checks.shelfQuota.state, "unlimited");
  assert.deepEqual(result.blockers, []);
});
