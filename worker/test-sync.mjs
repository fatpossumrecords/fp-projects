import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import { generateKeyPairSync } from 'crypto';
const dir = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const worker = (await import(dir + '/worker.js')).default;

// ── D1 shim over node:sqlite ──
const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync(dir + '/schema.sql', 'utf8'));
db.exec(fs.readFileSync(dir + '/seed.sql', 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => db.prepare(sql).run(...args),
  _exec() { return /^\s*select/i.test(sql) ? { results: db.prepare(sql).all(...args) } : db.prepare(sql).run(...args); },
});
const DB = { prepare: sql => stmt(sql), batch: async list => list.map(s => s._exec()) };

// ── mock Google ──
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const cals = { REL: new Map(), INT: new Map() };
let seq = 0, clock = Date.now();
const stamp = () => new Date(clock += 1000).toISOString();
const changed = { REL: [], INT: [] };
const touch = (c, ev) => { ev.updated = stamp(); changed[c].push(ev.id); };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.host === 'oauth2.googleapis.com') return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
  if (u.host === 'api.chartmetric.com') {
    // Shapes copied from the Chartmetric API reference examples.
    const J = d => new Response(JSON.stringify(d));
    if (u.pathname === '/api/token') return J({ token: 'cm', expires_in: 3600 });
    if (u.pathname === '/api/search') return J({ obj: { artists: [{ id: 2000, name: 'Nina Sky', sp_followers: 1200, sp_monthly_listeners: 34000 }] } });
    if (u.pathname === '/api/artist/2000') return J({ obj: { id: 2000, name: 'Nina Sky', code2: 'US', hometown_city: 'Queens',
      genres: { primary: { name: 'pop' }, secondary: [{ name: 'r&b/soul' }, { name: 'dance' }] },
      cm_statistics: { sp_followers: 147460505, sp_monthly_listeners: 106103812, ins_followers: '52000', tiktok_followers: 9100, ycs_subscribers: 31000, fs_likes: null, twitter_followers: 8800, deezer_fans: 410 } } });
    if (u.pathname === '/api/artist/2000/urls') return J({ obj: [
      { domain: 'spotify', url: ['https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4'] }, { domain: 'instagram', url: ['https://www.instagram.com/ninasky/?hl=en'] },
      { domain: 'twitter', url: ['https://twitter.com/ninasky'] }, { domain: 'youtube', url: ['https://www.youtube.com/channel/UCByOQJjav0CUDwxCk-jVNRQ'] },
      { domain: 'website', url: ['http://www.ninasky.com/'] }, { domain: 'itunes', url: 'https://music.apple.com/us/artist/123' }, { domain: 'genius', url: ['https://genius.com/artists/nina'] } ] });
    if (u.pathname === '/api/artist/2000/current/events') return J({ obj: u.searchParams.get('type') === 'festival'
      ? [{ id: 9, event_name: 'Pitchfork Music Festival', type: 'Festival', start_date: '2027-07-17T00:00:00.000Z', venue_name: 'Union Park', city: { name: 'Chicago', province: 'Illinois' }, code2: 'US' }]
      : [{ id: 7, event_name: 'Nina Sky at The Basement East', type: 'Concert', start_date: '2027-03-14T00:00:00.000Z', venue_name: 'The Basement East', city: { name: 'Nashville', province: 'Tennessee' }, code2: 'US', ticketmaster_event_url: 'https://ticketmaster.com/e/7' },
         { id: 8, event_name: 'Nina Sky at Terminal West (cancelled)', type: 'Concert', start_date: '2027-03-15T00:00:00.000Z', venue_name: 'Terminal West', city: { name: 'Atlanta', province: 'Georgia' }, code2: 'US' }] });
    if (u.pathname.startsWith('/api/artist/2000/stat/')) {
      const field = u.searchParams.get('field');
      if (u.pathname.endsWith('/instagram')) return J({ obj: { [field]: [{ value: 52400, timestp: '2026-10-20T08:00:00.000Z', weekly_diff: 300, monthly_diff: 1200, monthly_diff_percent: 2.34 }] } });
      if (u.pathname.endsWith('/spotify') && field === 'listeners') return J({ obj: { listeners: [{ value: 106000000, timestp: '2026-10-20T08:00:00.000Z', weekly_diff: -50000, monthly_diff: -239091, monthly_diff_percent: -0.67 }] } });
      return new Response('{}', { status: 500 });
    }
    if (u.pathname === '/api/artist/2000/relatedartists') return J({ obj: [{ id: 1, name: 'Ciara' }, { id: 2, name: 'Cassie' }] });
    return J({});
  }
  const m = u.pathname.match(/calendars\/([^/]+)\/events(?:\/(.+))?$/);
  const c = decodeURIComponent(m[1]), id = m[2] && decodeURIComponent(m[2]), cal = cals[c];
  const body = opts.body ? JSON.parse(opts.body) : null;
  const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
  if (opts.method === 'POST') { const ev = { ...body, id: 'e' + (++seq), status: 'confirmed' }; cal.set(ev.id, ev); touch(c, ev); return j(ev); }
  if (opts.method === 'PUT') { if (!cal.has(id)) return j({}, 404); const ev = { ...body, id, status: 'confirmed' }; cal.set(id, ev); touch(c, ev); return j(ev); }
  if (opts.method === 'PATCH') { const ev = cal.get(id); ev.extendedProperties = body.extendedProperties; touch(c, ev); return j(ev); }
  if (opts.method === 'DELETE') { const ev = cal.get(id); if (ev) { ev.status = 'cancelled'; touch(c, ev); } return new Response(null, { status: 204 }); }
  // list: syncToken = index into change log
  const tok = u.searchParams.get('syncToken');
  const ids = tok ? [...new Set(changed[c].slice(Number(tok.slice(1))))] : [...cal.keys()];
  return j({ items: ids.map(i => cal.get(i)), nextSyncToken: 't' + changed[c].length });
};

