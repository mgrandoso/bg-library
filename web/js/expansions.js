/* Expansiones: seccion dentro de la ficha del juego madre + panel de gestion. */
import { setupDescription } from './detail.js';
import { overlay } from './modal.js';
import { ensureUnlocked, mutationsLocked } from './safemode.js';
import { S } from './state.js';
import { api, esc, node, safeImg, toast } from './util.js';

/* ===== Expansiones (ítem 3): viven dentro de la ficha del juego madre ===== */
// Sección en la ficha: las expansiones que tenés/deseás (📦/⭐) + un "＋" para agregar/editar.
// Solo aparece si el juego está en tu colección o wishlist (si no, no podés tener expansiones).
export async function renderExpansions(inner, g, opts = {}) {
  const box = inner.querySelector('#expSection'); if (!box) return;
  if (g._preview || g._expansion) return;                 // preview sin guardar / ficha de expa
  if (!(g.own || g.wishlist)) return;                     // gate: solo juegos tuyos
  const draw = (mine) => {
    g.expansions = mine;                                  // cachear para el buscador de biblioteca
    const chips = mine.map(e =>
      `<span class="tagchip">${e.state === 'own' ? '📦' : '⭐'} ${esc(e.name)}</span>`).join('');
    // el lápiz de edición se oculta en solo lectura (advisor) o con el candado cerrado (modo seguro)
    const editBtn = (opts.readonly || mutationsLocked()) ? '' : ' <button class="exp-add" title="Agregar, editar o quitar expansiones">✎</button>';
    box.innerHTML = `<div><div class="section-h" style="margin-top:8px;display:flex;align-items:center;gap:8px">
        Expansiones${editBtn}</div>
      ${mine.length ? `<div class="chips-line">${chips}</div>`
        : `<div style="color:var(--ink-dim);font-size:13px">Sin expansiones cargadas.</div>`}</div>`;
    const eb = box.querySelector('.exp-add');
    if (eb) eb.addEventListener('click', () => openExpansionsPanel(g, draw));
  };
  try {
    const d = await api(`/games/${g.objectid}/expansions?owner=${S.owner}`);
    draw(d.mine || []);
  } catch { box.innerHTML = ''; }
}

