"""BG Library — backend FastAPI (multi-perfil)."""
import csv
import io
import json
import os
import re
import time

from fastapi import FastAPI, Body, Depends, UploadFile, File, Form, Query, BackgroundTasks
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


def get_conn():
    """Conexión SQLite por request, cerrada SIEMPRE (dependencia de FastAPI).

    Antes cada ruta hacía `conn = db.connect()` … `conn.close()` al final, sin try/finally: si algo
    levantaba en el medio —una query mal formada, un JSON corrupto al parsear una fila— la conexión
    quedaba viva. Con una transacción de escritura abierta eso bloquea TODAS las escrituras
    siguientes hasta que el recolector la junte, y el síntoma que ve el usuario es un
    "database is locked" que aparece y desaparece sin patrón.

    Ojo: una conexión abierta SIN transacción no retiene ningún lock, así que sostenerla durante
    una llamada de red no molesta. Lo que sí molestaba —transacciones abiertas durante fetches de
    BGG— se arregló aparte, commiteando por ítem en update/enrich/refresh."""
    conn = db.connect()
    try:
        yield conn
    finally:
        conn.close()


def _is_top(rank_overall):
    """True si el rank lo pone en el top canónico (rank<=TOP_N). El front usa `is_top` para decidir
    si al desmarcar a 'Ninguno' pide confirmación (fuera del top => se borra de la base)."""
    return rank_overall is not None and rank_overall <= db.TOP_N


def _me():
    conn = db.connect()
    try:
        return db.get_me(conn)
    finally:
        conn.close()


# ---------------- owners / perfiles ----------------

@app.get("/api/owners")
def owners(conn=Depends(get_conn)):
    db.get_me(conn)  # garantiza que exista 'Vos'
    return {"owners": db.list_owners(conn)}


@app.post("/api/owners")
def create_owner(payload: dict = Body(...), conn=Depends(get_conn)):
    name = (payload.get("name") or "").strip()
    if not name:
        return JSONResponse({"error": "falta el nombre"}, status_code=400)
    oid = db.ensure_owner(conn, name, is_me=1 if payload.get("is_me") else 0)
    return {"id": oid, "name": name}


@app.patch("/api/owners/{oid}")
def rename_owner(oid: int, payload: dict = Body(...), conn=Depends(get_conn)):
    """Renombra un perfil. `owners.name` es UNIQUE: sin este chequeo, renombrar a un nombre ya usado
    reventaba con IntegrityError -> 500 crudo (y el front lo comía en silencio)."""
    name = (payload.get("name") or "").strip()
    if not name:
        return JSONResponse({"error": "falta el nombre"}, status_code=400)
    if conn.execute("SELECT 1 FROM owners WHERE name=? AND id<>?", (name, oid)).fetchone():
        return JSONResponse({"error": f"ya existe un perfil llamado «{name}»"}, status_code=409)
    if not conn.execute("SELECT 1 FROM owners WHERE id=?", (oid,)).fetchone():
        return JSONResponse({"error": "ese perfil no existe"}, status_code=404)
    conn.execute("UPDATE owners SET name=? WHERE id=?", (name, oid))
    conn.commit()
    return {"ok": True, "name": name}


@app.post("/api/owners/{oid}/reset")
def reset_owner(oid: int, conn=Depends(get_conn)):
    """Vacía la colección de un perfil (borra todos sus holdings) sin borrar el perfil. Pensado
    para 'empezar de cero' con tu propio perfil (que no se puede borrar). Después corre el GC para
    limpiar del catálogo los juegos que quedaron sin dueño y no son top-5000."""
    n = conn.execute("SELECT COUNT(*) c FROM holdings WHERE owner_id=?", (oid,)).fetchone()["c"]
    conn.execute("DELETE FROM holdings WHERE owner_id=?", (oid,))
    conn.commit()
    orphans = db.gc_orphans(conn, db.top_ids(conn))
    conn.commit()
    return {"ok": True, "cleared": n, "gc": len(orphans)}


@app.delete("/api/owners/{oid}")
def delete_owner(oid: int, conn=Depends(get_conn)):
    row = conn.execute("SELECT is_me FROM owners WHERE id=?", (oid,)).fetchone()
    if row and row["is_me"]:
        return JSONResponse({"error": "no se puede borrar tu perfil"}, status_code=400)
    conn.execute("DELETE FROM holdings WHERE owner_id=?", (oid,))
    conn.execute("DELETE FROM owners WHERE id=?", (oid,))
    conn.commit()
    return {"ok": True}


