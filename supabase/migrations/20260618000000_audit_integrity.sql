-- audit_log: 판단 과정 전체 기록 (검색어, 출처, 모델, 가중치)
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS audit_log JSONB,
  ADD COLUMN IF NOT EXISTS integrity_hash TEXT;

-- 관리자 행동 감사 로그
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_email TEXT        NOT NULL,
  action      TEXT        NOT NULL,
  target_id   TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role only on admin_audit_log"
  ON public.admin_audit_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
  ON public.admin_audit_log (created_at DESC);
