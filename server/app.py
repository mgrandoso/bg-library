"""BG Library — backend FastAPI (multi-perfil)."""
import csv
import io
import os
import time

from fastapi import FastAPI, Body, UploadFile, File, Form, Query
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles

import db
import bgg
import seed as seedmod
import advisor
import appconfig

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(ROOT, "web")

app = FastAPI(title="BG Library")
db.init()
# primer arranque / tras clonar: carga el catálogo top-5000 desde el preseed versionado.
# Idempotente: en arranques siguientes no hace nada, así los datos del usuario persisten.
seedmod.ensure_seeded()


@app.middleware("http")
async def no_cache_assets(request, call_next):
    """App local en evolución: que el navegador nunca sirva HTML/JS/CSS viejo cacheado."""
    resp = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".js", ".css", ".html")):
        resp.headers["Cache-Control"] = "no-store, must-revalidate"
    return resp


def _me():
    conn = db.connect()
    me = db.get_me(conn)
    conn.close()
    return me


# ---------------- owners / perfiles ----------------

@app.get("/api/owners")
def owners():
    conn = db.connect()
    db.get_me(conn)  # garantiza que exista 'Vos'
    data = db.list_owners(conn)
    conn.close()
    return {"owners": data}


@app.post("/api/owners")
def create_owner(payload: dict = Body(...)):
    name = (payload.get("name") or "").strip()
    if not name:
        return JSONResponse({"error": "falta el nombre"}, status_code=400)
    conn = db.connect()
    oid = db.ensure_owner(conn, name, is_me=1 if payload.get("is_me") else 0)
    conn.close()
    return {"id": oid, "name": name}


@app.patch("/api/owners/{oid}")
def rename_owner(oid: int, payload: dict = Body(...)):
    name = (payload.get("name") or "").strip()
    conn = db.connect()
    if name:
        conn.execute("UPDATE owners SET name=? WHERE id=?", (name, oid))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/owners/{oid}/reset")
def reset_owner(oid: int):
    """Vacía la colección de un perfil (borra todos sus holdings) sin borrar el perfil. Pensado
    para 'empezar de cero' con tu propio perfil (que no se puede borrar). Después corre el GC para
    limpiar del catálogo los juegos que quedaron sin dueño y no son top-5000."""
    conn = db.connect()
    n = conn.execute("SELECT COUNT(*) c FROM holdings WHERE owner_id=?", (oid,)).fetchone()["c"]
    conn.execute("DELETE FROM holdings WHERE owner_id=?", (oid,))
    conn.commit()
    orphans = db.gc_orphans(conn, seedmod.preseed_id_set())
    conn.commit()
    conn.close()
    return {"ok": True, "cleared": n, "gc": len(orphans)}


