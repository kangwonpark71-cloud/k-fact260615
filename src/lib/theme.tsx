import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "navy" | "night";

interface ThemeCtx {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: "navy", toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("navy");

  useEffect(() => {
    const saved = localStorage.getItem("kfact-theme") as string | null;
    if (saved === "night") setTheme("night");
    else setTheme("navy");
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme === "night" ? "night" : "navy");
    localStorage.setItem("kfact-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "navy" ? "night" : "navy"));

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
