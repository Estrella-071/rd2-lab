CREATE TABLE IF NOT EXISTS simulation_shares (
  code TEXT PRIMARY KEY NOT NULL CHECK (length(code) = 6),
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_simulation_shares_created_at
  ON simulation_shares (created_at);
