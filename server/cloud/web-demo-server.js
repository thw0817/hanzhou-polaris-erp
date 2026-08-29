import crypto from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";
import {
  readDemoPublishCategories,
  readDemoPublishSchemaCoverage,
  readDemoPublishSchema,
} from "./demo-shein-schema-snapshot.js";
import { WebProductDraftService } from "./product-draft-service.js";

const host = "127.0.0.1";
const port = Number(process.env.SHEIN_WEB_DEMO_PORT || 8790);
const storeId = "00000000-0000-4000-8000-000000000001";
let demoStoreLabel = "网页验收店铺（隔离数据）";
let demoStoreAdminAlias = "";
let demoStoreAuthorized = true;
const demoMembers = [
  {
    id: "user-demo",
    email: "demo@hanzhou.icu",
    displayName: "验收管理员",
    status: "active",
    role: "owner",
    adminAlias: "",
    storeIds: [],
    joinedAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    email: "operator@hanzhou.icu",
    displayName: "地毯运营",
    status: "active",
    role: "operator",
    adminAlias: "",
    storeIds: [],
    joinedAt: "2026-07-12T00:00:00.000Z",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    email: "viewer@hanzhou.icu",
    displayName: "数据查看",
    status: "active",
    role: "viewer",
    adminAlias: "",
    storeIds: [storeId],
    joinedAt: "2026-07-18T00:00:00.000Z",
  },
];
const demoInvitations = [];
const demoBusinessRefresh = { job: null, jobs: [], snapshot: null };
const now = () => new Date().toISOString();
const drafts = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    storeId,
    name: "矩形短绒地毯通用模板",
    categoryId: "3155",
    productTypeId: "991",
    status: "ready",
    preflight: { passed: true, blockers: [] },
    updatedAt: now(),
    data: {
      title: "现代简约短绒客厅地毯",
      supplierCode: "RUG-TEMPLATE",
      supplierSku: "RUG-TEMPLATE-40X60",
      categoryName: "区域地毯",
      mainAssetId: "20000000-0000-4000-8000-000000000001",
      skcSaleAttributeId: "10",
      skcSaleAttributeValueId: "101",
      shape: "rectangle",
      gramsPerSquareMeter: "850",
      packagingMaterial: "短绒",
      currency: "CNY",
      attributeValues: {
        300: { valueIds: ["301"] },
      },
      packagingWorkbook: {
        fileName: "地毯包装体积表.xlsx",
        materials: {
          短绒: [
            {
              key: "40x60",
              widthCm: 40,
              lengthCm: 60,
              packageLengthCm: 40,
              packageWidthCm: 8,
              packageHeightCm: 8,
            },
            {
              key: "50x80",
              widthCm: 50,
              lengthCm: 80,
              packageLengthCm: 50,
              packageWidthCm: 9,
              packageHeightCm: 9,
            },
          ],
        },
        issues: [],
        materialCount: 1,
        rowCount: 2,
      },
      sizeRows: [
        {
          id: "size-40x60",
          name: "40*60",
          shape: "rectangle",
          widthCm: 40,
          lengthCm: 60,
          diameterCm: "",
          sheinValueId: "87:401",
          sheinAttributeId: "87",
          sheinAttributeValueId: "401",
          sheinValueLabel: "40*60",
          sizeAttributeValues: { 118: "40", 55: "60" },
          areaSquareMeters: 0.24,
          weightGrams: 204,
          packageLengthCm: 40,
          packageWidthCm: 8,
          packageHeightCm: 8,
          packageMatch: "matched",
          supplierSku: "RUG-TEMPLATE-40X60",
          costPrice: "12.80",
          inventoryNum: "0",
        },
        {
          id: "size-50x80",
          name: "50*80",
          shape: "rectangle",
          widthCm: 50,
          lengthCm: 80,
          diameterCm: "",
          sheinValueId: "87:402",
          sheinAttributeId: "87",
          sheinAttributeValueId: "402",
          sheinValueLabel: "50*80",
          sizeAttributeValues: { 118: "50", 55: "80" },
          areaSquareMeters: 0.4,
          weightGrams: 340,
          packageLengthCm: 50,
          packageWidthCm: 9,
          packageHeightCm: 9,
          packageMatch: "matched",
          supplierSku: "RUG-TEMPLATE-50X80",
          costPrice: "18.60",
          inventoryNum: "0",
        },
      ],
    },
  },
];
const demoProductDrafts = new WebProductDraftService({
  repository: {
    async save(input) {
      const updatedAt = now();
      const draft = {
        id: input.id || crypto.randomUUID(),
        storeId,
        name: input.name,
        categoryId: input.categoryId,
        productTypeId: input.productTypeId,
        data: input.data,
        preflight: input.preflight,
        status: input.status,
        updatedAt,
      };
      const index = drafts.findIndex((item) => item.id === draft.id);
      if (index >= 0) drafts[index] = draft;
      else drafts.unshift(draft);
      return {
        id: draft.id,
        store_id: storeId,
        name: draft.name,
        category_id: draft.categoryId,
        product_type_id: draft.productTypeId,
        draft_data: draft.data,
        preflight: draft.preflight,
        status: draft.status,
        updated_at: updatedAt,
      };
    },
  },
  async associatedAttributeRules() {
    return {
      info: {
        data: [{
          group_id: "template",
          link_rule_attribute_list: [],
        }],
      },
      diagnostics: { traceId: "demo-associated-rules" },
    };
  },
});
const batches = [];
const publishTemplates = [];
const mediaAssets = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    storeId,
    originalName: "验收主图-1600x1600.jpg",
    contentType: "image/jpeg",
    status: "ready",
    sizeBytes: 512000,
    width: 1600,
    height: 1600,
    purpose: "selected_unpublished",
    createdAt: now(),
  },
];
const mediaUploads = new Map();
function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json;charset=UTF-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

export function getDemoCorsOrigin(origin) {
  const value = String(origin || "").trim();
  return /^http:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(value)
    ? value
    : "";
}

function applyDemoCors(request, response) {
  const origin = getDemoCorsOrigin(request.headers.origin);
  response.setHeader("Vary", "Origin");
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
  }
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function publicBatch(batch) {
  return {
    ...batch,
    itemCount: batch.items.length,
    confirmationState:
      batch.state === "ready" &&
      batch.preflight?.confirmation?.state === "confirmed"
        ? "confirmed"
        : "pending",
    executionState:
      batch.state === "ready" &&
      batch.preflight?.confirmation?.state === "confirmed" &&
      batch.preflight?.executionPlan?.state ===
        "ready_for_execution_confirmation"
        ? "planned"
        : "pending",
    publishingEnabled: false,
  };
}

