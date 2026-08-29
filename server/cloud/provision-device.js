import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { PostgresDeviceAuthService } from "./device-auth.js";
import { createPostgresPool } from "./postgres.js";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--tenant-id") {
      options.tenantId = argv[index + 1];
      index += 1;
    } else if (argument === "--tenant-name") {
      options.tenantName = argv[index + 1];
      index += 1;
    } else if (argument === "--hours") {
      options.hours = Number(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`未知参数: ${argument}`);
    }
  }
  return options;
}

export async function provisionDeviceEnrollment({
  databaseUrl,
  tenantId = null,
  tenantName = "",
  hours = 24,
} = {}) {
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
    throw new Error("--hours 必须大于0且不超过168");
  }
  const pool = createPostgresPool({
    connectionString: databaseUrl,
    max: 2,
  });
  try {
    const service = new PostgresDeviceAuthService({ pool });
    return await service.createEnrollmentCode({
      tenantId,
      tenantName,
      expiresInMs: hours * 60 * 60 * 1000,
    });
  } finally {
    await pool.end();
  }
}

async function main() {
  const config = loadConfig();
  const options = parseArguments(process.argv.slice(2));
  const enrollment = await provisionDeviceEnrollment({
    databaseUrl: config.databaseUrl,
    ...options,
  });
  console.log("设备授权码已创建（仅显示本次，请勿公开）：");
  console.log(enrollment.code);
  console.log(`租户: ${enrollment.tenantName} (${enrollment.tenantId})`);
  console.log(`过期时间: ${enrollment.expiresAt}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
