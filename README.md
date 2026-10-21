# Fat Possum — Project Management

Replaces the old AppSheet. Team members sign in with their @fatpossum.com Google account.

- **Release Schedule**: artist / title / format / date / PM / status / territory / label. Switch between a
  spreadsheet view (edit in place, group by month or artist, export CSV) and a calendar view (drag to
  reschedule). Synced both ways with a shared Google Calendar.
- **Projects**: every field from the project doc template. Picking an artist fills in their website,
  socials, DSP links, RIYL and team from earlier projects. Team members and playlists come from saved
  libraries that grow as you save. You can pick asset links from Dropbox, paste a tracklist or tour dates
  to fill a table, and copy the tracklist or full credits back out.
  **Create Google Doc** writes it all into a Google Doc that anyone at fatpossum.com can view. **Update Google
  Doc** regenerates it. A project's Formats each become a row on the Release Schedule.
- **Internal Dates**: per-project deadlines (bio due, press photos, song pitching…) generated from an
  editable template counted back from the release date. They shift when the release date moves, and sync
  both ways with an internal Google Calendar. There is also a cross-project view: overdue, this week, next week.
- **Social Schedule**: week / day / month planner across all artists, drag posts between days, create one
  post on several platforms at once. Pick an artist to get their calendar. **Create share link** gives
  their team a read-only page (no sign-in needed) that you can turn off at any time.

## How it's built

| Piece | Where | Notes |
|---|---|---|
| Web app | GitHub Pages (`index.html`, `*.js`, `styles.css`) | Plain JS, no build step, same look as the inventory app |
| Public share page | `share.html` | Read-only artist social calendar |
| API | Cloudflare Worker (`worker/worker.js`) | Login, data, Google Calendar sync (cron every 5 min) |
| Database | Cloudflare D1 (`worker/schema.sql`) | Multiple editors at once, with save-conflict detection |

## One-time setup

### 1. Cloudflare (API + database)

```sh
cd worker
npm install
npx wrangler login
npx wrangler d1 create fp-projects        # copy the database_id it prints into wrangler.toml
npm run db:init:remote                    # creates tables + default lists/templates (fresh database)
# Only for a database created from an older version of schema.sql: npm run db:migrate:remote
npx wrangler secret put SESSION_SECRET    # paste any long random string
npm run deploy                            # prints https://fp-projects-api.<subdomain>.workers.dev
```

Put that Worker URL in `CONFIG.API_BASE` in **app.js** and `API_BASE` in **share.html**.

### 2. GitHub Pages (web app)

Create a repo `fatpossumrecords/fp-projects`, push this folder, then go to Settings → Pages → Deploy from
branch `main` / root. The app will be at `https://fatpossumrecords.github.io/fp-projects/`.
That origin is already allowed in `wrangler.toml` (`ALLOWED_ORIGINS`) and on the existing Google OAuth client.

### 3. Google Cloud (same project as the inventory app's sign-in)

**Docs export:**
1. APIs & Services → Library → enable **Google Drive API**.
2. OAuth consent screen: user type **Internal**, then add the scope `.../auth/drive.file`. This scope only lets
   the app see files it created itself.
3. Optional: create a folder in a **Shared Drive** for project docs and paste its ID in Settings → Lists.

**Two-way calendar sync:**
1. Enable **Google Calendar API**.
2. IAM → Service Accounts → create `fp-projects-calendar`. Then Keys → Add key → JSON, and download it.
3. In Google Calendar, create two calendars, e.g. **FP Release Schedule** and **FP Internal Dates**. For each one:
   - Settings → *Share with specific people* → add the service account's email with **Make changes to events**.
   - Share with Fat Possum (the whole org) so everyone can subscribe.
   - Copy the **Calendar ID** (under *Integrate calendar*).
   - If sharing with the service account is blocked, a Workspace admin needs to allow sharing calendars
     outside the domain (Admin console → Apps → Calendar → Sharing settings).
