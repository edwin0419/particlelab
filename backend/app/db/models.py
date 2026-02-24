from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlmodel import Field, SQLModel


class ImageAsset(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, index=True)
    filename: str
    content_type: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    storage_path: str
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class Run(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, index=True)
    image_id: str = Field(foreign_key="imageasset.id", index=True)
    name: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class StepArtifact(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, index=True)
    run_id: str = Field(foreign_key="run.id", index=True)
    step_id: int = Field(index=True)
    version: int = Field(index=True)
    artifact_type: str = Field(index=True)
    params_json: str = Field(default="{}")
    files_json: str = Field(default="[]")
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
