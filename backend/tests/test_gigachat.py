"""Клиент GigaChat API на имитации сервера (без сети): токен, загрузка изображений, attachments, JSON в промпте."""
import base64
import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

from colorpass import llm
from colorpass.llm import GigaChatClient, LLMConfig, make_client

KEY = base64.b64encode(b"client-id:client-secret").decode()
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode()


class FakeGigaChat(BaseHTTPRequestHandler):
    log = []

    def log_message(self, *a):
        pass

    def _json(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer tok-1":
            return self._json({"message": "Unauthorized"}, 401)
        if self.path == "/api/v1/models":
            return self._json({"data": [{"id": "GigaChat-2"}, {"id": "GigaChat-2-Max"}], "object": "list"})
        self._json({}, 404)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        FakeGigaChat.log.append((self.path, dict(self.headers), body))
        if self.path == "/api/v2/oauth":
            ok = self.headers.get("Authorization") == f"Basic {KEY}" and self.headers.get("RqUID") and b"scope=GIGACHAT_API_PERS" in body
            return self._json({"access_token": "tok-1", "expires_at": 4102444800000} if ok else {"message": "bad"}, 200 if ok else 401)
        if self.headers.get("Authorization") != "Bearer tok-1":
            return self._json({"message": "Unauthorized"}, 401)
        if self.path == "/api/v1/files":
            assert b'name="purpose"' in body and b"general" in body and b"image/png" in body
            n = sum(1 for p, *_ in FakeGigaChat.log if p == "/api/v1/files")
            return self._json({"id": f"file-{n}", "object": "file"})
        if self.path.startswith("/api/v1/files/") and self.path.endswith("/delete"):
            return self._json({"deleted": True})
        if self.path == "/api/v1/chat/completions":
            req = json.loads(body)
            assert "response_format" not in req and req["temperature"] > 0
            atts = [m.get("attachments", []) for m in req["messages"]]
            assert all(len(a) <= 1 for a in atts)  # одно изображение на сообщение
            answer = json.dumps({"ok": True, "images": sum(len(a) for a in atts)})
            return self._json({"choices": [{"message": {"role": "assistant", "content": "```json\n" + answer + "\n```"}}],
                               "usage": {"total_tokens": 10}})
        self._json({}, 404)


class GigaChatTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeGigaChat)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        port = cls.server.server_address[1]
        cls.env = mock.patch.dict(os.environ, {
            "GIGACHAT_AUTH_KEY": "", "GIGACHAT_CLIENT_ID": "client-id",
            "GIGACHAT_CLIENT_SECRET": "client-secret", "GIGACHAT_AUTH_URL": f"http://127.0.0.1:{port}/api/v2/oauth",
            "GIGACHAT_BASE_URL": f"http://127.0.0.1:{port}/api/v1", "GIGACHAT_MODEL": "GigaChat-2-Max",
            "HTTP_PROXY": "", "HTTPS_PROXY": "", "NO_PROXY": "127.0.0.1",
        })
        cls.env.start()

    @classmethod
    def tearDownClass(cls):
        cls.env.stop()
        cls.server.shutdown()

    def setUp(self):
        llm._TOKENS.clear()
        FakeGigaChat.log = []

    def test_status_and_factory(self):
        client = make_client(LLMConfig.from_env())
        self.assertIsInstance(client, GigaChatClient)
        st = client.status()
        self.assertTrue(st["available"], st)
        self.assertEqual(st["model"], "GigaChat-2-Max")

    def test_json_with_images(self):
        client = make_client(LLMConfig.from_env())
        data = client.chat_json("Система", "Сравни", {"type": "object"}, images=[PNG, PNG, PNG])
        self.assertEqual(data, {"ok": True, "images": 3})
        paths = [p for p, *_ in FakeGigaChat.log]
        self.assertEqual(paths.count("/api/v1/files"), 3)
        self.assertEqual(sum(1 for p in paths if p.endswith("/delete")), 3)  # файлы удаляются после ответа
        chat = json.loads([b for p, _, b in FakeGigaChat.log if p.endswith("/chat/completions")][0])
        self.assertIn("JSON-схеме", chat["messages"][0]["content"])
        self.assertEqual(paths.count("/api/v2/oauth"), 1)  # токен переиспользуется

    def test_bad_key(self):
        client = GigaChatClient(LLMConfig.from_env(), auth_key="d3Jvbmc=")
        st = client.status()
        self.assertFalse(st["available"])
        self.assertIn("токен", st["error"])


if __name__ == "__main__":
    unittest.main()
