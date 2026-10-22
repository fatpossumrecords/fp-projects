/* ============================================================
   FAT POSSUM — Project Management API (Cloudflare Worker + D1)

   Routes
     POST /auth/google              exchange a Google ID token for an app session
     POST /auth/dev                 local-only login (needs DEV_BYPASS_EMAIL in .dev.vars)
     GET  /api/bootstrap            me + settings + artists + users
     GET/POST        /api/:table    list / create   (releases, projects, milestones, social, artists)
     GET/PUT/DELETE  /api/:table/:id
     POST /api/projects/:id/milestones/generate   create internal dates from templates
     PUT  /api/settings/:key
     GET  /api/users · PUT /api/users/:email      (role changes: admin only)
     POST /api/artists/:id/share · DELETE ...     read-only social share link
     POST /api/import               bulk insert rows from the CSV importer (admin)
     POST /api/sync                 run the Google Calendar sync now (admin)
     GET  /api/sync/log
     GET  /share/:token             public, read-only artist social calendar

   Google Calendar is synced both ways:
     app → Google  every release / milestone write upserts its event
     Google → app  the cron trigger (every 5 min) reads incremental changes
                   with a syncToken. Date/title edits flow back, new events
                   become records, deleted events delete milestones and unlink
                   releases (a release is never deleted from Google's side).
   ============================================================ */

const SESSION_DAYS = 7;
const SEP = ' — ';   // separator in release event titles

// ── TABLE CONFIG ─────────────────────────────────────────────
const TABLES = {
  releases: {
    table: 'releases', dateCol: 'release_date', order: 'release_date, artist', cal: 'release',
    cols: ['project_id', 'format_key', 'kind', 'artist', 'title', 'format', 'release_date', 'pm', 'status', 'territory', 'label', 'catalog', 'notes'],
    required: ['artist', 'title'],
  },
  projects: {
    table: 'projects', dateCol: 'release_date', order: 'release_date DESC',
    cols: ['name', 'artist', 'title', 'release_date', 'label', 'catalog', 'territory', 'pm', 'status', 'data', 'doc_id', 'doc_url'],
    json: ['data'], required: ['artist', 'title'],
  },
  milestones: {
    table: 'milestones', dateCol: 'date', order: 'date', cal: 'milestone',
    cols: ['project_id', 'type', 'title', 'date', 'done', 'owner', 'notes'],
    required: ['title', 'date'],
  },
  social: {
    table: 'social_posts', dateCol: 'date', order: 'date, time',
    cols: ['date', 'time', 'artist', 'project_id', 'platform', 'platforms', 'posted', 'post_type', 'caption', 'asset_url', 'link_url', 'status', 'owner', 'notes', 'shared'],
    json: ['platforms', 'posted'], jsonArrays: ['platforms'], required: ['date'],
  },
  artists: {
    table: 'artists', order: 'name COLLATE NOCASE',
    cols: ['name', 'color', 'hometown', 'genre', 'socials', 'notes', 'profile'],
    json: ['socials', 'profile'], required: ['name'],
  },
  contacts: {
    table: 'contacts', order: 'name COLLATE NOCASE', key: c => norm(c.name),
    cols: ['name', 'role', 'company', 'email', 'phone', 'notes'], required: ['name'],
  },
  playlists: {
    table: 'playlists', order: 'dsp, name COLLATE NOCASE', key: p => playlistKey(p.dsp, p.name),
    cols: ['dsp', 'name', 'url', 'curator', 'notes'], required: ['name'],
  },
};

const norm = s => String(s || '').trim().toLowerCase();
const playlistKey = (dsp, name) => norm(dsp) + '|' + norm(name);

// ── ENTRY ────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      const res = await route(request, url, env, ctx);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status, cors);
      console.error(e);
      return json({ error: 'Server error: ' + e.message }, 500, cors);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCalendarSync(env));
    ctx.waitUntil(scheduledChartmetric(env));
  },
};

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] || ''),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const now = () => new Date().toISOString();

async function body(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'Invalid JSON body'); }
}

// ── ROUTER ───────────────────────────────────────────────────
async function route(request, url, env, ctx) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const m = request.method;

  if (parts[0] === 'auth' && parts[1] === 'google' && m === 'POST') return loginGoogle(request, env);
  if (parts[0] === 'auth' && parts[1] === 'dev' && m === 'POST') return loginDev(env);
  if (parts[0] === 'share' && parts[1] && m === 'GET') return shareView(parts[1], env);
  if (parts[0] !== 'api') throw new HttpError(404, 'Not found');

  const user = await requireUser(request, env);
  const canWrite = user.role === 'admin' || user.role === 'editor';
  const isAdmin = user.role === 'admin';
  const write = () => { if (!canWrite) throw new HttpError(403, 'Read-only account'); };
  const admin = () => { if (!isAdmin) throw new HttpError(403, 'Admin only'); };
  const [, res, id, sub, sub2] = parts;

  if (res === 'bootstrap') return json(await bootstrap(user, env));

  if (res === 'settings' && id && m === 'PUT') {
    write();
    const b = await body(request);
    await env.DB.prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3, updated_by = ?4')
      .bind(id, JSON.stringify(b.value), now(), user.email).run();
    return json({ ok: true });
  }

  if (res === 'users') {
    if (m === 'GET') return json((await env.DB.prepare('SELECT email, name, picture, role, last_login FROM users ORDER BY name').all()).results);
    if (m === 'PUT' && id) {
      admin();
      const b = await body(request);
      if (!['admin', 'editor', 'viewer', 'disabled'].includes(b.role)) throw new HttpError(400, 'Bad role');
      await env.DB.prepare('INSERT INTO users (email, name, role) VALUES (?1, ?2, ?3) ON CONFLICT(email) DO UPDATE SET role = ?3')
        .bind(id.toLowerCase(), b.name || null, b.role).run();
      return json({ ok: true });
    }
  }

  if (res === 'sync') {
    if (id === 'log') return json((await env.DB.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 100').all()).results);
    admin();
    if (id === 'reset') await env.DB.prepare("DELETE FROM sync_state WHERE key LIKE 'synctoken:%'").run();
    const summary = await runCalendarSync(env);
    return json(summary);
  }

  if (res === 'linkinfo' && m === 'GET') return json(await linkInfo(url.searchParams.get('url') || ''));
  if (res === 'followers' && m === 'POST') return json(await fetchFollowers(await body(request), env));
  if (res === 'chartmetric') {
    if (!env.CHARTMETRIC_REFRESH_TOKEN) throw new HttpError(400, 'Chartmetric isn’t connected (needs CHARTMETRIC_REFRESH_TOKEN)');
    if (id === 'search' && m === 'GET') return json(await cmSearch(url.searchParams.get('q') || '', env));
    if (id === 'artist' && sub && m === 'GET') return json(await cmArtist(sub, env));
  }

  if (res === 'lookup' && id === 'artist' && m === 'GET') {
    return json(sub ? await lookupArtist(sub, url.searchParams.get('name') || '', env) : await searchArtists(url.searchParams.get('q') || ''));
  }

  if (res === 'import' && m === 'POST') {
    admin();
    return json(await bulkImport(await body(request), user, env, ctx));
  }

  if (res === 'artists' && id && sub === 'share') {
    write();
    if (m === 'POST') {
      const token = randomToken();
      await env.DB.prepare('UPDATE artists SET share_token = ? WHERE id = ?').bind(token, id).run();
      return json({ share_token: token });
    }
    if (m === 'DELETE') {
      await env.DB.prepare('UPDATE artists SET share_token = NULL WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  if (res === 'projects' && id && sub === 'tour' && sub2 === 'pull' && m === 'POST') {
    write();
    if (!env.CHARTMETRIC_REFRESH_TOKEN) throw new HttpError(400, 'Chartmetric isn’t connected (needs CHARTMETRIC_REFRESH_TOKEN)');
    const r = await pullProjectTour(id, { email: user.email }, env, true);
    return json({ ...r, project: await getRow(TABLES.projects, id, env) });
  }

  if (res === 'projects' && id && sub === 'milestones' && sub2 === 'generate' && m === 'POST') {
    write();
    return json(await generateMilestones(id, user, env, ctx));
  }

  const cfg = TABLES[res];
  if (!cfg) throw new HttpError(404, 'Unknown resource');

  if (!id && m === 'GET') return json(await listRows(cfg, url.searchParams, env));
  if (!id && m === 'POST') { write(); return json(await createRow(res, cfg, await body(request), user, env, ctx), 201); }
  if (id && m === 'GET') {
    const row = await getRow(cfg, id, env);
    if (!row) throw new HttpError(404, 'Not found');
    return json(row);
  }
  if (id && m === 'PUT') { write(); return json(await updateRow(res, cfg, id, await body(request), user, env, ctx)); }
  if (id && m === 'DELETE') { write(); await deleteRow(res, cfg, id, user, env, ctx); return json({ ok: true }); }

  throw new HttpError(405, 'Method not allowed');
}

// ── AUTH ─────────────────────────────────────────────────────
async function loginGoogle(request, env) {
  const { credential } = await body(request);
  if (!credential) throw new HttpError(400, 'Missing credential');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) throw new HttpError(401, 'Google rejected the sign-in token');
  const info = await r.json();
  if (info.aud !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, 'Token audience mismatch');
  if (String(info.email_verified) !== 'true') throw new HttpError(401, 'Email not verified');
  const email = String(info.email || '').toLowerCase();
  const domain = (env.ALLOWED_DOMAIN || '').toLowerCase();
  return issueSession({ email, name: info.name, picture: info.picture }, env, domain && !email.endsWith('@' + domain));
}

async function loginDev(env) {
  if (!env.DEV_BYPASS_EMAIL) throw new HttpError(404, 'Not found');
  return issueSession({ email: env.DEV_BYPASS_EMAIL.toLowerCase(), name: 'Dev User', picture: '' }, env, false);
}

// Anyone on the company domain gets in as an editor; outside addresses only
// if an admin has added them on the Users screen.
async function issueSession(profile, env, outsideDomain) {
  const existing = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(profile.email).first();
  let role = existing?.role;
  if (profile.email === String(env.ADMIN_EMAIL || '').toLowerCase()) role = 'admin';
  if (!role) {
    if (outsideDomain) throw new HttpError(403, 'Only Fat Possum accounts can sign in. Ask an admin to add you.');
    role = 'editor';
  }
  if (role === 'disabled') throw new HttpError(403, 'Your access has been disabled. Contact an admin.');
  await env.DB.prepare(`INSERT INTO users (email, name, picture, role, last_login) VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(email) DO UPDATE SET name = ?2, picture = ?3, role = ?4, last_login = ?5`)
    .bind(profile.email, profile.name || null, profile.picture || null, role, now()).run();
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const token = await signSession({ email: profile.email, exp }, env);
  return json({ token, user: { ...profile, role } });
}

async function requireUser(request, env) {
  const h = request.headers.get('Authorization') || '';
  const payload = await verifySession(h.startsWith('Bearer ') ? h.slice(7) : '', env);
  if (!payload) throw new HttpError(401, 'Not signed in');
  const u = await env.DB.prepare('SELECT email, name, picture, role FROM users WHERE email = ?').bind(payload.email).first();
  if (!u || u.role === 'disabled') throw new HttpError(401, 'Access revoked');
  return u;
}

async function hmacKey(env) {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signSession(payload, env) {
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(p));
  return p + '.' + b64url(new Uint8Array(sig));
}

async function verifySession(token, env) {
  const [p, s] = String(token).split('.');
  if (!p || !s) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), b64urlDecode(s), new TextEncoder().encode(p));
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  return payload.exp > Date.now() ? payload : null;
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
function randomToken() { return b64url(crypto.getRandomValues(new Uint8Array(18))); }

// ── BOOTSTRAP ────────────────────────────────────────────────
async function bootstrap(user, env) {
  const [settings, artists, users, contacts, playlists] = await env.DB.batch([
    env.DB.prepare('SELECT key, value FROM settings'),
    env.DB.prepare('SELECT * FROM artists ORDER BY name COLLATE NOCASE'),
    env.DB.prepare("SELECT email, name, picture, role FROM users WHERE role != 'disabled' ORDER BY name"),
    env.DB.prepare('SELECT id, name, role, company, email, phone FROM contacts ORDER BY name COLLATE NOCASE'),
    env.DB.prepare('SELECT id, dsp, name, url FROM playlists ORDER BY dsp, name COLLATE NOCASE'),
  ]);
  const s = {};
  for (const r of settings.results) { try { s[r.key] = JSON.parse(r.value); } catch { /* skip bad row */ } }
  return {
    me: user,
    settings: s,
    artists: artists.results.map(a => decode(TABLES.artists, a)),
    users: users.results,
    contacts: contacts.results,
    playlists: playlists.results,
    calendar: { releases: env.CAL_RELEASES_ID || null, internal: env.CAL_INTERNAL_ID || null },
    sources: { chartmetric: !!env.CHARTMETRIC_REFRESH_TOKEN, youtube: !!env.YOUTUBE_API_KEY, spotify: !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET) },
  };
}

