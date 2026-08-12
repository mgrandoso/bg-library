/* Panel de estadisticas de la coleccion. */
import { WEIGHT_LABELS, typeColor, typeEs } from './domain.js';
import { S } from './state.js';
import { api, esc, node } from './util.js';

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

export async function renderPanel(m) {
  m.append(node('<div class="view"><div class="spinner"></div></div>'));
  const src = S.panelSource || 'own';
  let st;
  try { st = await api('/stats?owner=' + S.owner + '&source=' + src); } catch (e) { m.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; return; }
  S.stats = st;
  const h = st.highlights || {}; const sm = st.summary || {};
  const v = node('<div class="view"></div>');
  const grid = node('<div class="stat-grid"></div>');

  // --- Tu colección: dos sub-tarjetas clickeables (biblioteca / wishlist) que cambian la fuente ---
  const summary = node(`<div class="panel summary" style="grid-column:span 4">
    <h3>Tu colección</h3>
    <div class="src-toggle">
      <button class="src-card ${src === 'own' ? 'on' : ''}" data-src="own">
        <div class="bigstat">${st.counts.own}</div><div class="src-l">📦 en tu biblioteca</div></button>
      <button class="src-card ${src === 'wishlist' ? 'on' : ''}" data-src="wishlist">
        <div class="bigstat" style="color:var(--m-party)">${st.counts.wishlist}</div><div class="src-l">⭐ en tu wishlist</div></button>
    </div>
    <div class="mini-stats">
      <div class="ms"><span class="ms-k">Complejidad media</span><span class="ms-v">${sm.avg_weight ? sm.avg_weight + ' / 5' : '—'}</span></div>
      <div class="ms"><span class="ms-k">Duración típica</span><span class="ms-v">${sm.median_time ? sm.median_time + ' min' : '—'}</span></div>
      <div class="ms"><span class="ms-k">Diseñadores</span><span class="ms-v">${sm.designers || 0}</span></div>
      <div class="ms"><span class="ms-k">Mecánicas distintas</span><span class="ms-v">${sm.mechanics || 0}</span></div>
    </div>
  </div>`);
  summary.querySelectorAll('.src-card').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.src === S.panelSource) return;
    S.panelSource = b.dataset.src; renderPanel(m);
  }));
  grid.append(summary);

  // --- Destacados ---
  const hi = [
    ['🤝', h.coop, 'cooperativos', 'var(--m-abstract)'],
    ['🎉', h.party, 'de fiesta', 'var(--m-party)'],
    ['👥', h.two, 'ideales para 2', 'var(--m-strategy)'],
    ['🎪', h.big, 'para grupos grandes (5+)', 'var(--m-thematic)'],
    ['⚡', h.quick, 'rápidos (≤30′)', 'var(--brass)'],
    ['🌙', h.long, 'para toda la noche (120′+)', 'var(--m-war)'],
  ];
  grid.append(node(`<div class="panel highlights" style="grid-column:span 8">
    <h3>Destacados de ${src === 'wishlist' ? 'tu wishlist' : 'tu biblioteca'}</h3>
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
    <div class="age-note"><span>🧸 Infantiles <small>(diseñados para los más peques)</small></span><b>${infantiles}</b></div></div>`));

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
    ${src === 'own' && st.gaps && st.gaps.length ? `<div class="gap-note">💡 Cubrís poco los <b>${st.gaps.join(', ')} jugadores</b>. El advisor lo tiene en cuenta en "¿Qué compro?".</div>` : ''}
  </div>`));

  // --- Diseñadores ---
  const desEntries = st.top_designers.map(([n, c]) => [n, c, 'var(--brass-2)']);
  grid.append(node(`<div class="panel" style="grid-column:span 5"><h3>Diseñadores más presentes</h3>${desEntries.length ? bars(desEntries, Math.max(1, ...desEntries.map(e => e[1]))) : '<p style="color:var(--ink-dim)">Sin datos</p>'}</div>`));

  v.append(grid); m.innerHTML = ''; m.append(v);
}
