-- Project timeline items (announces, singles, videos…) live on the release schedule too.
-- kind: 'format' = from a project's Formats, 'timeline' = from a project's Timeline, NULL = added on the schedule.
ALTER TABLE releases ADD COLUMN kind TEXT;
UPDATE releases SET kind = 'format' WHERE format_key IS NOT NULL AND kind IS NULL;
