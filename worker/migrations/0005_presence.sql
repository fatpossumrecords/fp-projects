-- Who has a record open right now (heartbeat every 20s from the editor).
CREATE TABLE IF NOT EXISTS presence (
  resource TEXT NOT NULL,      -- e.g. 'projects/<id>'
  email    TEXT NOT NULL,
  name     TEXT,
  editing  INTEGER DEFAULT 0,  -- 1 while they have unsaved changes
  at       INTEGER NOT NULL,   -- ms since epoch of the last heartbeat
  PRIMARY KEY (resource, email)
);
