-- 분석 비동기 처리: status 컬럼 + 캐싱/폴링용 인덱스
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';

-- URL 기반 24시간 캐싱 조회용
CREATE INDEX IF NOT EXISTS idx_analyses_source_url_status
  ON public.analyses(source_url, status, created_at DESC)
  WHERE source_url IS NOT NULL;

-- 폴링: id + status 빠른 조회
CREATE INDEX IF NOT EXISTS idx_analyses_id_status
  ON public.analyses(id, status);
