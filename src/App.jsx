import { useEffect, useMemo, useRef, useState } from "react";
import readExcelFile from "read-excel-file/browser";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Database,
  FileCheck2,
  FileSpreadsheet,
  Filter,
  FolderOpen,
  FolderTree,
  Gauge,
  Images,
  LayoutDashboard,
  Library,
  Link2,
  ListChecks,
  LoaderCircle,
  Menu,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Store,
  Tags,
  Trash2,
  Upload,
  Warehouse,
  X,
  XCircle,
} from "lucide-react";
import {
  buildPublishProduct,
  classifyPublishImage,
  formatImageSize,
  publishImageTypes,
  validatePublishImage,
} from "./lib/publish-image-rules.js";
import {
  BUSINESS_MODE_LABELS,
  createPublishPreflightPlan,
} from "./lib/shein-publish-contract.js";
import {
  COMPLIANCE_GROUPS,
  SHEIN_TEMPLATE_ENDPOINTS,
  buildAttributeFields,
  findCategoryTrail,
  flattenLeafCategories,
  toCategorySelection,
  validateAttributeAssignments,
  validateTemplateSync,
} from "./lib/shein-template-contract.js";
import {
  calculateAreaSquareMeters,
  createSizeRow,
  enrichSizeRows,
  normalizePackagingWorkbook,
} from "./lib/package-template.js";
import {
  applySheinSizeOption,
  buildSizeAttributeList,
  filterSheinSizeOptions,
  validateSizeTemplate,
} from "./lib/shein-size-template.js";
import { appendTailMainImages } from "./lib/main-image-template.js";
import { buildNewProductDraft } from "./lib/shein-publish-draft.js";

function toUiStore(store) {
  const label = store.label || `SHEIN 店铺 ${store.supplierId || ""}`.trim();
  return {
    ...store,
    name: label,
    short: label.replace(/\s+/g, "").slice(0, 2).toUpperCase() || "SH",
    status: "已授权",
    synced: "待同步",
    today: null,
    sevenDays: null,
    thirtyDays: null,
    change: null,
    pending: null,
    risk: null,
  };
}

function withBusinessData(store, record) {
  const data = record?.data || record?.value || null;
  return {
    ...store,
    today: data?.totals?.today ?? null,
    yesterday: data?.totals?.yesterday ?? null,
    sevenDays: data?.totals?.sales7 ?? null,
    thirtyDays: data?.totals?.sales30 ?? null,
    synced: record?.syncedAt ? "已同步" : store.synced,
    syncedAt: record?.syncedAt || null,
    dataDate: data?.dataDate || "",
    productCount: data?.productCount ?? null,
    skuCount: data?.skuCount ?? null,
  };
}

const navGroups = [
  {
    label: "运营",
    items: [
      { id: "overview", label: "总览", icon: LayoutDashboard },
      { id: "products", label: "商品工作台", icon: ShoppingBag },
      { id: "product-templates", label: "商品模板库", icon: Library },
      { id: "compliance", label: "合规中心", icon: ShieldCheck },
      { id: "audit-events", label: "审核事件", icon: ClipboardCheck },
      { id: "compliance-templates", label: "合规模板库", icon: FileCheck2 },
    ],
  },
  {
    label: "经营",
    items: [
      { id: "pricing", label: "价格管理", icon: Tags },
      { id: "inventory", label: "库存与销量", icon: Warehouse },
      { id: "purchase", label: "采购履约", icon: PackageCheck },
      { id: "returns", label: "采购退货", icon: Box },
      { id: "finance", label: "财务中心", icon: CircleDollarSign },
    ],
  },
  {
    label: "系统",
    items: [
      { id: "tasks", label: "批量任务", icon: ListChecks },
      { id: "settings", label: "店铺与系统", icon: Settings },
    ],
  },
];

const pageMeta = {
  overview: ["运营总览", "跨店铺销量、风险和待办的统一视图"],
  products: ["商品工作台", "识别、创建、编辑并批量管理商品"],
  "product-templates": ["商品模板库", "管理可复用、可校验的建品规则"],
  compliance: ["合规中心", "集中处理证书、代理公司、警告语与实拍图"],
  "audit-events": ["审核事件", "查看 SHEIN 商品资料审核状态与失败原因"],
  "compliance-templates": ["合规模板库", "沉淀可复用的合规字段与绑定方案"],
  pricing: ["价格管理", "成本价、议价单与建议零售价"],
  inventory: ["库存与销量", "库存快照、缺货需求与销量趋势"],
  purchase: ["采购履约", "采购单、智能拆包与发货状态"],
  returns: ["采购退货", "退货申请、报废和执行状态"],
  finance: ["财务中心", "报账单、销售款和补扣款明细"],
  tasks: ["批量任务", "查看后台任务进度、失败项和处理记录"],
  settings: ["店铺与系统", "授权、成员、通知和系统设置"],
};

