CREATE TABLE simulation_shares_hardened (
  code TEXT PRIMARY KEY NOT NULL
    CHECK (
      length(code) = 6
      AND code NOT GLOB '*[^0-9A-Za-z]*'
    ),
  payload TEXT NOT NULL UNIQUE
    CHECK (
      length(payload) BETWEEN 1 AND 4096
      AND payload NOT GLOB '*[^0-9A-Za-z]*'
    ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

DROP TABLE simulation_shares;

ALTER TABLE simulation_shares_hardened
  RENAME TO simulation_shares;

CREATE INDEX idx_simulation_shares_created_at
  ON simulation_shares (created_at);
