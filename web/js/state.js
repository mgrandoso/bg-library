/* Estado global en memoria: S (todo lo compartido) y BGGV (navegacion del browse de BGG). */
/* ---------- estado ---------- */
export const S = {
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
export const BGGV = { games: [], page: 0, total: 0, hasMore: false, loading: false, owner: 0, sig: null };
