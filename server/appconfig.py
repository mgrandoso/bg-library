"""Config local. Los ajustes no sensibles (motor por defecto, modelo Gemini) viven en config.json
(gitignored). La API key de Google se guarda en el **keychain del SO** (Windows Credential Manager,
macOS Keychain, Secret Service) vía `keyring`, con **fallback a config.json** si keyring no está
disponible. Si encuentra una key vieja en texto plano en config.json, la **migra** al keychain."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PATH = os.path.join(ROOT, "config.json")

SERVICE = "ludoteca"          # namespace en el keychain
KEY_NAME = "gemini_api_key"

DEFAULTS = {
    "default_engine": "gemini",          # producción: Gemini (free tier)
    "gemini_model": "gemini-3.6-flash",  # último Flash free
}


def _keyring():
    """El módulo keyring si está instalado y con un backend usable; si no, None (→ fallback)."""
    try:
        import keyring
        from keyring.backends.fail import Keyring as _Fail
        if isinstance(keyring.get_keyring(), _Fail):
            return None
        return keyring
    except Exception:
        return None


def _kr_get(kr):
    try:
        return kr.get_password(SERVICE, KEY_NAME) or ""
    except Exception:
        return ""


def _kr_set(kr, value):
    try:
        kr.set_password(SERVICE, KEY_NAME, value)
        return True
    except Exception:
        return False


def _read_file():
    cfg = dict(DEFAULTS)
    if os.path.exists(PATH):
        try:
            cfg.update(json.load(open(PATH, encoding="utf-8")))
        except Exception:
            pass
    return cfg


def _write_file(cfg):
    """Persiste solo los ajustes no sensibles; incluye la key SOLO si estamos en modo fallback
    (sin keyring), nunca cuando la key vive en el keychain."""
    data = {k: cfg.get(k, DEFAULTS[k]) for k in DEFAULTS}
    if cfg.get("gemini_api_key"):
        data["gemini_api_key"] = cfg["gemini_api_key"]
    json.dump(data, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)


def load():
    """Config completa (con la key resuelta). Orden de resolución de la key:
    keychain → config.json (legacy, se migra) → variable de entorno GEMINI_API_KEY."""
    cfg = _read_file()
    file_key = (cfg.pop("gemini_api_key", "") or "").strip()
    kr = _keyring()
    key = ""
    if kr:
        key = _kr_get(kr)
        if not key and file_key and _kr_set(kr, file_key):   # migrar key plana → keychain
            key = file_key
            _write_file(cfg)                                 # reescribe config.json sin la key
    if not key:
        key = file_key or os.environ.get("GEMINI_API_KEY", "").strip()
    cfg["gemini_api_key"] = key
    return cfg


def save(patch):
    cfg = _read_file()                       # trae la key legacy del archivo si la hubiera
    for k in DEFAULTS:
        if k in patch:
            cfg[k] = patch[k]
    new_key = (patch.get("gemini_api_key") or "").strip()
    if new_key:
        kr = _keyring()
        if kr and _kr_set(kr, new_key):
            cfg.pop("gemini_api_key", None)  # guardada en el keychain, fuera del archivo
        else:
            cfg["gemini_api_key"] = new_key  # fallback: al archivo
    _write_file(cfg)
    return load()


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
