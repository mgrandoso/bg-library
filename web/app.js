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
const WEIGHT_LABELS = ['Liviana', 'Media-liviana', 'Media', 'Media-pesada', 'Pesada'];
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
// apariencias disponibles (ids de tema); usado desde init(), por eso vive arriba
const APPEARANCES = ['classic', 'fresca', 'calida'];
// candado SVG (line-style, a tono con el resto de los íconos del header): cerrado / abierto.
// Viven arriba porque applyLockUI() los usa desde bindTop() (temprano en init) → evita TDZ.
const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const UNLOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';

// Grupo "Mecánicas" (ítem 9): set CURADO por intención de filtrado (no por frecuencia). Cada
// entrada: [string canónico de BGG, etiqueta ES]. Se combinan OR entre sí y AND con el resto.
const MECHANICS = [
  ['Cooperative Game', '🤝 Cooperativo'],
  ['Solo / Solitaire Game', '🧍 Solo'],
  ['Scenario / Mission / Campaign Game', '📜 Campaña'],
  ['Team-Based Game', '👥 Por equipos'],
  ['Deck, Bag, and Pool Building', '🃏 Deck/Bag building'],
  ['Worker Placement', '👷 Worker placement'],
  ['Push Your Luck', '🎲 Push your luck'],
  ['Take That', '😈 Take That'],
];

/* ---------- estado ---------- */
const S = {
  games: [], owners: [], owner: 0, view: 'library',
  filters: { q: '', types: new Set(), mechanics: new Set(), players: 0, time: '', weight: '', designer: '', sort: 'rank', sortDir: 1 },
  stats: null, geminiReady: false, panelSource: 'own',
  // modo seguro: on/pin persisten en localStorage; `unlocked` vive SOLO en memoria → siempre
  // arranca cerrado (cubre F5 y reabrir el navegador). Es un freno anti-toques, no seguridad real.
  safe: { on: false, pin: '', unlocked: false },
  appearance: 'classic',
};
/* estado del browse de BGG (paginado, persiste al navegar) */
// BGG guarda SOLO el estado de navegación (paginado/carga). Los filtros y el orden viven en
// S.filters —único para las tres vistas—; `sig` recuerda con qué filtros se cargó lo que hay en
// pantalla, para saber si hay que recargar al volver a BGG tras tocar filtros en otra vista.
const BGGV = { games: [], page: 0, total: 0, hasMore: false, loading: false, owner: 0, sig: null };

/* ===== responsive: el "layout general" (nav solo-iconos + barra de filtros agrupada en
   desplegables Tipo/Filtros/Mecánicas) se usa en celular Y en tablet vertical. En tablet horizontal
   y desktop se mantiene inline como siempre. La ficha y el Advisor NO cambian en tablet: siguen
   como PC (2 columnas, descripciones sin colapsar) → esos siguen atados a isMobile(). Al cruzar
   cualquier breakpoint (rotar/redimensionar) repintamos para reconstruir la barra que corresponde.
   - isMobile()  = solo celular (≤640): ficha apilada, "(N)" del perfil oculto, Advisor "ver más".
   - isCompact() = celular O tablet vertical: layout general compacto (nav iconos + filtros acordeón). */
