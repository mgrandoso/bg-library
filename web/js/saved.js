/* Recomendaciones guardadas del Advisor (opt-in, por perfil). */
import { ADV, OCCASIONS, advReset, renderAdvisor } from './advisor.js';
import { askConfirm, askName, overlay } from './modal.js';
import { S } from './state.js';
import { $, api, esc, node, toast } from './util.js';

// Nombre por defecto sugerido: modo + ocasión (si hay) + fecha.
export function savedTitle(out) {
  const modeL = out.mode === 'buy' ? '¿Qué compro?' : '¿Qué saco hoy?';
  const occ = OCCASIONS[ADV.occasion] ? OCCASIONS[ADV.occasion].t : '';
  const d = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  return modeL + (occ ? ' · ' + occ : '') + ' · ' + d;
}
// Entrada "💾 Guardadas (N)" bajo el switch de modo; abre la lista.
export function savedBar() {
  const bar = node('<div class="saved-bar"><button class="btn ghost sm" id="advSavedBtn">💾 Guardadas</button></div>');
  bar.querySelector('#advSavedBtn').addEventListener('click', openSavedList);
  refreshSavedCount();
  return bar;
}
// Actualiza el label "Guardadas (N)" del header del advisor (si está en pantalla).
export function refreshSavedCount() {
  const btn = $('#advSavedBtn'); if (!btn) return;
  api('/saved?owner=' + S.owner).then(d => {
    const n = (d.saved || []).length;
    btn.textContent = n ? `💾 Guardadas (${n})` : '💾 Guardadas';
  }).catch(() => { });
}
// Lista de guardadas: cada una se puede volver a ver o eliminar.
async function openSavedList() {
  const inner = node(`<div class="sheet-body">
    <h2 style="margin-bottom:2px">Recomendaciones guardadas</h2>
    <p style="color:var(--ink-dim);margin:0 0 14px;font-size:13.5px">Tocá una para volver a verla.</p>
    <div class="saved-list" id="savedList"><div class="spinner"></div></div>
  </div>`);
  const ov = overlay(inner, 'sheet');
  const listEl = inner.querySelector('#savedList');
  const draw = (recs) => {
    if (!recs.length) {
      listEl.innerHTML = '<p style="color:var(--ink-dim)">Todavía no guardaste ninguna. En una recomendación, tocá <b>💾 Guardar</b>.</p>';
      return;
    }
    listEl.innerHTML = '';
    recs.forEach(r => {
      const d = new Date((r.created_at || 0) * 1000).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
      const row = node(`<div class="saved-row">
        <button class="saved-open" title="Ver de nuevo">
          <div class="saved-title">${esc(r.title || 'Recomendación')}</div>
          <div class="saved-meta">${esc(d)}</div>
        </button>
        <button class="saved-edit" title="Renombrar" aria-label="Renombrar">✎</button>
        <button class="saved-del" title="Eliminar" aria-label="Eliminar">🗑</button>
      </div>`);
      row.querySelector('.saved-open').addEventListener('click', () => { ov.close(); openSavedRec(r.id); });
      row.querySelector('.saved-edit').addEventListener('click', async () => {
        const nn = await askName('Renombrar', r.title || '');
        if (nn == null) return;
        try {
          await api('/saved/' + r.id + '?owner=' + S.owner, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: nn })
          });
          load();
        } catch (e) { toast('Error: ' + e.message); }
      });
      row.querySelector('.saved-del').addEventListener('click', async () => {
        const ok = await askConfirm(`¿Eliminar "${r.title || 'esta recomendación'}"?`, { ok: 'Sí, eliminar' });
        if (!ok) return;
        try { await api('/saved/' + r.id + '?owner=' + S.owner, { method: 'DELETE' }); load(); refreshSavedCount(); }
        catch (e) { toast('Error: ' + e.message); }
      });
      listEl.append(row);
    });
  };
  const load = async () => {
    try { const dd = await api('/saved?owner=' + S.owner); draw(dd.saved || []); }
    catch (e) { listEl.innerHTML = `<p style="color:var(--danger)">Error: ${esc(e.message)}</p>`; }
  };
  load();
}
// Vuelve a mostrar una guardada usando el mismo camino de "reanudar" (ADV.result → renderResults).
async function openSavedRec(id) {
  try {
    const d = await api('/saved/' + id + '?owner=' + S.owner);
    const payload = d.rec && d.rec.payload;
    if (!payload || !payload.picks) { toast('No pude abrir la recomendación'); return; }
    payload._saved = true;                    // ya está guardada: no re-ofrecer "Guardar"
    advReset();
    ADV.mode = payload.mode || 'play';
    ADV.occasion = 'libre'; ADV.answers = {};
    ADV.result = payload; ADV.loading = false;
    renderAdvisor($('#main'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) { toast('Error: ' + e.message); }
}