const env = { DB, SESSION_SECRET: 's', DEV_BYPASS_EMAIL: 'patrick@fatpossum.com', ADMIN_EMAIL: 'patrick@fatpossum.com', ALLOWED_ORIGINS: 'http://x',
  GOOGLE_SA_EMAIL: 'sa@x', GOOGLE_SA_KEY: privateKey, CHARTMETRIC_REFRESH_TOKEN: 'rt', CAL_RELEASES_ID: 'REL', CAL_INTERNAL_ID: 'INT', APP_URL: 'https://app/' };
const waits = [];
const ctx = { waitUntil: p => waits.push(p) };
const call = async (method, path, body, token) => {
  const r = await worker.fetch(new Request('http://w' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  while (waits.length) await waits.shift();
  return r.json();
};
const { token } = await call('POST', '/auth/dev');
const A = (m, p, b) => call(m, p, b, token);
const ok = (cond, msg) => console.log((cond ? 'PASS ' : 'FAIL ') + msg);

// 1. app → Google
const rel = await A('POST', '/api/releases', { artist: 'A - B', title: 'Album', format: 'LP', release_date: '2027-02-05', status: 'Confirmed' });
let r1 = await A('GET', '/api/releases/' + rel.id);
ok(r1.gcal_event_id && cals.REL.get(r1.gcal_event_id).summary === 'A - B — Album [LP]', 'release pushed to Google with correct title');
await A('POST', '/api/sync');
r1 = await A('GET', '/api/releases/' + rel.id);
ok(r1.artist === 'A - B' && r1.title === 'Album', 'round-trip of app-written event does not alter artist/title');

// 2. Google → app: move date
const ev = cals.REL.get(r1.gcal_event_id);
ev.start = { date: '2027-02-12' }; touch('REL', ev);
await A('POST', '/api/sync');
r1 = await A('GET', '/api/releases/' + rel.id);
ok(r1.release_date === '2027-02-12', 'date moved in Google flows back to app');

// 3. Google → app: rename
ev.summary = 'A - B — Album (Deluxe) [2xLP]'; touch('REL', ev);
await A('POST', '/api/sync');
r1 = await A('GET', '/api/releases/' + rel.id);
ok(r1.title === 'Album (Deluxe)' && r1.format === '2xLP' && r1.artist === 'A - B', 'rename in Google updates title/format');

// 4. new event created in Google
const nid = 'g1'; cals.INT.set(nid, { id: nid, status: 'confirmed', summary: 'Label meeting', start: { date: '2027-01-20' } }); touch('INT', cals.INT.get(nid));
await A('POST', '/api/sync');
const ms = await A('GET', '/api/milestones');
const created = ms.find(m => m.gcal_event_id === nid);
ok(created && created.title === 'Label meeting' && cals.INT.get(nid).extendedProperties?.private?.fpId === created.id, 'event created in Google becomes an internal date and gets tagged');

// 5. app wins when edited after Google
const before = cals.REL.get(r1.gcal_event_id);
await A('PUT', '/api/releases/' + rel.id, { status: 'Released' });
ok(cals.REL.get(r1.gcal_event_id).description.includes('Status: Released'), 'app edit updates Google event description');
await A('POST', '/api/sync');
r1 = await A('GET', '/api/releases/' + rel.id);
ok(r1.status === 'Released' && r1.release_date === '2027-02-12', 'sync after app edit is a no-op');

// 6. deletions
cals.INT.get(nid).status = 'cancelled'; touch('INT', cals.INT.get(nid));
await A('POST', '/api/sync');
ok(!(await A('GET', '/api/milestones')).some(m => m.id === created.id), 'deleting internal date in Google deletes it in app');
const evId = r1.gcal_event_id; cals.REL.get(evId).status = 'cancelled'; touch('REL', cals.REL.get(evId));
await A('POST', '/api/sync');
r1 = await A('GET', '/api/releases/' + rel.id);
ok(r1.id && !r1.gcal_event_id, 'deleting release in Google keeps release, unlinks event');
await A('POST', '/api/sync');
r1 = await A('GET', '/api/releases/' + rel.id);
ok(r1.gcal_event_id && cals.REL.get(r1.gcal_event_id).status === 'confirmed', 'next sync backfill re-creates the release event');

// 7. app delete removes event
await A('DELETE', '/api/releases/' + rel.id);
ok(cals.REL.get(r1.gcal_event_id).status === 'cancelled', 'deleting in app cancels Google event');
await A('POST', '/api/sync');
ok(!(await A('GET', '/api/releases')).length, 'cancelled event for deleted record does not resurrect it');

// 8. project-linked release moved in Google writes back to the project format
const p = await A('POST', '/api/projects', { artist: 'C', title: 'D', release_date: '2027-06-01', data: { formats: [{ key: 'f1', format: 'LP' }] } });
const lr = (await A('GET', '/api/releases?project_id=' + p.id))[0];
const lev = cals.REL.get(lr.gcal_event_id); lev.start = { date: '2027-06-15' }; touch('REL', lev);
await A('POST', '/api/sync');
const p2 = await A('GET', '/api/projects/' + p.id);
ok(p2.data.formats[0].release_date === '2027-06-15', 'Google date change on a project format writes back into the project');
// 9. timeline items become release-calendar events; moving one in Google moves it in the project
const tp = await A('POST', '/api/projects', { artist: 'E', title: 'F', release_date: '2027-08-01', data: { timeline: [{ date: '2027-05-01', item: 'Album announce' }] } });
const tr = (await A('GET', '/api/releases?project_id=' + tp.id)).find(r => r.kind === 'timeline');
const tev = cals.REL.get(tr.gcal_event_id);
ok(tev && tev.summary === 'E — Album announce', 'timeline item pushed to Google as "Artist — Item"');
tev.start = { date: '2027-05-08' }; tev.summary = 'E — Album announce + pre-order'; touch('REL', tev);
await A('POST', '/api/sync');
const tp2 = await A('GET', '/api/projects/' + tp.id);
ok(tp2.data.timeline[0].date === '2027-05-08' && tp2.data.timeline[0].item === 'Album announce + pre-order', 'Google edit to a timeline event writes back into the project timeline');
await A('DELETE', '/api/projects/' + tp.id);
ok(!(await A('GET', '/api/releases')).some(r => r.id === tr.id) && cals.REL.get(tr.gcal_event_id).status === 'cancelled', 'deleting the project removes its timeline rows and events');

// 10. Chartmetric mapping
const cm = await A('GET', '/api/chartmetric/artist/2000');
ok(cm.website === 'http://www.ninasky.com/' && cm.social.instagram === 'https://www.instagram.com/ninasky/' && cm.dsp_links.apple === 'https://music.apple.com/us/artist/123', 'Chartmetric links map to website / socials / DSPs (genius ignored)');
ok(cm.hometown === 'Queens, US' && cm.genre === 'Pop, R&B/Soul, Dance' && cm.riyl === 'Ciara, Cassie', 'Chartmetric hometown, genre and RIYL');
ok(cm.followers.instagram.count === 52400 && cm.followers.instagram.month === 1200 && cm.followers.instagram.month_pct === 2.34 && cm.followers.instagram.asof === '2026-10-20', 'Chartmetric growth: latest point with 30-day change');
ok(cm.followers.spotify_listeners.month === -239091 && cm.followers.tiktok.count === 9100 && cm.followers.tiktok.month == null && !cm.followers.facebook, 'falls back to the plain count when a stat call fails; nulls skipped');
const fr = await A('POST', '/api/followers', { spotify: 'https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4' });
ok(fr.source === 'Chartmetric' && fr.chartmetric_id === '2000' && fr.counts.tiktok.count === 9100, 'follower refresh finds the artist by Spotify link via Chartmetric');

// 11. tour dates: pulled shows merge with manual ones
const tp3 = await A('POST', '/api/projects', { artist: 'G', title: 'H', data: { chartmetric_id: '2000', tour: [
  { key: 'm1', date: '2027-03-14', city: 'Nashville, TN', venue: '', announced: false, source: 'manual' },
  { key: 'm2', date: '2027-04-01', city: 'Denver, CO', venue: 'Bluebird', announced: false, source: 'manual' } ] } });
const pull1 = await A('POST', `/api/projects/${tp3.id}/tour/pull`);
const t1 = pull1.project.data.tour;
const nash = t1.find(t => t.key === 'm1'), den = t1.find(t => t.key === 'm2');
ok(nash.announced === true && nash.venue === 'The Basement East' && nash.ticket_url === 'https://ticketmaster.com/e/7', 'manual unannounced show flips to announced when a matching listing appears');
ok(den.announced === false, 'manual show with no listing stays not announced');
ok(t1.length === 4 && t1.find(t => t.city.startsWith('Atlanta')).cancelled === true && t1.find(t => t.notes === 'Pitchfork Music Festival'), 'new concerts and festivals added, cancelled flagged');
const pull2 = await A('POST', `/api/projects/${tp3.id}/tour/pull`);
ok(pull2.project.data.tour.length === 4 && pull2.added === 0, 'pulling again adds no duplicates');
// city written differently but same venue / only show that day → still linked, not duplicated
const tp5 = await A('POST', '/api/projects', { artist: 'G2', title: 'H2', data: { chartmetric_id: '2000', tour: [
  { key: 'a', date: '2027-03-14', city: 'Music City', venue: 'Basement East', announced: false, source: 'manual' },
  { key: 'b', date: '2027-03-15', city: 'ATL', venue: '', announced: false, source: 'manual' } ] } });
const t5 = (await A('POST', `/api/projects/${tp5.id}/tour/pull`)).project.data.tour;
ok(t5.length === 3 && t5.find(t => t.key === 'a').announced && t5.find(t => t.key === 'b').ext_id === 'cm:8', 'matches by venue, or the only show that day, when the city is written differently');
// a pulled show the team deleted stays deleted
const p5 = await A('GET', '/api/projects/' + tp5.id);
p5.data.tour = p5.data.tour.filter(t => t.ext_id !== 'cm:9'); p5.data.tour_dismissed = ['cm:9'];
await A('PUT', '/api/projects/' + tp5.id, { data: p5.data, _expected_updated_at: p5.updated_at });
const t5b = (await A('POST', `/api/projects/${tp5.id}/tour/pull`)).project.data.tour;
ok(t5b.length === 2 && !t5b.some(t => t.ext_id === 'cm:9'), 'a deleted pulled show is not added back');

// 14. one event per release date for all formats
const gp = await A('POST', '/api/projects', { artist: 'Honey', title: 'LP2', release_date: '2027-04-09', data: { formats: [{ key: 'g1', format: 'LP', catalog: 'FP1' }, { key: 'g2', format: 'CD', catalog: 'FP2' }, { key: 'g3', format: 'Digital Album' }] } });
let grows = await A('GET', '/api/releases?project_id=' + gp.id);
const gid = grows[0].gcal_event_id;
ok(grows.length === 3 && grows.every(r => r.gcal_event_id === gid) && cals.REL.get(gid).summary === 'Honey — LP2 [LP / CD / Digital Album]', 'three formats on one date share one event');
ok(cals.REL.get(gid).description.startsWith('LP — FP1\nCD — FP2\nDigital Album'), 'event description lists each format with its cat #');
const gev = cals.REL.get(gid); gev.start = { date: '2027-04-16' }; touch('REL', gev);
await A('POST', '/api/sync');
grows = await A('GET', '/api/releases?project_id=' + gp.id);
ok(grows.every(r => r.release_date === '2027-04-16'), 'moving the shared event in Google moves every format');
const gpd = await A('GET', '/api/projects/' + gp.id);
ok(gpd.data.formats.every(f => !f.release_date || f.release_date === '2027-04-16'), 'and writes the new date back to the project');
const cd = grows.find(r => r.format === 'CD');
await A('PUT', '/api/releases/' + cd.id, { release_date: '2027-05-01' });
grows = await A('GET', '/api/releases?project_id=' + gp.id);
const cdRow = grows.find(r => r.format === 'CD'), lpRow = grows.find(r => r.format === 'LP');
ok(cdRow.gcal_event_id !== lpRow.gcal_event_id && cals.REL.get(lpRow.gcal_event_id).summary === 'Honey — LP2 [LP / Digital Album]' && cals.REL.get(cdRow.gcal_event_id).summary === 'Honey — LP2 [CD]', 'giving one format its own date splits it into its own event');
await A('PUT', '/api/releases/' + cdRow.id, { release_date: '2027-04-16' });
grows = await A('GET', '/api/releases?project_id=' + gp.id);
ok(new Set(grows.map(r => r.gcal_event_id)).size === 1 && cals.REL.get(cdRow.gcal_event_id).status === 'cancelled', 'moving it back re-joins the shared event and removes the extra one');
await A('DELETE', '/api/releases/' + grows.find(r => r.format === 'Digital Album').id);
ok(cals.REL.get(grows[0].gcal_event_id).summary === 'Honey — LP2 [LP / CD]' && cals.REL.get(grows[0].gcal_event_id).status === 'confirmed', 'deleting one format updates the shared event instead of removing it');
// one-time regroup of events created one-per-format before this change
const lr1 = await A('POST', '/api/releases', { artist: 'Old', title: 'Way', format: 'LP', release_date: '2027-06-06' });
const lr2 = await A('POST', '/api/releases', { artist: 'Old', title: 'Way', format: 'CD', release_date: '2027-06-06' });
const e1 = 'old-e1', e2 = 'old-e2';
for (const [e, f] of [[e1, 'LP'], [e2, 'CD']]) { cals.REL.set(e, { id: e, status: 'confirmed', summary: 'Old — Way [' + f + ']', start: { date: '2027-06-06' } }); }
await env.DB.batch([env.DB.prepare('UPDATE releases SET gcal_event_id = ? WHERE id = ?').bind(e1, lr1.id), env.DB.prepare('UPDATE releases SET gcal_event_id = ? WHERE id = ?').bind(e2, lr2.id),
  env.DB.prepare("DELETE FROM sync_state WHERE key = 'release_regroup_v1'")]);
for (let i = 0; i < 8; i++) await A('POST', '/api/sync');
const o1 = await A('GET', '/api/releases/' + lr1.id), o2 = await A('GET', '/api/releases/' + lr2.id);
ok(o1.gcal_event_id === o2.gcal_event_id && cals.REL.get(o1.gcal_event_id).summary === 'Old — Way [LP / CD]' && [e1, e2].filter(e => cals.REL.get(e).status === 'cancelled').length === 1, 'existing one-per-format events are merged and the spare removed');

// 13. shared calendar: other people's events are never imported or touched
env.CAL_RELEASES_SHARED = 'true';
const before13 = (await A('GET', '/api/releases')).length;
for (const [i, summary] of ['Peter Green Birthday', 'India ooo', 'Thanksgiving - US'].entries()) {
  const id = 'foreign' + i; cals.REL.set(id, { id, status: 'confirmed', summary, start: { date: '2026-11-0' + (i + 1) } }); touch('REL', cals.REL.get(id));
}
const mine = await A('POST', '/api/releases', { artist: 'Shared Test', title: 'On Primary', release_date: '2027-01-08' });
const mineEv = cals.REL.get((await A('GET', '/api/releases/' + mine.id)).gcal_event_id);
mineEv.start = { date: '2027-01-15' }; touch('REL', mineEv);
cals.REL.get('foreign1').status = 'cancelled'; touch('REL', cals.REL.get('foreign1'));
await A('POST', '/api/sync');
const rels13 = await A('GET', '/api/releases');
ok(rels13.length === before13 + 1 && !rels13.some(r => /Birthday|ooo|Thanksgiving/.test(r.artist + r.title)), 'shared calendar: birthdays / OOO / holidays are not imported');
ok((await A('GET', '/api/releases/' + mine.id)).release_date === '2027-01-15', 'shared calendar: moving an app event in Google still syncs back');
ok(!cals.REL.get('foreign0').extendedProperties && cals.REL.get('foreign0').summary === 'Peter Green Birthday', 'shared calendar: other events are left untouched');
env.CAL_RELEASES_SHARED = '';

// 12. scheduled Chartmetric refresh (runs as the cron would)
const tp4 = await A('POST', '/api/projects', { artist: 'Nina Sky', title: 'Weekly', release_date: '2027-02-01', data: { chartmetric_id: '2000', followers: { instagram: { count: 50000, asof: '2026-09-01' } } } });
await worker.scheduled({}, env, ctx); while (waits.length) await waits.shift();
const tp4b = await A('GET', '/api/projects/' + tp4.id);
ok(tp4b.data.followers.instagram.count === 52400 && tp4b.data.followers.instagram.prev?.count === 50000 && tp4b.data.followers_synced_at, 'weekly refresh updates follower counts and keeps the previous reading');
ok(tp4b.data.tour?.length === 3 && tp4b.data.tour_synced_at, 'scheduled run also pulls tour dates');
ok(tp4b.updated_at === tp4.updated_at, 'background refresh does not bump updated_at (no save conflicts for editors)');
await worker.scheduled({}, env, ctx); while (waits.length) await waits.shift();
ok((await A('GET', '/api/projects/' + tp4.id)).data.followers_synced_at === tp4b.data.followers_synced_at, 'a second run the same week skips projects already refreshed');

const log = await A('GET', '/api/sync/log');
ok(!log.some(l => l.level === 'error'), 'no sync errors logged' + (log.filter(l => l.level === 'error').map(l => ' | ' + l.msg).join('')));
