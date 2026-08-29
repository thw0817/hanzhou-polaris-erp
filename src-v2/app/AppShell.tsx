import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  BellRing,
  BookCopy,
  Check,
  ClipboardList,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  FilePenLine,
  Images,
  LogOut,
  ListChecks,
  Layers3,
  LayoutDashboard,
  Menu,
  Plus,
  Ruler,
  Settings,
  ShoppingBag,
  Send,
  ShieldCheck,
  Store as StoreIcon,
  TrendingUp,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
} from "react-router";
import {
  api,
  ApiError,
  isAuthorizedSheinStore,
  type Session,
  type Store,
} from "../lib/api";
import { cn } from "../lib/cn";
import { Button } from "../components/ui/button";

interface AppContextValue {
  session: Session;
  stores: Store[];
  currentStore: Store | null;
}

const CURRENT_STORE_STORAGE_KEY = "shein-console.current-store-id";

export function useAppContext() {
  return useOutletContext<AppContextValue>();
}

function LoadingScreen() {
  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--page)]">
      <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
        <span className="size-2 animate-pulse rounded-full bg-[var(--ink)]" />
        正在进入工作台
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--page)] px-4">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-md bg-[var(--danger-soft)] text-[var(--danger)]">
          <X size={20} />
        </div>
        <h1 className="text-lg font-semibold text-[var(--ink)]">工作台暂时无法加载</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{message}</p>
        <Button className="mt-5" onClick={() => window.location.reload()} variant="outline">
          重新加载
        </Button>
      </div>
    </div>
  );
}

