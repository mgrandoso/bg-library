/* ================= Ludoteca — app ================= */
'use strict';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeImg = (u) => (typeof u === 'string' && /^https:\/\//.test(u)) ? u : '';
function node(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
async function api(path, opts) {
  const r = await fetch('/api' + path, opts);
  if (!r.ok) { let e; try { e = (await r.json()).error; } catch {} throw new Error(e || r.status); }
  return r.status === 204 ? null : r.json();
}
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- constantes de dominio ---------- */
const SUBDOMAIN = {
  'Strategy Games': ['Estrategia', 'var(--m-strategy)'],
  'Family Games': ['Familiar', 'var(--m-family)'],
  'Party Games': ['Fiesta', 'var(--m-party)'],
  'Thematic Games': ['Temático', 'var(--m-thematic)'],
  'Wargames': ['Wargame', 'var(--m-war)'],
  'Abstract Games': ['Abstracto', 'var(--m-abstract)'],
  'Customizable Games': ['Coleccionable', 'var(--m-custom)'],
  "Children's Games": ['Infantil', 'var(--m-children)'],
};
const WEIGHT_LABELS = ['Ligero', 'Medio-ligero', 'Medio', 'Medio-pesado', 'Pesado'];
function weightBucket(w) {
  if (!w) return null;
  if (w < 1.5) return 0; if (w < 2.1) return 1; if (w < 2.7) return 2; if (w < 3.4) return 3; return 4;
}
const LANG = {
  'No necessary in-game text': 'Nula — se juega sin leer',
  'Some necessary text - easily memorized or small crib sheet': 'Baja',
  'Moderate in-game text - needs crib sheet or paste ups': 'Media',
  'Extensive use of text - massive conversion needed to be playable': 'Alta',
  'Unplayable in another language': 'Total — injugable en otro idioma',
};
const typeEs = (s) => (SUBDOMAIN[s] ? SUBDOMAIN[s][0] : s);
const typeColor = (s) => (SUBDOMAIN[s] ? SUBDOMAIN[s][1] : 'var(--brass)');

/* ---------- estado ---------- */
const S = {
  games: [], owners: [], owner: 0, view: 'library',
  filters: { q: '', types: new Set(), players: 0, time: '', weight: '', designer: '', sort: 'rank' },
  stats: null, geminiReady: false,
};

/* ================= arranque ================= */
init();
async function init() {
  bindTop();
  await loadOwners();
  await Promise.all([loadGames(), loadConfig()]);
  render();
  maybeOnboard();
  checkFreshness();
}

function meOwner() { return S.owners.find(o => o.id === S.owner) || S.owners.find(o => o.is_me) || S.owners[0]; }
function maybeOnboard() {
  const me = S.owners.find(o => o.is_me);
  if (me && (me.own_count + me.wish_count) === 0) openOnboarding();
}

function bindTop() {
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.view = b.dataset.view;
    $$('#nav button').forEach(x => x.classList.toggle('active', x === b));
    render();
  });
  $('#btnTheme').addEventListener('click', () => {
    const h = document.documentElement;
    h.dataset.theme = h.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', h.dataset.theme);
  });
  if (localStorage.getItem('theme')) document.documentElement.dataset.theme = localStorage.getItem('theme');
  $('#btnAdd').addEventListener('click', openAdd);
  $('#btnData').addEventListener('click', openData);
  $('#btnCfg').addEventListener('click', openConfig);
  $('#ownerSel').addEventListener('change', async e => {
    S.owner = +e.target.value; await loadGames(); render();
  });
}

async function loadOwners() {
  const d = await api('/owners'); S.owners = d.owners;
  if (!S.owner) S.owner = (S.owners.find(o => o.is_me) || S.owners[0]).id;
  const sel = $('#ownerSel');
  sel.innerHTML = S.owners.map(o =>
    `<option value="${o.id}">${o.is_me ? '👤 ' : '👥 '}${esc(o.name)} (${o.own_count})</option>`).join('');
  sel.value = S.owner;
}
async function loadGames() {
  const d = await api('/games?owner=' + S.owner); S.games = d.games;
}
async function loadConfig() {
  try { const c = await api('/config'); S.geminiReady = !!c.gemini_key_set; }
  catch { S.geminiReady = false; }
}

/* ================= router ================= */
function render() {
  const m = $('#main'); m.innerHTML = '';
  if (S.view === 'library') m.append(renderCollection('own'));
  else if (S.view === 'wishlist') m.append(renderCollection('wishlist'));
  else if (S.view === 'panel') renderPanel(m);
  else if (S.view === 'advisor') renderAdvisor(m);
}

/* ================= biblioteca / wishlist ================= */
function currentList(kind) {
  let list = S.games.filter(g => kind === 'own' ? g.own : g.wishlist);
  const f = S.filters;
  if (f.q) { const q = f.q.toLowerCase(); list = list.filter(g => (g.name || '').toLowerCase().includes(q)); }
  if (f.types.size) list = list.filter(g => (g.subdomains || []).some(s => f.types.has(s)));
  if (f.players) list = list.filter(g => (g.minplayers || 0) <= f.players && (g.maxplayers || 0) >= f.players);
  if (f.time) list = list.filter(g => {
    const t = g.maxplaytime || g.minplaytime || 0;
    return f.time === 'short' ? t > 0 && t < 30 : f.time === 'mid' ? t >= 30 && t <= 89 : t >= 90;
  });
  if (f.weight) list = list.filter(g => { const b = weightBucket(g.weight); return f.weight === 'light' ? b <= 1 : f.weight === 'mid' ? b === 2 : b >= 3; });
  if (f.designer) list = list.filter(g => (g.designers || []).some(d => d.name === f.designer));
  const s = f.sort;
  list.sort((a, b) => {
    if (s === 'rank') return (a.rank_overall || 1e9) - (b.rank_overall || 1e9);
    if (s === 'rating') return (b.rating_bayes || 0) - (a.rating_bayes || 0);
    if (s === 'weight') return (b.weight || 0) - (a.weight || 0);
    if (s === 'year') return (+b.yearpublished || 0) - (+a.yearpublished || 0);
    if (s === 'name') return (a.name || '').localeCompare(b.name || '');
    if (s === 'prio') return (a.wishlist_priority || 3) - (b.wishlist_priority || 3);
    if (s === 'time') return (a.maxplaytime || 0) - (b.maxplaytime || 0);
    return 0;
  });
  return list;
}

function renderCollection(kind) {
  const wrap = node('<div class="view"></div>');
  wrap.append(renderFilters(kind));
  const list = currentList(kind);
  if (!list.length) {
    wrap.append(node(`<div class="empty"><div class="ic">🎲</div><p>No hay juegos que coincidan.</p></div>`));
    return wrap;
  }
  const grid = node('<div class="grid"></div>');
  list.forEach(g => grid.append(card(g)));
  wrap.append(grid);
  return wrap;
}

