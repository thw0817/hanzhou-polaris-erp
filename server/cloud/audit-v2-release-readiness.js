import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const v2RequiredMigrations = Object.freeze([
  {
    filename: "021_member_invitations.sql",
    checksum: "e819325698a6f8707e974b7b218a33a290203f07fc7d114876753a07cbbd742e",
  },
  {
    filename: "022_sync_job_history_index.sql",
    checksum: "897e31b6d6d58c578c4229f1e3a529c82c4c86a0137d950a66d076f4bbd580c7",
  },
  {
    filename: "023_shein_rule_snapshots.sql",
    checksum: "8945ffb8926a90cca525f05443e8b1f446f25324e96c4fd24b66dcddc8c6f90a",
  },
  {
    filename: "024_compliance_preflight_runs.sql",
    checksum: "687f94fa1e0ea0caa15d9ed46d470f869a0797227bceb696499e08651f42ba26",
  },
  {
    filename: "025_certificate_library_snapshot.sql",
    checksum: "53d9cd2427e27bacc6ebe062d18d7cfe4d576bdab8130403e599251084735615",
  },
  {
    filename: "026_agency_library_snapshot.sql",
    checksum: "da14638007d495b7d417826d454f29b6fd618c38cfd5ef2662114dd79a03745c",
  },
  {
    filename: "027_warning_rules_snapshot.sql",
    checksum: "ba1d1e6503e90f5f13157dd8b6d720894d0bb84e64d187f84b5d1bbd84e3bb4a",
  },
  {
    filename: "028_compliance_preflight_reviews.sql",
    checksum: "f4af352c7867190b998259a8d5f05ca7ea508f7d97caf548a55496018496415d",
  },
  {
    filename: "029_compliance_audit_immutability.sql",
    checksum: "0a31ef4cf1d189da6a75682c3c26b86ae083a10eb7ebc0eb71a15555f9db4139",
  },
  {
    filename: "030_publish_execution_state.sql",
    checksum: "12eee269cceca76d5d76f9eee9f0acaced074bce3c6aa5ffaa2134052a6e9528",
  },
  {
    filename: "031_title_rule_templates.sql",
    checksum: "fa751c1d1aceccf175275940807a4f2b93d2361ddc737fe5ec600afdc5d22e42",
  },
  {
    filename: "032_commercial_templates.sql",
    checksum: "fff556ed753f5de354afb95ba9e1e695163012828eb7c11cf61955e1cdd81324",
  },
  {
    filename: "033_publish_settings_templates.sql",
    checksum: "e7fb9ec1e83f5ebb1a9a832d3977da20a2c137a0995c9f1655a668edd28dd705",
  },
  {
    filename: "034_publish_execution_enablement.sql",
    checksum: "4771b27adc163a78d6440cf2b5f7e8466696117ce6d8d8bfc929c038e5a6a7c3",
  },
  {
    filename: "036_store_admin_alias.sql",
    checksum: "be013dcdfb673629b41e4f79ffb346c46cfe2d932b3ac38a68de702dce485a82",
  },
  {
    filename: "037_repair_admin_publish_template_scopes.sql",
    checksum: "91202ca428f4821cc9b8244cc0de8f50f3db7bdca413c95ec74e8158243ea9a3",
  },
  {
    filename: "038_business_webhook_freshness.sql",
    checksum: "6c2688c887c021b5aecb09c5e4af2186a43c5540baf0ae26ecc740c41f31d471",
  },
  {
    filename: "039_product_review_states.sql",
    checksum: "4db3b3094b17b2b1b1c492de7e6c15f9fcfa5658c23f91e72a67890e8a6f2ee4",
  },
  {
    filename: "040_runtime_retention_hardening.sql",
    checksum: "b4cb1b2bdbdad54e93d2cd453ffa45e8a445f2046c78b1dfe632622e1c98cedf",
  },
  {
    filename: "041_ai_title_feature_grants.sql",
    checksum: "77d84b0029c99d42b943dd0fa18d8bf1a7362283d96c2eff276dbf07983f677d",
  },
  {
    filename: "042_ai_title_settings.sql",
    checksum: "a4b72f380bd10f656d9f54b3c397459b5108c1d51087b7135ce7400fe643d1db",
  },
  {
    filename: "043_product_review_workflow.sql",
    checksum: "17f1643fa34bcd20e948473aea10edbacd6e30bbf5b218bb6e9fd83af6f121bc",
  },
  {
    filename: "044_user_admin_alias.sql",
    checksum: "c50b0f7bdf8c11b2552ed3de550e896e8ad0c0039d99daf133ca5e3f239be034",
  },
  {
    filename: "045_publish_lifecycle_indexes.sql",
    checksum: "1c1e011a6318b7f869fd8c0e37e7628dbd139a9e9a088bc794f5bd234d55077d",
  },
]);

