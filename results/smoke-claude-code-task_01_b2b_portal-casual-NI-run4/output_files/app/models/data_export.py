"""GDPR data-export request model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.enums import ExportStatus
from app.models.base import Base, Timestamps, UUIDPrimaryKey, enum_column

if TYPE_CHECKING:
    import uuid


class DataExportRequest(Base, UUIDPrimaryKey, Timestamps):
    """Tracks a user's request to export their personal data (GDPR art. 15/20).

    The export is generated synchronously for this portal's scale; the model
    still records status/timestamps so the flow can move to a background job
    without an interface change.
    """

    __tablename__ = "data_export_requests"

    user_id: Mapped["uuid.UUID"] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[ExportStatus] = mapped_column(
        enum_column(ExportStatus), default=ExportStatus.PENDING, nullable=False
    )
    # Server-side path of the generated JSON archive.
    file_path: Mapped[str | None] = mapped_column(String(512))
    error: Mapped[str | None] = mapped_column(String(512))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
