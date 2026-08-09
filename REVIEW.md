# Revisión de calidad — Clean Code / Clean Architecture

Pasada de calidad sobre Ludoteca aplicando principios de Robert C. Martin (Uncle Bob).
No es dogma por el dogma: se aplicó donde suma a una app simple.

## Separación de responsabilidades (SRP / capas)

El backend está separado por responsabilidad, no por conveniencia:

| Módulo | Única razón para cambiar |
|---|---|
| `db.py` | El esquema o el acceso a SQLite |
| `bgg.py` | El contrato de la API de BoardGameGeek (geekdo) |
| `advisor.py` | La lógica de recomendación (scoring + agente) |
| `seed.py` | La carga/import de colecciones |
| `appconfig.py` | La configuración local (key de Gemini, modelo) |
| `app.py` | El transporte HTTP (rutas), delgado: valida y delega |

`app.py` no contiene lógica de negocio: arma la request, llama a la capa correspondiente y
serializa. La lógica de recomendación no sabe nada de HTTP; se testea sin levantar el server.

El frontend separa **modelo** (estado `S`, llamadas `api()`) de **vista** (funciones `render*`),
y cada vista/modal es una función acotada.

## Nombres con intención

- Funciones que dicen qué hacen: `games_for_owner`, `collection_profile`, `score_play`,
  `score_buy`, `set_holding`, `enrichLoop`, `checkFreshness`.
- Nada de `data2`, `tmp`, `flag`. Los helpers cortos (`esc`, `node`, `bars`) tienen doc o son
  autoexplicativos por uso.

## Funciones chicas, una cosa

- El scoring está partido en `score_play` / `score_buy` / `collection_profile`, cada una con una
  responsabilidad. `recommend()` orquesta; `agent_pick()` sólo maneja el LLM y su fallback.
- `_picks_from_scored()` extrae la construcción de resultados que se repetía (DRY).

## Manejo de errores en los bordes

- Toda llamada de red externa (BGG, Gemini, `claude -p`) está envuelta y **degrada con gracia**:
  el agente cae al determinístico; un fetch fallido no rompe la request.
- `api()` en el frontend centraliza el manejo de error y lo muestra por toast.
- El import decodifica con `utf-8-sig` (maneja BOM de Excel) y tolera CSVs sin datos BGG.

## Bugs reales encontrados y corregidos en la revisión

1. **Acentos rotos en el agente (Windows):** `subprocess.run(text=True)` decodifica la salida de
   `claude -p` con cp1252 → mojibake. Fijado con `encoding="utf-8", errors="replace"`.
2. **Barras del panel vacías:** los `<span>` de fill quedaban `display:inline`, así que `width`/
   `height` no aplicaban. Fijado con `display:block`.
3. **Fuga de listeners:** cada modal agregaba un `keydown` global que no se removía al cerrar por
   backdrop/botón. Fijado con un `close()` único + guardas.
4. **Payload pesado:** `/api/games` mandaba la descripción larga de los 720 juegos (~1 MB). Se
   quita del listado y la ficha la pide on-demand (lectura de DB).
5. **Upsert frágil:** al agregar la columna `description`, un `None` rompía el INSERT por
   parámetro faltante. El upsert ahora arma columnas desde las presentes.

## Segunda pasada — performance a escala (catálogo top-5000)

Al pre-cargar el top-5000 de BGG, `games` pasó de ~700 a 5000+ filas. Eso destapó costos que
antes eran invisibles:

| # | Hallazgo | Fix | Impacto |
|---|---|---|---|
| 6 | `games_for_owner` escaneaba **todo el catálogo** (LEFT JOIN desde `games`) y parseaba 9 campos JSON por fila, aunque el consumidor filtrara a los que tenés. Lo pagaban `/api/games`, `/api/stats` y el advisor determinístico en cada request. | Parte de `holdings` (WHERE owner_id) y arma el mapa "quién lo tiene" solo para los ids devueltos. | **9× más rápido** (575 → 63 ms/llamada; 5123 → 707 filas parseadas). |
| 7 | `/api/bgg` ordena/pagina por `rank_overall` (orden por defecto) sobre 5000+ filas sin índice → scan + sort en cada página. | Índice `idx_g_rank ON games(rank_overall)`. | `EXPLAIN` pasa de `SCAN + USE TEMP B-TREE` a `SEARCH USING INDEX`. |
| 8 | Rama muerta: etiqueta de motor `🤖 Claude` en `renderResults`, de cuando existía ese motor (hoy el agente es solo Gemini). | Se elimina la rama; queda Gemini / determinístico. | Menos código muerto que engaña al lector. |

