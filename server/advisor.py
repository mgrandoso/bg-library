"""Advisor: dos modos (play/buy) x dos motores (rules/agent).

- rules: scoring transparente sobre los datos de BGG. Instantáneo, offline, explica el porqué.
- agent: prefiltra con rules y le pasa la lista corta + respuestas a Gemini (free tier)
         para que razone y redacte la recomendación. Sin key de Gemini, cae a 'rules'.

El modo 'buy' es balance-aware: compara cada candidato contra el perfil de la
colección que ya tenés (own) y premia lo que llena un hueco.
"""
import json
import os
import re
import time
import unicodedata

import db

# ---- bandas de complejidad (weight BGG 1..5) ----
WEIGHT_BANDS = {
    "light": (1.0, 1.9),
    "medium": (1.9, 2.7),
    "heavy": (2.7, 5.0),
}
WEIGHT_LABELS = ["Liviana", "Media-liviana", "Media", "Media-pesada", "Pesada"]

# dependencia de idioma/lectura -> nivel coloquial
LANG_LEVEL = {
    "No necessary in-game text": "baja",
    "Some necessary text - easily memorized or small crib sheet": "baja",
    "Moderate in-game text - needs crib sheet or paste ups": "media",
    "Extensive use of text - massive conversion needed to be playable": "alta",
    "Unplayable in another language": "alta",
}

# palabras que marcan cooperativo en mecánicas/categorías
COOP_HINTS = ("Cooperative", "Co-operative")

# mapeo de temas amigables -> categorías BGG
THEME_MAP = {
    "fiesta": ["Party Game", "Humor", "Trivia", "Word Game"],
    "misterio": ["Deduction", "Murder/Mystery", "Spies/Secret Agents", "Horror"],
    "aventura": ["Adventure", "Fantasy", "Exploration", "Fighting"],
    "economia": ["Economic", "City Building", "Industry / Manufacturing", "Territory Building"],
    "naturaleza": ["Animals", "Environmental", "Farming"],
    "palabras": ["Word Game", "Trivia"],
    "historico": ["Ancient", "Medieval", "Civilization", "Wargame"],
}


def weight_bucket(w):
    """0..4 index para WEIGHT_LABELS."""
    if not w:
        return None
    if w < 1.5:
        return 0
    if w < 2.1:
        return 1
    if w < 2.7:
        return 2
    if w < 3.4:
        return 3
    return 4


def _is_coop(g):
    blob = " ".join(g.get("mechanics", []) + g.get("categories", []))
    return any(h in blob for h in COOP_HINTS)


def _lang_light(g):
    ld = (g.get("language_dependence") or "").lower()
    return ("no necessary" in ld) or ("easily memorized" in ld) or ("some necessary" in ld)


def _age_min(g):
    """Edad mínima como número (usa publisher, cae a comunidad)."""
    a = g.get("minage_publisher")
    if a:
        return a
    m = re.search(r"(\d+)", g.get("age_community") or "")
    return int(m.group(1)) if m else None


def _fits_players(g, n):
    """Devuelve (nivel, puntos): 'ideal'|'good'|'ok'|'no'."""
    best = g.get("best_players") or []
    rec = g.get("recommended_players") or []
    mn, mx = g.get("minplayers") or 0, g.get("maxplayers") or 0
    if n in best:
        return "ideal", 40
    if n in rec:
        return "good", 28
    if mn and mx and mn <= n <= mx:
        return "ok", 14
    return "no", -100


# ---------------- PLAY MODE ----------------

