-- Internal dates are app-only unless someone ticks "Google Cal" on them.
ALTER TABLE milestones ADD COLUMN gcal INTEGER NOT NULL DEFAULT 0;
