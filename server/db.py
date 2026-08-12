"""Capa SQLite. Multi-colección:
   - games:    catálogo compartido (datos BGG)
   - owners:   dueños (Vos + amigos)
   - holdings: qué tiene cada dueño (own/wishlist/prioridad/...)
"""
import json
import os
import sqlite3
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DB_PATH = os.environ.get("BG_DB_PATH") or os.path.join(ROOT, "bg.db")

# Tamaño del top canónico. La PERTENENCIA al top es DINÁMICA: "está en el top" = rank_overall<=TOP_N
# en la propia base (que el update reconcilia contra el dump del día), NO las claves del seed. El
# seed es solo la semilla de arranque. Ver seed.reconcile_top / gc_orphans.
TOP_N = 5000

JSON_FIELDS = {
    "best_players", "recommended_players", "subdomains", "categories",
    "mechanics", "families", "designers", "artists", "publishers",
}

OWNER_COLORS = ["#e0a458", "#4f8fd6", "#64b06a", "#e06692", "#a978d6", "#46b6ac", "#eab74b"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    objectid            TEXT PRIMARY KEY,
    name                TEXT,
    yearpublished       TEXT,
    href                TEXT,
    image               TEXT,
    thumb               TEXT,
    square              TEXT,
    short_description   TEXT,
    description         TEXT,
    minplayers          INTEGER,
    maxplayers          INTEGER,
    minplaytime         INTEGER,
    maxplaytime         INTEGER,
    minage_publisher    INTEGER,
    age_community       TEXT,
    language_dependence TEXT,
    best_players        TEXT,
    recommended_players TEXT,
    subdomains          TEXT,
    categories          TEXT,
    mechanics           TEXT,
    families            TEXT,
    designers           TEXT,
    artists             TEXT,
    publishers          TEXT,
    weight              REAL,
    weight_votes        TEXT,
    rating_avg          REAL,
    rating_bayes        REAL,
    users_rated         INTEGER,
    rank_overall        INTEGER,
    fetched_at          INTEGER
);
CREATE TABLE IF NOT EXISTS owners (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE,
    is_me      INTEGER DEFAULT 0,
    color      TEXT,
    created_at INTEGER
);
CREATE TABLE IF NOT EXISTS holdings (
    owner_id          INTEGER,
    objectid          TEXT,
    own               INTEGER DEFAULT 0,
    wishlist          INTEGER DEFAULT 0,
    wishlist_priority INTEGER DEFAULT 3,
    wishlist_comment  TEXT DEFAULT '',
    user_rating       REAL DEFAULT 0,
    numplays          INTEGER DEFAULT 0,
    notes             TEXT DEFAULT '',
    added_manually    INTEGER DEFAULT 0,
    updated_at        INTEGER DEFAULT 0,
    PRIMARY KEY (owner_id, objectid)
);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
-- Expansiones (ítem 3): cuelgan de un juego madre, POR PERFIL, y guardan SOLO el nombre + estado.
-- NO viven en `games` (nunca entran a listas/stats/advisor) y NO trackean prioridad de deseo.
CREATE TABLE IF NOT EXISTS expansions (
    owner_id          INTEGER,
    base_oid          TEXT,
    exp_oid           TEXT,
    name              TEXT,
    state             TEXT,          -- 'own' | 'wish'
    short_description TEXT,          -- lo único de "data" que guardamos (para el futuro advisor)
    updated_at        INTEGER DEFAULT 0,
    PRIMARY KEY (owner_id, base_oid, exp_oid)
);
CREATE TABLE IF NOT EXISTS saved_recs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    title       TEXT,
    mode        TEXT,                  -- 'play' | 'buy'
    engine      TEXT,                  -- 'gemini:...' | 'rules'
    payload     TEXT NOT NULL          -- snapshot JSON del resultado (picks, etc.)
);
CREATE INDEX IF NOT EXISTS idx_exp_owner_base ON expansions(owner_id, base_oid);
CREATE INDEX IF NOT EXISTS idx_saved_owner ON saved_recs(owner_id);
CREATE INDEX IF NOT EXISTS idx_h_owner ON holdings(owner_id);
CREATE INDEX IF NOT EXISTS idx_h_own ON holdings(own);
CREATE INDEX IF NOT EXISTS idx_h_wish ON holdings(wishlist);
CREATE INDEX IF NOT EXISTS idx_g_rank ON games(rank_overall);
"""


def meta_get(conn, key, default=None):
    """Lee un valor del key-value `meta` (flags de la app: last_update…)."""
    r = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return r["value"] if r else default


def meta_set(conn, key, value):
    """Upsert de un valor en `meta` (no commitea; lo hace el caller)."""
    conn.execute("INSERT INTO meta(key, value) VALUES(?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))


def count_es_pending(conn, owner_id):
    """Cuántos juegos de la colección del perfil (own o wishlist) tienen `es_name` sin resolver
    (NULL). Alimenta el nudge de nombres en español (ítem 5)."""
    row = conn.execute("""
        SELECT COUNT(*) c FROM games g
        JOIN holdings h ON h.objectid=g.objectid AND h.owner_id=?
        WHERE (h.own=1 OR h.wishlist=1) AND g.es_name IS NULL
    """, (owner_id,)).fetchone()
    return row["c"]


def connect():
    # check_same_thread=False: FastAPI corre las dependencias y la función de la ruta en hilos
    # DISTINTOS del threadpool, así que la conexión que abre `get_conn` se usa desde otro hilo y
    # SQLite lo rechaza por defecto ("SQLite objects created in a thread can only be used in that
    # same thread"). Es seguro acá porque cada request tiene su propia conexión y la usa un hilo a
    # la vez —nunca dos en simultáneo—: lo que se apaga es el chequeo de identidad de hilo, no la
    # serialización. Sin esto el fallo es INTERMITENTE (según qué hilo del pool toque), que es la
    # peor variante posible.
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init():
    conn = connect()
    conn.executescript(SCHEMA)
    _migrate(conn)
    conn.commit()
    conn.close()


def _migrate(conn):
    """Migraciones idempotentes para DBs viejas."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(games)").fetchall()}
    if "description" not in cols:
        conn.execute("ALTER TABLE games ADD COLUMN description TEXT")
    if "es_name" not in cols:
        # nombre en español (ítem 1). NULL = pendiente de resolver por LLM; una vez resuelto lleva
        # el castellano o el original repetido (nunca vuelve a NULL). No guardamos el resto de los
        # alt-names: no sirven.
        conn.execute("ALTER TABLE games ADD COLUMN es_name TEXT")
    # expansiones (ítem 3): agrega short_description a bases creadas antes de esa columna
    exp_cols = {r["name"] for r in conn.execute("PRAGMA table_info(expansions)").fetchall()}
    if exp_cols and "short_description" not in exp_cols:
        conn.execute("ALTER TABLE expansions ADD COLUMN short_description TEXT")


