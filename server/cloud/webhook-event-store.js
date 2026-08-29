export class MemoryWebhookEventStore {
  constructor() {
    this.events = new Map();
  }

  keyOf(event) {
    return `${event.appId}:${event.eventType}:${event.dedupeKey}`;
  }

  async insert(event) {
    const key = this.keyOf(event);
    const existing = this.events.get(key);
    if (existing) return { inserted: false, event: existing };
    const stored = {
      id: event.id || `event-${this.events.size + 1}`,
      ...event,
      state: "received",
      receivedAt: event.receivedAt || new Date().toISOString(),
    };
    this.events.set(key, stored);
    return { inserted: true, event: stored };
  }

  async markQueued(id, queueJobId) {
    const event = [...this.events.values()].find((item) => item.id === id);
    if (event) Object.assign(event, { state: "queued", queueJobId });
  }

  async markFailed(id, error) {
    const event = [...this.events.values()].find((item) => item.id === id);
    if (event) {
      Object.assign(event, {
        state: "failed",
        lastError: { message: error.message || String(error) },
      });
    }
  }

  async markQueueFailed(id, error) {
    const event = [...this.events.values()].find((item) => item.id === id);
    if (event) {
      Object.assign(event, {
        state: "received",
        lastError: { message: error.message || String(error) },
      });
    }
  }

  async saveProjection(id, { projectionVersion, projection } = {}) {
    const event = [...this.events.values()].find((item) => item.id === id);
    if (event) {
      Object.assign(event, {
        projectionVersion: projectionVersion || null,
        projection: projection || {},
      });
    }
  }
}

export class PostgresWebhookEventStore {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresWebhookEventStore 缺少 pool");
    this.pool = pool;
  }

  async insert(event) {
    const result = await this.pool.query(
      `INSERT INTO webhook_events (
        tenant_id, store_id, app_id, event_type, dedupe_key, source,
        raw_payload, payload, safe_headers
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb
      )
      ON CONFLICT (app_id, event_type, dedupe_key) DO NOTHING
      RETURNING id, state, received_at`,
      [
        event.tenantId || null,
        event.storeId || null,
        event.appId,
        event.eventType,
        event.dedupeKey,
        event.source || "internal",
        JSON.stringify(event.rawPayload ?? event.payload),
        JSON.stringify(event.payload),
        JSON.stringify(event.safeHeaders || {}),
      ],
    );
    if (result.rowCount) {
      return {
        inserted: true,
        event: {
          ...event,
          id: result.rows[0].id,
          state: result.rows[0].state,
          receivedAt: result.rows[0].received_at,
        },
      };
    }
    const existing = await this.pool.query(
      `SELECT id, state, received_at, queue_job_id
       FROM webhook_events
       WHERE app_id = $1 AND event_type = $2 AND dedupe_key = $3`,
      [event.appId, event.eventType, event.dedupeKey],
    );
    return {
      inserted: false,
      event: {
        ...event,
        id: existing.rows[0].id,
        state: existing.rows[0].state,
        receivedAt: existing.rows[0].received_at,
        queueJobId: existing.rows[0].queue_job_id,
      },
    };
  }

  async markQueued(id, queueJobId) {
    await this.pool.query(
      `UPDATE webhook_events
       SET state = 'queued', queue_job_id = $2
       WHERE id = $1`,
      [id, String(queueJobId)],
    );
  }

  async markFailed(id, error) {
    await this.pool.query(
      `UPDATE webhook_events
       SET state = 'failed',
           last_error = $2::jsonb
       WHERE id = $1`,
      [id, JSON.stringify({ message: error.message || String(error) })],
    );
  }

  async markQueueFailed(id, error) {
    await this.pool.query(
      `UPDATE webhook_events
       SET state = 'received',
           last_error = $2::jsonb
       WHERE id = $1`,
      [id, JSON.stringify({ message: error.message || String(error) })],
    );
  }

  async claim(id) {
    const result = await this.pool.query(
      `UPDATE webhook_events
       SET state = 'processing', attempt_count = attempt_count + 1
       WHERE id = $1 AND state IN ('received', 'queued', 'failed')
       RETURNING id, tenant_id, store_id, event_type, source,
                 raw_payload, payload`,
      [id],
    );
    return result.rows[0] || null;
  }

  async markProcessed(id) {
    await this.pool.query(
      `UPDATE webhook_events
       SET state = 'processed', processed_at = now(), last_error = NULL
       WHERE id = $1`,
      [id],
    );
  }

  async saveProjection(id, { projectionVersion, projection } = {}) {
    await this.pool.query(
      `UPDATE webhook_events
       SET projection_version = $2,
           projection = $3::jsonb
       WHERE id = $1`,
      [id, projectionVersion || null, JSON.stringify(projection || {})],
    );
  }
}
