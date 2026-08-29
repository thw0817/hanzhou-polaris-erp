import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublishExecutionProtocol,
  claimPublishExecutionRequest,
  consumePublishExecutionAuthorization,
  expirePublishExecutionClaim,
  isPublishExecutionAuthorizationActive,
  recordPublishExecutionReadback,
  recordPublishExecutionResult,
} from "./publish-execution-protocol.js";

function plan() {
  return {
    state: "ready_for_execution_confirmation",
    fingerprint: "plan-fingerprint",
    executionEnabled: false,
    authorizesPublishing: false,
    requests: [
      { requestKey: "request-1", itemId: "item-1", draftId: "draft-1" },
      { requestKey: "request-2", itemId: "item-2", draftId: "draft-2" },
    ],
  };
}

function protocol() {
  return buildPublishExecutionProtocol({
    batchId: "batch-1",
    plan: plan(),
    authorizedAt: "2026-08-05T08:00:00.000Z",
    authorizedBy: "user-1",
    authorizationId: "authorization-1",
  });
}

test("issues a ten-minute single-use protocol without enabling publishing", () => {
  const result = protocol();

  assert.equal(result.state, "issued");
  assert.equal(result.expiresAt, "2026-08-05T08:10:00.000Z");
  assert.equal(result.singleUse, true);
  assert.equal(result.executionEnabled, false);
  assert.equal(result.authorizesPublishing, false);
  assert.deepEqual(
    result.requests.map((request) => request.state),
    ["authorized", "authorized"],
  );
  assert.equal(
    result.retryPolicy.automaticRetryAfterUnknownResult,
    false,
  );
});

test("rejects expired authorization and consumes the same run idempotently", () => {
  const issued = protocol();
  assert.equal(
    isPublishExecutionAuthorizationActive(
      issued,
      "2026-08-05T08:09:59.000Z",
    ),
    true,
  );
  assert.throws(
    () =>
      consumePublishExecutionAuthorization(issued, {
        executionRunId: "run-1",
        consumedAt: "2026-08-05T08:10:00.000Z",
      }),
    /已过期/,
  );

  const running = consumePublishExecutionAuthorization(issued, {
    executionRunId: "run-1",
    consumedAt: "2026-08-05T08:05:00.000Z",
  });
  assert.equal(running.state, "running");
  assert.equal(
    consumePublishExecutionAuthorization(running, {
      executionRunId: "run-1",
      consumedAt: "2026-08-05T08:06:00.000Z",
    }),
    running,
  );
  assert.throws(
    () =>
      consumePublishExecutionAuthorization(running, {
        executionRunId: "run-2",
        consumedAt: "2026-08-05T08:06:00.000Z",
      }),
    /其他执行任务/,
  );
});

test("claims each request once and retries only explicit known failures", () => {
  const running = consumePublishExecutionAuthorization(protocol(), {
    executionRunId: "run-1",
    consumedAt: "2026-08-05T08:01:00.000Z",
  });
  const claimed = claimPublishExecutionRequest(running, {
    executionRunId: "run-1",
    requestKey: "request-1",
    claimId: "claim-1",
    workerId: "worker-1",
    claimedAt: "2026-08-05T08:01:10.000Z",
  });
  assert.equal(claimed.requests[0].state, "claimed");
  assert.equal(claimed.requests[0].attemptCount, 1);
  assert.throws(
    () =>
      claimPublishExecutionRequest(claimed, {
        executionRunId: "run-1",
        requestKey: "request-1",
        claimId: "claim-2",
        workerId: "worker-2",
        claimedAt: "2026-08-05T08:01:20.000Z",
      }),
    /不能并发执行/,
  );

  const failed = recordPublishExecutionResult(claimed, {
    executionRunId: "run-1",
    requestKey: "request-1",
    claimId: "claim-1",
    outcome: "failed",
    retryable: true,
    error: "SHEIN明确返回可重试失败",
    recordedAt: "2026-08-05T08:01:30.000Z",
  });
  const retried = claimPublishExecutionRequest(failed, {
    executionRunId: "run-1",
    requestKey: "request-1",
    claimId: "claim-3",
    workerId: "worker-1",
    claimedAt: "2026-08-05T08:02:00.000Z",
  });
  assert.equal(retried.requests[0].attemptCount, 2);
  assert.equal(retried.requests[1].attemptCount, 0);
});