const releaseContracts = Object.freeze([
  {
    filename: "server/cloud/control-server.js",
    markers: [
      "/publish-batches",
      "compliance-workspace",
      "publish\\/schema-coverage",
      "publish\\/schema-sync",
      "/preflight",
      "compliance\\/templates",
      "compliance-revalidation",
      "readback-status",
      "product-reviews",
      "readbackRepository: publishExecutionRepository",
    ],
  },
  {
    filename: "server/cloud/publish-batch-service.js",
    markers: [
      "plan-execution",
      "authorize-execution",
      "executionEnabled: false",
      "authorizesPublishing: false",
    ],
  },
  {
    filename: "server/cloud/product-review-service.js",
    markers: [
      "product_document_audit_status_notice_all_channels",
      "product_review_states",
      "failedReasons",
      "archived_at",
      "shelf_status === \"已上架\"",
    ],
  },
  {
    filename: "server/cloud/publish-execution-protocol.js",
    markers: [
      "EXECUTION_REQUEST_CLAIM_TTL_MS",
      "result_unknown",
      "automaticRetryAfterUnknownResult: false",
      "skc_compliance_revalidated",
    ],
  },
  {
    filename: "server/cloud/publish-execution-repository.js",
    markers: [
      "projectPublishExecutionAuthorization",
      "FOR UPDATE OF job SKIP LOCKED",
      "result_unknown",
      "PUBLISH_REQUEST_CLAIM_TTL_SECONDS",
      "appendWebhookReceipts",
      "appendDocumentStateReceipts",
      "appendComplianceRevalidationReceipt",
      "listPublishReadbackStatus",
      "ON CONFLICT (tenant_id, store_id, authorization_id)",
      "loadClaimedExecutionSource",
      "recordExecutionFailure",
    ],
  },
  {
    filename: "server/cloud/product-publish-executor.js",
    markers: [
      "/open-api/goods/product/publishOrEdit",
      "PRODUCT_PUBLISH_EXECUTION_DISABLED",
      "PRODUCT_PUBLISH_CANDIDATE_INVALID",
      "outcome: \"unknown\"",
    ],
  },
  {
    filename: "server/cloud/product-publish-worker.js",
    markers: [
      "PRODUCT_PUBLISH_JOB_NAME",
      "processProductPublishRun",
      "excludedJobIds",
      "recordExecutionFailure",
      "recordSubmitted",
    ],
  },
  {
    filename: "server/cloud/product-publish-worker-server.js",
    markers: [
      "executionEnabled !== true",
      "WebProductPublishExecutor",
      "single-use-authorization-no-automatic-publish-retry",
    ],
  },
  {
    filename: "server/cloud/document-state-projections.js",
    markers: [
      "normalizeProductDocumentState",
      "product-document-state-v1",
      "audit_state",
    ],
  },
  {
    filename: "server/cloud/spu-readback-projections.js",
    markers: [
      "normalizeSpuInfo",
      "spu-readback-v1",
      "skcInfoList",
      "skuInfoList",
    ],
  },
  {
    filename: "server/cloud/compliance-revalidation-projections.js",
    markers: [
      "buildComplianceRevalidation",
      "compliance-revalidation-v1",
      "OFFICIAL_CAPABILITIES",
      "unsupported_by_official_api",
    ],
  },
  {
    filename: "server/cloud/webhook-worker-server.js",
    markers: [
      "createDefaultWebhookProductionHandlers",
      "PostgresPublishExecutionRepository",
      "publishExecutionRepository",
    ],
  },
  {
    filename: "src-v2/lib/api.ts",
    markers: [
      "publishBatches:",
      "revalidatePublishCompliance",
      "publishBatchReadbackStatus",
      "plan-execution",
      "authorize-execution",
      "authorizesPublishing: false",
    ],
  },
  {
    filename: "src-v2/features/publishing/PublishBatchesPage.tsx",
    markers: [
      "商品审核中心",
      "审核流程商品",
      "api.publishNow(storeId, draftIds, idempotencyKey)",
      "api.productReviews(storeId)",
      "已驳回且关联草稿的商品可直接重新发起",
    ],
  },
]);

