import assert from "node:assert/strict";
import test from "node:test";

import { createErp06HandoffRehearsalTimeline } from "./rehearse-erp06-publish-handoff.js";

test("ERP-06 handoff rehearsal dispatches only after its outbox record can exist", () => {
  const createdAt = new Date("2026-08-31T01:30:00.000Z");
  const timeline = createErp06HandoffRehearsalTimeline(createdAt);

  assert(timeline.dispatchAt > createdAt);
  assert(timeline.workerAt > timeline.dispatchAt);
  assert(timeline.repeatDispatchAt > timeline.workerAt);
  assert(timeline.unknownWorkerAt > timeline.repeatDispatchAt);
});
