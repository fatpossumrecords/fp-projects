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

  // Follower change: Chartmetric's 30-day diff when we have it, otherwise the
  // change since the previous count someone typed in.
  function growth(f) {
    if (!f || f.count == null || f.count === '') return null;
    if (f.month != null) return { diff: Number(f.month), pct: f.month_pct != null ? Number(f.month_pct) : null, span: '30 days' };
    if (f.prev?.count != null && f.prev.asof) {
      const diff = Number(f.count) - Number(f.prev.count);
      return { diff, pct: Number(f.prev.count) ? diff / Number(f.prev.count) * 100 : null, span: 'since ' + FP.fmtDate(f.prev.asof, { month: 'short', day: 'numeric' }) };
    }
    return null;
  }
  function growthText(g, { withSpan = true } = {}) {
    if (!g) return '';
    const n = Math.abs(g.diff), short = n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(Math.round(n));
    return `${g.diff > 0 ? '+' : g.diff < 0 ? '−' : '±'}${short}${g.pct != null ? ` (${g.diff >= 0 ? '+' : '−'}${Math.abs(g.pct).toFixed(1)}%)` : ''}${withSpan ? ' ' + g.span : ''}`;
  }

  function blankData() {
    return { press_sections: [], social: {}, dsp_links: {}, followers: {}, assets: {}, social_extra: [], dsp_extra: [], smart_links: [], team: [], formats: [], timeline: [], tracks: [], playlists: [], tour: [] };
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
    // Press links used to be a text box; each line becomes a coverage entry.
    if (d.press_links && !(Array.isArray(d.press) && d.press.length)) {
      d.press = String(d.press_links).split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/(https?:\/\/\S+)/);
        const rest = m ? l.replace(m[1], '').replace(/[-–:|]\s*$|^\s*[-–:|]/g, '').trim() : l;
        let outlet = rest;
        if (!outlet && m) { try { outlet = new URL(m[1]).hostname.replace(/^www\./, ''); } catch { /* keep blank */ } }
        return { campaign: '', single: '', outlet, url: m ? m[1] : '', notes: '' };
      });
    }
    delete d.press_links;
    // A flat coverage list (previous version) becomes sections grouped by what it was for.
    if (!Array.isArray(d.press_sections)) d.press_sections = [];
    if (Array.isArray(d.press) && d.press.length && !d.press_sections.length) {
      for (const x of d.press) {
        const type = ['Single', 'Album', 'Tour'].includes(x.campaign) ? x.campaign : 'Other';
        const name = type === 'Single' ? (x.single || '') : '';
        let sec = d.press_sections.find(sc => sc.type === type && sc.name === name);
        if (!sec) d.press_sections.push(sec = { key: crypto.randomUUID().slice(0, 8), type, name, items: [] });
        sec.items.push({ outlet: x.outlet || '', url: x.url || '', notes: x.notes || '' });
      }
    }
    delete d.press;
    for (const sc of d.press_sections) { if (!sc.key) sc.key = crypto.randomUUID().slice(0, 8); if (!Array.isArray(sc.items)) sc.items = []; }
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

  // Publication names for common music press, by web address. Anything else uses the
  // page's own site name, the text pasted beside the link, or a tidied domain.
  const OUTLETS = { 'pitchfork.com': 'Pitchfork', 'stereogum.com': 'Stereogum', 'nme.com': 'NME', 'rollingstone.com': 'Rolling Stone', 'brooklynvegan.com': 'BrooklynVegan',
    'consequence.net': 'Consequence', 'theguardian.com': 'The Guardian', 'nytimes.com': 'The New York Times', 'npr.org': 'NPR', 'uncut.co.uk': 'Uncut', 'mojo4music.com': 'MOJO',
    'thefader.com': 'The FADER', 'pastemagazine.com': 'Paste', 'uproxx.com': 'Uproxx', 'spin.com': 'SPIN', 'billboard.com': 'Billboard', 'floodmagazine.com': 'FLOOD',
    'gorillavsbear.net': 'Gorilla vs. Bear', 'thelineofbestfit.com': 'The Line of Best Fit', 'clashmusic.com': 'Clash', 'loudandquiet.com': 'Loud And Quiet',
    'daily.bandcamp.com': 'Bandcamp Daily', 'kexp.org': 'KEXP', 'wfuv.org': 'WFUV', 'kcrw.com': 'KCRW', 'aquariumdrunkard.com': 'Aquarium Drunkard',
    'undertheradarmag.com': 'Under the Radar', 'exclaim.ca': 'Exclaim!', 'thequietus.com': 'The Quietus', 'popmatters.com': 'PopMatters', 'vulture.com': 'Vulture',
    'newyorker.com': 'The New Yorker', 'latimes.com': 'Los Angeles Times', 'washingtonpost.com': 'The Washington Post', 'bbc.co.uk': 'BBC', 'americansongwriter.com': 'American Songwriter',
    'nodepression.com': 'No Depression', 'glidemagazine.com': 'Glide Magazine', 'relix.com': 'Relix', 'magnetmagazine.com': 'MAGNET', 'treblezine.com': 'Treble',
    'gq.com': 'GQ', 'vogue.com': 'Vogue', 'interviewmagazine.com': 'Interview', 'dazeddigital.com': 'Dazed', 'iheart.com': 'iHeart', 'atwoodmagazine.com': 'Atwood Magazine',
    'thewild-honeypie.com': 'The Wild Honey Pie', 'bandsintown.com': 'Bandsintown', 'wonderlandmagazine.com': 'Wonderland', 'crack-magazine.com': 'Crack Magazine' };
  function outletName(url, site, text) {
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* not a URL */ }
    const known = OUTLETS[host] || OUTLETS[host.split('.').slice(-2).join('.')];
    if (known) return known;
    if (site && site.length < 60) return site;
    if (text && text.length < 60 && !/https?:/.test(text)) return text;
    const base = host.split('.').slice(-2, -1)[0] || host;
    return base.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
      onesheet: () => `<div class="grid">
        ${FP.field('About this release', ta('data.about', 5, 'The short pitch: what this record is and why it matters. This leads the first page of the Google Doc.'), 'wide')}
        ${FP.field('Selling points', ta('data.selling_points', 4, 'One per line, e.g.\nFirst album in five years\nProduced by …\nNorth American tour in March'), 'wide')}
        ${FP.field('Focus tracks', inp('data.focus_tracks', 'text', ' placeholder="e.g. Bird Songs For Atomic Skies, Eleven Saints"'), 'wide')}
      </div><p class="hint" style="margin-top:6px">These make up the one-sheet on page 1 of the Google Doc, with RIYL, press quotes, formats, tracklist and tour dates.</p>`,
      social: () => `${linkTable('social', SOCIALS)}<div style="margin-top:10px">${rep('social_extra')}</div>
        ${ro ? '' : FP.state.sources?.chartmetric
          ? `<p style="margin-top:10px"><button class="btn btn-sm" data-refresh-followers>Update follower counts from Chartmetric</button> <span class="hint">${d.chartmetric_id ? 'Linked to Chartmetric.' : 'Uses the Spotify link to find the artist, or run “Look up online” first.'}</span></p>`
          : `<p style="margin-top:10px"><button class="btn btn-sm" data-refresh-followers>Update YouTube &amp; Spotify counts</button> <span class="hint">Instagram, TikTok, Facebook and X don't share counts with other apps, so type those in.</span></p>`}`,
      dsps: () => `${linkTable('dsp_links', DSPS)}<div style="margin-top:10px">${rep('dsp_extra')}</div><p class="hint" style="margin-top:6px">Artist profile pages on each service.</p>`,
      riyl: () => ta('data.riyl', 2, 'Recommended if you like…'),
      smart_links: () => rep('smart_links'),
      assets: () => `
        <div class="toolbar" style="margin-bottom:10px">${btn('data-dbx-multi', 'Pick files from Dropbox…', 'btn')}<span class="hint">Select several files or folders at once. They're matched to the fields below by filename.</span></div>
        <div class="grid">
          <div class="field wide"><label>Project assets folder <span data-open-for="data.assets.folder">${openLink(d.assets.folder)}</span>${ro ? '' : ' · <a href="#" data-dbx="data.assets.folder">Choose in Dropbox</a>'}</label>${inp('data.assets.folder', 'url', ' placeholder="Dropbox folder with everything for this release"')}</div>
          ${ASSETS.map(([k, l]) => linkField('data.assets.' + k, l + ' link', ro ? '' : ` · <a href="#" data-dbx="data.assets.${k}">Dropbox</a>`)).join('')}
        </div>`,
      team: () => `${ro || d.team.length < 2 ? '' : `<div class="toolbar" style="margin-bottom:6px"><span class="hint">Sort by</span>
          <div class="seg seg-sm">${[['name', 'Name'], ['role', 'Role'], ['company', 'Company']].map(([k, l]) => `<button type="button" data-team-sort="${k}">${l}</button>`).join('')}</div></div>`}
        ${rep('team')}<p class="hint" style="margin-top:6px">Start typing a name to pick someone already saved. New people are remembered when you save, and this artist's team fills in next time.</p>`,
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
      press: () => `<div class="grid">${FP.field('Quotes', ta('data.press_quotes', 4, 'Pull quotes for the one-sheet'), 'wide')}</div>
        <div style="margin-top:12px">${pressSections()}</div>
        <div class="grid" style="margin-top:10px">${FP.field('Previous press', ta('data.press_previous', 3), 'wide')}</div>`,
      radio: () => ta('data.radio', 3),
      syncs: () => ta('data.syncs', 3),
      tour: () => `<div class="toolbar" style="margin-bottom:8px">
          ${FP.state.sources?.chartmetric && hooks.pullTour ? btn('data-pull-tour', 'Pull tour dates (Chartmetric)') : ''}
          ${btn('data-paste="tour"', 'Paste tour dates…')}
          <span class="hint">${d.tour_synced_at ? `Last pulled ${new Date(d.tour_synced_at).toLocaleString()}. ` : ''}${FP.state.sources?.chartmetric ? 'Announced shows are pulled from Songkick, Ticketmaster, SeatGeek and JamBase (via Chartmetric), and refreshed daily.' : 'Paste a list from an agent email, a spreadsheet or a website, one show per line.'}</span></div>
        ${tourTable()}`,
      recording: () => ta('data.recording', 4),
    };
    const TITLES = [['overview', 'Overview'], ['onesheet', 'One-sheet'], ['social', 'Social'], ['dsps', 'DSPs'], ['riyl', 'RIYL'], ['smart_links', 'Smart Links'], ['assets', 'Assets'],
      ['team', 'Team'], ['formats', 'Formats'], ['timeline', 'Timeline'], ['tracks', 'Tracklisting &amp; Credits'], ['marketing', 'Retail &amp; Digital Marketing'],
      ['playlists', 'Digital Playlisting'], ['press', 'Press'], ['radio', 'Radio'], ['syncs', 'Syncs'], ['tour', 'Tour Dates'], ['recording', 'Recording Details']];

    // Platform | link | followers | as of. Follower counts are saved to the artist profile too.
    function linkTable(group, list) {
      const fmtAsof = f => f?.asof ? `${f.source && f.source !== 'manual' ? f.source + ', ' : ''}${FP.fmtDate(f.asof, { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
      const gcell = key => { const g = growth(d.followers[key]); return `<td class="hint" style="white-space:nowrap;${g ? `color:${g.diff > 0 ? 'var(--green)' : g.diff < 0 ? 'var(--red)' : 'inherit'}` : ''}">${esc(growthText(g))}</td>`; };
      return `<div class="rep"><table><thead><tr><th style="width:130px">Platform</th><th>Link</th><th style="width:120px">Followers</th><th style="width:150px">Change</th><th style="width:150px">As of</th></tr></thead><tbody>
        ${list.map(([k, l]) => { const f = d.followers[k]; return `<tr>
          <td style="padding:6px 4px"><b>${l}</b></td>
          <td><div style="display:flex;gap:4px;align-items:center">${inp(`data.${group}.${k}`, 'url', ' style="flex:1"')}<span data-open-for="data.${group}.${k}">${openLink(d[group][k])}</span></div></td>
          <td><input type="number" min="0" data-fk="${k}" value="${esc(f?.count ?? '')}"${dis} placeholder="—"></td>
          ${gcell(k)}<td class="hint" data-asof="${k}">${fmtAsof(f)}</td></tr>${k === 'spotify' ? (() => { const ml = d.followers.spotify_listeners; return `<tr>
          <td style="padding:2px 4px 6px 14px" class="hint">↳ Monthly listeners</td><td></td>
          <td><input type="number" min="0" data-fk="spotify_listeners" value="${esc(ml?.count ?? '')}"${dis} placeholder="—"></td>
          ${gcell('spotify_listeners')}<td class="hint" data-asof="spotify_listeners">${fmtAsof(ml)}</td></tr>`; })() : ''}`; }).join('')}
        </tbody></table></div>`;
    }

    // Press is organised in sections — Single 1, Single 2, Album, Tour — each with its
    // own coverage list, so nothing has to be tagged item by item.
    function pressSections() {
      const songs = [...new Set([...d.tracks.map(t => t.song), ...String(d.focus_tracks || '').split(',').map(x => x.trim())].filter(Boolean))];
      const typeLabel = t => ({ Single: 'Single', Album: 'Album', Tour: 'Tour', Other: 'Other' })[t] || 'Other';
      const box = (sc, i) => `<div class="form-section" style="margin:0 0 10px 0;background:#fff">
        <h3 style="text-transform:none;letter-spacing:0;gap:8px">
          <select data-ps="${i}" data-psf="type"${dis} style="font-weight:600">${FP.options(['Single', 'Album', 'Tour', 'Other'], sc.type, { blank: false })}</select>
          <input type="text" data-ps="${i}" data-psf="name" value="${esc(sc.name)}"${sc.type === 'Single' ? ' list="dl-singles" placeholder="Single name"' : sc.type === 'Album' ? ' placeholder="Album title"' : sc.type === 'Tour' ? ' placeholder="e.g. Fall 2026 US tour"' : ' placeholder="Section name"'}${dis} style="flex:1">
          <span class="hint">${sc.items.filter(x => x.outlet || x.url).length} item${sc.items.length === 1 ? '' : 's'}</span>
          ${ro ? '' : `<button class="btn-ghost btn-sm" data-ps-paste="${i}" title="Paste several links into this section">Paste links</button><button class="btn-ghost btn-sm" data-ps-del="${i}" title="Remove section">✕</button>`}
        </h3>
        <div class="fs-body" style="padding:8px 10px"><div class="rep"><table><thead><tr><th style="width:200px">Publication</th><th>Link</th><th>Notes</th><th></th></tr></thead><tbody>
          ${sc.items.map((x, j) => { const at = `data-ps="${i}" data-pi="${j}"${dis}`; return `<tr>
            <td><input type="text" ${at} data-pk="outlet" value="${esc(x.outlet)}" placeholder="e.g. Pitchfork"></td>
            <td><div style="display:flex;gap:4px;align-items:center"><input type="url" ${at} data-pk="url" value="${esc(x.url)}" style="flex:1">${openLink(x.url)}</div></td>
            <td><input type="text" ${at} data-pk="notes" value="${esc(x.notes)}" placeholder="Optional"></td>
            <td style="width:30px">${ro ? '' : `<button class="btn-ghost btn-sm" data-ps-del-item="${i}:${j}" title="Remove">✕</button>`}</td></tr>`; }).join('')}
          </tbody></table>${ro ? '' : `<button class="btn btn-sm add" data-ps-add-item="${i}">+ Add coverage</button>`}</div></div></div>`;
      return `<datalist id="dl-singles">${songs.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
        ${d.press_sections.map(box).join('') || '<p class="hint" style="margin-bottom:8px">No coverage yet. Add a section for each single, the album or the tour.</p>'}
        ${ro ? '' : `<div class="toolbar"><button class="btn btn-sm" data-ps-add="Single">+ Single section</button><button class="btn btn-sm" data-ps-add="Album">+ Album section</button>
          <button class="btn btn-sm" data-ps-add="Tour">+ Tour section</button><span class="spacer"></span><button class="btn btn-sm" data-ps-paste="">Paste links…</button></div>`}`;
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
    const repSection = name => ({ social_extra: 'social', dsp_extra: 'dsps', smart_links: 'smart_links', team: 'team', formats: 'formats', timeline: 'timeline', tracks: 'tracks', playlists: 'playlists', tour: 'tour', press: 'press' })[name];
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
      if (t.dataset.ps !== undefined && t.dataset.psf === 'name') { d.press_sections[+t.dataset.ps].name = t.value; onChange(); return; }
      if (t.dataset.ps !== undefined && t.dataset.pk) { d.press_sections[+t.dataset.ps].items[+t.dataset.pi][t.dataset.pk] = t.value; onChange(); return; }
      if (t.dataset.fk) {
        const k = t.dataset.fk;
        const old = d.followers[k];
        // Keep the last reading from an earlier day so the change can be shown.
        const prev = old && old.asof && old.asof !== FP.today() ? { count: old.count, asof: old.asof } : old?.prev;
        if (t.value === '') delete d.followers[k];
        else d.followers[k] = { count: Number(t.value), asof: FP.today(), source: 'manual', ...(prev ? { prev } : {}) };
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
      if (t.dataset.ps !== undefined && t.dataset.psf === 'type') { d.press_sections[+t.dataset.ps].type = t.value; refresh('press'); onChange(); return; }
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
      if (t.matches('[data-ps-add]')) {
        const type = t.dataset.psAdd;
        d.press_sections.push({ key: crypto.randomUUID().slice(0, 8), type, name: type === 'Album' ? (proj.title || '') : '', items: [{ outlet: '', url: '', notes: '' }] });
        refresh('press'); onChange();
        box.querySelector(`[data-ps="${d.press_sections.length - 1}"][data-psf="name"]`)?.focus();
      }
      if (t.matches('[data-ps-add-item]')) {
        const i = +t.dataset.psAddItem; d.press_sections[i].items.push({ outlet: '', url: '', notes: '' });
        refresh('press'); onChange();
        box.querySelector(`[data-ps="${i}"][data-pi="${d.press_sections[i].items.length - 1}"][data-pk="outlet"]`)?.focus();
      }
      if (t.matches('[data-ps-del-item]')) { const [i, j] = t.dataset.psDelItem.split(':').map(Number); d.press_sections[i].items.splice(j, 1); refresh('press'); onChange(); }
      if (t.matches('[data-ps-del]')) {
        const i = +t.dataset.psDel, sc = d.press_sections[i];
        if (sc.items.some(x => x.url || x.outlet) && !confirm(`Remove the ${sc.type}${sc.name ? ' “' + sc.name + '”' : ''} section and its ${sc.items.length} item(s)?`)) return;
        d.press_sections.splice(i, 1); refresh('press'); onChange();
      }
      if (t.matches('[data-ps-paste]')) pastePress(t.dataset.psPaste === '' ? null : +t.dataset.psPaste);
      if (t.matches('[data-team-sort]')) {
        const k = t.dataset.teamSort;
        // Rows missing the chosen field go last; ties fall back to name.
        d.team.sort((x, y) => (!x[k]) - (!y[k]) || String(x[k] || '').localeCompare(String(y[k] || ''), undefined, { sensitivity: 'base' })
          || String(x.name || '').localeCompare(String(y.name || '')));
        refresh('team'); onChange();
        box.querySelector(`[data-team-sort="${k}"]`)?.classList.add('on');
      }
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

    // Paste a pile of press links: each gets a publication name (from the page, or a
    // known-outlet list), then is sorted into a section by spotting the single name,
    // album title or "tour" in its link / headline. Everything is reviewable first.
    function pastePress(targetIdx) {
      const m = FP.modal({
        title: 'Paste press links', wide: true, saveLabel: 'Add to sections',
        body: `<p class="hint" style="margin-bottom:8px">Paste links, one per line. Text on the same line (like the outlet name) is fine too. Each link is sorted into a section by matching the single name, album title or the word “tour”. Anything that doesn't match goes to ${targetIdx != null ? 'the section you pasted from' : 'the section you choose'}.</p>
          <textarea id="pp-text" rows="8" style="font-family:var(--mono);font-size:12px"></textarea>
          <p style="margin-top:8px"><button class="btn btn-sm" id="pp-go">Sort links</button> <span class="hint" id="pp-status"></span></p>
          <div id="pp-prev" style="margin-top:10px"></div>`,
        onSave: el => {
          const rows = [...el.querySelectorAll('[data-pp-row]')].filter(r => r.querySelector('[data-pp-inc]').checked);
          if (!rows.length) throw new Error('Nothing to add. Paste some links and click “Sort links” first.');
          let added = 0;
          for (const r of rows) {
            let si = r.querySelector('[data-pp-sec]').value;
            if (si.startsWith('new:')) {
              const [, type, ...nm] = si.split(':');
              d.press_sections.push({ key: crypto.randomUUID().slice(0, 8), type, name: nm.join(':'), items: [] });
              const idx = d.press_sections.length - 1;
              el.querySelectorAll(`[data-pp-sec] option[value="${CSS.escape(si)}"]`).forEach(o => { o.value = String(idx); });
              si = String(idx);
            }
            const sc = d.press_sections[+si];
            const url = r.dataset.url;
            if (sc.items.some(x => x.url === url)) continue;
            sc.items = sc.items.filter(x => x.outlet || x.url || x.notes);       // drop the empty starter row
            sc.items.push({ outlet: r.querySelector('[data-pp-outlet]').value.trim(), url, notes: r.querySelector('[data-pp-notes]').value.trim() });
            added++;
          }
          refresh('press'); onChange();
          FP.toast(`Added ${added} link${added === 1 ? '' : 's'}`);
        },
      });
      const $ = q => m.el.querySelector(q);
      $('#pp-go').onclick = async () => {
        const lines = $('#pp-text').value.split('\n').map(l => l.trim()).filter(Boolean);
        const items = [];
        for (const l of lines) for (const u of l.match(/https?:\/\/[^\s<>"']+/g) || []) items.push({ url: u.replace(/[),.;]+$/, ''), text: l.replace(u, '').replace(/^[\s\-–—:|•*]+|[\s\-–—:|]+$/g, '') });
        const seen = new Set(), uniq = items.filter(x => !seen.has(x.url) && seen.add(x.url));
        if (!uniq.length) { $('#pp-prev').innerHTML = '<p>No links found.</p>'; return; }
        $('#pp-go').disabled = true;
        // Look up page titles a few at a time.
        let done = 0;
        const info = new Array(uniq.length);
        const work = uniq.map((x, i) => async () => {
          try { info[i] = await FP.get('/api/linkinfo?url=' + encodeURIComponent(x.url)); } catch { info[i] = {}; }
          $('#pp-status').textContent = `Reading ${++done} of ${uniq.length}…`;
        });
        for (let i = 0; i < work.length; i += 4) await Promise.all(work.slice(i, i + 4).map(f => f()));
        $('#pp-status').textContent = '';
        $('#pp-go').disabled = false;

        // Section choices: existing sections, plus new ones for singles that have none yet.
        const norm = v => String(v || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
        const opts = d.press_sections.map((sc, i) => ({ value: String(i), label: `${sc.type}${sc.name ? ' — ' + sc.name : ''}`, type: sc.type, name: sc.name }));
        const songs = [...new Set(d.tracks.map(t => t.song).filter(Boolean))];
        for (const song of songs) if (!opts.some(o => o.type === 'Single' && norm(o.name) === norm(song))) opts.push({ value: `new:Single:${song}`, label: `New section: Single — ${song}`, type: 'Single', name: song, isNew: true });
        if (!opts.some(o => o.type === 'Album')) opts.push({ value: `new:Album:${proj.title || ''}`, label: `New section: Album${proj.title ? ' — ' + proj.title : ''}`, type: 'Album', name: proj.title || '', isNew: true });
        if (!opts.some(o => o.type === 'Tour')) opts.push({ value: 'new:Tour:', label: 'New section: Tour', type: 'Tour', name: '', isNew: true });
        const fallback = targetIdx != null ? String(targetIdx) : (opts.find(o => !o.isNew)?.value || opts[0].value);
        const guess = (x, inf) => {
          const hay = ' ' + norm(decodeURIComponent(x.url) + ' ' + x.text + ' ' + (inf.title || '')) + ' ';
          // Longest matching name wins, so "Bird Songs For Atomic Skies" beats "Skies".
          const named = opts.filter(o => o.name && o.type !== 'Tour' && hay.includes(' ' + norm(o.name) + ' ')).sort((a2, b2) => norm(b2.name).length - norm(a2.name).length);
          const single = named.find(o => o.type === 'Single'), album = named.find(o => o.type === 'Album');
          if (single && !(album && norm(album.name) === norm(single.name) && /album|lp|review/.test(hay))) return single.value;
          if (album) return album.value;
          if (/ tour | tour dates | dates /.test(hay)) return (opts.find(o => o.type === 'Tour' && !o.isNew) || opts.find(o => o.type === 'Tour')).value;
          return fallback;
        };
        $('#pp-prev').innerHTML = `<div class="tbl-wrap" style="max-height:340px"><table class="tbl edit"><thead><tr><th style="width:30px"></th><th style="width:170px">Publication</th><th>Headline / notes</th><th style="width:220px">Section</th></tr></thead><tbody>
          ${uniq.map((x, i) => { const inf = info[i] || {}; const g = guess(x, inf); return `<tr data-pp-row data-url="${esc(inf.url && !/\/(login|consent)/i.test(inf.url) ? x.url : x.url)}">
            <td style="text-align:center"><input type="checkbox" data-pp-inc checked></td>
            <td><input type="text" data-pp-outlet value="${esc(outletName(x.url, inf.site, x.text))}"></td>
            <td><input type="text" data-pp-notes value="${esc(inf.title && inf.title !== inf.site ? inf.title : '')}" title="${esc(x.url)}"></td>
            <td><select data-pp-sec>${opts.map(o => `<option value="${esc(o.value)}"${o.value === g ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></td></tr>`; }).join('')}
          </tbody></table></div><p class="hint" style="margin-top:6px">${uniq.length} link${uniq.length === 1 ? '' : 's'}. Check the sections, then click “Add to sections”. Links already in a section are skipped.</p>`;
      };
      if (targetIdx == null && !d.press_sections.length) $('#pp-status').textContent = 'Tip: sections are created for you if you don’t have any yet.';
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
  // Google converts this HTML into a Doc. h1/h2 become real headings (they show
  // in the doc outline). Avoid borders on headings: they turn into stray rule
  // lines that also break the next list. Empty fields and sections are left out.
  // Logo is served from the live site so Google can fetch it while building the Doc.
  const DOC_LOGO = 'https://fatpossumrecords.github.io/fp-projects/fp-logo.png';

  // Dropbox share links → direct image links Google can embed (album art on page 1).
  function imageUrl(u) {
    if (!FP.safeUrl(u)) return '';
    try {
      const url = new URL(u);
      if (/dropbox\.com$/.test(url.hostname.replace(/^www\./, ''))) {
        if (url.pathname.includes('/fo/')) return '';          // a folder, not an image
        url.searchParams.delete('dl'); url.searchParams.set('raw', '1');
        return url.href;
      }
      return /\.(jpe?g|png|gif|webp)$/i.test(url.pathname) ? u : '';
    } catch { return ''; }
  }

  function buildDocHtml(p) {
    // Page 1 is a one-sheet (pitch, release facts, tracklist, tour, links, contacts).
    // Page 2 onward holds the working details. Layout columns are borderless tables,
    // because that's the only multi-column layout Google keeps when converting HTML.
    const d = normalize(p.data);
    const C = { ink: '#1c1a16', muted: '#7a7468', accent: '#b83228', rule: '#e4e0d8' };
    const has = v => !blank(v);
    const txt = v => esc(v || '').replace(/\n/g, '<br>');
    const linkify = v => txt(v).replace(/(https?:\/\/[^\s<]+)/g, u => `<a href="${u}">${shortUrl(u)}</a>`);
    const a = (url, label) => FP.safeUrl(url) ? `<a href="${esc(url)}">${esc(label || shortUrl(url))}</a>` : esc(label || url || '');
    const muted = s => `<span style="color:${C.muted}">${s}</span>`;
    const dot = ` ${muted('·')} `;
    const para = (html, extra = '') => `<p style="margin:0 0 3pt 0;line-height:1.35;${extra}">${html}</p>`;
    const lines = list => list.filter(Boolean).map(x => para(x)).join('');
    const label = t => `<p style="margin:12pt 0 3pt 0;font-size:8pt;font-weight:bold;color:${C.accent}">${t.toUpperCase()}</p>`;
    const block = (t, body) => body ? label(t) + body : '';
    const h2 = t => `<h2 style="font-size:11pt;font-weight:bold;color:${C.accent};margin:16pt 0 4pt 0">${t}</h2>`;
    const section = (t, body) => body ? h2(t) + body : '';
    const W = 'border:1px solid #ffffff';                         // invisible table borders
    const cols = (...cells) => `<table style="border-collapse:collapse;width:100%;${W}"><tr>${cells.map(([w, html]) =>
      `<td style="width:${w};vertical-align:top;padding:0 16pt 0 0;${W}">${html}</td>`).join('')}</tr></table>`;
    const date = v => v ? esc(FP.fmtDate(v, { month: 'short', day: 'numeric', year: 'numeric' })) : 'TBD';
    const longDate = v => v ? esc(FP.fmtDate(v, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })) : 'Release date TBD';

    const tracks = d.tracks.filter(t => has(t.song));
    const formats = d.formats.filter(f => has(f.format) || has(f.title));
    const art = imageUrl(d.assets.album_art) || imageUrl(d.assets.single_art);
    const points = String(d.selling_points || '').split('\n').map(s => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
    const tourLines = rows => lines(rows.filter(t => has(t.date) || has(t.city)).map(t =>
      `<b>${t.date ? esc(FP.fmtDate(t.date, { weekday: 'short', month: 'short', day: 'numeric' })) : 'TBD'}</b>&nbsp;&nbsp;${esc(t.city || '')}${t.venue ? ' — ' + (FP.safeUrl(t.ticket_url) ? a(t.ticket_url, t.venue) : esc(t.venue)) : ''}${t.notes ? dot + esc(t.notes) : ''}${
        t.cancelled ? ' ' + muted('(cancelled)') : !t.announced ? ` <b style="color:${C.accent}">· Not announced</b>` : ''}`));
    const followerDates = Object.values(d.followers).map(f => f?.asof).filter(Boolean).sort();
    const timeline = [...formatTimeline(p), ...d.timeline.filter(t => has(t.item)), ...splitDatedLines(d.timeline_notes).dated]
      .sort((x, y) => String(x.date || '9').localeCompare(String(y.date || '9')));
    const otherNotes = splitDatedLines(d.timeline_notes).other;
    const assets = [['Project folder', d.assets.folder], ...ASSETS.map(([key, lab]) => [lab, d.assets[key]])].filter(([, u]) => FP.safeUrl(u));
    const smart = d.smart_links.filter(x => FP.safeUrl(x.url));

    // Socials & streaming: one row per platform with followers and their change,
    // so growth reads at a glance. Spotify gets followers and monthly listeners.
    const hair = (html, { head, right, color } = {}) => `<td style="padding:3pt 10pt 3pt 0;border:1px solid #ffffff;border-bottom:1px solid ${C.rule};vertical-align:top;font-size:9pt;${right ? 'text-align:right;' : ''}${head ? `color:${C.muted};font-weight:bold;` : ''}${color ? `color:${color};` : ''}">${html}</td>`;
    const statRows = [
      ...SOCIALS.map(([key, l]) => ({ name: l, url: d.social[key], f: d.followers[key], unit: key === 'youtube' ? 'subscribers' : key === 'facebook' ? 'likes' : 'followers' })),
      ...d.social_extra.map(x => ({ name: x.label || 'Link', url: x.url })),
      ...DSPS.flatMap(([key, l]) => [{ name: l, url: d.dsp_links[key], f: d.followers[key], unit: key === 'deezer' ? 'fans' : 'followers' },
        ...(key === 'spotify' && d.followers.spotify_listeners?.count != null ? [{ name: 'Spotify', url: d.dsp_links.spotify, f: d.followers.spotify_listeners, unit: 'monthly listeners' }] : [])]),
      ...d.dsp_extra.map(x => ({ name: x.label || 'Link', url: x.url })),
    ].filter(r => FP.safeUrl(r.url) || r.f?.count != null);
    const anyCounts = statRows.some(r => r.f?.count != null);
    const statsTable = statRows.length ? `<table style="border-collapse:collapse;width:100%;${W}">
        ${anyCounts ? `<tr>${hair('Platform', { head: true })}${hair('Audience', { head: true, right: true })}${hair('', { head: true })}${hair('Change', { head: true, right: true })}</tr>` : ''}
        ${statRows.map(r => { const g = growth(r.f); return `<tr>${hair(`<b>${a(r.url, r.name)}</b>`)}${hair(r.f?.count != null ? Number(r.f.count).toLocaleString('en-US') : muted('—'), { right: true })}${hair(r.f?.count != null ? muted(r.unit || '') : '')}${hair(g ? esc(growthText(g)) : '', { right: true, color: g ? (g.diff > 0 ? '#1e7e4a' : g.diff < 0 ? C.accent : C.muted) : '' })}</tr>`; }).join('')}
      </table>${followerDates.length ? para(`<span style="font-size:8pt;color:${C.muted}">As of ${esc(FP.fmtDate(followerDates.at(-1)))}${statRows.some(r => r.f?.month != null) ? '; change is over the last 30 days (Chartmetric)' : ''}.</span>`, 'margin-top:3pt') : ''}` : '';

    // ── PAGE 1: ONE-SHEET ──
    const header = cols(['78%', `
        <p style="margin:0;font-size:26pt;font-weight:bold;line-height:1.1">${esc(p.artist)}</p>
        <p style="margin:2pt 0 6pt 0;font-size:16pt;line-height:1.2">${esc(p.title)}</p>
        ${para([longDate(p.release_date), esc(p.label), esc(p.catalog)].filter(Boolean).join(dot), `color:${C.muted}`)}`],
      ['22%', `<p style="margin:0;text-align:right"><img src="${DOC_LOGO}" width="88" height="82" alt="Fat Possum Records"></p>`]);

    const left = [
      block('About', has(d.about) ? String(d.about).split(/\n\s*\n/).map(x => para(linkify(x), 'margin-bottom:6pt')).join('') : ''),
      block('Selling points', points.length ? `<ul style="margin:0 0 0 14pt;padding:0">${points.map(x => `<li style="margin:0 0 2pt 0">${linkify(x)}</li>`).join('')}</ul>` : ''),
      block('Focus tracks', has(d.focus_tracks) ? para(`<b>${esc(d.focus_tracks)}</b>`) : ''),
      block('Tracklist', tracks.length ? `<ol style="margin:0 0 0 16pt;padding:0">${tracks.map(t => `<li style="margin:0 0 1pt 0">${esc(t.song)}${t.length ? ' ' + muted(esc(t.length)) : ''}</li>`).join('')}</ol>` : ''),
      block('For fans of', has(d.riyl) ? para(txt(d.riyl)) : ''),
      block('Press', has(d.press_quotes) ? para(`<i>${linkify(d.press_quotes)}</i>`) : ''),
    ].join('') || para(muted('Add “About this release” and selling points in the project’s One-sheet section.'));

    // Date, label and cat # are already in the header.
    const facts = [['Territory', esc(p.territory)],
      ['Genre', esc(d.genre)], ['Hometown', esc(d.hometown)], ['Website', FP.safeUrl(d.website) ? a(d.website) : '']].filter(([, v]) => v);
    const right = [
      art ? `<p style="margin:0 0 8pt 0"><img src="${esc(art)}" width="200" height="200" alt="Album art"></p>` : '',
      block('Details', facts.length ? lines(facts.map(([l, v]) => `${muted(l)}&nbsp;&nbsp;${v}`)) : ''),
      block('Formats', lines(formats.map(f => `<b>${esc(f.format || 'Release')}</b>${f.title && f.title !== p.title ? ' — ' + esc(f.title) : ''}${f.release_date && f.release_date !== p.release_date ? dot + date(f.release_date) : ''}${f.catalog ? '<br>' + muted(esc(f.catalog) + (f.upc ? ' · UPC ' + esc(f.upc) : '')) : f.upc ? '<br>' + muted('UPC ' + esc(f.upc)) : ''}`))),
    ].join('');

    const contacts = [has(p.pm) && `<b>${esc(p.pm)}</b>${dot}Project manager`,
      ...d.team.filter(t => has(t.name)).map(t => `<b>${esc(t.name)}</b>${t.role ? dot + esc(t.role) : ''}${t.company ? ', ' + esc(t.company) : ''}${t.email ? dot + `<a href="mailto:${esc(t.email)}">${esc(t.email)}</a>` : ''}${t.phone ? dot + esc(t.phone) : ''}`)];

    const page1 = `${header}<hr style="border:none;border-top:1px solid ${C.rule};margin:8pt 0 0 0">
      ${cols(['58%', left], ['42%', right])}
      ${block('Timeline', lines(timeline.map(t => `<b>${date(t.date)}</b>&nbsp;&nbsp;${esc(t.item)}`)) + (otherNotes.length ? para(muted(linkify(otherNotes.join('\n')))) : ''))}
      ${block('Smart links', smart.length ? para(smart.map(x => a(x.url, x.label || 'Smart link')).join(dot)) : '')}
      ${block('Assets', assets.length ? para(assets.map(([n, u]) => a(u, n)).join(dot)) : '')}
      ${block('Socials &amp; streaming', statsTable)}
      ${block('Contacts', lines(contacts))}
      ${block('Tour dates', tourLines(d.tour))}`;

    // ── PAGE 2+: PROJECT DETAILS ──
    const tcols = [['num', '#'], ['song', 'Song'], ['length', 'Length'], ['isrc', 'ISRC'], ['writers', 'Writers'], ['publishers', 'Publishers']].filter(([c]) => c === 'num' || tracks.some(t => has(t[c])));
    const cell = (html, head) => `<td style="padding:3pt 8pt 3pt 0;border:1px solid #ffffff;border-bottom:1px solid ${C.rule};vertical-align:top;font-size:9pt;${head ? `color:${C.muted};font-weight:bold;` : ''}">${html}</td>`;
    const credits = tracks.length ? `<table style="border-collapse:collapse;width:100%;${W}"><tr>${tcols.map(([, l]) => cell(esc(l), true)).join('')}</tr>
        ${tracks.map((t, i) => `<tr>${tcols.map(([c]) => cell(c === 'song' ? `<b>${esc(t.song)}</b>` : esc(c === 'num' ? (t.vol || '') + (t.num || i + 1) : t[c] || ''))).join('')}</tr>`).join('')}</table>` : '';

    const page2 = [
      section('Retail &amp; digital marketing', lines([has(d.retail) && `<b>Retail.</b> ${linkify(d.retail)}`, has(d.digital) && `<b>Digital.</b> ${linkify(d.digital)}`])),
      section('Digital playlisting', lines(d.playlists.filter(x => has(x.name)).map(x => `${x.dsp ? esc(x.dsp) + dot : ''}<b>${a(x.url, x.name)}</b>${x.status ? ' ' + muted('(' + esc(x.status) + ')') : ''}${x.notes ? dot + esc(x.notes) : ''}`))),
      section('Press', (() => {
        // Sections in the order the team added them (Single 1, Single 2, Album, Tour…).
        const line = x => `<b>${a(x.url, x.outlet || shortUrl(x.url))}</b>${x.notes ? dot + esc(x.notes) : ''}`;
        return d.press_sections.map(sc => {
          const items = sc.items.filter(x => has(x.outlet) || FP.safeUrl(x.url));
          if (!items.length) return '';
          return para(`<span style="font-size:8pt;font-weight:bold;color:${C.muted}">${esc(sc.type + (sc.name ? ' — ' + sc.name : '')).toUpperCase()}</span>`, 'margin-top:6pt') + lines(items.map(line));
        }).join('') + (has(d.press_previous) ? para(`<b>Previous press.</b> ${linkify(d.press_previous)}`, 'margin-top:6pt') : '');
      })()),
      section('Radio', has(d.radio) ? para(linkify(d.radio)) : ''),
      section('Syncs', has(d.syncs) ? para(linkify(d.syncs)) : ''),
      section('Recording details', has(d.recording) ? para(linkify(d.recording)) : ''),
      section('Credits', credits),
    ].join('');

    const updated = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return `<html><body style="font-family:Arial;font-size:9.5pt;color:${C.ink};line-height:1.35">
      ${page1}
      ${page2 ? `<p style="page-break-before:always;margin:0 0 2pt 0;font-size:8pt;color:${C.muted}">${esc(p.artist).toUpperCase()} · ${esc(p.title).toUpperCase()}</p>
        <h1 style="font-size:16pt;font-weight:bold;margin:0 0 4pt 0">Project details</h1>${page2}` : ''}
      <p style="margin:24pt 0 0 0;font-size:7.5pt;color:${C.muted}">Updated ${updated} from the Fat Possum project system. Edit the project in the app and click “Update Google Doc” to change this document; direct edits are replaced on the next update.</p>
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