function renderFilters(kind) {
  const f = S.filters;
  const bar = node('<div class="filters"></div>');
  bar.append(node(`
    <div class="search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
      <input placeholder="Buscar juego…" value="${esc(f.q)}">
    </div>`));
  bar.querySelector('input').addEventListener('input', e => { f.q = e.target.value; refreshGrid(kind); });

  // players
  const players = node(`<select title="Jugadores"><option value="0">Jugadores</option>${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}" ${f.players === n ? 'selected' : ''}>${n} jugador${n > 1 ? 'es' : ''}</option>`).join('')}</select>`);
  players.addEventListener('change', e => { f.players = +e.target.value; refreshGrid(kind); });
  bar.append(players);

  const time = node(`<select title="Duración"><option value="">Duración</option><option value="short" ${f.time === 'short' ? 'selected' : ''}>Corto (&lt;30m)</option><option value="mid" ${f.time === 'mid' ? 'selected' : ''}>Medio (30–89m)</option><option value="long" ${f.time === 'long' ? 'selected' : ''}>Largo (90m+)</option></select>`);
  time.addEventListener('change', e => { f.time = e.target.value; refreshGrid(kind); });
  bar.append(time);

  const weight = node(`<select title="Complejidad"><option value="">Complejidad</option><option value="light" ${f.weight === 'light' ? 'selected' : ''}>Liviana</option><option value="mid" ${f.weight === 'mid' ? 'selected' : ''}>Media</option><option value="heavy" ${f.weight === 'heavy' ? 'selected' : ''}>Pesada</option></select>`);
  weight.addEventListener('change', e => { f.weight = e.target.value; refreshGrid(kind); });
  bar.append(weight);

  // designers presentes
  const designers = [...new Set(S.games.filter(g => kind === 'own' ? g.own : g.wishlist).flatMap(g => (g.designers || []).map(d => d.name)))].sort();
  const dsel = node(`<select title="Diseñador"><option value="">Diseñador</option>${designers.map(d => `<option ${f.designer === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>`);
  dsel.addEventListener('change', e => { f.designer = e.target.value; refreshGrid(kind); });
  bar.append(dsel);

  const sortOpts = kind === 'wishlist'
    ? [['prio', 'Prioridad'], ['rank', 'Ranking BGG'], ['rating', 'Rating'], ['weight', 'Complejidad'], ['year', 'Año'], ['name', 'Nombre']]
    : [['rank', 'Ranking BGG'], ['rating', 'Rating'], ['weight', 'Complejidad'], ['time', 'Duración'], ['year', 'Año'], ['name', 'Nombre']];
  if (kind === 'wishlist' && f.sort === 'rank') f.sort = 'prio';
  const sort = node(`<select title="Ordenar">${sortOpts.map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>↕ ${l}</option>`).join('')}</select>`);
  sort.addEventListener('change', e => { f.sort = e.target.value; refreshGrid(kind); });
  bar.append(sort);

  bar.append(node(`<span class="count-tag" id="countTag"></span>`));

  // chips de tipo
  const chips = node('<div class="type-chips"></div>');
  Object.keys(SUBDOMAIN).forEach(s => {
    const c = node(`<button class="chip ${f.types.has(s) ? 'active' : ''}" style="--c:${typeColor(s)}"><span class="dot"></span>${typeEs(s)}</button>`);
    c.addEventListener('click', () => { f.types.has(s) ? f.types.delete(s) : f.types.add(s); c.classList.toggle('active'); refreshGrid(kind); });
    chips.append(c);
  });
  bar.append(chips);
  return bar;
}

function refreshGrid(kind) {
  const list = currentList(kind);
  const wrap = $('#main .view');
  const old = wrap.querySelector('.grid, .empty'); if (old) old.remove();
  const tag = $('#countTag'); if (tag) tag.textContent = `${list.length} juego${list.length === 1 ? '' : 's'}`;
  if (!list.length) { wrap.append(node(`<div class="empty"><div class="ic">🎲</div><p>No hay juegos que coincidan.</p></div>`)); return; }
  const grid = node('<div class="grid"></div>');
  list.forEach(g => grid.append(card(g)));
  wrap.append(grid);
}

/* ---------- card ---------- */
function playerFit(g, n) {
  if (!n) return '';
  if ((g.best_players || []).includes(n)) return '<span class="fit-pill fit-ideal">Ideal</span>';
  if ((g.recommended_players || []).includes(n)) return '<span class="fit-pill fit-good">Va bien</span>';
  if ((g.minplayers || 0) <= n && (g.maxplayers || 0) >= n) return '<span class="fit-pill fit-ok">Se banca</span>';
  return '<span class="fit-pill fit-ok" style="opacity:.5">No entra</span>';
}
function weightbar(w, big) {
  const b = weightBucket(w); const on = b == null ? 0 : b + 1;
  return `<span class="weightbar ${big ? 'big' : ''}" title="Complejidad: ${b == null ? 's/d' : WEIGHT_LABELS[b]}">${[0, 1, 2, 3, 4].map(i => `<span class="seg ${i < on ? 'on' : ''}"></span>`).join('')}</span>`;
}
function card(g) {
  const t = (g.subdomains || [])[0];
  const c = node(`
    <div class="card">
      <div class="cover" style="background-image:url('${esc(safeImg(g.image || g.thumb))}')">
        ${g.rank_overall ? `<span class="rankbadge">#${g.rank_overall}</span>` : ''}
        <span class="statebadge">${g.own ? '📦' : (g.wishlist ? '⭐' : '')}</span>
      </div>
      <div class="body">
        <div>
          <div class="title">${esc(g.name)}</div>
          <div class="year">${esc(g.yearpublished || '')}${t ? ' · ' : ''}${t ? `<span style="color:${typeColor(t)}">${typeEs(t)}</span>` : ''}</div>
        </div>
        <div class="meta">
          ${weightbar(g.weight)}
          <span class="m">👥 ${g.minplayers || '?'}–${g.maxplayers || '?'}</span>
          <span class="m">⏱ ${g.maxplaytime || '?'}′</span>
        </div>
        ${S.filters.players ? `<div>${playerFit(g, S.filters.players)}</div>` : ''}
      </div>
    </div>`);
  c.addEventListener('click', () => openDetail(g));
  return c;
}

/* ================= ficha (modal) ================= */
function overlay(inner, cls = '') {
  const ov = node(`<div class="overlay"><div class="modal ${cls}"><button class="close">✕</button></div></div>`);
  ov.querySelector('.modal').append(inner);
  const onKey = (e) => {
    if (!document.body.contains(ov)) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'Escape') close();
  };
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('.close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  $('#modalRoot').append(ov);
  ov.close = close;
  return ov;
}

function playersViz(g) {
  const best = new Set(g.best_players || []); const rec = new Set(g.recommended_players || []);
  const mx = Math.min(g.maxplayers || 0, 10);
  let out = '<div class="players-row">';
  for (let n = g.minplayers || 1; n <= mx; n++) {
    const cls = best.has(n) ? 'best' : rec.has(n) ? 'rec' : '';
    out += `<span class="pcount ${cls}">${best.has(n) ? '<span class="crown">👑</span>' : ''}${n}</span>`;
  }
  return out + '</div>';
}
function openDetail(g) {
  const t = (g.subdomains || [])[0];
  const ageCom = g.age_community ? esc(g.age_community) : '—';
  const inner = node(`<div>
    <div class="detail-hero">
      <div class="cover"><img src="${esc(safeImg(g.image))}" alt=""></div>
      <div>
        <div class="detail-title">${esc(g.name)}</div>
        <div class="detail-sub">${esc(g.yearpublished || '')} ${g.rank_overall ? '· Ranking BGG #' + g.rank_overall : ''} ${g.rating_avg ? '· ★ ' + (+g.rating_avg).toFixed(1) : ''}</div>
        <div class="chips-line" style="margin-top:10px">
          ${(g.subdomains || []).map(s => `<span class="type-tag" style="--c:${typeColor(s)}">${typeEs(s)}</span>`).join('')}
        </div>
        <div class="detail-desc" id="detailDesc">${esc(g.short_description || '')}</div>
        <div class="spec-grid">
          <div class="spec"><div class="k">Complejidad</div><div class="v">${weightbar(g.weight, true)} ${g.weight ? (+g.weight).toFixed(1) + '/5' : ''}</div></div>
          <div class="spec"><div class="k">Duración</div><div class="v">⏱ ${g.minplaytime || '?'}–${g.maxplaytime || '?'} min</div></div>
          <div class="spec"><div class="k">Edad · editorial</div><div class="v">${g.minage_publisher ? g.minage_publisher + '+' : '—'}</div></div>
          <div class="spec"><div class="k">Edad · comunidad</div><div class="v">${ageCom}</div></div>
        </div>
        <div class="section-h">Jugadores <span style="text-transform:none;font-weight:500">(👑 mejor · <span style="color:var(--brass-2)">recomendado</span>)</span></div>
        ${playersViz(g)}
        <div class="spec" style="margin-top:14px"><div class="k">Dependencia del idioma</div><div class="v" style="font-size:14px">${esc(LANG[g.language_dependence] || g.language_dependence || '—')}</div></div>
      </div>
    </div>
    <div style="padding:0 24px 8px">
      ${g.designers && g.designers.length ? `<div class="section-h">Diseño</div><div class="chips-line" id="desigChips">${g.designers.map(d => `<span class="tagchip click" data-d="${esc(d.name)}">🖋 ${esc(d.name)}</span>`).join('')}</div>` : ''}
      ${g.categories && g.categories.length ? `<div class="section-h">Categorías</div><div class="chips-line">${g.categories.map(c => `<span class="tagchip">${esc(c)}</span>`).join('')}</div>` : ''}
      ${g.mechanics && g.mechanics.length ? `<div class="section-h">Mecánicas</div><div class="chips-line">${g.mechanics.slice(0, 12).map(c => `<span class="tagchip">${esc(c)}</span>`).join('')}</div>` : ''}
      ${g.owners_owning && g.owners_owning.length ? `<div class="section-h">Lo tienen</div><div class="chips-line">${g.owners_owning.map(n => `<span class="tagchip">👤 ${esc(n)}</span>`).join('')}</div>` : ''}
      <div style="margin-top:16px"><a href="${esc(safeImg(g.href) || '#')}" target="_blank" rel="noopener">Ver en BoardGameGeek ↗</a></div>
    </div>
    <div class="state-bar"></div>
  </div>`);

  // click en diseñador -> filtrar
  inner.querySelectorAll('#desigChips .tagchip').forEach(ch => ch.addEventListener('click', () => {
    S.filters.designer = ch.dataset.d; S.view = 'library';
    $$('#nav button').forEach(x => x.classList.toggle('active', x.dataset.view === 'library'));
    ov.remove(); render();
  }));

  // barra de estado
  const bar = inner.querySelector('.state-bar');
  bar.append(stateControls(g, ov => { }));
  const ov = overlay(inner);
  setupDescription(inner, g);
}

function _words(t, n) { const w = (t || '').split(/\s+/); return w.length <= n ? t : w.slice(0, n).join(' ') + '…'; }
async function setupDescription(inner, g) {
  const box = inner.querySelector('#detailDesc'); if (!box) return;
  const short = g.short_description || '';
  const collapse = (text) => {
    box.innerHTML = esc(_words(text, 60));
    if ((text.split(/\s+/).length) > 60) {
      const a = node('<button class="vermas">ver más ▾</button>');
      a.onclick = () => expand(text); box.append(' '); box.append(a);
    }
  };
  const expand = (text) => {
    box.innerHTML = esc(text).replace(/\n/g, '<br>');
    const a = node('<button class="vermas">ver menos ▴</button>');
    a.onclick = () => collapse(text); box.append(' '); box.append(a);
  };
  const loadFull = async () => {
    try {
      const d = await api('/games/' + g.objectid + '/description');
      g.description = d.description || '';
      const i = S.games.findIndex(x => x.objectid === g.objectid); if (i >= 0) S.games[i].description = g.description;
    } catch {}
    return g.description || '';
  };

  // placeholder instantáneo con la corta; luego auto-cargamos la larga (lectura de DB)
  box.innerHTML = esc(short || '');
  const full = g.description || await loadFull();
  if (full) collapse(full);
  else if (!short) box.innerHTML = '<span style="color:var(--ink-dim)">Sin descripción disponible.</span>';
}

function stateControls(g) {
  const box = node(`<div style="display:flex;flex-direction:column;gap:12px;width:100%">
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
      <div class="seg">
        <button data-s="own" class="${g.own ? 'on' : ''}">📦 La tengo</button>
        <button data-s="wishlist" class="${g.wishlist ? 'on' : ''}">⭐ La quiero</button>
        <button data-s="none" class="${!g.own && !g.wishlist ? 'on' : ''}">Ninguno</button>
      </div>
      <div class="prio ${g.wishlist ? '' : 'hidden'}" style="display:${g.wishlist ? 'flex' : 'none'};align-items:center;gap:8px">
        <span style="color:var(--ink-dim);font-size:13px">Prioridad</span>
        <div class="stars">${[1, 2, 3, 4, 5].map(i => `<span class="s ${(6 - (g.wishlist_priority || 3)) >= i ? 'on' : ''}" data-p="${i}">★</span>`).join('')}</div>
      </div>
    </div>
  </div>`);
  async function set(patch) {
    try {
      const upd = await api(`/games/${g.objectid}/state?owner=${S.owner}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
      });
      Object.assign(g, upd);
      const i = S.games.findIndex(x => x.objectid === g.objectid);
      if (i >= 0) Object.assign(S.games[i], upd);
      toast('Guardado');
      await loadOwners();
    } catch (e) { toast('Error: ' + e.message); }
  }
  box.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', async () => {
    box.querySelectorAll('.seg button').forEach(x => x.classList.remove('on')); b.classList.add('on');
    const s = b.dataset.s;
    const patch = { own: s === 'own' ? 1 : 0, wishlist: s === 'wishlist' ? 1 : 0 };
    box.querySelector('.prio').style.display = s === 'wishlist' ? 'flex' : 'none';
    await set(patch);
    if (S.view !== 'library' || true) { /* refrescamos grid si está */ if ($('#main .grid')) render(); }
  }));
  box.querySelectorAll('.stars .s').forEach(st => st.addEventListener('click', async () => {
    const stars = +st.dataset.p; const prio = 6 - stars; // 5★ = prio1
    box.querySelectorAll('.stars .s').forEach((x, i) => x.classList.toggle('on', i < stars));
    await set({ wishlist: 1, wishlist_priority: prio });
  }));
  return box;
}

