import { SheinApiError, requestShein } from "../shein-client.js";
import {
  SHEIN_COMPLIANCE_WRITE_PATHS,
  buildPhotoBindBody,
} from "../compliance-write-contract.js";
import { uploadSheinCompliancePhotoDirect } from "../shein-upload.js";
import { verifyProductRemotePublishCandidate } from "./product-remote-preflight.js";

export const PRODUCT_PUBLISH_PATH = "/open-api/goods/product/publishOrEdit";

const MANUALLY_RETRYABLE_CODES = new Set(["4000004"]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function jobField(job, camel, snake) {
  return job?.[camel] ?? job?.[snake];
}

function errorProjection(error, fallbackTraceId = null) {
  const projected = {
    code: error?.code == null ? null : text(error.code, 100),
    message: text(error?.message || "SHEIN商品发布失败", 1000),
    traceId: text(error?.traceId || fallbackTraceId, 200) || null,
  };
  if (Array.isArray(error?.details) && error.details.length) {
    projected.details = error.details.slice(0, 100);
  }
  return projected;
}

function compliancePhotoGroups(candidate) {
  const plan = object(candidate?.postPublishCompliancePhotos);
  const normalize = (value) => (Array.isArray(value) ? value : [])
    .map((photo) => ({
      assetId: text(photo?.assetId || photo?.localAssetRef, 200),
      name: text(photo?.name || photo?.fileName, 200),
    }))
    .filter((photo) => photo.assetId);
  return {
    package: normalize(plan.package),
    body: normalize(plan.body),
  };
}

function hasCompliancePhotos(groups) {
  return groups.package.length > 0 || groups.body.length > 0;
}

function validationMessage(info) {
  const preflight = Array.isArray(info.pre_valid_result)
    ? info.pre_valid_result
    : [];
  const preflightMessages = preflight.flatMap((row) =>
    [
      ...(Array.isArray(row?.messages) ? row.messages : []),
      row?.message,
    ]
  ).map((value) => text(value, 500)).filter(Boolean);
  const governanceMessages = (Array.isArray(info.mcc_valid_result)
    ? info.mcc_valid_result
    : [])
    .filter((row) => Number(row?.type) === 2)
    .map((row) => text(row?.message, 500))
    .filter(Boolean);
  const messages = [...preflightMessages, ...governanceMessages];
  return messages.join("；") || text(info.msg, 1000) || "SHEIN未受理商品发布";
}

function validationDetails(info) {
  const preflight = Array.isArray(info.pre_valid_result)
    ? info.pre_valid_result
    : [];
  const details = preflight.map((row) => {
    const location = [
      row?.form,
      row?.module,
      row?.field_name,
      row?.fieldName,
      row?.attribute_name,
      row?.attributeName,
      row?.skc_name,
      row?.sku_code,
    ].map((value) => text(value, 160)).filter(Boolean).join(" / ");
    const messages = [
      ...(Array.isArray(row?.messages) ? row.messages : []),
      row?.message,
    ].map((value) => text(value, 500)).filter(Boolean);
    const uniqueMessages = [...new Set(messages)];
    return uniqueMessages.length
      ? {
          source: "pre_valid_result",
          location: location || "SHEIN字段校验",
          messages: uniqueMessages,
        }
      : null;
  }).filter(Boolean);
  const governance = (Array.isArray(info.mcc_valid_result)
    ? info.mcc_valid_result
    : [])
    .filter((row) => Number(row?.type) === 2)
    .map((row) => {
      const messages = [
        ...(Array.isArray(row?.messages) ? row.messages : []),
        row?.message,
      ].map((value) => text(value, 500)).filter(Boolean);
      const uniqueMessages = [...new Set(messages)];
      return uniqueMessages.length
        ? { source: "mcc_valid_result", location: `type=${Number(row.type)}`, messages: uniqueMessages }
        : null;
    })
    .filter(Boolean);
  return [...details, ...governance].slice(0, 100);
}

function acceptedReceipt(payload, diagnostics) {
  const info = object(payload.info);
  if (payload.code !== "0" || info.success !== true) return null;
  const skcs = (Array.isArray(info.skc_list) ? info.skc_list : []).map((skc) => ({
    skcName: text(skc?.skc_name, 200),
    skus: (Array.isArray(skc?.sku_list) ? skc.sku_list : []).map((sku) => ({
      skuCode: text(sku?.sku_code, 200),
      supplierSku: text(sku?.supplier_sku, 200),
    })),
  }));
  const receipt = {
    success: true,
    spuName: text(info.spu_name, 200),
    version: text(info.version, 200),
    skcs,
    traceId: text(payload.traceId || diagnostics?.traceId, 200) || null,
  };
  if (
    !receipt.spuName ||
    !receipt.version ||
    !receipt.skcs.length ||
    receipt.skcs.some((skc) =>
      !skc.skcName ||
      !skc.skus.length ||
      skc.skus.some((sku) => !sku.skuCode || !sku.supplierSku)
    )
  ) {
    return null;
  }
  return receipt;
}

export class ProductPublishExecutorError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "ProductPublishExecutorError";
    this.code = code;
    this.status = status;
  }
}

