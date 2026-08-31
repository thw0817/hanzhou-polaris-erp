import { withTransaction } from "./postgres.js";

export class PostgresStoreRepository {
  constructor({ pool, credentialCipher } = {}) {
    if (!pool) throw new Error("PostgresStoreRepository 缺少 pool");
    if (!credentialCipher) {
      throw new Error("PostgresStoreRepository 缺少 credentialCipher");
    }
    this.pool = pool;
    this.credentialCipher = credentialCipher;
  }

  async upsertAuthorizedStore({
    tenantId,
    supplierId = null,
    openKeyId,
    secretKey,
    label = "",
    businessMode = "全托管",
    authorizedBy = null,
  }) {
    if (!tenantId || !openKeyId || !secretKey) {
      throw new Error("保存授权店铺时缺少 tenantId、openKeyId 或 secretKey");
    }
    return withTransaction(this.pool, async (client) => {
      const storeResult = await client.query(
        `INSERT INTO stores (
          tenant_id, supplier_id, open_key_id, label, business_mode,
          status, authorized_at, authorized_by
        ) VALUES ($1, $2, $3, $4, $5, 'active', now(), $6)
        ON CONFLICT (open_key_id) DO UPDATE SET
          supplier_id = EXCLUDED.supplier_id,
          label = EXCLUDED.label,
          business_mode = EXCLUDED.business_mode,
          status = 'active',
          authorized_at = now(),
          authorized_by = COALESCE(EXCLUDED.authorized_by, stores.authorized_by),
          updated_at = now()
        WHERE stores.tenant_id = EXCLUDED.tenant_id
        RETURNING id, tenant_id, supplier_id, open_key_id, label,
                  business_mode, status, authorized_at, authorized_by`,
        [
          tenantId,
          supplierId,
          openKeyId,
          label,
          businessMode,
          authorizedBy,
        ],
      );
      if (!storeResult.rowCount) {
        const error = new Error("该SHEIN店铺已绑定到其他工作空间");
        error.code = "STORE_ALREADY_BOUND";
        error.status = 409;
        throw error;
      }
      const store = storeResult.rows[0];
      const encrypted = this.credentialCipher.encrypt(secretKey, {
        storeId: store.id,
        openKeyId,
      });
      await client.query(
        `INSERT INTO store_credentials (
          store_id, ciphertext, iv, auth_tag, key_version, algorithm
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (store_id) DO UPDATE SET
          ciphertext = EXCLUDED.ciphertext,
          iv = EXCLUDED.iv,
          auth_tag = EXCLUDED.auth_tag,
          key_version = EXCLUDED.key_version,
          algorithm = EXCLUDED.algorithm,
          rotated_at = now(),
          updated_at = now()`,
        [
          store.id,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          encrypted.keyVersion,
          encrypted.algorithm,
        ],
      );
      return store;
    });
  }

  async getCredential(storeId) {
    const result = await this.pool.query(
      `SELECT s.id, s.tenant_id, s.supplier_id, s.open_key_id, s.status,
              c.ciphertext, c.iv, c.auth_tag, c.key_version
       FROM stores s
       JOIN store_credentials c ON c.store_id = s.id
       WHERE s.id = $1`,
      [storeId],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      storeId: row.id,
      tenantId: row.tenant_id,
      supplierId: row.supplier_id,
      openKeyId: row.open_key_id,
      status: row.status,
      secretKey: this.credentialCipher.decrypt(
        {
          ciphertext: row.ciphertext,
          iv: row.iv,
          authTag: row.auth_tag,
          keyVersion: row.key_version,
        },
        { storeId: row.id, openKeyId: row.open_key_id },
      ),
    };
  }

  async requireReauthorizationBySupplierId(supplierId) {
    const result = await this.pool.query(
      `UPDATE stores
       SET status = 'reauthorization_required', updated_at = now()
       WHERE supplier_id = $1 AND status <> 'disabled'
       RETURNING id`,
      [String(supplierId)],
    );
    return result.rows.map((row) => row.id);
  }

  async requireReauthorizationByStoreId(storeId) {
    const result = await this.pool.query(
      `UPDATE stores
       SET status = 'reauthorization_required', updated_at = now()
       WHERE id = $1 AND status = 'active'
       RETURNING id`,
      [storeId],
    );
    return result.rows.map((row) => row.id);
  }
}