def _to_int(v, default=None):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


# ---------------- owners ----------------

def get_me(conn):
    r = conn.execute("SELECT * FROM owners WHERE is_me=1 ORDER BY id LIMIT 1").fetchone()
    if r:
        return r["id"]
    return ensure_owner(conn, "Vos", is_me=1)


def ensure_owner(conn, name, is_me=0):
    r = conn.execute("SELECT id FROM owners WHERE name=?", (name,)).fetchone()
    if r:
        return r["id"]
    n = conn.execute("SELECT COUNT(*) c FROM owners").fetchone()["c"]
    color = OWNER_COLORS[n % len(OWNER_COLORS)]
    cur = conn.execute("INSERT INTO owners (name,is_me,color,created_at) VALUES (?,?,?,?)",
                       (name, is_me, color, int(time.time())))
    conn.commit()
    return cur.lastrowid


def list_owners(conn):
    rows = conn.execute("""
        SELECT o.*,
          (SELECT COUNT(*) FROM holdings h WHERE h.owner_id=o.id AND h.own=1) own_count,
          (SELECT COUNT(*) FROM holdings h WHERE h.owner_id=o.id AND h.wishlist=1) wish_count
        FROM owners o ORDER BY o.is_me DESC, o.name COLLATE NOCASE
    """).fetchall()
    return [dict(r) for r in rows]