// ── GENERIC CRUD ─────────────────────────────────────────────
function decode(cfg, row) {
  if (!row) return row;
  for (const c of cfg.json || []) {
    const empty = (cfg.jsonArrays || []).includes(c) ? [] : {};
    try { row[c] = row[c] ? JSON.parse(row[c]) : empty; } catch { row[c] = empty; }
  }
  return row;
}

function pick(cfg, b) {
  const out = {};
  for (const c of cfg.cols) {
    if (!(c in b)) continue;
    let v = b[c];
    if ((cfg.json || []).includes(c)) v = JSON.stringify(v || ((cfg.jsonArrays || []).includes(c) ? [] : {}));
    else if (typeof v === 'boolean') v = v ? 1 : 0;
    else if (v === '') v = null;
    out[c] = v;
  }
  return out;
}

async function listRows(cfg, q, env) {
  const where = [], args = [];
  if (cfg.dateCol && q.get('from')) { where.push(`${cfg.dateCol} >= ?`); args.push(q.get('from')); }
  if (cfg.dateCol && q.get('to')) { where.push(`${cfg.dateCol} <= ?`); args.push(q.get('to')); }
  if (q.get('project_id') && cfg.cols.includes('project_id')) { where.push('project_id = ?'); args.push(q.get('project_id')); }
  if (q.get('artist') && cfg.cols.includes('artist')) { where.push('artist = ? COLLATE NOCASE'); args.push(q.get('artist')); }
  const sql = `SELECT * FROM ${cfg.table}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${cfg.order} LIMIT 5000`;
  const r = await env.DB.prepare(sql).bind(...args).all();
  // Lists skip the big JSON blob on projects; the editor loads it per id.
  return r.results.map(row => (cfg.table === 'projects' ? (delete row.data, row) : decode(cfg, row)));
}

async function getRow(cfg, id, env) {
  return decode(cfg, await env.DB.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).bind(id).first());
}

