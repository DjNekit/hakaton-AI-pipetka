"""HTTP сервиса processor: отдача файлов документов и приём загрузок. Остальное — через очередь Redis.

  GET  /files/<doc>/<путь>           листы, развёртки, карты отличий, Excel… (package/… — фото пакета)
  GET  /files/samples/<имя>.pdf      PDF образца из dataset/
  POST /files/uploads                multipart, поле files (можно несколько): PDF — документы, JPEG/PNG — фото
  GET  /files/health                 жив ли сервис
"""
from __future__ import annotations

import email.parser
import email.policy
import json
import logging
import mimetypes
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote, urlparse

from . import storage
from .storage import BadRequest, NotFound

log = logging.getLogger(__name__)
MAX_BODY = 600 * 1024 * 1024  # пакет из нескольких PDF


def parse_multipart(content_type: str, body: bytes) -> list[tuple[str, str, bytes]]:
    """→ [(имя поля, имя файла, данные)] только для файловых частей."""
    msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
        f"Content-Type: {content_type}\r\n\r\n".encode() + body
    )
    out = []
    for part in msg.iter_parts():
        filename = part.get_filename()
        if filename:
            out.append((part.get_param("name", header="content-disposition") or "", filename, part.get_payload(decode=True) or b""))
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "colorpass-processor"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("processor %s %s\n" % (self.command, self.path[:160]))

    def _json(self, data, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path, download: str | None = None) -> None:
        data = path.read_bytes()
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if path.suffix in (".md", ".json"):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=60")
        if download:
            self.send_header("Content-Disposition", f"attachment; filename=\"file{path.suffix}\"; filename*=UTF-8''{quote(download)}")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        path = unquote(urlparse(self.path).path)
        try:
            if path == "/files/health":
                return self._json({"ok": True})
            m = re.fullmatch(r"/files/samples/([\w\-]+)\.pdf", path)
            if m:
                return self._file(storage.sample_pdf(m.group(1)))
            m = re.fullmatch(r"/files/([0-9a-f]{12})/(.+)", path)
            if m:
                f = storage.resolve_file(m.group(1), m.group(2))
                return self._file(f, download=f.name if m.group(2).startswith("export/") else None)
            return self._json({"error": "not_found"}, 404)
        except NotFound as exc:
            return self._json({"error": "not_found", "detail": str(exc)}, 404)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/files/uploads":
            return self._json({"error": "not_found"}, 404)
        length = int(self.headers.get("Content-Length") or 0)
        ctype = self.headers.get("Content-Type", "")
        if not ctype.startswith("multipart/form-data"):
            return self._json({"error": "bad_request", "detail": "Ожидается multipart/form-data"}, 400)
        if length > MAX_BODY:
            return self._json({"error": "bad_request", "detail": "Слишком большой пакет"}, 413)
        body = self.rfile.read(length)
        files = parse_multipart(ctype, body)
        if not files:
            return self._json({"error": "bad_request", "detail": "Нет файлов"}, 400)
        uploads, errors = [], []
        for _, name, data in files:
            try:
                uploads.append(storage.save_upload(name, data))
            except BadRequest as exc:
                errors.append(str(exc))
        if not uploads:
            return self._json({"error": "bad_request", "detail": "; ".join(errors)}, 400)
        return self._json({"uploads": uploads, "errors": errors}, 201)


def serve(port: int) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    httpd.daemon_threads = True
    return httpd
