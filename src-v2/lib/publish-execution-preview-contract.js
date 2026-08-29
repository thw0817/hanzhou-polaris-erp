function text(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function buildExecutionPayloadPreviews(batch) {
  const source = object(batch);
  const plan = object(object(source.preflight).executionPlan);
  const requests = Array.isArray(plan.requests) ? plan.requests : [];
  const items = Array.isArray(source.items) ? source.items : [];
  const itemIds = new Set();
  const requestKeys = new Set();
  const previews = requests.map((requestValue) => {
    const request = object(requestValue);
    const itemId = text(request.itemId);
    const requestKey = text(request.requestKey);
    const duplicate = itemIds.has(itemId) || requestKeys.has(requestKey);
    itemIds.add(itemId);
    requestKeys.add(requestKey);
    const matches = items.filter((item) => text(item?.id) === itemId);
    const item = matches.length === 1 ? matches[0] : null;
    const itemPreflight = object(item?.preflight);
    const remote = object(itemPreflight.remotePublishCandidate);
    const requestBody = object(remote.requestBody);
    const valid = Boolean(
      !duplicate &&
        item &&
        requestKey &&
        remote.state === "ready_for_publish_confirmation" &&
        remote.publishingEnabled === false &&
        text(request.remoteCandidateFingerprint) === text(remote.fingerprint) &&
        text(request.sourceCandidateFingerprint) ===
          text(itemPreflight.publishCandidateFingerprint) &&
        text(remote.sourceCandidateFingerprint) ===
          text(request.sourceCandidateFingerprint) &&
        Object.keys(requestBody).length,
    );
    return {
      request,
      item,
      requestBody: valid ? requestBody : null,
      valid,
      issue: valid ? "" : "载荷缺失或指纹不一致",
    };
  });
  return {
    previews,
    ready: Boolean(
      plan.state === "ready_for_execution_confirmation" &&
        requests.length > 0 &&
        Number(plan.requestCount) === requests.length &&
        previews.every((preview) => preview.valid)
    ),
    externalWrite: false,
  };
}
