import { createRuleFingerprint } from "./rule-snapshot-service.js";

export const EXECUTION_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
export const EXECUTION_REQUEST_CLAIM_TTL_MS = 2 * 60 * 1000;

export class PublishExecutionProtocolError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "PublishExecutionProtocolError";
    this.code = code;
    this.status = status;
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function isoTime(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${fieldName}必须是有效时间`);
  }
  return date.toISOString();
}

function requestByKey(protocol, requestKey) {
  const requests = Array.isArray(protocol?.requests) ? protocol.requests : [];
  const index = requests.findIndex((request) => request.requestKey === requestKey);
  if (index < 0) {
    throw new PublishExecutionProtocolError(
      "EXECUTION_REQUEST_NOT_FOUND",
      "执行计划中不存在该请求",
      404,
    );
  }
  return { request: requests[index], index };
}

function replaceRequest(protocol, index, request) {
  const requests = [...protocol.requests];
  requests[index] = request;
  return { ...protocol, requests };
}

function refreshCompletion(protocol, completedAt) {
  if (
    protocol.state !== "running" ||
    !protocol.requests.length ||
    protocol.requests.some((request) => request.state !== "completed")
  ) {
    return protocol;
  }
  return {
    ...protocol,
    state: "completed",
    completedAt,
  };
}

export function buildPublishExecutionProtocol({
  batchId,
  plan,
  authorizedAt,
  authorizedBy,
  authorizationId,
  authorizationTtlMs = EXECUTION_AUTHORIZATION_TTL_MS,
} = {}) {
  const normalizedPlan = asObject(plan);
  const requests = Array.isArray(normalizedPlan.requests)
    ? normalizedPlan.requests
    : [];
  if (
    normalizedPlan.state !== "ready_for_execution_confirmation" ||
    !normalizedPlan.fingerprint ||
    normalizedPlan.executionEnabled !== false ||
    normalizedPlan.authorizesPublishing !== false ||
    !requests.length
  ) {
    throw new PublishExecutionProtocolError(
      "EXECUTION_PLAN_NOT_READY",
      "当前执行计划不能生成一次性授权协议",
    );
  }
  const issuedAt = isoTime(authorizedAt, "authorizedAt");
  const ttlMs = Number(authorizationTtlMs);
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new TypeError("authorizationTtlMs必须是正整数");
  }
  const expiresAt = new Date(new Date(issuedAt).getTime() + ttlMs).toISOString();
  const stableAuthorization = {
    batchId: String(batchId || ""),
    executionPlanFingerprint: normalizedPlan.fingerprint,
    authorizationId: String(authorizationId || ""),
    authorizedAt: issuedAt,
    expiresAt,
    authorizedBy: String(authorizedBy || ""),
  };
  if (
    !stableAuthorization.batchId ||
    !stableAuthorization.authorizationId ||
    !stableAuthorization.authorizedBy
  ) {
    throw new TypeError("一次性授权协议缺少批次、授权人或授权ID");
  }
  return {
    state: "issued",
    ...stableAuthorization,
    fingerprint: createRuleFingerprint(stableAuthorization),
    singleUse: true,
    consumedAt: null,
    executionRunId: null,
    completedAt: null,
    requestClaimTtlMs: EXECUTION_REQUEST_CLAIM_TTL_MS,
    requests: requests.map((request) => ({
      requestKey: request.requestKey,
      itemId: request.itemId,
      draftId: request.draftId,
      state: "authorized",
      attemptCount: 0,
      claim: null,
      receipt: null,
      lastError: null,
      readback: {
        receive: "pending",
        audit: "pending",
        documentStateQuery: "not_started",
        spu: "blocked_until_audit_approved",
        compliance: "blocked_until_spu_readback",
      },
    })),
    retryPolicy: {
      knownFailure: "retry_failed_request_only",
      unknownResult: "recover_by_webhook_or_query_document_state",
      automaticRetryAfterUnknownResult: false,
    },
    completionCriteria: [
      "publish_response_persisted",
      "receive_notice_confirmed",
      "audit_approved",
      "spu_relationships_read_back",
      "skc_compliance_revalidated",
    ],
    executionEnabled: false,
    authorizesPublishing: false,
  };
}

export function isPublishExecutionAuthorizationActive(protocol, now) {
  return (
    protocol?.state === "issued" &&
    protocol?.singleUse === true &&
    protocol?.consumedAt === null &&
    new Date(protocol.expiresAt).getTime() > new Date(now).getTime()
  );
}

export function consumePublishExecutionAuthorization(
  protocol,
  { executionRunId, consumedAt } = {},
) {
  const consumedAtIso = isoTime(consumedAt, "consumedAt");
  if (protocol?.state === "running") {
    if (protocol.executionRunId === executionRunId) return protocol;
    throw new PublishExecutionProtocolError(
      "EXECUTION_AUTHORIZATION_CONSUMED",
      "一次性执行授权已被其他执行任务使用",
    );
  }
  if (!isPublishExecutionAuthorizationActive(protocol, consumedAtIso)) {
    throw new PublishExecutionProtocolError(
      "EXECUTION_AUTHORIZATION_EXPIRED",
      "一次性执行授权已过期，请重新确认当前执行计划",
    );
  }
  if (!executionRunId) {
    throw new TypeError("executionRunId不能为空");
  }
  return {
    ...protocol,
    state: "running",
    consumedAt: consumedAtIso,
    executionRunId,
  };
}

export function claimPublishExecutionRequest(
  protocol,
  { executionRunId, requestKey, claimId, workerId, claimedAt } = {},
) {
  if (
    protocol?.state !== "running" ||
    protocol.executionRunId !== executionRunId
  ) {
    throw new PublishExecutionProtocolError(
      "EXECUTION_RUN_NOT_ACTIVE",
      "当前执行任务没有有效的一次性授权",
    );
  }
  const { request, index } = requestByKey(protocol, requestKey);
  if (request.state === "claimed") {
    if (request.claim?.claimId === claimId) return protocol;
    throw new PublishExecutionProtocolError(
      "EXECUTION_REQUEST_ALREADY_CLAIMED",
      "该发布请求已被领取，不能并发执行",
    );
  }
  if (!["authorized", "failed_retryable"].includes(request.state)) {
    throw new PublishExecutionProtocolError(
      "EXECUTION_REQUEST_NOT_CLAIMABLE",
      request.state === "result_unknown"
        ? "请求结果未知，必须先通过通知或商品文档状态查询恢复"
        : "该发布请求当前不可领取",
    );
  }
  if (!claimId || !workerId) {
    throw new TypeError("claimId和workerId不能为空");
  }
  const claimedAtIso = isoTime(claimedAt, "claimedAt");
  const claimExpiresAt = new Date(
    new Date(claimedAtIso).getTime() + protocol.requestClaimTtlMs,
  ).toISOString();
  return replaceRequest(protocol, index, {
    ...request,
    state: "claimed",
    attemptCount: Number(request.attemptCount || 0) + 1,
    claim: {
      claimId,
      workerId,
      claimedAt: claimedAtIso,
      expiresAt: claimExpiresAt,
    },
    lastError: null,
  });
}

export function recordPublishExecutionResult(
  protocol,
  {
    executionRunId,
    requestKey,
    claimId,
    outcome,
    recordedAt,
    retryable = false,
    receipt = null,
    error = null,
  } = {},
) {
  if (
    protocol?.state !== "running" ||
    protocol.executionRunId !== executionRunId
  ) {
    throw new PublishExecutionProtocolError(
      "EXECUTION_RUN_NOT_ACTIVE",
      "当前执行任务没有有效的一次性授权",
    );
  }
  const { request, index } = requestByKey(protocol, requestKey);
  if (request.state !== "claimed" || request.claim?.claimId !== claimId) {
    throw new PublishExecutionProtocolError(
      "EXECUTION_REQUEST_CLAIM_MISMATCH",
      "发布结果与当前请求领取记录不匹配",
    );
  }
  const recordedAtIso = isoTime(recordedAt, "recordedAt");
  const normalizedOutcome = String(outcome || "");
  let state;
  if (normalizedOutcome === "accepted") {
    state = "submitted";
  } else if (normalizedOutcome === "unknown") {
    state = "result_unknown";
  } else if (normalizedOutcome === "failed") {
    state = retryable ? "failed_retryable" : "failed_terminal";
  } else {
    throw new TypeError("outcome仅支持accepted、unknown或failed");
  }
  return replaceRequest(protocol, index, {
    ...request,
    state,
    claim: null,
    receipt: normalizedOutcome === "accepted"
      ? { ...asObject(receipt), recordedAt: recordedAtIso }
      : request.receipt,
    lastError: normalizedOutcome === "accepted"
      ? null
      : {
          message: String(error?.message || error || "发布请求失败"),
          recordedAt: recordedAtIso,
          retryable: state === "failed_retryable",
          resultUnknown: state === "result_unknown",
        },
  });
}

export function expirePublishExecutionClaim(
  protocol,
  { executionRunId, requestKey, expiredAt } = {},
) {
  if (
    protocol?.state !== "running" ||
    protocol.executionRunId !== executionRunId
  ) {
    throw new PublishExecutionProtocolError(
      "EXECUTION_RUN_NOT_ACTIVE",
      "当前执行任务没有有效的一次性授权",
    );
  }
  const { request, index } = requestByKey(protocol, requestKey);
  if (request.state !== "claimed" || !request.claim?.expiresAt) {
    throw new PublishExecutionProtocolError(
      "EXECUTION_REQUEST_NOT_CLAIMED",
      "该发布请求没有可过期的领取记录",
    );
  }
  const expiredAtIso = isoTime(expiredAt, "expiredAt");
  if (
    new Date(expiredAtIso).getTime() <
    new Date(request.claim.expiresAt).getTime()
  ) {
    throw new PublishExecutionProtocolError(
      "EXECUTION_REQUEST_CLAIM_ACTIVE",
      "发布请求领取租约尚未过期",
    );
  }
  return replaceRequest(protocol, index, {
    ...request,
    state: "result_unknown",
    claim: null,
    lastError: {
      message: "发布请求领取租约过期，无法确认是否已提交",
      recordedAt: expiredAtIso,
      retryable: false,
      resultUnknown: true,
    },
  });
}

export function recordPublishExecutionReadback(
  protocol,
  { executionRunId, requestKey, stage, status, recordedAt } = {},
) {
  if (
    protocol?.state !== "running" ||
    protocol.executionRunId !== executionRunId
  ) {
    throw new PublishExecutionProtocolError(
      "EXECUTION_RUN_NOT_ACTIVE",
      "当前执行任务没有有效的一次性授权",
    );
  }
  const { request, index } = requestByKey(protocol, requestKey);
  if (!["submitted", "result_unknown"].includes(request.state)) {
    throw new PublishExecutionProtocolError(
      "EXECUTION_READBACK_NOT_ALLOWED",
      "该请求尚未提交或不需要结果恢复",
    );
  }
  const recordedAtIso = isoTime(recordedAt, "recordedAt");
  const readback = { ...request.readback };
  if (stage === "receive") {
    if (!["succeeded", "failed"].includes(status)) {
      throw new TypeError("receive状态仅支持succeeded或failed");
    }
    readback.receive = status;
  } else if (stage === "audit") {
    if (!["pending", "approved", "rejected", "revoked"].includes(status)) {
      throw new TypeError("audit状态无效");
    }
    readback.audit = status;
    if (status === "approved") readback.spu = "pending";
  } else if (stage === "documentStateQuery") {
    if (!["running", "resolved", "not_found"].includes(status)) {
      throw new TypeError("documentStateQuery状态无效");
    }
    readback.documentStateQuery = status;
  } else if (stage === "spu") {
    if (readback.audit !== "approved" || status !== "completed") {
      throw new PublishExecutionProtocolError(
        "SPU_READBACK_REQUIRES_APPROVAL",
        "只有审核通过后才能完成SPU关系回读",
      );
    }
    readback.spu = "completed";
    readback.compliance = "pending";
  } else if (stage === "compliance") {
    if (readback.spu !== "completed" || status !== "completed") {
      throw new PublishExecutionProtocolError(
        "COMPLIANCE_READBACK_REQUIRES_SPU",
        "只有SPU、SKC和SKU关系回读完成后才能完成合规复验",
      );
    }
    readback.compliance = "completed";
  } else {
    throw new TypeError("未知回读阶段");
  }
  const recoveredState =
    request.state === "result_unknown" &&
    ["receive", "audit"].includes(stage)
      ? "submitted"
      : request.state;
  const completed =
    recoveredState === "submitted" &&
    readback.receive === "succeeded" &&
    readback.audit === "approved" &&
    readback.spu === "completed" &&
    readback.compliance === "completed";
  return refreshCompletion(
    replaceRequest(protocol, index, {
      ...request,
      state: completed ? "completed" : recoveredState,
      readback: { ...readback, updatedAt: recordedAtIso },
    }),
    recordedAtIso,
  );
}
