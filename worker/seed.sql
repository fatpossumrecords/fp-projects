-- Default lookup lists and internal-date templates. Safe to re-run (won't overwrite edits).
-- Template offsets are days relative to the release date (negative = before).
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
('statuses',    '["Planning","Confirmed"]', datetime('now')),
('formats',     '["LP","2xLP","Color LP","CD","Cassette","7\"","12\"","Digital Album","Digital Single","EP","Box Set"]', datetime('now')),
('territories', '["World","US","US/CA","UK/EU","ROW","World ex-US"]', datetime('now')),
('labels',      '["Fat Possum","Big Legal Mess","Futurismo"]', datetime('now')),
('platforms',   '["Instagram","TikTok","Facebook","X / Twitter","YouTube","Threads","Bluesky","Newsletter"]', datetime('now')),
('post_types',  '["Announcement","Single","Music Video","Pre-save / Pre-order","Tour","Press","Behind the Scenes","Reel / Short","Story","Release Day","Merch"]', datetime('now')),
('post_statuses','["Idea","Drafted","Approved","Scheduled","Posted"]', datetime('now')),
-- Where each "Open" button on a post goes (Settings → Lists). Edit freely.
('platform_links','{"Instagram":"https://www.instagram.com/","TikTok":"https://www.tiktok.com/upload","Facebook":"https://business.facebook.com/latest/composer","X / Twitter":"https://x.com/compose/post","YouTube":"https://studio.youtube.com/","Threads":"https://www.threads.net/","Bluesky":"https://bsky.app/"}', datetime('now')),
('milestone_templates', '[
  {"key":"masters","title":"Masters delivered","offset":-112},
  {"key":"art_final","title":"Final album art due","offset":-98},
  {"key":"metadata","title":"Metadata / ISRCs / splits due","offset":-98},
  {"key":"bio","title":"Bio due","offset":-84},
  {"key":"press_photos","title":"Press photos due","offset":-84},
  {"key":"one_sheet","title":"One-sheet / solicitation to distributor","offset":-84},
  {"key":"press_start","title":"Press campaign starts","offset":-70},
  {"key":"announce","title":"Announce + pre-order live","offset":-56},
  {"key":"lyrics","title":"Lyrics due","offset":-56},
  {"key":"video","title":"Music video delivered","offset":-42},
  {"key":"dsp_pitch","title":"Digital song pitching (DSP editorial)","offset":-28},
  {"key":"radio","title":"Radio servicing","offset":-21},
  {"key":"release","title":"Street date","offset":0}
]', datetime('now'));
