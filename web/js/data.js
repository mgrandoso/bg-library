/* Carga de datos del backend: perfiles, juegos, config, frescura y enriquecido. */
import { S } from './state.js';
import { $, api, esc, toast } from './util.js';

export async function loadOwners() {
  const d = await api('/owners'); S.owners = d.owners;
  if (!S.owner) S.owner = (S.owners.find(o => o.is_me) || S.owners[0]).id;
  fillOwnerSel();
}
// El selector de perfil muestra solo el nombre; el "(N)" de juegos no aportaba y lo sacamos de todos
// lados. El ancho de la barra se mantiene por min-width en CSS para que no se achique.
export function fillOwnerSel() {
  const sel = $('#ownerSel'); if (!sel) return;
  sel.innerHTML = S.owners.map(o =>
    `<option value="${o.id}">${o.is_me ? '👤 ' : '👥 '}${esc(o.name)}</option>`).join('');
  sel.value = S.owner;
}
export async function loadGames() {
  const d = await api('/games?owner=' + S.owner); S.games = d.games;
}
export async function loadConfig() {
  try { const c = await api('/config'); S.geminiReady = !!c.gemini_key_set; }
  catch { S.geminiReady = false; }
}

/* chequeo no intrusivo de frescura al iniciar */
export async function checkFreshness() {
  try {
    const f = await api('/freshness?owner=' + S.owner);
    if (f.oldest_days != null && f.oldest_days >= 35)
      toast('Tus datos tienen más de un mes · actualizalos en ⇅');
  } catch {}
}

export async function enrichLoop(owner, onProgress) {
  let total = null, done = 0;
  for (let i = 0; i < 200; i++) {
    const r = await api(`/enrich?owner=${owner}&limit=25`);
    if (total === null) total = r.enriched + r.remaining;
    done += r.enriched;
    if (onProgress) onProgress(done, total || done + r.remaining, r.remaining);
    if (r.remaining === 0 || r.enriched === 0) break;
  }
}
