"""Puebla/actualiza desde collection.csv (estado) + data/bgg_data.json (datos BGG).
import_csv() sirve para re-importar tu backup o cargar el de un amigo (a otro owner)."""
import csv
import io
import json
import logging
import os
import re
import time

import db

log = logging.getLogger("ludoteca.seed")

# El CSV lo sube el usuario: el objectid de BGG es SIEMPRE numérico, así que todo lo demás se
# descarta acá. Sin este filtro un valor arbitrario viajaba hasta la clave primaria de `games` y
# hasta el HTML del diff de reconciliación (donde se interpola en un atributo).
_OID_RE = re.compile(r"^[0-9]{1,12}$")


def _clean_oid(raw):
    """objectid válido (solo dígitos) o None si la fila no sirve."""
    oid = (raw or "").strip()
    return oid if _OID_RE.match(oid) else None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CSV_PATH = os.path.join(ROOT, "collection.csv")
BGG_JSON = os.path.join(ROOT, "data", "bgg_data.json")


def _int(v, d=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return d


def _float(v, d=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def _state_from_row(row):
    own = 1 if row.get("own") == "1" else 0
    wish = 1 if row.get("wishlist") == "1" else 0
    prio = _int(row.get("wishlistpriority"), 3)
    # Algunos no usan el flag wishlist sino "want to buy" / "want in trade" como su lista de deseos.
    # Si el juego no lo tiene ni está en la wishlist explícita pero está en alguno de esos, lo
    # tratamos como wishlist con prioridad alta (2 = "muy buscado", por debajo del 1 "must have").
    if not own and not wish and (row.get("wanttobuy") == "1" or row.get("want") == "1"):
        wish, prio = 1, 2
    return {
        "own": own,
        "wishlist": wish,
        "wishlist_priority": prio,
        "wishlist_comment": row.get("wishlistcomment") or "",
        "user_rating": float(row["rating"]) if row.get("rating") not in (None, "", "0") else 0,
        "numplays": _int(row.get("numplays"), 0),
    }


def import_csv(text, owner_id, mode="both", bgg_lookup=None, fetch_missing=False):
    """Carga un CSV de colección BGG en las holdings de `owner_id`.
    mode: 'own' (solo lo que tiene) | 'both' (own + wishlist).

    Expansiones: el link de export usa `subtype=boardgame`, así que normalmente el CSV no las trae.
    No las filtramos por fila acá (el CSV no expone el subtype y fetchear cada juego sería caro). Si
    alguna igual se cuela, `absorb_expansion()` la resuelve en el pase de enrich —que ya fetchea cada
    juego nuevo, sin costo extra—: la cuelga de su base own/wish o la descarta, dejando el import por
    CSV comportándose como el alta a mano (`/api/games/add`, `/api/lookup`)."""
    conn = db.connect()
    reader = csv.DictReader(io.StringIO(text))
    updated = added_games = skipped = 0
    bgg = bgg_lookup or {}
    for row in reader:
        oid = _clean_oid(row.get("objectid"))
        if not oid:
            skipped += 1
            continue
        st = _state_from_row(row)
        if mode == "own" and not st["own"]:
            skipped += 1
            continue
        if not st["own"] and not st["wishlist"]:
            skipped += 1
            continue
        # asegurar el juego en el catálogo
        if not conn.execute("SELECT 1 FROM games WHERE objectid=?", (oid,)).fetchone():
            rec = bgg.get(oid)
            if not rec and fetch_missing:
                try:
                    import bgg as bggmod
                    rec = bggmod.fetch(oid)
                except Exception:
                    rec = None
            if not rec:
                rec = {"objectid": oid, "name": row.get("objectname"),
                       "yearpublished": row.get("yearpublished"),
                       "minplayers": row.get("minplayers"), "maxplayers": row.get("maxplayers"),
                       "minplaytime": row.get("minplaytime"), "maxplaytime": row.get("maxplaytime"),
                       "weight": row.get("avgweight"), "rank_overall": row.get("rank")}
            db.upsert_bgg(conn, rec)
            added_games += 1
        db.set_holding(conn, owner_id, oid, st)
        updated += 1
    conn.commit()
    conn.close()
    return {"updated": updated, "added_games": added_games, "skipped": skipped}


def absorb_expansion(conn, owner_id, rec):
    """Absorbe una expansión que se coló en el import (el CSV de BGG no expone el subtype, así que
    una expansión puede entrar como si fuera un juego suelto). Usa la ficha BGG que el `enrich` YA
    fetcheó (`rec` con `is_expansion`/`expands`) — sin costo de red extra — para dejar el import por
    CSV comportándose como el alta a mano: la saca de games/holdings de este perfil y, si el perfil
    tiene (own o wish) alguno de sus juegos base, la **cuelga** de él (tabla `expansions`) con el
    mismo estado; si no tiene ningún base, la **descarta**. No commitea (lo hace el caller).
    Devuelve 'attached' | 'discarded', o None si `rec` no es expansión / el perfil no la tenía."""
    if not rec.get("is_expansion"):
        return None
    oid = str(rec.get("objectid"))
    h = conn.execute("SELECT own, wishlist FROM holdings WHERE owner_id=? AND objectid=?",
                     (owner_id, oid)).fetchone()
    if not h:
        return None                              # este perfil no la tenía: nada que absorber
    state = "own" if h["own"] else "wish"        # con qué estado la tenía el import
    conn.execute("DELETE FROM holdings WHERE owner_id=? AND objectid=?", (owner_id, oid))
    attached = False
    for base in rec.get("expands") or []:        # cuelga del primer base que el perfil tenga/desee
        base_oid = str(base.get("id"))
        if db.owns_or_wishes(conn, owner_id, base_oid):
            db.set_expansion(conn, owner_id, base_oid, oid, rec.get("name"), state,
                             short_description=rec.get("short_description"))
            attached = True
            break
    db.remove_if_orphan(conn, oid)               # limpia el juego suelto si ya nadie lo tiene y no es top
    return "attached" if attached else "discarded"


BGG_TOP = os.path.join(ROOT, "data", "bgg_top.json")


def reseed_catalog():
    """(Re)carga el CATÁLOGO desde el preseed top-5000 versionado (`data/bgg_top.json`) y, si
    existe localmente, el cache enriquecido (`data/bgg_data.json`, que pisa el overlap por ser más
    completo). Solo toca la tabla `games` (datos BGG) — NO toca `holdings`, así es seguro re-correr
    y NO pisa la colección del usuario. Es lo que usa el botón 'Actualizar catálogo' de la app.

    El cache local se aplica SOLO como overlay de enriquecimiento de juegos que ya pertenecen al
    catálogo (preseed ∪ tenidos): no da de alta juegos por sí mismo. Si no, cada reseed re-inyecta
    juegos del cache que no son top-5000 ni los tiene nadie, y el GC los vuelve a barrer (churn)."""
    db.init()
    conn = db.connect()
    top = json.load(open(BGG_TOP, encoding="utf-8")) if os.path.exists(BGG_TOP) else {}
    for rec in top.values():
        db.upsert_bgg(conn, rec)
    local = 0
    if os.path.exists(BGG_JSON):
        held = {r["objectid"] for r in conn.execute(
            "SELECT DISTINCT objectid FROM holdings WHERE own=1 OR wishlist=1").fetchall()}
        keep = set(top.keys()) | held
        for oid, rec in json.load(open(BGG_JSON, encoding="utf-8")).items():
            if rec.get("error") or oid not in keep:
                continue
            db.upsert_bgg(conn, rec)
            local += 1
    conn.commit()
    conn.close()
    return {"catalog": len(top), "local_cache": local}


# --- "Actualizar todo": reconciliar el top contra el dump (altas/bajas/rerank) + refrescar datos ---
# La membresía del top es DINÁMICA (rank<=TOP_N en la base). El dump del día es la verdad de quién
# está y en qué orden; el update agrega entrantes, saca a los que cayeron (si nadie los tiene) y
# re-rankea. La colección fuera del top persiste siempre.

def refresh_tail(fetch=None, dump_n=None):
    """Refresca rank+rating de los juegos TENIDOS cuya posición quedó FUERA del dump liviano
    (rank_overall > DUMP_N): son la cola larga de la colección (clásicos masivos como Monopoly o
    Yahtzee), que el dump de ~10k no cubre. Reemplaza al viejo "pase profundo" (bajar el dump
    COMPLETO de ~31k filas solo para reposicionar 5-10 juegos era desproporcionado).

    Estrategia: pide cada uno por id con `fetch(oid)` (por defecto bgg.fetch, que trae rank_overall)
    y actualiza SOLO rank+rating — la data del juego es estática, no se re-escribe. Son poquísimos
    (a veces cero). Los juegos SIN rank (rank NULL) se saltean: BGG no rankea expansiones/nicho, así
    que fetchearlos no aportaría un rank. Un juego que subió a rank<=DUMP_N ya lo reposicionó el
    dump (apply_rank_dump) y no cae acá. Best-effort: un fetch que falla se loguea y sigue. Rating
    con COALESCE para no borrar un valor conocido ante un miss transitorio.
    Devuelve {refreshed, failed, tail}."""
    import bgg as bggmod
    dump_n = DUMP_N if dump_n is None else dump_n
    fetch = fetch or bggmod.fetch
    conn = db.connect()
    ids = [r["objectid"] for r in conn.execute(
        "SELECT objectid FROM games WHERE rank_overall IS NOT NULL AND rank_overall > ? "
        "AND objectid IN (SELECT objectid FROM holdings WHERE own=1 OR wishlist=1)",
        (dump_n,)).fetchall()]
    refreshed = failed = 0
    for oid in ids:
        try:
            rec = fetch(oid)
            conn.execute("""UPDATE games SET
                rank_overall=COALESCE(?, rank_overall),
                rating_bayes=COALESCE(?, rating_bayes),
                rating_avg=COALESCE(?, rating_avg),
                users_rated=COALESCE(?, users_rated)
                WHERE objectid=?""",
                         (rec.get("rank_overall"), rec.get("rating_bayes"),
                          rec.get("rating_avg"), rec.get("users_rated"), oid))
            # commit POR JUEGO, no al final: el primer UPDATE toma el lock de escritura de SQLite y
            # lo retiene hasta el commit. Si commiteáramos recién al terminar, el lock quedaría
            # tomado durante TODOS los fetch de red intermedios (hasta 25s x 3 reintentos cada uno)
            # y cualquier otra escritura de la app —marcar "lo tengo" desde el celu— fallaría con
            # "database is locked". Commitear acá lo libera entre fetch y fetch.
            conn.commit()
            refreshed += 1
        except Exception as e:  # noqa — un juego que no baja no debe voltear el update
            log.warning("refresh_tail: no pude traer %s -> %s: %s", oid, type(e).__name__, e)
            failed += 1
    conn.close()
    log.info("refresh_tail: %d refrescados (%d fallidos) de %d en la cola >%d",
             refreshed, failed, len(ids), dump_n)
    return {"refreshed": refreshed, "failed": failed, "tail": len(ids)}


def resolve_missing_es_names(call_llm, fetch_alt, limit=None, only_ids=None, chunk_size=80):
    """Popula `es_name` de los juegos con es_name NULL que alguien tiene/desea (ítem 1c). Trae los
    alt-names con `fetch_alt(oid)->[str]` y resuelve el nombre en español en batch con `call_llm`.
    Ambos INYECTABLES: en runtime `fetch_alt`=lambda que llama a bgg.fetch, `call_llm`=Gemini; en
    tests, fakes (sin red). Por defecto (`limit=None`) resuelve TODOS los pendientes en una corrida,
    partidos internamente en tandas de `chunk_size` (una llamada al LLM por tanda); `limit` acota el
    total sólo si se pide. `only_ids` restringe a un conjunto de objectids (p. ej. los recién
    importados). Devuelve {'resolved': n, 'pending': m, 'tandas': k}. Best-effort: no lanza."""
    import advisor
    import math
    conn = db.connect()
    # es_name pendiente = sin resolver Y en el top canónico (nuevo entrante) O tenido por alguien
    # (colección fuera del top). Así el diff resuelve los nombres de los juegos que aparecen en el
    # top y los de tu colección, sin re-trabajar los 5000 ya horneados.
    where = ("g.es_name IS NULL AND (g.rank_overall<=? OR g.objectid IN "
             "(SELECT objectid FROM holdings WHERE own=1 OR wishlist=1))")
    params = [db.TOP_N]
    if only_ids:
        where += " AND g.objectid IN (" + ",".join("?" for _ in only_ids) + ")"
        params += list(only_ids)
    sql = f"""
        SELECT DISTINCT g.objectid, g.name FROM games g
        WHERE {where}
    """
    if limit is not None:
        sql += " LIMIT ?"
        params = params + [limit]
    rows = conn.execute(sql, params).fetchall()
    if not rows:
        conn.close()
        return {"resolved": 0, "pending": 0, "tandas": 0}
    items = []
    for r in rows:
        try:
            alt = fetch_alt(r["objectid"]) or []
        except Exception as e:  # noqa — un juego que no se puede traer no debe voltear el batch
            log.warning("es_name: no pude traer alt-names de %s (%s) -> %s: %s",
                        r["name"], r["objectid"], type(e).__name__, e)
            alt = []
        items.append({"id": r["objectid"], "name": r["name"], "alt": alt})
    tandas = math.ceil(len(items) / chunk_size)
    log.info("es_name: %d pendientes en %d tanda(s) de hasta %d", len(items), tandas, chunk_size)
    resolved = advisor.resolve_es_names(items, call_llm, chunk_size=chunk_size)
    log.info("es_name: resueltos %d de %d pendientes", len(resolved), len(items))
    for oid, es in resolved.items():
        conn.execute("UPDATE games SET es_name=? WHERE objectid=?", (es, oid))
    conn.commit()
    conn.close()
    return {"resolved": len(resolved), "pending": len(items), "tandas": tandas}


def resolve_es_names_runtime(limit=None, only_ids=None):
    """Runtime: arma `fetch_alt` (bgg.fetch → alt_names) + `call_llm` (Gemini del keychain) y popula
    los es_name NULL. Por defecto resuelve TODOS los pendientes en una corrida (tandas internas), así
    un update no deja un remanente que obligue a re-actualizar. Sin key no hace nada y avisa
    (`no_key`). Best-effort (no lanza). Lo usan el trigger de import CSV y el update (ítem 4)."""
    import advisor
    import bgg as bggmod
    call_llm = advisor.gemini_caller()
    if not call_llm:
        return {"resolved": 0, "no_key": True}

    def fetch_alt(oid):
        return bggmod.fetch(oid).get("alt_names") or []
    try:
        return resolve_missing_es_names(call_llm, fetch_alt, limit=limit, only_ids=only_ids)
    except Exception as e:  # noqa — nunca voltear el flujo que lo dispara (import/update)
        log.error("es_name runtime falló -> %s: %s", type(e).__name__, e)
        return {"resolved": 0, "error": str(e)}


# --- Ítem 4: refresh de RANKS por dump liviano (reemplaza el diff de red del flujo 8) ---
# El catálogo/preseed sigue siendo top-5000; el dump top-10k es SOLO para reposicionar ranks
# (incluye tus juegos rankeados 5001-10000). NO agranda el catálogo ni refetch-ea data por juego.
DUMP_URL = "https://raw.githubusercontent.com/beefsack/bgg-ranking-historicals/master/{date}.csv"
# Cuántas filas del dump se bajan (Range parcial). Cubre el top-5000 canónico + margen para
# reposicionar tus juegos rankeados 5001-10000 gratis. Los tenidos con rank>DUMP_N los pone al día
# refresh_tail por id (no bajamos el dump completo por unos pocos). También es el umbral de la cola.
DUMP_N = 10000


def _latest_dump_url(today, url_ok, back_days=7):
    """URL del dump diario más reciente disponible. El archivo es `YYYY-MM-DD.csv`; prueba HOY y
    RETROCEDE día a día (hasta `back_days`) hasta que `url_ok(url)->bool` diga que existe. Lógica de
    fechas pura, SIN LLM (el fallback día-a-día cubre el huso horario / la hora de publicación del
    dump). Devuelve (url, 'YYYY-MM-DD') o (None, None) si no hay ninguno en la ventana."""
    from datetime import timedelta
    for i in range(back_days + 1):
        ds = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        url = DUMP_URL.format(date=ds)
        if url_ok(url):
            return url, ds
    return None, None


def parse_rank_dump(text, limit=10000):
    """Parsea el CSV del dump de beefsack (`ID,Name,Year,Rank,Average,Bayes average,Users rated,
    URL,Thumbnail`) y devuelve `{oid: {rank_overall, rating_bayes, rating_avg, users_rated}}`.

    `rank_overall` NO es el entero crudo del dump: es la POSICIÓN ENUMERADA (1..N) tras ordenar por
    (rank del dump asc, bayes desc). Enumerar es nuestra fuente ÚNICA de rank —garantiza ranks sin
    repetidos ni saltos aunque el dump de origen los tenga (los tiene: ~7 dup y ~7 huecos en el
    top-5000). El mismo criterio lo usa el horneado del seed y el update diario, así el ranking se
    mantiene consistente en el tiempo. Ignora filas sin ID o sin rank. `limit` recorta al top-N."""
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        oid = (row.get("ID") or "").strip()
        raw_rank = _int(row.get("Rank"), 0)
        if not oid or not raw_rank:
            continue
        rows.append((raw_rank, oid, {
            "rating_bayes": _float(row.get("Bayes average")),
            "rating_avg": _float(row.get("Average")),
            "users_rated": _int(row.get("Users rated"), None)}))
    # ordenar por rank del dump; el dump repite algunos rank, así que desempatamos por bayes desc
    # de forma determinística. La posición 1..N (sobre juegos ÚNICOS) es el rank_overall.
    rows.sort(key=lambda r: (r[0], -(r[2]["rating_bayes"] or 0.0)))
    # DEDUP por id ANTES de enumerar: el dump de beefsack trae ~7 filas duplicadas (mismo id) en el
    # top-5000. Si no se deduplican, la fila repetida "consume" una posición y deja un hueco (y se
    # pierde un juego real). Deduplicando primero (nos quedamos con la mejor fila de cada juego, que
    # por el orden es la primera) el resultado queda contiguo 1..N, sin repetidos ni saltos —
    # idéntico a como se horneó el seed. `limit` cuenta juegos únicos.
    out = {}
    pos = 0
    for _raw, oid, d in rows:
        if oid in out:
            continue
        pos += 1
        if pos > limit:
            break
        out[oid] = {"rank_overall": pos, **d}
    return out


def apply_rank_dump(dump):
    """Primitiva de RERANK: reposiciona rank+rating de los juegos que YA están en `games` con `dump`
    ({oid: {...}}). No da de alta (de eso se encarga `reconcile_top`); acá solo se reposiciona lo
    presente (top actual + tenidos que aparezcan en el dump). Rating con COALESCE para no pisar con
    NULL si el dump no lo trae. Devuelve cuántos actualizó."""
    conn = db.connect()
    have = {r["objectid"] for r in conn.execute("SELECT objectid FROM games").fetchall()}
    n = 0
    for oid, d in dump.items():
        if oid not in have:
            continue
        conn.execute("""UPDATE games SET
            rank_overall=?,
            rating_bayes=COALESCE(?, rating_bayes),
            rating_avg=COALESCE(?, rating_avg),
            users_rated=COALESCE(?, users_rated)
            WHERE objectid=?""",
                     (d["rank_overall"], d.get("rating_bayes"), d.get("rating_avg"),
                      d.get("users_rated"), oid))
        n += 1
    conn.commit()
    conn.close()
    return n


def reconcile_top(dump, top_n=None, fetch=None):
    """Reconcilia la MEMBRESÍA del top contra el dump del día (el corazón del update):

      · ALTAS: los objectid que entraron al top (rank<=top_n) y NO están en la base se traen de BGG
        (`fetch(oid)->rec`, por defecto bgg.fetch) y se insertan. Best-effort: si un fetch falla se
        loguea y sigue (se reintenta en el próximo update), nunca voltea la corrida.
      · RERANK: se reposiciona rank+rating de todo lo presente (via apply_rank_dump), incluidos los
        recién insertados, con el rank ENUMERADO del dump (fuente única, sin dups/huecos).

    Las BAJAS (juegos que cayeron del top y nadie tiene) las hace después el GC (`gc_run`), que ya
    corre con keep = top ∪ tenidos. La colección NO se toca. Devuelve {altas, altas_failed}."""
    import bgg as bggmod
    top_n = db.TOP_N if top_n is None else top_n
    fetch = fetch or bggmod.fetch
    conn = db.connect()
    have = {r["objectid"] for r in conn.execute("SELECT objectid FROM games").fetchall()}
    conn.close()
    entrantes = [oid for oid, d in dump.items() if d["rank_overall"] <= top_n and oid not in have]
    altas = failed = 0
    if entrantes:
        conn = db.connect()
        for oid in entrantes:
            try:
                db.upsert_bgg(conn, fetch(oid))   # rank de BGG; lo pisa el rerank con el enumerado
                conn.commit()   # por entrante: no retener el lock de escritura durante los fetch
                altas += 1
            except Exception as e:  # noqa — un entrante que no baja no debe voltear el update
                log.warning("reconcile_top: no pude traer el entrante %s -> %s: %s",
                            oid, type(e).__name__, e)
                failed += 1
        conn.close()
    reranked = apply_rank_dump(dump)
    log.info("reconcile_top: altas=%d (fallidas=%d) rerank=%d", altas, failed, reranked)
    return {"altas": altas, "altas_failed": failed, "reranked": reranked}


def _dump_url_ok(url):
    """HEAD al dump: True si existe (200). Silencioso ante 404/errores (es parte del retroceso de
    fechas de `_latest_dump_url`)."""
    import urllib.request
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "ludoteca"})
        urllib.request.urlopen(req, timeout=20)
        return True
    except Exception:  # noqa — 404 esperado al probar fechas futuras/sin publicar
        return False


