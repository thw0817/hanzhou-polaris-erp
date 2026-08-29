export class PostgresWebhookStoreResolver {
  constructor({ pool } = {}) {
    if (!pool) {
      throw new Error("PostgresWebhookStoreResolver 缺少 pool");
    }
    this.pool = pool;
  }

  async findByOpenKeyId(openKeyId) {
    const result = await this.pool.query(
      `SELECT id, tenant_id, status
       FROM stores
       WHERE open_key_id = $1`,
      [openKeyId],
    );
    if (!result.rowCount) return null;
    const store = result.rows[0];
    return {
      storeId: store.id,
      tenantId: store.tenant_id,
      status: store.status,
    };
  }
}