def score_play(g, a):
    """a = respuestas normalizadas. Devuelve (score, reasons[])."""
    reasons = []
    score = 0.0

    # 1) jugadores (lo más importante)
    n = a.get("players")
    if n:
        level, pts = _fits_players(g, n)
        score += pts
        if level == "ideal":
            reasons.append(f"{n} es el número ideal")
        elif level == "good":
            reasons.append(f"va bien con {n}")
        elif level == "ok":
            reasons.append(f"se banca {n}")
        else:
            return -100, ["no entra con esa cantidad de jugadores"]

    # 2) complejidad segun ganas
    vibe = a.get("vibe")
    w = g.get("weight") or 0
    if vibe in WEIGHT_BANDS and w:
        lo, hi = WEIGHT_BANDS[vibe]
        if lo <= w <= hi:
            score += 22
            reasons.append({"light": "liviano", "medium": "de peso medio",
                            "heavy": "con chicha para pensar"}[vibe])
        else:
            dist = min(abs(w - lo), abs(w - hi))
            score += max(0, 12 - dist * 8)

    # 3) tiempo
    t = a.get("time")
    mx_time = g.get("maxplaytime") or g.get("minplaytime") or 0
    if t and mx_time:
        cap = {"short": 45, "hour": 75, "long": 9999, "any": 9999}.get(t, 9999)
        if mx_time <= cap:
            score += 14
            if t == "short":
                reasons.append(f"corto (~{mx_time} min)")
        else:
            score -= min(20, (mx_time - cap) / 6)

    # 4) edad del mas chico
    ma = a.get("min_age")
    gmin = _age_min(g)
    if ma and gmin:
        if gmin <= ma:
            score += 10
        else:
            score -= (gmin - ma) * 3
            if gmin - ma >= 3:
                reasons.append(f"quizá exigente para {ma} años (recomendado {gmin}+)")

    # 5) coop vs competitivo
    coop_pref = a.get("coop")
    coop = _is_coop(g)
    if coop_pref == "coop":
        if coop:
            score += 12
            reasons.append("cooperativo: se unen contra el juego")
        else:
            score -= 6
    elif coop_pref == "competitive" and coop:
        score -= 5

    # 6) experiencia
    exp = a.get("experience")
    if exp == "new":
        if w and w <= 2.2:
            score += 8
        elif w and w >= 3:
            score -= 10
        if _lang_light(g):
            score += 4

    # 7) idioma / texto
    if a.get("language_ok"):
        if _lang_light(g):
            score += 7
            reasons.append("baja dependencia del idioma")
        else:
            score -= 8

    # 8) tema
    theme = a.get("theme")
    if theme and theme in THEME_MAP:
        cats = set(g.get("categories", []))
        if cats & set(THEME_MAP[theme]):
            score += 10
            reasons.append(f"tema {theme}")

    # 9) desempate por calidad
    rb = g.get("rating_bayes") or 0
    score += min(5, max(0, (rb - 6) * 2))

    return score, reasons


# ---------------- BUY MODE (balance-aware) ----------------

def collection_profile(owned):
    """Perfil de lo que ya tenés: cobertura por nº jugadores, buckets de peso, subdominios."""
    prof = {"player_cover": {n: 0 for n in range(1, 9)},
            "weight_buckets": [0] * 5, "subdomains": {}, "coop": 0, "count": len(owned)}
    for g in owned:
        for n in range(1, 9):
            lvl, _ = _fits_players(g, n)
            if lvl in ("ideal", "good"):
                prof["player_cover"][n] += 1
        b = weight_bucket(g.get("weight"))
        if b is not None:
            prof["weight_buckets"][b] += 1
        for s in g.get("subdomains", []):
            prof["subdomains"][s] = prof["subdomains"].get(s, 0) + 1
        if _is_coop(g):
            prof["coop"] += 1
    return prof