def _http_get_text(url, headers, timeout=45):
    import urllib.request
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


# ~240 bytes por fila (medido en vivo); pedimos con margen sobre DUMP_N filas.
_DUMP_BYTES_PER_ROW = 240


def fetch_rank_dump(top_n=None, today=None):
    """Baja el dump de ranks más reciente (por fecha) y lo parsea. Siempre Range PARCIAL (~top_n
    filas, ~2.5 MB para 10k): cubre el top canónico + tus juegos rankeados 5001-10000. La cola
    (>DUMP_N) NO viene en el dump — la pone al día refresh_tail por id. Loguea y RE-LANZA si no hay
    dump o falla la descarga (el caller decide)."""
    import datetime
    top_n = DUMP_N if top_n is None else top_n
    today = today or datetime.date.today()
    url, ds = _latest_dump_url(today, _dump_url_ok)
    if not url:
        log.error("dump de ranks: no encontré ninguno reciente (ventana de 7 días desde %s)", today)
        raise RuntimeError("no encontré un dump de ranks reciente en github")
    headers = {"User-Agent": "ludoteca",
               "Range": f"bytes=0-{int(top_n * _DUMP_BYTES_PER_ROW * 1.2)}"}
    try:
        text = _http_get_text(url, headers)
    except Exception as e:  # noqa — se re-lanza; el estándar es loguear con contexto
        log.error("dump de ranks: falló la descarga %s -> %s: %s", url, type(e).__name__, e)
        raise
    dump = parse_rank_dump(text, limit=top_n)
    log.info("dump de ranks %s: %d filas parseadas", ds, len(dump))
    return dump, ds


