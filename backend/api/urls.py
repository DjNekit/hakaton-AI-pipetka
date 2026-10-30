from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health),
    path("rules", views.rules),
    path("samples", views.samples),
    path("samples/<str:name>/pdf", views.sample_pdf),
    path("samples/<str:name>/check", views.sample_check),
    path("checks", views.checks),
    path("checks/<str:run_id>", views.check_detail),
    path("checks/<str:run_id>/blocks", views.check_blocks),
    path("checks/<str:run_id>/comparisons", views.check_comparisons),
    path("checks/<str:run_id>/corners", views.check_corners),
    path("checks/<str:run_id>/files/<path:relpath>", views.check_file),
]