async function insertRow(cfg, fields, user, env) {
  const id = fields.id || crypto.randomUUID();
  const row = { ...fields, id, updated_at: fields.updated_at || now(), updated_by: user.email };
  const keys = Object.keys(row);
  await env.DB.prepare(`INSERT INTO ${cfg.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .bind(...keys.map(k => row[k] ?? null)).run();
  return id;
}

async function patchRow(cfg, id, fields, user, env, updatedAt = now()) {
  const keys = Object.keys(fields);
  await env.DB.prepare(`UPDATE ${cfg.table} SET ${keys.map(k => k + ' = ?').join(', ')}${keys.length ? ', ' : ''}updated_at = ?, updated_by = ? WHERE id = ?`)
    .bind(...keys.map(k => fields[k] ?? null), updatedAt, user.email, id).run();
}

async function ensureArtist(name, user, env) {
  if (!name) return;
  await env.DB.prepare('INSERT OR IGNORE INTO artists (id, name, updated_at, updated_by) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), String(name).trim(), now(), user.email).run();
}

async function createRow(res, cfg, b, user, env, ctx) {
  const fields = pick(cfg, b);
  for (const r of cfg.required || []) if (!fields[r]) throw new HttpError(400, `${r} is required`);
  if (cfg.key) fields[cfg.table === 'contacts' ? 'name_key' : 'pl_key'] = cfg.key(fields);
  const id = await insertRow(cfg, fields, user, env);
  if (fields.artist && res !== 'artists') await ensureArtist(fields.artist, user, env);
  await afterWrite(res, id, user, env, ctx);
  return getRow(cfg, id, env);
}

async function updateRow(res, cfg, id, b, user, env, ctx) {
  const current = await getRow(cfg, id, env);
  if (!current) throw new HttpError(404, 'Not found');
  // Optimistic locking: the client sends the updated_at it loaded. If someone
  // else saved in between, refuse instead of silently overwriting their edit.
  if (b._expected_updated_at && b._expected_updated_at !== current.updated_at) {
    throw new HttpError(409, `${current.updated_by || 'Someone'} saved this at ${current.updated_at}. Reload to see their changes.`, { current });
  }
  const fields = pick(cfg, b);
  for (const r of cfg.required || []) if (r in fields && !fields[r]) throw new HttpError(400, `${r} is required`);
  if (cfg.key) fields[cfg.table === 'contacts' ? 'name_key' : 'pl_key'] = cfg.key({ ...current, ...fields });
  await patchRow(cfg, id, fields, user, env);
  if (fields.artist && res !== 'artists') await ensureArtist(fields.artist, user, env);

  if (res === 'projects' && b._shift_milestones && current.release_date && fields.release_date && fields.release_date !== current.release_date) {
    const delta = daysBetween(current.release_date, fields.release_date);
    const ms = await env.DB.prepare('SELECT id, date FROM milestones WHERE project_id = ? AND done = 0').bind(id).all();
    for (const m of ms.results) await patchRow(TABLES.milestones, m.id, { date: addDays(m.date, delta) }, user, env);
    ctx.waitUntil(pushMany(env, 'milestone', ms.results.map(m => m.id)));
  }
  await afterWrite(res, id, user, env, ctx);
  return getRow(cfg, id, env);
}

async function deleteRow(res, cfg, id, user, env, ctx) {
  const row = await getRow(cfg, id, env);
  if (!row) return;
  await env.DB.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).bind(id).run();
  // Deleting a project-linked row on the schedule removes its Formats / Timeline
  // entry too, so it doesn't come back the next time the project is saved.
  if (res === 'releases' && row.project_id && row.format_key) {
    const p = await getRow(TABLES.projects, row.project_id, env);
    const list = p?.data?.[row.kind === 'timeline' ? 'timeline' : 'formats'];
    if (Array.isArray(list) && list.some(x => x.key === row.format_key)) {
      p.data[row.kind === 'timeline' ? 'timeline' : 'formats'] = list.filter(x => x.key !== row.format_key);
      await patchRow(TABLES.projects, p.id, { data: JSON.stringify(p.data) }, user, env);
    }
  }
  if (cfg.cal && row.gcal_event_id) ctx.waitUntil(deleteEvent(env, cfg.cal, row.gcal_event_id));
  if (res === 'projects') {
    const ms = await env.DB.prepare('SELECT gcal_event_id FROM milestones WHERE project_id = ? AND gcal_event_id IS NOT NULL').bind(id).all();
    // Timeline items mean nothing without their project; format rows stay on the schedule.
    const tl = await env.DB.prepare("SELECT gcal_event_id FROM releases WHERE project_id = ? AND kind = 'timeline' AND gcal_event_id IS NOT NULL").bind(id).all();
    ctx.waitUntil(Promise.all(tl.results.map(r => deleteEvent(env, 'release', r.gcal_event_id))));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM releases WHERE project_id = ? AND kind = 'timeline'").bind(id),
      env.DB.prepare('DELETE FROM milestones WHERE project_id = ?').bind(id),
      // Release-schedule rows stay; they just stop being tied to the project.
      env.DB.prepare('UPDATE releases SET project_id = NULL, format_key = NULL WHERE project_id = ?').bind(id),
    ]);
    ctx.waitUntil(Promise.all(ms.results.map(m => deleteEvent(env, 'milestone', m.gcal_event_id))));
  }
}

async function afterWrite(res, id, user, env, ctx) {
  if (res === 'releases') { await writeThroughFormat(id, user, env); ctx.waitUntil(pushRecord(env, 'release', id)); }
  if (res === 'milestones') ctx.waitUntil(pushRecord(env, 'milestone', id));
  if (res === 'projects') {
    await syncProjectReleases(id, user, env, ctx);
    await learnFromProject(id, user, env);
  }
}

// Every project save teaches the shared libraries, so the next project for the
// same artist (or with the same people / playlists) fills itself in:
//   artist profile  website, genre, hometown, RIYL, socials, DSP links, team, logo
//   contacts        everyone on the team list
//   playlists       every playlist name + link
async function learnFromProject(projectId, user, env) {
  const p = await getRow(TABLES.projects, projectId, env);
  if (!p) return;
  const d = p.data || {};
  const a = await env.DB.prepare('SELECT id, profile FROM artists WHERE name = ? COLLATE NOCASE').bind(p.artist).first();
  if (a) {
    let prof = {};
    try { prof = JSON.parse(a.profile || '{}') || {}; } catch { prof = {}; }
    for (const k of ['website', 'genre', 'hometown', 'riyl', 'chartmetric_id']) if (String(d[k] || '').trim()) prof[k] = d[k];
    for (const group of ['social', 'dsp_links']) {
      prof[group] ||= {};
      for (const [k, v] of Object.entries(d[group] || {})) if (String(v || '').trim()) prof[group][k] = v;
    }
    // Follower counts: keep whichever reading is newest per platform.
    prof.followers ||= {};
    for (const [k, v] of Object.entries(d.followers || {})) {
      if (v && v.count !== '' && v.count != null && (!prof.followers[k] || String(v.asof || '') >= String(prof.followers[k].asof || ''))) prof.followers[k] = v;
    }
    for (const extra of ['social_extra', 'dsp_extra']) {
      const rows = (d[extra] || []).filter(x => String(x.url || '').trim());
      if (rows.length) prof[extra] = rows;
    }
    const team = (d.team || []).filter(t => String(t.name || '').trim());
    if (team.length) prof.team = team;
    if (String(d.assets?.logo || '').trim()) prof.logo = d.assets.logo;
    await env.DB.prepare('UPDATE artists SET profile = ?, hometown = COALESCE(?, hometown), genre = COALESCE(?, genre), updated_at = ?, updated_by = ? WHERE id = ?')
      .bind(JSON.stringify(prof), d.hometown || null, d.genre || null, now(), user.email, a.id).run();
  }
  const stmts = [];
  for (const t of d.team || []) {
    if (!String(t.name || '').trim()) continue;
    stmts.push(env.DB.prepare(`INSERT INTO contacts (id, name_key, name, role, company, email, phone, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(name_key) DO UPDATE SET name = ?3, role = COALESCE(NULLIF(?4, ''), role), company = COALESCE(NULLIF(?5, ''), company),
        email = COALESCE(NULLIF(?6, ''), email), phone = COALESCE(NULLIF(?7, ''), phone), updated_at = ?8, updated_by = ?9`)
      .bind(crypto.randomUUID(), norm(t.name), t.name.trim(), t.role || '', t.company || '', t.email || '', t.phone || '', now(), user.email));
  }
  for (const pl of d.playlists || []) {
    if (!String(pl.name || '').trim()) continue;
    stmts.push(env.DB.prepare(`INSERT INTO playlists (id, pl_key, dsp, name, url, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT(pl_key) DO UPDATE SET url = COALESCE(NULLIF(?5, ''), url), updated_at = ?6, updated_by = ?7`)
      .bind(crypto.randomUUID(), playlistKey(pl.dsp, pl.name), pl.dsp || null, pl.name.trim(), pl.url || '', now(), user.email));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

// A project's FORMATS list drives its rows on the release schedule: one row per
// format, kept in step with the project's headline fields on every save.
async function syncProjectReleases(projectId, user, env, ctx) {
  const p = await getRow(TABLES.projects, projectId, env);
  const formats = (p.data?.formats || []).filter(f => f && f.key && (f.format || f.title));
  // Timeline items saved before they carried keys get one now, so their schedule rows stay linked.
  if (Array.isArray(p.data?.timeline) && p.data.timeline.some(t => t && !t.key)) {
    for (const t of p.data.timeline) if (t && !t.key) t.key = crypto.randomUUID().slice(0, 8);
    await env.DB.prepare('UPDATE projects SET data = ? WHERE id = ?').bind(JSON.stringify(p.data), projectId).run();
  }
  const timeline = (p.data?.timeline || []).filter(t => t && t.key && String(t.item || '').trim());
  const existing = (await env.DB.prepare('SELECT * FROM releases WHERE project_id = ? AND format_key IS NOT NULL').bind(projectId).all()).results;
  const byKey = Object.fromEntries(existing.map(r => [r.format_key, r]));
  const touched = [];
  const wanted = [
    ...formats.map(f => ({
      project_id: projectId, format_key: f.key, kind: 'format',
      artist: p.artist, title: f.title || p.title, format: f.format || null,
      release_date: f.release_date || p.release_date || null,
      pm: p.pm, status: f.status || p.status, territory: f.territory || p.territory, label: p.label,
      catalog: f.catalog || p.catalog || null,
    })),
    // Timeline items (announce, singles, video…) sit on the schedule beside the formats.
    ...timeline.map(t => ({
      project_id: projectId, format_key: t.key, kind: 'timeline',
      artist: p.artist, title: t.item.trim(), format: null, release_date: t.date || null,
      pm: p.pm, status: p.status, territory: p.territory, label: p.label, catalog: null,
    })),
  ];
  for (const fields of wanted) {
    const f = { key: fields.format_key };
    const cur = byKey[f.key];
    if (!cur) touched.push(await insertRow(TABLES.releases, fields, user, env));
    else {
      const changed = Object.keys(fields).some(k => (cur[k] ?? null) !== (fields[k] ?? null));
      if (changed) { await patchRow(TABLES.releases, cur.id, fields, user, env); touched.push(cur.id); }
      delete byKey[f.key];
    }
  }
  for (const gone of Object.values(byKey)) {
    await env.DB.prepare('DELETE FROM releases WHERE id = ?').bind(gone.id).run();
    if (gone.gcal_event_id) ctx.waitUntil(deleteEvent(env, 'release', gone.gcal_event_id));
  }
  ctx.waitUntil(pushMany(env, 'release', touched));
  // Milestone event titles include the artist name.
  const ms = await env.DB.prepare('SELECT id FROM milestones WHERE project_id = ?').bind(projectId).all();
  ctx.waitUntil(pushMany(env, 'milestone', ms.results.map(m => m.id)));
}

// A release row generated from a project format is edited in two places (the
// schedule and the project). Copy schedule-side edits back into the project's
// format entry so the next project save doesn't revert them.
const FORMAT_FIELDS = { title: 'title', format: 'format', release_date: 'release_date', status: 'status', territory: 'territory', catalog: 'catalog' };
async function writeThroughFormat(releaseId, user, env) {
  const r = await env.DB.prepare('SELECT * FROM releases WHERE id = ?').bind(releaseId).first();
  if (!r?.project_id || !r.format_key) return;
  const p = await getRow(TABLES.projects, r.project_id, env);
  if (r.kind === 'timeline') {
    const t = (p?.data?.timeline || []).find(x => x.key === r.format_key);
    if (!t) return;
    if (t.item === r.title && (t.date || null) === (r.release_date || null)) return;
    t.item = r.title; t.date = r.release_date || '';
    return patchRow(TABLES.projects, p.id, { data: JSON.stringify(p.data) }, user, env);
  }
  const f = (p?.data?.formats || []).find(x => x.key === r.format_key);
  if (!f) return;
  let changed = false;
  for (const [col, fk] of Object.entries(FORMAT_FIELDS)) {
    // Store only true overrides; a value equal to the project's own stays blank
    // so the format keeps inheriting later project-level changes.
    const v = col !== 'format' && (r[col] ?? null) === (p[col] ?? null) ? '' : (r[col] ?? '');
    if ((f[fk] ?? '') !== v) { f[fk] = v; changed = true; }
  }
  if (changed) await patchRow(TABLES.projects, p.id, { data: JSON.stringify(p.data) }, user, env);
}

async function generateMilestones(projectId, user, env, ctx) {
  const p = await getRow(TABLES.projects, projectId, env);
  if (!p) throw new HttpError(404, 'Project not found');
  if (!p.release_date) throw new HttpError(400, 'Set a release date first — internal dates are counted back from it');
  const tRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'milestone_templates'").first();
  const templates = tRow ? JSON.parse(tRow.value) : [];
  const have = new Set((await env.DB.prepare('SELECT type FROM milestones WHERE project_id = ?').bind(projectId).all()).results.map(r => r.type));
  const created = [];
  for (const t of templates) {
    if (!t.key || have.has(t.key)) continue;
    created.push(await insertRow(TABLES.milestones, {
      project_id: projectId, type: t.key, title: t.title, date: addDays(p.release_date, Number(t.offset) || 0), done: 0, owner: t.owner || null,
    }, user, env));
  }
  ctx.waitUntil(pushMany(env, 'milestone', created));
  return { created: created.length };
}

// ── IMPORT ───────────────────────────────────────────────────
async function bulkImport(b, user, env, ctx) {
  const cfg = TABLES[b.table];
  if (!cfg || !Array.isArray(b.rows)) throw new HttpError(400, 'Bad import');
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 5000) : [];
  let inserted = 0, skipped = 0;
  const artists = new Set();
  const stmts = [];
  for (const raw of rows) {
    const fields = pick(cfg, raw);
    if ((cfg.required || []).some(r => !fields[r])) { skipped++; continue; }
    const row = { ...fields, id: crypto.randomUUID(), updated_at: now(), updated_by: user.email };
    const keys = Object.keys(row);
    stmts.push(env.DB.prepare(`INSERT INTO ${cfg.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).bind(...keys.map(k => row[k] ?? null)));
    if (fields.artist) artists.add(String(fields.artist).trim());
    inserted++;
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  for (const a of artists) await ensureArtist(a, user, env);
  // Imported releases get their calendar events on the next cron run (see backfill in runCalendarSync).
  return { inserted, skipped };
}

// ── PUBLIC SHARE ─────────────────────────────────────────────
async function shareView(token, env) {
  const artist = await env.DB.prepare('SELECT id, name, color FROM artists WHERE share_token = ?').bind(token).first();
  if (!artist) throw new HttpError(404, 'This link is no longer active');
  const from = addDays(new Date().toISOString().slice(0, 10), -30);
  const [posts, releases] = await env.DB.batch([
    env.DB.prepare(`SELECT date, time, platform, platforms, posted, post_type, caption, asset_url, link_url, status FROM social_posts
      WHERE artist = ? COLLATE NOCASE AND shared = 1 AND date >= ? ORDER BY date, time LIMIT 1000`).bind(artist.name, from),
    env.DB.prepare(`SELECT title, format, kind, release_date FROM releases WHERE artist = ? COLLATE NOCASE AND release_date >= ?
      AND (status IS NULL OR status NOT IN ('Cancelled', 'On Hold')) ORDER BY release_date`).bind(artist.name, from),
  ]);
  const parse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
  const ps = posts.results.map(p => ({ ...p, platforms: parse(p.platforms, p.platform ? [p.platform] : []), posted: parse(p.posted, {}) }));
  return json({ artist: { name: artist.name, color: artist.color }, posts: ps, releases: releases.results });
}

// ── DATES ────────────────────────────────────────────────────
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
}

// ── GOOGLE CALENDAR ──────────────────────────────────────────
// Auth is a service account (GOOGLE_SA_EMAIL / GOOGLE_SA_KEY secrets) that has
// "Make changes to events" on both shared calendars. No domain-wide delegation needed.
let _gToken = null;

async function googleToken(env) {
  if (_gToken && _gToken.exp > Date.now() + 60e3) return _gToken.token;
  const iat = Math.floor(Date.now() / 1000);
  const enc = o => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: env.GOOGLE_SA_EMAIL, scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600,
  });
  const pem = String(env.GOOGLE_SA_KEY).replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + b64url(new Uint8Array(sig)) }),
  });
  if (!r.ok) throw new Error('Google token exchange failed: ' + (await r.text()));
  const t = await r.json();
  _gToken = { token: t.access_token, exp: Date.now() + t.expires_in * 1000 };
  return _gToken.token;
}

