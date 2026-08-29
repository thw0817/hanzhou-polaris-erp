import { generateSheinSignature } from "./shein-crypto.js";
import { SheinApiError } from "./shein-client.js";
import {
  SHEIN_CERTIFICATE_MAX_BYTES,
  SHEIN_CERTIFICATE_MIME_TYPES,
  SHEIN_COMPLIANCE_PHOTO_MIME_TYPES,
  SHEIN_COMPLIANCE_WRITE_PATHS,
  buildPhotoUploadRequest,
} from "./compliance-write-contract.js";

export const SHEIN_IMAGE_UPLOAD_PATH = "/open-api/goods/upload-pic";
export const SHEIN_PRICE_PROOF_UPLOAD_PATH =
  "/open-api/goods/discuss/upload-discuss-file";
export const SHEIN_IMAGE_UPLOAD_TYPES = new Set([1, 2, 5, 6, 7]);
export const SHEIN_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const SHEIN_PRICE_PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const SHEIN_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
]);
export const SHEIN_PRICE_PROOF_TYPES = new Set([1, 4, 5]);
export const SHEIN_PRICE_PROOF_MIME_TYPES = new Map([
  [1, new Set(["image/jpeg", "image/png"])],
  [4, new Set(["image/jpeg", "image/png", "application/pdf"])],
  [
    5,
    new Set([
      "image/jpeg",
      "image/png",
      "application/pdf",
      "text/csv",
      "application/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]),
  ],
]);

const SHEIN_DIRECT_UPLOAD_PATHS = new Set([
  SHEIN_IMAGE_UPLOAD_PATH,
  SHEIN_PRICE_PROOF_UPLOAD_PATH,
  SHEIN_COMPLIANCE_WRITE_PATHS.certificateUpload,
  SHEIN_COMPLIANCE_WRITE_PATHS.photoUpload,
]);

export function createSheinUploadTicket({
  baseUrl,
  openKeyId,
  secretKey,
  path = SHEIN_IMAGE_UPLOAD_PATH,
  now = () => Date.now(),
  randomKey,
  lifetimeMs = 60_000,
}) {
  if (!SHEIN_DIRECT_UPLOAD_PATHS.has(path)) {
    throw new TypeError("上传签名接口不在允许列表中");
  }
  const timestamp = String(now());
  return {
    method: "POST",
    baseUrl,
    path,
    headers: {
      language: "zh-cn",
      "x-lt-openKeyId": openKeyId,
      "x-lt-timestamp": timestamp,
      "x-lt-signature": generateSheinSignature({
        openKeyId,
        secretKey,
        path,
        timestamp,
        randomKey,
      }),
    },
    expiresAt: new Date(Number(timestamp) + lifetimeMs).toISOString(),
  };
}

function inspectUrlExpiry(value) {
  if (!value) {
    return {
      urlHasExpiry: false,
      urlExpiresAt: null,
      urlExpirySource: null,
    };
  }
  try {
    const searchParams = new URL(value).searchParams;
    const expires = searchParams.get("Expires");
    if (expires) {
      const numeric = Number(expires);
      const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
      return {
        urlHasExpiry: Number.isFinite(milliseconds),
        urlExpiresAt: Number.isFinite(milliseconds)
          ? new Date(milliseconds).toISOString()
          : null,
        urlExpirySource: "Expires",
      };
    }

    const amzDate = searchParams.get("X-Amz-Date");
    const amzExpires = Number(searchParams.get("X-Amz-Expires"));
    const matchedDate = amzDate?.match(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    );
    const issuedAt = matchedDate
      ? Date.UTC(
          Number(matchedDate[1]),
          Number(matchedDate[2]) - 1,
          Number(matchedDate[3]),
          Number(matchedDate[4]),
          Number(matchedDate[5]),
          Number(matchedDate[6]),
        )
      : Number.NaN;
    const milliseconds = issuedAt + amzExpires * 1000;
    return {
      urlHasExpiry:
        Number.isFinite(issuedAt) &&
        Number.isFinite(amzExpires) &&
        amzExpires >= 0,
      urlExpiresAt:
        Number.isFinite(issuedAt) &&
        Number.isFinite(amzExpires) &&
        amzExpires >= 0
        ? new Date(milliseconds).toISOString()
        : null,
      urlExpirySource:
        Number.isFinite(issuedAt) &&
        Number.isFinite(amzExpires) &&
        amzExpires >= 0
          ? "X-Amz-Expires"
          : null,
    };
  } catch {
    return {
      urlHasExpiry: false,
      urlExpiresAt: null,
      urlExpirySource: null,
    };
  }
}

async function readUploadResponse({
  response,
  failureLabel,
  invalidResponseLabel,
}) {
  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new SheinApiError(invalidResponseLabel, {
      status: response.status,
    });
  }
  if (!response.ok || payload.code !== "0") {
    throw new SheinApiError(
      payload.msg || `${failureLabel} (${response.status})`,
      {
        status: response.status,
        code: payload.code,
        traceId: payload.traceId,
        response: payload,
      },
    );
  }
  return payload;
}

export async function uploadSheinImageDirect({
  baseUrl,
  openKeyId,
  secretKey,
  imageType,
  fileBytes,
  fileName,
  mimeType,
  fetchImpl = fetch,
  now = () => Date.now(),
  randomKey,
}) {
  const normalizedType = Number(imageType);
  if (!SHEIN_IMAGE_UPLOAD_TYPES.has(normalizedType)) {
    throw new TypeError("image_type 仅支持 1、2、5、6、7");
  }
  if (!SHEIN_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new TypeError("本地图片仅支持 JPG、JPEG、PNG");
  }
  if (!fileBytes?.length) throw new TypeError("未读取到图片文件");
  if (fileBytes.length > SHEIN_IMAGE_MAX_BYTES) {
    throw new TypeError("图片文件超过 SHEIN 规定的 3MB");
  }

  const ticket = createSheinUploadTicket({
    baseUrl,
    openKeyId,
    secretKey,
    now,
    randomKey,
  });
  const form = new FormData();
  form.append("image_type", String(normalizedType));
  form.append(
    "file",
    new Blob([fileBytes], { type: mimeType }),
    fileName || "upload.jpg",
  );

  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(`${ticket.baseUrl}${ticket.path}`, {
      method: ticket.method,
      headers: ticket.headers,
      body: form,
    });
  } catch (error) {
    throw new SheinApiError(`无法从本机直连 SHEIN：${error.message}`, {
      status: 502,
    });
  }

  const payload = await readUploadResponse({
    response,
    failureLabel: "SHEIN 图片上传失败",
    invalidResponseLabel: "SHEIN 图片上传返回了无法解析的响应",
  });

  return {
    payload,
    diagnostics: {
      transport: "desktop-local-agent",
      endpoint: ticket.path,
      requestBytes: fileBytes.length,
      durationMs: Date.now() - startedAt,
      traceId: payload.traceId || null,
      ticketExpiresAt: ticket.expiresAt,
      ...inspectUrlExpiry(payload.info?.image_url),
    },
  };
}