# ---------------- juegos ----------------

@app.get("/api/games")
def list_games(owner: int = 0, conn=Depends(get_conn)):
    """Solo tu colección (own + wishlist). El catálogo completo NO viaja acá; el
    browse del top vive en /api/bgg (paginado). Mantiene el payload liviano."""
    owner = owner or db.get_me(conn)
    games = [g for g in db.games_for_owner(conn, owner, top_n=db.TOP_N)
             if g.get("own") or g.get("wishlist")]
    # expansiones del perfil por juego (ítem 3): pintan la sección de la ficha y habilitan el
    # buscador por nombre de expansión (Biblioteca matchea expas 📦, Wishlist expas ⭐).
    exps = db.expansions_for(conn, owner)
    for g in games:
        g.pop("description", None)   # descripción larga on-demand en la ficha
        g["expansions"] = exps.get(g["objectid"], [])
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
# Grupo "Mecánicas" (ítem 9): eje ortogonal a los 8 subdominios. OR dentro del grupo, AND con el
# resto de los filtros. Cooperativo se detecta igual que advisor._is_coop (mechanics O categories con
# "Cooperative"/"Co-operative"); el resto matchea el string canónico exacto dentro del JSON mechanics.
_COOP_WHERE = ("(g.mechanics LIKE '%Cooperative%' OR g.categories LIKE '%Cooperative%' "
               "OR g.mechanics LIKE '%Co-operative%' OR g.categories LIKE '%Co-operative%')")


def _like_escape(s):
    """Escapa los comodines de LIKE en texto del usuario, para usar con ESCAPE '\\'. La barra va
    primero (si no, se re-escaparían las barras que agregamos después)."""
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _mech_where(mechs):
    """Cláusula OR para el grupo de mecánicas + sus params ligados. `mechs`: strings canónicos de
    BGG. Coop es especial (mira mechanics+categories); el resto matchea `mechanics LIKE '%"nombre"%'`
    (el JSON guarda los nombres entrecomillados). Devuelve ('(...)', [params])."""
    clauses, params = [], []
    for m in mechs:
        if m == "Cooperative Game":
            clauses.append(_COOP_WHERE)
        else:
            clauses.append("g.mechanics LIKE ?")
            params.append(f'%"{m}"%')
    return "(" + " OR ".join(clauses) + ")", params


def _members_expr(col):
    """Normaliza un array JSON ('[2, 3, 4]') a ',2,3,4,' para probar pertenencia con LIKE
    (sin importar los espacios que mete json.dumps)."""
    return f"(',' || replace(replace(replace(COALESCE({col},''),' ',''),'[',''),']','') || ',')"


def _fit_case(n):
    """Expresión SQL con el tier de ajuste a N jugadores: 0=ideal (best), 1=va bien (recommended),
    2=se banca (dentro de min/max), 3=no entra. `n` es un entero ya tipado por el query → seguro
    de interpolar. Espeja playerFit del front (ítem 9)."""
    best = f"{_members_expr('g.best_players')} LIKE '%,{n},%'"
    rec = f"{_members_expr('g.recommended_players')} LIKE '%,{n},%'"
    return (f"CASE WHEN {best} THEN 0 WHEN {rec} THEN 1 "
            f"WHEN g.minplayers <= {n} AND g.maxplayers >= {n} THEN 2 ELSE 3 END")