def score_buy(g, a, prof):
    reasons = []
    score = 0.0

    # jugadores habituales -> ¿llena un hueco de cobertura?
    up = a.get("usual_players")
    if up:
        lvl, pts = _fits_players(g, up)
        if lvl in ("ideal", "good"):
            score += 20
            cover = prof["player_cover"].get(up, 0)
            if cover <= 2:
                score += 25
                reasons.append(f"te llena un hueco: casi no tenés juegos buenos para {up} jugadores")
            else:
                reasons.append(f"suma para tus partidas de {up}")
        elif lvl == "no":
            score -= 15

    # qué querés más (subdominio) cruzado con lo que ya tenés
    want = a.get("want_more")  # ej "Strategy Games", "Party Games"...
    if want:
        if want in g.get("subdomains", []):
            score += 15
            have = prof["subdomains"].get(want, 0)
            if have <= 2:
                score += 15
                reasons.append(f"tenés pocos de {want} y este es del palo")
            else:
                reasons.append(f"más {want}, como pediste")

    # complejidad buscada
    vibe = a.get("vibe")
    w = g.get("weight") or 0
    if vibe in WEIGHT_BANDS and w:
        lo, hi = WEIGHT_BANDS[vibe]
        if lo <= w <= hi:
            score += 15

    # coop si lo pidió
    if a.get("want_more") == "coop" and _is_coop(g):
        score += 20
        if prof["coop"] <= 1:
            score += 15
            reasons.append("te falta cooperativos y este lo es")

    # audiencia familiar -> edad accesible
    if a.get("audience") == "family":
        gmin = _age_min(g)
        if gmin and gmin <= 8:
            score += 10
            reasons.append("accesible para chicos")

    # gemas seguras vs nicho
    so = a.get("safe_or_niche")
    users = g.get("users_rated") or 0
    rb = g.get("rating_bayes") or 0
    rank = g.get("rank_overall") or 99999
    if so == "safe":
        if rank and rank <= 500:
            score += 18
            reasons.append(f"gema segura (top {rank} de BGG)")
        score += min(8, users / 15000)
    elif so == "niche":
        if users and users < 8000:
            score += 12
            reasons.append("joya de nicho")
    score += min(6, max(0, (rb - 6.5) * 3))

    # prioridad de wishlist del usuario
    prio = g.get("wishlist_priority") or 3
    score += {1: 14, 2: 8, 3: 0, 4: -4}.get(prio, 0)
    if prio <= 2:
        reasons.append("alta prioridad en tu wishlist")

    return score, reasons


# ---------------- entrada principal ----------------

SHORTLIST_TIERS = [15, 20, 25, 30, 35, 40, 45, 50]


def shortlist_size(total):
    """~15% del pool, redondeado al tier más cercano, tope 50. Colecciones chicas: todo."""
    if total <= SHORTLIST_TIERS[0]:
        return max(1, total)
    target = 0.15 * total
    snapped = min(SHORTLIST_TIERS, key=lambda t: abs(t - target))
    return min(snapped, 50)


def recommend(mode, answers, engine="rules", limit=4, owner_id=None):
    conn = db.connect()
    if owner_id is None:
        owner_id = db.get_me(conn)
    games = db.games_for_owner(conn, owner_id)
    conn.close()
    if mode == "buy":
        pool = [g for g in games if g.get("wishlist")]
        owned = [g for g in games if g.get("own")]
        prof = collection_profile(owned)
    else:
        pool = [g for g in games if g.get("own")]
        prof = None

    scored = []
    for g in pool:
        if mode == "buy":
            s, why = score_buy(g, answers, prof)
        else:
            s, why = score_play(g, answers)
        if s > -50:
            scored.append((s, why, g))
    scored.sort(key=lambda x: x[0], reverse=True)

    if engine == "agent":
        k = shortlist_size(len(pool))     # cuántos candidatos ve el agente (según el tamaño del pool)
        # juegos que el usuario nombró en el texto libre (contexto real para el modelo): busca en
        # tu colección Y en el catálogo (por si nombra uno que no tenés). Solo si hay texto libre.
        mentioned = []
        text = answers.get("texto_libre", "")
        if text.strip():
            c2 = db.connect()
            mentioned = resolve_mentions(c2, text, games)
            c2.close()
        return agent_pick(mode, answers, scored[:k], limit, mentioned=mentioned)

    return {"engine": "rules", "mode": mode,
            "picks": _picks_from_scored(scored[:limit]), "considered": len(scored)}


def _picks_from_scored(scored):
    picks = []
    for s, why, g in scored:
        strs = [w for w in why if isinstance(w, str)]
        picks.append({
            "objectid": g["objectid"], "name": g["name"], "image": g["image"],
            "thumb": g["thumb"], "score": round(s, 1), "weight": g["weight"],
            "subdomains": g["subdomains"], "reasons": strs, "pitch": _mk_pitch(g, strs),
        })
    return picks


