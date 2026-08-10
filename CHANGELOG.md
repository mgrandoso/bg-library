# Changelog

Novedades notables de Ludoteca. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/); versionado semántico
(**0.x**: pre-1.0, el esquema de la DB y la API pueden cambiar entre versiones *minor*).

Las notas de **calidad y arquitectura** (metodología Clean Code, hallazgos, performance)
viven aparte, en [`REVIEW.md`](REVIEW.md).

## [Unreleased]

## [0.11.1] — 2026-08-10 — Scroll por vista + prefetch de portadas
### Fixed
- Al cambiar de tab (Biblioteca/Wishlist/BGG) el **scroll ya no se comparte**: cada vista arranca
  arriba, con reset **instantáneo** (sin la animación del `scroll-behavior:smooth`). Los filtros se
  siguen compartiendo; el scroll no. (Era un comportamiento viejo del SPA que quedó visible al
  compartir filtros en 0.9.0.)
### Performance
- **Prefetch de portadas en segundo plano**: tras el paint inicial (solo lo visible), en tiempo
  ocioso (`requestIdleCallback`) se calienta el caché del resto de las portadas → al scrollear ya
  están descargadas y no hay *pop-in*. Mantiene el arranque rápido del lazy-load de 0.11.0.

## [0.11.0] — 2026-08-10 — Advisor: fix de recomendación + trazabilidad LLM + portadas lazy
### Fixed
- **Recomendación con pitch de otro juego** (modo agente): el modelo a veces desalineaba el pitch
  con el `objectid` equivocado (p. ej. la descripción de *6 nimmt!/Take Five* pegada a *Scotland
  Yard*). Ahora al candidato se lo referencia por un **índice corto `#N`** en vez del objectid de
  BGG (copiar un número chico es mucho menos propenso a error), el modelo devuelve también el
  `name`, y si no coincide con el juego del `#N` pero sí con otro candidato, **se reasigna el pitch
  al juego correcto** (con match exacto que gana a contención, para no confundir *Skull* con *Skull
  King*). Solo si no se puede ubicar, cae al pitch determinístico.
### Added
- **Trazabilidad del LLM**: cada llamada al agente registra una línea JSON en `advisor_trace.jsonl`
  (prompt, respuesta cruda, candidatos, picks del modelo vs. finales, *warnings* y tiempos) — para
  diagnosticar con el dato, no suponiendo. Retención por antigüedad + cantidad (30 días / 100 por
  defecto), podada en cada escritura; apagable/ajustable por entorno (`BG_ADVISOR_TRACE*`,
  `BG_TRACE_PATH`) y con script de limpieza `server/prune_traces.py` para cron/Docker.
### Performance
- **Portadas lazy** en Biblioteca/Wishlist/BGG (todas las plataformas): las imágenes se bajan de la
  CDN de BGG recién al acercarse al viewport, con **preload deslizante proporcional a lo visible**
  (margen = 2× la altura de pantalla → quedan cargados el bloque visible + los ~2 siguientes, ≈3×;
  al scrollear entra el siguiente y así). Antes se disparaban ~150 imágenes externas de golpe al
  entrar a una vista. En celular la vista se asienta mucho más rápido y baja el uso de red; sin
  cambios de layout (el box de la portada ya tenía tamaño fijo) ni de aspecto en desktop.

## [0.10.1] — 2026-08-10 — Topbar celular más compacto
### Changed
- En celular la barra superior pasa de **3 filas a 2**: se oculta el texto "Ludoteca" y el
  subtítulo → queda solo el **logo del dado** a la izquierda, con el perfil/＋/⚙ alineados a la
  derecha. Gana altura útil para el contenido. En desktop no cambia.
- El **selector de perfil** en celular ya no muestra el "(N)" de juegos (queda "👤 Vos"); mantiene
  el ancho para que la barra no se achique. En desktop sigue mostrando el conteo.

## [0.10.0] — 2026-08-10 — Vista celular (responsive)
Rediseño de la experiencia en teléfono (probado a mano sobre iPhone 15 Pro). Todo **front-end**:
el desktop no cambia y no hay carga extra en el server.
### Added
- **Nav a solo-iconos** en celular (📖 Biblioteca · ⭐ Wishlist · 🏆 BGG · 📊 Panel · ✨ Advisor),
  repartidos a lo ancho para tap cómodo; entran las 5 sin cortar. En desktop sigue con texto.
