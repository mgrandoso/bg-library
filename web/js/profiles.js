/* Hub de perfiles y configuracion: perfiles, importar, backup, actualizar, configurar. */
import { renderAppearanceGrid } from './appearance.js';
import { enrichLoop, fillOwnerSel, loadGames, loadOwners } from './data.js';
import { askConfirm, askName, overlay } from './modal.js';
import { maybeOnboard } from './onboarding.js';
import { openReconcile } from './reconcile.js';
import { render } from './router.js';
import { ensureUnlocked, renderSafeBox } from './safemode.js';
import { BGGV, S } from './state.js';
import { $, api, esc, node, toast } from './util.js';

/* ================= DATOS: perfiles + import/export ================= */
export function openData(tab = 'perfiles') {
  const inner = node(`<div class="sheet-body">
    <h2 style="margin-bottom:14px">Perfiles y configuración</h2>
    <div class="tabs" id="dataTabs">
      <button data-t="perfiles"><span class="tab-ic">👥</span><span class="tab-tx">Perfiles</span></button>
      <button data-t="importar"><span class="tab-ic">📥</span><span class="tab-tx">Importar</span></button>
      <button data-t="backup"><span class="tab-ic">💾</span><span class="tab-tx">Backup</span></button>
      <button data-t="actualizar"><span class="tab-ic">🔄</span><span class="tab-tx">Actualizar</span></button>
      <button data-t="config"><span class="tab-ic">⚙</span><span class="tab-tx">Configurar</span></button>
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
      <details class="imp-help">
        <summary>¿No tenés el CSV? Te ayudo a generarlo en BGG ▾</summary>
        <div class="imp-help-body">
          <p>BoardGameGeek exporta tu colección con un link directo. Escribí tu usuario y descargalo (tenés que estar logueado en BGG en este navegador):</p>
          <div class="imp-user-row">
            <input id="bggUser" placeholder="tu usuario de BGG">
            <a class="btn disabled" id="bggDl" href="#" target="_blank" rel="noopener">⬇ Descargar CSV</a>
          </div>
          <p class="imp-help-note">Se baja un archivo <code>collection.csv</code>; después subilo acá abajo. El link es:<br>
            <code id="bggUrl">…&amp;username=<b>TU_USUARIO</b>&amp;all=1</code></p>
          <p class="imp-help-note">💡 A veces la <b>primera vez no baja nada</b>: BGG genera el export y recién en el
            <b>segundo acceso al mismo link</b> te lo descarga (te avisa además con una notificación en tu perfil, con el mismo link).</p>
        </div>
      </details>
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
      <p class="tab-hint"><b>Actualizar</b> baja el ranking del día de BGG (un dump liviano) y <b>reposiciona el rank y rating</b> de tu catálogo — arregla los ranks viejos, duplicados o salteados. De paso limpia huérfanos y completa los <b>nombres en español</b> pendientes (si tenés key de Gemini). Un solo paso, sin re-bajar la data de cada juego.</p>
      <button class="btn primary block" id="updateAllBtn">🔄 Actualizar</button>
      <div id="updateAllMsg" style="margin-top:10px;font-size:13px;color:var(--ink-dim)"></div>

      <hr style="border:0;border-top:1px solid var(--line);margin:20px 0">
      <p class="tab-hint">O por separado:</p>
      <div id="freshBox" style="font-size:13.5px;color:var(--ink-soft)">Comprobando…</div>
      <button class="btn block" id="refreshBtn" style="margin-top:10px;display:none">🔄 Solo rankings de mis juegos</button>
      <p class="tab-hint" style="margin-top:14px">¿Hiciste <code>git pull</code> y el repo trae un catálogo nuevo? Recargá <b>solo el top-5000</b> desde el preseed (no toca tu colección).</p>
      <button class="btn block" id="reseedBtn">📚 Solo recargar catálogo top-5000</button>
      <div id="reseedMsg" style="margin-top:10px;font-size:13px;color:var(--ink-dim)"></div>
    </section>

    <section data-p="config" class="tab-pane" hidden>
      <div class="section-h" style="margin-top:0">Modo seguro</div>
      <p class="tab-hint">Un candado en la barra que bloquea los cambios — para mirar sin tocar la colección.</p>
      <div id="safeBox"></div>

      <hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
      <div class="section-h" style="margin-top:0">Apariencia</div>
      <div class="appear-grid" id="appearGrid"></div>

      <hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
      <div class="section-h" style="margin-top:0">Advisor</div>
      <div class="field">
        <label>API key de Google AI Studio <span id="cfgKeyState"></span></label>
        <input id="cfgKey" type="password" placeholder="Pegá acá tu API key">
      </div>
      <div class="field">
        <label>Modelo Gemini</label>
        <input id="cfgModel" value="gemini-3.6-flash">
        <p class="tab-hint" style="margin-top:6px">Viene con el último Flash gratis. Cambialo si Google saca uno nuevo, o por un modelo superior (Pro) si tenés suscripción paga.</p>
      </div>
      <button class="btn primary block" id="cfgSave">Guardar</button>
      <div id="cfgMsg" style="margin-top:10px;font-size:12px;color:var(--good)"></div>
    </section>
  </div>`);

  // pestañas
  const showTab = (t) => {
    inner.querySelectorAll('#dataTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    inner.querySelectorAll('.tab-pane').forEach(p => p.hidden = p.dataset.p !== t);
    if (inner.parentElement) inner.parentElement.scrollTop = 0;   // alto fijo: dejá la barra de tabs a la vista
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

  // ayuda: armar el link de export de BGG desde el usuario
  const bggUser = inner.querySelector('#bggUser'), bggDl = inner.querySelector('#bggDl'), bggUrl = inner.querySelector('#bggUrl');
  const bggExportUrl = (u) => `https://boardgamegeek.com/geekcollection.php?action=exportcsv&subtype=boardgame&username=${encodeURIComponent(u)}&all=1`;
  const updateBgg = () => {
    const u = bggUser.value.trim();
    bggDl.classList.toggle('disabled', !u);
    bggDl.href = u ? bggExportUrl(u) : '#';
    bggUrl.innerHTML = u ? `…&username=<b>${esc(u)}</b>&all=1` : '…&username=<b>TU_USUARIO</b>&all=1';
  };
  bggUser.addEventListener('input', updateBgg);
  bggDl.addEventListener('click', e => { if (!bggUser.value.trim()) e.preventDefault(); });
  updateBgg();

  function paintOwners() {
    const list = inner.querySelector('#ownerList'); list.innerHTML = '';
    S.owners.forEach(o => {
      const row = node(`<div class="sr" style="cursor:default">
        <div style="width:14px;height:14px;border-radius:50%;background:${o.color};flex:none"></div>
        <div style="flex:1"><div class="n">${o.is_me ? '👤 ' : '👥 '}${esc(o.name)}</div><div class="y">${o.own_count} juegos · ${o.wish_count} wishlist</div></div>
        <button class="btn ghost ren" style="padding:6px 10px" title="Renombrar">✎</button>
        <button class="btn ghost rst" style="padding:6px 10px" title="Vaciar la colección (empezar de cero)">♻</button>
        ${o.is_me ? '' : '<button class="btn ghost del" style="padding:6px 10px;color:var(--danger)" title="Borrar perfil">🗑</button>'}
      </div>`);
      // Los tres usan los diálogos in-app (askName/askConfirm), NO prompt()/confirm() nativos: en
      // webviews y en la app agregada a la pantalla de inicio esos vienen suprimidos y devuelven
      // undefined -> el botón "no respondía". Y todos van con try/catch: sin él, un error del
      // backend (p. ej. renombrar a un nombre que ya existe, que ahora devuelve 409) moría en una
      // promesa rechazada y el usuario no veía absolutamente nada.
      row.querySelector('.ren').addEventListener('click', async () => {
        if (!ensureUnlocked()) return;
        const name = await askName('Renombrar perfil', o.name);
        if (name == null || name === o.name) return;
        try {
          await api('/owners/' + o.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
          await loadOwners(); paintOwners(); fillOwnerSel(); toast('Renombrado');
        } catch (e) { toast('Error: ' + e.message); }
      });
      row.querySelector('.rst').addEventListener('click', async () => {
        if (!ensureUnlocked()) return;
        if ((o.own_count + o.wish_count) === 0) { toast('Ese perfil ya está vacío'); return; }
        const ok = await askConfirm(
          `¿Vaciar la colección de ${o.name}?\n\nSe borran sus ${o.own_count} juegos y ${o.wish_count} de wishlist. El perfil queda, pero vacío. No se puede deshacer.`,
          { ok: 'Sí, vaciar' });
        if (!ok) return;
        try {
          const r = await api('/owners/' + o.id + '/reset', { method: 'POST' });
          await loadOwners(); paintOwners();
          if (S.owner === o.id) { await loadGames(); render(); }
          toast(`Colección vaciada (${r.cleared} juegos)`);
          if (o.is_me && S.owner === o.id) { ov.remove(); maybeOnboard(); }  // ofrecé recargar de cero
        } catch (e) { toast('Error: ' + e.message); }
      });
      const del = row.querySelector('.del');
      if (del) del.addEventListener('click', async () => {
        if (!ensureUnlocked()) return;
        const ok = await askConfirm(`¿Borrar el perfil de ${o.name} y su colección?`,
          { ok: 'Sí, borrar' });
        if (!ok) return;
        try {
          await api('/owners/' + o.id, { method: 'DELETE' });
          if (S.owner === o.id) S.owner = 0;
          await loadOwners(); if (!S.owner) S.owner = S.owners[0].id;
          await loadGames(); paintOwners(); fillOwnerSel(); render(); toast('Perfil borrado');
        } catch (e) { toast('Error: ' + e.message); }
      });
      list.append(row);
    });
  }
  paintOwners();

  inner.querySelector('#newOwner').addEventListener('keydown', async e => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    if (!ensureUnlocked()) return;
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
    if (!ensureUnlocked()) return;
    if (!file) return;
    const isNew = impProfile.value === '__new__';
    const name = isNew ? inner.querySelector('#impName').value.trim() : '';
    if (isNew && !name) { toast('Poné el nombre del perfil nuevo'); return; }
    const goBtn = inner.querySelector('#impGo'); const prog = inner.querySelector('#impProg');

    // Re-import a un perfil que YA tiene juegos → reconciliación con confirmación (flujo 9).
    // Perfil nuevo o vacío → import directo (todo son altas).
    const targetId = isNew ? null : Number(impProfile.value);
    const target = isNew ? null : S.owners.find(o => o.id === targetId);
    if (target && (target.own_count || 0) + (target.wish_count || 0) > 0) {
      goBtn.textContent = 'Analizando diferencias…'; goBtn.disabled = true;
      try {
        const fd = new FormData(); fd.append('file', file); fd.append('owner_id', targetId);
        const pv = await api('/reconcile/preview', { method: 'POST', body: fd });
        openReconcile(file, targetId, pv, ov);
      } catch (e) { toast('Error: ' + e.message); }
      goBtn.textContent = 'Importar'; goBtn.disabled = false;
      return;
    }

    const fd = new FormData(); fd.append('file', file); fd.append('mode', mode);
    if (isNew) { fd.append('owner_name', name); fd.append('new_profile', '1'); }
    else { fd.append('owner_id', impProfile.value); }
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

  // Actualizar (ítem 4): un solo POST /api/update. Baja el dump de ranks del día (Range parcial),
  // reconcilia el top (altas/rerank/bajas), pone al día por id la cola >10k de tu colección y
  // resuelve es_name pendientes (si hay key). Un solo paso, sin re-bajar la data de cada juego.
  const updateAllBtn = inner.querySelector('#updateAllBtn'), updateAllMsg = inner.querySelector('#updateAllMsg');
  updateAllBtn.addEventListener('click', async () => {
    updateAllBtn.disabled = true; updateAllMsg.textContent = '';
    updateAllBtn.textContent = '🔄 Actualizando rankings…';
    try {
      const r = await api('/update', { method: 'POST' });
      BGGV.owner = -1; await loadGames(); await loadOwners();
      const es = r.es_names || {};
      const tandas = es.tandas > 1 ? ` (en ${es.tandas} tandas)` : '';
      const esTxt = es.no_key ? ' · nombres en español: pendientes (falta key de Gemini)'
        : (es.resolved ? ` · nombres en español resueltos: <b>${es.resolved}</b>${tandas}` : '');
      updateAllMsg.innerHTML = `✓ Ranking del <b>${esc(r.dump_date || '')}</b> aplicado a `
        + `<b>${(r.ranks_applied || 0).toLocaleString('es-AR')}</b> juegos`
        + (r.altas ? ` · nuevos en el top: <b>${r.altas}</b>` : '')
        + (r.gc_removed ? ` · salieron del top: <b>${r.gc_removed}</b>` : '')
        + (r.tail_refreshed ? ` · cola actualizada: <b>${r.tail_refreshed}</b>` : '')
        + esTxt + '.';
      if (S.view === 'panel' || S.view === 'bgg') render();
      toast('Actualización completa');
    } catch (e) { updateAllMsg.innerHTML = `<span style="color:var(--danger)">Error: ${esc(e.message)}</span>`; }
    updateAllBtn.disabled = false; updateAllBtn.textContent = '🔄 Actualizar';
  });

  // recargar el catálogo top-5000 desde el preseed del repo (tras un git pull)
  const reseedBtn = inner.querySelector('#reseedBtn'), reseedMsg = inner.querySelector('#reseedMsg');
  reseedBtn.addEventListener('click', async () => {
    reseedBtn.disabled = true; reseedBtn.textContent = '📚 Recargando catálogo…';
    try {
      const r = await api('/reseed', { method: 'POST' });
      reseedMsg.innerHTML = `✓ Catálogo recargado: <b>${(r.catalog || 0).toLocaleString('es-AR')}</b> juegos del top-5000.`;
      BGGV.owner = -1;   // fuerza refetch del browse de BGG la próxima vez
      await loadGames();
      toast('Catálogo actualizado');
    } catch (e) { reseedMsg.innerHTML = `<span style="color:var(--danger)">Error: ${esc(e.message)}</span>`; }
    reseedBtn.disabled = false; reseedBtn.textContent = '📚 Actualizar catálogo top-5000';
  });

  // config del Advisor (Gemini) — antes era un sheet aparte, ahora es este tab
  const cfgKey = inner.querySelector('#cfgKey'), cfgModel = inner.querySelector('#cfgModel');
  const cfgKeyState = inner.querySelector('#cfgKeyState'), cfgMsg = inner.querySelector('#cfgMsg');
  (async () => {
    try {
      const cfg = await api('/config');
      if (cfg.gemini_model) cfgModel.value = cfg.gemini_model;
      if (cfg.gemini_key_set) {
        cfgKeyState.innerHTML = `<span style="color:var(--good)">· configurada (${esc(cfg.gemini_key_hint)})</span>`;
        cfgKey.placeholder = 'Ya configurada — dejá vacío para no cambiarla';
      }
    } catch {}
  })();
  inner.querySelector('#cfgSave').addEventListener('click', async () => {
    const patch = { default_engine: 'gemini', gemini_model: cfgModel.value.trim() };
    const key = cfgKey.value.trim(); if (key) patch.gemini_api_key = key;
    try {
      const pub = await api('/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      S.geminiReady = !!pub.gemini_key_set;
      cfgKey.value = '';
      if (pub.gemini_key_set) { cfgKeyState.innerHTML = `<span style="color:var(--good)">· configurada (${esc(pub.gemini_key_hint)})</span>`; cfgKey.placeholder = 'Ya configurada — dejá vacío para no cambiarla'; }
      cfgMsg.innerHTML = '✓ Guardado.';
      toast('Configuración guardada');
      if (S.view === 'advisor') render();   // habilita/deshabilita el agente al toque
    } catch (e) { toast('Error: ' + e.message); }
  });

  // apariencia + modo seguro (secciones nuevas del tab Configurar)
  renderAppearanceGrid(inner.querySelector('#appearGrid'));
  renderSafeBox(inner.querySelector('#safeBox'));

  const ov = overlay(inner, 'sheet data-hub');   // alto fijo: la barra de tabs no salta al cambiar
}

/* La config del Advisor (Gemini) vive como el tab "Advisor" de este sheet.
   Ya no hay sheet de config aparte ni boton propio en el header. */
