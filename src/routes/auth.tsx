import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "로그인 — K-Fact" },
      { name: "description", content: "K-Fact 로그인 및 회원가입." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup" | "check-email" | "forgot" | "forgot-sent">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && user) navigate({ to: "/" });
  }, [user, authLoading, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setMode("check-email");
        return;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/" });
    } catch (e) {
      setErr(translateError(e instanceof Error ? e.message : "오류가 발생했습니다."));
    } finally {
      setLoading(false);
    }
  };

  const google = async () => {
    setErr(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth` },
    });
    if (error) setErr(translateError(error.message));
  };

  if (mode === "forgot" || mode === "forgot-sent") {
    const handleForgot = async (e: React.FormEvent) => {
      e.preventDefault();
      setErr(null);
      setLoading(true);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (error) throw error;
        setMode("forgot-sent");
      } catch (e) {
        setErr(translateError(e instanceof Error ? e.message : "오류가 발생했습니다."));
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="min-h-screen grid place-items-center px-6 py-12">
        <div className="w-full max-w-md">
          <Link to="/" className="flex items-center gap-2.5 justify-center mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent grid place-items-center shadow-[var(--shadow-glow)]">
              <ShieldCheck className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-display font-bold text-lg">K-Fact</span>
          </Link>
          <div className="glass rounded-2xl p-6">
            {mode === "forgot-sent" ? (
              <div className="text-center">
                <div className="text-5xl mb-4">📨</div>
                <h1 className="text-2xl font-bold mb-2">메일을 확인하세요</h1>
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                  <strong className="text-foreground">{email}</strong>으로 비밀번호 재설정 링크를 보냈습니다.
                </p>
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="text-sm text-primary hover:underline"
                >
                  로그인으로 돌아가기
                </button>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-bold mb-1">비밀번호 재설정</h1>
                <p className="text-sm text-muted-foreground mb-6">
                  가입한 이메일을 입력하면 재설정 링크를 보내드립니다.
                </p>
                <form onSubmit={handleForgot} className="space-y-3">
                  <input
                    type="email"
                    required
                    placeholder="이메일"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-background/40 border border-border outline-none focus:border-primary text-sm"
                  />
                  {err && <p className="text-xs text-destructive">{err}</p>}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-primary to-accent text-primary-foreground text-sm font-medium disabled:opacity-50"
                  >
                    {loading ? "전송 중…" : "재설정 링크 보내기"}
                  </button>
                </form>
                <p className="text-center text-sm text-muted-foreground mt-5">
                  <button
                    type="button"
                    onClick={() => setMode("signin")}
                    className="text-primary hover:underline"
                  >
                    로그인으로 돌아가기
                  </button>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (mode === "check-email") {
    return (
      <div className="min-h-screen grid place-items-center px-6 py-12">
        <div className="w-full max-w-md text-center">
          <Link to="/" className="flex items-center gap-2.5 justify-center mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent grid place-items-center shadow-[var(--shadow-glow)]">
              <ShieldCheck className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-display font-bold text-lg">K-Fact</span>
          </Link>
          <div className="glass rounded-2xl p-8">
            <div className="text-5xl mb-4">📬</div>
            <h1 className="text-2xl font-bold mb-2">이메일을 확인해 주세요</h1>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              <strong className="text-foreground">{email}</strong>으로 인증 링크를 보냈습니다.<br />
              메일함을 확인한 후 링크를 클릭해 계정을 활성화하세요.
            </p>
            <p className="text-xs text-muted-foreground">
              메일이 오지 않으면 스팸함을 확인하거나{" "}
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="text-primary hover:underline"
              >
                다시 시도
              </button>
              하세요.
            </p>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-6">
            <Link to="/" className="hover:text-foreground">홈으로 →</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center px-6 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent grid place-items-center shadow-[var(--shadow-glow)]">
            <ShieldCheck className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-lg">K-Fact</span>
        </Link>

        <div className="glass rounded-2xl p-6">
          <h1 className="text-2xl font-bold mb-1">
            {mode === "signin" ? "다시 오신 걸 환영합니다" : "계정 만들기"}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === "signin"
              ? "로그인하면 분석 기록을 안전하게 보관할 수 있습니다."
              : "이메일과 비밀번호로 가입하세요."}
          </p>

          <button
            onClick={google}
            type="button"
            className="w-full mb-4 px-4 py-2.5 rounded-lg border border-border bg-surface-2 hover:bg-surface-2/70 text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <GoogleIcon /> Google로 계속하기
          </button>

          <div className="flex items-center gap-3 my-4 text-xs text-muted-foreground">
            <div className="flex-1 h-px bg-border" />또는<div className="flex-1 h-px bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <input
              type="email"
              required
              placeholder="이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-background/40 border border-border outline-none focus:border-primary text-sm"
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="비밀번호 (6자 이상)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-background/40 border border-border outline-none focus:border-primary text-sm"
            />
            {err && <p className="text-xs text-destructive">{err}</p>}
            {mode === "signin" && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  비밀번호를 잊으셨나요?
                </button>
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-primary to-accent text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {loading ? "처리 중…" : mode === "signin" ? "로그인" : "가입하기"}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-5">
            {mode === "signin" ? "계정이 없으신가요?" : "이미 계정이 있으신가요?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="text-primary hover:underline"
            >
              {mode === "signin" ? "가입하기" : "로그인"}
            </button>
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          로그인 없이도 분석은 가능합니다.{" "}
          <Link to="/" className="hover:text-foreground">홈으로 →</Link>
        </p>
      </div>
    </div>
  );
}

function translateError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (/email.*invalid/i.test(msg)) return "유효하지 않은 이메일 주소입니다.";
  if (/email rate limit/i.test(msg)) return "이메일 전송 한도를 초과했습니다. 잠시 후 다시 시도하세요.";
  if (/user already registered/i.test(msg)) return "이미 가입된 이메일입니다.";
  if (/password should be at least/i.test(msg)) return "비밀번호는 최소 6자 이상이어야 합니다.";
  if (/email not confirmed/i.test(msg)) return "이메일 인증이 완료되지 않았습니다. 메일함을 확인해 주세요.";
  if (/signup disabled/i.test(msg)) return "현재 회원가입이 비활성화되어 있습니다.";
  if (/over.*request.*limit/i.test(msg)) return "요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.";
  return msg;
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.48 12c0-.73.13-1.44.36-2.1V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.83z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}