function calId(env, kind) { return kind === 'release' ? env.CAL_RELEASES_ID : env.CAL_INTERNAL_ID; }
// A shared calendar (e.g. the company's main one) also holds birthdays, OOO and so on.
// On those, the app only ever reads back events it created; everything else is ignored.
function calShared(env, kind) { return String(kind === 'release' ? env.CAL_RELEASES_SHARED : env.CAL_INTERNAL_SHARED).toLowerCase() === 'true'; }
function calEnabled(env, kind) { return !!(env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_KEY && calId(env, kind)); }

async function gcal(env, kind, method, path = '', { query, payload } = {}) {
  const u = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId(env, kind))}/events${path}`);
  for (const [k, v] of Object.entries(query || {})) if (v != null) u.searchParams.set(k, v);
  const r = await fetch(u, {
    method,
    headers: { Authorization: 'Bearer ' + await googleToken(env), 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (r.status === 204) return { status: 204 };
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

async function logSync(env, level, msg) {
  try { await env.DB.prepare('INSERT INTO sync_log (level, msg) VALUES (?, ?)').bind(level, String(msg).slice(0, 1000)).run(); } catch { /* logging must not throw */ }
}

function releaseEvent(r, env) {
  const lines = [
    r.status && `Status: ${r.status}`, r.pm && `PM: ${r.pm}`, r.territory && `Territory: ${r.territory}`,
    r.label && `Label: ${r.label}`, r.catalog && `Cat #: ${r.catalog}`, r.notes,
    env.APP_URL && `\n${env.APP_URL}#/releases?id=${r.id}`,
  ].filter(Boolean);
  return {
    summary: `${r.artist}${SEP}${r.title}${r.format ? ` [${r.format}]` : ''}`,
    description: lines.join('\n'),
    start: { date: r.release_date }, end: { date: addDays(r.release_date, 1) },
    transparency: 'transparent',
    extendedProperties: { private: { fpType: 'release', fpId: r.id } },
  };
}

