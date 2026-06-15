import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ShieldCheck, History, LogOut, User as UserIcon,
  Moon, Sun, LayoutDashboard, Menu, X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

export function SiteHeader() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
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
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent grid place-items-center shadow-[var(--shadow-glow)]">
              <ShieldCheck className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-display font-bold text-base">K-Fact</span>
              <span className="hidden sm:block text-[10px] text-muted-foreground tracking-wider uppercase">
                Evidence-first fact assist
              </span>
            </div>
          </Link>

          {/* 데스크톱 네비게이션 */}
          <nav className="hidden sm:flex items-center gap-1">
            <button
              onClick={toggleTheme}
              aria-label={theme === "rose" ? "밤하늘 테마로 전환" : "자연스러운 색조 테마로 전환"}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-all"
            >
              {theme === "rose" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
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
            <button
              onClick={toggleTheme}
              aria-label="테마 변경"
              className="w-11 h-11 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-all"
            >
              {theme === "rose" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
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
        <div
          className="fixed inset-0 z-50 sm:hidden"
          onClick={close}
        >
          {/* 배경 딤 */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* 드로어 패널 */}
          <div
            className="absolute right-0 top-0 h-full w-72 glass border-l border-border/50 flex flex-col shadow-2xl"
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
            <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
              <DrawerLink to="/" icon={<ShieldCheck className="w-6 h-6" />} onClick={close}>
                홈
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

            {/* 하단 액션 */}
            <div className="px-3 py-4 border-t border-border/50 flex flex-col gap-2">
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
                  className="w-full flex items-center justify-center gap-2 px-4 py-4 rounded-xl text-base font-medium bg-gradient-to-r from-primary to-accent text-primary-foreground"
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
