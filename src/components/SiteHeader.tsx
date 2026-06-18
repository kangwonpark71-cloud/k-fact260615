import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ShieldCheck, History, LogOut, User as UserIcon,
  LayoutDashboard, Menu, X, Home, MessageSquare,
  Moon, Sun, Zap, Briefcase, ZoomIn, Palette,
  Check,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme, THEME_LIST, type Theme } from "@/lib/theme";

/* ── 테마별 아이콘 ── */
const THEME_ICONS: Record<Theme, React.ElementType> = {
  dark:     Moon,
  light:    Sun,
  teen:     Zap,
  thirties: Briefcase,
  senior:   ZoomIn,
};

/* ── 테마 선택기 드롭다운 ── */
function ThemeSelector({ mobile = false }: { mobile?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const CurrentIcon = THEME_ICONS[theme];

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  if (mobile) {
    /* 모바일 드로어 내부 — 세로 전체 목록 */
    return (
      <div className="px-3 py-3 border-t border-border/50">
        <p className="px-4 mb-2 text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground/60">
          테마
        </p>
        <div className="grid grid-cols-1 gap-1">
          {THEME_LIST.map(({ id, label, sub }) => {
            const Icon = THEME_ICONS[id];
            const active = theme === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors ${
                  active
                    ? "bg-primary/15 text-foreground font-semibold"
                    : "text-foreground/70 hover:text-foreground hover:bg-surface-2"
                }`}
              >
                <span
                  className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                  style={{ backgroundColor: THEME_LIST.find(t => t.id === id)?.swatchBg }}
                >
                  <Icon className="w-4 h-4" style={{ color: THEME_LIST.find(t => t.id === id)?.swatchFg }} />
                </span>
                <span className="flex-1 text-left">
                  <span className="block font-semibold text-sm">{label}</span>
                  <span className="block text-[11px] text-muted-foreground">{sub}</span>
                </span>
                {active && <Check className="w-4 h-4 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  /* 데스크톱 드롭다운 */
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="테마 선택"
        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
          open
            ? "bg-surface-2 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-surface-2"
        }`}
      >
        {open ? <Palette className="w-4 h-4" /> : <CurrentIcon className="w-4 h-4" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 glass border border-border/60 shadow-[var(--shadow-card)] z-50 py-1.5 overflow-hidden rounded-[calc(var(--radius)+2px)]">
          <p className="px-3 pb-1.5 pt-0.5 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground/50">
            테마 선택
          </p>
          {THEME_LIST.map(({ id, label, sub, swatchBg, swatchFg }) => {
            const Icon = THEME_ICONS[id];
            const active = theme === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => { setTheme(id); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  active
                    ? "bg-primary/12 text-foreground"
                    : "text-foreground/80 hover:bg-surface-2/60 hover:text-foreground"
                }`}
              >
                <span
                  className="w-6 h-6 rounded flex items-center justify-center shrink-0 border border-border/30"
                  style={{ backgroundColor: swatchBg }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: swatchFg }} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-semibold leading-tight">{label}</span>
                  <span className="block text-[10px] text-muted-foreground leading-tight truncate">{sub}</span>
                </span>
                {active && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SiteHeader
   ═══════════════════════════════════════════════════════ */
export function SiteHeader() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.email === import.meta.env.VITE_ADMIN_EMAIL;
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleSignOut = async () => {
    setDrawerOpen(false);
    await signOut();
    navigate({ to: "/" });
  };

  const close = () => setDrawerOpen(false);

  return (
    <>
      <header className="sticky top-0 z-40 glass">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          {/* 로고 */}
          <Link to="/" className="flex items-center gap-2.5 group" onClick={close}>
            <div className="w-9 h-9 rounded-sm border-2 border-primary/40 grid place-items-center bg-primary/5 group-hover:border-primary/60 transition-colors">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-display font-bold text-base tracking-tight">팩트체크</span>
              <span className="hidden sm:block text-[10px] text-muted-foreground tracking-widest uppercase">
                AI 사실검증
              </span>
            </div>
          </Link>

          {/* 데스크톱 네비게이션 */}
          <nav className="hidden sm:flex items-center gap-1">
            <ThemeSelector />
            <Link
              to="/live"
              className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors flex items-center gap-1.5"
            >
              <MessageSquare className="w-4 h-4" /> 대화 분석
            </Link>
            <Link
              to="/history"
              className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors flex items-center gap-1.5"
            >
              <History className="w-4 h-4" /> 히스토리
            </Link>
            {user ? (
              <>
                {isAdmin && (
                  <Link
                    to="/admin"
                    className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors flex items-center gap-1.5"
                  >
                    <LayoutDashboard className="w-4 h-4" /> 관리자
                  </Link>
                )}
                <span className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
                  <UserIcon className="w-3.5 h-3.5" />
                  {user.email ?? "사용자"}
                </span>
                <button
                  onClick={handleSignOut}
                  className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors flex items-center gap-1.5"
                >
                  <LogOut className="w-4 h-4" /> 로그아웃
                </button>
              </>
            ) : (
              <Link
                to="/auth"
                className="px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                로그인
              </Link>
            )}
          </nav>

          {/* 모바일 우측 버튼들 */}
          <div className="flex sm:hidden items-center gap-1">
            <ThemeSelector />
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="메뉴 열기"
              className="w-11 h-11 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-all"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>
      </header>

      {/* 모바일 드로어 오버레이 */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 sm:hidden" onClick={close}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          <div
            className="absolute right-0 top-0 h-full w-72 glass border-l border-border/50 flex flex-col shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 드로어 헤더 */}
            <div className="flex items-center justify-between px-5 py-5 border-b border-border/50">
              <span className="font-bold text-lg">메뉴</span>
              <button
                onClick={close}
                className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-surface-2 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* 로그인 사용자 정보 */}
            {user && (
              <div className="px-5 py-4 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <UserIcon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">로그인됨</p>
                    <p className="text-sm font-medium truncate">{user.email}</p>
                  </div>
                </div>
              </div>
            )}

            {/* 메뉴 아이템들 */}
            <nav className="px-3 py-4 flex flex-col gap-1">
              <DrawerLink to="/" icon={<ShieldCheck className="w-6 h-6" />} onClick={close}>
                홈
              </DrawerLink>
              <DrawerLink to="/live" icon={<MessageSquare className="w-6 h-6" />} onClick={close}>
                대화 분석
              </DrawerLink>
              <DrawerLink to="/history" icon={<History className="w-6 h-6" />} onClick={close}>
                분석 히스토리
              </DrawerLink>
              {isAdmin && (
                <DrawerLink to="/admin" icon={<LayoutDashboard className="w-6 h-6" />} onClick={close}>
                  관리자 대시보드
                </DrawerLink>
              )}
            </nav>

            {/* 테마 선택기 (모바일) */}
            <ThemeSelector mobile />

            {/* 하단 액션 */}
            <div className="px-3 py-4 border-t border-border/50 flex flex-col gap-2 mt-auto">
              {user ? (
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-4 px-4 py-4 rounded-xl text-base font-medium text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="w-6 h-6" />
                  로그아웃
                </button>
              ) : (
                <Link
                  to="/auth"
                  onClick={close}
                  className="w-full flex items-center justify-center gap-2 px-4 py-4 rounded-xl text-base font-medium bg-primary text-primary-foreground"
                >
                  로그인 / 회원가입
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DrawerLink({
  to, icon, children, onClick,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-4 px-4 py-4 rounded-xl text-base font-medium text-foreground/80 hover:text-foreground hover:bg-surface-2 transition-colors"
    >
      <span className="text-primary">{icon}</span>
      {children}
    </Link>
  );
}

export function BottomNav() {
  const { user } = useAuth();
  const { isAdmin } = useBottomNavAdmin();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const active = (path: string) =>
    pathname === path ? "text-primary" : "text-muted-foreground";

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 sm:hidden glass border-t border-border/50 flex items-stretch">
      <Link to="/" className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${active("/")}`}>
        <Home className="w-5 h-5" />
        홈
      </Link>
      <Link to="/live" className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${active("/live")}`}>
        <MessageSquare className="w-5 h-5" />
        대화
      </Link>
      <Link to="/history" className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${active("/history")}`}>
        <History className="w-5 h-5" />
        히스토리
      </Link>
      {user && isAdmin && (
        <Link to="/admin" className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${active("/admin")}`}>
          <LayoutDashboard className="w-5 h-5" />
          관리자
        </Link>
      )}
      <Link to={user ? "/" : "/auth"} className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${active("/auth")}`}>
        <UserIcon className="w-5 h-5" />
        {user ? user.email?.split("@")[0] ?? "나" : "로그인"}
      </Link>
    </nav>
  );
}

function useBottomNavAdmin() {
  const { user } = useAuth();
  const isAdmin = user?.email === import.meta.env.VITE_ADMIN_EMAIL;
  return { isAdmin };
}
