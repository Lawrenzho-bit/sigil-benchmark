from django.urls import include, path

from accounts import views as account_views

urlpatterns = [
    path("", account_views.dashboard, name="dashboard"),
    path("auth/", include("accounts.urls")),
    path("users/", include("accounts.user_urls")),
    path("orgs/", include("orgs.urls")),
    path("audit/", include("audit.urls")),
    path("flags/", include("featureflags.urls")),
    path("tokens/", include("apitokens.urls")),
    path("comms/", include("comms.urls")),
    path("health/", include("health.urls")),
    path("bulk/", include("bulkops.urls")),
]
