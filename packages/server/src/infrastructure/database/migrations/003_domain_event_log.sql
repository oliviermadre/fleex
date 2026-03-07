CREATE TABLE IF NOT EXISTS domain_event_log (
  id          TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  instance_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_domain_event_log_occurred_at ON domain_event_log(occurred_at);
CREATE INDEX IF NOT EXISTS idx_domain_event_log_event_type ON domain_event_log(event_type);

ALTER TABLE domain_event_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_domain_event_log" ON domain_event_log FOR ALL USING (true) WITH CHECK (true);
