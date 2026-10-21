/* ============================================================
   PROJECT INFO — the project sheet form, its auto-fill helpers
   (artist profiles, contacts, playlist library, Dropbox, paste
   parsers) and the Google Doc layout.
   Used by projects.js via FP.projectInfo.
   ============================================================ */
(function () {
  const esc = FP.esc;

  const SOCIALS = [['bandcamp', 'Bandcamp'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['twitter', 'Twitter / X'], ['youtube', 'YouTube'], ['soundcloud', 'SoundCloud'], ['tiktok', 'TikTok']];
  const DSPS = [['spotify', 'Spotify'], ['apple', 'Apple Music'], ['amazon', 'Amazon Music'], ['deezer', 'Deezer'], ['tidal', 'Tidal'], ['qobuz', 'Qobuz'], ['pandora', 'Pandora'], ['youtube_music', 'YouTube Music']];
  const DSP_LABELS = DSPS.map(d => d[1]);
  const ASSETS = [['bio', 'Biography', /bio|one.?sheet/i], ['press_photos', 'Press Photos', /photo|press|pics?\b|image/i], ['album_art', 'Album Art', /album|cover|front|artwork|jacket/i],
    ['single_art', 'Single Art', /single/i], ['logo', 'Logo', /logo/i], ['lyrics', 'Lyrics', /lyric/i]];
  const PL_STATUSES = ['Target', 'Pitched', 'Added', 'Not added'];

  const REPS = {
    team: { cols: [['role', 'Role'], ['name', 'Name', 'contacts'], ['company', 'Company'], ['email', 'Email'], ['phone', 'Phone']] },
    formats: { cols: [['format', 'Format', 'list:formats'], ['title', 'Title (if different)'], ['catalog', 'Cat #'], ['upc', 'UPC'], ['release_date', 'Date (if different)', 'date']], keyed: true },
    smart_links: { cols: [['label', 'Label'], ['url', 'Link', 'url']], placeholder: { label: 'e.g. Pre-save, Album link, Single 1' } },
    timeline: { cols: [['date', 'Date', 'date'], ['item', 'Item']], keyed: true },
    social_extra: { cols: [['label', 'Name'], ['url', 'Link', 'url']], addLabel: '+ Add another social', placeholder: { label: 'e.g. Threads, Bluesky' }, hideEmpty: true },
    dsp_extra: { cols: [['label', 'Name'], ['url', 'Link', 'url']], addLabel: '+ Add another DSP', placeholder: { label: 'e.g. Audiomack, Napster' }, hideEmpty: true },
    tracks: { cols: [['vol', 'Vol'], ['num', '#'], ['song', 'Song'], ['length', 'Length'], ['isrc', 'ISRC'], ['writers', 'Writers'], ['publishers', 'Publishers']] },
    playlists: { cols: [['dsp', 'DSP', 'dsp'], ['name', 'Playlist', 'playlists'], ['url', 'Link', 'url'], ['status', 'Status', 'plstatus'], ['notes', 'Notes']] },
    tour: { cols: [['date', 'Date', 'date'], ['city', 'City'], ['venue', 'Venue'], ['notes', 'Notes']], keyed: true },
  };

  const COL_W = { vol: 'width:56px', num: 'width:56px', length: 'width:80px', song: 'min-width:200px', isrc: 'min-width:140px', url: 'min-width:220px',
    name: 'min-width:160px', date: 'width:150px', format: 'min-width:120px', dsp: 'width:150px', status: 'width:120px' };

  function blankData() {
    return { social: {}, dsp_links: {}, followers: {}, assets: {}, social_extra: [], dsp_extra: [], smart_links: [], team: [], formats: [], timeline: [], tracks: [], playlists: [], tour: [] };
  }

  // Fills defaults and converts sheets saved by the first version of the form.
  function normalize(d) {
    d = Object.assign(blankData(), d || {});
    if (typeof d.timeline === 'string') { d.timeline_notes = d.timeline_notes || d.timeline; d.timeline = []; }
    if (d.social.spotify && !d.dsp_links.spotify) d.dsp_links.spotify = d.social.spotify;
    delete d.social.spotify;
    if (d.streaming_links && !d.smart_links.length) {
      d.smart_links = String(d.streaming_links).split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/(https?:\/\/\S+)/);
        return { label: m ? l.replace(m[1], '').replace(/[-–:|]\s*$/, '').trim() : l, url: m ? m[1] : '' };
      });
    }
    delete d.streaming_links;
    // Bandcamp moved from Overview into Social (via a short stop in Smart Links).
    if (d.bandcamp) { if (!d.social.bandcamp) d.social.bandcamp = d.bandcamp; delete d.bandcamp; }
    const bc = Array.isArray(d.smart_links) ? d.smart_links.findIndex(l => /bandcamp/i.test(l.label || '') && /bandcamp\.com/i.test(l.url || '')) : -1;
    if (bc >= 0 && !d.social.bandcamp) { d.social.bandcamp = d.smart_links[bc].url; d.smart_links.splice(bc, 1); }
    if (d.tracklisting && !d.tracks.length) d.tracks = parseTracks(d.tracklisting);
    delete d.tracklisting;
    for (const k of Object.keys(REPS)) if (!Array.isArray(d[k])) d[k] = [];
    for (const k of Object.keys(REPS)) if (REPS[k].keyed) for (const row of d[k]) if (!row.key) row.key = crypto.randomUUID().slice(0, 8);
    return d;
  }

  // ── PATH HELPERS ───────────────────────────────────────────
  const getPath = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
  function setPath(o, path, v) {
    const ks = path.split('.'); let cur = o;
    for (const k of ks.slice(0, -1)) cur = cur[k] ??= {};
    cur[ks.at(-1)] = v;
  }
  const blank = v => !String(v ?? '').trim();

  // ── ARTIST PROFILE AUTO-FILL ───────────────────────────────
  function artistProfile(name) {
    const a = FP.state.artists.find(x => x.name.toLowerCase() === String(name || '').trim().toLowerCase());
    return a?.profile && Object.keys(a.profile).length ? a.profile : null;
  }

  // Copies profile values into empty project fields only. Returns the names of what it filled.
  function applyProfile(proj, prof) {
    const d = proj.data, filled = new Set();
    if (blank(d.chartmetric_id) && !blank(prof.chartmetric_id)) d.chartmetric_id = prof.chartmetric_id;
    for (const [k, label] of [['website', 'website'], ['genre', 'genre'], ['hometown', 'hometown'], ['riyl', 'RIYL']]) {
      if (blank(d[k]) && !blank(prof[k])) { d[k] = prof[k]; filled.add(label); }
    }
    for (const [group, label] of [['social', 'socials'], ['dsp_links', 'DSP links']]) {
      for (const [k, v] of Object.entries(prof[group] || {})) if (blank(d[group][k]) && !blank(v)) { d[group][k] = v; filled.add(label); }
    }
    if (!d.team.some(t => !blank(t.name)) && prof.team?.length) { d.team = prof.team.map(t => ({ ...t })); filled.add('team'); }
    if (blank(d.assets.logo) && !blank(prof.logo)) { d.assets.logo = prof.logo; filled.add('logo'); }
    for (const [k, v] of Object.entries(prof.followers || {})) if (!d.followers[k] && v?.count != null) { d.followers[k] = { ...v }; filled.add('follower counts'); }
    for (const [k, label] of [['social_extra', 'socials'], ['dsp_extra', 'DSP links']]) {
      if (!d[k].some(x => !blank(x.url)) && prof[k]?.length) { d[k] = prof[k].map(x => ({ ...x })); filled.add(label); }
    }
    return [...filled];
  }

  // ── PASTE PARSERS ──────────────────────────────────────────
  const RE_ISRC = /^[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}$/i;
  const RE_LEN = /^\d{1,2}:\d{2}(:\d{2})?$/;
  const RE_NUM = /^\d{1,3}\.?$/;
  const RE_SIDE = /^(?:[A-H]\d{1,2}|(?:CD|Disc|LP)\s*\d+)$/i;
  const HEADERS = {
    vol: /^(vol|volume|disc|disk|side|cd)$/i, num: /^(#|no\.?|num|track\s*#?|track\s*no\.?|position)$/i,
    song: /^(song|title|track\s*title|track\s*name|name|track)$/i, length: /^(length|duration|time|track\s*length|runtime)$/i,
    isrc: /^isrc$/i, writers: /^(writers?|songwriters?|composers?|written\s*by|writer\s*credits?)$/i, publishers: /^(publishers?|publishing|pub)$/i,
  };

  // Accepts a plain tracklist ("1. Song (3:21)", "A1 Song 3:21") or rows
  // copied from a spreadsheet (tab-separated, header row optional).
  function parseTracks(text) {
    const lines = String(text).split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
    if (!lines.length) return [];
    if (lines.some(l => l.includes('\t'))) {
      const rows = lines.map(l => l.split('\t').map(c => c.trim()));
      const head = rows[0].map(h => Object.keys(HEADERS).find(k => HEADERS[k].test(h)));
      if (head.filter(Boolean).length >= 2) {
        return rows.slice(1).map(r => { const t = {}; head.forEach((k, i) => { if (k && r[i]) t[k] = r[i]; }); return t; }).filter(t => t.song);
      }
      return rows.map(r => {
        const t = {}, text = [];
        for (const c of r) {
          if (!c) continue;
          if (!t.isrc && RE_ISRC.test(c)) t.isrc = c.toUpperCase();
          else if (!t.length && RE_LEN.test(c)) t.length = c;
          else if (!t.num && !text.length && RE_NUM.test(c)) t.num = c.replace('.', '');
          else if (!t.vol && !text.length && RE_SIDE.test(c)) t.vol = c;
          else text.push(c);
        }
        [t.song, t.writers, t.publishers] = text;
        return t;
      }).filter(t => t.song);
    }
    return lines.map((l, i) => {
      let s = l.trim(), t = {};
      let m = s.match(/^([A-H])(\d{1,2})[.)\-:\s]\s*/i);
      if (m) { t.vol = m[1].toUpperCase(); t.num = m[2]; s = s.slice(m[0].length); }
      else if ((m = s.match(/^(\d{1,3})[.)\-:]?\s+/))) { t.num = m[1]; s = s.slice(m[0].length); }
      m = s.match(/\s*[([]?(\d{1,2}:\d{2})[)\]]?\s*$/);
      if (m) { t.length = m[1]; s = s.slice(0, m.index); }
      t.song = s.replace(/^["“]|["”]$/g, '').trim();
      if (!t.num) t.num = String(i + 1);
      return t;
    }).filter(t => t.song);
  }

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const monthIdx = name => MONTHS[name.slice(0, 4).toLowerCase()] ?? MONTHS[name.slice(0, 3).toLowerCase()];

  // Pulls a date off the front of a line. Without a year, picks the next
  // upcoming occurrence (anything more than 60 days back rolls to next year).
  function leadingDate(s) {
    s = s.replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+/i, '');
    let m, y, mo, d;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
    else if ((m = s.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?/))) [mo, d, y] = [+m[1] - 1, +m[2], m[3] ? +(m[3].length === 2 ? '20' + m[3] : m[3]) : null];
    else if ((m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i)) && monthIdx(m[1]) !== undefined) {
      mo = monthIdx(m[1]); d = +m[2]; y = m[3] ? +m[3] : null;
    } else if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:,?\s+(\d{4}))?/i)) && monthIdx(m[2]) !== undefined) {
      d = +m[1]; mo = monthIdx(m[2]); y = m[3] ? +m[3] : null;
    } else return null;
    if (y === null) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      y = today.getFullYear();
      if (new Date(y, mo, d) < new Date(today - 60 * 864e5)) y++;
    }
    const dt = new Date(y, mo, d);
    if (isNaN(dt) || dt.getMonth() !== mo) return null;
    return { date: FP.ymd(dt), rest: s.slice(m[0].length) };
  }

  // Splits free-text timeline notes into dated lines ("10/24 - Announce") and everything else.
  function splitDatedLines(text) {
    const dated = [], other = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const ld = leadingDate(line.trim());
      const item = ld && ld.rest.replace(/^\s*[-–—|:,]\s*/, '').trim();
      if (ld && item) dated.push({ date: ld.date, item }); else other.push(line.trim());
    }
    return { dated, other };
  }

  // One show per line: date, then city and venue separated by tabs, " - ", " | ", " @ " or commas.
  function parseTour(text) {
    const out = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const ld = leadingDate(line);
      if (!ld) { out.push({ error: line }); continue; }
      let rest = ld.rest.replace(/^\s*[-–—|,:@\t]\s*/, '').trim();
      let parts = rest.includes('\t') ? rest.split('\t') : rest.split(/\s+[-–—|@]\s+|\s+at\s+/i);
      parts = parts.map(p => p.trim()).filter(Boolean);
      let city = '', venue = '', notes = '';
      if (parts.length >= 2) {
        [city, venue, ...notes] = parts;
        // "The Basement East - Nashville, TN" → put the "City, ST" part in City.
        if (!/,/.test(city) && /,\s*[A-Z]{2,3}\b|,\s*[A-Z][a-z]+$/.test(venue)) [city, venue] = [venue, city];
        notes = notes.join(' · ');
      } else if (parts.length === 1) {
        const c = parts[0].split(/\s*,\s*/);
        if (c.length >= 3) { city = c.slice(0, 2).join(', '); venue = c.slice(2).join(', '); }
        else city = parts[0];
      }
      out.push({ date: ld.date, city, venue, notes });
    }
    return out;
  }

  // ── DROPBOX CHOOSER ────────────────────────────────────────
  // Needs a Dropbox app key (Settings → Lists) with this site's domain added
  // under the app's "Chooser / Saver / Embedder domains".
  function loadDropbox() {
    const key = FP.state.settings.dropbox_app_key;
    if (!key) return Promise.reject(new Error('Dropbox isn’t connected yet. An admin can add the Dropbox app key in Settings → Lists.'));
    if (window.Dropbox?.choose) return Promise.resolve(window.Dropbox);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://www.dropbox.com/static/api/2/dropins.js';
      s.id = 'dropboxjs';
      s.dataset.appKey = key;
      s.onload = () => resolve(window.Dropbox);
      s.onerror = () => reject(new Error('Couldn’t load Dropbox'));
      document.head.appendChild(s);
    });
  }
  // Must be called straight from a click: Dropbox.choose opens a popup, and
  // browsers (Safari especially) block popups that open after an await. So
  // the script is preloaded when a form opens, and choose() runs synchronously.
  function chooseFromDropbox({ multiselect }) {
    if (!FP.state.settings.dropbox_app_key) return Promise.reject(new Error('Dropbox isn’t connected yet. An admin can add the Dropbox app key in Settings → Lists.'));
    if (!window.Dropbox?.choose) {
      return loadDropbox().then(() => { throw new Error('Dropbox was still loading. Click again.'); });
    }
    return new Promise(resolve => window.Dropbox.choose({
      linkType: 'preview', multiselect, folderselect: true,
      success: files => resolve(files.map(f => ({ name: f.name, link: f.link, isDir: f.isDir }))),
      cancel: () => resolve([]),
    }));
  }

  // ── RENDER ─────────────────────────────────────────────────
  function render(box, proj, ro, onChange, hooks = {}) {
    // Fresh node each render so delegated listeners from a previous render don't stack.
    const fresh = box.cloneNode(false); box.replaceWith(fresh); box = fresh;
    if (!ro) FP.preloadDropbox();
    const d = proj.data;
    const dis = ro ? ' disabled' : '';
    const inp = (path, type = 'text', extra = '') => `<input type="${type}" data-p="${path}" value="${esc(getPath(proj, path))}"${dis}${extra}>`;
    const sel = (path, values) => `<select data-p="${path}"${dis}>${FP.options(values, getPath(proj, path))}</select>`;
    const ta = (path, rows = 3, ph = '') => `<textarea data-p="${path}" rows="${rows}" placeholder="${esc(ph)}"${dis}>${esc(getPath(proj, path))}</textarea>`;
    const openLink = v => FP.safeUrl(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener" title="Open">↗</a>` : '';
    const linkField = (path, label, extra = '') => `<div class="field"><label>${label} <span data-open-for="${path}">${openLink(getPath(proj, path))}</span>${extra}</label>${inp(path, 'url')}</div>`;
    const btn = (attr, label, cls = 'btn btn-sm') => ro ? '' : `<button class="${cls}" ${attr}>${label}</button>`;

    const SECTIONS = {
      overview: () => `<div class="grid">
        ${FP.field('Artist *', inp('artist', 'text', ` list="${FP.artistDatalist()}" autocomplete="off"`) + `<span class="hint"><span data-profile-hint></span>${ro ? '' : ' <a href="#" data-lookup>Look up online</a>'}</span>`)}
        ${FP.field('Title *', inp('title'))}
        ${FP.field('Project name', inp('name', 'text', ' placeholder="Defaults to the title"'))}
        ${FP.field('Release date', inp('release_date', 'date'))}
        ${FP.field('Label', sel('label', FP.list('labels')))}
        ${FP.field('Catalog #', inp('catalog'))}
        ${FP.field('Territory', sel('territory', FP.list('territories')))}
        ${FP.field('Project manager', sel('pm', FP.userNames()))}
        ${FP.field('Genre', inp('data.genre'))}
        ${FP.field('Hometown', inp('data.hometown'))}
        ${linkField('data.website', 'Official website')}
      </div>`,
      social: () => `${linkTable('social', SOCIALS)}<div style="margin-top:10px">${rep('social_extra')}</div>
        ${ro ? '' : FP.state.sources?.chartmetric
          ? `<p style="margin-top:10px"><button class="btn btn-sm" data-refresh-followers>Update follower counts from Chartmetric</button> <span class="hint">${d.chartmetric_id ? 'Linked to Chartmetric.' : 'Uses the Spotify link to find the artist, or run “Look up online” first.'}</span></p>`
          : `<p style="margin-top:10px"><button class="btn btn-sm" data-refresh-followers>Update YouTube &amp; Spotify counts</button> <span class="hint">Instagram, TikTok, Facebook and X don't share counts with other apps, so type those in.</span></p>`}`,
      dsps: () => `${linkTable('dsp_links', DSPS)}${d.followers.spotify_listeners ? `<p class="hint" style="margin-top:6px">Spotify monthly listeners: <b>${Number(d.followers.spotify_listeners.count).toLocaleString('en-US')}</b> (${esc(d.followers.spotify_listeners.source || '')}, ${FP.fmtDate(d.followers.spotify_listeners.asof)})</p>` : ''}<div style="margin-top:10px">${rep('dsp_extra')}</div><p class="hint" style="margin-top:6px">Artist profile pages on each service.</p>`,
      riyl: () => ta('data.riyl', 2, 'Recommended if you like…'),
      smart_links: () => rep('smart_links'),
      assets: () => `
        <div class="toolbar" style="margin-bottom:10px">${btn('data-dbx-multi', 'Pick files from Dropbox…', 'btn')}<span class="hint">Select several files or folders at once. They're matched to the fields below by filename.</span></div>
        <div class="grid">
          <div class="field wide"><label>Project assets folder <span data-open-for="data.assets.folder">${openLink(d.assets.folder)}</span>${ro ? '' : ' · <a href="#" data-dbx="data.assets.folder">Choose in Dropbox</a>'}</label>${inp('data.assets.folder', 'url', ' placeholder="Dropbox folder with everything for this release"')}</div>
          ${ASSETS.map(([k, l]) => linkField('data.assets.' + k, l + ' link', ro ? '' : ` · <a href="#" data-dbx="data.assets.${k}">Dropbox</a>`)).join('')}
        </div>`,
      team: () => `${rep('team')}<p class="hint" style="margin-top:6px">Start typing a name to pick someone already saved. New people are remembered when you save, and this artist's team fills in next time.</p>`,
      formats: () => `${rep('formats')}<p class="hint" style="margin-top:6px">Each format appears as its own row on the Release Schedule and in the Timeline below.</p>`,
      timeline: () => timelineHtml(),
      tracks: () => `<div class="toolbar" style="margin-bottom:8px">
          ${btn('data-paste="tracks"', 'Paste tracklist…')}
          <button class="btn btn-sm" data-copy="tracklist">Copy tracklist</button>
          <button class="btn btn-sm" data-copy="credits">Copy all info</button>
          <span class="hint">“Copy all info” pastes into Google Sheets or Docs as a table.</span></div>
        ${rep('tracks')}`,
      marketing: () => `<div class="grid">${FP.field('Retail', ta('data.retail', 4), 'wide')}${FP.field('Digital', ta('data.digital', 4), 'wide')}</div>`,
      playlists: () => `${rep('playlists')}<p class="hint" style="margin-top:6px">Start typing a playlist name to pick one you've used before, and its link fills in. New playlists are saved to the library when you save.</p>
        ${d.dsp && Object.values(d.dsp).some(v => v?.targets || v?.current) ? `<details style="margin-top:8px"><summary class="hint">Earlier playlisting notes</summary>${Object.entries(d.dsp).map(([k, v]) => v?.targets || v?.current ? `<p><b>${esc(k)}</b>: ${esc(v.targets || '')} ${v.current ? ' / current: ' + esc(v.current) : ''}</p>` : '').join('')}</details>` : ''}`,
      press: () => `<div class="grid">${FP.field('Quotes', ta('data.press_quotes', 4), 'wide')}${FP.field('Links', ta('data.press_links', 3), 'wide')}${FP.field('Previous press', ta('data.press_previous', 3), 'wide')}</div>`,
      radio: () => ta('data.radio', 3),
      syncs: () => ta('data.syncs', 3),
      tour: () => `<div class="toolbar" style="margin-bottom:8px">
          ${FP.state.sources?.chartmetric && hooks.pullTour ? btn('data-pull-tour', 'Pull tour dates (Chartmetric)') : ''}
          ${btn('data-paste="tour"', 'Paste tour dates…')}
          <span class="hint">${d.tour_synced_at ? `Last pulled ${new Date(d.tour_synced_at).toLocaleString()}. ` : ''}${FP.state.sources?.chartmetric ? 'Announced shows are pulled from Songkick, Ticketmaster, SeatGeek and JamBase (via Chartmetric), and refreshed daily.' : 'Paste a list from an agent email, a spreadsheet or a website, one show per line.'}</span></div>
        ${tourTable()}`,
      recording: () => ta('data.recording', 4),
    };
    const TITLES = [['overview', 'Overview'], ['social', 'Social'], ['dsps', 'DSPs'], ['riyl', 'RIYL'], ['smart_links', 'Smart Links'], ['assets', 'Assets'],
      ['team', 'Team'], ['formats', 'Formats'], ['timeline', 'Timeline'], ['tracks', 'Tracklisting &amp; Credits'], ['marketing', 'Retail &amp; Digital Marketing'],
      ['playlists', 'Digital Playlisting'], ['press', 'Press'], ['radio', 'Radio'], ['syncs', 'Syncs'], ['tour', 'Tour Dates'], ['recording', 'Recording Details']];

    // Platform | link | followers | as of. Follower counts are saved to the artist profile too.
    function linkTable(group, list) {
      const fmtAsof = f => f?.asof ? `${f.source && f.source !== 'manual' ? f.source + ', ' : ''}${FP.fmtDate(f.asof, { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
      return `<div class="rep"><table><thead><tr><th style="width:130px">Platform</th><th>Link</th><th style="width:120px">Followers</th><th style="width:150px">As of</th></tr></thead><tbody>
        ${list.map(([k, l]) => { const f = d.followers[k]; return `<tr>
          <td style="padding:6px 4px"><b>${l}</b></td>
          <td><div style="display:flex;gap:4px;align-items:center">${inp(`data.${group}.${k}`, 'url', ' style="flex:1"')}<span data-open-for="data.${group}.${k}">${openLink(d[group][k])}</span></div></td>
          <td><input type="number" min="0" data-fk="${k}" value="${esc(f?.count ?? '')}"${dis} placeholder="—"></td>
          <td class="hint" data-asof="${k}">${fmtAsof(f)}</td></tr>`; }).join('')}
        </tbody></table></div>`;
    }

    // Tour rows: editable date/city/venue/notes, plus an Announced marker. Pulled
    // (public) shows are always announced; manual ones flip when a listing appears.
    function tourTable() {
      const rows = d.tour;
      return `<div class="rep"><table><thead><tr><th style="width:150px">Date</th><th>City</th><th>Venue</th><th>Notes</th><th style="width:150px">Status</th><th></th></tr></thead><tbody>
        ${rows.map((r, i) => {
          const a = `data-rep="tour" data-i="${i}"${dis}`;
          const status = r.cancelled ? '<span class="badge s-cancelled">Cancelled</span>'
            : r.source === 'chartmetric' ? '<span class="badge s-confirmed">Announced</span>'
            : `<label style="display:flex;gap:4px;align-items:center;white-space:nowrap"><input type="checkbox" data-tour-ann="${i}"${r.announced ? ' checked' : ''}${dis}> ${r.announced ? '<span class="badge s-confirmed">Announced</span>' : '<span class="badge s-planning">Not announced</span>'}</label>`;
          return `<tr${r.cancelled ? ' style="opacity:.6"' : ''}>
            <td><input type="date" ${a} data-k="date" value="${esc(r.date)}"></td>
            <td><input type="text" ${a} data-k="city" value="${esc(r.city)}"></td>
            <td><div style="display:flex;gap:4px;align-items:center"><input type="text" ${a} data-k="venue" value="${esc(r.venue)}" style="flex:1">${FP.safeUrl(r.ticket_url) ? `<a href="${esc(r.ticket_url)}" target="_blank" rel="noopener" title="Tickets">🎟</a>` : ''}</div></td>
            <td><input type="text" ${a} data-k="notes" value="${esc(r.notes)}"></td>
            <td>${status}</td>
            <td style="width:30px">${ro ? '' : `<button class="btn-ghost btn-sm" data-del="tour" data-i="${i}" title="Remove">✕</button>`}</td></tr>`;
        }).join('')}</tbody></table>${ro ? '' : '<button class="btn btn-sm add" data-add="tour">+ Add date</button>'}</div>
        ${rows.length ? `<p class="hint" style="margin-top:6px">${rows.filter(r => !r.announced && !r.cancelled).length} not announced · ${rows.filter(r => r.announced && !r.cancelled).length} announced${rows.some(r => r.cancelled) ? ` · ${rows.filter(r => r.cancelled).length} cancelled` : ''}</p>` : ''}`;
    }

    function rep(name) {
      const cfg = REPS[name], list = d[name];
      const cellInput = (row, i, [k, , kind]) => {
        const a = `data-rep="${name}" data-i="${i}" data-k="${k}"${dis}`;
        const ph = cfg.placeholder?.[k] ? ` placeholder="${esc(cfg.placeholder[k])}"` : '';
        if (kind === 'date') return `<input type="date" ${a} value="${esc(row[k])}">`;
        if (kind === 'url') return `<div style="display:flex;gap:4px;align-items:center"><input type="url" ${a} value="${esc(row[k])}" style="flex:1">${openLink(row[k])}</div>`;
        if (kind === 'dsp') return `<select ${a}>${FP.options(DSP_LABELS, row[k])}</select>`;
        if (kind === 'plstatus') return `<select ${a}>${FP.options(PL_STATUSES, row[k])}</select>`;
        if (kind === 'contacts') return `<input type="text" ${a} value="${esc(row[k])}" list="dl-contacts" autocomplete="off">`;
        if (kind === 'playlists') return `<input type="text" ${a} value="${esc(row[k])}" list="dl-playlists" autocomplete="off">`;
        if (kind?.startsWith('list:')) return `<select ${a}>${FP.options(FP.list(kind.slice(5)), row[k])}</select>`;
        return `<input type="text" ${a} value="${esc(row[k])}"${ph}>`;
      };
      if (cfg.hideEmpty && !list.length) return ro ? '' : `<button class="btn btn-sm" data-add="${name}">${cfg.addLabel}</button>`;
      return `<div class="rep" data-rep-box="${name}"><table>
        <thead><tr>${cfg.cols.map(c => `<th style="${COL_W[c[0]] || ''}">${c[1]}</th>`).join('')}<th></th></tr></thead>
        <tbody>${list.map((row, i) => `<tr>${cfg.cols.map(c => `<td>${cellInput(row, i, c)}</td>`).join('')}
          <td style="width:30px">${ro ? '' : `<button class="btn-ghost btn-sm" data-del="${name}" data-i="${i}" title="Remove">✕</button>`}</td></tr>`).join('')}</tbody>
        </table>${ro ? '' : `<button class="btn btn-sm add" data-add="${name}">${cfg.addLabel || `+ Add ${name === 'timeline' ? 'item' : 'row'}`}</button>`}</div>`;
    }

    // Format rows show up automatically (read-only); everything else is added by hand.
    function timelineHtml() {
      const auto = formatTimeline(proj).map(t => ({ ...t, auto: true }));
      const manual = d.timeline.map((t, i) => ({ ...t, i }));
      const all = [...auto, ...manual].sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
      return `<div class="rep"><table><thead><tr><th style="width:160px">Date</th><th>Item</th><th></th></tr></thead><tbody>
        ${all.map(t => t.auto
          ? `<tr><td style="padding:6px 4px" class="mono">${t.date ? FP.fmtDate(t.date) : '—'}</td><td style="padding:6px 4px">${esc(t.item)} <span class="badge">from Formats</span></td><td></td></tr>`
          : `<tr><td><input type="date" data-rep="timeline" data-i="${t.i}" data-k="date" value="${esc(t.date)}"${dis}></td>
              <td><input type="text" data-rep="timeline" data-i="${t.i}" data-k="item" value="${esc(t.item)}" placeholder="e.g. Album announce, Single 2, Video premiere"${dis}></td>
              <td style="width:30px">${ro ? '' : `<button class="btn-ghost btn-sm" data-del="timeline" data-i="${t.i}" title="Remove">✕</button>`}</td></tr>`).join('')}
        </tbody></table>${ro ? '' : '<button class="btn btn-sm add" data-add="timeline">+ Add item</button>'}</div>
        <div style="margin-top:10px">${FP.field('Notes', ta('data.timeline_notes', 2, 'Anything else about the campaign rollout'))}
          ${!ro && splitDatedLines(d.timeline_notes).dated.length ? `<p style="margin-top:6px"><button class="btn btn-sm" data-notes-to-timeline>Turn the ${splitDatedLines(d.timeline_notes).dated.length} dated note line(s) into timeline items</button></p>` : ''}</div>
        <p class="hint" style="margin-top:6px">Timeline items appear on the Release Schedule and its Google Calendar when you save. Internal deadlines (bio due, song pitching…) go in the <b>Internal Dates</b> tab.</p>`;
    }

    box.innerHTML = TITLES.map(([k, t]) => `<section class="form-section"><h3>${t}</h3><div class="fs-body" id="sec-${k}">${SECTIONS[k]()}</div></section>`).join('') +
      (d.imported && Object.keys(d.imported).length ? `<section class="form-section"><h3>Imported from AppSheet</h3><div class="fs-body"><div class="grid">${Object.entries(d.imported).map(([k, v]) => FP.field(k, `<div>${esc(v)}</div>`)).join('')}</div></div></section>` : '') +
      (proj.updated_at ? `<p class="hint">Last saved ${new Date(proj.updated_at).toLocaleString()} by ${esc(proj.updated_by || '')}</p>` : '');
    datalists();
    const refresh = k => { box.querySelector('#sec-' + k).innerHTML = SECTIONS[k](); };
    const refreshAll = () => TITLES.forEach(([k]) => refresh(k));
    const repSection = name => ({ social_extra: 'social', dsp_extra: 'dsps', smart_links: 'smart_links', team: 'team', formats: 'formats', timeline: 'timeline', tracks: 'tracks', playlists: 'playlists', tour: 'tour' })[name];
    const profileHint = () => {
      const el = box.querySelector('[data-profile-hint]');
      if (el) el.innerHTML = !ro && artistProfile(proj.artist) ? '<a href="#" data-fill-profile>Fill from artist profile</a> ·' : '';
    };
    profileHint();

    const fillProfile = (quiet) => {
      const prof = artistProfile(proj.artist);
      if (!prof) return;
      const filled = applyProfile(proj, prof);
      if (filled.length) { refreshAll(); profileHint(); onChange(); FP.toast(`Filled ${filled.join(', ')} from ${proj.artist}'s profile`); }
      else if (!quiet) FP.toast('Nothing to fill: those fields already have values');
    };

    box.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.p) {
        setPath(proj, t.dataset.p, t.value);
        const o = box.querySelector(`[data-open-for="${t.dataset.p}"]`);
        if (o) o.innerHTML = openLink(t.value);
        if (t.dataset.p === 'release_date') refresh('timeline');
        if (t.dataset.p === 'artist') profileHint();
        onChange();
      }
      if (t.dataset.fk) {
        const k = t.dataset.fk;
        if (t.value === '') delete d.followers[k];
        else d.followers[k] = { count: Number(t.value), asof: FP.today(), source: 'manual' };
        const a = box.querySelector(`[data-asof="${k}"]`); if (a) a.textContent = t.value === '' ? '' : FP.fmtDate(FP.today(), { month: 'short', day: 'numeric', year: 'numeric' });
        onChange();
      }
      if (t.dataset.rep) {
        d[t.dataset.rep][+t.dataset.i][t.dataset.k] = t.value;
        if (t.dataset.rep === 'formats') refresh('timeline');
        onChange();
      }
    });

    box.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.tourAnn !== undefined) { d.tour[+t.dataset.tourAnn].announced = t.checked; refresh('tour'); onChange(); return; }
      if (t.dataset.p === 'artist') fillProfile(true);
      // Picking a known contact fills the rest of their row.
      if (t.dataset.rep === 'team' && t.dataset.k === 'name') {
        const c = (FP.state.contacts || []).find(x => x.name.toLowerCase() === t.value.trim().toLowerCase());
        const row = d.team[+t.dataset.i];
        if (c) { for (const k of ['role', 'company', 'email', 'phone']) if (blank(row[k]) && c[k]) row[k] = c[k]; refresh('team'); onChange(); }
      }
      // Picking a saved playlist fills its link and service.
      if (t.dataset.rep === 'playlists' && t.dataset.k === 'name') {
        const row = d.playlists[+t.dataset.i];
        const lib = FP.state.playlists || [];
        const p = lib.find(x => x.name.toLowerCase() === t.value.trim().toLowerCase() && (!row.dsp || x.dsp === row.dsp))
          || lib.find(x => x.name.toLowerCase() === t.value.trim().toLowerCase());
        if (p) { if (blank(row.url)) row.url = p.url || ''; if (blank(row.dsp)) row.dsp = p.dsp || ''; refresh('playlists'); onChange(); }
      }
    });

    box.addEventListener('click', async e => {
      const t = e.target;
      const add = t.closest('[data-add]'), del = t.closest('[data-del]');
      if (add) {
        const name = add.dataset.add, row = {};
        if (REPS[name].keyed) row.key = crypto.randomUUID().slice(0, 8);
        if (name === 'playlists') row.status = 'Target';
        if (name === 'tour') { row.announced = false; row.source = 'manual'; }
        d[name].push(row);
        refresh(repSection(name));
        const inputs = box.querySelectorAll(`[data-rep="${name}"][data-i="${d[name].length - 1}"]`);
        (name === 'timeline' ? inputs[0] : [...inputs].find(i => i.tagName === 'INPUT'))?.focus();
        onChange();
      }
      if (del) {
        d[del.dataset.del].splice(+del.dataset.i, 1);
        refresh(repSection(del.dataset.del));
        if (del.dataset.del === 'formats') refresh('timeline');
        onChange();
      }
      if (t.matches('[data-fill-profile]')) { e.preventDefault(); fillProfile(false); }
      if (t.matches('[data-lookup]')) { e.preventDefault(); lookupOnline(); }
      if (t.matches('[data-pull-tour]')) { t.disabled = true; try { await hooks.pullTour(); } finally { t.disabled = false; } }
      if (t.matches('[data-refresh-followers]')) {
        if (!d.social.youtube && !d.dsp_links.spotify) return FP.toast('Add the YouTube channel and/or Spotify artist link first', true);
        t.disabled = true;
        try {
          const r = await FP.post('/api/followers', { youtube: d.social.youtube || null, spotify: d.dsp_links.spotify || null, chartmetric_id: d.chartmetric_id || null });
          Object.assign(d.followers, r.counts);
          if (r.chartmetric_id) d.chartmetric_id = r.chartmetric_id;
          refresh('social'); refresh('dsps'); onChange();
          const name = k => ({ youtube: 'YouTube', spotify: 'Spotify', chartmetric: 'Chartmetric' })[k] || k;
          const got = Object.keys(r.counts), bad = Object.entries(r.errors);
          FP.toast([got.length && (r.source === 'Chartmetric' ? `Updated ${got.length} counts from Chartmetric. Save to keep.` : `Updated ${got.map(name).join(' and ')}. Save to keep.`),
            ...bad.map(([k, m]) => `${name(k)}: ${m}`)].filter(Boolean).join(' · ') || 'Nothing to update', !got.length);
        } catch (err) { FP.toast(err.message, true); }
        finally { t.disabled = false; }
      }
      if (t.matches('[data-notes-to-timeline]')) {
        const { dated, other } = splitDatedLines(d.timeline_notes);
        if (!confirm(`Add ${dated.length} item(s) to the timeline? They'll also appear on the Release Schedule when you save:\n\n${dated.map(x => `${FP.fmtDate(x.date)} — ${x.item}`).join('\n')}`)) return;
        for (const x of dated) d.timeline.push({ key: crypto.randomUUID().slice(0, 8), ...x });
        d.timeline_notes = other.join('\n');
        refresh('timeline'); onChange();
        FP.toast('Added to the timeline. Save to keep it.');
      }
      if (t.matches('[data-copy]')) {
        const tracks = d.tracks.filter(x => x.song);
        if (!tracks.length) return FP.toast('Add some tracks first', true);
        const text = t.dataset.copy === 'tracklist'
          ? tracks.map((x, i) => `${x.vol ? x.vol : ''}${x.num || i + 1}. ${x.song}${x.length ? ` (${x.length})` : ''}`).join('\n')
          : [REPS.tracks.cols.map(c => c[1]), ...tracks.map(x => REPS.tracks.cols.map(c => x[c[0]] || ''))].map(r => r.join('\t')).join('\n');
        try { await navigator.clipboard.writeText(text); FP.toast(t.dataset.copy === 'tracklist' ? 'Tracklist copied' : 'Tracklist with credits copied'); }
        catch { FP.toast('Your browser blocked the clipboard', true); }
      }
      if (t.matches('[data-paste="tracks"]')) pasteTracks();
      if (t.matches('[data-paste="tour"]')) pasteTour();
      if (t.matches('[data-dbx]')) {
        e.preventDefault();
        try {
          const [f] = await chooseFromDropbox({ multiselect: false });
          if (f) { setPath(proj, t.dataset.dbx, f.link); refresh('assets'); onChange(); }
        } catch (err) { FP.toast(err.message, true); }
      }
      if (t.matches('[data-dbx-multi]')) {
        try { const files = await chooseFromDropbox({ multiselect: true }); if (files.length) mapDropboxFiles(files); }
        catch (err) { FP.toast(err.message, true); }
      }
    });

    // Search Chartmetric (or MusicBrainz as a fallback), pick the right artist,
    // then choose which found values to use. Nothing already filled is overwritten unless ticked.
    async function lookupOnline() {
      const FIELDS = [['website', 'Official website'], ['hometown', 'Hometown'], ['genre', 'Genre'], ['riyl', 'RIYL'],
        ...SOCIALS.map(([k, l]) => ['social.' + k, l]), ...DSPS.map(([k, l]) => ['dsp_links.' + k, l])];
      const FOLLOWER_LABELS = { ...Object.fromEntries([...SOCIALS, ...DSPS].map(([k, l]) => [k, l + ' followers'])), youtube: 'YouTube subscribers', facebook: 'Facebook likes', spotify_listeners: 'Spotify monthly listeners', deezer: 'Deezer fans' };
      const cmOn = !!FP.state.sources?.chartmetric;
      let source = cmOn ? 'chartmetric' : 'musicbrainz';
      const m = FP.modal({
        title: 'Look up artist online', wide: true,
        body: `<div class="toolbar"><input type="search" id="lu-q" value="${esc(proj.artist)}" style="flex:1" placeholder="Artist name or Spotify link"><button class="btn" id="lu-go">Search</button></div>
          <div id="lu-out" style="margin-top:12px"></div>`,
      });
      const out = m.el.querySelector('#lu-out');
      const fmtN = n => n == null ? '' : Number(n).toLocaleString('en-US');
      const fallback = () => cmOn && source === 'chartmetric' ? '<p style="margin-top:8px"><button class="btn btn-sm" data-fallback>Search MusicBrainz instead</button></p>' : '';

      const search = async () => {
        const q = m.el.querySelector('#lu-q').value;
        out.innerHTML = `<p class="hint">Searching ${source === 'chartmetric' ? 'Chartmetric' : 'MusicBrainz'}…</p>`;
        try {
          if (source === 'chartmetric') {
            const hits = await FP.get('/api/chartmetric/search?q=' + encodeURIComponent(q));
            out.innerHTML = hits.length ? `<p class="hint" style="margin-bottom:6px">Pick the right artist (Chartmetric):</p>${hits.map(h => `
              <button class="card" data-pick="${h.id}" data-name="${esc(h.name)}" style="width:100%;text-align:left;margin-bottom:6px;flex-direction:row;align-items:center;gap:10px">
                ${FP.safeUrl(h.image_url) ? `<img src="${esc(h.image_url)}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover">` : ''}
                <b>${esc(h.name)}</b><span class="hint">${[h.sp_monthly_listeners != null && fmtN(h.sp_monthly_listeners) + ' monthly listeners', h.sp_followers != null && fmtN(h.sp_followers) + ' Spotify followers'].filter(Boolean).join(' · ')}</span>
              </button>`).join('')}${fallback()}`
              : `<p>No Chartmetric matches. Try a different spelling, or paste the artist's Spotify link.</p>${fallback()}`;
          } else {
            const hits = await FP.get('/api/lookup/artist?q=' + encodeURIComponent(q));
            out.innerHTML = hits.length ? `<p class="hint" style="margin-bottom:6px">Pick the right artist (MusicBrainz):</p>${hits.map(h => `
              <button class="card" data-pick="${h.id}" data-name="${esc(h.name)}" style="width:100%;text-align:left;margin-bottom:6px;flex-direction:row;align-items:center;gap:10px">
                <b>${esc(h.name)}</b><span class="hint">${esc([h.disambiguation, h.type, h.area || h.country].filter(Boolean).join(' · '))}</span>
                <span class="spacer"></span><span class="badge">${h.score}% match</span></button>`).join('')}`
              : '<p>No matches. Try a different spelling.</p>';
          }
        } catch (err) { out.innerHTML = `<p style="color:var(--red)">${esc(err.message)}</p>${fallback()}`; }
      };
      m.el.querySelector('#lu-go').onclick = search;
      m.el.querySelector('#lu-q').onkeydown = e => { if (e.key === 'Enter') search(); };

      out.addEventListener('click', async e => {
        if (e.target.closest('[data-fallback]')) { source = 'musicbrainz'; return search(); }
        const c = e.target.closest('[data-pick]');
        if (!c) return;
        out.innerHTML = '<p class="hint">Loading details…</p>';
        try {
          const r = source === 'chartmetric'
            ? await FP.get(`/api/chartmetric/artist/${c.dataset.pick}`)
            : await FP.get(`/api/lookup/artist/${c.dataset.pick}?name=${encodeURIComponent(c.dataset.name)}`);
          const found = FIELDS.map(([k, l]) => ({ k, l, v: getPath(r, k), cur: getPath(d, k) })).filter(x => !blank(x.v));
          const counts = Object.entries(r.followers || {}).map(([k, f]) => ({ k, l: FOLLOWER_LABELS[k] || k, f, cur: d.followers[k] }));
          const extras = (r.social_extra || []).filter(x => !d.social_extra.some(y => y.url === x.url));
          if (!found.length && !extras.length && !counts.length) { out.innerHTML = `<p>${esc(r.source)} has this artist but no links or details for them yet.</p>${fallback()}`; return; }
          const valueCell = v => `<td style="word-break:break-all">${FP.safeUrl(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v)}</td>`;
          out.innerHTML = `<p class="hint" style="margin-bottom:8px">Found on ${esc(r.source)}. Ticked values will be used. Fields you've already filled are unticked so nothing is overwritten by accident.</p>
            <div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:30px"></th><th>Field</th><th>Found</th><th>Currently</th></tr></thead><tbody>
            ${found.map((x, i) => `<tr><td><input type="checkbox" data-i="${i}"${blank(x.cur) || x.cur === x.v ? ' checked' : ''}></td><td>${x.l}</td>${valueCell(x.v)}
              <td style="word-break:break-all;color:var(--text-muted)">${esc(x.cur || '—')}</td></tr>`).join('')}
            ${counts.map((x, i) => `<tr><td><input type="checkbox" data-c="${i}" checked></td><td>${esc(x.l)}</td><td>${fmtN(x.f.count)}</td>
              <td style="color:var(--text-muted)">${x.cur ? fmtN(x.cur.count) + (x.cur.asof ? ' (' + FP.fmtDate(x.cur.asof) + ')' : '') : '—'}</td></tr>`).join('')}
            ${extras.map((x, i) => `<tr><td><input type="checkbox" data-x="${i}" checked></td><td>${esc(x.label)} (extra social)</td><td style="word-break:break-all">${esc(x.url)}</td><td>—</td></tr>`).join('')}
            </tbody></table></div>
            <p style="margin-top:12px"><button class="btn-primary" id="lu-apply">Use ticked values</button></p>`;
          out.querySelector('#lu-apply').onclick = () => {
            let n = 0;
            out.querySelectorAll('[data-i]:checked').forEach(cb => { const x = found[+cb.dataset.i]; if (x.cur !== x.v) { setPath(d, x.k, x.v); n++; } });
            out.querySelectorAll('[data-c]:checked').forEach(cb => { const x = counts[+cb.dataset.c]; d.followers[x.k] = { ...x.f }; n++; });
            out.querySelectorAll('[data-x]:checked').forEach(cb => { d.social_extra.push({ ...extras[+cb.dataset.x] }); n++; });
            if (r.chartmetric_id) d.chartmetric_id = r.chartmetric_id;
            refreshAll(); profileHint(); onChange(); m.close();
            FP.toast(n ? `Filled ${n} field${n === 1 ? '' : 's'}. Save to keep them.` : 'Nothing changed');
          };
        } catch (err) { out.innerHTML = `<p style="color:var(--red)">${esc(err.message)}</p>${fallback()}`; }
      });
      if (proj.artist) search();
      else out.innerHTML = `<p class="hint">Searches ${cmOn ? 'Chartmetric' : 'MusicBrainz, a free open music database'}.</p>`;
    }

    function pasteTracks() {
      const m = FP.modal({
        title: 'Paste tracklist', wide: true, saveLabel: 'Use these tracks',
        body: `<p class="hint" style="margin-bottom:8px">Paste a plain tracklist (“1. Song Title 3:21”, “A1 Song”), or rows copied from a spreadsheet. A header row (Song, ISRC, Length, Writers, Publishers…) is used if present. Without one, ISRCs and lengths are spotted automatically.</p>
          <textarea id="pt-text" rows="10" style="font-family:var(--mono);font-size:12px"></textarea>
          ${d.tracks.some(x => x.song) ? `<div style="margin-top:8px;display:flex;gap:14px"><label><input type="radio" name="pt-mode" value="merge" checked> Update matching songs and add new ones</label><label><input type="radio" name="pt-mode" value="replace"> Replace all tracks</label></div>` : ''}
          <div id="pt-prev" style="margin-top:10px"></div>`,
        onSave: el => {
          const rows = parseTracks(el.querySelector('#pt-text').value);
          if (!rows.length) throw new Error('No tracks found in what you pasted');
          const mode = el.querySelector('[name=pt-mode]:checked')?.value || 'replace';
          if (mode === 'replace') d.tracks = rows;
          else for (const r of rows) {
            const hit = d.tracks.find(x => String(x.song || '').toLowerCase() === r.song.toLowerCase());
            if (hit) { for (const [k, v] of Object.entries(r)) if (v) hit[k] = v; } else d.tracks.push(r);
          }
          refresh('tracks'); onChange();
          FP.toast(`${rows.length} track${rows.length === 1 ? '' : 's'} added`);
        },
      });
      const prev = () => {
        const rows = parseTracks(m.el.querySelector('#pt-text').value);
        m.el.querySelector('#pt-prev').innerHTML = rows.length ? previewTable(REPS.tracks.cols, rows) : '';
      };
      m.el.querySelector('#pt-text').addEventListener('input', prev);
    }

    function pasteTour() {
      const m = FP.modal({
        title: 'Paste tour dates', wide: true, saveLabel: 'Add these dates',
        body: `<p class="hint" style="margin-bottom:8px">One show per line, starting with the date. For example:<br><span class="mono">Mar 14 - Nashville, TN - The Basement East</span><br><span class="mono">3/15/27 Atlanta, GA @ Terminal West</span><br><span class="mono">Fri, April 2 | London, UK | Lafayette</span></p>
          <textarea id="pt-text" rows="10" style="font-family:var(--mono);font-size:12px"></textarea>
          <label style="display:block;margin-top:8px"><input type="checkbox" id="pt-ann"> These dates are already announced publicly</label>
          <div id="pt-prev" style="margin-top:10px"></div>`,
        onSave: el => {
          const ann = el.querySelector('#pt-ann').checked;
          const rows = parseTour(el.querySelector('#pt-text').value).filter(r => !r.error).map(r => ({ ...r, key: crypto.randomUUID().slice(0, 8), source: 'manual', announced: ann }));
          if (!rows.length) throw new Error('No dates found. Each line needs to start with a date.');
          const seen = new Set(d.tour.map(t => t.date + '|' + String(t.city || '').toLowerCase()));
          let added = 0;
          for (const r of rows) { if (seen.has(r.date + '|' + r.city.toLowerCase())) continue; d.tour.push(r); added++; }
          d.tour.sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9')));
          refresh('tour'); onChange();
          FP.toast(`Added ${added} show${added === 1 ? '' : 's'}${rows.length - added ? ` (${rows.length - added} already listed)` : ''}`);
        },
      });
      m.el.querySelector('#pt-text').addEventListener('input', () => {
        const rows = parseTour(m.el.querySelector('#pt-text').value);
        const bad = rows.filter(r => r.error);
        m.el.querySelector('#pt-prev').innerHTML = (rows.length - bad.length ? previewTable(REPS.tour.cols, rows.filter(r => !r.error).map(r => ({ ...r, date: FP.fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }))) : '') +
          (bad.length ? `<p style="color:var(--yellow);margin-top:6px">Couldn't find a date on ${bad.length} line${bad.length === 1 ? '' : 's'}: ${bad.slice(0, 3).map(b => `<span class="mono">${esc(b.error.slice(0, 40))}</span>`).join(', ')}</p>` : '');
      });
    }

    function mapDropboxFiles(files) {
      const slots = [['folder', 'Project assets folder'], ...ASSETS.map(([k, l]) => [k, l])];
      const guess = f => f.isDir && !ASSETS.some(([, , re]) => re.test(f.name)) ? 'folder' : (ASSETS.find(([, , re]) => re.test(f.name))?.[0] || '');
      FP.modal({
        title: 'Match Dropbox files', saveLabel: 'Add links',
        body: `<div class="tbl-wrap"><table class="tbl edit"><thead><tr><th>File</th><th style="width:200px">Use as</th></tr></thead><tbody>
          ${files.map((f, i) => `<tr><td style="padding:6px 10px">${f.isDir ? '📁' : '📄'} ${esc(f.name)}</td>
            <td><select data-f="${i}"><option value="">— skip —</option>${slots.map(([k, l]) => `<option value="${k}"${guess(f) === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td></tr>`).join('')}
          </tbody></table></div>`,
        onSave: el => {
          let n = 0;
          el.querySelectorAll('[data-f]').forEach(s => { if (s.value) { d.assets[s.value] = files[+s.dataset.f].link; n++; } });
          refresh('assets'); onChange();
          FP.toast(`Added ${n} link${n === 1 ? '' : 's'}`);
        },
      });
    }
  }

  function previewTable(cols, rows) {
    return `<div class="tbl-wrap" style="max-height:260px"><table class="tbl"><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c[0]] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="hint" style="margin-top:4px">${rows.length} found</p>`;
  }

  function datalists() {
    const make = (id, html) => {
      let dl = document.getElementById(id);
      if (!dl) { dl = document.createElement('datalist'); dl.id = id; document.body.appendChild(dl); }
      dl.innerHTML = html;
    };
    make('dl-contacts', (FP.state.contacts || []).map(c => `<option value="${esc(c.name)}">${esc([c.role, c.company].filter(Boolean).join(', '))}</option>`).join(''));
    make('dl-playlists', (FP.state.playlists || []).map(p => `<option value="${esc(p.name)}">${esc(p.dsp || '')}</option>`).join(''));
  }

  function formatTimeline(proj) {
    const fs = (proj.data.formats || []).filter(f => f.format || f.title);
    if (!fs.length) return proj.release_date ? [{ date: proj.release_date, item: 'Release date' }] : [];
    return fs.map(f => ({ date: f.release_date || proj.release_date || '', item: `${f.format || 'Release'}${f.title && f.title !== proj.title ? ` — ${f.title}` : ''} release` }));
  }

  // ── GOOGLE DOC LAYOUT ──────────────────────────────────────
  // Google converts this HTML into a Doc. Things it handles well: h1/h2 (they
  // become real headings in the doc outline), tables with cell shading, lists.
  // Things to avoid: borders on headings (they turn into stray rule lines that
  // also break the next list) and margin-less paragraphs.
  // Empty fields, sections and table columns are left out entirely.
  function buildDocHtml(p) {
    const d = normalize(p.data);
    const C = { ink: '#1c1a16', muted: '#7a7468', accent: '#b83228', line: '#d9d5cc', shade: '#f3f1ec' };
    const has = v => !blank(v);
    const txt = v => esc(v || '').replace(/\n/g, '<br>');
    const linkify = v => txt(v).replace(/(https?:\/\/[^\s<]+)/g, u => `<a href="${u}">${shortUrl(u)}</a>`);
    const a = (url, label) => FP.safeUrl(url) ? `<a href="${esc(url)}">${esc(label || shortUrl(url))}</a>` : esc(url || '');
    const P = 'margin:0 0 6pt 0;line-height:1.4';
    const para = html => `<p style="${P}">${html}</p>`;
    const h2 = t => `<h2 style="font-size:14pt;color:${C.accent};margin:20pt 0 6pt 0;font-weight:bold">${t}</h2>`;
    const cell = (html, head) => `<td style="border:1px solid ${C.line};padding:5pt 7pt;vertical-align:top;${head ? `background:${C.shade};font-weight:bold;` : ''}">${html}</td>`;
    // Two-column "label | value" table, skipping empty rows.
    const facts = rows => {
      const r = rows.filter(([, v]) => has(String(v ?? '').replace(/<[^>]+>/g, '')));
      return r.length ? `<table style="border-collapse:collapse;width:100%">${r.map(([l, v]) => `<tr>${cell(esc(l), true).replace('vertical-align:top;', 'vertical-align:top;width:30%;')}${cell(v)}</tr>`).join('')}</table>` : '';
    };
    // Grid table; columns with no data in any row are dropped.
    const grid = (cols, rows) => {
      rows = rows.filter(r => cols.some(([k]) => has(r[k])));
      const keep = cols.filter(([k]) => rows.some(r => has(r[k])));
      if (!rows.length) return '';
      return `<table style="border-collapse:collapse;width:100%"><tr>${keep.map(([, l]) => cell(esc(l), true)).join('')}</tr>
        ${rows.map(r => `<tr>${keep.map(([k, , fmt]) => cell(fmt ? fmt(r[k], r) : linkify(r[k]))).join('')}</tr>`).join('')}</table>`;
    };
    const section = (title, body) => body ? h2(title) + body : '';

    // Platform rows: the platform name is the link; follower counts alongside when known.
    const platRows = (list, group, extra) => [...list.map(([k, l]) => ({ name: l, url: d[group][k], f: d.followers[k] })), ...extra.map(x => ({ name: x.label || 'Link', url: x.url }))]
      .filter(r => has(r.url)).map(r => ({ name: r.name, url: r.url, count: r.f?.count != null && r.f.count !== '' ? Number(r.f.count).toLocaleString('en-US') : '', asof: r.f?.asof ? FP.fmtDate(r.f.asof) : '' }));
    const socials = platRows(SOCIALS, 'social', d.social_extra), dsps = platRows(DSPS, 'dsp_links', d.dsp_extra);
    const platGrid = rows => grid([['name', 'Platform', (v, r) => `<b>${a(r.url, v)}</b>`], ['count', 'Followers'], ['asof', 'As of']], rows);
    // Inline list of named links: "Biography · Press Photos · Album Art"
    const named = pairs => { const l = pairs.filter(([, u]) => FP.safeUrl(u)); return l.length ? para(l.map(([n, u]) => a(u, n)).join('&nbsp;&nbsp;·&nbsp;&nbsp;')) : ''; };
    const assets = [['Project folder', d.assets.folder], ...ASSETS.map(([k, l]) => [l, d.assets[k]])].filter(([, u]) => has(u));
    const notes = splitDatedLines(d.timeline_notes);
    const timeline = [...formatTimeline(p), ...d.timeline.filter(t => has(t.item)), ...notes.dated].sort((x, y) => String(x.date || '9').localeCompare(String(y.date || '9')));
    const tracks = d.tracks.filter(t => has(t.song));
    const sameTitle = d.formats.every(f => !has(f.title) || f.title === p.title);
    const press = [['Quotes', d.press_quotes], ['Links', d.press_links], ['Previous press', d.press_previous]].filter(([, v]) => has(v));
    const updated = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    return `<html><body style="font-family:Arial;font-size:11pt;color:${C.ink}">
      <p style="margin:0;font-size:9pt;color:${C.muted};letter-spacing:1pt">FAT POSSUM RECORDS · PROJECT DOCUMENT</p>
      <h1 style="font-size:24pt;margin:4pt 0 0 0;font-weight:bold">${esc(p.name || p.title)}</h1>
      <p style="margin:2pt 0 14pt 0;font-size:15pt;color:${C.muted}">${esc(p.artist)}</p>
      ${facts([
        ...(has(p.name) && p.name !== p.title ? [['Title', esc(p.title)]] : []), ['Release date', esc(FP.fmtDate(p.release_date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))],
        ['Label', esc(p.label)], ['Catalog #', esc(p.catalog)], ['Territory', esc(p.territory)], ['Status', esc(p.status)],
        ['Project manager', esc(p.pm)], ['Genre', esc(d.genre)], ['Hometown', esc(d.hometown)], ['Official website', a(d.website)],
      ])}
      ${section('Social', platGrid(socials))}
      ${section('DSPs', platGrid(dsps) + (d.followers.spotify_listeners?.count != null ? para(`<b>Spotify monthly listeners:</b> ${Number(d.followers.spotify_listeners.count).toLocaleString('en-US')} <span style="color:${C.muted}">(as of ${esc(FP.fmtDate(d.followers.spotify_listeners.asof))})</span>`) : ''))}
      ${section('RIYL', has(d.riyl) ? para(txt(d.riyl)) : '')}
      ${section('Smart Links', named(d.smart_links.map(x => [x.label || 'Smart link', x.url])))}
      ${section('Assets', named(assets))}
      ${section('Team', grid([['role', 'Role'], ['name', 'Name'], ['company', 'Company'], ['email', 'Email', v => v ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : ''], ['phone', 'Phone']], d.team))}
      ${section('Formats', grid([['format', 'Format'], ...(sameTitle ? [] : [['title', 'Title']]), ['catalog', 'Cat #'], ['upc', 'UPC'], ['release_date', 'Release date', v => esc(FP.fmtDate(v))]],
        d.formats.map(f => ({ ...f, title: f.title || p.title, release_date: f.release_date || p.release_date }))))}
      ${section('Timeline', (timeline.length ? grid([['date', 'Date', v => `<b>${v ? esc(FP.fmtDate(v)) : 'TBD'}</b>`], ['item', 'What']], timeline) : '')
        + (notes.other.length ? `<p style="margin:10pt 0 4pt 0;font-weight:bold">Notes</p>` + para(linkify(notes.other.join('\n'))) : ''))}
      ${section('Tracklisting &amp; Credits', grid([['vol', 'Vol'], ['num', '#'], ['song', 'Song', v => `<b>${esc(v)}</b>`], ['length', 'Length'], ['isrc', 'ISRC'], ['writers', 'Writers'], ['publishers', 'Publishers']],
        tracks.map((t, i) => ({ ...t, num: t.num || String(i + 1) }))))}
      ${section('Retail &amp; Digital Marketing', facts([['Retail', linkify(d.retail)], ['Digital', linkify(d.digital)]]))}
      ${section('Digital Playlisting', grid([['dsp', 'DSP'], ['name', 'Playlist', (v, r) => FP.safeUrl(r.url) ? `<a href="${esc(r.url)}">${esc(v)}</a>` : esc(v)], ['status', 'Status'], ['notes', 'Notes']], d.playlists.filter(x => has(x.name))))}
      ${section('Press', facts(press.map(([l, v]) => [l, linkify(v)])))}
      ${section('Radio', has(d.radio) ? para(linkify(d.radio)) : '')}
      ${section('Syncs', has(d.syncs) ? para(linkify(d.syncs)) : '')}
      ${section('Tour Dates', grid([['date', 'Date', v => esc(FP.fmtDate(v, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))], ['city', 'City'],
        ['venue', 'Venue', (v, r) => FP.safeUrl(r.ticket_url) ? `<a href="${esc(r.ticket_url)}">${esc(v || 'Tickets')}</a>` : esc(v)], ['notes', 'Notes'],
        ['status', 'Status', v => v === 'Not announced' ? `<b style="color:${C.accent}">Not announced</b>` : esc(v)]],
        d.tour.map(t => ({ ...t, status: t.cancelled ? 'Cancelled' : t.announced ? 'Announced' : 'Not announced' }))))}
      ${section('Recording Details', has(d.recording) ? para(linkify(d.recording)) : '')}
      <p style="margin:28pt 0 0 0;font-size:8pt;color:${C.muted}">Updated ${updated} from the Fat Possum project system. To change anything, edit the project in the app and click “Update Google Doc”. Edits made directly in this document are replaced on the next update.</p>
    </body></html>`;
  }

  // Readable link text: Dropbox files show their file name, everything else
  // shows the address without https://, www. or tracking parameters.
  function shortUrl(u) {
    try {
      const url = new URL(u);
      const host = url.hostname.replace(/^www\./, '');
      if (/dropbox\.com$/.test(host)) {
        if (url.pathname.includes('/fo/')) return 'Dropbox folder';
        const file = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
        return file ? `${file} (Dropbox)` : 'Dropbox link';
      }
      const path = url.pathname.replace(/\/+$/, '');
      const s = host + (path.length > 1 ? path : '');
      return s.length > 60 ? s.slice(0, 57) + '…' : s;
    } catch { return u; }
  }

  FP.chooseFromDropbox = chooseFromDropbox;
  FP.preloadDropbox = () => { if (FP.state.settings.dropbox_app_key) loadDropbox().catch(() => {}); };
  FP.projectInfo = { render, normalize, blankData, buildDocHtml, artistProfile, applyProfile, parseTracks, parseTour };
})();
