import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, LoaderCircle, Mail } from "lucide-react";
import { Link } from "react-router";
import { Button } from "../../components/ui/button";
import { ApiError, api } from "../../lib/api";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const requestReset = useMutation({ mutationFn: api.requestPasswordReset });
  const error = requestReset.error as ApiError | null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--page)] px-4 py-10">
      <section className="w-full max-w-[420px]" aria-labelledby="forgot-title">
        <div className="mb-9 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-[var(--ink)] text-sm font-black text-white">HZ</div>
          <div>
            <p className="text-[15px] font-semibold text-[var(--ink)]">SHEIN超级运营中心</p>
            <p className="mt-0.5 text-xs text-[var(--text-subtle)]">找回账号密码</p>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-white p-6 shadow-[var(--shadow-sm)] sm:p-8">
          {requestReset.isSuccess ? (
            <div className="py-5">
              <h1 id="forgot-title" className="text-2xl font-semibold text-[var(--ink)]">请检查邮箱</h1>
              <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                如果该邮箱已注册，我们已发送密码重置链接。链接 30 分钟内有效；如果没有收到，请检查垃圾邮件。
              </p>
              <Button className="mt-7 w-full" onClick={() => requestReset.reset()} variant="outline">重新发送</Button>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <h1 id="forgot-title" className="text-2xl font-semibold text-[var(--ink)]">忘记密码</h1>
                <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">输入注册邮箱，我们会发送一次性重置链接。</p>
              </div>
              <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); requestReset.mutate(email.trim()); }}>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[var(--ink)]">注册邮箱</span>
                  <span className="relative block">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" size={17} />
                    <input autoComplete="email" className="field pl-10" onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required type="email" value={email} />
                  </span>
                </label>
                {error && <div className="rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2.5 text-sm text-[var(--danger-strong)]" role="alert">{error.message}</div>}
                <Button className="w-full" disabled={requestReset.isPending} type="submit">
                  {requestReset.isPending && <LoaderCircle className="animate-spin" size={16} />}
                  发送重置邮件
                </Button>
              </form>
            </>
          )}
        </div>
        <p className="mt-5 text-center text-sm text-[var(--text-muted)]"><Link className="inline-flex items-center gap-1 font-medium text-[var(--ink)]" to="/login"><ArrowLeft size={15} />返回登录</Link></p>
      </section>
    </main>
  );
}
