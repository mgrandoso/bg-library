"""Tests livianos (sin pytest). Correr:  python tests.py
Cubren la lógica pura del advisor/bgg y una integración contra la DB seedeada."""
import bgg
import advisor
import db
import seed

db.init()  # garantiza migraciones idempotentes (p. ej. columna es_name) antes de testear

PASS = 0
FAIL = 0
SKIP = 0


def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok  {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}")


def bloque_falló(name, e):
    """Cierre de un bloque de tests que levantó. Distingue DOS cosas que antes se confundían:

    · falta una dependencia opcional (ImportError) -> OMITIDO, no es una falla. Antes esto salía
      como FAIL: correr los tests sin `fastapi` instalado daba "152 ok, 4 fail" y parecía que algo
      estaba roto cuando no había nada roto.
    · cualquier otra excepción -> FAIL de verdad (un test que se rompió).
    """
    global SKIP
    if isinstance(e, ImportError):
        SKIP += 1
        print(f"  skip {name} (falta '{getattr(e, 'name', None) or e}')")
    else:
        check(f"{name} ({e})", False)


def omitido(name, motivo):
    """Bloque que no se puede correr porque faltan DATOS, no porque algo esté roto."""
    global SKIP
    SKIP += 1
    print(f"  skip {name} ({motivo})")


# ---- bgg.parse_id ----
check("parse_id numérico", bgg.parse_id("173346") == "173346")
check("parse_id url", bgg.parse_id("https://boardgamegeek.com/boardgame/13/catan") == "13")
check("parse_id basura", bgg.parse_id("hola") is None)

# ---- weight_bucket ----
check("weight_bucket ligero", advisor.weight_bucket(1.2) == 0)
check("weight_bucket medio", advisor.weight_bucket(2.3) == 2)
check("weight_bucket pesado", advisor.weight_bucket(4.5) == 4)
check("weight_bucket None", advisor.weight_bucket(None) is None)

# ---- score_play: fit de jugadores ----
g_ok = {"best_players": [2], "recommended_players": [2, 3], "minplayers": 2, "maxplayers": 4,
        "weight": 2.2, "maxplaytime": 30, "minage_publisher": 10, "categories": [], "mechanics": [],
        "language_dependence": "No necessary in-game text", "rating_bayes": 7}
s_ideal, why_ideal = advisor.score_play(g_ok, {"players": 2})
check("score_play ideal suma", s_ideal >= 40)
s_no, why_no = advisor.score_play(g_ok, {"players": 6})
check("score_play descarta fuera de rango", s_no <= -50)

# ---- coop detection ----
g_coop = dict(g_ok, mechanics=["Cooperative Game"])
check("detecta cooperativo", advisor._is_coop(g_coop) is True)
check("no-coop", advisor._is_coop(g_ok) is False)

# ---- collection_profile ----
prof = advisor.collection_profile([g_ok, g_coop])
check("profile cuenta cobertura de 2 jugadores", prof["player_cover"][2] == 2)
check("profile cuenta coop", prof["coop"] == 1)

# ---- _vibe_bonus: acepta escalar o lista (OR entre bandas de complejidad) ----
check("vibe_bonus escalar liviano", advisor._vibe_bonus("light", 1.5) == (22, "liviano"))
check("vibe_bonus lista matchea alguna banda", advisor._vibe_bonus(["light", "medium"], 1.5)[0] == 22)
_pb = advisor._vibe_bonus(["heavy"], 1.5)[0]
check("vibe_bonus parcial si no cae en ninguna banda", 0 < _pb < 22)
check("vibe_bonus sin peso = 0", advisor._vibe_bonus(["light"], 0) == (0, None))
check("vibe_bonus lista vacía = 0", advisor._vibe_bonus([], 1.5) == (0, None))

# ---- dependencia de idioma: 3 niveles (none / light / any) ----
g_l1 = dict(g_ok, language_dependence="No necessary in-game text")
g_l2 = dict(g_ok, language_dependence="Some necessary text - easily memorized or small crib sheet")
check("lang_none nivel 1 = True", advisor._lang_none(g_l1) is True)
check("lang_none nivel 2 = False", advisor._lang_none(g_l2) is False)
check("lang_light nivel 2 = True", advisor._lang_light(g_l2) is True)
s_none, _ = advisor.score_play(g_l2, {"players": 2, "language_ok": "none"})
s_light, _ = advisor.score_play(g_l2, {"players": 2, "language_ok": "light"})
check("idioma 'sin texto' es más estricto que 'poco texto'", s_none < s_light)
s_bool, _ = advisor.score_play(g_l2, {"players": 2, "language_ok": True})
check("idioma booleano viejo se comporta como 'light' (compat)", s_bool == s_light)

# ---- integración contra la DB seedeada ----
# Este bloque corre contra la colección REAL de la base local, así que necesita que haya una.
# En un clon nuevo (o en CI) la base nace solo con el catálogo top-5000 del preseed y ningún juego
# marcado como propio: ahí no hay nada que integrar y el bloque se OMITE. Antes fallaba, y en el
# primer CI eso se leyó como "2 tests rotos" cuando en realidad faltaban datos.
try:
    conn = db.connect()
    me = db.get_me(conn)
    games = db.games_for_owner(conn, me)
    conn.close()
    own = [x for x in games if x["own"]]
except Exception as e:  # noqa
    games, own = [], []
    bloque_falló("integración DB (lectura)", e)

if not own:
    omitido("integración DB", "la base no tiene colección cargada")
else:
    try:
        check("DB: game tiene JSON parseado (subdomains lista)",
              isinstance(games[0]["subdomains"], list))

        rec = advisor.recommend("play", {"players": 2, "vibe": "medium"}, engine="rules", limit=3, owner_id=me)
        check("advisor play devuelve picks", len(rec["picks"]) > 0)
        check("advisor pick tiene pitch", bool(rec["picks"][0]["pitch"]))

        recb = advisor.recommend("buy", {"usual_players": 4, "vibe": "light", "safe_or_niche": "safe"},
                                 engine="rules", limit=3, owner_id=me)
        check("advisor buy devuelve picks", len(recb["picks"]) > 0)
    except Exception as e:  # noqa
        bloque_falló("integración DB", e)

# ---- strip de HTML ----
_stripped = bgg._strip_html("<p>Un <b>gran</b> juego</p> &amp; más")
check("strip_html saca tags", "<" not in _stripped and ">" not in _stripped)
check("strip_html desescapa entidades", "&amp;" not in _stripped and "&" in _stripped)
check("strip_html conserva palabras", "gran" in _stripped and "juego" in _stripped)
check("strip_html None", bgg._strip_html("") is None)

# ---- gap bonus en modo compra ----
# colección con MALA cobertura de 6 jugadores -> candidato para 6 debe puntuar el bonus de hueco
owned = [{"best_players": [2], "recommended_players": [2], "weight": 2.0, "subdomains": [],
          "mechanics": [], "categories": []}]
