"""Данные бэкенда в PostgreSQL: пакеты, документы (статус + отчёт), замечания, сравнения фото.

Файлов бэкенд не хранит — они у сервиса checker; здесь всё, что видит и меняет инспектор: журнал, отчёты,
исключённые замечания, решения, заключения модели. Без DATABASE_URL — MemoryStore (для разработки и проверок:
данные живут до перезапуска).
"""
from __future__ import annotations

import copy
import json
import logging
import os
import threading

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS packages (
    id            text PRIMARY KEY,
    title         text,
    state         text,
    verdict       text,
    created_at    timestamptz,
    finished_at   timestamptz,
    data          jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS checks (
    id            text PRIMARY KEY,
    file          text,
    sample        text,
    kind          text,
    state         text,
    stage         text,
    verdict       text,
    errors        integer,
    warnings      integer,
    address       text,
    llm_model     text,
    created_at    timestamptz,
    finished_at   timestamptz,
    seconds       real,
    status        jsonb NOT NULL
);
ALTER TABLE checks ADD COLUMN IF NOT EXISTS package_id text;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS position integer;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS report jsonb;
CREATE TABLE IF NOT EXISTS findings (
    check_id      text NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    finding_id    text NOT NULL,
    rule          text NOT NULL,
    severity      text NOT NULL,
    page          integer,
    element       text,
    message       text,
    ref           text,
    PRIMARY KEY (check_id, finding_id)
);
CREATE TABLE IF NOT EXISTS comparisons (
    id            text PRIMARY KEY,
    check_id      text NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    facade        text,
    source        text,
    verdict       text,
    diff_share    real,
    llm_model     text,
    created_at    timestamptz,
    payload       jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS packages_created_idx ON packages (created_at DESC);
CREATE INDEX IF NOT EXISTS checks_created_idx ON checks (created_at DESC);
CREATE INDEX IF NOT EXISTS checks_package_idx ON checks (package_id, position);
CREATE INDEX IF NOT EXISTS findings_rule_idx ON findings (rule);
CREATE INDEX IF NOT EXISTS comparisons_check_idx ON comparisons (check_id, created_at DESC);
"""

UPSERT_PACKAGE = """
INSERT INTO packages (id, title, state, verdict, created_at, finished_at, data) VALUES (%s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, state = EXCLUDED.state, verdict = EXCLUDED.verdict,
    finished_at = EXCLUDED.finished_at, data = EXCLUDED.data
"""
UPSERT_CHECK = """
INSERT INTO checks (id, package_id, position, file, sample, kind, state, stage, verdict, errors, warnings, address,
                    llm_model, created_at, finished_at, seconds, status, report)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (id) DO UPDATE SET
    package_id = COALESCE(EXCLUDED.package_id, checks.package_id), position = COALESCE(EXCLUDED.position, checks.position),
    file = EXCLUDED.file, sample = EXCLUDED.sample, kind = COALESCE(EXCLUDED.kind, checks.kind),
    state = EXCLUDED.state, stage = EXCLUDED.stage, verdict = EXCLUDED.verdict, errors = EXCLUDED.errors,
    warnings = EXCLUDED.warnings, address = COALESCE(EXCLUDED.address, checks.address),
    llm_model = COALESCE(EXCLUDED.llm_model, checks.llm_model), finished_at = EXCLUDED.finished_at,
    seconds = EXCLUDED.seconds, status = EXCLUDED.status, report = COALESCE(EXCLUDED.report, checks.report)
"""
DELETE_FINDINGS = "DELETE FROM findings WHERE check_id = %s"
INSERT_FINDING = """
INSERT INTO findings (check_id, finding_id, rule, severity, page, element, message, ref)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
"""
UPSERT_COMPARISON = """
INSERT INTO comparisons (id, check_id, facade, source, verdict, diff_share, llm_model, created_at, payload)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, verdict = EXCLUDED.verdict, llm_model = EXCLUDED.llm_model
"""
STATS = """
SELECT (SELECT count(*) FROM packages), count(*), count(*) FILTER (WHERE verdict = 'fail'),
       count(*) FILTER (WHERE verdict = 'pass'), (SELECT count(*) FROM comparisons)
FROM checks
"""


def _json(v):
    return json.loads(v) if isinstance(v, (str, bytes)) else v


def _check_params(status: dict, report: dict | None, jsonb) -> tuple:
    summary = (report or {}).get("summary") or {}
    llm = (report or {}).get("llm") or {}
    counts = status.get("counts") or {}
    return (
        status["id"], status.get("package_id"), status.get("position"), status.get("file"), status.get("sample"),
        status.get("kind") or (report or {}).get("document_kind"), status.get("state"), status.get("stage"),
        status.get("verdict"), counts.get("errors"), counts.get("warnings"), summary.get("address"),
        llm.get("model") if llm.get("used") else None, status.get("created_at"), status.get("finished_at"),
        status.get("seconds"), jsonb(status), jsonb(report) if report is not None else None,
    )


class PgStore:
    """PostgreSQL через psycopg 3; схема создаётся и дополняется сама (миграций Django нет)."""

    def __init__(self, url: str):
        self.url = url
        self._lock = threading.Lock()
        self._ready = False

    def _run(self, fn):
        import psycopg

        with psycopg.connect(self.url, autocommit=True, connect_timeout=5) as conn:
            if not self._ready:
                with self._lock:
                    if not self._ready:
                        conn.execute(SCHEMA)
                        self._ready = True
            with conn.cursor() as cur:
                return fn(cur)

    @staticmethod
    def _jsonb(obj):
        from psycopg.types.json import Jsonb

        return Jsonb(obj)

    # ---------------------------------------------------------------- пакеты
    def save_package(self, pkg: dict) -> None:
        self._run(lambda cur: cur.execute(UPSERT_PACKAGE, (
            pkg["id"], pkg.get("title"), pkg.get("state"), pkg.get("verdict"), pkg.get("created_at"),
            pkg.get("finished_at"), self._jsonb(pkg),
        )))

    def get_package(self, pid: str) -> dict | None:
        def work(cur):
            cur.execute("SELECT data FROM packages WHERE id = %s", (pid,))
            row = cur.fetchone()
            return _json(row[0]) if row else None

        return self._run(work)

    def list_packages(self, limit: int = 50) -> list[dict]:
        def work(cur):
            cur.execute("SELECT data FROM packages ORDER BY created_at DESC NULLS LAST LIMIT %s", (limit,))
            return [_json(r[0]) for r in cur.fetchall()]

        return self._run(work)

    # ---------------------------------------------------------------- документы
    def save_status(self, status: dict, report: dict | None = None) -> None:
        params = _check_params(status, report, self._jsonb)

        def work(cur):
            cur.execute(UPSERT_CHECK, params)
            if report is not None:
                cur.execute(DELETE_FINDINGS, (status["id"],))
                for f in report.get("findings", []):
                    cur.execute(INSERT_FINDING, (status["id"], f["id"], f["rule"], f["severity"], f.get("page"),
                                                 f.get("element"), f.get("message"), f.get("ref")))

        self._run(work)

    def get_check(self, cid: str) -> tuple[dict, dict | None] | None:
        def work(cur):
            cur.execute("SELECT status, report FROM checks WHERE id = %s", (cid,))
            row = cur.fetchone()
            return (_json(row[0]), _json(row[1]) if row[1] is not None else None) if row else None

        return self._run(work)

    def package_checks(self, pid: str) -> list[dict]:
        def work(cur):
            cur.execute("SELECT status FROM checks WHERE package_id = %s ORDER BY position", (pid,))
            return [_json(r[0]) for r in cur.fetchall()]

        return self._run(work)

    # ---------------------------------------------------------------- сравнения фото
    def save_comparison(self, payload: dict) -> None:
        llm = payload.get("llm") or {}
        self._run(lambda cur: cur.execute(UPSERT_COMPARISON, (
            payload["id"], payload["run_id"], payload["facade"]["label"], payload["source"]["name"],
            payload["result"]["verdict"], payload["result"]["diff_share"], llm.get("model") if llm.get("used") else None,
            payload["created_at"], self._jsonb(payload),
        )))

    def get_comparison(self, cid: str) -> dict | None:
        def work(cur):
            cur.execute("SELECT payload FROM comparisons WHERE id = %s", (cid,))
            row = cur.fetchone()
            return _json(row[0]) if row else None

        return self._run(work)

    def list_comparisons(self, check_id: str) -> list[dict]:
        def work(cur):
            cur.execute("SELECT payload FROM comparisons WHERE check_id = %s ORDER BY created_at DESC", (check_id,))
            return [_json(r[0]) for r in cur.fetchall()]

        return self._run(work)

    def stats(self) -> dict:
        def work(cur):
            cur.execute(STATS)
            packages, total, failed, passed, comparisons = cur.fetchone()
            return {"packages": int(packages), "checks": int(total), "failed": int(failed), "passed": int(passed),
                    "comparisons": int(comparisons)}

        return self._run(work)


class MemoryStore:
    """То же в памяти процесса — когда DATABASE_URL не задан (разработка, проверки)."""

    def __init__(self):
        self._lock = threading.Lock()
        self.packages: dict[str, dict] = {}
        self.checks: dict[str, tuple[dict, dict | None]] = {}
        self.comparisons: dict[str, dict] = {}

    def save_package(self, pkg):
        with self._lock:
            self.packages[pkg["id"]] = copy.deepcopy(pkg)

    def get_package(self, pid):
        return copy.deepcopy(self.packages.get(pid))

    def list_packages(self, limit=50):
        items = sorted(self.packages.values(), key=lambda p: p.get("created_at") or "", reverse=True)
        return copy.deepcopy(items[:limit])

    def save_status(self, status, report=None):
        with self._lock:
            old = self.checks.get(status["id"])
            self.checks[status["id"]] = (copy.deepcopy(status), copy.deepcopy(report) if report is not None else (old[1] if old else None))

    def get_check(self, cid):
        return copy.deepcopy(self.checks.get(cid))

    def package_checks(self, pid):
        items = [s for s, _ in self.checks.values() if s.get("package_id") == pid]
        return copy.deepcopy(sorted(items, key=lambda s: s.get("position") or 0))

    def save_comparison(self, payload):
        with self._lock:
            self.comparisons[payload["id"]] = copy.deepcopy(payload)

    def get_comparison(self, cid):
        return copy.deepcopy(self.comparisons.get(cid))

    def list_comparisons(self, check_id):
        items = [c for c in self.comparisons.values() if c.get("run_id") == check_id]
        return copy.deepcopy(sorted(items, key=lambda c: c.get("created_at") or "", reverse=True))

    def stats(self):
        return {"packages": len(self.packages), "checks": len(self.checks),
                "failed": sum(1 for s, _ in self.checks.values() if s.get("verdict") == "fail"),
                "passed": sum(1 for s, _ in self.checks.values() if s.get("verdict") == "pass"),
                "comparisons": len(self.comparisons)}


_STORE = None


def get_store():
    global _STORE
    if _STORE is None:
        url = os.getenv("DATABASE_URL", "").strip()
        _STORE = PgStore(url) if url else MemoryStore()
        if not url:
            log.warning("DATABASE_URL не задан — данные в памяти процесса до перезапуска")
    return _STORE
