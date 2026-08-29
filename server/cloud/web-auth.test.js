import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  generateMemberInvitationToken,
  generatePasswordResetToken,
  generateWebSessionToken,
  hashWebPassword,
  parseCookieHeader,
  PostgresWebAuthService,
  serializeWebSessionCookie,
  verifyWebPassword,
} from "./web-auth.js";

test("public registration creates an operator in the configured tenant without store access", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenants")) {
        return { rows: [{ id: "tenant-1", name: "涵舟工作室", status: "active" }] };
      }
      if (sql.includes("SELECT id FROM users")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("INSERT INTO users")) {
        return {
          rows: [{ id: "user-1", email: "new@example.com", display_name: "新用户", status: "active" }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const service = new PostgresWebAuthService({
    pool: {
      async query(sql, values) {
        return client.query(sql, values);
      },
      async connect() { return client; },
    },
    randomBytes: (size) => Buffer.alloc(size, 4),
  });

  const result = await service.register({
    tenantId: "tenant-1",
    email: " NEW@example.com ",
    displayName: "新用户",
    password: "StrongPassword!2026",
  });

  assert.equal(result.user.role, "operator");
  assert.equal(result.tenant.id, "tenant-1");
  assert.equal(calls.some((call) => call.sql.includes("membership_store_access")), false);
  assert.equal(calls.some((call) => call.sql.includes("web.user.register")), true);
});

test("password reset stores only a hash, sends a reset link, and invalidates the token after use", async () => {
  const rawToken = generatePasswordResetToken((size) => Buffer.alloc(size, 8));
  const calls = [];
  const sent = [];
  const resetUser = { id: "user-1", email: "member@example.com", display_name: "成员", status: "active" };
  const requestPool = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM users") && sql.includes("lower(email)")) {
        return { rows: [resetUser] };
      }
      if (sql.includes("INSERT INTO password_reset_tokens")) {
        return { rows: [{ id: "reset-1" }] };
      }
      return { rowCount: 1, rows: [] };
    },
    async connect() {
      return {
        async query(sql, values) {
          calls.push({ sql, values });
          if (sql.includes("INSERT INTO password_reset_tokens")) {
            return { rows: [{ id: "reset-1" }] };
          }
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
  };
  const service = new PostgresWebAuthService({
    pool: requestPool,
    now: () => new Date("2026-08-23T12:00:00.000Z"),
    randomBytes: (size) => Buffer.alloc(size, 8),
    emailService: {
      async sendPasswordReset(input) {
        sent.push(input);
      },
    },
    webAppBaseUrl: "https://app.example.test",
  });

  const requested = await service.requestPasswordReset({ email: "member@example.com" });
  assert.equal(requested.accepted, true);
  assert.equal(sent[0].to, "member@example.com");
  assert.match(sent[0].resetUrl, /reset-password\?token=swr_/);
  const inserted = calls.find((call) => call.sql.includes("INSERT INTO password_reset_tokens"));
  assert.equal(inserted.values.includes(rawToken), false);

  let resetUsed = false;
  const resetPool = {
    async connect() {
      return {
        async query(sql, values) {
          calls.push({ sql, values });
          if (sql.includes("FROM password_reset_tokens")) {
            return {
              rows: [{
                id: "reset-1",
                user_id: "user-1",
                token_hash: crypto.createHash("sha256").update(rawToken, "utf8").digest(),
                expires_at: "2026-08-23T12:30:00.000Z",
                used_at: resetUsed ? "2026-08-23T12:05:00.000Z" : null,
                user_status: "active",
                tenant_id: "tenant-1",
              }],
            };
          }
          if (sql.includes("UPDATE password_reset_tokens")) {
            resetUsed = true;
          }
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
  };
  const resetService = new PostgresWebAuthService({
    pool: resetPool,
    now: () => new Date("2026-08-23T12:05:00.000Z"),
    randomBytes: (size) => Buffer.alloc(size, 8),
  });
  assert.deepEqual(
    await resetService.resetPassword(rawToken, "AnotherStrongPassword!2026"),
    { reset: true },
  );
  await assert.rejects(
    () => resetService.resetPassword(rawToken, "ThirdStrongPassword!2026"),
    (error) => error.code === "INVALID_RESET_TOKEN",
  );
});

test("hashes and verifies web passwords without storing plaintext", async () => {
  const encoded = await hashWebPassword("StrongPassword!2026");

  assert.match(encoded, /^scrypt\$32768\$8\$1\$/);
  assert.equal(encoded.includes("StrongPassword!2026"), false);
  assert.equal(
    await verifyWebPassword("StrongPassword!2026", encoded),
    true,
  );
  assert.equal(await verifyWebPassword("WrongPassword", encoded), false);
});

test("member invitation tokens are opaque and stored only as hashes", async () => {
  const storeId = "20000000-0000-4000-8000-000000000001";
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenants")) {
        return { rows: [{ id: "tenant-1", name: "涵舟工作室", status: "active" }] };
      }
      if (sql.includes("FROM users")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM stores")) return { rows: [{ id: storeId }] };
      if (sql.includes("INSERT INTO member_invitations")) {
        return { rows: [{ id: "invitation-1" }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const fixedNow = new Date("2026-08-03T10:00:00.000Z");
  const randomBytes = (size) => Buffer.alloc(size, 7);
  const service = new PostgresWebAuthService({
    pool: { async connect() { return client; } },
    now: () => fixedNow,
    randomBytes,
  });

  const result = await service.createMemberInvitation(
    { tenantId: "tenant-1", userId: "owner-1", role: "owner" },
    {
      email: " NEW@example.com ",
      displayName: "新成员",
      role: "operator",
      storeIds: [storeId],
    },
  );

  assert.equal(result.token, generateMemberInvitationToken(randomBytes));
  assert.equal(result.invitation.email, "new@example.com");
  assert.equal(result.invitation.expiresAt, "2026-08-04T10:00:00.000Z");
  const insert = calls.find((call) => call.sql.includes("INSERT INTO member_invitations"));
  assert.ok(Buffer.isBuffer(insert.values[5]));
  assert.equal(insert.values.some((value) => value === result.token), false);
  const audit = calls.find((call) => call.sql.includes("web.member.invitation.create"));
  assert.equal(JSON.stringify(audit.values).includes(result.token), false);
});

test("accepting an invitation creates one member and marks the token used", async () => {
  const storeId = "20000000-0000-4000-8000-000000000001";
  const userId = "10000000-0000-4000-8000-000000000001";
  const token = generateMemberInvitationToken((size) => Buffer.alloc(size, 9));
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM member_invitations invitation")) {
        return { rows: [{
          id: "invitation-1",
          tenant_id: "tenant-1",
          email: "new@example.com",
          display_name: "新成员",
          role: "viewer",
          store_ids: [storeId],
          expires_at: "2026-08-04T10:00:00.000Z",
          accepted_at: null,
          revoked_at: null,
          invited_by: "owner-1",
          tenant_name: "涵舟工作室",
          tenant_status: "active",
        }] };
      }
      if (sql.includes("SELECT id FROM users")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM stores")) return { rows: [{ id: storeId }] };
      if (sql.includes("INSERT INTO users")) {
        return { rows: [{
          id: userId,
          email: "new@example.com",
          display_name: "新成员",
          status: "active",
        }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const service = new PostgresWebAuthService({
    pool: { async connect() { return client; } },
    now: () => new Date("2026-08-03T10:00:00.000Z"),
    randomBytes: (size) => Buffer.alloc(size, 5),
  });

  const result = await service.acceptMemberInvitation(token, "StrongPassword!2026");

  assert.equal(result.accepted, true);
  assert.equal(result.user.role, "viewer");
  assert.ok(calls.some((call) => call.sql.includes("INSERT INTO memberships")));
  assert.ok(calls.some((call) => call.sql.includes("INSERT INTO membership_store_access")));
  assert.ok(calls.some((call) => call.sql.includes("SET accepted_at")));
  assert.ok(calls.some((call) => call.sql.includes("web.member.invitation.accept")));
  assert.ok(calls.some((call) => call.sql === "COMMIT"));
  assert.equal(calls.some((call) => call.sql === "ROLLBACK"), false);
});

test("expired or already used invitations fail closed", async () => {
  const token = generateMemberInvitationToken((size) => Buffer.alloc(size, 3));
  const service = new PostgresWebAuthService({
    pool: {
      async query() {
        return { rows: [{
          id: "invitation-1",
          tenant_id: "tenant-1",
          email: "new@example.com",
          display_name: "新成员",
          role: "operator",
          store_ids: [],
          expires_at: "2026-08-03T09:00:00.000Z",
          accepted_at: null,
          revoked_at: null,
          tenant_name: "涵舟工作室",
          tenant_status: "active",
        }] };
      },
    },
    now: () => new Date("2026-08-03T10:00:00.000Z"),
  });

  await assert.rejects(
    () => service.getMemberInvitation(token),
    (error) => error.code === "INVITATION_EXPIRED" && error.status === 410,
  );
  await assert.rejects(
    () => service.getMemberInvitation("not-a-token"),
    (error) => error.code === "INVALID_INVITATION" && error.status === 404,
  );
});

test("administrators list every tenant store while operators require their own allowlist", async () => {
  const calls = [];
  const service = new PostgresWebAuthService({
    pool: {
      async query(sql, values) {
        calls.push({ sql, values });
        return {
          rows: [{
            id: "store-1",
            supplier_id: "supplier-1",
            label: "店铺1",
            business_mode: "全托管",
            status: "active",
            authorized_at: null,
            last_synced_at: null,
            authorized_by: "user-2",
            authorized_by_email: "member@example.test",
            authorized_by_name: "成员",
          }],
        };
      },
    },
  });

  const adminStores = await service.listStores({
    tenantId: "tenant-1",
    userId: "admin-1",
    role: "admin",
  });
  const operatorStores = await service.listStores({
    tenantId: "tenant-1",
    userId: "user-2",
    role: "operator",
  });

  assert.equal(calls[0].sql.includes("membership_store_access msa"), false);
  assert.deepEqual(calls[0].values, ["tenant-1"]);
  assert.equal(calls[1].sql.includes("membership_store_access msa"), true);
  assert.deepEqual(calls[1].values, ["tenant-1", "user-2"]);
  assert.equal(adminStores[0].authorizedBy.email, "member@example.test");
  assert.equal(operatorStores[0].authorizedBy, null);
});

test("renames only a store available to the current account", async () => {
  const calls = [];
  const service = new PostgresWebAuthService({
    pool: {
      async query(sql, values) {
        calls.push({ sql, values });
        if (sql.includes("SELECT s.id")) {
          return { rows: [{
            id: "store-1", tenant_id: "tenant-1", supplier_id: "14152389",
            label: "旧名称", business_mode: "全托管", status: "active",
          }] };
        }
        return { rowCount: 1, rows: [{
          id: "store-1", supplier_id: "14152389", label: "地毯主店",
          business_mode: "全托管", status: "active",
        }] };
      },
    },
  });

  const renamed = await service.renameStore({
    tenantId: "tenant-1", userId: "user-1", role: "operator",
  }, "store-1", "  地毯主店  ");

  assert.equal(calls[0].sql.includes("membership_store_access msa"), true);
  assert.deepEqual(calls[1].values, ["tenant-1", "store-1", "地毯主店"]);
  assert.equal(renamed.label, "地毯主店");
});

test("administrator store aliases stay in the administrator view", async () => {
  const calls = [];
  const service = new PostgresWebAuthService({
    pool: {
      async query(sql, values) {
        calls.push({ sql, values });
        if (sql.includes("SELECT s.id")) {
          return { rows: [{
            id: "store-1", tenant_id: "tenant-1", supplier_id: "14152389",
            label: "成员看到的名称", admin_label: "管理员旧别称",
            business_mode: "全托管", status: "active",
          }] };
        }
        return { rowCount: 1, rows: [{
          id: "store-1", supplier_id: "14152389", label: "成员看到的名称",
          admin_label: "管理员新别称", business_mode: "全托管", status: "active",
        }] };
      },
    },
  });

  const renamed = await service.renameStore({
    tenantId: "tenant-1", userId: "admin-1", role: "admin",
  }, "store-1", "  管理员新别称  ");

  assert.match(calls[1].sql, /admin_label/);
  assert.doesNotMatch(calls[1].sql, /SET label\s*=/);
  assert.deepEqual(calls[1].values, ["tenant-1", "store-1", "管理员新别称"]);
  assert.equal(renamed.label, "管理员新别称");
});

test("administrator account aliases are separate from the member display name", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM memberships m") && sql.includes("FOR UPDATE")) {
        return { rows: [{
          id: "10000000-0000-4000-8000-000000000002",
          email: "operator@example.test",
          display_name: "成员真实姓名",
          admin_label: "旧管理员别名",
          status: "active",
          role: "operator",
          created_at: "2026-08-01T00:00:00.000Z",
        }] };
      }
      if (sql.includes("FROM membership_store_access msa")) {
        return { rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const service = new PostgresWebAuthService({
    pool: {
      async connect() { return client; },
    },
  });

  const result = await service.updateMemberAdminAlias(
    { tenantId: "tenant-1", userId: "admin-1", role: "admin" },
    "10000000-0000-4000-8000-000000000002",
    "  家居运营  ",
  );

  assert.match(calls.find((call) => call.sql.includes("UPDATE users"))?.sql || "", /admin_label/);
  assert.deepEqual(
    calls.find((call) => call.sql.includes("UPDATE users"))?.values,
    ["10000000-0000-4000-8000-000000000002", "家居运营"],
  );
  assert.equal(result.member.displayName, "成员真实姓名");
  assert.equal(result.member.adminAlias, "家居运营");
});

test("ordinary members never receive administrator account or store aliases", async () => {
  const service = new PostgresWebAuthService({
    pool: {
      async query(sql) {
        if (sql.includes("SELECT s.id")) {
          return { rows: [{
            id: "store-1", tenant_id: "tenant-1", supplier_id: "14152389",
            label: "成员看到的店铺", admin_label: "管理员店铺别名",
            business_mode: "全托管", status: "active",
          }] };
        }
        return { rows: [] };
      },
    },
  });

  const stores = await service.listStores({
    tenantId: "tenant-1", userId: "member-1", role: "operator",
  });

  assert.equal(stores[0].label, "成员看到的店铺");
  assert.equal(stores[0].adminAlias, undefined);
  assert.equal(stores[0].baseLabel, undefined);
});

test("ordinary members cannot write administrator account aliases", async () => {
  const service = new PostgresWebAuthService({ pool: { async query() { return { rows: [] }; } } });
  await assert.rejects(
    service.updateMemberAdminAlias(
      { tenantId: "tenant-1", userId: "member-1", role: "operator" },
      "10000000-0000-4000-8000-000000000002",
      "不应被写入",
    ),
    (error) => error.code === "ADMIN_REQUIRED" && error.status === 403,
  );
});

test("administrators revoke a store authorization without deleting history", async () => {
  const storeId = "20000000-0000-4000-8000-000000000001";
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM stores") && sql.includes("FOR UPDATE")) {
        return { rows: [{
          id: storeId,
          tenant_id: "tenant-1",
          supplier_id: "14152389",
          label: "测试店铺",
          business_mode: "全托管",
          status: "active",
          last_synced_at: "2026-08-02T00:00:00.000Z",
        }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const service = new PostgresWebAuthService({
    pool: { async connect() { return client; } },
  });

  const revoked = await service.revokeStoreAuthorization(
    { tenantId: "tenant-1", userId: "owner-1", role: "owner" },
    storeId,
  );

  assert.equal(revoked.status, "disabled");
  assert.equal(revoked.supplierId, null);
  assert.equal(revoked.authorizationRevoked, true);
  assert.ok(calls.some((call) => call.sql.includes("SET status = 'disabled'")));
  assert.ok(calls.some((call) => call.sql.includes("DELETE FROM store_credentials")));
  assert.ok(calls.some((call) => call.sql.includes("web.store.authorization.revoke")));
  assert.ok(calls.some((call) => call.sql === "COMMIT"));
  assert.equal(calls.some((call) => call.sql === "ROLLBACK"), false);
});

test("store authorization revocation blocks active publishing", async () => {
  const storeId = "20000000-0000-4000-8000-000000000001";
  const makeService = ({ activeRun = false } = {}) => {
    const calls = [];
    const client = {
      async query(sql, values) {
        calls.push({ sql, values });
        if (sql.includes("FROM stores") && sql.includes("FOR UPDATE")) {
          return { rows: [{
            id: storeId,
            tenant_id: "tenant-1",
            supplier_id: "14152389",
            label: "测试店铺",
            business_mode: "全托管",
            status: "active",
          }] };
        }
        if (sql.includes("publish_execution_runs")) {
          return { rows: activeRun ? [{}] : [] };
        }
        return { rowCount: 1, rows: [] };
      },
      release() {},
    };
    return {
      service: new PostgresWebAuthService({ pool: { async connect() { return client; } } }),
      calls,
    };
  };

  const active = makeService({ activeRun: true });
  await assert.rejects(
    () => active.service.revokeStoreAuthorization(
      { tenantId: "tenant-1", userId: "owner-1", role: "owner" },
      storeId,
    ),
    (error) => error.code === "STORE_PUBLISH_IN_PROGRESS" && error.status === 409,
  );
  assert.equal(active.calls.some((call) => call.sql.includes("SET status = 'disabled'")), false);
});

test("only administrators can list tenant members and their store access", async () => {
  const calls = [];
  const service = new PostgresWebAuthService({
    pool: {
      async query(sql, values) {
        calls.push({ sql, values });
        if (sql.includes("FROM memberships m")) {
          return { rows: [
            {
              id: "owner-1",
              email: "owner@example.test",
              display_name: "负责人",
              status: "active",
              role: "owner",
              created_at: "2026-08-01T00:00:00.000Z",
            },
            {
              id: "member-1",
              email: "member@example.test",
              display_name: "运营成员",
              status: "active",
              role: "operator",
              created_at: "2026-08-02T00:00:00.000Z",
            },
          ] };
        }
        return { rows: [
          { user_id: "member-1", id: "store-1", label: "地毯一店", status: "active" },
        ] };
      },
    },
  });

  const result = await service.listMembers({
    tenantId: "tenant-1",
    userId: "owner-1",
    role: "owner",
  });

  assert.equal(result.count, 2);
  assert.equal(result.members[0].allStores, true);
  assert.deepEqual(result.members[1].stores, [
    { id: "store-1", label: "地毯一店", status: "active" },
  ]);
  assert.deepEqual(calls.map((call) => call.values), [
    ["tenant-1"],
    ["tenant-1"],
    ["tenant-1"],
  ]);
  await assert.rejects(
    () => service.listMembers({ tenantId: "tenant-1", role: "operator" }),
    (error) => error.code === "ADMIN_REQUIRED" && error.status === 403,
  );
});

test("administrator replaces a member store allowlist in one audited transaction", async () => {
  const memberId = "10000000-0000-4000-8000-000000000001";
  const storeId1 = "20000000-0000-4000-8000-000000000001";
  const storeId2 = "20000000-0000-4000-8000-000000000002";
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM memberships m")) {
        return { rows: [{
          id: memberId,
          email: "member@example.test",
          display_name: "运营成员",
          status: "active",
          role: "operator",
          created_at: "2026-08-02T00:00:00.000Z",
        }] };
      }
      if (sql.includes("FROM stores")) {
        return { rows: [
          { id: storeId1, label: "地毯一店", status: "active" },
          { id: storeId2, label: "地毯二店", status: "active" },
        ] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {
      calls.push({ sql: "RELEASE", values: undefined });
    },
  };
  const service = new PostgresWebAuthService({
    pool: { async connect() { return client; } },
  });

  const result = await service.updateMemberStoreAccess(
    { tenantId: "tenant-1", userId: "admin-1", role: "admin" },
    memberId,
    [storeId1, storeId2, storeId1],
  );

  assert.deepEqual(result.member.stores.map((store) => store.id), [
    storeId1,
    storeId2,
  ]);
  assert.deepEqual(
    calls.find((call) => call.sql.includes("DELETE FROM membership_store_access")).values,
    ["tenant-1", memberId],
  );
  assert.deepEqual(
    calls.find((call) => call.sql.includes("INSERT INTO membership_store_access")).values,
    ["tenant-1", memberId, [storeId1, storeId2], "admin-1"],
  );
  assert.ok(calls.some((call) => call.sql.includes("web.member.store_access.update")));
  assert.equal(calls.at(-2).sql, "COMMIT");
  assert.equal(calls.at(-1).sql, "RELEASE");
});

test("member store access rolls back before replacement when any store is invalid", async () => {
  const memberId = "10000000-0000-4000-8000-000000000001";
  const storeId1 = "20000000-0000-4000-8000-000000000001";
  const storeId2 = "20000000-0000-4000-8000-000000000002";
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM memberships m")) {
        return { rows: [{
          id: memberId,
          email: "member@example.test",
          display_name: "运营成员",
          status: "active",
          role: "operator",
          created_at: null,
        }] };
      }
      if (sql.includes("FROM stores")) {
        return { rows: [{ id: storeId1, label: "地毯一店", status: "active" }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {
      calls.push({ sql: "RELEASE", values: undefined });
    },
  };
  const service = new PostgresWebAuthService({
    pool: { async connect() { return client; } },
  });

  await assert.rejects(
    () => service.updateMemberStoreAccess(
      { tenantId: "tenant-1", userId: "admin-1", role: "admin" },
      memberId,
      [storeId1, storeId2],
    ),
    (error) => error.code === "STORE_ACCESS_INVALID" && error.status === 400,
  );

  assert.equal(
    calls.some((call) => call.sql.includes("DELETE FROM membership_store_access")),
    false,
  );
  assert.ok(calls.some((call) => call.sql === "ROLLBACK"));
  assert.equal(calls.at(-1).sql, "RELEASE");
});

test("administrator updates an ordinary member and revokes active tenant sessions", async () => {
  const memberId = "10000000-0000-4000-8000-000000000001";
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM memberships m")) {
        return { rows: [{
          id: memberId,
          email: "member@example.test",
          display_name: "运营成员",
          status: "active",
          role: "operator",
          created_at: "2026-08-02T00:00:00.000Z",
        }] };
      }
      if (sql.includes("FROM membership_store_access msa")) {
        return { rows: [{
          id: "20000000-0000-4000-8000-000000000001",
          label: "地毯一店",
          status: "active",
        }] };
      }
      if (sql.includes("AS membership_count")) {
        return { rows: [{ membership_count: 1 }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {
      calls.push({ sql: "RELEASE", values: undefined });
    },
  };
  const service = new PostgresWebAuthService({
    pool: { async connect() { return client; } },
  });

  const result = await service.updateManagedMember(
    { tenantId: "tenant-1", userId: "owner-1", role: "owner" },
    memberId,
    { role: "viewer", status: "disabled" },
  );

  assert.equal(result.member.role, "viewer");
  assert.equal(result.member.status, "disabled");
  assert.ok(calls.some((call) => call.sql.includes("UPDATE memberships")));
  assert.ok(calls.some((call) => call.sql.includes("UPDATE users")));
  assert.deepEqual(
    calls.find((call) => call.sql.includes("UPDATE web_sessions")).values,
    ["tenant-1", memberId],
  );
  assert.ok(calls.some((call) => call.sql.includes("web.member.profile.update")));
  assert.equal(calls.at(-2).sql, "COMMIT");
});

test("member profile updates protect administrators and reject elevated roles", async () => {
  const memberId = "10000000-0000-4000-8000-000000000001";
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM memberships m")) {
        return { rows: [{
          id: memberId,
          email: "admin@example.test",
          display_name: "管理员",
          status: "active",
          role: "admin",
          created_at: null,
        }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const service = new PostgresWebAuthService({
    pool: { async connect() { return client; } },
  });

  await assert.rejects(
    () => service.updateManagedMember(
      { tenantId: "tenant-1", userId: "owner-1", role: "owner" },
      memberId,
      { status: "disabled" },
    ),
    (error) => error.code === "PROTECTED_MEMBER" && error.status === 409,
  );
  await assert.rejects(
    () => service.updateManagedMember(
      { tenantId: "tenant-1", userId: "owner-1", role: "owner" },
      memberId,
      { role: "admin" },
    ),
    (error) => error.code === "INVALID_MEMBER_ROLE" && error.status === 400,
  );
  assert.ok(calls.some((call) => call.sql === "ROLLBACK"));
  assert.equal(calls.some((call) => call.sql.includes("UPDATE users")), false);
});

test("member status changes fail closed for users shared across tenants", async () => {
  const memberId = "10000000-0000-4000-8000-000000000001";
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM memberships m")) {
        return { rows: [{
          id: memberId,
          email: "shared@example.test",
          display_name: "共享成员",
          status: "active",
          role: "operator",
          created_at: null,
        }] };
      }
      if (sql.includes("AS membership_count")) {
        return { rows: [{ membership_count: 2 }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const service = new PostgresWebAuthService({
    pool: { async connect() { return client; } },
  });

  await assert.rejects(
    () => service.updateManagedMember(
      { tenantId: "tenant-1", userId: "owner-1", role: "owner" },
      memberId,
      { status: "disabled" },
    ),
    (error) => error.code === "SHARED_USER_STATUS_UNSUPPORTED" && error.status === 409,
  );
  assert.equal(calls.some((call) => call.sql.includes("UPDATE users")), false);
  assert.equal(calls.some((call) => call.sql === "ROLLBACK"), true);
});

test("creates opaque browser session tokens and strict cookies", () => {
  const token = generateWebSessionToken(() => Buffer.alloc(32, 7));
  const cookie = serializeWebSessionCookie({
    name: "shein_web_session",
    token,
    maxAgeSeconds: 3600,
    secure: true,
  });

  assert.match(token, /^sws_/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.equal(parseCookieHeader(cookie).shein_web_session, token);
});
