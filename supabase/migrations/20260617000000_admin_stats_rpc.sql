-- 관리자 통계 집계 RPC
-- verdict 분포, 평균 신뢰도, 고유 사용자/세션 수를
-- 클라이언트 전체 로드 없이 DB에서 한 번에 집계
CREATE OR REPLACE FUNCTION get_admin_stats_summary()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'verdict_counts', (
      SELECT COALESCE(
        jsonb_object_agg(COALESCE(overall_verdict, '미확인'), cnt),
        '{}'::jsonb
      )
      FROM (
        SELECT overall_verdict, COUNT(*) AS cnt
        FROM analyses
        GROUP BY overall_verdict
      ) v
    ),
    'avg_confidence', (
      SELECT COALESCE(ROUND(AVG(overall_confidence)), 0)
      FROM analyses
      WHERE overall_confidence IS NOT NULL
    ),
    'unique_users', (
      SELECT COUNT(DISTINCT user_id)
      FROM analyses
      WHERE user_id IS NOT NULL
    ),
    'unique_sessions', (
      SELECT COUNT(DISTINCT session_id)
      FROM analyses
      WHERE user_id IS NULL
        AND session_id IS NOT NULL
    )
  );
$$;

GRANT EXECUTE ON FUNCTION get_admin_stats_summary() TO service_role;
