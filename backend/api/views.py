"""Тонкий HTTP-слой над colorpass.service (вся логика — в сервисном слое)."""
from __future__ import annotations

import functools
import mimetypes
from io import BytesIO

from django.conf import settings
from django.http import FileResponse, HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.static import serve

from colorpass import service

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

        return wrapper

    return deco


def _flag(request, name: str, default: bool = True) -> bool:
    value = request.GET.get(name, request.POST.get(name))
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


@api_view(["GET"])
def health(request):
    return JsonResponse(service.health(), **_JSON)


@api_view(["GET"])
def rules(request):
    return JsonResponse(service.rules(), **_JSON)


@api_view(["GET"])
def samples(request):
    return JsonResponse({"samples": service.list_samples()}, **_JSON)


@api_view(["GET"])
def sample_pdf(request, name: str):
    return FileResponse(open(service.sample_pdf(name), "rb"), content_type="application/pdf")


@api_view(["POST"])
def sample_check(request, name: str):
    return JsonResponse(service.start_sample(name, use_llm=_flag(request, "llm")), status=202, **_JSON)


@api_view(["GET", "POST"])
def checks(request):
    if request.method == "POST":
        upload = request.FILES.get("file")
        if upload is None:
            raise service.BadRequest("Не передан файл (поле формы «file»)")
        status = service.start_upload(upload.name, upload.read(), use_llm=_flag(request, "llm"))
        return JsonResponse(status, status=202, **_JSON)
    return JsonResponse({"checks": service.list_runs()}, **_JSON)


@api_view(["GET"])
def check_detail(request, run_id: str):
    return JsonResponse(service.get_run(run_id), **_JSON)


@api_view(["GET"])
def check_blocks(request, run_id: str):
    return JsonResponse(service.list_blocks(run_id), **_JSON)


@api_view(["POST"])
def check_corners(request, run_id: str):
    upload = request.FILES.get("photo")
    return JsonResponse(
        service.suggest_corners(run_id, photo_bytes=upload.read() if upload else None, photo_block=request.POST.get("photo_block")),
        **_JSON,
    )


@api_view(["GET", "POST"])
def check_comparisons(request, run_id: str):
    if request.method == "POST":
        upload = request.FILES.get("photo")
        result = service.compare_photo(
            run_id,
            request.POST.get("facade", ""),
            photo_bytes=upload.read() if upload else None,
            photo_name=upload.name if upload else "",
            photo_block=request.POST.get("photo_block"),
            quad=request.POST.get("quad"),
            rect=request.POST.get("rect"),
            use_llm=_flag(request, "llm"),
        )
        return JsonResponse(result, status=201, **_JSON)
    return JsonResponse({"comparisons": service.list_comparisons(run_id)}, **_JSON)


@api_view(["GET"])
def check_file(request, run_id: str, relpath: str):
    path = service.run_file(run_id, relpath)
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if path.suffix == ".md":
        content_type = "text/markdown; charset=utf-8"
    return FileResponse(open(path, "rb"), content_type=content_type)


@api_view(["GET"])
def check_export(request, run_id: str):
    data, filename = service.export_excel(run_id)
    return FileResponse(
        BytesIO(data),
        as_attachment=True,
        filename=filename,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@api_view(["POST"])
def change_status(request, run_id: str):
    return JsonResponse(
        service.change_finding_status(
            run_id,
            request.POST.get("finding_id", ""),
            request.POST.get("action", "dismiss"),
            request.POST.get("reason", ""),
        ),
        **_JSON,
    )


@api_view(["POST"])
def set_decision(request, run_id: str):
    return JsonResponse(
        service.set_decision(run_id, request.POST.get("decision", ""), request.POST.get("note", "")),
        **_JSON,
    )


# ----------------------------------------------------------------- фронтенд (сборка frontend/dist)


def frontend_index(request):
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        return HttpResponse(
            "<h1>colorpass API работает</h1><p>Фронтенд не собран. Режим разработки: "
            "<code>cd frontend &amp;&amp; npm install &amp;&amp; npm run dev</code> → http://localhost:5173. "
            "Или соберите: <code>npm run build</code>.</p><p>API: <a href='/api/health'>/api/health</a></p>",
            content_type="text/html; charset=utf-8",
        )
    return FileResponse(open(index, "rb"), content_type="text/html; charset=utf-8")


def frontend_asset(request, path: str):
    return serve(request, path, document_root=settings.FRONTEND_DIST / "assets")
