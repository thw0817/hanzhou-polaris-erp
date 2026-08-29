import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  auditV2ReleaseArtifact,
  auditV2ReleaseReadiness,
  formatV2ReleaseArtifactReadiness,
  formatV2ReleaseReadiness,
  v2ReadinessObjectAuditSql,
  v2ReadinessRiskSql,
  v2ReadinessRoleAuditSql,
  v2RequiredMigrations,
} from "./audit-v2-release-readiness.js";

function queryType(text) {
  if (text.includes("FROM schema_migrations")) return "migrations";
  if (text.includes("expected_relations")) return "objects";
  if (text.includes("WITH runtime_role")) return "role";
  if (text.includes("expected_tables")) return "risk";
  if (text.includes("expected_capabilities")) return "runtime-capabilities";
  if (text.includes("WITH active_role")) return "runtime-role";
  return "unknown";
}

function inspectionPool({
  migrations = v2RequiredMigrations,
  failedObject = null,
  roleExists = true,
} = {}) {
  return {
    async query(query) {
      const type = queryType(query.text);
      if (type === "migrations") {
        return {
          rows: migrations.map(({ filename, checksum }) => ({
            filename,
            checksum,
          })),
        };
      }
      if (type === "objects") {
        return {
          rows: [
            { check_name: "relation:table:member_invitations", passed: true },
            {
              check_name: "constraint:shein_rule_snapshots_rule_type_check",
              passed: failedObject !== "constraint",
            },
            {
              check_name: "trigger:compliance_preflight_runs_immutable_row",
              passed: true,
            },
          ],
        };
      }
      if (type === "role") {
        return {
          rows: [{
            role_exists: roleExists,
            not_elevated: roleExists,
            not_database_owner_member: roleExists,
            not_public_schema_owner_member: roleExists,
            public_schema_boundary: roleExists,
            schema_migrations_no_write: roleExists,
            compliance_audit_append_only: roleExists,
          }],
        };
      }
      if (type === "risk") {
        return {
          rows: [
            { table_name: "sync_jobs", estimated_rows: "0", total_bytes: "0" },
            {
              table_name: "compliance_preflight_runs",
              estimated_rows: null,
              total_bytes: null,
            },
          ],
        };
      }
      throw new Error(`unexpected query: ${type}`);
    },
  };
}

function runtimePool({ failed = null } = {}) {
  return {
    async query(query) {
      const type = queryType(query.text);
      return {
        rows: [{
          check_name:
            type === "runtime-capabilities"
              ? "capability:table:stores"
              : "role:not_elevated",
          passed: failed !== type,
        }],
      };
    },
  };
}

async function createRelease() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shein-v2-ready-"));
  for (const migration of v2RequiredMigrations) {
    const filename = path.join(
      root,
      "server/cloud/migrations",
      migration.filename,
    );
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const source = await fs.readFile(
      path.join(
        process.cwd(),
        "server/cloud/migrations",
        migration.filename,
      ),
      "utf8",
    );
    await fs.writeFile(filename, source);
  }
  const contracts = {
    "server/cloud/control-server.js":
      "/publish-batches compliance-workspace publish\\/schema-coverage publish\\/schema-sync /preflight compliance\\/templates compliance-revalidation readback-status product-reviews readbackRepository: publishExecutionRepository",
    "server/cloud/publish-batch-service.js":
      "plan-execution authorize-execution executionEnabled: false authorizesPublishing: false",
    "server/cloud/product-review-service.js":
      "product_document_audit_status_notice_all_channels product_review_states failedReasons archived_at shelf_status === \"已上架\"",
    "server/cloud/publish-execution-protocol.js":
      "EXECUTION_REQUEST_CLAIM_TTL_MS result_unknown automaticRetryAfterUnknownResult: false skc_compliance_revalidated",
    "server/cloud/publish-execution-repository.js":
      "projectPublishExecutionAuthorization FOR UPDATE OF job SKIP LOCKED result_unknown PUBLISH_REQUEST_CLAIM_TTL_SECONDS appendWebhookReceipts appendDocumentStateReceipts appendComplianceRevalidationReceipt listPublishReadbackStatus ON CONFLICT (tenant_id, store_id, authorization_id) loadClaimedExecutionSource recordExecutionFailure",
    "server/cloud/product-publish-executor.js":
      '/open-api/goods/product/publishOrEdit PRODUCT_PUBLISH_EXECUTION_DISABLED PRODUCT_PUBLISH_CANDIDATE_INVALID outcome: "unknown"',
    "server/cloud/product-publish-worker.js":
      "PRODUCT_PUBLISH_JOB_NAME processProductPublishRun excludedJobIds recordExecutionFailure recordSubmitted",
    "server/cloud/product-publish-worker-server.js":
      "executionEnabled !== true WebProductPublishExecutor single-use-authorization-no-automatic-publish-retry",
    "server/cloud/document-state-projections.js":
      "normalizeProductDocumentState product-document-state-v1 audit_state",
    "server/cloud/spu-readback-projections.js":
      "normalizeSpuInfo spu-readback-v1 skcInfoList skuInfoList",
    "server/cloud/compliance-revalidation-projections.js":
      "buildComplianceRevalidation compliance-revalidation-v1 OFFICIAL_CAPABILITIES unsupported_by_official_api",
    "server/cloud/webhook-worker-server.js":
      "createDefaultWebhookProductionHandlers PostgresPublishExecutionRepository publishExecutionRepository",
    "src-v2/lib/api.ts":
      "publishBatches: revalidatePublishCompliance publishBatchReadbackStatus plan-execution authorize-execution authorizesPublishing: false",
    "src-v2/features/publishing/PublishBatchesPage.tsx":
      "商品审核中心 审核流程商品 api.publishNow(storeId, draftIds, idempotencyKey) api.productReviews(storeId) 已驳回且关联草稿的商品可直接重新发起",
    "deploy/postgres/audit-runtime-role.sql":
      "WITH active_role AS (SELECT 1) SELECT 'role:not_elevated' AS check_name, true AS passed",
    "deploy/postgres/audit-runtime-capabilities.sql":
      "WITH expected_capabilities AS (SELECT 1) SELECT 'capability:table:stores' AS check_name, true AS passed",
    "dist-v2/index.html":
      '<script type="module" src="/assets/app.js"></script>',
    "dist-v2/assets/app.js":
      "商品审核中心 审核流程商品 schema-coverage 全类目 schema 同步 当前类目的官方 schema 尚未完整同步",
  };
  for (const [filename, source] of Object.entries(contracts)) {
    const absolute = path.join(root, filename);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, source);
  }
  return root;
}

