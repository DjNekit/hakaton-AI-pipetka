#!/usr/bin/env python3
"""Резервный сервер без Django (только стандартная библиотека) — те же маршруты /api/*.

Нужен, если Django не установлен (офлайн-демо) и для быстрых проверок:
    python backend/devserver.py --port 8000
Основной сервер проекта — Django: python backend/manage.py runserver 8000
"""
from __future__ import annotations

import argparse
import email.parser
import email.policy
import json
import mimetypes
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from colorpass.envfile import load_env  # noqa: E402

load_env()
from colorpass import service  # noqa: E402

FRONTEND_DIST = Path(os.getenv("COLORPASS_FRONTEND_DIST", Path(__file__).resolve().parents[1] / "frontend" / "dist"))


def _flag(query: dict, form: dict, name: str, default: bool = True) -> bool:
    value = (query.get(name) or [None])[0] or form.get(name)
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _multipart(content_type: str, body: bytes) -> tuple[dict, dict]:
    msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
        f"Content-Type: {content_type}\r\n\r\n".encode() + body
    )
    fields, files = {}, {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        filename = part.get_filename()
        payload = part.get_payload(decode=True) or b""
        if filename:
            files[name] = (filename, payload)
        elif name:
            fields[name] = payload.decode("utf-8", "replace")
    return fields, files


class Handler(BaseHTTPRequestHandler):
    server_version = "colorpass-devserver"

    def log_message(self, fmt, *args):  # компактный лог
        sys.stderr.write("%s %s\n" % (self.command, self.path))

    # ------------------------------------------------------------ ответы
    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path: Path, content_type: str | None = None):
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _route(self, method: str):
        url = urlparse(self.path)
        path, query = url.path, parse_qs(url.query)
        form, files = {}, {}
        if method == "POST":
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            ctype = self.headers.get("Content-Type", "")
            if ctype.startswith("multipart/form-data"):
                form, files = _multipart(ctype, body)
        try:
            if path == "/api/health" and method == "GET":
                return self._json(service.health())
            if path == "/api/rules" and method == "GET":
                return self._json(service.rules())
            if path == "/api/samples" and method == "GET":
                return self._json({"samples": service.list_samples()})
            m = re.fullmatch(r"/api/samples/([\w\-]+)/pdf", path)
            if m and method == "GET":
                return self._file(service.sample_pdf(m.group(1)), "application/pdf")
            m = re.fullmatch(r"/api/samples/([\w\-]+)/check", path)
            if m and method == "POST":
                return self._json(service.start_sample(m.group(1), use_llm=_flag(query, form, "llm")), 202)
            if path == "/api/checks":
                if method == "POST":
                    if "file" not in files:
                        raise service.BadRequest("Не передан файл (поле формы «file»)")
                    name, data = files["file"]
                    return self._json(service.start_upload(name, data, use_llm=_flag(query, form, "llm")), 202)
                return self._json({"checks": service.list_runs()})
            m = re.fullmatch(r"/api/checks/([0-9a-f]{12})", path)
            if m and method == "GET":
                return self._json(service.get_run(m.group(1)))
            m = re.fullmatch(r"/api/checks/([0-9a-f]{12})/blocks", path)
            if m and method == "GET":
                return self._json(service.list_blocks(m.group(1)))
            m = re.fullmatch(r"/api/checks/([0-9a-f]{12})/corners", path)
            if m and method == "POST":
                name, data = files.get("photo", ("", b""))
                return self._json(service.suggest_corners(m.group(1), photo_bytes=data or None, photo_block=form.get("photo_block")))
            m = re.fullmatch(r"/api/checks/([0-9a-f]{12})/comparisons", path)
            if m:
                if method == "POST":
                    name, data = files.get("photo", ("", b""))
                    return self._json(
                        service.compare_photo(
                            m.group(1), form.get("facade", ""), photo_bytes=data or None, photo_name=name,
                            photo_block=form.get("photo_block"), quad=form.get("quad"), rect=form.get("rect"),
                            use_llm=_flag(query, form, "llm"),
                        ),
                        201,
                    )
                return self._json({"comparisons": service.list_comparisons(m.group(1))})
            m = re.fullmatch(r"/api/checks/([0-9a-f]{12})/files/(.+)", path)
            if m and method == "GET":
                p = service.run_file(m.group(1), m.group(2))
                return self._file(p, "text/markdown; charset=utf-8" if p.suffix == ".md" else None)
            if path.startswith("/api/"):
                return self._json({"error": "not_found"}, 404)
            # фронтенд
            target = FRONTEND_DIST / path.lstrip("/")
            if path.startswith("/assets/") and target.is_file() and FRONTEND_DIST in target.resolve().parents:
                return self._file(target)
            index = FRONTEND_DIST / "index.html"
            if index.exists():
                return self._file(index, "text/html; charset=utf-8")
            return self._json({"detail": "Фронтенд не собран: cd frontend && npm run build"}, 404)
        except service.NotFound as exc:
            return self._json({"error": "not_found", "detail": str(exc)}, 404)
        except service.BadRequest as exc:
            return self._json({"error": "bad_request", "detail": str(exc)}, 400)

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"colorpass devserver: http://{args.host}:{args.port}  (API: /api/health)")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