function milestoneEvent(m, artist, env) {
  return {
    summary: `${m.done ? '✓ ' : ''}${artist ? artist + ': ' : ''}${m.title}`,
    description: [m.owner && `Owner: ${m.owner}`, m.notes, env.APP_URL && m.project_id && `\n${env.APP_URL}#/projects/${m.project_id}?tab=dates`].filter(Boolean).join('\n'),
    start: { date: m.date }, end: { date: addDays(m.date, 1) },
    transparency: 'transparent',
    extendedProperties: { private: { fpType: 'milestone', fpId: m.id } },
  };
}

async function pushMany(env, kind, ids) {
  for (const id of ids) await pushRecord(env, kind, id);
}

async function pushRecord(env, kind, id) {
  if (!calEnabled(env, kind)) return;
  try {
    const table = kind === 'release' ? 'releases' : 'milestones';
    const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
    if (!row) return;
    const date = kind === 'release' ? row.release_date : row.date;
    if (!date) {
      if (row.gcal_event_id) {
        await deleteEvent(env, kind, row.gcal_event_id);
        await env.DB.prepare(`UPDATE ${table} SET gcal_event_id = NULL WHERE id = ?`).bind(id).run();
      }
      return;
    }
    let event;
    if (kind === 'release') event = releaseEvent(row, env);
    else {
      const p = row.project_id ? await env.DB.prepare('SELECT artist FROM projects WHERE id = ?').bind(row.project_id).first() : null;
      event = milestoneEvent(row, p?.artist, env);
    }
    if (row.gcal_event_id) {
      const r = await gcal(env, kind, 'PUT', '/' + encodeURIComponent(row.gcal_event_id), { payload: event });
      if (r.status < 300) return;
      if (r.status !== 404 && r.status !== 410) throw new Error(`update ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`);
    }
    const r = await gcal(env, kind, 'POST', '', { payload: event });
    if (r.status >= 300) throw new Error(`insert ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`);
    await env.DB.prepare(`UPDATE ${table} SET gcal_event_id = ? WHERE id = ?`).bind(r.data.id, id).run();
  } catch (e) {
    await logSync(env, 'error', `push ${kind} ${id}: ${e.message}`);
  }
}

async function deleteEvent(env, kind, eventId) {
  if (!calEnabled(env, kind) || !eventId) return;
  try {
    const r = await gcal(env, kind, 'DELETE', '/' + encodeURIComponent(eventId));
    if (r.status >= 300 && r.status !== 404 && r.status !== 410) throw new Error('HTTP ' + r.status);
  } catch (e) {
    await logSync(env, 'error', `delete ${kind} event ${eventId}: ${e.message}`);
  }
}

function eventDate(ev) {
  return ev.start?.date || (ev.start?.dateTime || '').slice(0, 10) || null;
}

function parseReleaseSummary(s) {
  // The app writes "Artist — Title [Format]" with an em dash; prefer that
  // separator so hyphens inside artist names don't split in the wrong place.
  const str = String(s || '');
  const em = str.indexOf(SEP);
  const m = em > 0 ? [null, str.slice(0, em), ...(str.slice(em + SEP.length).match(/^(.+?)(?:\s+\[(.+)\])?$/) || []).slice(1)]
    : str.match(/^(.+?)\s+[–-]\s+(.+?)(?:\s+\[(.+)\])?$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim(), format: m[3]?.trim() || null };
  return { artist: String(s || 'Untitled').trim(), title: '(from Google Calendar)', format: null };
}

function parseMilestoneSummary(s, artist) {
  let t = String(s || '').trim();
  const done = t.startsWith('✓');
  if (done) t = t.replace(/^✓\s*/, '');
  if (artist && t.toLowerCase().startsWith(artist.toLowerCase() + ':')) t = t.slice(artist.length + 1).trim();
  return { title: t || 'Untitled', done: done ? 1 : 0 };
}

const SYSTEM = { email: 'google-calendar' };

