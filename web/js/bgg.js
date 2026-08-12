/* Vista BGG: browse del top con filtros server-side, paginado y scroll infinito. */
import { card } from './card.js';
import { SUBDOMAIN, typeColor, typeEs } from './domain.js';
import { activeSelectCount, assembleFilterBar, hasActiveFilters, mechFacet, sortOptsFor, syncGroupBadge } from './filters.js';
import { BGGV, S } from './state.js';
import { $, api, esc, node, toast } from './util.js';

// firma de los filtros compartidos: si cambia mientras estás en otra vista, BGG recarga al volver.
function bggFilterSig() {
  const f = S.filters;
  return JSON.stringify([f.q, [...f.types].sort(), [...f.mechanics].sort(),
    f.players, f.time, f.weight, f.designer, f.sort, f.sortDir]);
}
function bggParams() {
  const f = S.filters;
  const p = new URLSearchParams({
    owner: S.owner, page: BGGV.page, per: 100, q: f.q, sort: f.sort, dir: f.sortDir,
  });
  if (f.types.size) p.set('types', [...f.types].join(','));
  if (f.mechanics.size) p.set('mechanics', [...f.mechanics].join('~'));  // '~': los nombres traen comas
  if (f.players) p.set('players', f.players);
  if (f.time) p.set('time', f.time);
  if (f.weight) p.set('weight', f.weight);
  if (f.designer) p.set('designer', f.designer);
  return p.toString();
}
function bggHasActiveFilters() { return hasActiveFilters(); }   // mismo S.filters que Biblioteca

async function bggFetch(reset) {
  if (BGGV.loading) return [];
  BGGV.loading = true;
  if (reset) { BGGV.page = 0; BGGV.games = []; BGGV.sig = bggFilterSig(); }
  let added = [];
  try {
    const d = await api('/bgg?' + bggParams());
    added = d.games;
    BGGV.games = BGGV.games.concat(d.games);
    BGGV.total = d.total; BGGV.hasMore = d.has_more; BGGV.owner = S.owner;
  } catch (e) { toast('Error: ' + e.message); }
  BGGV.loading = false;
  return added;
}

// recarga desde cero (cambió un filtro/orden/búsqueda): spinner → fetch(reset) → repaint
async function bggReload() {
  const grid = $('#bggGrid'); if (grid) grid.innerHTML = '<div class="spinner"></div>';
  await bggFetch(true);
  paintBGG();
}

let bggSearchT;
function renderBGGFilters() {
  const f = S.filters;   // BGG comparte el mismo estado de filtros/orden que Biblioteca y Wishlist
  const bar = node('<div class="filters"></div>');

  const search = node(`<div class="search">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
    <input id="bggSearch" placeholder="Buscar en el top de BGG…" value="${esc(f.q)}">
  </div>`);
  search.querySelector('input').addEventListener('input', e => {
    f.q = e.target.value; clearTimeout(bggSearchT); bggSearchT = setTimeout(bggReload, 350);
  });
  bar.append(search);

  const players = node(`<select title="Jugadores"><option value="0">Jugadores</option>${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}" ${f.players === n ? 'selected' : ''}>${n} jugador${n > 1 ? 'es' : ''}</option>`).join('')}</select>`);
  players.addEventListener('change', e => {
    f.players = +e.target.value;
    // ítem 9: elegir cantidad activa el orden por ajuste; quitarla revierte a ranking
    if (f.players) f.sort = 'fit';
    else if (f.sort === 'fit') f.sort = 'rank';
    renderBGG($('#main'));   // rehace la barra (muestra/oculta "fit") y recarga server-side
  });

  const time = node(`<select title="Duración"><option value="">Duración</option><option value="short" ${f.time === 'short' ? 'selected' : ''}>Corto (&lt;30m)</option><option value="mid" ${f.time === 'mid' ? 'selected' : ''}>Medio (30–89m)</option><option value="long" ${f.time === 'long' ? 'selected' : ''}>Largo (90m+)</option></select>`);
  time.addEventListener('change', e => { f.time = e.target.value; bggReload(); });

  const weight = node(`<select title="Complejidad"><option value="">Complejidad</option><option value="light" ${f.weight === 'light' ? 'selected' : ''}>Liviana</option><option value="mid" ${f.weight === 'mid' ? 'selected' : ''}>Media</option><option value="heavy" ${f.weight === 'heavy' ? 'selected' : ''}>Pesada</option></select>`);
  weight.addEventListener('change', e => { f.weight = e.target.value; bggReload(); });

  const sortOpts = sortOptsFor('bgg', f);
  const sort = node(`<select title="Ordenar por">${sortOpts.map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>Orden: ${l}</option>`).join('')}</select>`);
  sort.addEventListener('change', e => { f.sort = e.target.value; bggReload(); });

  const dirBtn = node(`<button class="mini-select sortdir ${f.sortDir === -1 ? 'flipped' : ''}" title="Invertir orden">${f.sortDir === 1 ? '↓' : '↑'}</button>`);
  dirBtn.addEventListener('click', () => {
    f.sortDir = f.sortDir === 1 ? -1 : 1;
    dirBtn.textContent = f.sortDir === 1 ? '↓' : '↑';
    dirBtn.classList.toggle('flipped', f.sortDir === -1);
    bggReload();
  });

  const typeChips = Object.keys(SUBDOMAIN).map(s => {
    const c = node(`<button class="chip ${f.types.has(s) ? 'active' : ''}" style="--c:${typeColor(s)}"><span class="dot"></span>${typeEs(s)}</button>`);
    c.addEventListener('click', () => { f.types.has(s) ? f.types.delete(s) : f.types.add(s); c.classList.toggle('active'); bggReload(); });
    return c;
  });
  const mech = mechFacet(f.mechanics, bggReload);   // grupo Mecánicas (colapsable), server-side
  // BGG no tiene combo de diseñador (serían ~2800 opciones): el filtro se activa al clickear un
  // diseñador en una ficha. Si está activo, lo mostramos como chip removible.
  let dchip = null;
  if (f.designer) {
    dchip = node(`<button class="chip active" title="Quitar filtro de diseñador">🖋 ${esc(f.designer)} ✕</button>`);
    dchip.addEventListener('click', () => { f.designer = ''; renderBGG($('#main')); });
  }
  const clearBtn = node('<button class="chip clear-filters" id="bggClear">✕ Limpiar filtros</button>');
  clearBtn.addEventListener('click', () => {
    S.filters = { q: '', types: new Set(), mechanics: new Set(), players: 0, time: '', weight: '', designer: '', sort: f.sort === 'fit' ? 'rank' : f.sort, sortDir: f.sortDir };
    renderBGG($('#main'));   // reconstruye la barra con los controles reseteados y recarga
  });
  clearBtn.style.display = bggHasActiveFilters() ? 'inline-flex' : 'none';
  const countTag = node('<span class="count-tag" id="bggCount"></span>');

  // BGG no tiene combo de diseñador (~2800 opciones): el diseñador activo es un chip removible (dchip).
  // En compacto va DENTRO del panel Filtros (en el slot del diseñador, para que activeSelectCount lo
  // cuente igual que en Biblioteca); en tablet horizontal/desktop va suelto (p.designerChip).
  const inline = [players, time, weight, sort, dirBtn];
  const filtrosBody = [players, time, weight];
  if (dchip) filtrosBody.push(dchip);         // slot del diseñador dentro del panel Filtros
  filtrosBody.push(sort, dirBtn);
  assembleFilterBar(bar, {
    inline, filtrosBody, typeChips, mech,
    clearBtn, countTag, designerChip: dchip, activeCount: activeSelectCount(f),
  });
  return bar;
}