export const v2ReadinessObjectAuditSql = `
WITH expected_relations (object_name, object_kind) AS (
  VALUES
    ('member_invitations', 'table'),
    ('shein_rule_snapshots', 'table'),
    ('compliance_preflight_runs', 'table'),
    ('compliance_preflight_reviews', 'table'),
    ('member_invitations_one_active_email_idx', 'index'),
    ('member_invitations_expiry_idx', 'index'),
    ('sync_jobs_tenant_store_history_idx', 'index'),
    ('shein_rule_snapshots_tenant_store_expiry_idx', 'index'),
    ('compliance_preflight_runs_tenant_store_skc_idx', 'index'),
    ('compliance_preflight_reviews_run_user_idx', 'index'),
    ('compliance_preflight_reviews_scope_idx', 'index'),
    ('publish_execution_runs', 'table'),
    ('publish_jobs', 'table'),
    ('publish_receipts', 'table'),
    ('publish_jobs_claimable_idx', 'index'),
    ('publish_jobs_claim_expiry_idx', 'index'),
    ('publish_jobs_platform_identity_idx', 'index'),
    ('publish_batch_items_product_draft_idx', 'index'),
    ('publish_jobs_product_draft_scope_idx', 'index')
),
expected_triggers (table_name, trigger_name, trigger_type) AS (
  VALUES
    ('compliance_preflight_runs', 'compliance_preflight_runs_immutable_row', 27),
    ('compliance_preflight_runs', 'compliance_preflight_runs_immutable_truncate', 34),
    ('compliance_preflight_reviews', 'compliance_preflight_reviews_immutable_row', 27),
    ('compliance_preflight_reviews', 'compliance_preflight_reviews_immutable_truncate', 34)
),
checks (check_name, passed) AS (
  SELECT
    'relation:' || expected.object_kind || ':' || expected.object_name,
    CASE
      WHEN expected.object_kind = 'table' THEN relation.relkind IN ('r', 'p')
      WHEN expected.object_kind = 'index' THEN
        relation.relkind = 'i' AND installed_index.indisvalid AND installed_index.indisready
      ELSE false
    END
  FROM expected_relations AS expected
  LEFT JOIN pg_namespace AS namespace
    ON namespace.nspname = 'public'
  LEFT JOIN pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = expected.object_name
  LEFT JOIN pg_index AS installed_index
    ON installed_index.indexrelid = relation.oid

  UNION ALL

  SELECT
    'constraint:shein_rule_snapshots_rule_type_check',
    EXISTS (
      SELECT 1
      FROM pg_constraint AS installed_constraint
      JOIN pg_class AS relation
        ON relation.oid = installed_constraint.conrelid
      JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
       AND namespace.nspname = 'public'
      WHERE relation.relname = 'shein_rule_snapshots'
        AND installed_constraint.conname = 'shein_rule_snapshots_rule_type_check'
        AND installed_constraint.contype = 'c'
        AND installed_constraint.convalidated
        AND position('category_tree' IN pg_get_constraintdef(installed_constraint.oid)) > 0
        AND position('publish_standard' IN pg_get_constraintdef(installed_constraint.oid)) > 0
        AND position('attribute_template' IN pg_get_constraintdef(installed_constraint.oid)) > 0
        AND position('associated_rules' IN pg_get_constraintdef(installed_constraint.oid)) > 0
        AND position('compliance_requirement' IN pg_get_constraintdef(installed_constraint.oid)) > 0
        AND position('certificate_schema' IN pg_get_constraintdef(installed_constraint.oid)) > 0
        AND position('certificate_library' IN pg_get_constraintdef(installed_constraint.oid)) > 0
        AND position('agency_library' IN pg_get_constraintdef(installed_constraint.oid)) > 0
        AND position('warning_rules' IN pg_get_constraintdef(installed_constraint.oid)) > 0
    )

  UNION ALL

  SELECT
    'constraint:publish_templates_template_type_check',
    EXISTS (
      SELECT 1
      FROM pg_constraint AS installed_constraint
      JOIN pg_class AS relation
        ON relation.oid = installed_constraint.conrelid
      JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
       AND namespace.nspname = 'public'
      WHERE relation.relname = 'publish_templates'
        AND installed_constraint.conname = 'publish_templates_template_type_check'
        AND installed_constraint.contype = 'c'
        AND installed_constraint.convalidated
        AND position('title_rule' IN pg_get_constraintdef(installed_constraint.oid)) > 0
        AND position('commercial' IN pg_get_constraintdef(installed_constraint.oid)) > 0
        AND position('publish_settings' IN pg_get_constraintdef(installed_constraint.oid)) > 0
    )

  UNION ALL

  SELECT
    'function:prevent_compliance_audit_mutation',
    EXISTS (
      SELECT 1
      FROM pg_proc AS guard_function
      JOIN pg_namespace AS namespace
        ON namespace.oid = guard_function.pronamespace
       AND namespace.nspname = 'public'
      WHERE guard_function.oid =
            to_regprocedure('public.prevent_compliance_audit_mutation()')
        AND guard_function.pronargs = 0
        AND guard_function.prorettype = 'trigger'::regtype
        AND position(
          'append-only compliance audit'
          IN pg_get_functiondef(guard_function.oid)
      ) > 0
    )

  UNION ALL

  SELECT
    'constraint:publish_execution_runs_execution_flags_consistent',
    EXISTS (
      SELECT 1
      FROM pg_constraint AS installed_constraint
      JOIN pg_class AS relation
        ON relation.oid = installed_constraint.conrelid
      JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
       AND namespace.nspname = 'public'
      WHERE relation.relname = 'publish_execution_runs'
        AND installed_constraint.conname =
            'publish_execution_runs_execution_flags_consistent'
        AND installed_constraint.contype = 'c'
        AND installed_constraint.convalidated
        AND position(
          'execution_enabled = authorizes_publishing'
          IN pg_get_constraintdef(installed_constraint.oid)
        ) > 0
    )

  UNION ALL

  SELECT
    'constraint:publish_execution_runs_execution_flags_state',
    EXISTS (
      SELECT 1
      FROM pg_constraint AS installed_constraint
      JOIN pg_class AS relation
        ON relation.oid = installed_constraint.conrelid
      JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
       AND namespace.nspname = 'public'
      WHERE relation.relname = 'publish_execution_runs'
        AND installed_constraint.conname =
            'publish_execution_runs_execution_flags_state'
        AND installed_constraint.contype = 'c'
        AND installed_constraint.convalidated
        AND position(
          'state = ''running'''
          IN pg_get_constraintdef(installed_constraint.oid)
        ) > 0
        AND position(
          'execution_enabled'
          IN pg_get_constraintdef(installed_constraint.oid)
        ) > 0
        AND position(
          'authorizes_publishing'
          IN pg_get_constraintdef(installed_constraint.oid)
        ) > 0
    )

  UNION ALL

  SELECT
    'trigger:' || expected.trigger_name,
    installed_trigger.oid IS NOT NULL
  FROM expected_triggers AS expected
  LEFT JOIN pg_namespace AS namespace
    ON namespace.nspname = 'public'
  LEFT JOIN pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = expected.table_name
  LEFT JOIN pg_trigger AS installed_trigger
    ON installed_trigger.tgrelid = relation.oid
   AND installed_trigger.tgname = expected.trigger_name
   AND installed_trigger.tgenabled = 'A'
   AND installed_trigger.tgfoid =
       to_regprocedure('public.prevent_compliance_audit_mutation()')
   AND installed_trigger.tgtype = expected.trigger_type
   AND NOT installed_trigger.tgisinternal
)
SELECT check_name, passed
FROM checks
ORDER BY check_name
`;