async function pullCalendar(env, kind) {
  const table = kind === 'release' ? 'releases' : 'milestones';
  const dateCol = kind === 'release' ? 'release_date' : 'date';
  const stateKey = 'synctoken:' + kind + ':' + calId(env, kind);
  const st = await env.DB.prepare('SELECT value FROM sync_state WHERE key = ?').bind(stateKey).first();
  let syncToken = st?.value || null, pageToken = null, nextSyncToken = null, changed = 0, pages = 0;
  const shared = calShared(env, kind);
  // Events the app knows about, loaded once, so unrelated events cost no database lookups.
  const known = new Set((await env.DB.prepare(`SELECT gcal_event_id FROM ${table} WHERE gcal_event_id IS NOT NULL`).all()).results.map(r => r.gcal_event_id));

  do {
    if (++pages > 200) throw new Error('calendar list did not finish after 200 pages');
    const r = await gcal(env, kind, 'GET', '', {
      query: { syncToken, pageToken, showDeleted: 'true', singleEvents: 'true', maxResults: '2500' },
    });
    if (r.status === 410) {           // token expired — full resync
      await env.DB.prepare('DELETE FROM sync_state WHERE key = ?').bind(stateKey).run();
      syncToken = null; pageToken = null;
      continue;
    }
    if (r.status >= 300) throw new Error(`list ${kind} ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`);

    for (const ev of r.data.items || []) {
      const fpId = ev.extendedProperties?.private?.fpId;
      if (!fpId && !known.has(ev.id) && (shared || ev.status === 'cancelled')) continue;   // not ours
      const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${fpId ? 'id = ?' : 'gcal_event_id = ?'}`).bind(fpId || ev.id).first();

      if (ev.status === 'cancelled') {
        if (!row || row.gcal_event_id !== ev.id) continue;
        if (kind === 'milestone') {
          await env.DB.prepare('DELETE FROM milestones WHERE id = ?').bind(row.id).run();
          await logSync(env, 'info', `milestone "${row.title}" deleted in Google Calendar — removed from app`);
        } else {
          await env.DB.prepare('UPDATE releases SET gcal_event_id = NULL WHERE id = ?').bind(row.id).run();
          await logSync(env, 'warn', `release "${row.artist} — ${row.title}" was deleted in Google Calendar. Kept in app; edit it to re-create the event.`);
        }
        changed++;
        continue;
      }

      const date = eventDate(ev);
      if (!date) continue;

      if (!row) {
        if (fpId) continue;            // event for a record that was deleted in the app
        // Created directly in Google Calendar → becomes a record, tagged back.
        let id;
        if (kind === 'release') {
          const p = parseReleaseSummary(ev.summary);
          id = await insertRow(TABLES.releases, { ...p, release_date: date, status: 'Planning', notes: ev.description || null, gcal_event_id: ev.id }, SYSTEM, env);
          await ensureArtist(p.artist, SYSTEM, env);
        } else {
          const p = parseMilestoneSummary(ev.summary);
          id = await insertRow(TABLES.milestones, { ...p, date, project_id: null, type: 'custom', notes: ev.description || null, gcal_event_id: ev.id }, SYSTEM, env);
        }
        await gcal(env, kind, 'PATCH', '/' + encodeURIComponent(ev.id), {
          payload: { extendedProperties: { private: { fpType: kind, fpId: id } } },
        });
        await logSync(env, 'info', `new ${kind} from Google Calendar: ${ev.summary}`);
        changed++;
        continue;
      }

      // Only accept Google's version if it was edited after the app's last save.
      if (ev.updated && row.updated_at && ev.updated <= row.updated_at) continue;
      const fields = {};
      if (date !== row[dateCol]) fields[dateCol] = date;
      // Titles are only re-parsed when someone actually renamed the event;
      // otherwise the app's own summary would round-trip through the parser.
      if (kind === 'release') {
        const p = parseReleaseSummary(ev.summary);
        if (ev.summary !== releaseEvent(row, env).summary && p.title !== '(from Google Calendar)') {
          for (const k of ['artist', 'title', 'format']) if ((p[k] ?? null) !== (row[k] ?? null)) fields[k] = p[k];
        }
      } else {
        const proj = row.project_id ? await env.DB.prepare('SELECT artist FROM projects WHERE id = ?').bind(row.project_id).first() : null;
        if (ev.summary !== milestoneEvent(row, proj?.artist, env).summary) {
          const p = parseMilestoneSummary(ev.summary, proj?.artist);
          if (p.title !== row.title) fields.title = p.title;
          if (p.done !== row.done) fields.done = p.done;
        }
      }
      if (ev.id !== row.gcal_event_id) fields.gcal_event_id = ev.id;
      if (Object.keys(fields).length) {
        await patchRow({ table }, row.id, fields, SYSTEM, env, ev.updated || now());
        if (kind === 'release') await writeThroughFormat(row.id, SYSTEM, env);
        await logSync(env, 'info', `${kind} updated from Google Calendar: ${ev.summary} (${Object.keys(fields).join(', ')})`);
        changed++;
      }
    }
    pageToken = r.data.nextPageToken || null;
    nextSyncToken = r.data.nextSyncToken || nextSyncToken;
  } while (pageToken || (!syncToken && !nextSyncToken));

  if (nextSyncToken) {
    await env.DB.prepare('INSERT INTO sync_state (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2').bind(stateKey, nextSyncToken).run();
  }
  return changed;
}

async function runCalendarSync(env) {
  const summary = {};
  for (const kind of ['release', 'milestone']) {
    if (!calEnabled(env, kind)) { summary[kind] = 'not configured'; continue; }
    try {
      // Backfill: records that have a date but no event yet (imports, failed pushes).
      const table = kind === 'release' ? 'releases' : 'milestones';
      const dateCol = kind === 'release' ? 'release_date' : 'date';
      const missing = await env.DB.prepare(`SELECT id FROM ${table} WHERE gcal_event_id IS NULL AND ${dateCol} IS NOT NULL LIMIT 40`).all();
      await pushMany(env, kind, missing.results.map(r => r.id));
      summary[kind] = { pushed: missing.results.length, pulled: await pullCalendar(env, kind) };
    } catch (e) {
      summary[kind] = 'error: ' + e.message;
      await logSync(env, 'error', `sync ${kind}: ${e.message}`);
    }
  }
  await env.DB.prepare("DELETE FROM sync_log WHERE id < (SELECT MAX(id) - 1000 FROM sync_log)").run();
  return summary;
}

// ── ARTIST LOOKUP (MusicBrainz + optional Last.fm) ───────────
// MusicBrainz is free and keyless but asks for an identifying User-Agent and
// at most ~1 request/second, so search and details are separate calls.
const MB = 'https://musicbrainz.org/ws/2';
const MB_UA = 'FatPossumProjects/1.0 ( https://fatpossumrecords.github.io/fp-projects )';

async function mbGet(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(MB + path, { headers: { 'User-Agent': MB_UA, Accept: 'application/json' } });
    if (r.status === 503) { await new Promise(res => setTimeout(res, 1100)); continue; }   // rate limited
    if (!r.ok) throw new HttpError(502, 'MusicBrainz lookup failed (HTTP ' + r.status + ')');
    return r.json();
  }
  throw new HttpError(503, 'MusicBrainz is busy — try again in a moment');
}

async function searchArtists(q) {
  if (!q.trim()) throw new HttpError(400, 'Enter an artist name');
  const d = await mbGet(`/artist?fmt=json&limit=6&query=${encodeURIComponent(`artist:"${q.replace(/"/g, '')}"`)}`);
  return (d.artists || []).map(a => ({
    id: a.id, name: a.name, score: a.score, country: a.country || '', disambiguation: a.disambiguation || '',
    area: a['begin-area']?.name || a.area?.name || '', type: a.type || '',
  }));
}

// host → [group, key]. group: website | social | dsp. Unlisted hosts are ignored
// unless MusicBrainz tags them as a social network (those become extra socials).
const LINK_HOSTS = [
  [/(^|\.)facebook\.com$/, 'social', 'facebook'], [/(^|\.)instagram\.com$/, 'social', 'instagram'],
  [/(^|\.)(twitter|x)\.com$/, 'social', 'twitter'], [/^music\.youtube\.com$/, 'dsp', 'youtube_music'],
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'social', 'youtube'], [/(^|\.)soundcloud\.com$/, 'social', 'soundcloud'],
  [/(^|\.)tiktok\.com$/, 'social', 'tiktok'], [/(^|\.)bandcamp\.com$/, 'social', 'bandcamp'],
  [/^open\.spotify\.com$/, 'dsp', 'spotify'], [/^(music|itunes)\.apple\.com$/, 'dsp', 'apple'],
  [/^music\.amazon\./, 'dsp', 'amazon'], [/(^|\.)deezer\.com$/, 'dsp', 'deezer'], [/(^|\.)tidal\.com$/, 'dsp', 'tidal'],
  [/(^|\.)qobuz\.com$/, 'dsp', 'qobuz'], [/(^|\.)pandora\.com$/, 'dsp', 'pandora'],
];
const SKIP_HOSTS = /(discogs|allmusic|rateyourmusic|musik-sammler|wikidata|wikipedia|linkedin|songkick|setlist\.fm|last\.fm|genius|imdb|viaf|isni|bbc\.co\.uk|secondhandsongs|whosampled|beatport|junodownload|musixmatch|lyrics)/i;

async function lookupArtist(mbid, name, env) {
  if (!/^[0-9a-f-]{36}$/i.test(mbid)) throw new HttpError(400, 'Bad artist id');
  const a = await mbGet(`/artist/${mbid}?fmt=json&inc=url-rels+genres+tags`);
  const out = { source: 'MusicBrainz', name: a.name, website: '', hometown: '', genre: '', riyl: '', social: {}, dsp_links: {}, social_extra: [] };
  out.hometown = [...new Set([a['begin-area']?.name, a.area?.name].filter(Boolean))].join(', ');
  const genres = (a.genres?.length ? a.genres : a.tags || []).sort((x, y) => (y.count || 0) - (x.count || 0)).slice(0, 3).map(g => g.name.replace(/\b\w/g, c => c.toUpperCase()));
  out.genre = genres.join(', ');
  for (const rel of a.relations || []) {
    const href = rel.url?.resource;
    if (!href || rel.ended) continue;
    let host;
    try { host = new URL(href).hostname.replace(/^www\./, ''); } catch { continue; }
    if (rel.type === 'official homepage' && !out.website) { out.website = href; continue; }
    const hit = LINK_HOSTS.find(([re]) => re.test(host));
    if (hit) {
      const [, group, key] = hit;
      const target = group === 'social' ? out.social : out.dsp_links;
      if (!target[key]) target[key] = href;
    } else if (rel.type === 'social network' && !SKIP_HOSTS.test(host)) {
      out.social_extra.push({ label: host.split('.').slice(-2, -1)[0].replace(/^\w/, c => c.toUpperCase()), url: href });
    }
  }
  if (env.LASTFM_API_KEY) {
    try {
      const q = `api_key=${env.LASTFM_API_KEY}&format=json&mbid=${mbid}&artist=${encodeURIComponent(name || a.name)}`;
      const sim = await (await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&limit=8&${q}`)).json();
      const names = (sim.similarartists?.artist || []).map(x => x.name).slice(0, 6);
      if (names.length) { out.riyl = names.join(', '); out.source += ' + Last.fm'; }
      if (!out.genre) {
        const info = await (await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&${q}`)).json();
        out.genre = (info.artist?.tags?.tag || []).slice(0, 3).map(t => t.name.replace(/\b\w/g, c => c.toUpperCase())).join(', ');
      }
    } catch { /* Last.fm is optional */ }
  }
  return out;
}

// ── FOLLOWER COUNTS ──────────────────────────────────────────
// Only services with a public API: YouTube (YOUTUBE_API_KEY) and Spotify
// (SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET). Instagram, TikTok, Facebook and X
// don't expose other accounts' counts, so those are entered by hand.
async function fetchFollowers(b, env) {
  // Chartmetric covers every platform in one call; fall back to YouTube/Spotify APIs without it.
  if (env.CHARTMETRIC_REFRESH_TOKEN && (b.chartmetric_id || b.spotify)) {
    try {
      let cmId = b.chartmetric_id;
      if (!cmId) cmId = (await cmSearch(b.spotify, env))[0]?.id;
      if (!cmId) throw new Error('Couldn’t find this artist on Chartmetric. Use “Look up online” to match them.');
      const a = await cmArtist(cmId, env);
      return { counts: a.followers, errors: {}, chartmetric_id: a.chartmetric_id, source: 'Chartmetric' };
    } catch (e) {
      if (!env.YOUTUBE_API_KEY && !env.SPOTIFY_CLIENT_ID) return { counts: {}, errors: { chartmetric: e.message } };
    }
  }
  const out = {}, errors = {}, today = new Date().toISOString().slice(0, 10);
  const yt = b.youtube, sp = b.spotify;
  if (yt) {
    if (!env.YOUTUBE_API_KEY) errors.youtube = 'YouTube isn’t set up (needs YOUTUBE_API_KEY)';
    else try {
      const u = new URL(yt);
      const seg = u.pathname.split('/').filter(Boolean);
      const q = seg[0] === 'channel' ? `id=${seg[1]}` : seg[0]?.startsWith('@') ? `forHandle=${encodeURIComponent(seg[0])}`
        : seg[0] === 'user' ? `forUsername=${encodeURIComponent(seg[1])}` : null;
      if (!q) throw new Error('Use a youtube.com/@handle or /channel/… link');
      const r = await (await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&${q}&key=${env.YOUTUBE_API_KEY}`)).json();
      const st = r.items?.[0]?.statistics;
      if (!st) throw new Error(r.error?.message || 'Channel not found');
      if (st.hiddenSubscriberCount) throw new Error('This channel hides its subscriber count');
      out.youtube = { count: Number(st.subscriberCount), asof: today, source: 'YouTube' };
    } catch (e) { errors.youtube = e.message; }
  }
  if (sp) {
    if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) errors.spotify = 'Spotify isn’t set up (needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET)';
    else try {
      const id = (String(sp).match(/artist\/([A-Za-z0-9]{22})/) || [])[1];
      if (!id) throw new Error('Use an open.spotify.com/artist/… link');
      const tok = await (await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET) },
        body: 'grant_type=client_credentials',
      })).json();
      if (!tok.access_token) throw new Error('Spotify rejected the app credentials');
      const a = await (await fetch(`https://api.spotify.com/v1/artists/${id}`, { headers: { Authorization: 'Bearer ' + tok.access_token } })).json();
      if (a.followers?.total == null) throw new Error(a.error?.message || 'Spotify didn’t return a follower count');
      out.spotify = { count: a.followers.total, asof: today, source: 'Spotify' };
    } catch (e) { errors.spotify = e.message; }
  }
  return { counts: out, errors };
}

