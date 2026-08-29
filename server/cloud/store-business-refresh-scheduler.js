const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;
const DEFAULT_MAX_CONCURRENCY = 2;
const SCHEDULER_LOCK_NAME = "shein-store-business-refresh-scheduler";

export class StoreBusinessRefreshScheduler {
  constructor({
    pool,
    service,
    now = () => new Date(),
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    maxConcurrency = DEFAULT_MAX_CONCURRENCY,
  } = {}) {
    if (!pool) throw new Error("经营数据刷新调度器缺少 pool");
    if (!service) throw new Error("经营数据刷新调度器缺少 service");
    this.pool = pool;
    this.service = service;
    this.now = now;
    this.staleAfterMs = Math.max(60_000, Number(staleAfterMs) || DEFAULT_STALE_AFTER_MS);
    this.maxConcurrency = Math.min(
      4,
      Math.max(1, Number(maxConcurrency) || DEFAULT_MAX_CONCURRENCY),
    );
  }

  async runOnce() {
    const client = await this.pool.connect();
    let acquired = false;
    try {
      const lock = await client.query({
        text: "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
        values: [SCHEDULER_LOCK_NAME],
      });
      acquired = lock.rows[0]?.acquired === true;
      if (!acquired) {
        return { acquired: false, scanned: 0, enqueued: 0, reused: 0, failed: 0 };
      }

      const staleBefore = new Date(this.now().getTime() - this.staleAfterMs);
      const due = await client.query({
        text: `
          SELECT store.tenant_id, store.id AS store_id
          FROM stores store
          JOIN tenants tenant ON tenant.id = store.tenant_id
          JOIN store_credentials credential ON credential.store_id = store.id
          LEFT JOIN store_business_snapshots snapshot
            ON snapshot.tenant_id = store.tenant_id
           AND snapshot.store_id = store.id
          WHERE tenant.status = 'active'
            AND store.status = 'active'
            AND (snapshot.synced_at IS NULL OR snapshot.synced_at < $1)
          ORDER BY snapshot.synced_at ASC NULLS FIRST, store.created_at ASC
        `,
        values: [staleBefore],
      });

      const summary = {
        acquired: true,
        scanned: due.rows.length,
        enqueued: 0,
        reused: 0,
        failed: 0,
      };
      let nextIndex = 0;
      const run = async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= due.rows.length) return;
          const row = due.rows[index];
          try {
            const result = await this.service.startRefresh({
              context: {
                tenantId: String(row.tenant_id),
                userId: null,
                trigger: "scheduler",
              },
              storeId: String(row.store_id),
            });
            if (result.started) summary.enqueued += 1;
            else summary.reused += 1;
          } catch {
            summary.failed += 1;
          }
        }
      };
      const workerCount = Math.min(this.maxConcurrency, due.rows.length);
      await Promise.all(Array.from({ length: workerCount }, () => run()));
      return summary;
    } finally {
      try {
        if (acquired) {
          await client.query({
            text: "SELECT pg_advisory_unlock(hashtext($1)) AS unlocked",
            values: [SCHEDULER_LOCK_NAME],
          });
        }
      } finally {
        client.release();
      }
    }
  }
}

export function startStoreBusinessRefreshScheduleLoop({
  scheduler,
  intervalMs = DEFAULT_STALE_AFTER_MS,
  onResult = () => {},
  onError = () => {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (!scheduler) throw new Error("经营数据刷新调度循环缺少 scheduler");
  const scheduleIntervalMs = Math.max(
    60_000,
    Number(intervalMs) || DEFAULT_STALE_AFTER_MS,
  );
  let current = null;
  let closed = false;
  const run = () => {
    if (closed) return Promise.resolve(null);
    if (current) return current;
    current = Promise.resolve()
      .then(() => scheduler.runOnce())
      .then(onResult)
      .catch(onError)
      .finally(() => { current = null; });
    return current;
  };
  const ready = run();
  const timer = setIntervalFn(run, scheduleIntervalMs);
  timer?.unref?.();
  return {
    ready,
    async close() {
      closed = true;
      clearIntervalFn(timer);
      await current;
    },
  };
}