const mqMobile = window.matchMedia('(max-width: 640px)');
function isMobile() { return mqMobile.matches; }
const mqCompact = window.matchMedia('(max-width: 640px), (min-width: 641px) and (max-width: 1024px) and (orientation: portrait)');
function isCompact() { return mqCompact.matches; }
// tablet HORIZONTAL (641–1024, landscape): la línea 1 de filtros queda inline como PC, pero la
// línea 2 pasa a DOS botones colapsables (Tipo / Mecánica) para no desbordar el ancho.
const mqTabLand = window.matchMedia('(orientation: landscape) and (min-width: 1025px) and (max-width: 1366px)');
function isTabletLandscape() { return mqTabLand.matches; }
// palabras del resumen de ficha antes del "ver más", por dispositivo: celular 60, tablet (vertical y
// horizontal) 70, PC 80. isCompact() incluye celular → chequear isMobile() primero.
function descLimit() {
  if (isMobile()) return 60;
  if (isCompact() || isTabletLandscape()) return 70;   // tablet vertical (isCompact sin celular) u horizontal
  return 80;                                            // PC
}
function onBreakpointChange() {
  if (typeof fillOwnerSel === 'function' && S.owners) fillOwnerSel();   // "(N)" del perfil según plataforma
  if (coverObserver) { coverObserver.disconnect(); coverObserver = null; }  // recalcula el margen (2× viewport)
  if (typeof render === 'function') render();
}
mqMobile.addEventListener('change', onBreakpointChange);
mqCompact.addEventListener('change', onBreakpointChange);   // rotar tablet vertical↔horizontal reconstruye la barra
mqTabLand.addEventListener('change', onBreakpointChange);   // cruzar 1024px en horizontal (tablet↔desktop) reconstruye la barra
// contador de filtros activos entre los selects (jugadores/duración/complejidad/diseñador);
// el orden no cuenta (siempre tiene un valor). Sirve para el badge del botón "Filtros" en celular.
function activeSelectCount(f) {
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
function syncGroupBadge(id, count) {
  const btn = document.querySelector(`.fgroup-btn[data-grp="${id}"]`);
  if (!btn) return;
  btn.classList.toggle('active', !!count);
  btn.querySelector('.fg-lbl').textContent = `${btn.dataset.icon} ${btn.dataset.label}${count ? ` (${count})` : ''}`;
}

/* ================= arranque ================= */
init();
async function init() {
  loadAppearance();
  loadSafe();
  bindTop();
  await loadOwners();
  await Promise.all([loadGames(), loadConfig()]);
  render();
  maybeOnboard();
  checkFreshness();
  maybeNudge();
}

function meOwner() { return S.owners.find(o => o.id === S.owner) || S.owners.find(o => o.is_me) || S.owners[0]; }
function maybeOnboard() {
  const me = S.owners.find(o => o.is_me);
  if (me && (me.own_count + me.wish_count) === 0) openOnboarding();
}

/* ---------- nudges no-nag (ítem 5) ---------- */
// Barra descartable entre el header y el contenido. Un solo nudge por vez.
function showNudge(html, onYes, onDismiss) {
  const old = $('#nudgeBar'); if (old) old.remove();
  const bar = node(`<div id="nudgeBar" class="nudge">
    <span class="nudge-ic">💡</span><span class="nudge-txt">${html}</span>
    <button class="btn primary sm nudge-yes">Actualizar</button>
    <button class="nudge-x" title="Ahora no" aria-label="Descartar">✕</button>
  </div>`);
  bar.querySelector('.nudge-yes').addEventListener('click', async () => { if (onDismiss) onDismiss(); bar.remove(); await onYes(); });
  bar.querySelector('.nudge-x').addEventListener('click', () => { if (onDismiss) onDismiss(); bar.remove(); });
  $('#app').insertBefore(bar, $('#main'));
}

async function maybeNudge() {
  let n; try { n = await api('/nudges?owner=' + S.owner); } catch { return; }
  // (a) pendientes de nombre en español: SOLO si hay key (sin ella no se pueden resolver).
  //     Umbral 10; tras descartar, no vuelve hasta cruzar el próximo tramo (~+10).
  if (n.gemini_ready && n.es_pending >= 10) {
    const at = +sessionStorage.getItem('nudgeEsAt') || 0;
    if (n.es_pending >= at + 10) {
      return showNudge(`Tenés <b>${n.es_pending}</b> juegos sin nombre en español. ¿Actualizar ahora?`,
        runUpdateFromNudge, () => sessionStorage.setItem('nudgeEsAt', n.es_pending));
    }
  }
  // (b) antigüedad: más de 6 meses sin actualizar rankings. Una vez por sesión.
  if (n.stale_days != null && n.stale_days > 180 && !sessionStorage.getItem('nudgeStale')) {
    const meses = Math.max(6, Math.round(n.stale_days / 30));
    showNudge(`Hace <b>${meses} meses</b> que no actualizás los rankings. ¿Actualizar?`,
      runUpdateFromNudge, () => sessionStorage.setItem('nudgeStale', '1'));
  }
}

// dispara el mismo "Actualizar" del tab de datos (ítem 4) y refresca la vista
async function runUpdateFromNudge() {
  toast('Actualizando rankings…');
  try {
    const r = await api('/update', { method: 'POST' });
    BGGV.owner = -1; await loadGames(); await loadOwners();
    if (S.view === 'panel' || S.view === 'bgg') render();
    const es = r.es_names || {};
    const tandas = es.tandas > 1 ? ` (en ${es.tandas} tandas)` : '';
    toast(es.resolved ? `Listo · ${es.resolved} nombres en español resueltos${tandas}` : 'Actualización completa');
  } catch (e) { toast('Error: ' + e.message); }
}

function bindTop() {
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.view = b.dataset.view;
    $$('#nav button').forEach(x => x.classList.toggle('active', x === b));
    render();
    // cada vista arranca arriba: se comparten los filtros, NO el scroll. 'instant' porque el <html>
    // tiene scroll-behavior:smooth y no queremos ver la animación de subida al cambiar de tab.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  });
  $('#btnTheme').addEventListener('click', () => {
    const h = document.documentElement;
    h.dataset.theme = h.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', h.dataset.theme);
  });
  if (localStorage.getItem('theme')) document.documentElement.dataset.theme = localStorage.getItem('theme');
  $('#btnAdd').addEventListener('click', () => { if (ensureUnlocked()) openAdd(); });
  $('#btnLock').addEventListener('click', toggleLock);
  $('#btnCfg').addEventListener('click', () => openData());   // hub único: perfiles + datos + config
  $('#ownerSel').addEventListener('change', async e => {
    S.owner = +e.target.value; await loadGames(); render();
  });
  applyLockUI();
}

/* ================= apariencias ================= */
// Tres temas: 'classic' (con día/noche 🌙), 'fresca' y 'calida' (claros, sin 🌙).
// El id se guarda por dispositivo en localStorage, igual que el tema día/noche.
function loadAppearance() {
  const a = localStorage.getItem('appearance');
  S.appearance = APPEARANCES.includes(a) ? a : 'classic';
  applyAppearance();
}
function applyAppearance() {
  const root = document.documentElement;
  if (S.appearance === 'classic') delete root.dataset.appearance;
  else root.dataset.appearance = S.appearance;
  const tb = $('#btnTheme'); if (tb) tb.style.display = S.appearance === 'classic' ? '' : 'none';
}
function setAppearance(a) {
  if (!APPEARANCES.includes(a)) return;
  S.appearance = a; localStorage.setItem('appearance', a); applyAppearance();
}

/* ================= modo seguro ================= */
// Escudo anti-toques: con el candado cerrado, las acciones de escritura quedan bloqueadas.
// `on`/`pin` persisten; el candado (unlocked) arranca SIEMPRE cerrado.
function loadSafe() {
  try {
    const raw = JSON.parse(localStorage.getItem('safe') || '{}');
    S.safe.on = !!raw.on; S.safe.pin = typeof raw.pin === 'string' ? raw.pin : '';
  } catch { S.safe.on = false; S.safe.pin = ''; }
  S.safe.unlocked = false;
}
function saveSafe() { localStorage.setItem('safe', JSON.stringify({ on: S.safe.on, pin: S.safe.pin })); }
// true si hay que bloquear la escritura (modo activo y candado cerrado)
function mutationsLocked() { return S.safe.on && !S.safe.unlocked; }
// gate para handlers de escritura: si está bloqueado avisa y devuelve false
function ensureUnlocked() {
  if (!mutationsLocked()) return true;
  toast('🔒 Modo seguro activo — tocá el candado para poder editar');
  return false;
}
// refleja el estado del candado en el header y (des)habilita el botón de agregar
function applyLockUI() {
  const lock = $('#btnLock'), add = $('#btnAdd');
  if (lock) {
    lock.style.display = S.safe.on ? '' : 'none';
    lock.classList.toggle('locked', mutationsLocked());
    lock.classList.toggle('unlocked', S.safe.on && S.safe.unlocked);
    lock.innerHTML = mutationsLocked() ? LOCK_SVG : UNLOCK_SVG;
    lock.title = mutationsLocked() ? 'Modo seguro: tocá para desbloquear' : 'Tocá para bloquear';
  }
  if (add) add.classList.toggle('disabled-soft', mutationsLocked());
}
async function toggleLock() {
  if (!S.safe.on) return;
  if (S.safe.unlocked) { S.safe.unlocked = false; afterLockChange(); toast('🔒 Bloqueado'); return; }
  if (S.safe.pin) {
    const pin = await askPin('Desbloquear', 'Ingresá el PIN para editar la colección.');
    if (pin == null) return;                       // canceló
    if (pin !== S.safe.pin) { toast('PIN incorrecto'); return; }
  }
  S.safe.unlocked = true; afterLockChange(); toast('🔓 Desbloqueado');
}
// tras abrir/cerrar el candado: actualizar header y repintar la vista (fichas abiertas se reabren)
function afterLockChange() { applyLockUI(); render(); }

// Prompt de PIN in-app (no usamos window.prompt: en webviews suele venir suprimido). Resuelve el
// PIN escrito, o null si cancela. `expect` opcional: si se pasa, exige coincidencia antes de resolver.
function askPin(title, msg, { confirm = false } = {}) {
  return new Promise(resolve => {
    const inner = node(`<div class="pin-modal">
      <h3>${esc(title)}</h3>
      <p>${esc(msg)}</p>
      <div class="field"><input id="pinInput" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN"></div>
      ${confirm ? '<div class="field"><input id="pinInput2" type="password" inputmode="numeric" autocomplete="off" placeholder="Repetir PIN"></div>' : ''}
      <div class="confirm-actions" style="display:flex;gap:10px;margin-top:6px">
        <button class="btn ghost" data-a="cancel" style="flex:1">Cancelar</button>
        <button class="btn primary" data-a="ok" style="flex:1">Aceptar</button>
      </div>
    </div>`);
    const ov = overlay(inner, 'pin');
    const inp = inner.querySelector('#pinInput'), inp2 = inner.querySelector('#pinInput2');
    const done = (v) => { ov.close(); resolve(v); };
    inner.querySelector('[data-a="cancel"]').addEventListener('click', () => done(null));
    inner.querySelector('[data-a="ok"]').addEventListener('click', () => {
      const v = (inp.value || '').trim();
      if (!v) { toast('Escribí un PIN'); return; }
      if (confirm && v !== (inp2.value || '').trim()) { toast('Los PIN no coinciden'); return; }
      done(v);
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { if (confirm) inp2.focus(); else inner.querySelector('[data-a="ok"]').click(); } });
    if (inp2) inp2.addEventListener('keydown', e => { if (e.key === 'Enter') inner.querySelector('[data-a="ok"]').click(); });
    setTimeout(() => inp.focus(), 50);
  });
}

// Metadatos de cada apariencia para el selector (nombre + descripción + swatches representativos).
const APPEAR_META = {
  classic: { name: 'Clásica', tag: 'Fieltro oscuro · día/noche', sw: ['#14100c', '#e0a458', '#46b6ac', '#e06692'] },
  fresca:  { name: 'Playa',   tag: 'Teal + coral sobre marfil',  sw: ['#f8f5f2', '#078080', '#f45d48', '#0aa1a1'] },
  calida:  { name: 'Taberna', tag: 'Navy + madera sobre crema',  sw: ['#f9f4ef', '#8c7851', '#f25042', '#020826'] },
};
// Grilla de tarjetas de apariencia (reutilizable en Config y en el onboarding).
function renderAppearanceGrid(container, onPick) {
  container.innerHTML = '';
  APPEARANCES.forEach(id => {
    const m = APPEAR_META[id];
    const card = node(`<button class="appear-card ${S.appearance === id ? 'on' : ''}" data-a="${id}">
      <div class="appear-sw">${m.sw.map(c => `<span style="background:${c}"></span>`).join('')}</div>
      <div class="appear-meta"><span class="appear-name">${esc(m.name)}</span>${S.appearance === id ? '<span class="appear-check">✓</span>' : ''}</div>
    </button>`);
    card.addEventListener('click', () => { setAppearance(id); renderAppearanceGrid(container, onPick); if (onPick) onPick(id); });
    container.append(card);
  });
}

// Panel de modo seguro (en Config): switch de activación + gestión de PIN. Activar/desactivar y
// cambiar PIN respetan la regla: con PIN puesto, cada una de esas acciones lo pide.
function renderSafeBox(container) {
  container.innerHTML = '';
  const on = S.safe.on, hasPin = !!S.safe.pin;
  // Todo en una sola fila (texto · botones de PIN · switch) para que activar no agregue una línea
  // ni cambie el alto de la sección.
  const status = on ? `Activado${hasPin ? ' · con PIN' : ' · sin PIN'}` : 'Desactivado';
  const btns = !on ? '' : (hasPin
    ? '<button class="btn ghost sm" id="pinSet">Cambiar PIN</button><button class="btn ghost sm" id="pinClear">Quitar PIN</button>'
    : '<button class="btn ghost sm" id="pinSet">Poner un PIN</button>');
  const row = node(`<div class="safe-row">
    <span class="safe-txt">${status}</span>
    <span class="safe-actions">${btns}</span>
    <label class="switch"><input type="checkbox" id="safeToggle" ${on ? 'checked' : ''}><span class="track"></span></label>
  </div>`);
  container.append(row);
  const pinSet = row.querySelector('#pinSet');
  if (pinSet) pinSet.addEventListener('click', async () => {
    if (hasPin) {
      const cur = await askPin('PIN actual', 'Ingresá tu PIN actual para cambiarlo.');
      if (cur == null) return;
      if (cur !== S.safe.pin) { toast('PIN incorrecto'); return; }
    }
    const np = await askPin('Nuevo PIN', 'Elegí un PIN. Te lo pedirá para abrir el candado.', { confirm: true });
    if (np == null) return;
    S.safe.pin = np; saveSafe(); applyLockUI(); renderSafeBox(container); toast('PIN actualizado');
  });
  const clr = row.querySelector('#pinClear');
  if (clr) clr.addEventListener('click', async () => {
    const cur = await askPin('Quitar PIN', 'Ingresá tu PIN para quitarlo.');
    if (cur == null) return;
    if (cur !== S.safe.pin) { toast('PIN incorrecto'); return; }
    S.safe.pin = ''; saveSafe(); applyLockUI(); renderSafeBox(container); toast('PIN quitado');
  });
  row.querySelector('#safeToggle').addEventListener('change', async (e) => {
    if (e.target.checked) {
      // activar sin prompt: el PIN se pone (opcional) con el botón "Poner un PIN"
      S.safe.on = true; S.safe.unlocked = true; saveSafe();   // queda abierto hasta el próximo reload
      toast('Modo seguro activado');
    } else {
      if (S.safe.pin) {
        const cur = await askPin('Desactivar modo seguro', 'Ingresá tu PIN para desactivarlo.');
        if (cur == null || cur !== S.safe.pin) { if (cur != null) toast('PIN incorrecto'); e.target.checked = true; return; }
      }
      S.safe.on = false; S.safe.pin = ''; S.safe.unlocked = false; saveSafe();
      toast('Modo seguro desactivado');
    }
    applyLockUI(); renderSafeBox(container);
  });
}

async function loadOwners() {
  const d = await api('/owners'); S.owners = d.owners;
  if (!S.owner) S.owner = (S.owners.find(o => o.is_me) || S.owners[0]).id;
  fillOwnerSel();
}
// En celular y en tablet vertical no mostramos el "(N)" de juegos en el selector de perfil (lo pidió
// el usuario); el ancho de la barra se mantiene por min-width en CSS para que no se achique.
function fillOwnerSel() {
  const sel = $('#ownerSel'); if (!sel) return;
  const mob = isCompact();
  sel.innerHTML = S.owners.map(o =>
    `<option value="${o.id}">${o.is_me ? '👤 ' : '👥 '}${esc(o.name)}${mob ? '' : ` (${o.own_count})`}</option>`).join('');
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
  else if (S.view === 'bgg') renderBGG(m);
  else if (S.view === 'panel') renderPanel(m);
  else if (S.view === 'advisor') renderAdvisor(m);
}

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
function passesMechanics(g, set) {
  for (const m of set) if (matchesMechanic(g, m)) return true;
  return false;
}

// Facet "Mecánicas" colapsable (ítem 9), reusable en Biblioteca y BGG. Devuelve {button, panel}:
// el botón muestra el conteo activo y togglea el panel de 8 chips; onChange se llama al tildar.
function mechFacet(set, onChange) {
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
function fitTier(g, n) {
  if (!n) return 3;
  if ((g.best_players || []).includes(n)) return 0;
  if ((g.recommended_players || []).includes(n)) return 1;
  if ((g.minplayers || 0) <= n && (g.maxplayers || 0) >= n) return 2;
  return 3;
}

function renderCollection(kind) {
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

  if (isCompact()) {
    // celular / tablet vertical: tres grupos colapsables (Filtros / Tipo / Mecánicas) + Limpiar/contador
    const gFiltros = filterGroup('filtros', '🎛', 'Filtros', activeSelectCount(f), [players, time, weight, dsel, sort, dirBtn]);
    const gTipo = filterGroup('tipo', '🏷', 'Tipo', f.types.size, typeChips);
    const fbtns = node('<div class="fbtns"></div>');
    fbtns.append(gFiltros.button, gTipo.button, mech.button);
    wireAccordion([gFiltros, gTipo, mech]);   // un solo grupo abierto a la vez
    const tail = node('<div class="filters-tail"></div>');
    tail.append(clearBtn, countTag);
    // celular: Limpiar + "N juegos" van en su propia fila abajo (no sobra ancho). Tablet vertical:
    // hay espacio → van en la MISMA fila de los botones, a la derecha (CSS: .fbtns .filters-tail).
    if (isMobile()) bar.append(fbtns, gFiltros.panel, gTipo.panel, mech.panel, tail);
    else { fbtns.append(tail); bar.append(fbtns, gFiltros.panel, gTipo.panel, mech.panel); }
  } else if (isTabletLandscape()) {
    // tablet horizontal: línea 1 con los selects inline (igual que PC); línea 2 con DOS botones
    // colapsables (Tipo / Mecánica) en acordeón + Limpiar/contador a la derecha. Todo en 2 líneas.
    bar.append(players, time, weight, dsel, sort, dirBtn);
    const gTipo = filterGroup('tipo', '🏷', 'Tipo', f.types.size, typeChips);
    const fbtns = node('<div class="fbtns"></div>');
    const tail = node('<div class="filters-tail"></div>');
    tail.append(clearBtn, countTag);
    fbtns.append(gTipo.button, mech.button, tail);
    wireAccordion([gTipo, mech]);   // un solo grupo abierto a la vez
    bar.append(fbtns, gTipo.panel, mech.panel);
  } else {
    // desktop: todo inline, como siempre
    bar.append(players, time, weight, dsel, sort, dirBtn);
    const chips = node('<div class="type-chips"></div>');
    typeChips.forEach(c => chips.append(c));
    chips.append(mech.button, clearBtn, countTag);
    bar.append(chips, mech.panel);
  }
  return bar;
}

function hasActiveFilters() {
  const f = S.filters;
  return !!(f.q || f.types.size || f.mechanics.size || f.players || f.time || f.weight || f.designer);
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

/* ================= BGG (browse del top, paginado + filtros server-side) ================= */
// Opciones de orden por vista: 'prio' solo en Wishlist; 'fit' aparece al elegir N jugadores.
// El resto es común a las tres vistas (misma semántica en cliente y servidor) → orden consistente.
function sortOptsFor(view, f) {
  const opts = view === 'wishlist'
    ? [['rank', 'Ranking BGG'], ['prio', 'Prioridad'], ['rating', 'Rating'], ['weight', 'Complejidad'], ['time', 'Duración'], ['year', 'Año'], ['name', 'Nombre']]
    : [['rank', 'Ranking BGG'], ['rating', 'Rating'], ['weight', 'Complejidad'], ['time', 'Duración'], ['year', 'Año'], ['name', 'Nombre']];
  if (f.players) opts.unshift(['fit', `Mejor para ${f.players} jug.`]);
  return opts;
}
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

  if (isCompact()) {
    // celular / tablet vertical: mismos tres grupos que Biblioteca. BGG no tiene combo de diseñador
    // (~2800 opciones), así que el diseñador activo va como chip removible DENTRO del panel Filtros,
    // en el lugar que ocuparía el select de diseñador (no como chip suelto afuera). activeSelectCount
    // ya lo cuenta → el badge "Filtros (N)" queda consistente con Biblioteca/Wishlist.
    const filtrosBody = [players, time, weight];
    if (dchip) filtrosBody.push(dchip);       // slot del diseñador
    filtrosBody.push(sort, dirBtn);
    const gFiltros = filterGroup('filtros', '🎛', 'Filtros', activeSelectCount(f), filtrosBody);
    const gTipo = filterGroup('tipo', '🏷', 'Tipo', f.types.size, typeChips);
    const fbtns = node('<div class="fbtns"></div>');
    fbtns.append(gFiltros.button, gTipo.button, mech.button);
    wireAccordion([gFiltros, gTipo, mech]);   // un solo grupo abierto a la vez
    const tail = node('<div class="filters-tail"></div>');
    tail.append(clearBtn, countTag);          // afuera SOLO Limpiar + contador
    // celular: tail en fila propia abajo. Tablet vertical: en la misma fila de los botones, a la
    // derecha (CSS: .fbtns .filters-tail).
    if (isMobile()) bar.append(fbtns, gFiltros.panel, gTipo.panel, mech.panel, tail);
    else { fbtns.append(tail); bar.append(fbtns, gFiltros.panel, gTipo.panel, mech.panel); }
  } else if (isTabletLandscape()) {
    // tablet horizontal: igual que Biblioteca (línea 1 inline, línea 2 con Tipo/Mecánica colapsables).
    // El diseñador activo va como chip removible suelto en la fila de los botones (BGG no tiene combo).
    bar.append(players, time, weight, sort, dirBtn);
    const gTipo = filterGroup('tipo', '🏷', 'Tipo', f.types.size, typeChips);
    const fbtns = node('<div class="fbtns"></div>');
    fbtns.append(gTipo.button, mech.button);
    if (dchip) fbtns.append(dchip);
    const tail = node('<div class="filters-tail"></div>');
    tail.append(clearBtn, countTag);
    fbtns.append(tail);
    wireAccordion([gTipo, mech]);   // un solo grupo abierto a la vez
    bar.append(fbtns, gTipo.panel, mech.panel);
  } else {
    bar.append(players, time, weight, sort, dirBtn);
    const chips = node('<div class="type-chips"></div>');
    typeChips.forEach(c => chips.append(c));
    chips.append(mech.button);
    if (dchip) chips.append(dchip);
    chips.append(clearBtn, countTag);
    bar.append(chips, mech.panel);
  }
  return bar;
}

async function renderBGG(m) {
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
// Etiqueta de estado sobre la portada. Solo en BGG (en Biblioteca/Wishlist es redundante:
// ahí todo es "tengo" o "quiero"). Chip con fondo sólido para que se lea como algo sobrepuesto.
function stateBadge(g) {
  if (S.view !== 'bgg') return '';
  if (g.own) return '<span class="statebadge own" title="En mi colección">📦</span>';
  if (g.wishlist) return '<span class="statebadge wish" title="En mi wishlist">⭐</span>';
  return '';
}
// Lazy-load de portadas: cada .cover arranca solo con su color placeholder (el box ya tiene tamaño
// fijo por aspect-ratio, así que NO hay salto de layout) y la imagen se asigna recién cuando la
// tarjeta se acerca al viewport. Antes se disparaban las ~154 imágenes externas de golpe al entrar
// a una vista → en celular hacía que "tarde en asentarse". Compartido por Biblioteca/Wishlist/BGG.
let coverObserver = null;
function lazyCover(cover) {
  const url = cover && cover.dataset.bg;
  if (!url) return;
  if (!('IntersectionObserver' in window)) {   // fallback: cargar ya
    cover.style.backgroundImage = `url('${url}')`; cover.removeAttribute('data-bg'); return;
  }
  if (!coverObserver) {
    // Preload deslizante proporcional a lo que se ve: el margen es 2× la altura del viewport, así
    // si el "bloque 1" es lo visible, quedan cargados también el 2 y el 3 (≈3× lo visible). Como el
    // IntersectionObserver reevalúa al scrollear, cuando bajás al bloque 2 entra el 4, y así: siempre
    // vas con ~2 bloques cargados por delante, nunca ves un hueco en algo que está en pantalla.
    const margin = Math.round((window.innerHeight || 800) * 2);
    coverObserver = new IntersectionObserver((entries, obs) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const c = en.target;
        c.style.backgroundImage = `url('${c.dataset.bg}')`;
        c.removeAttribute('data-bg');
        obs.unobserve(c);
      }
    }, { rootMargin: `${margin}px 0px` });
  }
  coverObserver.observe(cover);
  scheduleCoverPrefetch();   // opción A: además, precargar el resto en segundo plano (idle)
}

// Prefetch en segundo plano: tras el primer paint (rápido, solo lo visible), cuando el navegador
// está OCIOSO va calentando el caché de las portadas restantes con new Image(). Así, para cuando
// scrolleás, ya están descargadas y el observer solo las "muestra" (sin pop-in). Debounced: se
// dispara una vez por lote de tarjetas. Va de a poco para no pelear con el scroll/paint.
let _prefetchTimer = null;
function scheduleCoverPrefetch() {
  if (_prefetchTimer) return;
  _prefetchTimer = setTimeout(() => {
    _prefetchTimer = null;
    const pending = [...document.querySelectorAll('.cover[data-bg]')];
    let i = 0;
    const ric = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 8 }), 200));
    const pump = (dl) => {
      let n = 0;
      while (i < pending.length && dl.timeRemaining() > 4 && n < 20) {
        const url = pending[i++].dataset.bg;
        if (url) { const im = new Image(); im.src = url; }   // calienta caché; el observer la mostrará
        n++;
      }
      if (i < pending.length) ric(pump);
    };
    ric(pump);
  }, 400);   // esperar a que el paint inicial y el scroll se asienten
}

