"""Клиент GigaChat API (Сбер) — основная языковая модель сервиса; для разработки — локальная модель (LocalClient).

Модель только читает текст и изображения и формулирует выводы; решения «соответствует / нет» принимает код.
Без ключа или без доступа к API сервис работает по правилам.

Переменные окружения:
  GIGACHAT_AUTH_KEY=            ключ авторизации из личного кабинета (Base64 от «Client ID:Client Secret»)
  GIGACHAT_CLIENT_ID=, GIGACHAT_CLIENT_SECRET=   вместо ключа — его части
  GIGACHAT_SCOPE=GIGACHAT_API_PERS               физлица; GIGACHAT_API_B2B / GIGACHAT_API_CORP — для юрлиц
  GIGACHAT_MODEL=GigaChat-2-Max                  модель (Max и Pro понимают изображения)
  GIGACHAT_CA_BUNDLE=           путь к сертификату НУЦ Минцифры (в Docker-образе уже установлен в системные)
  GIGACHAT_VERIFY_SSL=1         0 — не проверять сертификат (только для отладки)
  LLM_TIMEOUT=180               секунд на запрос

Особенности API: токен по ключу авторизации живёт 30 минут; response_format нет — схема JSON передаётся
в системном промпте; изображения сначала загружаются через /files, в сообщении — одно изображение (до 10 на запрос).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass

log = logging.getLogger(__name__)

GIGACHAT_AUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
GIGACHAT_BASE_URL = "https://gigachat.devices.sberbank.ru/api/v1"
_TOKENS: dict[str, tuple[str, float]] = {}  # ключ авторизации → (токен, истекает, unix-секунды)
_TOKEN_LOCK = threading.Lock()


@dataclass
class LLMConfig:
    enabled: bool = True
    base_url: str = GIGACHAT_BASE_URL
    model: str = "GigaChat-2-Max"
    timeout: float = 180.0
    temperature: float = 0.01  # GigaChat не принимает 0

    @classmethod
    def from_env(cls) -> "LLMConfig":
        return cls(
            base_url=os.getenv("GIGACHAT_BASE_URL", GIGACHAT_BASE_URL).rstrip("/"),
            model=os.getenv("GIGACHAT_MODEL", "").strip() or cls.model,
            timeout=float(os.getenv("LLM_TIMEOUT", "180")),
        )


class LLMError(RuntimeError):
    pass


def _gigachat_key() -> str:
    key = os.getenv("GIGACHAT_AUTH_KEY", "").strip()
    if not key and os.getenv("GIGACHAT_CLIENT_ID") and os.getenv("GIGACHAT_CLIENT_SECRET"):
        raw = f"{os.getenv('GIGACHAT_CLIENT_ID').strip()}:{os.getenv('GIGACHAT_CLIENT_SECRET').strip()}"
        key = base64.b64encode(raw.encode()).decode()
    return key


class LLMClient:
    """GigaChat API: авторизация, загрузка изображений, чат, проверка доступности."""

    def __init__(self, config: LLMConfig | None = None, auth_key: str | None = None):
        self.config = config or LLMConfig.from_env()
        self._model: str | None = self.config.model or None
        self.calls: list[dict] = []
        self.auth_key = auth_key if auth_key is not None else _gigachat_key()
        self.auth_url = os.getenv("GIGACHAT_AUTH_URL", GIGACHAT_AUTH_URL)
        self.scope = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")

    # ------------------------------------------------------------------ транспорт
    def _ssl_context(self) -> ssl.SSLContext | None:
        if os.getenv("GIGACHAT_VERIFY_SSL", "1").strip().lower() in ("0", "false", "no", "off"):
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            return ctx
        bundle = os.getenv("GIGACHAT_CA_BUNDLE", "").strip()
        if bundle:
            ctx = ssl.create_default_context()
            ctx.load_verify_locations(cafile=bundle)
            return ctx
        return None

    def _token(self, force: bool = False) -> str:
        if not self.auth_key:
            raise LLMError("Не задан ключ GigaChat API (GIGACHAT_AUTH_KEY или GIGACHAT_CLIENT_ID + GIGACHAT_CLIENT_SECRET)")
        with _TOKEN_LOCK:
            cached = _TOKENS.get(self.auth_key)
            if cached and not force and cached[1] - time.time() > 60:
                return cached[0]
            req = urllib.request.Request(
                self.auth_url,
                data=urllib.parse.urlencode({"scope": self.scope}).encode(),
                method="POST",
            )
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
            req.add_header("Accept", "application/json")
            req.add_header("RqUID", str(uuid.uuid4()))
            req.add_header("Authorization", f"Basic {self.auth_key}")
            try:
                with urllib.request.urlopen(req, timeout=30, context=self._ssl_context()) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", "replace")[:300]
                raise LLMError(f"GigaChat: не удалось получить токен (HTTP {exc.code}): {body}") from exc
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
                hint = " Проверьте сертификат НУЦ Минцифры (GIGACHAT_CA_BUNDLE)." if "CERTIFICATE" in str(exc).upper() else ""
                raise LLMError(f"GigaChat: сервер авторизации недоступен: {exc}.{hint}") from exc
            token = data.get("access_token")
            if not token:
                raise LLMError(f"GigaChat: в ответе нет access_token: {str(data)[:200]}")
            expires = float(data.get("expires_at") or 0)
            expires = expires / 1000 if expires > 1e11 else expires or time.time() + 1500  # приходит в мс
            _TOKENS[self.auth_key] = (token, expires)
            return token

    def _auth_header(self) -> str:
        return f"Bearer {self._token()}"

    def _call(self, method: str, path: str, payload: dict | None = None, timeout: float | None = None) -> dict:
        try:
            return self._request(method, path, payload, timeout)
        except LLMError as exc:
            if "HTTP 401" not in str(exc):
                raise
            self._token(force=True)  # токен истёк раньше срока
            return self._request(method, path, payload, timeout)

    def _upload(self, png_b64: str, name: str) -> str:
        boundary = uuid.uuid4().hex
        body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"purpose\"\r\n\r\ngeneral\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
            "Content-Type: image/png\r\n\r\n"
        ).encode() + base64.b64decode(png_b64) + f"\r\n--{boundary}--\r\n".encode()
        for attempt in (0, 1):
            req = urllib.request.Request(f"{self.config.base_url}/files", data=body, method="POST")
            req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
            req.add_header("Accept", "application/json")
            req.add_header("Authorization", f"Bearer {self._token(force=attempt == 1)}")
            try:
                with urllib.request.urlopen(req, timeout=self.config.timeout, context=self._ssl_context()) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as exc:
                if exc.code == 401 and attempt == 0:
                    continue
                raise LLMError(f"GigaChat: не удалось загрузить изображение (HTTP {exc.code}): {exc.read()[:200]!r}") from exc
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
                raise LLMError(f"GigaChat недоступен: {exc}") from exc
        if not data.get("id"):
            raise LLMError(f"GigaChat: в ответе на загрузку нет id: {str(data)[:200]}")
        return data["id"]

    def _delete_file(self, file_id: str) -> None:
        try:
            self._call("POST", f"/files/{file_id}/delete", timeout=15)
        except LLMError as exc:  # файл удалится сам по сроку хранения; не мешаем проверке
            log.debug("GigaChat: файл %s не удалён: %s", file_id, exc)


    def _request(self, method: str, path: str, payload: dict | None = None, timeout: float | None = None) -> dict:
        url = f"{self.config.base_url}{path}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        req.add_header("Authorization", self._auth_header())
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.config.timeout, context=self._ssl_context()) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")[:500]
            raise LLMError(f"HTTP {exc.code}: {body}") from exc
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            raise LLMError(f"GigaChat недоступен ({url}): {exc}") from exc

    # ------------------------------------------------------------------ api
    def status(self) -> dict:
        base = {"enabled": self.config.enabled, "provider": "gigachat", "base_url": self.config.base_url}
        if not self.config.enabled:
            return {**base, "available": False, "model": None}
        try:
            data = self._call("GET", "/models", timeout=15)
        except LLMError as exc:
            return {**base, "available": False, "model": None, "error": str(exc)}
        models = [m.get("id") for m in data.get("data", []) if m.get("id")]
        model = self.config.model if (not models or self.config.model in models) else models[0]
        self._model = model
        return {**base, "available": True, "model": model, "models": models}

    def model(self) -> str:
        return self._model or self.config.model

    def chat(
        self, system: str, user: str, schema: dict | None = None, max_tokens: int = 2000, images: list[str] | None = None
    ) -> str:
        if not self.config.enabled:
            raise LLMError("Языковая модель отключена")
        if schema is not None:
            system += (
                "\n\nОтвет — только JSON-объект без пояснений и без markdown, строго по JSON-схеме:\n"
                + json.dumps(schema, ensure_ascii=False)
            )
        file_ids = [self._upload(b64, f"image{i + 1}.png") for i, b64 in enumerate((images or [])[:10])]
        messages: list[dict] = [{"role": "system", "content": system}]
        if file_ids:
            # одно изображение на сообщение: текст задания — с первым, остальные — отдельными сообщениями
            for i, fid in enumerate(file_ids):
                text = user if i == 0 else f"Изображение {i + 1}."
                messages.append({"role": "user", "content": text, "attachments": [fid]})
            if len(file_ids) > 1:
                messages.append({"role": "user", "content": "Это все изображения. Выполни задание из первого сообщения."})
        else:
            messages.append({"role": "user", "content": user})
        payload = {
            "model": self.model(),
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": max(self.config.temperature, 0.01),  # GigaChat не принимает 0
        }
        t0 = time.time()
        try:
            data = self._call("POST", "/chat/completions", payload)
        finally:
            for fid in file_ids:
                self._delete_file(fid)
        msg = (data.get("choices") or [{}])[0].get("message") or {}
        content = (msg.get("content") or "").strip()
        self.calls.append(
            {"model": payload["model"], "seconds": round(time.time() - t0, 1), "usage": data.get("usage"),
             "json": schema is not None, "images": len(file_ids)}
        )
        if not content:
            raise LLMError("GigaChat вернул пустой ответ")
        return content


    def chat_json(self, system: str, user: str, schema: dict, max_tokens: int = 2000, images: list[str] | None = None) -> dict:
        extra = {"images": images} if images else {}
        content = self.chat(system, user, schema=schema, max_tokens=max_tokens, **extra)
        return parse_json(content)


GigaChatClient = LLMClient  # прежнее имя класса


# ---------------------------------------------------------------------------- локальная модель (для разработки)


class LocalClient:
    """Локальная модель за OpenAI-совместимым API (LM Studio, llama.cpp server) — например, VLM на ноутбуке
    разработчика, до которого прод достаёт через обратный SSH-туннель. Включается переменной LOCAL_LLM_URL.

      LOCAL_LLM_URL=http://host.docker.internal:11234/v1   адрес API (пусто — не используется)
      LOCAL_LLM_MODEL=                                       пусто — первая загруженная чат-модель
      LOCAL_LLM_TIMEOUT=300                                  секунд на ответ
    """

    provider = "local"

    def __init__(self, base_url: str, model: str = "", timeout: float = 300.0):
        self.base_url = base_url.rstrip("/")
        self._model = model or None
        self.timeout = timeout
        self.calls: list[dict] = []

    def _request(self, method: str, path: str, payload: dict | None = None, timeout: float | None = None) -> dict:
        url = f"{self.base_url}{path}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", "Bearer local")
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise LLMError(f"Локальная модель: HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:300]}") from exc
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            raise LLMError(f"Локальная модель недоступна ({url}): {exc}") from exc

    def status(self) -> dict:
        base = {"enabled": True, "provider": "local", "base_url": self.base_url}
        try:
            data = self._request("GET", "/models", timeout=3)
        except LLMError as exc:
            return {**base, "available": False, "model": None, "error": str(exc)}
        models = [m.get("id") for m in data.get("data", []) if m.get("id") and "embed" not in m.get("id", "").lower()]
        model = self._model or (models[0] if models else None)
        self._model = model
        return {**base, "available": bool(model), "model": model, "models": models}

    def model(self) -> str:
        if not self._model and not self.status().get("available"):
            raise LLMError("Локальная модель: нет загруженной модели")
        return self._model  # type: ignore[return-value]

    def chat(
        self, system: str, user: str, schema: dict | None = None, max_tokens: int = 2000, images: list[str] | None = None
    ) -> str:
        content: str | list = user
        if images:
            content = [{"type": "text", "text": user}] + [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}} for b64 in images
            ]
        payload: dict = {
            "model": self.model(),
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}],
            "temperature": 0,
            "max_tokens": max_tokens,
            "reasoning_effort": "none",  # «думающие» модели отвечают в разы быстрее
        }
        if schema is not None:
            payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "result", "strict": True, "schema": schema}}
        t0 = time.time()
        try:
            data = self._request("POST", "/chat/completions", payload)
        except LLMError as exc:
            if "HTTP 400" not in str(exc):
                raise
            payload.pop("response_format", None)  # сервер не понимает structured output — без него
            payload.pop("reasoning_effort", None)
            data = self._request("POST", "/chat/completions", payload)
        msg = (data.get("choices") or [{}])[0].get("message") or {}
        text = re.sub(r"<think>.*?</think>", "", msg.get("content") or "", flags=re.S).strip()
        self.calls.append({"model": payload["model"], "provider": "local", "seconds": round(time.time() - t0, 1),
                           "usage": data.get("usage"), "json": schema is not None, "images": len(images or [])})
        if not text:
            raise LLMError("Локальная модель вернула пустой ответ")
        return text

    def chat_json(self, system: str, user: str, schema: dict, max_tokens: int = 2000, images: list[str] | None = None) -> dict:
        extra = {"images": images} if images else {}
        return parse_json(self.chat(system, user, schema=schema, max_tokens=max_tokens, **extra))


class RoutedClient:
    """Сначала локальная модель (если задан LOCAL_LLM_URL и она отвечает), иначе — GigaChat API.
    Если локальная модель отвалилась посреди проверки, запрос повторяется в GigaChat."""

    def __init__(self, local: LocalClient, cloud: LLMClient):
        self.local, self.cloud = local, cloud
        self.calls: list[dict] = []
        self._order: list = [local, cloud]
        self._status: dict | None = None

    def status(self) -> dict:
        ls, gs = self.local.status(), None
        if ls.get("available"):
            self._order = [self.local, self.cloud]
            active = {**ls, "provider": "local"}
        else:
            gs = self.cloud.status()
            self._order = [self.cloud]
            active = {**gs, "provider": "gigachat"}
        self._status = {**active, "local": {k: ls.get(k) for k in ("available", "model", "error", "base_url")},
                        "gigachat": None if gs is None else {k: gs.get(k) for k in ("available", "model", "error")}}
        return self._status

    def model(self) -> str:
        return self._order[0].model()

    def _run(self, method: str, *args, **kwargs):
        last: Exception | None = None
        for client in self._order:
            try:
                return getattr(client, method)(*args, **kwargs)
            except LLMError as exc:
                last = exc
                log.warning("%s не ответила, пробую следующую модель: %s", type(client).__name__, exc)
            finally:
                self.calls = self.local.calls + self.cloud.calls
        raise last or LLMError("Нет доступной модели")

    def chat(self, *args, **kwargs) -> str:
        return self._run("chat", *args, **kwargs)

    def chat_json(self, *args, **kwargs) -> dict:
        return self._run("chat_json", *args, **kwargs)


def make_client(config: LLMConfig | None = None):
    """GigaChat API; при заданном LOCAL_LLM_URL — сначала локальная модель, GigaChat — запасной."""
    cloud = LLMClient(config)
    local_url = os.getenv("LOCAL_LLM_URL", "").strip()
    if not local_url:
        return cloud
    local = LocalClient(local_url, os.getenv("LOCAL_LLM_MODEL", "").strip(), float(os.getenv("LOCAL_LLM_TIMEOUT", "300")))
    return RoutedClient(local, cloud)


def parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, flags=re.S)
        if not m:
            raise LLMError(f"Ответ модели не JSON: {text[:200]}")
        return json.loads(m.group(0))