/* ================= panel / stats ================= */
function bars(entries, max, colorFn) {
  // entries: [ [label, value, colorOverride?] ]
  return entries.map(([label, val, col]) => {
    const c = col || (colorFn ? colorFn(label) : 'var(--brass)');
    const pct = Math.max(val > 0 ? 8 : 0, val / max * 100);   // sliver mínimo si >0
    return `<div class="hbar">
      <span class="hbar-lbl">${esc(label)}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${pct}%;background:${c}"></span></span>
      <span class="hbar-num">${val}</span></div>`;
  }).join('');
}

async function renderPanel(m) {
  m.append(node('<div class="view"><div class="spinner"></div></div>'));
  let st;
  try { st = await api('/stats?owner=' + S.owner); } catch (e) { m.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; return; }
  S.stats = st;
  const h = st.highlights || {}; const sm = st.summary || {};
  const v = node('<div class="view"></div>');
  const grid = node('<div class="stat-grid"></div>');

  // --- Tu colección (enriquecida) ---
  const yr = (sm.year_min && sm.year_max) ? `${sm.year_min}–${sm.year_max}` : '—';
  grid.append(node(`<div class="panel summary" style="grid-column:span 4">
    <h3>Tu colección</h3>
    <div class="summary-nums">
      <div class="sn"><div class="bigstat">${st.counts.own}</div><div class="sn-l">📦 juegos</div></div>
      <div class="sn-div"></div>
      <div class="sn"><div class="bigstat" style="color:var(--m-party)">${st.counts.wishlist}</div><div class="sn-l">⭐ en wishlist</div></div>
    </div>
    <div class="mini-stats">
      <div class="ms"><span class="ms-k">Complejidad media</span><span class="ms-v">${sm.avg_weight ? sm.avg_weight + ' / 5' : '—'}</span></div>
      <div class="ms"><span class="ms-k">Duración típica</span><span class="ms-v">${sm.median_time ? sm.median_time + ' min' : '—'}</span></div>
      <div class="ms"><span class="ms-k">Diseñadores</span><span class="ms-v">${sm.designers || 0}</span></div>
      <div class="ms"><span class="ms-k">Mecánicas distintas</span><span class="ms-v">${sm.mechanics || 0}</span></div>
      <div class="ms"><span class="ms-k">Años de edición</span><span class="ms-v">${yr}</span></div>
    </div>
  </div>`));

  // --- Destacados ---
  const hi = [
    ['🤝', h.coop, 'cooperativos', 'var(--m-abstract)'],
    ['🎉', h.party, 'de fiesta', 'var(--m-party)'],
    ['👥', h.two, 'ideales para 2', 'var(--m-strategy)'],
    ['🎪', h.big, 'para grupo (5+)', 'var(--m-thematic)'],
    ['⚡', h.quick, 'rápidos (≤30′)', 'var(--brass)'],
    ['🌙', h.long, 'de la tarde (90’+)', 'var(--m-war)'],
  ];
  grid.append(node(`<div class="panel highlights" style="grid-column:span 8">
    <h3>Destacados de tu colección</h3>
    <div class="hi-grid">
      ${hi.map(([ic, n, l, c]) => `<div class="hi-tile" style="--tc:${c}"><div class="hi-ic">${ic}</div><div class="hi-n" style="color:${c}">${n || 0}</div><div class="hi-l">${l}</div></div>`).join('')}
    </div>
  </div>`));

  // --- Por tipo ---
  const typeEntries = Object.entries(st.by_type).sort((a, b) => b[1] - a[1]).map(([k, val]) => [typeEs(k), val, typeColor(k)]);
  grid.append(node(`<div class="panel" style="grid-column:span 4"><h3>Por tipo de juego</h3>${bars(typeEntries, Math.max(1, ...typeEntries.map(e => e[1]))) || '<p style="color:var(--ink-dim)">Sin datos</p>'}</div>`));

  // --- Por complejidad ---
  const weightEntries = st.by_weight.map((val, i) => [WEIGHT_LABELS[i], val]);
  grid.append(node(`<div class="panel" style="grid-column:span 4"><h3>Por complejidad</h3>${bars(weightEntries, Math.max(1, ...st.by_weight), () => 'var(--brass)')}</div>`));

  // --- Por edad (intervalos) + infantiles ---
  const ageLabels = { '4–8': 'Niños (4–8)', '9–12': 'Jóvenes (9–12)', '13+': 'Adultos (13+)' };
  const ageColors = { '4–8': 'var(--m-children)', '9–12': 'var(--m-family)', '13+': 'var(--m-strategy)' };
  const ageEntries = Object.entries(st.by_age || {}).map(([k, val]) => [ageLabels[k] || k, val, ageColors[k]]);
  const infantiles = (st.by_type || {})["Children's Games"] || 0;
  grid.append(node(`<div class="panel" style="grid-column:span 4"><h3>Por edad recomendada</h3>${bars(ageEntries, Math.max(1, ...ageEntries.map(e => e[1])))}
    <div class="age-note"><span>🧸 Infantiles <small>(pensados para chicos)</small></span><b>${infantiles}</b></div></div>`));

  // --- ¿Para cuántos jugadores? ---
  const cover = st.player_cover; const maxCover = Math.max(1, ...Object.values(cover));
  grid.append(node(`<div class="panel" style="grid-column:span 7"><h3>¿Para cuántos jugadores?</h3>
    <p style="color:var(--ink-dim);font-size:13px;margin:-6px 0 14px">Cuántos juegos tuyos andan bien (mejor o recomendado) con cada número</p>
    <div class="vbars">
      ${Object.entries(cover).map(([n, c]) => {
    const pct = Math.round(c / maxCover * 100);
    const col = c === 0 ? 'var(--line)' : c <= 2 ? 'var(--danger)' : 'var(--good)';
    return `<div class="vbar"><div class="vbar-n">${c}</div><div class="vbar-col"><div class="vbar-fill" style="height:${Math.max(c > 0 ? 6 : 2, pct)}%;background:${col}"></div></div><div class="vbar-x">${n}</div></div>`;
  }).join('')}
    </div>
    ${st.gaps && st.gaps.length ? `<div class="gap-note">💡 Cubrís poco los <b>${st.gaps.join(', ')} jugadores</b>. El advisor lo tiene en cuenta en "¿Qué compro?".</div>` : ''}
  </div>`));

  // --- Diseñadores ---
  const desEntries = st.top_designers.map(([n, c]) => [n, c, 'var(--brass-2)']);
  grid.append(node(`<div class="panel" style="grid-column:span 5"><h3>Diseñadores más presentes</h3>${desEntries.length ? bars(desEntries, Math.max(1, ...desEntries.map(e => e[1]))) : '<p style="color:var(--ink-dim)">Sin datos</p>'}</div>`));

  v.append(grid); m.innerHTML = ''; m.append(v);
}

