-- 005_gateway_public_key.sql
-- Add Ed25519 public key column, make secret_hash optional (transition period).

ALTER TABLE gateways ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE gateways ALTER COLUMN secret_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gateways_public_key ON gateways(public_key) WHERE public_key IS NOT NULL;
