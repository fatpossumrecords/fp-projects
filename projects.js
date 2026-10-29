/* ============================================================
   PROJECTS — project info sheet, Google Doc export, internal dates
   ============================================================ */
(function () {
  const esc = FP.esc;

  const HEAD = ['name', 'artist', 'title', 'release_date', 'label', 'catalog', 'territory', 'pm', 'status'];

  // ── ROUTES ─────────────────────────────────────────────────
  FP.route('projects', async (main, rest, params, page) => {
    if (rest[0]) return renderEditor(main, rest[0], params, page);
    return renderList(main, params);
  });

  async function renderList(main, params) {
    const projects = await FP.get('/api/projects');
    // Current = not released yet, or released within the last 12 months (campaigns run on after release).
    let q = params.q || '', show = ({ upcoming: 'current', past: 'archive' })[params.show] || params.show || 'current';
    main.innerHTML = `
      <div class="page-head"><h2>Projects</h2>
        ${FP.canWrite() ? '<a class="btn-primary" href="#/projects/new" style="text-decoration:none">+ New project</a>' : ''}</div>
      <div class="page-body">
        <div class="toolbar" style="margin-bottom:14px">
          <input type="search" id="p-q" placeholder="Search projects…" style="width:240px" value="${esc(q)}">
          <div class="seg" id="p-show"><button data-v="current">Current</button><button data-v="archive">Past campaigns</button><button data-v="all">All</button></div>
        </div>
        <div id="p-list"></div>
      </div>`;
    const draw = () => {
      const cutoff = FP.addDays(FP.today(), -365), ql = q.toLowerCase();
      main.querySelectorAll('#p-show button').forEach(b => b.classList.toggle('on', b.dataset.v === show));
      const list = projects.filter(p =>
        (show === 'all' || (show === 'current' ? (!p.release_date || p.release_date >= cutoff) : (p.release_date && p.release_date < cutoff))) &&
        (!ql || [p.artist, p.title, p.name, p.catalog, p.pm].some(v => String(v || '').toLowerCase().includes(ql))))
        .sort((a, b) => show === 'archive' ? String(b.release_date).localeCompare(String(a.release_date)) : String(a.release_date || '9').localeCompare(String(b.release_date || '9')));
      main.querySelector('#p-list').innerHTML = list.length ? `<div class="cards">${list.map(p => `
        <a class="card" href="#/projects/${p.id}" style="border-top:3px solid ${FP.statusColor(p.status)}">
          <div class="c-artist">${esc(p.artist)}</div>
          <div class="c-title">${esc(p.title)}</div>
          <div class="c-meta">${p.release_date ? `<span>${FP.fmtDate(p.release_date)}</span>` : '<span>No date</span>'}${FP.statusBadge(p.status)}${p.catalog ? `<span class="mono">${esc(p.catalog)}</span>` : ''}</div>
          <div class="c-meta">${[p.pm && `PM: ${esc(p.pm)}`, p.label && esc(p.label), p.doc_url && '📄 Doc'].filter(Boolean).join(' · ')}</div>
        </a>`).join('')}</div>` : '<div class="empty">No projects here yet.</div>';
    };
    main.querySelector('#p-q').oninput = e => { q = e.target.value; FP.setQuery({ q, show }); draw(); };
    main.querySelectorAll('#p-show button').forEach(b => b.onclick = () => { show = b.dataset.v; FP.setQuery({ q, show }); draw(); });
    draw();
  }

  // ── EDITOR ─────────────────────────────────────────────────
  async function renderEditor(main, id, params, page) {
    const isNew = id === 'new';
    let proj = isNew
      ? { artist: params.artist || '', title: '', status: FP.list('statuses')[0] || '', data: FP.projectInfo.blankData() }
      : await FP.get('/api/projects/' + id);
    proj.data = FP.projectInfo.normalize(proj.data);
    if (isNew && proj.artist) { const prof = FP.projectInfo.artistProfile(proj.artist); if (prof) FP.projectInfo.applyProfile(proj, prof); }
    let original = JSON.stringify(proj);
    let tab = isNew ? 'info' : (params.tab || 'info');
    const ro = !FP.canWrite();

    let presence = null;
    const setDirty = () => {
      const was = page.dirty;
      page.dirty = JSON.stringify(proj) !== original;
      if (presence && was !== page.dirty) presence.ping();
      const d = main.querySelector('#pe-dirty');
      if (d) d.textContent = page.dirty ? 'Unsaved changes' : '';
    };

    main.innerHTML = `
      <div class="page-head">
        <a class="btn-ghost" href="#/projects">← Projects</a>
        <h2 id="pe-title"></h2>
        ${!isNew ? '<span id="pe-presence" class="hint"></span>' : ''}
        <span id="pe-status"></span>
        ${!isNew ? `<span id="pe-doc"></span>` : ''}
      </div>
      ${!isNew ? `<div class="tabs"><button data-t="info">Project Info</button><button data-t="budget">Budget</button><button data-t="pnl">P&amp;L</button><button data-t="ads">Ads</button><button data-t="dates">Internal Dates</button><button data-t="social">Social</button></div>` : ''}
      <div class="page-body" id="pe-body"></div>
      <div class="savebar" id="pe-save">
        ${ro ? '<span class="hint">Read-only access</span>' : `<button class="btn-primary" id="pe-savebtn">${isNew ? 'Create project' : 'Save'}</button><span class="dirty" id="pe-dirty"></span>`}
        <span class="spacer"></span>
        ${!isNew && FP.canWrite() ? '<button class="btn-danger" id="pe-delete">Delete project</button>' : ''}
      </div>`;
    const $ = s => main.querySelector(s);
    const drawTitle = () => { $('#pe-title').textContent = proj.artist || proj.title ? `${proj.artist || '…'} — ${proj.title || '…'}` : 'New project'; };
    const drawDoc = () => {
      if (isNew || !$('#pe-doc')) return;
      $('#pe-doc').innerHTML = `${FP.safeUrl(proj.doc_url) ? `<a class="btn" href="${esc(proj.doc_url)}" target="_blank" rel="noopener">Open Google Doc ↗</a> ` : ''}
        ${FP.canWrite() ? `<button class="btn" id="pe-mkdoc">${proj.doc_id ? 'Update Google Doc' : 'Create Google Doc'}</button>` : ''}`;
      $('#pe-mkdoc')?.addEventListener('click', async e => {
        // Ask Google for Drive access first, while we're still inside the click,
        // so the permission popup isn't blocked. Then save and write.
        const token = driveToken();
        token.catch(() => {});
        if (page.dirty && !(await save())) return;
        e.target.disabled = true;
        try {
          const r = await writeGoogleDoc(proj, await token);
          if (r.doc_id !== proj.doc_id || r.doc_url !== proj.doc_url) {
            // Just these two fields, so no edit lock; updated_at stays as loaded so a later
            // full save still notices anyone else's save in between.
            await FP.put('/api/projects/' + proj.id, { doc_id: r.doc_id, doc_url: r.doc_url });
            const base = JSON.parse(original);
            for (const o of [proj, base]) { o.doc_id = r.doc_id; o.doc_url = r.doc_url; }
            original = JSON.stringify(base); setDirty();
          }
          FP.toast(r.created ? 'Google Doc created and shared with fatpossum.com. Use “Open Google Doc” to view it.' : 'Google Doc updated');
          drawDoc();
        } catch (err) { FP.toast(err.message, true); }
        finally { e.target.disabled = false; }
      });
    };
    const drawTab = () => {
      main.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
      // Project Info and Budget both edit the project itself, so they share the Save bar.
      $('#pe-save').classList.toggle('hidden', !['info', 'budget', 'pnl', 'ads'].includes(tab));
      if (tab === 'info') FP.projectInfo.render($('#pe-body'), proj, ro, () => { drawTitle(); setDirty(); }, { pullTour });
      if (tab === 'budget') FP.budget.render($('#pe-body'), proj, ro, setDirty, { pushSheet: () => pushSheet('budget') });
      if (tab === 'pnl') FP.pnl.render($('#pe-body'), proj, ro, setDirty);
      if (tab === 'ads') FP.ads.render($('#pe-body'), proj, ro, setDirty, { pushSheet: () => pushSheet('ads') });
      if (tab === 'dates') renderDates($('#pe-body'), proj);
      if (tab === 'social') renderProjectSocial($('#pe-body'), proj);
    };
    main.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
      if (['info', 'budget', 'pnl', 'ads'].includes(tab) && !['info', 'budget', 'pnl', 'ads'].includes(b.dataset.t) && page.dirty && !confirm('You have unsaved changes on Project Info. Switch tabs anyway? (They’ll stay until you leave the project.)')) return;
      tab = b.dataset.t; FP.setQuery({ tab: tab === 'info' ? '' : tab }); drawTab();
    });

    async function save() {
      if (!proj.artist || !proj.title) { FP.toast('Artist and title are required', true); return false; }
      const btn = $('#pe-savebtn'); if (btn) btn.disabled = true;
      try {
        proj.data.formats = proj.data.formats.filter(f => f.format || f.title || f.catalog || f.upc);
        const payload = { data: proj.data };
        for (const k of HEAD) payload[k] = proj[k] ?? '';
        const prev = JSON.parse(original);
        if (!isNew && prev.release_date && proj.release_date && prev.release_date !== proj.release_date) {
          const ms = await FP.get('/api/milestones?project_id=' + proj.id);
          if (ms.some(m => !m.done)) {
            const delta = Math.round((FP.parseYmd(proj.release_date) - FP.parseYmd(prev.release_date)) / 864e5);
            payload._shift_milestones = confirm(`Release date moved ${Math.abs(delta)} day${Math.abs(delta) === 1 ? '' : 's'} ${delta > 0 ? 'later' : 'earlier'}. Shift the open internal dates by the same amount?`);
          }
        }
        const { saved, mergedWith } = isNew ? { saved: await FP.saveRecord('projects', proj, payload) } : await putMerging(payload);
        saved.data = FP.projectInfo.normalize(saved.data);
        // The save taught the artist profile / contacts / playlist library; refresh them.
        await FP.loadBootstrap().catch(() => {});
        if (isNew) {
          page.dirty = false;
          if (saved.release_date && confirm('Project created. Add the standard internal dates (bio due, press photos, song pitching…) counted back from the release date?')) {
            await FP.post(`/api/projects/${saved.id}/milestones/generate`);
          }
          location.hash = '#/projects/' + saved.id;
          return true;
        }
        proj = saved; original = JSON.stringify(proj); setDirty();
        FP.toast(mergedWith ? `Saved, combined with ${mergedWith}’s changes` : 'Saved');
        drawTitle(); drawStatus(); drawTab();
        return true;
      } catch (e) {
        if (e.status !== 409 && !e.cancelled) FP.toast(e.message, true);
        return false;
      } finally { if (btn) btn.disabled = false; }
    }

    // Saves with the edit lock. If someone else saved since this page loaded, their
    // version is merged with ours (FP.merge3) and only true clashes are put to the user.
    async function putMerging(payload) {
      let base = JSON.parse(original), expected = proj.updated_at, mergedWith = null;
      const fields = o => ({ ...Object.fromEntries(HEAD.map(k => [k, o[k] ?? ''])), data: o.data });
      for (let attempt = 0; attempt < 4; attempt++) {
        try { return { saved: await FP.put('/api/projects/' + proj.id, { ...payload, _expected_updated_at: expected }), mergedWith }; }
        catch (e) {
          if (e.status !== 409 || !e.data?.current) throw e;
          const theirs = e.data.current;
          theirs.data = FP.projectInfo.normalize(theirs.data);
          const me = theirs.updated_by === FP.state.me?.email;
          const who = me ? 'You (in another window)' : FP.personName(theirs.updated_by);
          let r = FP.merge3(fields(base), fields(payload), fields(theirs));
          if (r.conflicts.length) {
            const picks = await FP.resolveConflicts(r.conflicts, who);
            if (!picks) { FP.toast('Not saved. Your changes are still here.', true); throw Object.assign(new Error('Cancelled'), { cancelled: true }); }
            r = FP.merge3(fields(base), fields(payload), fields(theirs), picks);
          }
          payload = { ...payload, ...r.value };
          base = theirs; expected = theirs.updated_at;
          if (!me) mergedWith = who;
        }
      }
      throw new Error('Couldn’t save: the project keeps changing. Try again in a moment.');
    }

    // Budget / Ads → each its own Google Sheet. Drive permission is asked for first, inside the
    // click (so the popup isn't blocked), then pending edits are saved and the sheet written.
    async function pushSheet(kind) {
      if (isNew) return FP.toast('Create the project first', true);
      const token = driveToken(); token.catch(() => {});
      if (page.dirty && !(await save())) return;
      try {
        const r = await writeSheet(proj, await token, SHEETS[kind]);
        proj.data[SHEETS[kind].key] = { id: r.id, tab: r.tab, url: r.url, updated: new Date().toISOString() };
        if (!(await save())) return;
        FP.toast(r.created ? 'Google Sheet created. It’s only visible to you until you share it.' : 'Google Sheet updated');
      } catch (e) { FP.toast(e.message, true); }
    }

    // Saves pending edits first, then the server merges Chartmetric listings into the stored tour list.
    async function pullTour() {
      if (isNew) return FP.toast('Create the project first', true);
      if (page.dirty && !(await save())) return;
      try {
        const r = await FP.post(`/api/projects/${proj.id}/tour/pull`);
        proj = r.project; proj.data = FP.projectInfo.normalize(proj.data); original = JSON.stringify(proj); setDirty();
        drawTab();
        FP.toast(r.found ? `Found ${r.found} listed show${r.found === 1 ? '' : 's'}: ${r.added} added, ${r.updated} updated` : 'No upcoming shows listed for this artist');
      } catch (e) { FP.toast(e.message, true); }
    }

    $('#pe-savebtn')?.addEventListener('click', save);
    $('#pe-delete')?.addEventListener('click', async () => {
      if (!confirm(`Delete "${proj.artist} — ${proj.title}"? Its internal dates are deleted too. Its release-schedule rows stay, unlinked from the project. The Google Doc is not deleted.`)) return;
      await FP.del('/api/projects/' + proj.id);
      page.dirty = false;
      location.hash = '#/projects';
    });
    const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key === 's' && tab === 'info' && !ro) { e.preventDefault(); save(); } };
    document.addEventListener('keydown', onKey);
    if (!isNew) {
      presence = FP.presence('projects/' + proj.id, () => page.dirty, (others, latest) => {
        const el = $('#pe-presence'); if (!el) return;
        const names = list => list.map(o => esc(o.name || FP.personName(o.email)));
        const editing = others.filter(o => o.editing), viewing = others.filter(o => !o.editing);
        const parts = [];
        if (editing.length) parts.push(`<b style="color:var(--yellow)">✎ ${names(editing).join(', ')} ${editing.length === 1 ? 'is' : 'are'} editing</b>`);
        if (viewing.length) parts.push(`👁 ${names(viewing).join(', ')} ${viewing.length === 1 ? 'has' : 'have'} this open`);
        // Someone else saved since we loaded: changes merge on save, or reload if nothing's pending.
        if (latest?.updated_at && latest.updated_at !== proj.updated_at && latest.updated_by !== FP.state.me?.email) {
          const who = esc(FP.personName(latest.updated_by));
          parts.push(page.dirty ? `${who} saved changes; yours will be combined when you save`
            : `${who} saved changes · <a href="#" data-reload>Load them</a>`);
        }
        el.innerHTML = parts.join(' · ');
      });
      $('#pe-presence')?.addEventListener('click', e => {
        if (!e.target.matches('[data-reload]')) return;
        e.preventDefault(); FP.navigate();
      });
    }
    page.destroy = () => { document.removeEventListener('keydown', onKey); presence?.stop(); };

    // Status toggle in the header. On a saved project it saves straight away (just
    // the status), keeping any other unsaved edits on the form intact.
    const drawStatus = () => { $('#pe-status').innerHTML = FP.statusToggle(proj.status, { disabled: ro }); };
    $('#pe-status').addEventListener('click', async e => {
      const b = e.target.closest('[data-status]');
      if (!b || ro || b.dataset.status === proj.status) return;
      if (isNew) { proj.status = b.dataset.status; drawStatus(); setDirty(); return; }
      try {
        // Just the status, so no edit lock; updated_at stays as loaded (see the Google Doc link above).
        const saved = await FP.put('/api/projects/' + proj.id, { status: b.dataset.status });
        const base = JSON.parse(original);
        for (const o of [proj, base]) o.status = saved.status;
        original = JSON.stringify(base);
        drawStatus(); setDirty();
        FP.toast(`Marked ${saved.status}`);
      } catch (err) { FP.toast(err.message, true); }
    });

    drawTitle(); drawStatus(); drawDoc(); drawTab();
  }

  // ── INTERNAL DATES (per project) ───────────────────────────
  async function renderDates(box, proj) {
    let ms = await FP.get('/api/milestones?project_id=' + proj.id);
    const w = FP.canWrite();
    box.innerHTML = `
      <div class="toolbar" style="margin-bottom:12px">
        ${w ? `<button class="btn" id="d-gen">Add standard dates from template</button><button class="btn" id="d-add">+ Custom date</button>` : ''}
        <span class="spacer"></span>
        <span class="hint">${proj.release_date ? `Release date: <b>${FP.fmtDate(proj.release_date)}</b>` : 'No release date set'}${FP.state.calendar.internal ? ' · Syncs with the internal Google Calendar' : ''}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,560px),1fr));gap:16px;align-items:start">
        <div id="d-list"></div><div id="d-cal"></div>
      </div>`;
    let cal;
    const draw = () => {
      ms.sort((a, b) => a.date.localeCompare(b.date));
      const today = FP.today();
      box.querySelector('#d-list').innerHTML = ms.length ? `<div class="tbl-wrap"><table class="tbl ${w ? 'edit' : ''}">
        <thead><tr><th style="width:30px">✓</th><th style="min-width:200px">Item</th><th style="min-width:140px">Date</th><th style="min-width:90px">vs release</th><th style="min-width:130px">Owner</th><th></th></tr></thead>
        <tbody>${ms.map(m => {
          const rel = proj.release_date ? Math.round((FP.parseYmd(m.date) - FP.parseYmd(proj.release_date)) / 864e5) : null;
          const late = !m.done && m.date < today;
          return `<tr data-id="${m.id}"${m.done ? ' class="past"' : ''}>
            <td style="text-align:center"><input type="checkbox" data-f="done"${m.done ? ' checked' : ''}${w ? '' : ' disabled'}></td>
            <td>${w ? `<input type="text" data-f="title" value="${esc(m.title)}">` : esc(m.title)}</td>
            <td>${w ? `<input type="date" data-f="date" value="${m.date}"${late ? ' style="color:var(--red);font-weight:600"' : ''}>` : FP.fmtDate(m.date)}</td>
            <td class="mono" style="color:var(--text-muted)">${rel === null ? '' : rel === 0 ? 'release day' : rel < 0 ? `${-rel}d before` : `${rel}d after`}</td>
            <td>${w ? `<select data-f="owner">${FP.options(FP.userNames(), m.owner)}</select>` : esc(m.owner)}</td>
            <td class="row-actions"><button class="btn-ghost btn-sm" data-open>⋯</button></td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">No internal dates yet. Add the standard set from the template, or add custom dates.</div>';
      box.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('change', async () => {
        const m = ms.find(x => x.id === inp.closest('tr').dataset.id);
        const v = inp.type === 'checkbox' ? inp.checked : inp.value;
        try { Object.assign(m, await FP.saveRecord('milestones', m, { [inp.dataset.f]: v })); draw(); }
        catch (e) { if (e.status !== 409) FP.toast(e.message, true); draw(); }
      }));
      box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openMilestone(ms.find(x => x.id === b.closest('tr').dataset.id), reload));
      if (cal) cal.destroy();
      cal = new FullCalendar.Calendar(box.querySelector('#d-cal'), {
        initialView: 'dayGridMonth', initialDate: ms.find(m => !m.done && m.date >= today)?.date || proj.release_date || undefined,
        headerToolbar: { left: 'prev,next', center: 'title', right: 'today' }, height: 'auto', editable: w,
        events: [
          ...(proj.release_date ? [{ title: '★ Release', start: proj.release_date, allDay: true, backgroundColor: '#b83228', borderColor: '#b83228', editable: false }] : []),
          ...ms.map(m => ({ id: m.id, title: (m.done ? '✓ ' : '') + m.title, start: m.date, allDay: true, backgroundColor: m.done ? '#e6f4ed' : '#fef3dc', borderColor: m.done ? '#9fd0b4' : '#e6c77d', textColor: m.done ? '#1e7e4a' : '#8a5c08' })),
        ],
        eventDrop: async info => {
          const m = ms.find(x => x.id === info.event.id);
          try { Object.assign(m, await FP.saveRecord('milestones', m, { date: FP.ymd(info.event.start) })); draw(); }
          catch (e) { info.revert(); if (e.status !== 409) FP.toast(e.message, true); }
        },
        eventClick: info => { const m = ms.find(x => x.id === info.event.id); if (m) openMilestone(m, reload); },
        dateClick: w ? info => openMilestone({ project_id: proj.id, date: info.dateStr, title: '' }, reload) : undefined,
      });
      cal.render();
    };
    const reload = async () => { ms = await FP.get('/api/milestones?project_id=' + proj.id); draw(); };
    box.querySelector('#d-gen')?.addEventListener('click', async () => {
      try { const r = await FP.post(`/api/projects/${proj.id}/milestones/generate`); FP.toast(r.created ? `Added ${r.created} dates` : 'All template dates are already on this project'); reload(); }
      catch (e) { FP.toast(e.message, true); }
    });
    box.querySelector('#d-add')?.addEventListener('click', () => openMilestone({ project_id: proj.id, date: FP.today(), title: '' }, reload));
    draw();
  }

  // ── MILESTONE MODAL ────────────────────────────────────────
  let _projCache = null;
  async function projectsForSelect() {
    if (!_projCache) _projCache = await FP.get('/api/projects');
    return _projCache;
  }

  async function openMilestone(m, after) {
    const projects = await projectsForSelect();
    const w = FP.canWrite();
    FP.modal({
      title: m.id ? 'Internal date' : 'New internal date',
      body: `<div class="grid">
        ${FP.field('Item', `<input type="text" name="title" value="${esc(m.title)}" placeholder="e.g. Bio due">`, 'wide')}
        ${FP.field('Date', `<input type="date" name="date" value="${esc(m.date)}">`)}
        ${FP.field('Owner', `<select name="owner">${FP.options(FP.userNames(), m.owner)}</select>`)}
        ${FP.field('Project', `<select name="project_id"><option value="">— Unassigned —</option>${projects.map(p => `<option value="${p.id}"${p.id === m.project_id ? ' selected' : ''}>${esc(p.artist)} — ${esc(p.title)}</option>`).join('')}</select>`, 'wide')}
        ${FP.field('Notes', `<textarea name="notes">${esc(m.notes)}</textarea>`, 'wide')}
        <label><input type="checkbox" name="done"${m.done ? ' checked' : ''}> Done</label>
      </div>`,
      onSave: w ? async el => {
        const f = FP.readForm(el);
        if (!f.title || !f.date) throw new Error('Item and date are required');
        if (!m.id) f.type = 'custom';
        await FP.saveRecord('milestones', m, f);
        after?.();
      } : null,
      onDelete: m.id && w ? async () => { await FP.del('/api/milestones/' + m.id); after?.(); } : null,
    });
  }
  FP.openMilestone = openMilestone;

  // ── PROJECT SOCIAL TAB ─────────────────────────────────────
  async function renderProjectSocial(box, proj) {
    const posts = (await FP.get('/api/social?artist=' + encodeURIComponent(proj.artist))).filter(p => !p.project_id || p.project_id === proj.id);
    box.innerHTML = `<div class="toolbar" style="margin-bottom:12px">
        <a class="btn" href="#/social?artist=${encodeURIComponent(proj.artist)}">Open ${esc(proj.artist)} in the Social Schedule →</a></div>
      ${posts.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Platform</th><th>Type</th><th>Caption</th><th>Status</th></tr></thead><tbody>
        ${posts.map(p => `<tr><td class="mono">${FP.fmtDate(p.date)}${p.time ? ' ' + esc(p.time) : ''}</td><td>${esc(p.platform)}</td><td>${esc(p.post_type)}</td>
          <td style="max-width:420px">${esc((p.caption || '').slice(0, 140))}</td><td>${FP.statusBadge(p.status)}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">No social posts planned for ${esc(proj.artist)} yet.</div>`}`;
  }

  // ── ALL INTERNAL DATES (#/dates) ───────────────────────────
  FP.route('dates', async (main, _rest, params) => {
    const [ms, projects] = await Promise.all([FP.get('/api/milestones'), FP.get('/api/projects')]);
    _projCache = projects;
    const pIdx = Object.fromEntries(projects.map(p => [p.id, p]));
    let view = params.view || 'list', owner = params.owner || '', showDone = params.done === '1';
    main.innerHTML = `
      <div class="page-head"><h2>Internal Dates</h2>
        <div class="seg" id="i-view"><button data-v="list">List</button><button data-v="calendar">Calendar</button></div>
        ${FP.canWrite() ? '<button class="btn-primary" id="i-add">+ Date</button>' : ''}</div>
      <div class="page-body">
        <div class="toolbar" style="margin-bottom:12px">
          <select id="i-owner">${FP.options(FP.userNames(), owner, { blankLabel: 'All owners' })}</select>
          <label><input type="checkbox" id="i-done"${showDone ? ' checked' : ''}> Show completed</label>
          <span class="spacer"></span>
          <span class="hint">${FP.state.calendar.internal ? 'Synced both ways with the internal Google Calendar' : 'Google Calendar sync is not configured yet'}</span>
        </div>
        <div id="i-box"></div></div>`;
    const $ = s => main.querySelector(s);
    const label = m => { const p = pIdx[m.project_id]; return p ? `${p.artist} — ${p.title}` : 'Unassigned'; };
    let cal;
    const draw = () => {
      FP.setQuery({ view: view === 'list' ? '' : view, owner, done: showDone ? '1' : '' });
      main.querySelectorAll('#i-view button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
      if (cal) { cal.destroy(); cal = null; }
      const list = ms.filter(m => (!owner || m.owner === owner) && (showDone || !m.done));
      const box = $('#i-box');
      if (view === 'calendar') {
        box.innerHTML = '<div></div>';
        cal = new FullCalendar.Calendar(box.firstChild, {
          initialView: 'dayGridMonth', headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,dayGridWeek,listMonth' },
          buttonText: { today: 'Today', month: 'Month', week: 'Week', list: 'List' }, height: 'auto', editable: FP.canWrite(), dayMaxEvents: 6,
          events: list.map(m => ({ id: m.id, title: `${m.done ? '✓ ' : ''}${pIdx[m.project_id]?.artist ? pIdx[m.project_id].artist + ': ' : ''}${m.title}`, start: m.date, allDay: true,
            backgroundColor: FP.statusColor(pIdx[m.project_id]?.status), borderColor: FP.statusColor(pIdx[m.project_id]?.status), textColor: FP.statusTextColor(pIdx[m.project_id]?.status) })),
          eventClick: info => openMilestone(ms.find(x => x.id === info.event.id), () => FP.navigate()),
          eventDrop: async info => {
            const m = ms.find(x => x.id === info.event.id);
            try { Object.assign(m, await FP.saveRecord('milestones', m, { date: FP.ymd(info.event.start) })); }
            catch (e) { info.revert(); if (e.status !== 409) FP.toast(e.message, true); }
          },
        });
        cal.render();
        return;
      }
      const today = FP.today(), wk = FP.addDays(today, 7), two = FP.addDays(today, 14);
      const buckets = [
        ['Overdue', m => !m.done && m.date < today],
        ['This week', m => m.date >= today && m.date < wk],
        ['Next week', m => m.date >= wk && m.date < two],
        ['Later', m => m.date >= two],
        ['Earlier (done)', m => m.done && m.date < today],
      ];
      let html = '';
      for (const [name, test] of buckets) {
        const items = list.filter(test).sort((a, b) => a.date.localeCompare(b.date));
        if (!items.length) continue;
        html += `<tr class="group"><td colspan="5">${name} · ${items.length}</td></tr>` + items.map(m => `
          <tr data-id="${m.id}"${m.done ? ' class="past"' : ''} style="cursor:pointer">
            <td class="mono" style="${name === 'Overdue' ? 'color:var(--red);font-weight:600' : ''}">${FP.fmtDate(m.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
            <td><span class="dot" style="background:${FP.statusColor(pIdx[m.project_id]?.status)}"></span>${esc(label(m))}</td>
            <td>${m.done ? '✓ ' : ''}${esc(m.title)}</td><td>${esc(m.owner)}</td>
            <td class="row-actions">${m.project_id ? `<a class="btn-ghost btn-sm" href="#/projects/${m.project_id}?tab=dates">Project ↗</a>` : ''}</td></tr>`).join('');
      }
      box.innerHTML = html ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Project</th><th>Item</th><th>Owner</th><th></th></tr></thead><tbody>${html}</tbody></table></div>`
        : '<div class="empty">Nothing here. 🎉</div>';
      box.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', e => {
        if (e.target.closest('a')) return;
        openMilestone(ms.find(x => x.id === tr.dataset.id), () => FP.navigate());
      }));
    };
    main.querySelectorAll('#i-view button').forEach(b => b.onclick = () => { view = b.dataset.v; draw(); });
    $('#i-owner').onchange = e => { owner = e.target.value; draw(); };
    $('#i-done').onchange = e => { showDone = e.target.checked; draw(); };
    $('#i-add')?.addEventListener('click', () => openMilestone({ date: FP.today(), title: '' }, () => FP.navigate()));
    draw();
  });

  // ── GOOGLE DOC EXPORT ──────────────────────────────────────
  // Runs in the browser with the signed-in user's own Drive permission
  // (drive.file scope: the app can only see files it created). The HTML is
  // uploaded and converted to a Google Doc; "Update" re-uploads over it.
  let _driveToken = null;
  function driveToken() {
    if (_driveToken && _driveToken.exp > Date.now() + 60e3) return Promise.resolve(_driveToken.token);
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) return reject(new Error('Google sign-in hasn’t loaded yet. Try again in a moment.'));
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file',
        hint: FP.state.me.email,
        callback: r => {
          if (r.error) return reject(new Error('Google Drive permission was not granted'));
          _driveToken = { token: r.access_token, exp: Date.now() + r.expires_in * 1000 };
          resolve(r.access_token);
        },
        error_callback: e => reject(new Error(
          e.type === 'popup_failed_to_open' ? 'Your browser blocked the Google window. Allow pop-ups for this site and try again.'
          : e.type === 'popup_closed' ? 'The Google window was closed before access was granted.'
          : (e.message || 'Google sign-in failed'))),
      });
      client.requestAccessToken({ prompt: '' });
    });
  }

  const SHEETS = {
    budget: { key: 'budget_sheet', name: 'Budget', spec: p => FP.budget.sheetSpec(p), rows: p => FP.budget.sheetRows(p) },
    ads: { key: 'ads_sheet', name: 'Ads', spec: p => FP.ads.sheetSpec(p), rows: p => FP.ads.sheetRows(p) },
  };

  async function writeSheet(proj, token, kind) {
    const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const sheetErr = async (r, what) => {
      const t = await r.text();
      if (/SERVICE_DISABLED|has not been used|is disabled/i.test(t)) return new Error('The Google Sheets API isn’t turned on for this app yet. An admin needs to enable it in Google Cloud (APIs & Services → Library → Google Sheets API).');
      return new Error(`Google Sheet ${what} failed: ${t.slice(0, 200)}`);
    };
    const existing = proj.data[kind.key];
    if (existing?.id && existing.tab != null) {
      const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${existing.id}:batchUpdate`, {
        method: 'POST', headers: H, body: JSON.stringify({ requests: [
          { updateCells: { range: { sheetId: existing.tab }, fields: 'userEnteredValue,userEnteredFormat' } },          // clear
          { updateCells: { start: { sheetId: existing.tab, rowIndex: 0, columnIndex: 0 }, rows: kind.rows(proj), fields: 'userEnteredValue,userEnteredFormat' } },
          { updateSpreadsheetProperties: { properties: { title: `${proj.artist} — ${proj.title} (${kind.name})` }, fields: 'title' } },
        ] }),
      });
      if (r.ok) return { id: existing.id, tab: existing.tab, url: existing.url };
      if (r.status !== 404 && r.status !== 403) throw await sheetErr(r, 'update');
      if (!confirm(`The existing ${kind.name.toLowerCase()} sheet could not be found (it may have been deleted, or was created by someone else). Create a new one?`)) throw new Error('Cancelled');
    }
    const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', headers: H, body: JSON.stringify(kind.spec(proj)) });
    if (!r.ok) throw await sheetErr(r, 'creation');
    const sh = await r.json();
    // File it in the project docs folder when one is set (best effort).
    const folder = FP.state.settings.drive_folder_id;
    if (folder) await fetch(`https://www.googleapis.com/drive/v3/files/${sh.spreadsheetId}?addParents=${encodeURIComponent(folder)}&supportsAllDrives=true`, { method: 'PATCH', headers: H, body: '{}' }).catch(() => {});
    return { id: sh.spreadsheetId, tab: sh.sheets?.[0]?.properties?.sheetId ?? 0, url: sh.spreadsheetUrl, created: true };
  }

  async function writeGoogleDoc(proj, token) {
    const html = FP.projectInfo.buildDocHtml(proj);
    const name = `${proj.artist} — ${proj.name || proj.title} (Project Doc)`;
    if (proj.doc_id) {
      const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${proj.doc_id}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, {
        method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=fpdoc' },
        body: multipart({ name }, html),
      });
      if (r.ok) { const f = await r.json(); return { doc_id: f.id, doc_url: f.webViewLink }; }
      if (r.status !== 404 && r.status !== 403) throw new Error('Google Doc update failed: ' + (await r.text()).slice(0, 200));
      if (!confirm('The existing Google Doc could not be found (it may have been deleted, or was created by someone else). Create a new one?')) throw new Error('Cancelled');
    }
    const folder = FP.state.settings.drive_folder_id;
    const create = async parents => fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=fpdoc' },
      body: multipart({ name, mimeType: 'application/vnd.google-apps.document', ...(parents ? { parents } : {}) }, html),
    });
    let r = await create(folder ? [folder] : null);
    if (!r.ok && folder) {
      FP.toast('Couldn’t write to the configured Drive folder, so the doc was saved to your My Drive instead. Check the folder ID in Settings.', true);
      r = await create(null);
    }
    if (!r.ok) throw new Error('Google Doc creation failed: ' + (await r.text()).slice(0, 200));
    const f = await r.json();
    // Anyone at fatpossum.com can view. The app is the source of truth, so edits go in the app.
    await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}/permissions?supportsAllDrives=true&sendNotificationEmail=false`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'domain', domain: 'fatpossum.com', role: 'reader' }),
    }).catch(() => {});
    return { doc_id: f.id, doc_url: f.webViewLink, created: true };
  }

  function multipart(meta, html) {
    return `--fpdoc\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--fpdoc\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--fpdoc--`;
  }

})();
