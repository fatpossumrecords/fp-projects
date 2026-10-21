-- Artist profiles (auto-fill), team contacts, playlist library.
ALTER TABLE artists ADD COLUMN profile TEXT;   -- JSON: website, genre, hometown, riyl, social{}, dsp_links{}, team[], logo

CREATE TABLE IF NOT EXISTS contacts (
  id          TEXT PRIMARY KEY,
  name_key    TEXT NOT NULL UNIQUE,   -- lower(trim(name)), for de-duplication
  name        TEXT NOT NULL,
  role        TEXT,
  company     TEXT,
  email       TEXT,
  phone       TEXT,
  notes       TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS playlists (
  id          TEXT PRIMARY KEY,
  pl_key      TEXT NOT NULL UNIQUE,   -- lower(dsp) | lower(name)
  dsp         TEXT,
  name        TEXT NOT NULL,
  url         TEXT,
  curator     TEXT,
  notes       TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);
