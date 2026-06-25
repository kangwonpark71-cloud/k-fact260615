-- analysis_feedback: 사용자 판정 동의/이의 피드백 테이블
CREATE TABLE IF NOT EXISTS analysis_feedback (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID        NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id  TEXT        NOT NULL,
  feedback    TEXT        NOT NULL CHECK (feedback IN ('agree', 'disagree')),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_analysis ON analysis_feedback(analysis_id);
CREATE INDEX IF NOT EXISTS idx_feedback_session  ON analysis_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created  ON analysis_feedback(created_at DESC);

-- 동일 세션에서 같은 분석에 중복 피드백 방지
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_session_analysis
  ON analysis_feedback(session_id, analysis_id);

-- 이의 비율 집계 뷰
CREATE OR REPLACE VIEW analysis_feedback_stats AS
SELECT
  analysis_id,
  COUNT(*)                                                AS total,
  COUNT(*) FILTER (WHERE feedback = 'agree')             AS agree_count,
  COUNT(*) FILTER (WHERE feedback = 'disagree')          AS disagree_count,
  ROUND(
    COUNT(*) FILTER (WHERE feedback = 'disagree') * 100.0
    / NULLIF(COUNT(*), 0), 1
  )                                                       AS disagree_rate
FROM analysis_feedback
GROUP BY analysis_id;

-- RLS
ALTER TABLE analysis_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_insert_feedback"
  ON analysis_feedback FOR INSERT WITH CHECK (true);

CREATE POLICY "service_role_all"
  ON analysis_feedback USING (auth.role() = 'service_role');
