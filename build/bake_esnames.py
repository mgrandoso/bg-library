"""Hornea `es_name` en el catálogo seed data/bgg_top.json.

Para cada juego baja los nombres alternativos (una sola llamada a geekitems) y
elige, si existe, el alternativo en castellano; si no, cae al `name` principal.

Diseño resumable con checkpoints (guardrail del proyecto):
  - data/_esname_altnames.json  {oid: [alts]}   -> lo que ya se bajó
  - data/_esname_resolved.json  {oid: es_name}  -> es_name resuelto
Al reiniciar solo se procesa lo que falta. El merge final escribe
bgg_top.json de forma atómica (temp + os.replace) tras un backup .bak único.

Modos:
  download   baja alt-names de todos los oids que falten (checkpoint incremental)
  resolve    resuelve es_name a partir de _esname_altnames.json (heurística abajo)
  merge      mergea _esname_resolved.json dentro de bgg_top.json (backup + atómico)
  sample     corre download+resolve end-to-end sobre una muestra e imprime name->es_name
  all        download -> resolve -> merge

NO edita ningún server/*.py ni la DB SQLite. Solo lee bgg._get/_alt_names/GEEKITEMS.
"""
import argparse
import json
import logging
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")
SEED = os.path.join(DATA, "bgg_top.json")
BAK = SEED + ".bak"
ALT_CKPT = os.path.join(DATA, "_esname_altnames.json")
RES_CKPT = os.path.join(DATA, "_esname_resolved.json")
REVIEW = os.path.join(DATA, "_esname_review.json")  # candidatos limítrofes p/inspección
BASE_CKPT = os.path.join(DATA, "_esname_base.json")  # base nueva top-5000 en construcción (resumable)

sys.path.insert(0, os.path.join(ROOT, "server"))
import bgg  # noqa: E402

# consola en UTF-8 (Windows cp1252 rompe con acentos/CJK)
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:  # noqa
        pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("bake_esnames")


# --------------------------------------------------------------------------
# Detección de castellano entre los alternativos.
#
# Los alt-names vienen SIN etiqueta de idioma. El castellano comparte mucho
# con pt/it/ca/fr, así que apoyamos la decisión en marcadores DISTINTIVOS del
# español (no en stopwords compartidas) y restamos cuando aparecen marcadores
# claros de otra lengua romance. Conservador: ante la duda, cae al name.
# --------------------------------------------------------------------------

def _norm(s):
    return (s or "").lower().strip()


def _tokens(s):
    return re.findall(r"[a-záéíóúñü]+", _norm(s))


# Marcadores fuertes de español (whole-word salvo indicado). Peso alto.
ES_STRONG = {
    "juego", "juegos", "edición", "edicion", "español", "española", "castellano",
    "secreto", "secreta", "secretos", "señor", "señores", "año", "años", "pequeño",
    "pequeña", "compañía", "montaña", "niños", "niño", "diseño", "sueño",
    "los", "las",  # artículos plurales distintivos (it=i/le, pt=os/as, ca=els/les, fr=les)
    "ladrones", "ladrón", "caballeros", "reyes", "colonos", "resistencia",
    "aventuras",
}
# Apoyo medio: español pero con solape parcial. Peso bajo.
ES_WEAK = {
    "el", "la", "un", "una", "de", "del", "y", "con", "para", "en",
    "reino", "imperio", "mundo", "guerra", "isla", "ciudad", "corona", "oro",
    "aventura", "muerte", "sangre", "camino", "leyenda", "batalla", "torre",
    "bosque", "tesoro", "viaje", "anillos", "señor", "época", "dragón", "dragones",
}
# Marcadores claros de OTRA lengua romance -> penalizan.
OTHER_STRONG = {
    # portugués
    "jogo", "jogos", "edição", "segredo", "ilha", "cidade", "senhor", "anéis",
    "colonizadores", "ladrões", "morte", "sangue", "reis",
    # italiano
    "gioco", "giochi", "edizione", "segreto", "mondo", "regno", "impero", "isola",
    "città", "cavalieri", "ladri", "signore", "anelli", "coloni", "morte",
    # catalán
    "joc", "jocs", "edició", "secret", "món", "regne", "imperi", "illa", "ciutat",
    "cavallers", "lladres", "senyor", "anells", "els", "jocs",
    # francés
    "jeu", "jeux", "édition", "secrète", "monde", "royaume", "empire", "île",
    "ville", "chevaliers", "voleurs", "seigneur", "anneaux", "guerre", "le", "les",
}