def update_ranks(resolve_es=True):
    """Ítem 4 — 'Actualizar': baja el dump de ranks más reciente y RECONCILIA el top contra él en
    una sola corrida:
      1. altas (entrantes nuevos, ficha por API) + rerank de rank+rating (reconcile_top),
      2. bajas (los que cayeron del top y nadie tiene, via gc_run),
      3. refresh_tail: pone al día por id el rank de tus juegos con rank>DUMP_N (la cola larga),
      4. resuelve los es_name pendientes (top nuevo + colección) si hay key de Gemini.
    La membresía del top es dinámica: nadie depende de que se publique un seed nuevo para ver los
    juegos que entraron. Marca `last_update`. Devuelve un resumen. La descarga puede lanzar (red);
    el caller/endpoint lo reporta."""
    import datetime
    dump, ds = fetch_rank_dump()
    rec = reconcile_top(dump)                       # altas + rerank
    gc = gc_run()                                   # bajas: caídos del top y no tenidos
    tail = refresh_tail()                           # cola >DUMP_N por id (reemplaza el pase profundo)
    conn = db.connect()
    db.meta_set(conn, "last_update", datetime.date.today().isoformat())
    conn.commit()
    conn.close()
    es = resolve_es_names_runtime() if resolve_es else {"resolved": 0, "skipped": True}
    log.info("update_ranks: dump=%s altas=%d bajas=%d rerank=%d cola=%d es=%s",
             ds, rec["altas"], gc["removed"], rec["reranked"], tail["refreshed"], es)
    return {"dump_date": ds, "ranks_applied": rec["reranked"], "altas": rec["altas"],
            "altas_failed": rec["altas_failed"], "gc_removed": gc["removed"],
            "tail_refreshed": tail["refreshed"], "es_names": es}


