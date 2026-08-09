# Changelog

Novedades notables de Ludoteca. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/); versionado semántico
(**0.x**: pre-1.0, el esquema de la DB y la API pueden cambiar entre versiones *minor*).

Las notas de **calidad y arquitectura** (metodología Clean Code, hallazgos, performance)
viven aparte, en [`REVIEW.md`](REVIEW.md).

## [Unreleased]

## [0.7.0] — 2026-08-09 — Self-hosting con Docker
### Added
- **Docker**: `Dockerfile` + `docker-compose.yml` con volumen `ludoteca_data` (la DB `bg.db` y
  `config.json` sobreviven a los redeploys). Rutas configurables por entorno `BG_DB_PATH` /
  `BG_CONFIG_PATH`, con fallback a las de siempre → correr local con `uvicorn` no cambia.
- Sección **"Deploy con Docker"** en el README (seedeo automático del top-5000 en el primer boot).
### Security
- La app **no tiene autenticación** (el *modo seguro* es un freno anti-toques del lado del cliente).
  Documentado: exponer solo en LAN de confianza o detrás de un reverse proxy con auth; tip de bind a
  `127.0.0.1` para uso en una sola máquina.
### Removed
- `PENDING.md` (notas internas del proyecto) sale del repo y queda gitignoreado.

## [0.6.0] — 2026-08-09 — Recomendaciones guardadas + presentación
### Added
- **Recomendaciones guardadas** (opt-in): guardás una recomendación con nombre y queda en
  *Advisor → Guardadas* para re-verla, renombrar o eliminar. Se guarda el **snapshot** del resultado
  (sobrevive cambios de la colección), por perfil. Endpoints `GET/POST/PATCH/DELETE /api/saved`.
### Changed
- Ficha abierta desde el Advisor: **solo lectura** (sin estados own/wish/ninguno, sin editar
  expansiones, sin navegar por diseñador; el link a BGG abre pestaña nueva). "Ver ficha" al fondo del
  cover, a lo ancho.
- **README rediseñado**: hero con badges del stack, galería 2×2 con desplegable "ampliar", y
  **capturas nuevas** en tema *Playa* a resolución de notebook — reproducibles con `build/shots.py`.
- Copy del vibe pesado: "para pensar en serio".

## [0.5.0] — 2026-08-09 — Apariencias + Modo seguro
### Added
- **Apariencias**: 3 temas elegibles (en Config y onboarding), persistidos por dispositivo — *Clásica*
  (oscuro, con día/noche), *Playa* (teal+coral) y *Taberna* (navy+madera).
- **Modo seguro**: candado en la barra que bloquea la escritura (agregar, estados, expansiones,
  perfiles, import/reconcile); PIN opcional; arranca cerrado en cada carga.
- **Advisor (play) con expansiones**: al agente se le pasan las expansiones que poseés (nombre +
  short desc) para sugerir usarlas —o no, p. ej. con jugadores nuevos—. El modo compra no las usa.
### Changed
- Wishlist: orden por defecto pasa a **Ranking BGG**. Hub de configuración con alto fijo (no salta al
  cambiar de pestaña).

## [0.4.0] — 2026-08-08 — Cola larga + Expansiones
### Added
- **Expansiones**: tabla aparte (`owner, base, exp, name, state 📦/⭐, short_description`); alta solo
  si el juego base está en own/wish; sección + panel "＋" en la ficha del madre; búsqueda por
  expansión en la Biblioteca (surface-ea la carta madre).
- **Guard de expansiones**: `bgg.fetch` expone `is_expansion`/`expands`; `/api/games/add` rechaza
  altas de expansión y el import las excluye aguas arriba (link de export de BGG).
### Changed
- Se retiró el **pase profundo** (dump completo ~31k). `update_ranks` corre `refresh_tail()`: pone al
  día por id (`bgg.fetch`) el rank de los juegos tenidos con `rank > 10.000`.

## [0.3.0] — 2026-08-07 — Ciclo de vida de los datos
### Added
- **Membresía dinámica del top**: "está en el top" = `rank_overall ≤ TOP_N`; el update reconcilia
  contra el dump del día (altas + rerank; bajas por GC, que respeta la colección). El seed pasa a ser
  solo semilla de arranque.
- **Nombres en español** (`es_name`) resueltos por diff (solo top y colección, sin re-trabajar).
- **Alta local-first**: `/api/lookup` abre la ficha sin persistir; se guarda solo al marcar own/wish
  (sin huérfanos).
- **Filtro cooperativo** (ortogonal a los subdominios) y **fit por jugadores** (tier, con orden
  "Mejor para N jug."); **nudges** no-nag.
### Changed
- Refresh por **dump enumerado**: ordena por (rank, bayes), **deduplica por id** y re-enumera 1..N →
  top contiguo, sin repetidos ni huecos. Se retiró el overlay `bgg_data.json` (el seed es
  autosuficiente).
- `bgg.search` deja de inventar URLs `camo/…` (siempre 404); hidratación local-first con placeholder.

## [0.2.0] — 2026-08-07 — Catálogo BGG navegable
### Added
- Vista **BGG**: top-5000 pre-seedeado, navegación paginada con scroll infinito, mismos filtros/orden
  que la Biblioteca, con tus juegos marcados 📦/⭐ y alta directa.
### Performance
- `games_for_owner` parte de `holdings` (deja de escanear todo el catálogo) → **~9× más rápido**
  (575 → 63 ms). Índice `idx_g_rank` para el orden por defecto de `/api/bgg`.

## [0.1.0] — 2026-08-07 — Primera versión
### Added
- **Biblioteca y Wishlist** con portadas, barra de complejidad, jugadores (badge *ideal / va bien*),
  duración y tipo; filtros (tipo, jugadores, duración, complejidad, diseñador), buscador y orden.
- **Ficha completa**: edad editorial vs. comunidad, nº de jugadores con 👑, dependencia del idioma,
  diseñadores clickeables, categorías, mecánicas y descripción (on-demand).
- **Advisor**: modos *¿Qué saco hoy?* y *¿Qué compro?*, motores **determinístico** y **agente**
  (Gemini), con chip de ocasión y desplegable de los 20 candidatos del determinístico.
- **Panel** de estadísticas; **Perfiles** (colecciones de amigos); **import/export** (CSV de BGG y
  backup propio). Licencia MIT.
