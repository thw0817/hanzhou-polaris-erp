import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Check,
  Copy,
  Eye,
  LoaderCircle,
  Mail,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  Store as StoreIcon,
  UserRound,
  UserRoundCheck,
  UserPlus,
  UserRoundX,
  Users,
  X,
} from "lucide-react";
import { Navigate } from "react-router";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import {
  api,
  type ManagedMemberRole,
  type MemberSummary,
} from "../../lib/api";
import { cn } from "../../lib/cn";

const roleLabels: Record<MemberSummary["role"], string> = {
  owner: "所有者",
  admin: "管理员",
  operator: "运营成员",
  viewer: "只读成员",
};

export function MembersPage() {
  const { session, stores } = useAppContext();
  const queryClient = useQueryClient();
  const isAdministrator = ["owner", "admin"].includes(session.user.role);
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const membersQueryKey = ["tenant", queryScope, "members"] as const;
  const aiTitleSettingsQueryKey = ["tenant", session.tenant.id, "ai-title-settings"] as const;
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingAliasMemberId, setEditingAliasMemberId] = useState<string | null>(null);
  const [draftMemberAlias, setDraftMemberAlias] = useState("");
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [memberToDisable, setMemberToDisable] = useState<MemberSummary | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDisplayName, setInviteDisplayName] = useState("");
  const [inviteRole, setInviteRole] = useState<ManagedMemberRole>("operator");
  const [inviteStoreIds, setInviteStoreIds] = useState<string[]>([]);
  const [inviteLink, setInviteLink] = useState("");
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [aiApiUrl, setAiApiUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiModelUrl, setAiModelUrl] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger";
    message: string;
  } | null>(null);
  const membersQuery = useQuery({
    queryKey: membersQueryKey,
    queryFn: api.members,
    enabled: isAdministrator,
  });
  const aiSettingsQuery = useQuery({
    queryKey: aiTitleSettingsQueryKey,
    queryFn: api.aiTitleSettings,
    enabled: isAdministrator,
    staleTime: 60_000,
  });
  useEffect(() => {
    const settings = aiSettingsQuery.data;
    if (!settings) return;
    setAiApiUrl(settings.apiUrl);
    setAiModel(settings.model);
    setAiModelUrl(settings.modelUrl);
  }, [aiSettingsQuery.data]);
  const updateAccess = useMutation({
    mutationFn: ({ userId, storeIds }: { userId: string; storeIds: string[] }) =>
      api.updateMemberStoreAccess(userId, storeIds),
    onSuccess: ({ member }) => {
      queryClient.setQueryData<{ members: MemberSummary[]; count: number }>(
        membersQueryKey,
        (current) => current
          ? {
              ...current,
              members: current.members.map((item) =>
                item.id === member.id ? member : item,
              ),
            }
          : current,
      );
      setEditingMemberId(null);
      setSelectedStoreIds([]);
      setFeedback({
        tone: "success",
        message: `已更新 ${member.displayName || member.email} 的店铺权限`,
      });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });
  const updateFeature = useMutation({
    mutationFn: ({ userId, enabled }: { userId: string; enabled: boolean }) =>
      api.updateMemberFeatureAccess(userId, "ai_title", enabled),
    onSuccess: ({ member }) => {
      queryClient.setQueryData<{ members: MemberSummary[]; count: number }>(
        membersQueryKey,
        (current) => current
          ? {
              ...current,
              members: current.members.map((item) => item.id === member.id ? member : item),
            }
          : current,
      );
      setFeedback({
        tone: "success",
        message: `${member.displayName || member.email} 的 AI 标题权限已${member.features?.aiTitle ? "开启" : "关闭"}`,
      });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });
  const saveAiSettings = useMutation({
    mutationFn: () => api.saveAiTitleSettings({
      apiUrl: aiApiUrl.trim(),
      model: aiModel.trim(),
      modelUrl: aiModelUrl.trim(),
      apiKey: aiApiKey,
    }),
    onSuccess: (settings) => {
      queryClient.setQueryData(aiTitleSettingsQueryKey, settings);
      setAiApiKey("");
      setFeedback({ tone: "success", message: "AI 标题服务配置已保存，密钥仅在服务端加密存储" });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });
  const updateMember = useMutation({
    mutationFn: ({
      userId,
      input,
    }: {
      userId: string;
      input: { role?: "operator" | "viewer"; status?: "active" | "disabled" };
    }) => api.updateManagedMember(userId, input),
    onSuccess: ({ member }) => {
      queryClient.setQueryData<{ members: MemberSummary[]; count: number }>(
        membersQueryKey,
        (current) => current
          ? {
              ...current,
              members: current.members.map((item) =>
                item.id === member.id ? member : item,
              ),
            }
          : current,
      );
      setMemberToDisable(null);
      setFeedback({
        tone: "success",
        message: `已更新 ${member.displayName || member.email} 的成员设置`,
      });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });
  const updateMemberAlias = useMutation({
    mutationFn: ({ userId, alias }: { userId: string; alias: string }) =>
      api.updateMemberAdminAlias(userId, alias),
    onSuccess: ({ member }) => {
      queryClient.setQueryData<{ members: MemberSummary[]; count: number }>(
        membersQueryKey,
        (current) => current
          ? {
              ...current,
              members: current.members.map((item) =>
                item.id === member.id ? member : item,
              ),
            }
          : current,
      );
      setEditingAliasMemberId(null);
      setDraftMemberAlias("");
      setFeedback({ tone: "success", message: `已保存${member.displayName || member.email}的管理员别名` });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });
  const createInvitation = useMutation({
    mutationFn: api.createMemberInvitation,
    onSuccess: ({ token }) => {
      setInviteLink(`${window.location.origin}/invite/${encodeURIComponent(token)}`);
      setInviteLinkCopied(false);
    },
  });

  if (!isAdministrator) return <Navigate replace to="/app/settings/stores" />;

  const beginEditing = (member: MemberSummary) => {
    const activeStoreIds = new Set(
      stores.filter((store) => store.status === "active").map((store) => store.id),
    );
    setFeedback(null);
    setEditingMemberId(member.id);
    setSelectedStoreIds(
      member.stores.map((store) => store.id).filter((id) => activeStoreIds.has(id)),
    );
  };

  const toggleStore = (storeId: string) => {
    setSelectedStoreIds((current) => current.includes(storeId)
      ? current.filter((id) => id !== storeId)
      : [...current, storeId]);
  };

  const cancelEditing = () => {
    setEditingMemberId(null);
    setSelectedStoreIds([]);
    updateAccess.reset();
  };

  const updateProfile = (
    member: MemberSummary,
    input: { role?: "operator" | "viewer"; status?: "active" | "disabled" },
  ) => {
    setFeedback(null);
    setEditingMemberId(null);
    setSelectedStoreIds([]);
    updateMember.mutate({ userId: member.id, input });
  };

  const beginAliasEditing = (member: MemberSummary) => {
    setFeedback(null);
    setEditingAliasMemberId(member.id);
    setDraftMemberAlias(member.adminAlias || "");
  };

  const cancelAliasEditing = () => {
    setEditingAliasMemberId(null);
    setDraftMemberAlias("");
    updateMemberAlias.reset();
  };

  const submitAlias = (member: MemberSummary) => {
    const normalized = draftMemberAlias.trim().replace(/\s+/g, " ");
    if (normalized.length > 120) {
      setFeedback({ tone: "danger", message: "管理员账户别名不能超过120个字符" });
      return;
    }
    if (normalized === (member.adminAlias || "")) {
      cancelAliasEditing();
      return;
    }
    updateMemberAlias.mutate({ userId: member.id, alias: normalized });
  };

  const resetInvitationDraft = () => {
    setInviteEmail("");
    setInviteDisplayName("");
    setInviteRole("operator");
    setInviteStoreIds(
      stores.filter((store) => store.status === "active").map((store) => store.id),
    );
    setInviteLink("");
    setInviteLinkCopied(false);
    createInvitation.reset();
  };

  const openInvitationForm = () => {
    setFeedback(null);
    resetInvitationDraft();
    setInviteOpen(true);
  };

  const toggleInviteStore = (storeId: string) => {
    setInviteStoreIds((current) => current.includes(storeId)
      ? current.filter((id) => id !== storeId)
      : [...current, storeId]);
  };

  const copyInvitationLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteLinkCopied(true);
    } catch {
      setFeedback({ tone: "danger", message: "无法自动复制，请手动选择邀请链接" });
    }
  };

  return (
    <>
      <header className="mb-5">
        <p className="text-xs font-medium text-[var(--text-subtle)]">设置</p>
        <h1 className="mt-1.5 text-2xl font-semibold text-[var(--ink)]">成员与店铺权限</h1>
        <p className="mt-1.5 text-sm text-[var(--text-muted)]">
          当前工作空间共 {membersQuery.data?.count ?? 0} 名成员
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
            onClick={() => setFeedback(null)}
            size="icon"
            title="关闭提示"
            variant="ghost"
          >
            <X size={15} />
          </Button>
        </div>
      )}

      {memberToDisable && (
        <div className="notice notice-danger" role="alert">
          <UserRoundX className="shrink-0" size={17} />
          <span className="min-w-0 flex-1">
            停用 {memberToDisable.displayName || memberToDisable.email} 后，该成员的网页登录会立即失效。
          </span>
          <Button
            disabled={updateMember.isPending}
            onClick={() => setMemberToDisable(null)}
            size="sm"
            variant="ghost"
          >
            取消
          </Button>
          <Button
            disabled={updateMember.isPending}
            onClick={() => updateProfile(memberToDisable, { status: "disabled" })}
            size="sm"
            variant="danger"
          >
            {updateMember.isPending && <LoaderCircle className="animate-spin" size={14} />}
            确认停用
          </Button>
        </div>
      )}

      <section className="data-panel mb-5">
        <header className="data-toolbar">
          <div>
            <h2>AI 标题服务</h2>
            <p>管理员在此配置千问兼容视觉接口；密钥不会返回浏览器，也不会写入代码。</p>
          </div>
          <span className={aiSettingsQuery.data?.configured ? "status-badge compliance-status-success" : "status-badge"}>
            {aiSettingsQuery.data?.configured ? "已配置" : "未配置"}
          </span>
        </header>
        <form
          className="grid gap-4 px-4 py-5 sm:grid-cols-2 sm:px-5"
          onSubmit={(event) => {
            event.preventDefault();
            saveAiSettings.mutate();
          }}
        >
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">视觉 API 地址（HTTPS）</span>
            <input autoComplete="url" className="field px-3 font-mono text-xs" maxLength={2000} onChange={(event) => setAiApiUrl(event.target.value)} placeholder="https://.../v1/chat/completions" required spellCheck={false} value={aiApiUrl} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">模型名称</span>
            <input className="field px-3 text-xs" maxLength={200} onChange={(event) => setAiModel(event.target.value)} placeholder="可填写模型标识" spellCheck={false} value={aiModel} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">模型地址（可选）</span>
            <input className="field px-3 font-mono text-xs" maxLength={2000} onChange={(event) => setAiModelUrl(event.target.value)} placeholder="模型名称和地址二选一" spellCheck={false} value={aiModelUrl} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">API 密钥</span>
            <input autoComplete="new-password" className="field px-3 font-mono text-xs" maxLength={2000} onChange={(event) => setAiApiKey(event.target.value)} placeholder={aiSettingsQuery.data?.keyHint ? `已配置 ${aiSettingsQuery.data.keyHint}，留空保持不变` : "首次保存必须填写"} spellCheck={false} type="password" value={aiApiKey} />
          </label>
          <div className="flex items-end justify-end gap-2">
            <Button disabled={saveAiSettings.isPending || aiSettingsQuery.isLoading} type="submit">
              {saveAiSettings.isPending && <LoaderCircle className="animate-spin" size={14} />}
              {saveAiSettings.isPending ? "保存中" : "保存 AI 配置"}
            </Button>
          </div>
        </form>
      </section>

      <section className="data-panel">
        <header className="data-toolbar">
          <div><h2>成员列表</h2><p>管理员默认拥有全部店铺，普通成员按白名单访问</p></div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--success-strong)]">
              <ShieldCheck size={15} /> 管理员视图
            </span>
            <Button onClick={inviteOpen ? () => setInviteOpen(false) : openInvitationForm} size="sm">
              {inviteOpen ? <X size={14} /> : <UserPlus size={14} />}
              {inviteOpen ? "收起" : "新增成员"}
            </Button>
          </div>
        </header>

        {inviteOpen && (
          <div className="border-b border-[var(--line)] bg-[var(--surface-muted)] px-4 py-5 sm:px-5">
            {inviteLink ? (
              <div className="mx-auto max-w-3xl">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--success-soft)] text-[var(--success-strong)]">
                    <Check size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-[var(--ink)]">邀请链接已创建</h3>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                      链接将在 24 小时后失效且只能使用一次，请通过可信渠道发送给成员。
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex min-w-0 gap-2">
                  <input
                    aria-label="邀请链接"
                    className="field min-w-0 flex-1 px-3 font-mono text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                    readOnly
                    value={inviteLink}
                  />
                  <Button
                    aria-label="复制邀请链接"
                    onClick={copyInvitationLink}
                    title="复制邀请链接"
                    variant="outline"
                  >
                    {inviteLinkCopied ? <Check size={15} /> : <Copy size={15} />}
                    {inviteLinkCopied ? "已复制" : "复制"}
                  </Button>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button onClick={() => setInviteOpen(false)} size="sm" variant="ghost">完成</Button>
                  <Button onClick={resetInvitationDraft} size="sm" variant="outline">
                    <UserPlus size={14} />继续邀请
                  </Button>
                </div>
              </div>
            ) : (
              <form
                className="mx-auto max-w-3xl"
                onSubmit={(event) => {
                  event.preventDefault();
                  createInvitation.mutate({
                    email: inviteEmail.trim(),
                    displayName: inviteDisplayName.trim(),
                    role: inviteRole,
                    storeIds: inviteStoreIds,
                  });
                }}
              >
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-[var(--ink)]">创建成员邀请</h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                    系统生成一次性链接，不会自动发送邮件。
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">成员邮箱</span>
                    <span className="relative block">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" size={16} />
                      <input
                        autoComplete="email"
                        className="field pl-10 pr-3"
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder="name@company.com"
                        required
                        type="email"
                        value={inviteEmail}
                      />
                    </span>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">显示名称</span>
                    <input
                      className="field px-3"
                      maxLength={120}
                      onChange={(event) => setInviteDisplayName(event.target.value)}
                      required
                      value={inviteDisplayName}
                    />
                  </label>
                  <label className="block sm:max-w-xs">
                    <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">成员角色</span>
                    <select
                      className="field px-3"
                      onChange={(event) => setInviteRole(event.target.value as ManagedMemberRole)}
                      value={inviteRole}
                    >
                      <option value="operator">运营成员</option>
                      <option value="viewer">只读成员</option>
                    </select>
                  </label>
                </div>

                <fieldset className="mt-5">
                  <legend className="text-xs font-medium text-[var(--ink)]">初始店铺权限</legend>
                  <p className="mt-1 text-xs text-[var(--text-subtle)]">已默认选择全部可用店铺</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {stores.map((store) => {
                      const active = store.status === "active";
                      return (
                        <label
                          className={cn(
                            "flex min-h-11 items-center gap-3 rounded-md border border-[var(--line)] bg-white px-3 text-sm",
                            active ? "cursor-pointer" : "cursor-not-allowed opacity-55",
                          )}
                          key={store.id}
                        >
                          <input
                            checked={inviteStoreIds.includes(store.id)}
                            disabled={!active || createInvitation.isPending}
                            onChange={() => toggleInviteStore(store.id)}
                            type="checkbox"
                          />
                          <span className="min-w-0 flex-1 truncate">{store.label}</span>
                          {!active && <span className="text-[11px] text-[var(--warning)]">不可用</span>}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {createInvitation.error && (
                  <div className="mt-4 rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2.5 text-sm text-[var(--danger-strong)]" role="alert">
                    {createInvitation.error.message}
                  </div>
                )}

                <div className="mt-5 flex justify-end gap-2">
                  <Button disabled={createInvitation.isPending} onClick={() => setInviteOpen(false)} size="sm" variant="ghost">取消</Button>
                  <Button disabled={createInvitation.isPending} size="sm" type="submit">
                    {createInvitation.isPending
                      ? <LoaderCircle className="animate-spin" size={14} />
                      : <UserPlus size={14} />}
                    {createInvitation.isPending ? "创建中" : "创建邀请"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        {membersQuery.isLoading && (
          <div className="grid min-h-72 place-items-center text-sm text-[var(--text-muted)]">
            <span className="flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />正在读取成员</span>
          </div>
        )}
        {membersQuery.error && (
          <div className="grid min-h-72 place-items-center px-4 text-center">
            <div>
              <Users className="mx-auto text-[var(--danger)]" size={24} />
              <p className="mt-3 text-sm text-[var(--ink)]">成员列表加载失败</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{membersQuery.error.message}</p>
              <Button className="mt-4" onClick={() => membersQuery.refetch()} size="sm" variant="outline">重试</Button>
            </div>
          </div>
        )}
        {membersQuery.data?.members.length === 0 && (
          <div className="grid min-h-72 place-items-center text-center">
            <div><Users className="mx-auto text-[var(--text-subtle)]" size={24} /><p className="mt-3 text-sm">暂无成员</p></div>
          </div>
        )}
        {membersQuery.data?.members.map((member) => {
          const editable = !member.allStores;
          const isEditing = editingMemberId === member.id;
          const isEditingAlias = editingAliasMemberId === member.id;
          return (
            <article className="border-b border-[var(--line)] last:border-b-0" key={member.id}>
              <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[var(--surface-muted)] text-[var(--text-muted)]">
                  <UserRound size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-medium text-[var(--ink)]">
                      {member.displayName || member.email}
                    </h2>
                    {member.id === session.user.id && <span className="status-badge">当前账号</span>}
                    <span className="status-badge">{roleLabels[member.role]}</span>
                    {member.status === "disabled" && <span className="stock-state stock-danger">已停用</span>}
                  </div>
                  {member.adminAlias && !isEditingAlias && (
                    <p className="mt-1 truncate text-xs text-[var(--text-muted)]">管理员别名：{member.adminAlias}</p>
                  )}
                  <p className="mt-1 truncate text-xs text-[var(--text-subtle)]">{member.email}</p>
                </div>
                <div className="min-w-0 sm:max-w-[44%] sm:text-right">
                  <p className="text-xs font-medium text-[var(--ink)]">
                    {member.allStores ? "全部店铺" : `${member.stores.length} 家店铺`}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--text-subtle)]">
                    {member.allStores
                      ? "按管理员角色继承"
                      : member.stores.map((store) => store.label).join("、") || "尚未分配"}
                  </p>
                </div>
                {!["owner", "admin"].includes(member.role) && (
                  <label className="flex shrink-0 items-center gap-2 rounded-md border border-[var(--line)] bg-white px-2.5 py-2 text-xs text-[var(--text-muted)]">
                    <input
                      checked={member.features?.aiTitle === true}
                      disabled={updateFeature.isPending || updateAccess.isPending || updateMember.isPending}
                      onChange={(event) => updateFeature.mutate({ userId: member.id, enabled: event.target.checked })}
                      type="checkbox"
                    />
                    AI标题
                  </label>
                )}
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    disabled={updateMemberAlias.isPending}
                    onClick={() => isEditingAlias ? cancelAliasEditing() : beginAliasEditing(member)}
                    size="sm"
                    variant="outline"
                  >
                    <Pencil size={14} />
                    {isEditingAlias ? "收起" : "管理员别名"}
                  </Button>
                </div>
                {editable && (
                  <div className="flex items-center gap-1.5">
                    <Button
                      disabled={updateAccess.isPending || updateMember.isPending}
                      onClick={() => isEditing ? cancelEditing() : beginEditing(member)}
                      size="sm"
                      variant="outline"
                    >
                      <StoreIcon size={14} />
                      {isEditing ? "收起" : "分配店铺"}
                    </Button>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <Button
                          aria-label={`管理${member.displayName || member.email}`}
                          disabled={updateAccess.isPending || updateMember.isPending}
                          size="icon"
                          title="成员设置"
                          variant="ghost"
                        >
                          <MoreHorizontal size={16} />
                        </Button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          align="end"
                          className="z-50 min-w-48 rounded-md border border-[var(--line)] bg-white p-1.5 shadow-[var(--shadow-md)]"
                          sideOffset={5}
                        >
                          <DropdownMenu.Label className="px-2 py-1.5 text-xs font-medium text-[var(--text-subtle)]">
                            成员设置
                          </DropdownMenu.Label>
                          <DropdownMenu.Item
                            className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-[highlighted]:bg-[var(--surface-muted)]"
                            onSelect={() => updateProfile(member, {
                              role: member.role === "operator" ? "viewer" : "operator",
                            })}
                          >
                            {member.role === "operator" ? <Eye size={15} /> : <UserRoundCheck size={15} />}
                            {member.role === "operator" ? "设为只读成员" : "设为运营成员"}
                          </DropdownMenu.Item>
                          <DropdownMenu.Separator className="my-1 h-px bg-[var(--line)]" />
                          {member.status === "active" ? (
                            <DropdownMenu.Item
                              className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm text-[var(--danger)] outline-none data-[highlighted]:bg-[var(--danger-soft)]"
                              onSelect={() => setMemberToDisable(member)}
                            >
                              <UserRoundX size={15} />
                              停用账号
                            </DropdownMenu.Item>
                          ) : (
                            <DropdownMenu.Item
                              className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm text-[var(--success-strong)] outline-none data-[highlighted]:bg-[var(--success-soft)]"
                              onSelect={() => updateProfile(member, { status: "active" })}
                            >
                              <UserRoundCheck size={15} />
                              恢复账号
                            </DropdownMenu.Item>
                          )}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>
                )}
              </div>

              {isEditingAlias && (
                <div className="border-t border-[var(--line)] bg-[var(--surface-muted)] px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <label className="min-w-0 flex-1">
                      <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">管理员账户别名（仅管理员可见）</span>
                      <input
                        autoFocus
                        className="field px-3"
                        disabled={updateMemberAlias.isPending}
                        maxLength={120}
                        onChange={(event) => setDraftMemberAlias(event.target.value)}
                        placeholder={member.displayName || member.email}
                        value={draftMemberAlias}
                      />
                    </label>
                    <div className="flex shrink-0 gap-2">
                      <Button disabled={updateMemberAlias.isPending} onClick={cancelAliasEditing} size="sm" variant="ghost">取消</Button>
                      <Button disabled={updateMemberAlias.isPending} onClick={() => submitAlias(member)} size="sm">
                        {updateMemberAlias.isPending && <LoaderCircle className="animate-spin" size={14} />}
                        {updateMemberAlias.isPending ? "保存中" : "保存别名"}
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs text-[var(--text-subtle)]">清空后恢复显示该用户真实账户名，不会改变登录邮箱或用户本人看到的名称。</p>
                </div>
              )}

              {isEditing && (
                <div className="border-t border-[var(--line)] bg-[var(--surface-muted)] px-4 py-4 sm:px-5">
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {stores.map((store) => {
                      const active = store.status === "active";
                      return (
                        <label
                          className={cn(
                            "flex min-h-11 items-center gap-3 rounded-md border border-[var(--line)] bg-white px-3 text-sm",
                            active ? "cursor-pointer" : "cursor-not-allowed opacity-55",
                          )}
                          key={store.id}
                        >
                          <input
                            checked={selectedStoreIds.includes(store.id)}
                            disabled={!active || updateAccess.isPending || updateMember.isPending}
                            onChange={() => toggleStore(store.id)}
                            type="checkbox"
                          />
                          <span className="min-w-0 flex-1 truncate">{store.label}</span>
                          {!active && <span className="text-[11px] text-[var(--warning)]">需重新授权</span>}
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button disabled={updateAccess.isPending || updateMember.isPending} onClick={cancelEditing} size="sm" variant="ghost">取消</Button>
                    <Button
                      disabled={updateAccess.isPending || updateMember.isPending}
                      onClick={() => updateAccess.mutate({ userId: member.id, storeIds: selectedStoreIds })}
                      size="sm"
                    >
                      {updateAccess.isPending
                        ? <LoaderCircle className="animate-spin" size={14} />
                        : <Check size={14} />}
                      {updateAccess.isPending ? "保存中" : "保存权限"}
                    </Button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </>
  );
}