export async function renderBGG(m) {
  // 'prio' es exclusivo de Wishlist: si venías con ese orden, normalizá a ranking para BGG
  const valid = sortOptsFor('bgg', S.filters).map(o => o[0]);
  if (!valid.includes(S.filters.sort)) S.filters.sort = valid[0];

  const v = node('<div class="view"></div>');
  v.append(renderBGGFilters());
  v.append(node('<div class="grid" id="bggGrid"></div>'));
  v.append(node('<div id="bggMore" style="text-align:center;margin:20px 0"></div>'));
  m.innerHTML = ''; m.append(v);

  // recarga si: cambió el perfil, cambiaron los filtros desde otra vista (sig), o no hay datos aún
  if (BGGV.owner !== S.owner || BGGV.sig !== bggFilterSig() || (!BGGV.games.length && !BGGV.loading)) {
    $('#bggGrid').innerHTML = '<div class="spinner"></div>';
    await bggFetch(true);
  }
  paintBGG();
}

function paintBGG() {
  const grid = $('#bggGrid'); if (!grid) return;
  grid.innerHTML = '';
  if (!BGGV.games.length) grid.append(node('<div class="empty"><div class="ic">🎲</div><p>Sin resultados.</p></div>'));
  else BGGV.games.forEach(g => grid.append(card(g)));
  const cnt = $('#bggCount'); if (cnt) cnt.textContent = `${BGGV.total.toLocaleString('es-AR')} juego${BGGV.total === 1 ? '' : 's'}`;
  const clr = $('#bggClear'); if (clr) clr.style.display = bggHasActiveFilters() ? 'inline-flex' : 'none';
  const f = S.filters;   // mantener los badges al día tras repintar (incluye el diseñador, que en BGG
  syncGroupBadge('filtros', activeSelectCount(f));   // va como chip DENTRO del panel Filtros → cuenta para el (N))
  syncGroupBadge('tipo', f.types.size);
  setupBGGInfinite();
}

// scroll infinito: un centinela al final dispara la carga de la próxima página.
// Fallback a botón manual si el navegador no soporta IntersectionObserver.
let bggObserver = null;
function setupBGGInfinite() {
  const more = $('#bggMore'); if (!more) return;
  if (bggObserver) { bggObserver.disconnect(); bggObserver = null; }
  more.innerHTML = '';
  if (!BGGV.hasMore) return;

  const loadNext = async () => {
    if (BGGV.loading || !BGGV.hasMore) return;
    BGGV.page++;
    const added = await bggFetch(false);
    const grid = $('#bggGrid');
    if (grid) added.forEach(g => grid.append(card(g)));   // append incremental (no repinta todo)
    setupBGGInfinite();                                    // reubica el centinela al nuevo final
  };

  if ('IntersectionObserver' in window) {
    more.innerHTML = `<div class="bgg-sentinel" id="bggSentinel"><div class="spinner" style="margin:0 auto"></div>
      <span class="count-tag" style="margin:0">${BGGV.games.length} de ${BGGV.total.toLocaleString('es-AR')}</span></div>`;
    bggObserver = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) loadNext();
    }, { rootMargin: '600px 0px' });                       // precarga antes de tocar fondo
    bggObserver.observe($('#bggSentinel'));
  } else {
    const btn = node(`<button class="btn">Cargar más · ${BGGV.games.length} de ${BGGV.total.toLocaleString('es-AR')}</button>`);
    btn.addEventListener('click', () => { btn.textContent = 'Cargando…'; btn.disabled = true; loadNext(); });
    more.append(btn);
  }
}
