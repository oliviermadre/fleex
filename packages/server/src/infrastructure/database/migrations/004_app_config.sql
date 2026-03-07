CREATE TABLE IF NOT EXISTS app_config (
  id          TEXT PRIMARY KEY DEFAULT 'singleton',
  data        JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_app_config" ON app_config FOR ALL USING (true) WITH CHECK (true);
