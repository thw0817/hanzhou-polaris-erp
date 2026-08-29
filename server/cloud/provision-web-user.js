import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { createPostgresPool } from "./postgres.js";
import { PostgresWebAuthService } from "./web-auth.js";

function parseArguments(argv) {
  const options = {
    tenantId: null,
    tenantName: "",
    email: "",
    displayName: "",
    role: "operator",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--tenant-id") {
      options.tenantId = argv[index + 1] || null;
      index += 1;
    } else if (argument === "--tenant-name") {
      options.tenantName = argv[index + 1] || "";
      index += 1;
    } else if (argument === "--email") {
      options.email = argv[index + 1] || "";
      index += 1;
    } else if (argument === "--display-name") {
      options.displayName = argv[index + 1] || "";
      index += 1;
    } else if (argument === "--role") {
      options.role = argv[index + 1] || "";
      index += 1;
    }
  }
  return options;
}

function generateTemporaryPassword() {
  return `Ww!${crypto.randomBytes(12).toString("base64url")}9`;
}

export async function provisionWebUser({
  pool,
  options,
  password = generateTemporaryPassword(),
} = {}) {
  const webAuth = new PostgresWebAuthService({ pool });
  const result = await webAuth.provisionUser({
    ...options,
    password,
  });
  return { ...result, temporaryPassword: password };
}

async function main() {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("缺少 DATABASE_URL");
  }
  const options = parseArguments(process.argv.slice(2));
  if (!options.email || (!options.tenantId && !options.tenantName)) {
    throw new Error(
      "用法: --tenant-id <ID> 或 --tenant-name <名称> --email <邮箱> [--display-name <姓名>] [--role owner|admin|operator|viewer]",
    );
  }
  const pool = createPostgresPool({ connectionString: config.databaseUrl });
  try {
    const result = await provisionWebUser({ pool, options });
    console.log(`工作空间: ${result.tenant.name} (${result.tenant.id})`);
    console.log(`用户: ${result.user.email} (${result.user.role})`);
    console.log(`临时密码: ${result.temporaryPassword}`);
    console.log("临时密码只显示一次，请通过安全渠道交给本人。");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