def _es_score(alt, base):
    """Puntaje de 'qué tan castellano' es `alt`. >0 = candidato; mayor = mejor."""
    toks = set(_tokens(alt))
    if not toks:
        return -99
    score = 0
    score += 3 * len(toks & ES_STRONG)
    score += 1 * len(toks & ES_WEAK)
    score -= 4 * len(toks & OTHER_STRONG)
    n = _norm(alt)
    # ñ es casi exclusivo del español (ca=ny, pt=nh, it=gn, fr=gn)
    if "ñ" in n:
        score += 3
    # sufijos distintivos del español
    for suf in ("ción", "ciones", "ería", "ísimo", "ísima"):
        if suf in n:
            score += 2
    # si es idéntico al name principal (salvo mayúsc/acentos), no aporta nada nuevo
    if _norm(alt) == _norm(base):
        return -1
    return score


# Palabras que son solo etiqueta de edición/variante (no traducen el título).
_ED_MISC = {
    "aniversario", "aniversário", "anniversary", "esencial", "especial", "deluxe",
    "jubileo", "jubilee", "primera", "segunda", "tercera", "edición", "edicion",
    "edition", "básico", "basico", "básica", "basica", "juego", "juegos",
    "del", "de", "la", "el", "los", "las", "y", "º", "°", "big", "box",
}


def _is_edition_variant(alt, base):
    """True si `alt` es solo el `base` (título sin traducir) + una etiqueta de
    edición/variante en español (p.ej. 'Everdell: Edición esencial',
    'Patchwork: Edición Andina', 'Pandemic, Edición 10º Aniversario'). Esos NO son
    el nombre en español del juego -> conviene caer al name principal."""
    na, nb = _norm(alt), _norm(base)
    if not nb or len(nb) < 3 or nb not in na:
        return False  # el base no aparece -> es una traducción genuina
    rem = na.replace(nb, " ")
    if re.search(r"edici[oó]n|edition|edizione|edição", rem):
        return True  # cualquier "Edición X" sobre el título sin traducir
    content = [t for t in _tokens(rem) if t not in _ED_MISC and not t.isdigit()]
    return not content  # sin palabras de contenido nuevas -> solo etiqueta


def resolve_es(name, alts):
    """Devuelve (es_name, ambiguo:bool). Elige el mejor alt castellano si supera
    umbral y es una traducción real (no una mera etiqueta de edición); si no, cae
    al name principal. `ambiguo` marca casos limítrofes para revisión."""
    base = name or ""
    best, best_score = None, 0
    for a in alts or []:
        sc = _es_score(a, base)
        if sc > best_score and not _is_edition_variant(a, base):
            best, best_score = a, sc
    # umbral: al menos un marcador fuerte (3) o combinación clara
    if best is not None and best_score >= 3:
        return best, False
    # limítrofe: hubo algo con señal positiva pero no alcanzó el umbral
    ambiguous = best is not None and 0 < best_score < 3
    return base, ambiguous


# --------------------------------------------------------------------------
# IO helpers
# --------------------------------------------------------------------------

def _load(path, default):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def _atomic_write(path, obj):
    """Escritura atómica (temp + replace). Reintenta el replace: en Windows os.replace tira
    PermissionError (WinError 5) si el destino está abierto por otro proceso o el antivirus/indexer
    lo lockea un instante. No hay que leer estos JSON desde otro proceso mientras se escribe."""
    import time as _t
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError as e:  # lock transitorio -> reintentar
            if attempt == 4:
                log.error("_atomic_write no pudo reemplazar %s tras reintentos: %s", path, e)
                raise
            _t.sleep(0.5 * (attempt + 1))


# --------------------------------------------------------------------------
# Modos
# --------------------------------------------------------------------------

