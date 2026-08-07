"""
Enriquece la colección de BGG usando la API JSON pública del frontend (api.geekdo.com).
La XML API oficial ahora requiere Bearer token; estos endpoints son públicos y traen más.

Entrada:  ../collection.csv  (export de colección de BGG)
Salida:   ../data/bgg_data.json  (dict keyed por objectid con datos normalizados)

Reanudable: si ya existe bgg_data.json, saltea los ids ya bajados.
"""
import csv
import json
import os
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CSV_PATH = os.path.join(ROOT, "collection.csv")
OUT_DIR = os.path.join(ROOT, "data")
OUT_PATH = os.path.join(OUT_DIR, "bgg_data.json")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")
GEEKITEMS = "https://api.geekdo.com/api/geekitems?objectid={id}&objecttype=thing&showcount=1"
DYNAMIC = "https://api.geekdo.com/api/dynamicinfo?objectid={id}&objecttype=thing"


def fetch_json(url, retries=4):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise last


def names(links, key):
    return [x.get("name") for x in links.get(key, []) if x.get("name")]


def link_objs(links, key):
    """Devuelve [{'id':..,'name':..}] para poder filtrar/linkear (ej. diseñadores)."""
    out = []
    for x in links.get(key, []):
        if x.get("name"):
            out.append({"id": str(x.get("objectid")), "name": x["name"]})
    return out


def normalize(objectid):
    gi = fetch_json(GEEKITEMS.format(id=objectid)).get("item", {})
    di = fetch_json(DYNAMIC.format(id=objectid)).get("item", {})
    links = gi.get("links", {})
    polls = di.get("polls", {})
    stats = di.get("stats", {})
    images = gi.get("images", {}) if isinstance(gi.get("images"), dict) else {}

    # best / recommended player counts (comunidad)
    up = polls.get("userplayers", {}) or {}
    def flatten(rngs):
        out = []
        for r in rngs or []:
            mn, mx = r.get("min"), r.get("max")
            if mn is None:
                continue
            mx = mx if mx is not None else mn
            out.extend(range(int(mn), int(mx) + 1))
        return sorted(set(out))
    best = flatten(up.get("best"))
    rec = flatten(up.get("recommended"))

    # rank overall
    rank_overall = None
    for ri in di.get("rankinfo", []) or []:
        if ri.get("rankobjectid") == 1 or ri.get("veryshortprettyname", "").strip().lower() == "overall":
            try:
                rank_overall = int(ri.get("rank"))
            except (TypeError, ValueError):
                rank_overall = None
            break

    weight_poll = polls.get("boardgameweight", {}) or {}

    return {
        "objectid": str(objectid),
        "name": gi.get("name"),
        "yearpublished": gi.get("yearpublished"),
        "href": gi.get("canonical_link"),
        "image": gi.get("imageurl") or images.get("original"),
        "thumb": images.get("previewthumb") or images.get("thumb"),
        "square": images.get("square200") or images.get("square"),
        "short_description": gi.get("short_description"),
        "minplayers": gi.get("minplayers"),
        "maxplayers": gi.get("maxplayers"),
        "minplaytime": gi.get("minplaytime"),
        "maxplaytime": gi.get("maxplaytime"),
        "minage_publisher": gi.get("minage"),
        "age_community": polls.get("playerage"),
        "language_dependence": polls.get("languagedependence"),
        "best_players": best,
        "recommended_players": rec,
        "userplayers_votes": up.get("totalvotes"),
        "subdomains": names(links, "boardgamesubdomain"),
        "categories": names(links, "boardgamecategory"),
        "mechanics": names(links, "boardgamemechanic"),
        "families": names(links, "boardgamefamily"),
        "designers": link_objs(links, "boardgamedesigner"),
        "artists": link_objs(links, "boardgameartist"),
        "publishers": names(links, "boardgamepublisher")[:5],
        "weight": weight_poll.get("averageweight") or stats.get("avgweight"),
        "weight_votes": weight_poll.get("votes"),
        "rating_avg": stats.get("average"),
        "rating_bayes": stats.get("baverage"),
        "users_rated": stats.get("usersrated"),
        "rank_overall": rank_overall,
        "fetched_at": int(time.time()),
    }


def load_ids():
    ids = []
    with open(CSV_PATH, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            oid = row.get("objectid", "").strip()
            if oid:
                ids.append(oid)
    # dedupe preservando orden
    seen, out = set(), []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    data = {}
    if os.path.exists(OUT_PATH):
        try:
            data = json.load(open(OUT_PATH, encoding="utf-8"))
        except Exception:
            data = {}
    ids = load_ids()
    todo = [i for i in ids if i not in data]
    print(f"Total ids: {len(ids)} | ya bajados: {len(data)} | pendientes: {len(todo)}", flush=True)

    done = 0
    lock_every = 25
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(normalize, oid): oid for oid in todo}
        for fut in as_completed(futs):
            oid = futs[fut]
            try:
                rec = fut.result()
                data[oid] = rec
            except Exception as e:  # noqa
                print(f"  FALLO {oid}: {e}", flush=True)
                data[oid] = {"objectid": oid, "error": str(e)}
            done += 1
            if done % lock_every == 0:
                json.dump(data, open(OUT_PATH, "w", encoding="utf-8"), ensure_ascii=False)
                print(f"  progreso {done}/{len(todo)}", flush=True)

    json.dump(data, open(OUT_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    ok = sum(1 for v in data.values() if not v.get("error"))
    print(f"LISTO. {ok}/{len(data)} ok. -> {OUT_PATH}", flush=True)


if __name__ == "__main__":
    main()
