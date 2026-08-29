import crypto from "node:crypto";
import { requestShein } from "../shein-client.js";
import {
  SHEIN_COMPLIANCE_WRITE_PATHS,
  buildCertificateBindBody,
  buildCertificatePresetInfoList,
  buildCertificateSaveBody,
  buildPhotoBindBody,
  parseCertificateBindResponse,
  parseCertificateSaveResponse,
  parsePhotoBindResponse,
} from "../compliance-write-contract.js";
import {
  uploadSheinCertificateDirect,
  uploadSheinCompliancePhotoDirect,
} from "../shein-upload.js";
import { WebAuthError } from "./web-auth.js";

const PHOTO_CONFIRMATION = "提交当前SKC实拍图";
const REPORT_CONFIRMATION = "提交当前SKC阻燃报告";
const ATTENTION_STATUSES = new Set([
  "失败",
  "待补充",
  "待提交",
  "未提交",
  "未处理",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function requiredText(value, message) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new ComplianceWriteError("INVALID_REQUEST", message, 400);
  }
  return normalized;
}

function mediaAssetId(value) {
  const matched = String(value || "").trim().match(/^media:([0-9a-f-]{36})$/i);
  if (!matched) {
    throw new ComplianceWriteError(
      "UNPROTECTED_COMPLIANCE_MEDIA",
      "合规素材必须来自当前店铺受保护的媒体库",
      409,
    );
  }
  return matched[1].toLowerCase();
}

function certificateIdentity(value) {
  return String(
    value?.certificateTypeId ?? value?.certificateTypeCode ?? "",
  );
}

function isFlammabilityReport(value) {
  const identity = [
    value?.certificateTypeCode,
    value?.certificateTypeName,
    value?.certificateType,
    value?.name,
  ].filter(Boolean).join(" ").toLowerCase();
  return identity.includes("1630") ||
    identity.includes("1631") ||
    identity.includes("smallcarpet") ||
    identity.includes("largecarpet");
}

