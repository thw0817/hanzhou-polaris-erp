import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import {
  MediaCleanupWorker,
  PostgresMediaCleanupRepository,
} from "./media-cleanup-worker.js";
import { createPostgresPool } from "./postgres.js";
import { S3ObjectStorage } from "./s3-object-storage.js";

export async function startMediaCleanupWorker(config = loadConfig()) {
  if (config.runtimeMode !== "cloud") {
    throw new Error("图片清理任务要求 SHEIN_RUNTIME_MODE=cloud");
  }
  if (!config.databaseUrl || !config.mediaStorage) {
    throw new Error("图片清理任务缺少数据库或对象存储配置");
  }
  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
    max: 2,
  });
  const storage = new S3ObjectStorage({
    endpoint: config.mediaStorage.endpoint,
    region: config.mediaStorage.region,
    bucket: config.mediaStorage.bucket,
    accessKeyId: config.mediaStorage.accessKeyId,
    secretAccessKey: config.mediaStorage.secretAccessKey,
  });
  const worker = new MediaCleanupWorker({
    repository: new PostgresMediaCleanupRepository({ pool }),
    storage,
    batchSize: config.mediaCleanupBatchSize,
  });
  const intervalMs = Math.max(
    60_000,
    Number(config.mediaCleanupIntervalMs) || 15 * 60 * 1000,
  );
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await worker.runOnce();
      console.log("[media-cleanup]", JSON.stringify(summary));
    } catch (error) {
      console.error("[media-cleanup]", error);
    } finally {
      running = false;
    }
  };
  await run();
  const timer = setInterval(run, intervalMs);
  const close = async () => {
    clearInterval(timer);
    await pool.end();
  };
  process.once("SIGINT", () => close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => close().finally(() => process.exit(0)));
  return { worker, close };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMediaCleanupWorker().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
