const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const SCHEDULER_LOCK_PREFIX = "shein-rule-refresh-monthly-scheduler";

function lockKey(monthKey, due) {
  return `${SCHEDULER_LOCK_PREFIX}:${monthKey}:${due ? "monthly" : "expired"}`;
}

function scheduleParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function emptySummary(due, acquired = false) {
  return {
    due,
    acquired,
    scanned: 0,
    enqueued: 0,
    reused: 0,
    skipped: 0,
    failed: 0,
  };
}

export class RuleRefreshScheduler {
  constructor({
    pool,
    service,
    now = () => new Date(),
    day = 1,
    startHour = 3,
    endHour = 4,
    timeZone = DEFAULT_TIME_ZONE,
  } = {}) {
    if (!pool) throw new Error("规则刷新月度调度器缺少 pool");
    if (!service) throw new Error("规则刷新月度调度器缺少 service");
    this.pool = pool;
    this.service = service;
    this.now = now;
    this.day = Number(day);
    this.startHour = Number(startHour);
    this.endHour = Number(endHour);
    this.timeZone = String(timeZone || DEFAULT_TIME_ZONE);
    if (!Number.isInteger(this.day) || this.day < 1 || this.day > 31) {
      throw new Error("规则刷新月度调度日期必须为 1-31");
    }
    if (
      !Number.isInteger(this.startHour) ||
      !Number.isInteger(this.endHour) ||
      this.startHour < 0 ||
      this.startHour > 23 ||
      this.endHour < 1 ||
      this.endHour > 24 ||
      this.startHour >= this.endHour
    ) {
      throw new Error("规则刷新月度调度时间窗口不正确");
    }
    scheduleParts(new Date(), this.timeZone);
  }

  isDue(date = this.now()) {
    const parts = scheduleParts(date, this.timeZone);
    return {
      due:
        parts.day === this.day &&
        parts.hour >= this.startHour &&
        parts.hour < this.endHour,
      monthKey: `${parts.year}-${String(parts.month).padStart(2, "0")}`,
    };
  }

  async runOnce() {
    const { due, monthKey } = this.isDue();
    let expiredRules = false;
    if (!due) {
      const result = await this.pool.query({
        text: `SELECT EXISTS (
                 SELECT 1 FROM shein_rule_snapshots
                 WHERE expires_at IS NOT NULL AND expires_at <= now()
               ) AS expired`,
      });
      expiredRules = result.rows[0]?.expired === true;
      if (!expiredRules) return emptySummary(false);
    }

    const client = await this.pool.connect();
    let acquired = false;
    try {
      const lock = await client.query({
        text: "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
        values: [lockKey(monthKey, due)],
      });
      acquired = lock.rows[0]?.acquired === true;
      if (!acquired) return emptySummary(true, false);

      const stores = await client.query({
        text: `
          SELECT store.tenant_id, store.id AS store_id,
                 EXISTS (
                   SELECT 1
                   FROM sync_jobs monthly_job
                   WHERE monthly_job.tenant_id = store.tenant_id
                     AND monthly_job.store_id = store.id
                     AND monthly_job.job_type = 'rule_refresh'
                     AND to_char(monthly_job.created_at AT TIME ZONE $1, 'YYYY-MM') = $2
                     AND monthly_job.progress->>'scope' = 'all'
                 ) AS has_full_refresh,
                 EXISTS (
                   SELECT 1
                   FROM shein_rule_snapshots expired_snapshot
                   WHERE expired_snapshot.tenant_id = store.tenant_id
                     AND expired_snapshot.store_id = store.id
                     AND expired_snapshot.expires_at IS NOT NULL
                     AND expired_snapshot.expires_at <= now()
                 ) AS has_expired_snapshot
          FROM stores store
          JOIN tenants tenant ON tenant.id = store.tenant_id
          JOIN store_credentials credential ON credential.store_id = store.id
          WHERE tenant.status = 'active'
            AND store.status = 'active'
          ORDER BY store.created_at ASC
        `,
        values: [this.timeZone, monthKey],
      });
      const summary = emptySummary(true, true);
      summary.due = due || expiredRules;
      summary.scanned = stores.rows.length;
      for (const row of stores.rows) {
        if (!due && row.has_expired_snapshot !== true) {
          summary.skipped += 1;
          continue;
        }
        if (row.has_full_refresh === true && due) {
          summary.skipped += 1;
          continue;
        }
        try {
          const result = await this.service.startRefresh({
            context: {
              tenantId: String(row.tenant_id),
              userId: null,
              trigger: "monthly-rule-refresh",
            },
            storeId: String(row.store_id),
            scope: "all",
          });
          if (result?.started) summary.enqueued += 1;
          else summary.reused += 1;
        } catch {
          summary.failed += 1;
        }
      }
      // Prune only expired snapshots that are no longer referenced by the
      // append-only compliance audit. The migration exposes this as a
      // SECURITY DEFINER function so the runtime role does not need DELETE on
      // the snapshot table itself.
      await client.query({
        text: "SELECT prune_shein_rule_snapshots($1) AS deleted",
        values: [500],
      });
      return summary;
    } finally {
      try {
        if (acquired) {
          await client.query({
            text: "SELECT pg_advisory_unlock(hashtext($1)) AS unlocked",
            values: [lockKey(monthKey, due)],
          });
        }
      } finally {
        client.release();
      }
    }
  }
}

export function startRuleRefreshScheduleLoop({
  scheduler,
  intervalMs = DEFAULT_INTERVAL_MS,
  onResult = () => {},
  onError = () => {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (!scheduler) throw new Error("规则刷新月度调度循环缺少 scheduler");
  const scheduleIntervalMs = Math.max(
    1_000,
    Number(intervalMs) || DEFAULT_INTERVAL_MS,
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