def gc_run():
    """Bajas del catálogo: borra los juegos que quedaron FUERA del top (rank>TOP_N o NULL) y que
    nadie tiene/desea. keep = top vigente (rank<=TOP_N) ∪ tenidos. Correr SIEMPRE después del
    rerank (así el keep refleja las posiciones nuevas). La colección no se toca."""
    conn = db.connect()
    orphans = db.gc_orphans(conn, db.top_ids(conn))
    conn.commit()
    conn.close()
    return {"removed": len(orphans)}


# --- Flujo 9: reconciliación de re-import (preview con diff + apply con confirmación) ---

def _csv_incoming(text):
    """Parsea el CSV a {objectid: {state, own, wishlist, name}} quedándose solo con lo que está
    en own o wishlist (un juego con ninguno de los dos no 'está' en la colección)."""
    reader = csv.DictReader(io.StringIO(text))
    out = {}
    for row in reader:
        oid = _clean_oid(row.get("objectid"))
        if not oid:
            continue
        st = _state_from_row(row)
        if not st["own"] and not st["wishlist"]:
            continue
        out[oid] = {"state": st, "own": st["own"], "wishlist": st["wishlist"],
                    "name": (row.get("objectname") or "").strip(), "row": row}
    return out


def _current_holdings(conn, owner_id):
    rows = conn.execute("""
        SELECT h.objectid, h.own, h.wishlist, h.wishlist_priority, g.name
        FROM holdings h LEFT JOIN games g ON g.objectid=h.objectid
        WHERE h.owner_id=? AND (h.own=1 OR h.wishlist=1)
    """, (owner_id,)).fetchall()
    return {r["objectid"]: dict(r) for r in rows}


