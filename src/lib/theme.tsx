import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "dark" | "light" | "teen" | "thirties" | "senior";

export interface ThemeMeta {
  id: Theme;
  label: string;
  sub: string;
  swatchBg: string;
  swatchFg: string;
}

export const THEME_LIST: ThemeMeta[] = [
  { id: "dark",     label: "다크",   sub: "딥 네이비 다크모드",      swatchBg: "#1b2a4a", swatchFg: "#e8edf5" },
  { id: "light",    label: "라이트", sub: "밝은 문서 스타일",        swatchBg: "#f7f4ef", swatchFg: "#1a2030" },
  { id: "teen",     label: "10대",   sub: "Z세대 네온 바이브",       swatchBg: "#1a0e2e", swatchFg: "#ff5ecb" },
  { id: "thirties", label: "30대",   sub: "프로페셔널 모던",         swatchBg: "#eef0f6", swatchFg: "#2a4499" },
  { id: "senior",   label: "60대",   sub: "큰 글씨 고대비 모드",    swatchBg: "#ffffff", swatchFg: "#0d1520" },
];

const VALID_THEMES = new Set<string>(["dark", "light", "teen", "thirties", "senior"]);

function migrateTheme(saved: string | null): Theme {
  if (!saved) return "dark";
  if (saved === "navy" || saved === "night") return "dark";
  if (VALID_THEMES.has(saved)) return saved as Theme;
  return "dark";
}

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: "dark", setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const saved = localStorage.getItem("factcheck-theme");
    setThemeState(migrateTheme(saved));
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("factcheck-theme", t);
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("factcheck-theme", theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
