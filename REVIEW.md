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

## Migraciones sin romper

`db.init()` corre migraciones idempotentes (`ALTER TABLE ... ADD COLUMN` si falta), así una DB
vieja se actualiza sin recrear.

## Tests (test-first en la lógica pura)

`server/tests.py` (18 casos, sin dependencias): parsing de IDs, buckets de complejidad, scoring
(incluye descarte por nº de jugadores), detección de cooperativos, perfil de colección, e
integración contra la DB seedeada. Corren en < 1s: `python server/tests.py`.

## Qué quedó deliberadamente simple

- SQLite + `sqlite3` plano (sin ORM): el dominio es chico y las queries son claras.
- Filtrado del grid en el cliente: 720 juegos es trivial en memoria y hace la UI instantánea.
- Sin framework de front: vanilla JS con helpers mínimos; menos superficie, cero build.
