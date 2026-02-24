from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class FileRef(BaseModel):
    path: str
    mime_type: str


class ImageAssetRead(BaseModel):
    id: str
    filename: str
    mime_type: Optional[str]
    width: Optional[int]
    height: Optional[int]
    created_at: datetime
    original_url: str


class RunCreate(BaseModel):
    image_id: str
    name: Optional[str] = None


class RunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    image_id: str
    name: Optional[str]
    created_at: datetime


class StepArtifactRead(BaseModel):
    id: str
    run_id: str
    step_id: int
    version: int
    artifact_type: str
    params: dict[str, Any] = Field(default_factory=dict)
    files: list[FileRef] = Field(default_factory=list)
    file_urls: list[str] = Field(default_factory=list)
    created_at: datetime


class ArtifactVersionGroup(BaseModel):
    version: int
    artifacts: list[StepArtifactRead]


class ArtifactStepGroup(BaseModel):
    step_id: int
    versions: list[ArtifactVersionGroup]


class RunArtifactsGroupedResponse(BaseModel):
    run_id: str
    steps: list[ArtifactStepGroup]


class RunHistoryImportResponse(BaseModel):
    run_id: str
    imported_count: int


class StepExecuteRequest(BaseModel):
    params: dict[str, Any] = Field(default_factory=dict)


class StepExecuteResponse(BaseModel):
    run_id: str
    step_id: int
    version: int
    artifacts: list[StepArtifactRead]


class Step1Measurement(BaseModel):
    ax: int
    ay: int
    bx: int
    by: int
    pixel_distance: float
    real_um: float

    @field_validator("pixel_distance", "real_um")
    @classmethod
    def _validate_positive(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("측정 길이는 0보다 커야 합니다.")
        return value


class Step1ExecuteRequest(BaseModel):
    crop_bottom_px: int = Field(default=0, ge=0)
    um_per_px: float
    measurement: Optional[Step1Measurement] = None

    @field_validator("um_per_px")
    @classmethod
    def _validate_um_per_px(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("µm/px 값은 0보다 커야 합니다.")
        return value


class Step1ExecuteResponse(BaseModel):
    run_id: str
    step_id: int
    version: int
    artifact: StepArtifactRead


class Step3ExecuteRequest(BaseModel):
    method: str = Field(default="bilateral")
    strength: float = Field(default=40, ge=0, le=100)
    edge_protect: float = Field(default=60, ge=0, le=100)
    quality_mode: str = Field(default="빠름")
    input_artifact_id: Optional[str] = None
    exclude_mask: Optional[str] = None
    exclude_roi: Optional[dict[str, Any]] = None

    @field_validator("method")
    @classmethod
    def _validate_method(cls, value: str) -> str:
        if value not in {"bilateral", "nlm"}:
            raise ValueError("방법은 bilateral 또는 nlm이어야 합니다.")
        return value

    @field_validator("quality_mode")
    @classmethod
    def _validate_quality_mode(cls, value: str) -> str:
        if value not in {"빠름", "정확"}:
            raise ValueError("처리 모드는 빠름 또는 정확이어야 합니다.")
        return value


class Step4ExecuteRequest(BaseModel):
    mode: str = Field(default="structure")
    seed_sensitivity: float = Field(default=50, ge=0, le=100)
    candidate_sensitivity: float = Field(default=50, ge=0, le=100)
    structure_scale_um: float = Field(default=1.0, gt=0)
    min_area_um2: float = Field(default=0.1, gt=0)
    input_artifact_id: Optional[str] = None

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, value: str) -> str:
        if value not in {"structure", "simple"}:
            raise ValueError("이진화 모드는 구조 기반 또는 단순 임계값이어야 합니다.")
        return value


class Step4PreviewRequest(Step4ExecuteRequest):
    preview_layer: str = Field(default="mask")

    @field_validator("preview_layer")
    @classmethod
    def _validate_preview_layer(cls, value: str) -> str:
        if value not in {"seed", "candidate", "mask", "mask_binary"}:
            raise ValueError("미리보기 레이어는 시드, 후보, 최종 마스크, 최종 마스크(흑백) 중 하나여야 합니다.")
        return value


class Step5ExecuteRequest(BaseModel):
    base_mask_artifact_id: Optional[str] = None
    edited_mask_png_base64: str = Field(min_length=1)
    brush_mode: Optional[str] = None
    brush_size_px: Optional[int] = None


class Step6ExecuteRequest(BaseModel):
    base_mask_artifact_id: Optional[str] = None
    max_expand_um: float = Field(default=1.0, ge=0.0, le=10.0)
    recover_sensitivity: float = Field(default=50.0, ge=0.0, le=100.0)
    edge_protect: float = Field(default=60.0, ge=0.0, le=100.0)
    fill_small_holes: bool = Field(default=True)


class Step7ExecuteRequest(BaseModel):
    base_mask_artifact_id: Optional[str] = None
    hole_mode: str = Field(default="fill_all")
    max_hole_area_um2: Optional[float] = Field(default=None, gt=0)
    closing_enabled: bool = Field(default=False)
    closing_radius_um: Optional[float] = Field(default=None, ge=0)

    @field_validator("hole_mode")
    @classmethod
    def _validate_hole_mode(cls, value: str) -> str:
        if value not in {"fill_all", "fill_small", "keep"}:
            raise ValueError("공극 처리 방식은 fill_all, fill_small, keep 중 하나여야 합니다.")
        return value


class Step7PreviewMetrics(BaseModel):
    solid_area_px: int
    outer_area_px: int
    porosity: float


class Step7PreviewResponse(BaseModel):
    solid_png_base64: str
    outer_png_base64: str
    metrics: Step7PreviewMetrics


class Step8ExecuteRequest(BaseModel):
    base_mask_artifact_id: Optional[str] = None
    step7_artifact_id: Optional[str] = None


class Step9ExecuteRequest(BaseModel):
    step8_artifact_id: Optional[str] = None
    smooth_level: float = Field(default=35.0, ge=0.0, le=100.0)
    resample_step_px: float = Field(default=2.0, ge=0.5, le=5.0)
    max_vertex_gap_px: float = Field(default=3.0, ge=1.0, le=8.0)


class Step9PreviewResponse(BaseModel):
    polygon_count: int
    polygons: list[dict[str, Any]] = Field(default_factory=list)
    image_width: Optional[int] = None
    image_height: Optional[int] = None


class Step10ExecuteRequest(BaseModel):
    split_strength: float = Field(default=50.0, ge=0.0, le=100.0)
    min_center_distance_px: int = Field(default=18, ge=1, le=512)
    min_particle_area: int = Field(default=30, ge=1, le=10_000_000)
    step9_artifact_id: Optional[str] = None
    step3_artifact_id: Optional[str] = None


class Step10PreviewResponse(BaseModel):
    split_lines: list[dict[str, Any]] = Field(default_factory=list)
    preview_labels_url: str
    split_line_count: int
    label_count: int
    image_width: Optional[int] = None
    image_height: Optional[int] = None
    label_areas: dict[str, int] = Field(default_factory=dict)
    qc: dict[str, Any] = Field(default_factory=dict)


class ArtifactRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ErrorResponse(BaseModel):
    detail: str