/* ================= ADVISOR ================= */
const OCCASIONS = {
  couple: { ic: '🍷', t: 'Noche de pareja', d: 'Para dos', preset: { players: 2, vibe: 'medium', coop: 'any' } },
  family: { ic: '👨‍👩‍👧', t: 'Familia con chicos', d: 'Con los más chicos', preset: { min_age: 8, vibe: 'light', language_ok: true } },
  party: { ic: '🎉', t: 'Fiesta', d: 'Mucha gente', preset: { players: 6, vibe: 'light', time: 'short', theme: 'fiesta' } },
  friends: { ic: '🍻', t: 'Con amigos', d: 'Junta informal', preset: { players: 4, vibe: 'medium' } },
  elders: { ic: '👵', t: 'Gente grande', d: 'No jugones', preset: { vibe: 'light', language_ok: true, experience: 'new' } },
  serious: { ic: '🧠', t: 'Algo en serio', d: 'Con ganas de pensar', preset: { vibe: 'heavy', time: 'long', experience: 'gamers' } },
  kidadult: { ic: '🧒', t: 'Grandes y chicos', d: 'Un adulto con los más chicos', preset: { players: 2, min_age: 6, vibe: 'light', language_ok: true } },
  newbies: { ic: '🌱', t: 'Recién empiezan', d: 'Nunca jugaron / no jugones', preset: { vibe: 'light', time: 'short', experience: 'new', language_ok: true } },
};
const PLAY_Q = [
  { k: 'players', type: 'step', q: '¿Cuántos van a jugar?', min: 1, max: 10 },
  { k: 'min_age', type: 'opt', q: 'El más chico, ¿qué edad?', opts: [['sin', 'Sin chicos', 99], ['6', '~6', 6], ['8', '~8', 8], ['10', '~10', 10], ['12', '12+', 12]] },
  { k: 'time', type: 'opt', q: '¿Cuánto rato tienen?', opts: [['short', 'Un rato (~30′)', 'short'], ['hour', 'Una hora', 'hour'], ['long', 'La tarde entera', 'long'], ['any', 'No importa', 'any']] },
  { k: 'vibe', type: 'opt', q: '¿Con qué ganas vienen?', opts: [['light', '😄 Reírse y charlar', 'light'], ['medium', '🎯 Enganchar sin quemarse', 'medium'], ['heavy', '🧠 Pensar en serio', 'heavy']] },
  { k: 'coop', type: 'opt', q: '¿Compiten o se unen?', opts: [['comp', '⚔ Competir', 'competitive'], ['coop', '🤝 Unirse contra el juego', 'coop'], ['any', 'Da igual', 'any']] },
  { k: 'experience', type: 'opt', q: '¿Cuánta calle tienen?', opts: [['new', 'Todos nuevos', 'new'], ['some', 'Alguno con experiencia', 'some'], ['gamers', 'Grupo jugón', 'gamers']] },
  { k: 'language_ok', type: 'opt', q: '¿Importa el idioma / texto?', opts: [['y', '🇪🇸 Mejor poco texto', true], ['n', 'No importa', false]] },
];
const BUY_Q = [
  { k: 'audience', type: 'opt', q: '¿Para quién es principalmente?', opts: [['group', 'Mi grupo habitual', 'group'], ['family', 'Familia con chicos', 'family'], ['couple', 'Para dos', 'couple'], ['party', 'Fiestas', 'party'], ['gift', 'Un regalo', 'gift']] },
  { k: 'usual_players', type: 'step', q: '¿Con cuánta gente jugás normalmente?', min: 1, max: 10 },
  { k: 'want_more', type: 'opt', q: '¿Qué te gustaría sumar?', opts: [['s', '♟ Más estrategia', 'Strategy Games'], ['p', '🎉 Más party', 'Party Games'], ['f', '👨‍👩‍👧 Más familiar', 'Family Games'], ['t', '🐉 Más temático', 'Thematic Games'], ['c', '🤝 Cooperativos', 'coop'], ['a', '🔷 Abstractos', 'Abstract Games']] },
  { k: 'vibe', type: 'opt', q: '¿Qué complejidad buscás?', opts: [['light', 'Livianos que salgan siempre', 'light'], ['medium', 'Medios', 'medium'], ['heavy', 'El juegazo de la tarde', 'heavy']] },
  { k: 'safe_or_niche', type: 'opt', q: '¿Gemas seguras o nicho?', opts: [['safe', '💎 Gemas seguras', 'safe'], ['niche', '🔍 Descubrir nicho', 'niche']] },
];

