import pg from "pg";

const { Pool } = pg;

export function createPostgresPool({
  connectionString,
  max = 10,
  idleTimeoutMillis = 30_000,
  connectionTimeoutMillis = 5_000,
} = {}) {
  if (!connectionString) {
    throw new Error("cloud 模式缺少 DATABASE_URL");
  }
  return new Pool({
    connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
  });
}

export async function withTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