prof = advisor.collection_profile(owned)
cand = {"best_players": [6], "recommended_players": [5, 6], "weight": 1.8, "subdomains": ["Party Games"],
        "mechanics": [], "categories": [], "users_rated": 20000, "rating_bayes": 7.5,
        "rank_overall": 300, "wishlist_priority": 3}
s_gap, why_gap = advisor.score_buy(cand, {"usual_players": 6, "safe_or_niche": "safe"}, prof)
check("score_buy premia llenar hueco de 6 jugadores",
      any("hueco" in w for w in why_gap if isinstance(w, str)))

# ---- want_more acepta lista (OR de subdominios) + compat escalar ----
cand_str = dict(cand, subdomains=["Strategy Games"])
_s_list, why_list = advisor.score_buy(
    cand_str, {"usual_players": 6, "want_more": ["Strategy Games", "Abstract Games"]}, prof)
check("want_more lista matchea el subdominio", any("Strategy Games" in w for w in why_list if isinstance(w, str)))
s_scalar, _ = advisor.score_buy(cand_str, {"usual_players": 6, "want_more": "Strategy Games"}, prof)
check("want_more escalar sigue andando (compat)", s_scalar > 0)

# ---- import_csv en perfil temporal + cleanup ----
try:
    import seed as seedmod
    conn = db.connect()
    tmp = db.ensure_owner(conn, "__QA_TMP__", is_me=0)
    conn.close()
    csv_txt = "objectname,objectid,own,wishlist,wishlistpriority\nCatan,13,1,0,3\n"
    res = seedmod.import_csv(csv_txt, tmp, mode="both", fetch_missing=False)
    check("import_csv agrega holding", res["updated"] == 1)
    conn = db.connect()
    games = db.games_for_owner(conn, tmp)
    owns = [g for g in games if g["own"]]
    check("import_csv: perfil temporal tiene 1 juego", len(owns) == 1)
    conn.execute("DELETE FROM holdings WHERE owner_id=?", (tmp,))
    conn.execute("DELETE FROM owners WHERE id=?", (tmp,))
    conn.commit()
    conn.close()
    check("cleanup del perfil temporal", True)
except Exception as e:  # noqa
    bloque_falló("import_csv temporal", e)

# ---- ítem 7: desmarcar a "Ninguno" — estado real + GC por rank (membresía dinámica) ----
try:
    conn = db.connect()
    tmp7 = db.ensure_owner(conn, "__QA_ST__", is_me=0)
    db.upsert_bgg(conn, {"objectid": "__QA_PRE__", "name": "__QA_PRE__", "rank_overall": 1})       # en el top
    db.upsert_bgg(conn, {"objectid": "__QA_ORPH__", "name": "__QA_ORPH__", "rank_overall": None})  # fuera del top

    # bug fix: el estado vuelve aunque own=0 & wish=0 (antes set_state devolvía {"ok":True} pelado)
    db.set_holding(conn, tmp7, "__QA_PRE__", {"own": 1, "wishlist": 0})
    db.set_holding(conn, tmp7, "__QA_PRE__", {"own": 0, "wishlist": 0})
    conn.commit()
    _gs = db.game_with_state(conn, tmp7, "__QA_PRE__")
    check("game_with_state trae own/wishlist aunque sean 0",
          _gs is not None and _gs["own"] == 0 and _gs["wishlist"] == 0)

    # en el top (rank<=TOP_N) desmarcado -> NO se borra
    _kept = db.remove_if_orphan(conn, "__QA_PRE__")
    check("remove_if_orphan NO borra un juego del top",
          _kept is False and conn.execute(
              "SELECT 1 FROM games WHERE objectid='__QA_PRE__'").fetchone() is not None)

    # fuera del top que alguien tiene -> NO se borra (respeta la colección)
    db.set_holding(conn, tmp7, "__QA_ORPH__", {"own": 1, "wishlist": 0})
    conn.commit()
    check("remove_if_orphan NO borra si alguien lo tiene",
          db.remove_if_orphan(conn, "__QA_ORPH__") is False)

    # fuera del top sin dueño -> se borra
    db.set_holding(conn, tmp7, "__QA_ORPH__", {"own": 0, "wishlist": 0})
    conn.commit()
    _gone = db.remove_if_orphan(conn, "__QA_ORPH__")
    check("remove_if_orphan borra huérfano fuera del top",
          _gone is True and conn.execute(
              "SELECT 1 FROM games WHERE objectid='__QA_ORPH__'").fetchone() is None)

    # flag is_top para que el front decida si confirma
    _byid = {g["objectid"]: g for g in db.games_for_owner(conn, tmp7, top_n=db.TOP_N)}
    check("games_for_owner marca is_top=True en el top",
          _byid.get("__QA_PRE__", {}).get("is_top") is True)

    conn.execute("DELETE FROM holdings WHERE owner_id=?", (tmp7,))
    conn.execute("DELETE FROM owners WHERE id=?", (tmp7,))
    conn.execute("DELETE FROM games WHERE objectid IN ('__QA_PRE__','__QA_ORPH__')")
    conn.commit()
    conn.close()
    check("cleanup ítem 7", True)
except Exception as e:  # noqa
    bloque_falló("ítem 7 set_state/GC", e)

# ---- ítem 1a: es_name (búsqueda en español + menciones + migración) ----
try:
    conn = db.connect()
    cols_g = {r["name"] for r in conn.execute("PRAGMA table_info(games)").fetchall()}
    check("games tiene columna es_name", "es_name" in cols_g)

    # nombres únicos e inexistentes en el catálogo real, para no colisionar con juegos que ya
    # estén (p. ej. "The Resistance" existe -> _match_names consumiría el token con el real)
    db.upsert_bgg(conn, {"objectid": "__QA_ES__", "name": "Qxz Resistance Testgame"})
    conn.execute("UPDATE games SET es_name='Prueba Resistencia Qxz' WHERE objectid='__QA_ES__'")
    conn.commit()

    _ms_es = advisor.resolve_mentions(conn, "el finde jugamos a Prueba Resistencia Qxz", [])
    check("resolve_mentions encuentra por es_name",
          any(m.get("objectid") == "__QA_ES__" for m in _ms_es))
    _ms_en = advisor.resolve_mentions(conn, "jugamos Qxz Resistance Testgame", [])
    check("resolve_mentions sigue matcheando por name inglés",
          any(m.get("objectid") == "__QA_ES__" for m in _ms_en))
    # es_name viaja en el payload del juego (para el display en la ficha)
    _g = db.game_with_state(conn, db.get_me(conn), "__QA_ES__")
    check("es_name viaja en game_with_state", _g.get("es_name") == "Prueba Resistencia Qxz")

    conn.execute("DELETE FROM games WHERE objectid='__QA_ES__'")
    conn.commit()
    conn.close()
    check("cleanup ítem 1a", True)
except Exception as e:  # noqa
    bloque_falló("ítem 1a es_name", e)