def cmd_download(oids):
    seed = _load(SEED, {})
    alts = _load(ALT_CKPT, {})
    todo = [o for o in oids if o not in alts]
    log.info("download: %d oids objetivo, %d ya en checkpoint, %d por bajar",
             len(oids), len(oids) - len(todo), len(todo))
    ok = fail = 0
    fails = []
    for i, oid in enumerate(todo, 1):
        name = (seed.get(oid) or {}).get("name")
        try:
            data = bgg._get(bgg.GEEKITEMS.format(id=oid))
            alts[oid] = bgg._alt_names(data.get("item", {}))
            ok += 1
        except Exception as e:  # noqa
            fail += 1
            fails.append(oid)
            log.warning("FALLO fetch oid=%s name=%r -> %s: %s", oid, name, type(e).__name__, e)
        if i % 25 == 0:
            _atomic_write(ALT_CKPT, alts)
        if i % 50 == 0:
            log.info("  progreso %d/%d (ok=%d fail=%d)", i, len(todo), ok, fail)
        # si la red está sistemáticamente caída, frenar (resumable)
        if fail >= 30 and ok == 0:
            log.error("30 fallos seguidos sin ningún éxito: la red parece caída. Freno acá.")
            break
    _atomic_write(ALT_CKPT, alts)
    log.info("download terminado: ok=%d fail=%d; checkpoint tiene %d oids", ok, fail, len(alts))
    if fails:
        log.info("pendientes (fetch fallido, reintentables en otra pasada): %s", fails[:50])
    return ok, fail


def cmd_resolve(oids):
    seed = _load(SEED, {})
    alts = _load(ALT_CKPT, {})
    resolved = _load(RES_CKPT, {})
    review = {}
    n_es = n_fallback = n_amb = 0
    for oid in oids:
        if oid not in alts:
            continue  # no bajado aún; queda pendiente
        name = (seed.get(oid) or {}).get("name") or ""
        es, amb = resolve_es(name, alts.get(oid))
        resolved[oid] = es
        if es != name:
            n_es += 1
        else:
            n_fallback += 1
        if amb:
            n_amb += 1
            review[oid] = {"name": name, "alts": alts.get(oid)}
    _atomic_write(RES_CKPT, resolved)
    if review:
        _atomic_write(REVIEW, review)
    log.info("resolve: %d resueltos (%d español real, %d fallback al name), %d limítrofes -> %s",
             len(resolved), n_es, n_fallback, n_amb, REVIEW if review else "(ninguno)")
    return resolved


def cmd_merge():
    seed = _load(SEED, {})
    resolved = _load(RES_CKPT, {})
    if not os.path.exists(BAK):
        _atomic_write(BAK, seed)
        log.info("backup creado: %s", BAK)
    filled = 0
    for oid, rec in seed.items():
        if oid in resolved:
            rec["es_name"] = resolved[oid]
            filled += 1
        elif "es_name" not in rec:
            # sin resolver (fetch pendiente): fallback al name para no dejar null
            rec["es_name"] = rec.get("name")
    _atomic_write(SEED, seed)
    log.info("merge: es_name escrito; %d desde resolver, %d total con es_name",
             filled, sum(1 for r in seed.values() if r.get("es_name")))


def cmd_verify():
    seed = _load(SEED, {})
    total = len(seed)
    with_es = sum(1 for r in seed.values() if r.get("es_name"))
    diff = sum(1 for r in seed.values() if r.get("es_name") and r.get("es_name") != r.get("name"))
    print(f"total={total} con_es_name={with_es} es_name!=name={diff}")
    ejemplos = [(r["name"], r["es_name"]) for r in seed.values()
                if r.get("es_name") and r.get("es_name") != r.get("name")]
    for a, b in ejemplos[:40]:
        print(f"  {a!r} -> {b!r}")


# --------------------------------------------------------------------------
# Reconstrucción del seed contra el top-5000 ACTUAL del dump de ranks (scope v2)
# --------------------------------------------------------------------------