function card(g) {
  const t = (g.subdomains || [])[0];
  const players = S.filters.players;
  const c = node(`
    <div class="card" data-oid="${esc(g.objectid)}">
      <div class="cover" data-bg="${esc(safeImg(g.image || g.thumb))}">
        ${g.rank_overall ? `<span class="rankbadge">#${g.rank_overall}</span>` : ''}
        ${stateBadge(g)}
        ${players ? `<div class="fit-overlay">${playerFit(g, players)}</div>` : ''}
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
      </div>
    </div>`);
  lazyCover(c.querySelector('.cover'));
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

// Confirmación in-app (no usamos window.confirm: en webviews embebidos suele quedar
// suprimido y devolver undefined -> el handler cortaba y "el botón no respondía").
function askConfirm(message, { ok = 'Sí, sacar', cancel = 'Cancelar' } = {}) {
  return new Promise(resolve => {
    const ov = node(`<div class="overlay"><div class="modal confirm">
      <div class="confirm-msg">${esc(message).replace(/\n/g, '<br>')}</div>
      <div class="confirm-actions">
        <button class="btn ghost" data-a="cancel">${esc(cancel)}</button>
        <button class="btn danger" data-a="ok">${esc(ok)}</button>
      </div>
    </div></div>`);
    let done = false;
    const onKey = (e) => { if (e.key === 'Escape') finish(false); };
    const finish = (val) => {
      if (done) return; done = true;
      ov.remove(); document.removeEventListener('keydown', onKey); resolve(val);
    };
    ov.querySelector('[data-a="ok"]').addEventListener('click', () => finish(true));
    ov.querySelector('[data-a="cancel"]').addEventListener('click', () => finish(false));
    ov.addEventListener('click', e => { if (e.target === ov) finish(false); });   // click afuera = cancelar
    document.addEventListener('keydown', onKey);
    $('#modalRoot').append(ov);
    ov.querySelector('[data-a="ok"]').focus();
  });
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
function openDetail(g, opts = {}) {
  const t = (g.subdomains || [])[0];
  const ageCom = g.age_community ? esc(g.age_community) : '—';
  // Cada bloque lleva data-fb: en desktop van en dos columnas (detail-side / detail-main) como
  // siempre; en celular la ficha pasa a una sola columna y estos data-fb se reordenan por CSS
  // (ver bloque móvil en styles.css) → portada, título, año/rank, tipo, descripción, specs, nombre
  // español, jugadores, idioma, diseño, categorías, mecánicas, expansiones, dueños, link BGG.
  const inner = node(`<div>
    <div class="detail-hero">
      <div class="detail-side">
        <div class="cover" data-fb="cover"><img src="${esc(safeImg(g.image))}" alt=""></div>
        ${g.es_name && g.es_name !== g.name ? `<div data-fb="esname"><div class="section-h" style="margin-top:8px">Nombre en español</div><div style="color:var(--ink);font-size:14px">${esc(g.es_name)}</div></div>` : ''}
        ${g.designers && g.designers.length ? `<div data-fb="designers"><div class="section-h" style="margin-top:8px">Diseño</div><div class="chips-line" id="desigChips">${g.designers.map(d => `<span class="tagchip click" data-d="${esc(d.name)}">🖋 ${esc(d.name)}</span>`).join('')}</div></div>` : ''}
        <div id="expSection" data-fb="expansions"></div>
        ${g.owners_owning && g.owners_owning.length ? `<div data-fb="owners"><div class="section-h">Lo tienen</div><div class="chips-line">${g.owners_owning.map(n => `<span class="tagchip">👤 ${esc(n)}</span>`).join('')}</div></div>` : ''}
        <div data-fb="bgg" style="margin-top:auto;padding-top:6px"><a href="${esc(safeImg(g.href) || '#')}" target="_blank" rel="noopener">Ver en BoardGameGeek ↗</a></div>
      </div>
      <div class="detail-main">
        <div class="detail-title" data-fb="title">${esc(g.name)}</div>
        <div class="detail-sub" data-fb="sub">${esc(g.yearpublished || '')} ${g.rank_overall ? '· Ranking BGG #' + g.rank_overall : ''} ${g.rating_avg ? '· ★ ' + (+g.rating_avg).toFixed(1) : ''}</div>
        <div class="chips-line" data-fb="tags" style="margin-top:10px">
          ${(g.subdomains || []).map(s => `<span class="type-tag" style="--c:${typeColor(s)}">${typeEs(s)}</span>`).join('')}
        </div>
        <div class="detail-desc" id="detailDesc" data-fb="desc">${esc(g.short_description || '')}</div>
        <div class="spec-grid" data-fb="specs">
          <div class="spec"><div class="k">Complejidad</div><div class="v">${weightbar(g.weight, true)} ${g.weight ? (+g.weight).toFixed(1) + '/5' : ''}</div></div>
          <div class="spec"><div class="k">Duración</div><div class="v">⏱ ${g.minplaytime || '?'}–${g.maxplaytime || '?'} min</div></div>
          <div class="spec"><div class="k">Edad · editorial</div><div class="v">${g.minage_publisher ? g.minage_publisher + '+' : '—'}</div></div>
          <div class="spec"><div class="k">Edad · comunidad</div><div class="v">${ageCom}</div></div>
        </div>
        <div data-fb="players">
          <div class="section-h">Jugadores <span style="text-transform:none;font-weight:500">(👑 mejor · <span style="color:var(--brass-2)">recomendado</span>)</span></div>
          ${playersViz(g)}
        </div>
        <div class="spec" data-fb="lang" style="margin-top:14px"><div class="k">Dependencia del idioma</div><div class="v" style="font-size:14px">${esc(LANG[g.language_dependence] || g.language_dependence || '—')}</div></div>
        ${g.categories && g.categories.length ? `<div data-fb="categories"><div class="section-h">Categorías</div><div class="chips-line">${g.categories.map(c => `<span class="tagchip">${esc(c)}</span>`).join('')}</div></div>` : ''}
        ${g.mechanics && g.mechanics.length ? `<div data-fb="mechanics"><div class="section-h">Mecánicas</div><div class="chips-line">${g.mechanics.slice(0, 12).map(c => `<span class="tagchip">${esc(c)}</span>`).join('')}</div></div>` : ''}
      </div>
    </div>
    <div class="state-bar"></div>
  </div>`);

  // click en diseñador -> filtra por ese diseñador SIN salir de la vista actual (Biblioteca,
  // Wishlist o BGG). Deshabilitado en solo lectura (advisor). Desde una ficha suelta (alta) cae
  // en Biblioteca. Como el filtro es único (S.filters), queda activo también al cambiar de tab.
  if (opts.readonly) {
    inner.querySelectorAll('#desigChips .tagchip').forEach(ch => ch.classList.remove('click'));
  } else {
    inner.querySelectorAll('#desigChips .tagchip').forEach(ch => ch.addEventListener('click', () => {
      S.filters.designer = ch.dataset.d;
      ov.remove();
      if (S.view === 'bgg') { renderBGG($('#main')); return; }
      if (S.view !== 'library' && S.view !== 'wishlist') {
        S.view = 'library';
        $$('#nav button').forEach(x => x.classList.toggle('active', x.dataset.view === 'library'));
      }
      render();
    }));
  }

  // barra de estado — en el advisor la ficha es de SOLO LECTURA (no es el lugar para editar)
  const bar = inner.querySelector('.state-bar');
  if (opts.readonly) bar.remove();
  else bar.append(stateControls(g));
  const ov = overlay(inner);
  setupDescription(inner, g);
  renderExpansions(inner, g, opts);
}

/* ===== Expansiones (ítem 3): viven dentro de la ficha del juego madre ===== */
// Sección en la ficha: las expansiones que tenés/deseás (📦/⭐) + un "＋" para agregar/editar.
// Solo aparece si el juego está en tu colección o wishlist (si no, no podés tener expansiones).
async function renderExpansions(inner, g, opts = {}) {
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
function openExpansionDetail(g, opts = {}) {
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

function _words(t, n) { const w = (t || '').split(/\s+/); return w.length <= n ? t : w.slice(0, n).join(' ') + '…'; }
// clamp genérico con "ver más"/"ver menos" para un texto ya presente (reusa _words y el estilo
// .vermas de las fichas). Si el texto es corto, lo muestra entero sin botón.
function clampText(box, text, limit) {
  text = text || '';
  const many = text.split(/\s+/).length > limit;
  const collapse = () => {
    box.textContent = _words(text, limit) + ' ';
    if (many) { const a = node('<button class="vermas">ver más ▾</button>'); a.onclick = expand; box.append(a); }
  };
  const expand = () => {
    box.textContent = text + ' ';
    const a = node('<button class="vermas">ver menos ▴</button>'); a.onclick = collapse; box.append(a);
  };
  collapse();
}
async function setupDescription(inner, g) {
  const box = inner.querySelector('#detailDesc'); if (!box) return;
  const short = g.short_description || '';
  const limit = descLimit();
  const collapse = (text) => {
    box.innerHTML = esc(_words(text, limit));
    if ((text.split(/\s+/).length) > limit) {
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
  // modo seguro cerrado: no se muestran los controles de estado, solo un aviso
  if (mutationsLocked()) return node(`<div class="locked-note"><span>🔒</span> Modo seguro activo. Tocá el candado de arriba para editar el estado del juego.</div>`);
  const box = node(`<div style="display:flex;flex-direction:column;gap:12px;width:100%">
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
      <div class="seg">
        <button data-s="own" class="${g.own ? 'on' : ''}"><span class="seg-ic">📦</span><span class="seg-tx">Lo tengo</span></button>
        <button data-s="wishlist" class="${g.wishlist ? 'on' : ''}"><span class="seg-ic">⭐</span><span class="seg-tx">Lo quiero</span></button>
        <button data-s="none" class="${!g.own && !g.wishlist ? 'on' : ''}"><span class="seg-ic">✕</span><span class="seg-tx">Ninguno</span></button>
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
      if (upd.removed) {
        // era no-preseed y quedó huérfano al desmarcarlo -> se fue del catálogo (ítem 7)
        S.games = S.games.filter(x => x.objectid !== g.objectid);
        BGGV.games = BGGV.games.filter(x => x.objectid !== g.objectid);
        const cardEl = document.querySelector(`.card[data-oid="${g.objectid}"] .statebadge`);
        if (cardEl) cardEl.remove();
        g.own = 0; g.wishlist = 0; g.status = 'none';
        toast('Sacado de tu ludoteca');
        await loadOwners();
        return;
      }
      Object.assign(g, upd);
      // reflejar el nuevo estado en las listas en memoria
      const i = S.games.findIndex(x => x.objectid === g.objectid);
      if (i >= 0) Object.assign(S.games[i], upd);
      else if (upd.own || upd.wishlist) S.games.push(upd);   // agregado desde BGG -> entra a la colección
      const j = BGGV.games.findIndex(x => x.objectid === g.objectid);
      if (j >= 0) Object.assign(BGGV.games[j], { own: upd.own, wishlist: upd.wishlist });
      // actualizar el badge de la card sin re-render (para BGG): recrea el chip de estado
      const cardEl = document.querySelector(`.card[data-oid="${g.objectid}"]`);
      if (cardEl && S.view === 'bgg') {
        const cover = cardEl.querySelector('.cover');
        const old = cover.querySelector('.statebadge'); if (old) old.remove();
        const html = stateBadge({ own: upd.own, wishlist: upd.wishlist });
        if (html) cover.append(node(html));
      }
      toast('Guardado');
      await loadOwners();
    } catch (e) { toast('Error: ' + e.message); }
  }
  box.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', async () => {
    const s = b.dataset.s;
    // juego en PREVIEW (ítem 8): traído de BGG para mostrar la ficha, todavía NO está en la base.
    // "Ninguno" no guarda nada (si cerrás así, no queda huérfano); own/wish lo persiste con /add.
    if (g._preview) {
      box.querySelectorAll('.seg button').forEach(x => x.classList.remove('on')); b.classList.add('on');
      box.querySelector('.prio').style.display = s === 'wishlist' ? 'flex' : 'none';
      if (s === 'none') return;
      try {
        const g2 = await api('/games/add?owner=' + S.owner, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objectid: g.objectid, status: s })
        });
        delete g._preview; Object.assign(g, g2);
        const i = S.games.findIndex(x => x.objectid === g.objectid);
        if (i >= 0) Object.assign(S.games[i], g2); else S.games.push(g2);
        toast(`Agregado: ${g2.name}`);
        await loadOwners();
        if (S.view === 'library' || S.view === 'wishlist') render();
      } catch (e) { toast('Error: ' + e.message); }
      return;
    }
    // "Ninguno": si el juego es top del catálogo (preseed) sale sin más y queda en la base.
    // Si NO es preseed, quedaría huérfano y se borra de la base -> confirmamos primero (ítem 7).
    if (s === 'none' && (g.own || g.wishlist) && !g.is_top) {
      const ok = await askConfirm(`¿Sacar "${g.name}" de tu ludoteca?\n\nNo está en el top del catálogo: si ningún otro perfil lo tiene, se borra de la base y para recuperarlo vas a tener que buscarlo de nuevo.`);
      if (!ok) return;
    }
    box.querySelectorAll('.seg button').forEach(x => x.classList.remove('on')); b.classList.add('on');
    const patch = { own: s === 'own' ? 1 : 0, wishlist: s === 'wishlist' ? 1 : 0 };
    box.querySelector('.prio').style.display = s === 'wishlist' ? 'flex' : 'none';
    await set(patch);
    // en biblioteca/wishlist cambia la membresía -> re-render; en BGG el badge ya se actualizó
    if (S.view === 'library' || S.view === 'wishlist') render();
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

