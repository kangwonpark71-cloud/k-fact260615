
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS analyses_user_id_idx ON public.analyses(user_id);
CREATE INDEX IF NOT EXISTS analyses_session_id_idx ON public.analyses(session_id);

DROP POLICY IF EXISTS "Anyone can insert analyses" ON public.analyses;
DROP POLICY IF EXISTS "Anyone can read analyses" ON public.analyses;

REVOKE ALL ON public.analyses FROM anon;
GRANT SELECT, INSERT ON public.analyses TO authenticated;
GRANT ALL ON public.analyses TO service_role;

CREATE POLICY "Users read own analyses"
  ON public.analyses FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own analyses"
  ON public.analyses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
