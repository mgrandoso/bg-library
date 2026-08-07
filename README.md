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
  (ambos formatos); exportá el estado actual; refrescá rankings cuando pasa el tiempo.
- 🏆 **BGG** — navegá el **top-5000 de BoardGameGeek** por ranking (paginado, con buscador), con tus juegos marcados ⭐/📦 y alta directa a biblioteca/wishlist.
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
python server/seed.py     # una vez: crea bg.db desde collection.csv + data/bgg_data.json
python -m uvicorn app:app --app-dir server --port 8778
```

Abrí **http://localhost:8778**. La primera vez, un onboarding te deja cargar tu colección (export
de BGG o backup) o empezar de cero.

## Advisor con agente (opcional)

El modo **agente** usa **Google Gemini** (tiene tier gratis). Conseguí una API key en
[Google AI Studio](https://aistudio.google.com/apikey) y pegala en **⚙ Configuración**. Sin key, el
Advisor funciona igual en modo determinístico (el agente queda deshabilitado hasta configurarla).

## Catálogo BGG pre-cargado (top-5000)

El repo ya viene con **`data/bgg_top.json`**: el **top-5000 de BGG por ranking, pre-seedeado a agosto 2026**
(vía la API pública de [recommend.games](https://recommend.games)). Así, quien clona el repo arranca
con el catálogo cargado **sin bajar nada** — `python server/seed.py` lo mete en la base.

**Mantenerlo al día es simple** y en gran parte automático:
- Cualquier juego que marques como *tengo/quiero* o que agregues por búsqueda **entra al catálogo** aunque
  no esté en el preseed.
- Para refrescar el top completo (juegos que entraron al ranking, cambios de rank): re-correr
  `python build/preseed_top.py 5000` regenera el JSON; `seed.py` aplica el diff. El **top-1000 es muy
  estable**; la franja baja rota unos cientos por año, así que un refresh cada 6-12 meses alcanza.

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
data/     bgg_data.json (colección enriquecida) · bgg_top.json (top-5000 pre-seed)
docs/     capturas del README
```

## Tests

```bash
python server/tests.py
```

Notas de arquitectura y de la revisión de calidad (Clean Code): ver [`REVIEW.md`](REVIEW.md).

## Licencia

[MIT](LICENSE) © 2026 Manuel Grandoso.
