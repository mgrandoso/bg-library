"""Limpieza de la traza del Advisor (observabilidad del LLM).

Poda `advisor_trace.jsonl` por antigüedad y cantidad, para no llenar el disco con datos que ya no
aportan. La escritura normal ya poda en cada llamada; este script es para correrlo aparte (cron,
tarea programada, o `docker exec`) y garantizar la limpieza aunque no haya nuevas recomendaciones.

Uso:
    python server/prune_traces.py                 # 30 días / 100 registros (o lo que digan las envs)
    python server/prune_traces.py --days 15       # override de la ventana
    python server/prune_traces.py --max 200       # override del tope por cantidad

Envs (mismas que usa el runtime): BG_TRACE_PATH, BG_ADVISOR_TRACE_DAYS, BG_ADVISOR_TRACE_MAX.

Ejemplo cron (limpieza diaria a las 3am dentro del contenedor):
    0 3 * * *  python /app/server/prune_traces.py
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import advisor


def main():
    ap = argparse.ArgumentParser(description="Poda la traza del Advisor por antigüedad y cantidad.")
    ap.add_argument("--days", type=int, default=advisor.TRACE_DAYS, help="retención en días")
    ap.add_argument("--max", type=int, default=advisor.TRACE_MAX, help="tope de registros a retener")
    ap.add_argument("--path", default=advisor._trace_path(), help="ruta del .jsonl")
    args = ap.parse_args()

    if not os.path.exists(args.path):
        print(f"[prune] no existe {args.path}; nada que hacer.")
        return
    with open(args.path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    kept = advisor.prune_trace_lines(lines, max_days=args.days, max_count=args.max)
    with open(args.path, "w", encoding="utf-8") as f:
        f.writelines(kept)
    print(f"[prune] {args.path}: {len(lines)} → {len(kept)} registros "
          f"(retención {args.days} días, tope {args.max}).")


if __name__ == "__main__":
    main()