export function isDemoDraftBatchEligible(draft) {
  return draft?.status === "ready" && draft?.preflight?.passed === true;
}

export function normalizeDemoStoreLabel(label) {
  const normalized = String(label || "").trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 40) {
    const error = new Error("店铺名称需为1至40个字符");
    error.code = "INVALID_STORE_LABEL";
    error.status = 400;
    throw error;
  }
  return normalized;
}

export function normalizeDemoAdminAlias(label) {
  const normalized = String(label || "").trim().replace(/\s+/g, " ");
  if (normalized.length > 40) {
    const error = new Error("管理员店铺别名不能超过40个字符");
    error.code = "INVALID_STORE_LABEL";
    error.status = 400;
    throw error;
  }
  return normalized;
}

export function updateDemoMemberAdminAlias(members, userId, alias) {
  const member = members.find((item) => item.id === userId);
  if (!member) {
    const error = new Error("成员不存在");
    error.code = "MEMBER_NOT_FOUND";
    error.status = 404;
    throw error;
  }
  const normalized = String(alias || "").trim().replace(/\s+/g, " ");
  if (normalized.length > 120) {
    const error = new Error("管理员账户别名不能超过120个字符");
    error.code = "INVALID_MEMBER_ALIAS";
    error.status = 400;
    throw error;
  }
  member.adminAlias = normalized;
  return member;
}

export function updateDemoMemberStoreAccess(
  members,
  userId,
  storeIds,
  availableStoreIds,
) {
  const member = members.find((item) => item.id === userId);
  if (!member) {
    const error = new Error("成员不存在");
    error.code = "MEMBER_NOT_FOUND";
    error.status = 404;
    throw error;
  }
  if (["owner", "admin"].includes(member.role)) {
    const error = new Error("管理员默认拥有全部店铺，无需单独分配");
    error.code = "MEMBER_INHERITS_ALL_STORES";
    error.status = 409;
    throw error;
  }
  if (!Array.isArray(storeIds)) {
    const error = new Error("店铺权限必须是数组");
    error.code = "INVALID_STORE_ACCESS";
    error.status = 400;
    throw error;
  }
  const selected = Array.from(new Set(storeIds.map((value) => String(value || "").trim())));
  const available = new Set(availableStoreIds);
  if (selected.some((id) => !id || !available.has(id)) || selected.length > 100) {
    const error = new Error("部分店铺不存在、未授权或不属于当前工作空间");
    error.code = "STORE_ACCESS_INVALID";
    error.status = 400;
    throw error;
  }
  member.storeIds = selected;
  return member;
}

export function updateDemoManagedMember(members, userId, input) {
  const member = members.find((item) => item.id === userId);
  if (!member) {
    const error = new Error("成员不存在");
    error.code = "MEMBER_NOT_FOUND";
    error.status = 404;
    throw error;
  }
  if (["owner", "admin"].includes(member.role)) {
    const error = new Error("管理员和所有者账号不能在此修改");
    error.code = "PROTECTED_MEMBER";
    error.status = 409;
    throw error;
  }
  const role = input?.role == null ? member.role : String(input.role).trim();
  const status = input?.status == null ? member.status : String(input.status).trim();
  if (!["operator", "viewer"].includes(role)) {
    const error = new Error("普通成员角色无效");
    error.code = "INVALID_MEMBER_ROLE";
    error.status = 400;
    throw error;
  }
  if (!["active", "disabled"].includes(status)) {
    const error = new Error("成员状态无效");
    error.code = "INVALID_MEMBER_STATUS";
    error.status = 400;
    throw error;
  }
  member.role = role;
  member.status = status;
  return member;
}

function demoInvitationError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function assertDemoInvitationAvailable(invitation, currentTime) {
  if (!invitation) {
    throw demoInvitationError("INVITATION_NOT_FOUND", "邀请链接不存在", 404);
  }
  if (
    invitation.acceptedAt ||
    invitation.revokedAt ||
    new Date(invitation.expiresAt).getTime() <= currentTime.getTime()
  ) {
    throw demoInvitationError("INVITATION_UNAVAILABLE", "邀请链接已失效或已被使用", 410);
  }
}

export function createDemoMemberInvitation(
  invitations,
  members,
  input,
  availableStoreIds,
  options = {},
) {
  const email = String(input?.email || "").trim().toLowerCase();
  const displayName = String(input?.displayName || "").trim();
  const role = String(input?.role || "").trim();
  const storeIds = Array.isArray(input?.storeIds)
    ? Array.from(new Set(input.storeIds.map((value) => String(value || "").trim())))
    : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !displayName || displayName.length > 120) {
    throw demoInvitationError("INVALID_REQUEST", "邮箱或显示名称无效");
  }
  if (!["operator", "viewer"].includes(role)) {
    throw demoInvitationError("INVALID_MEMBER_ROLE", "普通成员角色无效");
  }
  if (!storeIds) {
    throw demoInvitationError("INVALID_STORE_ACCESS", "店铺权限必须是数组");
  }
  const available = new Set(availableStoreIds);
  if (storeIds.some((id) => !id || !available.has(id)) || storeIds.length > 100) {
    throw demoInvitationError("STORE_ACCESS_INVALID", "部分店铺不存在、未授权或不属于当前工作空间");
  }
  if (members.some((member) => member.email?.toLowerCase() === email)) {
    throw demoInvitationError("INVITED_EMAIL_EXISTS", "该邮箱已存在账号", 409);
  }

  const currentTime = options.now?.() || new Date();
  for (const invitation of invitations) {
    if (invitation.email === email && !invitation.acceptedAt && !invitation.revokedAt) {
      invitation.revokedAt = currentTime.toISOString();
    }
  }
  const token = `swi_${(options.randomBytes || crypto.randomBytes)(32).toString("base64url")}`;
  const invitation = {
    id: (options.randomUUID || crypto.randomUUID)(),
    email,
    displayName,
    role,
    storeIds,
    token,
    expiresAt: new Date(currentTime.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    acceptedAt: null,
    revokedAt: null,
  };
  invitations.unshift(invitation);
  return {
    invitation: {
      id: invitation.id,
      email,
      displayName,
      role,
      storeIds,
      expiresAt: invitation.expiresAt,
    },
    token,
  };
}

