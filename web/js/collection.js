/* Vistas Biblioteca y Wishlist: filtrado en cliente, barra de filtros y grilla. */
import { card } from './card.js';
import { SUBDOMAIN, typeColor, typeEs, weightBucket } from './domain.js';
import { activeSelectCount, assembleFilterBar, fitTier, hasActiveFilters, mechFacet, passesMechanics, sortOptsFor, syncGroupBadge } from './filters.js';
import { render } from './router.js';
import { S } from './state.js';
import { $, esc, node } from './util.js';

/* ================= biblioteca / wishlist ================= */
function currentList(kind) {
  let list = S.games.filter(g => kind === 'own' ? g.own : g.wishlist);
  const f = S.filters;
  if (f.q) {
    const q = f.q.toLowerCase();
    // En Biblioteca (kind='own') el buscador matchea también por nombre de una expansión que TENÉS
    // (📦) → surface-ea la carta del juego madre. La Wishlist busca solo por nombre de juego.
    list = list.filter(g => (g.name || '').toLowerCase().includes(q)
      || (g.es_name || '').toLowerCase().includes(q)
      || (kind === 'own' && (g.expansions || []).some(
        e => e.state === 'own' && (e.name || '').toLowerCase().includes(q))));
  }
  if (f.types.size) list = list.filter(g => (g.subdomains || []).some(s => f.types.has(s)));
  if (f.mechanics.size) list = list.filter(g => passesMechanics(g, f.mechanics));
  if (f.players) list = list.filter(g => (g.minplayers || 0) <= f.players && (g.maxplayers || 0) >= f.players);
  if (f.time) list = list.filter(g => {
    const t = g.maxplaytime || g.minplaytime || 0;
    return f.time === 'short' ? t > 0 && t < 30 : f.time === 'mid' ? t >= 30 && t <= 89 : t >= 90;
  });
  if (f.weight) list = list.filter(g => { const b = weightBucket(g.weight); return f.weight === 'light' ? b <= 1 : f.weight === 'mid' ? b === 2 : b >= 3; });
  if (f.designer) list = list.filter(g => (g.designers || []).some(d => d.name === f.designer));
  const s = f.sort, dir = f.sortDir || 1;   // dir 1 = orden más lógico (mejor/primero); -1 invierte
  list.sort((a, b) => {
    let cmp = 0;
    if (s === 'rank') cmp = (a.rank_overall || 1e9) - (b.rank_overall || 1e9);
    else if (s === 'rating') cmp = (b.rating_bayes || 0) - (a.rating_bayes || 0);
    else if (s === 'weight') cmp = (b.weight || 0) - (a.weight || 0);
    else if (s === 'year') cmp = (+b.yearpublished || 0) - (+a.yearpublished || 0);
    else if (s === 'name') cmp = (a.name || '').localeCompare(b.name || '');
    else if (s === 'prio') cmp = ((a.wishlist_priority || 3) - (b.wishlist_priority || 3))
      || ((a.rank_overall || 1e9) - (b.rank_overall || 1e9));   // empate de prioridad -> mejor rank BGG primero
    else if (s === 'time') cmp = (a.maxplaytime || 0) - (b.maxplaytime || 0);
    else if (s === 'fit') cmp = (fitTier(a, f.players) - fitTier(b, f.players))
      || ((a.rank_overall || 1e9) - (b.rank_overall || 1e9));   // ítem 9: mejor→peor para N jug.
    return s === 'fit' ? cmp : cmp * dir;   // "fit" siempre mejor primero (no lo invierte el dir)
  });
  return list;
}

