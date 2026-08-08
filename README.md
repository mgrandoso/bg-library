<h1 align="center">🎲 Ludoteca</h1>

<p align="center"><b>Tu biblioteca de juegos de mesa</b> — navegá tu colección con datos y portadas de BoardGameGeek, mirá estadísticas, y dejá que un advisor te diga <i>qué sacar a la mesa hoy</i> o <i>qué te conviene comprar</i>.</p>

<p align="center">
  <img src="docs/library.png" alt="Biblioteca de Ludoteca" width="900">
</p>

---

## ¿Qué es?

Una app web local (FastAPI + SQLite + JavaScript vanilla) para gestionar tu colección de juegos de
mesa. Importás tu colección desde BoardGameGeek y Ludoteca la enriquece con portadas, complejidad,
diseñadores, categorías, mecánicas, edades y el número de jugadores "ideal" según la comunidad.
Estética de **mesa de juego premium**, responsive, con tema claro y oscuro.

## Qué hace

- 📚 **Biblioteca y Wishlist** — grid con portadas, barra de complejidad, jugadores (con badge
  *ideal / va bien*), duración y tipo. Filtros por tipo, jugadores, duración, complejidad y
  diseñador; buscador y orden. Ficha completa con edad editorial vs. comunidad, número de jugadores
  con 👑, dependencia del idioma, diseñadores clickeables, categorías, mecánicas y descripción.
- 🤖 **Advisor** — dos modos: *¿Qué saco hoy?* (entre lo que tenés) y *¿Qué compro?* (de tu
  wishlist, mirando el balance de tu colección). Elegís una **ocasión**, respondés preguntas
  simples, y elegís motor: **determinístico** (scoring transparente, instantáneo) o **agente**
  (Gemini razona sobre 20 candidatos y escribe la recomendación).
- 📊 **Panel** — destacados de tu colección, distribución por tipo / complejidad / edad, cobertura
  por número de jugadores (detecta huecos) y diseñadores más presentes.
- 👥 **Perfiles** — además de la tuya, cargá las colecciones de tus amigos (crear, cambiar,
  renombrar, borrar). En cada ficha ves quién tiene el juego.
- 🔄 **Import / Export / Actualizar** — importá un CSV de BoardGameGeek *o* un backup de esta app
  (ambos formatos); exportá el estado actual; refrescá rankings cuando pasa el tiempo. Si
  re-importás a un perfil que **ya tiene juegos**, primero ves una **reconciliación**: qué se
  agrega, qué cambia de estado y qué ya no está — las bajas las confirmás una por una.
- 🏆 **BGG** — navegá el **top-5000 de BoardGameGeek** con scroll infinito, buscador y los mismos
  filtros/orden que la Biblioteca (tipo, jugadores, duración, complejidad · rank/rating/complejidad/año),
  con tus juegos marcados 📦/⭐ y alta directa a biblioteca/wishlist.
- ➕ **Agregar juego** — buscás por nombre o pegás el ID / URL de BGG y trae todos los datos solo.

## Galería

<p align="center">
  <img src="docs/advisor.png" alt="Advisor" width="45%">
  <img src="docs/panel.png" alt="Panel de estadísticas" width="45%">
</p>
<p align="center">
  <img src="docs/bgg.png" alt="Browse del top de BGG" width="45%">
  <img src="docs/detail.png" alt="Ficha de un juego" width="45%">
</p>

## Correr

```bash
pip install -r requirements.txt
python server/seed.py     # una vez: crea bg.db con el catálogo top-5000 (data/bgg_top.json)
python -m uvicorn app:app --app-dir server --port 8778
```

Abrí **http://localhost:8778**. Arranca **vacío**: un onboarding te deja cargar tu colección
(export de BGG o backup de esta app) o empezar de cero agregando juegos a mano.

> **Tus datos quedan solo en tu máquina.** El repo trae únicamente el catálogo genérico del
> top-5000 (`data/bgg_top.json`). Tu colección (`bg.db`), tu export (`collection.csv`), el cache de
> tus juegos (`data/bgg_data.json`) y tu API key (`config.json`) están **gitignored**: hacés
> `git pull` para recibir mejoras del código sin que nada toque tu base ni tus cosas.