4. Put the two IDs in `wrangler.toml` (`CAL_RELEASES_ID`, `CAL_INTERNAL_ID`), then:
   ```sh
   npx wrangler secret put GOOGLE_SA_EMAIL   # client_email from the JSON key
   npx wrangler secret put GOOGLE_SA_KEY     # private_key from the JSON key (the whole BEGIN…END block)
   npm run deploy
   ```
5. In the app: Settings → Google Calendar → **Sync now**. The sync log shows any errors.

**How the sync behaves:** app edits show up in Google within seconds. Google edits come back every 5 minutes:
moving an event changes the date, renaming it changes the title, and new events become releases or
unassigned internal dates. Deleting an internal-date event in Google deletes it in the app. Deleting a
release event only unlinks it, and the event is re-created on the next sync. Releases are never deleted from
Google's side. If the same thing is edited in both places, whichever edit came last wins.

### 4. Dropbox (asset links)

Create an app at dropbox.com/developers/apps (Scoped access, Full Dropbox). Add `fatpossumrecords.github.io`
(and `localhost` for testing) under **Chooser / Saver / Embedder domains**. Paste the **App key** in
Settings → Lists. No secret is needed: the Chooser runs as whoever is signed in to Dropbox in that browser.

### 5. Artist lookup (optional Last.fm)

**Look up online** (next to the artist name on a project) searches MusicBrainz for website, socials, DSP links,
hometown and genre. It's free and needs no setup. To also get similar artists for RIYL, get a free API key at
last.fm/api/account/create and run `npx wrangler secret put LASTFM_API_KEY` in `worker/`.

### 5b. Chartmetric (recommended)

With Chartmetric connected, **Look up online** searches Chartmetric first. It fills website, socials, DSP links,
hometown, genre, RIYL ("fans also like") and follower counts for every platform. MusicBrainz stays available as a
fallback. **Update follower counts** refreshes all platforms at once. Current projects (release date within the last 120 days, or none yet) also refresh on their own: tour dates daily and follower counts weekly, from Monday 09:00 UTC. Put the account's API refresh token in:

- local: `worker/.dev.vars` → `CHARTMETRIC_REFRESH_TOKEN=...` (then restart `npm run dev`)
- live: `npx wrangler secret put CHARTMETRIC_REFRESH_TOKEN`

### 6. Follower counts without Chartmetric (optional)

Each project's Social and DSPs sections have a Followers column. Instagram, TikTok, Facebook and X don't share
counts with other apps, so those are typed in. **Update YouTube & Spotify counts** fills those two automatically
once these are set in `worker/`:

- YouTube: in the Google Cloud project, enable **YouTube Data API v3**, create an **API key** (restrict it to that
  API), then `npx wrangler secret put YOUTUBE_API_KEY`.
- Spotify: create an app at developer.spotify.com/dashboard, then `npx wrangler secret put SPOTIFY_CLIENT_ID` and
  `npx wrangler secret put SPOTIFY_CLIENT_SECRET`.

### 7. Bring over the AppSheet data

Export each AppSheet table as CSV, then in the app go to Settings → Import, pick a target (release schedule,
projects, internal dates, social posts), choose the file, and check the column matching. Columns the app
doesn't have a field for can be kept on projects as an "Imported from AppSheet" note.

## Access

Anyone at @fatpossum.com can sign in as an **editor**. `ADMIN_EMAIL` (patrick@) is always an **admin**.
Admins can set people to viewer (read-only) or disabled, and add outside emails, under Settings → Users.
Sign-in sessions last 7 days.

## Local development

```sh
cd worker && cp .dev.vars.example .dev.vars && npm install && npm run db:init:local && npm run dev   # API on :8787
python3 -m http.server 8080                                                                       # app on :8080 (from repo root)
```

Open http://localhost:8080 and use **Local dev sign-in**. Run `npm test` in `worker/` for the calendar
sync tests, which run against a mock Google Calendar.
