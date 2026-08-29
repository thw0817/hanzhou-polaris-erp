import assert from "node:assert/strict";
import test from "node:test";
import {
  MediaServiceError,
  WebMediaService,
} from "./media-service.js";

function createService(overrides = {}) {
  const records = new Map();
  const repository = {
    async createAsset(asset) {
      const row = {
        ...asset,
        store_id: asset.storeId,
        original_name: asset.originalName,
        content_type: asset.contentType,
        size_bytes: asset.sizeBytes,
        reference_count: 0,
        expires_at: asset.expiresAt?.toISOString() || null,
        created_at: "2026-07-31T10:00:00.000Z",
        object_key: asset.objectKey,
        status: "uploading",
      };
      records.set(asset.id, row);
      return row;
    },
    async findAsset({ assetId }) {
      return records.get(assetId) || null;
    },
    async markReady(input) {
      const row = records.get(input.assetId);
      Object.assign(row, {
        status: "ready",
        size_bytes: input.sizeBytes,
        content_type: input.contentType,
        width: input.width,
        height: input.height,
      });
      return row;
    },
    async listAssets() {
      return [...records.values()];
    },
    async usage() {
      const active = [...records.values()].filter((row) => row.status !== "deleted");
      return {
        storeAssetCount: active.filter((row) => row.store_id === "store-1").length,
        storeBytes: active
          .filter((row) => row.store_id === "store-1")
          .reduce((total, row) => total + Number(row.size_bytes || 0), 0),
        tenantAssetCount: active.length,
        tenantBytes: active.reduce((total, row) => total + Number(row.size_bytes || 0), 0),
      };
    },
  };
  const storage = {
    bucket: "shein-media",
    createUploadUrl() {
      return {
        url: "https://upload.example.test/signed",
        headers: { "Content-Type": "image/jpeg" },
        expiresAt: "2026-07-31T10:10:00.000Z",
      };
    },
    createDownloadUrl() {
      return {
        url: "https://download.example.test/signed",
        headers: {},
        expiresAt: "2026-07-31T10:05:00.000Z",
      };
    },
    async statObject() {
      return {
        sizeBytes: 1024,
        contentType: "image/jpeg",
        etag: "etag-1",
      };
    },
    async getObject() {
      return {
        bytes: Buffer.from("jpeg"),
        contentType: "image/jpeg",
        etag: "etag-1",
      };
    },
  };
  return {
    records,
    service: new WebMediaService({
      repository,
      storage,
      now: () => new Date("2026-07-31T10:00:00.000Z"),
      ...overrides,
    }),
  };
}

test("creates a tenant and store scoped browser upload ticket", async () => {
  const { service } = createService();
  const result = await service.createUploadTicket({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      originalName: "客厅 地毯.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      purpose: "temporary_upload",
    },
  });

  assert.equal(result.asset.storeId, "store-1");
  assert.equal(result.asset.status, "uploading");
  assert.equal(result.upload.method, "PUT");
  assert.equal(result.upload.url, "https://upload.example.test/signed");
  assert.equal(
    result.asset.expiresAt,
    "2026-08-03T10:00:00.000Z",
  );
});

test("blocks a browser upload when the configured workspace media quota is full", async () => {
  const { service } = createService({
    quota: {
      mediaAssetsPerStore: 1,
      mediaAssetsPerTenant: 10,
      mediaBytesPerStore: 10_000,
      mediaBytesPerTenant: 10_000,
    },
  });
  await service.createUploadTicket({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      originalName: "first.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      purpose: "temporary_upload",
    },
  });
  await assert.rejects(
    service.createUploadTicket({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
      input: {
        originalName: "second.jpg",
        contentType: "image/jpeg",
        sizeBytes: 1024,
        purpose: "temporary_upload",
      },
    }),
    (error) =>
      error instanceof MediaServiceError &&
      error.code === "MEDIA_QUOTA_EXCEEDED" &&
      error.status === 409,
  );
});

test("verifies object storage metadata before marking an upload ready", async () => {
  const { service } = createService();
  const created = await service.createUploadTicket({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      originalName: "rug.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      purpose: "compliance_evidence",
    },
  });
  const completed = await service.completeUpload({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    assetId: created.asset.id,
    input: { width: 1600, height: 1600 },
  });

  assert.equal(completed.asset.status, "ready");
  assert.equal(completed.asset.width, 1600);
  assert.equal(completed.asset.expiresAt, null);
});

