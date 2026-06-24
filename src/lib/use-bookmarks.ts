import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "factcheck_bookmarks";

function loadBookmarks(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === "string");
    return [];
  } catch {
    return [];
  }
}

export function useBookmarks() {
  const [ids, setIds] = useState<string[]>(loadBookmarks);

  useEffect(() => {
    const handle = () => setIds(loadBookmarks());
    window.addEventListener("storage", handle);
    return () => window.removeEventListener("storage", handle);
  }, []);

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        setIds([]);
      }
      return next;
    });
  }, []);

  const isBookmarked = useCallback((id: string) => ids.includes(id), [ids]);

  return { bookmarkedIds: ids, toggle, isBookmarked };
}
