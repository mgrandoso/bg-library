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
DB_PATH = os.path.join(ROOT, "bg.db")

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
CREATE INDEX IF NOT EXISTS idx_h_owner ON holdings(owner_id);
CREATE INDEX IF NOT EXISTS idx_h_own ON holdings(own);
CREATE INDEX IF NOT EXISTS idx_h_wish ON holdings(wishlist);
CREATE INDEX IF NOT EXISTS idx_g_rank ON games(rank_overall);
"""


def connect():
    conn = sqlite3.connect(DB_PATH)
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


def games_for_owner(conn, owner_id):
    """Los juegos que el owner tiene/quiere (con datos del catálogo) + quién más los tiene.
    Parte de `holdings` (no del catálogo completo), así el costo escala con el tamaño de SU
    colección y no con el del catálogo — clave ahora que `games` tiene miles de filas."""
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

    return [row_to_game(dict(r), owners_owning=owning.get(r["objectid"], [])) for r in rows]


def upsert_bgg(conn, rec):
    fields = [
        "objectid", "name", "yearpublished", "href", "image", "thumb", "square",
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
        if f == "description" and v is None:
            continue  # no pisar descripción existente si el fetch no la trae
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

    Regla: el catálogo `games` = (top-5000 del preseed) ∪ (todo lo que alguien tiene/quiere).
    Un juego es *huérfano* si NO está en `keep_ids` (los objectid del preseed top-5000 actual) y
    NO lo tiene ni lo desea ningún perfil (ningún holding con own=1 o wishlist=1). Los huérfanos
    se borran del catálogo (y se limpian holdings fantasma —own=0 y wishlist=0— que apunten a
    ellos). Devuelve la lista de objectids borrados.

    Es idempotente y barato; lo usan tanto 'Actualizar todo' (pasada C) como la reconciliación de
    import. `keep_ids` debe ser la *pertenencia al preseed*, NO el rank guardado: un juego que cayó
    del top (p. ej. #4998→#5025) ya no está en el preseed, así que si nadie lo tiene, se cae."""
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


def set_holding(conn, owner_id, objectid, patch):
    """Upsert de un holding."""
    exists = conn.execute("SELECT 1 FROM holdings WHERE owner_id=? AND objectid=?",
                          (owner_id, objectid)).fetchone()
    patch = dict(patch)
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