def reconcile_preview(text, owner_id):
    """Compara el CSV entrante contra lo que el perfil ya tiene. Devuelve 4 grupos para confirmar:
    added (altas), changed (own↔wish/prioridad), removed (ya no están: la parte sensible), y el
    conteo de unchanged. Compara own+wish siempre (el toggle de modo no aplica al re-import)."""
    conn = db.connect()
    incoming = _csv_incoming(text)
    current = _current_holdings(conn, owner_id)
    conn.close()
    added, changed, removed, unchanged = [], [], [], 0
    for oid, inc in incoming.items():
        cur = current.get(oid)
        new_st = "own" if inc["own"] else "wishlist"
        name = inc["name"] or (cur or {}).get("name") or oid
        if not cur:
            added.append({"objectid": oid, "name": name, "to": new_st})
            continue
        cur_st = "own" if cur["own"] else "wishlist"
        prio_changed = (new_st == "wishlist"
                        and (cur.get("wishlist_priority") or 3) != inc["state"]["wishlist_priority"])
        if cur_st != new_st or prio_changed:
            changed.append({"objectid": oid, "name": cur.get("name") or name,
                            "from": cur_st, "to": new_st})
        else:
            unchanged += 1
    for oid, cur in current.items():
        if oid not in incoming:
            removed.append({"objectid": oid, "name": cur.get("name") or oid,
                            "from": "own" if cur["own"] else "wishlist"})
    key = lambda x: (x["name"] or "").lower()
    added.sort(key=key); changed.sort(key=key); removed.sort(key=key)
    return {"added": added, "changed": changed, "removed": removed,
            "unchanged": unchanged, "owner_id": owner_id}


