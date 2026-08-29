import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, UserRound } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import { ApiError, api } from "../../lib/api";

export function RegisterPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const register = useMutation({
    mutationFn: api.register,
    onSuccess: () => navigate("/login", { replace: true }),
  });
  const error = register.error as ApiError | null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--page)] px-4 py-10">
      <section className="w-full max-w-[440px]" aria-labelledby="register-title">
        <div className="mb-9 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-[var(--ink)] text-sm font-black text-white">HZ</div>
          <div>
            <p className="text-[15px] font-semibold text-[var(--ink)]">SHEIN超级运营中心</p>
            <p className="mt-0.5 text-xs text-[var(--text-subtle)]">创建运营账号</p>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-white p-6 shadow-[var(--shadow-sm)] sm:p-8">
          <div className="mb-7">
            <h1 id="register-title" className="text-2xl font-semibold text-[var(--ink)]">注册账号</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              注册后先进入自己的账号，再授权需要管理的 SHEIN 店铺。
            </p>
          </div>

          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              register.reset();
              if (password !== confirmation) {
                setValidationError("两次输入的密码不一致");
                return;
              }
              setValidationError(null);
              register.mutate({ email: email.trim(), displayName: displayName.trim(), password });
            }}
          >
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--ink)]">称呼（选填）</span>
              <span className="relative block">
                <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" size={17} />
                <input autoComplete="name" className="field pl-10" maxLength={120} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：张三" value={displayName} />
              </span>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--ink)]">邮箱</span>
              <span className="relative block">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" size={17} />
                <input autoComplete="email" className="field pl-10" onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required type="email" value={email} />
              </span>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--ink)]">密码</span>
              <span className="relative block">
                <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" size={17} />
                <input autoComplete="new-password" className="field px-10" maxLength={200} minLength={10} onChange={(event) => setPassword(event.target.value)} required type={showPassword ? "text" : "password"} value={password} />
                <button aria-label={showPassword ? "隐藏密码" : "显示密码"} className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--surface-muted)]" onClick={() => setShowPassword((value) => !value)} type="button">
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
              <span className="mt-1.5 block text-xs text-[var(--text-subtle)]">至少 10 个字符</span>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--ink)]">确认密码</span>
              <input autoComplete="new-password" className="field px-3" maxLength={200} minLength={10} onChange={(event) => setConfirmation(event.target.value)} required type={showPassword ? "text" : "password"} value={confirmation} />
            </label>

            {(validationError || error) && (
              <div className="rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2.5 text-sm text-[var(--danger-strong)]" role="alert">
                {validationError || error?.message}
              </div>
            )}
            <Button className="w-full" disabled={register.isPending} type="submit">
              {register.isPending && <LoaderCircle className="animate-spin" size={16} />}
              注册并继续
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-[var(--text-muted)]">
          已有账号？ <Link className="font-medium text-[var(--ink)] underline underline-offset-4" to="/login">返回登录</Link>
        </p>
      </section>
    </main>
  );
}