const ADV = { mode: 'play', occasion: null, answers: {}, engine: 'rules', backend: 'claude', freetext: '' };

function renderAdvisor(m) {
  ADV.answers = ADV.answers || {};
  const v = node('<div class="view advisor-wrap"></div>');

  // switch de modo (los botones son el título)
  const ms = node('<div class="mode-switch"></div>');
  ms.append(mkModeCard('play', '🎲', '¿Qué saco hoy?', 'De lo que ya tenés'));
  ms.append(mkModeCard('buy', '🛒', '¿Qué compro?', 'De tu wishlist, según tu colección'));
  v.append(ms);

  const body = node('<div id="advBody"></div>');
  v.append(body);
  m.innerHTML = ''; m.append(v);
  renderAdvBody();
}
function mkModeCard(mode, ic, t, d) {
  const c = node(`<button class="mode-card ${ADV.mode === mode ? 'on' : ''}"><div class="ic">${ic}</div><h3>${t}</h3><p>${d}</p></button>`);
  c.addEventListener('click', () => { ADV.mode = mode; ADV.occasion = null; ADV.answers = {}; renderAdvisor($('#main')); });
  return c;
}

function renderAdvBody() {
  const b = $('#advBody'); b.innerHTML = '';
  // modo play arranca por ocasión
  if (ADV.mode === 'play' && !ADV.occasion) {
    b.append(node('<div class="section-h" style="text-align:center">Elegí la ocasión</div>'));
    const grid = node('<div class="occasion-grid"></div>');
    Object.entries(OCCASIONS).forEach(([k, o]) => {
      const el = node(`<button class="occ"><div class="ic">${o.ic}</div><div class="t">${o.t}</div><div class="d">${o.d}</div></button>`);
      el.addEventListener('click', () => { ADV.occasion = k; ADV.answers = { ...o.preset }; renderAdvBody(); });
      grid.append(el);
    });
    b.append(grid);
    const skip = node('<div style="text-align:center;margin-top:16px"><button class="btn ghost">o respondé sin elegir ocasión →</button></div>');
    skip.querySelector('button').addEventListener('click', () => { ADV.occasion = 'libre'; ADV.answers = {}; renderAdvBody(); });
    b.append(skip);
    return;
  }

  const form = node('<div id="advForm"></div>');
  const qs = ADV.mode === 'play' ? PLAY_Q : BUY_Q;
  qs.forEach(q => form.append(renderQ(q)));
  form.append(engineSwitch());
  const go = node(`<button class="btn primary block" style="margin-top:6px">✨ Recomendame ${ADV.mode === 'buy' ? 'qué comprar' : 'qué jugar'}</button>`);
  go.addEventListener('click', runAdvisor);
  form.append(go);
  b.append(form);
  b.append(node('<div id="advResults"></div>'));
}

function renderQ(q) {
  const wrap = node(`<div class="q"><div class="qh">${q.q}</div></div>`);
  if (q.type === 'step') {
    const val = ADV.answers[q.k] || 0;
    const s = node(`<div class="stepper"><button aria-label="menos">−</button><span class="val">${val || '·'}</span><button aria-label="más">+</button></div>`);
    const [minus, plus] = s.querySelectorAll('button'); const disp = s.querySelector('.val');
    minus.addEventListener('click', () => { ADV.answers[q.k] = Math.max(q.min, (ADV.answers[q.k] || q.min) - 1); disp.textContent = ADV.answers[q.k]; });
    plus.addEventListener('click', () => { ADV.answers[q.k] = Math.min(q.max, (ADV.answers[q.k] || q.min - 1) + 1); disp.textContent = ADV.answers[q.k]; });
    wrap.append(s);
  } else {
    const opts = node('<div class="opts"></div>');
    q.opts.forEach(([id, label, val]) => {
      const on = JSON.stringify(ADV.answers[q.k]) === JSON.stringify(val);
      const o = node(`<button class="opt ${on ? 'on' : ''}">${label}</button>`);
      o.addEventListener('click', () => {
        ADV.answers[q.k] = val;
        opts.querySelectorAll('.opt').forEach(x => x.classList.remove('on')); o.classList.add('on');
      });
      opts.append(o);
    });
    wrap.append(opts);
  }
  return wrap;
}

function engineSwitch() {
  if (!S.geminiReady && ADV.engine === 'agent') ADV.engine = 'rules';   // sin Gemini, no hay agente
  const agentAttr = S.geminiReady ? '' : 'disabled title="Configurá tu API key de Gemini en ⚙ para activar el agente"';
  const box = node(`<div class="engine-switch">
    <span style="font-weight:600">Motor:</span>
    <div class="seg">
      <button data-e="rules" class="${ADV.engine === 'rules' ? 'on' : ''}">⚙ Determinístico</button>
      <button data-e="agent" class="${ADV.engine === 'agent' ? 'on' : ''}" ${agentAttr}>🤖 Agente</button>
    </div>
    <span style="color:var(--ink-dim);font-size:12.5px" id="engHint"></span>
    <div class="freetext ${ADV.engine === 'agent' ? '' : 'disabled'}" >
      <textarea id="advFree" placeholder="Contale algo más en tus palabras (opcional, solo con el agente)… ej: 'somos 3 adultos y mi vieja que se aburre rápido'">${esc(ADV.freetext)}</textarea>
    </div>
  </div>`);
  const hint = box.querySelector('#engHint');
  const setHint = () => {
    if (!S.geminiReady) hint.innerHTML = 'Activá el agente con IA cargando tu API key de Gemini (gratis) en <b>⚙</b>.';
    else hint.textContent = ADV.engine === 'agent' ? 'Razona con Gemini sobre 20 candidatos de tu colección.' : 'Puntuación transparente sobre los datos.';
  };
  setHint();
  box.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    ADV.engine = b.dataset.e;
    box.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
    box.querySelector('.freetext').classList.toggle('disabled', ADV.engine !== 'agent');
    setHint();
  }));
  box.querySelector('#advFree').addEventListener('input', e => ADV.freetext = e.target.value);
  return box;
}

// Secuencia fija (3 s c/u → 15 s en total). Si tarda más, itera AGENT_TAIL.
const AGENT_SEQ = [
  'Buscando las mejores sugerencias, bancame un minuto 🎲',  // 0–3 s
  'Barajando los 20 candidatos de tu colección…',            // 3–6 s
  'Viendo qué encaja mejor con tu grupo…',                   // 6–9 s
  'Ya casi está…',                                           // 9–12 s
  'Afinando la recomendación…',                              // 12–15 s
];
const AGENT_TAIL = ['Dame unos segundos más…', 'Afinando la recomendación…'];
const AGENT_MIN_MS = AGENT_SEQ.length * 3000;  // 15 s mínimo de animación