@app.delete("/api/owners/{oid}")
def delete_owner(oid: int):
    conn = db.connect()
    row = conn.execute("SELECT is_me FROM owners WHERE id=?", (oid,)).fetchone()
    if row and row["is_me"]:
        conn.close()
        return JSONResponse({"error": "no se puede borrar tu perfil"}, status_code=400)
    conn.execute("DELETE FROM holdings WHERE owner_id=?", (oid,))
    conn.execute("DELETE FROM owners WHERE id=?", (oid,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ---------------- juegos ----------------

@app.get("/api/games")
def list_games(owner: int = 0):
    """Solo tu colección (own + wishlist). El catálogo completo NO viaja acá; el
    browse del top vive en /api/bgg (paginado). Mantiene el payload liviano."""
    conn = db.connect()
    owner = owner or db.get_me(conn)
    games = [g for g in db.games_for_owner(conn, owner) if g.get("own") or g.get("wishlist")]
    conn.close()
    for g in games:
        g.pop("description", None)   # descripción larga on-demand en la ficha
    return {"owner": owner, "games": games}


# orden: (expresión, dirección natural para dir=1). dir=-1 invierte.
BGG_SORT = {
    "rank":   ("g.rank_overall", "ASC"),
    "rating": ("g.rating_bayes", "DESC"),
    "weight": ("g.weight", "DESC"),
    "year":   ("CAST(g.yearpublished AS INTEGER)", "DESC"),
    "name":   ("g.name COLLATE NOCASE", "ASC"),
    "time":   ("COALESCE(NULLIF(g.maxplaytime,0), g.minplaytime)", "ASC"),
}
# complejidad: espeja weightBucket del front (light=buckets 0-1, mid=2, heavy=3-4)
BGG_WEIGHT = {"light": (0.01, 2.1), "mid": (2.1, 2.7), "heavy": (2.7, 99.0)}
# duración efectiva de un juego (maxplaytime, cae a minplaytime, 0 si nada)
_PLAYTIME = "COALESCE(NULLIF(g.maxplaytime,0), NULLIF(g.minplaytime,0), 0)"


@app.get("/api/bgg")
def bgg_browse(owner: int = 0, page: int = 0, per: int = 48, q: str = "",
               types: str = "", players: int = 0,
               time_f: str = Query("", alias="time"), weight: str = "",
               sort: str = "rank", direction: int = Query(1, alias="dir")):
    """Browse del top de BGG (por rank) con tu estado (own/wishlist) por juego.
    Filtros y orden server-side (mismos criterios que la Biblioteca). Paginado."""
    conn = db.connect()
    owner = owner or db.get_me(conn)
    where = ["g.rank_overall IS NOT NULL", "g.rank_overall > 0"]
    params = []
    if q.strip():
        where.append("g.name LIKE ? COLLATE NOCASE")
        params.append(f"%{q.strip()}%")
    sel_types = [t.strip() for t in types.split(",") if t.strip()]
    if sel_types:
        # subdomains se guarda como JSON: ["Strategy Games", ...]; matcheo por el nombre entrecomillado
        where.append("(" + " OR ".join("g.subdomains LIKE ?" for _ in sel_types) + ")")
        params += [f'%"{t}"%' for t in sel_types]
    if players:
        where.append("g.minplayers <= ? AND g.maxplayers >= ?")
        params += [players, players]
    if time_f == "short":
        where.append(f"{_PLAYTIME} > 0 AND {_PLAYTIME} < 30")
    elif time_f == "mid":
        where.append(f"{_PLAYTIME} BETWEEN 30 AND 89")
    elif time_f == "long":
        where.append(f"{_PLAYTIME} >= 90")
    if weight in BGG_WEIGHT:
        lo, hi = BGG_WEIGHT[weight]
        where.append("g.weight >= ? AND g.weight < ?")
        params += [lo, hi]
    where_sql = " AND ".join(where)

    expr, base_dir = BGG_SORT.get(sort, BGG_SORT["rank"])
    if direction != 1:
        base_dir = "ASC" if base_dir == "DESC" else "DESC"
    # NULLs siempre al final, sin importar la dirección; desempate estable por rank
    order_sql = f"({expr}) IS NULL, {expr} {base_dir}, g.rank_overall ASC"

    total = conn.execute(f"SELECT COUNT(*) c FROM games g WHERE {where_sql}", params).fetchone()["c"]
    rows = conn.execute(f"""
        SELECT g.*, h.own, h.wishlist, h.wishlist_priority
        FROM games g LEFT JOIN holdings h ON h.objectid=g.objectid AND h.owner_id=?
        WHERE {where_sql}
        ORDER BY {order_sql}
        LIMIT ? OFFSET ?
    """, [owner] + params + [per, page * per]).fetchall()
    conn.close()
    games = []
    for r in rows:
        g = db.row_to_game(r)
        g.pop("description", None)
        games.append(g)
    return {"games": games, "page": page, "per": per, "total": total,
            "has_more": (page + 1) * per < total}


@app.get("/api/games/{oid}/description")
def game_description(oid: str):
    """Descripción completa (lazy): la trae de BGG y cachea si falta."""
    conn = db.connect()
    row = conn.execute("SELECT description FROM games WHERE objectid=?", (oid,)).fetchone()
    desc = row["description"] if row else None
    if not desc:
        try:
            rec = bgg.fetch(oid)
            desc = rec.get("description")
            if desc:
                conn.execute("UPDATE games SET description=? WHERE objectid=?", (desc, oid))
                conn.commit()
        except Exception:
            desc = None
    conn.close()
    return {"description": desc or ""}


@app.post("/api/games/{oid}/state")
def set_state(oid: str, payload: dict = Body(...), owner: int = 0):
    allowed = {"own", "wishlist", "wishlist_priority", "wishlist_comment",
               "user_rating", "numplays", "notes"}
    patch = {k: v for k, v in payload.items() if k in allowed}
    if not patch:
        return JSONResponse({"error": "nada para actualizar"}, status_code=400)
    if patch.get("own") == 1:
        patch["wishlist"] = 0
    if patch.get("wishlist") == 1:
        patch["own"] = 0
    conn = db.connect()
    owner = owner or db.get_me(conn)
    db.set_holding(conn, owner, oid, patch)
    conn.commit()
    games = {g["objectid"]: g for g in db.games_for_owner(conn, owner)}
    conn.close()
    return games.get(oid, {"ok": True})


# ---------------- alta / búsqueda ----------------

@app.get("/api/search")
def search_bgg(q: str):
    try:
        return {"results": bgg.search(q)}
    except Exception as e:  # noqa
        return JSONResponse({"error": str(e)}, status_code=502)


@app.post("/api/games/add")
def add_game(payload: dict = Body(...), owner: int = 0):
    raw = str(payload.get("objectid") or payload.get("query") or "")
    oid = bgg.parse_id(raw)
    if not oid:
        return JSONResponse({"error": "no pude interpretar el id/URL"}, status_code=400)
    try:
        rec = bgg.fetch(oid)
    except Exception as e:  # noqa
        return JSONResponse({"error": f"BGG no respondió: {e}"}, status_code=502)
    conn = db.connect()
    owner = owner or db.get_me(conn)
    db.upsert_bgg(conn, rec)
    as_status = payload.get("status", "wishlist")
    st = {"added_manually": 1}
    if as_status == "own":
        st["own"], st["wishlist"] = 1, 0
    else:
        st["own"], st["wishlist"] = 0, 1
        st["wishlist_priority"] = int(payload.get("wishlist_priority", 3))
    db.set_holding(conn, owner, oid, st)
    conn.commit()
    games = {g["objectid"]: g for g in db.games_for_owner(conn, owner)}
    conn.close()
    return games.get(oid, {"ok": True})


# ---------------- import / export ----------------

@app.post("/api/import")
async def import_csv(file: UploadFile = File(...), owner_name: str = Form(""),
                     mode: str = Form("both"), new_profile: str = Form("0"),
                     owner_id: int = Form(0)):
    """Importa un CSV (formato BGG o de esta app: se lee por nombre de columna).
    Destino: perfil existente (owner_id), uno nuevo (new_profile+owner_name), o el mío."""
    raw = await file.read()
    text = raw.decode("utf-8-sig", errors="replace")
    conn = db.connect()
    if new_profile == "1" and owner_name.strip():
        target = db.ensure_owner(conn, owner_name.strip(), is_me=0)
    elif owner_id:
        target = owner_id
    else:
        target = db.get_me(conn)
    conn.close()
    res = seedmod.import_csv(text, target, mode=mode, fetch_missing=False)
    res["owner_id"] = target
    return res


@app.post("/api/reseed")
def reseed_catalog_ep():
    """Recarga el catálogo top-5000 desde el preseed del repo (útil tras un `git pull` que lo
    actualizó). Solo toca el catálogo de juegos; NO toca tu colección (holdings). Pasada A de
    'Actualizar todo'."""
    return seedmod.reseed_catalog()


@app.post("/api/update/refresh")
def update_refresh_ep(limit: int = 25, days: int = 30):
    """Pasada B de 'Actualizar todo': re-baja de BGG (por lotes, resumible) SOLO los juegos
    tenidos fuera del preseed y vencidos (>`days`). Diff real — no re-baja el top-5000 (eso lo
    hizo A desde el archivo local) ni lo que ya está fresco."""
    return seedmod.refresh_out_of_preseed(limit=limit, days=days)


@app.post("/api/update/gc")
def update_gc_ep():
    """Pasada C de 'Actualizar todo': GC de huérfanos (ni preseed ni tenidos)."""
    return seedmod.gc_run()


@app.post("/api/reconcile/preview")
async def reconcile_preview_ep(file: UploadFile = File(...), owner_id: int = Form(...)):
    """Dry-run del re-import: agrupa altas / cambios / bajas / sin-cambios para que el usuario
    confirme antes de tocar nada."""
    text = (await file.read()).decode("utf-8-sig", errors="replace")
    return seedmod.reconcile_preview(text, owner_id)


@app.post("/api/reconcile/apply")
async def reconcile_apply_ep(file: UploadFile = File(...), owner_id: int = Form(...),
                             remove: str = Form("")):
    """Aplica el re-import: altas+cambios siempre; bajas solo las confirmadas (`remove`, CSV de
    objectids); después GC."""
    text = (await file.read()).decode("utf-8-sig", errors="replace")
    ids = [x.strip() for x in remove.split(",") if x.strip()]
    return seedmod.reconcile_apply(text, owner_id, confirm_removals=ids)


@app.get("/api/enrich")
def enrich(owner: int = 0, limit: int = 20):
    """Enriquecimiento perezoso: completa datos BGG faltantes (imagen/diseñadores)
    de los juegos del perfil. Se llama en loop desde el onboarding/import."""
    conn = db.connect()
    owner = owner or db.get_me(conn)
    rows = conn.execute("""
        SELECT DISTINCT g.objectid FROM games g
        JOIN holdings h ON h.objectid=g.objectid AND h.owner_id=?
        WHERE g.image IS NULL OR g.image='' OR g.designers IS NULL OR g.designers='[]'
    """, (owner,)).fetchall()
    remaining_ids = [r["objectid"] for r in rows]
    done = 0
    for oid in remaining_ids[:limit]:
        try:
            db.upsert_bgg(conn, bgg.fetch(oid))
            done += 1
        except Exception:
            pass
    conn.commit()
    conn.close()
    return {"enriched": done, "remaining": max(0, len(remaining_ids) - done)}


@app.get("/api/freshness")
def freshness(owner: int = 0):
    """Cuán viejos están los datos del perfil (rankings cambian de a poco)."""
    conn = db.connect()
    owner = owner or db.get_me(conn)
    row = conn.execute("""
        SELECT MIN(g.fetched_at) oldest, COUNT(*) total FROM games g
        JOIN holdings h ON h.objectid=g.objectid AND h.owner_id=?
        WHERE g.fetched_at IS NOT NULL AND g.fetched_at>0
    """, (owner,)).fetchone()
    conn.close()
    oldest = row["oldest"]
    days = int((time.time() - oldest) / 86400) if oldest else None
    return {"oldest_days": days, "total": row["total"]}


@app.get("/api/refresh")
def refresh(owner: int = 0, limit: int = 25, days: int = 30):
    """Re-baja datos de BGG (ranking incluido) de los juegos más viejos que `days`."""
    conn = db.connect()
    owner = owner or db.get_me(conn)
    cutoff = int(time.time()) - days * 86400
    rows = conn.execute("""
        SELECT DISTINCT g.objectid FROM games g
        JOIN holdings h ON h.objectid=g.objectid AND h.owner_id=?
        WHERE g.fetched_at IS NULL OR g.fetched_at < ?
        ORDER BY g.fetched_at ASC
    """, (owner, cutoff)).fetchall()
    ids = [r["objectid"] for r in rows]
    done = 0
    for oid in ids[:limit]:
        try:
            db.upsert_bgg(conn, bgg.fetch(oid))
            done += 1
        except Exception:
            pass
    conn.commit()
    conn.close()
    return {"refreshed": done, "remaining": max(0, len(ids) - done)}


EXPORT_COLS = ["objectname", "objectid", "rating", "numplays", "weight", "own",
               "wishlist", "wishlistpriority", "wishlistcomment", "minplayers",
               "maxplayers", "playingtime", "yearpublished", "rank", "avgweight"]


@app.get("/api/export.csv")
def export_csv(owner: int = 0):
    conn = db.connect()
    owner = owner or db.get_me(conn)
    name = conn.execute("SELECT name FROM owners WHERE id=?", (owner,)).fetchone()
    name = name["name"] if name else "coleccion"
    games = db.games_for_owner(conn, owner)
    conn.close()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(EXPORT_COLS)
    for g in games:
        if not (g.get("own") or g.get("wishlist")):
            continue
        w.writerow([
            g.get("name"), g.get("objectid"), g.get("user_rating") or 0,
            g.get("numplays") or 0, g.get("weight") or 0, g.get("own") or 0,
            g.get("wishlist") or 0, g.get("wishlist_priority") or 3,
            g.get("wishlist_comment") or "", g.get("minplayers") or "",
            g.get("maxplayers") or "", g.get("maxplaytime") or "",
            g.get("yearpublished") or "", g.get("rank_overall") or "", g.get("weight") or 0,
        ])
    buf.seek(0)
    fname = f"bg-{name}-{time.strftime('%Y%m%d')}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ---------------- stats ----------------

@app.get("/api/stats")
def stats(owner: int = 0, source: str = "own"):
    """Estadísticas del perfil. source='own' (biblioteca) | 'wishlist'."""
    conn = db.connect()
    owner = owner or db.get_me(conn)
    games = db.games_for_owner(conn, owner)
    conn.close()
    owned = [g for g in games if g.get("own")]
    wish = [g for g in games if g.get("wishlist")]
    sel = wish if source == "wishlist" else owned   # sobre qué conjunto se calculan las stats
    prof = advisor.collection_profile(sel)

    by_type, by_designer, by_weight = {}, {}, [0] * 5
    for g in sel:
        for s in g.get("subdomains", []):
            by_type[s] = by_type.get(s, 0) + 1
        for d in g.get("designers", []):
            by_designer[d["name"]] = by_designer.get(d["name"], 0) + 1
        b = advisor.weight_bucket(g.get("weight"))
        if b is not None:
            by_weight[b] += 1
    top_designers = sorted(by_designer.items(), key=lambda x: -x[1])[:8]
    gaps = [n for n, c in prof["player_cover"].items() if c <= 2 and n <= 8]

    def has_num(g, n):
        return n in (g.get("best_players") or []) or n in (g.get("recommended_players") or [])

    highlights = {
        "coop": prof["coop"],
        "party": by_type.get("Party Games", 0),
        "two": sum(1 for g in sel if 2 in (g.get("best_players") or [])),      # ideales para 2
        "big": sum(1 for g in sel if any(has_num(g, n) for n in (5, 6, 7, 8))),
        "quick": sum(1 for g in sel if 0 < (g.get("maxplaytime") or 0) <= 30),
        "long": sum(1 for g in sel if (g.get("maxplaytime") or 0) >= 120),   # para toda la noche
    }

    # distribución por edad recomendada (editorial), en intervalos
    by_age = {"4–8": 0, "9–12": 0, "13+": 0}
    for g in sel:
        a = g.get("minage_publisher")
        if not a:
            continue
        if a <= 8:
            by_age["4–8"] += 1
        elif a <= 12:
            by_age["9–12"] += 1
        else:
            by_age["13+"] += 1

    # resumen enriquecido del conjunto
    weights = [g["weight"] for g in sel if g.get("weight")]
    times = sorted(g["maxplaytime"] for g in sel if g.get("maxplaytime"))
    years = [int(g["yearpublished"]) for g in sel if str(g.get("yearpublished") or "").isdigit()]
    mechanics = {m for g in sel for m in (g.get("mechanics") or [])}
    summary = {
        "avg_weight": round(sum(weights) / len(weights), 2) if weights else None,
        "median_time": times[len(times) // 2] if times else None,
        "designers": len(by_designer),
        "mechanics": len(mechanics),
        "year_min": min(years) if years else None,
        "year_max": max(years) if years else None,
    }

    return {
        "source": source,
        "counts": {"own": len(owned), "wishlist": len(wish)},
        "by_type": by_type, "by_weight": by_weight, "by_age": by_age,
        "weight_labels": advisor.WEIGHT_LABELS,
        "player_cover": prof["player_cover"],
        "top_designers": top_designers, "coop": prof["coop"], "gaps": gaps,
        "highlights": highlights, "summary": summary,
    }


# ---------------- advisor ----------------

@app.post("/api/advisor")
def advisor_ep(payload: dict = Body(...)):
    mode = payload.get("mode", "play")
    engine = payload.get("engine", "rules")
    answers = payload.get("answers", {}) or {}
    owner = payload.get("owner") or _me()
    try:
        return advisor.recommend(mode, answers, engine=engine,
                                 limit=int(payload.get("limit", 4)), owner_id=owner)
    except Exception as e:  # noqa
        return JSONResponse({"error": str(e)}, status_code=500)


# ---------------- config ----------------

@app.get("/api/config")
def get_config():
    return appconfig.public()


@app.post("/api/config")
def set_config(payload: dict = Body(...)):
    appconfig.save(payload)
    return appconfig.public()


# ---------------- estático ----------------

@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(os.path.join(WEB, "index.html"))


app.mount("/", StaticFiles(directory=WEB), name="web")
