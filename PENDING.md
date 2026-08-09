# Pendientes

> Los tres ítems de la iteración de expansiones + cola >10k están **hechos y verificados**
> (2026-08-08). Quedan solo mejoras diferidas, abajo.

## Hecho (2026-08-08) — pasa a README/REVIEW

1. **Cola de colección >10k por fetch-por-id.** Se retiró el pase profundo (dump completo ~31k).
   `seed.refresh_tail()` pone al día por id (`bgg.fetch`) el rank+rating de los tenidos con
   `rank>10.000`; los sin rank se saltean. Corre dentro de `update_ranks`.
2. **Guard de expansiones.** `bgg.fetch` marca `is_expansion`/`expands`; `/api/games/add` rechaza
   altas de expansión y `/api/lookup` abre la ficha de expansión. Import: excluidas aguas arriba
   por el link de export de BGG.
3. **Feature Expansiones.** Tabla `expansions(owner_id, base_oid, exp_oid, name, state, `
   `short_description, updated_at)` — nombre + estado 📦/⭐ + short desc (para el futuro advisor),
   **sin prioridad**. Alta solo si el base está en own/wish. Ficha del madre con sección
   "Expansiones" + panel "＋" (editor). Búsqueda muestra la ficha rotulada "Expansión de X" →
   "Agregar a X". Buscador de Biblioteca matchea expas `📦` y surface-ea la madre (Wishlist no).

## Diferido (con OK de Manuel, para otra vuelta)

- **Advisor "¿Qué compro?" sugiere expansiones.** Que el agente de compra sugiera comprar una
  expansión `⭐` de un juego que ya tenés. No es recomendación *puntuada* (las expas no tienen data
  completa, solo nombre + short desc) sino una **sugerencia**; se le pasa como contexto extra al
  prompt. "Merece una vuelta de tuerca" — revisar si con la short desc alcanza o hay que guardar la
  descripción completa.
- **(Opcional) Modal de detalle del "Actualizar".** Mostrar altas/bajas/cola/tandas en un modal con
  detalle en vez de una sola línea de texto.

## Fuera de esto (Manuel lo hace a mano, no es implementación)

- **Publicación** (flujo 13): `git push --force origin main` + `gh repo edit mgrandoso/bg-library
  --visibility public`. EN PAUSA hasta que Manuel diga.