## Advisor con agente (opcional)

El modo **agente** usa **Google Gemini** (tiene tier gratis). Conseguí una API key en
[Google AI Studio](https://aistudio.google.com/apikey) y pegala en **⚙ → Advisor**. La key se
guarda en el **llavero de credenciales del sistema** (Windows Credential Manager / macOS Keychain,
vía `keyring`), no en texto plano; si no hay keyring disponible cae a `config.json` local. Sin key,
el Advisor funciona igual en modo determinístico (el agente queda deshabilitado hasta configurarla).

## Catálogo BGG pre-cargado (top-5000)

El repo ya viene con **`data/bgg_top.json`**: el **top-5000 de BGG por ranking, pre-seedeado a agosto 2026**
(vía la API pública de [recommend.games](https://recommend.games)). Así, quien clona el repo arranca
con el catálogo cargado **sin bajar nada** — `python server/seed.py` lo mete en la base.

### Ciclo de vida de los datos

El catálogo `games` es, en todo momento, **(top-5000 del preseed) ∪ (todo lo que alguien tiene o
desea)**. De ahí salen todas las reglas:

- **Entran** juegos al catálogo por cuatro vías: el preseed top-5000, marcarlos *tengo/quiero*,
  agregarlos por búsqueda (ID/URL de BGG), o importar un CSV — cualquiera de estas suma el juego
  aunque no esté en el top.
- **Se van** (GC de huérfanos) solo si un juego **no** es top-5000 **y** ya no lo tiene ni lo desea
  nadie. Un juego que se cae del top pero alguien tiene, se queda; uno que nadie tiene y no es top,
  se limpia.
- **Actualizar todo** (Perfiles y datos → Actualizar) hace el mantenimiento completo **por diff**,
  rápido: (A) recarga el top-5000 desde el preseed local —instantáneo, sin red—, (B) re-baja de BGG
  **solo tus juegos que quedaron fuera del top** y están vencidos (>30 días), y (C) corre el GC. El
  costo de red no escala con el catálogo: solo toca los pocos juegos tuyos rankeados >5000 o caídos
  del top. La pertenencia al preseed —no el rank guardado— es la fuente de verdad de "es top-5000".

Para regenerar el preseed vos mismo: `python build/preseed_top.py 5000`. Cuando este repo actualice
`data/bgg_top.json`, alcanza con `git pull` + **Actualizar todo**.

**¿Cada cuánto conviene?** Poco. En el top-5000 actual, cada año reciente aporta **~300 juegos**
(2019: 359, 2021: 299, 2023: 302, 2024: 262…), o sea **~6% de recambio anual**, casi todo en la
franja baja (ranks ~4000-5000). El **top-1000 es muy estable**. Un refresh **cada 6-12 meses** alcanza.

## De dónde salen los datos

BoardGameGeek cerró su XML API oficial (requiere token). Ludoteca usa la **API JSON pública del
frontend de BGG** (`api.geekdo.com`: `geekitems` + `dynamicinfo`), que trae imágenes, links
(diseñadores, categorías, mecánicas, tipo), edades y polls de la comunidad. El cache vive en
`data/bgg_data.json` (regenerable con `build/enrich.py`).

## Estructura

```
server/   app.py (API)  db.py (SQLite)  bgg.py (geekdo)  advisor.py (recomendador)
          seed.py  appconfig.py  tests.py
web/      index.html  styles.css  app.js
build/    enrich.py  backfill_desc.py  preseed_top.py (top-5000 BGG)
data/     bgg_top.json (top-5000 pre-seed, versionado) · bgg_data.json (cache local, gitignored)
docs/     capturas del README
```

## Tests

```bash
python server/tests.py
```

Notas de arquitectura y de la revisión de calidad (Clean Code): ver [`REVIEW.md`](REVIEW.md).

## Licencia

[MIT](LICENSE) © 2026 Manuel Grandoso.
