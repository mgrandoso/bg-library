"""Backfill de descripciones largas para juegos ya cargados (solo endpoint geekitems).
Correr una vez:  python build/backfill_desc.py"""
import os
import sys
import time
import urllib.request
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "server"))
import db  # noqa
import bgg  # noqa

GEEKITEMS = "https://api.geekdo.com/api/geekitems?objectid={id}&objecttype=thing&showcount=1"


def fetch_desc(oid):
    req = urllib.request.Request(GEEKITEMS.format(id=oid),
                                 headers={"User-Agent": bgg.UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as r:
        gi = json.loads(r.read().decode("utf-8")).get("item", {})
    return oid, bgg._strip_html(gi.get("description"))


def main():
    db.init()
    conn = db.connect()
    rows = conn.execute("SELECT objectid FROM games WHERE description IS NULL OR description=''").fetchall()
    conn.close()
    ids = [r["objectid"] for r in rows]
    print(f"pendientes: {len(ids)}", flush=True)
    done = 0
    conn = db.connect()
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(fetch_desc, oid): oid for oid in ids}
        for fut in as_completed(futs):
            try:
                oid, desc = fut.result()
                if desc:
                    conn.execute("UPDATE games SET description=? WHERE objectid=?", (desc, oid))
                    done += 1
            except Exception:
                pass
            if done and done % 50 == 0:
                conn.commit()
                print(f"  {done}", flush=True)
    conn.commit()
    conn.close()
    print(f"LISTO. descripciones cargadas: {done}", flush=True)


if __name__ == "__main__":
    main()