// Panel "Gestionar": lista las expansiones OFICIALES del juego (de BGG, lazy) + las tuyas; marcás
// ninguno / 📦 tengo / ⭐ quiero, o abrís la ficha de cada una. Es también el editor. Las que marcás
// suben al tope (📦 primero, luego ⭐) para editarlas fácil; se re-ordena EN VIVO en cada cambio.
async function openExpansionsPanel(g, onChange) {
  const inner = node(`<div class="sheet-body">
    <h2 style="margin-bottom:2px">Expansiones</h2>
    <p style="color:var(--ink-dim);margin:0 0 12px;font-size:13.5px">de <b>${esc(g.es_name && g.es_name !== g.name ? g.es_name : g.name)}</b> — marcá las que tenés o querés.</p>
    <div class="field"><input id="expFilter" placeholder="Filtrar expansiones…"></div>
    <div class="exp-list" id="expList"><div class="spinner"></div></div>
  </div>`);
  const ov = overlay(inner, 'sheet');
  const listEl = inner.querySelector('#expList');
  let items = [];
  let curFilter = '';
  const rankState = s => (s === 'own' ? 0 : s === 'wish' ? 1 : 2);   // 📦 arriba, ⭐, luego sin marcar
  // refresca la sección de la ficha del madre (chips) con el estado real de la base
  const notify = async () => {
    try { const d = await api(`/games/${g.objectid}/expansions?owner=${S.owner}`); onChange && onChange(d.mine || []); }
    catch { /* la sección de la ficha se re-sincroniza al reabrir */ }
  };
  const apply = async (it, s) => {
    try {
      if (s === 'none') {
        await api(`/games/${g.objectid}/expansions/${encodeURIComponent(it.id)}?owner=${S.owner}`, { method: 'DELETE' });
        it.state = null;
      } else {
        const r = await api(`/games/${g.objectid}/expansions?owner=${S.owner}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exp_oid: it.id, name: it.name, state: s })
        });
        if (r.error) throw new Error(r.error);
        it.state = s;
      }
      render();          // re-ordena en vivo: la recién marcada sube al tope
      notify();
    } catch (e) { toast('Error: ' + e.message); }
  };
  const render = () => {
    const q = curFilter.toLowerCase();
    const shown = items.filter(it => !q || (it.name || '').toLowerCase().includes(q))
      .sort((a, b) => rankState(a.state) - rankState(b.state) || (a.name || '').localeCompare(b.name || ''));
    if (!shown.length) { listEl.innerHTML = '<p style="color:var(--ink-dim)">Sin resultados.</p>'; return; }
    listEl.innerHTML = '';
    shown.forEach(it => {
      const row = node(`<div class="exp-row">
        <div class="exp-name">${esc(it.name)}</div>
        <div class="exp-controls">
          <button class="exp-ficha" title="Ver ficha de la expansión">Ver</button>
          <div class="seg sm">
            <button data-s="none" class="${!it.state ? 'on' : ''}">—</button>
            <button data-s="own" class="${it.state === 'own' ? 'on' : ''}">📦</button>
            <button data-s="wish" class="${it.state === 'wish' ? 'on' : ''}">⭐</button>
          </div>
        </div></div>`);
      row.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => apply(it, b.dataset.s)));
      // "ver ficha": trae la ficha de la expa (como en la búsqueda) y deja marcarla; se refleja acá al toque
      row.querySelector('.exp-ficha').addEventListener('click', () => openExpansionFromPanel(
        it.id, g, it.state, (state) => { it.state = state; render(); notify(); }));
      listEl.append(row);
    });
  };
  inner.querySelector('#expFilter').addEventListener('input', e => { curFilter = e.target.value; render(); });
  try {
    const d = await api(`/games/${g.objectid}/expansions/catalog?owner=${S.owner}`);
    items = d.items || [];
    render();
  } catch (e) { listEl.innerHTML = `<p style="color:var(--danger)">Error: ${esc(e.message)}</p>`; }
}

// Trae la ficha de una expansión desde el panel de un juego madre conocido, con su estado actual y
// un callback que refleja el cambio en el panel + la ficha del madre.
async function openExpansionFromPanel(expId, base, currentState, onChange) {
  try {
    const d = await api('/lookup/' + encodeURIComponent(expId) + '?owner=' + S.owner);
    const g = d.game; g._expansion = true;
    openExpansionDetail(g, { base, currentState, onChange, keepOpen: true });
  } catch (e) { toast('Error: ' + e.message); }
}

// Ficha de una EXPANSIÓN: rotulada "Expansión de <madre>", sin control own/wish propio; la única
// alta es colgarla del juego madre (si lo tenés/deseás). `opts`:
//   base         juego madre ya conocido (viene del panel; si no, se deduce de g.expands)
//   currentState estado actual de la expa para marcar el botón
//   onChange     callback(state) tras marcar (refresca el panel de origen)
//   keepOpen     no cerrar tras marcar (para seguir editando desde la ficha)
export function openExpansionDetail(g, opts = {}) {
  let mother;
  if (opts.base) mother = { id: String(opts.base.objectid), name: opts.base.es_name && opts.base.es_name !== opts.base.name ? opts.base.es_name : opts.base.name };
  else {
    const mothers = g.expands || [];
    mother = mothers.find(m => S.games.some(x => x.objectid === String(m.id) && (x.own || x.wishlist))) || mothers[0] || null;
  }
  const canAdd = !!(mother && (opts.base || S.games.some(x => x.objectid === String(mother.id) && (x.own || x.wishlist))));
  const inner = node(`<div>
    <div class="detail-hero">
      <div class="detail-side">
        <div class="cover"><img src="${esc(safeImg(g.image))}" alt=""></div>
        <div style="margin-top:auto;padding-top:6px"><a href="${esc(safeImg(g.href) || '#')}" target="_blank" rel="noopener">Ver en BoardGameGeek ↗</a></div>
      </div>
      <div>
        <div class="exp-badge">📦 Expansión${mother ? ' de <b>' + esc(mother.name) + '</b>' : ''}</div>
        <div class="detail-title">${esc(g.name)}</div>
        <div class="detail-sub">${esc(g.yearpublished || '')}</div>
        <div class="detail-desc" id="detailDesc">${esc(g.short_description || '')}</div>
        <div class="exp-actions"></div>
      </div>
    </div>
  </div>`);
  const actions = inner.querySelector('.exp-actions');
  const paint = (state) => {
    if (!mother) { actions.innerHTML = `<p style="color:var(--ink-dim);font-size:13.5px">No pude identificar el juego base de esta expansión.</p>`; return; }
    if (!canAdd) { actions.innerHTML = `<p style="color:var(--ink-dim);font-size:13.5px">Para sumar esta expansión, agregá primero <b>${esc(mother.name)}</b> a tu colección o wishlist.</p>`; return; }
    actions.innerHTML = `<div class="section-h">Agregar a ${esc(mother.name)}</div>
      <div class="seg"><button data-s="own" class="${state === 'own' ? 'on' : ''}">📦 La tengo</button><button data-s="wish" class="${state === 'wish' ? 'on' : ''}">⭐ La quiero</button></div>`;
    actions.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', async () => {
      if (!ensureUnlocked()) return;
      const s = b.dataset.s;
      try {
        await api(`/games/${mother.id}/expansions?owner=${S.owner}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exp_oid: g.objectid, name: g.name, state: s,
            short_description: g.short_description || '' })
        });
        // reflejar en la colección en memoria (buscador + ficha del madre)
        const gm = S.games.find(x => x.objectid === String(mother.id));
        if (gm) { gm.expansions = (gm.expansions || []).filter(e => e.exp_oid !== g.objectid);
                  gm.expansions.push({ exp_oid: g.objectid, name: g.name, state: s }); }
        opts.onChange && opts.onChange(s);
        toast(`${s === 'own' ? 'La tenés' : 'La querés'} · ${g.name}`);
        if (opts.keepOpen) paint(s); else ov.remove();
      } catch (e) { toast('Error: ' + e.message); }
    }));
  };
  paint(opts.currentState || null);
  const ov = overlay(inner);
  setupDescription(inner, g);
}