- **Filtros colapsables** en tres grupos (**🎛 Filtros / 🏷 Tipo / 🛠 Mecánicas**) con el buscador
  siempre visible. Acordeón (uno abierto a la vez), badge "(N)" de activos, flechita ▾ que rota al
  abrir y se oculta cuando hay filtro activo (así el ancho no desborda). Libera la primera pantalla
  para ver los juegos.
- **"Ver más / ver menos"** en el pitch de las recomendaciones del Advisor (mismo patrón que la
  descripción de las fichas), para que la lista no se haga interminable.
### Changed
- **Ficha reordenada en celular**: portada centrada → título → año/ranking → tipo → descripción →
  specs → jugadores → idioma → diseño → categorías → mecánicas → expansiones → dueños → BGG.
  Espaciado parejo. Técnica: `display:contents` + `order` (una sola construcción, desktop intacto).
- **Botón de cerrar (✕) sticky** con efecto *glass* (semitransparente + blur): sigue visible al
  scrollear la ficha, no hay que volver arriba. Aplica también en desktop.
- **Barra de estado** de la ficha compacta y con solo iconos (📦/⭐/✕) en celular.
- **Advisor**: las dos tarjetas de modo (*¿Qué saco hoy?* / *¿Qué compro?*) en un solo renglón,
  como en PC.
- **Tabs de Configuración** a solo-iconos en celular (los 5 no entraban con texto).
- **Inputs de texto** (buscador y campo libre del Agente) con fondo blanco y más altos; `16px` para
  evitar el zoom automático de iOS al enfocar.
- **Toast** de acciones centrado y con ancho acotado.
- Se sacó "con Gemini" del texto del motor Agente (queda "Razona sobre N candidatos…").
### Fixed
- Separaciones parejas en la Biblioteca móvil (nav→filtros, filtros→grilla y entre tarjetas al
  mismo ritmo).

## [0.9.1] — 2026-08-10 — Contador de visibles al cambiar de vista
### Fixed
- El **contador de juegos visibles** solo aparecía en la vista donde tocabas el filtro; al cambiar
  de tab (con el filtro ya compartido activo) filtraba bien pero no mostraba el número. Ahora se
  pinta también al entrar a la vista, no solo al modificar un filtro.

## [0.9.0] — 2026-08-10 — Filtros compartidos + filtro por diseñador en BGG
### Added
- **Filtro por diseñador en BGG** (server-side): no hay combo —serían ~2.800 opciones en el
  top-5000— sino que se activa **clickeando un diseñador en cualquier ficha**. Aparece como chip
  removible en la barra. Match por nombre entrecomillado sobre el JSON `designers` (sin falsos
  positivos por substring).
### Changed
- **Un solo estado de filtros y orden** para Biblioteca, Wishlist y BGG (`S.filters`): lo que
  aplicás en una vista **se mantiene en las tres** hasta que toques *Limpiar filtros*. El click en
  un diseñador ahora **respeta la vista actual** (desde una ficha de BGG filtra BGG; desde tu
  colección/wishlist, esas) en lugar de saltar siempre a la Biblioteca.
- **Orden normalizado y consistente** entre vistas: *Prioridad* queda exclusivo de Wishlist (si
  cambiás de tab con ese orden, cae a *Ranking BGG*); se agregó *Duración* a Wishlist. El resto de
  los criterios comparten semántica en cliente y servidor.

## [0.8.1] — 2026-08-09 — Ajuste responsive (iPad)
### Fixed
- En **Biblioteca/Wishlist sobre iPad**, el combo **Diseñador** se ensanchaba con su opción más larga
  y empujaba la flecha de orden a una segunda línea. Se le acota el ancho solo en tablet (≤1200px);
  en desktop queda igual. BGG no se ve afectado (no tiene filtro de diseñador).

## [0.8.0] — 2026-08-09 — Import más inteligente + fix de onboarding
### Changed
- El **import por CSV** ahora absorbe las expansiones coladas igual que el alta a mano: en el pase
  de enriquecimiento (que ya fetchea cada juego nuevo, **sin costo de red extra**) detecta la
  expansión y la **cuelga del juego base** si lo tenés/deseás —con su estado own/wish—, o la
  **descarta** si no tenés el base. Ya no entran como juegos sueltos que ensucian listas/stats/advisor.
### Fixed
- **Onboarding**: subir el CSV ya no cierra el asistente. Al terminar muestra el éxito, deshabilita
  los botones de "cómo empezar" y ofrece un botón **"Entrar a la Ludoteca"**, así podés seguir
  configurando el Advisor (API key) y el modo seguro antes de entrar.

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