export class WebProductPublishExecutor {
  constructor({
    storeRepository,
    apiBaseUrl,
    executionEnabled = false,
    request = requestShein,
    fetchImpl = fetch,
    mediaService = null,
    uploadCompliancePhoto = uploadSheinCompliancePhotoDirect,
    complianceWritesEnabled = false,
  } = {}) {
    if (!storeRepository) throw new Error("商品发布执行器缺少 storeRepository");
    if (!apiBaseUrl) throw new Error("商品发布执行器缺少 apiBaseUrl");
    if (typeof request !== "function") throw new Error("商品发布执行器缺少 request");
    this.storeRepository = storeRepository;
    this.apiBaseUrl = apiBaseUrl;
    this.executionEnabled = executionEnabled === true;
    this.request = request;
    this.fetchImpl = fetchImpl;
    this.mediaService = mediaService;
    this.uploadCompliancePhoto = uploadCompliancePhoto;
    this.complianceWritesEnabled = complianceWritesEnabled === true;
  }

  async submitCompliancePhotos({ tenantId, storeId, credential, remoteCandidate, receipt }) {
    const groups = compliancePhotoGroups(remoteCandidate);
    if (!hasCompliancePhotos(groups)) return receipt;
    const counts = {
      packageCount: groups.package.length,
      bodyCount: groups.body.length,
    };
    const failedReceipt = (error, extra = {}) => ({
      ...receipt,
      compliancePhotoSubmission: {
        status: "failed",
        code: text(error?.code, 100) || extra.code || "PRODUCT_PUBLISH_COMPLIANCE_PHOTO_FAILED",
        message: text(error?.message, 1000) || "商品提交已接受，但合规实拍图未能提交",
        traceId: text(error?.traceId || extra.traceId, 200) || null,
        retryable: false,
        ...counts,
      },
    });
    if (!this.complianceWritesEnabled) {
      return failedReceipt({
        code: "PRODUCT_PUBLISH_COMPLIANCE_PHOTO_DISABLED",
        message: "商品提交已接受，但合规实拍图写入开关尚未启用",
      });
    }
    if (!this.mediaService || typeof this.mediaService.readReadyComplianceEvidence !== "function") {
      return failedReceipt({
        code: "PRODUCT_PUBLISH_COMPLIANCE_PHOTO_MEDIA_UNAVAILABLE",
        message: "商品提交已接受，但服务器没有可读取合规实拍图的媒体存储配置",
      });
    }

    const uploadGroups = { package: [], body: [] };
    const uploadTraceIds = [];
    try {
      for (const groupName of ["package", "body"]) {
        for (const photo of groups[groupName]) {
          const media = await this.mediaService.readReadyComplianceEvidence({
            context: { tenantId },
            storeId,
            assetId: photo.assetId,
            kind: "photo",
          });
          const uploaded = await this.uploadCompliancePhoto({
            baseUrl: this.apiBaseUrl,
            openKeyId: credential.openKeyId,
            secretKey: credential.secretKey,
            fileBytes: media.fileBytes,
            fileName: media.fileName || photo.name || "compliance-photo.jpg",
            mimeType: media.mimeType,
            width: media.width,
            height: media.height,
            fetchImpl: this.fetchImpl,
          });
          const info = object(uploaded?.payload?.info);
          if (!text(info.imageUrl, 400) || !text(info.imageMd5, 100)) {
            throw new ProductPublishExecutorError(
              "PRODUCT_PUBLISH_COMPLIANCE_PHOTO_UPLOAD_INVALID",
              "SHEIN实拍图上传成功但未返回可绑定的图片地址或MD5",
            );
          }
          const uploadTraceId = text(uploaded?.payload?.traceId || uploaded?.diagnostics?.traceId, 200);
          if (uploadTraceId) uploadTraceIds.push(uploadTraceId);
          uploadGroups[groupName].push({
            imageUrl: text(info.imageUrl, 400),
            imageMd5: text(info.imageMd5, 100),
          });
        }
      }
      const bindResult = await this.request({
        baseUrl: this.apiBaseUrl,
        path: SHEIN_COMPLIANCE_WRITE_PATHS.photoBind,
        body: buildPhotoBindBody({
          skcList: receipt.skcs.map((skc) => skc.skcName),
          packageLableList: uploadGroups.package,
          bodyLableList: uploadGroups.body,
        }),
        openKeyId: credential.openKeyId,
        secretKey: credential.secretKey,
        timeoutMs: 60_000,
        fetchImpl: this.fetchImpl,
      });
      const bindPayload = object(bindResult?.payload);
      if (bindPayload.code !== "0") {
        throw new SheinApiError(
          text(bindPayload.msg, 1000) || "SHEIN实拍图绑定失败",
          {
            status: 502,
            code: bindPayload.code,
            traceId: bindPayload.traceId || bindResult?.diagnostics?.traceId,
            response: bindPayload,
          },
        );
      }
      return {
        ...receipt,
        compliancePhotoSubmission: {
          status: "passed",
          ...counts,
          skcCount: receipt.skcs.length,
          uploadTraceIds,
          bindTraceId: text(bindPayload.traceId || bindResult?.diagnostics?.traceId, 200) || null,
        },
      };
    } catch (error) {
      return failedReceipt(error, { uploadTraceIds });
    }
  }

