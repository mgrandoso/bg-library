/* Helpers base: selectores, escape, fetch a /api, toast y recorte de texto.
   No importa nada: es la hoja del grafo de modulos. */
/* ---------- helpers ---------- */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeImg = (u) => (typeof u === 'string' && /^https:\/\//.test(u)) ? u : '';
export function node(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export async function api(path, opts) {
  const r = await fetch('/api' + path, opts);
  if (!r.ok) { let e; try { e = (await r.json()).error; } catch {} throw new Error(e || r.status); }
  return r.status === 204 ? null : r.json();
}
let toastT;
export function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

export function _words(t, n) { const w = (t || '').split(/\s+/); return w.length <= n ? t : w.slice(0, n).join(' ') + '…'; }
// clamp genérico con "ver más"/"ver menos" para un texto ya presente (reusa _words y el estilo
// .vermas de las fichas). Si el texto es corto, lo muestra entero sin botón.
export function clampText(box, text, limit) {
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
