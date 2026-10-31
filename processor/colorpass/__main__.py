"""CLI: python -m colorpass {check,eval,eval-photos} ..."""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .envfile import load_env

load_env()

from .evaluate import evaluate  # noqa: E402
from .pipeline import run_check  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="colorpass", description="Проверка паспорта колористического решения фасадов")
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("check", help="проверить один PDF")
    c.add_argument("pdf")
    c.add_argument("--out", default=None, help="папка отчёта (по умолчанию runs/<имя файла>)")

    e = sub.add_parser("eval", help="оценить качество на размеченных паспортах")
    e.add_argument("dataset", nargs="?", default=str(ROOT / "dataset" / "real"))
    e.add_argument("--out", default=str(ROOT / "runs" / "eval"))

    ep = sub.add_parser("eval-photos", help="точность сравнения фото с развёрткой по разметке *.photos.json")
    ep.add_argument("dataset", nargs="?", default=str(ROOT / "dataset" / "real"))

    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

    if args.cmd == "check":
        pdf = Path(args.pdf)
        out = Path(args.out) if args.out else ROOT / "runs" / pdf.stem

        def progress(stage: str, frac: float) -> None:
            print(f"[{frac * 100:3.0f}%] {stage}", file=sys.stderr)

        report = run_check(pdf, out, progress=progress)
        verdict = {"pass": "СООТВЕТСТВУЕТ", "warn": "ЕСТЬ ПРЕДУПРЕЖДЕНИЯ", "fail": "ТРЕБУЕТ ДОРАБОТКИ"}[report["verdict"]]
        print(f"\nВердикт: {verdict}  (ошибок {report['counts']['errors']}, предупреждений {report['counts']['warnings']}, {report['duration_s']} с)")
        for f in report["findings"]:
            where = f"лист {f['page'] + 1}" if f.get("page") is not None else "—"
            print(f"  [{f['rule']}] {f['severity']:7s} {where:8s} {f['message']}")
        print(f"\nЗаключение ({report['conclusion']['source']}):\n{report['conclusion']['text']}")
        print(f"\nОтчёт: {out / 'report.json'}")
        return 0
    if args.cmd == "eval":
        evaluate(args.dataset, args.out)
        return 0
    if args.cmd == "eval-photos":
        from .evaluate import evaluate_photos

        evaluate_photos(args.dataset)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