test("unknown results cannot be retried and recover only through readback", () => {
  const running = consumePublishExecutionAuthorization(protocol(), {
    executionRunId: "run-1",
    consumedAt: "2026-08-05T08:01:00.000Z",
  });
  const claimed = claimPublishExecutionRequest(running, {
    executionRunId: "run-1",
    requestKey: "request-1",
    claimId: "claim-1",
    workerId: "worker-1",
    claimedAt: "2026-08-05T08:01:10.000Z",
  });
  const unknown = recordPublishExecutionResult(claimed, {
    executionRunId: "run-1",
    requestKey: "request-1",
    claimId: "claim-1",
    outcome: "unknown",
    error: "提交后连接中断",
    recordedAt: "2026-08-05T08:01:30.000Z",
  });
  assert.equal(unknown.requests[0].state, "result_unknown");
  assert.equal(unknown.requests[0].lastError.retryable, false);
  assert.throws(
    () =>
      claimPublishExecutionRequest(unknown, {
        executionRunId: "run-1",
        requestKey: "request-1",
        claimId: "claim-2",
        workerId: "worker-1",
        claimedAt: "2026-08-05T08:02:00.000Z",
      }),
    /通知或商品文档状态查询恢复/,
  );

  const recovered = recordPublishExecutionReadback(unknown, {
    executionRunId: "run-1",
    requestKey: "request-1",
    stage: "receive",
    status: "succeeded",
    recordedAt: "2026-08-05T08:03:00.000Z",
  });
  assert.equal(recovered.requests[0].state, "submitted");
  assert.equal(recovered.requests[0].readback.receive, "succeeded");
});

test("expired request claims become unknown instead of being reclaimed", () => {
  const running = consumePublishExecutionAuthorization(protocol(), {
    executionRunId: "run-1",
    consumedAt: "2026-08-05T08:01:00.000Z",
  });
  const claimed = claimPublishExecutionRequest(running, {
    executionRunId: "run-1",
    requestKey: "request-1",
    claimId: "claim-1",
    workerId: "worker-1",
    claimedAt: "2026-08-05T08:01:10.000Z",
  });
  assert.throws(
    () =>
      expirePublishExecutionClaim(claimed, {
        executionRunId: "run-1",
        requestKey: "request-1",
        expiredAt: "2026-08-05T08:03:09.000Z",
      }),
    /尚未过期/,
  );
  const unknown = expirePublishExecutionClaim(claimed, {
    executionRunId: "run-1",
    requestKey: "request-1",
    expiredAt: "2026-08-05T08:03:10.000Z",
  });
  assert.equal(unknown.requests[0].state, "result_unknown");
  assert.equal(unknown.requests[0].lastError.retryable, false);
  assert.throws(
    () =>
      claimPublishExecutionRequest(unknown, {
        executionRunId: "run-1",
        requestKey: "request-1",
        claimId: "claim-2",
        workerId: "worker-2",
        claimedAt: "2026-08-05T08:03:20.000Z",
      }),
    /通知或商品文档状态查询恢复/,
  );
});

test("completes only after approval, SPU readback and SKC compliance revalidation", () => {
  let result = consumePublishExecutionAuthorization(protocol(), {
    executionRunId: "run-1",
    consumedAt: "2026-08-05T08:01:00.000Z",
  });
  for (const requestKey of ["request-1", "request-2"]) {
    result = claimPublishExecutionRequest(result, {
      executionRunId: "run-1",
      requestKey,
      claimId: `claim-${requestKey}`,
      workerId: "worker-1",
      claimedAt: "2026-08-05T08:01:10.000Z",
    });
    result = recordPublishExecutionResult(result, {
      executionRunId: "run-1",
      requestKey,
      claimId: `claim-${requestKey}`,
      outcome: "accepted",
      receipt: { version: `version-${requestKey}` },
      recordedAt: "2026-08-05T08:01:20.000Z",
    });
    result = recordPublishExecutionReadback(result, {
      executionRunId: "run-1",
      requestKey,
      stage: "receive",
      status: "succeeded",
      recordedAt: "2026-08-05T08:02:00.000Z",
    });
    result = recordPublishExecutionReadback(result, {
      executionRunId: "run-1",
      requestKey,
      stage: "audit",
      status: "approved",
      recordedAt: "2026-08-05T08:03:00.000Z",
    });
    result = recordPublishExecutionReadback(result, {
      executionRunId: "run-1",
      requestKey,
      stage: "spu",
      status: "completed",
      recordedAt: "2026-08-05T08:04:00.000Z",
    });
    result = recordPublishExecutionReadback(result, {
      executionRunId: "run-1",
      requestKey,
      stage: "compliance",
      status: "completed",
      recordedAt: "2026-08-05T08:05:00.000Z",
    });
  }

  assert.equal(result.state, "completed");
  assert.deepEqual(
    result.requests.map((request) => request.state),
    ["completed", "completed"],
  );
});