export const v2ReadinessRoleAuditSql = `
WITH runtime_role AS (
  SELECT
    oid,
    rolsuper,
    rolcreaterole,
    rolcreatedb,
    rolreplication,
    rolbypassrls
  FROM pg_roles
  WHERE rolname = 'shein_runtime'
),
database_owner AS (
  SELECT datdba
  FROM pg_database
  WHERE datname = current_database()
),
public_schema AS (
  SELECT oid, nspowner
  FROM pg_namespace
  WHERE nspname = 'public'
),
objects AS (
  SELECT
    to_regclass('public.schema_migrations') AS migrations_oid,
    to_regclass('public.compliance_preflight_runs') AS runs_oid,
    to_regclass('public.compliance_preflight_reviews') AS reviews_oid
)
SELECT
  EXISTS (SELECT 1 FROM runtime_role) AS role_exists,
  COALESCE((
    SELECT NOT (
      rolsuper OR
      rolcreaterole OR
      rolcreatedb OR
      rolreplication OR
      rolbypassrls
    )
    FROM runtime_role
  ), false) AS not_elevated,
  COALESCE((
    SELECT NOT pg_has_role(runtime_role.oid, database_owner.datdba, 'MEMBER')
    FROM runtime_role, database_owner
  ), false) AS not_database_owner_member,
  COALESCE((
    SELECT NOT pg_has_role(runtime_role.oid, public_schema.nspowner, 'MEMBER')
    FROM runtime_role, public_schema
  ), false) AS not_public_schema_owner_member,
  COALESCE((
    SELECT
      has_schema_privilege(runtime_role.oid, public_schema.oid, 'USAGE') AND
      NOT has_schema_privilege(runtime_role.oid, public_schema.oid, 'CREATE')
    FROM runtime_role, public_schema
  ), false) AS public_schema_boundary,
  COALESCE((
    SELECT
      objects.migrations_oid IS NOT NULL AND
      NOT has_table_privilege(runtime_role.oid, objects.migrations_oid, 'INSERT') AND
      NOT has_table_privilege(runtime_role.oid, objects.migrations_oid, 'UPDATE') AND
      NOT has_table_privilege(runtime_role.oid, objects.migrations_oid, 'DELETE') AND
      NOT has_table_privilege(runtime_role.oid, objects.migrations_oid, 'TRUNCATE')
    FROM runtime_role, objects
  ), false) AS schema_migrations_no_write,
  COALESCE((
    SELECT bool_and(
      protected.object_oid IS NOT NULL AND
      has_table_privilege(runtime_role.oid, protected.object_oid, 'SELECT') AND
      has_table_privilege(runtime_role.oid, protected.object_oid, 'INSERT') AND
      NOT has_table_privilege(runtime_role.oid, protected.object_oid, 'UPDATE') AND
      NOT has_table_privilege(runtime_role.oid, protected.object_oid, 'DELETE') AND
      NOT has_table_privilege(runtime_role.oid, protected.object_oid, 'TRUNCATE') AND
      NOT has_table_privilege(runtime_role.oid, protected.object_oid, 'TRIGGER')
    )
    FROM runtime_role
    CROSS JOIN objects
    CROSS JOIN LATERAL (
      VALUES (objects.runs_oid), (objects.reviews_oid)
    ) AS protected(object_oid)
  ), false) AS compliance_audit_append_only
`;