export function renderCollection(kind) {
  const wrap = node('<div class="view"></div>');
  wrap.append(renderFilters(kind));
  const list = currentList(kind);
  // el contador de visibles también al pintar la vista (no solo al tocar un filtro): así al
  // cambiar de tab con un filtro ya activo, el número aparece igual. (refreshGrid lo re-setea luego)
  wrap.querySelector('#countTag').textContent = `${list.length} juego${list.length === 1 ? '' : 's'}`;
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
  players.addEventListener('change', e => {
    f.players = +e.target.value;
    // ítem 9: al elegir cantidad, el orden pasa a "Mejor para N jug."; al quitarla, revierte
    if (f.players) f.sort = 'fit';
    else if (f.sort === 'fit') f.sort = 'rank';
    render();   // rehace la barra para mostrar/ocultar la opción de orden por ajuste
  });

  const time = node(`<select title="Duración"><option value="">Duración</option><option value="short" ${f.time === 'short' ? 'selected' : ''}>Corto (&lt;30m)</option><option value="mid" ${f.time === 'mid' ? 'selected' : ''}>Medio (30–89m)</option><option value="long" ${f.time === 'long' ? 'selected' : ''}>Largo (90m+)</option></select>`);
  time.addEventListener('change', e => { f.time = e.target.value; refreshGrid(kind); });

  const weight = node(`<select title="Complejidad"><option value="">Complejidad</option><option value="light" ${f.weight === 'light' ? 'selected' : ''}>Liviana</option><option value="mid" ${f.weight === 'mid' ? 'selected' : ''}>Media</option><option value="heavy" ${f.weight === 'heavy' ? 'selected' : ''}>Pesada</option></select>`);
  weight.addEventListener('change', e => { f.weight = e.target.value; refreshGrid(kind); });

  // designers presentes en esta vista; si hay un diseñador activo que no está (p. ej. vino de un
  // click en BGG), lo agrego igual para que el combo lo muestre seleccionado y se pueda quitar.
  const designers = [...new Set(S.games.filter(g => kind === 'own' ? g.own : g.wishlist).flatMap(g => (g.designers || []).map(d => d.name)))].sort();
  if (f.designer && !designers.includes(f.designer)) designers.unshift(f.designer);
  const dsel = node(`<select class="flt-designer" title="Diseñador"><option value="">Diseñador</option>${designers.map(d => `<option ${f.designer === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>`);
  dsel.addEventListener('change', e => { f.designer = e.target.value; refreshGrid(kind); });

  const sortOpts = sortOptsFor(kind === 'wishlist' ? 'wishlist' : 'library', f);
  const validSorts = sortOpts.map(o => o[0]);
  if (!validSorts.includes(f.sort)) f.sort = validSorts[0];        // criterio no válido para esta vista -> default
  const sort = node(`<select title="Ordenar por">${sortOpts.map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>Orden: ${l}</option>`).join('')}</select>`);
  sort.addEventListener('change', e => { f.sort = e.target.value; refreshGrid(kind); });

  const dirBtn = node(`<button class="mini-select sortdir" title="Invertir orden">${f.sortDir === 1 ? '↓' : '↑'}</button>`);
  dirBtn.addEventListener('click', () => {
    f.sortDir = f.sortDir === 1 ? -1 : 1;
    dirBtn.textContent = f.sortDir === 1 ? '↓' : '↑';
    dirBtn.classList.toggle('flipped', f.sortDir === -1);
    refreshGrid(kind);
  });
  dirBtn.classList.toggle('flipped', f.sortDir === -1);

  // chips de tipo (8 subdominios) y faceta Mecánicas (ambos reusables en las dos ramas)
  const typeChips = Object.keys(SUBDOMAIN).map(s => {
    const c = node(`<button class="chip ${f.types.has(s) ? 'active' : ''}" style="--c:${typeColor(s)}"><span class="dot"></span>${typeEs(s)}</button>`);
    c.addEventListener('click', () => { f.types.has(s) ? f.types.delete(s) : f.types.add(s); c.classList.toggle('active'); refreshGrid(kind); });
    return c;
  });
  const mech = mechFacet(f.mechanics, () => refreshGrid(kind));   // grupo Mecánicas (colapsable)
  const clearBtn = node('<button class="chip clear-filters" id="clearFilters">✕ Limpiar filtros</button>');
  clearBtn.addEventListener('click', () => {
    S.filters = { q: '', types: new Set(), mechanics: new Set(), players: 0, time: '', weight: '', designer: '', sort: f.sort === 'fit' ? 'rank' : f.sort, sortDir: f.sortDir };
    render();
  });
  clearBtn.style.display = hasActiveFilters() ? 'inline-flex' : 'none';
  const countTag = node('<span class="count-tag" id="countTag"></span>');

  // Biblioteca/Wishlist: el diseñador es un combo (dsel) que va inline / en el panel Filtros → misma
  // lista para línea 1 y para el grupo Filtros. No hay chip removible de diseñador.
  const inline = [players, time, weight, dsel, sort, dirBtn];
  assembleFilterBar(bar, {
    inline, filtrosBody: inline, typeChips, mech,
    clearBtn, countTag, designerChip: null, activeCount: activeSelectCount(f),
  });
  return bar;
}

function refreshGrid(kind) {
  const list = currentList(kind);
  const wrap = $('#main .view');
  const old = wrap.querySelector('.grid, .empty'); if (old) old.remove();
  const tag = $('#countTag'); if (tag) tag.textContent = `${list.length} juego${list.length === 1 ? '' : 's'}`;
  const cb = $('#clearFilters'); if (cb) cb.style.display = hasActiveFilters() ? 'inline-flex' : 'none';
  syncGroupBadge('filtros', activeSelectCount(S.filters));   // celular: mantener badges al día
  syncGroupBadge('tipo', S.filters.types.size);
  if (!list.length) { wrap.append(node(`<div class="empty"><div class="ic">🎲</div><p>No hay juegos que coincidan.</p></div>`)); return; }
  const grid = node('<div class="grid"></div>');
  list.forEach(g => grid.append(card(g)));
  wrap.append(grid);
}