# ---------------- games ----------------

def row_to_game(row, owners_owning=None):
    g = dict(row)
    for f in JSON_FIELDS:
        raw = g.get(f)
        try:
            g[f] = json.loads(raw) if raw else []
        except (TypeError, json.JSONDecodeError):
            g[f] = []
    own = g.get("own") or 0
    wish = g.get("wishlist") or 0
    g["own"], g["wishlist"] = own, wish
    g["status"] = "own" if own else ("wishlist" if wish else "none")
    if owners_owning is not None:
        g["owners_owning"] = owners_owning
    return g


def games_for_owner(conn, owner_id, top_n=None):
    """Los juegos que el owner tiene/quiere (con datos del catálogo) + quién más los tiene.
    Parte de `holdings` (no del catálogo completo), así el costo escala con el tamaño de SU
    colección y no con el del catálogo — clave ahora que `games` tiene miles de filas.

    Si se pasa `top_n`, cada juego lleva `is_top` = (rank_overall<=top_n): el front lo usa para
    decidir si al desmarcar a 'Ninguno' pide confirmación (fuera del top => se borra de la base)."""
    rows = conn.execute("""
        SELECT g.*, h.own, h.wishlist, h.wishlist_priority, h.wishlist_comment,
               h.user_rating, h.numplays, h.notes, h.added_manually, h.updated_at
        FROM holdings h JOIN games g ON g.objectid=h.objectid
        WHERE h.owner_id=?
        ORDER BY g.name COLLATE NOCASE
    """, (owner_id,)).fetchall()

    # mapa objectid -> [nombres de owners que lo tienen (own=1)], solo para los juegos devueltos
    ids = [r["objectid"] for r in rows]
    owning = {}
    if ids:
        ph = ",".join("?" for _ in ids)
        for r in conn.execute(f"""
            SELECT h.objectid, o.name FROM holdings h JOIN owners o ON o.id=h.owner_id
            WHERE h.own=1 AND h.objectid IN ({ph})
        """, ids).fetchall():
            owning.setdefault(r["objectid"], []).append(r["name"])

    games = [row_to_game(dict(r), owners_owning=owning.get(r["objectid"], [])) for r in rows]
    if top_n is not None:
        for g in games:
            rk = g.get("rank_overall")
            g["is_top"] = rk is not None and rk <= top_n
    return games


def game_with_state(conn, owner_id, oid):
    """El juego (datos del catálogo) + estado del holding de ese owner, AUNQUE own=0 y wishlist=0.
    Devuelve None si el juego ya no está en el catálogo (p. ej. lo barrió el GC). Existe para que
    `set_state` pueda devolver el estado real tras desmarcar a 'Ninguno' — `games_for_owner` no
    sirve porque solo trae own/wishlist=1."""
    row = conn.execute("""
        SELECT g.*, h.own, h.wishlist, h.wishlist_priority, h.wishlist_comment,
               h.user_rating, h.numplays, h.notes, h.added_manually, h.updated_at
        FROM games g LEFT JOIN holdings h ON h.objectid=g.objectid AND h.owner_id=?
        WHERE g.objectid=?
    """, (owner_id, oid)).fetchone()
    return row_to_game(dict(row)) if row else None


def top_ids(conn, top_n=TOP_N):
    """Los objectid que están en el top canónico HOY = rank_overall<=top_n en la base. Fuente de
    verdad DINÁMICA de la pertenencia al top (el update la reconcilia contra el dump). Reemplaza al
    viejo set congelado de claves del seed. `keep_ids` del GC = top_ids ∪ tenidos."""
    return {r["objectid"] for r in conn.execute(
        "SELECT objectid FROM games WHERE rank_overall IS NOT NULL AND rank_overall<=?",
        (top_n,)).fetchall()}