# ---- import: want / wanttobuy cuentan como wishlist con prioridad alta ----
import seed as _seed
_st_wtb = _seed._state_from_row({"wanttobuy": "1"})
check("wanttobuy -> wishlist", _st_wtb["own"] == 0 and _st_wtb["wishlist"] == 1)
check("wanttobuy -> prioridad alta (<=2)", _st_wtb["wishlist_priority"] <= 2)
_st_wt = _seed._state_from_row({"want": "1"})
check("want -> wishlist con prioridad alta", _st_wt["wishlist"] == 1 and _st_wt["wishlist_priority"] <= 2)
_st_wl = _seed._state_from_row({"wishlist": "1", "wishlistpriority": "4"})
check("wishlist explícita mantiene su prioridad", _st_wl["wishlist"] == 1 and _st_wl["wishlist_priority"] == 4)
_st_own = _seed._state_from_row({"own": "1", "wanttobuy": "1"})
check("own gana sobre wanttobuy (no wishlist)", _st_own["own"] == 1 and _st_own["wishlist"] == 0)

# ---- ítem 1b: resolver de es_name (LLM inyectable, parseo robusto, batcheo) ----
_es_items = [
    {"id": "1", "name": "The Resistance", "alt": ["La Resistencia", "Der Widerstand"]},
    {"id": "2", "name": "Azul", "alt": ["Azul", "アズール"]},
    {"id": "3", "name": "Wingspan", "alt": ["Flügelschlag", "Alas"]},
]
_es_prompt = advisor._build_esname_prompt(_es_items)
check("prompt es_name incluye nombres y alternativos",
      "The Resistance" in _es_prompt and "La Resistencia" in _es_prompt)

def _llm_ok(p):
    return 'listo ```json\n{"1":"La Resistencia","2":"Azul","3":"Alas"}\n``` fin'
_r_ok = advisor.resolve_es_names(_es_items, _llm_ok)
check("resolve elige el nombre en español", _r_ok["1"] == "La Resistencia" and _r_ok["3"] == "Alas")
check("resolve devuelve todos los ids", set(_r_ok) == {"1", "2", "3"})

def _llm_garbage(p):
    return "no tengo idea de esto"
_r_bad = advisor.resolve_es_names(_es_items, _llm_garbage)
check("resolve con basura cae al nombre principal",
      _r_bad["1"] == "The Resistance" and set(_r_bad) == {"1", "2", "3"})

def _llm_partial(p):
    return '{"1":"La Resistencia"}'
_r_part = advisor.resolve_es_names(_es_items, _llm_partial)
check("resolve completa faltantes con el nombre principal",
      _r_part["2"] == "Azul" and _r_part["3"] == "Wingspan")

_calls = []
def _llm_count(p):
    _calls.append(1)
    return "{}"
_r_chunk = advisor.resolve_es_names(_es_items, _llm_count, chunk_size=1)
check("resolve batchea por chunk_size (1 llamada por chunk)",
      len(_calls) == 3 and set(_r_chunk) == {"1", "2", "3"})

check("resolve lista vacía = {} sin llamar al LLM", advisor.resolve_es_names([], _llm_count) == {})

# ---- ítem 1c: captura de alt-names + popular es_name de los NULL (todo inyectable) ----
check("_alt_names extrae nombres",
      bgg._alt_names({"alternatenames": [{"nameid": 1, "name": "Azul"}, {"name": "アズール"}]})
      == ["Azul", "アズール"])
check("_alt_names sin alternatenames = []", bgg._alt_names({}) == [])
check("_alt_names tolera lista de strings", bgg._alt_names({"alternatenames": ["Uno", "Dos"]})
      == ["Uno", "Dos"])

try:
    conn = db.connect()
    tmp1c = db.ensure_owner(conn, "__QA_ESM__", is_me=0)
    db.upsert_bgg(conn, {"objectid": "__QA_M1__", "name": "Skull Game QA"})  # es_name NULL
    db.set_holding(conn, tmp1c, "__QA_M1__", {"own": 1})
    conn.commit()
    conn.close()

    def _fetch_alt(oid):
        return ["Calavera QA", "Totenkopf"]
    def _llm_es(p):
        return '{"__QA_M1__":"Calavera QA"}'
    # only_ids aísla el test a nuestro juego (la función global tocaría los NULL reales de la base)
    _rm = _seed.resolve_missing_es_names(_llm_es, _fetch_alt, only_ids=["__QA_M1__"])
    check("resolve_missing_es_names popula al menos 1", _rm["resolved"] >= 1)

    conn = db.connect()
    _val = conn.execute("SELECT es_name FROM games WHERE objectid='__QA_M1__'").fetchone()["es_name"]
    check("es_name quedó guardado en la base", _val == "Calavera QA")

    # sin NULLs pendientes no llama al LLM (idempotente)
    _calls_rm = []
    _rm2 = _seed.resolve_missing_es_names(
        lambda p: _calls_rm.append(1) or "{}", _fetch_alt, only_ids=["__QA_M1__"])
    check("resolve_missing_es_names no reprocesa lo ya resuelto",
          _rm2["resolved"] == 0 and len(_calls_rm) == 0)

    conn.execute("DELETE FROM holdings WHERE owner_id=?", (tmp1c,))
    conn.execute("DELETE FROM owners WHERE id=?", (tmp1c,))
    conn.execute("DELETE FROM games WHERE objectid='__QA_M1__'")
    conn.commit()
    conn.close()
    check("cleanup ítem 1c", True)
except Exception as e:  # noqa
    bloque_falló("ítem 1c resolve_missing_es_names", e)

# ---- tema 3: un update resuelve TODOS los pendientes, partidos en tandas internas ----
try:
    conn = db.connect()
    tmpT = db.ensure_owner(conn, "__QA_TANDAS__", is_me=0)
    _ids = ["__QA_T1__", "__QA_T2__", "__QA_T3__"]
    for oid in _ids:
        db.upsert_bgg(conn, {"objectid": oid, "name": oid})       # es_name NULL
        db.set_holding(conn, tmpT, oid, {"own": 1})
    conn.commit()
    conn.close()

    _tanda_calls = []
    def _llm_t(p):
        _tanda_calls.append(1)
        return "{" + ",".join(f'"{oid}":"{oid} ES"' for oid in _ids) + "}"
    # chunk_size=2 con 3 pendientes -> 2 tandas, pero resuelve los 3 en una sola corrida
    _rt = _seed.resolve_missing_es_names(
        _llm_t, lambda oid: [], only_ids=_ids, chunk_size=2)
    check("tema 3: resuelve TODOS los pendientes en una corrida", _rt["resolved"] == 3)
    check("tema 3: reporta 2 tandas (3 pendientes / chunk 2)", _rt["tandas"] == 2)
    check("tema 3: hizo 2 llamadas al LLM (una por tanda)", len(_tanda_calls) == 2)

    conn = db.connect()
    conn.execute("DELETE FROM holdings WHERE owner_id=?", (tmpT,))
    conn.execute("DELETE FROM owners WHERE id=?", (tmpT,))
    conn.executemany("DELETE FROM games WHERE objectid=?", [(o,) for o in _ids])
    conn.commit()
    conn.close()
    check("cleanup tema 3", True)
except Exception as e:  # noqa
    bloque_falló("tema 3 tandas", e)

