from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class MacroCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    body: str
    actions: dict = Field(default_factory=dict)
    visibility: str = "team"


class MacroOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    body: str
    actions: dict
    visibility: str
    use_count: int
    created_at: datetime
    updated_at: datetime
