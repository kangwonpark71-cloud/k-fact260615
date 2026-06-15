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

CREATE POLICY "anon_all_visitors"
  ON visitors FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_custom_services"
  ON custom_services FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_deleted_services"
  ON deleted_services FOR ALL TO anon USING (true) WITH CHECK (true);