# ---- runtime: gemini_caller / resolve_es_names_runtime gatean por presencia de key ----
import appconfig as _appcfg
_orig_load = _appcfg.load
try:
    _appcfg.load = lambda: {"gemini_api_key": "", "gemini_model": "x"}
    check("gemini_caller sin key = None", advisor.gemini_caller() is None)
    check("resolve_es_names_runtime sin key avisa no_key",
          _seed.resolve_es_names_runtime().get("no_key") is True)
    _appcfg.load = lambda: {"gemini_api_key": "KEYFAKE", "gemini_model": "m"}
    check("gemini_caller con key = callable", callable(advisor.gemini_caller()))
finally:
    _appcfg.load = _orig_load

# ---- ítem 4: refresh de ranks por dump (meta / url-por-fecha / parse / apply) ----
from datetime import date as _date

# meta key-value (last_update)
conn = db.connect()
db.meta_set(conn, "__qa_k__", "hola")
conn.commit()
check("meta_set/meta_get", db.meta_get(conn, "__qa_k__") == "hola")
check("meta_get default", db.meta_get(conn, "__nope__", "def") == "def")
conn.execute("DELETE FROM meta WHERE key='__qa_k__'")
conn.commit()
conn.close()

# encontrar el dump más reciente por fecha (retrocede día a día, sin LLM)
_seen = {"https://raw.githubusercontent.com/beefsack/bgg-ranking-historicals/master/2026-08-06.csv"}
_url, _ds = _seed._latest_dump_url(_date(2026, 8, 8), lambda u: u in _seen, back_days=7)
check("_latest_dump_url encuentra el más reciente disponible", _ds == "2026-08-06")
_u2, _d2 = _seed._latest_dump_url(_date(2026, 8, 8), lambda u: False, back_days=3)
check("_latest_dump_url None si no hay en la ventana", _u2 is None and _d2 is None)

# parse del CSV del dump
_dump_csv = ("ID,Name,Year,Rank,Average,Bayes average,Users rated,URL,Thumbnail\n"
             "224517,Brass: Birmingham,2018,1,8.6,8.4,45000,/x,/y\n"
             "13,CATAN,1995,500,7.1,6.9,120000,/a,/b\n"
             ",NoID,2000,3,5,5,10,,\n")
_dp = _seed.parse_rank_dump(_dump_csv)
# rank_overall es la POSICIÓN enumerada (1..N), no el entero crudo del dump: Brass=1, CATAN=2
check("parse_rank_dump enumera posición", _dp["224517"]["rank_overall"] == 1 and _dp["13"]["rank_overall"] == 2)
check("parse_rank_dump toma bayes", abs(_dp["224517"]["rating_bayes"] - 8.4) < 0.001)
check("parse_rank_dump ignora filas sin ID", len(_dp) == 2)
check("parse_rank_dump respeta limit", len(_seed.parse_rank_dump(_dump_csv, limit=1)) == 1)

# enumeración = fuente única de rank: sin repetidos ni saltos aunque el dump traiga dup/huecos
_noisy = ("ID,Name,Year,Rank,Average,Bayes average,Users rated,URL,Thumbnail\n"
          "10,A,2000,1,8,8.5,100,,\n"
          "20,B,2001,3,8,8.4,100,,\n"      # hueco: falta el rank 2 en el dump
          "30,C,2002,3,8,8.6,100,,\n"      # rank 3 DUPLICADO (empata con B); bayes 8.6 > 8.4
          "40,D,2003,5,8,8.0,100,,\n")     # hueco: falta el rank 4
_en = _seed.parse_rank_dump(_noisy)
_ranks = sorted(v["rank_overall"] for v in _en.values())
check("enumeración: 4 juegos con ranks 1..4 contiguos", _ranks == [1, 2, 3, 4])
check("enumeración: sin ranks repetidos", len(_ranks) == len(set(_ranks)))
check("enumeración: desempata rank igual por bayes desc (C antes que B)",
      _en["30"]["rank_overall"] < _en["20"]["rank_overall"])
check("enumeración: respeta el orden global del dump (A=1, D=último)",
      _en["10"]["rank_overall"] == 1 and _en["40"]["rank_overall"] == 4)

# FILAS DUPLICADAS (mismo id repetido, como trae beefsack): se deduplican ANTES de enumerar, así
# NO dejan hueco ni pierden un juego. 3 filas / 2 juegos -> ranks 1..2 contiguos.
_dupdump = ("ID,Name,Year,Rank,Average,Bayes average,Users rated,URL,Thumbnail\n"
            "10,A,2000,1,8,8.5,100,,\n"
            "20,B,2001,2,8,8.4,100,,\n"
            "20,B,2001,2,8,8.4,100,,\n")     # fila DUPLICADA de B (mismo id)
_dd = _seed.parse_rank_dump(_dupdump)
check("dedup: fila duplicada no agrega un juego (2 únicos)", len(_dd) == 2)
check("dedup: ranks contiguos 1..2 sin hueco por el duplicado",
      sorted(v["rank_overall"] for v in _dd.values()) == [1, 2])

# aplicar el dump: reposiciona SOLO los del catálogo, no agrega juegos
try:
    conn = db.connect()
    db.upsert_bgg(conn, {"objectid": "__QA_RK__", "name": "RankQA", "rank_overall": 9999, "rating_bayes": 1.0})
    conn.commit()
    conn.close()
    _n = _seed.apply_rank_dump({
        "__QA_RK__": {"rank_overall": 42, "rating_bayes": 7.7, "rating_avg": 7.9, "users_rated": 100},
        "__NOTIN__": {"rank_overall": 1, "rating_bayes": 9, "rating_avg": 9, "users_rated": 9}})
    check("apply_rank_dump actualiza solo los del catálogo", _n == 1)
    conn = db.connect()
    _rk = conn.execute("SELECT rank_overall, rating_bayes FROM games WHERE objectid='__QA_RK__'").fetchone()
    check("apply_rank_dump reposiciona rank+rating",
          _rk["rank_overall"] == 42 and abs(_rk["rating_bayes"] - 7.7) < 0.001)
    check("apply_rank_dump NO agrega juegos nuevos",
          conn.execute("SELECT 1 FROM games WHERE objectid='__NOTIN__'").fetchone() is None)
    conn.execute("DELETE FROM games WHERE objectid='__QA_RK__'")
    conn.commit()
    conn.close()
    check("cleanup apply_rank_dump", True)
except Exception as e:  # noqa
    bloque_falló("apply_rank_dump", e)

