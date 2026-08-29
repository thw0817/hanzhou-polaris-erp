import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(currentDirectory, "../..");

export const RELEASE_MANIFEST_SCHEMA_VERSION = 2;

const COMPONENT_DEFINITIONS = Object.freeze({
  control: {
    label: "Control",
    kind: "control",
    entry: "server/cloud/control-server.js",
  },
  publishWorker: {
    label: "Publish Worker",
    kind: "worker",
    entry: "server/cloud/product-publish-worker-server.js",
  },
  outboxDispatcher: {
    label: "Outbox Dispatcher",
    kind: "worker",
    entry: "server/cloud/outbox-dispatcher.js",
    requiredForPublish: true,
  },
  storeBusinessRefreshWorker: {
    label: "Store Business Refresh Worker",
    kind: "worker",
    entry: "server/cloud/store-business-refresh-worker-server.js",
  },
  ruleRefreshWorker: {
    label: "Rule Refresh Worker",
    kind: "worker",
    entry: "server/cloud/rule-refresh-worker-server.js",
  },
  complianceSyncWorker: {
    label: "Compliance Sync Worker",
    kind: "worker",
    entry: "server/cloud/compliance-sync-worker-server.js",
  },
  webhookIngress: {
    label: "Webhook Ingress",
    kind: "worker",
    entry: "server/cloud/webhook-server.js",
  },
  webhookWorker: {
    label: "Webhook Worker",
    kind: "worker",
    entry: "server/cloud/webhook-worker-server.js",
  },
  mediaCleanupWorker: {
    label: "Media Cleanup Worker",
    kind: "worker",
    entry: "server/cloud/media-cleanup-worker-server.js",
  },
});

const LIVE_WRITE_FLAGS = Object.freeze({
  productPublish: "SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED",
  complianceWrites: "SHEIN_COMPLIANCE_WRITES_ENABLED",
  webhookIngress: "SHEIN_WEBHOOK_INGRESS_ENABLED",
  storeBusinessRefresh: "SHEIN_STORE_BUSINESS_REFRESH_ENABLED",
  ruleRefresh: "SHEIN_RULE_REFRESH_ENABLED",
  complianceSync: "SHEIN_COMPLIANCE_SYNC_ENABLED",
});

function gitValue(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseVersion(filename) {
  return Number(filename.match(/^(\d+)_/)?.[1] || 0);
}

function safePath(root, relative) {
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`release manifest path escapes root: ${relative}`);
  }
  return resolved;
}

async function fileInfo(root, relative) {
  try {
    const filename = safePath(root, relative);
    const contents = await fs.readFile(filename);
    return {
      exists: true,
      bytes: contents.byteLength,
      sha256: sha256(contents),
    };
  } catch {
    return { exists: false, bytes: null, sha256: null };
  }
}

async function migrationInventory(root) {
  const directory = safePath(root, "server/cloud/migrations");
  let filenames = [];
  try {
    filenames = (await fs.readdir(directory))
      .filter((filename) => /^\d+_[^/]+\.sql$/.test(filename))
      .sort((left, right) => parseVersion(left) - parseVersion(right) || left.localeCompare(right));
  } catch {
    return { files: [], schemaRange: null };
  }
  const files = [];
  for (const filename of filenames) {
    const info = await fileInfo(root, `server/cloud/migrations/${filename}`);
    files.push({ filename, version: parseVersion(filename), ...info });
  }
  return {
    files,
    schemaRange: files.length
      ? {
          min: files[0].filename,
          max: files[files.length - 1].filename,
          minVersion: files[0].version,
          maxVersion: files[files.length - 1].version,
        }
      : null,
  };
}