def remove_if_orphan(conn, oid, top_n=TOP_N):
    """Borra un juego del catálogo si quedó *huérfano* al desmarcarse: está FUERA del top
    (rank_overall>top_n o NULL) y ningún perfil lo tiene ni lo desea. Versión dirigida a un solo oid
    de `gc_orphans` (para el desmarcado a 'Ninguno', ítem 7). Devuelve True si lo borró. NO
    commitea (lo hace el caller)."""
    row = conn.execute("SELECT rank_overall FROM games WHERE objectid=?", (oid,)).fetchone()
    rk = row["rank_overall"] if row else None
    if rk is not None and rk <= top_n:      # está en el top canónico -> se queda
        return False
    held = conn.execute(
        "SELECT 1 FROM holdings WHERE objectid=? AND (own=1 OR wishlist=1) LIMIT 1", (oid,)
    ).fetchone()
    if held:
        return False
    conn.execute("DELETE FROM holdings WHERE objectid=?", (oid,))
    conn.execute("DELETE FROM games WHERE objectid=?", (oid,))
    return True


def upsert_bgg(conn, rec):
    fields = [
        "objectid", "name", "es_name", "yearpublished", "href", "image", "thumb", "square",
        "short_description", "description", "minplayers", "maxplayers", "minplaytime", "maxplaytime",
        "minage_publisher", "age_community", "language_dependence",
        "best_players", "recommended_players", "subdomains", "categories",
        "mechanics", "families", "designers", "artists", "publishers",
        "weight", "weight_votes", "rating_avg", "rating_bayes", "users_rated",
        "rank_overall", "fetched_at",
    ]
    vals = {}
    for f in fields:
        v = rec.get(f)
        if f in ("description", "es_name") and v is None:
            continue  # no pisar con NULL lo ya resuelto (descripción larga / nombre en español)
        if f in JSON_FIELDS:
            v = json.dumps(v or [], ensure_ascii=False)
        if f in ("minplayers", "maxplayers", "minplaytime", "maxplaytime",
                 "minage_publisher", "users_rated", "rank_overall"):
            v = _to_int(v)
        vals[f] = v
    present = list(vals.keys())  # puede excluir 'description' si vino None
    exists = conn.execute("SELECT 1 FROM games WHERE objectid=?", (vals["objectid"],)).fetchone()
    if exists:
        sets = ", ".join(f"{f}=:{f}" for f in present if f != "objectid")
        conn.execute(f"UPDATE games SET {sets} WHERE objectid=:objectid", vals)
    else:
        cols = ", ".join(present)
        ph = ", ".join(f":{f}" for f in present)
        conn.execute(f"INSERT INTO games ({cols}) VALUES ({ph})", vals)


def _chunks(seq, n=400):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def gc_orphans(conn, keep_ids):
    """Recolección de huérfanos del catálogo (flujo de ciclo de vida de datos).

    Regla: el catálogo `games` = (top canónico, rank<=TOP_N) ∪ (todo lo que alguien tiene/quiere).
    Un juego es *huérfano* si NO está en `keep_ids` (pasar `top_ids(conn)`) y NO lo tiene ni lo
    desea ningún perfil (ningún holding con own=1 o wishlist=1). Los huérfanos se borran del
    catálogo (y se limpian holdings fantasma —own=0 y wishlist=0— que apunten a ellos). Devuelve
    la lista de objectids borrados.

    Es idempotente y barato; lo usan tanto 'Actualizar todo' (tras reconciliar el top) como la
    reconciliación de import. `keep_ids` es el rank VIGENTE tras el rerank: un juego que cayó del
    top (p. ej. #4998→#5025) ya no cumple rank<=TOP_N, así que si nadie lo tiene, se cae."""
    keep = set(keep_ids)
    held = {r["objectid"] for r in conn.execute(
        "SELECT DISTINCT objectid FROM holdings WHERE own=1 OR wishlist=1").fetchall()}
    all_ids = {r["objectid"] for r in conn.execute("SELECT objectid FROM games").fetchall()}
    orphans = [i for i in all_ids if i not in keep and i not in held]
    for chunk in _chunks(orphans):
        ph = ",".join("?" for _ in chunk)
        conn.execute(f"DELETE FROM holdings WHERE objectid IN ({ph})", chunk)
        conn.execute(f"DELETE FROM games WHERE objectid IN ({ph})", chunk)
    return orphans


