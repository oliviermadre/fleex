-- 005_gateway_public_key.sql
-- Add Ed25519 public key column, make secret_hash optional (transition period).

ALTER TABLE gateways ADD COLUMN IF NOT EXISTS public_key TEXT UNIQUE;
ALTER TABLE gateways ALTER COLUMN secret_hash DROP NOT NULL;