@app.get("/api/bgg")
def bgg_browse(owner: int = 0, page: int = 0, per: int = 48, q: str = "",
               types: str = "", mechanics: str = "", players: int = 0,
               time_f: str = Query("", alias="time"), weight: str = "",
               designer: str = "",
               sort: str = "rank", direction: int = Query(1, alias="dir"),
               conn=Depends(get_conn)):
    """Browse del top de BGG (por rank) con tu estado (own/wishlist) por juego.
    Filtros y orden server-side (mismos criterios que la Biblioteca). Paginado."""
    per = max(1, min(per, 200))    # tope: sin él, ?per=999999 vuelca el catálogo entero en una request
    page = max(0, page)            # un page negativo daría un OFFSET negativo
    owner = owner or db.get_me(conn)
    where = ["g.rank_overall IS NOT NULL", "g.rank_overall > 0"]
    params = []
    if q.strip():
        # matchea nombre inglés o español (ítem 1): "la resistencia" encuentra The Resistance.
        # Se escapan los comodines de LIKE ('%' y '_'): sin eso, buscar "50%" matcheaba TODO.
        like = f"%{_like_escape(q.strip())}%"
        where.append("(g.name LIKE ? ESCAPE '\\' COLLATE NOCASE "
                     "OR g.es_name LIKE ? ESCAPE '\\' COLLATE NOCASE)")
        params += [like, like]
    sel_types = [t.strip() for t in types.split(",") if t.strip()]
    if sel_types:
        # subdomains se guarda como JSON: ["Strategy Games", ...]; matcheo por el nombre entrecomillado
        where.append("(" + " OR ".join("g.subdomains LIKE ?" for _ in sel_types) + ")")
        params += [f'%"{t}"%' for t in sel_types]
    mechs = [m for m in mechanics.split("~") if m.strip()]   # '~' separa (los nombres traen comas/barras)
    if mechs:
        clause, mparams = _mech_where(mechs)
        where.append(clause)
        params += mparams
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
    if designer.strip():
        # designers se guarda como JSON [{"name": "..."}]; matcheo el nombre entrecomillado
        # (las comillas evitan falsos positivos por substring, p. ej. "Knizia" vs "Reiner Knizia")
        where.append("g.designers LIKE ?")
        params.append(f'%"{designer.strip()}"%')
    where_sql = " AND ".join(where)

    if sort == "fit" and players:
        # "Mejor para N jug." (ítem 9): ideal→va bien→se banca, desempate por rank BGG
        order_sql = f"{_fit_case(players)} ASC, g.rank_overall ASC"
    else:
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
    games = []
    for r in rows:
        g = db.row_to_game(r)
        g.pop("description", None)
        rk = g.get("rank_overall")
        g["is_top"] = rk is not None and rk <= db.TOP_N
        games.append(g)
    return {"games": games, "page": page, "per": per, "total": total,
            "has_more": (page + 1) * per < total}


@app.get("/api/games/{oid}/description")
def game_description(oid: str, conn=Depends(get_conn)):
    """Descripción completa (lazy): la trae de BGG y cachea si falta."""
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
    return {"description": desc or ""}


@app.post("/api/games/{oid}/state")
def set_state(oid: str, payload: dict = Body(...), owner: int = 0, conn=Depends(get_conn)):
    allowed = {"own", "wishlist", "wishlist_priority", "wishlist_comment",
               "user_rating", "numplays", "notes"}
    patch = {k: v for k, v in payload.items() if k in allowed}
    if not patch:
        return JSONResponse({"error": "nada para actualizar"}, status_code=400)
    if patch.get("own") == 1:
        patch["wishlist"] = 0
    if patch.get("wishlist") == 1:
        patch["own"] = 0
    owner = owner or db.get_me(conn)
    db.set_holding(conn, owner, oid, patch)
    conn.commit()
    # desmarcado a "Ninguno": si el juego está FUERA del top y nadie lo tiene/desea, se va del
    # catálogo (huérfano). En el top => queda en la base. Ver ítem 7 del ciclo de vida de datos.
    if patch.get("own") == 0 and patch.get("wishlist") == 0:
        # las expansiones cuelgan del juego madre: si lo sacás de tu colección, se van con él
        # (para este perfil). Sin base own/wish no se puede tener/desear su expansión (ítem 3).
        conn.execute("DELETE FROM expansions WHERE owner_id=? AND base_oid=?", (owner, oid))
        conn.commit()
        if db.remove_if_orphan(conn, oid):
            conn.commit()
            return {"ok": True, "removed": True, "objectid": oid}
    g = db.game_with_state(conn, owner, oid)
    return g or {"ok": True, "removed": True, "objectid": oid}


# ---------------- alta / búsqueda ----------------

