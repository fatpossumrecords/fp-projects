/* ============================================================
   SOCIAL SCHEDULE — planner (list / day / week / month), the
   posting view for whoever publishes, per-artist share links
   ============================================================ */
(function () {
  const esc = FP.esc;
  let ui = { view: 'week', artist: '', platform: '', status: '', anchor: null };
  try { Object.assign(ui, JSON.parse(localStorage.getItem('fp_social_ui') || '{}')); } catch { /* defaults */ }
  const saveUi = () => { try { localStorage.setItem('fp_social_ui', JSON.stringify({ ...ui, anchor: null })); } catch { /* ignore */ } };

  const mondayOf = ymd => { const d = FP.parseYmd(ymd); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return FP.ymd(d); };
  const narrow = () => window.matchMedia('(max-width: 760px)').matches;
  // Phones get the list or day view; the 7-column week and month grid don't fit.
  const view = () => narrow() && !['list', 'day'].includes(ui.view) ? 'list' : ui.view;

  const ABBR = { Instagram: 'IG', TikTok: 'TikTok', Facebook: 'FB', 'X / Twitter': 'X', YouTube: 'YT', Threads: 'Threads', Bluesky: 'Bsky', Newsletter: 'Email' };
  const abbr = p => ABBR[p] || p;

  // Older posts kept one platform in `platform`; newer ones keep a list in `platforms`.
  function norm(x) {
    if (!Array.isArray(x.platforms) || !x.platforms.length) x.platforms = x.platform ? String(x.platform).split(/\s*,\s*/).filter(Boolean) : [];
    if (!x.posted || typeof x.posted !== 'object' || Array.isArray(x.posted)) x.posted = {};
    return x;
  }
  // "Completed" is tracked by the per-platform ticks, separate from the status list (which teams customise).
  const allPosted = x => x.platforms.length ? x.platforms.every(p => x.posted[p]) : !!x.posted._all;
  const statusOrDone = x => allPosted(x) ? '<span class="badge s-posted">✓ Posted</span>' : FP.statusBadge(x.status);

  FP.route('social', async (main, _rest, params) => {
    if (params.artist !== undefined) ui.artist = params.artist;
    if (params.date) ui.anchor = params.date;
    if (!ui.anchor) ui.anchor = FP.today();
    main.innerHTML = `
      <div class="page-head"><h2>Social Schedule</h2>
        <div class="seg" id="s-view"><button data-v="list">List</button><button data-v="day">Day</button><button data-v="week" class="hide-mobile">Week</button><button data-v="month" class="hide-mobile">Month</button></div>
        ${FP.canWrite() ? '<button class="btn-primary" id="s-add">+ Post</button>' : ''}</div>
      <div class="page-body">
        <div class="toolbar" style="margin-bottom:12px">
          <button class="btn" id="s-prev">‹</button><button class="btn" id="s-today">Today</button><button class="btn" id="s-next">›</button>
          <b id="s-range" style="min-width:180px;font-size:14px"></b>
          <select id="s-artist"></select>
          <select id="s-platform">${FP.options(FP.list('platforms'), ui.platform, { blankLabel: 'All platforms' })}</select>
          <select id="s-status">${FP.options(FP.list('post_statuses'), ui.status, { blankLabel: 'All statuses' })}</select>
          <span class="spacer"></span>
          <button class="btn hide-mobile" id="s-csv">Export CSV</button>
        </div>
        <div id="s-share"></div>
        <div id="s-box"></div>
      </div>`;
    const $ = s => main.querySelector(s);
    $('#s-artist').innerHTML = `<option value="">All artists</option>` + FP.state.artists.map(a => `<option${a.name === ui.artist ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
    main.querySelectorAll('#s-view button').forEach(b => b.onclick = () => { ui.view = b.dataset.v; saveUi(); draw(); });
    $('#s-artist').onchange = e => { ui.artist = e.target.value; saveUi(); draw(); };
    $('#s-platform').onchange = e => { ui.platform = e.target.value; saveUi(); draw(); };
    $('#s-status').onchange = e => { ui.status = e.target.value; saveUi(); draw(); };
    $('#s-today').onclick = () => { ui.anchor = FP.today(); draw(); };
    const step = dir => {
      const v = view();
      if (v === 'day') ui.anchor = FP.addDays(ui.anchor, dir);
      else if (v === 'week') ui.anchor = FP.addDays(ui.anchor, 7 * dir);
      else if (v === 'list') ui.anchor = FP.addDays(ui.anchor, 14 * dir);
      else { const d = FP.parseYmd(ui.anchor); d.setDate(1); d.setMonth(d.getMonth() + dir); ui.anchor = FP.ymd(d); }
      draw();
    };
    $('#s-prev').onclick = () => step(-1);
    $('#s-next').onclick = () => step(1);
    const newPost = date => openPost({ date, artist: ui.artist, status: FP.list('post_statuses')[0], platforms: [] }, draw);
    $('#s-add')?.addEventListener('click', () => newPost(view() === 'day' ? ui.anchor : FP.today()));

    let cal = null, posts = [];
    const range = () => {
      const v = view();
      if (v === 'day') return [ui.anchor, ui.anchor];
      if (v === 'week') { const m = mondayOf(ui.anchor); return [m, FP.addDays(m, 6)]; }
      if (v === 'list') return [ui.anchor, FP.addDays(ui.anchor, 13)];
      const d = FP.parseYmd(ui.anchor); const first = new Date(d.getFullYear(), d.getMonth(), 1), last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return [FP.addDays(FP.ymd(first), -7), FP.addDays(FP.ymd(last), 7)];
    };
    $('#s-csv').onclick = () => FP.downloadCsv(`social-${ui.artist ? FP.slug(ui.artist) + '-' : ''}${range()[0]}.csv`,
      ['Date', 'Time', 'Artist', 'Platforms', 'Type', 'Status', 'Owner', 'Caption', 'Asset', 'Link', 'Notes'],
      posts.map(p => [p.date, p.time, p.artist, p.platforms.join(', '), p.post_type, p.status, p.owner, p.caption, p.asset_url, p.link_url, p.notes]));
    const onResize = () => { if (cal || main.querySelector('.week')) draw(); };
    window.addEventListener('resize', onResize);
    FP.current.destroy = () => window.removeEventListener('resize', onResize);

    async function draw() {
      FP.setQuery({ artist: ui.artist, date: ui.anchor === FP.today() ? '' : ui.anchor });
      const v = view();
      main.querySelectorAll('#s-view button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
      drawShare();
      const [from, to] = range();
      const qa = ui.artist ? '&artist=' + encodeURIComponent(ui.artist) : '';
      const [p, rels, ms] = await Promise.all([
        FP.get(`/api/social?from=${from}&to=${to}${qa}`),
        FP.get(`/api/releases?from=${from}&to=${to}${qa}`),
        FP.get(`/api/milestones?from=${from}&to=${to}`),
      ]);
      posts = p.map(norm).filter(x => (!ui.platform || x.platforms.includes(ui.platform)) && (!ui.status || x.status === ui.status));
      const marks = {};
      for (const r of rels) if (!['Cancelled', 'On Hold'].includes(r.status)) (marks[r.release_date] ||= []).push({ cls: r.kind === 'timeline' ? 'ms' : '', text: `${r.kind === 'timeline' ? '◆' : '★'} ${r.artist} — ${r.title}${r.format ? ' [' + r.format + ']' : ''}` });
      if (!ui.artist) for (const m of ms) if (/announce|release|video|single/i.test(m.title)) (marks[m.date] ||= []).push({ cls: 'ms', text: m.title });
      const byTime = list => list.sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')));

      const box = $('#s-box');
      if (cal) { cal.destroy(); cal = null; }
      if (v === 'week') {
        const mon = mondayOf(ui.anchor);
        $('#s-range').textContent = `${FP.fmtDate(mon, { month: 'short', day: 'numeric' })} – ${FP.fmtDate(FP.addDays(mon, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`;
        const days = [...Array(7)].map((_, i) => FP.addDays(mon, i));
        box.innerHTML = `<div class="week">${days.map(d => dayColumn(d, byTime(posts.filter(x => x.date === d)), marks[d] || [])).join('')}</div>`;
      } else if (v === 'day') {
        $('#s-range').textContent = FP.fmtDate(ui.anchor, { weekday: 'long', month: 'long', day: 'numeric' });
        const list = byTime(posts.filter(x => x.date === ui.anchor));
        box.innerHTML = `<div class="agenda">
          ${(marks[ui.anchor] || []).map(m => `<div class="mark ${m.cls}">${esc(m.text)}</div>`).join('')}
          ${list.length ? list.map(x => postCard(x, true)).join('') : '<div class="empty">Nothing planned for this day.</div>'}
          ${FP.canWrite() ? `<button class="btn" data-newday="${ui.anchor}">+ Add a post for this day</button>` : ''}</div>`;
      } else if (v === 'list') {
        $('#s-range').textContent = `${FP.fmtDate(from, { month: 'short', day: 'numeric' })} – ${FP.fmtDate(to, { month: 'short', day: 'numeric' })}`;
        const days = [...Array(14)].map((_, i) => FP.addDays(from, i)).filter(d => posts.some(x => x.date === d) || marks[d]);
        box.innerHTML = `<div class="agenda">${days.length ? days.map(d => `
          <div class="date-h${d === FP.today() ? ' today' : ''}">${d === FP.today() ? 'Today · ' : ''}${FP.fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
          ${(marks[d] || []).map(m => `<div class="mark ${m.cls}">${esc(m.text)}</div>`).join('')}
          ${byTime(posts.filter(x => x.date === d)).map(x => postCard(x, true)).join('')}`).join('') : '<div class="empty">Nothing planned in these two weeks.</div>'}</div>`;
      } else {
        $('#s-range').textContent = FP.monthLabel(ui.anchor);
        box.innerHTML = '<div></div>';
        cal = new FullCalendar.Calendar(box.firstChild, {
          initialView: 'dayGridMonth', initialDate: ui.anchor, headerToolbar: false, height: 'auto', firstDay: 1,
          editable: FP.canWrite(), dayMaxEvents: 5,
          events: [
            ...posts.map(x => ({ id: x.id, title: `${allPosted(x) ? '✓ ' : ''}${x.time ? x.time + ' ' : ''}${ui.artist ? '' : x.artist + ' · '}${x.platforms.map(abbr).join('/')}${x.post_type ? ' · ' + x.post_type : ''}`,
              start: x.date, allDay: true, backgroundColor: FP.artistColor(x.artist), borderColor: FP.artistColor(x.artist), classNames: allPosted(x) ? ['posted'] : [] })),
            ...Object.entries(marks).flatMap(([d, ms]) => ms.filter(m => !m.cls).map(m => ({ title: m.text, start: d, allDay: true, display: 'background', backgroundColor: '#e8c4c0' }))),
          ],
          eventClick: info => { const x = posts.find(p => p.id === info.event.id); if (x) openPoster(x, draw); },
          eventDrop: async info => {
            const x = posts.find(p => p.id === info.event.id);
            try { Object.assign(x, await FP.saveRecord('social', x, { date: FP.ymd(info.event.start) })); }
            catch (e) { info.revert(); if (e.status !== 409) FP.toast(e.message, true); }
          },
          dateClick: FP.canWrite() ? info => newPost(info.dateStr) : undefined,
        });
        cal.render();
        return;
      }
      wire(box);
    }

    function dayColumn(d, list, marks) {
      const dt = FP.parseYmd(d);
      return `<div class="day${d === FP.today() ? ' today' : ''}" data-day="${d}">
        <div class="day-head"><span class="dow">${dt.toLocaleDateString('en-US', { weekday: 'short' })}</span><span class="dnum">${dt.getDate()}</span>
          <button class="btn-ghost btn-sm" data-goday="${d}" title="Open day view">⤢</button>
          ${FP.canWrite() ? `<button class="btn-ghost btn-sm add" data-newday="${d}" title="Add post">+</button>` : ''}</div>
        ${marks.length ? `<div class="day-marks">${marks.map(m => `<div class="mark ${m.cls}">${esc(m.text)}</div>`).join('')}</div>` : ''}
        <div class="day-posts">${list.map(x => postCard(x)).join('')}</div></div>`;
    }

    function postCard(x, big) {
      return `<div class="post${big ? ' big' : ''}${allPosted(x) ? ' posted' : ''}" data-post="${x.id}" draggable="${FP.canWrite() && !narrow()}" style="border-left-color:${FP.artistColor(x.artist)}">
        <div class="p-top">${x.time ? `<span class="mono">${esc(x.time)}</span>` : ''}${ui.artist ? '' : `<span class="p-artist">${esc(x.artist || '—')}</span>`}
          <span class="spacer"></span>${statusOrDone(x)}${FP.canWrite() ? '<button class="btn-ghost btn-sm p-edit" data-edit title="Edit post">✎</button>' : ''}</div>
        ${x.platforms.length ? `<div class="chips" style="margin-top:4px">${x.platforms.map(p => `<span class="chip${x.posted[p] ? ' done' : ''}">${x.posted[p] ? '✓ ' : ''}${esc(big ? p : abbr(p))}</span>`).join('')}</div>` : ''}
        ${x.post_type ? `<div style="font-weight:600;margin-top:3px">${esc(x.post_type)}</div>` : ''}
        ${x.caption ? `<div class="p-cap">${esc(x.caption)}</div>` : ''}
      </div>`;
    }

    function wire(box) {
      box.querySelectorAll('[data-post]').forEach(el => {
        const x = () => posts.find(p => p.id === el.dataset.post);
        el.onclick = e => {
          if (e.target.closest('a')) return;
          if (e.target.closest('[data-edit]')) return openPost(x(), draw);
          openPoster(x(), draw);
        };
        el.ondragstart = e => { e.dataTransfer.setData('text/plain', el.dataset.post); e.dataTransfer.effectAllowed = 'move'; };
      });
      box.querySelectorAll('[data-newday]').forEach(b => b.onclick = e => { e.stopPropagation(); newPost(b.dataset.newday); });
      box.querySelectorAll('[data-goday]').forEach(b => b.onclick = () => { ui.view = 'day'; ui.anchor = b.dataset.goday; saveUi(); draw(); });
      if (!FP.canWrite()) return;
      box.querySelectorAll('[data-day]').forEach(col => {
        col.ondragover = e => { e.preventDefault(); col.classList.add('drop'); };
        col.ondragleave = () => col.classList.remove('drop');
        col.ondrop = async e => {
          e.preventDefault(); col.classList.remove('drop');
          const x = posts.find(p => p.id === e.dataTransfer.getData('text/plain'));
          if (!x || x.date === col.dataset.day) return;
          try { await FP.saveRecord('social', x, { date: col.dataset.day }); draw(); }
          catch (err) { if (err.status !== 409) FP.toast(err.message, true); draw(); }
        };
      });
    }

    // Per-artist share link for the artist's own team (read-only, no sign-in).
    function drawShare() {
      const el = $('#s-share');
      const a = FP.state.artists.find(x => x.name === ui.artist);
      if (!a || !a.id) { el.innerHTML = ''; return; }
      const url = a.share_token ? new URL('share.html?t=' + a.share_token, location.href).href : '';
      el.innerHTML = `<div class="form-section"><div class="fs-body toolbar">
        <span class="dot" style="background:${FP.artistColor(a.name)}"></span><b>${esc(a.name)} social calendar</b>
        ${url ? `<input type="text" readonly value="${esc(url)}" style="flex:1;min-width:200px" id="s-url"><button class="btn btn-sm" id="s-copy">Copy link</button>
          <a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener" style="text-decoration:none">Preview ↗</a>
          ${FP.canWrite() ? '<button class="btn-danger btn-sm" id="s-revoke">Turn off link</button>' : ''}`
        : `<span class="hint">Share a read-only view of this calendar with ${esc(a.name)}'s team. No sign-in needed.</span>${FP.canWrite() ? '<button class="btn btn-sm" id="s-mk">Create share link</button>' : ''}`}
        </div></div>`;
      $('#s-copy')?.addEventListener('click', () => { navigator.clipboard.writeText(url); FP.toast('Link copied'); });
      $('#s-mk')?.addEventListener('click', async () => { a.share_token = (await FP.post(`/api/artists/${a.id}/share`)).share_token; drawShare(); });
      $('#s-revoke')?.addEventListener('click', async () => {
        if (!confirm('Turn off this link? Anyone who has it will lose access.')) return;
        await FP.del(`/api/artists/${a.id}/share`); a.share_token = null; drawShare();
      });
    }

    draw();
  });

  // ── POSTING VIEW ───────────────────────────────────────────
  // What the person publishing needs: copy the caption, grab the asset,
  // jump to each platform, and tick each one off.
  const PROFILE_KEY = { Instagram: 'instagram', TikTok: 'tiktok', Facebook: 'facebook', 'X / Twitter': 'twitter', YouTube: 'youtube', SoundCloud: 'soundcloud', Bandcamp: 'bandcamp' };

  function openPoster(x, after) {
    norm(x);
    const w = FP.canWrite();
    const links = FP.state.settings.platform_links || {};
    const prof = FP.projectInfo?.artistProfile(x.artist) || {};
    const m = FP.modal({ title: x.artist ? `${x.artist}${x.post_type ? ' · ' + x.post_type : ''}` : 'Post', body: '<div class="poster"></div>', sheet: true, noFoot: true });
    const box = m.el.querySelector('.poster');
    const copy = async (text, what) => {
      try { await navigator.clipboard.writeText(text); FP.toast(`${what} copied`); }
      catch { FP.toast('Couldn’t copy. Select the text and copy it manually.', true); }
    };
    const draw = () => {
      const done = allPosted(x);
      box.innerHTML = `
        <div class="meta">${FP.fmtDate(x.date, { weekday: 'long', month: 'long', day: 'numeric' })}${x.time ? ' · ' + esc(x.time) : ''} ${statusOrDone(x)}${x.owner ? ` · ${esc(x.owner)}` : ''}</div>
        ${x.caption ? `<div class="cap">${esc(x.caption)}</div>
          <div class="actions"><button class="btn-primary btn-lg" data-copy-cap>Copy caption</button></div>` : '<p class="hint">No caption written yet.</p>'}
        <div class="actions">
          ${FP.safeUrl(x.asset_url) ? `<a class="btn btn-lg" href="${esc(x.asset_url)}" target="_blank" rel="noopener">⬇ Get asset</a>` : '<span class="hint" style="align-self:center">No asset link</span>'}
          ${FP.safeUrl(x.link_url) ? `<button class="btn btn-lg" data-copy-link>Copy link for post</button>` : ''}
        </div>
        ${FP.safeUrl(x.link_url) ? `<div class="hint" style="word-break:break-all">Link: <a href="${esc(x.link_url)}" target="_blank" rel="noopener">${esc(x.link_url)}</a></div>` : ''}
        <div>
          ${x.platforms.length ? x.platforms.map(p => {
            const open = FP.safeUrl(links[p]), page = FP.safeUrl(prof.social?.[PROFILE_KEY[p]]);
            return `<div class="plat"><b>${esc(p)}</b>
              ${page ? `<a class="btn-ghost btn-sm" href="${esc(page)}" target="_blank" rel="noopener" title="${esc(x.artist)}'s page">Artist page</a>` : ''}
              ${open ? `<a class="btn btn-lg" href="${esc(open)}" target="_blank" rel="noopener">Open ↗</a>` : ''}
              ${w ? `<button class="btn btn-lg done-btn${x.posted[p] ? ' on' : ''}" data-done="${esc(p)}">${x.posted[p] ? '✓ Posted' : 'Mark posted'}</button>` : (x.posted[p] ? '<span class="chip done">✓ Posted</span>' : '')}
            </div>`;
          }).join('') : '<p class="hint">No platforms picked for this post.</p>'}
        </div>
        ${x.notes ? `<div class="hint"><b>Notes:</b> ${esc(x.notes)}</div>` : ''}
        <div class="actions" style="border-top:1px solid var(--border);padding-top:14px">
          ${w ? `<button class="btn btn-lg" data-edit>✎ Edit</button>
            <button class="btn-lg ${done ? 'btn' : 'btn-primary'}" data-all>${done ? 'Completed ✓ (undo)' : 'Mark completed'}</button>` : ''}
          <button class="btn btn-lg" data-close>Close</button>
        </div>`;
    };
    const save = async posted => {
      try { Object.assign(x, norm(await FP.saveRecord('social', x, { posted }))); draw(); after?.(); }
      catch (e) { if (e.status !== 409) FP.toast(e.message, true); }
    };
    box.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.matches('[data-copy-cap]')) copy(x.caption, 'Caption');
      if (t.matches('[data-copy-link]')) copy(x.link_url, 'Link');
      if (t.matches('[data-close]')) m.close();
      if (t.matches('[data-edit]')) { m.close(); openPost(x, after); }
      if (t.matches('[data-done]')) {
        const p = t.dataset.done, posted = { ...x.posted };
        if (posted[p]) delete posted[p]; else posted[p] = new Date().toISOString();
        save(posted);
      }
      if (t.matches('[data-all]')) {
        const undo = allPosted(x), posted = {};
        if (!undo) { const ts = new Date().toISOString(); for (const p of x.platforms) posted[p] = x.posted[p] || ts; if (!x.platforms.length) posted._all = ts; }
        save(posted);
      }
    });
    draw();
  }
  FP.openPoster = openPoster;

  // ── EDIT MODAL ─────────────────────────────────────────────
  const ASSET_LABELS = [['folder', 'Project folder'], ['press_photos', 'Press photos'], ['single_art', 'Single art'], ['album_art', 'Album art'], ['logo', 'Logo'], ['bio', 'Bio'], ['lyrics', 'Lyrics']];

  async function openPost(x, after) {
    norm(x);
    if (FP.canWrite()) FP.preloadDropbox();
    const isNew = !x.id;
    const projects = await FP.get('/api/projects');
    const w = FP.canWrite();
    const platforms = [...new Set([...FP.list('platforms'), ...x.platforms])];
    const m = FP.modal({
      title: isNew ? 'New social post' : `Edit · ${x.artist || 'post'}`,
      body: `<div class="grid">
        ${FP.field('Date', `<input type="date" name="date" value="${esc(x.date)}">`)}
        ${FP.field('Time', `<input type="time" name="time" value="${esc(x.time)}">`)}
        ${FP.field('Artist', `<input type="text" name="artist" list="${FP.artistDatalist()}" value="${esc(x.artist)}">`)}
        ${FP.field('Project', `<select name="project_id" id="pp-proj"></select>`)}
        ${FP.field('Platforms', `<div style="display:flex;flex-wrap:wrap;gap:4px 14px">
            <label style="font-weight:600"><input type="checkbox" id="pp-all"> Select all</label>
            ${platforms.map(p => `<label><input type="checkbox" data-plat value="${esc(p)}"${x.platforms.includes(p) ? ' checked' : ''}> ${esc(p)}</label>`).join('')}</div>`, 'wide')}
        ${FP.field('Type', `<select name="post_type">${FP.options(FP.list('post_types'), x.post_type)}</select>`)}
        ${FP.field('Status', `<select name="status">${FP.options(FP.list('post_statuses'), x.status, { blank: false })}</select>`)}
        ${FP.field('Owner', `<select name="owner">${FP.options(FP.userNames(), x.owner ?? (isNew ? FP.state.me.name : ''))}</select>`)}
        ${FP.field('Caption / copy', `<textarea name="caption" rows="5">${esc(x.caption)}</textarea>`, 'wide')}
        <div class="field wide"><label>Asset link${w ? ' · <a href="#" id="pp-dbx">Choose in Dropbox</a>' : ''}</label><input type="url" name="asset_url" value="${esc(x.asset_url)}"><div class="link-picks" id="pp-assets"></div></div>
        <div class="field wide"><label>Link in post (pre-save, tickets…)</label><input type="url" name="link_url" value="${esc(x.link_url)}"><div class="link-picks" id="pp-links"></div></div>
        ${FP.field('Internal notes', `<textarea name="notes" rows="2">${esc(x.notes)}</textarea>`, 'wide')}
        <label class="field wide" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" name="shared"${x.shared === 0 ? '' : ' checked'}> Show on the artist's shared calendar link</label>
      </div>
      ${!isNew && w ? '<p style="margin-top:12px"><button class="btn btn-sm" data-dup>Duplicate</button></p>' : ''}`,
      onSave: w ? async el => {
        const f = FP.readForm(el);
        if (!f.date) throw new Error('Date is required');
        f.platforms = [...el.querySelectorAll('[data-plat]:checked')].map(c => c.value);
        f.platform = f.platforms.join(', ');
        // Keep ticks only for platforms still on the post.
        f.posted = Object.fromEntries(Object.entries(x.posted).filter(([p]) => f.platforms.includes(p) || (p === '_all' && !f.platforms.length)));
        await FP.saveRecord('social', x, f);
        FP.ensureArtistLocal(f.artist);
        after?.();
      } : null,
      onDelete: !isNew && w ? async () => { await FP.del('/api/social/' + x.id); after?.(); } : null,
    });
    const $ = s => m.el.querySelector(s);
    const projSel = $('#pp-proj'), artistInp = $('[name=artist]');

    const plats = () => [...m.el.querySelectorAll('[data-plat]')];
    const syncAll = () => { $('#pp-all').checked = plats().every(c => c.checked); };
    $('#pp-all').onchange = e => plats().forEach(c => { c.checked = e.target.checked; });
    plats().forEach(c => c.onchange = syncAll);
    syncAll();

    // Quick picks from the chosen project's Smart Links and Assets.
    const picks = async () => {
      const id = projSel.value;
      $('#pp-assets').innerHTML = ''; $('#pp-links').innerHTML = '';
      if (!id) return;
      const d = FP.projectInfo.normalize((await FP.get('/api/projects/' + id)).data);
      const chip = (target, label, url) => FP.safeUrl(url) ? `<button type="button" class="chip" data-target="${target}" data-url="${esc(url)}" title="${esc(url)}">${esc(label)}</button>` : '';
      $('#pp-assets').innerHTML = ASSET_LABELS.map(([k, l]) => chip('asset_url', l, d.assets[k])).join('');
      $('#pp-links').innerHTML = [...d.smart_links.map(s => chip('link_url', s.label || 'Smart link', s.url)), chip('link_url', 'Website', d.website)].join('');
    };
    m.el.addEventListener('click', e => {
      const c = e.target.closest('[data-target]');
      if (c) { $(`[name=${c.dataset.target}]`).value = c.dataset.url; FP.toast(`${c.textContent} link added`); }
    });
    $('#pp-dbx')?.addEventListener('click', async e => {
      e.preventDefault();
      try { const [f] = await FP.chooseFromDropbox({ multiselect: false }); if (f) $('[name=asset_url]').value = f.link; }
      catch (err) { FP.toast(err.message, true); }
    });

    const fillProjects = () => {
      const a = artistInp.value.trim().toLowerCase();
      const list = projects.filter(p => !a || p.artist.toLowerCase() === a);
      const keep = projSel.value || x.project_id;
      projSel.innerHTML = '<option value="">—</option>' + list.map(p => `<option value="${p.id}"${p.id === keep ? ' selected' : ''}>${esc(p.artist)} — ${esc(p.title)}</option>`).join('');
      // One upcoming project for this artist → pick it, since it's almost always the one.
      if (!projSel.value && a) {
        const up = list.filter(p => !p.release_date || p.release_date >= FP.today());
        if (up.length === 1) projSel.value = up[0].id;
      }
      picks();
    };
    artistInp.addEventListener('change', fillProjects);
    projSel.addEventListener('change', picks);
    fillProjects();
    m.el.querySelector('[data-dup]')?.addEventListener('click', () => {
      const copy = { ...x, posted: {} }; delete copy.id; delete copy.updated_at;
      m.close(); openPost(copy, after);
    });
  }
})();
