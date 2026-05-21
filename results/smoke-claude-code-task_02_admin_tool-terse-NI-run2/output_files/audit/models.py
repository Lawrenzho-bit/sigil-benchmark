"""Tamper-evident audit log.

Every mutating admin action writes one `AuditLog` row. Rows form a hash chain:
each row's `row_hash` covers its own content *and* the previous row's hash.
Altering or deleting any historical row breaks every hash after it, which
`verify_chain` (and the `audit_verify` management command) detects.

The log is append-only by contract: there are no update/delete views, and the
DB account used by the app should not be granted DELETE on this table in a
hardened deployment (see README).
"""
import hashlib
import json
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

GENESIS_HASH = "0" * 64


def _canonical(payload: dict) -> str:
    """Deterministic JSON used as hash input. Key order is fixed so the same
    logical content always hashes identically."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


class AuditLog(models.Model):
    seq = models.BigAutoField(primary_key=True)  # chain order
    public_id = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="audit_entries"
    )
    actor_email = models.CharField(max_length=255, blank=True)  # snapshot, survives actor deletion
    actor_role = models.CharField(max_length=32, blank=True)

    action = models.CharField(max_length=64, db_index=True)
    outcome = models.CharField(max_length=16, default="success")  # success | denied | error

    target_type = models.CharField(max_length=64, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    target_repr = models.CharField(max_length=255, blank=True)

    # {field: [old, new]} for edits; free-form context otherwise.
    diff = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    impersonation = models.ForeignKey(
        "accounts.ImpersonationSession", on_delete=models.SET_NULL, null=True, blank=True
    )

    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True)

    prev_hash = models.CharField(max_length=64, editable=False)
    row_hash = models.CharField(max_length=64, editable=False, unique=True)

    class Meta:
        ordering = ["-seq"]
        indexes = [
            models.Index(fields=["target_type", "target_id"]),
            models.Index(fields=["actor", "-seq"]),
        ]

    def __str__(self):
        return f"#{self.seq} {self.action} by {self.actor_email or 'system'}"

    def content_payload(self) -> dict:
        """The fields covered by the hash. `seq`/`row_hash` are excluded;
        `prev_hash` is included so the chain is linked."""
        return {
            "public_id": str(self.public_id),
            "timestamp": self.timestamp.isoformat(),
            "actor_email": self.actor_email,
            "actor_role": self.actor_role,
            "action": self.action,
            "outcome": self.outcome,
            "target_type": self.target_type,
            "target_id": self.target_id,
            "target_repr": self.target_repr,
            "diff": self.diff,
            "metadata": self.metadata,
            "impersonation": str(self.impersonation_id) if self.impersonation_id else None,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "prev_hash": self.prev_hash,
        }

    def compute_hash(self) -> str:
        return hashlib.sha256(_canonical(self.content_payload()).encode()).hexdigest()


def verify_chain(queryset=None):
    """Walk the chain in order and confirm every link. Returns (ok, errors)."""
    rows = (queryset or AuditLog.objects.all()).order_by("seq")
    errors = []
    expected_prev = GENESIS_HASH
    for row in rows.iterator():
        if row.prev_hash != expected_prev:
            errors.append(f"#{row.seq}: prev_hash mismatch (chain broken before this row)")
        if row.compute_hash() != row.row_hash:
            errors.append(f"#{row.seq}: row_hash mismatch (row content was altered)")
        expected_prev = row.row_hash
    return (not errors, errors)