def _mk_pitch(g, reasons):
    if not reasons:
        return f"{g['name']}: buena opción según tus respuestas."
    return f"{g['name']} — " + "; ".join(reasons[:4]) + "."


# ---------------- motor AGENTE (Gemini) ----------------

def _extract_json(text):
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _norm(s):
    """Normaliza para matchear nombres: sin acentos, minúsculas, alfanum, espacios colapsados
    (así 'Pandemic Legacy: Season 1' matchea se escriba con o sin los dos puntos)."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# Nombres del catálogo que también son palabra común (ES/EN): p.ej. "azul" el color vs. el juego
# Azul. Para ESTOS (y solo si son de una sola palabra) exigimos una señal de intención antes de
# tratarlos como mención. Es una lista de palabras frecuentes del idioma, no de juegos.
_COMMON_WORDS = frozenset("""
azul rojo verde negro blanco gris marron naranja violeta rosa dorado plateado color colores
luna sol estrella estrellas cielo mar oceano rio bosque montana fuego agua tierra aire viento
oro plata bronce guerra paz vida muerte amor odio tiempo dia noche tarde manana ano mundo
casa mesa carta cartas dado dados ficha fichas tablero rey reina principe rico pobre grande
chico corto largo rapido lento facil dificil nuevo viejo bueno malo fiesta familia amigos
grupo gente dos tres cuatro cinco seis siete ocho nueve diez cien mil
the and for with about year game games moon gold silver root coup pandemic wizard spirit
war life love time night day sun star sky sea river forest fire water earth king queen
castle dragon knight party fun family quick short long solo group blue red green black white
""".split())

# palabras gatillo: si aparecen justo antes de un nombre ambiguo, es señal de que sí lo nombra
_CUES = frozenset("""
como parecido parecida similar iguales igual tipo estilo jugar jugamos jugando jugue jugado
juego juegos sacar saco saque sacamos probar probamos pruebo tengo tenemos tenes comprar
compro compre quiero probando
""".split())


def _cap_norm_tokens(text):
    """Tokens (normalizados) que en el texto ORIGINAL venían con mayúscula inicial — señal de
    nombre propio (título) y no palabra común. 'AZUL' y 'Azul' cuentan; 'azul' no."""
    caps = set()
    for tok in re.findall(r"\S+", text or ""):
        first = next((c for c in tok if c.isalpha()), "")
        if first and first == first.upper() and first != first.lower():
            caps.add(_norm(tok))
    return caps


def _match_names(text, name_rows, got_ids, limit):
    """Matchea nombres de juego en `text`. Nombres largos primero ('Ark Nova' gana a 'Ark'), y va
    consumiendo lo matcheado. Para nombres de UNA sola palabra que son palabra común (azul, luna,
    root...) exige señal de intención —mayúscula en el original o palabra gatillo antes— para no
    confundir 'color azul' con el juego Azul. Devuelve los objectids encontrados."""
    padded = f" {_norm(text)} "
    toks = padded.split()
    caps = _cap_norm_tokens(text)
    found = []
    for oid, name in sorted(name_rows, key=lambda x: -len(x[1] or "")):
        if oid in got_ids:
            continue
        nn = _norm(name)
        if len(nn) < 4:            # evita falsos positivos de nombres muy cortos (Go, Uno, Set)
            continue
        token = f" {nn} "
        if token not in padded:
            continue
        if " " not in nn and nn in _COMMON_WORDS and nn not in caps:
            cued = False
            for i, t in enumerate(toks):
                prev1 = toks[i - 1] if i >= 1 else ""
                prev2 = toks[i - 2] if i >= 2 else ""
                if t == nn and (prev1 in _CUES or prev2 in _CUES):
                    cued = True
                    break
            if not cued:
                continue           # palabra común sin señal de intención → no es una mención
        found.append(oid)
        got_ids.add(oid)
        padded = padded.replace(token, "  ")   # consumido: no rematchear subcadenas
        if len(found) >= limit:
            break
    return found


def resolve_mentions(conn, text, collection, limit=4):
    """Juegos nombrados en el texto libre, con sus datos reales. Matchea contra TODO el catálogo
    (que ya incluye los tuyos) por nombre más largo primero, así 'Pandemic Legacy: Season 1' gana
    a 'Pandemic'. Luego clasifica: si es tuyo usa los datos en memoria; si no, los trae de la base
    y lo marca `_not_owned` (lo jugaste afuera → solo referencia)."""
    if not _norm(text):
        return []
    by_id = {g["objectid"]: g for g in collection}
    names = [(r["objectid"], r["name"]) for r in
             conn.execute("SELECT objectid, name FROM games").fetchall()]
    ids = _match_names(text, names, set(), limit)   # orden: nombre más largo primero
    # los que no son de tu colección: traer datos reales de la base en un solo query
    fetch_ids = [oid for oid in ids if oid not in by_id]
    fetched = {}
    if fetch_ids:
        ph = ",".join("?" for _ in fetch_ids)
        for r in conn.execute(f"SELECT * FROM games WHERE objectid IN ({ph})", fetch_ids).fetchall():
            g = db.row_to_game(dict(r))
            g["_not_owned"] = True
            fetched[r["objectid"]] = g
    return [by_id.get(oid) or fetched.get(oid) for oid in ids if oid in by_id or oid in fetched]


def _build_prompt(mode, answers, shortlist, mentioned=None):
    games_txt = []
    for s, why, g in shortlist:
        # preferimos la descripción larga: el LLM aprovecha el contexto temático
        desc = (g.get("description") or g.get("short_description") or "").strip().replace("\n", " ")
        if len(desc) > 400:
            desc = desc[:400] + "…"
        games_txt.append(
            f"- id={g['objectid']} | {g['name']} ({g.get('yearpublished')}) | "
            f"tipo={','.join(g.get('subdomains') or [])} | complejidad={round(g.get('weight') or 0,1)}/5 | "
            f"jugadores {g.get('minplayers')}-{g.get('maxplayers')} (mejor: {g.get('best_players')}) | "
            f"~{g.get('maxplaytime')}min | edad {g.get('minage_publisher')}+ | "
            f"dependencia_idioma={LANG_LEVEL.get(g.get('language_dependence'), 'media')} | "
            f"mecánicas={','.join((g.get('mechanics') or [])[:4])}"
            + (f" | de qué va: {desc}" if desc else "")
        )
    # juegos que el usuario nombró en su texto libre: le damos los datos reales para que no invente
    mentioned_txt = ""
    if mentioned:
        short_ids = {g["objectid"] for _s, _why, g in shortlist}
        lines = []
        for g in mentioned:
            if g.get("_not_owned"):
                flag = " | no está en su colección (quizá lo jugó afuera): úsalo solo de referencia, no lo recomiendes"
            elif g["objectid"] in short_ids:
                flag = " | ya está entre los candidatos de abajo"
            else:
                flag = " | no está entre los candidatos"
            lines.append(
                f"- {g['name']}: tipo={','.join(g.get('subdomains') or [])} | "
                f"complejidad={round(g.get('weight') or 0,1)}/5 | "
                f"mecánicas={','.join((g.get('mechanics') or [])[:4])}" + flag)
        mentioned_txt = (
            "\n\nDetección heurística (puede equivocarse): por el texto del usuario, estos juegos "
            "PODRÍAN ser referencias que hizo. Te adjunto sus datos reales solo como contexto, por "
            "si al leer el pedido interpretás que efectivamente los estaba nombrando. Si alguno no "
            "encaja (p. ej. usó la palabra en otro sentido), ignoralo. Si sí los nombró: cuando "
            "pide descartar uno o dice que ya lo juega mucho, no lo recomiendes; cuando pide 'algo "
            "parecido', usá su tipo/mecánicas como referencia para elegir entre los candidatos:\n"
            + "\n".join(lines))

    intent = ("Recomendá qué juego sacar HOY a la mesa entre los que YA TIENE"
              if mode == "play" else
              "Recomendá qué juego le CONVIENE COMPRAR de su wishlist, mirando el balance de su colección")
    metodo = """Método de recomendación (heurísticas del hobby):