export const v2ReadinessRiskSql = `
WITH expected_tables (table_name) AS (
  VALUES
    ('sync_jobs'),
    ('skcs'),
    ('compliance_drafts'),
    ('product_drafts'),
    ('publish_batches'),
    ('users'),
    ('memberships'),
    ('compliance_preflight_runs'),
    ('compliance_preflight_reviews')
)
SELECT
  expected.table_name,
  CASE
    WHEN relation.oid IS NULL THEN NULL
    ELSE GREATEST(relation.reltuples, 0)::bigint
  END AS estimated_rows,
  CASE
    WHEN relation.oid IS NULL THEN NULL
    ELSE pg_total_relation_size(relation.oid)
  END AS total_bytes
FROM expected_tables AS expected
LEFT JOIN pg_namespace AS namespace
  ON namespace.nspname = 'public'
LEFT JOIN pg_class AS relation
  ON relation.relnamespace = namespace.oid
 AND relation.relname = expected.table_name
 AND relation.relkind IN ('r', 'p')
ORDER BY expected.table_name
`;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function readText(filename) {
  try {
    return { exists: true, text: await fs.readFile(filename, "utf8") };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, text: "" };
    throw error;
  }
}

function failedChecks(rows) {
  return (rows || [])
    .filter((row) => row?.passed !== true)
    .map((row) => String(row.check_name || "unnamed"));
}

