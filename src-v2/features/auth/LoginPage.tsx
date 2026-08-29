import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { Link, Navigate, useNavigate } from "react-router";
import { api, ApiError } from "../../lib/api";
import { Button } from "../../components/ui/button";

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const sessionState = queryClient.getQueryState(["session"]);
  const session = sessionState?.status === "success"
    ? queryClient.getQueryData(["session"])
    : null;
  const login = useMutation({
    mutationFn: api.login,
    onSuccess: (result) => {
      queryClient.clear();
      queryClient.setQueryData(["session"], result);
      navigate("/app", { replace: true });
    },
  });

  if (session) return <Navigate replace to="/app" />;

  const error = login.error as ApiError | null;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--page)] px-4 py-10">
      <section className="w-full max-w-[420px]" aria-labelledby="login-title">
        <div className="mb-9 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-[var(--ink)] text-sm font-black text-white">
            HZ
          </div>
          <div>
            <p className="text-[15px] font-semibold text-[var(--ink)]">SHEIN超级运营中心</p>
            <p className="mt-0.5 text-xs text-[var(--text-subtle)]">内部运营系统</p>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-white p-6 shadow-[var(--shadow-sm)] sm:p-8">
          <div className="mb-7">
            <h1 id="login-title" className="text-2xl font-semibold text-[var(--ink)]">
              登录工作台
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              使用管理员分配的工作室账号登录
            </p>
          </div>

          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              login.mutate({ email: email.trim(), password });
            }}
          >
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--ink)]">邮箱</span>
              <span className="relative block">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" size={17} />
                <input
                  autoComplete="email"
                  className="field pl-10"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@company.com"
                  required
                  type="email"
                  value={email}
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--ink)]">密码</span>
              <span className="relative block">
                <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" size={17} />
                <input
                  autoComplete="current-password"
                  className="field px-10"
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
            </label>

            <div className="-mt-2 flex items-center justify-between text-xs">
              <Link className="text-[var(--text-muted)] underline underline-offset-4 hover:text-[var(--ink)]" to="/forgot-password">忘记密码？</Link>
              <Link className="font-medium text-[var(--ink)] underline underline-offset-4" to="/register">注册账号</Link>
            </div>

            {error && (
              <div className="rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2.5 text-sm text-[var(--danger-strong)]" role="alert">
                {error.message}
              </div>
            )}

            <Button className="w-full" disabled={login.isPending} type="submit">
              {login.isPending && <LoaderCircle className="animate-spin" size={16} />}
              登录
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-[var(--text-subtle)]">
          仅限 SHEIN 超级运营中心授权成员使用
        </p>
      </section>
    </main>
  );
}