- Priorizá el número de jugadores 'mejor' (poll de la comunidad) por sobre el rango que 'soporta'.
- Grupo nuevo / no jugón: complejidad baja (≤2.3), poca dependencia del idioma, reglas que se explican rápido; evitá parálisis por análisis, downtime largo y eliminación de jugadores.
- Tiempo real ≈ tiempo de enseñar + tiempo de jugar. Si tienen 'un rato', priorizá reglas simples.
- Matcheá el tono: risa/social → party/mecánicas ligeras; ganas de pensar → estrategia/euro.
- Para 2 jugadores, preferí diseños pensados para 2. Para grupos grandes, que escale sin aburrir.
- 'Table presence' (que quede lindo/atractivo en la mesa) suma en ocasiones sociales.
- No recomiendes siempre lo más rankeado: pesa el encaje real con la ocasión.
- Diversificá las sugerencias (que no sean juegos casi iguales)."""
    return f"""Sos un asesor de juegos de mesa para alguien NO experto. {intent}.

{metodo}

Respuestas del usuario (traducidas de preguntas de la vida real):
{json.dumps(answers, ensure_ascii=False, indent=2)}{mentioned_txt}

Candidatos (prefiltrados por relevancia; evaluá TODOS y elegí los mejores):
{chr(10).join(games_txt)}