# ---- membresía dinámica: reconcile_top da de alta entrantes; el GC baja los caídos no tenidos ----
# En DB temporal aislado: top_n chico y gc global no pueden correr sobre la base real sin borrarla.
import os as _os
import tempfile as _tf
_orig_db_path = db.DB_PATH
_tmpdb = _os.path.join(_tf.gettempdir(), "bg_reconcile_test.db")
try:
    if _os.path.exists(_tmpdb):
        _os.remove(_tmpdb)
    db.DB_PATH = _tmpdb
    db.init()
    conn = db.connect()
    _rowner = db.ensure_owner(conn, "RecOwner", is_me=0)
    db.upsert_bgg(conn, {"objectid": "A", "name": "A", "rank_overall": 1})   # sigue en el top
    db.upsert_bgg(conn, {"objectid": "B", "name": "B", "rank_overall": 2})   # cae del top pero TENIDO
    db.upsert_bgg(conn, {"objectid": "C", "name": "C", "rank_overall": 3})   # cae del top, sin dueño
    db.set_holding(conn, _rowner, "B", {"own": 1})
    conn.commit()
    conn.close()

    # dump enumerado: entra X en #2; B y C se caen a #5 y #6 (top_n=3)
    _rdump = {
        "A": {"rank_overall": 1, "rating_bayes": 8.0, "rating_avg": 8.1, "users_rated": 10},
        "X": {"rank_overall": 2, "rating_bayes": 7.9, "rating_avg": 8.0, "users_rated": 9},
        "B": {"rank_overall": 5, "rating_bayes": 7.0, "rating_avg": 7.1, "users_rated": 8},
        "C": {"rank_overall": 6, "rating_bayes": 6.0, "rating_avg": 6.1, "users_rated": 7},
    }
    _fetched = []
    def _fake_fetch(oid):
        _fetched.append(oid)
        return {"objectid": oid, "name": "Nuevo " + oid, "rank_overall": 999}
    _rc = _seed.reconcile_top(_rdump, top_n=3, fetch=_fake_fetch)
    check("reconcile_top da de alta SOLO al entrante nuevo", _rc["altas"] == 1 and _fetched == ["X"])

    conn = db.connect()
    _x = conn.execute("SELECT name, rank_overall FROM games WHERE objectid='X'").fetchone()
    check("entrante insertado con datos de BGG y rank enumerado del dump",
          _x is not None and _x["name"] == "Nuevo X" and _x["rank_overall"] == 2)

    # bajas: keep = top(rank<=3) ∪ tenidos
    _orphans = db.gc_orphans(conn, db.top_ids(conn, top_n=3))
    conn.commit()
    check("GC baja al que cayó del top y nadie tiene (C)", "C" in _orphans)
    check("GC respeta la colección: B cayó del top pero es tenido -> queda",
          "B" not in _orphans
          and conn.execute("SELECT 1 FROM games WHERE objectid='B'").fetchone() is not None)
    check("el que sigue en el top (A) queda",
          conn.execute("SELECT 1 FROM games WHERE objectid='A'").fetchone() is not None)
    conn.close()
    check("cleanup reconcile_top", True)
except Exception as e:  # noqa
    bloque_falló("reconcile_top / membresía dinámica", e)
finally:
    db.DB_PATH = _orig_db_path
    try:
        if _os.path.exists(_tmpdb):
            _os.remove(_tmpdb)
    except Exception:  # noqa
        pass

# ---- ítem 1: refresh_tail pone al día por id SOLO la cola >DUMP_N tenida (reemplaza el pase profundo) ----
_tmpdb2 = _os.path.join(_tf.gettempdir(), "bg_tail_test.db")
try:
    if _os.path.exists(_tmpdb2):
        _os.remove(_tmpdb2)
    db.DB_PATH = _tmpdb2
    db.init()
    conn = db.connect()
    _towner = db.ensure_owner(conn, "TailOwner", is_me=0)
    db.upsert_bgg(conn, {"objectid": "T1", "name": "Cola tenida", "rank_overall": 15000})  # >DUMP_N, tenido
    db.upsert_bgg(conn, {"objectid": "T2", "name": "Expa sin rank", "rank_overall": None}) # sin rank -> skip
    db.upsert_bgg(conn, {"objectid": "T3", "name": "En el dump", "rank_overall": 8000})    # <=DUMP_N -> lo hace el dump
    db.upsert_bgg(conn, {"objectid": "T4", "name": "Cola NO tenida", "rank_overall": 20000})  # no tenido -> skip
    db.upsert_bgg(conn, {"objectid": "T5", "name": "Cola sin rank nuevo", "rank_overall": 16000})
    for _o in ("T1", "T2", "T3", "T5"):
        db.set_holding(conn, _towner, _o, {"own": 1})
    conn.commit()
    conn.close()

    _tfetched = []
    def _tail_fetch(oid):
        _tfetched.append(oid)
        if oid == "T5":
            return {"objectid": oid, "rank_overall": None, "rating_bayes": 5.5}  # miss de rank -> COALESCE
        return {"objectid": oid, "rank_overall": 14500, "rating_bayes": 6.1, "rating_avg": 6.2,
                "users_rated": 42}
    _tr = _seed.refresh_tail(fetch=_tail_fetch, dump_n=10000)
    check("refresh_tail toca SOLO la cola >DUMP_N tenida (T1, T5)", sorted(_tfetched) == ["T1", "T5"])
    check("refresh_tail reporta tail=2 refreshed=2", _tr["tail"] == 2 and _tr["refreshed"] == 2)
    conn = db.connect()
    _t1 = conn.execute("SELECT rank_overall, rating_bayes FROM games WHERE objectid='T1'").fetchone()
    check("refresh_tail actualiza rank+rating de la cola", _t1["rank_overall"] == 14500)
    _t5 = conn.execute("SELECT rank_overall FROM games WHERE objectid='T5'").fetchone()
    check("refresh_tail COALESCE: un miss de rank NO borra el valor conocido", _t5["rank_overall"] == 16000)
    conn.close()
    check("cleanup refresh_tail", True)
except Exception as e:  # noqa
    bloque_falló("refresh_tail", e)
finally:
    db.DB_PATH = _orig_db_path
    try:
        if _os.path.exists(_tmpdb2):
            _os.remove(_tmpdb2)
    except Exception:  # noqa
        pass

# ---- ítem 8: bgg.search no arma URL camo falsa (monkeypatch de la red) ----
_og_get = bgg._get
try:
    bgg._get = lambda url, retries=3: {"items": [
        {"objectid": 13, "name": "CATAN", "yearpublished": 1995,
         "rep_imageid": 999, "href": "/boardgame/13/catan"}]}
    _sr = bgg.search("catan", n=5)
    check("search devuelve id/name/año",
          _sr[0]["objectid"] == "13" and _sr[0]["name"] == "CATAN" and _sr[0]["yearpublished"] == 1995)
    check("search NO arma thumb camo", not _sr[0].get("thumb"))
    check("search arma href absoluto de BGG", _sr[0]["href"] == "https://boardgamegeek.com/boardgame/13/catan")
finally:
    bgg._get = _og_get

