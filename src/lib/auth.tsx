import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { claimAnonymousAnalyses } from "@/lib/analyses.functions";
import { getSessionId } from "@/lib/session";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const claimedFor = useRef<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // 로그인 후 익명 분석을 본인 계정으로 이전
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid || claimedFor.current === uid) return;
    claimedFor.current = uid;
    const sessionId = getSessionId();
    claimAnonymousAnalyses({ data: { sessionId } })
      .then((res) => {
        if (res.claimed > 0) {
          queryClient.invalidateQueries({ queryKey: ["analyses"] });
        }
      })
      .catch((e) => console.warn("claim failed", e));
  }, [session?.user?.id, queryClient]);

  const signOut = async () => {
    claimedFor.current = null;
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider value={{ user: session?.user ?? null, session, loading, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
