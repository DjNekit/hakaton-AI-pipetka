"""Тонкий HTTP-слой над core.service (вся логика — в сервисном слое).

Файлы (листы, развёртки, загрузки, Excel) отдаёт и принимает сервис checker по /files/…; бэкенд работает
только с данными: пакеты, отчёты, замечания, решения.
"""
from __future__ import annotations

import functools
import json

from django.conf import settings
from django.http import FileResponse, HttpResponse, HttpResponseRedirect, JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.static import serve

from core import service

_JSON = {"json_dumps_params": {"ensure_ascii": False}}


def api_view(methods: list[str]):
    def deco(fn):
        @functools.wraps(fn)
        @require_http_methods(methods)
        def wrapper(request, *args, **kwargs):
            try:
                return fn(request, *args, **kwargs)
            except service.NotFound as exc:
                return JsonResponse({"error": "not_found", "detail": str(exc)}, status=404, **_JSON)
            except service.BadRequest as exc:
                return JsonResponse({"error": "bad_request", "detail": str(exc)}, status=400, **_JSON)
            except service.Unavailable as exc:
                return JsonResponse({"error": "unavailable", "detail": str(exc)}, status=503, **_JSON)

        return wrapper

    return deco


def _data(request) -> dict:
    """Тело запроса: JSON или обычная форма."""
    if request.content_type == "application/json":
        try:
            data = json.loads(request.body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise service.BadRequest("Ожидается JSON") from exc
        if not isinstance(data, dict):
            raise service.BadRequest("Ожидается JSON-объект")
        return data
    return request.POST.dict()


# ---------------------------------------------------------------- справочные


@api_view(["GET"])
def health(request):
    return JsonResponse(service.health(), **_JSON)


@api_view(["GET"])
def rules(request):
    return JsonResponse(service.rules(), **_JSON)


@api_view(["GET"])
def samples(request):
    return JsonResponse({"samples": service.samples()}, **_JSON)


@api_view(["GET"])
def sample_pdf(request, name: str):
    return HttpResponseRedirect(f"/files/samples/{name}.pdf")


@api_view(["POST"])
def sample_check(request, name: str):
    return JsonResponse(service.start_sample(name), status=202, **_JSON)


# ---------------------------------------------------------------- пакеты


@api_view(["GET", "POST"])
def packages(request):
    if request.method == "POST":
        data = _data(request)
        pkg = service.create_package(data.get("uploads"), data.get("samples"), data.get("title", ""), data.get("service_type"))
        return JsonResponse(pkg, status=202, **_JSON)
    return JsonResponse({"packages": service.list_packages()}, **_JSON)


@api_view(["GET"])
def package_detail(request, package_id: str):
    return JsonResponse(service.get_package(package_id), **_JSON)


# ---------------------------------------------------------------- документы


@api_view(["GET"])
def check_detail(request, run_id: str):
    return JsonResponse(service.get_check(run_id), **_JSON)


@api_view(["GET"])
def check_report(request, run_id: str):
    return JsonResponse(service.report_json(run_id), **_JSON)


@api_view(["GET"])
def check_conclusion_md(request, run_id: str):
    resp = HttpResponse(service.conclusion_text(run_id), content_type="text/markdown; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="conclusion-{run_id}.md"'
    return resp


@api_view(["GET"])
def check_export(request, run_id: str):
    return HttpResponseRedirect(service.export_excel_url(run_id))


@api_view(["POST"])
def change_status(request, run_id: str):
    d = _data(request)
    return JsonResponse(service.change_finding_status(run_id, d.get("finding_id", ""), d.get("action", "dismiss"), d.get("reason", "")), **_JSON)


@api_view(["POST"])
def set_decision(request, run_id: str):
    d = _data(request)
    return JsonResponse(service.set_decision(run_id, d.get("decision", ""), d.get("note", "")), **_JSON)


@api_view(["POST"])
def check_conclusion(request, run_id: str):
    """Заключение от модели — его присылает сервис chat."""
    d = _data(request)
    return JsonResponse(service.save_conclusion(run_id, d.get("text", ""), d.get("model", ""), d.get("provider", "")), **_JSON)


# ---------------------------------------------------------------- сравнение фото


@api_view(["GET"])
def check_blocks(request, run_id: str):
    return JsonResponse(service.blocks(run_id), **_JSON)


@api_view(["POST"])
def check_corners(request, run_id: str):
    return JsonResponse(service.corners(run_id, _data(request)), **_JSON)


@api_view(["GET", "POST"])
def check_comparisons(request, run_id: str):
    if request.method == "POST":
        return JsonResponse(service.compare_photo(run_id, _data(request)), status=201, **_JSON)
    return JsonResponse({"comparisons": service.list_comparisons(run_id)}, **_JSON)


@api_view(["POST"])
def comparison_review(request, run_id: str, cid: str):
    """Описание отличий на фото от модели — его присылает сервис chat."""
    d = _data(request)
    return JsonResponse(service.save_photo_review(run_id, cid, d.get("review"), d.get("model", ""), d.get("provider", ""), d.get("error", "")), **_JSON)


# ---------------------------------------------------------------- фронтенд (если собран и бэкенд открыт напрямую)


def frontend_index(request):
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        return HttpResponse(
            "<h1>colorpass API работает</h1><p>Фронтенд не собран. Режим разработки: "
            "<code>docker compose up</code> → http://localhost:5173.</p><p>API: <a href='/api/health'>/api/health</a></p>",
            content_type="text/html; charset=utf-8",
        )
    return FileResponse(open(index, "rb"), content_type="text/html; charset=utf-8")


def frontend_asset(request, path: str):
    return serve(request, path, document_root=settings.FRONTEND_DIST / "assets")