# ---- ítem 2: guard de expansiones (bgg.fetch marca is_expansion; expansions_of lista oficiales) ----
_og_get2 = bgg._get
try:
    def _fake_geek(url, retries=3):
        if "dynamicinfo" in url:
            return {"item": {}}
        if "objectid=325" in url:   # expansión: subtype canónico + expandsboardgame (madre)
            return {"item": {"name": "Catan: Seafarers", "subtype": "boardgameexpansion",
                             "links": {"expandsboardgame": [{"objectid": 13, "name": "Catan"}],
                                       "boardgameexpansion": [{"objectid": 999, "name": "Sub-exp"}]}}}
        return {"item": {"name": "Catan", "subtype": "boardgame",   # base
                         "links": {"boardgameexpansion": [
                             {"objectid": 325, "name": "Catan: Seafarers"},
                             {"objectid": 326, "name": "Catan: Cities & Knights"}]}}}
    bgg._get = _fake_geek
    _exp = bgg.fetch("325")
    check("fetch marca is_expansion en una expansión", _exp["is_expansion"] is True)
    check("fetch trae la madre en expands", _exp["expands"] == [{"id": "13", "name": "Catan"}])
    _base = bgg.fetch("13")
    check("fetch NO marca expansión a un juego base",
          _base["is_expansion"] is False and _base["expands"] == [])
    _off = bgg.expansions_of("13")
    check("expansions_of lista las expansiones oficiales del base",
          {e["id"] for e in _off} == {"325", "326"})
finally:
    bgg._get = _og_get2

# ---- ítem 2: /api/games/add rechaza una expansión (no entra al catálogo como juego suelto) ----
try:
    import app as _app
    import json as _json
    _ogfetch = bgg.fetch
    bgg.fetch = lambda oid: {"objectid": oid, "name": "Una Expa", "is_expansion": True,
                             "expands": [{"id": "13", "name": "Catan"}]}
    try:
        _resp = _app.add_game({"objectid": "325"})
        _body = _json.loads(_resp.body)
        check("add_game rechaza expansión con 400", getattr(_resp, "status_code", None) == 400)
        check("add_game devuelve is_expansion + madre", _body.get("is_expansion") is True
              and _body.get("expands") == [{"id": "13", "name": "Catan"}])
    finally:
        bgg.fetch = _ogfetch
except Exception as e:  # noqa
    bloque_falló("add_game guard expansión", e)

# ---- ítem 9: tier de ajuste a N jugadores (fit) en SQL ----
try:
    import app as _app
    import sqlite3 as _sq
    _c = _sq.connect(":memory:"); _c.row_factory = _sq.Row
    _c.execute("CREATE TABLE games (objectid TEXT, best_players TEXT, recommended_players TEXT, "
               "minplayers INT, maxplayers INT)")
    _c.executemany("INSERT INTO games VALUES (?,?,?,?,?)", [
        ("A", "[2, 3]", "[4]", 2, 5),   # N=2 -> ideal (0)
        ("B", "[4]", "[2, 3]", 2, 5),   # N=2 -> va bien (1)
        ("C", "[5]", "[5]", 1, 8),      # N=2 -> se banca (2)
        ("D", "[5]", "[5]", 3, 4),      # N=2 -> no entra (3)
    ])
    _case = _app._fit_case(2)
    _res = {r["objectid"]: r["t"] for r in _c.execute(f"SELECT objectid, {_case} t FROM games g")}
    _c.close()
    check("fit_case ideal=0", _res["A"] == 0)
    check("fit_case va bien=1", _res["B"] == 1)
    check("fit_case se banca=2", _res["C"] == 2)
    check("fit_case no entra=3", _res["D"] == 3)
except Exception as e:  # noqa
    bloque_falló("fit_case", e)

# ---- ítem 9: grupo de mecánicas (OR interno; coop mira mechanics+categories) ----
try:
    import app as _app
    import sqlite3 as _sq
    _c2 = _sq.connect(":memory:"); _c2.row_factory = _sq.Row
    _c2.execute("CREATE TABLE games (objectid TEXT, mechanics TEXT, categories TEXT)")
    _c2.executemany("INSERT INTO games VALUES (?,?,?)", [
        ("WP", '["Worker Placement", "Dice Rolling"]', '[]'),
        ("CO", '["Hand Management"]', '["Cooperative"]'),   # coop por CATEGORÍA (no mechanic)
        ("NO", '["Trading"]', '["Economic"]'),
    ])
    def _mech_ids(mechs):
        cl, pr = _app._mech_where(mechs)
        return {r["objectid"] for r in _c2.execute(f"SELECT objectid FROM games g WHERE {cl}", pr)}
    check("_mech_where matchea string canónico", _mech_ids(["Worker Placement"]) == {"WP"})
    check("_mech_where coop mira categorías", _mech_ids(["Cooperative Game"]) == {"CO"})
    check("_mech_where OR entre mecánicas", _mech_ids(["Worker Placement", "Cooperative Game"]) == {"WP", "CO"})
    _c2.close()
except Exception as e:  # noqa
    bloque_falló("_mech_where", e)

# ---- ítem 5: conteo de es_name pendientes del perfil ----
try:
    conn = db.connect()
    _me = db.get_me(conn)
    db.upsert_bgg(conn, {"objectid": "__QA_ESP__", "name": "EsPendQA"})  # sin es_name -> NULL
    conn.execute("UPDATE games SET es_name=NULL WHERE objectid='__QA_ESP__'")
    db.set_holding(conn, _me, "__QA_ESP__", {"own": 1, "wishlist": 0})
    conn.commit()
    _before = db.count_es_pending(conn, _me)
    check("count_es_pending cuenta un pendiente", _before >= 1)
    conn.execute("UPDATE games SET es_name='EsPendQA' WHERE objectid='__QA_ESP__'"); conn.commit()
    check("count_es_pending baja al resolver", db.count_es_pending(conn, _me) == _before - 1)
    conn.execute("DELETE FROM holdings WHERE objectid='__QA_ESP__'")
    conn.execute("DELETE FROM games WHERE objectid='__QA_ESP__'")
    conn.commit(); conn.close()
    check("cleanup count_es_pending", True)
except Exception as e:  # noqa
    bloque_falló("count_es_pending", e)