function App() {
  const [activePage, setActivePage] = useState(() =>
    new URLSearchParams(window.location.search).has("tempToken")
      ? "settings"
      : "overview",
  );
  const [authorizedStores, setAuthorizedStores] = useState([]);
  const [storeId, setStoreId] = useState("");
  const [proxyHealth, setProxyHealth] = useState(null);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [identifyOpen, setIdentifyOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchMode, setBatchMode] = useState("identify");
  const [templateBuilderType, setTemplateBuilderType] = useState(null);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [publishTemplate, setPublishTemplate] = useState(null);
  const [publishMode, setPublishMode] = useState("single");
  const [createdTemplates, setCreatedTemplates] = useState({
    product: [],
    compliance: [],
  });
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [queriedProductRows, setQueriedProductRows] = useState([]);
  const [complianceRows, setComplianceRows] = useState([]);
  const [complianceSyncedAt, setComplianceSyncedAt] = useState(null);
  const [complianceJob, setComplianceJob] = useState(null);
  const [storeDataById, setStoreDataById] = useState({});
  const [drawerItem, setDrawerItem] = useState(null);
  const [toast, setToast] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [complianceSyncing, setComplianceSyncing] = useState(false);

  const activeStore = useMemo(
    () => authorizedStores.find((store) => store.id === storeId) || authorizedStores[0] || null,
    [authorizedStores, storeId],
  );

  const refreshStoreConnections = async () => {
    const [healthResult, storesResult] = await Promise.all([
      requestLocalApi("/api/health"),
      requestLocalApi("/api/shein/stores"),
    ]);
    const baseStores = (storesResult.stores || []).map(toUiStore);
    const cacheResults = await Promise.all(
      baseStores.map(async (store) => {
        try {
          const record = await requestLocalApi(
            `/api/shein/stores/${encodeURIComponent(store.id)}/data?summary=1`,
          );
          return [store.id, record];
        } catch {
          return [store.id, { synced: false, syncedAt: null, data: null }];
        }
      }),
    );
    const nextDataById = Object.fromEntries(cacheResults);
    const nextStores = baseStores.map((store) =>
      withBusinessData(store, nextDataById[store.id]),
    );
    setProxyHealth(healthResult);
    setAuthorizedStores(nextStores);
    setStoreDataById(nextDataById);
    setStoreId((current) =>
      nextStores.some((store) => store.id === current)
        ? current
        : nextStores[0]?.id || "",
    );
  };

  useEffect(() => {
    refreshStoreConnections().catch(() => setProxyHealth(null));
  }, []);

  const refreshTemplates = async (targetStoreId = storeId) => {
    if (!targetStoreId) {
      setCreatedTemplates({ product: [], compliance: [] });
      return;
    }
    setTemplatesLoading(true);
    try {
      const result = await requestLocalApi(
        `/api/templates?storeId=${encodeURIComponent(targetStoreId)}`,
      );
      const templates = result.templates || [];
      setCreatedTemplates({
        product: templates.filter((template) => template.templateType === "product"),
        compliance: templates.filter((template) => template.templateType === "compliance"),
      });
    } catch (error) {
      setToast(formatConnectionError(error));
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => {
    refreshTemplates(storeId);
  }, [storeId]);

  useEffect(() => {
    if (!storeId || complianceJob?.state !== "running") return undefined;
    let cancelled = false;
    let timer;

    const poll = async () => {
      try {
        const result = await requestLocalApi(
          `/api/shein/stores/${encodeURIComponent(
            storeId,
          )}/compliance/sync/status`,
        );
        if (cancelled) return;
        const nextJob = result.job || null;
        setComplianceJob(nextJob);
        if (nextJob?.state === "running") {
          timer = window.setTimeout(poll, 1500);
        } else if (nextJob) {
          const detail = await requestLocalApi(
            `/api/shein/stores/${encodeURIComponent(storeId)}/compliance`,
          );
          if (cancelled) return;
          const compliance = detail.data || null;
          setComplianceRows(compliance?.rows || []);
          setComplianceSyncedAt(compliance?.syncedAt || null);
          setStoreDataById((current) => ({
            ...current,
            [storeId]: {
              ...(current[storeId] || {}),
              data: {
                ...(current[storeId]?.data || {}),
                compliance,
              },
            },
          }));
          setToast(
            nextJob.state === "completed"
              ? `合规同步完成：已检查 ${nextJob.success} 个 SKC`
              : `合规同步完成：成功 ${nextJob.success} 个，失败 ${nextJob.failed} 个`,
          );
        }
      } catch (error) {
        if (!cancelled) {
          setToast(formatConnectionError(error));
          timer = window.setTimeout(poll, 3000);
        }
      }
    };

    timer = window.setTimeout(poll, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [storeId, complianceJob?.state]);

  useEffect(() => {
    let cancelled = false;
    if (!storeId) {
      setQueriedProductRows([]);
      setComplianceRows([]);
      setComplianceSyncedAt(null);
      setComplianceJob(null);
      return undefined;
    }

    setQueriedProductRows([]);
    setComplianceRows([]);
    setComplianceSyncedAt(null);
    setComplianceJob(null);
    requestLocalApi(
      `/api/shein/stores/${encodeURIComponent(storeId)}/data`,
    )
      .then((record) => {
        if (cancelled) return;
        setStoreDataById((current) => ({
          ...current,
          [storeId]: record,
        }));
        setQueriedProductRows(record.data?.products || []);
        setComplianceRows(record.data?.compliance?.rows || []);
        setComplianceSyncedAt(record.data?.compliance?.syncedAt || null);
        setComplianceJob(record.data?.compliance?.syncJob || null);
      })
      .catch((error) => {
        if (!cancelled) setToast(formatConnectionError(error));
      });

    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const switchStore = (nextStore) => {
    setStoreId(nextStore.id);
    setStoreMenuOpen(false);
    setToast(`已切换至 ${nextStore.name}`);
  };

  const syncStore = async () => {
    if (!activeStore) {
      setActivePage("settings");
      setToast("请先授权一个 SHEIN 店铺");
      return;
    }
    setSyncing(true);
    try {
      const result = await requestLocalApi(
        `/api/shein/stores/${encodeURIComponent(activeStore.id)}/sync`,
        { method: "POST", body: "{}" },
      );
      setStoreDataById((current) => ({
        ...current,
        [activeStore.id]: result,
      }));
      setAuthorizedStores((current) =>
        current.map((store) =>
          store.id === activeStore.id
            ? withBusinessData(store, result)
            : store,
        ),
      );
      setQueriedProductRows(result.data?.products || []);
      setComplianceRows(result.data?.compliance?.rows || []);
      setComplianceSyncedAt(result.data?.compliance?.syncedAt || null);
      setComplianceJob(result.data?.compliance?.syncJob || null);
      setToast(
        `同步完成：${result.data?.productCount || 0} 个SKC、${
          result.data?.skuCount || 0
        } 个SKU`,
      );
    } catch (error) {
      setToast(formatConnectionError(error));
    } finally {
      setSyncing(false);
    }
  };

  const syncCompliance = async ({ retryFailed = false } = {}) => {
    if (!activeStore) {
      setActivePage("settings");
      setToast("请先授权一个 SHEIN 店铺");
      return;
    }
    setComplianceSyncing(true);
    try {
      const result = await requestLocalApi(
        `/api/shein/stores/${encodeURIComponent(
          activeStore.id,
        )}/compliance/sync`,
        {
          method: "POST",
          body: JSON.stringify(retryFailed ? { retryFailed: true } : {}),
        },
      );
      setComplianceJob(result.job || null);
      if (Array.isArray(result.data?.rows)) {
        setComplianceRows(result.data.rows);
        setComplianceSyncedAt(result.data.syncedAt || null);
      }
      setToast(
        result.started
          ? retryFailed
            ? `已启动失败项重试：共 ${result.job?.total || 0} 个 SKC`
            : `已启动全店合规同步：共 ${result.job?.total || 0} 个 SKC`
          : "当前店铺的合规同步仍在运行",
      );
    } catch (error) {
      setToast(formatConnectionError(error));
    } finally {
      setComplianceSyncing(false);
    }
  };

  const inspectCompliance = async (row) => {
    setDrawerItem({ ...row, type: "compliance" });
    if (!activeStore || !row?.skc) return;
    try {
      const result = await requestLocalApi(
        `/api/shein/stores/${encodeURIComponent(
          activeStore.id,
        )}/compliance?skc=${encodeURIComponent(row.skc)}`,
      );
      setDrawerItem({ ...(result.data || row), type: "compliance" });
    } catch (error) {
      setToast(formatConnectionError(error));
    }
  };

  const openBatch = (mode = "identify") => {
    if (!activeStore) {
      setActivePage("settings");
      setToast("请先授权一个 SHEIN 店铺");
      return;
    }
    setBatchMode(mode);
    setBatchOpen(true);
  };

  const openIdentify = () => {
    if (!activeStore) {
      setActivePage("settings");
      setToast("请先授权一个 SHEIN 店铺");
      return;
    }
    setIdentifyOpen(true);
  };

  const openProductPublish = (mode = "single", template = null) => {
    if (!activeStore) {
      setActivePage("settings");
      setToast("请先授权一个 SHEIN 店铺");
      return;
    }
    if (!template) {
      setActivePage("product-templates");
      setToast("请先创建并校验商品模板");
      return;
    }
    setPublishMode(mode);
    setPublishTemplate(template);
  };

  const openTemplateBuilder = (type, template = null) => {
    setEditingTemplate(template);
    setTemplateBuilderType(type);
  };

  const deleteTemplate = async (template) => {
    if (!window.confirm(`确认删除模板“${template.name}”吗？`)) return;
    try {
      await requestLocalApi(`/api/templates/${encodeURIComponent(template.id)}`, {
        method: "DELETE",
      });
      setDrawerItem(null);
      await refreshTemplates(template.storeId);
      setToast(`${template.name} 已删除`);
    } catch (error) {
      setToast(formatConnectionError(error));
    }
  };

  const tasks = useMemo(() => {
    if (!complianceJob) return [];
    const state =
      complianceJob.state === "running"
        ? "运行中"
        : complianceJob.state === "completed"
          ? "已完成"
          : "需处理";
    return [
      {
        id: complianceJob.id,
        title: "全店合规数据同步",
        detail: `${complianceJob.completedBatches || 0} / ${
          complianceJob.batchCount || 0
        } 批`,
        progress: complianceJob.progress || 0,
        success: complianceJob.success || 0,
        failed: complianceJob.failed || 0,
        state,
        error: complianceJob.error,
        diagnostics: complianceJob.diagnostics || [],
      },
    ];
  }, [complianceJob]);

  const title = pageMeta[activePage] || pageMeta.overview;

  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${sidebarCollapsed ? "sidebar--collapsed" : ""} ${
          mobileNavOpen ? "sidebar--mobile-open" : ""
        }`}
      >
        <div className="brand">
          <div className="brand__mark">
            <ShoppingBag size={20} strokeWidth={2.2} />
          </div>
          {!sidebarCollapsed && (
            <div className="brand__copy">
              <strong>全托运营助手</strong>
              <span>SHEIN Full Service</span>
            </div>
          )}
          <button
            className="icon-button sidebar__collapse"
            type="button"
            title={sidebarCollapsed ? "展开导航" : "收起导航"}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </div>

        <nav className="sidebar__nav">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              {!sidebarCollapsed && <div className="nav-group__label">{group.label}</div>}
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={`nav-item ${activePage === item.id ? "is-active" : ""}`}
                    key={item.id}
                    type="button"
                    title={sidebarCollapsed ? item.label : undefined}
                    onClick={() => {
                      setActivePage(item.id);
                      setMobileNavOpen(false);
                    }}
                  >
                    <Icon size={18} />
                    {!sidebarCollapsed && <span>{item.label}</span>}
                    {!sidebarCollapsed && item.badge && (
                      <span className="nav-item__badge">{item.badge}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="system-health">
            <span className={`system-health__dot ${proxyHealth?.ok ? "" : "is-offline"}`} />
            {!sidebarCollapsed && (
              <div>
                <strong>{proxyHealth?.ok ? "本地代理已连接" : "本地代理未连接"}</strong>
                <span>{proxyHealth?.configured ? "应用凭证已配置" : "等待连接检查"}</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {mobileNavOpen && (
        <button
          className="mobile-backdrop"
          type="button"
          aria-label="关闭导航"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <main className="main">
        <header className="topbar">
          <div className="topbar__left">
            <button
              className="icon-button mobile-menu"
              type="button"
              title="打开导航"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu size={19} />
            </button>
            <div className="store-switcher-wrap">
              <button
                className={`store-switcher ${storeMenuOpen ? "is-open" : ""}`}
                type="button"
                onClick={() => setStoreMenuOpen((value) => !value)}
              >
                <span className="store-avatar">{activeStore?.short || "--"}</span>
                <span className="store-switcher__copy">
                  <strong>{activeStore?.name || "尚未连接店铺"}</strong>
                  <small>
                    <i className={`status-dot ${activeStore ? "" : "warning"}`} />
                    {activeStore
                      ? activeStore.syncedAt
                        ? `业务数据已同步 · ${activeStore.productCount || 0}个商品`
                        : "已授权 · 业务数据待同步"
                      : "请前往店铺与系统授权"}
                  </small>
                </span>
                <ChevronDown size={16} />
              </button>
              {storeMenuOpen && (
                <StoreMenu
                  stores={authorizedStores}
                  activeId={storeId}
                  onSelect={switchStore}
                  onManage={() => {
                    setStoreMenuOpen(false);
                    setActivePage("settings");
                  }}
                />
              )}
            </div>
          </div>
          <div className="topbar__actions">
            <button
              className="icon-button"
              type="button"
              title="同步当前店铺"
              onClick={syncStore}
            >
              <RefreshCw size={18} className={syncing ? "spin" : ""} />
            </button>
            <button className="icon-button" type="button" title="通知中心">
              <Bell size={18} />
            </button>
            <button
              className="task-trigger"
              type="button"
              onClick={() => setTaskPanelOpen(true)}
            >
              <ListChecks size={17} />
              <span>批量任务</span>
            </button>
            <span className="user-avatar">田</span>
          </div>
        </header>

        <div className="page">
          <div className="page-heading">
            <div>
              <h1>{title[0]}</h1>
              <p>{title[1]}</p>
            </div>
            <div className="page-heading__actions">
              {(activePage === "overview" || activePage === "products") && (
                <>
                  <button
                    className="button button--secondary"
                    onClick={() =>
                      activePage === "products"
                        ? openProductPublish("batch")
                        : openBatch("identify")
                    }
                  >
                    {activePage === "products" ? <FolderTree size={17} /> : <ListChecks size={17} />}
                    批量处理
                  </button>
                  <button className="button button--primary" onClick={openIdentify}>
                    <Sparkles size={17} />
                    SKC 智能识别
                  </button>
                </>
              )}
              {activePage === "compliance" && (
                <button
                  className="button button--primary"
                  onClick={() => openBatch("compliance")}
                >
                  <ShieldCheck size={17} />
                  批量合规
                </button>
              )}
            </div>
          </div>

          {activePage === "overview" && (
            <Overview
              activeStore={activeStore}
              stores={authorizedStores}
              products={storeDataById[activeStore?.id]?.data?.products || []}
              onOpenIdentify={openIdentify}
              onOpenPublish={() => openProductPublish("batch")}
              onOpenCompliance={() => setActivePage("compliance")}
              onOpenProducts={() => setActivePage("products")}
              onOpenTasks={() => setTaskPanelOpen(true)}
            />
          )}
          {activePage === "products" && (
            <ProductWorkbench
              store={activeStore}
              rows={queriedProductRows}
              onProductsLoaded={setQueriedProductRows}
              onInspect={setDrawerItem}
              onIdentify={openIdentify}
              onBatch={() => openProductPublish("batch")}
            />
          )}
          {activePage === "product-templates" && (
            <TemplateLibrary
              type="product"
              extraTemplates={createdTemplates.product}
              loading={templatesLoading}
              onCreate={() => openTemplateBuilder("product")}
              onIdentify={openIdentify}
              onInspect={setDrawerItem}
              onEdit={(template) => openTemplateBuilder("product", template)}
              onDelete={deleteTemplate}
              onUse={(template) => openProductPublish("single", template)}
            />
          )}
          {activePage === "compliance" && (
            <ComplianceCenter
              rows={complianceRows}
              syncedAt={complianceSyncedAt}
              syncing={
                complianceSyncing || complianceJob?.state === "running"
              }
              job={complianceJob}
              onSync={() => syncCompliance()}
              onRetryFailed={() => syncCompliance({ retryFailed: true })}
              onInspect={inspectCompliance}
            />
          )}
          {activePage === "audit-events" && (
            <AuditEventCenter store={activeStore} />
          )}
          {activePage === "compliance-templates" && (
            <TemplateLibrary
              type="compliance"
              extraTemplates={createdTemplates.compliance}
              loading={templatesLoading}
              onCreate={() => openTemplateBuilder("compliance")}
              onIdentify={openIdentify}
              onInspect={setDrawerItem}
              onEdit={(template) => openTemplateBuilder("compliance", template)}
              onDelete={deleteTemplate}
              onUse={() => openBatch("compliance")}
            />
          )}
          {activePage === "tasks" && <TaskPage tasks={tasks} onInspect={setDrawerItem} />}
          {activePage === "settings" && (
            <ConnectionSettings onStoresChanged={refreshStoreConnections} />
          )}
          {![
            "overview",
            "products",
            "product-templates",
            "compliance",
            "audit-events",
            "compliance-templates",
            "tasks",
            "settings",
          ].includes(activePage) && <ModulePlaceholder page={activePage} />}
        </div>
      </main>

      {identifyOpen && activeStore && (
        <IdentifyDialog
          store={activeStore}
          onProductIdentified={(product) => {
            setQueriedProductRows((current) => [
              product,
              ...current.filter((row) => row.skc !== product.skc),
            ]);
          }}
          onInspect={setDrawerItem}
          onClose={() => setIdentifyOpen(false)}
        />
      )}
      {batchOpen && activeStore && (
        <BatchDialog
          initialMode={batchMode}
          store={activeStore}
          complianceRows={complianceRows}
          complianceTemplates={createdTemplates.compliance}
          onClose={() => setBatchOpen(false)}
        />
      )}
      {templateBuilderType && activeStore && (
        <TemplateBuilderDialog
          store={activeStore}
          type={templateBuilderType}
          initialTemplate={editingTemplate}
          onClose={() => {
            setTemplateBuilderType(null);
            setEditingTemplate(null);
          }}
          onComplete={async (template) => {
            const path = editingTemplate
              ? `/api/templates/${encodeURIComponent(editingTemplate.id)}`
              : "/api/templates";
            const result = await requestLocalApi(path, {
              method: editingTemplate ? "PUT" : "POST",
              body: JSON.stringify(template),
            });
            await refreshTemplates(activeStore.id);
            setTemplateBuilderType(null);
            setEditingTemplate(null);
            setDrawerItem({
              ...result.template,
              type: "template",
              templateType: templateBuilderType,
            });
            setToast(
              `${result.template.name} 已${editingTemplate ? "更新" : "创建"}并保存`,
            );
          }}
        />
      )}
      {publishTemplate && activeStore && (
        <PublishDialog
          store={activeStore}
          template={publishTemplate}
          initialMode={publishMode}
          onClose={() => setPublishTemplate(null)}
        />
      )}
      {drawerItem && (
        <DetailDrawer
          item={drawerItem}
          store={activeStore}
          onClose={() => setDrawerItem(null)}
          onEditTemplate={(template) => {
            setDrawerItem(null);
            openTemplateBuilder(template.templateType, template);
          }}
          onDeleteTemplate={deleteTemplate}
        />
      )}
      {taskPanelOpen && <TaskPanel tasks={tasks} onClose={() => setTaskPanelOpen(false)} />}
      {toast && (
        <div className="toast">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}

function StoreMenu({ stores, activeId, onSelect, onManage }) {
  const [query, setQuery] = useState("");
  const filtered = stores.filter((store) =>
    store.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="store-menu">
      <div className="store-menu__head">
        <strong>切换店铺</strong>
        <span>{stores.length} 家已授权</span>
      </div>
      <label className="search-field search-field--compact">
        <Search size={16} />
        <input
          autoFocus
          value={query}
          placeholder="搜索店铺"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="store-menu__list">
        {filtered.length === 0 && (
          <div className="store-menu__empty">
            <Store size={20} />
            <strong>暂无已授权店铺</strong>
            <span>前往店铺与系统完成 SHEIN 授权</span>
          </div>
        )}
        {filtered.map((store) => (
          <button
            className={`store-option ${activeId === store.id ? "is-active" : ""}`}
            key={store.id}
            type="button"
            onClick={() => onSelect(store)}
          >
            <span className="store-avatar store-avatar--small">{store.short}</span>
            <span>
              <strong>{store.name}</strong>
              <small>Supplier ID {store.supplierId || "待获取"}</small>
            </span>
            {activeId === store.id && <Check size={17} />}
          </button>
        ))}
      </div>
      <button className="store-menu__manage" type="button" onClick={onManage}>
        <Store size={16} />
        管理授权店铺
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

function Overview({
  activeStore,
  stores,
  products,
  onOpenIdentify,
  onOpenPublish,
  onOpenCompliance,
  onOpenProducts,
  onOpenTasks,
}) {
  const syncedStores = stores.filter((store) => store.syncedAt);
  const sumStoreMetric = (key) =>
    syncedStores.reduce((sum, store) => sum + Number(store[key] || 0), 0);
  const todayTotal = sumStoreMetric("today");
  const yesterdayTotal = sumStoreMetric("yesterday");
  const sales7Total = sumStoreMetric("sevenDays");
  const sales30Total = sumStoreMetric("thirtyDays");
  const todayChange =
    yesterdayTotal > 0
      ? `${(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100).toFixed(1)}%`
      : null;

  return (
    <div className="stack">
      <section className="metric-band">
        <Metric
          label="全部店铺今日销量"
          value={syncedStores.length ? todayTotal : "—"}
          meta={
            syncedStores.length
              ? `${syncedStores.length} 家店铺已同步`
              : "点击顶部同步按钮读取销量"
          }
          trend={todayChange}
          icon={Gauge}
          accent="teal"
        />
        <Metric
          label="全部店铺7日销量"
          value={syncedStores.length ? sales7Total : "—"}
          meta={
            activeStore?.dataDate
              ? `统计截止 ${activeStore.dataDate}`
              : "等待真实 SKU 销量数据"
          }
          icon={ArrowUpRight}
          accent="green"
        />
        <Metric
          label="全部店铺30日销量"
          value={syncedStores.length ? sales30Total : "—"}
          meta={`已授权 ${stores.length} 家 · 已同步 ${syncedStores.length} 家`}
          icon={Database}
          accent="blue"
        />
        <Metric
          label="需要立即处理"
          value="—"
          meta="等待商品与合规接口同步"
          icon={AlertCircle}
          accent="red"
        />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>店铺销量概览</h2>
            <p>所有已授权店铺的实时销量与经营状态</p>
          </div>
          <button className="text-button" type="button">
            查看完整报表 <ChevronRight size={15} />
          </button>
        </div>
        <div className="store-sales-table">
          <div className="table-head">
            <span>店铺</span>
            <span>今日销量</span>
            <span>7日销量</span>
            <span>30日销量</span>
            <span>较昨日</span>
            <span>待办 / 风险</span>
            <span>数据状态</span>
          </div>
          {stores.length === 0 && (
            <DataEmptyState
              icon={Store}
              title="暂无已授权店铺"
              description="完成店铺授权后，这里会展示真实店铺连接状态。"
            />
          )}
          {stores.map((store) => (
            <div
              className={`table-row ${store.id === activeStore?.id ? "is-current" : ""}`}
              key={store.id}
            >
              <span className="cell-store">
                <span className="store-avatar store-avatar--small">{store.short}</span>
                <span>
                  <strong>{store.name}</strong>
                  <small>{store.id === activeStore?.id ? "当前店铺" : "已授权"}</small>
                </span>
              </span>
              <strong>{store.today ?? "—"}</strong>
              <span>{store.sevenDays ?? "—"}</span>
              <span>{store.thirtyDays ?? "—"}</span>
              <span>
                {store.yesterday > 0 && store.today !== null
                  ? `${(
                      ((store.today - store.yesterday) / store.yesterday) *
                      100
                    ).toFixed(1)}%`
                  : "—"}
              </span>
              <span>—</span>
              <span className="sync-state">
                <i className="status-dot" />
                {store.syncedAt ? "已同步" : "待同步"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="overview-grid">
        <section className="section-block">
          <div className="section-heading">
            <div>
              <h2>当前店铺待办</h2>
              <p>{activeStore?.name || "尚未连接店铺"} · 真实业务数据</p>
            </div>
            <button className="icon-button" type="button" title="筛选待办">
              <Filter size={17} />
            </button>
          </div>
          <div className="todo-list">
            <DataEmptyState
              icon={ClipboardCheck}
              title="暂无已同步待办"
              description="商品、合规与采购接口接入后，将按真实状态生成待办。"
            />
          </div>
        </section>

        <section className="section-block quick-section">
          <div className="section-heading">
            <div>
              <h2>快捷操作</h2>
              <p>从识别和模板开始处理</p>
            </div>
          </div>
          <div className="quick-grid">
            <QuickAction icon={Sparkles} label="SKC智能识别" meta="生成双模板" onClick={onOpenIdentify} />
            <QuickAction icon={FolderTree} label="批量建品" meta="导入商品文件夹" onClick={onOpenPublish} />
            <QuickAction icon={ShieldCheck} label="批量合规" meta="识别并补充" onClick={onOpenCompliance} />
            <QuickAction icon={Library} label="模板库" meta="暂无已校验模板" />
          </div>
        </section>
      </div>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>近期商品</h2>
            <p>优先展示有审核或合规变化的商品</p>
          </div>
          <button className="text-button" type="button" onClick={onOpenProducts}>
            进入商品工作台 <ChevronRight size={15} />
          </button>
        </div>
        <ProductTable rows={products.slice(0, 3)} compact />
      </section>
    </div>
  );
}

function Metric({ label, value, meta, trend, icon: Icon, accent }) {
  return (
    <div className="metric">
      <div className={`metric__icon metric__icon--${accent}`}>
        <Icon size={19} />
      </div>
      <div className="metric__label">{label}</div>
      <div className="metric__value">{value}</div>
      <div className="metric__footer">
        <span>{meta}</span>
        {trend && <strong className={accent === "red" ? "text-danger" : ""}>{trend}</strong>}
      </div>
    </div>
  );
}

function Todo({ tone, title, detail, action, onClick }) {
  return (
    <button className="todo" type="button" onClick={onClick}>
      <span className={`todo__indicator todo__indicator--${tone}`} />
      <span className="todo__copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className="todo__action">{action}</span>
      <ChevronRight size={16} />
    </button>
  );
}

function QuickAction({ icon: Icon, label, meta, onClick }) {
  return (
    <button className="quick-action" type="button" onClick={onClick}>
      <span className="quick-action__icon">
        <Icon size={19} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{meta}</small>
      </span>
      <ChevronRight size={15} />
    </button>
  );
}

function DataEmptyState({ icon: Icon = Database, title, description }) {
  return (
    <div className="data-empty-state">
      <Icon size={22} />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function ProductWorkbench({
  store,
  rows,
  onProductsLoaded,
  onInspect,
  onIdentify,
  onBatch,
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchNotice, setSearchNotice] = useState(null);
  const [activeFilter, setActiveFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const productFilters = [
    { id: "all", label: "全部", predicate: () => true },
    { id: "draft", label: "待发布", predicate: (row) => row.state === "待发布" },
    { id: "review", label: "审核中", predicate: (row) => row.state === "审核中" },
    {
      id: "failed",
      label: "审核失败",
      predicate: (row) => row.state === "审核失败",
    },
    { id: "selling", label: "在售", predicate: (row) => row.state === "在售" },
    { id: "off", label: "已下架", predicate: (row) => row.state === "已下架" },
  ];
  const selectedFilter =
    productFilters.find((filter) => filter.id === activeFilter) || productFilters[0];
  const visibleRows = rows.filter(selectedFilter.predicate);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const safePage = Math.min(currentPage, pageCount);
  const pagedRows = visibleRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilter, rows]);

  const searchPlatform = async (event) => {
    event?.preventDefault();
    const skc = query.trim();
    if (!skc || !store || searching) return;
    setSearching(true);
    setSearchNotice(null);
    try {
      const result = await requestLocalApi(
        `/api/shein/stores/${encodeURIComponent(store.id)}/products/search`,
        {
          method: "POST",
          body: JSON.stringify({ skc }),
        },
      );
      const products = result.products || [];
      onProductsLoaded(products);
      setSearchNotice(
        products.length
          ? { type: "success", text: `已从当前店铺查询到 SKC ${skc}` }
          : {
              type: "empty",
              text: "当前授权店铺未查询到该 SKC，或商品尚未审核通过",
            },
      );
    } catch (error) {
      onProductsLoaded([]);
      setSearchNotice({ type: "error", text: formatConnectionError(error) });
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <form className="platform-product-search" onSubmit={searchPlatform}>
          <label className="search-field">
            <Search size={17} />
            <input
              value={query}
              placeholder="输入平台 SKC 编码"
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchNotice(null);
              }}
            />
          </label>
          <button
            className="button button--primary"
            type="submit"
            disabled={!query.trim() || !store || searching}
          >
            {searching ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}
            {searching ? "正在查询" : "查询平台商品"}
          </button>
        </form>
        <div className="toolbar__group">
          <button className="button button--secondary" type="button">
            <Filter size={16} /> 筛选
          </button>
          <button className="button button--secondary" type="button">
            <SlidersHorizontal size={16} /> 列设置
          </button>
          <button className="button button--secondary" type="button" onClick={onBatch}>
            <FolderTree size={16} /> 批量操作
          </button>
          <button className="button button--primary" type="button" onClick={onIdentify}>
            <Sparkles size={16} /> 智能识别
          </button>
        </div>
      </div>
      {searchNotice && (
        <div
          className={`product-search-notice product-search-notice--${searchNotice.type}`}
          role="status"
        >
          {searchNotice.type === "success" ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertCircle size={16} />
          )}
          <span>{searchNotice.text}</span>
        </div>
      )}
      <div className="filter-tabs">
        {productFilters.map((filter) => (
          <button
            className={activeFilter === filter.id ? "is-active" : ""}
            key={filter.id}
            type="button"
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label} <span>{rows.filter(filter.predicate).length}</span>
          </button>
        ))}
      </div>
      <section className="section-block table-section">
        <ProductTable rows={pagedRows} onInspect={onInspect} selectable />
        <TableFooter
          count={pagedRows.length}
          total={visibleRows.length}
          page={safePage}
          pageCount={pageCount}
          onPageChange={setCurrentPage}
        />
      </section>
    </div>
  );
}

function ProductTable({ rows, compact = false, selectable = false, onInspect }) {
  return (
    <div className={`product-table ${compact ? "product-table--compact" : ""}`}>
      <div className="product-table__head">
        {selectable && <input aria-label="全选商品" type="checkbox" />}
        <span>商品</span>
        <span>类目 / 变体</span>
        <span>来源模板</span>
        <span>合规</span>
        <span>状态</span>
        <span>7日销量</span>
        <span />
      </div>
      {rows.length === 0 && (
        <DataEmptyState
          icon={ShoppingBag}
          title="暂无真实商品数据"
          description="商品查询接口接入后，这里只展示当前授权店铺返回的商品。"
        />
      )}
      {rows.map((row) => (
        <div className="product-table__row" key={row.skc}>
          {selectable && <input aria-label={`选择 ${row.skc}`} type="checkbox" />}
          <span className="product-cell">
            <span className="product-thumb">
              {row.image ? <img src={row.image} alt="" /> : <Images size={20} />}
            </span>
            <span>
              <strong>{row.name}</strong>
              <small>{row.skc}</small>
            </span>
          </span>
          <span className="two-line-cell">
            <strong>{row.category}</strong>
            <small>{row.variants}</small>
          </span>
          <span>{row.template}</span>
          <StatusChip value={row.compliance} />
          <StatusChip value={row.state} />
          <strong>{row.sales7}</strong>
          <button
            className="icon-button icon-button--small"
            type="button"
            title="查看详情"
            onClick={() => onInspect?.(row)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

function StatusChip({ value }) {
  const tone = ["通过", "审核通过", "在售", "已完成", "可用", "已授权", "API支持", "已生成", "可提交"].includes(value)
    ? "success"
    : ["失败", "审核失败", "处理失败", "已失效", "已下架", "需修正"].includes(value)
      ? "danger"
      : ["待审核", "审核中", "处理中", "等待处理", "运行中"].includes(value)
        ? "info"
        : ["无需", "已撤回"].includes(value)
          ? "neutral"
          : "warning";
  return <span className={`status-chip status-chip--${tone}`}>{value}</span>;
}

const auditStateLabels = {
  pending: "待审核",
  passed: "审核通过",
  failed: "审核失败",
  withdrawn: "已撤回",
};

const eventStateLabels = {
  received: "等待入队",
  queued: "等待处理",
  processing: "处理中",
  processed: "已处理",
  failed: "处理失败",
};

function formatAuditDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

function flattenAuditEvents(items) {
  return (items || []).flatMap((event) => {
    const records = event.projection?.records || [];
    const sourceRecords = records.length ? records : [null];
    return sourceRecords.map((record, index) => ({
      id: `${event.id}:${index}`,
      eventId: event.id,
      eventState: event.state,
      attemptCount: event.attemptCount,
      receivedAt: event.receivedAt,
      processedAt: event.processedAt,
      lastError: event.lastError,
      projectionVersion: event.projectionVersion,
      store: event.store,
      spuName: record?.spuName || "",
      skcName: record?.skcName || "",
      skuCodes: record?.skuCodes || [],
      documentSn: record?.documentSn || "",
      version: record?.version || "",
      auditTime: record?.auditTime || "",
      auditStateLabel: record?.auditStateLabel || "",
      failedReasons: record?.failedReasons || [],
    }));
  });
}

function AuditEventCenter({ store }) {
  const [items, setItems] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const supplierId = store?.supplierId || store?.id || "";

  const loadEvents = async () => {
    if (!supplierId) {
      setItems([]);
      setGeneratedAt(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await requestLocalApi(
        `/api/cloud/webhook-audits?supplierId=${encodeURIComponent(
          supplierId,
        )}&limit=100`,
      );
      setItems(flattenAuditEvents(result.items));
      setGeneratedAt(result.generatedAt || new Date().toISOString());
    } catch (requestError) {
      setItems([]);
      setError(formatConnectionError(requestError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [supplierId]);

  const counts = {
    total: items.length,
    pending: items.filter((item) => item.auditStateLabel === "pending").length,
    passed: items.filter((item) => item.auditStateLabel === "passed").length,
    failed: items.filter(
      (item) =>
        item.auditStateLabel === "failed" || item.eventState === "failed",
    ).length,
  };
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = items.filter((item) => {
    const matchesFilter =
      activeFilter === "all" ||
      item.auditStateLabel === activeFilter ||
      (activeFilter === "failed" && item.eventState === "failed");
    const searchable = [
      item.spuName,
      item.skcName,
      item.documentSn,
      ...item.skuCodes,
    ]
      .join(" ")
      .toLowerCase();
    return matchesFilter && (!normalizedQuery || searchable.includes(normalizedQuery));
  });
  const filters = [
    { id: "all", label: "全部", count: counts.total },
    { id: "pending", label: "待审核", count: counts.pending },
    { id: "passed", label: "审核通过", count: counts.passed },
    { id: "failed", label: "审核失败", count: counts.failed },
    {
      id: "withdrawn",
      label: "已撤回",
      count: items.filter((item) => item.auditStateLabel === "withdrawn").length,
    },
  ];

  return (
    <div className="stack">
      <div className="audit-safety-banner">
        <ShieldCheck size={18} />
        <span>
          <strong>只读审核事件中心</strong>
          仅展示 SHEIN Webhook 的标准化结果，不返回原始密文、签名或密钥，也不执行商品写入。
        </span>
      </div>
      <div className="compliance-summary audit-event-summary">
        <div><strong>{counts.total}</strong><span>审核记录</span></div>
        <div><strong className="text-warning">{counts.pending}</strong><span>待审核</span></div>
        <div><strong className="text-success">{counts.passed}</strong><span>审核通过</span></div>
        <div><strong className="text-danger">{counts.failed}</strong><span>审核/处理失败</span></div>
        <div className="compliance-summary__note">
          <Clock3 size={18} />
          <span>
            {generatedAt
              ? `云端读取于 ${formatAuditDate(generatedAt)}`
              : "等待读取云端正式审核事件"}
          </span>
        </div>
      </div>
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            value={query}
            placeholder="搜索 SPU、SKC、SKU 或工单号"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          className="button button--primary"
          type="button"
          disabled={!supplierId || loading}
          onClick={loadEvents}
        >
          <RefreshCw size={16} className={loading ? "spin" : ""} />
          {loading ? "正在读取" : "刷新审核事件"}
        </button>
      </div>
      <div className="filter-tabs">
        {filters.map((filter) => (
          <button
            className={activeFilter === filter.id ? "is-active" : ""}
            key={filter.id}
            type="button"
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label} <span>{filter.count}</span>
          </button>
        ))}
      </div>
      {error && (
        <div className="inline-alert inline-alert--amber">
          <AlertCircle size={17} />
          <span>{error}</span>
        </div>
      )}
      <section className="section-block table-section">
        <div className="audit-event-table">
          <div className="audit-event-table__head">
            <span>商品标识</span>
            <span>审核状态</span>
            <span>失败原因</span>
            <span>工单 / 版本</span>
            <span>平台审核时间</span>
            <span>接收 / 处理时间</span>
          </div>
          {!store && (
            <DataEmptyState
              icon={Store}
              title="尚未选择授权店铺"
              description="请先在“店铺与系统”连接 SHEIN 店铺。"
            />
          )}
          {store && !loading && !error && filtered.length === 0 && (
            <DataEmptyState
              icon={ClipboardCheck}
              title={items.length ? "当前筛选条件下没有审核事件" : "暂无正式审核事件"}
              description={
                items.length
                  ? "尝试切换筛选条件或清空搜索内容。"
                  : "正式事件订阅保持关闭时这里为空；开启单事件灰度后，只展示当前租户和店铺的标准化结果。"
              }
            />
          )}
          {filtered.map((item) => {
            const auditLabel =
              auditStateLabels[item.auditStateLabel] ||
              eventStateLabels[item.eventState] ||
              "状态未知";
            const reasons = item.failedReasons
              .map((reason) =>
                [reason.language, reason.content].filter(Boolean).join("："),
              )
              .filter(Boolean);
            return (
              <div className="audit-event-table__row" key={item.id}>
                <span className="two-line-cell">
                  <strong>{item.skcName || item.spuName || "未返回商品编码"}</strong>
                  <small>
                    {item.spuName && item.skcName
                      ? `SPU ${item.spuName}`
                      : item.skuCodes.length
                        ? `SKU ${item.skuCodes.join("、")}`
                        : `事件 ${item.eventId}`}
                  </small>
                </span>
                <StatusChip value={auditLabel} />
                <span className="audit-reason-cell">
                  {reasons.length ? (
                    reasons.map((reason) => <small key={reason}>{reason}</small>)
                  ) : item.lastError?.message ? (
                    <small className="text-danger">{item.lastError.message}</small>
                  ) : (
                    <small>—</small>
                  )}
                </span>
                <span className="two-line-cell">
                  <strong>{item.documentSn || "—"}</strong>
                  <small>
                    {item.version ? `版本 ${item.version}` : item.projectionVersion || "未生成投影"}
                  </small>
                </span>
                <span>{formatAuditDate(item.auditTime)}</span>
                <span className="two-line-cell">
                  <strong>{formatAuditDate(item.receivedAt)}</strong>
                  <small>
                    {item.processedAt
                      ? `处理于 ${formatAuditDate(item.processedAt)}`
                      : `${eventStateLabels[item.eventState] || item.eventState} · 尝试 ${item.attemptCount}`}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ComplianceCenter({
  rows,
  syncedAt,
  syncing,
  job,
  onSync,
  onRetryFailed,
  onInspect,
}) {
  const [query, setQuery] = useState("");
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const filtered = rows.filter((row) => {
    const matchesQuery =
      row.skc.toLowerCase().includes(query.toLowerCase()) ||
      row.name.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (!abnormalOnly || row.state !== "通过");
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedRows = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const passed = rows.filter((row) =>
    [
      row.certificate,
      row.agency,
      row.warning,
      row.platformOnly,
      row.packagePhoto,
      row.bodyPhoto,
    ]
      .every((value) => ["通过", "无需"].includes(value)),
  ).length;
  const failed = rows.filter((row) =>
    [
      row.certificate,
      row.agency,
      row.warning,
      row.platformOnly,
      row.packagePhoto,
      row.bodyPhoto,
    ]
      .some((value) => ["失败", "已失效"].includes(value)),
  ).length;
  return (
    <div className="stack">
      <div className="compliance-summary">
        <div><strong>{rows.length}</strong><span>全部SKC</span></div>
        <div><strong className="text-success">{passed}</strong><span>合规通过</span></div>
        <div><strong className="text-warning">{rows.length - passed - failed}</strong><span>待补充/待审</span></div>
        <div><strong className="text-danger">{failed}</strong><span>失败或失效</span></div>
        <div className="compliance-summary__note">
          <ShieldCheck size={18} />
          <span>
            {syncedAt
              ? `真实接口同步于 ${new Date(syncedAt).toLocaleString("zh-CN", {
                  hour12: false,
                })}`
              : "尚未同步真实合规数据"}
          </span>
        </div>
      </div>
      {job?.state === "running" && (
        <div className="compliance-sync-progress">
          <div className="compliance-sync-progress__copy">
            <span>
              <LoaderCircle className="spin" size={17} />
              <strong>正在后台同步全店合规</strong>
            </span>
            <span>
              {job.processed} / {job.total} 个 SKC · {job.completedBatches} /{" "}
              {job.batchCount} 批
            </span>
          </div>
          <div
            className="compliance-sync-progress__track"
            role="progressbar"
            aria-label="全店合规同步进度"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={job.progress || 0}
          >
            <i style={{ width: `${job.progress || 0}%` }} />
          </div>
          <small>每批完成即保存，本页可继续搜索和查看已同步记录。</small>
        </div>
      )}
      {job &&
        ["completed_with_errors", "failed"].includes(job.state) && (
          <div className="inline-alert inline-alert--amber compliance-retry-alert">
            <AlertCircle size={17} />
            <span>
              {job.error || "部分合规记录同步失败"}，已成功的数据已保留，可重新同步补齐。
            </span>
            {job.failedSkcNames?.length > 0 && (
              <button
                className="button button--secondary"
                type="button"
                disabled={syncing}
                onClick={onRetryFailed}
              >
                <RotateCcw size={15} />
                仅重试 {job.failedSkcNames.length} 个失败项
              </button>
            )}
          </div>
        )}
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            value={query}
            placeholder="搜索 SKC 或商品名称"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <div className="toolbar__group">
          <button
            className={`button button--secondary ${abnormalOnly ? "is-active" : ""}`}
            type="button"
            onClick={() => {
              setAbnormalOnly((current) => !current);
              setPage(1);
            }}
          >
            <Filter size={16} /> 仅看异常
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={syncing}
            onClick={onSync}
          >
            <RefreshCw size={16} className={syncing ? "spin" : ""} />
            {syncing ? "正在同步" : syncedAt ? "重新同步" : "同步合规数据"}
          </button>
        </div>
      </div>
      <section className="section-block table-section">
        <div className="compliance-table">
          <div className="compliance-table__head">
            <input aria-label="全选合规记录" type="checkbox" />
            <span>商品 / SKC</span>
            <span>资质证书</span>
            <span>代理公司</span>
            <span>警告语</span>
            <span>后台合规项</span>
            <span>包装实拍图</span>
            <span>本体实拍图</span>
            <span />
          </div>
          {filtered.length === 0 && (
            <DataEmptyState
              icon={ShieldCheck}
              title="暂无真实合规记录"
              description={
                syncedAt
                  ? "当前筛选条件下没有合规记录。"
                  : "点击“同步合规数据”，读取当前店铺的合规要求与实拍图要求。"
              }
            />
          )}
          {pagedRows.map((row) => (
            <div className="compliance-table__row" key={row.skc}>
              <input aria-label={`选择 ${row.skc}`} type="checkbox" />
              <span className="two-line-cell">
                <strong>{row.name}</strong>
                <small>{row.skc}</small>
              </span>
              <StatusChip value={row.certificate} />
              <StatusChip value={row.agency} />
              <StatusChip value={row.warning} />
              <StatusChip value={row.platformOnly || "无需"} />
              <StatusChip value={row.packagePhoto} />
              <StatusChip value={row.bodyPhoto} />
              <button
                className="icon-button icon-button--small"
                type="button"
                title="处理合规"
                onClick={() => onInspect({ ...row, type: "compliance" })}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          ))}
        </div>
        <TableFooter
          count={pagedRows.length}
          total={filtered.length}
          page={currentPage}
          pageCount={pageCount}
          onPageChange={setPage}
        />
      </section>
    </div>
  );
}

function TemplateLibrary({
  type,
  extraTemplates = [],
  loading = false,
  onCreate,
  onIdentify,
  onInspect,
  onEdit,
  onDelete,
  onUse,
}) {
  const isProduct = type === "product";
  const templates = [...extraTemplates];
  return (
    <div className="stack">
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} />
          <input placeholder={`搜索${isProduct ? "商品" : "合规"}模板`} />
        </label>
        <div className="toolbar__group">
          <button className="button button--secondary" type="button" onClick={onIdentify}>
            <Upload size={16} /> 从SKC识别
          </button>
          <button className="button button--primary" type="button" onClick={onCreate}>
            <Library size={16} /> 新建模板
          </button>
        </div>
      </div>
      <section className="section-block table-section">
        <div className="template-table">
          <div className="template-table__head">
            <span>模板名称</span>
            <span>适用范围</span>
            <span>模板内容</span>
            <span>使用次数</span>
            <span>最后更新</span>
            <span>状态</span>
            <span />
          </div>
          {templates.map((template) => (
            <div className="template-table__row" key={template.name}>
              <span className="template-name">
                <span className="template-name__icon">
                  {isProduct ? <ShoppingBag size={17} /> : <ShieldCheck size={17} />}
                </span>
                <span>
                  <strong>{template.name}</strong>
                  <small>
                    版本 {template.version || 1} · {template.source || "自定义模板"}
                  </small>
                </span>
              </span>
              <span>{template.scope}</span>
              <span>{template.content}</span>
              <span>{template.usage}</span>
              <span>{template.updated}</span>
              <StatusChip value={template.status || "待接口校验"} />
              <span className="template-actions">
                <button
                  className="icon-button icon-button--small"
                  type="button"
                  title="编辑模板"
                  onClick={() => onEdit(template)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() =>
                    onUse({
                      ...template,
                      type: "template",
                      templateType: type,
                    })
                  }
                >
                  {isProduct ? <Send size={14} /> : <ShieldCheck size={14} />}
                  {isProduct ? "用此发品" : "应用模板"}
                </button>
                <button
                  className="icon-button icon-button--small"
                  type="button"
                  title="查看模板"
                  onClick={() =>
                    onInspect({
                      ...template,
                      type: "template",
                      templateType: type,
                    })
                  }
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  className="icon-button icon-button--small icon-button--danger"
                  type="button"
                  title="删除模板"
                  onClick={() => onDelete(template)}
                >
                  <Trash2 size={15} />
                </button>
              </span>
            </div>
          ))}
          {!loading && templates.length === 0 && (
            <div className="template-table__empty">
              <Database size={20} />
              <strong>暂无已校验模板</strong>
              <span>新建模板并成功读取当前店铺SHEIN接口数据后，模板才会出现在这里。</span>
            </div>
          )}
          {loading && (
            <div className="template-table__empty">
              <LoaderCircle className="spin" size={20} />
              <strong>正在读取本地模板</strong>
              <span>模板按当前授权店铺隔离加载。</span>
            </div>
          )}
        </div>
        <TableFooter count={templates.length} total={templates.length} />
      </section>
    </div>
  );
}

function TaskPage({ tasks, onInspect }) {
  const running = tasks.filter((task) => task.state === "运行中").length;
  const completed = tasks.filter((task) => task.state === "已完成").length;
  const needsAttention = tasks.filter((task) => task.failed > 0).length;
  return (
    <div className="stack">
      <div className="filter-tabs">
        <button className="is-active" type="button">全部 <span>{tasks.length}</span></button>
        <button type="button">运行中 <span>{running}</span></button>
        <button type="button">已完成 <span>{completed}</span></button>
        <button type="button">需要处理 <span>{needsAttention}</span></button>
      </div>
      <section className="section-block table-section">
        <div className="task-table">
          <div className="task-table__head">
            <span>任务</span>
            <span>进度</span>
            <span>成功</span>
            <span>失败</span>
            <span>状态</span>
            <span />
          </div>
          {tasks.length === 0 && (
            <DataEmptyState
              icon={ListChecks}
              title="暂无真实批量任务"
              description="批量接口接入并实际提交后，任务进度和失败项会显示在这里。"
            />
          )}
          {tasks.map((task) => (
            <div className="task-table__row" key={task.id}>
              <span className="two-line-cell">
                <strong>{task.title}</strong>
                <small>{task.id} · {task.detail}</small>
              </span>
              <span className="progress-cell">
                <span><i style={{ width: `${task.progress}%` }} /></span>
                <strong>{task.progress}%</strong>
              </span>
              <span className="text-success">{task.success}</span>
              <span className={task.failed ? "text-danger" : ""}>{task.failed}</span>
              <StatusChip value={task.state} />
              <button
                className="icon-button icon-button--small"
                type="button"
                title="查看任务"
                onClick={() => onInspect({ ...task, type: "task" })}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

async function requestLocalApi(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `本地服务请求失败 (${response.status})`);
    error.code = payload.code;
    error.traceId = payload.traceId;
    throw error;
  }
  return payload;
}

function ConnectionSettings({ onStoresChanged }) {
  const [health, setHealth] = useState(null);
  const [cloudSession, setCloudSession] = useState(null);
  const [connectedStores, setConnectedStores] = useState([]);
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [deviceName, setDeviceName] = useState(() => {
    const platform = window.navigator.userAgentData?.platform
      || window.navigator.platform;
    return platform ? `${platform} 工作电脑` : "当前工作电脑";
  });
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [notice, setNotice] = useState(null);
  const [testResults, setTestResults] = useState({});

  const loadConnectionState = async () => {
    const [healthResult, storesResult] = await Promise.all([
      requestLocalApi("/api/health"),
      requestLocalApi("/api/shein/stores"),
    ]);
    const cloudResult = healthResult.localDirectAuthEnabled
      ? {
          configured: false,
          connected: false,
          tenant: null,
          device: null,
          expiresAt: null,
          cloudBaseUrl: "",
        }
      : await requestLocalApi("/api/cloud/session");
    setHealth(healthResult);
    setConnectedStores(storesResult.stores || []);
    setCloudSession(cloudResult);
    return {
      health: healthResult,
      stores: storesResult.stores || [],
    };
  };

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const connectionState = await loadConnectionState();
        const localDirectAuth = connectionState.health.localDirectAuthEnabled;
        const params = new URLSearchParams(window.location.search);
        const authorized = params.get("sheinAuthorized");
        const authorizationError = params.get("sheinAuthError");
        if (authorized || authorizationError) {
          window.history.replaceState({}, "", window.location.pathname);
          if (authorizationError) {
            throw new Error(authorizationError);
          }
          if (!cancelled) {
            setNotice({
              type: "success",
              text: localDirectAuth
                ? `${params.get("storeLabel") || "SHEIN 店铺"} 已授权，凭证已保存到本机加密凭证库`
                : `${params.get("storeLabel") || "SHEIN 店铺"} 已授权，当前电脑已自动连接云端`,
            });
            await loadConnectionState();
            await onStoresChanged?.();
          }
          return;
        }
        const tempToken = params.get("tempToken");
        const state = params.get("state");
        if (!tempToken && !state) return;
        if (!tempToken || !state) {
          throw new Error("SHEIN 授权回调缺少 tempToken 或 state");
        }

        setAction("exchange");
        const result = await requestLocalApi(
          localDirectAuth
            ? "/api/shein/auth/exchange"
            : "/api/shein/cloud-auth/complete",
          {
            method: "POST",
            body: JSON.stringify(
              localDirectAuth
                ? { tempToken, state }
                : { tempToken, state, deviceName },
            ),
          },
        );
        if (cancelled) return;
        window.history.replaceState({}, "", window.location.pathname);
        setCloudSession(result.cloud || null);
        setNotice({
          type: "success",
          text: localDirectAuth
            ? `${result.store.label} 已授权，凭证已保存到本机加密凭证库`
            : `${result.store.label} 已授权，当前电脑已自动连接云端`,
        });
        await loadConnectionState();
        await onStoresChanged?.();
      } catch (error) {
        if (!cancelled) {
          const params = new URLSearchParams(window.location.search);
          if (params.has("tempToken") || params.has("state")) {
            window.history.replaceState({}, "", window.location.pathname);
          }
          setNotice({
            type: "error",
            text: formatConnectionError(error),
          });
        }
      } finally {
        if (!cancelled) {
          setAction("");
          setLoading(false);
        }
      }
    };
    initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  const startAuthorization = async () => {
    setAction("authorize");
    setNotice(null);
    try {
      const localDirectAuth = Boolean(health?.localDirectAuthEnabled);
      const result = await requestLocalApi(
        localDirectAuth ? "/api/shein/auth/url" : "/api/shein/cloud-auth/start",
        {
        method: "POST",
          body: JSON.stringify(
            localDirectAuth ? {} : { deviceName: deviceName.trim() },
          ),
        },
      );
      window.location.assign(result.url);
    } catch (error) {
      setNotice({ type: "error", text: formatConnectionError(error) });
      setAction("");
    }
  };

  const connectCloud = async () => {
    const code = enrollmentCode.trim();
    const name = deviceName.trim();
    if (!code || !name) {
      setNotice({
        type: "error",
        text: "请输入一次性设备连接码和当前电脑名称",
      });
      return;
    }
    setAction("cloud:enroll");
    setNotice(null);
    try {
      const result = await requestLocalApi("/api/cloud/enroll", {
        method: "POST",
        body: JSON.stringify({ code, deviceName: name }),
      });
      setCloudSession(result);
      setEnrollmentCode("");
      setNotice({
        type: "success",
        text: `当前电脑已连接到 ${result.tenant?.name || "云端工作空间"}`,
      });
    } catch (error) {
      setNotice({ type: "error", text: formatConnectionError(error) });
    } finally {
      setAction("");
    }
  };

  const verifyCloud = async () => {
    setAction("cloud:verify");
    setNotice(null);
    try {
      const result = await requestLocalApi("/api/cloud/session/verify", {
        method: "POST",
        body: "{}",
      });
      setCloudSession(result);
      setNotice({
        type: "success",
        text: "云端设备身份有效，安全连接正常",
      });
    } catch (error) {
      await loadConnectionState().catch(() => {});
      setNotice({ type: "error", text: formatConnectionError(error) });
    } finally {
      setAction("");
    }
  };

  const disconnectCloud = async () => {
    if (!window.confirm("确认断开当前电脑与云端工作空间的连接？")) return;
    setAction("cloud:disconnect");
    setNotice(null);
    try {
      const result = await requestLocalApi("/api/cloud/session", {
        method: "DELETE",
      });
      setCloudSession(result);
      setNotice({
        type: "success",
        text: "当前电脑已与云端工作空间断开",
      });
    } catch (error) {
      setNotice({ type: "error", text: formatConnectionError(error) });
    } finally {
      setAction("");
    }
  };

  const testStore = async (store) => {
    setAction(`test:${store.id}`);
    setNotice(null);
    try {
      const result = await requestLocalApi(
        `/api/shein/stores/${encodeURIComponent(store.id)}/test`,
        { method: "POST", body: "{}" },
      );
      setTestResults((current) => ({ ...current, [store.id]: result }));
      setNotice({
        type: "success",
        text: `${store.label} 已通过真实 SHEIN 只读接口验签`,
      });
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [store.id]: { error: formatConnectionError(error) },
      }));
      setNotice({ type: "error", text: formatConnectionError(error) });
    } finally {
      setAction("");
    }
  };

  const disconnectStore = async (store) => {
    setAction(`remove:${store.id}`);
    setNotice(null);
    try {
      await requestLocalApi(`/api/shein/stores/${encodeURIComponent(store.id)}`, {
        method: "DELETE",
      });
      await loadConnectionState();
      await onStoresChanged?.();
      setNotice({
        type: "success",
        text: `${store.label} 的凭证已从本机加密凭证库移除`,
      });
    } catch (error) {
      setNotice({ type: "error", text: formatConnectionError(error) });
    } finally {
      setAction("");
    }
  };

  if (loading && !health) {
    return (
      <section className="connection-loading">
        <LoaderCircle className="spin" size={22} />
        正在检查本地安全代理
      </section>
    );
  }

  if (!health) {
    return (
      <section className="connection-empty">
        <AlertCircle size={26} />
        <h2>本地安全代理未启动</h2>
        <p>请通过项目的统一开发命令启动网页与代理服务。</p>
        <code>npm run dev</code>
      </section>
    );
  }

  const localDirectAuth = Boolean(health.localDirectAuthEnabled);

  return (
    <div className="connection-page">
      {notice && (
        <div className={`connection-notice connection-notice--${notice.type}`}>
          {notice.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{notice.text}</span>
        </div>
      )}

      {localDirectAuth && (
        <section className="cloud-device-panel">
          <div className="cloud-device-panel__head">
            <div className="cloud-device-panel__title">
              <span className="cloud-device-panel__icon">
                <ShieldCheck size={20} />
              </span>
              <div>
                <span className="eyebrow">LOCAL DIRECT CONNECTION</span>
                <h2>本机直连授权</h2>
                <p>授权交换、凭证加密保存和只读同步均由本机 Node 代理完成，浏览器不接触密钥。</p>
              </div>
            </div>
            <span className="connection-state is-ready">
              <i />
              本机直连可用
            </span>
          </div>
          <dl className="cloud-device-session__facts">
            <div>
              <dt>授权交换</dt>
              <dd>本机 /api/shein/auth/exchange</dd>
            </div>
            <div>
              <dt>经营同步</dt>
              <dd>本机调用 SHEIN 只读接口</dd>
            </div>
            <div>
              <dt>凭证存储</dt>
              <dd>本机 AES-256-GCM 加密文件</dd>
            </div>
            <div>
              <dt>发布权限</dt>
              <dd>保持关闭</dd>
            </div>
          </dl>
        </section>
      )}

      {!localDirectAuth && (
        <section className="cloud-device-panel">
        <div className="cloud-device-panel__head">
          <div className="cloud-device-panel__title">
            <span className="cloud-device-panel__icon">
              <Database size={20} />
            </span>
            <div>
              <span className="eyebrow">SECURE CLOUD WORKSPACE</span>
              <h2>云端设备连接</h2>
              <p>云端保存结构化业务数据和设备权限；图片仍由本机直接上传 SHEIN。</p>
            </div>
          </div>
          <span className={`connection-state ${cloudSession?.connected ? "is-ready" : ""}`}>
            <i />
            {cloudSession?.connected ? "设备已连接" : "设备未连接"}
          </span>
        </div>

        {cloudSession?.connected ? (
          <div className="cloud-device-session">
            <dl className="cloud-device-session__facts">
              <div>
                <dt>工作空间</dt>
                <dd>{cloudSession.tenant?.name || "未命名工作空间"}</dd>
              </div>
              <div>
                <dt>当前设备</dt>
                <dd>{cloudSession.device?.name || "当前工作电脑"}</dd>
              </div>
              <div>
                <dt>云端地址</dt>
                <dd>{cloudSession.cloudBaseUrl}</dd>
              </div>
              <div>
                <dt>会话有效期</dt>
                <dd>
                  {cloudSession.expiresAt
                    ? new Date(cloudSession.expiresAt).toLocaleString("zh-CN", { hour12: false })
                    : "由云端策略管理"}
                </dd>
              </div>
            </dl>
            <div className="cloud-device-session__actions">
              <button
                className="button button--secondary"
                type="button"
                disabled={Boolean(action)}
                onClick={verifyCloud}
              >
                {action === "cloud:verify" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <RefreshCw size={16} />
                )}
                验证连接
              </button>
              <button
                className="button button--danger"
                type="button"
                disabled={Boolean(action)}
                onClick={disconnectCloud}
              >
                {action === "cloud:disconnect" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <X size={16} />
                )}
                断开设备
              </button>
            </div>
          </div>
        ) : (
          <div className="cloud-device-enrollment">
            <label>
              <span>当前电脑名称</span>
              <input
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                placeholder="例如：运营部 MacBook"
                maxLength={120}
              />
            </label>
            <p>
              点击下方“授权店铺并连接当前电脑”后，会通过 SHEIN 店铺授权自动创建工作空间和设备会话。
            </p>
            <details>
              <summary>管理员备用连接</summary>
              <div className="cloud-device-enrollment">
                <label>
                  <span>一次性设备连接码</span>
                  <input
                    value={enrollmentCode}
                    onChange={(event) => setEnrollmentCode(event.target.value)}
                    placeholder="在云端生成后粘贴到这里"
                    autoComplete="off"
                    spellCheck="false"
                  />
                </label>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={!cloudSession?.configured || Boolean(action)}
                  onClick={connectCloud}
                >
                  {action === "cloud:enroll" ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Link2 size={16} />
                  )}
                  使用连接码
                </button>
                <p>
                  连接码仅可使用一次，仅用于管理员恢复或追加设备。
                </p>
              </div>
            </details>
          </div>
        )}
        </section>
      )}

      <section className="connection-hero">
        <div className="connection-hero__icon"><ShieldCheck size={26} /></div>
        <div className="connection-hero__copy">
          <span className="eyebrow">SHEIN OPEN PLATFORM</span>
          <h2>真实接口连接</h2>
          <p>
            {localDirectAuth
              ? "本机完成应用级换密钥并加密保存店铺凭证；经营数据通过本机代理读取。"
              : "云端完成应用级换密钥，本地代理加密保存店铺凭证；浏览器不接触任何密钥。"}
          </p>
        </div>
        <div className="connection-hero__actions">
          <span className={`connection-state ${health.configured ? "is-ready" : ""}`}>
            <i />
            {localDirectAuth
              ? health.configured
                ? "本机授权配置可用"
                : "等待本机应用配置"
              : cloudSession?.configured
                ? "云端授权可用"
                : "等待云端服务"}
          </span>
          <button
            className="button button--primary"
            type="button"
            disabled={
              (localDirectAuth ? !health.configured : !cloudSession?.configured) ||
              (!localDirectAuth && !deviceName.trim()) ||
              Boolean(action)
            }
            onClick={startAuthorization}
          >
            {action === "authorize" ? <LoaderCircle className="spin" size={17} /> : <Link2 size={17} />}
            授权店铺并连接当前电脑
          </button>
        </div>
      </section>

      <section className="connection-grid">
        <div className="connection-panel">
          <div className="connection-panel__head">
            <div>
              <span className="eyebrow">运行环境</span>
              <h3>安全代理</h3>
            </div>
            <Database size={20} />
          </div>
          <dl className="connection-facts">
            <div><dt>业务环境</dt><dd>全托管生产环境</dd></div>
            <div><dt>API 网关</dt><dd>{health.apiBaseUrl}</dd></div>
            <div><dt>授权域名</dt><dd>{health.authorizationHost}</dd></div>
            <div><dt>回调地址</dt><dd>{health.redirectUrl}</dd></div>
            <div>
              <dt>凭证存储</dt>
              <dd>
                {health.credentialsStorage === "encrypted-file"
                  ? "本机 AES-256-GCM 加密文件"
                  : "本地代理安全存储"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="connection-panel">
          <div className="connection-panel__head">
            <div>
              <span className="eyebrow">连接前检查</span>
              <h3>应用配置</h3>
            </div>
            <Settings size={20} />
          </div>
          <div className="connection-checklist">
            <ConnectionCheck
              done={localDirectAuth ? health.configured : cloudSession?.configured}
              title={localDirectAuth ? "本机授权服务" : "云端授权服务"}
              detail={
                localDirectAuth
                  ? health.configured
                    ? "SHEIN_APP_ID 与 SHEIN_APP_SECRET 已配置"
                    : "请在本地 .env 配置应用凭证"
                  : cloudSession?.configured
                    ? cloudSession.cloudBaseUrl
                    : "等待本地代理连接云端控制服务"
              }
            />
            <ConnectionCheck
              done={health.redirectUrl.startsWith("https://")}
              title="正式回调地址"
              detail={
                health.redirectUrl.startsWith("https://")
                  ? health.redirectUrl
                  : "本地联调地址可用；提交 Webhook/商业发布前换为 HTTPS"
              }
              optional
            />
            <ConnectionCheck
              done={connectedStores.length > 0}
              title="店铺授权"
              detail={
                connectedStores.length
                  ? `已安全保存 ${connectedStores.length} 家店铺凭证`
                  : "由商家主账号完成授权"
              }
            />
          </div>
        </div>
      </section>

      <section className="connected-stores">
        <div className="section-heading">
          <div>
            <span className="eyebrow">AUTHORIZED STORES</span>
            <h2>已连接店铺</h2>
            <p>连通测试调用文档中的只读接口 `/open-api/goods/query-category-tree`。</p>
          </div>
          <span className="count-badge">{connectedStores.length} 家</span>
        </div>

        {connectedStores.length === 0 ? (
          <div className="connected-stores__empty">
            <Store size={24} />
            <strong>还没有真实店铺凭证</strong>
            <p>配置应用凭证后点击“授权新店铺”，每家店铺会保存自己独立的密钥。</p>
          </div>
        ) : (
          <div className="connected-store-list">
            {connectedStores.map((store) => {
              const result = testResults[store.id];
              return (
                <article className="connected-store-row" key={store.id}>
                  <span className="store-avatar">{String(store.label).slice(0, 1)}</span>
                  <div className="connected-store-row__identity">
                    <strong>{store.label}</strong>
                    <span>
                      Supplier ID {store.supplierId || "待查询"} · OpenKey {store.openKeyIdMasked}
                    </span>
                  </div>
                  <div className="connected-store-row__meta">
                    <span>{store.businessMode}</span>
                    <small>{store.source === "environment" ? "环境变量接入" : "商家授权接入"}</small>
                  </div>
                  <div className="connected-store-row__result">
                    {!result && <span className="text-muted">尚未测试</span>}
                    {result?.ok && (
                      <>
                        <span className="text-success">验签通过</span>
                        <small>
                          {result.categoryCount} 个类目 · {result.diagnostics.durationMs}ms
                        </small>
                      </>
                    )}
                    {result?.error && <span className="text-danger">{result.error}</span>}
                  </div>
                  <div className="connected-store-row__actions">
                    <button
                      className="button button--secondary"
                      type="button"
                      disabled={Boolean(action)}
                      onClick={() => testStore(store)}
                    >
                      {action === `test:${store.id}` ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <RefreshCw size={16} />
                      )}
                      测试连接
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="移除本机凭证"
                      disabled={Boolean(action)}
                      onClick={() => disconnectStore(store)}
                    >
                      <X size={17} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <DirectUploadValidation stores={connectedStores} />
      <PriceProofUploadValidation stores={connectedStores} />
    </div>
  );
}

const uploadValidationTypes = [
  { value: "1", type: "main", label: "主图 · image_type=1" },
  { value: "2", type: "detail", label: "细节图 · image_type=2" },
  { value: "5", type: "square", label: "方形图 · image_type=5" },
  { value: "6", type: "swatch", label: "色块图 · image_type=6" },
  { value: "7", type: "description", label: "详情图 · image_type=7" },
];

function DirectUploadValidation({ stores }) {
  const [storeId, setStoreId] = useState("");
  const [imageType, setImageType] = useState("1");
  const [fileState, setFileState] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!stores.some((store) => store.id === storeId)) {
      setStoreId(stores[0]?.id || "");
    }
  }, [stores, storeId]);

  const selectFile = async (file) => {
    setResult(null);
    if (!file) {
      setFileState(null);
      return;
    }
    const dimensions = await readImageDimensions(file).catch(() => ({
      width: 0,
      height: 0,
    }));
    const selectedType =
      uploadValidationTypes.find((item) => item.value === imageType) ||
      uploadValidationTypes[0];
    setFileState({
      file,
      ...dimensions,
      issues: validatePublishImage(
        file,
        selectedType.type,
        dimensions.width,
        dimensions.height,
      ),
    });
  };

  const changeImageType = (value) => {
    setImageType(value);
    setResult(null);
    setFileState((current) => {
      if (!current) return current;
      const selectedType =
        uploadValidationTypes.find((item) => item.value === value) ||
        uploadValidationTypes[0];
      return {
        ...current,
        issues: validatePublishImage(
          current.file,
          selectedType.type,
          current.width,
          current.height,
        ),
      };
    });
  };

  const upload = async () => {
    if (!storeId || !fileState?.file || fileState.issues.length) return;
    setUploading(true);
    setResult(null);
    try {
      const response = await fetch(
        `/api/local/shein/stores/${encodeURIComponent(
          storeId,
        )}/upload-image?imageType=${encodeURIComponent(imageType)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": fileState.file.type,
            "x-file-name": encodeURIComponent(fileState.file.name),
          },
          body: fileState.file,
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(
          payload.message || `本地直传验证失败 (${response.status})`,
        );
        error.code = payload.code;
        error.traceId = payload.traceId;
        throw error;
      }
      setResult({ type: "success", ...payload });
    } catch (error) {
      setResult({ type: "error", message: formatConnectionError(error) });
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="direct-upload-validation">
      <div className="section-heading">
        <div>
          <span className="eyebrow">DESKTOP DIRECT UPLOAD</span>
          <h2>本机图片直传验证</h2>
          <p>
            文件只经过当前电脑的本地代理并直接发送至SHEIN，云端架构仅提供短时签名。
          </p>
        </div>
        <span className="status-chip status-chip--info">不会发布商品</span>
      </div>
      <div className="direct-upload-validation__body">
        <div className="direct-upload-fields">
          <label className="form-field">
            <span>验证店铺</span>
            <select
              value={storeId}
              disabled={!stores.length || uploading}
              onChange={(event) => setStoreId(event.target.value)}
            >
              {!stores.length && <option value="">请先授权店铺</option>}
              {stores.map((store) => (
                <option value={store.id} key={store.id}>
                  {store.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>图片类型</span>
            <select
              value={imageType}
              disabled={uploading}
              onChange={(event) => changeImageType(event.target.value)}
            >
              {uploadValidationTypes.map((type) => (
                <option value={type.value} key={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label className="direct-upload-file">
            <Upload size={18} />
            <span>{fileState?.file.name || "选择一张符合SHEIN规范的图片"}</span>
            <input
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              type="file"
              disabled={uploading}
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
          </label>
          <button
            className="button button--primary"
            type="button"
            disabled={
              !storeId ||
              !fileState?.file ||
              fileState.issues.length > 0 ||
              uploading
            }
            onClick={upload}
          >
            {uploading ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Send size={16} />
            )}
            {uploading ? "正在从本机上传" : "开始真实直传验证"}
          </button>
        </div>

        {fileState && (
          <div
            className={`direct-upload-file-result ${
              fileState.issues.length ? "has-error" : "is-ready"
            }`}
          >
            {fileState.issues.length ? (
              <AlertCircle size={18} />
            ) : (
              <CheckCircle2 size={18} />
            )}
            <span>
              <strong>
                {fileState.width}×{fileState.height}px ·{" "}
                {formatImageSize(fileState.file.size)}
              </strong>
              <small>
                {fileState.issues.length
                  ? fileState.issues.join("；")
                  : "本地预检通过，可以上传至SHEIN图片空间"}
              </small>
            </span>
          </div>
        )}

        {result?.type === "success" && (
          <div className="direct-upload-result">
            <span className="direct-upload-result__preview">
              <img src={result.info.image_url} alt="SHEIN返回图片" />
            </span>
            <div>
              <strong>SHEIN真实上传成功</strong>
              <span>
                {result.info.width}×{result.info.height}px ·{" "}
                {formatImageSize(result.info.size || 0)} ·{" "}
                {result.info.image_hex_type}
              </span>
              <small>
                本机直传 {result.diagnostics.durationMs}ms · TraceId{" "}
                {result.diagnostics.traceId || "未返回"} · URL
                {result.diagnostics.urlHasExpiry ? "包含有效期" : "未发现有效期参数"}
              </small>
              <a href={result.info.image_url} target="_blank" rel="noreferrer">
                查看SHEIN图片
              </a>
            </div>
          </div>
        )}

        {result?.type === "error" && (
          <div className="connection-notice connection-notice--error">
            <AlertCircle size={18} />
            <span>{result.message}</span>
          </div>
        )}
      </div>
    </section>
  );
}

const priceProofValidationTypes = [
  {
    value: "1",
    label: "议价单辅助材料 · type=1",
    detail: "仅 JPG、JPEG、PNG，最大 10MB",
    accept: ".jpg,.jpeg,.png,image/jpeg,image/png",
    mimeTypes: new Set(["image/jpeg", "image/png"]),
  },
  {
    value: "4",
    label: "建议零售价证明 · type=4",
    detail: "JPG、JPEG、PNG、PDF，最大 10MB",
    accept: ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf",
    mimeTypes: new Set(["image/jpeg", "image/png", "application/pdf"]),
  },
  {
    value: "5",
    label: "成本价涨价材料 · type=5",
    detail: "图片、PDF、CSV、XLS、XLSX，最大 10MB",
    accept:
      ".jpg,.jpeg,.png,.pdf,.csv,.xls,.xlsx,image/jpeg,image/png,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    mimeTypes: new Set([
      "image/jpeg",
      "image/png",
      "application/pdf",
      "text/csv",
      "application/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]),
  },
];

const proofMimeTypeByExtension = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function getProofFileMimeType(file) {
  if (file?.type) return file.type.toLowerCase();
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  return proofMimeTypeByExtension[extension] || "";
}

function PriceProofUploadValidation({ stores }) {
  const [storeId, setStoreId] = useState("");
  const [proofType, setProofType] = useState("4");
  const [fileState, setFileState] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!stores.some((store) => store.id === storeId)) {
      setStoreId(stores[0]?.id || "");
    }
  }, [stores, storeId]);

  const activeType =
    priceProofValidationTypes.find((item) => item.value === proofType) ||
    priceProofValidationTypes[1];

  const validateFile = (file, type = activeType) => {
    if (!file) return null;
    const mimeType = getProofFileMimeType(file);
    const issues = [];
    if (!type.mimeTypes.has(mimeType)) {
      issues.push("当前场景不支持此文件格式");
    }
    if (file.size > 10 * 1024 * 1024) {
      issues.push("文件超过 SHEIN 规定的 10MB");
    }
    return { file, mimeType, issues };
  };

  const selectFile = (file) => {
    setResult(null);
    setFileState(validateFile(file));
  };

  const changeProofType = (value) => {
    const nextType =
      priceProofValidationTypes.find((item) => item.value === value) ||
      priceProofValidationTypes[1];
    setProofType(value);
    setResult(null);
    setFileState((current) =>
      current?.file ? validateFile(current.file, nextType) : current,
    );
  };

  const upload = async () => {
    if (!storeId || !fileState?.file || fileState.issues.length) return;
    setUploading(true);
    setResult(null);
    try {
      const response = await fetch(
        `/api/local/shein/stores/${encodeURIComponent(
          storeId,
        )}/upload-price-proof?type=${encodeURIComponent(proofType)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": fileState.mimeType,
            "x-file-name": encodeURIComponent(fileState.file.name),
          },
          body: fileState.file,
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(
          payload.message || `价格证明直传失败 (${response.status})`,
        );
        error.code = payload.code;
        error.traceId = payload.traceId;
        throw error;
      }
      setResult({ type: "success", ...payload });
    } catch (error) {
      setResult({ type: "error", message: formatConnectionError(error) });
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="direct-upload-validation">
      <div className="section-heading">
        <div>
          <span className="eyebrow">PRICE PROOF DIRECT UPLOAD</span>
          <h2>价格证明文件直传验证</h2>
          <p>
            按SHEIN场景规则预检后由本机直传，返回 objectKey 与 URL
            供议价、成本价或建议零售价业务使用。
          </p>
        </div>
        <span className="status-chip status-chip--info">不会提交价格</span>
      </div>
      <div className="direct-upload-validation__body">
        <div className="direct-upload-fields">
          <label className="form-field">
            <span>验证店铺</span>
            <select
              value={storeId}
              disabled={!stores.length || uploading}
              onChange={(event) => setStoreId(event.target.value)}
            >
              {!stores.length && <option value="">请先授权店铺</option>}
              {stores.map((store) => (
                <option value={store.id} key={store.id}>
                  {store.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>材料场景</span>
            <select
              value={proofType}
              disabled={uploading}
              onChange={(event) => changeProofType(event.target.value)}
            >
              {priceProofValidationTypes.map((type) => (
                <option value={type.value} key={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            <small>{activeType.detail}</small>
          </label>
          <label className="direct-upload-file">
            <Upload size={18} />
            <span>{fileState?.file.name || "选择价格证明文件"}</span>
            <input
              accept={activeType.accept}
              type="file"
              disabled={uploading}
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
          </label>
          <button
            className="button button--primary"
            type="button"
            disabled={
              !storeId ||
              !fileState?.file ||
              fileState.issues.length > 0 ||
              uploading
            }
            onClick={upload}
          >
            {uploading ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Send size={16} />
            )}
            {uploading ? "正在从本机上传" : "开始价格证明直传"}
          </button>
        </div>

        {fileState && (
          <div
            className={`direct-upload-file-result ${
              fileState.issues.length ? "has-error" : "is-ready"
            }`}
          >
            {fileState.issues.length ? (
              <AlertCircle size={18} />
            ) : (
              <CheckCircle2 size={18} />
            )}
            <span>
              <strong>
                {fileState.file.name} · {formatImageSize(fileState.file.size)}
              </strong>
              <small>
                {fileState.issues.length
                  ? fileState.issues.join("；")
                  : `本地预检通过 · ${activeType.detail}`}
              </small>
            </span>
          </div>
        )}

        {result?.type === "success" && (
          <div className="direct-upload-result direct-upload-result--file">
            <span className="direct-upload-result__file-icon">
              <FileCheck2 size={24} />
            </span>
            <div>
              <strong>SHEIN价格证明上传成功</strong>
              <span>objectKey：{result.info.objectKey || "未返回"}</span>
              <small>
                本机直传 {result.diagnostics.durationMs}ms · TraceId{" "}
                {result.diagnostics.traceId || "未返回"} · URL
                {result.diagnostics.urlHasExpiry
                  ? `有效至 ${result.diagnostics.urlExpiresAt}`
                  : "未发现有效期参数"}
              </small>
              {result.info.url && (
                <a href={result.info.url} target="_blank" rel="noreferrer">
                  查看SHEIN文件
                </a>
              )}
            </div>
          </div>
        )}

        {result?.type === "error" && (
          <div className="connection-notice connection-notice--error">
            <AlertCircle size={18} />
            <span>{result.message}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function ConnectionCheck({ done, title, detail, optional = false }) {
  return (
    <div className="connection-check">
      <span className={`connection-check__icon ${done ? "is-done" : ""}`}>
        {done ? <Check size={15} /> : <Clock3 size={15} />}
      </span>
      <div>
        <strong>{title}{optional ? "（后续）" : ""}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function formatConnectionError(error) {
  if (error.code === "openapi00002") {
    return `${error.message}。授权已完成，但当前请求出口 IP 尚未加入 SHEIN 应用白名单${
      error.traceId ? `（TraceId ${error.traceId}）` : ""
    }`;
  }
  const suffix = [
    error.code ? `错误码 ${error.code}` : "",
    error.traceId ? `TraceId ${error.traceId}` : "",
  ].filter(Boolean).join(" · ");
  return suffix ? `${error.message}（${suffix}）` : error.message;
}

function ModulePlaceholder({ page }) {
  const [title, description] = pageMeta[page] || ["功能模块", "模块正在规划中"];
  const Icon =
    {
      pricing: Tags,
      inventory: Warehouse,
      purchase: PackageCheck,
      returns: Box,
      finance: CircleDollarSign,
      settings: Settings,
    }[page] || ClipboardCheck;
  return (
    <section className="module-placeholder">
      <div className="module-placeholder__icon"><Icon size={28} /></div>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="module-placeholder__status">
        <Clock3 size={16} />
        第一版交互框架已预留，下一轮接入完整工作流
      </div>
    </section>
  );
}

function IdentifyDialog({ store, onProductIdentified, onInspect, onClose }) {
  const [skc, setSkc] = useState("");
  const [notice, setNotice] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const start = async () => {
    const normalizedSkc = skc.trim();
    if (!normalizedSkc || loading) return;
    setLoading(true);
    setNotice(null);
    setResult(null);
    try {
      const response = await requestLocalApi(
        `/api/shein/stores/${encodeURIComponent(store.id)}/products/identify`,
        {
          method: "POST",
          body: JSON.stringify({ skc: normalizedSkc }),
        },
      );
      setResult(response.product);
      onProductIdentified?.(response.product);
      setNotice({
        type: "success",
        text: "商品归属与详情读取成功，可继续用真实类目字段建立模板。",
      });
    } catch (error) {
      setNotice({ type: "error", text: formatConnectionError(error) });
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="modal identify-modal">
        <div className="modal__head">
          <div>
            <span className="eyebrow">智能识别</span>
            <h2>从 SKC 生成商品与合规模板</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <div className="modal__body">
          <div className="recognition-intro">
            <Sparkles size={22} />
            <div>
              <strong>自动读取平台商品与合规信息</strong>
              <p>识别结果将重新校验当前店铺的商品归属、类目、属性与合规规则。</p>
            </div>
          </div>
          <label className="form-field">
            <span>当前店铺</span>
            <div className="readonly-field">
              <span className="store-avatar store-avatar--small">{store.short}</span>
              <strong>{store.name}</strong>
              <span className="status-chip status-chip--success">已授权</span>
            </div>
          </label>
          <label className="form-field">
            <span>平台 SKC 编码</span>
            <input
              value={skc}
              placeholder="输入当前店铺的 SKC 平台编码"
              onChange={(event) => {
                setSkc(event.target.value);
                setNotice(null);
                setResult(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") start();
              }}
            />
            <small>仅支持识别当前授权店铺拥有的 SKC</small>
          </label>
          {notice && (
            <div
              className={`inline-alert ${
                notice.type === "success"
                  ? "inline-alert--success"
                  : "inline-alert--red"
              }`}
            >
              {notice.type === "success" ? (
                <CheckCircle2 size={17} />
              ) : (
                <AlertCircle size={17} />
              )}
              <span>{notice.text}</span>
            </div>
          )}
          {result && (
            <div className="recognition-product-result">
              <span className="product-thumb product-thumb--large">
                {result.image ? <img src={result.image} alt="" /> : <Images size={24} />}
              </span>
              <div>
                <strong>{result.name}</strong>
                <small>{result.skc}</small>
                <p>
                  SPU {result.spu} · 类目 {result.categoryId || "未返回"} ·{" "}
                  {result.detailSummary?.skuCount ?? result.skuCount} 个 SKU
                </p>
              </div>
              <StatusChip value={result.state} />
              <button
                className="icon-button icon-button--small"
                type="button"
                title="查看商品详情"
                onClick={() => onInspect?.(result)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          <div className="documented-flow">
            {[
              ["1", "按 SKC 定位商品", "/open-api/goods/searchProduct"],
              ["2", "读取完整商品详情", "/open-api/goods/spu-info"],
              ["3", "读取类目字段", "/open-api/goods/query-attribute-template"],
              ["4", "读取合规要求", "/open-api/goods/get-certificate-rule"],
            ].map(([number, title, path]) => (
              <div key={path}>
                <i>{number}</i>
                <span><strong>{title}</strong><code>{path}</code></span>
              </div>
            ))}
          </div>
        </div>
        <div className="modal__footer">
          <button className="button button--secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={!skc.trim() || loading}
            onClick={start}
          >
            {loading ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Search size={16} />
            )}
            {loading ? "正在查询 SHEIN" : "查询平台商品"}
          </button>
        </div>
      </div>
    </div>
  );
}

const productTemplateTabs = [
  { id: "attributes", label: "商品属性" },
  { id: "sizes", label: "SKU尺寸" },
  { id: "images", label: "主图模板" },
];

const complianceTemplateTabs = [
  { id: "scope", label: "SKC合规要求" },
  { id: "certificates", label: "资质证书" },
  { id: "agencies", label: "代理公司" },
  { id: "warnings", label: "警告语" },
  { id: "photos", label: "合规实拍图" },
];

function TemplateBuilderDialog({
  store,
  type,
  initialTemplate = null,
  onClose,
  onComplete,
}) {
  const isProduct = type === "product";
  const tabs = isProduct ? productTemplateTabs : complianceTemplateTabs;
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const initialCategory = initialTemplate?.categoryId
    ? {
        categoryId: initialTemplate.categoryId,
        productTypeId: initialTemplate.productTypeId,
        name: initialTemplate.categoryName || initialTemplate.scope || "已保存类目",
        path:
          initialTemplate.categoryPath ||
          String(initialTemplate.scope || "已保存类目").split(" > "),
      }
    : null;
  const [templateName, setTemplateName] = useState(initialTemplate?.name || "");
  const [referenceSkc, setReferenceSkc] = useState(initialTemplate?.referenceSkc || "");
  const [categoryId, setCategoryId] = useState(String(initialTemplate?.categoryId || ""));
  const [productTypeId, setProductTypeId] = useState(
    String(initialTemplate?.productTypeId || ""),
  );
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [categoryInfo, setCategoryInfo] = useState(null);
  const [attributeInfo, setAttributeInfo] = useState(null);
  const [publishStandardInfo, setPublishStandardInfo] = useState(null);
  const [attributeValues, setAttributeValues] = useState(
    initialTemplate?.attributeValues || {},
  );
  const [perProductFieldIds, setPerProductFieldIds] = useState(
    initialTemplate?.perProductFieldIds || [],
  );
  const [sizeRows, setSizeRows] = useState(initialTemplate?.sizeRows || []);
  const [sizeTemplateId, setSizeTemplateId] = useState(
    initialTemplate?.sizeTemplateId || "",
  );
  const [sizeTemplateName, setSizeTemplateName] = useState(
    initialTemplate?.sizeTemplateName || "",
  );
  const [sizeTemplateShape, setSizeTemplateShape] = useState(
    initialTemplate?.sizeTemplateShape ||
      initialTemplate?.sizeRows?.[0]?.shape ||
      "rectangle",
  );
  const [packagingWorkbook, setPackagingWorkbook] = useState(
    initialTemplate?.packagingWorkbook || null,
  );
  const [mainImageTemplates, setMainImageTemplates] = useState(
    initialTemplate?.mainImageTemplates || [],
  );
  const [complianceBundle, setComplianceBundle] = useState(null);
  const [complianceAssignments, setComplianceAssignments] = useState(
    initialTemplate?.defaults || {
      certificates: [],
      agencies: [],
      warnings: [],
      photos: [],
    },
  );
  const [syncStatus, setSyncStatus] = useState(
    isProduct ? "loading" : "idle",
  );
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const editSyncStarted = useRef(false);
  const endpoint = isProduct
    ? SHEIN_TEMPLATE_ENDPOINTS.categoryTree
    : SHEIN_TEMPLATE_ENDPOINTS.complianceRequirements;
  const syncedFields = useMemo(
    () =>
      attributeInfo && productTypeId
        ? buildAttributeFields(attributeInfo, productTypeId)
        : [],
    [attributeInfo, productTypeId],
  );
  const syncValidation = validateTemplateSync({
    type,
    name: templateName,
    referenceSkc,
    categoryId,
    syncStatus,
  });
  const assignmentValidation = validateAttributeAssignments(
    syncedFields,
    attributeValues,
    perProductFieldIds,
  );
  const validation = {
    valid:
      syncValidation.valid &&
      (!isProduct || assignmentValidation.valid),
    issues: [...syncValidation.issues, ...(isProduct ? assignmentValidation.issues : [])],
  };

  const requestSync = async ({ force = false } = {}) => {
    if (!isProduct && !referenceSkc.trim()) {
      setNotice("请先填写当前店铺拥有的参照SKC");
      return;
    }
    if (!isProduct) {
      setSyncStatus("loading");
      setNotice("");
      try {
        const result = await requestLocalApi(
          `/api/shein/stores/${encodeURIComponent(store.id)}/compliance/rules`,
          {
            method: "POST",
            body: JSON.stringify({ skc: referenceSkc.trim(), force }),
          },
        );
        setComplianceBundle(result.data || null);
        setSyncStatus(result.data?.complete ? "synced" : "idle");
        const bundle = result.data || {};
        setNotice(
          result.data?.complete
            ? `已读取 ${bundle.requirements?.certificates?.length || 0} 个证书要求、${bundle.bindableAgencies?.length || 0} 个可绑定代理公司、${bundle.warningRules?.length || 0} 组手动警告语规则。`
            : `规则包读取不完整：${bundle.errors?.[0]?.message || "请稍后重新读取"}`,
        );
        return result.data?.complete === true;
      } catch (error) {
        setComplianceBundle(null);
        setSyncStatus("idle");
        setNotice(formatConnectionError(error));
        return false;
      }
    }
    setSyncStatus("loading");
    setNotice("");
    try {
      const result = await requestLocalApi(
        `/api/shein/stores/${encodeURIComponent(store.id)}/template/categories`,
        { method: "POST", body: JSON.stringify({ force }) },
      );
      setCategoryInfo(result.info);
      setSyncStatus("categories");
      setNotice(
        result.cached
          ? `已读取本店缓存的 ${result.leafCategoryCount} 个真实末级类目，不重复请求SHEIN。`
          : `已从SHEIN同步 ${result.leafCategoryCount} 个真实末级类目并保存到本地缓存。`,
      );
      return true;
    } catch (error) {
      setSyncStatus("idle");
      setNotice(formatConnectionError(error));
      return false;
    }
  };

  const selectProductCategory = async (
    category,
    { preserveValues = false, force = false } = {},
  ) => {
    setSelectedCategory(category);
    setCategoryId(String(category.categoryId));
    setProductTypeId(String(category.productTypeId));
    if (!preserveValues) {
      setAttributeValues({});
      setPerProductFieldIds([]);
      setSizeRows([]);
      setSizeTemplateId("");
      setSizeTemplateName("");
      setSizeTemplateShape("rectangle");
    }
    setAttributeInfo(null);
    setPublishStandardInfo(null);
    setSyncStatus("loading");
    setNotice("");
    try {
      const [attributes, standard] = await Promise.all([
        requestLocalApi(
          `/api/shein/stores/${encodeURIComponent(store.id)}/template/attributes`,
          {
            method: "POST",
            body: JSON.stringify({ productTypeId: category.productTypeId, force }),
          },
        ),
        requestLocalApi(
          `/api/shein/stores/${encodeURIComponent(store.id)}/template/publish-standard`,
          {
            method: "POST",
            body: JSON.stringify({ categoryId: category.categoryId, force }),
          },
        ),
      ]);
      setAttributeInfo(attributes.info);
      setPublishStandardInfo(standard.info);
      setSyncStatus("synced");
      setNotice(
        attributes.cached && standard.cached
          ? `已读取“${category.name}”的本地字段缓存。`
          : `已按SHEIN接口同步“${category.name}”的属性与发布字段并缓存。`,
      );
    } catch (error) {
      setSyncStatus("categories");
      setNotice(formatConnectionError(error));
    }
  };

  useEffect(() => {
    if (!isProduct || editSyncStarted.current) return;
    editSyncStarted.current = true;
    const loadSchema = async () => {
      const loaded = await requestSync();
      if (loaded && initialCategory) {
        await selectProductCategory(initialCategory, { preserveValues: true });
      }
    };
    loadSchema();
  }, []);

  const refreshSchema = async () => {
    const loaded = await requestSync({ force: true });
    if (loaded && selectedCategory) {
      await selectProductCategory(selectedCategory, {
        preserveValues: true,
        force: true,
      });
    }
  };

  const updateAttributeValue = (fieldId, nextValue) => {
    const id = String(fieldId);
    setAttributeValues((current) => ({ ...current, [id]: nextValue }));
  };

  const togglePerProductField = (fieldId, enabled) => {
    const id = String(fieldId);
    setPerProductFieldIds((current) =>
      enabled
        ? Array.from(new Set([...current.map(String), id]))
        : current.filter((item) => String(item) !== id),
    );
  };

  const markMissingRequiredAsPerProduct = () => {
    const missing = syncedFields
      .filter((field) => field.required)
      .filter(
        (field) =>
          !attributeValues[String(field.id)]?.valueIds?.length &&
          !String(attributeValues[String(field.id)]?.customValue || "").trim(),
      )
      .map((field) => String(field.id));
    setPerProductFieldIds((current) =>
      Array.from(new Set([...current.map(String), ...missing])),
    );
    setNotice(`已将 ${missing.length} 个未填写必填属性设为“每个商品单独填写”。`);
  };

  const saveTemplate = async () => {
    if (!validation.valid) {
      setNotice(validation.issues[0]);
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const configuredCount = Object.values(attributeValues).filter(
        (value) =>
          value?.valueIds?.length || String(value?.customValue || "").trim(),
      ).length;
      const complianceConfiguredCount = Object.values(
        complianceAssignments,
      ).reduce(
        (total, values) => total + (Array.isArray(values) ? values.length : 0),
        0,
      );
      const record = getPublishStandardRecord(publishStandardInfo);
      await onComplete({
        id: initialTemplate?.id,
        name: templateName.trim(),
        storeId: store.id,
        templateType: type,
        scope: isProduct
          ? selectedCategory?.path.join(" > ") || `SHEIN类目 ${categoryId}`
          : `参照SKC ${referenceSkc}`,
        content: isProduct
          ? `${configuredCount}项模板值 · ${perProductFieldIds.length}项单品填写`
          : `${complianceConfiguredCount}项合规选择 · 每个SKC提交前重查`,
        usage: initialTemplate?.usage || "0次使用",
        updated: new Date().toLocaleString("zh-CN", { hour12: false }),
        source: "SHEIN接口同步",
        status: "可用",
        storeName: store.name,
        validatedAt: new Date().toISOString(),
        categoryId: isProduct ? categoryId : "",
        productTypeId: isProduct ? productTypeId : "",
        categoryName: isProduct ? selectedCategory?.name || "" : "",
        categoryPath: isProduct ? selectedCategory?.path || [] : [],
        referenceSkc: isProduct ? "" : referenceSkc,
        defaults: isProduct ? undefined : complianceAssignments,
        ruleSnapshotAt: isProduct
          ? undefined
          : complianceBundle?.fetchedAt || new Date().toISOString(),
        ruleSnapshotSummary: isProduct
          ? undefined
          : {
              certificateRequirementCount:
                complianceBundle?.requirements?.certificates?.length || 0,
              agencyRequirementCount:
                complianceBundle?.requirements?.agencies?.length || 0,
              warningRequirementCount:
                complianceBundle?.requirements?.warnings?.length || 0,
              bodyPhotoRequirementCount:
                complianceBundle?.requirements?.bodyPhotos?.length || 0,
              packagePhotoRequirementCount:
                complianceBundle?.requirements?.packagePhotos?.length || 0,
              unsupportedRequirementCount:
                complianceBundle?.requirements?.unsupported?.length || 0,
            },
        attributeValues: isProduct ? attributeValues : {},
        perProductFieldIds: isProduct ? perProductFieldIds : [],
        sizeRows: isProduct ? sizeRows : [],
        sizeTemplateId: isProduct ? sizeTemplateId : "",
        sizeTemplateName: isProduct ? sizeTemplateName : "",
        sizeTemplateShape: isProduct ? sizeTemplateShape : "",
        sizeAttributeList: isProduct
          ? buildSizeAttributeList(
              sizeRows,
              syncedFields.filter((field) => field.typeCode === 2),
            )
          : [],
        packagingWorkbook: isProduct ? packagingWorkbook : null,
        mainImageTemplates: isProduct ? mainImageTemplates : [],
        schemaSummary: isProduct
          ? {
              fieldCount: syncedFields.length,
              requiredCount: syncedFields.filter((field) => field.required).length,
              syncedAt: new Date().toISOString(),
            }
          : null,
        publishFieldRules: isProduct
          ? (record?.fill_in_standard_list || record?.fillInStandardList || [])
          : [],
        pictureRules: isProduct
          ? (record?.picture_config_list || record?.pictureConfigList || [])
          : [],
      });
    } catch (error) {
      setNotice(formatConnectionError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="template-studio" role="dialog" aria-modal="true">
      <header className="template-studio__header">
        <div className="template-studio__identity">
          <button className="icon-button" type="button" title="关闭模板编辑器" onClick={onClose}>
            <X size={19} />
          </button>
          <span className={`template-studio__mark ${isProduct ? "" : "is-compliance"}`}>
            {isProduct ? <ShoppingBag size={19} /> : <ShieldCheck size={19} />}
          </span>
          <div>
            <span className="eyebrow">{isProduct ? "商品模板工作台" : "合规模板工作台"}</span>
            <h1>{isProduct ? "自建商品模板" : "自建合规模板"}</h1>
          </div>
        </div>
        <div className="template-studio__store">
          <span className="store-avatar store-avatar--small">{store.short}</span>
          <span><strong>{store.name}</strong><small>当前授权店铺</small></span>
          <StatusChip
            value={
              syncStatus === "synced"
                ? "字段已同步"
                : syncStatus === "loading"
                  ? "读取中"
                  : "待接口校验"
            }
          />
        </div>
      </header>

      <div className="template-studio__controls">
        <label>
          <span>模板名称</span>
          <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
        </label>
        <div className="template-studio__sync">
          <Database size={16} />
          <span>
            <strong>{endpoint.method} {endpoint.path}</strong>
            <small>模板字段只接受当前店铺SHEIN接口响应</small>
          </span>
          <button
            className="button button--secondary button--small"
            type="button"
            disabled={syncStatus === "loading"}
            onClick={isProduct ? refreshSchema : requestSync}
          >
            {syncStatus === "loading" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <RefreshCw size={15} />
            )}
            {isProduct ? "重新同步字段" : "读取SKC要求"}
          </button>
        </div>
      </div>

      <nav className="template-studio__tabs" aria-label="模板编辑步骤">
        {tabs.map((tab) => (
          <button
            className={activeTab === tab.id ? "is-active" : ""}
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="template-studio__body">
        {isProduct ? (
          <>
            {activeTab === "attributes" && (
              <ProductAttributeTemplate
                storeId={store.id}
                categoryId={categoryId}
                categoryInfo={categoryInfo}
                selectedCategory={selectedCategory}
                attributeInfo={attributeInfo}
                productTypeId={productTypeId}
                attributeValues={attributeValues}
                perProductFieldIds={perProductFieldIds}
                onAttributeValues={setAttributeValues}
                onPerProductFieldIds={setPerProductFieldIds}
                onAttributeValue={updateAttributeValue}
                onPerProductField={togglePerProductField}
                onMarkMissingRequired={markMissingRequiredAsPerProduct}
                onSelectCategory={selectProductCategory}
              />
            )}
            {activeTab === "sizes" && (
              <SizeTemplateEditor
                storeId={store.id}
                categoryId={categoryId}
                attributeInfo={attributeInfo}
                productTypeId={productTypeId}
                sizeRows={sizeRows}
                onSizeRows={setSizeRows}
                sizeTemplateId={sizeTemplateId}
                onSizeTemplateId={setSizeTemplateId}
                sizeTemplateName={sizeTemplateName}
                onSizeTemplateName={setSizeTemplateName}
                shape={sizeTemplateShape}
                onShape={setSizeTemplateShape}
                packagingWorkbook={packagingWorkbook}
                onPackagingWorkbook={setPackagingWorkbook}
              />
            )}
            {activeTab === "images" && (
              <ProductImageTemplate
                storeId={store.id}
                templates={mainImageTemplates}
                onTemplates={setMainImageTemplates}
              />
            )}
          </>
        ) : (
          <>
            {activeTab === "scope" && (
              <ComplianceScopeTemplate
                bundle={complianceBundle}
                referenceSkc={referenceSkc}
                onReferenceSkc={(value) => {
                  setReferenceSkc(value);
                  setComplianceBundle(null);
                  setSyncStatus("idle");
                  setNotice("");
                }}
                onSync={requestSync}
              />
            )}
            {activeTab === "certificates" && (
              <CertificateTemplate
                bundle={complianceBundle}
                assignments={complianceAssignments.certificates}
                onAssignments={(certificates) =>
                  setComplianceAssignments((current) => ({
                    ...current,
                    certificates,
                  }))
                }
              />
            )}
            {activeTab === "agencies" && (
              <AgencyTemplate
                bundle={complianceBundle}
                assignments={complianceAssignments.agencies}
                onAssignments={(agencies) =>
                  setComplianceAssignments((current) => ({
                    ...current,
                    agencies,
                  }))
                }
              />
            )}
            {activeTab === "warnings" && (
              <WarningTemplate
                bundle={complianceBundle}
                assignments={complianceAssignments.warnings}
                onAssignments={(warnings) =>
                  setComplianceAssignments((current) => ({
                    ...current,
                    warnings,
                  }))
                }
              />
            )}
            {activeTab === "photos" && (
              <CompliancePhotoTemplate
                bundle={complianceBundle}
                assignments={complianceAssignments.photos}
                onAssignments={(photos) =>
                  setComplianceAssignments((current) => ({
                    ...current,
                    photos,
                  }))
                }
              />
            )}
          </>
        )}
      </main>

      <footer className="template-studio__footer">
        <div>
          {isProduct && ["sizes", "images"].includes(activeTab) ? (
            <span className="template-studio__notice">
              <CheckCircle2 size={15} />
              {activeTab === "sizes"
                ? "尺寸模板使用页面顶部“保存尺寸模板”独立保存。"
                : "尾部主图模板使用页面顶部“保存模板”独立保存。"}
            </span>
          ) : notice ? (
            <span
              className={
                syncStatus === "synced"
                  ? "template-studio__notice"
                  : "template-studio__error"
              }
            >
              {syncStatus === "synced" ? (
                <CheckCircle2 size={15} />
              ) : (
                <AlertCircle size={15} />
              )}
              {notice}
            </span>
          ) : !validation.valid ? (
            <span className="template-studio__error">
              <AlertCircle size={15} />{validation.issues[0]}
            </span>
          ) : (
            <span>字段来源与必填策略已校验，可以保存模板。</span>
          )}
        </div>
        <button className="button button--secondary" type="button" onClick={onClose}>取消</button>
        {!(isProduct && ["sizes", "images"].includes(activeTab)) && (
          <button
            className="button button--primary"
            type="button"
            disabled={!validation.valid || saving}
            onClick={saveTemplate}
          >
            {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
            {initialTemplate ? "更新模板" : "保存模板"}
          </button>
        )}
      </footer>
    </div>
  );
}

function TemplateSectionHeading({ eyebrow, title, description, endpoint }) {
  return (
    <div className="template-section-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {endpoint && <code>{endpoint}</code>}
    </div>
  );
}

function ApiEmptyState({ endpoint, title, description, fields, action, onAction }) {
  return (
    <div className="api-empty-state">
      <div className="api-empty-state__icon"><Database size={21} /></div>
      <div>
        <span className="eyebrow">等待SHEIN接口响应</span>
        <h3>{title}</h3>
        <p>{description}</p>
        <code>{endpoint.method} {endpoint.path}</code>
        <div className="api-field-pills">
          {fields.map((field) => <span key={field}>{field}</span>)}
        </div>
      </div>
      {action && (
        <button className="button button--secondary button--small" type="button" onClick={onAction}>
          <RefreshCw size={15} /> {action}
        </button>
      )}
    </div>
  );
}

function ProductAttributeTemplate({
  storeId,
  categoryId,
  categoryInfo,
  selectedCategory,
  attributeInfo,
  productTypeId,
  attributeValues,
  perProductFieldIds,
  onAttributeValues,
  onPerProductFieldIds,
  onAttributeValue,
  onPerProductField,
  onMarkMissingRequired,
  onSelectCategory,
}) {
  const categoryEndpoint = SHEIN_TEMPLATE_ENDPOINTS.categoryTree;
  const attributeEndpoint = SHEIN_TEMPLATE_ENDPOINTS.attributeTemplate;
  const [query, setQuery] = useState("");
  const [categoryTrail, setCategoryTrail] = useState([]);
  const [savedAttributeTemplates, setSavedAttributeTemplates] = useState([]);
  const [attributeTemplateId, setAttributeTemplateId] = useState("");
  const [attributeTemplateName, setAttributeTemplateName] = useState("");
  const [attributeLibraryLoading, setAttributeLibraryLoading] = useState(false);
  const [attributeSaving, setAttributeSaving] = useState(false);
  const [attributeNotice, setAttributeNotice] = useState("");
  const categories = useMemo(
    () => (categoryInfo ? flattenLeafCategories(categoryInfo) : []),
    [categoryInfo],
  );
  const searchResults = categories
    .filter((category) =>
      category.path.join(" > ").toLowerCase().includes(query.trim().toLowerCase()),
    )
    .slice(0, 30);
  const categoryColumns = useMemo(() => {
    if (!categoryInfo?.data) return [];
    const columns = [categoryInfo.data];
    for (const node of categoryTrail) {
      if (Array.isArray(node.children) && node.children.length) {
        columns.push(node.children);
      }
    }
    return columns.slice(0, 4);
  }, [categoryInfo, categoryTrail]);
  const fields = useMemo(
    () =>
      attributeInfo && productTypeId
        ? buildAttributeFields(attributeInfo, productTypeId).filter((field) =>
            [3, 4].includes(field.typeCode),
          )
        : [],
    [attributeInfo, productTypeId],
  );

  useEffect(() => {
    if (!categoryInfo || !selectedCategory?.categoryId) return;
    setCategoryTrail(findCategoryTrail(categoryInfo, selectedCategory.categoryId));
  }, [categoryInfo, selectedCategory?.categoryId]);

  const loadAttributeTemplates = async () => {
    if (!storeId || !productTypeId) {
      setSavedAttributeTemplates([]);
      return;
    }
    setAttributeLibraryLoading(true);
    try {
      const result = await requestLocalApi(
        `/api/attribute-templates?storeId=${encodeURIComponent(
          storeId,
        )}&productTypeId=${encodeURIComponent(productTypeId)}`,
      );
      setSavedAttributeTemplates(result.templates || []);
    } catch (error) {
      setAttributeNotice(formatConnectionError(error));
    } finally {
      setAttributeLibraryLoading(false);
    }
  };

  useEffect(() => {
    setAttributeTemplateId("");
    setAttributeTemplateName("");
    setAttributeNotice("");
    loadAttributeTemplates();
  }, [storeId, productTypeId]);

  const loadAttributeTemplate = (id) => {
    const saved = savedAttributeTemplates.find(
      (item) => String(item.id) === String(id),
    );
    if (!saved) return;
    setAttributeTemplateId(saved.id);
    setAttributeTemplateName(saved.name);
    onAttributeValues(saved.attributeValues || {});
    onPerProductFieldIds(saved.perProductFieldIds || []);
    setAttributeNotice(`已载入商品属性模板“${saved.name}”`);
  };

  const startNewAttributeTemplate = () => {
    setAttributeTemplateId("");
    setAttributeTemplateName("");
    onAttributeValues({});
    onPerProductFieldIds([]);
    setAttributeNotice("已新建空白商品属性模板，请填写并命名后保存。");
  };

  const saveAttributeTemplate = async () => {
    if (!attributeTemplateName.trim()) {
      setAttributeNotice("请填写商品属性模板名称");
      return;
    }
    const assignment = validateAttributeAssignments(
      fields,
      attributeValues,
      perProductFieldIds,
    );
    if (!assignment.valid) {
      setAttributeNotice(assignment.issues[0]);
      return;
    }
    setAttributeSaving(true);
    setAttributeNotice("");
    try {
      const path = attributeTemplateId
        ? `/api/attribute-templates/${encodeURIComponent(attributeTemplateId)}`
        : "/api/attribute-templates";
      const result = await requestLocalApi(path, {
        method: attributeTemplateId ? "PUT" : "POST",
        body: JSON.stringify({
          id: attributeTemplateId || undefined,
          name: attributeTemplateName.trim(),
          storeId,
          categoryId,
          productTypeId,
          categoryName: selectedCategory?.name || "",
          categoryPath: selectedCategory?.path || [],
          attributeValues,
          perProductFieldIds,
        }),
      });
      setAttributeTemplateId(result.template.id);
      setAttributeTemplateName(result.template.name);
      await loadAttributeTemplates();
      setAttributeNotice(`商品属性模板“${result.template.name}”已保存`);
    } catch (error) {
      setAttributeNotice(formatConnectionError(error));
    } finally {
      setAttributeSaving(false);
    }
  };

  const deleteAttributeTemplate = async () => {
    if (!attributeTemplateId) return;
    if (!window.confirm(`确认删除商品属性模板“${attributeTemplateName}”吗？`)) {
      return;
    }
    try {
      await requestLocalApi(
        `/api/attribute-templates/${encodeURIComponent(attributeTemplateId)}`,
        { method: "DELETE" },
      );
      startNewAttributeTemplate();
      await loadAttributeTemplates();
      setAttributeNotice("商品属性模板已删除");
    } catch (error) {
      setAttributeNotice(formatConnectionError(error));
    }
  };

  const chooseCategoryNode = (node, columnIndex) => {
    const nextTrail = [...categoryTrail.slice(0, columnIndex), node];
    setCategoryTrail(nextTrail);
    const selection = toCategorySelection(nextTrail);
    if (selection) onSelectCategory(selection);
  };

  const chooseSearchResult = (category) => {
    setCategoryTrail(findCategoryTrail(categoryInfo, category.categoryId));
    setQuery("");
    onSelectCategory(category);
  };

  return (
    <div className="template-editor-stack">
      <section className="template-editor-section">
        <TemplateSectionHeading
          eyebrow="类目决定字段"
          title="选择 SHEIN 末级类目"
          description="类目树按店铺缓存，只在首次建立或主动重新同步时请求SHEIN；选择末级类目后读取对应属性和发布规范。"
          endpoint={categoryEndpoint.path}
        />
        {!categoryInfo ? (
          <ApiEmptyState
            endpoint={categoryEndpoint}
            title="尚未取得当前店铺类目树"
            description="正在读取当前店铺已缓存的类目；首次使用时会自动向SHEIN同步一次。"
            fields={categoryEndpoint.responseFields}
          />
        ) : (
          <div className="real-category-picker">
            <label className="search-field">
              <Search size={17} />
              <input
                value={query}
                placeholder={`搜索 ${categories.length} 个真实末级类目`}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {query.trim() && (
              <div className="category-search-results">
                {searchResults.map((category) => (
                  <button
                    key={`${category.categoryId}-${category.productTypeId}`}
                    type="button"
                    onClick={() => chooseSearchResult(category)}
                  >
                    <span>
                      <strong>{category.name}</strong>
                      <small>{category.path.join(" > ")}</small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
                {searchResults.length === 0 && <span>没有匹配的末级类目</span>}
              </div>
            )}
            <div
              className="category-browser"
              style={{ "--category-columns": Math.max(categoryColumns.length, 1) }}
            >
              {categoryColumns.map((nodes, columnIndex) => (
                <div className="category-column" key={`category-column-${columnIndex}`}>
                  <strong>{["一级类目", "二级类目", "三级类目", "四级类目"][columnIndex]}</strong>
                  <div>
                    {nodes.map((node) => (
                      <button
                        className={
                          String(categoryTrail[columnIndex]?.category_id) ===
                          String(node.category_id)
                            ? "is-active"
                            : ""
                        }
                        key={node.category_id}
                        type="button"
                        onClick={() => chooseCategoryNode(node, columnIndex)}
                      >
                        <span>{node.category_name}</span>
                        {node.last_category ? (
                          <small>末级</small>
                        ) : (
                          <ChevronRight size={14} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {selectedCategory && (
              <div className="selected-category">
                <CheckCircle2 size={17} />
                <span>
                  <strong>{selectedCategory.name}</strong>
                  <small>{selectedCategory.path.join(" > ")}</small>
                </span>
                <code>{selectedCategory.categoryId} / {selectedCategory.productTypeId}</code>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="template-editor-section">
        <TemplateSectionHeading
          eyebrow="字段填写"
          title="必填、选填与不可填写属性"
          description="按SHEIN页面密度分为必填和选填区域；字段、值域、必填状态及输入方式仍完全来自当前类目的接口响应。"
          endpoint={attributeEndpoint.path}
        />
        {attributeInfo && (
          <>
            <div className="attribute-template-toolbar">
              <label>
                <span>已保存商品属性模板</span>
                <select
                  disabled={attributeLibraryLoading}
                  value={attributeTemplateId}
                  onChange={(event) =>
                    loadAttributeTemplate(event.target.value)
                  }
                >
                  <option value="">
                    {attributeLibraryLoading
                      ? "正在读取..."
                      : "选择已有商品属性模板"}
                  </option>
                  {savedAttributeTemplates.map((saved) => (
                    <option key={saved.id} value={saved.id}>
                      {saved.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button button--secondary button--small"
                type="button"
                onClick={startNewAttributeTemplate}
              >
                <Plus size={15} /> 新建
              </button>
              <label className="attribute-template-toolbar__name">
                <span>当前模板名称</span>
                <input
                  value={attributeTemplateName}
                  placeholder="例如：天鹅绒装饰地毯通用属性"
                  onChange={(event) =>
                    setAttributeTemplateName(event.target.value)
                  }
                />
              </label>
              {attributeTemplateId && (
                <button
                  className="icon-button icon-button--danger"
                  type="button"
                  title="删除当前商品属性模板"
                  onClick={deleteAttributeTemplate}
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button
                className="button button--primary"
                type="button"
                disabled={attributeSaving}
                onClick={saveAttributeTemplate}
              >
                {attributeSaving ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                {attributeTemplateId ? "更新属性模板" : "保存属性模板"}
              </button>
            </div>
            {attributeNotice && (
              <div
                className={`inline-alert ${
                  /请|缺少|失败|未/.test(attributeNotice)
                    ? "inline-alert--amber"
                    : "inline-alert--success"
                }`}
              >
                {/请|缺少|失败|未/.test(attributeNotice) ? (
                  <AlertCircle size={16} />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                <span>{attributeNotice}</span>
              </div>
            )}
          </>
        )}
        {!attributeInfo ? (
          <ApiEmptyState
            endpoint={attributeEndpoint}
            title="选择末级类目后读取属性"
            description="未返回 attribute_id 和可用值前，不创建任何商品属性输入框。"
            fields={[
              "attribute_id",
              "attribute_name",
              "attribute_status",
              "attribute_type",
              "attribute_mode",
              "attribute_input_num",
              "attribute_value_info_list",
            ]}
          />
        ) : (
          <>
            <div className="attribute-editor-summary">
              <span>
                <strong>{fields.filter((field) => field.required).length}</strong>
                个必填普通属性
              </span>
              <span>
                <strong>{perProductFieldIds.length}</strong>
                个字段设为单品填写
              </span>
              <button
                className="button button--secondary button--small"
                type="button"
                onClick={onMarkMissingRequired}
              >
                <CheckCircle2 size={14} /> 未填写必填项设为单品填写
              </button>
            </div>
            <AttributeFieldMatrix
              fields={fields}
              values={attributeValues}
              perProductFieldIds={perProductFieldIds}
              onChange={onAttributeValue}
              onPerProduct={onPerProductField}
            />
          </>
        )}
      </section>
    </div>
  );
}

function AttributeValueControl({ field, value, disabled, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selectedIds = (value?.valueIds || []).map(String);
  const customValue = value?.customValue || "";
  const selectedOptions = field.values.filter((option) =>
    selectedIds.includes(String(option.id)),
  );
  const isMulti = [1, 4].includes(field.modeCode) || field.typeCode === 1;
  const supportsManual = [0, 4].includes(field.modeCode) || field.values.length === 0;
  const filteredOptions = field.values
    .filter((option) =>
      `${option.label} ${option.labelEn}`.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 120);

  const updateSelected = (optionId, checked) => {
    const id = String(optionId);
    let nextIds = checked
      ? [...selectedIds, id]
      : selectedIds.filter((selectedId) => selectedId !== id);
    nextIds = Array.from(new Set(nextIds));
    if (field.maxSelections > 0 && nextIds.length > field.maxSelections) return;
    onChange({ valueIds: nextIds, customValue });
  };

  if (!isMulti && field.values.length) {
    return (
      <select
        className="attribute-input"
        disabled={disabled}
        value={selectedIds[0] || ""}
        onChange={(event) =>
          onChange({
            valueIds: event.target.value ? [event.target.value] : [],
            customValue,
          })
        }
      >
        <option value="">请选择</option>
        {field.values.map((option) => (
          <option key={option.id} value={String(option.id)}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (!field.values.length) {
    return (
      <input
        className="attribute-input"
        disabled={disabled}
        value={customValue}
        placeholder={field.required ? "填写模板默认值" : "选填模板默认值"}
        onChange={(event) =>
          onChange({ valueIds: selectedIds, customValue: event.target.value })
        }
      />
    );
  }

  return (
    <div className={`attribute-choice ${disabled ? "is-disabled" : ""}`}>
      <button
        className={`attribute-choice__trigger ${open ? "is-open" : ""}`}
        disabled={disabled}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          {selectedOptions.length
            ? selectedOptions.slice(0, 3).map((option) => option.label).join("、")
            : "选择模板值"}
          {selectedOptions.length > 3 && ` 等${selectedOptions.length}项`}
        </span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="attribute-choice__menu">
          <div className="attribute-choice__head">
          <span>
              <strong>{field.name}</strong>
              <small>
                已选 {selectedIds.length}
                {field.maxSelections > 0 ? ` / ${field.maxSelections}` : ""}
              </small>
          </span>
          <button
            className="icon-button icon-button--small"
            type="button"
            title="关闭选项"
            onClick={() => setOpen(false)}
          >
            <X size={14} />
          </button>
          </div>
          {field.values.length > 12 && (
            <label className="search-field search-field--compact">
              <Search size={15} />
              <input
                value={query}
                placeholder={`搜索 ${field.values.length} 个SHEIN可用值`}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}
          <div className="attribute-choice__options">
            {filteredOptions.map((option) => {
              const checked = selectedIds.includes(String(option.id));
              const atLimit =
                !checked &&
                field.maxSelections > 0 &&
                selectedIds.length >= field.maxSelections;
              return (
                <label key={option.id}>
                  <input
                    checked={checked}
                    disabled={disabled || atLimit}
                    type="checkbox"
                    onChange={(event) => updateSelected(option.id, event.target.checked)}
                  />
                  <span>{option.label}</span>
                  {option.labelEn && <small>{option.labelEn}</small>}
                </label>
              );
            })}
          </div>
          {filteredOptions.length === 120 && (
            <small className="attribute-choice__limit">继续输入关键词以缩小范围</small>
          )}
        </div>
      )}
      {supportsManual && (
        <input
          className="attribute-input"
          disabled={disabled}
          value={customValue}
          placeholder="自定义值"
          onChange={(event) =>
            onChange({ valueIds: selectedIds, customValue: event.target.value })
          }
        />
      )}
    </div>
  );
}

function AttributeFieldMatrix({
  fields,
  values = {},
  perProductFieldIds = [],
  onChange,
  onPerProduct,
}) {
  if (!fields.length) {
    return (
      <DataEmptyState
        icon={Database}
        title="接口未返回可填写属性"
        description="当前类目响应中没有 attribute_status=2 或 3 的属性。"
      />
    );
  }
  const perProduct = new Set(perProductFieldIds.map(String));
  const renderField = (field) => {
    const fieldId = String(field.id);
    const isPerProduct = perProduct.has(fieldId);
    return (
      <div className="shein-attribute-field" key={field.id}>
        <div className="shein-attribute-field__label">
          <span>
            {field.required && <b>*</b>}
            <strong>{field.name}</strong>
          </span>
          <small title={`SHEIN attribute_id: ${field.id}`}>
            {field.type} · ID {field.id}
          </small>
        </div>
        <AttributeValueControl
          field={field}
          value={values[fieldId]}
          disabled={isPerProduct}
          onChange={(nextValue) => onChange?.(fieldId, nextValue)}
        />
        <label className="field-scope-toggle">
          <input
            checked={isPerProduct}
            type="checkbox"
            onChange={(event) => {
              if (event.target.checked) {
                onChange?.(fieldId, { valueIds: [], customValue: "" });
              }
              onPerProduct?.(fieldId, event.target.checked);
            }}
          />
          <span>每个商品单独填写</span>
        </label>
      </div>
    );
  };
  const requiredFields = fields.filter((field) => field.required);
  const optionalFields = fields.filter((field) => !field.required);
  return (
    <div className="shein-attribute-groups">
      <section>
        <div className="shein-attribute-groups__heading">
          <strong>必填属性</strong>
          <span>{requiredFields.length} 项</span>
        </div>
        <div className="shein-attribute-grid">
          {requiredFields.map(renderField)}
        </div>
      </section>
      {optionalFields.length > 0 && (
        <section>
          <div className="shein-attribute-groups__heading">
            <strong>选填属性</strong>
            <span>{optionalFields.length} 项</span>
          </div>
          <div className="shein-attribute-grid">
            {optionalFields.map(renderField)}
          </div>
        </section>
      )}
    </div>
  );
}

function SearchableSheinSize({ options, row, onSelect }) {
  const [query, setQuery] = useState(row.sheinValueLabel || row.name || "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(
    () => filterSheinSizeOptions(options, query),
    [options, query],
  );

  useEffect(() => {
    setQuery(row.sheinValueLabel || row.name || "");
  }, [row.sheinValueLabel, row.name]);

  const choose = (option) => {
    setQuery(option.label);
    setOpen(false);
    setActiveIndex(0);
    onSelect(option);
  };

  return (
    <div className="size-combobox">
      <div className="size-combobox__input">
        <Search size={15} />
        <input
          aria-autocomplete="list"
          aria-expanded={open}
          aria-label="搜索SHEIN尺寸值"
          role="combobox"
          value={query}
          placeholder="输入 40、40*60 搜索"
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) =>
                Math.min(current + 1, Math.max(matches.length - 1, 0)),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter" && open && matches[activeIndex]) {
              event.preventDefault();
              choose(matches[activeIndex]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <ChevronDown size={15} />
      </div>
      {open && (
        <div className="size-combobox__menu" role="listbox">
          {matches.map((option, index) => (
            <button
              className={index === activeIndex ? "is-active" : ""}
              key={`${option.fieldId}-${option.id}`}
              role="option"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              <small>{option.fieldName}</small>
            </button>
          ))}
          {matches.length === 0 && (
            <div className="size-combobox__empty">
              当前类目的SHEIN尺寸值中没有匹配项
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SizeTemplateEditor({
  storeId,
  categoryId,
  attributeInfo,
  productTypeId,
  sizeRows,
  onSizeRows,
  sizeTemplateId,
  onSizeTemplateId,
  sizeTemplateName,
  onSizeTemplateName,
  shape,
  onShape,
  packagingWorkbook,
  onPackagingWorkbook,
}) {
  const attributeEndpoint = SHEIN_TEMPLATE_ENDPOINTS.attributeTemplate;
  const packagingFileInput = useRef(null);
  const allFields = useMemo(
    () =>
      attributeInfo && productTypeId
        ? buildAttributeFields(attributeInfo, productTypeId)
        : [],
    [attributeInfo, productTypeId],
  );
  const salesSizeFields = useMemo(
    () =>
      allFields.filter(
        (field) =>
          field.typeCode === 1 && /尺寸|尺码|规格|size/i.test(field.name),
      ),
    [allFields],
  );
  const sizeAttributeFields = useMemo(
    () => allFields.filter((field) => field.typeCode === 2),
    [allFields],
  );
  const sizeValueOptions = useMemo(
    () =>
      salesSizeFields
        .flatMap((field) =>
          field.values.map((value) => ({
            ...value,
            fieldId: field.id,
            fieldName: field.name,
          })),
        ),
    [salesSizeFields],
  );
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [importingWorkbook, setImportingWorkbook] = useState(false);

  const updateSize = (id, patch) => {
    onSizeRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const loadTemplates = async () => {
    if (!storeId || !productTypeId) return;
    setLibraryLoading(true);
    try {
      const result = await requestLocalApi(
        `/api/size-templates?storeId=${encodeURIComponent(
          storeId,
        )}&productTypeId=${encodeURIComponent(productTypeId)}`,
      );
      setSavedTemplates(result.templates || []);
    } catch (error) {
      setNotice(formatConnectionError(error));
    } finally {
      setLibraryLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, [storeId, productTypeId]);

  const loadTemplate = (id) => {
    const template = savedTemplates.find((item) => item.id === id);
    if (!template) return;
    onSizeTemplateId(template.id);
    onSizeTemplateName(template.name);
    onShape(template.shape || "rectangle");
    onPackagingWorkbook(template.packagingWorkbook || null);
    onSizeRows(
      (template.rows || []).map((row) => ({
        ...createSizeRow(),
        ...row,
        shape: template.shape || row.shape || "rectangle",
      })),
    );
    setNotice(`已载入尺寸模板“${template.name}”`);
  };

  const startNewTemplate = () => {
    onSizeTemplateId("");
    onSizeTemplateName("");
    onShape("rectangle");
    onSizeRows([]);
    onPackagingWorkbook(null);
    setNotice("已新建空白尺寸模板，请命名后保存。");
  };

  const changeShape = (nextShape) => {
    onShape(nextShape);
    onSizeRows((current) =>
      current.map((row) => {
        const option = sizeValueOptions.find(
          (item) =>
            String(item.fieldId) === String(row.sheinAttributeId) &&
            String(item.id) === String(row.sheinAttributeValueId),
        );
        return option
          ? applySheinSizeOption(row, option, {
              shape: nextShape,
              sizeAttributeFields,
            })
          : {
              ...row,
              shape: nextShape,
              widthCm: "",
              lengthCm: "",
              diameterCm: "",
              packageMatch: "pending",
            };
      }),
    );
  };

  const saveSizeTemplate = async () => {
    const validation = validateSizeTemplate({
      name: sizeTemplateName,
      rows: sizeRows,
      sizeAttributeFields,
    });
    if (!validation.valid) {
      setNotice(validation.issues[0]);
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const path = sizeTemplateId
        ? `/api/size-templates/${encodeURIComponent(sizeTemplateId)}`
        : "/api/size-templates";
      const result = await requestLocalApi(path, {
        method: sizeTemplateId ? "PUT" : "POST",
        body: JSON.stringify({
          id: sizeTemplateId || undefined,
          name: sizeTemplateName.trim(),
          storeId,
          categoryId,
          productTypeId,
          shape,
          rows: sizeRows,
          packagingWorkbook,
          sizeAttributeList: buildSizeAttributeList(
            sizeRows,
            sizeAttributeFields,
          ),
        }),
      });
      onSizeTemplateId(result.template.id);
      onSizeTemplateName(result.template.name);
      await loadTemplates();
      setNotice(`尺寸模板“${result.template.name}”已独立保存`);
    } catch (error) {
      setNotice(formatConnectionError(error));
    } finally {
      setSaving(false);
    }
  };

  const removeSizeTemplate = async () => {
    if (!sizeTemplateId) return;
    try {
      await requestLocalApi(
        `/api/size-templates/${encodeURIComponent(sizeTemplateId)}`,
        { method: "DELETE" },
      );
      startNewTemplate();
      await loadTemplates();
      setNotice("尺寸模板已删除");
    } catch (error) {
      setNotice(formatConnectionError(error));
    }
  };

  const updateSizeAttributeValue = (row, field, rawValue) => {
    const value = rawValue.replace(/[^\d]/g, "");
    const name = `${field.name || ""} ${field.nameEn || ""}`;
    const dimensionPatch = {};
    if (/直径|diameter/i.test(name)) dimensionPatch.diameterCm = value;
    else if (/宽度|width/i.test(name)) dimensionPatch.widthCm = value;
    else if (/长度|length/i.test(name)) dimensionPatch.lengthCm = value;
    updateSize(row.id, {
      ...dimensionPatch,
      sizeAttributeValues: {
        ...(row.sizeAttributeValues || {}),
        [String(field.id)]: value,
      },
      packageMatch: "pending",
    });
  };

  const importPackagingWorkbook = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportingWorkbook(true);
    setNotice("");
    try {
      const sheets = await readExcelFile(file);
      const normalized = normalizePackagingWorkbook(sheets);
      if (normalized.materialCount === 0) {
        throw new Error(normalized.issues[0] || "工作簿中没有可用材质表");
      }
      onPackagingWorkbook({
        fileName: file.name,
        importedAt: new Date().toISOString(),
        ...normalized,
      });
      setNotice(
        `已解析 ${normalized.materialCount} 种材质、${normalized.rowCount} 条打包体积规则；保存尺寸模板后会一起保留。`,
      );
    } catch (error) {
      setNotice(`打包体积表导入失败：${error.message || "无法解析文件"}`);
    } finally {
      setImportingWorkbook(false);
      event.target.value = "";
    }
  };

  return (
    <div className="template-editor-stack">
      <section className="template-editor-section">
        <TemplateSectionHeading
          eyebrow="SKU规格"
          title="一个SKU尺寸一行"
          description="SHEIN销售/尺码属性和值域由当前类目接口返回；成品尺寸用于面积、克重和包装表匹配，不等同于打包后的长宽高。"
          endpoint={attributeEndpoint.path}
        />
        {!attributeInfo ? (
          <ApiEmptyState
            endpoint={attributeEndpoint}
            title="尚未取得SKU属性结构"
            description="未同步 attribute_id 前不允许添加本地尺寸行，避免尺寸名称和值无法映射到SHEIN。"
            fields={[
              "attribute_type",
              "attribute_label",
              "attribute_mode",
              "attribute_input_num",
              "attribute_value_info_list",
              "main_attribute_status",
            ]}
          />
        ) : (
          <>
            <div className="size-template-toolbar">
              <label>
                <span>已保存尺寸模板</span>
                <select
                  disabled={libraryLoading}
                  value={sizeTemplateId}
                  onChange={(event) => loadTemplate(event.target.value)}
                >
                  <option value="">
                    {libraryLoading ? "正在读取..." : "选择已有模板"}
                  </option>
                  {savedTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button button--secondary button--small"
                type="button"
                onClick={startNewTemplate}
              >
                <Plus size={15} /> 新建
              </button>
              <label className="size-template-toolbar__name">
                <span>当前模板名称</span>
                <input
                  value={sizeTemplateName}
                  placeholder="例如：矩形天鹅绒常用尺寸"
                  onChange={(event) => onSizeTemplateName(event.target.value)}
                />
              </label>
              <div className="size-shape-control">
                <span>计重形状</span>
                <div>
                  <button
                    className={shape === "rectangle" ? "is-active" : ""}
                    type="button"
                    onClick={() => changeShape("rectangle")}
                  >
                    矩形
                  </button>
                  <button
                    className={shape === "round" ? "is-active" : ""}
                    type="button"
                    onClick={() => changeShape("round")}
                  >
                    圆形
                  </button>
                </div>
              </div>
              <div className="size-template-toolbar__actions">
                {sizeTemplateId && (
                  <button
                    className="icon-button icon-button--danger"
                    type="button"
                    title="删除当前尺寸模板"
                    onClick={removeSizeTemplate}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                <button
                  className="button button--primary"
                  type="button"
                  disabled={saving}
                  onClick={saveSizeTemplate}
                >
                  {saving ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  {sizeTemplateId ? "更新尺寸模板" : "保存尺寸模板"}
                </button>
              </div>
            </div>
            {notice && (
              <div
                className={`inline-alert ${
                  /失败|请/.test(notice) ? "inline-alert--amber" : "inline-alert--success"
                }`}
              >
                {/失败|请/.test(notice) ? (
                  <AlertCircle size={16} />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                <span>{notice}</span>
              </div>
            )}
            <div className="inline-alert inline-alert--blue">
              <CheckCircle2 size={16} />
              <span>
                <strong>SHEIN尺寸值决定上品SKU</strong>
                选择后软件自动解析铺开后的计重尺寸，并用于面积、克重和包装表匹配。形状只控制本地计算方式，不作为独立的SHEIN销售属性提交。
              </span>
            </div>
            <div className="sku-size-table">
              <div className="sku-size-table__head sku-size-table__head--compact">
                <span>SHEIN尺寸值</span>
                <span>自动解析的计重尺寸</span>
                <span>面积</span>
                <span>尺码表状态</span>
                <span />
              </div>
              {sizeRows.map((row) => (
                <div className="sku-size-table__row sku-size-table__row--compact" key={row.id}>
                  <SearchableSheinSize
                    options={sizeValueOptions}
                    row={row}
                    onSelect={(option) =>
                      updateSize(
                        row.id,
                        applySheinSizeOption(row, option, {
                          shape,
                          sizeAttributeFields,
                        }),
                      )
                    }
                  />
                  <span className="calculated-value">
                    {shape === "round"
                      ? row.diameterCm
                        ? `直径 ${row.diameterCm} cm`
                        : "未能从尺寸值解析"
                      : row.widthCm && row.lengthCm
                        ? `${row.widthCm} × ${row.lengthCm} cm`
                        : "未能从尺寸值解析"}
                  </span>
                  <span className="calculated-value">
                    {calculateAreaSquareMeters(row) == null
                      ? "待解析"
                      : `${calculateAreaSquareMeters(row)} m²`}
                  </span>
                  <span className="calculated-value">
                    {sizeAttributeFields
                      .filter((field) => field.required)
                      .every(
                        (field) =>
                          Number(
                            row.sizeAttributeValues?.[String(field.id)],
                          ) > 0,
                      )
                      ? "必填项完整"
                      : "待补必填项"}
                  </span>
                  <button
                    className="icon-button icon-button--small"
                    title="删除尺寸"
                    type="button"
                    onClick={() =>
                      onSizeRows((current) => current.filter((item) => item.id !== row.id))
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {sizeRows.length === 0 && (
                <div className="sku-size-table__empty">
                  还没有尺寸行。每一个准备发布的SKU尺寸都在这里单独建一行。
                </div>
              )}
            </div>
            <button
              className="button button--secondary button--small"
              type="button"
              onClick={() =>
                onSizeRows((current) => [
                  ...current,
                  { ...createSizeRow(), shape },
                ])
              }
            >
              <Plus size={15} /> 添加尺寸
            </button>
            {salesSizeFields.length === 0 && (
              <div className="inline-alert inline-alert--amber">
                <AlertCircle size={16} />
                <span>
                  <strong>当前响应没有销售/尺码属性值</strong>
                  尺寸行可以先保存，但发品前仍需按SHEIN发布字段规范补齐SKU映射。
                </span>
              </div>
            )}

            <div className="size-chart-section">
              <div className="size-chart-section__heading">
                <div>
                  <span className="eyebrow">SHEIN发品字段</span>
                  <h3>产品尺码表</h3>
                  <p>
                    由当前类目的 `attribute_type=2` 动态生成；每个数值会通过销售属性ID和值ID关联到对应SKU尺寸。
                  </p>
                </div>
                <code>size_attribute_list</code>
              </div>
              {sizeAttributeFields.length > 0 ? (
                <div
                  className="size-chart-table"
                  style={{
                    "--chart-columns": sizeAttributeFields.length,
                  }}
                >
                  <div className="size-chart-table__head">
                    <span>关联SHEIN尺寸</span>
                    {sizeAttributeFields.map((field) => (
                      <span key={field.id}>
                        {field.required && <b>*</b>}
                        {field.name}
                      </span>
                    ))}
                  </div>
                  {sizeRows.map((row) => (
                    <div className="size-chart-table__row" key={row.id}>
                      <strong>{row.sheinValueLabel || "尚未选择"}</strong>
                      {sizeAttributeFields.map((field) => (
                        <label key={field.id}>
                          <input
                            inputMode="numeric"
                            min="1"
                            step="1"
                            type="number"
                            value={
                              row.sizeAttributeValues?.[String(field.id)] || ""
                            }
                            placeholder={field.required ? "必填正整数" : "选填"}
                            onChange={(event) =>
                              updateSizeAttributeValue(
                                row,
                                field,
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      ))}
                    </div>
                  ))}
                  {sizeRows.length === 0 && (
                    <div className="size-chart-table__empty">
                      添加并选择SHEIN尺寸后，尺码表会自动填入长度、宽度或直径。
                    </div>
                  )}
                </div>
              ) : (
                <div className="inline-alert">
                  <Database size={16} />
                  <span>
                    当前类目接口没有返回 `attribute_type=2`
                    的尺码表字段，因此发品时不生成 `size_attribute_list`。
                  </span>
                </div>
              )}
            </div>

            <div className="size-workbook-section">
              <div className="size-workbook-section__heading">
                <div>
                  <span className="eyebrow">本地打包规则</span>
                  <h3>打包体积表</h3>
                  <p>
                    每个工作表代表一种材质。这里只解析并保存规则，上品时选择材质后再一键匹配SKU打包长、宽、高。
                  </p>
                </div>
                <input
                  ref={packagingFileInput}
                  hidden
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  type="file"
                  onChange={importPackagingWorkbook}
                />
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={importingWorkbook}
                  onClick={() => packagingFileInput.current?.click()}
                >
                  {importingWorkbook ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Upload size={16} />
                  )}
                  {packagingWorkbook ? "更换打包体积表" : "上传打包体积表"}
                </button>
              </div>
              {packagingWorkbook ? (
                <div className="workbook-summary workbook-summary--size-template">
                  <FileSpreadsheet size={18} />
                  <span>
                    <strong>{packagingWorkbook.fileName}</strong>
                    <small>
                      {packagingWorkbook.materialCount} 种材质 ·{" "}
                      {packagingWorkbook.rowCount} 条打包体积规则
                    </small>
                  </span>
                  <div className="workbook-materials">
                    {Object.keys(packagingWorkbook.materials || {}).map(
                      (material) => (
                        <span key={material}>{material}</span>
                      ),
                    )}
                  </div>
                  <button
                    className="icon-button icon-button--small"
                    type="button"
                    title="移除打包体积表"
                    onClick={() => onPackagingWorkbook(null)}
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <div className="size-workbook-empty">
                  <FileSpreadsheet size={20} />
                  <span>
                    <strong>尚未上传打包体积表</strong>
                    支持 `.xlsx`，列名为：宽、长、打包长、打包宽、打包高。
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function getPublishStandardRecord(info) {
  const data = info?.data ?? info ?? null;
  return Array.isArray(data) ? data[0] || null : data;
}

async function uploadMainImageAsset(file) {
  const mimeType =
    file.type ||
    (/\.png$/i.test(file.name) ? "image/png" : "image/jpeg");
  const response = await fetch("/api/main-image-assets", {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "x-file-name": encodeURIComponent(file.name),
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `图片保存失败（HTTP ${response.status}）`);
  }
  return payload.asset;
}

function ProductImageTemplate({
  storeId,
  templates,
  onTemplates,
}) {
  const fileInput = useRef(null);
  const [savedTemplates, setSavedTemplates] = useState(templates || []);
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [previewImage, setPreviewImage] = useState(null);

  const loadLibrary = async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const result = await requestLocalApi(
        `/api/main-image-templates?storeId=${encodeURIComponent(storeId)}`,
      );
      const nextTemplates = result.templates || [];
      setSavedTemplates(nextTemplates);
      onTemplates(nextTemplates);
    } catch (error) {
      setNotice(formatConnectionError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLibrary();
  }, [storeId]);

  const loadTemplate = (id) => {
    const template = savedTemplates.find((item) => item.id === id);
    if (!template) return;
    setTemplateId(template.id);
    setTemplateName(template.name);
    setImages(template.images || []);
    setNotice(`已载入尾部主图模板“${template.name}”`);
  };

  const startNewTemplate = () => {
    setTemplateId("");
    setTemplateName("");
    setImages([]);
    setNotice("已新建空白尾部主图模板");
  };

  const addImages = async (event) => {
    const files = Array.from(event.target.files || []).filter(
      (file) =>
        file.type === "image/jpeg" ||
        file.type === "image/png" ||
        /\.(jpe?g|png)$/i.test(file.name),
    );
    if (!files.length) return;
    setUploading(true);
    setNotice("");
    const accepted = [];
    const rejected = [];
    try {
      for (const file of files) {
        let dimensions = { width: 0, height: 0 };
        try {
          dimensions = await readImageDimensions(file);
        } catch {
          rejected.push(`${file.name}：无法读取图片尺寸`);
          continue;
        }
        const issues = validatePublishImage(
          file,
          "main",
          dimensions.width,
          dimensions.height,
        );
        if (issues.length) {
          rejected.push(`${file.name}：${issues.join("、")}`);
          continue;
        }
        const asset = await uploadMainImageAsset(file);
        accepted.push({
          ...asset,
          width: dimensions.width,
          height: dimensions.height,
          sizeLabel: formatImageSize(file.size),
        });
      }
      setImages((current) => [...current, ...accepted]);
      setNotice(
        rejected.length
          ? `已加入 ${accepted.length} 张；${rejected[0]}`
          : `已加入 ${accepted.length} 张尾部主图，保存模板后可长期复用。`,
      );
    } catch (error) {
      setNotice(formatConnectionError(error));
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      setNotice("请填写主图模板名称");
      return;
    }
    if (!images.length) {
      setNotice("请至少上传一张主图");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const path = templateId
        ? `/api/main-image-templates/${encodeURIComponent(templateId)}`
        : "/api/main-image-templates";
      const result = await requestLocalApi(path, {
        method: templateId ? "PUT" : "POST",
        body: JSON.stringify({
          id: templateId || undefined,
          name: templateName.trim(),
          storeId,
          placement: "append",
          imageType: 1,
          images,
        }),
      });
      setTemplateId(result.template.id);
      setTemplateName(result.template.name);
      await loadLibrary();
      setNotice(`尾部主图模板“${result.template.name}”已保存`);
    } catch (error) {
      setNotice(formatConnectionError(error));
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async () => {
    if (!templateId) return;
    try {
      await requestLocalApi(
        `/api/main-image-templates/${encodeURIComponent(templateId)}`,
        { method: "DELETE" },
      );
      startNewTemplate();
      await loadLibrary();
      setNotice("尾部主图模板已删除");
    } catch (error) {
      setNotice(formatConnectionError(error));
    }
  };

  return (
    <div className="template-editor-stack">
      <section className="template-editor-section">
        <TemplateSectionHeading
          eyebrow="可复用主图素材"
          title="尾部主图模板"
          description="模板图片固定追加在商品自身主图之后。旧版SKC图片方案中首图为image_type=1，追加尾图按顺序作为image_type=2；新版方案则跟随当前类目的SPU图片规则。"
        />
        <div className="tail-image-template-toolbar">
          <label>
            <span>已保存模板</span>
            <select
              disabled={loading}
              value={templateId}
              onChange={(event) => loadTemplate(event.target.value)}
            >
              <option value="">
                {loading ? "正在读取..." : "选择已有尾部主图模板"}
              </option>
              {savedTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} · {template.images?.length || 0}张
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button--secondary button--small"
            type="button"
            onClick={startNewTemplate}
          >
            <Plus size={15} /> 新建
          </button>
          <label className="tail-image-template-toolbar__name">
            <span>模板名称</span>
            <input
              value={templateName}
              placeholder="例如：天鹅绒材质说明尾图"
              onChange={(event) => setTemplateName(event.target.value)}
            />
          </label>
          <input
            ref={fileInput}
            hidden
            multiple
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            type="file"
            onChange={addImages}
          />
          <button
            className="button button--secondary"
            type="button"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Upload size={16} />
            )}
            上传图片
          </button>
          {templateId && (
            <button
              className="icon-button icon-button--danger"
              type="button"
              title="删除当前主图模板"
              onClick={deleteTemplate}
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            className="button button--primary"
            type="button"
            disabled={saving || uploading}
            onClick={saveTemplate}
          >
            {saving ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            {templateId ? "更新模板" : "保存模板"}
          </button>
        </div>
        {notice && (
          <div
            className={`inline-alert ${
              /失败|请|无法|超过|需为/.test(notice)
                ? "inline-alert--amber"
                : "inline-alert--success"
            }`}
          >
            {/失败|请|无法|超过|需为/.test(notice) ? (
              <AlertCircle size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
            <span>{notice}</span>
          </div>
        )}
        <div className="tail-image-sequence">
          {images.map((image, index) => (
            <article key={image.id || image.fileName}>
              <button
                className="tail-image-sequence__preview"
                type="button"
                title="放大查看"
                onClick={() => setPreviewImage(image)}
              >
                <img src={image.url} alt={`${templateName || "主图模板"} 第${index + 1}张`} />
                <span><Search size={15} /> 放大</span>
              </button>
              <div>
                <i>{index + 1}</i>
                <span>
                  <strong>{image.originalName || image.fileName}</strong>
                  <small>
                    {image.width}×{image.height}px · {image.sizeLabel || formatImageSize(image.size || 0)}
                  </small>
                </span>
                <button
                  className="icon-button icon-button--small"
                  title="移除图片"
                  type="button"
                  onClick={() =>
                    setImages((current) =>
                      current.filter((item) => item !== image),
                    )
                  }
                >
                  <X size={14} />
                </button>
              </div>
            </article>
          ))}
          {images.length === 0 && (
            <DataEmptyState
              icon={Images}
              title="还没有上传尾部主图"
              description="填写模板名称后可一次上传多张；缩略图按当前顺序展示，上品时会依次追加到商品主图末尾。"
            />
          )}
        </div>
        <div className="inline-alert inline-alert--blue">
          <Images size={16} />
          <span>
            <strong>固定追加规则</strong>
            商品文件夹中的主图保持在前，所选模板图片按这里的1、2、3顺序放在最后；提交前仍按当前类目图片数量上限校验。
          </span>
        </div>
      </section>
      {previewImage && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="主图大图预览"
          onClick={() => setPreviewImage(null)}
        >
          <button
            className="icon-button image-lightbox__close"
            type="button"
            title="关闭预览"
            onClick={() => setPreviewImage(null)}
          >
            <X size={20} />
          </button>
          <img
            src={previewImage.url}
            alt={previewImage.originalName || previewImage.fileName}
            onClick={(event) => event.stopPropagation()}
          />
          <span>
            {previewImage.originalName || previewImage.fileName} ·{" "}
            {previewImage.width}×{previewImage.height}px
          </span>
        </div>
      )}
    </div>
  );
}

function complianceRequirementKey(item = {}) {
  return String(item.certificateTypeCode || item.certificateTypeId || "");
}

function replaceComplianceAssignment(assignments, key, nextValue) {
  const next = (assignments || []).filter(
    (item) => complianceRequirementKey(item) !== key,
  );
  return nextValue ? [...next, nextValue] : next;
}

function ComplianceScopeTemplate({
  bundle,
  referenceSkc,
  onReferenceSkc,
  onSync,
}) {
  const endpoint = SHEIN_TEMPLATE_ENDPOINTS.complianceRequirements;
  const requirements = bundle?.requirements;
  const totalRequirements = requirements
    ? Object.values(requirements).reduce(
        (total, values) => total + (Array.isArray(values) ? values.length : 0),
        0,
      )
    : 0;
  return (
    <div className="template-editor-stack">
      <section className="template-editor-section">
        <TemplateSectionHeading
          eyebrow="应用入口"
          title="读取参照SKC的合规要求"
          description="参照SKC只用于建立可编辑模板。批量应用时，每个目标SKC都必须重新查询自己的合规要求。"
          endpoint={endpoint.path}
        />
        <div className="compliance-scope-form">
          <label className="form-field">
            <span>参照 SKC</span>
            <input value={referenceSkc} onChange={(event) => onReferenceSkc(event.target.value)} />
            <small>输入当前授权店铺拥有的SKC平台编码</small>
          </label>
          <button className="button button--primary" type="button" onClick={onSync}>
            <RefreshCw size={16} /> 读取SHEIN合规要求
          </button>
        </div>
        {!bundle ? (
          <ApiEmptyState
            endpoint={endpoint}
            title="尚未取得该SKC的合规要求"
            description="只有接口返回的 items 才会进入模板；证书类型名称、分组、必填状态和审核状态均不在本地预设。"
            fields={[
              "skcName",
              "certificateTypeCode",
              "certificateTypeId",
              "certificateTypeName",
              "complianceGroupCode",
              "isAutoProductWarning",
              "isManualProductWarning",
              "isRequired",
              "reviewState",
            ]}
          />
        ) : (
          <div className="compliance-bundle-summary">
            <div><strong>{totalRequirements}</strong><span>平台要求/图片槽位</span></div>
            <div><strong>{bundle.certificateSchemas?.length || 0}</strong><span>证书Schema</span></div>
            <div><strong>{bundle.certificates?.length || 0}</strong><span>店铺证书</span></div>
            <div><strong>{bundle.bindableAgencies?.length || 0}</strong><span>可绑定代理公司</span></div>
            <div><strong>{bundle.warningRules?.length || 0}</strong><span>手动警告语规则</span></div>
          </div>
        )}
      </section>

      <section className="template-editor-section">
        <TemplateSectionHeading
          eyebrow="要求矩阵"
          title="文档规定的分组处理边界"
          description="以下只描述接口能力边界，不代表当前SKC一定存在这些要求。"
        />
        <div className="api-boundary-grid">
          {Object.entries(COMPLIANCE_GROUPS).map(([code, group]) => (
            <div key={code}>
              <code>{code}</code>
              <strong>{group.label}</strong>
              <span>
                {group.supported === true && "开放平台支持"}
                {group.supported === "manual-warning-only" && "仅手动警告语支持；自动警告语由平台处理"}
                {group.supported === false && "开放平台暂不支持"}
              </span>
            </div>
          ))}
        </div>
        <div className="inline-alert inline-alert--amber">
          <AlertCircle size={17} />
          <span><strong>实拍图另行查询</strong>实拍图要求来自 /open-api/goods-compliance/skc-label-list，不从上述 items 推断。</span>
        </div>
        {bundle?.requirements?.unsupported?.some(
          (item) => Number(item.isRequired) === 1 && Number(item.reviewState) !== 2,
        ) && (
          <div className="inline-alert inline-alert--amber">
            <XCircle size={17} />
            <span>
              <strong>存在API不可处理的必填项</strong>
              此模板只能保存为风险记录，不能进入批量执行。
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

function CertificateTemplate({ bundle, assignments = [], onAssignments }) {
  const schemaEndpoint = SHEIN_TEMPLATE_ENDPOINTS.certificateSchema;
  const searchEndpoint = SHEIN_TEMPLATE_ENDPOINTS.certificateSearch;
  const requirements = bundle?.requirements?.certificates || [];
  const chooseCertificate = (requirement, poolSn) => {
    const key = complianceRequirementKey(requirement);
    const selected = (bundle?.certificates || []).find(
      (certificate) => String(certificate.poolSn) === String(poolSn),
    );
    onAssignments(
      replaceComplianceAssignment(
        assignments,
        key,
        selected
          ? {
              certificateTypeCode: requirement.certificateTypeCode,
              certificateTypeId: requirement.certificateTypeId,
              poolSn: selected.poolSn,
              status: selected.status,
              certificateDimension: selected.certificateDimension,
              bindSkcFlag: selected.bindSkcFlag === 1,
            }
          : null,
      ),
    );
  };
  return (
    <div className="template-editor-stack">
      <section className="template-editor-section">
        <TemplateSectionHeading
          eyebrow="ZSZZL"
          title="证书填写结构"
          description="从SKC要求取得 certificateTypeCode 后，再读取该证书类型的预设字段、必填状态、输入类型和值域。"
          endpoint={schemaEndpoint.path}
        />
        {!bundle ? (
          <ApiEmptyState
            endpoint={schemaEndpoint}
            title="尚未取得证书Schema"
            description="未返回 presetId、inputType 和 presetValueList 前，不生成证书填写表单。"
            fields={[
              "certificateTypeInfoList",
              "certificateDimension",
              "certificateLabel",
              "certificateTypeId",
              "presetInfoList",
              "presetId",
              "inputType",
              "isRequired",
              "presetValueList",
              "sourceFrom",
            ]}
          />
        ) : (
          <div className="compliance-rule-list">
            {requirements.map((requirement) => {
              const schema = (bundle.certificateSchemas || []).find(
                (item) =>
                  String(item.certificateTypeId) ===
                  String(requirement.certificateTypeId),
              );
              const fields = [
                ...(schema?.presetInfoList || []),
                ...(schema?.otherPresetInfoList || []),
              ];
              return (
                <div className="compliance-rule-row" key={complianceRequirementKey(requirement)}>
                  <span>
                    <strong>{requirement.certificateTypeName}</strong>
                    <small>
                      {requirement.certificateTypeCode} · {Number(requirement.isRequired) === 1 ? "必填" : "选填"} · 审核状态 {requirement.reviewState}
                    </small>
                  </span>
                  <span>
                    <StatusChip value={schema ? "Schema已读取" : "缺少Schema"} />
                    <small>
                      {fields.length
                        ? `${fields.length} 个动态字段`
                        : "无额外动态字段"}
                    </small>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section className="template-editor-section">
        <TemplateSectionHeading
          eyebrow="店铺证书池"
          title="查询可复用证书"
          description="模板只能引用当前授权店铺查询到的 poolSn；编辑与绑定请求必须使用对应接口的真实字段。"
          endpoint={searchEndpoint.path}
        />
        {!bundle ? (
          <ApiEmptyState
            endpoint={searchEndpoint}
            title="尚未查询当前店铺证书池"
            description="证书名称、状态、有效期、文件和SKC绑定状态均以接口响应为准。"
            fields={searchEndpoint.responseFields}
          />
        ) : (
          <div className="compliance-assignment-list">
            {requirements.map((requirement) => {
              const key = complianceRequirementKey(requirement);
              const perSkcUpload =
                isPerSkcFlammabilityCertificate(requirement);
              const selected = assignments.find(
                (item) => complianceRequirementKey(item) === key,
              );
              const options = (bundle.certificates || []).filter(
                (certificate) =>
                  certificate.certificateTypeCode ===
                    requirement.certificateTypeCode &&
                  Number(certificate.status) === 2,
              );
              if (perSkcUpload) {
                return (
                  <div className="inline-alert inline-alert--blue" key={key}>
                    <ShieldCheck size={16} />
                    <span>
                      <strong>
                        {requirement.certificateTypeName}：每个 SKC 单独上传
                      </strong>
                      1630/1631 不写入通用模板；批量处理时会在每个 SKC 页签内调用证书直传接口。
                    </span>
                  </div>
                );
              }
              return (
                <label className="form-field" key={key}>
                  <span>{requirement.certificateTypeName}</span>
                  <select
                    value={selected?.poolSn || ""}
                    onChange={(event) =>
                      chooseCertificate(requirement, event.target.value)
                    }
                  >
                    <option value="">不设模板默认值</option>
                    {options.map((certificate) => (
                      <option key={certificate.poolSn} value={certificate.poolSn}>
                        {certificate.fileList?.[0]?.fileName || certificate.poolSn}
                        {certificate.invalidTime
                          ? ` · 有效至 ${certificate.invalidTime}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  <small>
                    {options.length
                      ? `${options.length} 份当前生效证书可复用`
                      : "当前店铺没有该类型的生效证书；新建证书写入仍保持关闭"}
                  </small>
                </label>
              );
            })}
          </div>
        )}
      </section>
      <div className="template-facts">
        <div><strong>保存证书</strong><span>POST /open-api/goods-certificates/save</span></div>
        <div><strong>文件来源</strong><span>fileUrl 必须使用证书文件上传接口返回的SHEIN地址</span></div>
        <div><strong>全量证书</strong><span>certificateDimension=2 时由平台自动应用，无需逐SKC绑定</span></div>
      </div>
    </div>
  );
}

function AgencyTemplate({ bundle, assignments = [], onAssignments }) {
  const endpoint = SHEIN_TEMPLATE_ENDPOINTS.agencyList;
  const requirements = bundle?.requirements?.agencies || [];
  const agencyTypeLabel = {
    0: "欧盟责任人",
    1: "英国代理",
    2: "美国代理",
    3: "制造商",
    4: "土耳其责任人",
  };
  const expectedAgencyType = (requirement) => {
    const code = String(requirement.certificateTypeCode || "").toLowerCase();
    if (code === "eurespperson") return 0;
    if (code === "ukrespperson") return 1;
    if (code === "usrespperson") return 2;
    if (code === "manufacturer") return 3;
    if (code === "turespperson") return 4;
    return null;
  };
  const chooseAgency = (requirement, agencyId) => {
    const key = complianceRequirementKey(requirement);
    const selected = (bundle?.bindableAgencies || []).find(
      (agency) => String(agency.agencyId) === String(agencyId),
    );
    onAssignments(
      replaceComplianceAssignment(
        assignments,
        key,
        selected
          ? {
              certificateTypeCode: requirement.certificateTypeCode,
              certificateTypeId: requirement.certificateTypeId,
              agencyId: selected.agencyId,
              agencyStatus: selected.agencyStatus,
              applyStatus: selected.applyStatus,
              coveredProductRange: selected.coveredProductRange,
              agencyType: selected.agencyType,
            }
          : null,
      ),
    );
  };
  return (
    <section className="template-editor-section">
      <TemplateSectionHeading
        eyebrow="按站点匹配"
        title="查询当前店铺代理公司"
        description="代理公司类型、名称、品牌、覆盖范围、审核状态和有效期全部来自店铺接口。"
        endpoint={endpoint.path}
      />
      {!bundle ? (
        <ApiEmptyState
          endpoint={endpoint}
          title="尚未取得代理公司列表"
          description="未返回 agencyId 前不展示任何代理公司名称，也不允许建立本地代理公司选项。"
          fields={endpoint.responseFields}
        />
      ) : (
        <div className="compliance-assignment-list">
          {requirements.map((requirement) => {
            const key = complianceRequirementKey(requirement);
            const selected = assignments.find(
              (item) => complianceRequirementKey(item) === key,
            );
            const requiredType = expectedAgencyType(requirement);
            const options = (bundle.bindableAgencies || []).filter(
              (agency) =>
                requiredType === null ||
                Number(agency.agencyType) === requiredType,
            );
            return (
              <label className="form-field" key={key}>
                <span>{requirement.certificateTypeName}</span>
                <select
                  value={selected?.agencyId || ""}
                  onChange={(event) =>
                    chooseAgency(requirement, event.target.value)
                  }
                >
                  <option value="">不设模板默认值</option>
                  {options.map((agency) => (
                    <option key={agency.agencyId} value={agency.agencyId}>
                      {agency.agencyName} ·{" "}
                      {agencyTypeLabel[agency.agencyType] || `类型${agency.agencyType}`}
                      {Number(agency.coveredProductRange) === 1
                        ? " · 全店覆盖"
                        : ""}
                    </option>
                  ))}
                </select>
                <small>
                  {options.length
                    ? `仅显示${agencyTypeLabel[requiredType] || "当前要求"}类型；提交前仍会核对审核状态。`
                    : "当前店铺没有可绑定且类型匹配的代理公司。"}
                </small>
              </label>
            );
          })}
        </div>
      )}
      <div className="inline-alert">
        <CheckCircle2 size={17} />
        <span><strong>文档绑定条件</strong>agencyStatus=0 且 applyStatus=1或2；coveredProductRange=1 时覆盖全部商品，由平台自动绑定。</span>
      </div>
    </section>
  );
}

function WarningTemplate({ bundle, assignments = [], onAssignments }) {
  const endpoint = SHEIN_TEMPLATE_ENDPOINTS.warningRules;
  const requirements = bundle?.requirements?.warnings || [];
  const setWarningValue = (requirement, rules, fieldCode, valueId, checked) => {
    const key = complianceRequirementKey(requirement);
    const existing = assignments.find(
      (item) => complianceRequirementKey(item) === key,
    );
    const currentIds = (existing?.selectedByField?.[fieldCode] || []).map(String);
    const nextIds = checked
      ? Array.from(new Set([...currentIds, String(valueId)]))
      : currentIds.filter((id) => id !== String(valueId));
    const nextAssignment = {
      certificateTypeCode: requirement.certificateTypeCode,
      certificateTypeId: requirement.certificateTypeId,
      rules,
      selectedByField: {
        ...(existing?.selectedByField || {}),
        [fieldCode]: nextIds,
      },
    };
    onAssignments(
      replaceComplianceAssignment(assignments, key, nextAssignment),
    );
  };
  return (
    <div className="template-editor-stack">
      <section className="template-editor-section">
        <TemplateSectionHeading
          eyebrow="动态规则"
          title="警告语字段映射"
          description="只有SKC要求中 isManualProductWarning=true 的HGXXL项目进入此处；自动警告语由SHEIN平台处理。"
          endpoint={endpoint.path}
        />
        {!bundle ? (
          <ApiEmptyState
            endpoint={endpoint}
            title="尚未取得手动警告语字段规则"
            description="未返回 fieldCode、fieldType、候选值、互斥关系和映射路径前，不生成任何警告语选项。"
            fields={endpoint.responseFields}
          />
        ) : requirements.length ? (
          <div className="compliance-warning-list">
            {requirements.map((requirement) => {
              const key = complianceRequirementKey(requirement);
              const rules = (bundle.warningRules || []).find(
                (rule) => rule.certificateTypeCode === requirement.certificateTypeCode,
              );
              const assignment = assignments.find(
                (item) => complianceRequirementKey(item) === key,
              );
              return (
                <section key={key}>
                  <strong>{requirement.certificateTypeName}</strong>
                  {(rules?.presetInfo?.presetFields || [])
                    .filter((field) => Number(field.isEnabled ?? 1) === 1)
                    .sort((left, right) => Number(left.fieldSort) - Number(right.fieldSort))
                    .map((field, fieldIndex, fields) => (
                      <div className="compliance-warning-field" key={field.fieldCode}>
                        <span>
                          <strong>{field.fieldName}</strong>
                          <small>
                            {fieldIndex === fields.length - 1
                              ? "警告语字段；映射值会在预检时自动补齐"
                              : Number(field.fieldType) === 1
                                ? "单选"
                                : "多选"}
                          </small>
                        </span>
                        <div className="compliance-field-options">
                          {(field.presetFieldValues || [])
                            .filter((value) => Number(value.isEnabled ?? 1) === 1)
                            .map((value) => (
                              <label key={value.fieldValueId}>
                                <input
                                  checked={(
                                    assignment?.selectedByField?.[field.fieldCode] || []
                                  )
                                    .map(String)
                                    .includes(String(value.fieldValueId))}
                                  type="checkbox"
                                  onChange={(event) =>
                                    setWarningValue(
                                      requirement,
                                      rules,
                                      field.fieldCode,
                                      value.fieldValueId,
                                      event.target.checked,
                                    )
                                  }
                                />
                                <span>{value.fieldValue}</span>
                              </label>
                            ))}
                        </div>
                      </div>
                    ))}
                  {!rules && <small>当前规则包未返回该警告语规则，不能填写。</small>}
                </section>
              );
            })}
          </div>
        ) : (
          <DataEmptyState
            icon={CheckCircle2}
            title="该SKC没有手动警告语要求"
            description="自动警告语由SHEIN平台处理，本模板不生成本地字段。"
          />
        )}
      </section>
      <section className="template-editor-section">
        <TemplateSectionHeading
          eyebrow="提交前校验"
          title="警告语生成规则"
          description="以下校验规则直接来自接口文档。"
        />
        <div className="rule-checklist">
          <span><Check size={15} />fieldSort 最大的字段作为警告语字段</span>
          <span><Check size={15} />忽略 isEnabled=0 的字段和值</span>
          <span><Check size={15} />校验 exclusionFieldValueIds 互斥关系</span>
          <span><Check size={15} />按 mappingPaths 自动补齐警告语值</span>
          <span><Check size={15} />fieldType=2 按文档以多值输入处理</span>
        </div>
      </section>
    </div>
  );
}

function CompliancePhotoTemplate({
  bundle,
  assignments = [],
  onAssignments,
}) {
  const [uploadingKey, setUploadingKey] = useState("");
  const [notice, setNotice] = useState("");
  const endpoint = SHEIN_TEMPLATE_ENDPOINTS.photoRequirements;
  const requirements = [
    ...(bundle?.requirements?.bodyPhotos || []),
    ...(bundle?.requirements?.packagePhotos || []),
  ];
  const reusableRequirements = requirements.filter(isReusableEuRepPhoto);
  const chooseReusablePhoto = async (requirement, file) => {
    if (!file) return;
    const key = compliancePhotoKey(requirement);
    setUploadingKey(key);
    setNotice("");
    try {
      const dimensions = await readImageDimensions(file);
      const asset = await uploadMainImageAsset(file);
      onAssignments(
        replacePhotoAssignment(assignments, key, {
          labelId: requirement.labelId,
          labelGroup: String(requirement.labelGroup || ""),
          templateReusable: true,
          localAssetRef: asset.url,
          localAssetId: asset.id,
          fileName: file.name,
          mimeType: asset.mimeType,
          size: asset.size,
          width: dimensions.width,
          height: dimensions.height,
        }),
      );
      setNotice("欧代实拍图已保存到本机通用模板，可批量复用。");
    } catch (error) {
      setNotice(formatConnectionError(error));
    } finally {
      setUploadingKey("");
    }
  };
  const reviewLabel = {
    0: "待提交",
    1: "平台侧通过",
    2: "通过",
    3: "驳回",
  };
  return (
    <div className="template-editor-stack">
      <section className="template-editor-section">
        <TemplateSectionHeading
          eyebrow="通用 + 单品分层"
          title="读取SKC实拍图要求"
          description="欧代/欧盟责任人实拍图可作为通用模板；其余槽位默认按目标 SKC 单独处理。"
          endpoint={endpoint.path}
        />
        {!bundle ? (
          <ApiEmptyState
            endpoint={endpoint}
            title="尚未取得实拍图清单"
            description="实拍图必须按目标SKC逐一处理，模板不能复用另一商品的图片或虚构固定拍摄位置。"
            fields={endpoint.responseFields}
          />
        ) : (
          <div className="compliance-rule-list">
            {requirements.map((requirement) => (
              <div
                className="compliance-rule-row"
                key={`${requirement.labelId}-${requirement.labelGroup}`}
              >
                <span>
                  <strong>{requirement.labelName}</strong>
                  <small>
                    labelId {requirement.labelId} ·{" "}
                    {String(requirement.labelGroup) === "1" ? "商品本体" : "外包装"}
                  </small>
                </span>
                <span>
                  <StatusChip
                    value={
                      isReusableEuRepPhoto(requirement)
                        ? "可通用模板"
                        : reviewLabel[requirement.reviewStatus] || "未知"
                    }
                  />
                  <small>
                    {isReusableEuRepPhoto(requirement)
                      ? "批量时复用同一欧代实拍图"
                      : Number(requirement.isRequired) === 1
                        ? "必传"
                        : "当前选传"}
                  </small>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="template-editor-section">
        <TemplateSectionHeading
          eyebrow="通用资料"
          title="欧代/欧盟责任人实拍图模板"
          description="同一张欧代信息实拍图可保存为本机模板，并映射到批量目标中返回的欧代 labelId。"
        />
        {!bundle ? (
          <div className="compliance-detail-empty">请先读取参照 SKC 要求。</div>
        ) : reusableRequirements.length ? (
          <div className="photo-assignment-grid">
            {reusableRequirements.map((requirement) => {
              const key = compliancePhotoKey(requirement);
              const assignment = assignments.find(
                (item) => compliancePhotoKey(item) === key,
              );
              return (
                <label className="compliance-file-slot" key={key}>
                  {uploadingKey === key ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Images size={18} />
                  )}
                  <span>
                    <strong>{requirement.labelName}</strong>
                    <small>
                      labelId {requirement.labelId} ·{" "}
                      {String(requirement.labelGroup) === "1"
                        ? "商品本体"
                        : "外包装"}{" "}
                      · 通用模板
                    </small>
                    {assignment && (
                      <small className="text-success">
                        已保存 {assignment.fileName}
                      </small>
                    )}
                  </span>
                  <input
                    accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                    type="file"
                    disabled={Boolean(uploadingKey)}
                    onChange={(event) => {
                      chooseReusablePhoto(
                        requirement,
                        event.target.files?.[0],
                      );
                      event.target.value = "";
                    }}
                  />
                </label>
              );
            })}
          </div>
        ) : (
          <DataEmptyState
            icon={Images}
            title="参照 SKC 没有欧代实拍图槽位"
            description="模板不猜 labelId；请换一个包含欧代实拍图要求的参照 SKC。"
          />
        )}
        {notice && (
          <div
            className={`inline-alert ${
              notice.includes("已保存")
                ? "inline-alert--success"
                : "inline-alert--amber"
            }`}
          >
            {notice.includes("已保存") ? (
              <CheckCircle2 size={16} />
            ) : (
              <AlertCircle size={16} />
            )}
            <span>{notice}</span>
          </div>
        )}
      </section>

      <section className="template-editor-section">
        <TemplateSectionHeading
          eyebrow="识别元素"
          title="文档规定的实拍图执行顺序"
          description="只有查询接口返回的labelId才能进入上传与绑定步骤。"
        />
        <div className="documented-flow">
          {[
            ["1", "查询要求", "/open-api/goods-compliance/skc-label-list"],
            ["2", "上传图片", "/open-api/goods-compliance/upload-skc-label-picture"],
            ["3", "保存绑定", "/open-api/goods-compliance/skc-save-label"],
            ["4", "重新查询", "/open-api/goods-compliance/skc-label-list"],
          ].map(([number, title, path]) => (
            <div key={`${number}-${path}`}>
              <i>{number}</i>
              <span><strong>{title}</strong><code>{path}</code></span>
            </div>
          ))}
        </div>
        <div className="template-facts">
          <div><strong>labelGroup=1</strong><span>商品本体</span></div>
          <div><strong>labelGroup=2</strong><span>外包装</span></div>
          <div><strong>isRequired=10</strong><span>瞬时未知状态，延迟后重新查询</span></div>
        </div>
        <div className="inline-alert inline-alert--amber">
          <AlertCircle size={17} />
          <span><strong>审核状态枚举不同</strong>查询入参 reviewStatusList 与响应 reviewStatus 不是同一组枚举，代码必须分别建模，不能共用。</span>
        </div>
      </section>
    </div>
  );
}

async function readImageDimensions(file) {
  if ("createImageBitmap" in window) {
    const bitmap = await window.createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      reject(new Error("IMAGE_DECODE_FAILED"));
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

async function parsePublishFolders(fileList, mode) {
  const imageFiles = Array.from(fileList).filter(
    (file) =>
      file.type.startsWith("image/") ||
      /\.(jpe?g|png)$/i.test(file.name),
  );
  const groups = new Map();

  const inspectedFiles = await Promise.all(
    imageFiles.map(async (file, index) => {
      const type = classifyPublishImage(file.name);
      let dimensions = { width: 0, height: 0 };
      try {
        dimensions = await readImageDimensions(file);
      } catch {
        dimensions = { width: 0, height: 0 };
      }
      return {
        id: `${file.webkitRelativePath || file.name}-${index}`,
        file,
        type,
        width: dimensions.width,
        height: dimensions.height,
        sizeLabel: formatImageSize(file.size),
        previewUrl: URL.createObjectURL(file),
        issues: validatePublishImage(
          file,
          type,
          dimensions.width,
          dimensions.height,
        ),
      };
    }),
  );

  inspectedFiles.forEach((image) => {
    const { file } = image;
    const path = file.webkitRelativePath || file.name;
    const parts = path.split("/").filter(Boolean);
    const productFolder =
      mode === "batch" && parts.length >= 3
        ? parts[1]
        : parts.length >= 2
          ? parts[0]
          : "未命名商品";
    const current = groups.get(productFolder) || {
      name: productFolder,
      files: [],
    };
    current.files.push(image);
    groups.set(productFolder, current);
  });

  return Array.from(groups.values()).map(buildPublishProduct);
}

function PublishFlowSteps({ step }) {
  const current =
    {
      edit: 1,
      fields: 2,
      checking: 3,
      ready: 4,
    }[step] || 1;
  const items = ["文件夹与图片", "商品字段", "API 预检", "保存任务"];

  return (
    <div className="publish-flow" aria-label="商品发布步骤">
      {items.map((label, index) => {
        const order = index + 1;
        return (
          <span
            className={`${order === current ? "is-active" : ""} ${
              order < current ? "is-done" : ""
            }`}
            key={label}
          >
            <i>{order < current ? <Check size={12} /> : order}</i>
            <strong>{label}</strong>
          </span>
        );
      })}
    </div>
  );
}

function PublishDialog({
  store,
  template,
  initialMode = "single",
  onClose,
}) {
  const [mode, setMode] = useState(initialMode);
  const [step, setStep] = useState("edit");
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [products, setProducts] = useState([]);
  const [isParsing, setIsParsing] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);
  const [reuseMainImage, setReuseMainImage] = useState(true);
  const [mainImageTemplates, setMainImageTemplates] = useState([]);
  const [selectedMainImageTemplateId, setSelectedMainImageTemplateId] =
    useState("");
  const [sizeTemplates, setSizeTemplates] = useState([]);
  const [selectedSizeTemplateId, setSelectedSizeTemplateId] = useState("");
  const [attributeTemplates, setAttributeTemplates] = useState([]);
  const [selectedAttributeTemplateId, setSelectedAttributeTemplateId] =
    useState("");
  const [publishAttributeInfo, setPublishAttributeInfo] = useState(null);
  const [publishStandardInfo, setPublishStandardInfo] = useState(null);
  const [productDraftInputs, setProductDraftInputs] = useState({});
  const [productAttributeOverrides, setProductAttributeOverrides] = useState({});
  const [skuDraftInputs, setSkuDraftInputs] = useState({});
  const [packagingMaterial, setPackagingMaterial] = useState("");
  const [gramsPerSquareMeter, setGramsPerSquareMeter] = useState("");
  const [resolvedSkuPackages, setResolvedSkuPackages] = useState([]);
  const [publishRuleNotice, setPublishRuleNotice] = useState("");
  const [publishAssetsLoading, setPublishAssetsLoading] = useState(false);
  const [preflightResult, setPreflightResult] = useState(null);
  const folderInput = useRef(null);
  const businessMode = "full";

  useEffect(() => {
    let cancelled = false;
    const loadPublishAssets = async () => {
      if (!store?.id) return;
      setPublishAssetsLoading(true);
      try {
        const [
          mainImageResult,
          sizeResult,
          attributeTemplateResult,
          attributeSchemaResult,
          publishStandardResult,
        ] = await Promise.all([
          requestLocalApi(
            `/api/main-image-templates?storeId=${encodeURIComponent(store.id)}`,
          ),
          template.productTypeId
            ? requestLocalApi(
                `/api/size-templates?storeId=${encodeURIComponent(
                  store.id,
                )}&productTypeId=${encodeURIComponent(template.productTypeId)}`,
              )
            : Promise.resolve({ templates: [] }),
          template.productTypeId
            ? requestLocalApi(
                `/api/attribute-templates?storeId=${encodeURIComponent(
                  store.id,
                )}&productTypeId=${encodeURIComponent(template.productTypeId)}`,
              )
            : Promise.resolve({ templates: [] }),
          template.productTypeId
            ? requestLocalApi(
                `/api/shein/stores/${encodeURIComponent(
                  store.id,
                )}/template/attributes`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    productTypeId: template.productTypeId,
                  }),
                },
              )
            : Promise.resolve({ info: null }),
          template.categoryId
            ? requestLocalApi(
                `/api/shein/stores/${encodeURIComponent(
                  store.id,
                )}/template/publish-standard`,
                {
                  method: "POST",
                  body: JSON.stringify({ categoryId: template.categoryId }),
                },
              )
            : Promise.resolve({ info: null }),
        ]);
        if (cancelled) return;

        const nextMainImageTemplates = mainImageResult.templates || [];
        const fetchedSizeTemplates = sizeResult.templates || [];
        const hasReferencedTemplate = fetchedSizeTemplates.some(
          (item) => String(item.id) === String(template.sizeTemplateId),
        );
        const embeddedSizeTemplate =
          template.sizeRows?.length && !hasReferencedTemplate
            ? {
                id: template.sizeTemplateId || "embedded-size-template",
                name: template.sizeTemplateName || `${template.name}内置尺寸`,
                rows: template.sizeRows,
                shape: template.sizeTemplateShape || "rectangle",
                packagingWorkbook: template.packagingWorkbook || null,
              }
            : null;
        const nextSizeTemplates = embeddedSizeTemplate
          ? [embeddedSizeTemplate, ...fetchedSizeTemplates]
          : fetchedSizeTemplates;

        setMainImageTemplates(nextMainImageTemplates);
        setSizeTemplates(nextSizeTemplates);
        const fetchedAttributeTemplates =
          attributeTemplateResult.templates || [];
        const embeddedAttributeTemplate =
          Object.keys(template.attributeValues || {}).length ||
          (template.perProductFieldIds || []).length
            ? {
                id: "embedded-attribute-template",
                name: `${template.name}内置属性`,
                attributeValues: template.attributeValues || {},
                perProductFieldIds: template.perProductFieldIds || [],
              }
            : null;
        const nextAttributeTemplates = embeddedAttributeTemplate
          ? [embeddedAttributeTemplate, ...fetchedAttributeTemplates]
          : fetchedAttributeTemplates;
        setAttributeTemplates(nextAttributeTemplates);
        setSelectedAttributeTemplateId(
          nextAttributeTemplates.length
            ? String(nextAttributeTemplates[0].id)
            : "",
        );
        setPublishAttributeInfo(attributeSchemaResult.info || null);
        setPublishStandardInfo(publishStandardResult.info || null);
        if (nextSizeTemplates.length) {
          const referencedTemplate = nextSizeTemplates.find(
            (item) => String(item.id) === String(template.sizeTemplateId),
          );
          setSelectedSizeTemplateId(
            String(referencedTemplate?.id || nextSizeTemplates[0].id),
          );
        }
      } catch (error) {
        if (!cancelled) setPublishRuleNotice(formatConnectionError(error));
      } finally {
        if (!cancelled) setPublishAssetsLoading(false);
      }
    };

    loadPublishAssets();
    return () => {
      cancelled = true;
    };
  }, [
    store?.id,
    template.categoryId,
    template.productTypeId,
    template.sizeTemplateId,
  ]);

  useEffect(
    () => () => {
      products.forEach((product) => {
        product.files.forEach((image) => {
          if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
        });
      });
    },
    [products],
  );

  const resetImport = (nextMode) => {
    setMode(nextMode);
    setProducts([]);
    setFolderName("");
    setFolderError("");
    setEditingProductId(null);
    setResolvedSkuPackages([]);
    setProductDraftInputs({});
    setProductAttributeOverrides({});
    setSkuDraftInputs({});
    setPublishRuleNotice("");
    setPreflightResult(null);
    setStep("edit");
  };

  const handleFolder = async (event) => {
    const files = event.target.files;
    if (!files.length) return;
    const firstPath = files[0]?.webkitRelativePath || "";
    setFolderName(firstPath.split("/")[0] || "已选文件夹");
    setFolderError("");
    setIsParsing(true);
    try {
      const parsed = await parsePublishFolders(files, mode);
      setProducts(parsed);
      setProductDraftInputs(
        Object.fromEntries(
          parsed.map((product, index) => {
            const inferredCode = product.name
              .toUpperCase()
              .replace(/[^A-Z0-9]+/g, "-")
              .replace(/^-|-$/g, "")
              .slice(0, 32) || `PRODUCT-${index + 1}`;
            return [
              product.id,
              {
                title: product.name,
                supplierCode: inferredCode,
                costPrice: "",
                inventoryNum: "0",
                shelfWay: "1",
                shelfRequire: "1",
                stopPurchase: "1",
                mallState: "1",
                spotFlag: "1",
                skcSaleAttributeId: "",
                skcSaleAttributeValueId: "",
              },
            ];
          }),
        ),
      );
      setFolderError(
        parsed.length
          ? ""
          : "文件夹中没有可识别的 JPG、JPEG 或 PNG 图片。",
      );
    } catch {
      setProducts([]);
      setFolderError("文件夹读取失败，请检查图片文件后重试。");
    } finally {
      setIsParsing(false);
      event.target.value = "";
    }
  };

  const updateImageType = (productId, imageId, nextType) => {
    setProducts((current) =>
      current.map((product, index) => {
        if (product.id !== productId) return product;
        const nextFiles = product.files.map((image) =>
          image.id === imageId
            ? {
                ...image,
                type: nextType,
                issues: validatePublishImage(
                  image.file,
                  nextType,
                  image.width,
                  image.height,
                ),
              }
            : image,
        );
        return buildPublishProduct(
          { ...product, files: nextFiles, id: product.id },
          index,
        );
      }),
    );
  };

  const validate = () => {
    if (!products.length) {
      setFolderError(
        mode === "batch"
          ? "请先选择包含商品子文件夹的批量根目录。"
          : "请先选择一个商品文件夹。",
      );
      return;
    }
    const blockerCount = products.reduce(
      (sum, product) => sum + product.blockers.length,
      0,
    );
    const productsWithoutSkuImages = products.filter(
      (product) => !product.sku.length,
    ).length;
    if (blockerCount) {
      setFolderError(
        `还有 ${blockerCount} 个图片问题，请进入对应商品调整映射或更换图片。`,
      );
      return;
    }
    if (!reuseMainImage && productsWithoutSkuImages) {
      setFolderError(
        `有 ${productsWithoutSkuImages} 个商品没有独立 SKU 图，请上传 SKU 图或开启引用主图。`,
      );
      return;
    }
    if (selectedSizeTemplateId && !resolvedSkuPackages.length) {
      setFolderError("已选择尺寸模板，请先选择材质并执行“一键解析SKU包装”。");
      return;
    }
    setFolderError("");
    setStep("fields");
  };
  const totalImages = products.reduce(
    (sum, product) => sum + product.files.length,
    0,
  );
  const validProducts = products.filter(
    (product) =>
      !product.blockers.length &&
      (reuseMainImage || product.sku.length > 0),
  ).length;
  const editingProduct = products.find(
    (product) => product.id === editingProductId,
  );
  const selectedMainImageTemplate = useMemo(
    () =>
      mainImageTemplates.find(
        (item) => String(item.id) === String(selectedMainImageTemplateId),
      ) || null,
    [mainImageTemplates, selectedMainImageTemplateId],
  );
  const selectedSizeTemplate = useMemo(
    () =>
      sizeTemplates.find(
        (item) => String(item.id) === String(selectedSizeTemplateId),
      ) || null,
    [sizeTemplates, selectedSizeTemplateId],
  );
  const selectedAttributeTemplate = useMemo(
    () =>
      attributeTemplates.find(
        (item) =>
          String(item.id) === String(selectedAttributeTemplateId),
      ) || null,
    [attributeTemplates, selectedAttributeTemplateId],
  );
  const publishStandardRecord = useMemo(
    () => getPublishStandardRecord(publishStandardInfo),
    [publishStandardInfo],
  );
  const publishAttributeFields = useMemo(
    () =>
      publishAttributeInfo && template.productTypeId
        ? buildAttributeFields(
            publishAttributeInfo,
            template.productTypeId,
          )
        : [],
    [publishAttributeInfo, template.productTypeId],
  );
  const productAttributeFields = useMemo(
    () =>
      publishAttributeFields.filter((field) =>
        [3, 4].includes(field.typeCode),
      ),
    [publishAttributeFields],
  );
  const sizeAttributeFields = useMemo(
    () =>
      publishAttributeFields.filter((field) => field.typeCode === 2),
    [publishAttributeFields],
  );
  const mainSaleAttributeFields = useMemo(
    () =>
      publishAttributeFields.filter(
        (field) =>
          field.typeCode === 1 && Number(field.labelCode) === 1,
      ),
    [publishAttributeFields],
  );
  const packagingMaterials = Object.keys(
    selectedSizeTemplate?.packagingWorkbook?.materials || {},
  );
  const publishRows = resolvedSkuPackages.length
    ? resolvedSkuPackages
    : selectedSizeTemplate?.rows || [];

  const updateProductDraftInput = (productId, key, value) => {
    setProductDraftInputs((current) => ({
      ...current,
      [productId]: {
        ...(current[productId] || {}),
        [key]: value,
      },
    }));
  };

  const updateProductAttributeOverride = (productId, fieldId, value) => {
    setProductAttributeOverrides((current) => ({
      ...current,
      [productId]: {
        ...(current[productId] || {}),
        [String(fieldId)]: value,
      },
    }));
  };

  const updateSkuDraftInput = (productId, rowKey, key, value) => {
    setSkuDraftInputs((current) => ({
      ...current,
      [productId]: {
        ...(current[productId] || {}),
        [rowKey]: {
          ...(current[productId]?.[rowKey] || {}),
          [key]: value,
        },
      },
    }));
  };

  const productDrafts = useMemo(
    () =>
      products.map((product, productIndex) => {
        const fields = productDraftInputs[product.id] || {};
        const skuInputs = Object.fromEntries(
          (publishRows.length ? publishRows : [{ id: "single-sku" }]).map(
            (row, rowIndex) => {
              const rowKey = String(
                row.id || row.sheinValueId || rowIndex,
              );
              const sizeSuffix = String(
                row.sheinValueLabel || row.name || rowIndex + 1,
              )
                .toUpperCase()
                .replace(/[^A-Z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 36);
              const stored = skuDraftInputs[product.id]?.[rowKey] || {};
              return [
                rowKey,
                {
                  supplierSku:
                    stored.supplierSku ??
                    `${fields.supplierCode || `PRODUCT-${productIndex + 1}`}-${
                      sizeSuffix || rowIndex + 1
                    }`,
                  costPrice: stored.costPrice ?? fields.costPrice ?? "",
                  inventoryNum:
                    stored.inventoryNum ?? fields.inventoryNum ?? "0",
                  length: stored.length ?? "",
                  width: stored.width ?? "",
                  height: stored.height ?? "",
                  weight: stored.weight ?? "",
                  mallState: fields.mallState || "1",
                  stopPurchase: fields.stopPurchase || "1",
                },
              ];
            },
          ),
        );
        const draft = buildNewProductDraft({
          categoryId: template.categoryId,
          productTypeId: template.productTypeId,
          defaultLanguage: publishStandardRecord?.default_language || "",
          currency: publishStandardRecord?.currency || "",
          product,
          productFields: fields,
          attributeFields: productAttributeFields,
          attributeTemplate: selectedAttributeTemplate,
          attributeOverrides:
            productAttributeOverrides[product.id] || {},
          sizeRows: publishRows,
          sizeAttributeFields,
          skuInputs,
          tailTemplate: selectedMainImageTemplate,
          pictureConfig:
            publishStandardRecord?.picture_config_list || [],
          fillStandardList:
            publishStandardRecord?.fill_in_standard_list || [],
          weightConfig: publishStandardRecord?.weight_config || null,
          dimensionConfig:
            publishStandardRecord?.length_width_height_config || null,
          businessMode,
        });
        const schemaBlockers = [];
        if (!publishAttributeInfo) {
          schemaBlockers.push("尚未读取当前类目的SHEIN属性");
        }
        if (!publishStandardRecord) {
          schemaBlockers.push("尚未读取当前类目的SHEIN发布规范");
        }
        if (!selectedAttributeTemplate) {
          schemaBlockers.push("尚未选择商品属性模板");
        }
        return {
          ...draft,
          blockers: Array.from(
            new Set([...schemaBlockers, ...draft.blockers]),
          ),
          readyForPreflight:
            schemaBlockers.length === 0 && draft.readyForPreflight,
        };
      }),
    [
      products,
      productDraftInputs,
      skuDraftInputs,
      productAttributeOverrides,
      publishRows,
      template.categoryId,
      template.productTypeId,
      publishStandardRecord,
      publishAttributeInfo,
      productAttributeFields,
      sizeAttributeFields,
      selectedAttributeTemplate,
      selectedMainImageTemplate,
    ],
  );
  const draftBlockerCount = productDrafts.reduce(
    (sum, draft) => sum + draft.blockers.length,
    0,
  );

  const selectSizeTemplate = (id) => {
    setSelectedSizeTemplateId(id);
    setPackagingMaterial("");
    setResolvedSkuPackages([]);
    setPublishRuleNotice("");
  };

  const resolveSkuPackages = () => {
    if (!selectedSizeTemplate) {
      setPublishRuleNotice("请先选择尺寸模板。");
      return;
    }
    if (!selectedSizeTemplate.packagingWorkbook) {
      setPublishRuleNotice("该尺寸模板没有打包体积表，请回到模板库上传并保存。");
      return;
    }
    if (!packagingMaterial) {
      setPublishRuleNotice("请选择本次商品对应的材质。");
      return;
    }
    if (!(Number(gramsPerSquareMeter) > 0)) {
      setPublishRuleNotice("请输入大于0的每平方米克重，用于计算各SKU克重。");
      return;
    }

    const resolved = enrichSizeRows(selectedSizeTemplate.rows || [], {
      materialRows:
        selectedSizeTemplate.packagingWorkbook.materials[packagingMaterial] ||
        [],
      gramsPerSquareMeter,
    });
    setResolvedSkuPackages(resolved);
    const matchedCount = resolved.filter(
      (row) => row.packageMatch === "matched",
    ).length;
    setPublishRuleNotice(
      `已解析 ${resolved.length} 个SKU：${matchedCount} 个匹配打包体积，${
        resolved.length - matchedCount
      } 个待补充。`,
    );
  };
  const preflightPlan = useMemo(
    () =>
      createPublishPreflightPlan({
        businessMode,
        hasCategory: Boolean(template.categoryId),
        hasAttributes: Boolean(publishAttributeInfo),
        hasImages: products.length > 0,
      }),
    [
      businessMode,
      products.length,
      template.categoryId,
      publishAttributeInfo,
    ],
  );

  const buildPreflight = async () => {
    if (draftBlockerCount) {
      setPublishRuleNotice(
        `当前还有 ${draftBlockerCount} 个发品阻断项，请先完成每个商品和SKU的必填字段。`,
      );
      return;
    }
    const supplierSkuList = productDrafts.flatMap((draft) =>
      (draft.payload.skc_list?.[0]?.sku_list || []).map(
        (sku) => sku.supplier_sku,
      ),
    );
    setPublishRuleNotice("");
    setPreflightResult(null);
    setStep("checking");
    try {
      const result = await requestLocalApi(
        `/api/shein/stores/${encodeURIComponent(
          store.id,
        )}/publish/preflight`,
        {
          method: "POST",
          body: JSON.stringify({ supplierSkuList }),
        },
      );
      setPreflightResult(result);
      setStep("ready");
    } catch (error) {
      setPublishRuleNotice(formatConnectionError(error));
      setStep("fields");
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal publish-modal">
        <div className="modal__head">
          <div>
            <span className="eyebrow">SHEIN API 文档驱动</span>
            <h2>商品发布工作台</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <PublishFlowSteps step={step} />
        {step === "edit" && (
          <div className="modal__body">
            <div className="publish-template-summary">
              <span className="template-name__icon"><ShoppingBag size={19} /></span>
              <span>
                <strong>{template.name}</strong>
                <small>{template.scope} · {template.content}</small>
              </span>
              <StatusChip value="可用" />
            </div>
            <div className="segmented segmented--two">
              <button
                className={mode === "single" ? "is-active" : ""}
                type="button"
                onClick={() => resetImport("single")}
              >
                <ShoppingBag size={16} /> 单个发品
              </button>
              <button
                className={mode === "batch" ? "is-active" : ""}
                type="button"
                onClick={() => resetImport("batch")}
              >
                <FolderTree size={16} /> 批量发品
              </button>
            </div>

            <input
              ref={folderInput}
              className="visually-hidden"
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              multiple
              webkitdirectory=""
              directory=""
              onChange={handleFolder}
            />

            {isParsing ? (
              <div className="folder-import folder-import--loading">
                <LoaderCircle size={28} className="spin" />
                <strong>正在读取图片尺寸并匹配 SHEIN 槽位</strong>
                <span>所有图片仅在本地解析，暂不上传</span>
              </div>
            ) : !products.length ? (
              <button
                className={`folder-import ${folderError ? "has-error" : ""}`}
                type="button"
                onClick={() => folderInput.current?.click()}
              >
                <span className="folder-import__icon">
                  {mode === "batch" ? <FolderTree size={26} /> : <FolderOpen size={26} />}
                </span>
                <strong>
                  {mode === "batch"
                    ? "选择批量商品根目录"
                    : "选择一个商品文件夹"}
                </strong>
                <span>
                  {mode === "batch"
                    ? "每个子文件夹识别为一个商品"
                    : "读取文件夹内的主图、详情图、色块图与 SKU 图"}
                </span>
                <small>支持 JPG、JPEG、PNG，图片在本地预检后再上传 SHEIN</small>
              </button>
            ) : (
              <div className="folder-result">
                <div className="folder-result__head">
                  <span>
                    <FolderOpen size={17} />
                    <strong>{folderName}</strong>
                    <small>
                      已识别 {products.length} 个商品 · {totalImages} 张图片
                    </small>
                  </span>
                  <button
                    className="button button--secondary button--small"
                    type="button"
                    onClick={() => folderInput.current?.click()}
                  >
                    <RefreshCw size={14} /> 重新选择
                  </button>
                </div>
                <div className="folder-product-list">
                  {products.map((product) => (
                    <div className="folder-product-row" key={product.id}>
                      <span className="folder-product-thumb">
                        {product.previewUrl ? (
                          <img src={product.previewUrl} alt="" />
                        ) : (
                          <Images size={19} />
                        )}
                      </span>
                      <span className="folder-product-name">
                        <strong>{product.name}</strong>
                        <small>
                          {product.files.length} 张图片 ·{" "}
                          {product.blockers.length
                            ? `${product.blockers.length} 个问题`
                            : "本地校验通过"}
                        </small>
                      </span>
                      <span className="folder-image-counts">
                        <small>
                          主图{" "}
                          {
                            appendTailMainImages(
                              product.main,
                              selectedMainImageTemplate,
                            ).images.length
                          }
                        </small>
                        {selectedMainImageTemplate && (
                          <small className="is-template-tail">
                            含尾图 {selectedMainImageTemplate.images?.length || 0}
                          </small>
                        )}
                        <small>细节 {product.detail.length}</small>
                        <small>详情 {product.description.length}</small>
                        <small>色块 {product.swatch.length}</small>
                      </span>
                      <span className="folder-sku-source">
                        <Link2 size={14} />
                        <small>SKU 预览</small>
                        <strong>{product.skuImageSource}</strong>
                      </span>
                      <StatusChip
                        value={product.blockers.length ? "需修正" : "可提交"}
                      />
                      <button
                        className="icon-button icon-button--small"
                        type="button"
                        title="调整图片映射"
                        onClick={() => setEditingProductId(product.id)}
                      >
                        <SlidersHorizontal size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {products.length > 0 && (
              <section className="publish-reuse-rules">
                <div className="publish-reuse-rules__heading">
                  <span>
                    <strong>复用规则</strong>
                    <small>
                      只读取当前店铺、当前类目已保存的属性与尺寸模板
                    </small>
                  </span>
                  {publishAssetsLoading && (
                    <LoaderCircle className="spin" size={17} />
                  )}
                </div>
                <div className="publish-reuse-grid">
                  <div className="publish-reuse-panel">
                    <label className="form-field">
                      <span>尾部主图模板</span>
                      <select
                        value={selectedMainImageTemplateId}
                        onChange={(event) =>
                          setSelectedMainImageTemplateId(event.target.value)
                        }
                      >
                        <option value="">不追加尾部主图</option>
                        {mainImageTemplates.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {item.images?.length || 0}张
                          </option>
                        ))}
                      </select>
                      <small>
                        商品文件夹主图保持原顺序，模板图固定追加为最后几张，
                        最终类型按当前类目的新旧图片方案生成。
                      </small>
                    </label>
                    {selectedMainImageTemplate ? (
                      <div className="publish-tail-preview">
                        {selectedMainImageTemplate.images.map((image, index) => (
                          <span key={image.id || image.url}>
                            <img src={image.url} alt="" />
                            <i>尾{index + 1}</i>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="publish-rule-empty">
                        <Images size={17} />
                        <span>未选择时只使用商品文件夹中的主图</span>
                      </div>
                    )}
                  </div>

                  <div className="publish-reuse-panel">
                    <label className="form-field">
                      <span>商品属性模板</span>
                      <select
                        value={selectedAttributeTemplateId}
                        onChange={(event) =>
                          setSelectedAttributeTemplateId(event.target.value)
                        }
                      >
                        <option value="">请选择商品属性模板</option>
                        {attributeTemplates.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ·{" "}
                            {
                              Object.keys(item.attributeValues || {})
                                .length
                            }
                            项模板值
                          </option>
                        ))}
                      </select>
                      <small>
                        模板中的通用属性直接复用；标记为单品填写的字段会在下一步逐商品展开。
                      </small>
                    </label>
                    {selectedAttributeTemplate ? (
                      <div className="publish-rule-empty">
                        <CheckCircle2 size={17} />
                        <span>
                          已选择“{selectedAttributeTemplate.name}”，
                          {selectedAttributeTemplate.perProductFieldIds
                            ?.length || 0}
                          项需单品填写
                        </span>
                      </div>
                    ) : (
                      <div className="publish-rule-empty">
                        <AlertCircle size={17} />
                        <span>没有属性模板时不能进入正式预检</span>
                      </div>
                    )}
                  </div>

                  <div className="publish-reuse-panel">
                    <div className="publish-package-controls">
                      <label className="form-field">
                        <span>SKU尺寸模板</span>
                        <select
                          value={selectedSizeTemplateId}
                          onChange={(event) =>
                            selectSizeTemplate(event.target.value)
                          }
                        >
                          <option value="">不使用尺寸模板</option>
                          {sizeTemplates.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · {item.rows?.length || 0}个SKU
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-field">
                        <span>材质</span>
                        <select
                          disabled={!packagingMaterials.length}
                          value={packagingMaterial}
                          onChange={(event) => {
                            setPackagingMaterial(event.target.value);
                            setResolvedSkuPackages([]);
                          }}
                        >
                          <option value="">
                            {packagingMaterials.length
                              ? "选择打包体积表中的材质"
                              : "尺寸模板未上传打包体积表"}
                          </option>
                          {packagingMaterials.map((material) => (
                            <option key={material} value={material}>
                              {material}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-field">
                        <span>每平方米克重（g/m²）</span>
                        <input
                          inputMode="decimal"
                          min="0"
                          type="number"
                          placeholder="例如 850"
                          value={gramsPerSquareMeter}
                          onChange={(event) => {
                            setGramsPerSquareMeter(event.target.value);
                            setResolvedSkuPackages([]);
                          }}
                        />
                      </label>
                      <button
                        className="button button--primary"
                        type="button"
                        disabled={
                          !selectedSizeTemplate ||
                          !packagingMaterial ||
                          !(Number(gramsPerSquareMeter) > 0)
                        }
                        onClick={resolveSkuPackages}
                      >
                        <Sparkles size={16} /> 一键解析SKU包装
                      </button>
                    </div>
                    <small className="publish-package-formula">
                      矩形按宽×长计算面积；圆形按当前约定的直径×直径计算。SKU克重=面积×每平方米克重。
                    </small>
                  </div>
                </div>

                {publishRuleNotice && (
                  <div
                    className={`inline-alert ${
                      /没有|请|待补充|失败/.test(publishRuleNotice)
                        ? "inline-alert--amber"
                        : "inline-alert--success"
                    }`}
                  >
                    {/没有|请|待补充|失败/.test(publishRuleNotice) ? (
                      <AlertCircle size={16} />
                    ) : (
                      <CheckCircle2 size={16} />
                    )}
                    <span>{publishRuleNotice}</span>
                  </div>
                )}

                {resolvedSkuPackages.length > 0 && (
                  <div className="publish-package-result">
                    <div className="publish-package-result__head">
                      <span>SKU尺寸</span>
                      <span>打包长×宽×高（cm）</span>
                      <span>面积</span>
                      <span>计算克重</span>
                      <span>匹配状态</span>
                    </div>
                    {resolvedSkuPackages.slice(0, 8).map((row) => (
                      <div
                        className="publish-package-result__row"
                        key={row.id || row.sheinValueId || row.name}
                      >
                        <strong>{row.sheinValueLabel || row.name}</strong>
                        <span>
                          {row.packageMatch === "matched"
                            ? `${row.packageLengthCm}×${row.packageWidthCm}×${row.packageHeightCm}`
                            : "未匹配"}
                        </span>
                        <span>{row.areaSquareMeters ?? "-"} m²</span>
                        <span>{row.weightGrams ?? "-"} g</span>
                        <span
                          className={
                            row.packageMatch === "matched"
                              ? "is-matched"
                              : "is-missing"
                          }
                        >
                          {row.packageMatch === "matched"
                            ? "已匹配"
                            : "待补充"}
                        </span>
                      </div>
                    ))}
                    {resolvedSkuPackages.length > 8 && (
                      <div className="publish-package-result__more">
                        另有 {resolvedSkuPackages.length - 8} 个SKU已解析
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {folderError && (
              <div className="folder-error">
                <AlertCircle size={15} />
                <span>{folderError}</span>
              </div>
            )}

            {products.length > 0 && mode === "single" && (
              <label className="folder-option folder-option--wide">
                <input
                  type="checkbox"
                  checked={reuseMainImage}
                  onChange={(event) =>
                    setReuseMainImage(event.target.checked)
                  }
                />
                <span>
                  <strong>缺少独立 SKU 图时引用商品首图</strong>
                  <small>
                    标题、商家货号、主销售属性与逐SKU供应信息在下一步填写
                  </small>
                </span>
              </label>
            )}

            {products.length > 0 && mode === "batch" && (
              <label className="folder-option folder-option--wide">
                <input
                  type="checkbox"
                  checked={reuseMainImage}
                  onChange={(event) => setReuseMainImage(event.target.checked)}
                />
                <span>
                  <strong>缺少独立 SKU 图时，自动引用各商品主图 1</strong>
                  <small>可在提交前逐个商品调整图片映射和销售属性</small>
                </span>
              </label>
            )}

            {products.length > 0 && (
              <div className="folder-validation-summary">
                <span>
                  <CheckCircle2 size={15} />
                  <strong>{validProducts}</strong> 个商品可提交
                </span>
                <span className={products.length - validProducts ? "has-error" : ""}>
                  <AlertCircle size={15} />
                  <strong>{products.length - validProducts}</strong> 个商品需修正
                </span>
                <small>校验依据：当前 SHEIN 图片类型规范</small>
              </div>
            )}

            <div className="publish-api-checks">
              <strong>下一步按接口读取</strong>
              <span><Database size={15} /> 店铺发品权限与上架额度</span>
              <span><Database size={15} /> 末级类目、字段规范与默认语种</span>
              <span><Database size={15} /> 商品属性、销售属性与关联规则</span>
              <span><Database size={15} /> 商家 SKU 唯一性与图片上传</span>
            </div>
          </div>
        )}
        {step === "fields" && (
          <div className="modal__body publish-contract">
            <div className="contract-banner contract-banner--ready">
              <ClipboardCheck size={20} />
              <span>
                <strong>真实类目字段已装配为发品草稿</strong>
                <small>
                  每个商品、每个SKU独立校验；本地图片只生成上传队列，尚未传给SHEIN。
                </small>
              </span>
              <StatusChip
                value={draftBlockerCount ? "需补充" : "草稿完整"}
              />
            </div>

            <section className="contract-section">
              <div className="contract-section__head">
                <span>
                  <strong>店铺与类目上下文</strong>
                  <small>先确定类目，再获取字段规范和属性</small>
                </span>
                <code>/goods/query-category-tree</code>
              </div>
              <div className="api-context-grid">
                <div>
                  <span>业务模式</span>
                  <strong>{BUSINESS_MODE_LABELS[businessMode]}</strong>
                </div>
                <div>
                  <span>末级类目 / product_type_id</span>
                  <strong>
                    {template.categoryId} / {template.productTypeId}
                  </strong>
                </div>
                <div>
                  <span>默认语种 / 供货价币种</span>
                  <strong>
                    {publishStandardRecord?.default_language || "未返回"} /{" "}
                    {publishStandardRecord?.currency || "未返回"}
                  </strong>
                </div>
                <div>
                  <span>图片方案</span>
                  <strong>
                    {publishStandardRecord?.picture_config_list?.find(
                      (item) => item.field_key === "switch_spu_picture",
                    )?.is_true
                      ? "新版 SPU 图片"
                      : "旧版 SKC 图片"}
                  </strong>
                </div>
              </div>
            </section>

            <section className="contract-section">
              <div className="contract-section__head">
                <span>
                  <strong>
                    {mode === "batch" ? "批量商品草稿" : "单个商品草稿"}
                  </strong>
                  <small>
                    属性模板、主销售属性、尺寸SKU、包装、供货价与库存全部按商品隔离
                  </small>
                </span>
                <code>{productDrafts.length} 个商品</code>
              </div>
              <div className="publish-draft-list">
                {products.map((product, index) => (
                  <PublishProductDraftEditor
                    key={product.id}
                    businessMode={businessMode}
                    currency={publishStandardRecord?.currency || ""}
                    draft={productDrafts[index]}
                    index={index}
                    input={productDraftInputs[product.id] || {}}
                    mainSaleFields={mainSaleAttributeFields}
                    mode={mode}
                    onAttributeOverride={(fieldId, value) =>
                      updateProductAttributeOverride(
                        product.id,
                        fieldId,
                        value,
                      )
                    }
                    onInput={(key, value) =>
                      updateProductDraftInput(product.id, key, value)
                    }
                    onSkuInput={(rowKey, key, value) =>
                      updateSkuDraftInput(
                        product.id,
                        rowKey,
                        key,
                        value,
                      )
                    }
                    overrides={
                      productAttributeOverrides[product.id] || {}
                    }
                    perProductFields={productAttributeFields.filter((field) =>
                      selectedAttributeTemplate?.perProductFieldIds
                        ?.map(String)
                        .includes(String(field.id)),
                    )}
                    product={product}
                    rawSkuInputs={skuDraftInputs[product.id] || {}}
                  />
                ))}
              </div>
            </section>

            <div
              className={`folder-validation-summary ${
                draftBlockerCount ? "has-error" : ""
              }`}
            >
              <span>
                <CheckCircle2 size={15} />
                <strong>
                  {
                    productDrafts.filter(
                      (draft) => draft.readyForPreflight,
                    ).length
                  }
                </strong>{" "}
                个商品草稿完整
              </span>
              <span className={draftBlockerCount ? "has-error" : ""}>
                <AlertCircle size={15} />
                <strong>{draftBlockerCount}</strong> 个阻断项
              </span>
              <small>
                图片上传队列{" "}
                {productDrafts.reduce(
                  (sum, draft) => sum + draft.pendingUploadCount,
                  0,
                )}{" "}
                张，正式预检前仍保留在本地
              </small>
            </div>
            {publishRuleNotice && (
              <div className="inline-alert inline-alert--amber">
                <AlertCircle size={16} />
                <span>{publishRuleNotice}</span>
              </div>
            )}
          </div>
        )}
        {step === "checking" && (
          <div className="recognition-loading">
            <LoaderCircle size={30} className="spin" />
            <strong>正在执行 SHEIN 真实发品预检</strong>
            <span>校验店铺发品权限与商家SKU唯一性...</span>
          </div>
        )}
        {step === "ready" && (
          <div className="modal__body publish-ready publish-contract">
            <div className="contract-banner contract-banner--ready">
              <ClipboardCheck size={20} />
              <div>
                <strong>
                  {preflightResult?.passed
                    ? "首轮 SHEIN 真实预检已通过"
                    : "SHEIN 真实预检发现阻断项"}
                </strong>
                <small>
                  已检查 {products.length} 个商品文件夹和 {totalImages} 张图片；本轮只调用可发品权限和商家SKU重复校验。
                </small>
              </div>
              <StatusChip
                value={preflightResult?.passed ? "首轮通过" : "已阻断"}
              />
            </div>
            <div className="api-context-grid">
              <div>
                <span>店铺可发品权限</span>
                <strong>
                  {preflightResult?.permission?.canPublishProduct === true
                    ? "允许"
                    : "不允许"}
                </strong>
                <small>
                  TraceId{" "}
                  {preflightResult?.permission?.diagnostics?.traceId || "未返回"}
                </small>
              </div>
              <div>
                <span>商家SKU唯一性</span>
                <strong>
                  {preflightResult?.supplierSkuCheck?.checkedCount || 0} 个已校验
                </strong>
                <small>
                  重复{" "}
                  {preflightResult?.supplierSkuCheck?.repeatedSkus?.length || 0} 个
                </small>
              </div>
            </div>
            {preflightResult?.blockers?.length > 0 && (
              <div className="inline-alert inline-alert--amber">
                <AlertCircle size={17} />
                <span>
                  <strong>预检阻断：</strong>
                  {preflightResult.blockers.join("；")}
                </span>
              </div>
            )}
            <div className="preflight-list">
              {preflightPlan.map((item) => (
                <div className="preflight-row" key={item.endpoint}>
                  <span className="preflight-order">{item.order}</span>
                  <span className="preflight-copy">
                    <strong>{item.label}</strong>
                    <code>{item.method} {item.path}</code>
                  </span>
                  <StatusChip
                    value={
                      item.state === "local-ready"
                        ? "本地就绪"
                        : item.endpoint === "publishPermission"
                          ? preflightResult?.permission?.canPublishProduct === true
                            ? "已通过"
                            : "已阻断"
                        : item.endpoint === "supplierSkuRepeated"
                          ? preflightResult?.supplierSkuCheck?.repeatedSkus
                              ?.length === 0
                            ? "已通过"
                            : "已阻断"
                        : item.state === "ready"
                          ? "已有上下文"
                          : item.state === "waiting"
                            ? "最后执行"
                            : "待调用"
                    }
                  />
                </div>
              ))}
            </div>
            <div className="inline-alert inline-alert--amber">
              <AlertCircle size={17} />
              <span>
                <strong>正式发布仍保持关闭</strong>
                本轮已向SHEIN发出两项只读校验请求；关联属性规则、图片上传和发布接口尚未执行。
              </span>
            </div>
          </div>
        )}
        <div className="modal__footer">
          {step === "fields" ? (
            <button className="button button--secondary" type="button" onClick={() => setStep("edit")}>
              返回图片
            </button>
          ) : (
            <button className="button button--secondary" type="button" onClick={onClose}>
              取消
            </button>
          )}
          {step === "edit" && (
            <button className="button button--primary" type="button" onClick={validate}>
              下一步：商品字段 <ChevronRight size={16} />
            </button>
          )}
          {step === "fields" && (
            <button className="button button--primary" type="button" onClick={buildPreflight}>
              <ListChecks size={16} /> 执行首轮真实预检
            </button>
          )}
          {step === "ready" && (
            <button className="button button--primary" type="button" disabled>
              <Send size={16} /> 正式发布尚未开放
            </button>
          )}
        </div>
      </div>
      {editingProduct && (
        <ImageMappingDialog
          product={editingProduct}
          onChangeType={(imageId, nextType) =>
            updateImageType(editingProduct.id, imageId, nextType)
          }
          onClose={() => setEditingProductId(null)}
        />
      )}
    </div>
  );
}

function PublishProductDraftEditor({
  businessMode,
  currency,
  draft,
  index,
  input,
  mainSaleFields,
  mode,
  onAttributeOverride,
  onInput,
  onSkuInput,
  overrides,
  perProductFields,
  product,
  rawSkuInputs,
}) {
  const selectedSaleValue =
    input.skcSaleAttributeId && input.skcSaleAttributeValueId
      ? `${input.skcSaleAttributeId}:${input.skcSaleAttributeValueId}`
      : "";

  return (
    <details
      className={`publish-draft-card ${
        draft?.blockers.length ? "has-error" : "is-ready"
      }`}
      open={mode === "single" || index === 0}
    >
      <summary>
        <span className="folder-product-thumb">
          {product.previewUrl ? (
            <img src={product.previewUrl} alt="" />
          ) : (
            <Images size={19} />
          )}
        </span>
        <span>
          <strong>{input.title || product.name}</strong>
          <small>
            {draft?.skuRows.length || 0} 个SKU ·{" "}
            {draft?.pendingUploadCount || 0} 张待上传图片
          </small>
        </span>
        <StatusChip
          value={draft?.blockers.length ? "需补充" : "草稿完整"}
        />
        <ChevronDown size={17} />
      </summary>

      <div className="publish-draft-card__body">
        <div className="builder-form-grid contract-form-grid">
          <label className="form-field">
            <span>默认语种商品标题 *</span>
            <input
              value={input.title || ""}
              onChange={(event) => onInput("title", event.target.value)}
            />
            <small>默认语种与最大长度来自当前类目发布规范</small>
          </label>
          <label className="form-field">
            <span>商家 SKC 货号 supplier_code *</span>
            <input
              value={input.supplierCode || ""}
              onChange={(event) =>
                onInput("supplierCode", event.target.value)
              }
            />
            <small>SKC维度，最多200个字符</small>
          </label>
          <label className="form-field">
            <span>SKC 主销售属性 *</span>
            <select
              value={selectedSaleValue}
              onChange={(event) => {
                const [attributeId = "", valueId = ""] =
                  event.target.value.split(":");
                onInput("skcSaleAttributeId", attributeId);
                onInput("skcSaleAttributeValueId", valueId);
              }}
            >
              <option value="">请选择SHEIN主销售属性值</option>
              {mainSaleFields.flatMap((field) =>
                field.values.map((option) => (
                  <option
                    key={`${field.id}:${option.id}`}
                    value={`${field.id}:${option.id}`}
                  >
                    {field.name} / {option.label}
                  </option>
                )),
              )}
            </select>
            <small>
              仅使用 attribute_type=1 且 attribute_label=1 的真实返回值
            </small>
          </label>
          <label className="form-field">
            <span>默认供货价（{currency || "币种未返回"}）*</span>
            <input
              inputMode="decimal"
              placeholder="例如 15.80"
              value={input.costPrice || ""}
              onChange={(event) =>
                onInput("costPrice", event.target.value)
              }
            />
            <small>一键应用到未单独修改的全部SKU</small>
          </label>
          <label className="form-field">
            <span>默认库存 *</span>
            <input
              inputMode="numeric"
              min="0"
              max="99999"
              type="number"
              value={input.inventoryNum ?? "0"}
              onChange={(event) =>
                onInput("inventoryNum", event.target.value)
              }
            />
            <small>新品 stock_info_list，允许0，最大99999</small>
          </label>
          <label className="form-field">
            <span>样品是否现货 *</span>
            <select
              value={input.spotFlag || "1"}
              onChange={(event) =>
                onInput("spotFlag", event.target.value)
              }
            >
              <option value="1">是</option>
              <option value="2">否</option>
            </select>
            <small>
              sample_info 自动取当前主销售属性与尺寸模板第一行
            </small>
          </label>
        </div>

        {perProductFields.length > 0 && (
          <section className="publish-single-attributes">
            <div className="publish-single-attributes__head">
              <span>
                <strong>本商品单独填写的属性</strong>
                <small>
                  这些字段不会沿用模板值，提交时进入 product_attribute_list
                </small>
              </span>
              <code>{perProductFields.length} 项</code>
            </div>
            <div className="shein-attribute-grid">
              {perProductFields.map((field) => (
                <div className="shein-attribute-field" key={field.id}>
                  <div className="shein-attribute-field__label">
                    <span>
                      {field.required && <b>*</b>}
                      <strong>{field.name}</strong>
                    </span>
                    <small>attribute_id {field.id}</small>
                  </div>
                  <AttributeValueControl
                    field={field}
                    value={overrides[String(field.id)]}
                    onChange={(value) =>
                      onAttributeOverride(field.id, value)
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="publish-sku-editor">
          <div className="publish-sku-editor__head">
            <span>
              <strong>SKU供应信息</strong>
              <small>
                一个尺寸一行；商家SKU、供货价、库存均可逐行覆盖
              </small>
            </span>
            <code>{draft?.skuRows.length || 0} 行</code>
          </div>
          <div className="publish-sku-table">
            <div className="publish-sku-table__header">
              <span>SHEIN尺寸</span>
              <span>商家SKU</span>
              <span>供货价</span>
              <span>库存</span>
              <span>包装长×宽×高 / 重量</span>
            </div>
            {draft?.skuRows.map((sku) => {
              const stored = rawSkuInputs[sku.key] || {};
              const payload = sku.payload;
              return (
                <div className="publish-sku-table__row" key={sku.key}>
                  <strong>{sku.label}</strong>
                  <input
                    aria-label={`${sku.label}商家SKU`}
                    value={stored.supplierSku ?? payload.supplier_sku}
                    onChange={(event) =>
                      onSkuInput(
                        sku.key,
                        "supplierSku",
                        event.target.value,
                      )
                    }
                  />
                  <input
                    aria-label={`${sku.label}供货价`}
                    inputMode="decimal"
                    placeholder={currency || "供货价"}
                    value={
                      stored.costPrice ??
                      payload.cost_info?.cost_price ??
                      ""
                    }
                    onChange={(event) =>
                      onSkuInput(
                        sku.key,
                        "costPrice",
                        event.target.value,
                      )
                    }
                  />
                  <input
                    aria-label={`${sku.label}库存`}
                    inputMode="numeric"
                    min="0"
                    max="99999"
                    type="number"
                    value={
                      stored.inventoryNum ??
                      payload.stock_info_list?.[0]?.inventory_num ??
                      "0"
                    }
                    onChange={(event) =>
                      onSkuInput(
                        sku.key,
                        "inventoryNum",
                        event.target.value,
                      )
                    }
                  />
                  <span className="publish-sku-package">
                    <strong>
                      {payload.length || "?"}×{payload.width || "?"}×
                      {payload.height || "?"} cm
                    </strong>
                    <small>{payload.weight || "?"} g</small>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <div
          className={`publish-draft-validation ${
            draft?.blockers.length ? "has-error" : ""
          }`}
        >
          {draft?.blockers.length ? (
            <>
              <AlertCircle size={17} />
              <span>
                <strong>{draft.blockers.length} 个阻断项</strong>
                <small>{draft.blockers.slice(0, 5).join("；")}</small>
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 size={17} />
              <span>
                <strong>字段草稿完整</strong>
                <small>
                  下一步校验店铺发品资格和商家SKU唯一性
                </small>
              </span>
            </>
          )}
        </div>
      </div>
    </details>
  );
}

function ImageMappingDialog({ product, onChangeType, onClose }) {
  return (
    <div className="image-mapper-backdrop">
      <section className="image-mapper" aria-label="商品图片映射">
        <div className="image-mapper__head">
          <div>
            <span className="eyebrow">本地图片映射</span>
            <h3>{product.name}</h3>
            <p>
              {product.files.length} 张图片 ·{" "}
              {product.blockers.length
                ? `${product.blockers.length} 个问题待修正`
                : "全部通过本地校验"}
            </p>
          </div>
          <button className="icon-button" type="button" title="关闭图片映射" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="image-mapper__legend">
          <span>命名建议</span>
          <code>main_</code>
          <code>detail_</code>
          <code>square_</code>
          <code>swatch_</code>
          <code>description_</code>
          <code>sku_</code>
        </div>
        <div className="image-mapper__list">
          {product.files.map((image, index) => (
            <div
              className={`image-mapper-row ${
                image.issues.length ? "has-error" : ""
              }`}
              key={image.id}
            >
              <span className="image-mapper-thumb">
                <img src={image.previewUrl} alt="" />
                <i>{index + 1}</i>
              </span>
              <span className="image-mapper-file">
                <strong>{image.file.name}</strong>
                <small>
                  {image.width || "?"}×{image.height || "?"} · {image.sizeLabel}
                </small>
              </span>
              <label className="image-type-select">
                <span>映射槽位</span>
                <select
                  value={image.type}
                  onChange={(event) => onChangeType(image.id, event.target.value)}
                >
                  {Object.entries(publishImageTypes).map(([value, option]) => (
                    <option value={value} key={value}>
                      {option.label}
                      {option.apiType !== "引用" ? ` · type=${option.apiType}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <span className="image-rule-result">
                {image.issues.length ? (
                  <>
                    <AlertCircle size={15} />
                    <strong>{image.issues[0]}</strong>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={15} />
                    <strong>符合当前槽位规范</strong>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="image-mapper__footer">
          <span>
            映射调整只改变图片用途，不修改本地原文件。
          </span>
          <button className="button button--primary" type="button" onClick={onClose}>
            <Check size={16} /> 完成映射
          </button>
        </div>
      </section>
    </div>
  );
}

function BatchDialog({
  initialMode,
  store,
  complianceRows = [],
  complianceTemplates = [],
  onClose,
}) {
  const [mode, setMode] = useState(initialMode);
  const [source, setSource] = useState("paste");
  const [text, setText] = useState("");
  const [selectedSkcs, setSelectedSkcs] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [preflight, setPreflight] = useState(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState("");
  const [batchDetails, setBatchDetails] = useState({});
  const [batchBundles, setBatchBundles] = useState({});
  const [inputsBySkc, setInputsBySkc] = useState({});
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [activeOverrideSkc, setActiveOverrideSkc] = useState("");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const uniqueLines = Array.from(new Set(lines));
  const duplicateCount = lines.length - uniqueLines.length;
  const targets = source === "paste" ? uniqueLines : selectedSkcs;
  const modeCopy = {
    identify: {
      title: "批量识别商品并生成模板",
      hint: "将逐个校验商品归属、类目、属性和合规要求",
    },
    compliance: {
      title: "批量补充商品合规信息",
      hint: "统一处理证书、代理公司、警告语和实拍图任务",
    },
  };
  const toggleProduct = (skc, checked) => {
    setSelectedSkcs((current) =>
      checked
        ? Array.from(new Set([...current, skc]))
        : current.filter((item) => item !== skc),
    );
    setPreflight(null);
  };
  const loadBatchMaterials = async () => {
    if (!targets.length || mode !== "compliance") return;
    if (targets.length > 30) {
      setPreflightError("逐商品资料编辑一次最多展开 30 个 SKC；更大批次请先按相同规则分组。");
      return;
    }
    setMaterialsLoading(true);
    setPreflightError("");
    try {
      const entries = await Promise.all(
        targets.map(async (skc) => {
          const detail = await requestLocalApi(
            `/api/shein/stores/${encodeURIComponent(
              store.id,
            )}/compliance?skc=${encodeURIComponent(skc)}`,
          );
          const rules = await requestLocalApi(
            `/api/shein/stores/${encodeURIComponent(
              store.id,
            )}/compliance/rules`,
            {
              method: "POST",
              body: JSON.stringify({ skc, force: true }),
            },
          );
          return [skc, detail.data, rules.data];
        }),
      );
      setBatchDetails(
        Object.fromEntries(entries.map(([skc, detail]) => [skc, detail])),
      );
      setBatchBundles(
        Object.fromEntries(entries.map(([skc, , rules]) => [skc, rules])),
      );
      setActiveOverrideSkc(entries[0]?.[0] || "");
      setPreflight(null);
    } catch (error) {
      setPreflightError(formatConnectionError(error));
    } finally {
      setMaterialsLoading(false);
    }
  };
  const runCompliancePreflight = async () => {
    if (!targets.length || mode !== "compliance") return;
    setPreflightLoading(true);
    setPreflightError("");
    setPreflight(null);
    try {
      const result = await requestLocalApi(
        `/api/shein/stores/${encodeURIComponent(
          store.id,
        )}/compliance/preflight`,
        {
          method: "POST",
          body: JSON.stringify({
            skcList: targets,
            templateId: templateId || undefined,
            inputsBySkc,
          }),
        },
      );
      setPreflight(result);
    } catch (error) {
      setPreflightError(formatConnectionError(error));
    } finally {
      setPreflightLoading(false);
    }
  };
  const planStatusLabel = {
    ready: "可执行",
    compliant: "已合规",
    waiting_review: "审核中",
    rules_pending: "待重查",
    blocked: "被阻断",
  };
  return (
    <div className="modal-backdrop">
      <div className="modal batch-modal">
        <div className="modal__head">
          <div>
            <span className="eyebrow">批量处理</span>
            <h2>创建后台批量任务</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <div className="modal__body">
          <div className="segmented">
            <button className={mode === "identify" ? "is-active" : ""} onClick={() => setMode("identify")} type="button">
              <Sparkles size={16} /> 智能识别
            </button>
            <button className={mode === "compliance" ? "is-active" : ""} onClick={() => setMode("compliance")} type="button">
              <ShieldCheck size={16} /> 批量合规
            </button>
          </div>
          <div className="batch-context">
            <div>
              <strong>{modeCopy[mode].title}</strong>
              <span>{modeCopy[mode].hint}</span>
            </div>
            <StatusChip value={mode === "compliance" ? "合规任务" : "识别任务"} />
          </div>
          <div className="batch-source">
            <div className="batch-source__tabs">
              <button
                className={source === "paste" ? "is-active" : ""}
                type="button"
                onClick={() => setSource("paste")}
              >
                粘贴 SKC
              </button>
              <button
                className={source === "products" ? "is-active" : ""}
                type="button"
                onClick={() => setSource("products")}
              >
                从商品列表选择
              </button>
            </div>
            {source === "paste" && (
              <label className="form-field">
                <span>每行一个 SKC 编码</span>
                <textarea
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    setPreflight(null);
                  }}
                />
                <small>已输入 {lines.length} 行；预检只读取本地已同步的真实合规缓存</small>
              </label>
            )}
            {source === "products" && (
              <div className="batch-product-picker">
                {complianceRows.length ? (
                  <>
                    <label className="batch-product-picker__all">
                      <input
                        checked={
                          complianceRows.length > 0 &&
                          selectedSkcs.length === complianceRows.length
                        }
                        type="checkbox"
                        onChange={(event) => {
                          setSelectedSkcs(
                            event.target.checked
                              ? complianceRows.map((row) => row.skc)
                              : [],
                          );
                          setPreflight(null);
                        }}
                      />
                      <span>
                        <strong>选择全部已同步商品</strong>
                        <small>{complianceRows.length} 个 SKC</small>
                      </span>
                    </label>
                    {complianceRows.slice(0, 100).map((row) => (
                      <label key={row.skc}>
                        <input
                          checked={selectedSkcs.includes(row.skc)}
                          type="checkbox"
                          onChange={(event) =>
                            toggleProduct(row.skc, event.target.checked)
                          }
                        />
                        <span>
                          <strong>{row.name || row.skc}</strong>
                          <small>{row.skc}</small>
                        </span>
                        <StatusChip value={row.state} />
                      </label>
                    ))}
                    {complianceRows.length > 100 && (
                      <small className="batch-product-picker__limit">
                        当前仅展开前100个；可用“选择全部”或粘贴指定SKC。
                      </small>
                    )}
                  </>
                ) : (
                  <DataEmptyState
                    icon={ShoppingBag}
                    title="当前合规列表为空"
                    description="先同步真实商品和合规要求，再从列表选择。"
                  />
                )}
              </div>
            )}
          </div>
          <div className="batch-check">
            <div><CheckCircle2 size={17} /><span><strong>{targets.length}</strong><small>待预检SKC</small></span></div>
            <div><AlertCircle size={17} /><span><strong>{source === "paste" ? duplicateCount : 0}</strong><small>重复数据</small></span></div>
            <div><XCircle size={17} /><span><strong>0</strong><small>格式错误</small></span></div>
          </div>
          {mode === "compliance" ? (
            <>
              <label className="form-field compliance-preflight-template">
                <span>合规模板（可选）</span>
                <select
                  value={templateId}
                  onChange={(event) => {
                    setTemplateId(event.target.value);
                    setPreflight(null);
                  }}
                >
                  <option value="">不套模板，仅检查当前缺口</option>
                  {complianceTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <small>模板不会绕过每个SKC自己的实时要求和API能力边界。</small>
              </label>
              <section className="batch-materials">
                <div className="batch-materials__head">
                  <span>
                    <strong>资料填写方式</strong>
                    <small>
                      相同资料用合规模板；不同证书、代理公司、警告语和实拍图在每个 SKC 下覆盖。
                    </small>
                  </span>
                  <button
                    className="button button--secondary button--small"
                    type="button"
                    disabled={!targets.length || materialsLoading}
                    onClick={loadBatchMaterials}
                  >
                    {materialsLoading ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Database size={15} />
                    )}
                    {materialsLoading ? "读取中" : "读取逐商品资料"}
                  </button>
                </div>
                {Object.keys(batchDetails).length > 0 && (
                  <>
                    <div className="batch-materials__tabs">
                      {targets.map((skc) => (
                        <button
                          className={activeOverrideSkc === skc ? "is-active" : ""}
                          key={skc}
                          type="button"
                          onClick={() => setActiveOverrideSkc(skc)}
                        >
                          {skc}
                        </button>
                      ))}
                    </div>
                    {activeOverrideSkc && batchDetails[activeOverrideSkc] && (
                      <div className="batch-materials__editor">
                        <div className="inline-alert inline-alert--blue">
                          <ShieldCheck size={16} />
                          <span>
                            <strong>{activeOverrideSkc} 单独覆盖</strong>
                            未填写的类别继续使用上方模板默认值；这里填写的资料只作用于当前 SKC。
                          </span>
                        </div>
                        <SingleCertificateAssignments
                          bundle={batchBundles[activeOverrideSkc]}
                          assignments={
                            inputsBySkc[activeOverrideSkc]?.certificates || []
                          }
                          storeId={store.id}
                          skc={activeOverrideSkc}
                          onAssignments={(certificates) => {
                            setInputsBySkc((current) => ({
                              ...current,
                              [activeOverrideSkc]: {
                                ...(current[activeOverrideSkc] || {}),
                                certificates,
                              },
                            }));
                            setPreflight(null);
                          }}
                        />
                        <AgencyTemplate
                          bundle={batchBundles[activeOverrideSkc]}
                          assignments={
                            inputsBySkc[activeOverrideSkc]?.agencies || []
                          }
                          onAssignments={(agencies) => {
                            setInputsBySkc((current) => ({
                              ...current,
                              [activeOverrideSkc]: {
                                ...(current[activeOverrideSkc] || {}),
                                agencies,
                              },
                            }));
                            setPreflight(null);
                          }}
                        />
                        <WarningTemplate
                          bundle={batchBundles[activeOverrideSkc]}
                          assignments={
                            inputsBySkc[activeOverrideSkc]?.warnings || []
                          }
                          onAssignments={(warnings) => {
                            setInputsBySkc((current) => ({
                              ...current,
                              [activeOverrideSkc]: {
                                ...(current[activeOverrideSkc] || {}),
                                warnings,
                              },
                            }));
                            setPreflight(null);
                          }}
                        />
                        <SinglePhotoAssignments
                          item={batchDetails[activeOverrideSkc]}
                          assignments={
                            inputsBySkc[activeOverrideSkc]?.photos || []
                          }
                          onAssignments={(photos) => {
                            setInputsBySkc((current) => ({
                              ...current,
                              [activeOverrideSkc]: {
                                ...(current[activeOverrideSkc] || {}),
                                photos,
                              },
                            }));
                            setPreflight(null);
                          }}
                        />
                      </div>
                    )}
                  </>
                )}
              </section>
              <div className="inline-alert inline-alert--blue">
                <ShieldCheck size={17} />
                <span>
                  <strong>当前为 dry-run 预检</strong>
                  只生成动作与阻断清单，不上传文件、不绑定证书、不改警告语。
                </span>
              </div>
              {preflightError && (
                <div className="inline-alert inline-alert--amber">
                  <AlertCircle size={17} />
                  <span><strong>预检失败</strong>{preflightError}</span>
                </div>
              )}
              {preflight && (
                <div className="compliance-preflight-result">
                  <div className="batch-check">
                    <div><CheckCircle2 size={17} /><span><strong>{preflight.summary.ready}</strong><small>可执行</small></span></div>
                    <div><AlertCircle size={17} /><span><strong>{preflight.summary.rulesPending + preflight.summary.waitingReview}</strong><small>待重查/待审</small></span></div>
                    <div><XCircle size={17} /><span><strong>{preflight.summary.blocked}</strong><small>被阻断</small></span></div>
                  </div>
                  <div className="preflight-list">
                    {preflight.plans.slice(0, 50).map((plan, index) => (
                      <div className="preflight-row" key={plan.skc}>
                        <i className="preflight-order">{index + 1}</i>
                        <span className="preflight-copy">
                          <strong>{plan.skc}</strong>
                          <code>
                            {plan.blockers[0]?.message ||
                              plan.waiting[0]?.name ||
                              (plan.actions.length
                                ? `${plan.actions.length} 个安全动作待执行`
                                : "当前无需补充")}
                          </code>
                          {plan.blockers.length > 1 && (
                            <details className="preflight-blockers">
                              <summary>
                                查看全部 {plan.blockers.length} 个阻断项
                              </summary>
                              <ul>
                                {plan.blockers.map((blocker, blockerIndex) => (
                                  <li
                                    key={`${blocker.code || "blocker"}-${blockerIndex}`}
                                  >
                                    {blocker.message}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </span>
                        <StatusChip value={planStatusLabel[plan.status]} />
                      </div>
                    ))}
                  </div>
                  {preflight.plans.length > 50 && (
                    <small className="batch-product-picker__limit">
                      已显示前50个预检结果，共{preflight.plans.length}个。
                    </small>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="inline-alert inline-alert--amber">
              <AlertCircle size={17} />
              <span>
                <strong>商品识别批量接口尚未接入</strong>
                当前开发优先完成合规闭环，不创建模拟任务。
              </span>
            </div>
          )}
        </div>
        <div className="modal__footer">
          <button className="button button--secondary" type="button" onClick={onClose}>取消</button>
          <button
            className="button button--primary"
            type="button"
            disabled={mode !== "compliance" || !targets.length || preflightLoading}
            onClick={runCompliancePreflight}
          >
            {preflightLoading ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <ListChecks size={16} />
            )}
            {preflightLoading ? "正在预检" : "运行安全预检"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailDrawer({
  item,
  store,
  onClose,
  onEditTemplate,
  onDeleteTemplate,
}) {
  const isCompliance = item.type === "compliance";
  const isTemplate = item.type === "template";
  const isTask = item.type === "task";
  const isRecognition = item.type === "recognition";
  const heading = isCompliance
    ? "处理合规信息"
    : isTemplate
      ? "模板详情"
      : isTask
        ? "批量任务详情"
        : isRecognition
          ? "编辑识别结果"
          : "商品详情";
  return (
    <>
      <button className="drawer-backdrop" type="button" aria-label="关闭详情" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer__head">
          <div>
            <span className="eyebrow">{isTemplate ? "模板管理" : "工作详情"}</span>
            <h2>{heading}</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <div className="drawer__body">
          {isTask ? (
            <TaskDetail item={item} />
          ) : isTemplate ? (
            <TemplateDetail item={item} />
          ) : (
            <ProductDetail
              item={item}
              store={store}
              compliance={isCompliance}
              recognition={isRecognition}
            />
          )}
        </div>
        <div className="drawer__footer">
          {isTemplate && (
            <button
              className="button button--danger"
              type="button"
              onClick={() => onDeleteTemplate(item)}
            >
              <Trash2 size={16} /> 删除
            </button>
          )}
          <button className="button button--secondary" type="button" onClick={onClose}>关闭</button>
          {!isCompliance && (
            <button
              className="button button--primary"
              type="button"
              onClick={() => isTemplate && onEditTemplate(item)}
            >
              {isTemplate && <Pencil size={16} />}
              {isTemplate
                ? "编辑模板"
                : isTask
                  ? "处理失败项"
                  : "保存修改"}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

function compliancePhotoKey(item = {}) {
  return `${item.labelId}:${String(item.labelGroup || "")}`;
}

function isPerSkcFlammabilityCertificate(requirement = {}) {
  const identity = [
    requirement.certificateTypeCode,
    requirement.certificateTypeName,
    requirement.certificateType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    identity.includes("1630") ||
    identity.includes("1631") ||
    identity.includes("smallcarpet") ||
    identity.includes("largecarpet")
  );
}

function isReusableEuRepPhoto(requirement = {}) {
  const name = String(requirement.labelName || "").toLowerCase();
  return (
    Number(requirement.labelId) === 11 ||
    name.includes("欧代") ||
    name.includes("欧盟责任人")
  );
}

async function uploadComplianceCertificateFile(storeId, file) {
  const mimeType =
    file.type ||
    (/\.pdf$/i.test(file.name)
      ? "application/pdf"
      : /\.png$/i.test(file.name)
        ? "image/png"
        : "image/jpeg");
  const response = await fetch(
    `/api/local/shein/stores/${encodeURIComponent(
      storeId,
    )}/upload-certificate`,
    {
      method: "POST",
      headers: {
        "Content-Type": mimeType,
        "x-file-name": encodeURIComponent(file.name),
      },
      body: file,
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload.message || `资质证书直传失败（HTTP ${response.status}）`,
    );
    error.code = payload.code;
    error.traceId = payload.traceId;
    throw error;
  }
  return {
    ...payload.info,
    mimeType,
    size: file.size,
    diagnostics: payload.diagnostics,
  };
}

function replacePhotoAssignment(assignments, key, nextValue) {
  const next = (assignments || []).filter(
    (item) => compliancePhotoKey(item) !== key,
  );
  return nextValue ? [...next, nextValue] : next;
}

function findCertificateSchema(bundle, requirement) {
  return (bundle?.certificateSchemas || []).find(
    (schema) =>
      String(schema.certificateTypeId || "") ===
      String(requirement.certificateTypeId || ""),
  );
}

function enabledCertificateFields(schema) {
  return [
    ...(schema?.presetInfoList || []),
    ...(schema?.otherPresetInfoList || []),
  ].filter((field) => Number(field.isEnabled ?? 1) === 1);
}

function ComplianceProductWorkbench({ item, store }) {
  const [step, setStep] = useState("materials");
  const [bundle, setBundle] = useState(null);
  const [assignments, setAssignments] = useState({
    certificates: [],
    agencies: [],
    warnings: [],
    photos: [],
  });
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [preflight, setPreflight] = useState(null);

  const loadRules = async () => {
    if (!store?.id || !item?.skc) return;
    setLoading(true);
    setNotice("");
    setPreflight(null);
    try {
      const result = await requestLocalApi(
        `/api/shein/stores/${encodeURIComponent(
          store.id,
        )}/compliance/rules`,
        {
          method: "POST",
          body: JSON.stringify({ skc: item.skc, force: true }),
        },
      );
      setBundle(result.data || null);
      setNotice(
        result.data?.complete
          ? "已读取当前 SKC 的动态规则和店铺资料库。"
          : `规则读取不完整：${result.data?.errors?.[0]?.message || "请稍后重试"}`,
      );
    } catch (error) {
      setNotice(formatConnectionError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, [store?.id, item?.skc]);

  const runPreflight = async () => {
    setLoading(true);
    setNotice("");
    try {
      const result = await requestLocalApi(
        `/api/shein/stores/${encodeURIComponent(
          store.id,
        )}/compliance/preflight`,
        {
          method: "POST",
          body: JSON.stringify({
            skcList: [item.skc],
            inputsBySkc: { [item.skc]: assignments },
          }),
        },
      );
      setPreflight(result);
      setStep("review");
      setNotice(
        result.plans?.[0]?.status === "ready"
          ? "资料预检通过，已生成安全动作清单。"
          : result.plans?.[0]?.blockers?.[0]?.message ||
              "预检完成，请处理阻断项。",
      );
    } catch (error) {
      setNotice(formatConnectionError(error));
    } finally {
      setLoading(false);
    }
  };

  const steps = [
    ["materials", "1", "准备资料"],
    ["photos", "2", "实拍图"],
    ["review", "3", "预检确认"],
  ];
  const plan = preflight?.plans?.[0];

  return (
    <div className="drawer-stack compliance-workbench">
      <div className="drawer-product">
        <span className="product-thumb product-thumb--large">
          {item.image ? <img src={item.image} alt="" /> : <Images size={24} />}
        </span>
        <div>
          <strong>{item.name || item.skc}</strong>
          <small>{item.skc}</small>
          <StatusChip value={item.state || "待同步"} />
        </div>
      </div>

      <div className="compliance-workbench__steps">
        {steps.map(([id, number, label]) => (
          <button
            className={step === id ? "is-active" : ""}
            key={id}
            type="button"
            onClick={() => setStep(id)}
          >
            <i>{number}</i>
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="inline-alert inline-alert--blue">
        <ShieldCheck size={17} />
        <span>
          <strong>安全流程</strong>
          本页先读取要求，再准备资料并运行 dry-run。当前不会直接修改 SHEIN 商品。
        </span>
      </div>

      {loading && !bundle ? (
        <div className="compliance-workbench__loading">
          <LoaderCircle className="spin" size={22} />
          <span>正在读取证书库、代理公司和动态规则…</span>
        </div>
      ) : null}

      {step === "materials" && (
        <>
          <DetailSection title="当前状态">
            <EditableRow label="资质证书" value={item.certificate || "待同步"} status />
            <EditableRow label="代理公司" value={item.agency || "待同步"} status />
            <EditableRow label="警告语" value={item.warning || "待同步"} status />
            <EditableRow label="仅后台可处理" value={item.platformOnly || "无需"} status />
          </DetailSection>

          <SingleCertificateAssignments
            bundle={bundle}
            assignments={assignments.certificates}
            storeId={store.id}
            skc={item.skc}
            onAssignments={(certificates) => {
              setAssignments((current) => ({ ...current, certificates }));
              setPreflight(null);
            }}
          />

          <AgencyTemplate
            bundle={bundle}
            assignments={assignments.agencies}
            onAssignments={(agencies) => {
              setAssignments((current) => ({ ...current, agencies }));
              setPreflight(null);
            }}
          />

          <WarningTemplate
            bundle={bundle}
            assignments={assignments.warnings}
            onAssignments={(warnings) => {
              setAssignments((current) => ({ ...current, warnings }));
              setPreflight(null);
            }}
          />
        </>
      )}

      {step === "photos" && (
        <SinglePhotoAssignments
          item={item}
          assignments={assignments.photos}
          onAssignments={(photos) => {
            setAssignments((current) => ({ ...current, photos }));
            setPreflight(null);
          }}
        />
      )}

      {step === "review" && (
        <section className="template-editor-section compliance-review-panel">
          <TemplateSectionHeading
            eyebrow="dry-run"
            title="提交前检查结果"
            description="这里只展示将要执行的动作和阻断原因。真实写入仍需单独开启写入开关并再次确认。"
          />
          {!plan ? (
            <DataEmptyState
              icon={ClipboardCheck}
              title="尚未运行预检"
              description="准备好证书、代理公司、警告语和实拍图后，点击下方“运行安全预检”。"
            />
          ) : (
            <>
              <div className="batch-check">
                <div>
                  <CheckCircle2 size={17} />
                  <span><strong>{plan.counts.actions}</strong><small>待执行动作</small></span>
                </div>
                <div>
                  <AlertCircle size={17} />
                  <span><strong>{plan.counts.warnings}</strong><small>风险提示</small></span>
                </div>
                <div>
                  <XCircle size={17} />
                  <span><strong>{plan.counts.blockers}</strong><small>阻断项</small></span>
                </div>
              </div>
              <CompliancePlanList plan={plan} />
              {plan.actions.some(
                (action) => action.type === "photo.upload_and_bind",
              ) && (
                <div className="inline-alert inline-alert--amber">
                  <AlertCircle size={17} />
                  <span>
                    <strong>实拍图暂时只完成资料准备</strong>
                    原始归档没有 skc-save-label 的完整请求正文，因此上传绑定继续 fail-closed；选中的本地图片不会发送到云端。
                  </span>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {item.unsupportedRequirements?.length > 0 && (
        <DetailSection title="需要到 SHEIN 后台处理">
          <div className="inline-alert inline-alert--amber">
            <AlertCircle size={17} />
            <span>
              <strong>开放平台只读，不生成上传动作</strong>
              GCC合规信息、产品标识符等非手动警告语 HGXXL 项目，需要在 SHEIN 商品合规管理后台补充；软件只负责同步状态和阻断漏项。
            </span>
          </div>
          <ComplianceRequirementList items={item.unsupportedRequirements} />
        </DetailSection>
      )}

      {notice && (
        <div
          className={`inline-alert ${
            /不完整|失败|阻断|缺少|不能|未/.test(notice)
              ? "inline-alert--amber"
              : "inline-alert--success"
          }`}
        >
          {/不完整|失败|阻断|缺少|不能|未/.test(notice) ? (
            <AlertCircle size={17} />
          ) : (
            <CheckCircle2 size={17} />
          )}
          <span>{notice}</span>
        </div>
      )}

      <div className="compliance-workbench__actions">
        <button
          className="button button--secondary"
          type="button"
          disabled={loading}
          onClick={loadRules}
        >
          <RefreshCw className={loading ? "spin" : ""} size={16} />
          重读当前要求
        </button>
        <button
          className="button button--primary"
          type="button"
          disabled={loading || !bundle}
          onClick={runPreflight}
        >
          {loading ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <ClipboardCheck size={16} />
          )}
          运行安全预检
        </button>
      </div>
    </div>
  );
}

function SingleCertificateAssignments({
  bundle,
  assignments = [],
  onAssignments,
  storeId,
  skc,
}) {
  const [uploadState, setUploadState] = useState({});
  const requirements = bundle?.requirements?.certificates || [];
  const updateAssignment = (requirement, updater) => {
    const key = complianceRequirementKey(requirement);
    const current = assignments.find(
      (assignment) => complianceRequirementKey(assignment) === key,
    );
    onAssignments(
      replaceComplianceAssignment(
        assignments,
        key,
        updater(current || {
          certificateTypeCode: requirement.certificateTypeCode,
          certificateTypeId: requirement.certificateTypeId,
        }),
      ),
    );
  };

  return (
    <section className="template-editor-section">
      <TemplateSectionHeading
        eyebrow="资质证书"
        title="选择已有证书，或准备一份新证书"
        description="已有证书可直接进入绑定 dry-run；新证书会按 SHEIN Schema 展开字段并校验证书文件。"
        endpoint="/open-api/goods-certificates/search"
      />
      {!bundle ? (
        <div className="compliance-detail-empty">正在读取证书规则…</div>
      ) : requirements.length === 0 ? (
        <DataEmptyState
          icon={FileCheck2}
          title="该 SKC 没有证书补充要求"
          description="以 SHEIN 当前返回结果为准。"
        />
      ) : (
        <div className="single-assignment-list">
          {requirements.map((requirement) => {
            const key = complianceRequirementKey(requirement);
            const assignment = assignments.find(
              (current) => complianceRequirementKey(current) === key,
            );
            const perSkcUpload =
              isPerSkcFlammabilityCertificate(requirement);
            const mode = perSkcUpload
              ? "new"
              : assignment?.mode || "existing";
            const schema = findCertificateSchema(bundle, requirement);
            const options = (bundle.certificates || []).filter(
              (certificate) =>
                certificate.certificateTypeCode ===
                  requirement.certificateTypeCode &&
                Number(certificate.status) === 2,
            );
            return (
              <article className="single-assignment-card" key={key}>
                <header>
                  <span>
                    <strong>{requirement.certificateTypeName}</strong>
                    <small>
                      {Number(requirement.isRequired) === 1 ? "必填" : "选填"} ·{" "}
                      {requirement.certificateTypeCode}
                    </small>
                  </span>
                  <StatusChip
                    value={
                      Number(requirement.reviewState) === 3
                        ? "失败"
                        : Number(requirement.reviewState) === 2
                          ? "通过"
                          : "待补充"
                    }
                  />
                </header>
                <div className="segmented segmented--compact">
                  {!perSkcUpload && (
                    <button
                      className={mode === "existing" ? "is-active" : ""}
                      type="button"
                      onClick={() =>
                        updateAssignment(requirement, () => ({
                          certificateTypeCode: requirement.certificateTypeCode,
                          certificateTypeId: requirement.certificateTypeId,
                          mode: "existing",
                          skc,
                        }))
                      }
                    >
                      使用证书库
                    </button>
                  )}
                  <button
                    className={mode === "new" ? "is-active" : ""}
                    type="button"
                    onClick={() =>
                      updateAssignment(requirement, (current) => ({
                        certificateTypeCode: requirement.certificateTypeCode,
                        certificateTypeId: requirement.certificateTypeId,
                        mode: "new",
                        skc,
                        schema,
                        files: current.files || [],
                        fieldValues: current.fieldValues || {},
                      }))
                    }
                  >
                    {perSkcUpload ? "当前 SKC 单独上传" : "新建证书"}
                  </button>
                </div>
                {perSkcUpload && (
                  <div className="inline-alert inline-alert--blue">
                    <ShieldCheck size={16} />
                    <span>
                      <strong>1630/1631 不使用通用证书模板</strong>
                      检测报告必须属于当前 SKC：{skc}，文件将从本机直接上传到 SHEIN。
                    </span>
                  </div>
                )}
                {mode === "existing" ? (
                  <label className="form-field">
                    <span>当前店铺的生效证书</span>
                    <select
                      value={assignment?.poolSn || ""}
                      onChange={(event) => {
                        const selected = options.find(
                          (certificate) =>
                            String(certificate.poolSn) === event.target.value,
                        );
                        updateAssignment(requirement, () =>
                          selected
                            ? {
                                certificateTypeCode:
                                  requirement.certificateTypeCode,
                                certificateTypeId:
                                  requirement.certificateTypeId,
                                mode: "existing",
                                skc,
                                poolSn: selected.poolSn,
                                status: selected.status,
                                certificateDimension:
                                  selected.certificateDimension,
                              }
                            : null,
                        );
                      }}
                    >
                      <option value="">请选择证书</option>
                      {options.map((certificate) => (
                        <option
                          key={certificate.poolSn}
                          value={certificate.poolSn}
                        >
                          {certificate.fileList?.[0]?.fileName ||
                            certificate.poolSn}
                          {certificate.invalidTime
                            ? ` · 有效至 ${certificate.invalidTime}`
                            : ""}
                        </option>
                      ))}
                    </select>
                    <small>
                      {options.length
                        ? `${options.length} 份生效证书可选`
                        : "证书库没有该类型的生效证书，请切换到“新建证书”"}
                    </small>
                  </label>
                ) : (
                  <>
                    <label className="compliance-file-slot">
                      <Upload size={18} />
                      <span>
                        <strong>
                          {assignment?.files?.[0]?.fileName ||
                            "选择 PDF、PNG、JPG 证书文件"}
                        </strong>
                        <small>最大 20MB；从当前电脑直接上传 SHEIN，不经过云端</small>
                      </span>
                      <input
                        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                        type="file"
                        disabled={uploadState[key]?.loading}
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (!file || !storeId) return;
                          setUploadState((current) => ({
                            ...current,
                            [key]: { loading: true, error: "" },
                          }));
                          updateAssignment(requirement, (current) => ({
                            ...current,
                            certificateTypeCode:
                              requirement.certificateTypeCode,
                            certificateTypeId: requirement.certificateTypeId,
                            mode: "new",
                            skc,
                            schema,
                            files: [],
                          }));
                          try {
                            const uploaded =
                              await uploadComplianceCertificateFile(
                                storeId,
                                file,
                              );
                            updateAssignment(requirement, (current) => ({
                              ...current,
                              certificateTypeCode:
                                requirement.certificateTypeCode,
                              certificateTypeId:
                                requirement.certificateTypeId,
                              certificateDimension:
                                schema?.certificateDimension ?? 1,
                              mode: "new",
                              skc,
                              schema,
                              files: [uploaded],
                            }));
                            setUploadState((current) => ({
                              ...current,
                              [key]: {
                                loading: false,
                                error: "",
                                uploaded: true,
                              },
                            }));
                          } catch (error) {
                            setUploadState((current) => ({
                              ...current,
                              [key]: {
                                loading: false,
                                error: formatConnectionError(error),
                              },
                            }));
                          } finally {
                            event.target.value = "";
                          }
                        }}
                      />
                    </label>
                    {uploadState[key]?.loading && (
                      <div className="inline-alert inline-alert--blue">
                        <LoaderCircle className="spin" size={16} />
                        <span>正在从当前电脑直传 SHEIN 证书空间…</span>
                      </div>
                    )}
                    {uploadState[key]?.uploaded &&
                      assignment?.files?.[0]?.fileUrl && (
                        <div className="inline-alert inline-alert--success">
                          <CheckCircle2 size={16} />
                          <span>
                            <strong>SHEIN 已接收证书文件</strong>
                            已取得 fileUrl、fileMd5、fileName，可进入证书创建预检。
                          </span>
                        </div>
                      )}
                    {uploadState[key]?.error && (
                      <div className="inline-alert inline-alert--amber">
                        <AlertCircle size={16} />
                        <span>{uploadState[key].error}</span>
                      </div>
                    )}
                    <CertificateDynamicFields
                      bundle={bundle}
                      schema={schema}
                      values={assignment?.fieldValues || {}}
                      onValues={(fieldValues) =>
                        updateAssignment(requirement, (current) => ({
                          ...current,
                          certificateTypeCode:
                            requirement.certificateTypeCode,
                          certificateTypeId: requirement.certificateTypeId,
                          mode: "new",
                          skc,
                          schema,
                          files: current.files || [],
                          fieldValues,
                        }))
                      }
                    />
                    {!schema && (
                      <div className="inline-alert inline-alert--amber">
                        <AlertCircle size={16} />
                        <span>当前规则包未返回证书 Schema，不能创建该证书。</span>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CertificateDynamicFields({ bundle, schema, values, onValues }) {
  const fields = enabledCertificateFields(schema);
  const setValue = (presetId, nextValue) =>
    onValues({ ...values, [String(presetId)]: nextValue });
  if (!schema || fields.length === 0) return null;
  return (
    <div className="certificate-dynamic-fields">
      {fields.map((field) => {
        const key = String(field.presetId);
        const value = values[key] || {};
        const label =
          field.presetRemark || field.presetName || `字段 ${field.presetId}`;
        if (String(field.sourceFrom || "").toUpperCase() === "SRM") {
          const selectedAgency = (
            bundle?.srmDetectionAgencyList || []
          ).find(
            (item) =>
              String(item.detectionAgency?.detectionAgencyId) ===
              String(value.detectionAgencyId || ""),
          );
          return (
            <div className="certificate-srm-field" key={key}>
              <label className="form-field">
                <span>{label}{Number(field.isRequired) === 1 ? " *" : ""}</span>
                <select
                  value={value.detectionAgencyId || ""}
                  onChange={(event) =>
                    setValue(key, {
                      detectionAgencyId: event.target.value,
                      laboratoryId: "",
                    })
                  }
                >
                  <option value="">请选择检测机构</option>
                  {(bundle?.srmDetectionAgencyList || []).map((item) => (
                    <option
                      key={item.detectionAgency?.detectionAgencyId}
                      value={item.detectionAgency?.detectionAgencyId}
                    >
                      {item.detectionAgency?.detectionAgencyName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>实验室</span>
                <select
                  value={value.laboratoryId || ""}
                  onChange={(event) =>
                    setValue(key, {
                      ...value,
                      laboratoryId: event.target.value,
                    })
                  }
                >
                  <option value="">请选择实验室</option>
                  {(selectedAgency?.laboratoryList || []).map((laboratory) => (
                    <option
                      key={laboratory.laboratoryId}
                      value={laboratory.laboratoryId}
                    >
                      {laboratory.laboratoryName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          );
        }
        if ([1, 2, 5, 6].includes(Number(field.inputType))) {
          const selectedIds = (value.valueIds || []).map(String);
          return (
            <div className="form-field" key={key}>
              <span>{label}{Number(field.isRequired) === 1 ? " *" : ""}</span>
              <div className="compliance-field-options">
                {(field.presetValueList || []).map((option) => (
                  <label key={option.presetValueId}>
                    <input
                      checked={selectedIds.includes(
                        String(option.presetValueId),
                      )}
                      type={
                        Number(field.inputType) === 1 ? "radio" : "checkbox"
                      }
                      name={`certificate-${schema.certificateTypeId}-${key}`}
                      onChange={(event) => {
                        const optionId = String(option.presetValueId);
                        const nextIds =
                          Number(field.inputType) === 1
                            ? event.target.checked
                              ? [optionId]
                              : []
                            : event.target.checked
                              ? Array.from(new Set([...selectedIds, optionId]))
                              : selectedIds.filter((id) => id !== optionId);
                        setValue(key, { valueIds: nextIds });
                      }}
                    />
                    <span>{option.presetValue}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        }
        return (
          <label className="form-field" key={key}>
            <span>{label}{Number(field.isRequired) === 1 ? " *" : ""}</span>
            <input
              type={Number(field.inputType) === 4 ? "date" : "text"}
              value={value.value || ""}
              onChange={(event) =>
                setValue(key, { value: event.target.value })
              }
            />
            {field.unit && <small>单位：{field.unit}</small>}
          </label>
        );
      })}
    </div>
  );
}

function SinglePhotoAssignments({ item, assignments = [], onAssignments }) {
  const requirements = [
    ...(item.bodyPhotoRequirements || []),
    ...(item.packagePhotoRequirements || []),
  ];
  const choosePhoto = async (requirement, file) => {
    const key = compliancePhotoKey(requirement);
    if (!file) {
      onAssignments(replacePhotoAssignment(assignments, key, null));
      return;
    }
    let dimensions = { width: 0, height: 0 };
    try {
      dimensions = await readImageDimensions(file);
    } catch {
      dimensions = { width: 0, height: 0 };
    }
    onAssignments(
      replacePhotoAssignment(assignments, key, {
        labelId: requirement.labelId,
        labelGroup: String(requirement.labelGroup || ""),
        localAssetRef: `local:${file.name}:${file.lastModified}`,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        width: dimensions.width,
        height: dimensions.height,
      }),
    );
  };
  return (
    <section className="template-editor-section">
      <TemplateSectionHeading
        eyebrow="逐槽位上传"
        title="包装与商品本体实拍图"
        description="每个槽位都来自当前 SKC 的 labelId；图片不会跨 SKC 自动复用。"
        endpoint="/open-api/goods-compliance/skc-label-list"
      />
      {requirements.length === 0 ? (
        <DataEmptyState
          icon={Images}
          title="该 SKC 没有实拍图要求"
          description="SHEIN 当前未返回本体或包装实拍图槽位。"
        />
      ) : (
        <div className="photo-assignment-grid">
          {requirements.map((requirement) => {
            const key = compliancePhotoKey(requirement);
            const assignment = assignments.find(
              (current) => compliancePhotoKey(current) === key,
            );
            return (
              <label className="compliance-file-slot" key={key}>
                <Images size={18} />
                <span>
                  <strong>{requirement.labelName}</strong>
                  <small>
                    {String(requirement.labelGroup) === "1"
                      ? "商品本体"
                      : "外包装"}{" "}
                    · labelId {requirement.labelId} ·{" "}
                    {Number(requirement.isRequired) === 1 ? "必传" : "选传"}
                  </small>
                  {assignment && (
                    <small className="text-success">
                      已选择 {assignment.fileName} · {assignment.width}×
                      {assignment.height}px
                    </small>
                  )}
                </span>
                <input
                  accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                  type="file"
                  onChange={(event) =>
                    choosePhoto(requirement, event.target.files?.[0])
                  }
                />
              </label>
            );
          })}
        </div>
      )}
      <div className="inline-alert inline-alert--amber">
        <AlertCircle size={17} />
        <span>
          <strong>当前只选取本地文件，不上传</strong>
          文件将来由桌面本地代理直传 SHEIN，不经过云服务器；绑定正文核准前保持安全阻断。
        </span>
      </div>
    </section>
  );
}

function CompliancePlanList({ plan }) {
  const actionLabels = {
    "certificate.bind_existing": "绑定已有证书",
    "certificate.create_and_bind": "上传并新建证书后绑定",
    "agency.bind": "绑定代理公司",
    "agency.recheck_store_scope": "回查全店代理公司覆盖",
    "certificate.recheck_store_scope": "回查全店证书覆盖",
    "warning.update": "更新手动警告语",
    "photo.upload_and_bind": "上传并绑定实拍图",
  };
  return (
    <div className="compliance-plan-list">
      {(plan.actions || []).map((action, index) => (
        <div key={`${action.type}-${action.requirementKey}-${index}`}>
          <CheckCircle2 size={16} />
          <span>
            <strong>{actionLabels[action.type] || action.type}</strong>
            <small>{action.requirementKey}</small>
          </span>
        </div>
      ))}
      {(plan.blockers || []).map((blocker, index) => (
        <div className="is-blocker" key={`${blocker.code}-${index}`}>
          <XCircle size={16} />
          <span>
            <strong>{blocker.message}</strong>
            <small>{blocker.code}</small>
          </span>
        </div>
      ))}
      {(plan.warnings || []).map((warning, index) => (
        <div className="is-warning" key={`${warning.code}-${index}`}>
          <AlertCircle size={16} />
          <span>
            <strong>{warning.message}</strong>
            <small>{warning.code}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function ProductDetail({ item, store, compliance, recognition }) {
  const source = item || {};
  if (compliance) {
    return <ComplianceProductWorkbench item={source} store={store} />;
  }
  return (
    <div className="drawer-stack">
      <div className="drawer-product">
        <span className="product-thumb product-thumb--large">
          {source.image ? <img src={source.image} alt="" /> : <Images size={24} />}
        </span>
        <div>
          <strong>{source.name || "未读取商品名称"}</strong>
          <small>{source.skc || source.recognizedSkc || "—"}</small>
          <StatusChip value={source.state || (compliance ? "待同步" : "待接口校验")} />
        </div>
      </div>
      {recognition && (
        <div className="inline-alert inline-alert--amber">
          <AlertCircle size={17} />
          <span><strong>识别结果尚未同步</strong>接口返回前不生成字段、置信度或模板。</span>
        </div>
      )}
      <DetailSection title="基本信息">
        <>
          <EditableRow label="商品类目" value={source.category || "—"} />
          <EditableRow label="商品名称" value={source.name || "—"} />
          <EditableRow label="变体结构" value={source.variants || "—"} />
          <EditableRow label="来源模板" value={source.template || "—"} />
        </>
      </DetailSection>
      <DetailSection title="识别字段">
        <DataEmptyState
          icon={Database}
          title="暂无真实识别字段"
          description="字段数量和可复用性只根据 SHEIN 接口响应计算。"
        />
      </DetailSection>
    </div>
  );
}

function ComplianceRequirementList({ items = [], emptyText = "暂无要求", photo = false }) {
  if (!items.length) {
    return <div className="compliance-detail-empty">{emptyText}</div>;
  }
  return (
    <div className="compliance-detail-list">
      {items.map((item, index) => {
        const required = Number(item.isRequired) === 1;
        const status = photo
          ? Number(item.reviewStatus) === 3
            ? "失败"
            : Number(item.reviewStatus) === 0
              ? required
                ? "待补充"
                : "无需"
              : "通过"
          : Number(item.reviewState) === 3
            ? "失败"
            : Number(item.reviewState) === 1
              ? "审核中"
              : Number(item.reviewState) === 2
                ? "通过"
                : required
                  ? "待补充"
                  : "无需";
        return (
          <div
            className="compliance-detail-item"
            key={`${item.labelId || item.certificateTypeCode || index}`}
          >
            <span>
              <strong>{item.labelName || item.certificateTypeName || "未命名要求"}</strong>
              <small>
                {photo
                  ? String(item.labelGroup) === "1"
                    ? "商品本体"
                    : "外包装"
                  : item.complianceGroupCode || "未分组"}
                {required ? " · 必填" : " · 选填"}
                {!photo &&
                item.complianceGroupCode === "HGXXL" &&
                item.isManualProductWarning !== true
                  ? " · 仅SHEIN后台处理"
                  : ""}
              </small>
              {Array.isArray(item.failReason) && item.failReason.length > 0 && (
                <small className="text-danger">{item.failReason.join("；")}</small>
              )}
            </span>
            <StatusChip value={status} />
          </div>
        );
      })}
    </div>
  );
}

function TemplateDetail({ item }) {
  return (
    <div className="drawer-stack">
      <div className="template-hero">
        <div className="template-name__icon">
          {item.templateType === "compliance" ? <ShieldCheck size={20} /> : <ShoppingBag size={20} />}
        </div>
        <div>
          <strong>{item.name}</strong>
          <small>{item.scope}</small>
        </div>
      </div>
      <DetailSection title="模板信息">
        <EditableRow label="模板状态" value={item.status || "待接口校验"} status />
        <EditableRow label="来源店铺" value={item.storeName || "—"} />
        <EditableRow
          label={item.referenceSkc ? "参照SKC" : "字段来源"}
          value={item.referenceSkc || item.source || "—"}
        />
        <EditableRow label="最近校验" value={item.validatedAt || "尚未校验"} />
      </DetailSection>
      <DetailSection title="版本记录">
        {item.revisions?.length ? (
          <div className="revision-list">
            {[...item.revisions].reverse().map((revision) => (
              <div key={`${revision.version}-${revision.savedAt}`}>
                <span><Clock3 size={14} />版本 {revision.version}</span>
                <small>
                  {new Date(revision.savedAt).toLocaleString("zh-CN", { hour12: false })}
                  {" · "}
                  {revision.selectedAttributeCount || 0} 项模板值
                </small>
              </div>
            ))}
          </div>
        ) : (
          <DataEmptyState
            icon={Clock3}
            title="暂无版本记录"
            description="首次保存后开始记录模板版本。"
          />
        )}
      </DetailSection>
    </div>
  );
}

function TaskDetail({ item }) {
  return (
    <div className="drawer-stack">
      <div className="task-detail-head">
        <span className="task-detail-head__icon"><ListChecks size={21} /></span>
        <div><strong>{item.title}</strong><small>{item.id}</small></div>
        <StatusChip value={item.state} />
      </div>
      <div className="task-kpis">
        <div><strong>{item.success}</strong><span>成功</span></div>
        <div><strong className="text-danger">{item.failed}</strong><span>失败</span></div>
        <div><strong>{item.progress}%</strong><span>进度</span></div>
      </div>
      <DetailSection title="处理记录">
        <DataEmptyState
          icon={ListChecks}
          title="暂无处理记录"
          description="每一次真实 API 请求完成后写入批次记录和 TraceId。"
        />
      </DetailSection>
      {item.failed > 0 && (
        <div className="inline-alert inline-alert--red">
          <XCircle size={17} />
          <span><strong>存在 {item.failed} 条失败记录</strong>可修正字段后仅重试失败项。</span>
        </div>
      )}
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function EditableRow({ label, value, status = false }) {
  return (
    <div className="editable-row">
      <span>{label}</span>
      {status ? <StatusChip value={value} /> : <strong>{value}</strong>}
      <button className="text-button" type="button">修改</button>
    </div>
  );
}

function TaskPanel({ tasks, onClose }) {
  const running = tasks.filter((task) => task.state === "运行中").length;
  const needsAttention = tasks.filter((task) => task.failed > 0).length;
  return (
    <>
      <button className="drawer-backdrop" type="button" aria-label="关闭任务中心" onClick={onClose} />
      <aside className="task-panel">
        <div className="drawer__head">
          <div>
            <span className="eyebrow">后台处理</span>
            <h2>批量任务</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="task-panel__summary">
          <span><strong>{running}</strong> 运行中</span>
          <span><strong>{needsAttention}</strong> 需要处理</span>
        </div>
        <div className="task-panel__list">
          {tasks.length === 0 && (
            <DataEmptyState
              icon={ListChecks}
              title="暂无真实批量任务"
              description="任务创建、拆批、重试和进度都将由真实请求驱动。"
            />
          )}
          {tasks.map((task) => (
            <div className="task-card" key={task.id}>
              <div className="task-card__head">
                <span className="task-card__icon"><ListChecks size={17} /></span>
                <span><strong>{task.title}</strong><small>{task.detail}</small></span>
                <StatusChip value={task.state} />
              </div>
              <div className="task-card__progress">
                <span><i style={{ width: `${task.progress}%` }} /></span>
                <strong>{task.progress}%</strong>
              </div>
              <div className="task-card__footer">
                <span className="text-success">{task.success} 成功</span>
                <span className={task.failed ? "text-danger" : ""}>{task.failed} 失败</span>
                <button className="text-button" type="button">查看详情</button>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

function TableFooter({
  count,
  total,
  page = 1,
  pageCount = 1,
  onPageChange,
}) {
  return (
    <div className="table-footer">
      <span>显示 {count} 条，共 {total} 条</span>
      <div>
        <button
          type="button"
          disabled={!onPageChange || page <= 1}
          onClick={() => onPageChange?.(page - 1)}
        >
          上一页
        </button>
        <button className="is-active" type="button">
          {page} / {pageCount}
        </button>
        <button
          type="button"
          disabled={!onPageChange || page >= pageCount}
          onClick={() => onPageChange?.(page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export default App;
