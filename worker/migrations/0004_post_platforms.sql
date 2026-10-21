-- One social post can go to several platforms; each platform is ticked off separately.
ALTER TABLE social_posts ADD COLUMN platforms TEXT;   -- JSON array, e.g. ["Instagram","TikTok"]
ALTER TABLE social_posts ADD COLUMN posted TEXT;      -- JSON object, platform → ISO time it was posted
UPDATE social_posts SET platforms = json_array(platform) WHERE platform IS NOT NULL AND platform != '' AND platforms IS NULL;
