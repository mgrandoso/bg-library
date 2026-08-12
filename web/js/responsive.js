/* Breakpoints: que layout corresponde segun el ancho. Solo por ancho, sin orientation. */
import { resetCoverObserver } from './card.js';
import { render } from './router.js';

/* ===== responsive: el "layout general" (nav solo-iconos + barra de filtros agrupada en
   desplegables Tipo/Filtros/Mecánicas) se usa en celular Y en tablet vertical. En tablet horizontal
   y desktop se mantiene inline como siempre. La ficha y el Advisor NO cambian en tablet: siguen
   como PC (2 columnas, descripciones sin colapsar) → esos siguen atados a isMobile(). Al cruzar
   cualquier breakpoint (rotar/redimensionar) repintamos para reconstruir la barra que corresponde.
   - isMobile()  = solo celular (≤640): ficha apilada, "(N)" del perfil oculto, Advisor "ver más".
   - isCompact() = celular O tablet vertical: layout general compacto (nav iconos + filtros acordeón). */
/* Los breakpoints son SOLO por ancho, sin `orientation`. Antes isCompact() exigía portrait entre
   641 y 1024, así que una ventana ANCHA Y BAJA (achicar el navegador en PC, que siempre queda
   landscape) caía en una zona muerta 641–1024 donde no matcheaba ninguna query y volvía a PC:
   la secuencia al achicar era PC → tablet → PC otra vez → celular. Además el corte estaba en el
   lugar equivocado: los filtros ya envolvían en dos filas desde ~1100 pero recién colapsaban en
   940. Medido en WebKit: la línea 1 (buscador + 5 selects + orden) entra hasta 1120px y envuelve
   en 1100 → ese es el corte. Ahora es monotónico: cada vez que achicás, el layout solo puede
   simplificarse, nunca volver atrás. */
const mqMobile = window.matchMedia('(max-width: 640px)');
export function isMobile() { return mqMobile.matches; }
// ≤1119: la línea 1 ya no entra → los filtros se agrupan en desplegables (Filtros/Tipo/Mecánicas).
// Cubre celular, tablet vertical Y la ventana de PC angosta (que antes quedaba en la zona muerta).
const mqCompact = window.matchMedia('(max-width: 1119px)');
export function isCompact() { return mqCompact.matches; }
// 1120–1366: la línea 1 entra inline como PC, pero los 8 chips de tipo + Mecánicas apilarían
// varias filas → esa línea 2 pasa a DOS botones colapsables. Es el caso del iPad horizontal y
// también el de una ventana de PC mediana.
const mqTabLand = window.matchMedia('(min-width: 1120px) and (max-width: 1366px)');
export function isTabletLandscape() { return mqTabLand.matches; }
// palabras del resumen de ficha antes del "ver más", por dispositivo: celular 60, tablet (vertical y
// horizontal) 70, PC 80. isCompact() incluye celular → chequear isMobile() primero.
export function descLimit() {
  if (isMobile()) return 60;
  if (isCompact() || isTabletLandscape()) return 70;   // tablet vertical (isCompact sin celular) u horizontal
  return 80;                                            // PC
}
function onBreakpointChange() {
  resetCoverObserver();   // recalcula el margen de precarga (2× viewport)
  render();
}
mqMobile.addEventListener('change', onBreakpointChange);
mqCompact.addEventListener('change', onBreakpointChange);   // rotar tablet vertical↔horizontal reconstruye la barra
mqTabLand.addEventListener('change', onBreakpointChange);   // cruzar 1024px en horizontal (tablet↔desktop) reconstruye la barra
