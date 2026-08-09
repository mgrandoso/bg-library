"""Genera las capturas del README (docs/*.png) de forma reproducible.

Usa Playwright (Chromium headless) a resolución de notebook 1440x900 con
deviceScaleFactor=2 → PNG nítidos (~2880px de ancho). Setea la apariencia
"Playa" (fresca) por localStorage antes de que la app arranque, y encuadra
cada vista igual que las capturas publicadas:

  - library : 5 tarjetas por fila (contenido tope 1360 → aire a los costados),
              alto recortado a 2 filas + asomo de la 3ª (se mide la fila 3).
  - bgg     : mismo encuadre que la Biblioteca, sobre el top de BGG.
  - panel   : dashboard completo (full_page).
  - advisor : encuadrado a su columna (advisor-wrap 780) abriendo la 1ª
              recomendación guardada del perfil actual (mostrar un resultado
              real y estable, no uno que cambie entre corridas).
  - detail  : ficha de Harmonies sobre la biblioteca difuminada.

Requisitos:
    pip install playwright
    python -m playwright install chromium
    # y el server corriendo:  python -m uvicorn app:app --app-dir server --port 8778

Uso:
    python build/shots.py            # escribe en docs/
    python build/shots.py salida/    # escribe en otra carpeta (para revisar antes)

Para la captura del Advisor tiene que existir al menos UNA recomendación
guardada en el perfil activo (Advisor → 💾 Guardar). Si no hay ninguna, esa
captura se saltea con un aviso.
"""
import sys
import os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8778"
OUT = sys.argv[1] if len(sys.argv) > 1 else "docs"

# Encuadre tipo notebook. La grilla entra en 5 columnas a 1440 (main tope 1360).
VIEWPORT = {"width": 1440, "height": 900}
SCALE = 2


def settle(page, extra=800):
    """Espera red ociosa + fuentes listas + un colchón, para que covers y
    tipografías (Google Fonts) estén renderizadas antes de la captura."""
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass
    page.evaluate("async () => { await document.fonts.ready; }")
    page.wait_for_timeout(extra)


def two_rows_height(page):
    """Alto en px para ver 2 filas completas + un asomo de la 3ª (mide el
    inicio de la 11ª tarjeta = primera de la 3ª fila a 5 por fila)."""
    return page.evaluate(
        """() => {
            const c = document.querySelectorAll('.grid .card');
            return c.length > 10 ? Math.round(c[10].getBoundingClientRect().top + 46) : 900;
        }"""
    )


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=SCALE)
        page = ctx.new_page()

        # Apariencia "Playa" (fresca) + light, antes de que la app lea el estado.
        page.goto(BASE)
        page.evaluate(
            "() => { localStorage.setItem('appearance','fresca');"
            " localStorage.setItem('theme','light');"
            " localStorage.setItem('onboarded','1'); }"
        )
        page.reload()
        settle(page, 1200)

        # ---------- LIBRARY ----------
        page.click("nav button[data-view='library']")
        page.set_viewport_size(VIEWPORT)
        page.wait_for_timeout(500)
        page.evaluate("() => window.scrollTo(0,0)")
        settle(page, 900)
        page.set_viewport_size({"width": 1440, "height": int(two_rows_height(page))})
        page.wait_for_timeout(300)
        page.screenshot(path=f"{OUT}/library.png")
        print("library ok")

        # ---------- BGG ----------
        page.click("nav button[data-view='bgg']")
        page.set_viewport_size(VIEWPORT)
        page.wait_for_timeout(600)
        page.evaluate("() => window.scrollTo(0,0)")
        settle(page, 1200)
        page.set_viewport_size({"width": 1440, "height": int(two_rows_height(page))})
        page.wait_for_timeout(300)
        page.screenshot(path=f"{OUT}/bgg.png")
        print("bgg ok")

        # ---------- PANEL (dashboard completo) ----------
        page.click("nav button[data-view='panel']")
        page.set_viewport_size(VIEWPORT)
        page.wait_for_timeout(600)
        page.evaluate("() => window.scrollTo(0,0)")
        settle(page, 1000)
        page.screenshot(path=f"{OUT}/panel.png", full_page=True)
        print("panel ok")

        # ---------- ADVISOR (1ª recomendación guardada) ----------
        # misma resolución que el resto (viewport 1440 → 2880 de ancho); la columna
        # (advisor-wrap 780) queda centrada con bandas crema, como en una notebook.
        page.click("nav button[data-view='advisor']")
        page.set_viewport_size(VIEWPORT)
        settle(page, 800)
        saved = page.query_selector("#advSavedBtn")
        if saved:
            saved.click()
            page.wait_for_timeout(600)
            row = page.query_selector(".saved-open")
            if row:
                row.click()
                page.wait_for_timeout(1200)
                page.evaluate("() => window.scrollTo(0,0)")
                settle(page, 1000)
                # alto: 2 recomendaciones completas + asomo de la 3ª
                h = page.evaluate(
                    """() => {
                        const c = document.querySelectorAll('#advResults .rec-card');
                        return c.length > 2 ? Math.round(c[2].getBoundingClientRect().top + 46)
                                            : 940;
                    }"""
                )
                page.set_viewport_size({"width": 1440, "height": int(h)})
                page.wait_for_timeout(300)
                page.screenshot(path=f"{OUT}/advisor.png")
                print("advisor ok")
            else:
                print("advisor SKIP: no hay recomendaciones guardadas en el perfil activo")
        else:
            print("advisor SKIP: no encontre el boton de guardadas")

        # ---------- DETAIL (Harmonies) ----------
        page.click("nav button[data-view='library']")
        page.set_viewport_size(VIEWPORT)
        settle(page, 800)
        page.evaluate("() => window.scrollTo(0,0)")
        opened = page.evaluate(
            """() => {
                try {
                    const g = S.games.find(x => x.name === 'Harmonies');
                    if (g) { openDetail(g); return true; }
                } catch (e) {}
                return false;
            }"""
        )
        if not opened:
            page.locator(".card", has_text="Harmonies").first.click()
        page.wait_for_timeout(1000)
        settle(page, 1000)
        page.screenshot(path=f"{OUT}/detail.png")
        print("detail ok")

        browser.close()
        print("DONE ->", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
