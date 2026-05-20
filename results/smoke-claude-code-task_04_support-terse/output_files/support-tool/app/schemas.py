from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: EmailStr
    name: str
    role: str


class UserCreate(BaseModel):
    email: EmailStr
    name: str
    password: str
    role: Literal["customer", "agent", "admin"] = "customer"


# ---------------------------------------------------------------------------
# Tickets
# ---------------------------------------------------------------------------

Priority = Literal["low", "normal", "high", "urgent"]
Status = Literal["new", "open", "pending", "resolved", "closed", "merged"]
ChannelLit = Literal["email", "web", "slack", "api"]


class TicketCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=500)
    description: str = ""
    priority: Priority = "normal"
    channel: ChannelLit = "web"
    tags: list[str] = []


class TicketUpdate(BaseModel):
    subject: Optional[str] = None
    priority: Optional[Priority] = None
    status: Optional[Status] = None
    assignee_id: Optional[int] = None
    tags: Optional[list[str]] = None


class CommentCreatePublic(BaseModel):
    """Customer-facing — visibility is forced to public server-side."""
    body: str = Field(min_length=1)


class CommentCreateAgent(BaseModel):
    body: str = Field(min_length=1)
    visibility: Literal["public", "internal"] = "public"


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    author_id: int
    visibility: str
    body: str
    from_email: bool
    created_at: datetime


class SLAOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    first_response_due_at: datetime
    resolution_due_at: datetime
    first_response_breached_at: Optional[datetime]
    resolution_breached_at: Optional[datetime]


class TicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    public_id: str
    subject: str
    description: str
    requester_id: int
    assignee_id: Optional[int]
    status: str
    priority: str
    channel: str
    tags: list[str]
    first_responded_at: Optional[datetime]
    resolved_at: Optional[datetime]
    closed_at: Optional[datetime]
    merged_into_id: Optional[int]
    created_at: datetime
    updated_at: datetime
    sla: Optional[SLAOut] = None


class TicketDetail(TicketOut):
    comments: list[CommentOut] = []


class MergeRequest(BaseModel):
    """Merge `source` ticket into `target`. Source becomes status='merged'."""
    source_ticket_id: int
    target_ticket_id: int


# ---------------------------------------------------------------------------
# KB
# ---------------------------------------------------------------------------

class KBArticleIn(BaseModel):
    slug: str
    title: str
    body: str
    published: bool = False


class KBArticleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    slug: str
    title: str
    body: str
    published: bool
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Macros
# ---------------------------------------------------------------------------

class MacroIn(BaseModel):
    name: str
    body: str


class MacroOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    body: str


# ---------------------------------------------------------------------------
# CSAT
# ---------------------------------------------------------------------------

class CSATSubmit(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None


# ---------------------------------------------------------------------------
# Inbound email (shape mirrors common provider webhooks; trimmed)
# ---------------------------------------------------------------------------

class InboundEmailAttachment(BaseModel):
    filename: str
    content_type: str
    size_bytes: int
    storage_url: str


class InboundEmail(BaseModel):
    from_email: EmailStr
    from_name: Optional[str] = None
    subject: str
    text_body: str
    in_reply_to_public_id: Optional[str] = None  # provider should extract from References/In-Reply-To
    attachments: list[InboundEmailAttachment] = []


# ---------------------------------------------------------------------------
# Customer profile
# ---------------------------------------------------------------------------

class CustomerProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: EmailStr
    name: str
    created_at: datetime
    ticket_count: int
    open_ticket_count: int
    tickets: list[TicketOut]
