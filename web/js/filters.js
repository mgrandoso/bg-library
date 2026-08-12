/* Maquinaria compartida de la barra de filtros: predicados, faceta de mecanicas,
   grupos colapsables y el ensamblado de la barra. La usan Biblioteca/Wishlist y BGG. */
import { MECHANICS } from './domain.js';
import { isCompact, isMobile, isTabletLandscape } from './responsive.js';
import { S } from './state.js';
import { esc, node } from './util.js';

// contador de filtros activos entre los selects (jugadores/duración/complejidad/diseñador);
// el orden no cuenta (siempre tiene un valor). Sirve para el badge del botón "Filtros" en celular.
export function activeSelectCount(f) {
  return (f.players ? 1 : 0) + (f.time ? 1 : 0) + (f.weight ? 1 : 0) + (f.designer ? 1 : 0);
}
// grupo colapsable de filtros para celular (mismo mecanismo que la faceta Mecánicas): un botón
// con conteo de activos + un panel full-width que se muestra/oculta. Devuelve {button, panel}.
// `id` permite refrescar el badge sin reconstruir la barra (ver syncGroupBadge).
function filterGroup(id, icon, label, count, bodyEls) {
  const button = node(`<button type="button" class="chip fgroup-btn ${count ? 'active' : ''}" data-grp="${id}"><span class="fg-lbl">${icon} ${esc(label)}${count ? ` (${count})` : ''}</span> <span class="caret">▾</span></button>`);
  button.dataset.icon = icon; button.dataset.label = label;
  const panel = node('<div class="fpanel" hidden></div>');
  bodyEls.forEach(el => panel.append(el));
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.classList.toggle('open', !panel.hidden);
  });
  return { button, panel };
}
// acordeón (celular): un solo grupo abierto a la vez. Cada grupo ya togglea su propio panel al
// hacer click; acá, después de ese toggle, cerramos los demás. Así abrir uno colapsa al resto y
// volver a tocar el abierto lo cierra (queda todo colapsado).
function wireAccordion(groups) {
  groups.forEach(g => g.button.addEventListener('click', () => {
    groups.forEach(o => {
      if (o === g) return;
      o.panel.hidden = true;
      o.button.classList.remove('open');
    });
  }));
}
// actualiza el badge "(N)" y el resaltado de un grupo sin repintar la barra. No-op en desktop
// (los botones de grupo no existen). Se llama donde ya refrescamos contador/limpiar.
export function syncGroupBadge(id, count) {
  const btn = document.querySelector(`.fgroup-btn[data-grp="${id}"]`);
  if (!btn) return;
  btn.classList.toggle('active', !!count);
  btn.querySelector('.fg-lbl').textContent = `${btn.dataset.icon} ${btn.dataset.label}${count ? ` (${count})` : ''}`;
}

// cooperativo = mecánica (ítem 9), eje ortogonal a los 8 subdominios. Espeja advisor._is_coop.
function isCoop(g) {
  const blob = [...(g.mechanics || []), ...(g.categories || [])].join(' ');
  return /cooperative|co-operative/i.test(blob);
}
// match de una mecánica curada: coop mira mechanics+categories; el resto, string canónico exacto.
function matchesMechanic(g, canonical) {
  return canonical === 'Cooperative Game' ? isCoop(g) : (g.mechanics || []).includes(canonical);
}
// OR dentro del grupo de mecánicas (pasa si tiene alguna de las seleccionadas)
export function passesMechanics(g, set) {
  for (const m of set) if (matchesMechanic(g, m)) return true;
  return false;
}

// Facet "Mecánicas" colapsable (ítem 9), reusable en Biblioteca y BGG. Devuelve {button, panel}:
// el botón muestra el conteo activo y togglea el panel de 8 chips; onChange se llama al tildar.
export function mechFacet(set, onChange) {
  const label = () => `🛠 Mecánicas${set.size ? ` (${set.size})` : ''}`;
  const button = node(`<button class="chip mech-btn ${set.size ? 'active' : ''}" title="Filtrar por mecánica"><span class="mech-lbl">${label()}</span> <span class="caret">▾</span></button>`);
  const panel = node('<div class="mech-panel" hidden></div>');
  MECHANICS.forEach(([canon, lbl]) => {
    const c = node(`<button class="chip mech-chip ${set.has(canon) ? 'active' : ''}">${lbl}</button>`);
    c.addEventListener('click', () => {
      set.has(canon) ? set.delete(canon) : set.add(canon);
      c.classList.toggle('active');
      button.classList.toggle('active', set.size > 0);
      button.querySelector('.mech-lbl').textContent = label();
      onChange();
    });
    panel.append(c);
  });
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.classList.toggle('open', !panel.hidden);
  });
  return { button, panel };
}
// tier de ajuste a N jugadores: 0 ideal · 1 va bien · 2 se banca · 3 no entra (espeja playerFit)
export function fitTier(g, n) {
  if (!n) return 3;
  if ((g.best_players || []).includes(n)) return 0;
  if ((g.recommended_players || []).includes(n)) return 1;
  if ((g.minplayers || 0) <= n && (g.maxplayers || 0) >= n) return 2;
  return 3;
}

