import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  KeyRound,
  Link2,
  LoaderCircle,
  Pencil,
  ShieldCheck,
  Store as StoreIcon,
  Trash2,
  X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import { api, type Store } from "../../lib/api";
import { formatTime } from "../operations/OperationsShared";

export function StoresPage() {
  const { stores, session } = useAppContext();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger";
    message: string;
  } | null>(null);
  const canManage = ["owner", "admin"].includes(session.user.role);
  const storesQueryKey = ["stores", `${session.tenant.id}:${session.user.id}`] as const;
  const authorizeStore = useMutation({
    mutationFn: api.startSheinAuthorization,
    onSuccess: ({ authorizationUrl }) => {
      if (!authorizationUrl) {
        setFeedback({ tone: "danger", message: "授权服务未返回 SHEIN 地址" });
        return;
      }
      window.location.assign(authorizationUrl);
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });
  const renameStore = useMutation({
    mutationFn: ({ storeId, label }: { storeId: string; label: string }) =>
      api.renameStore(storeId, label),
    onSuccess: ({ store }) => {
      queryClient.setQueryData<{ stores: Store[]; count: number }>(
        storesQueryKey,
        (current) => current
          ? {
              ...current,
              stores: current.stores.map((item) =>
                item.id === store.id ? { ...item, ...store } : item,
              ),
            }
          : current,
      );
      setEditingStoreId(null);
      setDraftLabel("");
      setFeedback({
        tone: "success",
        message: canManage ? `已保存管理员店铺别名：${store.label}` : `已保存店铺名称：${store.label}`,
      });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });
  const revokeStore = useMutation({
    mutationFn: (storeId: string) => api.revokeStoreAuthorization(storeId),
    onSuccess: ({ store }) => {
      queryClient.setQueryData<{ stores: Store[]; count: number }>(
        storesQueryKey,
        (current) => current
          ? {
              ...current,
              stores: current.stores.filter((item) => item.id !== store.id),
              count: Math.max(0, current.count - 1),
            }
          : current,
      );
      setFeedback({
        tone: "success",
        message: `已删除“${store.label}”的授权，历史数据已保留`,
      });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const authorized = params.get("sheinAuthorized");
    const authorizationError = params.get("sheinAuthError");
    if (!authorized && !authorizationError) return;

    if (authorized) {
      const storeLabel = params.get("storeLabel") || "SHEIN 店铺";
      setFeedback({ tone: "success", message: `${storeLabel}授权成功` });
      queryClient.invalidateQueries({ queryKey: storesQueryKey });
    } else {
      setFeedback({
        tone: "danger",
        message: authorizationError || "SHEIN 授权失败",
      });
    }

    params.delete("sheinAuthorized");
    params.delete("sheinAuthError");
    params.delete("storeLabel");
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "" },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate, queryClient]);

  const beginEditing = (store: Store) => {
    setFeedback(null);
    setEditingStoreId(store.id);
    setDraftLabel(canManage ? store.adminAlias || "" : store.label);
  };

  const cancelEditing = () => {
    setEditingStoreId(null);
    setDraftLabel("");
    renameStore.reset();
  };

  const submitRename = (event: FormEvent<HTMLFormElement>, store: Store) => {
    event.preventDefault();
    const normalized = draftLabel.trim().replace(/\s+/g, " ");
    if ((!canManage && !normalized) || normalized.length > 40) {
      setFeedback({ tone: "danger", message: canManage ? "管理员店铺别名不能超过40个字符" : "店铺名称需为1至40个字符" });
      return;
    }
    if (normalized === (canManage ? store.adminAlias || "" : store.label)) {
      cancelEditing();
      return;
    }
    renameStore.mutate({ storeId: store.id, label: normalized });
  };

  const confirmRevoke = (store: Store) => {
    if (!canManage || store.status === "disabled") return;
    if (!window.confirm(`确定删除“${store.label}”的店铺授权吗？\n\n授权凭证会被清除，历史数据会保留。`)) {
      return;
    }
    setFeedback(null);
    revokeStore.mutate(store.id);
  };

  return (
    <>
      <header className="mb-5">
        <p className="text-xs font-medium text-[var(--text-subtle)]">设置</p>
        <h1 className="mt-1.5 text-2xl font-semibold text-[var(--ink)]">店铺管理</h1>
        <p className="mt-1.5 text-sm text-[var(--text-muted)]">
          当前账号可访问 {stores.length} 家 SHEIN 店铺
        </p>
      </header>
      {feedback && (
        <div
          className={feedback.tone === "danger" ? "notice notice-danger" : "notice notice-success"}
          role={feedback.tone === "danger" ? "alert" : "status"}
        >
          {feedback.tone === "success" ? <Check size={16} /> : <X size={16} />}
          <span className="min-w-0 flex-1">{feedback.message}</span>
          <Button
            aria-label="关闭提示"
            className="ml-auto"
            onClick={() => setFeedback(null)}
            size="icon"
            title="关闭提示"
            variant="ghost"
          >
            <X size={15} />
          </Button>
        </div>
      )}
      <section className="data-panel">
        <header className="data-toolbar">
          <div><h2>授权店铺</h2><p>店铺密钥仅在服务端加密保存</p></div>
          <div className="flex items-center gap-2">
            {canManage && (
              <span className="hidden items-center gap-1.5 text-xs font-medium text-[var(--success-strong)] sm:flex">
                <ShieldCheck size={15} /> 管理员权限
              </span>
            )}
            <Button
              disabled={authorizeStore.isPending}
              onClick={() => {
                setFeedback(null);
                authorizeStore.mutate();
              }}
            >
              {authorizeStore.isPending
                ? <LoaderCircle className="animate-spin" size={16} />
                : <Link2 size={16} />}
              {authorizeStore.isPending
                ? "正在打开 SHEIN"
                : stores.length
                  ? "授权或重新授权"
                  : "授权 SHEIN 店铺"}
            </Button>
          </div>
        </header>
        {stores.length ? (
          <div className="divide-y divide-[var(--line)]">
            {stores.map((store) => (
              <article className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5" key={store.id}>
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[var(--surface-muted)] text-[var(--text-muted)]">
                  <StoreIcon size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  {editingStoreId === store.id ? (
                    <form
                      className="flex max-w-md items-center gap-1.5"
                      onSubmit={(event) => submitRename(event, store)}
                    >
                      <label className="sr-only" htmlFor={`store-label-${store.id}`}>
                        {canManage ? "管理员店铺别名" : "店铺显示名称"}
                      </label>
                      <input
                        autoFocus
                        className="field h-9 min-w-0 flex-1 px-2.5"
                        disabled={renameStore.isPending}
                        id={`store-label-${store.id}`}
                        maxLength={40}
                        onChange={(event) => setDraftLabel(event.target.value)}
                        placeholder={canManage ? `默认使用：${store.baseLabel || store.label}` : "店铺显示名称"}
                        value={draftLabel}
                      />
                      <Button
                        aria-label={canManage ? "保存管理员店铺别名" : "保存店铺名称"}
                        disabled={renameStore.isPending}
                        size="icon"
                        title="保存"
                        type="submit"
                      >
                        {renameStore.isPending
                          ? <LoaderCircle className="animate-spin" size={16} />
                          : <Check size={16} />}
                      </Button>
                      <Button
                        aria-label="取消修改"
                        disabled={renameStore.isPending}
                        onClick={cancelEditing}
                        size="icon"
                        title="取消"
                        variant="ghost"
                      >
                        <X size={16} />
                      </Button>
                    </form>
                  ) : (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-medium text-[var(--ink)]">{store.label}</h2>
                        {canManage && (
                          <p className="mt-0.5 truncate text-xs text-[var(--text-subtle)]">
                            成员看到：{store.baseLabel || store.label}
                          </p>
                        )}
                      </div>
                      <Button
                        aria-label={canManage ? `修改${store.label}的管理员店铺别名` : `修改${store.label}的名称`}
                        className="size-8"
                        disabled={renameStore.isPending || store.status !== "active"}
                        onClick={() => beginEditing(store)}
                        size="icon"
                        title={store.status === "active" ? (canManage ? "修改管理员店铺别名" : "修改店铺名称") : "请先恢复店铺授权"}
                        variant="ghost"
                      >
                        <Pencil size={14} />
                      </Button>
                      {canManage && (
                        <Button
                          aria-label={`删除${store.label}的授权`}
                          className="size-8 text-[var(--danger-strong)] hover:text-[var(--danger-strong)]"
                          disabled={revokeStore.isPending || store.status === "disabled"}
                          onClick={() => confirmRevoke(store)}
                          size="icon"
                          title={store.status === "active" ? "删除授权" : "授权已删除"}
                          variant="ghost"
                        >
                          {revokeStore.isPending
                            ? <LoaderCircle className="animate-spin" size={14} />
                            : <Trash2 size={14} />}
                        </Button>
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-[var(--text-subtle)]">
                    {store.businessMode} · Supplier ID {store.supplierId || "未返回"}
                  </p>
                </div>
                <div className="flex items-center gap-5 text-xs text-[var(--text-subtle)] sm:text-right">
                  <span>最近同步<br /><strong className="mt-1 block font-medium text-[var(--ink)]">{formatTime(store.lastSyncedAt)}</strong></span>
                  <span
                    className={
                      store.status === "active"
                        ? "store-status store-status-active"
                        : "store-status store-status-warning"
                    }
                  >
                    <KeyRound size={13} />{" "}
                    {store.status === "active"
                      ? "授权正常"
                      : store.status === "reauthorization_required"
                        ? "需要重新授权"
                        : "授权已删除"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid min-h-72 place-items-center text-center">
            <div><StoreIcon className="mx-auto text-[var(--text-subtle)]" size={24} /><p className="mt-3 text-sm">暂无可访问店铺</p></div>
          </div>
        )}
      </section>
    </>
  );
}
