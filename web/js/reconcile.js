/* Reconciliacion de re-import: diff agrupado del CSV contra la coleccion. */
import { enrichLoop, loadGames, loadOwners } from './data.js';
import { overlay } from './modal.js';
import { render } from './router.js';
import { ensureUnlocked } from './safemode.js';
import { S } from './state.js';
import { $, api, esc, node, toast } from './util.js';

/* Reconciliación de re-import (flujo 9): muestra el diff agrupado y aplica con confirmación.
   Altas y cambios se aplican al confirmar; las bajas solo las que el usuario marca. */
export function openReconcile(file, ownerId, pv, dataOv) {
  const owner = S.owners.find(o => o.id === ownerId) || {};
  const stTag = s => s === 'own'
    ? '<span class="st own">📦 tengo</span>' : '<span class="st wish">⭐ wishlist</span>';
  const grp = (cls, icon, title, n, bodyHtml, open) => n === 0 ? '' : `
    <details class="recon-grp ${cls}" ${open ? 'open' : ''}>
      <summary><span class="recon-ic">${icon}</span><b>${title}</b><span class="recon-n">${n}</span></summary>
      <div class="recon-body">${bodyHtml}</div>
    </details>`;
  const addedHtml = pv.added.map(g =>
    `<div class="recon-row"><span class="rn">${esc(g.name)}</span>${stTag(g.to)}</div>`).join('');
  const changedHtml = pv.changed.map(g =>
    `<div class="recon-row"><span class="rn">${esc(g.name)}</span><span class="ch">${stTag(g.from)} <span class="arr">→</span> ${stTag(g.to)}</span></div>`).join('');
  const removedHtml =
    `<p class="recon-hint">Marcá las que quieras <b>sacar</b> de la colección. Las que dejes sin marcar se conservan.</p>
     <button class="btn ghost sm" id="rmAll" type="button">Marcar todas</button>`
    + pv.removed.map(g =>
      `<label class="recon-row rm"><input type="checkbox" class="rmchk" data-id="${esc(g.objectid)}"><span class="rn">${esc(g.name)}</span>${stTag(g.from)}</label>`).join('');

  const nothing = !pv.added.length && !pv.changed.length && !pv.removed.length;
  const inner = node(`<div class="sheet-body">
    <h2 style="margin-bottom:4px">Revisar importación</h2>
    <p class="tab-hint">Comparé el CSV con la colección de <b>${esc(owner.name || 'este perfil')}</b>. Las <b>altas</b> y los <b>cambios</b> se aplican al confirmar; las <b>bajas</b>, solo las que marques.</p>
    ${nothing ? '<p style="margin:22px 0;color:var(--ink-dim);text-align:center">No hay diferencias: el CSV coincide con lo que ya tenés. 🎲</p>' : ''}
    <div class="recon-groups">
      ${grp('add', '➕', 'Se agregan', pv.added.length, addedHtml, true)}
      ${grp('chg', '🔄', 'Cambian de estado', pv.changed.length, changedHtml, true)}
      ${grp('rem', '➖', 'Ya no están en el CSV', pv.removed.length, removedHtml, pv.removed.length <= 12)}
    </div>
    <div class="recon-unchanged">= ${pv.unchanged} sin cambios</div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn" id="rcCancel" style="flex:1">Cancelar</button>
      <button class="btn primary" id="rcApply" style="flex:2">${nothing ? 'Cerrar' : 'Aplicar cambios'}</button>
    </div>
    <div id="rcProg" style="margin-top:10px"></div>
  </div>`);

  const ov = overlay(inner, 'sheet');
  const rmAll = inner.querySelector('#rmAll');
  if (rmAll) rmAll.addEventListener('click', () => {
    const chks = [...inner.querySelectorAll('.rmchk')]; const allOn = chks.every(c => c.checked);
    chks.forEach(c => c.checked = !allOn); rmAll.textContent = allOn ? 'Marcar todas' : 'Desmarcar todas';
  });
  inner.querySelector('#rcCancel').addEventListener('click', () => ov.remove());
  inner.querySelector('#rcApply').addEventListener('click', async () => {
    if (nothing) { ov.remove(); return; }
    if (!ensureUnlocked()) return;
    const remove = [...inner.querySelectorAll('.rmchk:checked')].map(c => c.dataset.id);
    const btn = inner.querySelector('#rcApply'); btn.disabled = true; btn.textContent = 'Aplicando…';
    const prog = inner.querySelector('#rcProg');
    try {
      const fd = new FormData(); fd.append('file', file);
      fd.append('owner_id', ownerId); fd.append('remove', remove.join(','));
      const r = await api('/reconcile/apply', { method: 'POST', body: fd });
      prog.innerHTML = `<p style="color:var(--ink-dim);font-size:13px">Trayendo imágenes y datos de BGG…</p>
        <div class="hbar-track"><span class="hbar-fill" id="rcfill" style="width:0%;background:var(--brass)"></span></div>`;
      await enrichLoop(ownerId, (d, t) => { const f = $('#rcfill'); if (f) f.style.width = (t ? d / t * 100 : 100) + '%'; });
      await loadOwners(); S.owner = ownerId; await loadGames();
      ov.remove(); if (dataOv) dataOv.remove(); render();
      toast(`Listo: +${r.added} altas · ${r.changed} cambios · −${r.removed} bajas`);
    } catch (e) { prog.innerHTML = `<p style="color:var(--danger)">Error: ${esc(e.message)}</p>`; btn.disabled = false; btn.textContent = 'Aplicar cambios'; }
  });
}
