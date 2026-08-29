import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  auditPolarisReleaseManifest,
  createPolarisReleaseManifest,
} from "./release-manifest.js";

const componentEntries = [
  "server/cloud/control-server.js",
  "server/cloud/product-publish-worker-server.js",
  "server/cloud/outbox-dispatcher.js",
  "server/cloud/store-business-refresh-worker-server.js",
  "server/cloud/rule-refresh-worker-server.js",
  "server/cloud/compliance-sync-worker-server.js",
  "server/cloud/webhook-server.js",
  "server/cloud/webhook-worker-server.js",
  "server/cloud/media-cleanup-worker-server.js",
];

async function fixtureRoot({ withOutbox = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "polaris-release-manifest-"));
  await fs.mkdir(path.join(root, "dist-v2"), { recursive: true });
  await fs.mkdir(path.join(root, "server/cloud/migrations"), { recursive: true });
  for (const entry of componentEntries) {
    if (entry.includes("outbox") && !withOutbox) continue;
    const filename = path.join(root, entry);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, `// ${entry}\n`);
  }
  await fs.writeFile(path.join(root, "server/cloud/migrations/001_initial.sql"), "create table fixture (id integer);\n");
  await fs.writeFile(path.join(root, "server/cloud/migrations/002_next.sql"), "alter table fixture add column label text;\n");
  await fs.writeFile(
    path.join(root, "dist-v2/release-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      artifactKind: "hanzhou-polaris-v2-frontend",
      buildId: "build-1",
      sourceRevision: "revision-1",
      buildTime: "2026-08-29T00:00:00.000Z",
      ui: { mode: "v2", marker: "polaris-v2", entry: "src-v2/main.tsx" },
      artifact: { outputDir: "dist-v2" },
    }),
  );
  return root;
}

test("release manifest declares source, UI, services, schema and disabled write flags", async () => {
  const root = await fixtureRoot();
  const environment = {
    POLARIS_SOURCE_REVISION: "revision-1",
    POLARIS_BUILD_ID: "build-1",
    POLARIS_BUILD_TIME: "2026-08-29T00:00:00.000Z",
    SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED: "false",
  };
  const manifest = await createPolarisReleaseManifest({ root, environment });
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.source.revision, "revision-1");
  assert.equal(manifest.ui.marker, "polaris-v2");
  assert.equal(manifest.components.control.status, "ready");
  assert.equal(manifest.components.outboxDispatcher.status, "ready");
  assert.equal(manifest.schema.range.max, "002_next.sql");
  assert.equal(manifest.flags.liveWrite.productPublish.enabled, false);
  assert.equal(manifest.publishCommandGate.canAcceptNewPublishCommand, false);
  assert.deepEqual(manifest.publishCommandGate.blockers, ["product_publish_live_write_disabled"]);
  const report = await auditPolarisReleaseManifest({ root, manifest, requireCleanSource: false });
  assert.equal(report.passed, true);
});

test("manifest audit catches component and migration drift", async () => {
  const root = await fixtureRoot();
  const manifest = await createPolarisReleaseManifest({
    root,
    environment: {
      POLARIS_SOURCE_REVISION: "revision-1",
      POLARIS_BUILD_ID: "build-1",
      POLARIS_BUILD_TIME: "2026-08-29T00:00:00.000Z",
    },
  });
  await fs.appendFile(path.join(root, "server/cloud/control-server.js"), "// tampered\n");
  await fs.writeFile(path.join(root, "server/cloud/migrations/003_drift.sql"), "-- drift\n");
  const report = await auditPolarisReleaseManifest({ root, manifest, requireCleanSource: false });
  assert.equal(report.passed, false);
  assert.ok(report.errors.includes("component:control:hash"));
  assert.ok(report.errors.includes("schema_migration_inventory_drift"));
});

test("missing Outbox Dispatcher stays declared but blocks publishing", async () => {
  const root = await fixtureRoot({ withOutbox: false });
  const manifest = await createPolarisReleaseManifest({
    root,
    environment: { POLARIS_SOURCE_REVISION: "revision-1", POLARIS_BUILD_ID: "build-1" },
  });
  assert.equal(manifest.components.outboxDispatcher.entry, "server/cloud/outbox-dispatcher.js");
  assert.equal(manifest.components.outboxDispatcher.status, "not_implemented");
  assert.equal(manifest.publishCommandGate.canAcceptNewPublishCommand, false);
  assert.ok(manifest.publishCommandGate.blockers.includes("outboxDispatcher_not_implemented"));
});
