from django.urls import include, path, re_path

from api import views

urlpatterns = [
    path("api/", include("api.urls")),
    re_path(r"^assets/(?P<path>.+)$", views.frontend_asset),
    re_path(r"^(?!api/).*$", views.frontend_index),
]