def _target_5000():
    """Devuelve (targets, newrank, dump, ds): los 5000 oids del top-5000 ACTUAL (los 5000 de menor
    rank del dump), y el rank RENUMERADO 1..5000 contiguo por orden de rank.

    Por qué renumerar: el dump de beefsack es un espejo imperfecto del ranking live de BGG. Hoy
    (2026-08-08) dentro del top-5000 tiene 7 huecos (797, 2500, 3800, 4102, 4298, 4501, 4502) Y 7
    ranks duplicados (801, 2501, 3811, 4032, 4301, 4483, 4497). El invariante exigido (rank_overall
    == {1..5000} exacto, sin huecos ni repetidos) se logra ENUMERANDO: ordenar TODAS las filas por
    (Rank asc, Bayes desc) para romper empates de forma determinística, tomar las primeras 5000 y
    asignar rank_overall CONTIGUO 1..5000 por POSICIÓN (no el 'Rank' crudo). rating_* del dump tal cual."""
    import seed as seedmod
    dump, ds = seedmod.fetch_rank_dump(top_n=5000, deep=True)  # deep = archivo completo, sin truncado
    ordered = sorted(dump.items(),
                     key=lambda kv: (kv[1]["rank_overall"], -(kv[1].get("rating_bayes") or 0.0)))[:5000]
    targets = [oid for oid, _ in ordered]
    newrank = {oid: i + 1 for i, (oid, _) in enumerate(ordered)}
    return targets, newrank, dump, ds


def cmd_base():
    """PASADA 1 (red): arma la base nueva = top-5000 actual con data (reusada del bgg_top.json actual
    por oid, o bgg.fetch para newcomers) + rank renumerado + rating del dump + alt_names guardados.
    Resumable: checkpoint incremental en _esname_base.json; los oids fallidos quedan pendientes."""
    cur = _load(SEED, {})
    alts_ck = _load(ALT_CKPT, {})
    base = _load(BASE_CKPT, {})
    targets, newrank, dump, ds = _target_5000()
    log.info("base: dump=%s targets=%d ya_en_base=%d por_armar=%d",
             ds, len(targets), sum(1 for o in targets if o in base),
             sum(1 for o in targets if o not in base))
    ok = fail = fetched_newcomer = fetched_alt = 0
    fails = []
    for i, oid in enumerate(targets, 1):
        if oid in base:
            base[oid]["rank_overall"] = newrank[oid]  # re-asienta rank por si el dump cambió
            continue
        d = dump[oid]
        rec = dict(cur.get(oid) or {})
        alt = None
        try:
            if not rec:  # NEWCOMER: no está en el seed actual -> fetch completo
                rec = bgg.fetch(oid)
                alt = rec.get("alt_names")
                fetched_newcomer += 1
            if alt is None:
                alt = alts_ck.get(oid)  # del checkpoint del download en background
            if alt is None:  # ni en seed ni en checkpoint -> bajar alt-names (geekitems)
                gi = bgg._get(bgg.GEEKITEMS.format(id=oid)).get("item", {})
                alt = bgg._alt_names(gi)
                fetched_alt += 1
        except Exception as e:  # noqa — un juego que falla se saltea y se loguea; queda pendiente
            fail += 1
            fails.append(oid)
            log.warning("FALLO base oid=%s name=%r -> %s: %s",
                        oid, (rec or {}).get("name"), type(e).__name__, e)
            continue
        rec["objectid"] = oid
        rec["alt_names"] = alt or []
        rec["rank_overall"] = newrank[oid]
        rec["rating_bayes"] = d.get("rating_bayes")
        rec["rating_avg"] = d.get("rating_avg")
        rec["users_rated"] = d.get("users_rated")
        base[oid] = rec
        ok += 1
        if ok % 10 == 0:
            _atomic_write(BASE_CKPT, base)
        if ok % 50 == 0:
            log.info("  base progreso: armados=%d (newcomers=%d, alt-fetch=%d, fail=%d)",
                     ok, fetched_newcomer, fetched_alt, fail)
    _atomic_write(BASE_CKPT, base)
    log.info("base terminada: %d/%d en base (newcomers=%d alt-fetch=%d fail=%d)",
             len(base), len(targets), fetched_newcomer, fetched_alt, fail)
    if fails:
        log.info("pendientes (reintentables en otra pasada): %s", fails)
    return base


