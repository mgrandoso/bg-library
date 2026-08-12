"""Prueba de humo en WebKit (el motor de Safari).

Por qué existe: la preview de desarrollo es Chromium y NO reproduce WebKit. Así se coló que
Safari IGNORA el `padding` de un `<select>` nativo — el control quedaba en 21px contra los 39px
del buscador, y en Chromium se veía perfecto. Este script corre el motor de verdad y falla si:

  · hay errores de JavaScript o de consola,
  · la biblioteca no renderiza tarjetas,
  · aparece scroll horizontal (el clásico desborde de móvil),
  · los controles de una misma familia no miden lo mismo (la regresión del <select>).

NO cubre el "chrome" del navegador —la barra inferior de Safari, la franja que se roba el primer
toque, `dvh` vs `lvh`—: eso no existe en un navegador headless y sigue necesitando un iPhone real.

Uso:  python build/smoke_webkit.py [url]
"""
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8778"

# (nombre, ancho, alto). El de celular está calibrado contra un iPhone 15 Pro real.
VIEWPORTS = [("escritorio", 1440, 900), ("celular", 393, 852)]

MEDICIONES = """(() => {
  const alto = s => { const e = document.querySelector(s);
    return e ? +e.getBoundingClientRect().height.toFixed(1) : null; };
  return {
    tarjetas: document.querySelectorAll('.card').length,
    desbordeX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    // familia "controles de línea": tienen que medir todos igual (ver --ctl-h en styles.css)
    controles: {
      buscador: alto('.filters .search'),
      select: alto('.filters select'),
      orden: alto('.filters .sortdir'),
    },
  };
})()"""


def revisar(page, nombre):
    """Devuelve la lista de problemas encontrados en un viewport (vacía = todo bien)."""
    fallas = []
    m = page.evaluate(MEDICIONES)

    if not m["tarjetas"]:
        fallas.append(f"[{nombre}] no renderizó ninguna tarjeta de juego")
    if m["desbordeX"] > 0:
        fallas.append(f"[{nombre}] scroll horizontal: sobran {m['desbordeX']}px")

    # en compacto los selects viven dentro del panel colapsado y no hay nada que comparar
    alturas = {k: v for k, v in m["controles"].items() if v}
    if len(alturas) > 1 and len(set(alturas.values())) > 1:
        fallas.append(f"[{nombre}] controles de línea desparejos: {alturas}")

    return fallas


def main():
    fallas = []
    with sync_playwright() as p:
        navegador = p.webkit.launch()
        for nombre, ancho, alto in VIEWPORTS:
            ctx = navegador.new_context(viewport={"width": ancho, "height": alto},
                                        is_mobile=(ancho < 768), has_touch=(ancho < 768))
            page = ctx.new_page()
            errores = []
            page.on("pageerror", lambda e: errores.append(f"JS: {e}"))
            page.on("console", lambda msg: errores.append(f"consola: {msg.text}")
                    if msg.type == "error" and "Failed to load resource" not in msg.text else None)

            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_selector(".card", timeout=20000)
            page.wait_for_timeout(400)          # que se asienten los observers de portadas

            fallas += revisar(page, nombre)
            fallas += [f"[{nombre}] {e}" for e in errores]
            print(f"  {nombre} ({ancho}x{alto}): revisado")
            ctx.close()
        navegador.close()

    if fallas:
        print("\nFALLA el humo en WebKit:")
        for f in fallas:
            print(f"  · {f}")
        return 1
    print("\nWebKit OK: render, sin errores, sin desborde, controles parejos.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