export async function uploadSheinPriceProofDirect({
  baseUrl,
  openKeyId,
  secretKey,
  proofType,
  fileBytes,
  fileName,
  mimeType,
  fetchImpl = fetch,
  now = () => Date.now(),
  randomKey,
}) {
  const normalizedType = Number(proofType);
  if (!SHEIN_PRICE_PROOF_TYPES.has(normalizedType)) {
    throw new TypeError("type 仅支持 1（议价）、4（建议零售价）、5（成本涨价）");
  }
  const allowedMimeTypes = SHEIN_PRICE_PROOF_MIME_TYPES.get(normalizedType);
  if (!allowedMimeTypes?.has(mimeType)) {
    throw new TypeError("当前价格证明场景不支持此文件类型");
  }
  if (!fileBytes?.length) throw new TypeError("未读取到证明文件");
  if (fileBytes.length > SHEIN_PRICE_PROOF_MAX_BYTES) {
    throw new TypeError("价格证明文件超过 SHEIN 规定的 10MB");
  }

  const ticket = createSheinUploadTicket({
    baseUrl,
    openKeyId,
    secretKey,
    path: SHEIN_PRICE_PROOF_UPLOAD_PATH,
    now,
    randomKey,
  });
  const form = new FormData();
  form.append(
    "file",
    new Blob([fileBytes], { type: mimeType }),
    fileName || "proof-file",
  );
  const query = new URLSearchParams({ type: String(normalizedType) });

  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(
      `${ticket.baseUrl}${ticket.path}?${query.toString()}`,
      {
        method: ticket.method,
        headers: ticket.headers,
        body: form,
      },
    );
  } catch (error) {
    throw new SheinApiError(`无法从本机直连 SHEIN：${error.message}`, {
      status: 502,
    });
  }

  const payload = await readUploadResponse({
    response,
    failureLabel: "SHEIN 价格证明上传失败",
    invalidResponseLabel: "SHEIN 价格证明上传返回了无法解析的响应",
  });

  return {
    payload,
    diagnostics: {
      transport: "desktop-local-agent",
      endpoint: ticket.path,
      proofType: normalizedType,
      requestBytes: fileBytes.length,
      durationMs: Date.now() - startedAt,
      traceId: payload.traceId || null,
      ticketExpiresAt: ticket.expiresAt,
      ...inspectUrlExpiry(payload.info?.url),
    },
  };
}

