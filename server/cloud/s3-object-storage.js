import crypto from "node:crypto";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha1(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function hmacSha1(key, value) {
  return crypto.createHmac("sha1", key).update(value).digest("hex");
}

function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeObjectKey(objectKey) {
  return String(objectKey)
    .split("/")
    .map(percentEncode)
    .join("/");
}

function amzTimestamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function normalizeHeaderValue(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

function requiredText(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name}不能为空`);
  return normalized;
}

function isTencentCosEndpoint(endpoint) {
  const hostname = endpoint.hostname.toLowerCase();
  return (
    hostname.includes(".cos.") &&
    (hostname.endsWith(".myqcloud.com") || hostname.endsWith(".tencentcos.cn"))
  );
}

function resolveSignatureVersion(signatureVersion, endpoint) {
  const normalized = String(signatureVersion || "auto").trim().toLowerCase();
  if (!["auto", "aws4", "cos"].includes(normalized)) {
    throw new TypeError("对象存储签名版本必须是auto、aws4或cos");
  }
  if (normalized === "auto") {
    return isTencentCosEndpoint(endpoint) ? "cos" : "aws4";
  }
  return normalized;
}

function formatCosEntries(entries) {
  return Object.entries(entries)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, value]) =>
        `${percentEncode(name.toLowerCase())}=${percentEncode(normalizeHeaderValue(value))}`,
    )
    .join("&");
}

export class S3ObjectStorage {
  constructor({
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    allowInsecureEndpoint = false,
    signatureVersion = "auto",
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
  } = {}) {
    this.endpoint = new URL(requiredText(endpoint, "对象存储Endpoint"));
    if (
      this.endpoint.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(this.endpoint.hostname) &&
      allowInsecureEndpoint !== true
    ) {
      throw new TypeError("对象存储Endpoint必须使用HTTPS");
    }
    this.region = requiredText(region, "对象存储Region");
    this.bucket = requiredText(bucket, "对象存储Bucket");
    this.accessKeyId = requiredText(accessKeyId, "对象存储AccessKeyId");
    this.secretAccessKey = requiredText(
      secretAccessKey,
      "对象存储SecretAccessKey",
    );
    this.signatureVersion = resolveSignatureVersion(
      signatureVersion,
      this.endpoint,
    );
    if (typeof fetchImpl !== "function") {
      throw new TypeError("对象存储缺少fetch实现");
    }
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  createPresignedUrl({
    method,
    objectKey,
    contentType = "",
    expiresInSeconds = 10 * 60,
  } = {}) {
    const normalizedMethod = requiredText(method, "HTTP方法").toUpperCase();
    const normalizedKey = requiredText(objectKey, "对象Key");
    const expiry = Number(expiresInSeconds);
    if (!Number.isInteger(expiry) || expiry < 60 || expiry > 3600) {
      throw new TypeError("预签名有效期必须在60到3600秒之间");
    }

    const signedAt = new Date(this.now());
    if (Number.isNaN(signedAt.getTime())) {
      throw new TypeError("签名时间无效");
    }
    if (this.signatureVersion === "cos") {
      return this.createCosPresignedUrl({
        normalizedMethod,
        normalizedKey,
        contentType,
        expiry,
        signedAt,
      });
    }
    return this.createAws4PresignedUrl({
      normalizedMethod,
      normalizedKey,
      contentType,
      expiry,
      signedAt,
    });
  }

  createAws4PresignedUrl({
    normalizedMethod,
    normalizedKey,
    contentType,
    expiry,
    signedAt,
  }) {
    const timestamp = amzTimestamp(signedAt);
    const dateStamp = timestamp.slice(0, 8);
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const url = new URL(this.endpoint);
    const endpointPath = url.pathname.replace(/\/+$/, "");
    url.pathname = `${endpointPath}/${encodeObjectKey(normalizedKey)}`;
    url.hash = "";
    url.search = "";

    const headers = {
      host: url.host,
    };
    if (contentType) {
      headers["content-type"] = normalizeHeaderValue(contentType);
    }
    const signedHeaderNames = Object.keys(headers).sort();
    const signedHeaders = signedHeaderNames.join(";");
    const canonicalHeaders = signedHeaderNames
      .map((name) => `${name}:${headers[name]}\n`)
      .join("");
    const query = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.accessKeyId}/${scope}`,
      "X-Amz-Date": timestamp,
      "X-Amz-Expires": String(expiry),
      "X-Amz-SignedHeaders": signedHeaders,
    };
    const canonicalQuery = Object.entries(query)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${percentEncode(name)}=${percentEncode(value)}`)
      .join("&");
    const canonicalRequest = [
      normalizedMethod,
      url.pathname,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      timestamp,
      scope,
      sha256(canonicalRequest),
    ].join("\n");
    const dateKey = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, this.region);
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = hmac(signingKey, stringToSign, "hex");
    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;

    return {
      url: url.toString(),
      headers: contentType ? { "Content-Type": headers["content-type"] } : {},
      expiresAt: new Date(signedAt.getTime() + expiry * 1000).toISOString(),
    };
  }

  createCosPresignedUrl({
    normalizedMethod,
    normalizedKey,
    contentType,
    expiry,
    signedAt,
  }) {
    const startTime = Math.floor(signedAt.getTime() / 1000);
    const keyTime = `${startTime};${startTime + expiry}`;
    const url = new URL(this.endpoint);
    const endpointPath = url.pathname.replace(/\/+$/, "");
    url.pathname = `${endpointPath}/${encodeObjectKey(normalizedKey)}`;
    url.hash = "";
    url.search = "";

    const headers = {
      host: url.host,
    };
    if (contentType) {
      headers["content-type"] = normalizeHeaderValue(contentType);
    }
    const signedHeaderNames = Object.keys(headers).sort();
    const signedHeaders = signedHeaderNames.join(";");
    const httpHeaders = formatCosEntries(headers);
    const httpString = [
      normalizedMethod.toLowerCase(),
      url.pathname,
      "",
      httpHeaders,
      "",
    ].join("\n");
    const stringToSign = [
      "sha1",
      keyTime,
      sha1(httpString),
      "",
    ].join("\n");
    const signKey = hmacSha1(this.secretAccessKey, keyTime);
    const signature = hmacSha1(signKey, stringToSign);
    const query = [
      ["q-sign-algorithm", "sha1"],
      ["q-ak", this.accessKeyId],
      ["q-sign-time", keyTime],
      ["q-key-time", keyTime],
      ["q-header-list", signedHeaders],
      ["q-url-param-list", ""],
      ["q-signature", signature],
    ];
    url.search = query
      .map(([name, value]) => `${percentEncode(name)}=${percentEncode(value)}`)
      .join("&");

    return {
      url: url.toString(),
      headers: contentType ? { "Content-Type": headers["content-type"] } : {},
      expiresAt: new Date(signedAt.getTime() + expiry * 1000).toISOString(),
    };
  }

  createUploadUrl({ objectKey, contentType, expiresInSeconds } = {}) {
    return this.createPresignedUrl({
      method: "PUT",
      objectKey,
      contentType,
      expiresInSeconds,
    });
  }

  createDownloadUrl({ objectKey, expiresInSeconds } = {}) {
    return this.createPresignedUrl({
      method: "GET",
      objectKey,
      expiresInSeconds,
    });
  }

  async getObject({ objectKey, maxBytes = 25 * 1024 * 1024 } = {}) {
    const signed = this.createPresignedUrl({
      method: "GET",
      objectKey,
      expiresInSeconds: 5 * 60,
    });
    const response = await this.fetchImpl(signed.url, {
      method: "GET",
      redirect: "error",
    });
    if (!response.ok) {
      const error = new Error(`对象存储下载失败 (${response.status})`);
      error.status = response.status;
      throw error;
    }
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      const error = new Error("对象存储图片超过服务端处理上限");
      error.status = 413;
      throw error;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      const error = new Error("对象存储图片超过服务端处理上限");
      error.status = 413;
      throw error;
    }
    return {
      bytes,
      contentType: response.headers.get("content-type") || "application/octet-stream",
      etag: (response.headers.get("etag") || "").replace(/^"|"$/g, ""),
    };
  }

  async putObject({ objectKey, bytes, contentType = "application/octet-stream" } = {}) {
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    if (!body.length) throw new TypeError("对象内容不能为空");
    const signed = this.createPresignedUrl({
      method: "PUT",
      objectKey,
      contentType,
      expiresInSeconds: 5 * 60,
    });
    const response = await this.fetchImpl(signed.url, {
      method: "PUT",
      headers: signed.headers,
      body,
      redirect: "error",
    });
    if (!response.ok) {
      const error = new Error(`对象存储写入失败 (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return {
      sizeBytes: body.length,
      contentType,
      etag: (response.headers.get("etag") || "").replace(/^"|"$/g, ""),
    };
  }

  async statObject({ objectKey } = {}) {
    const signed = this.createPresignedUrl({
      method: "HEAD",
      objectKey,
      expiresInSeconds: 5 * 60,
    });
    const response = await this.fetchImpl(signed.url, {
      method: "HEAD",
      redirect: "error",
    });
    if (!response.ok) {
      const error = new Error(`对象存储校验失败 (${response.status})`);
      error.status = response.status;
      throw error;
    }
    const sizeBytes = Number(response.headers.get("content-length"));
    return {
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
      contentType: response.headers.get("content-type") || "",
      etag: (response.headers.get("etag") || "").replace(/^"|"$/g, ""),
    };
  }

  async deleteObject({ objectKey } = {}) {
    const signed = this.createPresignedUrl({
      method: "DELETE",
      objectKey,
      expiresInSeconds: 5 * 60,
    });
    const response = await this.fetchImpl(signed.url, {
      method: "DELETE",
      redirect: "error",
    });
    if (!response.ok && response.status !== 404) {
      const error = new Error(`对象存储删除失败 (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return {
      deleted: true,
      alreadyMissing: response.status === 404,
    };
  }
}
