CREATE TABLE IF NOT EXISTS hrd_admin_sessions (
  token_hash text PRIMARY KEY, email text NOT NULL, csrf text NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hrd_clubs (
  id uuid PRIMARY KEY, name text NOT NULL, brief text NOT NULL DEFAULT '', base_url text NOT NULL,
  authorisation text NOT NULL, issuer text NOT NULL, collected_at timestamptz NOT NULL DEFAULT now(),
  encrypted_token text, credential_mask text NOT NULL DEFAULT '••••••••', credential_expires_at timestamptz,
  credential_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','credential_required','disconnected')),
  validated_at timestamptz, last_success_at timestamptz, disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hrd_records (
  id uuid PRIMARY KEY, club_id uuid NOT NULL REFERENCES hrd_clubs(id) ON DELETE CASCADE,
  entity_type text NOT NULL, source_id text NOT NULL, data jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(), UNIQUE(club_id,entity_type,source_id)
);
CREATE INDEX IF NOT EXISTS hrd_records_club_type ON hrd_records(club_id,entity_type);
CREATE TABLE IF NOT EXISTS hrd_route_checks (
  club_id uuid NOT NULL REFERENCES hrd_clubs(id) ON DELETE CASCADE, route text NOT NULL,
  state text NOT NULL, status integer, latency_ms integer NOT NULL, checked_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz, PRIMARY KEY(club_id,route)
);
CREATE TABLE IF NOT EXISTS hrd_sync_runs (
  id uuid PRIMARY KEY, club_id uuid NOT NULL REFERENCES hrd_clubs(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  state text NOT NULL, datasets jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS hrd_audit_events (
  id uuid PRIMARY KEY, actor text NOT NULL, action text NOT NULL, club_id uuid,
  details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hrd_audit_created ON hrd_audit_events(created_at);
CREATE TABLE IF NOT EXISTS hrd_rate_limits (
  bucket text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL
);
