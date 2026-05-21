"""Admin-staff identity model.

`User` is an *admin operator* of this tool (~50 people), authenticated via SSO.
It is distinct from `orgs.ManagedUser`, which represents the SaaS company's
customers that operators administer. Keeping them separate means a customer
account can never accidentally gain operator privileges.
"""
import uuid

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager
from django.db import models
from django.utils import timezone

from .rbac import Role, permissions_for


class UserManager(BaseUserManager):
    def create_user(self, email, full_name="", admin_role=Role.READ_ONLY, **extra):
        if not email:
            raise ValueError("Operators must have an email address.")
        user = self.model(
            email=self.normalize_email(email).lower(),
            full_name=full_name,
            admin_role=admin_role,
            **extra,
        )
        # SSO-only: operator accounts never hold a usable password.
        user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("admin_role", Role.SUPER_ADMIN)
        extra.setdefault("is_staff", True)
        user = self.create_user(email=email, **extra)
        if password:
            # Only reachable via `createsuperuser` in DEBUG for local bootstrap.
            user.set_password(password)
            user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=255, blank=True)
    admin_role = models.CharField(max_length=32, choices=Role.CHOICES, default=Role.READ_ONLY)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)  # Django-admin access only.

    sso_provider = models.CharField(max_length=16, blank=True)  # "oidc" | "saml"
    sso_subject = models.CharField(max_length=255, blank=True)  # IdP subject id

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        ordering = ["email"]
        indexes = [models.Index(fields=["sso_provider", "sso_subject"])]

    def __str__(self):
        return f"{self.email} ({self.get_admin_role_display()})"

    @property
    def permissions(self):
        return permissions_for(self.admin_role)

    # Django integration hooks. Authorization in this app flows through
    # accounts.rbac, never through Django's default permission system.
    def has_perm(self, perm, obj=None):
        from .rbac import has_perm as rbac_has_perm
        return rbac_has_perm(self, perm)

    def has_module_perms(self, app_label):
        return self.is_staff


class ImpersonationSession(models.Model):
    """Record of an operator acting as a customer (ManagedUser).

    A row is created when impersonation starts and closed when it ends. While
    a row is open, `AuditContextMiddleware` attaches the impersonation context
    to every audit entry, so all actions are attributed to the real operator
    *and* flagged as performed under impersonation.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    operator = models.ForeignKey(User, on_delete=models.PROTECT, related_name="impersonations")
    target = models.ForeignKey("orgs.ManagedUser", on_delete=models.PROTECT, related_name="impersonated_by")
    reason = models.TextField()  # Justification is mandatory.

    started_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)
    session_key = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["operator", "ended_at"])]

    @property
    def is_active(self):
        return self.ended_at is None

    def end(self):
        if self.is_active:
            self.ended_at = timezone.now()
            self.save(update_fields=["ended_at"])