function photoGroup(value) {
  if (String(value?.labelGroup || "") === "1" || value?.photoSlot === "product") {
    return "body";
  }
  if (
    String(value?.labelGroup || "") === "2" ||
    ["inner_package", "outer_package"].includes(value?.photoSlot)
  ) {
    return "package";
  }
  return null;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function freshSnapshot(snapshots, ruleType) {
  return asArray(snapshots).find(
    (snapshot) => snapshot.rule_type === ruleType && snapshot.fresh === true,
  );
}

function snapshotFingerprint(snapshot) {
  return String(snapshot?.fingerprint || "");
}

function requirementData(row) {
  return asObject(row?.requirement_data);
}

function reportDateFields(schema) {
  return [
    ...asArray(schema?.presetInfoList),
    ...asArray(schema?.otherPresetInfoList),
  ].filter(
    (field) => Number(field?.isEnabled ?? 1) === 1 && Number(field?.inputType) === 4,
  );
}

function errorMessage(error) {
  return String(error?.message || "SHEIN合规提交失败");
}

export class ComplianceWriteError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = "ComplianceWriteError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class WebComplianceWriteService {
  constructor({
    workspaceRepository,
    storeRepository,
    mediaService,
    complianceReader,
    complianceSync = null,
    apiBaseUrl,
    confirmationSecret,
    executionEnabled = false,
    fetchImpl = fetch,
    now = () => new Date(),
    request = requestShein,
    uploadCertificate = uploadSheinCertificateDirect,
    uploadPhoto = uploadSheinCompliancePhotoDirect,
  } = {}) {
    if (!workspaceRepository) throw new Error("合规写入服务缺少 workspaceRepository");
    if (!storeRepository) throw new Error("合规写入服务缺少 storeRepository");
    if (!mediaService) throw new Error("合规写入服务缺少 mediaService");
    if (!apiBaseUrl) throw new Error("合规写入服务缺少 apiBaseUrl");
    this.workspaceRepository = workspaceRepository;
    this.storeRepository = storeRepository;
    this.mediaService = mediaService;
    this.complianceReader = complianceReader;
    this.complianceSync = complianceSync;
    this.apiBaseUrl = apiBaseUrl;
    this.confirmationSecret = String(confirmationSecret || "");
    this.executionEnabled = executionEnabled === true && this.confirmationSecret.length >= 32;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.request = request;
    this.uploadCertificate = uploadCertificate;
    this.uploadPhoto = uploadPhoto;
    this.consumedTokens = new Set();
  }

  capabilities() {
    return {
      photoBindingDiagnostic: true,
      photoSubmit: this.executionEnabled,
      reportSubmit: this.executionEnabled,
    };
  }

  #assertActor(context, { requireExecution = true } = {}) {
    if (context?.role === "viewer") {
      throw new ComplianceWriteError(
        "COMPLIANCE_WRITE_FORBIDDEN",
        "当前角色不能向SHEIN提交合规资料",
        403,
      );
    }
    if (requireExecution && !this.executionEnabled) {
      throw new ComplianceWriteError(
        "COMPLIANCE_WRITE_DISABLED",
        "云端SHEIN合规真实提交尚未启用",
        503,
      );
    }
  }

  async #credential(context, storeId) {
    let credential;
    try {
      credential = await this.storeRepository.getCredential(storeId);
    } catch (error) {
      if (error?.code !== "CLOUD_CREDENTIAL_DECRYPT_FAILED") throw error;
      await this.storeRepository.requireReauthorizationByStoreId?.(storeId);
      throw new WebAuthError(
        "STORE_REAUTHORIZATION_REQUIRED",
        "店铺授权凭证无法解密，请重新授权该店铺",
        409,
      );
    }
    if (
      !credential ||
      credential.tenantId !== context.tenantId ||
      credential.status !== "active"
    ) {
      throw new WebAuthError(
        "STORE_UNAVAILABLE",
        "店铺凭证不存在、已失效或不属于当前工作空间",
        409,
      );
    }
    return credential;
  }

  async #workspace(context, storeId, skc) {
    const normalizedSkc = requiredText(skc, "SKC不能为空");
    const skcRow = await this.workspaceRepository.getSkc({
      tenantId: context.tenantId,
      storeId,
      skc: normalizedSkc,
    });
    if (!skcRow) {
      throw new ComplianceWriteError(
        "COMPLIANCE_SKC_NOT_FOUND",
        "当前店铺不存在该SKC合规缓存",
        404,
      );
    }
    const [records, snapshots, draft] = await Promise.all([
      this.workspaceRepository.listRecords({
        tenantId: context.tenantId,
        storeId,
        skcId: skcRow.id,
      }),
      this.workspaceRepository.listSnapshots({
        tenantId: context.tenantId,
        storeId,
        skc: normalizedSkc,
      }),
      this.workspaceRepository.getDraft({
        tenantId: context.tenantId,
        storeId,
        skc: normalizedSkc,
      }),
    ]);
    const requirementSnapshot = freshSnapshot(snapshots, "compliance_requirement");
    if (!requirementSnapshot) {
      throw new ComplianceWriteError(
        "FRESH_RULE_SNAPSHOT_REQUIRED",
        "缺少未过期的SHEIN合规要求快照，请先刷新合规数据",
        409,
      );
    }
    return {
      skc: normalizedSkc,
      skcRow,
      records,
      snapshots,
      draft,
      requirementSnapshot,
    };
  }

  #createToken(kind, planKey) {
    const expiresAt = this.now().getTime() + 5 * 60 * 1000;
    const nonce = crypto.randomBytes(12).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ kind, planKey, expiresAt, nonce }))
      .toString("base64url");
    const signature = crypto.createHmac("sha256", this.confirmationSecret)
      .update(payload)
      .digest("base64url");
    return `${payload}.${signature}`;
  }

  #consumeToken(token, kind, planKey) {
    const normalized = requiredText(token, "提交确认令牌不能为空");
    if (this.consumedTokens.has(normalized)) {
      throw new ComplianceWriteError(
        "COMPLIANCE_CONFIRMATION_REUSED",
        "提交确认已使用，请重新检查载荷",
        409,
      );
    }
    const [payload, signature] = normalized.split(".");
    if (!payload || !signature) {
      throw new ComplianceWriteError("COMPLIANCE_CONFIRMATION_INVALID", "提交确认无效", 409);
    }
    const expected = crypto.createHmac("sha256", this.confirmationSecret)
      .update(payload)
      .digest("base64url");
    const signatureBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (
      signatureBytes.length !== expectedBytes.length ||
      !crypto.timingSafeEqual(signatureBytes, expectedBytes)
    ) {
      throw new ComplianceWriteError("COMPLIANCE_CONFIRMATION_INVALID", "提交确认无效", 409);
    }
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new ComplianceWriteError("COMPLIANCE_CONFIRMATION_INVALID", "提交确认无效", 409);
    }
    if (
      decoded.kind !== kind ||
      decoded.planKey !== planKey ||
      Number(decoded.expiresAt) < this.now().getTime()
    ) {
      throw new ComplianceWriteError(
        "COMPLIANCE_CONFIRMATION_STALE",
        "提交载荷或规则已变化，请重新检查后确认",
        409,
      );
    }
    this.consumedTokens.add(normalized);
  }

  async #startReadback(context, storeId) {
    if (!this.complianceSync?.startSync) {
      return { job: null, warning: "合规写入成功，但云端状态同步服务未启用" };
    }
    try {
      const result = await this.complianceSync.startSync({ context, storeId });
      return { job: result.job || null, warning: null };
    } catch (error) {
      return { job: null, warning: errorMessage(error) };
    }
  }

  async #photoPlan({ context, storeId, skc }) {
    const workspace = await this.#workspace(context, storeId, skc);
    if (!workspace.draft) {
      throw new ComplianceWriteError(
        "PHOTO_DRAFT_REQUIRED",
        "请先上传实拍图并保存当前SKC资料",
        409,
      );
    }
    const records = asArray(workspace.records).filter((record) =>
      ["body_photo", "package_photo"].includes(record.requirement_type),
    );
    const needsBody = records.some(
      (record) => record.requirement_type === "body_photo" && record.required === true && ATTENTION_STATUSES.has(String(record.status)),
    );
    const needsPackage = records.some(
      (record) => record.requirement_type === "package_photo" && record.required === true && ATTENTION_STATUSES.has(String(record.status)),
    );
    if (!needsBody && !needsPackage) {
      throw new ComplianceWriteError(
        "PHOTO_NO_FAILED_GROUP",
        "当前SKC没有失败或待补充的实拍图分组，无需重复提交",
        409,
      );
    }
    const photos = asArray(workspace.draft.inputs?.photos).filter((photo) => {
      const group = photoGroup(photo);
      return (group === "body" && needsBody) || (group === "package" && needsPackage);
    });
    const bodyPhotos = photos.filter((photo) => photoGroup(photo) === "body");
    const packagePhotos = photos.filter((photo) => photoGroup(photo) === "package");
    if ((needsBody && !bodyPhotos.length) || (needsPackage && !packagePhotos.length)) {
      throw new ComplianceWriteError(
        "PHOTO_REQUIRED_GROUP_MISSING",
        "请先补齐当前失败分组所需的实拍图",
        422,
      );
    }
    if (bodyPhotos.length > 15 || packagePhotos.length > 15) {
      throw new ComplianceWriteError(
        "PHOTO_GROUP_LIMIT_EXCEEDED",
        "商品本体实拍图和商品包装实拍图每组最多15张",
        422,
      );
    }
    const normalized = photos.map((photo) => ({
      group: photoGroup(photo),
      assetId: mediaAssetId(photo.localAssetRef),
      fileName: String(photo.fileName || ""),
    }));
    const planKey = fingerprint({
      kind: "photo",
      skc: workspace.skc,
      draftUpdatedAt: workspace.draft.updated_at,
      requirementFingerprint: snapshotFingerprint(workspace.requirementSnapshot),
      photos: normalized,
    });
    return { ...workspace, photos: normalized, needsBody, needsPackage, planKey };
  }

  async checkPhotos({ context, storeId, skc }) {
    this.#assertActor(context, { requireExecution: false });
    const plan = await this.#photoPlan({ context, storeId, skc });
    const bodyCount = plan.photos.filter((photo) => photo.group === "body").length;
    const packageCount = plan.photos.filter((photo) => photo.group === "package").length;
    return {
      externalWrite: false,
      requestPath: SHEIN_COMPLIANCE_WRITE_PATHS.photoBind,
      uploadPath: SHEIN_COMPLIANCE_WRITE_PATHS.photoUpload,
      skc: plan.skc,
      groups: {
        body: bodyCount,
        package: packageCount,
      },
      status: "candidate_only",
      fields: {
        skc: plan.skc,
        bindBodyAfterUpload: {
          skcList: [plan.skc],
          ...(packageCount ? { packageLableList: Array(packageCount).fill({ imageUrl: "<由上传接口返回>", imageMd5: "<由上传接口返回>" }) } : {}),
          ...(bodyCount ? { bodyLableList: Array(bodyCount).fill({ imageUrl: "<由上传接口返回>", imageMd5: "<由上传接口返回>" }) } : {}),
        },
      },
      missingOfficialFields: [
        "SHEIN未提供历史图片删除字段；重新绑定不承诺删除旧图",
      ],
      checks: [{
        officialGroup: "product",
        label: "商品本体实拍图",
        labelGroup: "1",
        labelIds: [],
        localPhotoCount: bodyCount,
        status: bodyCount ? "candidate" : "not_selected",
        message: bodyCount ? `将提交${bodyCount}张到bodyLableList` : "本次不提交商品本体实拍图",
      }, {
        officialGroup: "package",
        label: "商品包装实拍图",
        labelGroup: "2",
        labelIds: [],
        localPhotoCount: packageCount,
        status: packageCount ? "candidate" : "not_selected",
        message: packageCount ? `将提交${packageCount}张到packageLableList` : "本次不提交商品包装实拍图",
      }],
      ...(this.executionEnabled ? {
        confirmationToken: this.#createToken("photo", plan.planKey),
        confirmation: PHOTO_CONFIRMATION,
      } : {}),
      historyMutation: "not_documented",
    };
  }

  async submitPhotos({ context, storeId, skc, input = {} }) {
    this.#assertActor(context);
    if (String(input.confirmation || "") !== PHOTO_CONFIRMATION) {
      throw new ComplianceWriteError(
        "PHOTO_SUBMIT_CONFIRMATION_REQUIRED",
        "提交前必须确认当前SKC和实拍图分组",
        409,
      );
    }
    const plan = await this.#photoPlan({ context, storeId, skc });
    this.#consumeToken(input.confirmationToken, "photo", plan.planKey);
    const credential = await this.#credential(context, storeId);
    const packageLableList = [];
    const bodyLableList = [];
    const uploads = [];
    for (const photo of plan.photos) {
      const media = await this.mediaService.readReadyComplianceEvidence({
        context,
        storeId,
        assetId: photo.assetId,
        kind: "photo",
      });
      const uploaded = await this.uploadPhoto({
        baseUrl: this.apiBaseUrl,
        openKeyId: credential.openKeyId,
        secretKey: credential.secretKey,
        fileBytes: media.fileBytes,
        fileName: media.fileName,
        mimeType: media.mimeType,
        width: media.width,
        height: media.height,
        fetchImpl: this.fetchImpl,
      });
      const receipt = {
        imageUrl: String(uploaded.payload.info.imageUrl),
        imageMd5: String(uploaded.payload.info.imageMd5),
      };
      if (photo.group === "package") packageLableList.push(receipt);
      else bodyLableList.push(receipt);
      uploads.push({
        group: photo.group,
        fileName: media.fileName,
        traceId: uploaded.diagnostics?.traceId || null,
      });
    }
    const bindBody = buildPhotoBindBody({
      skcList: [plan.skc],
      packageLableList,
      bodyLableList,
    });
    const bound = await this.request({
      baseUrl: this.apiBaseUrl,
      path: SHEIN_COMPLIANCE_WRITE_PATHS.photoBind,
      body: bindBody,
      openKeyId: credential.openKeyId,
      secretKey: credential.secretKey,
      timeoutMs: 60_000,
      fetchImpl: this.fetchImpl,
    });
    const info = parsePhotoBindResponse(bound.payload);
    const readback = await this.#startReadback(context, storeId);
    return {
      ok: true,
      externalWrite: true,
      mode: "executed",
      info,
      traceId: info.traceId,
      uploads,
      readbackJob: readback.job,
      readbackWarning: readback.warning,
      historyMutation: "not_documented",
    };
  }

  async #reportPlan({ context, storeId, skc, assignment }) {
    const workspace = await this.#workspace(context, storeId, skc);
    const value = asObject(assignment);
    if (!isFlammabilityReport(value)) {
      throw new ComplianceWriteError(
        "COMPLIANCE_REPORT_TYPE_INVALID",
        "当前接口只接受1630/1631当前SKC单独报告",
        422,
      );
    }
    const requirementPayload = asObject(workspace.requirementSnapshot.payload);
    const requirement = asArray(requirementPayload.certificateRequirements).find(
      (candidate) => certificateIdentity(candidate) === certificateIdentity(value),
    );
    if (!requirement || !isFlammabilityReport(requirement)) {
      throw new ComplianceWriteError(
        "COMPLIANCE_REPORT_NOT_REQUIRED",
        "当前SHEIN合规要求未返回该1630/1631报告类型",
        409,
      );
    }
    if (Number(requirement.isRequired) !== 1) {
      throw new ComplianceWriteError(
        "COMPLIANCE_REPORT_NOT_REQUIRED",
        Number(requirement.isRequired) === 10
          ? "当前1630/1631要求仍在确认中，请刷新后再提交"
          : "当前SKC无需提交该1630/1631报告",
        409,
      );
    }
    if (Number(requirement.reviewState) === 1) {
      throw new ComplianceWriteError(
        "COMPLIANCE_REPORT_IN_REVIEW",
        "当前1630/1631报告正在审核中，请勿重复提交",
        409,
      );
    }
    if (Number(requirement.reviewState) === 2) {
      throw new ComplianceWriteError(
        "COMPLIANCE_REPORT_ALREADY_PASSED",
        "当前1630/1631报告已审核通过，无需重复提交",
        409,
      );
    }
    const schemaSnapshot = freshSnapshot(workspace.snapshots, "certificate_schema");
    const schema = asArray(asObject(schemaSnapshot?.payload).certificateSchemas).find(
      (candidate) => certificateIdentity(candidate) === certificateIdentity(requirement),
    );
    if (!schemaSnapshot || !schema || Number(schema.isEnabled) !== 1) {
      throw new ComplianceWriteError(
        "CERTIFICATE_SCHEMA_REQUIRED",
        "缺少当前报告类型未过期且启用的SHEIN填写规则",
        409,
      );
    }
    if (Number(schema.certificateDimension) !== 1) {
      throw new ComplianceWriteError(
        "REPORT_DIMENSION_INVALID",
        "1630/1631必须按当前SKC单独创建并绑定",
        409,
      );
    }
    const dateFields = reportDateFields(schema);
    if (!dateFields.length) {
      throw new ComplianceWriteError(
        "REPORT_DATE_SCHEMA_MISSING",
        "SHEIN填写规则没有返回可绑定的报告日期字段，已阻止猜测提交",
        409,
      );
    }
    const fieldValues = asObject(value.fieldValues);
    if (!dateFields.some((field) => String(fieldValues[String(field.presetId)]?.value || "").trim())) {
      throw new ComplianceWriteError(
        "REPORT_DATE_REQUIRED",
        "请填写1630/1631报告日期",
        422,
      );
    }
    const files = asArray(value.files).map((file) => ({
      assetId: mediaAssetId(file?.localAssetRef),
      fileName: String(file?.fileName || ""),
    }));
    if (!files.length) {
      throw new ComplianceWriteError(
        "CERTIFICATE_FILE_REQUIRED",
        "请先上传当前SKC的1630/1631报告",
        422,
      );
    }
    const presetInfoList = buildCertificatePresetInfoList({ schema, fieldValues });
    const normalizedAssignment = {
      certificateTypeCode: String(requirement.certificateTypeCode || ""),
      certificateDimension: Number(schema.certificateDimension),
      files,
      presetInfoList,
    };
    const planKey = fingerprint({
      kind: "report",
      skc: workspace.skc,
      requirementFingerprint: snapshotFingerprint(workspace.requirementSnapshot),
      schemaFingerprint: snapshotFingerprint(schemaSnapshot),
      assignment: normalizedAssignment,
    });
    return {
      ...workspace,
      schemaSnapshot,
      requirement,
      schema,
      assignment: normalizedAssignment,
      planKey,
    };
  }

  async checkReport({ context, storeId, skc, input = {} }) {
    this.#assertActor(context);
    const plan = await this.#reportPlan({
      context,
      storeId,
      skc,
      assignment: input.assignment,
    });
    return {
      externalWrite: false,
      skc: plan.skc,
      reportType: String(plan.requirement.certificateTypeName || "1630/1631"),
      uploadPath: SHEIN_COMPLIANCE_WRITE_PATHS.certificateUpload,
      savePath: SHEIN_COMPLIANCE_WRITE_PATHS.certificateSave,
      bindPath: SHEIN_COMPLIANCE_WRITE_PATHS.certificateBind,
      fileCount: plan.assignment.files.length,
      fieldCount: plan.assignment.presetInfoList.length,
      confirmationToken: this.#createToken("report", plan.planKey),
      confirmation: REPORT_CONFIRMATION,
    };
  }

  async submitReport({ context, storeId, skc, input = {} }) {
    this.#assertActor(context);
    if (String(input.confirmation || "") !== REPORT_CONFIRMATION) {
      throw new ComplianceWriteError(
        "REPORT_SUBMIT_CONFIRMATION_REQUIRED",
        "提交前必须确认当前SKC、报告类型和报告日期",
        409,
      );
    }
    const plan = await this.#reportPlan({
      context,
      storeId,
      skc,
      assignment: input.assignment,
    });
    this.#consumeToken(input.confirmationToken, "report", plan.planKey);
    const credential = await this.#credential(context, storeId);
    const fileList = [];
    const uploads = [];
    for (const file of plan.assignment.files) {
      const media = await this.mediaService.readReadyComplianceEvidence({
        context,
        storeId,
        assetId: file.assetId,
        kind: "certificate",
      });
      const uploaded = await this.uploadCertificate({
        baseUrl: this.apiBaseUrl,
        openKeyId: credential.openKeyId,
        secretKey: credential.secretKey,
        fileBytes: media.fileBytes,
        fileName: media.fileName,
        mimeType: media.mimeType,
        fetchImpl: this.fetchImpl,
      });
      fileList.push({
        fileUrl: String(uploaded.payload.info.fileUrl),
        fileMd5: String(uploaded.payload.info.fileMd5),
        fileName: String(uploaded.payload.info.fileName || media.fileName),
      });
      uploads.push({
        fileName: media.fileName,
        traceId: uploaded.diagnostics?.traceId || null,
      });
    }
    const saveBody = buildCertificateSaveBody({
      certificateTypeCode: plan.assignment.certificateTypeCode,
      certificateDimension: plan.assignment.certificateDimension,
      fileList,
      presetInfoList: plan.assignment.presetInfoList,
    });
    const saved = await this.request({
      baseUrl: this.apiBaseUrl,
      path: SHEIN_COMPLIANCE_WRITE_PATHS.certificateSave,
      body: saveBody,
      openKeyId: credential.openKeyId,
      secretKey: credential.secretKey,
      timeoutMs: 60_000,
      fetchImpl: this.fetchImpl,
    });
    const saveReceipt = parseCertificateSaveResponse(saved.payload);
    const bindBody = buildCertificateBindBody({
      poolSn: saveReceipt.poolSn,
      skcNames: [plan.skc],
    });
    const bound = await this.request({
      baseUrl: this.apiBaseUrl,
      path: SHEIN_COMPLIANCE_WRITE_PATHS.certificateBind,
      body: bindBody,
      openKeyId: credential.openKeyId,
      secretKey: credential.secretKey,
      timeoutMs: 60_000,
      fetchImpl: this.fetchImpl,
    });
    const bindReceipt = parseCertificateBindResponse(bound.payload);
    const readback = await this.#startReadback(context, storeId);
    return {
      ok: true,
      externalWrite: true,
      mode: "executed",
      skc: plan.skc,
      poolSn: saveReceipt.poolSn,
      uploads,
      saveTraceId: saveReceipt.traceId,
      bindTraceId: bindReceipt.traceId,
      readbackJob: readback.job,
      readbackWarning: readback.warning,
    };
  }
}
