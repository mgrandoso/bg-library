/* Punto de entrada: arranque, nudges y cableado de la barra superior.
   El navegador sigue los import de aca y carga el resto en el orden correcto. */
import { openAdd } from './add.js';
import { loadAppearance, syncThemeColor } from './appearance.js';
import { checkFreshness, loadConfig, loadGames, loadOwners } from './data.js';
import { maybeOnboard } from './onboarding.js';
import { openData } from './profiles.js';
import { render } from './router.js';
import { applyLockUI, ensureUnlocked, loadSafe, toggleLock } from './safemode.js';
import { BGGV, S } from './state.js';
import { $, $$, api, node, toast } from './util.js';

/* ================= arranque ================= */
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
    syncThemeColor();          // día/noche también cambia el --bg → repintar la barra de estado
  });
  if (localStorage.getItem('theme')) document.documentElement.dataset.theme = localStorage.getItem('theme');
  syncThemeColor();
  $('#btnAdd').addEventListener('click', () => { if (ensureUnlocked()) openAdd(); });
  $('#btnLock').addEventListener('click', toggleLock);
  $('#btnCfg').addEventListener('click', () => openData());   // hub único: perfiles + datos + config
  $('#ownerSel').addEventListener('change', async e => {
    S.owner = +e.target.value; await loadGames(); render();
  });
  // botón "volver arriba": aparece al scrollear >500px; sube suave (html tiene scroll-behavior:smooth)
  const toTop = $('#toTop');
  if (toTop) {
    const sync = () => toTop.classList.toggle('show', window.scrollY > 500);
    window.addEventListener('scroll', sync, { passive: true });
    toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    sync();
  }
  // La barra de estado de la ficha (sticky abajo) necesita separarse del borde cuando la toolbar de
  // Safari está COLAPSADA (ahí sus botones caen en la franja del doble-tap); con la toolbar DESPLEGADA
  // esa separación de más queda como un hueco feo. Detectamos el estado midiendo el alto real del
  // visualViewport (baja al aparecer la toolbar) contra su máximo, y ajustamos --sb-pad.
  const vv = window.visualViewport;
  if (vv) {
    let maxH = 0;
    const setSbPad = () => {
      maxH = Math.max(maxH, vv.height);
      const barUp = (maxH - vv.height) > 24;
      document.documentElement.style.setProperty('--sb-pad', barUp ? '10px' : '40px');
    };
    vv.addEventListener('resize', setSbPad, { passive: true });
    vv.addEventListener('scroll', setSbPad, { passive: true });
    setSbPad();
  }
  applyLockUI();
}

init();