@app.get("/api/search")
def search_bgg(q: str, conn=Depends(get_conn)):
    """Búsqueda híbrida local-first (ítem 8): BGG hace el matching (encuentra bien, incluso lo que
    no tenés), la base local hidrata con imagen/datos válidos los que ya están (thumbnail que carga,
    instantáneo). Los que no están: sin thumbnail (placeholder en el front), la data completa se
    trae recién al abrir la ficha. NO se arma ninguna URL de imagen falsa."""
    try:
        cands = bgg.search(q, n=6)
    except Exception as e:  # noqa — la red puede fallar; queda logueado en bgg._get
        return JSONResponse({"error": str(e)}, status_code=502)
    ids = [c["objectid"] for c in cands]
    local = {}
    if ids:
        ph = ",".join("?" for _ in ids)
        for r in conn.execute(
                f"SELECT objectid, thumb, image FROM games WHERE objectid IN ({ph})", ids):
            local[r["objectid"]] = r
    for c in cands:
        loc = local.get(c["objectid"])
        c["local"] = loc is not None
        c["thumb"] = (loc["thumb"] or loc["image"]) if loc else None
    return {"results": cands}


@app.get("/api/lookup/{oid}")
def lookup_game(oid: str, owner: int = 0, conn=Depends(get_conn)):
    """Trae un juego para MOSTRAR su ficha (ítem 8). Si ya está en la base, devuelve el registro
    local con tu estado (`saved=True`). Si no, lo trae de BGG SIN persistirlo (`saved=False`): la
    ficha se muestra con "Ninguno" y recién se guarda si marcás own/wish. Así, si cerrás sin marcar,
    no queda nada en la base (no genera huérfanos)."""
    owner = owner or db.get_me(conn)
    g = db.game_with_state(conn, owner, oid)
    if g is not None:
        g["is_top"] = _is_top(g.get("rank_overall"))
        return {"game": g, "saved": True}
    try:
        rec = bgg.fetch(oid)
    except Exception as e:  # noqa — red; queda logueado en bgg._get
        return JSONResponse({"error": f"BGG no respondió: {e}"}, status_code=502)
    rec.pop("alt_names", None)          # transitorio, no hace falta en la ficha
    rec["own"], rec["wishlist"] = 0, 0  # se muestra con "Ninguno" marcado
    rec["is_top"] = _is_top(rec.get("rank_overall"))
    # Expansión: la ficha se muestra rotulada "expansión de <madre>" y la única alta posible es
    # colgarla del juego madre (ítem 3); NUNCA entra al catálogo como juego suelto. `is_expansion`
    # y `expands` viajan para que el front arme esa ficha. Ver /api/games/{base}/expansions.
    if not rec.get("is_expansion"):
        rec.pop("expands", None)
    return {"game": rec, "saved": False, "is_expansion": bool(rec.get("is_expansion"))}


@app.post("/api/games/add")
def add_game(payload: dict = Body(...), owner: int = 0, conn=Depends(get_conn)):
    raw = str(payload.get("objectid") or payload.get("query") or "")
    oid = bgg.parse_id(raw)
    if not oid:
        return JSONResponse({"error": "no pude interpretar el id/URL"}, status_code=400)
    try:
        rec = bgg.fetch(oid)
    except Exception as e:  # noqa
        return JSONResponse({"error": f"BGG no respondió: {e}"}, status_code=502)
    # Guard: una expansión NO se da de alta como juego suelto (nunca entra a `games`/listas/stats).
    # Se agrega colgada de su juego madre desde la ficha (ítem 3). El front usa `expands` para ofrecer
    # "Agregar a <madre>".
    if rec.get("is_expansion"):
        return JSONResponse({"error": "es una expansión: agregala desde la ficha del juego base",
                             "is_expansion": True, "expands": rec.get("expands") or [],
                             "name": rec.get("name")}, status_code=400)
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
    g = db.game_with_state(conn, owner, oid)
    if g is not None:
        g["is_top"] = _is_top(g.get("rank_overall"))
    return g or {"ok": True}


# ---------------- expansiones (ítem 3) ----------------

@app.get("/api/games/{base}/expansions")
def list_expansions(base: str, owner: int = 0, conn=Depends(get_conn)):
    """Las expansiones que el perfil registró para el juego `base` (nombre + estado 📦/⭐). Pinta la
    sección "Expansiones" de la ficha. `can_add` = el base está en tu colección/wishlist."""
    owner = owner or db.get_me(conn)
    mine = db.expansions_for(conn, owner, base)
    can_add = db.owns_or_wishes(conn, owner, base)
    return {"mine": mine, "can_add": can_add}


