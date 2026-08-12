/* Apariencias (temas) y color de la barra de estado del sistema. */
import { APPEARANCES } from './domain.js';
import { S } from './state.js';
import { $, esc, node } from './util.js';

/* ================= apariencias ================= */
// Tres temas: 'classic' (con día/noche 🌙), 'fresca' y 'calida' (claros, sin 🌙).
// El id se guarda por dispositivo en localStorage, igual que el tema día/noche.
export function loadAppearance() {
  const a = localStorage.getItem('appearance');
  S.appearance = APPEARANCES.includes(a) ? a : 'classic';
  applyAppearance();
}
function applyAppearance() {
  const root = document.documentElement;
  if (S.appearance === 'classic') delete root.dataset.appearance;
  else root.dataset.appearance = S.appearance;
  const tb = $('#btnTheme'); if (tb) tb.style.display = S.appearance === 'classic' ? '' : 'none';
  syncThemeColor();
}
// Tiñe la barra de estado del sistema (y el fondo del cambiador de apps) con el --bg del tema
// activo. Sin esto, agregada a la pantalla de inicio, la Ludoteca en tema Playa mostraba una
// franja oscura arriba que no era de ningún tema. Se lee del CSS para no duplicar los colores acá.
export function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]'); if (!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) meta.setAttribute('content', bg);
}
function setAppearance(a) {
  if (!APPEARANCES.includes(a)) return;
  S.appearance = a; localStorage.setItem('appearance', a); applyAppearance();
}

// Metadatos de cada apariencia para el selector (nombre + descripción + swatches representativos).
const APPEAR_META = {
  classic: { name: 'Clásica', tag: 'Fieltro oscuro · día/noche', sw: ['#14100c', '#e0a458', '#46b6ac', '#e06692'] },
  fresca:  { name: 'Playa',   tag: 'Teal + coral sobre marfil',  sw: ['#f8f5f2', '#078080', '#f45d48', '#0aa1a1'] },
  calida:  { name: 'Taberna', tag: 'Navy + madera sobre crema',  sw: ['#f9f4ef', '#8c7851', '#f25042', '#020826'] },
};
// Grilla de tarjetas de apariencia (reutilizable en Config y en el onboarding).
export function renderAppearanceGrid(container, onPick) {
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