async function auditRelease({ root, webRoot }) {
  const migrations = [];
  for (const expected of v2RequiredMigrations) {
    const filename = path.join(
      root,
      "server/cloud/migrations",
      expected.filename,
    );
    const file = await readText(filename);
    const actualChecksum = file.exists ? sha256(file.text) : null;
    migrations.push({
      ...expected,
      releaseChecksum: actualChecksum,
      status: !file.exists
        ? "missing"
        : actualChecksum === expected.checksum
          ? "matched"
          : "mismatched",
    });
  }

  const contracts = [];
  for (const contract of releaseContracts) {
    const file = await readText(path.join(root, contract.filename));
    const missingMarkers = file.exists
      ? contract.markers.filter((marker) => !file.text.includes(marker))
      : [...contract.markers];
    contracts.push({
      filename: contract.filename,
      exists: file.exists,
      missingMarkers,
      passed: file.exists && missingMarkers.length === 0,
    });
  }

  const indexFile = await readText(path.join(webRoot, "index.html"));
  let bundle = { exists: false, text: "" };
  let bundleFilename = null;
  const bundleFilenames = new Set();
  if (indexFile.exists) {
    const assetPath = indexFile.text.match(
      /<script[^>]+src=["']([^"']+\.js)["']/i,
    )?.[1];
    if (assetPath) {
      bundleFilename = assetPath.replace(/^\/+/, "");
      bundleFilenames.add(bundleFilename);
    }
  }
  // Vite route-level code splitting moves feature markers out of the entry
  // chunk. Audit every generated JS asset so a valid split release is not
  // rejected merely because the first entry chunk is intentionally small.
  async function collectJavaScriptAssets(directory, prefix = "") {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = path.join(prefix, entry.name);
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await collectJavaScriptAssets(absolute, relative);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        bundleFilenames.add(relative);
      }
    }
  }
  await collectJavaScriptAssets(webRoot);
  const bundles = await Promise.all(
    [...bundleFilenames].map(async (filename) => ({
      filename,
      ...(await readText(path.join(webRoot, filename))),
    })),
  );
  const primaryBundle = bundleFilename
    ? bundles.find((candidate) => candidate.filename === bundleFilename)
    : null;
  bundle = primaryBundle || bundles.find((candidate) => candidate.exists) || bundle;
  const bundleText = bundles
    .filter((candidate) => candidate.exists)
    .map((candidate) => candidate.text)
    .join("\n");
  const webMarkers = [
    "商品审核中心",
    "审核流程商品",
    "schema-coverage",
    "全类目 schema 同步",
    "当前类目的官方 schema 尚未完整同步",
  ];
  const missingWebMarkers = bundleText
    ? webMarkers.filter((marker) => !bundleText.includes(marker))
    : [...webMarkers];

  return {
    root,
    webRoot,
    migrations,
    contracts,
    webArtifact: {
      indexExists: indexFile.exists,
      bundleFilename,
      bundleFilenames: [...bundleFilenames].sort(),
      bundleExists: bundle.exists,
      missingMarkers: missingWebMarkers,
      passed:
        indexFile.exists &&
        bundle.exists &&
        missingWebMarkers.length === 0,
    },
  };
}

export async function auditV2ReleaseArtifact({
  root,
  webRoot = path.join(root, "dist-v2"),
} = {}) {
  if (!root) throw new TypeError("root不能为空");
  const release = await auditRelease({ root, webRoot });
  const blockers = [];

  for (const migration of release.migrations) {
    if (migration.status !== "matched") {
      blockers.push(`release_migration:${migration.filename}:${migration.status}`);
    }
  }
  for (const contract of release.contracts) {
    if (!contract.passed) {
      blockers.push(`release_contract:${contract.filename}`);
    }
  }
  if (!release.webArtifact.passed) {
    blockers.push("release_web_artifact:v2");
  }

  return {
    ready: blockers.length === 0,
    publishingEnabled: false,
    authorizesPublishing: false,
    release,
    blockers,
  };
}

