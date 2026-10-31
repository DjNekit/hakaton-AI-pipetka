"""Запуск сервиса checker: HTTP для файлов + воркеры очереди Redis.

  python -m worker

  REDIS_URL=redis://redis:6379/0
  COLORPASS_WORKERS=2        сколько пакетов проверяется одновременно (тяжёлые задачи)
  COLORPASS_RPC_WORKERS=4    быстрые операции: развёртки, углы, сравнение фото, пересчёт, Excel
  PORT=8001
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
import traceback

from colorpass.envfile import load_env

load_env()

from . import jobs, storage  # noqa: E402
from .fileserver import serve  # noqa: E402
from .redisq import HEARTBEAT, JOBS, RPC, Redis  # noqa: E402
from .storage import BadRequest, NotFound  # noqa: E402

log = logging.getLogger("worker")
REPLY_TTL = 300
UPLOAD_TTL = 24 * 3600  # загрузки, так и не попавшие в пакет, удаляются через сутки


def heavy_loop(r: Redis, stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            raw = r.brpop(JOBS, timeout=5)
        except Exception as exc:  # noqa: BLE001 — Redis перезапускается: ждём и пробуем снова
            log.warning("Redis недоступен: %s", exc)
            time.sleep(3)
            continue
        if not raw:
            continue
        job = json.loads(raw)
        log.info("задача %s %s", job["type"], job["args"].get("package_id", ""))
        try:
            if job["type"] == "check_package":
                jobs.check_package(r, job["args"])
            else:
                log.warning("неизвестная задача %s", job["type"])
        except Exception:  # noqa: BLE001
            log.error("задача %s упала:\n%s", job["type"], traceback.format_exc())


def rpc_loop(r: Redis, stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            raw = r.brpop(RPC, timeout=5)
        except Exception as exc:  # noqa: BLE001
            log.warning("Redis недоступен: %s", exc)
            time.sleep(3)
            continue
        if not raw:
            continue
        job = json.loads(raw)
        handler = jobs.RPC_HANDLERS.get(job["type"])
        try:
            if handler is None:
                raise BadRequest(f"Неизвестная операция {job['type']}")
            reply = {"ok": True, "result": handler(job["args"])}
        except NotFound as exc:
            reply = {"ok": False, "status": 404, "error": str(exc)}
        except BadRequest as exc:
            reply = {"ok": False, "status": 400, "error": str(exc)}
        except Exception as exc:  # noqa: BLE001
            log.error("операция %s упала:\n%s", job["type"], traceback.format_exc())
            reply = {"ok": False, "status": 500, "error": f"{type(exc).__name__}: {exc}"}
        if job.get("reply"):
            r.lpush(job["reply"], json.dumps(reply, ensure_ascii=False))
            r.expire(job["reply"], REPLY_TTL)


def housekeeping(r: Redis, stop: threading.Event, workers: int) -> None:
    while not stop.is_set():
        try:
            r.set(HEARTBEAT, json.dumps({"at": jobs.now(), "workers": workers}), ex=30)
        except Exception as exc:  # noqa: BLE001
            log.warning("Redis недоступен: %s", exc)
        if storage.UPLOADS.exists():
            for d in storage.UPLOADS.iterdir():
                try:
                    if time.time() - d.stat().st_mtime > UPLOAD_TTL:
                        shutil.rmtree(d, ignore_errors=True)
                except OSError:
                    pass
        stop.wait(10)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    r = Redis()
    stop = threading.Event()
    heavy = int(os.getenv("COLORPASS_WORKERS", "2"))
    light = int(os.getenv("COLORPASS_RPC_WORKERS", "4"))
    for d in (storage.UPLOADS, storage.DOCS, storage.PACKAGES):
        d.mkdir(parents=True, exist_ok=True)
    threads = [threading.Thread(target=heavy_loop, args=(r, stop), daemon=True, name=f"heavy-{i}") for i in range(heavy)]
    threads += [threading.Thread(target=rpc_loop, args=(r, stop), daemon=True, name=f"rpc-{i}") for i in range(light)]
    threads.append(threading.Thread(target=housekeeping, args=(r, stop, heavy), daemon=True, name="housekeeping"))
    for t in threads:
        t.start()
    port = int(os.getenv("PORT", "8001"))
    httpd = serve(port)
    log.info("checker: файлы http://0.0.0.0:%s/files, воркеров %s + %s, Redis %s:%s, данные %s", port, heavy, light, r.host, r.port, storage.RUNS)
    try:
        httpd.serve_forever()
    finally:
        stop.set()


if __name__ == "__main__":
    main()
