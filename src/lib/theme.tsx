import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "rose" | "night";

interface ThemeCtx {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: "rose", toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("rose");

  useEffect(() => {
    const saved = localStorage.getItem("kfact-theme") as Theme | null;
    if (saved === "rose" || saved === "night") setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("kfact-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "rose" ? "night" : "rose"));

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
