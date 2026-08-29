import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(currentDirectory, "../..");

const REQUIRED_FLAGS = Object.freeze([
  "SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED",
  "SHEIN_COMPLIANCE_WRITES_ENABLED",
  "SHEIN_WEBHOOK_INGRESS_ENABLED",
  "SHEIN_STORE_BUSINESS_REFRESH_ENABLED",
  "SHEIN_RULE_REFRESH_ENABLED",
  "SHEIN_COMPLIANCE_SYNC_ENABLED",
]);

export async function auditStagingIsolation(root = defaultRoot) {
  const compose = await fs.readFile(path.join(root, "deploy/docker-compose.staging.yml"), "utf8");
  const env = await fs.readFile(path.join(root, ".env.staging.example"), "utf8");
  const checks = [
    {
      name: "dedicated_compose_project",
      passed: /name:\s*hanzhou-polaris-staging/.test(compose),
    },
    {
      name: "dedicated_database_volume_and_port",
      passed: compose.includes("polaris_staging_postgres_data") && compose.includes("127.0.0.1:55432:5432"),
    },
    {
      name: "dedicated_redis_volume_and_port",
      passed: compose.includes("polaris_staging_redis_data") && compose.includes("127.0.0.1:56379:6379"),
    },
    {
      name: "dedicated_bucket_and_object_store",
      passed: env.includes("SHEIN_MEDIA_S3_BUCKET=shein-polaris-staging") && compose.includes("polaris_staging_minio_data"),
    },
    {
      name: "non_production_api_endpoint",
      passed: env.includes("SHEIN_API_BASE_URL=http://shein-api-disabled.invalid") &&
        !env.includes("openapi.sheincorp") && !env.includes("app.hanzhou.icu"),
    },
    {
      name: "staging_runtime_mode",
      passed: env.includes("SHEIN_RUNTIME_MODE=cloud") && env.includes("SHEIN_ENVIRONMENT=staging"),
    },
    ...REQUIRED_FLAGS.map((name) => ({
      name: `flag_disabled:${name}`,
      passed: new RegExp(`^${name}=false$`, "m").test(env),
    })),
    {
      name: "no_production_volume_names",
      passed: !compose.includes("shein_postgres_data") && !compose.includes("shein_redis_data"),
    },
    {
      name: "no_production_write_credentials",
      passed: /SHEIN_APP_ID=$/m.test(env) && /SHEIN_APP_SECRET=$/m.test(env) && /SHEIN_CLOUD_ENCRYPTION_KEY=/.test(env),
    },
  ];
  return { root, passed: checks.every((check) => check.passed), checks };
}

async function main() {
  const root = path.resolve(process.argv.find((value) => value.startsWith("--root="))?.slice(7) || defaultRoot);
  const report = await auditStagingIsolation(root);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
