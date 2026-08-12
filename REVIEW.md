# Revisión de calidad — Clean Code / Clean Architecture

Pasada de calidad sobre Ludoteca aplicando principios de Robert C. Martin (Uncle Bob).
No es dogma por el dogma: se aplicó donde suma a una app simple.

> Este documento es sobre **metodología y hallazgos de calidad** (estable). El registro de
> **qué se entregó en cada iteración** vive en [`CHANGELOG.md`](CHANGELOG.md).

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
  el agente cae al determinístico; un fetch fallido no rompe la request. Las rutas nuevas
  (`/api/search`, `/api/lookup`, dump) devuelven `502` + log con contexto (`bgg._get`, `seed`
  loguean URL + tipo de error); nunca voltean el flujo.
- `api()` en el frontend centraliza el manejo de error y lo muestra por toast.
- El import decodifica con `utf-8-sig` (maneja BOM de Excel) y tolera CSVs sin datos BGG.

## Bugs reales encontrados y corregidos en la revisión

1. **Acentos rotos en el agente (Windows):** `subprocess.run(text=True)` decodifica la salida de
   `claude -p` con cp1252 → mojibake. Fijado con `encoding="utf-8", errors="replace"`.
2. **Barras del panel vacías:** los `<span>` de fill quedaban `display:inline`, así que `width`/
   `height` no aplicaban. Fijado con `display:block`.
3. **Fuga de listeners:** cada modal agregaba un `keydown` global que no se removía al cerrar por
   backdrop/botón. Fijado con un `close()` único + guardas.
4. **Payload pesado:** `/api/games` mandaba la descripción larga de todos los juegos (~1 MB). Se
   quita del listado y la ficha la pide on-demand (lectura de DB).
5. **Upsert frágil:** al agregar la columna `description`, un `None` rompía el INSERT por
   parámetro faltante. El upsert ahora arma columnas desde las presentes.
6. **Puesto consumido por duplicados del dump:** el dump de ranking trae ~7 filas duplicadas del
   mismo id; si no se **deduplica antes de enumerar**, cada duplicado consume un puesto y deja un
   hueco en el top. Fijado deduplicando por id y re-enumerando 1..N sobre juegos únicos.

## Performance a escala (catálogo top-5000)

Al pre-cargar el top-5000 de BGG, `games` pasó de ~700 a 5000+ filas. Eso destapó costos que
antes eran invisibles:

| # | Hallazgo | Fix | Impacto |
|---|---|---|---|
| 1 | `games_for_owner` escaneaba **todo el catálogo** (LEFT JOIN desde `games`) y parseaba 9 campos JSON por fila, aunque el consumidor filtrara a los que tenés. Lo pagaban `/api/games`, `/api/stats` y el advisor determinístico en cada request. | Parte de `holdings` (WHERE owner_id) y arma el mapa "quién lo tiene" solo para los ids devueltos. | **9× más rápido** (575 → 63 ms/llamada; 5123 → 707 filas parseadas). |
| 2 | `/api/bgg` ordena/pagina por `rank_overall` sobre 5000+ filas sin índice → scan + sort en cada página. | Índice `idx_g_rank ON games(rank_overall)`. | `EXPLAIN` pasa de `SCAN + USE TEMP B-TREE` a `SEARCH USING INDEX`. |
| 3 | Rama muerta: etiqueta de motor `🤖 Claude` en `renderResults`, de cuando existía ese motor (hoy el agente es solo Gemini). | Se elimina la rama. | Menos código muerto que engaña al lector. |

**Filtros de `/api/bgg` sin inyección:** los fragmentos interpolados en el SQL (orden, rangos de
peso, expresión de duración) son **constantes del servidor** elegidas por whitelist (`BGG_SORT`,
`BGG_WEIGHT`); todo lo que viene del usuario viaja como parámetro ligado (`?`). `sort`/`weight`
se usan como clave de diccionario y `dir`/`players` son enteros. Los tiers de fit por jugadores
(`_fit_case`) interpolan un `n` ya tipado a entero.

## Duplicación front/back asumida (sin build step)

Hay lógica de dominio espejada en JS y Python que **debe** mantenerse en sync: buckets de
complejidad (`weightBucket` / `weight_bucket` / `BGG_WEIGHT`), `shortlistSize` / `shortlist_size`,
los labels de complejidad, e `isCoop`/`fitTier` (JS) que espejan `_is_coop`/`_fit_case` (SQL). Es
el precio de no tener bundler (SPA vanilla). Se mitiga con comentarios "espeja el back/front" en
cada lado; si algún día se suma build, es lo primero a unificar en un módulo compartido.

