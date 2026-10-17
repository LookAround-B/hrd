ALTER TABLE hrd_clubs ADD COLUMN IF NOT EXISTS scope_notes text NOT NULL DEFAULT '';
ALTER TABLE hrd_clubs ADD COLUMN IF NOT EXISTS rate_limit_notes text NOT NULL DEFAULT '';
ALTER TABLE hrd_clubs ADD COLUMN IF NOT EXISTS credential_fingerprint text;
ALTER TABLE hrd_clubs ADD COLUMN IF NOT EXISTS route_catalog jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS hrd_clubs_credential_fingerprint ON hrd_clubs(credential_fingerprint)
  WHERE credential_fingerprint IS NOT NULL AND encrypted_token IS NOT NULL;
