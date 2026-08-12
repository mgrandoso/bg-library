/* Alta de juegos: busqueda por nombre o id/URL de BGG, con ficha en preview. */
import { openDetail } from './detail.js';
import { openExpansionDetail } from './expansions.js';
import { overlay } from './modal.js';
import { S } from './state.js';
import { api, esc, node, safeImg, toast } from './util.js';

/* ================= AGREGAR juego (ítem 8: local-first) ================= */
// id de BGG desde un id suelto o una URL
function bggId(s) {
  s = String(s || '').trim();
  const m = s.match(/boardgame\/(\d+)/);
  return m ? m[1] : (s.match(/\d{2,}/) || [s])[0];
}
export function openAdd() {
  const inner = node(`<div class="sheet-body">
    <h2 style="margin-bottom:4px">Agregar juego</h2>
    <p style="color:var(--ink-dim);margin:0 0 16px;font-size:13.5px">Buscá por nombre, o pegá el ID / URL de BoardGameGeek. Tocá un resultado para ver su ficha y sumarlo.</p>
    <div class="field"><input id="addQ" placeholder="Ej: Wingspan, o 266192, o el link de BGG…" autofocus></div>
    <div style="margin-bottom:6px"><button class="btn primary" id="addSearch">Buscar</button></div>
    <div class="search-results" id="addResults"></div>
  </div>`);
  const q = inner.querySelector('#addQ'); const results = inner.querySelector('#addResults');
  async function doSearch() {
    const val = q.value.trim(); if (!val) return;
    // id o URL → directo a la ficha (lookup); si no, búsqueda por nombre
    if (/^\d+$/.test(val) || /boardgamegeek\.com/.test(val)) { return openLookup(bggId(val)); }
    results.innerHTML = '<div class="spinner"></div>';
    try {
      const d = await api('/search?q=' + encodeURIComponent(val));
      results.innerHTML = '';
      if (!d.results.length) { results.innerHTML = '<p style="color:var(--ink-dim)">Sin resultados.</p>'; return; }
      d.results.forEach(r => {
        const thumb = safeImg(r.thumb);   // solo los locales traen imagen; el resto, placeholder
        const el = node(`<div class="sr">
          <div class="sr-thumb ${thumb ? '' : 'ph'}"${thumb ? ` style="background-image:url('${esc(thumb)}')"` : ''}>${thumb ? '' : '🎲'}</div>
          <div><div class="n">${esc(r.name)}</div><div class="y">${esc(r.yearpublished || '')}${r.local ? ' · ya en tu base' : ''} · id ${esc(r.objectid)}</div></div>
        </div>`);
        el.addEventListener('click', () => openLookup(r.objectid));
        results.append(el);
      });
    } catch (e) { results.innerHTML = `<p style="color:var(--danger)">Error: ${esc(e.message)}</p>`; }
  }
  // abre la ficha del juego: local si ya está, o traído de BGG sin persistir (preview) si no.
  // Recién se guarda si el usuario marca "Lo tengo/Lo quiero" en la ficha (stateControls).
  async function openLookup(oid) {
    // La búsqueda queda ABIERTA detrás: la ficha se abre encima (otro overlay). Al cerrar la ficha
    // volvés a los resultados sin re-buscar; para salir, cerrás la ficha y después la búsqueda. Útil
    // para navegar entre varios resultados. NO se pisa la lista con un spinner.
    // El aviso solo aparece si TARDA: cuando el juego ya está en tu base la ficha abre al toque y
    // el cartel era ruido. Si hay que ir a buscarlo a BGG, ahí sí avisa que está trabajando.
    const aviso = setTimeout(() => toast('Buscando en BGG…'), 400);
    try {
      const d = await api('/lookup/' + encodeURIComponent(oid) + '?owner=' + S.owner);
      const g = d.game;
      // Si es expansión, ficha de expansión — y con el estado que ya tenga (📦/⭐) marcado.
      if (d.is_expansion) { g._expansion = true; openExpansionDetail(g, { currentState: d.exp_state || null, keepOpen: true }); return; }
      if (!d.saved) g._preview = true;
      openDetail(g);
    } catch (e) { toast('Error: ' + e.message); }
    finally { clearTimeout(aviso); }
  }
  inner.querySelector('#addSearch').addEventListener('click', doSearch);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  const ov = overlay(inner, 'sheet');
  setTimeout(() => q.focus(), 50);
}