# ---- ítem 3: expansiones (tabla name-only, gate por base own/wish, upsert, agrupado) ----
try:
    conn = db.connect()
    _me = db.get_me(conn)
    db.upsert_bgg(conn, {"objectid": "__QA_BASE__", "name": "Base QA"})
    check("gate: sin tener el base, no se puede agregar expa",
          db.owns_or_wishes(conn, _me, "__QA_BASE__") is False)
    db.set_holding(conn, _me, "__QA_BASE__", {"own": 1})
    conn.commit()
    check("gate: con el base en own, sí", db.owns_or_wishes(conn, _me, "__QA_BASE__") is True)
    db.set_expansion(conn, _me, "__QA_BASE__", "E1", "Expa Uno", "own", short_description="una expa")
    db.set_expansion(conn, _me, "__QA_BASE__", "E2", "Expa Dos", "wish")
    conn.commit()
    _mine = db.expansions_for(conn, _me, "__QA_BASE__")
    check("expansions_for lista las 2 con su estado",
          {e["exp_oid"]: e["state"] for e in _mine} == {"E1": "own", "E2": "wish"})
    check("set_expansion guarda short_description",
          {e["exp_oid"]: e["short_description"] for e in _mine}["E1"] == "una expa")
    # upsert sin short_description NO pisa la ya guardada (COALESCE)
    db.set_expansion(conn, _me, "__QA_BASE__", "E1", "Expa Uno", "wish"); conn.commit()
    check("upsert sin short_description conserva la anterior (COALESCE)",
          {e["exp_oid"]: e["short_description"] for e in db.expansions_for(conn, _me, "__QA_BASE__")}["E1"] == "una expa")
    db.set_expansion(conn, _me, "__QA_BASE__", "E2", "Expa Dos", "own"); conn.commit()
    _mine2 = {e["exp_oid"]: e["state"] for e in db.expansions_for(conn, _me, "__QA_BASE__")}
    check("set_expansion es upsert (no duplica, cambia estado)", len(_mine2) == 2 and _mine2["E2"] == "own")
    db.set_expansion(conn, _me, "__QA_BASE__", "E3", "Expa Tres", "loquesea"); conn.commit()
    _st3 = {e["exp_oid"]: e["state"] for e in db.expansions_for(conn, _me, "__QA_BASE__")}["E3"]
    check("state inválido cae a 'wish'", _st3 == "wish")
    _all = db.expansions_for(conn, _me)
    check("expansions_for sin base agrupa por base_oid",
          "__QA_BASE__" in _all and len(_all["__QA_BASE__"]) == 3)
    # búsqueda inversa: de un objectid a "¿es una expansión que ya tengo?". La usa /api/lookup
    # para abrir la ficha correcta cuando el id ya está en la base.
    _h = db.expansion_holding(conn, _me, "E2")
    check("expansion_holding encuentra la expa por su objectid",
          bool(_h) and _h["base_oid"] == "__QA_BASE__" and _h["state"] == "own")
    check("expansion_holding trae el nombre del juego madre", _h["base_name"] == "Base QA")
    check("expansion_holding devuelve None si el id no es expansión tuya",
          db.expansion_holding(conn, _me, "__NO_EXISTE__") is None)
    check("expansion_holding tiene scope por perfil",
          db.expansion_holding(conn, _me + 9999, "E2") is None)
    db.remove_expansion(conn, _me, "__QA_BASE__", "E1"); conn.commit()
    check("remove_expansion saca una", len(db.expansions_for(conn, _me, "__QA_BASE__")) == 2)
    conn.execute("DELETE FROM expansions WHERE base_oid='__QA_BASE__'")
    conn.execute("DELETE FROM holdings WHERE objectid='__QA_BASE__'")
    conn.execute("DELETE FROM games WHERE objectid='__QA_BASE__'")
    conn.commit(); conn.close()
    check("cleanup expansiones", True)
except Exception as e:  # noqa
    bloque_falló("expansiones", e)

# ---- ítem 3: el endpoint set_expansion_ep respeta el gate (base no tenido -> 400) ----
try:
    import app as _app
    # Las rutas reciben la conexión por Depends(get_conn). Llamadas directo como función (sin pasar
    # por FastAPI) hay que pasársela a mano, si no llega el objeto Depends y revienta.
    _c = db.connect()
    try:
        _rr = _app.set_expansion_ep("__QA_NOPE__", {"exp_oid": "Z", "name": "Z", "state": "own"},
                                    conn=_c)
    finally:
        _c.close()
    check("set_expansion_ep bloquea si no tenés el base", getattr(_rr, "status_code", None) == 400)
except Exception as e:  # noqa
    bloque_falló("set_expansion_ep gate", e)

# ---- expansiones en el advisor: db.owned_expansions_for (solo 'own', agrupado, con short_desc) ----
try:
    conn = db.connect(); _me = db.get_me(conn)
    db.upsert_bgg(conn, {"objectid": "__QA_EXB__", "name": "Base Exp QA"})
    db.set_holding(conn, _me, "__QA_EXB__", {"own": 1})
    db.set_expansion(conn, _me, "__QA_EXB__", "OE1", "Own Expa", "own", short_description="jugable ya")
    db.set_expansion(conn, _me, "__QA_EXB__", "WE1", "Wish Expa", "wish", short_description="la quiero")
    conn.commit()
    _oe = db.owned_expansions_for(conn, _me)
    check("owned_expansions_for agrupa por base_oid", "__QA_EXB__" in _oe)
    check("owned_expansions_for trae SOLO las 'own'",
          [e["name"] for e in _oe["__QA_EXB__"]] == ["Own Expa"])
    check("owned_expansions_for incluye short_description",
          _oe["__QA_EXB__"][0]["short_description"] == "jugable ya")
    conn.execute("DELETE FROM expansions WHERE base_oid='__QA_EXB__'")
    conn.execute("DELETE FROM holdings WHERE objectid='__QA_EXB__'")
    conn.execute("DELETE FROM games WHERE objectid='__QA_EXB__'")
    conn.commit(); conn.close()
    check("cleanup owned_expansions_for", True)
except Exception as e:  # noqa
    bloque_falló("owned_expansions_for", e)

# ---- expansiones en el prompt del advisor: play las incluye + instruye; buy no ----
try:
    _gx = {"objectid": "X1", "name": "Juego X", "yearpublished": 2020,
           "subdomains": ["Strategy Games"], "weight": 2.5, "minplayers": 1, "maxplayers": 4,
           "best_players": [3], "maxplaytime": 60, "minage_publisher": 12,
           "language_dependence": "No necessary in-game text", "mechanics": ["Hand Management"],
           "expansions": [{"name": "Gran Expa", "short_description": "agrega modo solo y cartas nuevas"}]}
    _sl = [(50.0, ["va bien"], _gx)]
    _p_play = advisor._build_prompt("play", {"players": 3}, _sl)
    check("prompt play incluye EXPANSIONES QUE POSEE", "EXPANSIONES QUE POSEE" in _p_play)
    check("prompt play incluye el nombre de la expa", "Gran Expa" in _p_play)
    check("prompt play incluye la short_description de la expa", "modo solo" in _p_play)
    check("prompt play instruye sobre expansiones (sugerir/omitir)",
          "expansi" in _p_play.lower() and "suger" in _p_play.lower())
    _p_buy = advisor._build_prompt("buy", {"usual_players": 3}, _sl)
    check("prompt buy NO incluye expansiones (solo juegos)", "EXPANSIONES QUE POSEE" not in _p_buy)
    check("prompt usa ref corto (#1) en vez del objectid", "#1 |" in _p_play and "id=X1" not in _p_play)
except Exception as e:  # noqa
    bloque_falló("expansiones en prompt", e)