## Migraciones sin romper

`db.init()` corre migraciones idempotentes (`ALTER TABLE ... ADD COLUMN` si falta), así una DB
vieja se actualiza sin recrear.

## Tests (test-first en la lógica pura)

`server/tests.py` (**149 casos**, sin dependencias): parsing de IDs, buckets de complejidad,
scoring (incluye descarte por nº de jugadores), detección de cooperativos, perfil de colección,
limpieza de HTML, import de CSV, reconciliación del top (alta de entrante, baja del caído
no-tenido, colección preservada), expansiones (guard de alta, upsert, short-desc) y recomendaciones
guardadas (snapshot, scope por perfil). Corren en < 1 s: `python server/tests.py`.

## Qué quedó deliberadamente simple

- SQLite + `sqlite3` plano (sin ORM): el dominio es chico y las queries son claras.
- Filtrado en el cliente **solo de tu colección** (holdings, ~cientos): trivial en memoria y UI
  instantánea. El browse del catálogo completo (5000+) es server-side y paginado (`/api/bgg`).
- Sin framework de front: vanilla JS con helpers mínimos; menos superficie, cero build.
- **Módulos ES nativos, sin bundler.** `web/js/` son 23 módulos que el navegador carga siguiendo
  los `import`; sigue sin haber paso de build, npm ni webpack.

## Front: de un archivo a módulos

`app.js` era un solo archivo de ~2.550 líneas donde todo era global: cualquier función podía llamar
a cualquier otra y ninguna declaraba de qué dependía. El argumento para no partirlo era que "sin
bundler significa múltiples `<script>` y orden manual de carga" — que es exactamente lo que resuelve
**ESM**: el navegador lee los `import` del módulo de entrada y arma el orden solo.

- **`web/js/`, 23 módulos** de ~40 a ~360 líneas. El grafo va de hojas sin dependencias
  (`util`, `domain`, `state`) hacia arriba; `main.js` es la entrada y **nadie lo importa**.
- El código se movió **tal cual** (mismos cuerpos de función): el diff es corte + cabeceras de
  `import`/`export`, no reescritura. La API pública de cada módulo es solo lo que otro usa.
- **Ciclos**: los hay (`router` ↔ vistas, `card` ↔ `detail`) y son inocuos porque solo participan
  declaraciones de función, que se hoistean. La única regla a respetar: ningún módulo puede leer en
  su nivel superior un `const` de otro módulo del ciclo. Hoy el único código de nivel superior son
  los listeners de `matchMedia` (sobre sus propios `const`) y el `init()` final de `main.js`.
- **`coverObserver`** era un `let` global que `responsive.js` pisaba; un import ESM es de solo
  lectura, así que `card.js` pasó a exponer `resetCoverObserver()` en vez de la variable.
- **Cache-buster**: el `?v=` del index versiona solo la entrada. `GET /js/{name}.js` reescribe los
  `import` agregándoles el mismo número (el mtime más nuevo de `web/js/`). Tiene que ser **uno solo
  para todos**: el navegador identifica un módulo por su URL, así que dos `?v=` distintos para
  `state.js` lo cargarían dos veces y habría dos copias del estado.

## Qué NO se tocó (y por qué)

- **Modales largos (`openData`, `openDetail`).** Son constructores de UI cohesivos (una pantalla
  cada uno); partirlos ahora agrega indirección sin bajar complejidad real.

## Deuda conocida

- La confirmación al sacar un juego a "Ninguno" usa `is_top` (`rank ≤ TOP_N`) como proxy de "se
  borra de la base". Para datos anómalos (una expansión vieja cargada como juego, con rank en el
  top) el proxy falla: no avisa aunque el backend la borre. El guard de altas ya evita generar ese
  dato; si molesta, cambiar el proxy por "¿está en el preseed?".

## Principio para cambios de fondo en la base (evolución de esquema/datos)

Cuando se agregue **un dato nuevo que el front consuma** (una columna/campo nuevo), tener en cuenta:

- **El top canónico es la referencia completa.** Ese dato llega íntegro para los del top vía la base
  horneada (re-bake) y/o la reconciliación; los 5000 son la porción confiable y homogénea.
- **La colección fuera del top puede quedar con faltantes de ese dato**, porque esos juegos se
  trajeron ad-hoc (alta manual / caídos del top) y quizás con un fetch previo al campo nuevo. El
  front debe tolerar el faltante (fallback/placeholder), y el dato se completa **por diff** en las
  actualizaciones. Nunca asumir que un juego de colección tiene el campo nuevo.
