from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health),
    path("rules", views.rules),
    path("samples", views.samples),
    path("samples/<str:name>/pdf", views.sample_pdf),
    path("samples/<str:name>/check", views.sample_check),
    # пакеты документов одной заявки
    path("packages", views.packages),
    path("packages/<str:package_id>", views.package_detail),
    # документы пакета
    path("checks/<str:run_id>", views.check_detail),
    path("checks/<str:run_id>/report.json", views.check_report),
    path("checks/<str:run_id>/conclusion.md", views.check_conclusion_md),
    path("checks/<str:run_id>/export.xlsx", views.check_export),
    path("checks/<str:run_id>/change_status", views.change_status),
    path("checks/<str:run_id>/decision", views.set_decision),
    path("checks/<str:run_id>/conclusion", views.check_conclusion),
    path("checks/<str:run_id>/blocks", views.check_blocks),
    path("checks/<str:run_id>/corners", views.check_corners),
    path("checks/<str:run_id>/comparisons", views.check_comparisons),
    path("checks/<str:run_id>/comparisons/<str:cid>/review", views.comparison_review),
]