async function auditDatabase({ root, inspectionPool, runtimePool }) {
  const migrationResult = await inspectionPool.query({
    text: `
      SELECT filename, checksum
      FROM schema_migrations
      WHERE filename = ANY($1::text[])
      ORDER BY filename
    `,
    values: [v2RequiredMigrations.map(({ filename }) => filename)],
  });
  const recordedMigrations = new Map(
    migrationResult.rows.map((row) => [row.filename, row.checksum]),
  );
  const migrations = v2RequiredMigrations.map((expected) => {
    const databaseChecksum = recordedMigrations.get(expected.filename) || null;
    return {
      ...expected,
      databaseChecksum,
      status: !databaseChecksum
        ? "missing"
        : databaseChecksum === expected.checksum
          ? "matched"
          : "mismatched",
    };
  });

  const [objectResult, roleResult, riskResult] = await Promise.all([
    inspectionPool.query({
      text: v2ReadinessObjectAuditSql,
      queryMode: "simple",
    }),
    inspectionPool.query({
      text: v2ReadinessRoleAuditSql,
      queryMode: "simple",
    }),
    inspectionPool.query({
      text: v2ReadinessRiskSql,
      queryMode: "simple",
    }),
  ]);

  const role = roleResult.rows[0] || {};
  const roleChecks = [
    "role_exists",
    "not_elevated",
    "not_database_owner_member",
    "not_public_schema_owner_member",
    "public_schema_boundary",
    "schema_migrations_no_write",
    "compliance_audit_append_only",
  ].map((checkName) => ({
    checkName,
    passed: role[checkName] === true,
  }));

  let runtimeAudit = {
    attempted: false,
    passed: false,
    failedChecks: ["runtime_connection_not_audited"],
  };
  if (role.role_exists === true && runtimePool) {
    try {
      const checks = [];
      for (const filename of [
        "audit-runtime-role.sql",
        "audit-runtime-capabilities.sql",
      ]) {
        const auditFile = await readText(
          path.join(root, "deploy/postgres", filename),
        );
        if (!auditFile.exists) {
          checks.push({
            check_name: `audit_file:${filename}`,
            passed: false,
          });
          continue;
        }
        const result = await runtimePool.query({
          text: auditFile.text,
          queryMode: "simple",
        });
        if (!result.rows?.length) {
          checks.push({
            check_name: `audit_result:${filename}`,
            passed: false,
          });
        } else {
          checks.push(...result.rows);
        }
      }
      const runtimeFailedChecks = failedChecks(checks);
      runtimeAudit = {
        attempted: true,
        passed: runtimeFailedChecks.length === 0,
        failedChecks: runtimeFailedChecks,
      };
    } catch {
      runtimeAudit = {
        attempted: true,
        passed: false,
        failedChecks: ["runtime_audit_query_failed"],
      };
    }
  }

  return {
    migrations,
    objects: {
      checks: objectResult.rows,
      failedChecks: failedChecks(objectResult.rows),
    },
    runtimeRole: {
      checks: roleChecks,
      failedChecks: roleChecks
        .filter((check) => !check.passed)
        .map((check) => check.checkName),
      runtimeAudit,
    },
    riskSignals: riskResult.rows.map((row) => ({
      table: row.table_name,
      estimatedRows:
        row.estimated_rows === null ? null : Number(row.estimated_rows),
      totalBytes: row.total_bytes === null ? null : Number(row.total_bytes),
    })),
  };
}

export async function auditV2ReleaseReadiness({
  root,
  webRoot = path.join(root, "dist-v2"),
  inspectionPool,
  runtimePool = null,
} = {}) {
  if (!root || !inspectionPool) {
    throw new TypeError("root和inspectionPool不能为空");
  }
  const [artifact, database] = await Promise.all([
    auditV2ReleaseArtifact({ root, webRoot }),
    auditDatabase({ root, inspectionPool, runtimePool }),
  ]);
  const { release } = artifact;
  const blockers = [...artifact.blockers];
  for (const migration of database.migrations) {
    if (migration.status !== "matched") {
      blockers.push(`database_migration:${migration.filename}:${migration.status}`);
    }
  }
  blockers.push(
    ...database.objects.failedChecks.map((check) => `database_object:${check}`),
    ...database.runtimeRole.failedChecks.map((check) => `runtime_role:${check}`),
  );
  if (!database.runtimeRole.runtimeAudit.passed) {
    blockers.push(
      ...database.runtimeRole.runtimeAudit.failedChecks.map(
        (check) => `runtime_capability:${check}`,
      ),
    );
  }

  return {
    ready: blockers.length === 0,
    publishingEnabled: false,
    authorizesPublishing: false,
    release,
    database,
    blockers,
  };
}

