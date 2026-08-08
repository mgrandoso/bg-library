"""Puebla/actualiza desde collection.csv (estado) + data/bgg_data.json (datos BGG).
import_csv() sirve para re-importar tu backup o cargar el de un amigo (a otro owner)."""
import csv
import io
import json
import os
import time

import db

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CSV_PATH = os.path.join(ROOT, "collection.csv")
BGG_JSON = os.path.join(ROOT, "data", "bgg_data.json")


def _int(v, d=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return d


def _state_from_row(row):
    return {
        "own": 1 if row.get("own") == "1" else 0,
        "wishlist": 1 if row.get("wishlist") == "1" else 0,
        "wishlist_priority": _int(row.get("wishlistpriority"), 3),
        "wishlist_comment": row.get("wishlistcomment") or "",
        "user_rating": float(row["rating"]) if row.get("rating") not in (None, "", "0") else 0,
        "numplays": _int(row.get("numplays"), 0),
    }


def import_csv(text, owner_id, mode="both", bgg_lookup=None, fetch_missing=False):
    """Carga un CSV de colección BGG en las holdings de `owner_id`.
    mode: 'own' (solo lo que tiene) | 'both' (own + wishlist)."""
    conn = db.connect()
    reader = csv.DictReader(io.StringIO(text))
    updated = added_games = skipped = 0
    bgg = bgg_lookup or {}
    for row in reader:
        oid = (row.get("objectid") or "").strip()
        if not oid:
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


def preseed_id_set():
    """Los objectid del preseed top-5000 actual (fuente de verdad de 'es top-5000').
    Se usa como `keep_ids` del GC y para detectar qué juegos quedaron FUERA del top."""
    top = json.load(open(BGG_TOP, encoding="utf-8")) if os.path.exists(BGG_TOP) else {}
    return set(top.keys())


# --- Flujo 8: "Actualizar todo" por DIFF (A reseed local · B refresh de red mínimo · C GC) ---
# El costo de red NO escala con el catálogo: la pasada A refresca los 5000 desde el JSON local
# (sin red), así que B solo baja de BGG los pocos juegos TENIDOS que quedaron fuera del preseed
# (tu colección rankeada >5000 y los que se cayeron del top). Ese es el diff real.

def refresh_out_of_preseed(limit=25, days=30):
    """Pasada B, resumible. Re-baja de BGG el rank/datos reales de los juegos TENIDOS (own/wish)
    que NO están en el preseed y que están VENCIDOS (fetched_at más viejo que `days`).

    Es el diff real y barato: los 5000 del top ya se refrescaron en la pasada A desde el archivo
    local (sin red), así que acá solo caen tus juegos rankeados >5000 o caídos del top, y encima
    solo los que hace rato no se tocan. En una colección recién enriquecida esto da 0 y es
    instantáneo; los rankings fuera del top se mueven lento, revisarlos cada ~mes alcanza. El
    umbral por antigüedad también hace que el loop del front termine (lo recién bajado deja de
    estar vencido) y que dos corridas seguidas no repitan trabajo."""
    import bgg as bggmod
    keep = preseed_id_set()
    conn = db.connect()
    held = {r["objectid"] for r in conn.execute(
        "SELECT DISTINCT objectid FROM holdings WHERE own=1 OR wishlist=1").fetchall()}
    fetched = {r["objectid"]: (r["fetched_at"] or 0)
               for r in conn.execute("SELECT objectid, fetched_at FROM games").fetchall()}
    cutoff = int(time.time()) - days * 86400
    ids = [i for i in held if i not in keep and fetched.get(i, 0) < cutoff]
    ids.sort(key=lambda i: fetched.get(i, 0))  # más viejo primero
    done = 0
    for oid in ids[:limit]:
        try:
            db.upsert_bgg(conn, bggmod.fetch(oid))
            done += 1
        except Exception:
            pass
    conn.commit()
    conn.close()
    return {"refreshed": done, "remaining": max(0, len(ids) - done)}


def gc_run():
    """Pasada C. Corre el GC de huérfanos usando la pertenencia al preseed como fuente de verdad."""
    conn = db.connect()
    orphans = db.gc_orphans(conn, preseed_id_set())
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
        oid = (row.get("objectid") or "").strip()
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
    orphans = db.gc_orphans(conn, preseed_id_set())
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