test("V2 artifact readiness checks the release without a database", async () => {
  const root = await createRelease();
  const report = await auditV2ReleaseArtifact({ root });

  assert.equal(report.ready, true);
  assert.deepEqual(report.blockers, []);
  assert.match(
    formatV2ReleaseArtifactReadiness(report),
    /V2 release artifact readiness: READY/,
  );
});

test("V2 artifact readiness blocks a release without the category schema gate", async () => {
  const root = await createRelease();
  await fs.writeFile(
    path.join(root, "dist-v2/assets/app.js"),
    "商品审核中心 审核流程商品",
  );

  const report = await auditV2ReleaseArtifact({ root });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers, ["release_web_artifact:v2"]);
  assert.deepEqual(
    report.release.webArtifact.missingMarkers,
    ["schema-coverage", "全类目 schema 同步", "当前类目的官方 schema 尚未完整同步"],
  );
});

test("V2 artifact readiness scans route-split JavaScript assets", async () => {
  const root = await createRelease();
  await fs.writeFile(
    path.join(root, "dist-v2/assets/app.js"),
    "商品审核中心 审核流程商品",
  );
  await fs.writeFile(
    path.join(root, "dist-v2/assets/compliance-page.js"),
    "schema-coverage 全类目 schema 同步 当前类目的官方 schema 尚未完整同步",
  );

  const report = await auditV2ReleaseArtifact({ root });

  assert.equal(report.ready, true);
  assert.equal(report.release.webArtifact.bundleFilenames.includes("assets/compliance-page.js"), true);
});

test("V2 readiness gate passes only a complete release and database", async () => {
  const root = await createRelease();
  const report = await auditV2ReleaseReadiness({
    root,
    inspectionPool: inspectionPool(),
    runtimePool: runtimePool(),
  });

  assert.equal(report.ready, true);
  assert.equal(report.publishingEnabled, false);
  assert.equal(report.authorizesPublishing, false);
  assert.deepEqual(report.blockers, []);
  assert.equal(
    report.database.migrations.every(({ status }) => status === "matched"),
    true,
  );
  assert.equal(report.release.webArtifact.passed, true);
  assert.deepEqual(report.database.riskSignals, [
    { table: "sync_jobs", estimatedRows: 0, totalBytes: 0 },
    {
      table: "compliance_preflight_runs",
      estimatedRows: null,
      totalBytes: null,
    },
  ]);
});

test("V2 readiness gate reports missing migrations, role and release support", async () => {
  const root = await createRelease();
  await fs.rm(
    path.join(root, "server/cloud/migrations/034_publish_execution_enablement.sql"),
  );
  await fs.writeFile(
    path.join(root, "dist-v2/assets/app.js"),
    "商品审核中心",
  );
  const report = await auditV2ReleaseReadiness({
    root,
    inspectionPool: inspectionPool({
      migrations: v2RequiredMigrations.filter(
        ({ filename }) => filename !== "034_publish_execution_enablement.sql",
      ),
      roleExists: false,
    }),
  });

  assert.equal(report.ready, false);
  assert.ok(
    report.blockers.includes(
      "release_migration:034_publish_execution_enablement.sql:missing",
    ),
  );
  assert.ok(
    report.blockers.includes(
      "database_migration:034_publish_execution_enablement.sql:missing",
    ),
  );
  assert.ok(report.blockers.includes("release_web_artifact:v2"));
  assert.ok(report.blockers.includes("runtime_role:role_exists"));
  assert.ok(
    report.blockers.includes(
      "runtime_capability:runtime_connection_not_audited",
    ),
  );
});

