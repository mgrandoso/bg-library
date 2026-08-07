"""Tests livianos (sin pytest). Correr:  python tests.py
Cubren la lógica pura del advisor/bgg y una integración contra la DB seedeada."""
import bgg
import advisor
import db

PASS = 0
FAIL = 0


def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok  {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}")


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

# ---- integración contra la DB seedeada ----
try:
    conn = db.connect()
    me = db.get_me(conn)
    games = db.games_for_owner(conn, me)
    conn.close()
    own = [x for x in games if x["own"]]
    check("DB: hay juegos en propiedad", len(own) > 0)
    check("DB: game tiene JSON parseado (subdomains lista)", isinstance(games[0]["subdomains"], list))

    rec = advisor.recommend("play", {"players": 2, "vibe": "medium"}, engine="rules", limit=3, owner_id=me)
    check("advisor play devuelve picks", len(rec["picks"]) > 0)
    check("advisor pick tiene pitch", bool(rec["picks"][0]["pitch"]))

    recb = advisor.recommend("buy", {"usual_players": 4, "vibe": "light", "safe_or_niche": "safe"},
                             engine="rules", limit=3, owner_id=me)
    check("advisor buy devuelve picks", len(recb["picks"]) > 0)
except Exception as e:  # noqa
    check(f"integración DB ({e})", False)

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
    check(f"import_csv temporal ({e})", False)

print(f"\n{PASS} ok, {FAIL} fail")
raise SystemExit(1 if FAIL else 0)