@app.get("/api/games/{base}/expansions/catalog")
def expansions_catalog(base: str, owner: int = 0, conn=Depends(get_conn)):
    """Panel "＋": expansiones OFICIALES del juego (de BGG, lazy) mergeadas con tu estado, para
    marcar/editar. Incluye al final las tuyas que no figuren en la lista oficial (rarezas/promos)."""
    owner = owner or db.get_me(conn)
    can_add = db.owns_or_wishes(conn, owner, base)
    mine = {e["exp_oid"]: e for e in db.expansions_for(conn, owner, base)}
    try:
        official = bgg.expansions_of(base)
    except Exception as e:  # noqa — red; queda logueado en bgg._get
        return JSONResponse({"error": f"BGG no respondió: {e}"}, status_code=502)
    items = [{"id": o["id"], "name": o["name"], "state": (mine.get(o["id"]) or {}).get("state")}
             for o in official]
    seen = {o["id"] for o in official}
    for exp_oid, e in mine.items():
        if exp_oid not in seen:
            items.append({"id": exp_oid, "name": e["name"], "state": e["state"]})
    return {"items": items, "can_add": can_add}


@app.post("/api/games/{base}/expansions")
def set_expansion_ep(base: str, payload: dict = Body(...), owner: int = 0, conn=Depends(get_conn)):
    """Agrega/edita una expansión colgada del juego `base`. Gate: el base debe estar en own o wish.
    `state` ∈ {'own','wish'}. Solo guarda nombre + estado (no trackea prioridad)."""
    exp_oid = str(payload.get("exp_oid") or "").strip()
    name = (payload.get("name") or "").strip()
    state = payload.get("state") or "wish"
    if not exp_oid or not name:
        return JSONResponse({"error": "falta exp_oid o name"}, status_code=400)
    owner = owner or db.get_me(conn)
    if not db.owns_or_wishes(conn, owner, base):
        return JSONResponse({"error": "agregá primero el juego base a tu colección o wishlist"},
                            status_code=400)
    # short_description: del payload (la ficha de búsqueda ya la tiene) o, si no, un fetch
    # best-effort (una vez; queda guardada). Nunca voltea el alta si BGG no responde.
    short_desc = payload.get("short_description")
    if not short_desc:
        try:
            short_desc = bgg.fetch(exp_oid).get("short_description")
        except Exception:  # noqa — la data de la expa es opcional; el nombre+estado alcanzan
            short_desc = None
    db.set_expansion(conn, owner, base, exp_oid, name, state, short_description=short_desc)
    conn.commit()
    return {"mine": db.expansions_for(conn, owner, base), "can_add": True}


@app.delete("/api/games/{base}/expansions/{exp_oid}")
def remove_expansion_ep(base: str, exp_oid: str, owner: int = 0, conn=Depends(get_conn)):
    """Quita una expansión del juego (para este perfil)."""
    owner = owner or db.get_me(conn)
    db.remove_expansion(conn, owner, base, exp_oid)
    conn.commit()
    mine = db.expansions_for(conn, owner, base)
    can_add = db.owns_or_wishes(conn, owner, base)
    return {"mine": mine, "can_add": can_add}


# ---------------- recomendaciones guardadas del advisor (opt-in) ----------------

@app.get("/api/saved")
def list_saved(owner: int = 0, conn=Depends(get_conn)):
    """Metadata de las recomendaciones guardadas del perfil (más nuevas primero)."""
    owner = owner or db.get_me(conn)
    recs = db.saved_recs_for(conn, owner)
    return {"saved": recs}


@app.post("/api/saved")
def save_rec_ep(payload: dict = Body(...), owner: int = 0, conn=Depends(get_conn)):
    """Guarda una recomendación (opt-in). Body: {title, mode, engine, result}. `result` es el
    snapshot del resultado tal cual se mostró (picks, etc.) — se guarda idéntico."""
    result = payload.get("result")
    if not isinstance(result, dict) or not result.get("picks"):
        return JSONResponse({"error": "no hay recomendación para guardar"}, status_code=400)
    title = (payload.get("title") or "Recomendación").strip()
    mode = payload.get("mode") or result.get("mode") or "play"
    engine = payload.get("engine") or result.get("engine") or "rules"
    owner = owner or db.get_me(conn)
    rid = db.save_rec(conn, owner, title, mode, engine, json.dumps(result, ensure_ascii=False))
    conn.commit()
    return {"id": rid}