/* ================= ADVISOR ================= */
const OCCASIONS = {
  couple: { ic: '🍷', t: 'Noche de pareja', d: 'Para dos', preset: { players: 2, vibe: 'medium', coop: 'any' } },
  family: { ic: '👨‍👩‍👧', t: 'Familia con chicos', d: 'Con los más chicos', preset: { min_age: 8, vibe: 'light', language_ok: 'light' } },
  party: { ic: '🎉', t: 'Fiesta', d: 'Mucha gente', preset: { players: 6, vibe: 'light', time: 'short', theme: 'fiesta' } },
  friends: { ic: '🍻', t: 'Con amigos', d: 'Junta informal', preset: { players: 4, vibe: 'medium' } },
  elders: { ic: '👵', t: 'Gente grande', d: 'No jugones', preset: { vibe: 'light', language_ok: 'light', experience: 'new' } },
  serious: { ic: '🧠', t: 'Algo en serio', d: 'Con ganas de pensar', preset: { vibe: 'heavy', time: 'long', experience: 'gamers' } },
  kidadult: { ic: '🧒', t: 'Grandes y chicos', d: 'Un adulto con chicos', preset: { players: 2, min_age: 6, vibe: 'light', language_ok: 'light' } },
  newbies: { ic: '🌱', t: 'Recién empiezan', d: 'Nunca jugaron / no jugones', preset: { vibe: 'light', time: 'short', experience: 'new', language_ok: 'light' } },
};
const PLAY_Q = [
  { k: 'players', type: 'step', q: '¿Cuántos van a jugar?', min: 1, max: 10 },
  { k: 'min_age', type: 'opt', q: 'El más chico, ¿qué edad?', opts: [['sin', 'Sin chicos', 99], ['6', '~6', 6], ['8', '~8', 8], ['10', '~10', 10], ['12', '12+', 12]] },
  { k: 'time', type: 'opt', q: '¿Cuánto rato tienen?', opts: [['short', 'Un rato (~30′)', 'short'], ['hour', 'Una hora', 'hour'], ['long', 'La tarde entera', 'long'], ['any', 'No importa', 'any']] },
  { k: 'vibe', type: 'opt', multi: true, q: '¿Con qué ganas vienen? (podés elegir varias)', opts: [['light', '😄 Reírse y charlar', 'light'], ['medium', '🎯 Enganchar sin quemarse', 'medium'], ['heavy', '🧠 Pensar en serio', 'heavy']] },
  { k: 'coop', type: 'opt', q: '¿Compiten o se unen?', opts: [['comp', '⚔ Competir', 'competitive'], ['coop', '🤝 Unirse contra el juego', 'coop'], ['any', 'Da igual', 'any']] },
  { k: 'experience', type: 'opt', q: '¿Cuánta calle tienen?', opts: [['new', 'Todos nuevos', 'new'], ['some', 'Alguno con experiencia', 'some'], ['gamers', 'Grupo jugón', 'gamers']] },
  { k: 'language_ok', type: 'opt', q: '¿Importa el idioma / texto?', opts: [['none', 'Sin texto', 'none'], ['light', 'Mejor poco texto', 'light'], ['any', 'No importa', 'any']] },
];
const BUY_Q = [
  { k: 'audience', type: 'opt', q: '¿Para quién es principalmente?', opts: [['group', 'Mi grupo habitual', 'group'], ['family', 'Familia con chicos', 'family'], ['couple', 'Para dos', 'couple'], ['party', 'Fiestas', 'party'], ['gift', 'Un regalo', 'gift']] },
  { k: 'usual_players', type: 'step', q: '¿Con cuánta gente jugás normalmente?', min: 1, max: 10 },
  { k: 'want_more', type: 'opt', multi: true, q: '¿Qué te gustaría sumar? (podés elegir varias)', opts: [['s', '♟ Más estrategia', 'Strategy Games'], ['p', '🎉 Más party', 'Party Games'], ['f', '👨‍👩‍👧 Más familiar', 'Family Games'], ['t', '🐉 Más temático', 'Thematic Games'], ['c', '🤝 Cooperativos', 'coop'], ['a', '🔷 Abstractos', 'Abstract Games']] },
  { k: 'vibe', type: 'opt', q: '¿Qué complejidad buscás?', opts: [['light', 'Livianos que salgan siempre', 'light'], ['medium', 'Medios', 'medium'], ['heavy', 'El juegazo de la tarde', 'heavy']] },
  { k: 'safe_or_niche', type: 'opt', q: '¿Gemas seguras o nicho?', opts: [['safe', '💎 Gemas seguras', 'safe'], ['niche', '🔍 Descubrir nicho', 'niche']] },
];