  async execute({
    tenantId,
    storeId,
    job,
    claimId,
    remoteCandidate,
  } = {}) {
    if (!this.executionEnabled) {
      throw new ProductPublishExecutorError(
        "PRODUCT_PUBLISH_EXECUTION_DISABLED",
        "SHEIN商品真实发布执行尚未启用",
        503,
      );
    }
    if (
      text(jobField(job, "tenantId", "tenant_id")) !== text(tenantId) ||
      text(jobField(job, "storeId", "store_id")) !== text(storeId)
    ) {
      throw new ProductPublishExecutorError(
        "PRODUCT_PUBLISH_JOB_SCOPE_MISMATCH",
        "发布任务不属于当前租户店铺",
        403,
      );
    }
    if (
      job?.executionEnabled !== true ||
      job?.authorizesPublishing !== true ||
      text(job?.state) !== "claimed" ||
      text(jobField(job, "claimId", "claim_id")) !== text(claimId)
    ) {
      throw new ProductPublishExecutorError(
        "PRODUCT_PUBLISH_JOB_NOT_AUTHORIZED",
        "发布任务没有有效的执行授权或领取记录",
      );
    }
    const remoteFingerprint = text(remoteCandidate?.fingerprint, 64);
    const expectedRemoteFingerprint = text(
      jobField(job, "remoteCandidateFingerprint", "remote_candidate_fingerprint"),
      64,
    );
    const expectedSourceFingerprint = text(
      jobField(job, "sourceCandidateFingerprint", "source_candidate_fingerprint"),
      64,
    );
    if (
      !verifyProductRemotePublishCandidate(remoteCandidate) ||
      !remoteFingerprint ||
      remoteFingerprint !== expectedRemoteFingerprint ||
      (expectedSourceFingerprint &&
        text(remoteCandidate?.sourceCandidateFingerprint, 64) !==
          expectedSourceFingerprint)
    ) {
      throw new ProductPublishExecutorError(
        "PRODUCT_PUBLISH_CANDIDATE_INVALID",
        "发布候选快照无效、已变化或与执行任务不一致",
      );
    }

    const credential = await this.storeRepository.getCredential(storeId);
    if (
      !credential ||
      credential.tenantId !== tenantId ||
      credential.status !== "active" ||
      !credential.openKeyId ||
      !credential.secretKey
    ) {
      throw new ProductPublishExecutorError(
        "PRODUCT_PUBLISH_STORE_UNAVAILABLE",
        "店铺授权凭证不存在、已失效或不属于当前租户",
        409,
      );
    }

    try {
      const result = await this.request({
        baseUrl: this.apiBaseUrl,
        path: PRODUCT_PUBLISH_PATH,
        body: remoteCandidate.requestBody,
        openKeyId: credential.openKeyId,
        secretKey: credential.secretKey,
        timeoutMs: 60_000,
        fetchImpl: this.fetchImpl,
      });
      const payload = object(result?.payload);
      const receipt = acceptedReceipt(payload, result?.diagnostics);
      if (receipt) {
        const finalReceipt = await this.submitCompliancePhotos({
          tenantId,
          storeId,
          credential,
          remoteCandidate,
          receipt,
        });
        return { outcome: "accepted", retryable: false, receipt: finalReceipt };
      }
      const info = object(payload.info);
      if (payload.code !== "0" || info.success === false) {
        const code = text(payload.code, 100) || null;
        const details = validationDetails(info);
        return {
          outcome: "failed",
          retryable: MANUALLY_RETRYABLE_CODES.has(code),
          error: {
            code,
            message: info.success === false
              ? validationMessage(info)
              : text(payload.msg, 1000) || validationMessage(info),
            traceId: text(payload.traceId || result?.diagnostics?.traceId, 200) || null,
            ...(details.length ? { details } : {}),
          },
        };
      }
      return {
        outcome: "unknown",
        retryable: false,
        error: {
          code: null,
          message: "SHEIN返回成功状态但缺少完整SPU、SKC、SKU或审核版本，必须回读确认",
          traceId: text(payload.traceId || result?.diagnostics?.traceId, 200) || null,
        },
      };
    } catch (error) {
      const explicitResponse = error instanceof SheinApiError && Boolean(error.response);
      const projected = errorProjection(error);
      return {
        outcome: explicitResponse ? "failed" : "unknown",
        retryable: explicitResponse && MANUALLY_RETRYABLE_CODES.has(projected.code),
        error: projected,
      };
    }
  }
}
