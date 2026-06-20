CREATE TABLE IF NOT EXISTS visitors (
  id INT PRIMARY KEY DEFAULT 1,
  count BIGINT DEFAULT 7682453556,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO visitors (id, count) VALUES (1, 7682453556) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS custom_services (
  id BIGSERIAL PRIMARY KEY,
  cat TEXT NOT NULL,
  "name" TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT DEFAULT '🔗',
  color TEXT DEFAULT '#6366f1',
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deleted_services (
  id BIGSERIAL PRIMARY KEY,
  item_key TEXT NOT NULL UNIQUE,
  deleted_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE visitors        ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE deleted_services ENABLE ROW LEVEL SECURITY;

-- visitors: 방문자 카운터 — anon SELECT만 허용 (카운터 증가는 서버 함수에서)
CREATE POLICY "anon_select_visitors"
  ON visitors FOR SELECT TO anon USING (true);
-- 서버 함수(service_role)가 UPDATE 가능하도록 별도 정책
CREATE POLICY "service_update_visitors"
  ON visitors FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- custom_services: 모든 사용자가 읽을 수 있으나 생성/수정/삭제는 인증(service_role)만
CREATE POLICY "anon_select_custom_services"
  ON custom_services FOR SELECT TO anon USING (true);
CREATE POLICY "service_all_custom_services"
  ON custom_services FOR ALL TO service_role USING (true) WITH CHECK (true);

-- deleted_services: anon은 읽기만, service_role만 변경 가능
CREATE POLICY "anon_select_deleted_services"
  ON deleted_services FOR SELECT TO anon USING (true);
CREATE POLICY "service_all_deleted_services"
  ON deleted_services FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- analyses: AI 분석 결과 저장 (핵심 테이블)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source_url TEXT,
  input_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  title TEXT,
  summary TEXT,
  overall_verdict TEXT,
  overall_confidence REAL,
  claims JSONB DEFAULT '[]'::jsonb,
  audit_log JSONB,
  integrity_hash TEXT,
  _phase1_model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analyses_session_id ON analyses(session_id);
CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at);
CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);
CREATE INDEX IF NOT EXISTS idx_analyses_source_url ON analyses(source_url);

ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;

-- anon: 자신의 session_id 또는 user_id에 해당하는 analyses만 읽기
CREATE POLICY "anon_select_own_analyses"
  ON analyses FOR SELECT TO anon
  USING (
    session_id = current_setting('app.session_id', true)::text
    OR user_id = auth.uid()
  );

-- service_role: 모든 analyses 읽기/쓰기 (서버 함수 사용)
CREATE POLICY "service_all_analyses"
  ON analyses FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- api_keys: AI 프로바이더 API 키 (암호화 저장)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS api_keys (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  key_value TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- service_role만 api_keys 접근 (관리자 대시보드에서 service_role로 쿼리)
CREATE POLICY "service_all_api_keys"
  ON api_keys FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- DB 집계 함수 (관리자 대시보드용)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_admin_stats_summary()
RETURNS TABLE (
  total_analyses BIGINT,
  avg_confidence REAL,
  unique_users BIGINT,
  unique_sessions BIGINT,
  verdict_distribution JSONB
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_analyses,
    AVG(overall_confidence)::REAL AS avg_confidence,
    COUNT(DISTINCT user_id)::BIGINT AS unique_users,
    COUNT(DISTINCT session_id)::BIGINT AS unique_sessions,
    COALESCE(
      jsonb_agg(jsonb_build_object(overall_verdict, cnt)) FILTER (WHERE overall_verdict IS NOT NULL),
      '[]'::jsonb
    ) AS verdict_distribution
  FROM (
    SELECT
      overall_verdict,
      overall_confidence,
      user_id,
      session_id,
      COUNT(*) OVER (PARTITION BY overall_verdict) AS cnt
    FROM analyses
  ) sub;
END;
$$;