function StoreSwitcher({
  stores,
  currentStore,
  onSelect,
}: {
  stores: Store[];
  currentStore: Store | null;
  onSelect: (store: Store) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const visibleStores = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return stores;
    return stores.filter((store) => [store.label, store.id, store.businessMode]
      .some((value) => String(value || "").toLocaleLowerCase().includes(needle)));
  }, [search, stores]);

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-[var(--line)] bg-white px-2.5 text-left hover:border-[var(--line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] md:min-w-[220px]"
          type="button"
        >
          <StoreIcon className="shrink-0 text-[var(--text-subtle)]" size={16} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink)]">
            {currentStore?.label || "选择店铺"}
          </span>
          <ChevronDown className="shrink-0 text-[var(--text-subtle)]" size={15} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          className="z-50 min-w-[260px] rounded-md border border-[var(--line)] bg-white p-1.5 shadow-[var(--shadow-md)]"
          sideOffset={6}
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs font-medium text-[var(--text-subtle)]">
            已授权店铺
          </DropdownMenu.Label>
          {stores.length > 8 && (
            <div className="px-1 pb-1.5">
              <input
                aria-label="搜索店铺"
                className="h-8 w-full rounded border border-[var(--line)] bg-white px-2 text-sm outline-none focus:border-[var(--focus)] focus:ring-2 focus:ring-[var(--focus)]/20"
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="搜索店铺名称或 ID"
                value={search}
              />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto">
            {visibleStores.map((store) => (
              <DropdownMenu.Item
                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-[highlighted]:bg-[var(--surface-muted)]"
                key={store.id}
                onSelect={() => onSelect(store)}
              >
                <span className="grid size-7 place-items-center rounded-sm bg-[var(--surface-strong)] text-xs font-semibold text-[var(--ink)]">
                  {store.label.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[var(--ink)]">{store.label}</span>
                  <span className="block truncate text-xs text-[var(--text-subtle)]">
                    {store.environment === "demo"
                      ? "未连接平台"
                      : store.businessMode}
                  </span>
                </span>
                {store.id === currentStore?.id && <Check className="text-[var(--success)]" size={16} />}
              </DropdownMenu.Item>
            ))}
            {!visibleStores.length && (
              <p className="px-2 py-3 text-sm text-[var(--text-muted)]">没有匹配的店铺</p>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function AccountMenu({ session }: { session: Session }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      try {
        window.localStorage.removeItem(CURRENT_STORE_STORAGE_KEY);
      } catch {
        // Storage can be unavailable; the authenticated query cache is still cleared.
      }
      navigate("/login", { replace: true });
    },
  });
  const roleLabel = ["owner", "admin"].includes(session.user.role) ? "管理员" : "成员";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label="打开用户菜单"
          className="flex size-9 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--text-muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          type="button"
        >
          <UserRound size={17} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="z-50 w-64 rounded-md border border-[var(--line)] bg-white p-1.5 shadow-[var(--shadow-md)]"
          sideOffset={6}
        >
          <div className="px-2 py-2">
            <p className="truncate text-sm font-medium text-[var(--ink)]">
              {session.user.displayName || session.user.email}
            </p>
            <p className="mt-0.5 truncate text-xs text-[var(--text-subtle)]">
              {roleLabel} · {session.user.email}
            </p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-[var(--line)]" />
          <DropdownMenu.Item
            className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm text-[var(--danger)] outline-none data-[highlighted]:bg-[var(--danger-soft)]"
            onSelect={() => logout.mutate()}
          >
            <LogOut size={16} />
            退出登录
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const navItems = [
  { path: "overview", suffix: "overview", label: "总览", icon: LayoutDashboard },
  { path: "today-work", suffix: "today-work", label: "今日工作", icon: ClipboardList },
  { path: "products", suffix: "products", label: "商品经营", icon: ShoppingBag },
  { path: "publishing", suffix: "publishing", label: "商品审核中心", icon: Send },
  { path: "sales-inventory", suffix: "sales-inventory", label: "销量与库存", icon: TrendingUp },
  { path: "alerts", suffix: "alerts", label: "经营预警", icon: BellRing },
  { path: "compliance", suffix: "compliance", label: "合规工作台", icon: ShieldCheck },
  { path: "products/drafts", suffix: "products/drafts", label: "商品草稿", icon: FilePenLine },
  { path: "products/batch-new", suffix: "products/batch-new", label: "批量建品", icon: Layers3 },
  { path: "products/new", suffix: "products/new", label: "新建商品", icon: Plus },
];

// Warm only the heaviest operational routes when a user points at (or tabs
// to) them. The browser reuses the same Vite chunks on click, so navigation
// does not wait for a cold lazy import while the page is mounting.
const navPrefetchers: Record<string, () => Promise<unknown>> = {
  publishing: () => import("../features/publishing/PublishBatchesPage"),
  compliance: () => import("../features/compliance/CompliancePage"),
  "sales-inventory": () => import("../features/operations/SalesInventoryPage"),
};

function prefetchNavRoute(path: string) {
  void navPrefetchers[path]?.();
}

function Sidebar({
  currentStore,
  canManageMembers,
  mobileOpen,
  onClose,
}: {
  currentStore: Store | null;
  canManageMembers: boolean;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const storeId = currentStore?.id;
  return (
    <>
      {mobileOpen && (
        <button
          aria-label="关闭导航背景"
          className="fixed inset-0 z-30 bg-black/20 lg:hidden"
          onClick={onClose}
          type="button"
        />
      )}
      <aside
        className={cn(
          "commercial-sidebar fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col border-r border-[var(--line)] bg-[var(--sidebar)] transition-transform lg:w-[236px] lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-[var(--line)] px-4">
          <div className="grid size-8 place-items-center rounded-md bg-[var(--ink)] text-[11px] font-black text-white">
            HZ
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--ink)]">SHEIN超级运营中心</p>
            <p className="mt-0.5 text-[11px] text-[var(--text-subtle)]">运营工作台</p>
          </div>
          <Button aria-label="关闭导航" className="lg:hidden" onClick={onClose} size="icon" variant="ghost">
            <X size={18} />
          </Button>
        </div>

        <div
          className="commercial-sidebar__context"
          title={currentStore?.label || "尚未选择店铺"}
        >
          <StoreIcon size={14} />
          <span className="min-w-0 flex-1 truncate">
            {currentStore?.label || "尚未选择店铺"}
          </span>
          <span
            aria-label={currentStore?.status === "active" ? "授权正常" : "需要检查店铺状态"}
            className={cn(
              "commercial-sidebar__context-dot",
              currentStore?.status === "active" && currentStore.environment !== "demo"
                ? "commercial-sidebar__context-dot--ok"
                : "commercial-sidebar__context-dot--warning",
            )}
          />
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="主导航">
          <p className="mb-2 px-2 text-[11px] font-semibold text-[var(--text-subtle)]">经营中心</p>
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return storeId || item.path === "today-work" ? (
                <NavLink
                  className={({ isActive }) =>
                    cn(
                      "commercial-nav-link flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]",
                      isActive && "commercial-nav-link--active bg-[var(--nav-active)] text-[var(--ink)]",
                    )
                  }
                  end
                  key={item.path}
                  onClick={onClose}
                  onFocus={() => prefetchNavRoute(item.path)}
                  onMouseEnter={() => prefetchNavRoute(item.path)}
                  to={item.path === "today-work"
                    ? "/app/today-work"
                    : item.path === "overview"
                    ? `/app/overview?store=${encodeURIComponent(storeId || "")}`
                    : `/app/operations/${encodeURIComponent(storeId || "")}/${item.path}`}
                >
                  <Icon size={17} />
                  {item.label}
                </NavLink>
              ) : (
                <span className="flex h-9 items-center gap-3 px-2.5 text-sm text-[var(--text-subtle)]" key={item.path}>
                  <Icon size={17} />
                  {item.label}
                </span>
              );
            })}
          </div>
          <p className="mb-2 mt-5 px-2 text-[11px] font-semibold text-[var(--text-subtle)]">模板中心</p>
          {storeId ? (
            <div className="space-y-1">
              <NavLink
                className={({ isActive }) =>
                  cn(
                    "commercial-nav-link flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]",
                    isActive && "commercial-nav-link--active bg-[var(--nav-active)] text-[var(--ink)]",
                  )
                }
                onClick={onClose}
                to={`/app/templates/${encodeURIComponent(storeId)}/title-rules`}
              >
                <FileText size={17} />
                标题规则
              </NavLink>
              <NavLink
                className={({ isActive }) =>
                  cn(
                    "commercial-nav-link flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]",
                    isActive && "commercial-nav-link--active bg-[var(--nav-active)] text-[var(--ink)]",
                  )
                }
                onClick={onClose}
                to={`/app/templates/${encodeURIComponent(storeId)}/attributes`}
              >
                <BookCopy size={17} />
                商品属性
              </NavLink>
              <NavLink
                className={({ isActive }) =>
                  cn(
                    "commercial-nav-link flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]",
                    isActive && "commercial-nav-link--active bg-[var(--nav-active)] text-[var(--ink)]",
                  )
                }
                onClick={onClose}
                to={`/app/templates/${encodeURIComponent(storeId)}/sizes`}
              >
                <Ruler size={17} />
                颜色与尺寸
              </NavLink>
              <NavLink
                className={({ isActive }) =>
                  cn(
                    "commercial-nav-link flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]",
                    isActive && "commercial-nav-link--active bg-[var(--nav-active)] text-[var(--ink)]",
                  )
                }
                onClick={onClose}
                to={`/app/templates/${encodeURIComponent(storeId)}/packaging`}
              >
                <FileSpreadsheet size={17} />
                打包体积
              </NavLink>
              <NavLink
                className={({ isActive }) =>
                  cn(
                    "flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]",
                    isActive && "bg-[var(--nav-active)] text-[var(--ink)]",
                  )
                }
                onClick={onClose}
                to={`/app/templates/${encodeURIComponent(storeId)}/tail-images`}
              >
                <Images size={17} />
                通用商品图片
              </NavLink>
              <NavLink
                className={({ isActive }) =>
                  cn(
                    "commercial-nav-link flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]",
                    isActive && "commercial-nav-link--active bg-[var(--nav-active)] text-[var(--ink)]",
                  )
                }
                onClick={onClose}
                to={`/app/templates/${encodeURIComponent(storeId)}/compliance`}
              >
                <ShieldCheck size={17} />
                合规实拍图
              </NavLink>
            </div>
          ) : (
            <div className="space-y-1">
              <span className="flex h-9 items-center gap-3 px-2.5 text-sm text-[var(--text-subtle)]">
                <FileText size={17} />
                标题规则
              </span>
              <span className="flex h-9 items-center gap-3 px-2.5 text-sm text-[var(--text-subtle)]">
                <BookCopy size={17} />
                商品属性
              </span>
              <span className="flex h-9 items-center gap-3 px-2.5 text-sm text-[var(--text-subtle)]">
                <Ruler size={17} />
                颜色与尺寸
              </span>
              <span className="flex h-9 items-center gap-3 px-2.5 text-sm text-[var(--text-subtle)]">
                <FileSpreadsheet size={17} />
                打包体积
              </span>
              <span className="flex h-9 items-center gap-3 px-2.5 text-sm text-[var(--text-subtle)]">
                <Images size={17} />
                通用商品图片
              </span>
              <span className="flex h-9 items-center gap-3 px-2.5 text-sm text-[var(--text-subtle)]">
                <ShieldCheck size={17} />
                合规实拍图
              </span>
            </div>
          )}
        </nav>

        <div className="border-t border-[var(--line)] p-3">
          <NavLink
            className={({ isActive }) =>
              cn(
                "commercial-nav-link flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]",
                isActive && "commercial-nav-link--active bg-[var(--nav-active)] text-[var(--ink)]",
              )
            }
            onClick={onClose}
            to="/app/settings/stores"
          >
            <Settings size={17} />
            店铺管理
          </NavLink>
          {canManageMembers && (
            <NavLink
              className={({ isActive }) =>
                cn(
                  "commercial-nav-link mt-1 flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]",
                  isActive && "commercial-nav-link--active bg-[var(--nav-active)] text-[var(--ink)]",
                )
              }
              onClick={onClose}
              to="/app/settings/members"
            >
              <Users size={17} />
              成员权限
            </NavLink>
          )}
        </div>
      </aside>
    </>
  );
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [persistedStoreId, setPersistedStoreId] = useState(() => {
    try {
      return window.localStorage.getItem(CURRENT_STORE_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: api.session });
  const sessionScope = sessionQuery.data ? `${sessionQuery.data.tenant.id}:${sessionQuery.data.user.id}` : "anonymous";
  const storesQueryKey = ["stores", sessionScope] as const;
  const storesQuery = useQuery({
    queryKey: storesQueryKey,
    queryFn: api.stores,
    enabled: sessionQuery.isSuccess,
  });
  const storeId = decodeURIComponent(
    location.pathname.match(/^\/app\/(?:operations|templates)\/([^/]+)/)?.[1] || "",
  );
  const overviewStoreId = location.pathname === "/app/overview"
    ? String(new URLSearchParams(location.search).get("store") || "")
    : "";
  const stores = useMemo(
    () => (storesQuery.data?.stores || []).filter(isAuthorizedSheinStore),
    [storesQuery.data],
  );
  const selectedStoreId = storeId || overviewStoreId || persistedStoreId;
  const currentStore = stores.find((store) => store.id === selectedStoreId) || stores[0] || null;

  useEffect(() => {
    if (!currentStore || !stores.some((store) => store.id === currentStore.id)) return;
    setPersistedStoreId(currentStore.id);
    try {
      window.localStorage.setItem(CURRENT_STORE_STORAGE_KEY, currentStore.id);
    } catch {
      // Storage can be unavailable in restricted browser contexts; routing still remains scoped.
    }
  }, [currentStore, stores]);
  const workspaceUsageQuery = useQuery({
    queryKey: ["store", sessionQuery.data ? `${sessionQuery.data.tenant.id}:${sessionQuery.data.user.id}` : "anonymous", currentStore?.id || "", "workspace-usage"],
    queryFn: () => api.workspaceUsage(currentStore!.id),
    enabled: Boolean(currentStore?.id),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const sessionError = sessionQuery.error as ApiError | null;
  useEffect(() => {
    if (sessionError?.status !== 401) return;
    queryClient.clear();
    setPersistedStoreId("");
    try {
      window.localStorage.removeItem(CURRENT_STORE_STORAGE_KEY);
    } catch {
      // Storage can be unavailable; the in-memory session and store selection are cleared.
    }
  }, [queryClient, sessionError]);

  if (sessionQuery.isLoading || (sessionQuery.isSuccess && storesQuery.isLoading)) {
    return <LoadingScreen />;
  }
  if (sessionError?.status === 401) return <Navigate replace to="/login" />;
  if (sessionQuery.error || storesQuery.error || !sessionQuery.data) {
    const error = (sessionQuery.error || storesQuery.error) as Error | null;
    return <ErrorScreen message={error?.message || "无法读取登录信息"} />;
  }
  if (storeId && !stores.some((store) => store.id === storeId)) {
    return <Navigate replace to="/app" />;
  }

  const selectStore = (store: Store) => {
    setPersistedStoreId(store.id);
    try {
      window.localStorage.setItem(CURRENT_STORE_STORAGE_KEY, store.id);
    } catch {
      // Keep the in-memory selection even when browser storage is unavailable.
    }
    const nextPath = location.pathname === "/app/today-work"
      ? "/app/today-work"
      : location.pathname === "/app/overview"
      ? `/app/overview?store=${encodeURIComponent(store.id)}`
      : storeId
        ? location.pathname.replace(encodeURIComponent(storeId), encodeURIComponent(store.id))
        : `/app/operations/${encodeURIComponent(store.id)}/products`;
    navigate(nextPath);
  };

  return (
    <div className="commercial-shell min-h-dvh bg-[var(--page)] text-[var(--ink)]">
      <Sidebar
        canManageMembers={["owner", "admin"].includes(sessionQuery.data.user.role)}
        currentStore={currentStore}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      <div className="min-h-dvh lg:pl-[236px]">
        <header className="commercial-topbar sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[var(--line)] bg-white/95 px-3 backdrop-blur sm:px-5">
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button aria-label="打开导航" className="lg:hidden" onClick={() => setMobileOpen(true)} size="icon" variant="ghost">
                <Menu size={19} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="tooltip" sideOffset={5}>打开导航</Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
          <StoreSwitcher stores={stores} currentStore={currentStore} onSelect={selectStore} />
          <div className="ml-auto flex items-center gap-2">
            {workspaceUsageQuery.data && (
              <span
                className={cn(
                  "hidden items-center rounded-md px-2 py-1 text-[11px] font-medium md:flex",
                  workspaceUsageQuery.data.alerts.some((alert) => alert.level === "error")
                    ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                    : workspaceUsageQuery.data.alerts.length
                      ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                      : "bg-[var(--surface-muted)] text-[var(--text-muted)]",
                )}
                role="status"
                title={workspaceUsageQuery.data.alerts.map((alert) => alert.message).join("；") || "当前账号与店铺的草稿、图片使用量"}
              >
                草稿 {workspaceUsageQuery.data.drafts.storeUsed}/{workspaceUsageQuery.data.drafts.storeLimit}
                <span className="mx-1 text-[var(--text-subtle)]">·</span>
                图片 {workspaceUsageQuery.data.media.storeUsed}/{workspaceUsageQuery.data.media.storeLimit}
              </span>
            )}
            <span
              className={`hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium sm:flex ${
                !currentStore
                  ? "bg-[var(--surface-muted)] text-[var(--text-muted)]"
                  : currentStore.environment === "demo" || currentStore.status !== "active"
                    ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                    : "bg-[var(--success-soft)] text-[var(--success-strong)]"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  !currentStore
                    ? "bg-[var(--text-subtle)]"
                    : currentStore.environment === "demo" || currentStore.status !== "active"
                      ? "bg-[var(--warning)]"
                      : "bg-[var(--success)]"
                }`}
              />
              {!currentStore
                ? "未绑定店铺"
                : currentStore.environment === "demo"
                  ? "未连接平台"
                  : currentStore.status === "active"
                    ? "授权正常"
                    : currentStore.status === "reauthorization_required"
                      ? "需要重新授权"
                      : "已停用"}
            </span>
            {currentStore && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    aria-label="打开任务中心"
                    onClick={() => navigate(`/app/operations/${encodeURIComponent(currentStore.id)}/jobs`)}
                    size="icon"
                    variant={location.pathname.endsWith("/jobs") ? "outline" : "ghost"}
                  >
                    <ListChecks size={17} />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className="tooltip" sideOffset={5}>任务中心</Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            )}
            <AccountMenu session={sessionQuery.data} />
          </div>
        </header>
        <main className="commercial-main mx-auto w-full max-w-[1600px] p-3 sm:p-5 lg:p-6">
          <Outlet
            key={storeId || "workspace-without-store"}
            context={{ session: sessionQuery.data, stores, currentStore }}
          />
        </main>
      </div>
    </div>
  );
}

export function AppStart() {
  const { stores } = useAppContext();
  if (stores.length) {
    return <Navigate replace to="/app/overview" />;
  }
  return (
    <section className="empty-panel min-h-[420px]">
      <span className="empty-icon"><StoreIcon size={22} /></span>
      <h1>还没有可访问的店铺</h1>
      <p>管理员完成 SHEIN 授权或店铺分配后，这里会显示经营数据。</p>
    </section>
  );
}
