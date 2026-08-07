"""Baja el top-N de BGG (por rank real) desde la API pública de recommend.games,
que trae casi todo en bulk (rank, imagen, jugadores best/rec, complejidad, tipo,
categorías, mecánicas, diseñadores, ratings, descripción). Sin miles de llamadas.

Salida: ../data/bgg_top.json  (dict keyed por objectid) -> se versiona en el repo,
así quien clona arranca con el catálogo cargado sin bajar nada.

Uso:  python build/preseed_top.py [N]     (N por defecto 5000)
"""
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data", "bgg_top.json")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")
API = ("https://recommend.games/api/games/?bgg_rank__gt=0&bgg_rank__lte={n}"
       "&ordering=bgg_rank&page_size=100&page={page}")

# game_type de recommend.games -> subdomain de BGG (plural), para que matchee con el resto
TYPE_MAP = {
    "Abstract Game": "Abstract Games", "Children's Game": "Children's Games",
    "Customizable": "Customizable Games", "Family Game": "Family Games",
    "Party Game": "Party Games", "Strategy Game": "Strategy Games",
    "Thematic": "Thematic Games", "Wargame": "Wargames", "War Game": "Wargames",
}
LANG_BY_LEVEL = {
    1: "No necessary in-game text",
    2: "Some necessary text - easily memorized or small crib sheet",
    3: "Moderate in-game text - needs crib sheet or paste ups",
    4: "Extensive use of text - massive conversion needed to be playable",
    5: "Unplayable in another language",
}


def _get(url, retries=4):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def _first(v):
    return v[0] if isinstance(v, list) and v else (v if isinstance(v, str) else None)


def _rng(lo, hi):
    if lo is None:
        return []
    hi = hi if hi is not None else lo
    try:
        return list(range(int(lo), int(hi) + 1))
    except (TypeError, ValueError):
        return []


def _int(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def normalize(g):
    img = _first(g.get("image_url"))
    ld = g.get("language_dependency")
    lang = None
    if isinstance(ld, (int, float)):
        lang = LANG_BY_LEVEL.get(int(round(ld)))
    elif isinstance(ld, str):
        lang = ld
    age_rec = _int(g.get("min_age_rec"))
    desc = (g.get("description") or "").strip() or None
    return {
        "objectid": str(g["bgg_id"]),
        "name": g.get("name"),
        "yearpublished": str(g["year"]) if g.get("year") else None,
        "href": g.get("url") or (f"https://boardgamegeek.com/boardgame/{g['bgg_id']}"),
        "image": img,
        "thumb": img,
        "square": img,
        "short_description": None,
        "description": desc,
        "minplayers": _int(g.get("min_players")),
        "maxplayers": _int(g.get("max_players")),
        "minplaytime": _int(g.get("min_time")),
        "maxplaytime": _int(g.get("max_time")),
        "minage_publisher": _int(g.get("min_age")),
        "age_community": f"{age_rec}+" if age_rec else None,
        "language_dependence": lang,
        "best_players": _rng(g.get("min_players_best"), g.get("max_players_best")),
        "recommended_players": _rng(g.get("min_players_rec"), g.get("max_players_rec")),
        "subdomains": [TYPE_MAP.get(t, t) for t in (g.get("game_type_name") or [])],
        "categories": g.get("category_name") or [],
        "mechanics": g.get("mechanic_name") or [],
        "families": [],
        "designers": [{"id": "", "name": n} for n in (g.get("designer_name") or [])],
        "artists": [{"id": "", "name": n} for n in (g.get("artist_name") or [])],
        "publishers": [],
        "weight": g.get("complexity"),
        "weight_votes": None,
        "rating_avg": g.get("avg_rating"),
        "rating_bayes": g.get("bayes_rating"),
        "users_rated": _int(g.get("num_votes")),
        "rank_overall": _int(g.get("bgg_rank")),
        "fetched_at": int(time.time()),
    }


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out = {}
    page = 1
    while True:
        data = _get(API.format(n=n, page=page))
        results = data.get("results", [])
        if not results:
            break
        for g in results:
            if not g.get("bgg_id"):
                continue
            rec = normalize(g)
            if rec["rank_overall"]:
                out[rec["objectid"]] = rec
        print(f"  página {page}: total acumulado {len(out)}", flush=True)
        if not data.get("next"):
            break
        page += 1
        time.sleep(0.2)
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"LISTO. {len(out)} juegos del top-{n} -> {OUT} ({os.path.getsize(OUT)/1024/1024:.1f} MB)", flush=True)


if __name__ == "__main__":
    main()
