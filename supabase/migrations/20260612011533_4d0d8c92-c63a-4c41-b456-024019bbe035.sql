CREATE TABLE public.analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_url TEXT,
  input_text TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  overall_verdict TEXT,
  overall_confidence INTEGER,
  claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_analyses_session ON public.analyses(session_id, created_at DESC);

GRANT SELECT, INSERT ON public.analyses TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analyses TO authenticated;
GRANT ALL ON public.analyses TO service_role;

ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert analyses" ON public.analyses FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can read analyses" ON public.analyses FOR SELECT TO anon, authenticated USING (true);