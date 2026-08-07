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


def seed():
    db.init()
    conn = db.connect()
    me = db.get_me(conn)
    conn.close()

    conn = db.connect()
    # 1) catálogo BGG top (recommend.games) — se pisa luego en el overlap con los datos geekdo
    top = json.load(open(BGG_TOP, encoding="utf-8")) if os.path.exists(BGG_TOP) else {}
    for oid, rec in top.items():
        db.upsert_bgg(conn, rec)
    print(f"BGG top cargados: {len(top)}")
    # 2) datos geekdo de la colección propia (más completos: sobreescriben el overlap)
    bgg = json.load(open(BGG_JSON, encoding="utf-8")) if os.path.exists(BGG_JSON) else {}
    n = 0
    for oid, rec in bgg.items():
        if rec.get("error"):
            continue
        db.upsert_bgg(conn, rec)
        n += 1
    conn.commit()
    conn.close()
    print(f"BGG colección (geekdo) cargados: {n}")
    if os.path.exists(CSV_PATH):
        text = open(CSV_PATH, encoding="utf-8").read()
        res = import_csv(text, me, mode="both", bgg_lookup=bgg)
        print(f"Estado aplicado a 'Vos': {res}")


if __name__ == "__main__":
    seed()