export function getDemoMemberInvitation(invitations, token, currentTime = new Date()) {
  const invitation = invitations.find((item) => item.token === token);
  assertDemoInvitationAvailable(invitation, currentTime);
  return {
    invitation: {
      id: invitation.id,
      email: invitation.email,
      displayName: invitation.displayName,
      role: invitation.role,
      storeCount: invitation.storeIds.length,
      expiresAt: invitation.expiresAt,
      tenant: { id: "tenant-demo", name: "SHEIN涵舟工作室" },
    },
  };
}

export function acceptDemoMemberInvitation(
  invitations,
  members,
  token,
  password,
  availableStoreIds,
  options = {},
) {
  const currentTime = options.now?.() || new Date();
  const invitation = invitations.find((item) => item.token === token);
  assertDemoInvitationAvailable(invitation, currentTime);
  if (typeof password !== "string" || password.length < 10 || password.length > 200) {
    throw demoInvitationError("INVALID_REQUEST", "密码长度必须为10-200个字符");
  }
  if (members.some((member) => member.email?.toLowerCase() === invitation.email)) {
    throw demoInvitationError("INVITED_EMAIL_EXISTS", "该邮箱已存在账号", 409);
  }
  const available = new Set(availableStoreIds);
  if (invitation.storeIds.some((id) => !available.has(id))) {
    throw demoInvitationError("INVITATION_STORES_CHANGED", "邀请中的店铺权限已变化，请联系管理员重新邀请", 409);
  }

  const member = {
    id: (options.randomUUID || crypto.randomUUID)(),
    email: invitation.email,
    displayName: invitation.displayName,
    status: "active",
    role: invitation.role,
    storeIds: [...invitation.storeIds],
    joinedAt: currentTime.toISOString(),
  };
  members.push(member);
  invitation.acceptedAt = currentTime.toISOString();
  return {
    accepted: true,
    tenant: { id: "tenant-demo", name: "SHEIN涵舟工作室" },
    user: {
      id: member.id,
      email: member.email,
      displayName: member.displayName,
      role: member.role,
    },
  };
}

export function startDemoBusinessRefresh(state, options = {}) {
  if (["queued", "running"].includes(state.job?.state)) {
    return { started: false, job: state.job };
  }
  const currentTime = options.now?.() || new Date();
  const job = {
    id: (options.randomUUID || crypto.randomUUID)(),
    jobType: "store_business_refresh",
    state: "running",
    requestedBy: "user-demo",
    startedAt: currentTime.toISOString(),
    completedAt: null,
    createdAt: currentTime.toISOString(),
  };
  state.job = job;
  if (!Array.isArray(state.jobs)) state.jobs = [];
  state.jobs.unshift(job);
  return { started: true, job };
}

