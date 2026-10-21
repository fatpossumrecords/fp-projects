-- FAT POSSUM — Project Management schema (Cloudflare D1 / SQLite)
-- Apply with:  npx wrangler d1 execute fp-projects --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  email       TEXT PRIMARY KEY,
  name        TEXT,
  picture     TEXT,
  role        TEXT NOT NULL DEFAULT 'editor',   -- admin | editor | viewer | disabled
  last_login  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT,
  hometown    TEXT,
  genre       TEXT,
  socials     TEXT,            -- JSON {instagram, tiktok, ...}
  notes       TEXT,
  share_token TEXT UNIQUE,     -- read-only social calendar link for the artist's team
  profile     TEXT,            -- JSON learned from projects: website, socials, DSP links, RIYL, team
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS artists_name ON artists(name COLLATE NOCASE);

-- One row per release-schedule line (artist / title / format / date ...).
-- Rows created from a project's FORMATS list carry project_id + format_key.
CREATE TABLE IF NOT EXISTS releases (
  id            TEXT PRIMARY KEY,
  project_id    TEXT,
  format_key    TEXT,          -- key of the project Formats / Timeline entry this row comes from
  kind          TEXT,          -- 'format' | 'timeline' | NULL (added directly on the schedule)
  artist        TEXT NOT NULL,
  title         TEXT NOT NULL,
  format        TEXT,
  release_date  TEXT,          -- YYYY-MM-DD
  pm            TEXT,          -- project manager
  status        TEXT,
  territory     TEXT,
  label         TEXT,
  catalog       TEXT,
  notes         TEXT,
  gcal_event_id TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT
);
CREATE INDEX IF NOT EXISTS releases_date ON releases(release_date);
CREATE INDEX IF NOT EXISTS releases_project ON releases(project_id);
CREATE INDEX IF NOT EXISTS releases_gcal ON releases(gcal_event_id);

-- Project info sheet. Indexed headline fields are columns; the rest of the
-- project doc (socials, assets, DSP targets, press, ISRC table ...) is JSON in `data`.
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  artist        TEXT NOT NULL,
  title         TEXT NOT NULL,
  release_date  TEXT,
  label         TEXT,
  catalog       TEXT,
  territory     TEXT,
  pm            TEXT,
  status        TEXT,
  data          TEXT,          -- JSON
  doc_id        TEXT,          -- Google Doc file id
  doc_url       TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT
);
CREATE INDEX IF NOT EXISTS projects_date ON projects(release_date);

-- Internal dates (song pitching, bio due, press photos due ...)
CREATE TABLE IF NOT EXISTS milestones (
  id            TEXT PRIMARY KEY,
  project_id    TEXT,          -- null = created directly in Google Calendar, not yet assigned
  type          TEXT,          -- template key, e.g. 'bio_due'
  title         TEXT NOT NULL,
  date          TEXT NOT NULL,
  done          INTEGER NOT NULL DEFAULT 0,
  owner         TEXT,
  notes         TEXT,
  gcal_event_id TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT
);
CREATE INDEX IF NOT EXISTS milestones_project ON milestones(project_id);
CREATE INDEX IF NOT EXISTS milestones_date ON milestones(date);
CREATE INDEX IF NOT EXISTS milestones_gcal ON milestones(gcal_event_id);

CREATE TABLE IF NOT EXISTS social_posts (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  time        TEXT,            -- HH:MM
  artist      TEXT,
  project_id  TEXT,
  platform    TEXT,            -- display copy of platforms, e.g. "Instagram, TikTok"
  platforms   TEXT,            -- JSON array of platforms
  posted      TEXT,            -- JSON object: platform → ISO time it was posted
  post_type   TEXT,
  caption     TEXT,
  asset_url   TEXT,
  link_url    TEXT,
  status      TEXT,            -- Idea | Drafted | Approved | Scheduled | Posted
  owner       TEXT,
  notes       TEXT,
  shared      INTEGER NOT NULL DEFAULT 1,  -- visible on the artist's share link
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);
CREATE INDEX IF NOT EXISTS social_date ON social_posts(date);
CREATE INDEX IF NOT EXISTS social_artist ON social_posts(artist);

-- Lookup lists, milestone templates, etc. value is JSON.
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

-- Calendar sync tokens and the sync log.
CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS sync_log (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  ts    TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT,
  msg   TEXT
);

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
