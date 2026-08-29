import test from "node:test";
import assert from "node:assert/strict";
import {
  SHEIN_IMAGE_UPLOAD_PATH,
  SHEIN_PRICE_PROOF_UPLOAD_PATH,
  createSheinUploadTicket,
  uploadSheinCertificateDirect,
  uploadSheinCompliancePhotoDirect,
  uploadSheinImageDirect,
  uploadSheinPriceProofDirect,
} from "./shein-upload.js";
import { SHEIN_COMPLIANCE_WRITE_PATHS } from "./compliance-write-contract.js";

test("creates a short-lived allowlisted upload ticket without exposing secretKey", () => {
  const ticket = createSheinUploadTicket({
    baseUrl: "https://openapi.sheincorp.cn",
    openKeyId: "open-key",
    secretKey: "secret-key",
    now: () => 1_800_000_000_000,
    randomKey: "abc12",
  });

  assert.equal(ticket.path, SHEIN_IMAGE_UPLOAD_PATH);
  assert.equal(ticket.headers["x-lt-openKeyId"], "open-key");
  assert.match(ticket.headers["x-lt-signature"], /^abc12/);
  assert.equal(JSON.stringify(ticket).includes("secret-key"), false);
});

test("uploads multipart bytes directly and reports URL expiry", async () => {
  let captured;
  const result = await uploadSheinImageDirect({
    baseUrl: "https://openapi.sheincorp.cn",
    openKeyId: "open-key",
    secretKey: "secret-key",
    imageType: 1,
    fileBytes: Buffer.from("jpeg"),
    fileName: "test.jpg",
    mimeType: "image/jpeg",
    now: () => 1_800_000_000_000,
    randomKey: "abc12",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(
        JSON.stringify({
          code: "0",
          msg: "OK",
          info: {
            image_url: "https://img.example/test.jpg?Expires=1800000120",
            width: 1200,
            height: 1200,
            size: 4,
            image_hex_type: "jpg",
          },
          traceId: "trace-upload",
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(
    captured.url,
    `https://openapi.sheincorp.cn${SHEIN_IMAGE_UPLOAD_PATH}`,
  );
  assert.equal(captured.options.headers["Content-Type"], undefined);
  assert.equal(captured.options.body.get("image_type"), "1");
  assert.equal(result.diagnostics.transport, "desktop-local-agent");
  assert.equal(result.diagnostics.urlHasExpiry, true);
  assert.equal(result.diagnostics.traceId, "trace-upload");
});

test("creates a proof upload ticket from the allowlisted path", () => {
  const ticket = createSheinUploadTicket({
    baseUrl: "https://openapi.sheincorp.cn",
    openKeyId: "open-key",
    secretKey: "secret-key",
    path: SHEIN_PRICE_PROOF_UPLOAD_PATH,
    now: () => 1_800_000_000_000,
    randomKey: "abc12",
  });

  assert.equal(ticket.path, SHEIN_PRICE_PROOF_UPLOAD_PATH);
  assert.equal(ticket.headers["x-lt-openKeyId"], "open-key");
  assert.equal(JSON.stringify(ticket).includes("secret-key"), false);
});

test("uploads a price proof with type in the request query only", async () => {
  let captured;
  const result = await uploadSheinPriceProofDirect({
    baseUrl: "https://openapi.sheincorp.cn",
    openKeyId: "open-key",
    secretKey: "secret-key",
    proofType: 4,
    fileBytes: Buffer.from("%PDF"),
    fileName: "rrp.pdf",
    mimeType: "application/pdf",
    now: () => 1_800_000_000_000,
    randomKey: "abc12",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(
        JSON.stringify({
          code: "0",
          msg: "OK",
          info: {
            objectKey: "rrp-proof.pdf",
            url: "https://file.example/rrp-proof.pdf?X-Amz-Date=20270115T080000Z&X-Amz-Expires=604799",
          },
          traceId: "trace-proof",
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(
    captured.url,
    `https://openapi.sheincorp.cn${SHEIN_PRICE_PROOF_UPLOAD_PATH}?type=4`,
  );
  assert.equal(captured.options.headers["Content-Type"], undefined);
  assert.equal(captured.options.body.get("file").name, "rrp.pdf");
  assert.equal(result.diagnostics.proofType, 4);
  assert.equal(result.diagnostics.urlHasExpiry, true);
  assert.equal(result.diagnostics.urlExpirySource, "X-Amz-Expires");
  assert.equal(result.diagnostics.urlExpiresAt, "2027-01-22T07:59:59.000Z");
  assert.equal(result.diagnostics.traceId, "trace-proof");
});

test("rejects unsupported price proof file types before calling SHEIN", async () => {
  await assert.rejects(
    uploadSheinPriceProofDirect({
      baseUrl: "https://openapi.sheincorp.cn",
      openKeyId: "open-key",
      secretKey: "secret-key",
      proofType: 4,
      fileBytes: Buffer.from("sheet"),
      fileName: "rrp.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    /当前价格证明场景不支持此文件类型/,
  );
});

test("uploads a compliance certificate directly and keeps official file fields", async () => {
  let captured;
  const result = await uploadSheinCertificateDirect({
    baseUrl: "https://openapi.sheincorp.cn",
    openKeyId: "open-key",
    secretKey: "secret-key",
    fileBytes: Buffer.from("%PDF"),
    fileName: "1631-report.pdf",
    mimeType: "application/pdf",
    now: () => 1_800_000_000_000,
    randomKey: "abc12",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(
        JSON.stringify({
          code: "0",
          msg: "OK",
          info: {
            fileUrl: "https://file.example/1631-report.pdf",
            fileMd5: "2230eacf3617c2a4604758ea3ae871b9",
            fileName: "1631-report.pdf",
          },
          traceId: "trace-certificate",
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(
    captured.url,
    `https://openapi.sheincorp.cn${SHEIN_COMPLIANCE_WRITE_PATHS.certificateUpload}`,
  );
  assert.equal(captured.options.headers["Content-Type"], undefined);
  assert.equal(captured.options.body.get("file").name, "1631-report.pdf");
  assert.equal(result.payload.info.fileName, "1631-report.pdf");
  assert.equal(result.diagnostics.transport, "desktop-local-agent");
  assert.equal(result.diagnostics.traceId, "trace-certificate");
});

test("uploads a compliance photo as multipart and requires imageUrl plus imageMd5", async () => {
  let captured;
  const result = await uploadSheinCompliancePhotoDirect({
    baseUrl: "https://openapi.sheincorp.cn",
    openKeyId: "open-key",
    secretKey: "secret-key",
    fileBytes: Buffer.from("jpeg"),
    fileName: "package.jpg",
    mimeType: "image/jpeg",
    width: 1200,
    height: 900,
    now: () => 1_800_000_000_000,
    randomKey: "abc12",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({
        code: "0",
        msg: "OK",
        info: {
          imageUrl: "https://image.example/package.jpg",
          imageMd5: "f39f332f054cf958c9ba4367dce9b1d0",
          code: 0,
          msg: null,
        },
        traceId: "trace-photo",
      }), { status: 200 });
    },
  });

  assert.equal(
    captured.url,
    `https://openapi.sheincorp.cn${SHEIN_COMPLIANCE_WRITE_PATHS.photoUpload}`,
  );
  assert.equal(captured.options.headers["Content-Type"], undefined);
  assert.equal(captured.options.body.get("file").name, "package.jpg");
  assert.equal(result.payload.info.imageMd5, "f39f332f054cf958c9ba4367dce9b1d0");
  assert.equal(result.diagnostics.traceId, "trace-photo");
});

test("rejects an invalid compliance photo before calling SHEIN", async () => {
  let called = false;
  await assert.rejects(
    uploadSheinCompliancePhotoDirect({
      baseUrl: "https://openapi.sheincorp.cn",
      openKeyId: "open-key",
      secretKey: "secret-key",
      fileBytes: Buffer.alloc(10 * 1024 * 1024 + 1),
      fileName: "too-large.jpg",
      mimeType: "image/jpeg",
      width: 1200,
      height: 900,
      fetchImpl: async () => {
        called = true;
        return new Response("{}");
      },
    }),
    /10MB/,
  );
  assert.equal(called, false);
});