// ── CHARTMETRIC ──────────────────────────────────────────────
// Auth: the account's refresh token (CHARTMETRIC_REFRESH_TOKEN secret) is
// exchanged at /api/token for a 1-hour access token, cached per isolate.
const CM = 'https://api.chartmetric.com/api';
let _cmToken = null;

async function cmToken(env) {
  if (_cmToken && _cmToken.exp > Date.now() + 60e3) return _cmToken.token;
  const r = await fetch(CM + '/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshtoken: env.CHARTMETRIC_REFRESH_TOKEN }) });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.token) throw new HttpError(502, 'Chartmetric rejected the refresh token' + (t.error ? ': ' + t.error : ''));
  _cmToken = { token: t.token, exp: Date.now() + (t.expires_in || 3600) * 1000 };
  return _cmToken.token;
}

async function cmGet(path, env) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(CM + path, { headers: { Authorization: 'Bearer ' + await cmToken(env) } });
    if (r.status === 429) {                       // rate limited: wait for the reset the API reports
      const reset = Number(r.headers.get('X-RateLimit-Reset'));
      const wait = reset > 1e9 ? Math.min(5000, reset * 1000 - Date.now()) : 1200;
      await new Promise(res => setTimeout(res, Math.max(500, wait)));
      continue;
    }
    if (r.status === 401) { _cmToken = null; continue; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(502, `Chartmetric ${path.split('?')[0]} failed (HTTP ${r.status})${d.error ? ': ' + d.error : ''}`);
    return d;
  }
  throw new HttpError(503, 'Chartmetric is rate-limiting requests. Try again in a moment.');
}

// Accepts a name or a Spotify/Apple/Deezer URL.
async function cmSearch(q, env) {
  if (!String(q).trim()) throw new HttpError(400, 'Enter an artist name');
  const d = await cmGet(`/search?type=artists&limit=8&q=${encodeURIComponent(String(q).slice(0, 100))}`, env);
  return (d.obj?.artists || []).map(a => ({ id: a.id, name: a.name, image_url: a.image_url || '', sp_followers: a.sp_followers ?? null, sp_monthly_listeners: a.sp_monthly_listeners ?? null, score: a.cm_artist_score ?? null }));
}

// cm_statistics field → our follower key
const CM_STATS = { instagram: 'ins_followers', tiktok: 'tiktok_followers', youtube: 'ycs_subscribers', facebook: 'fs_likes', twitter: ['twitter_followers', 'ts_followers'],
  soundcloud: 'soundcloud_followers', spotify: 'sp_followers', spotify_listeners: 'sp_monthly_listeners', deezer: 'deezer_fans' };

// our follower key → Chartmetric stat [source, field]
const CM_SERIES = { instagram: ['instagram', 'followers'], tiktok: ['tiktok', 'followers'], youtube: ['youtube_channel', 'subscribers'],
  facebook: ['facebook', 'likes'], twitter: ['twitter', 'followers'], soundcloud: ['soundcloud', 'followers'],
  spotify: ['spotify', 'followers'], spotify_listeners: ['spotify', 'listeners'], deezer: ['deezer', 'fans'] };

async function cmArtist(cmId, env, { followersOnly = false } = {}) {
  if (!/^\d+$/.test(String(cmId))) throw new HttpError(400, 'Bad Chartmetric id');
  const meta = (await cmGet(`/artist/${cmId}`, env)).obj || {};
  const urls = followersOnly ? [] : (await cmGet(`/artist/${cmId}/urls`, env)).obj;
  let related = [];
  if (!followersOnly) try { related = (await cmGet(`/artist/${cmId}/relatedartists?limit=8`, env)).obj || []; } catch { /* optional */ }
  const today = new Date().toISOString().slice(0, 10);
  const out = { source: 'Chartmetric', chartmetric_id: String(cmId), name: meta.name || '', image_url: meta.image_url || '',
    website: '', hometown: '', genre: '', riyl: '', social: {}, dsp_links: {}, social_extra: [], followers: {} };
  out.hometown = [meta.hometown_city, meta.code2].filter(Boolean).join(', ');
  const g = meta.genres || {};
  out.genre = [g.primary?.name, ...(g.secondary || []).map(x => x.name)].filter(Boolean).slice(0, 3)
    .map(n => n.replace(/(^|[\s/&-])\w/g, c => c.toUpperCase())).join(', ');
  out.riyl = related.map(r => r.name).filter(Boolean).slice(0, 6).join(', ');
  for (const row of Array.isArray(urls) ? urls : []) {
    for (const href of [].concat(row.url || [])) {
      if (!href) continue;
      if (row.domain === 'website') { if (!out.website) out.website = href; continue; }
      let host; try { host = new URL(href).hostname.replace(/^www\./, ''); } catch { continue; }
      const hit = LINK_HOSTS.find(([re]) => re.test(host));
      if (!hit) continue;
      const target = hit[1] === 'social' ? out.social : out.dsp_links;
      if (!target[hit[2]]) target[hit[2]] = href.replace(/\?hl=[a-z-]+$/i, '');
    }
  }
  const st = meta.cm_statistics || {};
  for (const [key, fields] of Object.entries(CM_STATS)) {
    const v = [].concat(fields).map(f => st[f]).find(x => x !== null && x !== undefined && x !== '');
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out.followers[key] = { count: Math.round(n), asof: today, source: 'Chartmetric' };
  }
  // Growth: the latest time-series point carries 7- and 30-day diffs. Only asked
  // for platforms the artist actually has, to keep the call count down.
  for (const [key, [src, field]] of Object.entries(CM_SERIES)) {
    if (!out.followers[key]) continue;
    try {
      const pts = (await cmGet(`/artist/${cmId}/stat/${src}?field=${field}&latest=true`, env)).obj?.[field] || [];
      const pt = pts[pts.length - 1];
      if (!pt) continue;
      const num = x => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x))) ? null : Number(x);
      Object.assign(out.followers[key], {
        count: num(pt.value) ?? out.followers[key].count,
        asof: String(pt.timestp || today).slice(0, 10),
        week: num(pt.weekly_diff), month: num(pt.monthly_diff), month_pct: num(pt.monthly_diff_percent),
      });
    } catch { /* growth is optional; the count from cm_statistics stands */ }
  }
  return out;
}