# ---------------- expansiones (ítem 3) ----------------

def owns_or_wishes(conn, owner_id, base_oid):
    """True si el perfil tiene (own) o desea (wish) el juego `base_oid`. Gate para poder agregarle
    expansiones: una expa solo se cuelga de un juego que está en tu colección o wishlist."""
    return conn.execute(
        "SELECT 1 FROM holdings WHERE owner_id=? AND objectid=? AND (own=1 OR wishlist=1) LIMIT 1",
        (owner_id, base_oid)).fetchone() is not None


def expansions_for(conn, owner_id, base_oid=None):
    """Expansiones que el perfil registró. Si se pasa `base_oid`, solo las de ese juego; si no,
    TODAS las del perfil agrupadas por base_oid (para el payload de la colección → buscador por
    nombre de expansión). Devuelve, según el caso, una lista [{exp_oid, name, state}] o un dict
    {base_oid: [ ... ]}."""
    if base_oid is not None:
        rows = conn.execute(
            "SELECT exp_oid, name, state, short_description FROM expansions "
            "WHERE owner_id=? AND base_oid=? ORDER BY name COLLATE NOCASE",
            (owner_id, base_oid)).fetchall()
        return [dict(r) for r in rows]
    out = {}
    for r in conn.execute(
            "SELECT base_oid, exp_oid, name, state FROM expansions WHERE owner_id=? "
            "ORDER BY name COLLATE NOCASE", (owner_id,)).fetchall():
        out.setdefault(r["base_oid"], []).append(
            {"exp_oid": r["exp_oid"], "name": r["name"], "state": r["state"]})
    return out


def owned_expansions_for(conn, owner_id):
    """Expansiones que el perfil TIENE (state='own'), agrupadas por base_oid, con su
    short_description. Para el advisor (modo play): adjuntarle al agente las expas jugables de
    cada juego candidato. Devuelve {base_oid: [{name, short_description}]}."""
    out = {}
    for r in conn.execute(
            "SELECT base_oid, name, short_description FROM expansions "
            "WHERE owner_id=? AND state='own' ORDER BY name COLLATE NOCASE", (owner_id,)).fetchall():
        out.setdefault(r["base_oid"], []).append(
            {"name": r["name"], "short_description": r["short_description"] or ""})
    return out


def set_expansion(conn, owner_id, base_oid, exp_oid, name, state, short_description=None):
    """Upsert de una expansión colgada de `base_oid`. `state` ∈ {'own','wish'} (default 'wish' si
    viene otra cosa). `short_description` es lo único de "data" que guardamos (para el futuro
    advisor); si viene None NO se pisa lo ya guardado (COALESCE). No commitea; no valida el gate."""
    state = state if state in ("own", "wish") else "wish"
    conn.execute(
        "INSERT INTO expansions(owner_id, base_oid, exp_oid, name, state, short_description, "
        "updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id, base_oid, exp_oid) DO UPDATE SET "
        "name=excluded.name, state=excluded.state, "
        "short_description=COALESCE(excluded.short_description, expansions.short_description), "
        "updated_at=excluded.updated_at",
        (owner_id, base_oid, str(exp_oid), name, state, short_description, int(time.time())))