export async function uploadSheinCertificateDirect({
  baseUrl,
  openKeyId,
  secretKey,
  fileBytes,
  fileName,
  mimeType,
  fetchImpl = fetch,
  now = () => Date.now(),
  randomKey,
}) {
  if (!SHEIN_CERTIFICATE_MIME_TYPES.has(mimeType)) {
    throw new TypeError("资质证书仅支持 PDF、PNG、JPG、JPEG");
  }
  if (!fileBytes?.length) throw new TypeError("未读取到资质证书文件");
  if (fileBytes.length > SHEIN_CERTIFICATE_MAX_BYTES) {
    throw new TypeError("资质证书文件超过 SHEIN 规定的 20MB");
  }

  const ticket = createSheinUploadTicket({
    baseUrl,
    openKeyId,
    secretKey,
    path: SHEIN_COMPLIANCE_WRITE_PATHS.certificateUpload,
    now,
    randomKey,
  });
  const form = new FormData();
  form.append(
    "file",
    new Blob([fileBytes], { type: mimeType }),
    fileName || "certificate-file",
  );

  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(`${ticket.baseUrl}${ticket.path}`, {
      method: ticket.method,
      headers: ticket.headers,
      body: form,
    });
  } catch (error) {
    throw new SheinApiError(`无法从本机直传资质证书：${error.message}`, {
      status: 502,
    });
  }

  const payload = await readUploadResponse({
    response,
    failureLabel: "SHEIN 资质证书上传失败",
    invalidResponseLabel: "SHEIN 资质证书上传返回了无法解析的响应",
  });
  const info = payload.info || {};
  if (!info.fileUrl || !info.fileMd5 || !info.fileName) {
    throw new SheinApiError(
      "SHEIN 资质证书上传成功但未返回 fileUrl、fileMd5、fileName",
      {
        status: 502,
        code: payload.code,
        traceId: payload.traceId,
        response: payload,
      },
    );
  }

  return {
    payload,
    diagnostics: {
      transport: "desktop-local-agent",
      endpoint: ticket.path,
      requestBytes: fileBytes.length,
      durationMs: Date.now() - startedAt,
      traceId: payload.traceId || null,
      ticketExpiresAt: ticket.expiresAt,
      ...inspectUrlExpiry(info.fileUrl),
    },
  };
}

export async function uploadSheinCompliancePhotoDirect({
  baseUrl,
  openKeyId,
  secretKey,
  fileBytes,
  fileName,
  mimeType,
  width,
  height,
  fetchImpl = fetch,
  now = () => Date.now(),
  randomKey,
}) {
  if (!SHEIN_COMPLIANCE_PHOTO_MIME_TYPES.has(mimeType)) {
    throw new TypeError("合规实拍图仅支持 PNG、JPG、JPEG");
  }
  if (!fileBytes?.length) throw new TypeError("未读取到合规实拍图文件");
  buildPhotoUploadRequest({
    fileName: fileName || "compliance-photo.jpg",
    mimeType,
    size: fileBytes.length,
    width,
    height,
  });

  const ticket = createSheinUploadTicket({
    baseUrl,
    openKeyId,
    secretKey,
    path: SHEIN_COMPLIANCE_WRITE_PATHS.photoUpload,
    now,
    randomKey,
  });
  const form = new FormData();
  form.append(
    "file",
    new Blob([fileBytes], { type: mimeType }),
    fileName || "compliance-photo.jpg",
  );

  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(`${ticket.baseUrl}${ticket.path}`, {
      method: ticket.method,
      headers: ticket.headers,
      body: form,
    });
  } catch (error) {
    throw new SheinApiError(`无法从本机直传合规实拍图：${error.message}`, {
      status: 502,
    });
  }

  const payload = await readUploadResponse({
    response,
    failureLabel: "SHEIN 合规实拍图上传失败",
    invalidResponseLabel: "SHEIN 合规实拍图上传返回了无法解析的响应",
  });
  const info = payload.info || {};
  if (Number(info.code ?? 0) !== 0 || !info.imageUrl || !info.imageMd5) {
    throw new SheinApiError(
      info.msg || "SHEIN 合规实拍图上传成功但未返回 imageUrl、imageMd5",
      {
        status: 502,
        code: info.code ?? payload.code,
        traceId: payload.traceId,
        response: payload,
      },
    );
  }

  return {
    payload,
    diagnostics: {
      transport: "desktop-local-agent",
      endpoint: ticket.path,
      requestBytes: fileBytes.length,
      width,
      height,
      durationMs: Date.now() - startedAt,
      traceId: payload.traceId || null,
      ticketExpiresAt: ticket.expiresAt,
      ...inspectUrlExpiry(info.imageUrl),
    },
  };
}