// Ensamblado de la barra de filtros, común a Biblioteca/Wishlist y BGG: la estructura de las tres ramas
// (compacto con 3 grupos colapsables / tablet horizontal con 2 botones / desktop inline) es idéntica,
// así que vivía duplicada en las dos funciones. Acá se arma una sola vez; las diferencias entre vistas
// llegan ya resueltas en `p`:
//   p.inline       controles de la línea 1 en desktop y tablet horizontal (Biblioteca incluye el combo
//                  de diseñador; BGG no —allá el diseñador es un chip removible → p.designerChip)
//   p.filtrosBody  cuerpo del grupo "Filtros" en compacto (mismos controles ordenados para el panel)
//   p.typeChips    chips de tipo (grupo "Tipo") · p.mech faceta "Mecánicas" ({button, panel}) ya cableada
//   p.clearBtn, p.countTag   tail (Limpiar + contador); cada vista ya les puso su id
//   p.designerChip chip removible de diseñador (solo BGG; suelto en tablet horizontal/desktop) o null
//   p.activeCount  nº de selects activos → badge "(N)" del grupo Filtros en compacto
export function assembleFilterBar(bar, p) {
  const f = S.filters;
  const mkTail = () => { const t = node('<div class="filters-tail"></div>'); t.append(p.clearBtn, p.countTag); return t; };
  if (isCompact()) {
    // celular / tablet vertical: tres grupos colapsables (Filtros / Tipo / Mecánicas) + Limpiar/contador
    const gFiltros = filterGroup('filtros', '🎛', 'Filtros', p.activeCount, p.filtrosBody);
    const gTipo = filterGroup('tipo', '🏷', 'Tipo', f.types.size, p.typeChips);
    const fbtns = node('<div class="fbtns"></div>');
    fbtns.append(gFiltros.button, gTipo.button, p.mech.button);
    wireAccordion([gFiltros, gTipo, p.mech]);   // un solo grupo abierto a la vez
    const tail = mkTail();
    // celular: Limpiar + "N juegos" en su propia fila abajo. Tablet vertical: en la misma fila de los
    // botones, a la derecha (CSS: .fbtns .filters-tail).
    if (isMobile()) bar.append(fbtns, gFiltros.panel, gTipo.panel, p.mech.panel, tail);
    else { fbtns.append(tail); bar.append(fbtns, gFiltros.panel, gTipo.panel, p.mech.panel); }
  } else if (isTabletLandscape()) {
    // tablet horizontal: línea 1 inline (como PC); línea 2 con DOS botones colapsables (Tipo/Mecánica)
    // en acordeón + Limpiar/contador a la derecha. El diseñador activo (BGG) va suelto en esa fila.
    bar.append(...p.inline);
    const gTipo = filterGroup('tipo', '🏷', 'Tipo', f.types.size, p.typeChips);
    const fbtns = node('<div class="fbtns"></div>');
    fbtns.append(gTipo.button, p.mech.button);
    if (p.designerChip) fbtns.append(p.designerChip);
    fbtns.append(mkTail());
    wireAccordion([gTipo, p.mech]);   // un solo grupo abierto a la vez
    bar.append(fbtns, gTipo.panel, p.mech.panel);
  } else {
    // desktop: todo inline, como siempre
    bar.append(...p.inline);
    const chips = node('<div class="type-chips"></div>');
    p.typeChips.forEach(c => chips.append(c));
    chips.append(p.mech.button);
    if (p.designerChip) chips.append(p.designerChip);
    chips.append(p.clearBtn, p.countTag);
    bar.append(chips, p.mech.panel);
  }
}

export function hasActiveFilters() {
  const f = S.filters;
  return !!(f.q || f.types.size || f.mechanics.size || f.players || f.time || f.weight || f.designer);
}

// Opciones de orden por vista: 'prio' solo en Wishlist; 'fit' aparece al elegir N jugadores.
// El resto es común a las tres vistas (misma semántica en cliente y servidor) → orden consistente.
export function sortOptsFor(view, f) {
  const opts = view === 'wishlist'
    ? [['rank', 'Ranking BGG'], ['prio', 'Prioridad'], ['rating', 'Rating'], ['weight', 'Complejidad'], ['time', 'Duración'], ['year', 'Año'], ['name', 'Nombre']]
    : [['rank', 'Ranking BGG'], ['rating', 'Rating'], ['weight', 'Complejidad'], ['time', 'Duración'], ['year', 'Año'], ['name', 'Nombre']];
  if (f.players) opts.unshift(['fit', `Mejor para ${f.players} jug.`]);
  return opts;
}