Analizá los {len(shortlist)} candidatos y elegí los 5 mejores para esta situación.
IMPORTANTE: el ORDEN en que los devolvés ES tu ranking de recomendación. Poné PRIMERO el que
MÁS recomendás para esta situación y así en orden decreciente, según tu evaluación de la ocasión,
lo que agregó el usuario en sus respuestas, y las estadísticas de cada juego (jugadores, tiempo,
complejidad, tema, mecánicas).
Para cada uno, un pitch en español rioplatense (es-AR), 3-4 frases, coloquial y concreto:
contá brevemente DE QUÉ VA el juego y su dinámica, y cerrá relacionándolo con lo que pidió.

Reglas de estilo del pitch (importante):
- No empieces una oración con un número: si arranca con una cantidad, escribila con palabras
  ("Cinco jugadores…", nunca "5 jugadores…"). Los números en medio de la frase van con dígitos
  ("dura 30 minutos", "en 5 minutos se explica").
- NUNCA menciones el número de complejidad (nada de "complejidad 2.3"). Describila cualitativamente:
  "ligera", "entre ligera y media", "media", "media-pesada" o "pesada".
- Para el idioma hablá de "dependencia de idioma/lectura" alta/media/baja (nunca "sin texto");
  baja = se puede jugar sin saber el idioma / sin leer casi nada.
- Tono relajado, como recomendándole un juego a un amigo. Sin floreo ni marketing.