function agentLoader() {
  const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const el = node(`<div class="agent-loading"><div class="dice-roll"><span>⚀</span><span>⚄</span></div><div class="agent-msg">${AGENT_SEQ[0]}</div><div class="agent-sub">El agente analiza 20 candidatos de tu colección</div></div>`);
  const dice = el.querySelectorAll('.dice-roll span'); const msg = el.querySelector('.agent-msg');
  let fi = 0, step = 0;
  const t1 = setInterval(() => { fi++; dice[0].textContent = faces[fi % 6]; dice[1].textContent = faces[(fi + 3) % 6]; }, 130);
  const t2 = setInterval(() => {
    step++;
    msg.textContent = step < AGENT_SEQ.length
      ? AGENT_SEQ[step]
      : AGENT_TAIL[(step - AGENT_SEQ.length) % 2];
  }, 3000);
  el._stop = () => { clearInterval(t1); clearInterval(t2); };
  return el;
}

async function runAdvisor() {
  const res = $('#advResults'); const form = $('#advForm');
  if (form) form.style.display = 'none';               // los resultados pisan el formulario
  let loader = null;
  if (ADV.engine === 'agent') { res.innerHTML = ''; loader = agentLoader(); res.append(loader); }
  else { res.innerHTML = '<div style="text-align:center;padding:30px 0"><div class="spinner"></div></div>'; }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const answers = { ...ADV.answers };
  if (ADV.engine === 'agent' && ADV.freetext.trim()) answers.texto_libre = ADV.freetext.trim();
  const started = performance.now();
  try {
    const out = await api('/advisor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: ADV.mode, engine: ADV.engine, answers, owner: S.owner, limit: 5 })
    });
    // el loader del agente se muestra un mínimo (la animación completa) aunque la respuesta llegue antes
    if (loader) {
      const left = AGENT_MIN_MS - (performance.now() - started);
      if (left > 0) await new Promise(r => setTimeout(r, left));
      loader._stop();
    }
    renderResults(out);
  } catch (e) {
    if (loader) loader._stop();
    res.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
    res.append(backButton());
  }
}

