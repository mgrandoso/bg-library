/* Tarjeta de juego de la grilla + lazy-load y prefetch de portadas. */
import { openDetail } from './detail.js';
import { WEIGHT_LABELS, typeColor, typeEs, weightBucket } from './domain.js';
import { S } from './state.js';
import { esc, node, safeImg } from './util.js';

/* ---------- card ---------- */
function playerFit(g, n) {
  if (!n) return '';
  if ((g.best_players || []).includes(n)) return '<span class="fit-pill fit-ideal">Ideal</span>';
  if ((g.recommended_players || []).includes(n)) return '<span class="fit-pill fit-good">Va bien</span>';
  if ((g.minplayers || 0) <= n && (g.maxplayers || 0) >= n) return '<span class="fit-pill fit-ok">Se banca</span>';
  return '<span class="fit-pill fit-ok" style="opacity:.5">No entra</span>';
}
export function weightbar(w, big) {
  const b = weightBucket(w); const on = b == null ? 0 : b + 1;
  return `<span class="weightbar ${big ? 'big' : ''}" title="Complejidad: ${b == null ? 's/d' : WEIGHT_LABELS[b]}">${[0, 1, 2, 3, 4].map(i => `<span class="seg ${i < on ? 'on' : ''}"></span>`).join('')}</span>`;
}
// Etiqueta de estado sobre la portada. Solo en BGG (en Biblioteca/Wishlist es redundante:
// ahí todo es "tengo" o "quiero"). Chip con fondo sólido para que se lea como algo sobrepuesto.
export function stateBadge(g) {
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
// El margen de precarga se calcula con el alto del viewport, asi que al cruzar un
// breakpoint hay que tirar el observer para que lo recalcule (lo llama responsive.js).
export function resetCoverObserver() {
  if (coverObserver) { coverObserver.disconnect(); coverObserver = null; }
}
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

export function card(g) {
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
