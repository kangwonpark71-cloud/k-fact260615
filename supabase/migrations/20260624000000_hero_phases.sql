-- hero_phases: 관리자 대시보드에서 히어로 롤링 텍스트 페이즈를 관리
-- RollingHeroText가 DB에서 sort_order순으로 fetch하여 표시

CREATE TABLE IF NOT EXISTS hero_phases (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text        TEXT NOT NULL,
  variant     TEXT NOT NULL DEFAULT 'default'
              CHECK (variant IN ('default', 'impact', 'natural')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin 전용 RLS: service_role bypass, public은 읽기만
ALTER TABLE hero_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hero_phases_select_anon"
  ON hero_phases FOR SELECT
  USING (TRUE);

CREATE POLICY "hero_phases_all_admin"
  ON hero_phases FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 시드 데이터: 기존 4개 페이즈
INSERT INTO hero_phases (text, variant, sort_order) VALUES
  ('올인원 Pass! 인공지능 언어 마스터 1기', 'default', 0),
  ('팩트체크AI', 'impact', 1),
  ('"사실"보다 "자극"에 더 쉽게 반응함', 'natural', 2),
  ('"진짜처럼 보이는 거짓"', 'default', 3)
ON CONFLICT DO NOTHING;
