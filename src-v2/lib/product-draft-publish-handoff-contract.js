function text(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function selectedDraftIds(drafts, selectedIds, storeId) {
  const rows = Array.isArray(drafts) ? drafts : [];
  const selected = Array.from(new Set(
    (Array.isArray(selectedIds) ? selectedIds : []).map(text).filter(Boolean),
  ));
  const rowsById = new Map(rows.map((draft) => [text(draft?.id), draft]));
  const readyDraftIds = selected.filter((id) => {
    const draft = rowsById.get(id);
    return draft &&
      text(draft.storeId) === text(storeId) &&
      text(draft.status) === "ready";
  });
  return { selected, readyDraftIds };
}

export function buildPublishBatchHandoff({ drafts = [], selectedIds = [], storeId = "" } = {}) {
  const result = selectedDraftIds(drafts, selectedIds, storeId);
  return {
    selectedCount: result.selected.length,
    readyDraftIds: result.readyDraftIds,
    rejectedCount: result.selected.length - result.readyDraftIds.length,
    externalWrite: false,
    state: {
      source: "product-drafts",
      storeId: text(storeId),
      draftIds: result.readyDraftIds,
    },
  };
}

export function consumePublishBatchHandoff({ state, drafts = [], storeId = "" } = {}) {
  const source = object(state);
  if (source.source !== "product-drafts") {
    return {
      accepted: false,
      readyDraftIds: [],
      rejectedCount: 0,
      reason: "",
      externalWrite: false,
    };
  }
  const draftIds = Array.isArray(source.draftIds) ? source.draftIds : [];
  if (text(source.storeId) !== text(storeId)) {
    return {
      accepted: false,
      readyDraftIds: [],
      rejectedCount: draftIds.length,
      reason: "来源店铺与当前店铺不一致，未带入草稿",
      externalWrite: false,
    };
  }
  const result = selectedDraftIds(drafts, draftIds, storeId);
  return {
    accepted: true,
    readyDraftIds: result.readyDraftIds,
    rejectedCount: result.selected.length - result.readyDraftIds.length,
    reason: "",
    externalWrite: false,
  };
}