async function readFrontendManifest(root, webRoot) {
  try {
    const filename = safePath(root, path.relative(root, path.join(webRoot, "release-manifest.json")));
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch {
    return null;
  }
}

function flagSnapshot(environment) {
  return Object.fromEntries(
    Object.entries(LIVE_WRITE_FLAGS).map(([name, envName]) => [
      name,
      { envName, enabled: environment[envName] === "true" },
    ]),
  );
}

export async function createPolarisReleaseManifest({
  root = defaultRoot,
  webRoot = path.join(root, "dist-v2"),
  environment = process.env,
} = {}) {
  const sourceRevision = String(
    environment.POLARIS_SOURCE_REVISION || gitValue(root, ["rev-parse", "HEAD"]) || "unknown",
  ).trim() || "unknown";
  const sourceTree = gitValue(root, ["rev-parse", "HEAD^{tree}"]) || "unknown";
  const sourceDirty = Boolean(gitValue(root, ["status", "--porcelain", "--untracked-files=all"]));
  const frontend = await readFrontendManifest(root, webRoot);
  const buildTime = String(
    environment.POLARIS_BUILD_TIME ||
      frontend?.buildTime ||
      gitValue(root, ["show", "-s", "--format=%cI", "HEAD"]) ||
      new Date().toISOString(),
  ).trim();
  const buildId = String(
    environment.POLARIS_BUILD_ID || frontend?.buildId || sourceRevision,
  ).trim() || "unknown";
  const migrations = await migrationInventory(root);
  const components = {};
  for (const [key, definition] of Object.entries(COMPONENT_DEFINITIONS)) {
    const info = await fileInfo(root, definition.entry);
    components[key] = {
      label: definition.label,
      kind: definition.kind,
      entry: definition.entry,
      requiredForPublish: definition.requiredForPublish === true,
      status: info.exists ? "ready" : "not_implemented",
      sourceRevision,
      ...info,
    };
  }
  const flags = flagSnapshot(environment);
  const requiredComponentKeys = Object.entries(COMPONENT_DEFINITIONS)
    .filter(([, definition]) => definition.requiredForPublish === true || definition.kind === "control" || definition.label === "Publish Worker")
    .map(([key]) => key);
  const sameSourceRevision = requiredComponentKeys.every(
    (key) => components[key]?.sourceRevision === sourceRevision,
  );
  const publishBlockers = [];
  for (const key of requiredComponentKeys) {
    if (components[key]?.status !== "ready") publishBlockers.push(`${key}_not_implemented`);
  }
  if (!flags.productPublish.enabled) publishBlockers.push("product_publish_live_write_disabled");
  if (!sameSourceRevision) publishBlockers.push("required_component_source_revision_drift");
  return {
    schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
    artifactKind: "hanzhou-polaris-release",
    immutable: true,
    releaseId: `polaris-${buildId}`,
    build: {
      buildId,
      buildTime,
      builtBy: environment.CI ? "ci" : "local",
      buildOnce: true,
      sourceDirty,
    },
    source: {
      revision: sourceRevision,
      tree: sourceTree,
      dirty: sourceDirty,
    },
    ui: frontend
      ? {
          mode: frontend.ui?.mode || null,
          marker: frontend.ui?.marker || null,
          entry: frontend.ui?.entry || null,
          buildId: frontend.buildId || null,
          sourceRevision: frontend.sourceRevision || null,
          artifact: frontend.artifact || null,
        }
      : null,
    components,
    schema: {
      range: migrations.schemaRange,
      migrations: migrations.files,
    },
    flags: {
      liveWrite: flags,
      allDisabledByDefault: Object.values(flags).every((flag) => flag.enabled === false),
    },
    publishCommandGate: {
      requiredComponents: requiredComponentKeys,
      sameSourceRevision,
      liveWriteEnabled: flags.productPublish.enabled,
      canAcceptNewPublishCommand: publishBlockers.length === 0,
      blockers: publishBlockers,
    },
  };
}

export async function auditPolarisReleaseManifest({
  root = defaultRoot,
  webRoot = path.join(root, "dist-v2"),
  manifest,
  requireCleanSource = true,
} = {}) {
  const errors = [];
  if (!manifest || manifest.schemaVersion !== RELEASE_MANIFEST_SCHEMA_VERSION) {
    errors.push("manifest_schema_version");
  }
  if (manifest?.immutable !== true) errors.push("manifest_not_immutable");
  if (manifest?.artifactKind !== "hanzhou-polaris-release") errors.push("manifest_artifact_kind");
  if (!manifest?.source?.revision || manifest.source.revision === "unknown") errors.push("source_revision_missing");
  if (requireCleanSource && manifest?.source?.dirty !== false) errors.push("source_dirty");
  const currentRevision = gitValue(root, ["rev-parse", "HEAD"]);
  if (currentRevision && manifest?.source?.revision !== currentRevision) errors.push("source_revision_drift");
  const frontend = await readFrontendManifest(root, webRoot);
  if (!frontend) errors.push("v2_release_manifest_missing");
  if (frontend && manifest?.ui?.sourceRevision !== frontend.sourceRevision) errors.push("ui_source_revision_drift");
  if (frontend && manifest?.ui?.buildId !== frontend.buildId) errors.push("ui_build_id_drift");
  for (const [key, definition] of Object.entries(COMPONENT_DEFINITIONS)) {
    const component = manifest?.components?.[key];
    if (!component || component.entry !== definition.entry || component.sourceRevision !== manifest?.source?.revision) {
      errors.push(`component:${key}:declaration`);
      continue;
    }
    if (component.status === "ready") {
      const actual = await fileInfo(root, component.entry);
      if (!actual.exists || actual.bytes !== component.bytes || actual.sha256 !== component.sha256) {
        errors.push(`component:${key}:hash`);
      }
    } else if (component.status !== "not_implemented") {
      errors.push(`component:${key}:status`);
    }
  }
  const migrationFiles = manifest?.schema?.migrations || [];
  if (!migrationFiles.length || !manifest?.schema?.range) errors.push("schema_range_missing");
  const currentMigrations = await migrationInventory(root);
  const expectedMigrationNames = currentMigrations.files.map(({ filename }) => filename);
  const declaredMigrationNames = migrationFiles.map(({ filename }) => filename);
  if (JSON.stringify(expectedMigrationNames) !== JSON.stringify(declaredMigrationNames)) {
    errors.push("schema_migration_inventory_drift");
  }
  for (const migration of migrationFiles) {
    const actual = await fileInfo(root, `server/cloud/migrations/${migration.filename}`);
    if (!actual.exists || actual.sha256 !== migration.sha256 || actual.bytes !== migration.bytes) {
      errors.push(`migration:${migration.filename}:hash`);
    }
  }
  const liveWrite = manifest?.flags?.liveWrite || {};
  for (const name of Object.keys(LIVE_WRITE_FLAGS)) {
    if (typeof liveWrite[name]?.enabled !== "boolean" || !liveWrite[name]?.envName) {
      errors.push(`flag:${name}:missing`);
    }
  }
  if (manifest?.publishCommandGate?.canAcceptNewPublishCommand === true &&
      manifest?.publishCommandGate?.blockers?.length) {
    errors.push("publish_gate_self_inconsistent");
  }
  if (manifest?.components?.outboxDispatcher?.status !== "ready" &&
      manifest?.publishCommandGate?.canAcceptNewPublishCommand === true) {
    errors.push("publish_gate_outbox_bypass");
  }
  return { passed: errors.length === 0, errors, manifest };
}

export async function writePolarisReleaseManifest(filename, options = {}) {
  const manifest = await createPolarisReleaseManifest(options);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.chmod(filename, 0o444);
  return manifest;
}

function optionValue(name) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const root = path.resolve(optionValue("--root") || defaultRoot);
  const webRoot = path.resolve(optionValue("--web-root") || path.join(root, "dist-v2"));
  const manifest = await createPolarisReleaseManifest({ root, webRoot });
  const report = await auditPolarisReleaseManifest({ root, webRoot, manifest });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