function backButton() {
  const b = node('<div style="text-align:center;margin-top:8px"><button class="btn ghost">↩ Volver a buscar</button></div>');
  b.querySelector('button').addEventListener('click', () => {
    const form = $('#advForm'); if (form) form.style.display = '';
    $('#advResults').innerHTML = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  return b;
}

function renderResults(out) {
  const res = $('#advResults'); res.innerHTML = '';
  const engLabel = out.engine === 'rules' ? '⚙ determinístico' : (out.engine.startsWith('gemini') ? '🤖 Gemini' : '🤖 Claude');
  res.append(node(`<div class="rec-head">Seleccioné los mejores <b>${out.picks.length}</b> de <b>${out.considered}</b> que se adaptaban a lo que pediste <span class="rec-eng">${engLabel}</span></div>`));
  if (out.note) res.append(node(`<div class="gap-note" style="background:color-mix(in srgb,var(--brass) 12%,transparent);border-color:color-mix(in srgb,var(--brass) 30%,transparent)">${esc(out.note)}</div>`));
  if (!out.picks.length) { res.append(node('<div class="empty"><div class="ic">🤔</div><p>No encontré nada que encaje. Aflojá algún filtro.</p></div>')); res.append(backButton()); return; }
  const byId = Object.fromEntries(S.games.map(g => [g.objectid, g]));
  out.picks.forEach((p, idx) => {
    const g = byId[p.objectid] || p;
    const c = node(`<div class="rec-card">
      <div class="rec-rank">${idx + 1}</div>
      <div class="cover"><img src="${esc(safeImg(p.image || p.thumb))}" alt=""></div>
      <div>
        <h3>${esc(p.name)}</h3>
        <div class="chips-line" style="margin:6px 0">${(p.subdomains || []).map(s => `<span class="type-tag" style="--c:${typeColor(s)}">${typeEs(s)}</span>`).join('')} ${weightbar(p.weight)}</div>
        <div class="rec-pitch">${esc(p.pitch)}</div>
        <div class="rec-why">${(p.reasons || []).map(r => `<span class="tagchip">✓ ${esc(r)}</span>`).join('')}</div>
        <div style="margin-top:10px"><button class="btn ghost">Ver ficha</button></div>
      </div>
    </div>`);
    c.querySelector('button').addEventListener('click', () => openDetail(g));
    res.append(c);
  });
  // acciones: sorprendeme (elige una) + volver a buscar
  const actions = node('<div class="rec-actions"></div>');
  if (ADV.mode === 'play') {
    const sp = node('<button class="btn">🎲 Sorprendeme</button>');
    sp.addEventListener('click', () => {
      sp.classList.add('dice-rolling'); setTimeout(() => sp.classList.remove('dice-rolling'), 600);
      const top = out.picks.slice(0, 3);                 // al azar entre los 3 de mejor fit
      const pick = top[Math.floor(Math.random() * top.length)];
      const g = byId[pick.objectid] || pick; setTimeout(() => openDetail(g), 300);
    });
    actions.append(sp);
  }
  const back = node('<button class="btn ghost">↩ Volver a buscar</button>');
  back.addEventListener('click', () => {
    const form = $('#advForm'); if (form) form.style.display = '';
    res.innerHTML = ''; window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  actions.append(back);
  res.append(actions);
}

/* ================= AGREGAR juego ================= */
function openAdd() {
  const inner = node(`<div class="sheet-body">
    <h2 style="margin-bottom:4px">Agregar juego</h2>
    <p style="color:var(--ink-dim);margin:0 0 16px;font-size:13.5px">Buscá por nombre, o pegá el ID / URL de BoardGameGeek.</p>
    <div class="field"><input id="addQ" placeholder="Ej: Wingspan, o 266192, o el link de BGG…" autofocus></div>
    <div style="display:flex;gap:8px;margin-bottom:6px">
      <button class="btn primary" id="addSearch">Buscar</button>
      <div class="seg" id="addStatus"><button data-s="own">📦 La tengo</button><button data-s="wishlist" class="on">⭐ La quiero</button></div>
    </div>
    <div class="search-results" id="addResults"></div>
  </div>`);
  let status = 'wishlist';
  inner.querySelectorAll('#addStatus button').forEach(b => b.addEventListener('click', () => {
    inner.querySelectorAll('#addStatus button').forEach(x => x.classList.remove('on')); b.classList.add('on'); status = b.dataset.s;
  }));
  const q = inner.querySelector('#addQ'); const results = inner.querySelector('#addResults');
  async function doSearch() {
    const val = q.value.trim(); if (!val) return;
    // si parece id/url, agregar directo
    if (/^\d+$/.test(val) || /boardgamegeek\.com/.test(val)) { return addDirect(val); }
    results.innerHTML = '<div class="spinner"></div>';
    try {
      const d = await api('/search?q=' + encodeURIComponent(val));
      results.innerHTML = '';
      if (!d.results.length) { results.innerHTML = '<p style="color:var(--ink-dim)">Sin resultados.</p>'; return; }
      d.results.forEach(r => {
        const el = node(`<div class="sr"><img src="${esc(safeImg(r.thumb))}" alt=""><div><div class="n">${esc(r.name)}</div><div class="y">${esc(r.yearpublished || '')} · id ${esc(r.objectid)}</div></div></div>`);
        el.addEventListener('click', () => addDirect(r.objectid));
        results.append(el);
      });
    } catch (e) { results.innerHTML = `<p style="color:var(--danger)">Error: ${esc(e.message)}</p>`; }
  }
  async function addDirect(idOrUrl) {
    results.innerHTML = '<div class="spinner"></div>';
    try {
      const g = await api('/games/add?owner=' + S.owner, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: idOrUrl, status })
      });
      await loadGames(); await loadOwners();
      ov.remove(); toast(`Agregado: ${g.name}`); render(); openDetail(g);
    } catch (e) { results.innerHTML = `<p style="color:var(--danger)">Error: ${esc(e.message)}</p>`; }
  }
  inner.querySelector('#addSearch').addEventListener('click', doSearch);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  const ov = overlay(inner, 'sheet');
  setTimeout(() => q.focus(), 50);
}

/* ================= DATOS: perfiles + import/export ================= */
function openData(tab = 'perfiles') {
  const inner = node(`<div class="sheet-body">
    <h2 style="margin-bottom:14px">Perfiles y datos</h2>
    <div class="tabs" id="dataTabs">
      <button data-t="perfiles">👥 Perfiles</button>
      <button data-t="importar">📥 Importar</button>
      <button data-t="backup">💾 Backup</button>
      <button data-t="actualizar">🔄 Actualizar</button>
    </div>

    <section data-p="perfiles" class="tab-pane">
      <p class="tab-hint">Tu colección y las de tus amigos. Cambiá de perfil desde el selector de arriba.</p>
      <div id="ownerList" style="display:flex;flex-direction:column;gap:8px"></div>
      <div class="field" style="margin-top:14px">
        <label>Crear un perfil nuevo (vacío)</label>
        <input id="newOwner" placeholder="Nombre del amigo… (Enter para crear)">
      </div>
    </section>

    <section data-p="importar" class="tab-pane" hidden>
      <p class="tab-hint">Cargá un CSV de <b>BoardGameGeek</b> o un <b>backup de esta app</b> (los dos formatos funcionan). Se completa con imágenes y datos automáticamente. Si el perfil ya existe, <b>actualiza</b> su estado.</p>
      <div class="field">
        <label>¿A qué perfil va?</label>
        <select id="impProfile"></select>
      </div>
      <div class="field" id="impNameWrap" style="display:none">
        <label>Nombre del perfil nuevo</label>
        <input id="impName" placeholder="Ej: Juan">
      </div>
      <div class="field">
        <label>¿Qué cargar?</label>
        <div class="seg" id="impMode"><button data-m="both" class="on">Todo (tiene + wishlist)</button><button data-m="own">Solo lo que tiene</button></div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <label class="btn">📂 Elegir CSV<input type="file" id="impFile" accept=".csv" hidden></label>
        <span id="impFileName" style="color:var(--ink-dim);font-size:13px"></span>
      </div>
      <button class="btn primary block" id="impGo" style="margin-top:14px" disabled>Importar</button>
      <div id="impProg" style="margin-top:10px"></div>
    </section>

    <section data-p="backup" class="tab-pane" hidden>
      <p class="tab-hint">Descargá un CSV con el estado actual (te sirve de respaldo y para re-importar acá o en BGG).</p>
      <button class="btn block" id="expBtn">⬇ Descargar CSV de <b id="expWho"></b></button>
    </section>

    <section data-p="actualizar" class="tab-pane" hidden>
      <p class="tab-hint">Los rankings y datos de BGG cambian de a poco (salen juegos nuevos). Refrescalos cuando quieras.</p>
      <div id="freshBox" style="font-size:13.5px;color:var(--ink-soft)">Comprobando…</div>
      <button class="btn primary block" id="refreshBtn" style="margin-top:12px;display:none">🔄 Actualizar rankings y datos</button>
    </section>
  </div>`);

  // pestañas
  const showTab = (t) => {
    inner.querySelectorAll('#dataTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    inner.querySelectorAll('.tab-pane').forEach(p => p.hidden = p.dataset.p !== t);
  };
  inner.querySelectorAll('#dataTabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.t)));
  showTab(tab);
  inner.querySelector('#expWho').textContent = (S.owners.find(o => o.id === S.owner) || {}).name || 'tu perfil';

  // selector de perfil destino (existentes + nuevo)
  const impProfile = inner.querySelector('#impProfile');
  const paintImpProfile = () => {
    impProfile.innerHTML = S.owners.map(o => `<option value="${o.id}" ${o.id === S.owner ? 'selected' : ''}>${o.is_me ? '👤 ' : '👥 '}${esc(o.name)} — actualizar</option>`).join('')
      + '<option value="__new__">➕ Nuevo perfil…</option>';
  };
  paintImpProfile();
  impProfile.addEventListener('change', () => {
    inner.querySelector('#impNameWrap').style.display = impProfile.value === '__new__' ? 'block' : 'none';
  });

  function paintOwners() {
    const list = inner.querySelector('#ownerList'); list.innerHTML = '';
    S.owners.forEach(o => {
      const row = node(`<div class="sr" style="cursor:default">
        <div style="width:14px;height:14px;border-radius:50%;background:${o.color};flex:none"></div>
        <div style="flex:1"><div class="n">${o.is_me ? '👤 ' : '👥 '}${esc(o.name)}</div><div class="y">${o.own_count} juegos · ${o.wish_count} wishlist</div></div>
        <button class="btn ghost ren" style="padding:6px 10px">✎</button>
        ${o.is_me ? '' : '<button class="btn ghost del" style="padding:6px 10px;color:var(--danger)">🗑</button>'}
      </div>`);
      row.querySelector('.ren').addEventListener('click', async () => {
        const name = prompt('Nuevo nombre:', o.name); if (!name) return;
        await api('/owners/' + o.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        await loadOwners(); paintOwners(); toast('Renombrado');
      });
      const del = row.querySelector('.del');
      if (del) del.addEventListener('click', async () => {
        if (!confirm(`¿Borrar el perfil de ${o.name} y su colección?`)) return;
        await api('/owners/' + o.id, { method: 'DELETE' });
        if (S.owner === o.id) S.owner = 0;
        await loadOwners(); if (!S.owner) S.owner = S.owners[0].id; await loadGames(); paintOwners(); render(); toast('Perfil borrado');
      });
      list.append(row);
    });
  }
  paintOwners();

  inner.querySelector('#newOwner').addEventListener('keydown', async e => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    await api('/owners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: e.target.value.trim() }) });
    e.target.value = ''; await loadOwners(); paintOwners(); toast('Perfil creado');
  });

  let mode = 'both', file = null;
  inner.querySelectorAll('#impMode button').forEach(b => b.addEventListener('click', () => {
    inner.querySelectorAll('#impMode button').forEach(x => x.classList.remove('on')); b.classList.add('on'); mode = b.dataset.m;
  }));
  inner.querySelector('#impFile').addEventListener('change', e => {
    file = e.target.files[0]; inner.querySelector('#impFileName').textContent = file ? file.name : '';
    inner.querySelector('#impGo').disabled = !file;
  });
  inner.querySelector('#impGo').addEventListener('click', async () => {
    if (!file) return;
    const isNew = impProfile.value === '__new__';
    const name = isNew ? inner.querySelector('#impName').value.trim() : '';
    if (isNew && !name) { toast('Poné el nombre del perfil nuevo'); return; }
    const fd = new FormData(); fd.append('file', file); fd.append('mode', mode);
    if (isNew) { fd.append('owner_name', name); fd.append('new_profile', '1'); }
    else { fd.append('owner_id', impProfile.value); }
    const goBtn = inner.querySelector('#impGo'); const prog = inner.querySelector('#impProg');
    goBtn.textContent = 'Importando…'; goBtn.disabled = true;
    try {
      const r = await api('/import', { method: 'POST', body: fd });
      await loadOwners(); S.owner = r.owner_id;
      // completar datos faltantes (imágenes) del CSV importado
      prog.innerHTML = `<p style="color:var(--ink-dim);font-size:13px">Trayendo imágenes y datos de BGG…</p>
        <div class="hbar-track"><span class="hbar-fill" id="impfill" style="width:0%;background:var(--brass)"></span></div>`;
      await enrichLoop(S.owner, (d, t) => { const f = $('#impfill'); if (f) f.style.width = (t ? d / t * 100 : 100) + '%'; });
      await loadGames();
      ov.remove(); render(); toast(`Importado: ${r.updated} juegos${r.added_games ? ', ' + r.added_games + ' nuevos' : ''}`);
    } catch (e) { toast('Error: ' + e.message); goBtn.textContent = 'Importar'; goBtn.disabled = false; }
  });
  inner.querySelector('#expBtn').addEventListener('click', () => { window.location = '/api/export.csv?owner=' + S.owner; });

  // frescura de datos
  const freshBox = inner.querySelector('#freshBox'); const refreshBtn = inner.querySelector('#refreshBtn');
  (async () => {
    try {
      const f = await api('/freshness?owner=' + S.owner);
      if (f.oldest_days == null) { freshBox.textContent = 'Sin datos de BGG todavía.'; return; }
      const stale = f.oldest_days >= 30;
      freshBox.innerHTML = stale
        ? `⚠️ Lo más viejo se actualizó hace <b>${f.oldest_days} días</b>. Conviene refrescar los rankings.`
        : `✓ Datos frescos (lo más viejo, hace ${f.oldest_days} días).`;
      refreshBtn.style.display = 'block';
    } catch { freshBox.textContent = ''; }
  })();
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true; let total = null, done = 0;
    for (let i = 0; i < 200; i++) {
      const r = await api(`/refresh?owner=${S.owner}&limit=25&days=30`);
      if (total === null) total = r.refreshed + r.remaining;
      done += r.refreshed;
      refreshBtn.textContent = `🔄 Actualizando… ${done}/${total || done}`;
      if (r.remaining === 0 || r.refreshed === 0) break;
    }
    await loadGames(); refreshBtn.textContent = '✓ Actualizado'; freshBox.innerHTML = '✓ Datos frescos.';
    toast(`Actualizados ${done} juegos`); if (S.view === 'panel') render();
  });

  const ov = overlay(inner, 'sheet');
}

/* chequeo no intrusivo de frescura al iniciar */
async function checkFreshness() {
  try {
    const f = await api('/freshness?owner=' + S.owner);
    if (f.oldest_days != null && f.oldest_days >= 35)
      toast('Tus datos tienen más de un mes · actualizalos en ⇅');
  } catch {}
}

/* ================= ONBOARDING ================= */
async function enrichLoop(owner, onProgress) {
  let total = null, done = 0;
  for (let i = 0; i < 200; i++) {
    const r = await api(`/enrich?owner=${owner}&limit=25`);
    if (total === null) total = r.enriched + r.remaining;
    done += r.enriched;
    if (onProgress) onProgress(done, total || done + r.remaining, r.remaining);
    if (r.remaining === 0 || r.enriched === 0) break;
  }
}

function openOnboarding() {
  const inner = node(`<div class="sheet-body" style="text-align:center">
    <div class="die" style="width:64px;height:64px;font-size:34px;border-radius:18px;margin:0 auto 14px;display:grid;place-items:center;background:linear-gradient(150deg,var(--brass-2),var(--brass));color:var(--brass-ink);transform:rotate(-6deg)">🎲</div>
    <h2 style="font-size:26px">Bienvenido a tu Ludoteca</h2>
    <p style="color:var(--ink-dim);margin:6px auto 22px;max-width:420px">¿Cómo querés empezar? Podés cargar tu colección en segundos o ir sumando juegos a mano.</p>
    <div style="display:flex;flex-direction:column;gap:12px;text-align:left">
      <button class="onb" data-c="bgg"><div class="oic">📥</div><div><b>Tengo un export de BoardGameGeek</b><span>Subí el CSV de tu colección y lo completo con imágenes y datos.</span></div></button>
      <button class="onb" data-c="backup"><div class="oic">💾</div><div><b>Tengo un backup de esta app</b><span>Restaurá un CSV que descargaste antes desde acá.</span></div></button>
      <button class="onb" data-c="scratch"><div class="oic">✨</div><div><b>Empezar de cero</b><span>Buscá y agregá tus juegos uno por uno.</span></div></button>
    </div>
    <div id="onbProg" style="margin-top:18px"></div>
  </div>`);
  // estilos inline para los botones de onboarding
  inner.querySelectorAll('.onb').forEach(b => {
    b.style.cssText = 'display:flex;gap:14px;align-items:center;padding:16px;border-radius:14px;background:var(--surface);border:1px solid var(--line);transition:.15s;text-align:left';
    b.onmouseenter = () => { b.style.borderColor = 'var(--brass)'; b.style.transform = 'translateY(-2px)'; };
    b.onmouseleave = () => { b.style.borderColor = 'var(--line)'; b.style.transform = 'none'; };
    b.querySelector('.oic').style.cssText = 'font-size:28px;flex:none';
    const d = b.querySelector('div:last-child'); d.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    b.querySelector('b').style.cssText = 'font-family:Bricolage Grotesque;font-size:15px';
    b.querySelector('span').style.cssText = 'color:var(--ink-dim);font-size:13px';
  });

  const prog = inner.querySelector('#onbProg');
  async function handleFile(mode) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv';
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      prog.innerHTML = '<div class="spinner"></div><p style="color:var(--ink-dim)">Importando tu colección…</p>';
      const fd = new FormData(); fd.append('file', file); fd.append('mode', 'both');
      try {
        const r = await api('/import', { method: 'POST', body: fd });
        await loadOwners();
        if (mode === 'bgg') {
          prog.innerHTML = `<p style="color:var(--ink-dim)">Trayendo imágenes y datos de BGG…</p>
            <div class="bar-row"><span class="track"><span class="fill" id="obfill" style="width:0%"></span></span><span class="num" id="obnum"></span></div>`;
          await enrichLoop(S.owner, (d, t, rem) => {
            const pc = t ? Math.round(d / t * 100) : 100;
            const f = $('#obfill'), n = $('#obnum'); if (f) f.style.width = pc + '%'; if (n) n.textContent = rem;
          });
        }
        await loadGames(); ov.remove(); render();
        toast(`¡Listo! ${r.updated} juegos cargados.`);
      } catch (e) { prog.innerHTML = `<p style="color:var(--danger)">Error: ${esc(e.message)}</p>`; }
    };
    inp.click();
  }
  inner.querySelectorAll('.onb').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.c;
    if (c === 'scratch') { ov.remove(); openAdd(); }
    else handleFile(c);
  }));
  const ov = overlay(inner, 'sheet');
}