// ── TOUR DATES (Chartmetric live events) ─────────────────────
// Chartmetric aggregates Songkick, JamBase, SeatGeek and Ticketmaster listings.
// Anything listed there is public, so it counts as announced. Manually entered
// shows stay "not announced" until a matching listing (same date + city) appears.
async function cmEvents(cmId, env) {
  const out = [];
  for (const type of ['concert', 'festival']) {
    const d = await cmGet(`/artist/${cmId}/current/events?fromDaysAgo=30&toDaysAgo=-540&limit=100&type=${type}`, env);
    for (const e of d.obj || []) {
      const date = String(e.start_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      out.push({
        ext_id: 'cm:' + e.id, date,
        city: [e.city?.name, e.city?.province || e.code2].filter(Boolean).join(', '),
        venue: e.venue_name || '',
        notes: e.type === 'Festival' && e.event_name ? String(e.event_name).replace(/\s*\(cancelled\)\s*$/i, '') : '',
        ticket_url: e.ticketmaster_event_url || e.seatgeek_event_url || e.songkick_event_url || e.jambase_event_url || '',
        cancelled: /\(cancelled\)/i.test(e.event_name || ''),
      });
    }
  }
  return out;
}

const cityKey = c => String(c || '').split(',')[0].trim().toLowerCase();

const venueKey = v => String(v || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');

// Match a listing to an existing row, most certain first:
//   same listing → same date + city → same date + venue → the only unlinked show that day.
// Listings someone deleted from the project (tour_dismissed) are never re-added.
function mergeTour(rows, events, dismissed = []) {
  rows = (rows || []).map(r => ({ ...r }));
  let added = 0, updated = 0;
  const skip = new Set(dismissed);
  for (const ev of events) {
    if (skip.has(ev.ext_id)) continue;
    const open = rows.filter(r => !r.ext_id && r.date === ev.date);
    const hit = rows.find(r => r.ext_id === ev.ext_id)
      || open.find(r => cityKey(r.city) === cityKey(ev.city))
      || open.find(r => r.venue && venueKey(r.venue) === venueKey(ev.venue))
      || (open.length === 1 && !events.some(o => o !== ev && o.date === ev.date) ? open[0] : null);
    if (hit) {
      const before = JSON.stringify(hit);
      hit.ext_id = ev.ext_id; hit.ticket_url = ev.ticket_url || hit.ticket_url || ''; hit.cancelled = ev.cancelled; hit.announced = true;
      if (hit.source === 'chartmetric') Object.assign(hit, { date: ev.date, city: ev.city, venue: ev.venue, notes: hit.notes || ev.notes });
      else { if (!hit.venue) hit.venue = ev.venue; if (!hit.city) hit.city = ev.city; }
      if (JSON.stringify(hit) !== before) updated++;
    } else {
      rows.push({ key: crypto.randomUUID().slice(0, 8), ...ev, source: 'chartmetric', announced: true });
      added++;
    }
  }
  rows.sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9')));
  return { rows, added, updated };
}

async function projectCmId(p, env) {
  const d = p.data || {};
  if (d.chartmetric_id) return d.chartmetric_id;
  const a = await env.DB.prepare('SELECT profile FROM artists WHERE name = ? COLLATE NOCASE').bind(p.artist).first();
  let prof = {}; try { prof = JSON.parse(a?.profile || '{}'); } catch { /* none */ }
  if (prof.chartmetric_id) return prof.chartmetric_id;
  const spotify = d.dsp_links?.spotify || prof.dsp_links?.spotify;
  return spotify ? (await cmSearch(spotify, env))[0]?.id || null : null;
}

async function pullProjectTour(projectId, user, env, strict, background = false) {
  const p = await getRow(TABLES.projects, projectId, env);
  if (!p) throw new HttpError(404, 'Project not found');
  const cmId = await projectCmId(p, env);
  if (!cmId) {
    if (strict) throw new HttpError(400, 'This artist isn’t linked to Chartmetric yet. Use “Look up online” (or add their Spotify link) first.');
    p.data.tour_synced_at = now();      // checked; try again tomorrow
    await patchRow(TABLES.projects, p.id, { data: JSON.stringify(p.data) }, user, env, p.updated_at);
    return { added: 0, updated: 0, skipped: true };
  }
  const events = await cmEvents(cmId, env);
  const { rows, added, updated } = mergeTour(p.data.tour, events, p.data.tour_dismissed || []);
  p.data.tour = rows;
  p.data.chartmetric_id = String(cmId);
  p.data.tour_synced_at = now();
  await patchRow(TABLES.projects, p.id, { data: JSON.stringify(p.data) }, user, env, (added || updated) && !background ? now() : p.updated_at);
  return { added, updated, found: events.length };
}

// Scheduled Chartmetric refreshes for current projects (release date within the
// last 120 days, or none yet). Each 5-minute cron run handles a small batch, so a
// run never exceeds Cloudflare's per-invocation request limit:
//   tour dates      daily, from 09:00 UTC   (5 projects per run, 2 requests each)
//   follower counts weekly, from Monday 09:00 UTC (2 projects per run, ~10 requests each)
async function scheduledChartmetric(env) {
  if (!env.CHARTMETRIC_REFRESH_TOKEN) return;
  const nowD = new Date();
  const today = nowD.toISOString().slice(0, 10);
  const dayStart = nowD.getUTCHours() >= 9 ? today + 'T09:00:00.000Z' : addDays(today, -1) + 'T09:00:00.000Z';
  const monday = addDays(today, -((nowD.getUTCDay() + 6) % 7)) + 'T09:00:00.000Z';
  const current = `(release_date IS NULL OR release_date >= '${addDays(today, -120)}')`;
  const sys = { email: 'chartmetric-sync' };

  const due = async (field, since, limit) => (await env.DB.prepare(
    `SELECT id FROM projects WHERE ${current} AND (json_extract(data, '$.${field}') IS NULL OR json_extract(data, '$.${field}') < ?) ORDER BY release_date IS NULL, release_date LIMIT ${limit}`)
    .bind(since).all()).results;

  for (const { id } of await due('tour_synced_at', dayStart, 5)) {
    try { await pullProjectTour(id, sys, env, false, true); }
    catch (e) { await logSync(env, 'warn', `tour sync ${id}: ${e.message}`); }
  }
  if (nowD.toISOString() >= monday) {
    for (const { id } of await due('followers_synced_at', monday, 2)) {
      try { await refreshProjectFollowers(id, sys, env); }
      catch (e) { await logSync(env, 'warn', `follower sync ${id}: ${e.message}`); }
    }
  }
}

// Latest follower counts + 30-day growth for one project, saved to the project and
// learned into the artist profile. The previous reading is kept for comparison.
async function refreshProjectFollowers(projectId, user, env) {
  const p = await getRow(TABLES.projects, projectId, env);
  if (!p) return;
  const cmId = await projectCmId(p, env);
  p.data.followers_synced_at = now();
  if (cmId) {
    const fresh = (await cmArtist(cmId, env, { followersOnly: true })).followers;
    p.data.followers ||= {};
    for (const [k, f] of Object.entries(fresh)) {
      const old = p.data.followers[k];
      const prev = old && old.asof && old.asof !== f.asof ? { count: old.count, asof: old.asof } : old?.prev;
      p.data.followers[k] = { ...f, ...(prev ? { prev } : {}) };
    }
    p.data.chartmetric_id = String(cmId);
  }
  // Background data: keep updated_at so anyone editing the project isn't hit with a save conflict.
  await patchRow(TABLES.projects, p.id, { data: JSON.stringify(p.data) }, user, env, p.updated_at);
  if (cmId) await learnFromProject(p.id, user, env);
}

// ── LINK INFO (press paste) ──────────────────────────────────
// Reads a public article's site name and headline from its <meta> tags so pasted
// press links can be labelled and sorted. Best effort: some sites block bots.
async function linkInfo(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'Not a link'); }
  if (!/^https?:$/.test(u.protocol) || /^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(u.hostname)) throw new HttpError(400, 'Not a public link');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(u.href, { redirect: 'follow', signal: ctrl.signal, headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml' } });
    if (!r.ok || !/html/i.test(r.headers.get('content-type') || '')) return { url: r.url || u.href };
    // Only the <head> matters; stop reading after ~200 KB.
    const reader = r.body.getReader(); let html = '', size = 0;
    while (size < 200000) { const { done, value } = await reader.read(); if (done) break; size += value.length; html += new TextDecoder().decode(value); if (/<\/head>/i.test(html)) break; }
    try { reader.cancel(); } catch { /* ignore */ }
    const meta = name => {
      const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i'));
      const c = m && m[0].match(/content=["']([^"']*)["']/i);
      return c ? decodeEntities(c[1]).trim() : '';
    };
    const title = meta('og:title') || meta('twitter:title') || decodeEntities((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim();
    return { url: r.url || u.href, site: meta('og:site_name'), title: title.slice(0, 300) };
  } catch { return { url: u.href }; }
  finally { clearTimeout(timer); }
}

function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39|nbsp|rsquo|lsquo|ldquo|rdquo|ndash|mdash|hellip);/gi, (m, e) => {
    const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' };
    if (map[e.toLowerCase()]) return map[e.toLowerCase()];
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return m;
  });
}