export function startDemoRuleRefresh(state, options = {}) {
  const currentTime = options.now?.() || new Date();
  const timestamp = currentTime.toISOString();
  const job = {
    id: (options.randomUUID || crypto.randomUUID)(),
    jobType: "rule_refresh",
    state: "succeeded",
    progress: { total: 1, processed: 1, succeeded: 1, failed: 0 },
    requestedBy: "user-demo",
    startedAt: timestamp,
    completedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (!Array.isArray(state.jobs)) state.jobs = [];
  state.jobs.unshift(job);
  return { started: true, job };
}

export function retryDemoRuleRefresh() {
  throw demoInvitationError(
    "DEMO_RULE_REFRESH_RETRY_UNAVAILABLE",
    "本地演示环境没有真实失败类目快照，不能模拟定向重试；请在真实云端规则刷新任务中执行",
    503,
  );
}

export function startDemoComplianceSync(state, options = {}) {
  const hasTargets = (state.snapshot?.products || []).some((product) =>
    String(product?.skc || "").trim(),
  );
  if (!hasTargets) {
    const error = new Error(
      "当前店铺没有可同步的真实 SKC，请先刷新经营数据",
    );
    error.code = "COMPLIANCE_SYNC_NO_TARGETS";
    error.status = 409;
    throw error;
  }
  const currentTime = options.now?.() || new Date();
  const timestamp = currentTime.toISOString();
  const job = {
    id: (options.randomUUID || crypto.randomUUID)(),
    jobType: "compliance_sync",
    state: "succeeded",
    progress: { total: 0, processed: 0, succeeded: 0, failed: 0 },
    requestedBy: "user-demo",
    startedAt: timestamp,
    completedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (!Array.isArray(state.jobs)) state.jobs = [];
  state.jobs.unshift(job);
  return { started: true, job };
}

export function readDemoBusinessDashboard(state, options = {}) {
  const currentTime = options.now?.() || new Date();
  const completeAfterMs = options.completeAfterMs ?? 1_000;
  if (
    state.job?.state === "running" &&
    currentTime.getTime() - new Date(state.job.startedAt).getTime() >= completeAfterMs
  ) {
    state.job.state = "succeeded";
    state.job.completedAt = currentTime.toISOString();
    state.job.updatedAt = currentTime.toISOString();
    state.job.progress = { snapshotStored: true };
    const sourceCutoff = currentTime.toISOString().slice(0, 10).replaceAll("-", "");
    state.snapshot = {
      dataDate: sourceCutoff,
      productCount: 0,
      products: [],
      warnings: [],
      totals: {
        today: 0,
        yesterday: 0,
        sales7: 0,
        sales30: 0,
        actualInventory: 0,
        activeProductCount: 0,
        pendingProductCount: 0,
        offShelfProductCount: 0,
        soldOutProductCount: 0,
        highWarningCount: 0,
      },
    };
  }
  const activeJob = ["queued", "running"].includes(state.job?.state)
    ? state.job
    : null;
  return {
    state: activeJob ? "refreshing" : state.snapshot ? "ready" : "idle",
    snapshot: state.snapshot,
    stale: !state.snapshot,
    syncedAt: state.job?.completedAt || null,
    sourceCutoff: state.snapshot?.dataDate || "",
    refreshStartedAt: state.job?.startedAt || null,
    refreshCompletedAt: state.job?.completedAt || null,
    lastError: null,
    refreshJob: activeJob,
    storeId,
    refreshAfterSeconds: 300,
  };
}

function publicDemoSyncJob(job) {
  return {
    id: job.id,
    jobType: job.jobType,
    state: job.state,
    progress: job.progress || {},
    error: job.error || null,
    requestedBy: { name: "验收管理员", me: true },
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt || job.createdAt,
  };
}

export function listDemoSyncJobs(state, filters = {}) {
  const jobs = (state.jobs || [])
    .filter((job) => !filters.state || job.state === filters.state)
    .filter((job) => !filters.jobType || job.jobType === filters.jobType)
    .slice(0, 50)
    .map(publicDemoSyncJob);
  return { jobs, count: jobs.length };
}

export function getDemoSyncJob(state, jobId) {
  const job = (state.jobs || []).find((item) => item.id === jobId);
  if (!job) throw demoInvitationError("SYNC_JOB_NOT_FOUND", "同步任务不存在", 404);
  return { job: { ...publicDemoSyncJob(job), items: [] } };
}

function publicDemoMember(member) {
  return {
    id: member.id,
    email: member.email,
    displayName: member.displayName,
    adminAlias: member.adminAlias || null,
    status: member.status,
    role: member.role,
    allStores: ["owner", "admin"].includes(member.role),
    stores: member.storeIds.map((id) => ({
      id,
      label: id === storeId && ["owner", "admin"].includes(member.role)
        ? demoStoreAdminAlias || demoStoreLabel
        : id === storeId
          ? demoStoreLabel
          : "未知店铺",
      status: "active",
    })),
    joinedAt: member.joinedAt,
  };
}

function extractDraftSupplierSkus(draft) {
  const rows = Array.isArray(draft?.data?.sizeRows)
    ? draft.data.sizeRows
    : [];
  const rowSkus = rows
    .map((row) => String(row?.supplierSku || "").trim())
    .filter(Boolean);
  const legacySku = String(draft?.data?.supplierSku || "").trim();
  return Array.from(new Set([...rowSkus, ...(legacySku ? [legacySku] : [])]));
}

export function applyDemoBatchAction(batch, action, draftList = drafts) {
  const normalizedAction = String(action || "").trim();
  if (
    ![
      "pause",
      "resume",
      "retry",
      "preflight",
      "confirm",
      "plan-execution",
      "authorize-execution",
    ].includes(normalizedAction)
  ) {
    const error = new Error(
      "仅支持preflight、confirm、plan-execution、authorize-execution、pause、resume或retry",
    );
    error.code = "INVALID_BATCH_ACTION";
    error.status = 400;
    throw error;
  }
  if (normalizedAction === "confirm") {
    const error = new Error(
      batch.state === "ready"
        ? "演示环境未连接真实SHEIN店铺，不能确认远程发布候选快照"
        : "仅可确认全部条目均已通过远程预检的发布批次",
    );
    error.code =
      batch.state === "ready"
        ? "DEMO_CONFIRMATION_UNAVAILABLE"
        : "BATCH_NOT_READY_FOR_CONFIRMATION";
    error.status = 409;
    throw error;
  }
  if (normalizedAction === "plan-execution") {
    const error = new Error(
      batch.preflight?.confirmation?.state === "confirmed"
        ? "演示环境没有真实远程发布候选，不能生成执行计划"
        : "必须先确认当前冻结快照，才能生成发布执行计划",
    );
    error.code =
      batch.preflight?.confirmation?.state === "confirmed"
        ? "DEMO_EXECUTION_PLAN_UNAVAILABLE"
        : "EXECUTION_PLAN_CONFIRMATION_REQUIRED";
    error.status = 409;
    throw error;
  }
  if (normalizedAction === "authorize-execution") {
    const error = new Error(
      batch.preflight?.executionPlan?.state ===
        "ready_for_execution_confirmation"
        ? "演示环境不能生成真实执行的一次性授权协议"
        : "必须先生成并核对当前执行计划",
    );
    error.code =
      batch.preflight?.executionPlan?.state ===
        "ready_for_execution_confirmation"
        ? "DEMO_EXECUTION_AUTHORIZATION_UNAVAILABLE"
        : "EXECUTION_PLAN_NOT_READY";
    error.status = 409;
    throw error;
  }
  if (normalizedAction === "preflight" && batch.state === "paused") {
    const error = new Error("批次已暂停，请先恢复后再预检");
    error.code = "BATCH_PAUSED";
    error.status = 409;
    throw error;
  }
  if (normalizedAction === "preflight" && batch.state === "ready") {
    return batch;
  }

  if (normalizedAction !== "preflight") {
    const stateByAction = {
      pause: "paused",
      resume: "queued",
      retry: "queued",
    };
    batch.state = stateByAction[normalizedAction];
    batch.updatedAt = now();
    batch.items = batch.items.map((item) => ({
      ...item,
      state: batch.state,
      updatedAt: now(),
    }));
    return batch;
  }

  const itemResults = batch.items.map((item) => {
    const draft = draftList.find((candidate) => candidate.id === item.draftId);
    const supplierSkus = extractDraftSupplierSkus(draft);
    const blockers = [
      ...(!supplierSkus.length ? ["草稿没有可预检的商家SKU"] : []),
      "演示环境未连接真实SHEIN店铺，不能冻结权限、额度、SKU查重或图片上传结果",
    ];
    return {
      ...item,
      state: "failed",
      attemptCount: item.attemptCount + 1,
      preflight: {
        passed: false,
        blockers,
        supplierSkus,
        remotePublishCandidate: {
          state: "blocked",
          publishingEnabled: false,
          requestBody: null,
          fingerprint: "",
          blockers: [{
            code: "DEMO_REMOTE_PREFLIGHT_UNAVAILABLE",
            message: blockers.at(-1),
          }],
        },
      },
      lastError: blockers.join("；"),
      updatedAt: now(),
    };
  });
  batch.items = itemResults;
  batch.state = itemResults.every((item) => item.state === "ready")
    ? "ready"
    : "failed";
  batch.preflight = {
    passed: batch.state === "ready",
    blockers: itemResults.flatMap((item) => item.preflight.blockers || []),
    publishingEnabled: false,
  };
  batch.lastError =
    itemResults.find((item) => item.lastError)?.lastError || "";
  batch.updatedAt = now();
  return batch;
}

export function getDemoPublishCategories(options = {}) {
  return readDemoPublishCategories(options);
}

export function getDemoPublishSchema(options = {}) {
  return readDemoPublishSchema(options);
}

export function getDemoPublishSchemaCoverage(options = {}) {
  return readDemoPublishSchemaCoverage(options);
}

export function normalizeDemoPublishTemplateData(templateType, sourceData = {}) {
  const data = sourceData && typeof sourceData === "object" ? sourceData : {};
  if (templateType === "publish_settings") {
    return {
      mallState: String(data.mallState || ""),
      stopPurchase: String(data.stopPurchase || ""),
      shelfRequire: String(data.shelfRequire || ""),
      shelfWay: "1",
    };
  }
  if (templateType !== "compliance" || data.templateKind !== "rug_report") {
    return data;
  }

  const reportType = String(data.reportType || "");
  const reportFile = data.reportFile && typeof data.reportFile === "object"
    ? { ...data.reportFile }
    : {};
  return {
    templateKind: "rug_report",
    reportType,
    reportDate: String(data.reportDate || ""),
    reportFile,
    requirements: [],
    defaults: {
      certificates: [{
        certificateTypeId: null,
        certificateTypeCode: `RugReport${reportType}`,
        certificateTypeName: `16 CFR ${reportType} 检测报告`,
        certificateDimension: null,
        poolSn: "",
        status: null,
        files: [reportFile],
        fieldValues: {},
      }],
      agencies: [],
      warnings: [],
      photos: [],
    },
    storeScoped: true,
    revalidateOnUse: true,
  };
}

export function createWebDemoServer() {
  return http.createServer(async (request, response) => {
    applyDemoCors(request, response);
    if (request.method === "OPTIONS") return json(response, 204, {});
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true, service: "shein-web-demo" });
    }
    if (request.method === "GET" && url.pathname === "/v1/web/session") {
      return json(response, 200, {
        authenticated: true,
        tenant: { id: "tenant-demo", name: "SHEIN涵舟工作室" },
        user: {
          id: "user-demo",
          email: "demo@hanzhou.icu",
          displayName: "验收管理员",
          role: "owner",
        },
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
    }
    if (request.method === "GET" && url.pathname === "/v1/web/admin/members") {
      return json(response, 200, {
        members: demoMembers.map(publicDemoMember),
        count: demoMembers.length,
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/web/admin/invitations") {
      try {
        const result = createDemoMemberInvitation(
          demoInvitations,
          demoMembers,
          await readBody(request),
          [storeId],
        );
        return json(response, 201, result);
      } catch (error) {
        return json(response, error.status || 400, {
          code: error.code || "INVALID_INVITATION",
          msg: error.message,
        });
      }
    }
    const demoInvitationAcceptMatch = url.pathname.match(
      /^\/v1\/web\/invitations\/([^/]+)\/accept$/,
    );
    if (request.method === "POST" && demoInvitationAcceptMatch) {
      try {
        const input = await readBody(request);
        const result = acceptDemoMemberInvitation(
          demoInvitations,
          demoMembers,
          decodeURIComponent(demoInvitationAcceptMatch[1]),
          input.password,
          [storeId],
        );
        return json(response, 200, result);
      } catch (error) {
        return json(response, error.status || 400, {
          code: error.code || "INVALID_INVITATION",
          msg: error.message,
        });
      }
    }
    const demoInvitationMatch = url.pathname.match(
      /^\/v1\/web\/invitations\/([^/]+)$/,
    );
    if (request.method === "GET" && demoInvitationMatch) {
      try {
        return json(
          response,
          200,
          getDemoMemberInvitation(
            demoInvitations,
            decodeURIComponent(demoInvitationMatch[1]),
          ),
        );
      } catch (error) {
        return json(response, error.status || 400, {
          code: error.code || "INVALID_INVITATION",
          msg: error.message,
        });
      }
    }
    const demoManagedMemberMatch = url.pathname.match(
      /^\/v1\/web\/admin\/members\/([^/]+)$/,
    );
    if (request.method === "PATCH" && demoManagedMemberMatch) {
      try {
        const member = updateDemoManagedMember(
          demoMembers,
          decodeURIComponent(demoManagedMemberMatch[1]),
          await readBody(request),
        );
        return json(response, 200, { member: publicDemoMember(member) });
      } catch (error) {
        return json(response, error.status || 400, {
          code: error.code || "INVALID_MEMBER_UPDATE",
          msg: error.message,
        });
      }
    }
    const demoMemberStoreAccessMatch = url.pathname.match(
      /^\/v1\/web\/admin\/members\/([^/]+)\/store-access$/,
    );
    if (request.method === "PUT" && demoMemberStoreAccessMatch) {
      try {
        const input = await readBody(request);
        const member = updateDemoMemberStoreAccess(
          demoMembers,
          decodeURIComponent(demoMemberStoreAccessMatch[1]),
          input.storeIds,
          [storeId],
        );
        return json(response, 200, { member: publicDemoMember(member) });
      } catch (error) {
        return json(response, error.status || 400, {
          code: error.code || "INVALID_STORE_ACCESS",
          msg: error.message,
        });
      }
    }
    if (request.method === "GET" && url.pathname === "/v1/web/stores") {
      return json(response, 200, {
      stores: demoStoreAuthorized ? [
          {
            id: storeId,
            supplierId: "DEMO-001",
            label: demoStoreAdminAlias || demoStoreLabel,
            baseLabel: demoStoreLabel,
            adminAlias: demoStoreAdminAlias || null,
            businessMode: "全托管",
            status: "active",
            environment: "demo",
          },
        ] : [],
        count: demoStoreAuthorized ? 1 : 0,
      });
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/web/shein/auth/start"
    ) {
      return json(response, 503, {
        code: "SHEIN_AUTHORIZATION_UNAVAILABLE",
        msg: "演示环境未连接真实 SHEIN 授权服务",
      });
    }
    if (
      request.method === "PATCH" &&
      url.pathname === `/v1/web/stores/${storeId}`
    ) {
      try {
        const input = await readBody(request);
        demoStoreAdminAlias = normalizeDemoAdminAlias(input.label);
        return json(response, 200, {
          store: {
            id: storeId,
            supplierId: "DEMO-001",
            label: demoStoreAdminAlias || demoStoreLabel,
            baseLabel: demoStoreLabel,
            adminAlias: demoStoreAdminAlias || null,
            businessMode: "全托管",
            status: "active",
            environment: "demo",
          },
        });
      } catch (error) {
        return json(response, error.status || 400, {
          code: error.code || "INVALID_STORE_LABEL",
          msg: error.message,
        });
      }
    }
    const demoMemberAliasMatch = url.pathname.match(
      /^\/v1\/web\/admin\/members\/([^/]+)\/alias$/,
    );
    if (request.method === "PATCH" && demoMemberAliasMatch) {
      try {
        const member = updateDemoMemberAdminAlias(
          demoMembers,
          decodeURIComponent(demoMemberAliasMatch[1]),
          (await readBody(request)).alias,
        );
        return json(response, 200, { member: publicDemoMember(member) });
      } catch (error) {
        return json(response, error.status || 400, {
          code: error.code || "INVALID_MEMBER_ALIAS",
          msg: error.message,
        });
      }
    }
    if (
      request.method === "DELETE" &&
      url.pathname === `/v1/web/stores/${storeId}`
    ) {
      demoStoreAuthorized = false;
      return json(response, 200, {
        store: {
          id: storeId,
          supplierId: null,
          label: demoStoreLabel,
          businessMode: "全托管",
          status: "disabled",
          environment: "demo",
          authorizationRevoked: true,
        },
      });
    }
    if (
      request.method === "POST" &&
      url.pathname === `/v1/web/stores/${storeId}/publish/associated-rules`
    ) {
      return json(response, 200, {
        info: { data: [{ group_id: "template", link_rule_attribute_list: [] }] },
        diagnostics: { demo: true, charged: false },
      });
    }
    const publishTemplateMediaMatch = url.pathname.match(
      new RegExp(
        `^/v1/web/stores/${storeId}/publish-templates/([^/]+)/media/([^/]+)/download-ticket$`,
      ),
    );
    if (publishTemplateMediaMatch && request.method === "GET") {
      const template = publishTemplates.find(
        (item) => item.id === publishTemplateMediaMatch[1],
      );
      const assetId = publishTemplateMediaMatch[2];
      const assetIds = Array.isArray(template?.data?.assetIds)
        ? template.data.assetIds.map(String)
        : [];
      const asset = mediaAssets.find((item) => item.id === assetId);
      if (
        template?.templateType !== "tail_image" ||
        !assetIds.includes(assetId) ||
        !asset ||
        !["ready", "referenced"].includes(asset.status)
      ) {
        return json(response, 404, {
          code: "TEMPLATE_MEDIA_NOT_FOUND",
          msg: "图片不属于当前可见尾部主图模板",
        });
      }
      return json(response, 200, {
        asset,
        download: {
          method: "GET",
          url: `http://${request.headers.host}/v1/web-demo/downloads/${asset.id}`,
          headers: {},
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        },
      });
    }
    const publishTemplateMatch = url.pathname.match(
      new RegExp(`^/v1/web/stores/${storeId}/publish-templates(?:/([^/]+))?$`),
    );
    if (publishTemplateMatch && request.method === "GET") {
      const type = url.searchParams.get("type");
      const rows = publishTemplates.filter(
        (template) => !type || template.templateType === type,
      ).map((template) => ({
        ...template,
        data: normalizeDemoPublishTemplateData(
          template.templateType,
          template.data,
        ),
      }));
      return json(response, 200, { templates: rows, count: rows.length });
    }
    if (publishTemplateMatch && ["POST", "PUT"].includes(request.method)) {
      const input = await readBody(request);
      const id = publishTemplateMatch[1] || crypto.randomUUID();
      const existing = publishTemplates.findIndex((template) => template.id === id);
      const previous = existing >= 0 ? publishTemplates[existing] : null;
      const template = {
        id,
        storeId,
        scope: "tenant",
        scopeLabel: "全员通用",
        ownerUserId: "demo-user",
        canManage: true,
        templateType: input.templateType,
        name: input.name,
        categoryId: input.categoryId || "",
        productTypeId: input.productTypeId || "",
        schemaFingerprint: "demo-schema-fingerprint",
        data: normalizeDemoPublishTemplateData(
          input.templateType,
          input.data,
        ),
        version: (previous?.version || 0) + 1,
        createdAt: previous?.createdAt || now(),
        updatedAt: now(),
      };
      if (existing >= 0) publishTemplates[existing] = template;
      else publishTemplates.unshift(template);
      return json(response, request.method === "POST" ? 201 : 200, { template });
    }
    if (publishTemplateMatch && request.method === "DELETE") {
      const index = publishTemplates.findIndex(
        (template) => template.id === publishTemplateMatch[1],
      );
      if (index < 0) {
        return json(response, 404, { code: "TEMPLATE_NOT_FOUND", msg: "模板不存在" });
      }
      const [{ id }] = publishTemplates.splice(index, 1);
      return json(response, 200, { ok: true, id });
    }
    if (
      request.method === "GET" &&
      url.pathname === `/v1/web/stores/${storeId}/products`
    ) {
      return json(response, 200, {
        products: [],
        count: 0,
        total: 0,
        pageNum: 1,
        pageSize: 30,
      });
    }
    if (
      ["GET", "POST"].includes(request.method) &&
      url.pathname === `/v1/web/stores/${storeId}/business-dashboard`
    ) {
      const refresh = request.method === "POST"
        ? startDemoBusinessRefresh(demoBusinessRefresh)
        : null;
      const dashboard = readDemoBusinessDashboard(demoBusinessRefresh);
      return json(
        response,
        200,
        refresh?.job ? { ...dashboard, refreshJob: refresh.job } : dashboard,
      );
    }
    if (
      request.method === "POST" &&
      url.pathname === `/v1/web/stores/${storeId}/rules/refresh`
    ) {
      return json(response, 202, startDemoRuleRefresh(demoBusinessRefresh));
    }
    if (
      request.method === "POST" &&
      url.pathname === `/v1/web/stores/${storeId}/rules/refresh/retry`
    ) {
      try {
        const input = await readBody(request);
        retryDemoRuleRefresh(input?.jobId);
      } catch (error) {
        return json(response, error.status || 503, {
          code: error.code || "DEMO_RULE_REFRESH_RETRY_UNAVAILABLE",
          msg: error.message,
        });
      }
    }
    if (
      request.method === "POST" &&
      url.pathname === `/v1/web/stores/${storeId}/publish/schema-sync`
    ) {
      return json(response, 503, {
        code: "DEMO_SCHEMA_SYNC_UNAVAILABLE",
        msg: "演示环境未连接真实 SHEIN 授权服务，不能同步全部类目 schema",
      });
    }
    if (
      request.method === "POST" &&
      url.pathname === `/v1/web/stores/${storeId}/compliance/refresh`
    ) {
      try {
        return json(response, 202, startDemoComplianceSync(demoBusinessRefresh));
      } catch (error) {
        return json(response, error.status || 409, {
          code: error.code || "COMPLIANCE_SYNC_NO_TARGETS",
          msg: error.message,
        });
      }
    }
    if (
      request.method === "GET" &&
      url.pathname === `/v1/web/stores/${storeId}/compliance-workspace`
    ) {
      const requestedPage = Number(url.searchParams.get("page") || 1);
      const requestedPageSize = Number(url.searchParams.get("pageSize") || 50);
      const page = Number.isInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1;
      const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0
        ? Math.min(100, requestedPageSize)
        : 50;
      return json(response, 200, {
        items: [],
        pagination: { page, pageSize, total: 0, pageCount: 0 },
      });
    }
    const demoComplianceDetailMatch = url.pathname.match(
      new RegExp(`^/v1/web/stores/${storeId}/compliance-workspace/([^/]+)$`),
    );
    if (request.method === "GET" && demoComplianceDetailMatch) {
      return json(response, 404, {
        code: "COMPLIANCE_SKC_NOT_FOUND",
        msg: "验收店铺没有该SKC合规缓存",
      });
    }
    const demoSyncJobMatch = url.pathname.match(
      new RegExp(`^/v1/web/stores/${storeId}/sync-jobs(?:/([^/]+))?$`),
    );
    if (request.method === "GET" && demoSyncJobMatch) {
      try {
        if (demoSyncJobMatch[1]) {
          return json(
            response,
            200,
            getDemoSyncJob(demoBusinessRefresh, decodeURIComponent(demoSyncJobMatch[1])),
          );
        }
        return json(response, 200, listDemoSyncJobs(demoBusinessRefresh, {
          state: url.searchParams.get("state") || "",
          jobType: url.searchParams.get("jobType") || "",
        }));
      } catch (error) {
        return json(response, error.status || 400, {
          code: error.code || "INVALID_SYNC_JOB",
          msg: error.message,
        });
      }
    }
    if (
      request.method === "GET" &&
      url.pathname === `/v1/web/stores/${storeId}/publish/categories`
    ) {
      try {
        return json(response, 200, getDemoPublishCategories());
      } catch (error) {
        return json(response, error.status || 503, {
          code: error.code || "DEMO_CATEGORY_SNAPSHOT_MISSING",
          msg: error.message,
        });
      }
    }
    if (
      request.method === "POST" &&
      url.pathname === `/v1/web/stores/${storeId}/publish/schema`
    ) {
      try {
        const input = await readBody(request);
        return json(response, 200, getDemoPublishSchema(input));
      } catch (error) {
        return json(response, error.status || 400, {
          code: error.code || "INVALID_DEMO_SCHEMA_REQUEST",
          msg: error.message,
        });
      }
    }
    if (
      request.method === "GET" &&
      url.pathname === `/v1/web/stores/${storeId}/publish/schema-coverage`
    ) {
      try {
        return json(response, 200, getDemoPublishSchemaCoverage());
      } catch (error) {
        return json(response, error.status || 503, {
          code: error.code || "DEMO_SCHEMA_COVERAGE_UNAVAILABLE",
          msg: error.message,
        });
      }
    }
    if (
      request.method === "GET" &&
      url.pathname === `/v1/web/stores/${storeId}/media`
    ) {
      const purpose = url.searchParams.get("purpose");
      const limit = Math.min(
        100,
        Math.max(1, Number(url.searchParams.get("limit") || 50)),
      );
      const assets = mediaAssets
        .filter((asset) => !purpose || asset.purpose === purpose)
        .slice(0, limit);
      return json(response, 200, {
        assets,
        count: assets.length,
      });
    }
    if (
      request.method === "POST" &&
      url.pathname === `/v1/web/stores/${storeId}/media/upload-ticket`
    ) {
      const input = await readBody(request);
      const asset = {
        id: crypto.randomUUID(),
        storeId,
        originalName: String(input.originalName || ""),
        contentType: String(input.contentType || ""),
        status: "uploading",
        sizeBytes: Number(input.sizeBytes || 0),
        width: null,
        height: null,
        purpose: String(input.purpose || "temporary_upload"),
        createdAt: now(),
      };
      mediaAssets.unshift(asset);
      mediaUploads.set(asset.id, {
        expectedSize: asset.sizeBytes,
        bytes: null,
      });
      return json(response, 201, {
        asset,
        upload: {
          url: `http://${request.headers.host}/v1/web-demo/uploads/${asset.id}`,
          method: "PUT",
          headers: {
            "Content-Type": asset.contentType,
          },
          expiresInSeconds: 600,
        },
      });
    }
    const demoUploadMatch = url.pathname.match(
      /^\/v1\/web-demo\/uploads\/([^/]+)$/,
    );
    if (request.method === "PUT" && demoUploadMatch) {
      const upload = mediaUploads.get(demoUploadMatch[1]);
      if (!upload) {
        return json(response, 404, {
          code: "UPLOAD_NOT_FOUND",
          msg: "验收上传任务不存在",
        });
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      upload.bytes = Buffer.concat(chunks);
      if (
        upload.expectedSize > 0 &&
        upload.bytes.length !== upload.expectedSize
      ) {
        return json(response, 400, {
          code: "UPLOAD_SIZE_MISMATCH",
          msg: "验收上传文件大小不一致",
        });
      }
      response.writeHead(200, {
        "Content-Type": "text/plain;charset=UTF-8",
        "Cache-Control": "no-store",
      });
      return response.end("ok");
    }
    const demoCompleteMatch = url.pathname.match(
      new RegExp(
        `^/v1/web/stores/${storeId}/media/([^/]+)/complete$`,
      ),
    );
    if (request.method === "POST" && demoCompleteMatch) {
      const asset = mediaAssets.find(
        (item) => item.id === demoCompleteMatch[1],
      );
      const upload = mediaUploads.get(demoCompleteMatch[1]);
      if (!asset || !upload?.bytes) {
        return json(response, 409, {
          code: "UPLOAD_INCOMPLETE",
          msg: "请先完成验收文件上传",
        });
      }
      const input = await readBody(request);
      asset.status = "ready";
      asset.sizeBytes = upload.bytes.length;
      asset.width = Number(input.width) || null;
      asset.height = Number(input.height) || null;
      return json(response, 200, { asset });
    }
    const demoDownloadTicketMatch = url.pathname.match(
      new RegExp(
        `^/v1/web/stores/${storeId}/media/([^/]+)/download-ticket$`,
      ),
    );
    if (request.method === "GET" && demoDownloadTicketMatch) {
      const asset = mediaAssets.find(
        (item) => item.id === demoDownloadTicketMatch[1],
      );
      if (!asset || !["ready", "referenced"].includes(asset.status)) {
        return json(response, 404, {
          code: "MEDIA_NOT_FOUND",
          msg: "验收图片不存在或尚未完成",
        });
      }
      return json(response, 200, {
        asset,
        download: {
          method: "GET",
          url: `http://${request.headers.host}/v1/web-demo/downloads/${asset.id}`,
          headers: {},
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        },
      });
    }
    const demoDownloadMatch = url.pathname.match(
      /^\/v1\/web-demo\/downloads\/([^/]+)$/,
    );
    if (request.method === "GET" && demoDownloadMatch) {
      const asset = mediaAssets.find((item) => item.id === demoDownloadMatch[1]);
      const upload = mediaUploads.get(demoDownloadMatch[1]);
      if (!asset || !upload?.bytes) {
        return json(response, 404, {
          code: "MEDIA_NOT_FOUND",
          msg: "验收图片内容不存在",
        });
      }
      response.writeHead(200, {
        "Content-Type": asset.contentType || "application/octet-stream",
        "Content-Length": upload.bytes.length,
        "Cache-Control": "no-store",
      });
      return response.end(upload.bytes);
    }
    if (
      url.pathname === `/v1/web/stores/${storeId}/product-drafts` &&
      request.method === "GET"
    ) {
      return json(response, 200, { drafts, count: drafts.length });
    }
    if (
      url.pathname === `/v1/web/stores/${storeId}/product-drafts` &&
      request.method === "POST"
    ) {
      const input = await readBody(request);
      return json(
        response,
        201,
        await demoProductDrafts.save({
          context: { tenantId: "demo-tenant", userId: "user-demo" },
          storeId,
          input,
        }),
      );
    }
    if (
      request.method === "POST" &&
      url.pathname === `/v1/web/stores/${storeId}/publish/preflight`
    ) {
      const input = await readBody(request);
      const supplierSkuList = Array.from(new Set(input.supplierSkuList || []));
      return json(response, 200, {
        passed: false,
        blockers: [
          ...(!supplierSkuList.length ? ["缺少商家SKU"] : []),
          "演示环境未连接真实SHEIN店铺，远程预检不可用",
        ],
        permission: { canPublishProduct: null, reason: "演示环境未连接真实店铺" },
        shelfQuota: { availableLimit: null },
        supplierSkuCheck: {
          requestedCount: supplierSkuList.length,
          checkedCount: 0,
          repeatedSkus: [],
          results: [],
        },
      });
    }
    if (
      url.pathname === `/v1/web/stores/${storeId}/publish-batches` &&
      request.method === "GET"
    ) {
      return json(response, 200, {
        batches: batches.map(publicBatch),
        count: batches.length,
        publishingEnabled: false,
      });
    }
    const readbackStatusMatch = url.pathname.match(
      new RegExp(`^/v1/web/stores/${storeId}/publish-batches/([^/]+)/readback-status$`),
    );
    if (request.method === "GET" && readbackStatusMatch) {
      const batch = batches.find((item) => item.id === readbackStatusMatch[1]);
      if (!batch) {
        return json(response, 404, {
          code: "NOT_FOUND",
          msg: "发布批次不存在",
        });
      }
      return json(response, 200, {
        batchId: batch.id,
        items: [],
        readOnly: true,
      });
    }
    if (
      url.pathname === `/v1/web/stores/${storeId}/publish-batches` &&
      request.method === "POST"
    ) {
      const input = await readBody(request);
      const requestedDrafts = Array.from(new Set(input.draftIds || []));
      const invalidDrafts = requestedDrafts.filter((draftId) => {
        const draft = drafts.find((item) => item.id === draftId);
        return !isDemoDraftBatchEligible(draft);
      });
      if (!requestedDrafts.length || invalidDrafts.length) {
        return json(response, 409, {
          code: "INVALID_BATCH_DRAFTS",
          msg: "部分商品草稿不存在、尚未预检通过或不属于当前店铺",
        });
      }
      let batch = batches.find(
        (item) => item.idempotencyKey === input.idempotencyKey,
      );
      if (!batch) {
        batch = {
          id: crypto.randomUUID(),
          storeId,
          name: input.name,
          idempotencyKey: input.idempotencyKey,
          state: "queued",
          preflight: {},
          lastError: "",
          createdAt: now(),
          updatedAt: now(),
          items: requestedDrafts.map((draftId) => {
            const draft = drafts.find((item) => item.id === draftId);
            return {
              id: crypto.randomUUID(),
              draftId,
              draftName: draft?.name || draftId,
              state: "queued",
              attemptCount: 0,
              preflight: {},
              lastError: "",
              updatedAt: now(),
            };
          }),
        };
        batches.unshift(batch);
      }
      return json(response, 201, {
        batch: publicBatch(batch),
        publishingEnabled: false,
      });
    }
    const actionMatch = url.pathname.match(
      new RegExp(`^/v1/web/stores/${storeId}/publish-batches/([^/]+)/actions$`),
    );
    if (request.method === "POST" && actionMatch) {
      const input = await readBody(request);
      const batch = batches.find((item) => item.id === actionMatch[1]);
      if (!batch) return json(response, 404, { code: "NOT_FOUND", msg: "批次不存在" });
      try {
        applyDemoBatchAction(batch, input.action);
      } catch (error) {
        return json(response, error.status || 400, {
          code: error.code || "INVALID_BATCH_ACTION",
          msg: error.message,
        });
      }
      return json(response, 200, {
        batch: publicBatch(batch),
        publishingEnabled: false,
      });
    }

    return json(response, 404, {
      code: "NOT_FOUND",
      msg: `验收服务未实现 ${request.method} ${url.pathname}`,
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createWebDemoServer().listen(port, host, () => {
    console.log(`[web-demo] http://${host}:${port}`);
  });
}
