"""Acceso a la API JSON pública de BGG (api.geekdo.com / boardgamegeek.com).
La XML API oficial requiere Bearer token; estos endpoints del frontend son públicos."""
import json
import logging
import re
import time
import urllib.parse
import urllib.request

log = logging.getLogger("ludoteca.bgg")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")
GEEKITEMS = "https://api.geekdo.com/api/geekitems?objectid={id}&objecttype=thing&showcount=1"
DYNAMIC = "https://api.geekdo.com/api/dynamicinfo?objectid={id}&objecttype=thing"
SEARCH = "https://boardgamegeek.com/search/boardgame?q={q}&showcount={n}&nosession=1"


def _get(url, retries=3):
    """GET + parse JSON contra la API pública de BGG, con reintentos. Loguea cada fallo con la URL
    y el tipo de error, y un ERROR final al agotar reintentos: si BGG cambia un endpoint/estructura
    o el proxy corporativo corta, queda rastro claro en el log para diagnosticarlo (pedido de M.)."""
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa
            last = e
            log.warning("BGG GET falló (intento %d/%d) %s -> %s: %s",
                        attempt + 1, retries, url, type(e).__name__, e)
            time.sleep(1.0 * (attempt + 1))
    log.error("BGG GET agotó reintentos: %s -> %s: %s", url, type(last).__name__, last)
    raise last


def parse_id(text):
    """Acepta un id, o una URL de BGG, y devuelve el objectid."""
    text = (text or "").strip()
    if text.isdigit():
        return text
    m = re.search(r"/boardgame/(\d+)", text)
    if m:
        return m.group(1)
    m = re.search(r"(\d{2,})", text)
    return m.group(1) if m else None


def search(q, n=8):
    """Búsqueda de BGG: devuelve candidatos con `objectid + name + yearpublished + href`.
    NO arma thumbnail: la API de búsqueda solo trae `rep_imageid` y la URL `camo/…` que se armaba
    a mano necesita un hash firmado → siempre daba 404 (thumbnails rotos). La imagen la aporta la
    base local si el juego ya está (hidratación local-first, ítem 8); si no, placeholder hasta
    agregarlo. No inventamos URLs de imagen."""
    data = _get(SEARCH.format(q=urllib.parse.quote(q), n=n))
    out = []
    for it in data.get("items", [])[:n]:
        out.append({
            "objectid": str(it.get("objectid")),
            "name": it.get("name"),
            "yearpublished": it.get("yearpublished"),
            "href": "https://boardgamegeek.com" + (it.get("href") or ""),
        })
    return out


def _names(links, key):
    return [x.get("name") for x in links.get(key, []) if x.get("name")]


def _alt_names(gi):
    """Nombres alternativos (otros idiomas) de un geekitem. BGG los da como [{nameid,name}] sin
    etiqueta de idioma. TRANSITORIO: alimenta el resolver de es_name (ítem 1); NO se persiste."""
    out = []
    for x in gi.get("alternatenames") or []:
        n = x.get("name") if isinstance(x, dict) else x
        if n:
            out.append(n)
    return out


def _link_objs(links, key):
    out = []
    for x in links.get(key, []):
        if x.get("name"):
            out.append({"id": str(x.get("objectid")), "name": x["name"]})
    return out


def expansions_of(objectid):
    """Expansiones OFICIALES de un juego según BGG (links `boardgameexpansion`): lista de
    {id, name}. Un solo GET al geekitem (liviano). Alimenta el panel '＋' de la ficha (ítem 3);
    NO se persiste — las expansiones viven en la tabla `expansions` solo por nombre."""
    gi = _get(GEEKITEMS.format(id=objectid)).get("item", {})
    return _link_objs(gi.get("links", {}), "boardgameexpansion")


def _strip_html(html):
    if not html:
        return None
    import html as _h
    txt = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    txt = re.sub(r"<[^>]+>", " ", txt)
    txt = _h.unescape(txt)
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r"\n\s*\n+", "\n\n", txt)
    return txt.strip() or None


def _flatten(rngs):
    out = []
    for r in rngs or []:
        mn, mx = r.get("min"), r.get("max")
        if mn is None:
            continue
        mx = mx if mx is not None else mn
        out.extend(range(int(mn), int(mx) + 1))
    return sorted(set(out))


def fetch(objectid):
    """Trae y normaliza un juego. Mismo shape que build/enrich.py."""
    gi = _get(GEEKITEMS.format(id=objectid)).get("item", {})
    di = _get(DYNAMIC.format(id=objectid)).get("item", {})
    links = gi.get("links", {})
    polls = di.get("polls", {})
    stats = di.get("stats", {})
    images = gi.get("images", {}) if isinstance(gi.get("images"), dict) else {}
    up = polls.get("userplayers", {}) or {}

    rank_overall = None
    for ri in di.get("rankinfo", []) or []:
        if ri.get("rankobjectid") == 1 or ri.get("veryshortprettyname", "").strip().lower() == "overall":
            try:
                rank_overall = int(ri.get("rank"))
            except (TypeError, ValueError):
                rank_overall = None
            break

    wp = polls.get("boardgameweight", {}) or {}
    # expansión: subtype canónico o que expanda a algún juego base. `expands` = madre(s). Ambos
    # TRANSITORIOS (no se persisten en games): alimentan el guard de alta y la ficha de expansión.
    expands = _link_objs(links, "expandsboardgame")
    is_expansion = gi.get("subtype") == "boardgameexpansion" or bool(expands)
    return {
        "objectid": str(objectid),
        "name": gi.get("name"),
        "subtype": gi.get("subtype"),
        "is_expansion": is_expansion,
        "expands": expands,            # transitorio: juego(s) madre de una expansión
        "alt_names": _alt_names(gi),   # transitorio (para el resolver de es_name); db.upsert no lo guarda
        "yearpublished": gi.get("yearpublished"),
        "href": gi.get("canonical_link"),
        "image": gi.get("imageurl") or images.get("original"),
        "thumb": images.get("previewthumb") or images.get("thumb"),
        "square": images.get("square200") or images.get("square"),
        "short_description": gi.get("short_description"),
        "description": _strip_html(gi.get("description")),
        "minplayers": gi.get("minplayers"),
        "maxplayers": gi.get("maxplayers"),
        "minplaytime": gi.get("minplaytime"),
        "maxplaytime": gi.get("maxplaytime"),
        "minage_publisher": gi.get("minage"),
        "age_community": polls.get("playerage"),
        "language_dependence": polls.get("languagedependence"),
        "best_players": _flatten(up.get("best")),
        "recommended_players": _flatten(up.get("recommended")),
        "subdomains": _names(links, "boardgamesubdomain"),
        "categories": _names(links, "boardgamecategory"),
        "mechanics": _names(links, "boardgamemechanic"),
        "families": _names(links, "boardgamefamily"),
        "designers": _link_objs(links, "boardgamedesigner"),
        "artists": _link_objs(links, "boardgameartist"),
        "publishers": _names(links, "boardgamepublisher")[:5],
        "weight": wp.get("averageweight") or stats.get("avgweight"),
        "weight_votes": wp.get("votes"),
        "rating_avg": stats.get("average"),
        "rating_bayes": stats.get("baverage"),
        "users_rated": stats.get("usersrated"),
        "rank_overall": rank_overall,
        "fetched_at": int(time.time()),
    }
