import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Store,
  UserRound,
} from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { Button } from "../../components/ui/button";
import { api, type ManagedMemberRole } from "../../lib/api";

const roleLabels: Record<ManagedMemberRole, string> = {
  operator: "运营成员",
  viewer: "只读成员",
};

function formatExpiry(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function InvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const invitationQuery = useQuery({
    queryKey: ["member-invitation", token],
    queryFn: () => api.memberInvitation(token),
    enabled: Boolean(token),
    retry: false,
  });
  const acceptInvitation = useMutation({
    mutationFn: () => api.acceptMemberInvitation(token, password),
  });

  const invitation = invitationQuery.data?.invitation;
  const requestError = invitationQuery.error || acceptInvitation.error;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--page)] px-4 py-10">
      <section className="w-full max-w-[460px]" aria-labelledby="invite-title">
        <div className="mb-9 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-[var(--ink)] text-sm font-black text-white">
            HZ
          </div>
          <div>
            <p className="text-[15px] font-semibold text-[var(--ink)]">SHEIN超级运营中心</p>
            <p className="mt-0.5 text-xs text-[var(--text-subtle)]">成员邀请</p>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-white p-6 shadow-[var(--shadow-sm)] sm:p-8">
          {invitationQuery.isLoading && (
            <div className="grid min-h-64 place-items-center text-sm text-[var(--text-muted)]">
              <span className="flex items-center gap-2">
                <LoaderCircle className="animate-spin" size={18} />正在验证邀请
              </span>
            </div>
          )}

          {invitationQuery.isError && (
            <div className="py-7 text-center">
              <LockKeyhole className="mx-auto text-[var(--danger)]" size={28} />
              <h1 id="invite-title" className="mt-4 text-xl font-semibold text-[var(--ink)]">
                邀请链接不可用
              </h1>
              <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                {invitationQuery.error.message}
              </p>
              <Button className="mt-6" onClick={() => navigate("/login")} variant="outline">
                返回登录
              </Button>
            </div>
          )}

          {invitation && acceptInvitation.isSuccess && (
            <div className="py-7 text-center">
              <span className="mx-auto grid size-11 place-items-center rounded-md bg-[var(--success-soft)] text-[var(--success-strong)]">
                <Check size={23} />
              </span>
              <h1 id="invite-title" className="mt-4 text-xl font-semibold text-[var(--ink)]">
                账号已创建
              </h1>
              <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                你已加入 {invitation.tenant.name}，现在可以使用邮箱和新密码登录。
              </p>
              <Button className="mt-6 w-full" onClick={() => navigate("/login", { replace: true })}>
                前往登录
              </Button>
            </div>
          )}

          {invitation && !acceptInvitation.isSuccess && (
            <>
              <div className="mb-6">
                <h1 id="invite-title" className="text-2xl font-semibold text-[var(--ink)]">
                  设置登录密码
                </h1>
                <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                  {invitation.tenant.name} 邀请你加入工作空间
                </p>
              </div>

              <dl className="mb-6 grid gap-3 rounded-md bg-[var(--surface-muted)] p-4 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <Mail className="shrink-0 text-[var(--text-subtle)]" size={16} />
                  <dt className="sr-only">邮箱</dt>
                  <dd className="min-w-0 truncate text-[var(--ink)]">{invitation.email}</dd>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <UserRound className="shrink-0 text-[var(--text-subtle)]" size={16} />
                  <dt className="sr-only">成员</dt>
                  <dd className="min-w-0 truncate text-[var(--ink)]">
                    {invitation.displayName} · {roleLabels[invitation.role]}
                  </dd>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <Store className="shrink-0 text-[var(--text-subtle)]" size={16} />
                  <dt className="sr-only">店铺权限</dt>
                  <dd className="text-[var(--ink)]">已分配 {invitation.storeCount} 家店铺</dd>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <ShieldCheck className="shrink-0 text-[var(--text-subtle)]" size={16} />
                  <dt className="sr-only">有效期</dt>
                  <dd className="text-xs text-[var(--text-muted)]">
                    链接有效至 {formatExpiry(invitation.expiresAt)}
                  </dd>
                </div>
              </dl>

              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  acceptInvitation.reset();
                  if (password !== confirmation) {
                    setValidationError("两次输入的密码不一致");
                    return;
                  }
                  setValidationError(null);
                  acceptInvitation.mutate();
                }}
              >
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[var(--ink)]">新密码</span>
                  <span className="relative block">
                    <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" size={17} />
                    <input
                      autoComplete="new-password"
                      className="field px-10"
                      maxLength={200}
                      minLength={10}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      type={showPassword ? "text" : "password"}
                      value={password}
                    />
                    <button
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                      onClick={() => setShowPassword((value) => !value)}
                      type="button"
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </span>
                  <span className="mt-1.5 block text-xs text-[var(--text-subtle)]">至少 10 个字符</span>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[var(--ink)]">确认密码</span>
                  <input
                    autoComplete="new-password"
                    className="field px-3"
                    maxLength={200}
                    minLength={10}
                    onChange={(event) => setConfirmation(event.target.value)}
                    required
                    type={showPassword ? "text" : "password"}
                    value={confirmation}
                  />
                </label>

                {(validationError || requestError) && (
                  <div className="rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2.5 text-sm text-[var(--danger-strong)]" role="alert">
                    {validationError || requestError?.message}
                  </div>
                )}

                <Button className="w-full" disabled={acceptInvitation.isPending} type="submit">
                  {acceptInvitation.isPending && <LoaderCircle className="animate-spin" size={16} />}
                  创建账号
                </Button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
