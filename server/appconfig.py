"""Config local (gitignored). Guarda API key de Google, modelo Gemini y motor por defecto."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PATH = os.path.join(ROOT, "config.json")

DEFAULTS = {
    "default_engine": "gemini",        # producción: Gemini (free tier). Claude = fallback dev.
    "gemini_api_key": "",
    "gemini_model": "gemini-3.6-flash",  # último Flash free (jul-2026)
}


def load():
    cfg = dict(DEFAULTS)
    if os.path.exists(PATH):
        try:
            cfg.update(json.load(open(PATH, encoding="utf-8")))
        except Exception:
            pass
    return cfg


def save(patch):
    cfg = load()
    for k in DEFAULTS:
        if k in patch:
            cfg[k] = patch[k]
    json.dump(cfg, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return cfg


def public():
    """Config sin exponer la key completa (para el frontend)."""
    cfg = load()
    key = cfg.get("gemini_api_key") or ""
    return {
        "default_engine": cfg["default_engine"],
        "gemini_model": cfg["gemini_model"],
        "gemini_key_set": bool(key),
        "gemini_key_hint": ("…" + key[-4:]) if key else "",
    }
