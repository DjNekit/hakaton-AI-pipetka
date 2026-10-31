"""Минимальный клиент Redis (протокол RESP) и очередь задач между бэкендом и сервисом checker.

Без внешних зависимостей: нужны только списки, множества, строки и хэши. Копия этого файла лежит
в backend/core/redisq.py — формат очередей у обоих сервисов общий (описан ниже).

Очереди и ключи:
  cp:jobs                 тяжёлые задачи (проверка пакета) — LPUSH бэкенд, BRPOP воркеры checker
  cp:rpc                  быстрые запросы (развёртки, углы, сравнение фото, пересчёт, Excel…) с ответом
  cp:reply:<id>           ответ на запрос: {"ok": true, "result": …} или {"ok": false, "error": …, "status": 400}
  cp:progress:<doc>       хэш с ходом проверки документа: state, stage, progress, error
  cp:result:<key>         готовый результат (документ "doc:<id>" или пакет "pkg:<id>") — забирает бэкенд
  cp:ready                множество ключей готовых результатов
  cp:heartbeat            checker жив (обновляется каждые 10 с, живёт 30 с)
"""
from __future__ import annotations

import json
import os
import socket
import threading
import uuid
from urllib.parse import urlparse

JOBS = "cp:jobs"
RPC = "cp:rpc"
READY = "cp:ready"
HEARTBEAT = "cp:heartbeat"


def progress_key(doc_id: str) -> str:
    return f"cp:progress:{doc_id}"


def result_key(key: str) -> str:
    return f"cp:result:{key}"


class RedisError(Exception):
    pass


class Redis:
    """Одно соединение на поток (блокирующие BRPOP/BLPOP не мешают друг другу)."""

    def __init__(self, url: str | None = None):
        u = urlparse(url or os.getenv("REDIS_URL", "redis://redis:6379/0"))
        self.host, self.port = u.hostname or "localhost", u.port or 6379
        self.password = u.password
        self.db = int((u.path or "/0").lstrip("/") or 0)
        self._local = threading.local()

    # ------------------------------------------------------------------ протокол
    def _conn(self):
        c = getattr(self._local, "conn", None)
        if c is None:
            sock = socket.create_connection((self.host, self.port), timeout=10)
            c = (sock, sock.makefile("rb"))
            self._local.conn = c
            if self.password:
                self._call(c, "AUTH", self.password)
            if self.db:
                self._call(c, "SELECT", str(self.db))
        return c

    def _drop(self) -> None:
        c = getattr(self._local, "conn", None)
        if c:
            try:
                c[0].close()
            except OSError:
                pass
        self._local.conn = None

    @staticmethod
    def _encode(args) -> bytes:
        out = [f"*{len(args)}\r\n".encode()]
        for a in args:
            b = a if isinstance(a, bytes) else str(a).encode("utf-8")
            out.append(b"$%d\r\n%s\r\n" % (len(b), b))
        return b"".join(out)

    def _read(self, f):
        line = f.readline()
        if not line:
            raise ConnectionError("Redis закрыл соединение")
        kind, rest = line[:1], line[1:-2]
        if kind == b"+":
            return rest.decode()
        if kind == b"-":
            raise RedisError(rest.decode())
        if kind == b":":
            return int(rest)
        if kind == b"$":
            n = int(rest)
            if n < 0:
                return None
            data = f.read(n + 2)
            return data[:-2].decode("utf-8")
        if kind == b"*":
            n = int(rest)
            return None if n < 0 else [self._read(f) for _ in range(n)]
        raise RedisError(f"Неизвестный ответ Redis: {line[:40]!r}")

    def _call(self, c, *args, timeout: float | None = 10):
        sock, f = c
        sock.settimeout(timeout)
        sock.sendall(self._encode(args))
        return self._read(f)

    def call(self, *args, timeout: float | None = 10):
        for attempt in (0, 1):
            try:
                return self._call(self._conn(), *args, timeout=timeout)
            except (ConnectionError, OSError):
                self._drop()
                if attempt:
                    raise
        return None

    # ------------------------------------------------------------------ команды
    def ping(self) -> bool:
        return self.call("PING") == "PONG"

    def lpush(self, key: str, value: str) -> int:
        return self.call("LPUSH", key, value)

    def brpop(self, key: str, timeout: int = 5):
        r = self.call("BRPOP", key, timeout, timeout=timeout + 5)
        return r[1] if r else None

    def blpop(self, key: str, timeout: int = 5):
        r = self.call("BLPOP", key, timeout, timeout=timeout + 5)
        return r[1] if r else None

    def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.call("SET", key, value, *(("EX", ex) if ex else ()))

    def get(self, key: str):
        return self.call("GET", key)

    def delete(self, *keys: str) -> int:
        return self.call("DEL", *keys) if keys else 0

    def expire(self, key: str, seconds: int) -> None:
        self.call("EXPIRE", key, seconds)

    def sadd(self, key: str, member: str) -> None:
        self.call("SADD", key, member)

    def srem(self, key: str, member: str) -> None:
        self.call("SREM", key, member)

    def smembers(self, key: str) -> list[str]:
        return self.call("SMEMBERS", key) or []

    def hset(self, key: str, mapping: dict) -> None:
        args = []
        for k, v in mapping.items():
            args += [k, "" if v is None else v]
        if args:
            self.call("HSET", key, *args)

    def hgetall(self, key: str) -> dict:
        r = self.call("HGETALL", key) or []
        return dict(zip(r[::2], r[1::2]))


# ---------------------------------------------------------------------- задачи


def push_job(r: Redis, queue: str, kind: str, args: dict, reply: bool = False) -> str | None:
    """Ставит задачу в очередь; при reply=True возвращает ключ, куда придёт ответ."""
    reply_key = f"cp:reply:{uuid.uuid4().hex}" if reply else None
    r.lpush(queue, json.dumps({"type": kind, "args": args, "reply": reply_key}, ensure_ascii=False))
    return reply_key