**Filtros de `/api/bgg` sin inyección:** los fragmentos interpolados en el SQL (orden, rangos de
peso, expresión de duración) son **constantes del servidor** elegidas por whitelist (`BGG_SORT`,
`BGG_WEIGHT`); todo lo que viene del usuario viaja como parámetro ligado (`?`). `sort`/`weight`
se usan como clave de diccionario y `dir`/`players` son enteros.

## Duplicación front/back asumida (sin build step)

Hay lógica de dominio espejada en JS y Python que **debe** mantenerse en sync: buckets de
complejidad (`weightBucket` / `weight_bucket` / rangos `BGG_WEIGHT`), `shortlistSize` /
`shortlist_size`, y los labels de complejidad. Es el precio de no tener bundler (SPA vanilla). Se
mitiga con comentarios "espeja el back/front" en cada lado; si algún día se suma build, es lo
primero a unificar en un módulo compartido.

## Migraciones sin romper

`db.init()` corre migraciones idempotentes (`ALTER TABLE ... ADD COLUMN` si falta), así una DB
vieja se actualiza sin recrear.

## Tests (test-first en la lógica pura)

`server/tests.py` (26 casos, sin dependencias): parsing de IDs, buckets de complejidad, scoring
(incluye descarte por nº de jugadores), detección de cooperativos, perfil de colección, limpieza
de HTML, import de CSV, e integración contra la DB seedeada. Corren en < 1s: `python server/tests.py`.

## Qué quedó deliberadamente simple

- SQLite + `sqlite3` plano (sin ORM): el dominio es chico y las queries son claras.
- Filtrado en el cliente **solo de tu colección** (holdings, ~cientos): trivial en memoria y UI
  instantánea. El browse del catálogo completo (5000+) es server-side y paginado (`/api/bgg`).
- Sin framework de front: vanilla JS con helpers mínimos; menos superficie, cero build.

## Qué NO se tocó (y por qué)

- **`app.js` es un archivo grande (~1300 líneas).** Uncle Bob pediría partirlo; sin bundler eso
  significa múltiples `<script>` y orden manual de carga. Está seccionado por comentarios y cada
  vista/modal es una función acotada. Se difiere hasta que haya build.
- **Modales largos (`openData`, `openDetail`).** Son constructores de UI cohesivos (una pantalla
  cada uno); partirlos ahora agrega indirección sin bajar complejidad real.

## Tercera pasada — es_name, refresh por dump enumerado, alta local-first, filtros

Iteración de nombres en español + refresh por ranking + mejoras de alta/filtros. Decisiones de
diseño con impacto en calidad:

