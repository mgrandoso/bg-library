/* Modo seguro: candado anti-toques con PIN opcional. */
import { LOCK_SVG, UNLOCK_SVG } from './domain.js';
import { askPin } from './modal.js';
import { render } from './router.js';
import { S } from './state.js';
import { $, node, toast } from './util.js';

/* ================= modo seguro ================= */
// Escudo anti-toques: con el candado cerrado, las acciones de escritura quedan bloqueadas.
// `on`/`pin` persisten; el candado (unlocked) arranca SIEMPRE cerrado.
export function loadSafe() {
  try {
    const raw = JSON.parse(localStorage.getItem('safe') || '{}');
    S.safe.on = !!raw.on; S.safe.pin = typeof raw.pin === 'string' ? raw.pin : '';
  } catch { S.safe.on = false; S.safe.pin = ''; }
  S.safe.unlocked = false;
}
function saveSafe() { localStorage.setItem('safe', JSON.stringify({ on: S.safe.on, pin: S.safe.pin })); }
// true si hay que bloquear la escritura (modo activo y candado cerrado)
export function mutationsLocked() { return S.safe.on && !S.safe.unlocked; }
// gate para handlers de escritura: si está bloqueado avisa y devuelve false
export function ensureUnlocked() {
  if (!mutationsLocked()) return true;
  toast('🔒 Modo seguro activo — tocá el candado para poder editar');
  return false;
}
// refleja el estado del candado en el header y (des)habilita el botón de agregar
export function applyLockUI() {
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
export async function toggleLock() {
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

// Panel de modo seguro (en Config): switch de activación + gestión de PIN. Activar/desactivar y
// cambiar PIN respetan la regla: con PIN puesto, cada una de esas acciones lo pide.
export function renderSafeBox(container) {
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