@app.get("/api/saved/{rec_id}")
def get_saved(rec_id: int, owner: int = 0, conn=Depends(get_conn)):
    """Una recomendación guardada con su snapshot completo (para volver a mostrarla)."""
    owner = owner or db.get_me(conn)
    rec = db.get_saved_rec(conn, owner, rec_id)
    if not rec:
        return JSONResponse({"error": "no encontrada"}, status_code=404)
    return {"rec": rec}


@app.patch("/api/saved/{rec_id}")
def rename_saved(rec_id: int, payload: dict = Body(...), owner: int = 0, conn=Depends(get_conn)):
    """Renombra una recomendación guardada. Body: {title}."""
    title = (payload.get("title") or "").strip()
    if not title:
        return JSONResponse({"error": "falta el título"}, status_code=400)
    owner = owner or db.get_me(conn)
    db.rename_saved_rec(conn, owner, rec_id, title)
    conn.commit()
    return {"ok": True}


@app.delete("/api/saved/{rec_id}")
def delete_saved(rec_id: int, owner: int = 0, conn=Depends(get_conn)):
    """Borra una recomendación guardada del perfil."""
    owner = owner or db.get_me(conn)
    db.delete_saved_rec(conn, owner, rec_id)
    conn.commit()
    return {"ok": True}


# ---------------- import / export ----------------

@app.post("/api/import")
async def import_csv(background_tasks: BackgroundTasks,
                     file: UploadFile = File(...), owner_name: str = Form(""),
                     mode: str = Form("both"), new_profile: str = Form("0"),
                     owner_id: int = Form(0)):
    """Importa un CSV (formato BGG o de esta app: se lee por nombre de columna).
    Destino: perfil existente (owner_id), uno nuevo (new_profile+owner_name), o el mío.
    Tras importar, dispara en BACKGROUND la resolución de es_name de los pendientes (si hay key de
    Gemini) — no bloquea la respuesta; si no hay key, quedan NULL para el próximo update (ítem 1c)."""
    raw = await file.read()
    text = raw.decode("utf-8-sig", errors="replace")
    if new_profile == "1" and owner_name.strip():
        target = db.ensure_owner(conn, owner_name.strip(), is_me=0)
    elif owner_id:
        target = owner_id
    else:
        target = db.get_me(conn)
    res = seedmod.import_csv(text, target, mode=mode, fetch_missing=False)
    res["owner_id"] = target
    background_tasks.add_task(seedmod.resolve_es_names_runtime)  # alta masiva -> 1 batch si hay key
    return res


@app.post("/api/reseed")
def reseed_catalog_ep():
    """Recarga el catálogo top-5000 desde el preseed del repo (útil tras un `git pull` que lo
    actualizó). Solo toca el catálogo de juegos; NO toca tu colección (holdings). Pasada A de
    'Actualizar todo'."""
    return seedmod.reseed_catalog()


@app.post("/api/update")
def update_ep():
    """Ítem 4 — UN solo 'Actualizar': baja el dump de ranks más reciente (Range parcial ~10k),
    reconcilia el top (altas/rerank/bajas), pone al día por id la cola >10k de tu colección
    (refresh_tail) y resuelve es_name pendientes (si hay key). Un solo paso, sin re-bajar la data
    de cada juego. Si la descarga del dump falla (red), devuelve 502 con el detalle — el error queda
    logueado, no rompe la app."""
    try:
        return seedmod.update_ranks()
    except Exception as e:  # noqa — la red puede fallar; se reporta y quedó logueado en seed
        return JSONResponse({"error": f"no pude actualizar los rankings: {e}"}, status_code=502)


