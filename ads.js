/* ============================================================
   ADS — per-project ad budget splitter + ad plan (Ads tab)
   Campaigns grouped by phase, with booking status, dates, budget,
   spend and results, plus targeting. Stored in project.data.ads,
   saved with the project, never in the Google Doc.
   ============================================================ */
(function () {
  const esc = FP.esc;
  const key = () => crypto.randomUUID().slice(0, 8);
  const num = v => (v === '' || v == null || !Number.isFinite(Number(v))) ? 0 : Number(v);
  const money = n => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

  const PLATFORMS = ['YouTube', 'Meta (IG / FB)', 'Spotify Marquee', 'Spotify Showcase', 'TikTok', 'Amazon (AMS)', 'Google Ads', 'Snapchat', 'Reddit', 'X', 'Other'];
  const AD_TYPES = ['Multi-Format Video', 'In-Stream Video', 'Video Views', 'Traffic', 'Conversions', 'Reach', 'Engagement', 'Marquee', 'Showcase', 'Spark Ads', 'Sponsored Products'];
  // Where each platform's totals go on the Budget tab's Online / Digital Marketing category.
  const BUDGET_LINE = { 'YouTube': 'YouTube', 'Meta (IG / FB)': 'Facebook / Instagram', 'Spotify Marquee': 'DSP / Playlisting', 'Spotify Showcase': 'DSP / Playlisting',
    'TikTok': 'TikTok', 'Amazon (AMS)': 'Amazon (AMS)', 'Google Ads': 'Google Ads', 'X': 'Twitter', 'Snapchat': 'Other social ads', 'Reddit': 'Other social ads', 'Other': 'Third Party Ads (NPR / Aquarium Drunkard, etc.)' };

  const REMARKETING = ['Facebook / Instagram: 3-second video views (365 days)', 'Facebook / Instagram: 10-second video views (365 days)', 'Facebook engagement (365 days)',
    'Instagram engagement (365 days)', 'Event responses (365 days)', 'YouTube: channel views (540 days)', 'YouTube: subscribers (540 days)', 'Artist remarketing', 'Fat Possum remarketing'];

  function defaults(proj) {
    return {
      approved: '', campaigns: [],
      targets: { remarketing: REMARKETING.join('\n'), artists: String(proj.data.riyl || '').split(/\s*,\s*/).filter(Boolean).join('\n'), media: '' },
    };
  }
  const blankCampaign = phase => ({ key: key(), phase: phase || '', name: '', platform: '', ad_type: '', start: '', end: '', territory: '', budget: '', spent: '', results: '',
    booked: false, preview: false, live: false, ad_sets: '', optimisation: '', age: '', copy: '', creative: '', link: '' });
  const days = c => c.start && c.end && c.end >= c.start ? Math.round((FP.parseYmd(c.end) - FP.parseYmd(c.start)) / 864e5) : '';
  const onlineBudget = proj => {
    const g = (proj.data.budget?.groups || []).find(x => /online|digital/i.test(x.name));
    return g ? FP.budget.totals({ groups: [g] }).b : 0;
  };

  function render(box, proj, ro, onChange) {
    const fresh = box.cloneNode(false); box.replaceWith(fresh); box = fresh;
    const ads = proj.data.ads ? Object.assign(defaults(proj), proj.data.ads) : defaults(proj);
    const changed = () => { if (proj.data.ads !== ads) proj.data.ads = ads; onChange(); };
    const dis = ro ? ' disabled' : '';
    const songs = [...new Set([...(proj.data.tracks || []).map(t => t.song), ...String(proj.data.focus_tracks || '').split(',').map(x => x.trim())].filter(Boolean))];
    const phaseIdeas = [...new Set([...songs.map(s => `Single — ${s}`), 'Single 1', 'Single 2', 'Single 3', 'Album announce', 'Pre-orders', 'Album release', 'Tour', 'In-store', 'Standalone', 'Contingency'])];
    const smart = (proj.data.smart_links || []).filter(x => FP.safeUrl(x.url));

    const summary = () => {
      const planned = ads.campaigns.reduce((t, c) => t + num(c.budget), 0), spent = ads.campaigns.reduce((t, c) => t + num(c.spent), 0);
      const approved = num(ads.approved), unalloc = approved - planned;
      const card = (label, v, sub, warn) => `<div class="card" style="cursor:default;gap:3px${warn ? ';border-color:var(--red)' : ''}"><div class="c-artist">${label}</div>
        <div style="font-size:18px;font-weight:600${warn ? ';color:var(--red)' : ''}">${money(v)}</div>${sub ? `<div class="hint">${sub}</div>` : ''}</div>`;
      const byPlat = {}, byPhase = {};
      for (const c of ads.campaigns) {
        const p = c.platform || 'No platform', ph = c.phase || 'No phase';
        (byPlat[p] ||= { b: 0, s: 0 }); byPlat[p].b += num(c.budget); byPlat[p].s += num(c.spent);
        (byPhase[ph] ||= { b: 0, s: 0 }); byPhase[ph].b += num(c.budget); byPhase[ph].s += num(c.spent);
      }
      const breakdown = (title, obj) => Object.keys(obj).length ? `<div><div class="hint" style="font-weight:600;margin-bottom:3px">${title}</div>${Object.entries(obj).sort((a, b) => b[1].b - a[1].b).map(([k, v]) =>
        `<div style="display:flex;gap:8px;font-size:12px"><span style="flex:1">${esc(k)}</span><span>${money(v.b)}</span><span class="hint" style="width:90px;text-align:right">${money(v.s)} spent</span></div>`).join('')}</div>` : '';
      return `<div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-bottom:10px">
          <div class="card" style="cursor:default;gap:3px"><div class="c-artist">Approved budget</div>
            <div style="display:flex;gap:6px;align-items:center">$<input type="number" min="0" step="any" data-approved value="${esc(ads.approved)}" placeholder="0"${dis} style="width:110px;font-size:16px;font-weight:600"></div>
            ${onlineBudget(proj) && num(ads.approved) !== onlineBudget(proj) && !ro ? `<a href="#" class="hint" data-use-budget>Use Budget's online / digital figure (${money(onlineBudget(proj))})</a>` : '<span class="hint">what the label signed off</span>'}</div>
          ${card('Planned', planned, approved ? `${Math.round(planned / approved * 100)}% of approved` : '', approved && planned > approved)}
          ${card('Spent', spent, planned ? `${money(planned - spent)} still to spend` : '')}
          ${card(unalloc < 0 ? 'Over approved' : 'Unallocated', Math.abs(unalloc), unalloc < 0 ? 'planned more than approved' : 'approved but not yet planned', unalloc < 0)}
        </div>
        ${ads.campaigns.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-bottom:12px">${breakdown('By platform', byPlat)}${breakdown('By phase', byPhase)}</div>` : ''}`;
    };

    const table = () => {
      // Phases in the order they first appear; campaigns keep their own order inside a phase.
      const phases = [...new Set(ads.campaigns.map(c => c.phase || ''))];
      const ck = (i, k, label) => `<label title="${label}" style="display:inline-flex;gap:2px;align-items:center;font-size:10px;color:var(--text-muted)"><input type="checkbox" data-ac="${i}" data-k="${k}"${ads.campaigns[i][k] ? ' checked' : ''}${dis}>${label[0]}</label>`;
      const row = i => { const c = ads.campaigns[i], a = `data-ai="${i}"${dis}`; return `<tr>
        <td><input type="text" ${a} data-k="name" value="${esc(c.name)}" placeholder="e.g. Music video – YT"></td>
        <td><select ${a} data-k="platform">${FP.options(PLATFORMS, c.platform)}</select></td>
        <td><input type="text" ${a} data-k="ad_type" value="${esc(c.ad_type)}" list="dl-adtypes"></td>
        <td><input type="date" ${a} data-k="start" value="${esc(c.start)}"></td>
        <td><input type="date" ${a} data-k="end" value="${esc(c.end)}"></td>
        <td class="mono" style="text-align:center;color:var(--text-muted)" data-days="${i}">${days(c)}</td>
        <td><input type="text" ${a} data-k="territory" value="${esc(c.territory)}" placeholder="US, UK…"></td>
        <td><input type="number" min="0" step="any" ${a} data-k="budget" value="${esc(c.budget)}" placeholder="0"></td>
        <td><input type="number" min="0" step="any" ${a} data-k="spent" value="${esc(c.spent)}" placeholder="0"></td>
        <td><input type="text" ${a} data-k="results" value="${esc(c.results)}" placeholder="views, clicks…"></td>
        <td style="white-space:nowrap">${ck(i, 'booked', 'Booked')} ${ck(i, 'preview', 'Preview')} ${ck(i, 'live', 'Live')}</td>
        <td style="white-space:nowrap"><button class="btn-ghost btn-sm" data-adetail="${i}" title="Targeting, copy, creative, link">⋯</button>${ro ? '' : `<button class="btn-ghost btn-sm" data-adel="${i}" title="Remove">✕</button>`}</td></tr>`; };
      return `<datalist id="dl-adtypes">${AD_TYPES.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
        <datalist id="dl-adphases">${phaseIdeas.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
        ${phases.map(ph => {
          const idx = ads.campaigns.map((c, i) => [c, i]).filter(([c]) => (c.phase || '') === ph).map(([, i]) => i);
          const b = idx.reduce((t, i) => t + num(ads.campaigns[i].budget), 0), s = idx.reduce((t, i) => t + num(ads.campaigns[i].spent), 0);
          return `<div class="form-section" style="margin-bottom:8px;background:#fff">
            <h3 style="text-transform:none;letter-spacing:0;gap:8px;padding:5px 8px">
              <input type="text" data-phase="${esc(ph)}" value="${esc(ph)}" list="dl-adphases" placeholder="Phase, e.g. Single 1"${dis} style="font-weight:600;flex:1;max-width:320px">
              <span class="spacer"></span><span class="hint">${money(b)} planned · ${money(s)} spent</span></h3>
            <div class="fs-body" style="padding:4px 6px 6px;overflow-x:auto"><div class="rep compact"><table style="min-width:1100px">
              <thead><tr><th style="min-width:170px">Campaign</th><th style="width:140px">Platform</th><th style="width:130px">Ad type</th><th style="width:130px">Start</th><th style="width:130px">End</th><th style="width:40px">Days</th>
                <th style="width:110px">Territory</th><th style="width:90px">Budget</th><th style="width:90px">Spent</th><th style="min-width:140px">Results</th><th style="width:90px">Status</th><th></th></tr></thead>
              <tbody>${idx.map(row).join('')}</tbody></table>
              ${ro ? '' : `<button class="btn btn-sm add" data-aadd="${esc(ph)}">+ Add campaign</button>`}</div></div></div>`;
        }).join('') || '<p class="hint" style="margin:6px 0 10px">No campaigns yet.</p>'}
        ${ro ? '' : `<div class="toolbar"><button class="btn btn-sm" data-anewphase>+ New phase</button>
          <span class="spacer"></span><button class="btn btn-sm" data-to-budget>Send totals to Budget</button></div>`}`;
    };

    const targets = () => `<section class="form-section" style="margin-top:14px"><h3>Targets</h3><div class="fs-body">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
        ${[['remarketing', 'Social remarketing'], ['artists', 'Related artists'], ['media', 'Related media / interests']].map(([k, l]) =>
          `<div class="field"><label>${l} <span class="hint">(one per line)</span></label><textarea data-tk="${k}" rows="8"${dis}>${esc(ads.targets[k])}</textarea></div>`).join('')}
      </div>${!ro && proj.data.riyl ? '<p class="hint" style="margin-top:6px"><a href="#" data-riyl>Add the project’s RIYL to related artists</a></p>' : ''}</div></section>`;

    const draw = () => {
      box.innerHTML = `<p class="hint" style="margin-bottom:10px">Plan and track paid campaigns for this release. Saves with the project's <b>Save</b> button; not included in the Google Doc.</p>
        <div id="ad-summary">${summary()}</div><div id="ad-table">${table()}</div>${targets()}`;
    };
    const refreshSummary = () => { box.querySelector('#ad-summary').innerHTML = summary(); };

    box.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.approved !== undefined) { ads.approved = t.value; changed(); refreshSummary(); return; }
      if (t.dataset.tk) { ads.targets[t.dataset.tk] = t.value; changed(); return; }
      if (t.dataset.ai !== undefined && t.type !== 'checkbox') {
        const c = ads.campaigns[+t.dataset.ai]; c[t.dataset.k] = t.value; changed();
        if (['start', 'end'].includes(t.dataset.k)) { const d = box.querySelector(`[data-days="${t.dataset.ai}"]`); if (d) d.textContent = days(c); }
        if (['budget', 'spent', 'platform'].includes(t.dataset.k)) refreshSummary();
      }
    });
    box.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.ac !== undefined) { ads.campaigns[+t.dataset.ac][t.dataset.k] = t.checked; changed(); }
      // Renaming a phase renames it for all its campaigns.
      if (t.dataset.phase !== undefined) {
        for (const c of ads.campaigns) if ((c.phase || '') === t.dataset.phase) c.phase = t.value.trim();
        changed(); box.querySelector('#ad-table').innerHTML = table(); refreshSummary();
      }
    });
    box.addEventListener('click', e => {
      const t = e.target.closest('button, a'); if (!t) return;
      if (t.matches('[data-use-budget]')) { e.preventDefault(); ads.approved = String(onlineBudget(proj)); changed(); refreshSummary(); }
      if (t.matches('[data-riyl]')) {
        e.preventDefault();
        const have = new Set(String(ads.targets.artists).split('\n').map(x => x.trim().toLowerCase()).filter(Boolean));
        const add = String(proj.data.riyl).split(/\s*,\s*/).filter(x => x && !have.has(x.toLowerCase()));
        ads.targets.artists = [String(ads.targets.artists).trim(), ...add].filter(Boolean).join('\n'); changed(); draw();
      }
      if (t.dataset.aadd !== undefined) {
        // Insert after the phase's last campaign so the phase stays together.
        const last = ads.campaigns.map(c => c.phase || '').lastIndexOf(t.dataset.aadd);
        ads.campaigns.splice(last + 1, 0, blankCampaign(t.dataset.aadd)); changed();
        box.querySelector('#ad-table').innerHTML = table(); refreshSummary();
        box.querySelector(`[data-ai="${last + 1}"][data-k="name"]`)?.focus();
      }
      if (t.matches('[data-anewphase]')) {
        ads.campaigns.push(blankCampaign(''));
        changed(); box.querySelector('#ad-table').innerHTML = table(); refreshSummary();
        box.querySelector('[data-phase=""]')?.focus();
      }
      if (t.dataset.adel !== undefined) {
        const c = ads.campaigns[+t.dataset.adel];
        if ((num(c.budget) || num(c.spent)) && !confirm(`Remove “${c.name || 'this campaign'}”?`)) return;
        ads.campaigns.splice(+t.dataset.adel, 1); changed(); box.querySelector('#ad-table').innerHTML = table(); refreshSummary();
      }
      if (t.dataset.adetail !== undefined) openDetail(+t.dataset.adetail);
      if (t.matches('[data-to-budget]')) sendToBudget();
    });

    function openDetail(i) {
      const c = ads.campaigns[i];
      FP.modal({
        title: c.name || 'Campaign details', wide: true, saveLabel: 'Done',
        body: `<div class="grid">
          ${FP.field('Ad sets / audiences', `<textarea name="ad_sets" rows="3" placeholder="e.g. Artist remarketing | Fat Possum remarketing | Related artists">${esc(c.ad_sets)}</textarea>`, 'wide')}
          ${FP.field('Optimisation', `<input type="text" name="optimisation" value="${esc(c.optimisation)}" placeholder="e.g. Video views">`)}
          ${FP.field('Age', `<input type="text" name="age" value="${esc(c.age)}" placeholder="e.g. 18-45">`)}
          ${FP.field('Copy', `<textarea name="copy" rows="3">${esc(c.copy)}</textarea>`, 'wide')}
          ${FP.field('Creative', `<input type="text" name="creative" value="${esc(c.creative)}" placeholder="e.g. music video, lyric video">`)}
          <div class="field"><label>Link</label><input type="url" name="link" value="${esc(c.link)}" list="dl-adlinks"><datalist id="dl-adlinks">${smart.map(x => `<option value="${esc(x.url)}">${esc(x.label || '')}</option>`).join('')}</datalist></div>
        </div>`,
        onSave: ro ? null : el => { Object.assign(c, FP.readForm(el)); changed(); },
      });
    }

    // Writes planned / spent per platform into the Budget tab's Online / Digital Marketing lines.
    function sendToBudget() {
      if (!proj.data.budget?.groups) proj.data.budget = FP.budget.template();
      const groups = proj.data.budget.groups;
      let g = groups.find(x => /online|digital/i.test(x.name));
      if (!g) { g = { key: key(), area: 'marketing', name: 'Online / Digital Marketing', lines: [] }; groups.push(g); }
      const totals = {};
      for (const c of ads.campaigns) {
        if (!c.platform || (!num(c.budget) && !num(c.spent))) continue;
        const line = BUDGET_LINE[c.platform] || c.platform;
        (totals[line] ||= { b: 0, s: 0 }); totals[line].b += num(c.budget); totals[line].s += num(c.spent);
      }
      const names = Object.keys(totals);
      if (!names.length) return FP.toast('Add campaigns with a platform and budget first', true);
      if (!confirm(`Set these lines in the Budget's “${g.name}” category?\n\n${names.map(n => `${n}: ${money(totals[n].b)} budgeted, ${money(totals[n].s)} paid`).join('\n')}\n\nOther Budget lines aren't changed. Save afterwards to keep it.`)) return;
      for (const n of names) {
        let l = g.lines.find(x => String(x.account).toLowerCase() === n.toLowerCase());
        if (!l) { l = { key: key(), account: n, budgeted: '', paid: '', notes: '' }; g.lines.push(l); }
        l.budgeted = String(totals[n].b); l.paid = String(totals[n].s); l.notes = l.notes || 'From the Ads tab';
      }
      onChange();
      FP.toast(`Updated ${names.length} Budget line${names.length === 1 ? '' : 's'}. Save to keep it.`);
    }

    draw();
  }

  FP.ads = { render, defaults };
})();