const ADV = { mode: 'play', occasion: null, answers: {}, engine: 'rules', freetext: '', engineTouched: false,
  loading: false, result: null, reqId: 0, _loader: null };

function renderAdvisor(m) {
  ADV.answers = ADV.answers || {};
  // si Gemini está configurado, arrancá en modo Agente (salvo que el usuario ya haya elegido)
  if (S.geminiReady && !ADV.engineTouched) ADV.engine = 'agent';
  const v = node('<div class="view advisor-wrap"></div>');

  // switch de modo (los botones son el título)
  const ms = node('<div class="mode-switch"></div>');
  ms.append(mkModeCard('play', '🎲', '¿Qué saco hoy?', 'De lo que ya tenés'));
  ms.append(mkModeCard('buy', '🛒', '¿Qué compro?', 'De tu wishlist, según tu colección'));
  v.append(ms);
  v.append(savedBar());

  const body = node('<div id="advBody"></div>');
  v.append(body);
  m.innerHTML = ''; m.append(v);
  renderAdvBody();
}
function mkModeCard(mode, ic, t, d) {
  const c = node(`<button class="mode-card ${ADV.mode === mode ? 'on' : ''}"><div class="ic">${ic}</div><h3>${t}</h3><p>${d}</p></button>`);
  c.addEventListener('click', () => { advReset(); ADV.mode = mode; ADV.occasion = null; ADV.answers = {}; renderAdvisor($('#main')); });
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
  // chip de la ocasión elegida (modo play), con opción de cambiarla
  if (ADV.mode === 'play' && ADV.occasion) {
    const o = OCCASIONS[ADV.occasion];
    const chip = node(`<div class="occ-chip"><span class="occ-chip-l">${o ? `${o.ic} <b>${esc(o.t)}</b>` : 'Sin ocasión — respondiendo libre'}</span><button class="occ-change">${o ? '↺ cambiar ocasión' : '＋ elegir ocasión'}</button></div>`);
    chip.querySelector('.occ-change').addEventListener('click', () => { advReset(); ADV.occasion = null; ADV.answers = {}; renderAdvBody(); });
    form.append(chip);
  }
  const qs = ADV.mode === 'play' ? PLAY_Q : BUY_Q;
  qs.forEach(q => form.append(renderQ(q)));
  form.append(engineSwitch());
  const go = node(`<button class="btn primary block" style="margin-top:6px">✨ Recomendame ${ADV.mode === 'buy' ? 'qué comprar' : 'qué jugar'}</button>`);
  go.addEventListener('click', runAdvisor);
  form.append(go);
  b.append(form);
  b.append(node('<div id="advResults"></div>'));

  // reanudar: si hay una búsqueda en curso o un resultado, mostrarlo (persiste al navegar)
  if (ADV.loading) showAdvLoading();
  else if (ADV.result && ADV.result.error) {
    form.style.display = 'none';
    const res = $('#advResults'); res.innerHTML = `<div class="empty">Error: ${esc(ADV.result.error)}</div>`; res.append(backButton());
  } else if (ADV.result) renderResults(ADV.result);
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
    const multi = !!q.multi;
    if (multi && !Array.isArray(ADV.answers[q.k]))    // normaliza escalar de preset -> lista
      ADV.answers[q.k] = ADV.answers[q.k] == null ? [] : [ADV.answers[q.k]];
    q.opts.forEach(([id, label, val]) => {
      const on = multi ? ADV.answers[q.k].includes(val)
                       : JSON.stringify(ADV.answers[q.k]) === JSON.stringify(val);
      const o = node(`<button class="opt ${on ? 'on' : ''}">${label}</button>`);
      o.addEventListener('click', () => {
        if (multi) {
          const arr = ADV.answers[q.k], i = arr.indexOf(val);
          if (i >= 0) arr.splice(i, 1); else arr.push(val);
          o.classList.toggle('on');
        } else {
          ADV.answers[q.k] = val;
          opts.querySelectorAll('.opt').forEach(x => x.classList.remove('on')); o.classList.add('on');
        }
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
      <textarea id="advFree" placeholder="Contame algo más con tus palabras: preferencias del grupo, mecánicas, juegos similares que les gusten, etc.… ej: 'Somos 3 adultos y mi vieja se aburre rápido, solemos jugar juegos con dados'">${esc(ADV.freetext)}</textarea>
    </div>
  </div>`);
  const hint = box.querySelector('#engHint');
  const setHint = () => {
    if (!S.geminiReady) hint.innerHTML = 'Activá el agente con IA cargando tu API key de Gemini (gratis) en <b>⚙</b>.';
    else hint.textContent = ADV.engine === 'agent' ? `Razona sobre ${shortlistSize(poolTotal())} candidatos de tu colección.` : 'Puntuación transparente sobre los datos.';
  };
  setHint();
  box.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    ADV.engine = b.dataset.e; ADV.engineTouched = true;
    box.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
    box.querySelector('.freetext').classList.toggle('disabled', ADV.engine !== 'agent');
    setHint();
  }));
  box.querySelector('#advFree').addEventListener('input', e => ADV.freetext = e.target.value);
  return box;
}

// Secuencia de frases (5 s c/u → ~25 s). Si tarda más, itera AGENT_TAIL.
const AGENT_SEQ = [
  'Buscando las mejores sugerencias, bancame un minuto 🎲',  // 0–5 s
  'Barajando los candidatos de tu colección…',               // 5–10 s
  'Viendo qué encaja mejor con tu grupo…',                   // 10–15 s
  'Ya casi está…',                                           // 15–20 s
  'Afinando la recomendación…',                              // 20–25 s
];
const AGENT_TAIL = ['Dame unos segundos más…', 'Afinando la recomendación…'];
const AGENT_STEP_MS = 5000;   // cada frase 5s (la secuencia cubre ~25s, luego alterna la cola)
const AGENT_MIN_MS = 25000;   // mínimo 25s (= 5 frases × 5s); si el modelo tarda más, se sigue esperando

// cuántos candidatos ve el agente: ~15% del pool, tier más cercano de [15..50], tope 50 (espeja el backend)
const SHORTLIST_TIERS = [15, 20, 25, 30, 35, 40, 45, 50];
function shortlistSize(total) {
  if (total <= 15) return Math.max(1, total);
  const t = 0.15 * total;
  return Math.min(SHORTLIST_TIERS.reduce((a, b) => Math.abs(b - t) < Math.abs(a - t) ? b : a), 50);
}
function poolTotal() { return S.games.filter(g => ADV.mode === 'buy' ? g.wishlist : g.own).length; }

function agentLoader() {
  const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const el = node(`<div class="agent-loading"><div class="dice-roll"><span>⚀</span><span>⚄</span></div><div class="agent-msg">${AGENT_SEQ[0]}</div><div class="agent-sub">El agente analiza ${shortlistSize(poolTotal())} candidatos de tu colección</div></div>`);
  const dice = el.querySelectorAll('.dice-roll span'); const msg = el.querySelector('.agent-msg');
  let fi = 0, step = 0;
  const t1 = setInterval(() => { fi++; dice[0].textContent = faces[fi % 6]; dice[1].textContent = faces[(fi + 3) % 6]; }, 130);
  const t2 = setInterval(() => {
    step++;
    msg.textContent = step < AGENT_SEQ.length
      ? AGENT_SEQ[step]
      : AGENT_TAIL[(step - AGENT_SEQ.length) % 2];
  }, AGENT_STEP_MS);
  el._stop = () => { clearInterval(t1); clearInterval(t2); };
  return el;
}

function stopAdvLoader() { if (ADV._loader) { ADV._loader._stop(); ADV._loader = null; } }

// Muestra el loader/spinner en #advResults (si estás en la vista advisor). Idempotente.
function showAdvLoading() {
  const res = $('#advResults'); if (!res) return;
  const form = $('#advForm'); if (form) form.style.display = 'none';
  stopAdvLoader();
  if (ADV.engine === 'agent') { res.innerHTML = ''; ADV._loader = agentLoader(); res.append(ADV._loader); }
  else { res.innerHTML = '<div style="text-align:center;padding:30px 0"><div class="spinner"></div></div>'; }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function runAdvisor() {
  const myId = ++ADV.reqId;             // cada búsqueda tiene su id; la última manda
  ADV.loading = true; ADV.result = null;
  showAdvLoading();
  const started = performance.now();
  const answers = { ...ADV.answers };
  if (ADV.engine === 'agent' && ADV.freetext.trim()) answers.texto_libre = ADV.freetext.trim();
  try {
    const out = await api('/advisor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: ADV.mode, engine: ADV.engine, answers, owner: S.owner, limit: 5 })
    });
    if (myId !== ADV.reqId) return;     // otra búsqueda la reemplazó
    const totalS = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`[advisor] click→respuesta: ${totalS}s | motor: ${out.engine}` +
      (out.elapsed_ms ? ` | gemini: ${(out.elapsed_ms / 1000).toFixed(1)}s` : ''));
    // mínimo de animación SOLO si el agente realmente respondió (si cayó al determinístico, mostrar ya)
    const fromGemini = out.engine && String(out.engine).startsWith('gemini');
    if (fromGemini) {
      const left = AGENT_MIN_MS - (performance.now() - started);
      if (left > 0) await new Promise(r => setTimeout(r, left));
      if (myId !== ADV.reqId) return;
    }
    ADV.loading = false; ADV.result = out; stopAdvLoader();
    if (S.view === 'advisor') renderResults(out);   // si navegaste, queda guardado para cuando vuelvas
  } catch (e) {
    if (myId !== ADV.reqId) return;
    ADV.loading = false; ADV.result = { error: e.message }; stopAdvLoader();
    if (S.view === 'advisor') {
      const res = $('#advResults'); if (res) { res.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; res.append(backButton()); }
    }
  }
}

function advReset() {                    // volver al formulario, descartar resultado en curso
  ADV.reqId++; ADV.loading = false; ADV.result = null; stopAdvLoader();
}

function backButton() {
  const b = node('<div style="text-align:center;margin-top:8px"><button class="btn ghost">↩ Volver a buscar</button></div>');
  b.querySelector('button').addEventListener('click', () => {
    advReset();
    const form = $('#advForm'); if (form) form.style.display = '';
    const res = $('#advResults'); if (res) res.innerHTML = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  return b;
}

function renderResults(out) {
  const res = $('#advResults'); if (!res) return; res.innerHTML = '';
  const form = $('#advForm'); if (form) form.style.display = 'none';   // los resultados pisan el form
  const engLabel = out.engine.startsWith('gemini') ? '🤖 Gemini' : '⚙ determinístico';
  res.append(node(`<div class="rec-head">Seleccioné los mejores <b>${out.picks.length}</b> de <b>${out.considered}</b> que se adaptaban a lo que pediste <span class="rec-eng">${engLabel}</span></div>`));
  if (out.note) res.append(node(`<div class="gap-note" style="background:color-mix(in srgb,var(--brass) 12%,transparent);border-color:color-mix(in srgb,var(--brass) 30%,transparent)">${esc(out.note)}</div>`));
  if (!out.picks.length) { res.append(node('<div class="empty"><div class="ic">🤔</div><p>No encontré nada que encaje. Aflojá algún filtro.</p></div>')); res.append(backButton()); return; }
  const byId = Object.fromEntries(S.games.map(g => [g.objectid, g]));
  out.picks.forEach((p, idx) => {
    const g = byId[p.objectid] || p;
    const c = node(`<div class="rec-card">
      <div class="rec-rank">${idx + 1}</div>
      <div class="rec-media">
        <div class="cover"><img src="${esc(safeImg(p.image || p.thumb))}" alt=""></div>
        <button class="btn ghost rec-ficha">Ver ficha</button>
      </div>
      <div>
        <h3>${esc(p.name)}</h3>
        <div class="chips-line" style="margin:6px 0">${(p.subdomains || []).map(s => `<span class="type-tag" style="--c:${typeColor(s)}">${typeEs(s)}</span>`).join('')} ${weightbar(p.weight)}</div>
        <div class="rec-pitch"></div>
        <div class="rec-why">${(p.reasons || []).map(r => `<span class="tagchip">✓ ${esc(r)}</span>`).join('')}</div>
      </div>
    </div>`);
    // "ver más / ver menos" solo en celular; en tablet/PC hay lugar de sobra → mostrar todo el pitch
    if (isMobile()) clampText(c.querySelector('.rec-pitch'), p.pitch, 28);
    else c.querySelector('.rec-pitch').textContent = p.pitch;
    c.querySelector('.rec-ficha').addEventListener('click', () => openDetail(g, { readonly: true }));
    res.append(c);
  });
  // acciones: guardar + reintentar con Gemini (si cayó al determinístico) + sorprendeme + volver
  const actions = node('<div class="rec-actions"></div>');
  if (!out._saved) {   // no ofrecer "Guardar" cuando ya estás viendo una guardada
    const saveBtn = node('<button class="btn">💾 Guardar</button>');
    saveBtn.addEventListener('click', async () => {
      const name = await askName('Guardar recomendación', savedTitle(out));
      if (name == null) return;                 // canceló
      try {
        const r = await api('/saved?owner=' + S.owner, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: name, mode: out.mode, engine: out.engine, result: out })
        });
        if (r.error) throw new Error(r.error);
        saveBtn.textContent = '✓ Guardada'; saveBtn.disabled = true;
        refreshSavedCount();                     // actualiza "Guardadas (N)" sin re-render
        toast('Recomendación guardada');
      } catch (e) { toast('Error: ' + e.message); }
    });
    actions.append(saveBtn);
  }
  if (out.engine === 'rules' && ADV.engine === 'agent') {
    const retry = node('<button class="btn primary">🔁 Reintentar con Gemini</button>');
    retry.addEventListener('click', () => runAdvisor());   // reusa tus respuestas, no recompletás nada
    actions.append(retry);
  }
  if (ADV.mode === 'play') {
    const sp = node('<button class="btn">🎲 Sorprendeme</button>');
    sp.addEventListener('click', () => {
      sp.classList.add('dice-rolling'); setTimeout(() => sp.classList.remove('dice-rolling'), 600);
      const top = out.picks.slice(0, 3);                 // al azar entre los 3 de mejor fit
      const pick = top[Math.floor(Math.random() * top.length)];
      const g = byId[pick.objectid] || pick; setTimeout(() => openDetail(g, { readonly: true }), 300);
    });
    actions.append(sp);
  }
  const back = node('<button class="btn ghost">↩ Volver a buscar</button>');
  back.addEventListener('click', () => {
    advReset();
    const form = $('#advForm'); if (form) form.style.display = '';
    res.innerHTML = ''; window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  actions.append(back);
  res.append(actions);

  // transparencia: los N candidatos que analizó el determinístico (lista simple)
  if (out.candidates && out.candidates.length) {
    const det = node(`<details class="candlist">
      <summary>Ver los ${out.candidates.length} candidatos que analicé <span>(${poolTotal()} → ${out.candidates.length} determinístico → ${out.picks.length} agente)</span></summary>
      <ol>${out.candidates.map(c => `<li class="${c.picked ? 'picked' : ''}">${esc(c.name)}${(c.subdomains || [])[0] ? ` <small>· ${typeEs(c.subdomains[0])}</small>` : ''}${c.picked ? ' <b>✓ elegido</b>' : ''}</li>`).join('')}</ol>
    </details>`);
    res.append(det);
  }
}

/* ===== Recomendaciones guardadas (opt-in): snapshot del resultado, por perfil ===== */
// Prompt de nombre in-app (para guardar/renombrar). Prefill editable; Enter = aceptar. Devuelve el
// nombre escrito, o null si cancela.
function askName(title, defaultValue) {
  return new Promise(resolve => {
    const inner = node(`<div>
      <h3 style="font-size:17px;margin:0 0 12px">${esc(title)}</h3>
      <div class="field"><input id="nameInput" type="text" value="${esc(defaultValue || '')}" placeholder="Ponele un nombre" autocomplete="off"></div>
      <div style="display:flex;gap:10px;margin-top:6px">
        <button class="btn ghost" data-a="cancel" style="flex:1;justify-content:center">Cancelar</button>
        <button class="btn primary" data-a="ok" style="flex:1;justify-content:center">Aceptar</button>
      </div>
    </div>`);
    const ov = overlay(inner, 'namebox');
    const inp = inner.querySelector('#nameInput');
    const done = (v) => { ov.close(); resolve(v); };
    inner.querySelector('[data-a="cancel"]').addEventListener('click', () => done(null));
    inner.querySelector('[data-a="ok"]').addEventListener('click', () => {
      const v = (inp.value || '').trim();
      if (!v) { toast('Escribí un nombre'); return; }
      done(v);
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inner.querySelector('[data-a="ok"]').click(); });
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  });
}
// Nombre por defecto sugerido: modo + ocasión (si hay) + fecha.
function savedTitle(out) {
  const modeL = out.mode === 'buy' ? '¿Qué compro?' : '¿Qué saco hoy?';
  const occ = OCCASIONS[ADV.occasion] ? OCCASIONS[ADV.occasion].t : '';
  const d = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  return modeL + (occ ? ' · ' + occ : '') + ' · ' + d;
}
// Entrada "💾 Guardadas (N)" bajo el switch de modo; abre la lista.
function savedBar() {
  const bar = node('<div class="saved-bar"><button class="btn ghost sm" id="advSavedBtn">💾 Guardadas</button></div>');
  bar.querySelector('#advSavedBtn').addEventListener('click', openSavedList);
  refreshSavedCount();
  return bar;
}
// Actualiza el label "Guardadas (N)" del header del advisor (si está en pantalla).
function refreshSavedCount() {
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

/* ================= AGREGAR juego (ítem 8: local-first) ================= */
// id de BGG desde un id suelto o una URL
function bggId(s) {
  s = String(s || '').trim();
  const m = s.match(/boardgame\/(\d+)/);
  return m ? m[1] : (s.match(/\d{2,}/) || [s])[0];
}
function openAdd() {
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
    toast('Abriendo ficha…');
    try {
      const d = await api('/lookup/' + encodeURIComponent(oid) + '?owner=' + S.owner);
      const g = d.game;
      if (d.is_expansion) { g._expansion = true; openExpansionDetail(g); return; }
      if (!d.saved) g._preview = true;
      openDetail(g);
    } catch (e) { toast('Error: ' + e.message); }
  }
  inner.querySelector('#addSearch').addEventListener('click', doSearch);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  const ov = overlay(inner, 'sheet');
  setTimeout(() => q.focus(), 50);
}

/* ================= DATOS: perfiles + import/export ================= */
function openData(tab = 'perfiles') {
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
      row.querySelector('.ren').addEventListener('click', async () => {
        if (!ensureUnlocked()) return;
        const name = prompt('Nuevo nombre:', o.name); if (!name) return;
        await api('/owners/' + o.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        await loadOwners(); paintOwners(); toast('Renombrado');
      });
      row.querySelector('.rst').addEventListener('click', async () => {
        if (!ensureUnlocked()) return;
        if ((o.own_count + o.wish_count) === 0) { toast('Ese perfil ya está vacío'); return; }
        if (!confirm(`¿Vaciar la colección de ${o.name}? Se borran sus ${o.own_count} juegos y ${o.wish_count} de wishlist. El perfil queda, pero vacío. No se puede deshacer.`)) return;
        const r = await api('/owners/' + o.id + '/reset', { method: 'POST' });
        await loadOwners(); paintOwners();
        if (S.owner === o.id) { await loadGames(); render(); }
        toast(`Colección vaciada (${r.cleared} juegos)`);
        if (o.is_me && S.owner === o.id) { ov.remove(); maybeOnboard(); }  // ofrecé recargar de cero
      });
      const del = row.querySelector('.del');
      if (del) del.addEventListener('click', async () => {
        if (!ensureUnlocked()) return;
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

/* Reconciliación de re-import (flujo 9): muestra el diff agrupado y aplica con confirmación.
   Altas y cambios se aplican al confirmar; las bajas solo las que el usuario marca. */
function openReconcile(file, ownerId, pv, dataOv) {
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
      `<label class="recon-row rm"><input type="checkbox" class="rmchk" data-id="${g.objectid}"><span class="rn">${esc(g.name)}</span>${stTag(g.from)}</label>`).join('');

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
    <div style="margin-top:20px;text-align:left">
      <div class="section-h" style="margin:0 0 8px">Elegí un tema <span style="text-transform:none;font-weight:500;color:var(--ink-dim)">(lo cambiás cuando quieras)</span></div>
      <div class="appear-grid" id="onbAppear"></div>
    </div>
    <div style="margin-top:16px;text-align:left">
      <div class="section-h" style="margin:0 0 6px">Modo seguro <span style="text-transform:none;font-weight:500;color:var(--ink-dim)">(opcional)</span></div>
      <p class="tab-hint" style="margin:0 0 8px">Un candado que bloquea los cambios — para que un chico mire sin tocar la colección. Lo activás y configurás el PIN cuando quieras.</p>
      <div id="onbSafe"></div>
    </div>
    <div class="onb-key" style="margin-top:18px">💡 El <b>Advisor con IA</b> es opcional: usa una API key <b>gratis</b> de Google Gemini. Podés cargarla ahora o cuando quieras en <b>⚙ → Configurar</b>. Sin ella, la app anda completa (búsqueda, panel y advisor determinístico).
      <div style="margin-top:8px"><button class="btn ghost sm" id="onbKey">Configurar el Advisor (opcional)</button></div>
    </div>
    <div id="onbProg" style="margin-top:18px"></div>
  </div>`);
  renderAppearanceGrid(inner.querySelector('#onbAppear'));
  renderSafeBox(inner.querySelector('#onbSafe'));
  inner.querySelector('#onbKey').addEventListener('click', () => { ov.remove(); openData('config'); });
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
        await loadGames(); render();   // poblá la biblioteca detrás SIN cerrar: el onboarding sigue
        // No auto-cerramos: el tema / modo seguro / API key viven en esta misma pantalla. El usuario
        // sigue configurando y cierra con "Entrar" (o desde "Configurar el Advisor"). (fix onboarding)
        inner.querySelectorAll('.onb').forEach(x => { x.disabled = true; x.style.opacity = '.45'; x.style.pointerEvents = 'none'; });
        prog.innerHTML = `<div class="onb-key">✅ <b>¡Listo! ${r.updated} juegos cargados.</b> Si querés, configurá el Advisor acá arriba (opcional); cuando estés, entrá.</div>
          <button class="btn primary" id="onbEnter" style="margin-top:12px">Entrar a la Ludoteca →</button>`;
        prog.querySelector('#onbEnter').addEventListener('click', () => ov.remove());
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

/* La config del Advisor (Gemini) vive como el tab "Advisor" del sheet "Perfiles y configuración"
   (ver openData). Ya no hay sheet de config aparte ni botón propio en el header. */