test("V2 readiness gate fails closed on checksum, object or capability drift", async () => {
  const root = await createRelease();
  const migrations = v2RequiredMigrations.map((migration) =>
    migration.filename === "025_certificate_library_snapshot.sql"
      ? { ...migration, checksum: "changed" }
      : migration
  );
  const report = await auditV2ReleaseReadiness({
    root,
    inspectionPool: inspectionPool({
      migrations,
      failedObject: "constraint",
    }),
    runtimePool: runtimePool({ failed: "runtime-capabilities" }),
  });

  assert.equal(report.ready, false);
  assert.ok(
    report.blockers.includes(
      "database_migration:025_certificate_library_snapshot.sql:mismatched",
    ),
  );
  assert.ok(
    report.blockers.includes(
      "database_object:constraint:shein_rule_snapshots_rule_type_check",
    ),
  );
  assert.ok(
    report.blockers.includes(
      "runtime_capability:capability:table:stores",
    ),
  );
});

test("V2 readiness gate hides runtime connection errors behind a stable blocker", async () => {
  const root = await createRelease();
  const report = await auditV2ReleaseReadiness({
    root,
    inspectionPool: inspectionPool(),
    runtimePool: {
      async query() {
        throw new Error("postgres://secret@example.invalid/database");
      },
    },
  });

  assert.equal(report.ready, false);
  assert.deepEqual(
    report.database.runtimeRole.runtimeAudit.failedChecks,
    ["runtime_audit_query_failed"],
  );
  assert.ok(
    report.blockers.includes(
      "runtime_capability:runtime_audit_query_failed",
    ),
  );
  assert.doesNotMatch(
    formatV2ReleaseReadiness(report),
    /secret|example\.invalid|postgres:\/\//,
  );
});

test("V2 readiness SQL and output remain read-only and credential-free", async () => {
  for (const sql of [
    v2ReadinessObjectAuditSql,
    v2ReadinessRoleAuditSql,
    v2ReadinessRiskSql,
  ]) {
    assert.doesNotMatch(
      sql,
      /\b(INSERT INTO|UPDATE\s+\w|DELETE FROM|TRUNCATE TABLE|CREATE\s+\w|ALTER\s+\w|DROP\s+\w|GRANT\s+\w|REVOKE\s+\w)\b/i,
    );
  }
  assert.match(v2ReadinessObjectAuditSql, /indisvalid/);
  assert.match(v2ReadinessObjectAuditSql, /tgenabled = 'A'/);
  assert.match(v2ReadinessObjectAuditSql, /publish_execution_runs/);
  assert.match(v2ReadinessObjectAuditSql, /publish_jobs_claimable_idx/);
  assert.match(
    v2ReadinessObjectAuditSql,
    /publish_execution_runs_execution_flags_consistent/,
  );
  assert.match(v2ReadinessObjectAuditSql, /publish_execution_runs_execution_flags_state/);
  assert.match(v2ReadinessRoleAuditSql, /shein_runtime/);
  assert.match(v2ReadinessRoleAuditSql, /schema_migrations_no_write/);

  const root = await createRelease();
  const report = await auditV2ReleaseReadiness({
    root,
    inspectionPool: inspectionPool({ roleExists: false }),
  });
  const output = formatV2ReleaseReadiness(report);
  assert.match(output, /executionEnabled=false/);
  assert.match(output, /021_member_invitations\.sql/);
  assert.doesNotMatch(
    output,
    /(?:postgres(?:ql)?:\/\/|DATABASE_URL\s*=|PASSWORD\s*=|SECRET\s*=)/i,
  );
});

test("V2 readiness CLI supports a separate dependency root", async () => {
  const source = await fs.readFile(
    new URL("./audit-v2-release-readiness.js", import.meta.url),
    "utf8",
  );
  const packageJson = JSON.parse(await fs.readFile(
    new URL("../../package.json", import.meta.url),
    "utf8",
  ));

  assert.match(source, /optionValue\("--module-root"\)/);
  assert.match(source, /createRequire\(path\.join\(moduleRoot, "package\.json"\)\)/);
  assert.equal(
    packageJson.scripts["db:audit:v2-readiness"],
    "node --env-file-if-exists=.env server/cloud/audit-v2-release-readiness.js",
  );
});