/* ================= CONFIG ================= */
async function openConfig() {
  let cfg; try { cfg = await api('/config'); } catch { cfg = {}; }
  const inner = node(`<div class="sheet-body">
    <h2 style="margin-bottom:6px">Configuración</h2>
    <p style="color:var(--ink-dim);margin:0 0 18px;font-size:13.5px">El <b>Advisor con agente</b> usa <b>Google Gemini</b> (tiene <b>tier gratis</b>). Conseguí una API key gratis en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> y pegala acá.</p>
    <div class="field">
      <label>API key de Google AI Studio ${cfg.gemini_key_set ? `<span style="color:var(--good)">· configurada (${esc(cfg.gemini_key_hint)})</span>` : ''}</label>
      <input id="cfgKey" type="password" placeholder="${cfg.gemini_key_set ? 'Ya configurada — dejá vacío para no cambiarla' : 'Pegá acá tu API key'}">
    </div>
    <div class="field">
      <label>Modelo Gemini</label>
      <input id="cfgModel" value="${esc(cfg.gemini_model || 'gemini-3.6-flash')}">
      <p style="color:var(--ink-dim);font-size:12px;margin:6px 0 0">Viene con el último Flash gratis. Podés cambiarlo si Google saca uno nuevo.</p>
    </div>
    <button class="btn primary block" id="cfgSave">Guardar</button>
    <p style="color:var(--ink-dim);font-size:12px;margin-top:12px">La key se guarda solo en tu máquina (config.json, no se sube al repo). Sin key, el Advisor funciona igual en modo determinístico.</p>
  </div>`);
  inner.querySelector('#cfgSave').addEventListener('click', async () => {
    const patch = { default_engine: 'gemini', gemini_model: inner.querySelector('#cfgModel').value.trim() };
    const key = inner.querySelector('#cfgKey').value.trim(); if (key) patch.gemini_api_key = key;
    try {
      const pub = await api('/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      S.geminiReady = !!pub.gemini_key_set;
      ov.remove(); toast('Configuración guardada');
      if (S.view === 'advisor') render();   // habilita/deshabilita el agente al toque
    } catch (e) { toast('Error: ' + e.message); }
  });
  const ov = overlay(inner, 'sheet');
}
