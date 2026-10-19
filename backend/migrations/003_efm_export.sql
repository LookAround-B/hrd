-- Full read-only EFM export, kept apart from hrd_records so the dashboard payload stays small.
CREATE TABLE IF NOT EXISTS hrd_efm_datasets (
  club_id uuid NOT NULL REFERENCES hrd_clubs(id) ON DELETE CASCADE, dataset text NOT NULL,
  total integer NOT NULL DEFAULT 0, fields jsonb NOT NULL DEFAULT '[]', state text NOT NULL,
  synced_at timestamptz, checked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(club_id,dataset)
);
CREATE TABLE IF NOT EXISTS hrd_efm_rows (
  club_id uuid NOT NULL REFERENCES hrd_clubs(id) ON DELETE CASCADE, dataset text NOT NULL,
  source_id text NOT NULL, data jsonb NOT NULL, synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(club_id,dataset,source_id)
);