@app.get("/api/nudges")
def nudges(owner: int = 0, conn=Depends(get_conn)):
    """Datos para los nudges no-nag (ítem 5): cuántos es_name del perfil están pendientes, hace
    cuánto no se corre 'Actualizar', y si hay key de Gemini (el nudge de es_name solo aplica con
    key: sin ella no se pueden resolver). El front decide si mostrar y respeta el 'no molestar'."""
    import datetime
    owner = owner or db.get_me(conn)
    es_pending = db.count_es_pending(conn, owner)
    last_update = db.meta_get(conn, "last_update")
    stale_days = None
    if last_update:
        try:
            stale_days = (datetime.date.today() - datetime.date.fromisoformat(last_update)).days
        except ValueError:
            stale_days = None
    return {"es_pending": es_pending, "last_update": last_update, "stale_days": stale_days,
            "gemini_ready": appconfig.public()["gemini_key_set"]}


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
def enrich(owner: int = 0, limit: int = 20, conn=Depends(get_conn)):
    """Enriquecimiento perezoso: completa datos BGG faltantes (imagen/diseñadores)
    de los juegos del perfil. Se llama en loop desde el onboarding/import."""
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
            rec = bgg.fetch(oid)
            # Expansión colada por el import (el CSV de BGG no trae subtype): en vez de dejarla como
            # juego suelto, se cuelga del base own/wish o se descarta — como el alta a mano. Barato:
            # reusa este fetch, sin llamadas extra.
            if rec.get("is_expansion"):
                seedmod.absorb_expansion(conn, owner, rec)
            else:
                db.upsert_bgg(conn, rec)
            conn.commit()   # por juego: el lock de escritura no se retiene durante el próximo fetch
            done += 1
        except Exception:
            pass
    return {"enriched": done, "remaining": max(0, len(remaining_ids) - done)}


@app.get("/api/freshness")
def freshness(owner: int = 0, conn=Depends(get_conn)):
    """Cuán viejos están los datos del perfil (rankings cambian de a poco)."""
    owner = owner or db.get_me(conn)
    row = conn.execute("""
        SELECT MIN(g.fetched_at) oldest, COUNT(*) total FROM games g
        JOIN holdings h ON h.objectid=g.objectid AND h.owner_id=?
        WHERE g.fetched_at IS NOT NULL AND g.fetched_at>0
    """, (owner,)).fetchone()
    oldest = row["oldest"]
    days = int((time.time() - oldest) / 86400) if oldest else None
    return {"oldest_days": days, "total": row["total"]}


@app.get("/api/refresh")
def refresh(owner: int = 0, limit: int = 25, days: int = 30, conn=Depends(get_conn)):
    """Re-baja datos de BGG (ranking incluido) de los juegos más viejos que `days`."""
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
            conn.commit()   # por juego: el lock de escritura no se retiene durante el próximo fetch
            done += 1
        except Exception:
            pass
    return {"refreshed": done, "remaining": max(0, len(ids) - done)}


EXPORT_COLS = ["objectname", "objectid", "rating", "numplays", "weight", "own",
               "wishlist", "wishlistpriority", "wishlistcomment", "minplayers",
               "maxplayers", "playingtime", "yearpublished", "rank", "avgweight"]


@app.get("/api/export.csv")
def export_csv(owner: int = 0, conn=Depends(get_conn)):
    owner = owner or db.get_me(conn)
    name = conn.execute("SELECT name FROM owners WHERE id=?", (owner,)).fetchone()
    name = name["name"] if name else "coleccion"
    games = db.games_for_owner(conn, owner)
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
def stats(owner: int = 0, source: str = "own", conn=Depends(get_conn)):
    """Estadísticas del perfil. source='own' (biblioteca) | 'wishlist'."""
    owner = owner or db.get_me(conn)
    games = db.games_for_owner(conn, owner)
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

_ASSET_V = re.compile(r"/(styles\.css|app\.js)\?v=\d+")


@app.get("/", response_class=HTMLResponse)
def index():
    """Sirve index.html con el cache-buster de styles.css/app.js derivado del mtime del archivo.

    Antes ese número (?v=84) se subía A MANO en cada cambio de CSS/JS. No versiona nada —no se
    guarda ninguna copia—: solo cambia la URL para que el navegador no reuse la vieja. Como el
    middleware ya manda `no-store`, el número era redundante salvo por iOS Safari, que a veces
    lo ignora al volver con el botón atrás. Derivándolo del mtime se conserva ese seguro y
    desaparece el paso manual (que se olvidaba, y entonces el celular seguía con el CSS viejo).
    El número que quede escrito en el archivo ya no importa: se reemplaza al servir."""
    with open(os.path.join(WEB, "index.html"), encoding="utf-8") as f:
        html = f.read()

    def stamp(m):
        asset = m.group(1)
        try:
            return f"/{asset}?v={int(os.path.getmtime(os.path.join(WEB, asset)))}"
        except OSError:
            return m.group(0)   # si el archivo no está, dejamos lo que había

    return HTMLResponse(_ASSET_V.sub(stamp, html))


app.mount("/", StaticFiles(directory=WEB), name="web")