export function formatV2ReleaseArtifactReadiness(report) {
  const lines = [
    `V2 release artifact readiness: ${report.ready ? "READY" : "NOT READY"}`,
    "Publishing remains disabled: executionEnabled=false, authorizesPublishing=false",
    "",
    "Release migrations:",
  ];
  for (const migration of report.release.migrations) {
    lines.push(`- ${migration.filename} release=${migration.status}`);
  }
  lines.push(
    "",
    `Release contracts: ${report.release.contracts.filter((item) => item.passed).length}/${report.release.contracts.length}`,
    `V2 web artifact: ${report.release.webArtifact.passed ? "passed" : "failed"}`,
    "",
    "Blockers:",
  );
  lines.push(...(report.blockers.length
    ? report.blockers.map((blocker) => `- ${blocker}`)
    : ["- none"]));
  return `${lines.join("\n")}\n`;
}

export function formatV2ReleaseReadiness(report) {
  const lines = [
    `V2 release readiness: ${report.ready ? "READY" : "NOT READY"}`,
    "Publishing remains disabled: executionEnabled=false, authorizesPublishing=false",
    "",
    "Migrations:",
  ];
  for (const migration of report.database.migrations) {
    lines.push(
      `- ${migration.filename} ${migration.checksum} database=${migration.status}`,
    );
  }
  lines.push(
    "",
    `Release contracts: ${report.release.contracts.filter((item) => item.passed).length}/${report.release.contracts.length}`,
    `V2 web artifact: ${report.release.webArtifact.passed ? "passed" : "failed"}`,
    `Database objects: ${report.database.objects.failedChecks.length ? report.database.objects.failedChecks.join(", ") : "passed"}`,
    `Runtime role: ${report.database.runtimeRole.failedChecks.length ? report.database.runtimeRole.failedChecks.join(", ") : "passed"}`,
    `Runtime capability audit: ${report.database.runtimeRole.runtimeAudit.passed ? "passed" : report.database.runtimeRole.runtimeAudit.failedChecks.join(", ")}`,
    "",
    "Risk signals (PostgreSQL estimates):",
  );
  for (const signal of report.database.riskSignals) {
    lines.push(
      `- ${signal.table}: rows=${signal.estimatedRows ?? "missing"}, bytes=${signal.totalBytes ?? "missing"}`,
    );
  }
  lines.push("", "Blockers:");
  lines.push(...(report.blockers.length
    ? report.blockers.map((blocker) => `- ${blocker}`)
    : ["- none"]));
  return `${lines.join("\n")}\n`;
}

function optionValue(name) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const root = path.resolve(optionValue("--root") || process.cwd());
  const webRoot = path.resolve(
    optionValue("--web-root") || path.join(root, "dist-v2"),
  );
  const moduleRoot = path.resolve(optionValue("--module-root") || root);
  if (process.argv.includes("--static-only")) {
    const report = await auditV2ReleaseArtifact({ root, webRoot });
    process.stdout.write(
      process.argv.includes("--json")
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatV2ReleaseArtifactReadiness(report),
    );
    process.exitCode = report.ready ? 0 : 1;
    return;
  }
  const inspectionUrl =
    process.env.SHEIN_MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  const runtimeUrl =
    process.env.SHEIN_RUNTIME_DATABASE_URL || process.env.DATABASE_URL;
  if (!inspectionUrl) {
    throw new Error("缺少SHEIN_MIGRATION_DATABASE_URL或DATABASE_URL");
  }

  const requireFromRelease = createRequire(path.join(moduleRoot, "package.json"));
  const { Pool } = requireFromRelease("pg");
  const inspectionPool = new Pool({
    connectionString: inspectionUrl,
    max: 2,
    connectionTimeoutMillis: 5_000,
  });
  const runtimePool = runtimeUrl
    ? new Pool({
        connectionString: runtimeUrl,
        max: 1,
        connectionTimeoutMillis: 5_000,
      })
    : null;

  try {
    const report = await auditV2ReleaseReadiness({
      root,
      webRoot,
      inspectionPool,
      runtimePool,
    });
    process.stdout.write(
      process.argv.includes("--json")
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatV2ReleaseReadiness(report),
    );
    process.exitCode = report.ready ? 0 : 1;
  } finally {
    await Promise.all([
      inspectionPool.end(),
      runtimePool?.end(),
    ]);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
