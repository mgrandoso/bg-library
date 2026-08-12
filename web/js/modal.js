/* Dialogos in-app: overlay generico + confirmar / pedir PIN / pedir nombre.
   No usamos los nativos (confirm/prompt): en webviews vienen suprimidos. */
import { $, esc, node, toast } from './util.js';

export function overlay(inner, cls = '') {
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
export function askConfirm(message, { ok = 'Sí, sacar', cancel = 'Cancelar' } = {}) {
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

// Prompt de PIN in-app (no usamos window.prompt: en webviews suele venir suprimido). Resuelve el
// PIN escrito, o null si cancela. `expect` opcional: si se pasa, exige coincidencia antes de resolver.
export function askPin(title, msg, { confirm = false } = {}) {
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

// Prompt de nombre in-app (para guardar/renombrar). Prefill editable; Enter = aceptar. Devuelve el
// nombre escrito, o null si cancela.
export function askName(title, defaultValue) {
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