| Tema | Decisión | Por qué |
|---|---|---|
| **Rank = fuente única** | `parse_rank_dump` NO guarda el entero crudo del dump: ordena por (rank, bayes desc), **deduplica por id** y guarda la **posición enumerada** 1..N sobre juegos únicos. Se baja de más (~10k filas) y se croppea a `TOP_N` DESPUÉS de limpiar. El seed horneado y el update diario usan el MISMO criterio. | El dump de beefsack es un espejo imperfecto: rank crudo duplicado entre juegos distintos (se desempata por bayes), **~7 filas duplicadas del mismo id** (si no se dedup ANTES de enumerar, cada una consume un puesto y deja un hueco — bug real encontrado y corregido), y ~7 huecos de rank (los disuelve la enumeración). Bajar de más y croppear al final garantiza top-N completo y contiguo. |
| **Datos estáticos vs volátil** | El overlay de enriquecimiento (`bgg_data.json`) se retiró: el seed nuevo es autosuficiente (imagen/desc/mecánicas 5000/5000). | El overlay viejo pisaba los ranks limpios con ranks stale → dups. La única data volátil es rank+rating, y la owna el dump. |
| **Búsqueda de alta** | `bgg.search` ya no arma la URL `camo/…` (siempre daba 404). Hidratación local-first: la base aporta imagen a los que ya están; el resto, placeholder. Sin `<img>` roto (background-image + placeholder). | No inventar URLs de imagen; no mostrar íconos rotos. |
| **Alta sin huérfanos** | `/api/lookup` trae la ficha de un juego no-local SIN persistirlo; recién se guarda (`/api/games/add`) si el usuario marca own/wish. | Si cierra sin marcar, no queda nada en la base (evita huérfanos). |
| **Filtro cooperativo** | Toggle propio, ortogonal a los 8 subdominios (coop es mecánica). SQL con las mismas pistas que `advisor._is_coop`. | Mantener la taxonomía de BGG correcta (subdominio ≠ mecánica). |
| **Fit por jugadores** | Tier de ajuste (`_fit_case` en SQL / `fitTier` en JS) con `n` entero ya tipado (interpolación segura); orden "Mejor para N jug." auto-seleccionado. Pill como overlay flotante. | El pill como fila extra hacía crecer la card al filtrar; el overlay no mueve el layout. |
| **Nudges no-nag** | `sessionStorage` guarda el punto de descarte; el de es_name reaparece al cruzar el próximo tramo (+10), el de antigüedad una vez por sesión. | Sugerir sin molestar. |

**Duplicación front/back (se suma a la lista existente):** `isCoop`/`fitTier` (JS) espejan
`_is_coop`/`_fit_case` (SQL); las tres marcadas con comentario "espeja". Es el mismo precio de no
tener build step.

**Manejo de errores:** las llamadas de red nuevas (`/api/search`, `/api/lookup`, dump) degradan
con 502 + log con contexto (`bgg._get` y `seed` loguean URL + tipo de error); nunca rompen el flujo.

## Cuarta pasada — membresía dinámica del top (el update reconcilia contra el dump)

**Problema que resolvió:** antes la membresía del top-5000 estaba *congelada* a las claves del seed
JSON. El update solo re-rankeaba ese conjunto fijo: los juegos que **entraban** nuevos al top no
aparecían (había que re-hornear + `git pull` o buscarlos a mano) y los que **caían** no se iban.

**Modelo nuevo:** la pertenencia al top es **dinámica** y se deriva de la propia base —
*"está en el top" = `rank_overall <= TOP_N`* (`db.TOP_N`, hoy 5000). El **dump del día es la fuente
de verdad** de quién está y en qué orden. El seed pasa a ser **solo semilla de arranque**.

| Tema | Decisión | Por qué |
|---|---|---|
| **Reconciliación** | `seed.reconcile_top(dump)`: **altas** (entrantes `rank<=TOP_N` que no están → `bgg.fetch` + insert) + **rerank** (reposiciona todo lo presente con el rank enumerado). Las **bajas** las hace el GC después (`gc_run`, keep = `top ∪ tenidos`). | Nadie depende de que se publique un seed nuevo para ver los juegos que entraron/salieron del top. |
| **Fuente de membresía** | Se eliminó `preseed_id_set()` (claves del JSON, cacheado por mtime). Ahora `db.top_ids(conn)` = `rank<=TOP_N`, y `is_top` (antes `is_preseed`) se computa del rank del propio juego. | Desacopla la verdad de la membresía del archivo; el rank vigente (tras el rerank) es la única fuente. |
| **Colección intocable** | Ni la reconciliación ni el GC tocan `holdings`. Un juego que cae del top pero está en own/wishlist **persiste** (queda fuera-del-top con su rank real). Cada instalación tiene su propio conjunto fuera-del-top. | El top a una misma fecha es igual para todos; lo personal es la colección, que persiste a las actualizaciones. |
| **es_name de entrantes** | Los entrantes se insertan con `es_name` NULL y los resuelve **el mismo proceso de siempre**, ahora con scope `es_name IS NULL AND (rank<=TOP_N OR tenido)` — cubre los nuevos del top y tu colección, sin re-trabajar los 5000 ya horneados. | Determinístico: data por API al entrar, nombre en español después, por diff. |
| **Costo acotado + re-hornear opcional** | ~300 juegos/año entran al top-5000 → un update normal trae un puñado. Un install muy viejo podría traer cientos en el primer update (best-effort: un fetch que falla se loguea y se reintenta, no voltea la corrida). Subir cada tanto una **base horneada nueva** al git achica ese primer update. | El re-horneado deja de ser requisito de correctitud y pasa a ser optimización. |