def remove_expansion(conn, owner_id, base_oid, exp_oid):
    """Quita una expansión del juego (para ese perfil). No commitea."""
    conn.execute("DELETE FROM expansions WHERE owner_id=? AND base_oid=? AND exp_oid=?",
                 (owner_id, base_oid, str(exp_oid)))


# ---- recomendaciones guardadas del advisor (opt-in; snapshot del resultado) ----

def save_rec(conn, owner_id, title, mode, engine, payload):
    """Guarda una recomendación del advisor para el perfil. `payload` es un string JSON (el
    snapshot del resultado tal cual se mostró). No commitea. Devuelve el id nuevo."""
    cur = conn.execute(
        "INSERT INTO saved_recs(owner_id, created_at, title, mode, engine, payload) "
        "VALUES(?,?,?,?,?,?)",
        (owner_id, int(time.time()), title, mode, engine, payload))
    return cur.lastrowid


def saved_recs_for(conn, owner_id):
    """Metadata de las recomendaciones guardadas del perfil, más nuevas primero (sin el payload,
    para una lista liviana)."""
    return [dict(r) for r in conn.execute(
        "SELECT id, created_at, title, mode, engine FROM saved_recs "
        "WHERE owner_id=? ORDER BY created_at DESC, id DESC", (owner_id,)).fetchall()]


def get_saved_rec(conn, owner_id, rec_id):
    """Una recomendación guardada con su `payload` YA parseado (dict), o None si no existe o es de
    otro perfil (scope por owner)."""
    r = conn.execute(
        "SELECT id, created_at, title, mode, engine, payload FROM saved_recs "
        "WHERE id=? AND owner_id=?", (rec_id, owner_id)).fetchone()
    if not r:
        return None
    d = dict(r)
    try:
        d["payload"] = json.loads(d["payload"])
    except (TypeError, json.JSONDecodeError):
        d["payload"] = {}
    return d


def rename_saved_rec(conn, owner_id, rec_id, title):
    """Renombra una recomendación guardada del perfil (no commitea)."""
    conn.execute("UPDATE saved_recs SET title=? WHERE id=? AND owner_id=?",
                 (title, rec_id, owner_id))


def delete_saved_rec(conn, owner_id, rec_id):
    """Borra una recomendación guardada del perfil (no commitea)."""
    conn.execute("DELETE FROM saved_recs WHERE id=? AND owner_id=?", (rec_id, owner_id))


# Columnas que un patch puede tocar. Los nombres de columna se INTERPOLAN en el SQL (no pueden ir
# como parámetro ligado), así que la validación vive acá, pegada al riesgo. Antes el único filtro
# estaba en el endpoint /api/games/{oid}/state; cualquier caller nuevo heredaba el agujero sin
# enterarse.
HOLDING_COLS = {"own", "wishlist", "wishlist_priority", "wishlist_comment",
                "user_rating", "numplays", "notes", "added_manually", "updated_at"}


def set_holding(conn, owner_id, objectid, patch):
    """Upsert de un holding. Descarta del patch cualquier clave que no sea columna conocida."""
    exists = conn.execute("SELECT 1 FROM holdings WHERE owner_id=? AND objectid=?",
                          (owner_id, objectid)).fetchone()
    patch = {k: v for k, v in patch.items() if k in HOLDING_COLS}
    patch["updated_at"] = int(time.time())
    if not exists:
        patch.setdefault("own", 0)
        patch.setdefault("wishlist", 0)
        cols = ["owner_id", "objectid"] + list(patch.keys())
        vals = [owner_id, objectid] + list(patch.values())
        ph = ", ".join("?" for _ in cols)
        conn.execute(f"INSERT INTO holdings ({', '.join(cols)}) VALUES ({ph})", vals)
    else:
        sets = ", ".join(f"{k}=:{k}" for k in patch)
        patch["owner_id"], patch["objectid"] = owner_id, objectid
        conn.execute(f"UPDATE holdings SET {sets} WHERE owner_id=:owner_id AND objectid=:objectid", patch)
