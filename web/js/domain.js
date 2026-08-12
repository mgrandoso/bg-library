/* Constantes de dominio: subdominios de BGG, complejidad, idioma, mecanicas curadas.
   Datos puros, sin DOM ni estado. */
/* ---------- constantes de dominio ---------- */
export const SUBDOMAIN = {
  'Strategy Games': ['Estrategia', 'var(--m-strategy)'],
  'Family Games': ['Familiar', 'var(--m-family)'],
  'Party Games': ['Fiesta', 'var(--m-party)'],
  'Thematic Games': ['Temático', 'var(--m-thematic)'],
  'Wargames': ['Wargame', 'var(--m-war)'],
  'Abstract Games': ['Abstracto', 'var(--m-abstract)'],
  'Customizable Games': ['Coleccionable', 'var(--m-custom)'],
  "Children's Games": ['Infantil', 'var(--m-children)'],
};
export const WEIGHT_LABELS = ['Liviana', 'Media-liviana', 'Media', 'Media-pesada', 'Pesada'];
export function weightBucket(w) {
  if (!w) return null;
  if (w < 1.5) return 0; if (w < 2.1) return 1; if (w < 2.7) return 2; if (w < 3.4) return 3; return 4;
}
export const LANG = {
  'No necessary in-game text': 'Nula — se juega sin leer',
  'Some necessary text - easily memorized or small crib sheet': 'Baja',
  'Moderate in-game text - needs crib sheet or paste ups': 'Media',
  'Extensive use of text - massive conversion needed to be playable': 'Alta',
  'Unplayable in another language': 'Total — injugable en otro idioma',
};
export const typeEs = (s) => (SUBDOMAIN[s] ? SUBDOMAIN[s][0] : s);
export const typeColor = (s) => (SUBDOMAIN[s] ? SUBDOMAIN[s][1] : 'var(--brass)');
// apariencias disponibles (ids de tema); usado desde init(), por eso vive arriba
export const APPEARANCES = ['classic', 'fresca', 'calida'];
// candado SVG (line-style, a tono con el resto de los íconos del header): cerrado / abierto.
// Viven arriba porque applyLockUI() los usa desde bindTop() (temprano en init) → evita TDZ.
export const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
export const UNLOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';

// Grupo "Mecánicas" (ítem 9): set CURADO por intención de filtrado (no por frecuencia). Cada
// entrada: [string canónico de BGG, etiqueta ES]. Se combinan OR entre sí y AND con el resto.
export const MECHANICS = [
  ['Cooperative Game', '🤝 Cooperativo'],
  ['Solo / Solitaire Game', '🧍 Solo'],
  ['Scenario / Mission / Campaign Game', '📜 Campaña'],
  ['Team-Based Game', '👥 Por equipos'],
  ['Deck, Bag, and Pool Building', '🃏 Deck/Bag building'],
  ['Worker Placement', '👷 Worker placement'],
  ['Push Your Luck', '🎲 Push your luck'],
  ['Take That', '😈 Take That'],
];
