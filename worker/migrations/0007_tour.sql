-- Tour dates for artists without a project. Artists with a project keep their
-- shows in projects.data.tour; these move into the project when one is created.
CREATE TABLE IF NOT EXISTS shows (
  id          TEXT PRIMARY KEY,
  artist      TEXT NOT NULL,
  date        TEXT NOT NULL,
  city        TEXT,
  venue       TEXT,
  notes       TEXT,
  ticket_url  TEXT,
  announced   INTEGER NOT NULL DEFAULT 0,
  cancelled   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);
CREATE INDEX IF NOT EXISTS shows_artist ON shows (artist COLLATE NOCASE);

-- City → map coordinates (OpenStreetMap lookup, cached), for the distance filters.
CREATE TABLE IF NOT EXISTS places (
  key    TEXT PRIMARY KEY,     -- lower-cased city text, e.g. 'oxford, ms'
  lat    REAL,
  lon    REAL,
  label  TEXT,                 -- what OpenStreetMap matched, for checking
  found  INTEGER NOT NULL DEFAULT 0,
  at     TEXT NOT NULL
);
