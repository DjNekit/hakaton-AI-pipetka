"""История проверок и сравнений фото в PostgreSQL.

Включается переменной DATABASE_URL (postgresql://user:pass@host:5432/db). Файлы в runs/web/ остаются:
PDF, листы, карты отличий и report.json лежат на диске, в базе — проверки, замечания и сравнения
(для журнала, поиска и отчётов). Если база недоступна, сервис работает на файлах, как без неё.
"""
from __future__ import annotations

import json
import logging
import os
import threading

log = logging.getLogger(__name__)

SCHEMA = """
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
CREATE INDEX IF NOT EXISTS checks_created_idx ON checks (created_at DESC);
CREATE INDEX IF NOT EXISTS findings_rule_idx ON findings (rule);
CREATE INDEX IF NOT EXISTS comparisons_check_idx ON comparisons (check_id, created_at DESC);
"""

UPSERT_CHECK = """
INSERT INTO checks (id, file, sample, kind, state, stage, verdict, errors, warnings, address, llm_model,
                    created_at, finished_at, seconds, status)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (id) DO UPDATE SET
    file = EXCLUDED.file, sample = EXCLUDED.sample, kind = COALESCE(EXCLUDED.kind, checks.kind),
    state = EXCLUDED.state, stage = EXCLUDED.stage, verdict = EXCLUDED.verdict, errors = EXCLUDED.errors,
    warnings = EXCLUDED.warnings, address = COALESCE(EXCLUDED.address, checks.address),
    llm_model = COALESCE(EXCLUDED.llm_model, checks.llm_model), created_at = EXCLUDED.created_at,
    finished_at = EXCLUDED.finished_at, seconds = EXCLUDED.seconds, status = EXCLUDED.status
"""
DELETE_FINDINGS = "DELETE FROM findings WHERE check_id = %s"
INSERT_FINDING = """
INSERT INTO findings (check_id, finding_id, rule, severity, page, element, message, ref)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
"""
INSERT_COMPARISON = """
INSERT INTO comparisons (id, check_id, facade, source, verdict, diff_share, llm_model, created_at, payload)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, verdict = EXCLUDED.verdict
"""
SELECT_RUNS = "SELECT status FROM checks ORDER BY created_at DESC NULLS LAST LIMIT %s"
SELECT_COMPARISONS = "SELECT payload FROM comparisons WHERE check_id = %s ORDER BY created_at DESC"
STATS = """
SELECT count(*), count(*) FILTER (WHERE verdict = 'fail'), count(*) FILTER (WHERE verdict = 'pass'),
       (SELECT count(*) FROM comparisons)
FROM checks
"""


def _json_value(v):
    return json.loads(v) if isinstance(v, (str, bytes)) else v


class PgStore:
    """Тонкая обёртка над psycopg 3; connect_fn подменяется в тестах."""

    def __init__(self, url: str, connect_fn=None):
        self.url = url
        self._connect_fn = connect_fn
        self._lock = threading.Lock()
        self._ready = False

    # ------------------------------------------------------------------ соединение
    def _connect(self):
        if self._connect_fn:
            return self._connect_fn()
        import psycopg

        return psycopg.connect(self.url, autocommit=True, connect_timeout=5)

    def _jsonb(self, obj):
        if self._connect_fn:
            return json.dumps(obj, ensure_ascii=False)
        from psycopg.types.json import Jsonb

        return Jsonb(obj)

    def _run(self, fn):
        with self._lock:
            conn = self._connect()
            try:
                if not self._ready:
                    with conn.cursor() as cur:
                        cur.execute(SCHEMA)
                    self._ready = True
                with conn.cursor() as cur:
                    return fn(cur)
            finally:
                conn.close()

    # ------------------------------------------------------------------ запись
    def save_status(self, status: dict, report: dict | None = None) -> None:
        summary = (report or {}).get("summary", {})
        llm_model = ((report or {}).get("llm") or {}).get("model") if report and report.get("llm", {}).get("used") else None
        counts = status.get("counts") or {}
        params = (
            status["id"], status.get("file"), status.get("sample"), (report or {}).get("document_kind"),
            status.get("state"), status.get("stage"), status.get("verdict"), counts.get("errors"), counts.get("warnings"),
            summary.get("address"), llm_model, status.get("created_at"), status.get("finished_at"), status.get("seconds"),
            self._jsonb(status),
        )

        def work(cur):
            cur.execute(UPSERT_CHECK, params)
            if report is not None:
                cur.execute(DELETE_FINDINGS, (status["id"],))
                for f in report.get("findings", []):
                    cur.execute(INSERT_FINDING, (status["id"], f["id"], f["rule"], f["severity"], f.get("page"),
                                                 f.get("element"), f.get("message"), f.get("ref")))

        self._run(work)

    def save_comparison(self, payload: dict) -> None:
        params = (
            payload["id"], payload["run_id"], payload["facade"]["label"], payload["source"]["name"],
            payload["result"]["verdict"], payload["result"]["diff_share"], payload["llm"].get("model") if payload["llm"].get("used") else None,
            payload["created_at"], self._jsonb(payload),
        )
        self._run(lambda cur: cur.execute(INSERT_COMPARISON, params))

    # ------------------------------------------------------------------ чтение
    def list_runs(self, limit: int = 50) -> list[dict]:
        def work(cur):
            cur.execute(SELECT_RUNS, (limit,))
            return [_json_value(r[0]) for r in cur.fetchall()]

        return self._run(work)

    def list_comparisons(self, run_id: str) -> list[dict]:
        def work(cur):
            cur.execute(SELECT_COMPARISONS, (run_id,))
            return [_json_value(r[0]) for r in cur.fetchall()]

        return self._run(work)

    def stats(self) -> dict:
        def work(cur):
            cur.execute(STATS)
            total, failed, passed, comparisons = cur.fetchone()
            return {"checks": int(total), "failed": int(failed), "passed": int(passed), "comparisons": int(comparisons)}

        return self._run(work)


_STORE: PgStore | None = None
_STORE_URL: str | None = None


def get_store() -> PgStore | None:
    """Хранилище по DATABASE_URL или None (тогда — только файлы)."""
    global _STORE, _STORE_URL
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        return None
    if _STORE is None or _STORE_URL != url:
        _STORE, _STORE_URL = PgStore(url), url
    return _STORE


def safe(op: str, fn, default=None):
    """Ошибка базы не должна ломать проверку: пишем в лог и работаем на файлах."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        log.warning("PostgreSQL (%s) недоступен, работаю на файлах: %s", op, exc)
        return default
