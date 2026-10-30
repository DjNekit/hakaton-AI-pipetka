"""Хранилище в PostgreSQL: SQL проверяется на настоящем сервере через psql (без драйвера psycopg).

Запускается, если задан PGTEST_DSN (например, "host=/tmp port=55432 user=postgres dbname=colorpass")
и есть psql; иначе пропускается. В Docker-образе работает настоящий psycopg — этот тест проверяет
схему, запросы и логику сервиса без него."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest import mock

from colorpass import store as store_mod

DSN = os.getenv("PGTEST_DSN", "")


def _literal(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (date, datetime)):
        v = v.isoformat()
    return "'" + str(v).replace("'", "''") + "'"


class PsqlCursor:
    def __init__(self):
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass

    def execute(self, sql, params=()):
        parts = sql.split("%s")
        assert len(parts) == len(params) + 1, (sql, params)
        text = parts[0] + "".join(_literal(p) + rest for p, rest in zip(params, parts[1:]))
        out = subprocess.run(["psql", DSN, "-X", "-q", "-A", "-t", "-F", "\x1f", "-v", "ON_ERROR_STOP=1", "-c", text],
                             capture_output=True, text=True)
        if out.returncode:
            raise RuntimeError(out.stderr)
        self.rows = [tuple(line.split("\x1f")) for line in out.stdout.splitlines() if line]

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0]


class PsqlConn:
    def cursor(self):
        return PsqlCursor()

    def close(self):
        pass


@unittest.skipUnless(DSN and shutil.which("psql"), "нет тестового PostgreSQL (PGTEST_DSN)")
class StoreTest(unittest.TestCase):
    def setUp(self):
        subprocess.run(["psql", DSN, "-q", "-c", "DROP TABLE IF EXISTS comparisons, findings, checks"], check=True)
        self.store = store_mod.PgStore("postgresql://test", connect_fn=PsqlConn)

    def test_roundtrip(self):
        status = {"id": "abc123abc123", "file": "p.pdf", "state": "done", "stage": "Готово", "verdict": "fail",
                  "counts": {"errors": 1, "warnings": 0}, "created_at": "2026-10-28T10:00:00+00:00", "seconds": 3.5}
        report = {"document_kind": "passport", "summary": {"address": "ул. Маршала Бирюзова, д. 20"}, "llm": {"used": False},
                  "findings": [{"id": "F001", "rule": "GRF-01", "severity": "error", "page": 11, "message": "Нет автора «-»", "ref": "114-ПП"}]}
        self.store.save_status(status, report)
        self.store.save_status(status, report)  # повторная запись — без дублей замечаний
        runs = self.store.list_runs()
        self.assertEqual(runs[0]["id"], "abc123abc123")
        n = subprocess.run(["psql", DSN, "-At", "-c", "select count(*), max(message) from findings"], capture_output=True, text=True).stdout
        self.assertEqual(n.strip(), "1|Нет автора «-»")
        payload = {"id": "cmp000000001", "run_id": "abc123abc123", "facade": {"label": "Развёртка 1"}, "source": {"name": "Фото 1"},
                   "result": {"verdict": "mismatch", "diff_share": 0.7}, "llm": {"used": False}, "created_at": "2026-10-28T10:01:00+00:00"}
        self.store.save_comparison(payload)
        self.assertEqual(self.store.list_comparisons("abc123abc123")[0]["result"]["verdict"], "mismatch")
        self.assertEqual(self.store.stats(), {"checks": 1, "failed": 1, "passed": 0, "comparisons": 1})

    def test_service_uses_db_and_imports_files(self):
        from colorpass import service

        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp) / "0123456789ab"
            (run / "compare" / "c1").mkdir(parents=True)
            (run / "status.json").write_text(json.dumps({"id": "0123456789ab", "file": "old.pdf", "state": "done",
                                                         "created_at": "2026-10-27T09:00:00+00:00"}), encoding="utf-8")
            (run / "compare" / "c1" / "result.json").write_text(json.dumps({
                "id": "c1", "run_id": "0123456789ab", "facade": {"label": "Р1"}, "source": {"name": "Ф1"},
                "result": {"verdict": "match", "diff_share": 0.01}, "llm": {"used": False}, "created_at": "2026-10-27T09:01:00+00:00"}),
                encoding="utf-8")
            with mock.patch.object(service, "RUNS_DIR", Path(tmp)), mock.patch.object(service, "get_store", lambda: self.store):
                runs = service.list_runs()  # база пустая → файлы переносятся в неё
                self.assertEqual([r["id"] for r in runs], ["0123456789ab"])
                self.assertEqual(service.list_comparisons("0123456789ab")[0]["id"], "c1")
                self.assertTrue(service.health()["db"]["ok"])


if __name__ == "__main__":
    unittest.main()
