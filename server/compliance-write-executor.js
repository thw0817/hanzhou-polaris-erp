import { createHash, timingSafeEqual } from "node:crypto";
import {
  buildAgencyBindBody,
  buildCertificateBindBody,
  buildWarningUpdateBody,
  SHEIN_COMPLIANCE_WRITE_PATHS,
} from "./compliance-write-contract.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function issue(code, message, extra = {}) {
  return { code, message, ...extra };
}

function confirmationMatches(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function verifyWriteConfirmationToken({ plan, secret, token } = {}) {
  if (!secret) return false;
  const expected = createWriteConfirmationToken({ plan, secret });
  return confirmationMatches(token, expected);
}

function assertBusinessWriteSuccess(writeRequest, result) {
  const payload = asObject(result?.payload);
  const info = asObject(payload.info);
  if (
    writeRequest.path === SHEIN_COMPLIANCE_WRITE_PATHS.warningUpdate &&
    asArray(info.failedList).length
  ) {
    const error = new Error("SHEIN 警告语更新存在失败的 SKC");
    error.code = "SHEIN_WRITE_PARTIAL_FAILURE";
    error.traceId = result?.diagnostics?.traceId || payload.traceId || null;
    error.response = {
      failedList: info.failedList,
      successList: asArray(info.successList),
    };
    throw error;
  }
}

export function compileComplianceWriteRequests({
  plans = [],
  now = Date.now(),
} = {}) {
  const requests = [];
  const blockers = [];
  for (const plan of asArray(plans)) {
    if (plan.status !== "ready") continue;
    for (const action of asArray(plan.actions)) {
      const base = {
        skc: plan.skc,
        actionType: action.type,
        requirementKey: action.requirementKey,
      };
      try {
        if (action.type === "certificate.bind_existing") {
          requests.push({
            ...base,
            method: "POST",
            path: SHEIN_COMPLIANCE_WRITE_PATHS.certificateBind,
            body: buildCertificateBindBody({
              poolSn: action.poolSn,
              skcNames: [plan.skc],
            }),
          });
        } else if (action.type === "agency.bind") {
          requests.push({
            ...base,
            method: "POST",
            path: SHEIN_COMPLIANCE_WRITE_PATHS.agencyBind,
            body: buildAgencyBindBody({
              agencyId: action.agencyId,
              agencyType: action.agencyType,
              skc: [plan.skc],
            }),
          });
        } else if (action.type === "warning.update") {
          requests.push({
            ...base,
            method: "POST",
            path: SHEIN_COMPLIANCE_WRITE_PATHS.warningUpdate,
            body: buildWarningUpdateBody({
              certificateTypeCode: action.certificateTypeCode,
              skcNames: [plan.skc],
              rules: action.rules,
              selectedByField: action.selectedByField,
            }),
          });
        } else if (action.type === "certificate.create_and_bind") {
          blockers.push(
            issue(
              "CERTIFICATE_CREATE_EXECUTION_NOT_READY",
              "证书创建需要先完成文件上传和动态字段组装，当前执行器不会猜测文件或字段",
              base,
            ),
          );
        } else if (action.type === "photo.upload_and_bind") {
          blockers.push(
            issue(
              "PHOTO_UPLOAD_RECEIPT_REQUIRED",
              "实拍图必须先上传并取得 SHEIN imageUrl、imageMd5，再按包装/商品本体分组绑定",
              base,
            ),
          );
        } else if (
          action.type === "certificate.recheck_store_scope" ||
          action.type === "agency.recheck_store_scope"
        ) {
          blockers.push(
            issue(
              "STORE_SCOPE_RECHECK_REQUIRED",
              "店铺级证书/代理公司需要先重新读取 SKC 状态，不能直接写入",
              base,
            ),
          );
        } else {
          blockers.push(
            issue("WRITE_ACTION_UNSUPPORTED", "当前写入动作没有安全构造器", base),
          );
        }
      } catch (error) {
        blockers.push(
          issue(error.code || "WRITE_REQUEST_INVALID", error.message, base),
        );
      }
    }
  }
  return {
    dryRun: true,
    generatedAt: new Date(now).toISOString(),
    executable: blockers.length === 0 && requests.length > 0,
    requests,
    blockers,
  };
}

export function createWriteConfirmationToken({
  plan,
  secret,
} = {}) {
  if (!secret) throw new TypeError("secret is required");
  return createHash("sha256")
    .update(`${secret}:${stableJson(plan)}`)
    .digest("hex");
}

export class ComplianceWriteExecutor {
  constructor({
    request,
    verify,
    enabled = false,
    confirmationSecret = "",
  } = {}) {
    if (typeof request !== "function") throw new TypeError("request is required");
    this.request = request;
    this.verify = verify;
    this.enabled = enabled === true;
    this.confirmationSecret = confirmationSecret;
  }

  async execute({
    plans = [],
    execute = false,
    confirmationToken = "",
  } = {}) {
    const writePlan = compileComplianceWriteRequests({ plans });
    if (!execute) {
      return {
        ...writePlan,
        mode: "dry-run",
        executed: false,
      };
    }
    if (!this.enabled) {
      return {
        ...writePlan,
        mode: "blocked",
        executed: false,
        blockers: [
          ...writePlan.blockers,
          issue(
            "WRITE_DISABLED",
            "真实合规写入开关未开启；当前环境只允许 dry-run",
          ),
        ],
      };
    }
    if (!writePlan.executable) {
      return {
        ...writePlan,
        mode: "blocked",
        executed: false,
      };
    }
    const expectedToken = createWriteConfirmationToken({
      plan: plans,
      secret: this.confirmationSecret,
    });
    if (!confirmationMatches(confirmationToken, expectedToken)) {
      return {
        ...writePlan,
        mode: "blocked",
        executed: false,
        blockers: [
          ...writePlan.blockers,
          issue(
            "CONFIRMATION_REQUIRED",
            "真实写入必须使用本次 dry-run 生成的确认令牌",
          ),
        ],
      };
    }
    const results = [];
    try {
      for (const request of writePlan.requests) {
        const result = await this.request(request);
        assertBusinessWriteSuccess(request, result);
        results.push({
          ...request,
          diagnostics: result?.diagnostics || null,
          payload: result?.payload || null,
        });
      }
    } catch (error) {
      return {
        ...writePlan,
        mode: "failed",
        executed: false,
        results,
        blockers: [
          ...writePlan.blockers,
          issue(
            error.code || "SHEIN_WRITE_FAILED",
            error.message || "SHEIN 合规写入失败",
            {
              traceId: error.traceId || null,
              response: error.response || null,
            },
          ),
        ],
      };
    }
    if (typeof this.verify !== "function") {
      return {
        ...writePlan,
        mode: "blocked",
        executed: false,
        results,
        blockers: [
          ...writePlan.blockers,
          issue(
            "READBACK_REQUIRED",
            "写入后必须重新查询合规要求和实拍图状态，未配置复核器",
          ),
        ],
      };
    }
    const verification = await this.verify({
      plans,
      requests: writePlan.requests,
      results,
    });
    return {
      ...writePlan,
      mode: "executed",
      executed: true,
      results,
      verification,
    };
  }
}