def cmd_resolve2():
    """PASADA 2 (sin red): resuelve es_name LEYENDO alt_names de la base ya armada, y lo escribe en
    cada record. Idempotente (se puede re-correr con otro criterio sin volver a bajar nada)."""
    base = _load(BASE_CKPT, {})
    review = {}
    n_es = n_fallback = n_amb = 0
    for oid, rec in base.items():
        name = rec.get("name") or ""
        es, amb = resolve_es(name, rec.get("alt_names"))
        rec["es_name"] = es
        if es != name:
            n_es += 1
        else:
            n_fallback += 1
        if amb:
            n_amb += 1
            review[oid] = {"name": name, "alts": rec.get("alt_names")}
    _atomic_write(BASE_CKPT, base)
    if review:
        _atomic_write(REVIEW, review)
    log.info("resolve2: %d records, %d español real, %d fallback al name, %d limítrofes",
             len(base), n_es, n_fallback, n_amb)
    return base


def cmd_finalize():
    """Escribe la base como bgg_top.json final: backup .bak una sola vez + escritura atómica."""
    base = _load(BASE_CKPT, {})
    if len(base) != 5000:
        log.warning("finalize: la base tiene %d records (esperado 5000). Reviso pendientes antes de "
                    "finalizar.", len(base))
    if not os.path.exists(BAK):
        _atomic_write(BAK, _load(SEED, {}))
        log.info("backup creado: %s", BAK)
    _atomic_write(SEED, base)
    log.info("finalize: bgg_top.json escrito con %d records", len(base))


def cmd_verify2():
    seed = _load(SEED, {})
    total = len(seed)
    ranks = sorted(r.get("rank_overall") for r in seed.values())
    contig = ranks == list(range(1, 5001))
    with_es = sum(1 for r in seed.values() if r.get("es_name"))
    empty_es = [oid for oid, r in seed.items() if not r.get("es_name")]
    have_alt = sum(1 for r in seed.values() if isinstance(r.get("alt_names"), list))
    diff = sum(1 for r in seed.values() if r.get("es_name") and r.get("es_name") != r.get("name"))
    print(f"total={total} (==5000: {total == 5000})")
    print(f"ranks contiguos 1..5000: {contig}  (min={ranks[0] if ranks else None} max={ranks[-1] if ranks else None} unique={len(set(ranks))})")
    print(f"con alt_names (lista): {have_alt}   con es_name no vacío: {with_es}")
    print(f"es_name != name (español real): {diff}")
    if empty_es:
        print(f"SIN es_name ({len(empty_es)}): {empty_es[:50]}")
    ejemplos = [(r["name"], r["es_name"]) for r in seed.values()
                if r.get("es_name") and r.get("es_name") != r.get("name")]
    print("\nEjemplos name -> es_name:")
    for a, b in ejemplos[:40]:
        print(f"  {a!r} -> {b!r}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["download", "resolve", "merge", "sample", "all", "verify",
                                     "base", "resolve2", "finalize", "verify2", "rebuild"])
    ap.add_argument("--ids", help="lista de oids separada por coma (para sample/pruebas)")
    ap.add_argument("--limit", type=int, help="limitar N oids (para pruebas)")
    args = ap.parse_args()

    seed = _load(SEED, {})
    all_oids = list(seed.keys())

    if args.mode == "verify":
        cmd_verify()
        return
    if args.mode == "verify2":
        cmd_verify2()
        return
    if args.mode == "base":
        cmd_base()
        return
    if args.mode == "resolve2":
        cmd_resolve2()
        return
    if args.mode == "finalize":
        cmd_finalize()
        return
    if args.mode == "rebuild":
        cmd_base()
        cmd_resolve2()
        cmd_finalize()
        cmd_verify2()
        return

    if args.mode == "sample":
        ids = (args.ids.split(",") if args.ids else all_oids[: (args.limit or 30)])
        ids = [i.strip() for i in ids]
        cmd_download(ids)
        resolved = cmd_resolve(ids)
        alts = _load(ALT_CKPT, {})
        print("\n=== MUESTRA name -> es_name ===")
        for oid in ids:
            name = (seed.get(oid) or {}).get("name")
            es = resolved.get(oid, "(no resuelto)")
            mark = "  <== ES" if es != name else ""
            print(f"[{oid}] {name!r} -> {es!r}{mark}")
        return

    oids = all_oids[: args.limit] if args.limit else all_oids
    if args.mode in ("download", "all"):
        cmd_download(oids)
    if args.mode in ("resolve", "all"):
        cmd_resolve(oids)
    if args.mode in ("merge", "all"):
        cmd_merge()


if __name__ == "__main__":
    main()