**Verificado:** tests unitarios aislados (`tests.py`: alta de entrante con rank enumerado, baja del
caído no-tenido, colección preservada) + simulación end-to-end (top_n=100, base 110→112: entran 5,
caen 5 con 2 tenidos que persisten, reorden, jump-in 120→80, cadena es_name) — 16/16 checks.

### Principio para cambios de fondo en la base (evolución de esquema/datos)

Cuando se agregue **un dato nuevo que el front consuma** (una columna/campo nuevo), tener en cuenta:

- **El top canónico es la referencia completa.** Ese dato llega íntegro para los del top vía la base
  horneada (re-bake) y/o la reconciliación; los 5000 son la porción confiable y homogénea.
- **La colección fuera del top puede quedar con faltantes de ese dato**, porque esos juegos se
  trajeron ad-hoc (alta manual / caídos del top) y quizás con un fetch previo al campo nuevo. El
  front debe tolerar el faltante (fallback/placeholder), y el dato se completa **por diff** en las
  actualizaciones. Nunca asumir que un juego de colección tiene el campo nuevo.

## Quinta pasada — cola >10k por id + expansiones (2026-08-08)

| Tema | Decisión | Por qué |
|---|---|---|
| **Pase profundo retirado** | Se eliminó el dump completo (~31k) que corría cada ~180 días. `update_ranks` ahora, tras reconciliar, corre `refresh_tail()`: pide por id (`bgg.fetch`) el rank+rating de los **tenidos con rank>10.000** (COALESCE, no borra ante un miss); los sin rank se saltean. | Bajar 31k filas para reposicionar 5-10 juegos (o 0) era desproporcionado. El rank de la cola larga se mueve lento; unas pocas llamadas por id alcanzan. |
| **Guard de expansiones** | `bgg.fetch` expone `is_expansion` (`subtype=='boardgameexpansion'` o `expandsboardgame` no vacío) + `expands` (madre). `/api/games/add` rechaza expansiones (400); `/api/lookup` abre la ficha de expansión. Import: excluidas por el link de export de BGG (`excludesubtype`). | Una expansión nunca debe entrar a `games` (contaminaría listas/stats/advisor). El guard es en el punto de alta, no en cada consulta. |
| **Expansiones = tabla aparte** | `expansions(owner_id, base_oid, exp_oid, name, state, short_description, updated_at)`. Name + estado 📦/⭐ + short desc (para el futuro advisor), **sin prioridad**. Alta solo si el base está en own/wish; al desmarcar el base se borran sus expas. | Por construcción no tocan `games`/`holdings` → cero riesgo de fuga a listas/rank/GC. Modelo mínimo: solo lo que sirve. |
| **Búsqueda por expansión (solo Biblioteca)** | `/api/games` incluye `expansions` por juego; el buscador de Biblioteca matchea expas `📦` y surface-ea la carta madre. La Wishlist no busca por expansión. | Coherencia: no meter en la wishlist un juego que tenés. Decisión de Manuel tras descartar el caso cruzado. |

**Verificado:** `tests.py` 134/134 (refresh_tail toca solo la cola tenida + COALESCE; guard de add;
gate/upsert/short-desc de expansiones) + QA en navegador (sección + panel ＋ con oficiales de BGG,
chip en la ficha, búsqueda por expansión, ficha rotulada "Expansión de Catan" con alta a la madre).

## Sexta pasada — apariencias, modo seguro, advisor con expansiones (2026-08-09)