# ---- guard ref-pitch: reasignar el pitch al juego correcto por `name`, y retención de traza ----
try:
    import os
    # exacto gana a contención cuando conviven 'Skull' y 'Skull King'
    _mkg = lambda oid, name: {"objectid": oid, "name": name, "image": "", "thumb": "",
                              "weight": 2.0, "subdomains": [], "es_name": ""}
    _sk = [(9.0, ["a"], _mkg("SK", "Skull King")), (8.0, ["b"], _mkg("S", "Skull"))]
    check("_find_in_shortlist_by_name: exacto gana a contención",
          advisor._find_in_shortlist_by_name(_sk, "Skull")[2]["objectid"] == "S")

    # agent_pick: el modelo pone ref=1 (Scotland Yard) pero name/pitch son de Take Five → reasigna
    _shortlist = [(9.0, ["r1"], _mkg("2996", "Scotland Yard")),
                  (8.0, ["r2"], _mkg("432", "Take Five"))]
    _orig_call = advisor._call_gemini
    _orig_trace = advisor.TRACE_ENABLED
    advisor.TRACE_ENABLED = False   # no escribir archivo en tests
    os.environ["GEMINI_API_KEY"] = "test-key"
    advisor._call_gemini = lambda *a, **k: (
        '{"picks":[{"ref":1,"name":"Take Five","pitch":"Sumás la menor cantidad de puntos evitando filas."}]}')
    try:
        _out = advisor.agent_pick("play", {"players": 6}, _shortlist, limit=4)
    finally:
        advisor._call_gemini = _orig_call
        advisor.TRACE_ENABLED = _orig_trace
        os.environ.pop("GEMINI_API_KEY", None)
    _p0 = _out["picks"][0]
    check("agent_pick reasigna el pitch al juego correcto (por name)",
          _p0["objectid"] == "432" and _p0["name"] == "Take Five" and "menor cantidad" in _p0["pitch"])

    # retención de traza: descarta > max_days y respeta el tope por cantidad
    import time as _t, json as _tj
    _now = _t.time()
    _old = _t.strftime(advisor._TS_FMT, _t.localtime(_now - 40 * 86400))
    _new = _t.strftime(advisor._TS_FMT, _t.localtime(_now - 1 * 86400))
    _kept = advisor.prune_trace_lines(
        [_tj.dumps({"ts": _old}) + "\n", _tj.dumps({"ts": _new}) + "\n"],
        max_days=30, max_count=100, now=_now)
    check("prune_trace_lines descarta lo más viejo que la ventana", len(_kept) == 1)
    check("prune_trace_lines respeta el tope por cantidad",
          len(advisor.prune_trace_lines([_tj.dumps({"ts": _new}) + "\n"] * 150,
                                        max_days=30, max_count=100, now=_now)) == 100)
except Exception as e:  # noqa
    bloque_falló("guard ref-pitch + retencion traza", e)

# ---- recomendaciones guardadas (saved_recs): save/list/get/delete, scope por owner ----
try:
    import json as _json
    conn = db.connect(); _me = db.get_me(conn)
    _pl = _json.dumps({"mode": "play", "engine": "gemini:demo",
                       "picks": [{"objectid": "1", "name": "Juego X", "pitch": "p"}]})
    _rid = db.save_rec(conn, _me, "Rec QA", "play", "gemini:demo", _pl); conn.commit()
    check("save_rec devuelve un id", isinstance(_rid, int) and _rid > 0)
    _list = db.saved_recs_for(conn, _me)
    check("saved_recs_for lista la guardada (con metadata, sin payload)",
          any(r["id"] == _rid and r["title"] == "Rec QA" and "payload" not in r for r in _list))
    _one = db.get_saved_rec(conn, _me, _rid)
    check("get_saved_rec trae el payload parseado",
          _one is not None and _one["payload"]["picks"][0]["name"] == "Juego X")
    check("get_saved_rec scope por owner (otro perfil no la ve)",
          db.get_saved_rec(conn, _me + 99999, _rid) is None)
    db.rename_saved_rec(conn, _me, _rid, "Rec renombrada"); conn.commit()
    check("rename_saved_rec cambia el título",
          db.get_saved_rec(conn, _me, _rid)["title"] == "Rec renombrada")
    db.delete_saved_rec(conn, _me, _rid); conn.commit()
    check("delete_saved_rec la elimina", db.get_saved_rec(conn, _me, _rid) is None)
    conn.close()
except Exception as e:  # noqa
    bloque_falló("saved_recs", e)

# ---- import: absorber expansiones coladas (se cuelgan del base own/wish, o se descartan) ----
try:
    conn = db.connect(); _me = db.get_me(conn)
    db.upsert_bgg(conn, {"objectid": "__QA_BASE__", "name": "Base QA"})
    db.set_holding(conn, _me, "__QA_BASE__", {"own": 1})
    # expansión colada como juego suelto (own), con su base en la colección
    db.upsert_bgg(conn, {"objectid": "__QA_EXP__", "name": "Expa QA"})
    db.set_holding(conn, _me, "__QA_EXP__", {"own": 1})
    _rec = {"objectid": "__QA_EXP__", "name": "Expa QA", "is_expansion": True,
            "expands": [{"id": "__QA_BASE__", "name": "Base QA"}], "short_description": "sd"}
    _res = seed.absorb_expansion(conn, _me, _rec); conn.commit()
    check("absorb: con base own la cuelga (attached)", _res == "attached")
    _mine = db.expansions_for(conn, _me, "__QA_BASE__")
    check("absorb: queda en expansions del base, estado own",
          any(e["exp_oid"] == "__QA_EXP__" and e["state"] == "own" for e in _mine))
    check("absorb: ya NO es holding suelto",
          conn.execute("SELECT 1 FROM holdings WHERE owner_id=? AND objectid='__QA_EXP__'",
                       (_me,)).fetchone() is None)
    check("absorb: ya NO está en games (juego suelto borrado)",
          conn.execute("SELECT 1 FROM games WHERE objectid='__QA_EXP__'").fetchone() is None)
    # expansión sin base en la colección -> se descarta
    db.upsert_bgg(conn, {"objectid": "__QA_EXP2__", "name": "Expa Huerfana"})
    db.set_holding(conn, _me, "__QA_EXP2__", {"wishlist": 1})
    _rec2 = {"objectid": "__QA_EXP2__", "name": "Expa Huerfana", "is_expansion": True,
             "expands": [{"id": "__QA_NOBASE__", "name": "Base ausente"}]}
    _res2 = seed.absorb_expansion(conn, _me, _rec2); conn.commit()
    check("absorb: sin base own/wish la descarta", _res2 == "discarded")
    check("absorb: la descartada no queda como holding",
          conn.execute("SELECT 1 FROM holdings WHERE owner_id=? AND objectid='__QA_EXP2__'",
                       (_me,)).fetchone() is None)
    check("absorb: un juego que NO es expansión no se toca (None)",
          seed.absorb_expansion(conn, _me, {"objectid": "__QA_BASE__", "is_expansion": False}) is None)
    for _oid in ("__QA_BASE__", "__QA_EXP__", "__QA_EXP2__"):
        conn.execute("DELETE FROM holdings WHERE objectid=?", (_oid,))
        conn.execute("DELETE FROM games WHERE objectid=?", (_oid,))
    conn.execute("DELETE FROM expansions WHERE base_oid='__QA_BASE__'")
    conn.commit(); conn.close()
    check("cleanup absorb_expansion", True)
except Exception as e:  # noqa
    bloque_falló("absorb_expansion", e)

print(f"\n{PASS} ok, {FAIL} fail" + (f", {SKIP} omitidos" if SKIP else ""))
raise SystemExit(1 if FAIL else 0)
