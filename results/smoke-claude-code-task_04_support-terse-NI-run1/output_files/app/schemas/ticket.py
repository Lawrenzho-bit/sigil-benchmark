from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.message import MessageChannel, MessageKind
from app.models.ticket import TicketChannel, TicketPriority, TicketStatus


class TicketCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1)
    customer_email: EmailStr
    customer_name: str | None = None
    priority: TicketPriority = TicketPriority.NORMAL
    channel: TicketChannel = TicketChannel.WEB
    tags: list[str] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)


class TicketUpdate(BaseModel):
    status: TicketStatus | None = None
    priority: TicketPriority | None = None
    assignee_id: UUID | None = None
    team: str | None = None
    tags: list[str] | None = None


class MessageIn(BaseModel):
    body: str
    kind: MessageKind = MessageKind.AGENT_REPLY
    channel: MessageChannel = MessageChannel.WEB
    is_internal: bool = False


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    kind: MessageKind
    channel: MessageChannel
    body_text: str
    body_html: str | None
    is_internal: bool
    customer_id: UUID | None
    author_id: UUID | None
    created_at: datetime


class TicketListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    number: int
    subject: str
    status: TicketStatus
    priority: TicketPriority
    customer_id: UUID
    assignee_id: UUID | None
    first_response_due_at: datetime | None
    resolve_due_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TicketDetail(TicketListItem):
    channel: TicketChannel
    team: str | None
    first_response_at: datetime | None
    resolved_at: datetime | None
    closed_at: datetime | None
    tags: list[str]
    messages: list[MessageOut]


class TicketFilter(BaseModel):
    status: list[TicketStatus] | None = None
    priority: list[TicketPriority] | None = None
    assignee_id: UUID | None = None
    unassigned: bool = False
    customer_id: UUID | None = None
    tag: str | None = None
    q: str | None = None
    sort: str = "-updated_at"   # field or -field
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)