| Tema | Decisión | Por qué |
|---|---|---|
| **Apariencias (3 temas)** | `data-appearance` en `<html>` (además del `data-theme` día/noche). *Clásica* (con 🌙), *Playa* (Happy Hues 8: teal+coral/marfil) y *Taberna* (Happy Hues 11: navy+madera/crema), ambas **claras** (ocultan 🌙). Se elige en Config y en el onboarding; persiste en `localStorage` por dispositivo. Los bloques CSS van DESPUÉS de los temas clásicos (misma especificidad, gana el orden) y sólo redefinen lo que cambia (los `--m-*` de tipo se heredan). | Faithful a paletas pensadas como claras; no forzar un modo oscuro que las desvirtúe. Orthogonal a la lógica de datos: es puro CSS + un atributo. |
| **Modo seguro** | Candado en el header (SVG line-style) que bloquea la escritura (agregar, estado own/wish/none, expansiones, perfiles, import/reconcile). `on`/`pin` en `localStorage`; el candado (`unlocked`) vive **solo en memoria** → arranca cerrado en cada carga/F5. Gate único `ensureUnlocked()` en cada handler de escritura + `stateControls`/`✎` se ocultan bloqueados. PIN opcional (freno anti-toques, no seguridad real). | Un chico puede navegar/filtrar/usar el advisor sin tocar la colección. El estado en memoria cumple "cerrado tras F5/reabrir" sin persistir el desbloqueo. |
| **Advisor play con expansiones** | `db.owned_expansions_for(owner)` → `{base_oid:[{name,short_description}]}` (solo `state='own'`). `recommend()` (modo play) las adjunta a cada juego; `_build_prompt` agrega "EXPANSIONES QUE POSEE" e instruye al agente a sugerir usarla (y por qué) o dejarla (grupo nuevo, poco tiempo). El modo **buy no** las considera (decisión del usuario). | Darle al agente el contexto de lo que el usuario realmente tiene para enriquecer la recomendación. `short_description` alcanza por ahora. |
| **Wishlist: orden por defecto** | El orden por defecto pasó a *Ranking BGG*; *Prioridad* queda segundo (elegible). | El usuario switcheaba siempre a rank; que sea el default. |
| **Hub Config: alto fijo** | `.sheet.data-hub` con `height: min(92vh, 768px)` (= la pestaña más alta, Configurar) y scroll-to-top al cambiar de tab. | La barra de tabs no salta al cambiar de pestaña. |

**Nota (deuda menor):** la confirmación al sacar a "Ninguno" usa `is_top` (rank≤TOP_N) como proxy de
"se borra de la base". Para datos anómalos (una expansión vieja cargada como juego, con rank en el
top) el proxy falla: no avisa aunque el backend la borre. El guard de altas ya evita generar ese
dato; si molesta, cambiar el proxy por "¿está en el preseed?".

**Verificado:** `tests.py` 143/143 (owned_expansions_for solo `own`+short_desc; prompt play incluye
expansiones e instrucción, buy no) + QA en navegador (3 apariencias con el liquid-glass de la topbar,
modo seguro bloqueando la ficha y ocultando el ✎, onboarding con temas + candado, hub con alto fijo).

**Ajustes posteriores (mismo día):** ficha del Advisor de **solo lectura** (`openDetail(g,{readonly})`:
sin estados own/wish/ninguno, sin ✎, sin navegar por diseñador — es solo para ver detalle; el link a
BGG abre pestaña nueva); "Ver ficha" al fondo de la columna del cover (full width, centrado); label del
vibe pesado "para pensar en serio" (era un argentinismo). **Recomendaciones guardadas** (opt-in): tabla
`saved_recs(owner_id, created_at, title, mode, engine, payload)` con el **snapshot** del resultado
(sobrevive cambios de la colección); endpoints `GET/POST /api/saved` + `GET/DELETE /api/saved/{id}`;
front con botón 💾 Guardar en las acciones + entrada "💾 Guardadas (N)" en Advisor (lista con re-ver y
eliminar; reusa el camino de "reanudar" `ADV.result → renderResults`, `_saved` evita re-ofrecer guardar).
`tests.py` **148/148**.