def reconcile_apply(text, owner_id, confirm_removals=None):
    """Aplica la reconciliación: altas + cambios SIEMPRE; bajas SOLO las confirmadas (borra el
    holding); después corre el GC de huérfanos. `confirm_removals` = lista de objectids a dar de baja."""
    confirm = set(confirm_removals or [])
    conn = db.connect()
    incoming = _csv_incoming(text)
    current = _current_holdings(conn, owner_id)
    bgg = json.load(open(BGG_JSON, encoding="utf-8")) if os.path.exists(BGG_JSON) else {}
    added = changed = removed = 0
    for oid, inc in incoming.items():
        if not conn.execute("SELECT 1 FROM games WHERE objectid=?", (oid,)).fetchone():
            rec = bgg.get(oid) or {"objectid": oid, "name": inc["name"],
                                   "yearpublished": inc["row"].get("yearpublished"),
                                   "minplayers": inc["row"].get("minplayers"),
                                   "maxplayers": inc["row"].get("maxplayers"),
                                   "minplaytime": inc["row"].get("minplaytime"),
                                   "maxplaytime": inc["row"].get("maxplaytime"),
                                   "weight": inc["row"].get("avgweight"),
                                   "rank_overall": inc["row"].get("rank")}
            db.upsert_bgg(conn, rec)
        cur = current.get(oid)
        db.set_holding(conn, owner_id, oid, inc["state"])
        if not cur:
            added += 1
        elif ("own" if cur["own"] else "wishlist") != ("own" if inc["own"] else "wishlist"):
            changed += 1
    for oid in confirm:
        if oid in current:
            conn.execute("DELETE FROM holdings WHERE owner_id=? AND objectid=?", (owner_id, oid))
            removed += 1
    conn.commit()
    orphans = db.gc_orphans(conn, db.top_ids(conn))
    conn.commit()
    conn.close()
    return {"added": added, "changed": changed, "removed": removed, "gc": len(orphans)}


def ensure_seeded():
    """Bootstrap de PRIMER arranque (y tras clonar el repo): si el catálogo está vacío, lo carga
    desde el preseed. Idempotente y barato (un COUNT); en arranques siguientes no hace nada, así
    los datos del usuario persisten y `git pull` no le toca nada. Devuelve True si sembró."""
    db.init()
    conn = db.connect()
    empty = conn.execute("SELECT COUNT(*) c FROM games").fetchone()["c"] == 0
    conn.close()
    if empty:
        reseed_catalog()
    return empty


def seed():
    """Seed completo de dev (incluye la colección propia si hay collection.csv local)."""
    res = reseed_catalog()
    print(f"Catálogo cargado: top={res['catalog']}, cache_local={res['local_cache']}")
    if os.path.exists(CSV_PATH):
        conn = db.connect()
        me = db.get_me(conn)
        bgg = json.load(open(BGG_JSON, encoding="utf-8")) if os.path.exists(BGG_JSON) else {}
        conn.close()
        r = import_csv(open(CSV_PATH, encoding="utf-8").read(), me, mode="both", bgg_lookup=bgg)
        print(f"Estado aplicado a 'Vos': {r}")


if __name__ == "__main__":
    seed()