Respondé SOLO JSON válido con esta forma exacta:
{{"picks":[{{"objectid":"<id>","pitch":"<3-4 frases>"}}]}}"""


def agent_pick(mode, answers, shortlist, limit, mentioned=None):
    if not shortlist:
        return {"engine": "agent", "mode": mode, "picks": [], "considered": 0,
                "note": "No hay candidatos que cumplan los filtros."}
    import appconfig
    cfg = appconfig.load()
    gem_key = cfg.get("gemini_api_key") or os.environ.get("GEMINI_API_KEY")
    gem_model = cfg.get("gemini_model") or "gemini-3.6-flash"

    def deterministico(note):
        return {"engine": "rules", "mode": mode, "picks": _picks_from_scored(shortlist[:limit]),
                "considered": len(shortlist), "note": note}

    # El modo agente es SOLO Gemini. Sin key -> determinístico.
    if not gem_key:
        return deterministico("Configurá tu API key de Gemini (⚙) para usar el modo agente.")

    if mentioned:
        print(f"[advisor] menciones detectadas: {[g['name'] for g in mentioned]}", flush=True)
    prompt = _build_prompt(mode, answers, shortlist, mentioned=mentioned)
    by_id = {g["objectid"]: (s, why, g) for s, why, g in shortlist}
    t0 = time.time()
    try:
        result_text = _call_gemini(prompt, gem_key, gem_model)
    except Exception as e:  # noqa
        print(f"[advisor] gemini FALLO en {time.time()-t0:.1f}s: {e}", flush=True)
        return deterministico("Gemini no respondió; usé el determinístico.")
    elapsed = time.time() - t0
    print(f"[advisor] gemini {gem_model} OK en {elapsed:.1f}s ({mode})", flush=True)
    used = "gemini:" + gem_model

    parsed = _extract_json(result_text) or {"picks": []}
    picks = []
    for p in parsed.get("picks", [])[:limit]:
        oid = str(p.get("objectid"))
        if oid in by_id:
            s, why, g = by_id[oid]
            picks.append({
                "objectid": oid, "name": g["name"], "image": g["image"], "thumb": g["thumb"],
                "weight": g["weight"], "subdomains": g["subdomains"],
                "reasons": [w for w in why if isinstance(w, str)],
                "pitch": p.get("pitch") or _mk_pitch(g, [w for w in why if isinstance(w, str)]),
            })
    if not picks:  # el LLM no devolvió ids válidos -> caemos al shortlist
        return {"engine": "rules", "mode": mode, "picks": _picks_from_scored(shortlist[:limit]),
                "considered": len(shortlist), "note": "El agente no devolvió juegos válidos."}
    # los candidatos que analizó el determinístico (en su orden), marcando cuáles eligió el agente
    picked_ids = {p["objectid"] for p in picks}
    candidates = [{"objectid": g["objectid"], "name": g["name"],
                   "subdomains": g.get("subdomains", []), "picked": g["objectid"] in picked_ids}
                  for _s, _why, g in shortlist]
    return {"engine": used, "mode": mode, "picks": picks, "considered": len(shortlist),
            "elapsed_ms": int(elapsed * 1000), "candidates": candidates}


def _call_gemini(prompt, key, model="gemini-3.6-flash"):
    """Llama a Gemini con razonamiento (thinking) al máximo dinámico. Si el modelo no
    soporta thinkingConfig, reintenta sin ese campo (robusto ante distintas versiones)."""
    import urllib.request
    import urllib.error
    url = ("https://generativelanguage.googleapis.com/v1beta/models/"
           + model + ":generateContent?key=" + key)

    def post(payload, tries=4):
        # timeout 60s por intento. Reintenta ante transitorios: HTTP 429/500/503 de Google, y
        # errores de red/SSL (típicos del proxy corporativo, que falla de forma intermitente).
        # Backoff creciente: 1.5s, 3s, 4.5s. Como el loader tiene piso de ~25s, los reintentos
        # que resuelven dentro de esa ventana son invisibles para el usuario.
        last = None
        for i in range(tries):
            req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return json.loads(r.read().decode())
            except urllib.error.HTTPError as e:
                # HTTPError es subclase de URLError: lo atajamos primero para tratar el 400 aparte
                if e.code in (429, 500, 503) and i < tries - 1:
                    last = e
                    time.sleep(1.5 * (i + 1))
                    continue
                raise
            except urllib.error.URLError as e:
                # red caída o SSL del proxy corporativo (intermitente) -> reintento
                if i < tries - 1:
                    last = e
                    time.sleep(1.5 * (i + 1))
                    continue
                raise
        raise last

    base = {"contents": [{"parts": [{"text": prompt}]}]}
    # thinkingBudget -1 = razonamiento dinámico (usa lo que necesite, esfuerzo alto)
    with_thinking = dict(base, generationConfig={"thinkingConfig": {"thinkingBudget": -1}})
    try:
        data = post(with_thinking)
    except urllib.error.HTTPError as e:
        if e.code == 400:
            data = post(base)
        else:
            raise

    parts = data["candidates"][0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts if "text" in p)