test("creates a scoped download ticket only after an image is ready", async () => {
  const { service } = createService();
  const created = await service.createUploadTicket({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      originalName: "result.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      purpose: "selected_unpublished",
    },
  });
  await service.completeUpload({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    assetId: created.asset.id,
    input: { width: 1200, height: 1200 },
  });

  const ticket = await service.createDownloadTicket({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    assetId: created.asset.id,
  });
  assert.equal(ticket.download.method, "GET");
  assert.equal(ticket.download.url, "https://download.example.test/signed");
  assert.equal(ticket.asset.originalName, "result.jpg");
});

test("reads only ready JPG or PNG bytes for the SHEIN upload boundary", async () => {
  const { service } = createService();
  const created = await service.createUploadTicket({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      originalName: "publish.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      purpose: "selected_unpublished",
    },
  });
  await service.completeUpload({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    assetId: created.asset.id,
    input: { width: 1200, height: 1200 },
  });

  const image = await service.readReadySheinImage({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    assetId: created.asset.id,
  });

  assert.equal(image.fileName, "publish.jpg");
  assert.equal(image.mimeType, "image/jpeg");
  assert.deepEqual(image.fileBytes, Buffer.from("jpeg"));
});

test("reads protected compliance photos with dimensions and certificate PDFs", async () => {
  const { service } = createService();
  const photo = await service.createUploadTicket({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      originalName: "package.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      purpose: "compliance_evidence",
    },
  });
  await service.completeUpload({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    assetId: photo.asset.id,
    input: { width: 1200, height: 1200 },
  });
  const evidence = await service.readReadyComplianceEvidence({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    assetId: photo.asset.id,
    kind: "photo",
  });
  assert.equal(evidence.fileName, "package.jpg");
  assert.equal(evidence.width, 1200);

  const { service: pdfService } = createService({
    storage: {
      bucket: "shein-media",
      createUploadUrl() {
        return { url: "https://upload.example.test/signed", headers: {}, expiresAt: "2026-07-31T10:10:00.000Z" };
      },
      async statObject() {
        return { sizeBytes: 1024, contentType: "application/pdf", etag: "etag-pdf" };
      },
      async getObject() {
        return { bytes: Buffer.from("pdf"), contentType: "application/pdf" };
      },
    },
  });
  const pdf = await pdfService.createUploadTicket({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      originalName: "1631.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      purpose: "compliance_evidence",
    },
  });
  await pdfService.completeUpload({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    assetId: pdf.asset.id,
  });
  const report = await pdfService.readReadyComplianceEvidence({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    assetId: pdf.asset.id,
    kind: "certificate",
  });
  assert.equal(report.mimeType, "application/pdf");
  assert.deepEqual(report.fileBytes, Buffer.from("pdf"));
});

test("expires legacy reusable creative sources after three days", async () => {
  const { service } = createService();
  const result = await service.createUploadTicket({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      originalName: "4060-living-room.jpg",
      contentType: "image/jpeg",
      sizeBytes: 2048,
      purpose: "reusable_source",
    },
  });

  assert.equal(result.asset.purpose, "reusable_source");
  assert.equal(result.asset.expiresAt, "2026-08-03T10:00:00.000Z");
});

test("accepts AVIF browser uploads without requiring browser conversion", async () => {
  const { service } = createService();
  const result = await service.createUploadTicket({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      originalName: "rug.avif",
      contentType: "image/avif",
      sizeBytes: 1024,
      purpose: "temporary_upload",
    },
  });

  assert.equal(result.asset.contentType, "image/avif");
  assert.match(result.asset.originalName, /\.avif$/);
});

test("rejects unsupported or oversized browser media before storage access", async () => {
  const { service } = createService({ maxUploadBytes: 1024 });
  await assert.rejects(
    service.createUploadTicket({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
      input: {
        originalName: "rug.gif",
        contentType: "image/gif",
        sizeBytes: 100,
      },
    }),
    (error) =>
      error instanceof MediaServiceError &&
      error.code === "UNSUPPORTED_MEDIA_TYPE",
  );
  await assert.rejects(
    service.createUploadTicket({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
      input: {
        originalName: "rug.jpg",
        contentType: "image/jpeg",
        sizeBytes: 2048,
      },
    }),
    (error) =>
      error instanceof MediaServiceError &&
      error.code === "MEDIA_TOO_LARGE",
  );
});

test("accepts PDF only for protected compliance evidence", async () => {
  const { service } = createService();
  const result = await service.createUploadTicket({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      originalName: "1631-report.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      purpose: "compliance_evidence",
    },
  });
  assert.equal(result.asset.contentType, "application/pdf");
  assert.equal(result.asset.expiresAt, null);

  await assert.rejects(
    service.createUploadTicket({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
      input: {
        originalName: "temporary.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
        purpose: "temporary_upload",
      },
    }),
    (error) =>
      error instanceof MediaServiceError &&
      error.code === "INVALID_MEDIA_PURPOSE",
  );
});
