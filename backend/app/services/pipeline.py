from __future__ import annotations

import base64
import heapq
import json
import math
from collections import deque
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageOps
from sqlalchemy import func
from sqlmodel import Session, desc, select

from app.db.models import ImageAsset, Run, StepArtifact
from app.schemas import FileRef
from app.services.storage import storage_service

VALID_STEP_IDS = {1, 2, 3, 4, 45, 5, 6, 7, 8, 9, 10}
STEP_PREREQUISITES: dict[int, int] = {
    2: 1,
    3: 2,
    4: 3,
    5: 4,
    45: 5,
    6: 5,
    7: 6,
    9: 8,
    10: 9,
}


def _next_version(session: Session, run_id: str, step_id: int) -> int:
    stmt = select(func.max(StepArtifact.version)).where(
        StepArtifact.run_id == run_id,
        StepArtifact.step_id == step_id,
    )
    current = session.exec(stmt).one()
    return (current or 0) + 1


def _add_artifact(
    session: Session,
    *,
    run_id: str,
    step_id: int,
    version: int,
    artifact_type: str,
    params: dict[str, Any],
    files: list[FileRef],
) -> StepArtifact:
    artifact = StepArtifact(
        run_id=run_id,
        step_id=step_id,
        version=version,
        artifact_type=artifact_type,
        params_json=json.dumps(params, ensure_ascii=False),
        files_json=json.dumps([f.model_dump() for f in files], ensure_ascii=False),
    )
    session.add(artifact)
    session.flush()
    return artifact


def _get_image_size(image: ImageAsset) -> tuple[int, int]:
    if image.width and image.height:
        return image.width, image.height
    abs_path = storage_service.resolve(image.storage_path)
    with Image.open(abs_path) as img:
        return img.size


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_float(value: Any, default: float | None = None) -> float | None:
    try:
        converted = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(converted):
        return default
    return converted


def _serialize_files(files: list[FileRef]) -> str:
    return json.dumps([file_ref.model_dump() for file_ref in files], ensure_ascii=False)


def _safe_json_loads(raw: str, fallback: Any) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback


def _to_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "y", "on"}:
            return True
        if normalized in {"0", "false", "no", "n", "off"}:
            return False
    if isinstance(value, (int, float)):
        return value != 0
    return default


def _clamp_float(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def _step_label(step_id: int) -> str:
    if step_id == 45:
        return "4.5"
    return str(step_id)


def _is_step_completed(session: Session, run_id: str, step_id: int) -> bool:
    stmt = select(StepArtifact.id).where(
        StepArtifact.run_id == run_id,
        StepArtifact.step_id == step_id,
    )
    return session.exec(stmt.limit(1)).first() is not None


def _validate_step_prerequisite(session: Session, run_id: str, step_id: int) -> None:
    prerequisite = STEP_PREREQUISITES.get(step_id)
    if prerequisite is None:
        return
    if _is_step_completed(session, run_id, prerequisite):
        return
    if step_id == 9 and prerequisite == 6:
        raise ValueError("먼저 6단계 마스크가 필요합니다.")
    if step_id == 10 and prerequisite == 9:
        raise ValueError("먼저 9단계 폴리곤이 필요합니다.")
    raise ValueError(f"{_step_label(prerequisite)}단계를 먼저 완료해야 실행할 수 있습니다.")


def _latest_step_artifact(session: Session, run_id: str, step_id: int) -> StepArtifact | None:
    stmt = (
        select(StepArtifact)
        .where(
            StepArtifact.run_id == run_id,
            StepArtifact.step_id == step_id,
        )
        .order_by(desc(StepArtifact.version), desc(StepArtifact.created_at))
        .limit(1)
    )
    return session.exec(stmt).first()


def _artifact_first_image_path(artifact: StepArtifact | None) -> str | None:
    if artifact is None:
        return None
    files = _safe_json_loads(artifact.files_json, [])
    if not isinstance(files, list):
        return None
    for file_item in files:
        if not isinstance(file_item, dict):
            continue
        path = file_item.get("path")
        mime_type = str(file_item.get("mime_type", ""))
        if isinstance(path, str) and mime_type.startswith("image/"):
            return path
    return None


def _artifact_step3_exclude_mask_path(artifact: StepArtifact | None) -> str | None:
    if artifact is None:
        return None
    files = _safe_json_loads(artifact.files_json, [])
    if not isinstance(files, list):
        return None
    for file_item in files:
        if not isinstance(file_item, dict):
            continue
        path = file_item.get("path")
        if not isinstance(path, str) or not path:
            continue
        filename = Path(path).name.lower()
        if "exclude_mask" in filename:
            return path
    return None


def _artifact_image_path_by_keywords(artifact: StepArtifact | None, keywords: list[str]) -> str | None:
    if artifact is None:
        return None
    files = _safe_json_loads(artifact.files_json, [])
    if not isinstance(files, list):
        return None
    normalized_keywords = [keyword.lower() for keyword in keywords if keyword]
    for file_item in files:
        if not isinstance(file_item, dict):
            continue
        path = file_item.get("path")
        mime_type = str(file_item.get("mime_type", ""))
        if not isinstance(path, str) or not path or not mime_type.startswith("image/"):
            continue
        filename = Path(path).name.lower()
        if any(keyword in filename for keyword in normalized_keywords):
            return path
    return None


def _artifact_json_path_by_keywords(artifact: StepArtifact | None, keywords: list[str]) -> str | None:
    if artifact is None:
        return None
    files = _safe_json_loads(artifact.files_json, [])
    if not isinstance(files, list):
        return None
    normalized_keywords = [keyword.lower() for keyword in keywords if keyword]
    for file_item in files:
        if not isinstance(file_item, dict):
            continue
        path = file_item.get("path")
        mime_type = str(file_item.get("mime_type", ""))
        if not isinstance(path, str) or not path:
            continue
        filename = Path(path).name.lower()
        if mime_type == "application/json" or filename.endswith(".json"):
            if not normalized_keywords or any(keyword in filename for keyword in normalized_keywords):
                return path
    return None


def _load_step3_exclude_mask_image(session: Session, step3_artifact_id: str) -> Image.Image | None:
    artifact = session.get(StepArtifact, step3_artifact_id)
    if artifact is None:
        return None
    mask_path = _artifact_step3_exclude_mask_path(artifact)
    if not mask_path:
        return None
    absolute_path = storage_service.resolve(mask_path)
    if not absolute_path.exists():
        return None
    with Image.open(absolute_path) as mask_image:
        return mask_image.convert("L").copy()


def _resolve_input_image_path(session: Session, run: Run, image: ImageAsset, step_id: int) -> str:
    prerequisite = STEP_PREREQUISITES.get(step_id)
    if prerequisite is None:
        return image.storage_path

    prerequisite_artifact = _latest_step_artifact(session, run.id, prerequisite)
    artifact_image_path = _artifact_first_image_path(prerequisite_artifact)
    if artifact_image_path:
        absolute = storage_service.resolve(artifact_image_path)
        if absolute.exists():
            return artifact_image_path

    return image.storage_path


def _normalize_step2_params(params: dict[str, Any]) -> dict[str, Any]:
    brightness = _to_float(params.get("brightness"), 0.0) or 0.0
    contrast = _to_float(params.get("contrast"), 0.0) or 0.0
    gamma = _to_float(params.get("gamma"), 1.0) or 1.0
    clahe_enabled = _to_bool(params.get("clahe_enabled"), False)
    clahe_strength = _to_float(params.get("clahe_strength"), 0.0) or 0.0
    black_clip_pct = _to_float(params.get("black_clip_pct"), 0.5) or 0.5
    white_clip_pct = _to_float(params.get("white_clip_pct"), 99.5) or 99.5

    clahe_tile_raw = params.get("clahe_tile")
    clahe_tile_map = {
        "자동": "auto",
        "작게": "small",
        "보통": "medium",
        "크게": "large",
        "auto": "auto",
        "small": "small",
        "medium": "medium",
        "large": "large",
    }
    clahe_tile = clahe_tile_map.get(str(clahe_tile_raw or "auto").strip().lower(), "auto")

    normalized = {
        "brightness": _clamp_float(brightness, -100.0, 100.0),
        "contrast": _clamp_float(contrast, -100.0, 100.0),
        "gamma": _clamp_float(gamma, 0.2, 5.0),
        "clahe_enabled": clahe_enabled,
        "clahe_strength": _clamp_float(clahe_strength, 0.0, 10.0),
        "black_clip_pct": _clamp_float(black_clip_pct, 0.0, 5.0),
        "white_clip_pct": _clamp_float(white_clip_pct, 95.0, 100.0),
        "clahe_tile": clahe_tile,
    }

    if normalized["white_clip_pct"] <= normalized["black_clip_pct"]:
        normalized["white_clip_pct"] = max(95.0, min(100.0, normalized["black_clip_pct"] + 1.0))

    return normalized


def _resolve_clahe_tile_size(width: int, height: int, clahe_tile: str) -> int:
    short_edge = max(16, min(width, height))
    if clahe_tile == "small":
        return max(16, short_edge // 16)
    if clahe_tile == "medium":
        return max(24, short_edge // 10)
    if clahe_tile == "large":
        return max(32, short_edge // 6)
    return max(24, short_edge // 12)


def _apply_clahe_approximation(image: Image.Image, strength: float, clahe_tile: str) -> Image.Image:
    alpha = _clamp_float(strength / 10.0, 0.0, 1.0)
    if alpha <= 0:
        return image

    width, height = image.size
    tile_size = _resolve_clahe_tile_size(width, height, clahe_tile)
    result = Image.new("L", (width, height))

    for top in range(0, height, tile_size):
        for left in range(0, width, tile_size):
            box = (left, top, min(width, left + tile_size), min(height, top + tile_size))
            tile = image.crop(box)
            equalized = ImageOps.equalize(tile)
            mixed = Image.blend(tile, equalized, alpha)
            result.paste(mixed, box)

    return result


def _apply_step2_pipeline(source: Image.Image, params: dict[str, Any]) -> tuple[Image.Image, dict[str, Any]]:
    normalized_params = _normalize_step2_params(params)
    image = source.convert("L")

    low_cutoff = normalized_params["black_clip_pct"]
    high_cutoff = 100.0 - normalized_params["white_clip_pct"]
    image = ImageOps.autocontrast(image, cutoff=(low_cutoff, high_cutoff))

    brightness_shift = normalized_params["brightness"] * 2.55
    contrast_factor = max(0.0, 1.0 + (normalized_params["contrast"] / 100.0))
    lut_brightness_contrast: list[int] = []
    for value in range(256):
        adjusted = ((value - 128.0) * contrast_factor) + 128.0 + brightness_shift
        lut_brightness_contrast.append(int(_clamp_float(adjusted, 0.0, 255.0)))
    image = image.point(lut_brightness_contrast)

    gamma_value = max(0.2, float(normalized_params["gamma"]))
    gamma_inv = 1.0 / gamma_value
    lut_gamma = [int(_clamp_float((255.0 * ((value / 255.0) ** gamma_inv)), 0.0, 255.0)) for value in range(256)]
    image = image.point(lut_gamma)

    if normalized_params["clahe_enabled"] and normalized_params["clahe_strength"] > 0:
        image = _apply_clahe_approximation(
            image,
            strength=float(normalized_params["clahe_strength"]),
            clahe_tile=str(normalized_params["clahe_tile"]),
        )

    return image, normalized_params


def _clamp_int(value: int, min_value: int, max_value: int) -> int:
    return max(min_value, min(max_value, value))


def _normalize_step3_params(params: dict[str, Any]) -> dict[str, Any]:
    method_raw = str(params.get("method", "bilateral")).strip().lower()
    method_map = {
        "bilateral": "bilateral",
        "양방향 필터(기본)": "bilateral",
        "양방향 필터": "bilateral",
        "양방향": "bilateral",
        "nlm": "nlm",
        "비국소 평균(nlm)": "nlm",
        "비국소 평균": "nlm",
    }
    method = method_map.get(method_raw)
    if method is None:
        raise ValueError("3단계 방법은 양방향 필터 또는 비국소 평균(NLM)만 지원합니다.")

    quality_raw = str(params.get("quality_mode", "빠름")).strip()
    quality_map = {
        "빠름": "빠름",
        "빠름(미리보기)": "빠름",
        "정확": "정확",
        "정확(원본)": "정확",
    }
    quality_mode = quality_map.get(quality_raw)
    if quality_mode is None:
        raise ValueError("처리 모드는 빠름 또는 정확만 지원합니다.")

    input_artifact_id = params.get("input_artifact_id")
    normalized_input_artifact_id: str | None = None
    if isinstance(input_artifact_id, str) and input_artifact_id.strip():
        normalized_input_artifact_id = input_artifact_id.strip()

    exclude_mask_raw = params.get("exclude_mask")
    normalized_exclude_mask: str | None = None
    if isinstance(exclude_mask_raw, str) and exclude_mask_raw.strip():
        normalized_exclude_mask = exclude_mask_raw.strip()

    exclude_roi_raw = params.get("exclude_roi")
    normalized_exclude_roi: dict[str, Any] | None = None
    if isinstance(exclude_roi_raw, dict):
        normalized_exclude_roi = exclude_roi_raw

    return {
        "method": method,
        "strength": _clamp_float(_to_float(params.get("strength"), 40.0) or 40.0, 0.0, 100.0),
        "edge_protect": _clamp_float(_to_float(params.get("edge_protect"), 60.0) or 60.0, 0.0, 100.0),
        "quality_mode": quality_mode,
        "input_artifact_id": normalized_input_artifact_id,
        "exclude_mask": normalized_exclude_mask,
        "exclude_roi": normalized_exclude_roi,
    }


def _decode_base64_image_bytes(value: str) -> bytes:
    raw = value.strip()
    if raw.startswith("data:"):
        parts = raw.split(",", 1)
        if len(parts) != 2:
            raise ValueError("제외 마스크 데이터 형식이 올바르지 않습니다.")
        raw = parts[1]
    try:
        return base64.b64decode(raw.encode("ascii"), validate=True)
    except Exception as exc:
        raise ValueError("제외 마스크 인코딩이 올바르지 않습니다.") from exc


def _normalize_step3_exclude_mask(mask_raw: str | None, width: int, height: int) -> Image.Image:
    if mask_raw is None:
        return Image.new("L", (width, height), 0)

    decoded = _decode_base64_image_bytes(mask_raw)
    try:
        with Image.open(BytesIO(decoded)) as loaded:
            mask = loaded.convert("L")
            if mask.size != (width, height):
                raise ValueError("제외 마스크 크기가 입력 이미지와 일치하지 않습니다.")
            binary = mask.point(lambda value: 255 if value >= 128 else 0)
            unique_values = set(binary.getdata())
            if not unique_values.issubset({0, 255}):
                raise ValueError("제외 마스크는 0 또는 255 값만 포함해야 합니다.")
            return binary
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("제외 마스크를 이미지로 해석할 수 없습니다.") from exc


def _sanitize_step3_exclude_roi(
    roi_raw: dict[str, Any] | None,
    width: int,
    height: int,
) -> dict[str, Any]:
    if roi_raw is None:
        return {
            "rectangles": [],
            "polygons": [],
            "brush_strokes": [],
        }

    rectangles_raw = roi_raw.get("rectangles")
    polygons_raw = roi_raw.get("polygons")
    brush_raw = roi_raw.get("brush_strokes")

    sanitized_rectangles: list[dict[str, int]] = []
    if isinstance(rectangles_raw, list):
        for item in rectangles_raw:
            if not isinstance(item, dict):
                continue
            x = _to_int(item.get("x"), 0)
            y = _to_int(item.get("y"), 0)
            rect_width = _to_int(item.get("width"), 0)
            rect_height = _to_int(item.get("height"), 0)
            if rect_width <= 0 or rect_height <= 0:
                continue
            x = _clamp_int(x, 0, max(width - 1, 0))
            y = _clamp_int(y, 0, max(height - 1, 0))
            rect_width = _clamp_int(rect_width, 1, max(width - x, 1))
            rect_height = _clamp_int(rect_height, 1, max(height - y, 1))
            sanitized_rectangles.append(
                {
                    "x": x,
                    "y": y,
                    "width": rect_width,
                    "height": rect_height,
                }
            )

    sanitized_polygons: list[dict[str, Any]] = []
    if isinstance(polygons_raw, list):
        for item in polygons_raw:
            if not isinstance(item, dict):
                continue
            points_raw = item.get("points")
            if not isinstance(points_raw, list):
                continue
            sanitized_points: list[dict[str, int]] = []
            for point in points_raw:
                if not isinstance(point, dict):
                    continue
                px = _clamp_int(_to_int(point.get("x"), 0), 0, max(width - 1, 0))
                py = _clamp_int(_to_int(point.get("y"), 0), 0, max(height - 1, 0))
                sanitized_points.append({"x": px, "y": py})
            if len(sanitized_points) >= 3:
                sanitized_polygons.append({"points": sanitized_points})

    sanitized_brush: list[dict[str, Any]] = []
    if isinstance(brush_raw, list):
        for item in brush_raw:
            if not isinstance(item, dict):
                continue
            points_raw = item.get("points")
            if not isinstance(points_raw, list):
                continue
            size = _clamp_float(_to_float(item.get("size"), 8.0) or 8.0, 1.0, 200.0)
            sanitized_points: list[dict[str, int]] = []
            for point in points_raw:
                if not isinstance(point, dict):
                    continue
                px = _clamp_int(_to_int(point.get("x"), 0), 0, max(width - 1, 0))
                py = _clamp_int(_to_int(point.get("y"), 0), 0, max(height - 1, 0))
                sanitized_points.append({"x": px, "y": py})
            if len(sanitized_points) > 0:
                sanitized_brush.append({"size": round(size, 3), "points": sanitized_points})

    return {
        "rectangles": sanitized_rectangles,
        "polygons": sanitized_polygons,
        "brush_strokes": sanitized_brush,
    }


def _apply_step3_exclude_mask(output: Image.Image, source: Image.Image, exclude_mask: Image.Image) -> Image.Image:
    output_l = output.convert("L")
    source_l = source.convert("L")
    if output_l.size != source_l.size:
        output_l = output_l.resize(source_l.size, Image.Resampling.BILINEAR)
    if exclude_mask.size != source_l.size:
        exclude_mask = exclude_mask.resize(source_l.size, Image.Resampling.NEAREST)
    return Image.composite(source_l, output_l, exclude_mask.convert("L")).convert("L")


def _resolve_step3_input_image_path(
    session: Session,
    run: Run,
    requested_input_artifact_id: str | None,
) -> tuple[str, str]:
    if requested_input_artifact_id:
        selected = session.get(StepArtifact, requested_input_artifact_id)
        if selected is None or selected.run_id != run.id or selected.step_id != 2:
            raise ValueError("선택한 2단계 산출물을 찾을 수 없습니다.")

        selected_path = _artifact_first_image_path(selected)
        if selected_path:
            selected_abs = storage_service.resolve(selected_path)
            if selected_abs.exists():
                return selected_path, selected.id
        raise ValueError("선택한 2단계 산출물에 이미지 파일이 없습니다.")

    latest_step2 = _latest_step_artifact(session, run.id, 2)
    latest_path = _artifact_first_image_path(latest_step2)
    if latest_step2 and latest_path:
        latest_abs = storage_service.resolve(latest_path)
        if latest_abs.exists():
            return latest_path, latest_step2.id

    raise ValueError("2단계를 먼저 완료해야 실행할 수 있습니다.")


def _build_step3_internal_params(normalized_params: dict[str, Any]) -> dict[str, Any]:
    method = str(normalized_params["method"])
    strength = float(normalized_params["strength"])
    edge_protect = float(normalized_params["edge_protect"])
    quality_mode = str(normalized_params["quality_mode"])

    strength_ratio = strength / 100.0
    edge_ratio = edge_protect / 100.0

    if method == "bilateral":
        sigma_space = 1.4 + (strength_ratio * 7.2)
        sigma_space *= 1.0 - (edge_ratio * 0.25)
        sigma_space = _clamp_float(sigma_space, 1.0, 8.5)

        sigma_color = 10.0 + (strength_ratio * 96.0)
        sigma_color *= 1.0 - (edge_ratio * 0.72)
        sigma_color = _clamp_float(sigma_color, 4.0, 110.0)

        base_radius = int(round(sigma_space * 1.8))
        if quality_mode == "빠름":
            radius = _clamp_int(base_radius, 1, 4)
        else:
            radius = _clamp_int(base_radius + 1, 2, 7)

        return {
            "sigma_space": round(sigma_space, 3),
            "sigma_color": round(sigma_color, 3),
            "radius": radius,
        }

    h = 2.0 + (strength_ratio * 30.0)
    h *= 1.0 - (edge_ratio * 0.75)
    h = _clamp_float(h, 1.0, 24.0)

    if quality_mode == "빠름":
        patch_radius = 1
        search_radius = _clamp_int(2 + int(round(strength_ratio * 2.5)), 2, 4)
    else:
        patch_radius = 2
        search_radius = _clamp_int(3 + int(round(strength_ratio * 3.5)), 3, 6)

    median_size = 3 + (2 * _clamp_int(int(round(h / 8.0)), 0, 3))
    blend_alpha = _clamp_float(h / 24.0, 0.08, 0.88)

    return {
        "h": round(h, 3),
        "patch_radius": patch_radius,
        "search_radius": search_radius,
        "median_size": median_size,
        "blend_alpha": round(blend_alpha, 3),
    }


def _apply_edge_preserve_composite(original: Image.Image, denoised: Image.Image, edge_protect: float) -> Image.Image:
    edge_image = original.filter(ImageFilter.FIND_EDGES)
    boost = 1.2 + (edge_protect / 60.0)
    threshold = 28.0 + ((100.0 - edge_protect) * 0.2)

    mask = edge_image.point(lambda value: 255 if (value * boost) >= threshold else int(_clamp_float(value * boost, 0, 255)))
    return Image.composite(original, denoised, mask)


def _apply_step3_bilateral_fallback(
    image: Image.Image,
    strength: float,
    edge_protect: float,
    quality_mode: str,
    internal: dict[str, Any],
) -> Image.Image:
    sigma_space = float(internal["sigma_space"])
    blur_radius = max(0.4, sigma_space * 0.6)
    alpha = _clamp_float((strength / 100.0) * 0.9, 0.05, 0.92)

    blurred = image.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    mixed = Image.blend(image, blurred, alpha)
    result = _apply_edge_preserve_composite(image, mixed, edge_protect)

    if quality_mode == "정확":
        second = result.filter(ImageFilter.GaussianBlur(radius=max(0.6, blur_radius * 0.9)))
        result = _apply_edge_preserve_composite(result, Image.blend(result, second, alpha * 0.65), edge_protect)

    return result.convert("L")


def _apply_step3_nlm_fallback(
    image: Image.Image,
    strength: float,
    edge_protect: float,
    quality_mode: str,
    internal: dict[str, Any],
) -> Image.Image:
    median_size = int(internal["median_size"])
    blend_alpha = float(internal["blend_alpha"])
    h_value = float(internal["h"])

    primary = image.filter(ImageFilter.MedianFilter(size=median_size))
    blur_radius = max(0.5, h_value / 11.0)
    primary = primary.filter(ImageFilter.BoxBlur(radius=blur_radius))
    mixed = Image.blend(image, primary, blend_alpha)
    result = _apply_edge_preserve_composite(image, mixed, edge_protect)

    if quality_mode == "정확":
        refine = result.filter(ImageFilter.MedianFilter(size=min(9, median_size + 2)))
        refine = refine.filter(ImageFilter.BoxBlur(radius=max(0.7, blur_radius * 1.1)))
        result = _apply_edge_preserve_composite(result, Image.blend(result, refine, min(0.95, blend_alpha * 0.7)), edge_protect)

    return result.convert("L")


def _prepare_step3_preview_source(image: Image.Image, quality_mode: str) -> tuple[Image.Image, float]:
    max_edge = 900 if quality_mode == "빠름" else 1200
    width, height = image.size
    long_edge = max(width, height)
    if long_edge <= max_edge:
        return image.copy(), 1.0

    scale = max_edge / long_edge
    resized = image.resize(
        (max(1, int(round(width * scale))), max(1, int(round(height * scale)))),
        Image.Resampling.BILINEAR,
    )
    return resized, scale


def _laplacian_variance(gray_bytes: bytes, width: int, height: int) -> float:
    if width < 3 or height < 3:
        return 0.0

    count = 0
    mean = 0.0
    m2 = 0.0
    for y in range(1, height - 1):
        row = y * width
        row_up = (y - 1) * width
        row_down = (y + 1) * width
        for x in range(1, width - 1):
            center = gray_bytes[row + x]
            lap = (4 * center) - gray_bytes[row + x - 1] - gray_bytes[row + x + 1] - gray_bytes[row_up + x] - gray_bytes[row_down + x]
            count += 1
            delta = lap - mean
            mean += delta / count
            m2 += delta * (lap - mean)

    if count <= 1:
        return 0.0
    return m2 / (count - 1)


def _sobel_mean(gray_bytes: bytes, width: int, height: int) -> float:
    if width < 3 or height < 3:
        return 0.0

    total = 0.0
    count = 0
    for y in range(1, height - 1):
        row = y * width
        row_up = (y - 1) * width
        row_down = (y + 1) * width
        for x in range(1, width - 1):
            gx = (
                gray_bytes[row_up + x + 1]
                + (2 * gray_bytes[row + x + 1])
                + gray_bytes[row_down + x + 1]
                - gray_bytes[row_up + x - 1]
                - (2 * gray_bytes[row + x - 1])
                - gray_bytes[row_down + x - 1]
            )
            gy = (
                gray_bytes[row_down + x - 1]
                + (2 * gray_bytes[row_down + x])
                + gray_bytes[row_down + x + 1]
                - gray_bytes[row_up + x - 1]
                - (2 * gray_bytes[row_up + x])
                - gray_bytes[row_up + x + 1]
            )
            total += math.sqrt((gx * gx) + (gy * gy))
            count += 1

    if count == 0:
        return 0.0
    return total / count


def _step3_qc_labels(noise_reduction_pct: float, edge_preserve_pct: float) -> tuple[str, str]:
    if noise_reduction_pct >= 35.0:
        noise_label = "높음"
    elif noise_reduction_pct >= 15.0:
        noise_label = "보통"
    else:
        noise_label = "낮음"

    edge_label = "양호" if edge_preserve_pct >= 80.0 else "주의"
    return noise_label, edge_label


def _compute_step3_qc(source: Image.Image, output: Image.Image) -> dict[str, Any]:
    source_l = source.convert("L")
    output_l = output.convert("L")
    if output_l.size != source_l.size:
        output_l = output_l.resize(source_l.size, Image.Resampling.BILINEAR)

    width, height = source_l.size
    source_bytes = source_l.tobytes()
    output_bytes = output_l.tobytes()

    lap_before = _laplacian_variance(source_bytes, width, height)
    lap_after = _laplacian_variance(output_bytes, width, height)
    sobel_before = _sobel_mean(source_bytes, width, height)
    sobel_after = _sobel_mean(output_bytes, width, height)

    if lap_before > 1e-8:
        noise_reduction_pct = ((lap_before - lap_after) / lap_before) * 100.0
    else:
        noise_reduction_pct = 0.0

    if sobel_before > 1e-8:
        edge_preserve_pct = (sobel_after / sobel_before) * 100.0
    else:
        edge_preserve_pct = 100.0

    noise_reduction_pct = _clamp_float(noise_reduction_pct, -100.0, 100.0)
    edge_preserve_pct = _clamp_float(edge_preserve_pct, 0.0, 200.0)
    noise_label, edge_label = _step3_qc_labels(noise_reduction_pct, edge_preserve_pct)

    return {
        "noise_reduction_pct": round(noise_reduction_pct, 2),
        "edge_preserve_pct": round(edge_preserve_pct, 2),
        "noise_reduction_level": noise_label,
        "edge_preserve_level": edge_label,
        "laplacian_variance_before": round(lap_before, 4),
        "laplacian_variance_after": round(lap_after, 4),
        "sobel_mean_before": round(sobel_before, 4),
        "sobel_mean_after": round(sobel_after, 4),
    }


def _apply_step3_pipeline(
    source: Image.Image,
    normalized_params: dict[str, Any],
    *,
    preview: bool,
) -> tuple[Image.Image, dict[str, Any], dict[str, Any]]:
    source_gray = source.convert("L")
    working_source = source_gray
    preview_scale = 1.0
    if preview:
        working_source, preview_scale = _prepare_step3_preview_source(source_gray, str(normalized_params["quality_mode"]))

    method = str(normalized_params["method"])
    strength = float(normalized_params["strength"])
    edge_protect = float(normalized_params["edge_protect"])
    quality_mode = str(normalized_params["quality_mode"])

    internal = _build_step3_internal_params(normalized_params)
    if method == "bilateral":
        output = _apply_step3_bilateral_fallback(working_source, strength, edge_protect, quality_mode, internal)
    else:
        output = _apply_step3_nlm_fallback(working_source, strength, edge_protect, quality_mode, internal)

    if preview and preview_scale != 1.0:
        output = output.resize(source_gray.size, Image.Resampling.BILINEAR)

    qc = _compute_step3_qc(source_gray, output)
    internal_payload = dict(internal)
    internal_payload["preview_scale"] = round(preview_scale, 5)

    return output.convert("L"), internal_payload, qc


def create_step3_preview_png(
    session: Session,
    run: Run,
    params: dict[str, Any],
) -> bytes:
    image = session.get(ImageAsset, run.image_id)
    if image is None:
        raise LookupError("원본 이미지를 찾을 수 없습니다.")

    _validate_step_prerequisite(session, run.id, 3)
    normalized_params = _normalize_step3_params(params)
    source_rel_path, _ = _resolve_step3_input_image_path(session, run, normalized_params["input_artifact_id"])
    source_abs_path = storage_service.resolve(source_rel_path)

    with Image.open(source_abs_path) as source_image:
        source_gray = source_image.convert("L")
        exclude_mask = _normalize_step3_exclude_mask(
            normalized_params.get("exclude_mask"),
            source_gray.size[0],
            source_gray.size[1],
        )
        preview_image, _, _ = _apply_step3_pipeline(source_gray, normalized_params, preview=True)
        preview_image = _apply_step3_exclude_mask(preview_image, source_gray, exclude_mask)

    buffer = BytesIO()
    preview_image.save(buffer, format="PNG")
    return buffer.getvalue()


def _normalize_step4_params(params: dict[str, Any]) -> dict[str, Any]:
    mode_raw = str(params.get("mode", "structure")).strip().lower()
    mode_map = {
        "structure": "structure",
        "구조 기반 이진화(추천)": "structure",
        "구조 기반 이진화": "structure",
        "구조 기반": "structure",
        "simple": "simple",
        "단순 임계값(디버그)": "simple",
        "단순 임계값": "simple",
    }
    mode = mode_map.get(mode_raw)
    if mode is None:
        raise ValueError("4단계 모드는 구조 기반 또는 단순 임계값만 지원합니다.")

    preview_layer_raw = str(params.get("preview_layer", "mask")).strip().lower()
    preview_layer_map = {
        "seed": "seed",
        "candidate": "candidate",
        "mask": "mask",
        "mask_binary": "mask_binary",
        "최종 마스크": "mask",
        "최종 마스크(흑백)": "mask_binary",
        "흑백": "mask_binary",
    }
    preview_layer = preview_layer_map.get(preview_layer_raw, "mask")

    input_artifact_id = params.get("input_artifact_id")
    normalized_input_artifact_id: str | None = None
    if isinstance(input_artifact_id, str) and input_artifact_id.strip():
        normalized_input_artifact_id = input_artifact_id.strip()

    return {
        "mode": mode,
        "seed_sensitivity": _clamp_float(_to_float(params.get("seed_sensitivity"), 50.0) or 50.0, 0.0, 100.0),
        "candidate_sensitivity": _clamp_float(
            _to_float(params.get("candidate_sensitivity"), 50.0) or 50.0,
            0.0,
            100.0,
        ),
        "structure_scale_um": _clamp_float(_to_float(params.get("structure_scale_um"), 1.0) or 1.0, 0.05, 1000.0),
        "min_area_um2": _clamp_float(_to_float(params.get("min_area_um2"), 0.1) or 0.1, 0.0001, 1_000_000.0),
        "preview_layer": preview_layer,
        "input_artifact_id": normalized_input_artifact_id,
    }


def _resolve_step4_input_image_path(
    session: Session,
    run: Run,
    requested_input_artifact_id: str | None,
) -> tuple[str, str]:
    if requested_input_artifact_id:
        selected = session.get(StepArtifact, requested_input_artifact_id)
        if selected is None or selected.run_id != run.id or selected.step_id != 3:
            raise ValueError("선택한 3단계 산출물을 찾을 수 없습니다.")
        selected_path = _artifact_first_image_path(selected)
        if selected_path:
            selected_abs = storage_service.resolve(selected_path)
            if selected_abs.exists():
                return selected_path, selected.id
        raise ValueError("선택한 3단계 산출물에 이미지 파일이 없습니다.")

    latest_step3 = _latest_step_artifact(session, run.id, 3)
    latest_path = _artifact_first_image_path(latest_step3)
    if latest_step3 and latest_path:
        latest_abs = storage_service.resolve(latest_path)
        if latest_abs.exists():
            return latest_path, latest_step3.id

    raise ValueError("3단계를 먼저 완료해야 실행할 수 있습니다.")


def _resolve_um_per_px(session: Session, run: Run) -> float:
    latest_step1 = _latest_step_artifact(session, run.id, 1)
    if latest_step1 is None:
        raise ValueError("1단계 스케일 보정 정보를 찾을 수 없습니다.")
    params = _safe_json_loads(latest_step1.params_json, {})
    if not isinstance(params, dict):
        raise ValueError("1단계 스케일 보정 정보를 읽을 수 없습니다.")
    um_per_px = _to_float(params.get("um_per_px"))
    if um_per_px is None or um_per_px <= 0:
        raise ValueError("1단계 스케일 보정 값을 확인할 수 없습니다.")
    return um_per_px


def _prepare_step4_preview_source(image: Image.Image) -> tuple[Image.Image, float]:
    width, height = image.size
    max_edge = 1200
    long_edge = max(width, height)
    if long_edge <= max_edge:
        return image.copy(), 1.0
    scale = max_edge / long_edge
    resized = image.resize(
        (max(1, int(round(width * scale))), max(1, int(round(height * scale)))),
        Image.Resampling.BILINEAR,
    )
    return resized, scale


def _otsu_threshold(gray_bytes: bytes) -> int:
    histogram = [0] * 256
    for value in gray_bytes:
        histogram[value] += 1

    total = len(gray_bytes)
    if total == 0:
        return 0

    sum_total = 0.0
    for index in range(256):
        sum_total += index * histogram[index]

    weight_bg = 0
    sum_bg = 0.0
    max_variance = -1.0
    threshold = 0

    for index in range(256):
        weight_bg += histogram[index]
        if weight_bg == 0:
            continue
        weight_fg = total - weight_bg
        if weight_fg == 0:
            break

        sum_bg += index * histogram[index]
        mean_bg = sum_bg / weight_bg
        mean_fg = (sum_total - sum_bg) / weight_fg
        variance = weight_bg * weight_fg * ((mean_bg - mean_fg) ** 2)
        if variance > max_variance:
            max_variance = variance
            threshold = index

    return threshold


def _binary_image_to_mask(image: Image.Image) -> bytearray:
    return bytearray(1 if value >= 128 else 0 for value in image.convert("L").tobytes())


def _mask_to_binary_image(mask: bytearray, width: int, height: int) -> Image.Image:
    data = bytes(255 if value else 0 for value in mask)
    return Image.frombytes("L", (width, height), data)


def _resize_mask(mask: bytearray, width: int, height: int, target_width: int, target_height: int) -> bytearray:
    if width == target_width and height == target_height:
        return bytearray(mask)
    image = _mask_to_binary_image(mask, width, height)
    resized = image.resize((target_width, target_height), Image.Resampling.NEAREST)
    return _binary_image_to_mask(resized)


def _compute_sobel_magnitude(gray_bytes: bytes, width: int, height: int) -> list[float]:
    gradient = [0.0] * (width * height)
    if width < 3 or height < 3:
        return gradient

    for y in range(1, height - 1):
        row = y * width
        row_up = (y - 1) * width
        row_down = (y + 1) * width
        for x in range(1, width - 1):
            gx = (
                gray_bytes[row_up + x + 1]
                + (2 * gray_bytes[row + x + 1])
                + gray_bytes[row_down + x + 1]
                - gray_bytes[row_up + x - 1]
                - (2 * gray_bytes[row + x - 1])
                - gray_bytes[row_down + x - 1]
            )
            gy = (
                gray_bytes[row_down + x - 1]
                + (2 * gray_bytes[row_down + x])
                + gray_bytes[row_down + x + 1]
                - gray_bytes[row_up + x - 1]
                - (2 * gray_bytes[row_up + x])
                - gray_bytes[row_up + x + 1]
            )
            gradient[row + x] = math.sqrt((gx * gx) + (gy * gy)) / 8.0

    return gradient


def _reconstruct_seed_within_candidate(seed: bytearray, candidate: bytearray, width: int, height: int) -> bytearray:
    total = width * height
    result = bytearray(total)
    queue: deque[int] = deque()

    for index in range(total):
        if seed[index] and candidate[index]:
            result[index] = 1
            queue.append(index)

    while queue:
        index = queue.popleft()
        x = index % width
        y = index // width

        for ny in range(max(0, y - 1), min(height, y + 2)):
            row = ny * width
            for nx in range(max(0, x - 1), min(width, x + 2)):
                neighbor = row + nx
                if result[neighbor] or candidate[neighbor] == 0:
                    continue
                result[neighbor] = 1
                queue.append(neighbor)

    return result


def _remove_small_objects(mask: bytearray, width: int, height: int, min_area_px: int) -> bytearray:
    if min_area_px <= 1:
        return bytearray(mask)

    total = width * height
    visited = bytearray(total)
    output = bytearray(total)

    for index in range(total):
        if visited[index] or mask[index] == 0:
            continue

        component: list[int] = []
        queue: deque[int] = deque([index])
        visited[index] = 1

        while queue:
            current = queue.popleft()
            component.append(current)
            x = current % width
            y = current // width

            for ny in range(max(0, y - 1), min(height, y + 2)):
                row = ny * width
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    neighbor = row + nx
                    if visited[neighbor] or mask[neighbor] == 0:
                        continue
                    visited[neighbor] = 1
                    queue.append(neighbor)

        if len(component) >= min_area_px:
            for keep_index in component:
                output[keep_index] = 1

    return output


def _compute_boundary_complexity(mask: bytearray, width: int, height: int) -> float:
    area = sum(mask)
    if area == 0:
        return 0.0

    perimeter = 0
    for y in range(height):
        row = y * width
        for x in range(width):
            index = row + x
            if mask[index] == 0:
                continue
            if x == 0 or mask[index - 1] == 0:
                perimeter += 1
            if x == width - 1 or mask[index + 1] == 0:
                perimeter += 1
            if y == 0 or mask[index - width] == 0:
                perimeter += 1
            if y == height - 1 or mask[index + width] == 0:
                perimeter += 1

    return perimeter / max(math.sqrt(area), 1.0)


def _compute_step4_qc(seed_mask: bytearray, final_mask: bytearray, width: int, height: int) -> dict[str, Any]:
    total = max(width * height, 1)
    seed_count = int(sum(seed_mask))
    final_count = int(sum(final_mask))
    area_ratio_pct = (final_count / total) * 100.0
    expansion_ratio = final_count / max(seed_count, 1)
    boundary_complexity = _compute_boundary_complexity(final_mask, width, height)
    return {
        "mask_area_ratio_pct": round(area_ratio_pct, 3),
        "seed_to_final_expansion_ratio": round(expansion_ratio, 4),
        "boundary_complexity": round(boundary_complexity, 4),
    }


def _create_overlay_image(mask: bytearray, width: int, height: int, preview_layer: str) -> Image.Image:
    color_map: dict[str, tuple[int, int, int, int]] = {
        "seed": (40, 170, 255, 190),
        "candidate": (255, 166, 0, 190),
        "mask": (16, 185, 129, 200),
    }
    red, green, blue, alpha = color_map.get(preview_layer, color_map["mask"])
    rgba = bytearray(width * height * 4)
    for index, value in enumerate(mask):
        if value == 0:
            continue
        base = index * 4
        rgba[base] = red
        rgba[base + 1] = green
        rgba[base + 2] = blue
        rgba[base + 3] = alpha
    return Image.frombytes("RGBA", (width, height), bytes(rgba))


def _run_step4_pipeline(
    source: Image.Image,
    normalized_params: dict[str, Any],
    um_per_px: float,
    exclude_mask_image: Image.Image | None,
    *,
    preview: bool,
) -> tuple[dict[str, bytearray], dict[str, Any], dict[str, Any], int, int]:
    original = source.convert("L")
    target_width, target_height = original.size
    exclude_mask_target: bytearray | None = None
    if exclude_mask_image is not None:
        normalized_exclude = exclude_mask_image.convert("L")
        if normalized_exclude.size != (target_width, target_height):
            normalized_exclude = normalized_exclude.resize((target_width, target_height), Image.Resampling.NEAREST)
        normalized_exclude = normalized_exclude.point(lambda value: 255 if value >= 128 else 0)
        exclude_mask_target = _binary_image_to_mask(normalized_exclude)

    working = original
    preview_scale = 1.0
    if preview:
        working, preview_scale = _prepare_step4_preview_source(original)

    width, height = working.size
    gray_bytes = working.tobytes()
    otsu_threshold = _otsu_threshold(gray_bytes)

    seed_sensitivity = float(normalized_params["seed_sensitivity"])
    candidate_sensitivity = float(normalized_params["candidate_sensitivity"])
    structure_scale_um = float(normalized_params["structure_scale_um"])
    min_area_um2 = float(normalized_params["min_area_um2"])

    seed_offset = int(round(((50.0 - seed_sensitivity) / 50.0) * 26.0))
    threshold_seed = _clamp_int(otsu_threshold + seed_offset, 0, 255)
    threshold_candidate = _clamp_int(
        otsu_threshold + int(round(((50.0 - candidate_sensitivity) / 50.0) * 34.0)),
        0,
        255,
    )

    structure_px = _clamp_float(structure_scale_um / um_per_px, 0.5, 256.0)
    sigma = _clamp_float(structure_px * 0.45, 0.6, 12.0)

    total = width * height
    seed_mask = bytearray(total)
    candidate_mask = bytearray(total)

    if normalized_params["mode"] == "simple":
        simple_threshold = _clamp_int(otsu_threshold + int(round(((50.0 - seed_sensitivity) / 50.0) * 22.0)), 0, 255)
        for index in range(total):
            if gray_bytes[index] > simple_threshold:
                seed_mask[index] = 1
                candidate_mask[index] = 1
        gradient_threshold = 0.0
        contrast_threshold = 0.0
    else:
        blurred_bytes = working.filter(ImageFilter.GaussianBlur(radius=sigma)).tobytes()
        gradient = _compute_sobel_magnitude(gray_bytes, width, height)
        gradient_threshold = 12.0 + ((100.0 - candidate_sensitivity) * 0.28)
        contrast_threshold = 4.0 + ((100.0 - candidate_sensitivity) * 0.20)

        for index in range(total):
            pixel = gray_bytes[index]
            if pixel > threshold_seed:
                seed_mask[index] = 1

            local_contrast = max(0, pixel - blurred_bytes[index])
            is_candidate = pixel > threshold_candidate and (
                gradient[index] > gradient_threshold or local_contrast > contrast_threshold
            )
            if is_candidate or seed_mask[index]:
                candidate_mask[index] = 1

    reconstructed = _reconstruct_seed_within_candidate(seed_mask, candidate_mask, width, height)

    min_area_px = max(1, int(round(min_area_um2 / max((um_per_px * um_per_px), 1e-8))))
    final_mask = _remove_small_objects(reconstructed, width, height, min_area_px)

    if preview_scale != 1.0 and (width != target_width or height != target_height):
        seed_mask = _resize_mask(seed_mask, width, height, target_width, target_height)
        candidate_mask = _resize_mask(candidate_mask, width, height, target_width, target_height)
        final_mask = _resize_mask(final_mask, width, height, target_width, target_height)
        width = target_width
        height = target_height

    exclude_applied_px = 0
    if exclude_mask_target is not None and len(exclude_mask_target) == (width * height):
        for index, excluded in enumerate(exclude_mask_target):
            if excluded == 0:
                continue
            exclude_applied_px += 1
            candidate_mask[index] = 0
            final_mask[index] = 0

    qc = _compute_step4_qc(seed_mask, final_mask, width, height)
    internal = {
        "otsu_threshold": otsu_threshold,
        "threshold_seed": threshold_seed,
        "threshold_candidate": threshold_candidate,
        "gradient_threshold": round(gradient_threshold, 4),
        "contrast_threshold": round(contrast_threshold, 4),
        "structure_scale_px": round(structure_px, 4),
        "gaussian_sigma": round(sigma, 4),
        "min_area_px": min_area_px,
        "preview_scale": round(preview_scale, 5),
        "exclude_applied_px": exclude_applied_px,
    }

    masks = {
        "seed": seed_mask,
        "candidate": candidate_mask,
        "mask": final_mask,
    }
    return masks, internal, qc, width, height


def create_step4_preview_png(
    session: Session,
    run: Run,
    params: dict[str, Any],
) -> bytes:
    image = session.get(ImageAsset, run.image_id)
    if image is None:
        raise LookupError("원본 이미지를 찾을 수 없습니다.")

    _validate_step_prerequisite(session, run.id, 4)
    normalized_params = _normalize_step4_params(params)
    source_rel_path, input_artifact_id = _resolve_step4_input_image_path(session, run, normalized_params["input_artifact_id"])
    source_abs_path = storage_service.resolve(source_rel_path)
    um_per_px = _resolve_um_per_px(session, run)
    exclude_mask_image = _load_step3_exclude_mask_image(session, input_artifact_id)

    with Image.open(source_abs_path) as source_image:
        masks, _, _, width, height = _run_step4_pipeline(
            source_image,
            normalized_params,
            um_per_px,
            exclude_mask_image,
            preview=True,
        )

    preview_layer = str(normalized_params["preview_layer"])
    mask_layer = "mask" if preview_layer == "mask_binary" else preview_layer
    preview_mask = masks[mask_layer]
    if preview_layer == "mask_binary":
        preview_image = _mask_to_binary_image(preview_mask, width, height)
    else:
        preview_image = _create_overlay_image(preview_mask, width, height, preview_layer)
    buffer = BytesIO()
    preview_image.save(buffer, format="PNG")
    return buffer.getvalue()


def _normalize_step5_params(params: dict[str, Any]) -> dict[str, Any]:
    base_mask_artifact_id = params.get("base_mask_artifact_id")
    normalized_base_mask_artifact_id: str | None = None
    if isinstance(base_mask_artifact_id, str) and base_mask_artifact_id.strip():
        normalized_base_mask_artifact_id = base_mask_artifact_id.strip()

    mask_raw = params.get("edited_mask_png_base64")
    if not isinstance(mask_raw, str) or not mask_raw.strip():
        raise ValueError("편집된 마스크 데이터가 비어 있습니다.")

    brush_mode_raw = params.get("brush_mode")
    brush_mode_map = {
        "삭제": "삭제",
        "복원": "복원",
        "delete": "삭제",
        "erase": "삭제",
        "restore": "복원",
    }
    brush_mode: str | None = None
    if isinstance(brush_mode_raw, str) and brush_mode_raw.strip():
        mapped = brush_mode_map.get(brush_mode_raw.strip().lower(), None)
        if mapped is None:
            mapped = brush_mode_map.get(brush_mode_raw.strip(), None)
        brush_mode = mapped if mapped in {"삭제", "복원"} else None

    brush_size_px = _to_int(params.get("brush_size_px"), 0)
    normalized_brush_size_px: int | None = None
    if brush_size_px > 0:
        normalized_brush_size_px = _clamp_int(brush_size_px, 1, 300)

    return {
        "base_mask_artifact_id": normalized_base_mask_artifact_id,
        "edited_mask_png_base64": mask_raw.strip(),
        "brush_mode": brush_mode,
        "brush_size_px": normalized_brush_size_px,
    }


def _resolve_step5_base_mask_path(
    session: Session,
    run: Run,
    requested_base_mask_artifact_id: str | None,
) -> tuple[str, str]:
    if requested_base_mask_artifact_id:
        selected = session.get(StepArtifact, requested_base_mask_artifact_id)
        if selected is None or selected.run_id != run.id or selected.step_id != 4:
            raise ValueError("선택한 4단계 마스크 산출물을 찾을 수 없습니다.")
        selected_path = _artifact_first_image_path(selected)
        if selected_path:
            selected_abs = storage_service.resolve(selected_path)
            if selected_abs.exists():
                return selected_path, selected.id
        raise ValueError("선택한 4단계 산출물에 마스크 이미지가 없습니다.")

    latest_step4 = _latest_step_artifact(session, run.id, 4)
    latest_path = _artifact_first_image_path(latest_step4)
    if latest_step4 and latest_path:
        latest_abs = storage_service.resolve(latest_path)
        if latest_abs.exists():
            return latest_path, latest_step4.id

    raise ValueError("4단계를 먼저 완료해야 실행할 수 있습니다.")


def _normalize_step5_edited_mask(mask_raw: str, width: int, height: int) -> Image.Image:
    decoded = _decode_base64_image_bytes(mask_raw)
    try:
        with Image.open(BytesIO(decoded)) as loaded:
            mask = loaded.convert("L")
            if mask.size != (width, height):
                raise ValueError("편집 마스크 크기가 기준 마스크와 일치하지 않습니다.")
            binary = mask.point(lambda value: 255 if value > 0 else 0)
            unique_values = set(binary.getdata())
            if not unique_values.issubset({0, 255}):
                raise ValueError("편집 마스크는 0 또는 255 값만 포함해야 합니다.")
            return binary
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("편집 마스크를 이미지로 해석할 수 없습니다.") from exc


def _normalize_step6_params(params: dict[str, Any]) -> dict[str, Any]:
    base_mask_artifact_id = params.get("base_mask_artifact_id")
    normalized_base_mask_artifact_id: str | None = None
    if isinstance(base_mask_artifact_id, str) and base_mask_artifact_id.strip():
        normalized_base_mask_artifact_id = base_mask_artifact_id.strip()

    return {
        "base_mask_artifact_id": normalized_base_mask_artifact_id,
        "max_expand_um": _clamp_float(_to_float(params.get("max_expand_um"), 1.0) or 1.0, 0.0, 10.0),
        "recover_sensitivity": _clamp_float(
            _to_float(params.get("recover_sensitivity"), 50.0) or 50.0,
            0.0,
            100.0,
        ),
        "edge_protect": _clamp_float(_to_float(params.get("edge_protect"), 60.0) or 60.0, 0.0, 100.0),
        "fill_small_holes": _to_bool(params.get("fill_small_holes"), True),
    }


def _resolve_step6_base_inputs(
    session: Session,
    run: Run,
    requested_base_mask_artifact_id: str | None,
) -> tuple[str, str, str, str | None]:
    step5_artifact: StepArtifact | None = None
    if requested_base_mask_artifact_id:
        selected = session.get(StepArtifact, requested_base_mask_artifact_id)
        if selected is None or selected.run_id != run.id or selected.step_id != 5:
            raise ValueError("선택한 5단계 마스크 산출물을 찾을 수 없습니다.")
        step5_artifact = selected
    else:
        step5_artifact = _latest_step_artifact(session, run.id, 5)
        if step5_artifact is None:
            raise ValueError("5단계를 먼저 완료해야 실행할 수 있습니다.")

    step5_mask_rel_path = _artifact_first_image_path(step5_artifact)
    if not step5_mask_rel_path:
        raise ValueError("선택한 5단계 산출물에 마스크 이미지가 없습니다.")
    step5_mask_abs_path = storage_service.resolve(step5_mask_rel_path)
    if not step5_mask_abs_path.exists():
        raise ValueError("선택한 5단계 마스크 파일을 찾을 수 없습니다.")

    step3_image_rel_path: str | None = None
    step3_artifact_id: str | None = None

    step5_params = _safe_json_loads(step5_artifact.params_json, {})
    if isinstance(step5_params, dict):
        step4_artifact_id = step5_params.get("base_mask_artifact_id")
        if isinstance(step4_artifact_id, str) and step4_artifact_id.strip():
            step4_artifact = session.get(StepArtifact, step4_artifact_id.strip())
            if step4_artifact is not None and step4_artifact.run_id == run.id and step4_artifact.step_id == 4:
                step4_params = _safe_json_loads(step4_artifact.params_json, {})
                if isinstance(step4_params, dict):
                    candidate_step3_id = step4_params.get("input_artifact_id")
                    if isinstance(candidate_step3_id, str) and candidate_step3_id.strip():
                        step3_artifact = session.get(StepArtifact, candidate_step3_id.strip())
                        if step3_artifact is not None and step3_artifact.run_id == run.id and step3_artifact.step_id == 3:
                            candidate_path = _artifact_first_image_path(step3_artifact)
                            if candidate_path:
                                candidate_abs = storage_service.resolve(candidate_path)
                                if candidate_abs.exists():
                                    step3_image_rel_path = candidate_path
                                    step3_artifact_id = step3_artifact.id

    if step3_image_rel_path is None:
        latest_step3 = _latest_step_artifact(session, run.id, 3)
        latest_step3_path = _artifact_first_image_path(latest_step3)
        if latest_step3 and latest_step3_path:
            latest_step3_abs = storage_service.resolve(latest_step3_path)
            if latest_step3_abs.exists():
                step3_image_rel_path = latest_step3_path
                step3_artifact_id = latest_step3.id

    if step3_image_rel_path is None:
        raise ValueError("3단계 결과 이미지를 찾을 수 없습니다.")

    return step5_mask_rel_path, step5_artifact.id, step3_image_rel_path, step3_artifact_id


def _cityblock_distance_from_mask(mask: bytearray, width: int, height: int) -> list[int]:
    inf = width + height + 5
    dist = [0 if value else inf for value in mask]

    for y in range(height):
        row = y * width
        for x in range(width):
            index = row + x
            if dist[index] == 0:
                continue
            best = dist[index]
            if x > 0:
                best = min(best, dist[index - 1] + 1)
            if y > 0:
                best = min(best, dist[index - width] + 1)
            dist[index] = best

    for y in range(height - 1, -1, -1):
        row = y * width
        for x in range(width - 1, -1, -1):
            index = row + x
            if dist[index] == 0:
                continue
            best = dist[index]
            if x + 1 < width:
                best = min(best, dist[index + 1] + 1)
            if y + 1 < height:
                best = min(best, dist[index + width] + 1)
            dist[index] = best

    return dist


def _compute_step6_intensity_stats(gray_bytes: bytes, base_mask: bytearray) -> tuple[float, float, int]:
    count = 0
    total = 0.0
    total_sq = 0.0
    for index, selected in enumerate(base_mask):
        if selected == 0:
            continue
        value = gray_bytes[index]
        count += 1
        total += value
        total_sq += value * value

    if count == 0:
        raise ValueError("5단계 마스크에 입자 영역이 없어 구출을 진행할 수 없습니다.")

    mean = total / count
    variance = max((total_sq / count) - (mean * mean), 0.0)
    sigma = max(math.sqrt(variance), 1.0)
    return mean, sigma, count


def _fill_small_holes(mask: bytearray, width: int, height: int, max_hole_area: int) -> bytearray:
    if max_hole_area <= 0:
        return bytearray(mask)

    total = width * height
    output = bytearray(mask)
    visited = bytearray(total)

    for index in range(total):
        if visited[index] or output[index] != 0:
            continue

        component: list[int] = []
        queue: deque[int] = deque([index])
        visited[index] = 1
        touches_border = False

        while queue:
            current = queue.popleft()
            component.append(current)
            x = current % width
            y = current // width
            if x == 0 or y == 0 or x == width - 1 or y == height - 1:
                touches_border = True

            for ny in range(max(0, y - 1), min(height, y + 2)):
                row = ny * width
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    neighbor = row + nx
                    if visited[neighbor] or output[neighbor] != 0:
                        continue
                    visited[neighbor] = 1
                    queue.append(neighbor)

        if touches_border:
            continue
        if len(component) > max_hole_area:
            continue
        for fill_index in component:
            output[fill_index] = 1

    return output


def _run_step6_pipeline(
    source_gray: Image.Image,
    base_mask_image: Image.Image,
    normalized_params: dict[str, Any],
    um_per_px: float,
) -> tuple[Image.Image, dict[str, Any], dict[str, Any]]:
    grayscale = source_gray.convert("L")
    mask_gray = base_mask_image.convert("L")
    if mask_gray.size != grayscale.size:
        mask_gray = mask_gray.resize(grayscale.size, Image.Resampling.NEAREST)
    mask_gray = mask_gray.point(lambda value: 255 if value > 0 else 0)

    width, height = grayscale.size
    total = width * height
    gray_bytes = grayscale.tobytes()
    base_mask = _binary_image_to_mask(mask_gray)

    mean, sigma, particle_count = _compute_step6_intensity_stats(gray_bytes, base_mask)

    max_expand_um = float(normalized_params["max_expand_um"])
    recover_sensitivity = float(normalized_params["recover_sensitivity"])
    edge_protect = float(normalized_params["edge_protect"])
    fill_small_holes = bool(normalized_params["fill_small_holes"])

    max_expand_px_unclamped = max_expand_um / max(um_per_px, 1e-8)
    max_expand_px = _clamp_int(int(round(max_expand_px_unclamped)), 0, 512)

    sensitivity_ratio = recover_sensitivity / 100.0
    k_sigma = _clamp_float(2.3 - (sensitivity_ratio * 1.8), 0.5, 2.3)
    intensity_threshold = _clamp_float(mean - (k_sigma * sigma), 0.0, 255.0)

    gradient = _compute_sobel_magnitude(gray_bytes, width, height)
    base_gradient_sum = 0.0
    for index, selected in enumerate(base_mask):
        if selected:
            base_gradient_sum += gradient[index]
    mean_gradient_on_mask = base_gradient_sum / max(particle_count, 1)

    edge_ratio = edge_protect / 100.0
    grad_max = (mean_gradient_on_mask * (2.2 - (edge_ratio * 1.4))) + (18.0 - (edge_ratio * 10.0))
    grad_max = _clamp_float(grad_max, 4.0, 220.0)

    distance_from_mask = _cityblock_distance_from_mask(base_mask, width, height)
    recovered_mask = bytearray(base_mask)
    accepted_growth = 0

    if max_expand_px > 0:
        for index in range(total):
            if recovered_mask[index]:
                continue
            if distance_from_mask[index] > max_expand_px:
                continue
            if gray_bytes[index] < intensity_threshold:
                continue
            if gradient[index] > grad_max:
                continue
            recovered_mask[index] = 1
            accepted_growth += 1

    if fill_small_holes:
        max_hole_area = _clamp_int(int(round(((max_expand_px + 1) ** 2) * 0.4)), 4, 4000)
        recovered_mask = _fill_small_holes(recovered_mask, width, height, max_hole_area)
    else:
        max_hole_area = 0

    min_object_area = 1 if max_expand_px <= 2 else _clamp_int(int(round(max_expand_px * 0.8)), 1, 36)
    recovered_mask = _remove_small_objects(recovered_mask, width, height, min_object_area)
    recovered_mask = bytearray(1 if value else 0 for value in recovered_mask)

    output = _mask_to_binary_image(recovered_mask, width, height)
    unique_values = sorted({int(pixel) for pixel in set(output.getdata())})

    base_area = int(sum(base_mask))
    final_area = int(sum(recovered_mask))
    qc_payload = {
        "base_area_px": base_area,
        "recovered_area_px": final_area,
        "expanded_area_px": max(0, final_area - base_area),
        "expansion_ratio": round(final_area / max(base_area, 1), 5),
        "mask_area_ratio_pct": round((final_area / max(total, 1)) * 100.0, 4),
    }

    internal = {
        "um_per_px": round(um_per_px, 8),
        "max_expand_px": max_expand_px,
        "max_expand_px_unclamped": round(max_expand_px_unclamped, 6),
        "particle_mean": round(mean, 6),
        "particle_sigma": round(sigma, 6),
        "k_sigma": round(k_sigma, 6),
        "intensity_threshold": round(intensity_threshold, 6),
        "mean_gradient_on_mask": round(mean_gradient_on_mask, 6),
        "gradient_max": round(grad_max, 6),
        "accepted_growth_px": accepted_growth,
        "fill_small_holes_applied": fill_small_holes,
        "max_hole_area_px": max_hole_area,
        "min_object_area_px": min_object_area,
        "mask_unique_values": unique_values,
    }

    return output, internal, qc_payload


def create_step6_preview_png(
    session: Session,
    run: Run,
    params: dict[str, Any],
) -> bytes:
    image = session.get(ImageAsset, run.image_id)
    if image is None:
        raise LookupError("원본 이미지를 찾을 수 없습니다.")

    _validate_step_prerequisite(session, run.id, 6)
    normalized_params = _normalize_step6_params(params)
    base_mask_rel_path, _, source_rel_path, _ = _resolve_step6_base_inputs(
        session,
        run,
        normalized_params["base_mask_artifact_id"],
    )
    base_mask_abs_path = storage_service.resolve(base_mask_rel_path)
    source_abs_path = storage_service.resolve(source_rel_path)
    um_per_px = _resolve_um_per_px(session, run)

    with Image.open(source_abs_path) as source_image, Image.open(base_mask_abs_path) as base_mask_image:
        preview_image, _, _ = _run_step6_pipeline(
            source_image.convert("L"),
            base_mask_image.convert("L"),
            normalized_params,
            um_per_px,
        )

    buffer = BytesIO()
    preview_image.save(buffer, format="PNG")
    return buffer.getvalue()


def _normalize_step7_params(params: dict[str, Any]) -> dict[str, Any]:
    base_mask_artifact_id = params.get("base_mask_artifact_id")
    normalized_base_mask_artifact_id: str | None = None
    if isinstance(base_mask_artifact_id, str) and base_mask_artifact_id.strip():
        normalized_base_mask_artifact_id = base_mask_artifact_id.strip()

    hole_mode_raw = str(params.get("hole_mode", "fill_all")).strip().lower()
    hole_mode_map = {
        "fill_all": "fill_all",
        "모든 공극 채우기(추천)": "fill_all",
        "모든 공극 채우기": "fill_all",
        "fill_small": "fill_small",
        "작은 공극만 채우기": "fill_small",
        "keep": "keep",
        "공극 유지": "keep",
    }
    hole_mode = hole_mode_map.get(hole_mode_raw)
    if hole_mode is None:
        raise ValueError("공극 처리 방식이 올바르지 않습니다.")

    max_hole_area_um2_raw = _to_float(params.get("max_hole_area_um2"))
    max_hole_area_um2: float | None = None
    if hole_mode == "fill_small":
        if max_hole_area_um2_raw is None or max_hole_area_um2_raw <= 0:
            raise ValueError("작은 공극만 채우기 모드에서는 최대 공극 크기(µm²)를 입력해야 합니다.")
        max_hole_area_um2 = _clamp_float(max_hole_area_um2_raw, 0.0001, 1_000_000_000.0)
    elif max_hole_area_um2_raw is not None and max_hole_area_um2_raw > 0:
        max_hole_area_um2 = _clamp_float(max_hole_area_um2_raw, 0.0001, 1_000_000_000.0)

    closing_enabled = _to_bool(params.get("closing_enabled"), False)
    closing_radius_um_raw = _to_float(params.get("closing_radius_um"))
    closing_radius_um = (
        _clamp_float(closing_radius_um_raw, 0.0, 10.0)
        if closing_radius_um_raw is not None and closing_radius_um_raw >= 0
        else None
    )
    if closing_enabled and closing_radius_um is None:
        closing_radius_um = 0.3

    return {
        "base_mask_artifact_id": normalized_base_mask_artifact_id,
        "hole_mode": hole_mode,
        "max_hole_area_um2": max_hole_area_um2,
        "closing_enabled": closing_enabled,
        "closing_radius_um": closing_radius_um,
    }


def _resolve_step7_base_inputs(
    session: Session,
    run: Run,
    requested_base_mask_artifact_id: str | None,
) -> tuple[str, str, str | None, str | None]:
    step6_artifact: StepArtifact | None = None
    if requested_base_mask_artifact_id:
        selected = session.get(StepArtifact, requested_base_mask_artifact_id)
        if selected is None or selected.run_id != run.id or selected.step_id != 6:
            raise ValueError("선택한 6단계 산출물을 찾을 수 없습니다.")
        step6_artifact = selected
    else:
        step6_artifact = _latest_step_artifact(session, run.id, 6)
        if step6_artifact is None:
            raise ValueError("6단계를 먼저 완료해야 실행할 수 있습니다.")

    step6_mask_rel_path = _artifact_first_image_path(step6_artifact)
    if not step6_mask_rel_path:
        raise ValueError("선택한 6단계 산출물에 마스크 이미지가 없습니다.")
    step6_mask_abs_path = storage_service.resolve(step6_mask_rel_path)
    if not step6_mask_abs_path.exists():
        raise ValueError("선택한 6단계 마스크 파일을 찾을 수 없습니다.")

    source_rel_path: str | None = None
    source_artifact_id: str | None = None

    step6_params = _safe_json_loads(step6_artifact.params_json, {})
    if isinstance(step6_params, dict):
        input_artifact_id = step6_params.get("input_artifact_id")
        if isinstance(input_artifact_id, str) and input_artifact_id.strip():
            step3_artifact = session.get(StepArtifact, input_artifact_id.strip())
            if step3_artifact is not None and step3_artifact.run_id == run.id and step3_artifact.step_id == 3:
                candidate_path = _artifact_first_image_path(step3_artifact)
                if candidate_path:
                    candidate_abs = storage_service.resolve(candidate_path)
                    if candidate_abs.exists():
                        source_rel_path = candidate_path
                        source_artifact_id = step3_artifact.id

    if source_rel_path is None:
        latest_step3 = _latest_step_artifact(session, run.id, 3)
        latest_step3_path = _artifact_first_image_path(latest_step3)
        if latest_step3 and latest_step3_path:
            latest_step3_abs = storage_service.resolve(latest_step3_path)
            if latest_step3_abs.exists():
                source_rel_path = latest_step3_path
                source_artifact_id = latest_step3.id

    return step6_mask_rel_path, step6_artifact.id, source_rel_path, source_artifact_id


def _apply_binary_closing(mask: bytearray, width: int, height: int, radius_px: int) -> bytearray:
    if radius_px <= 0:
        return bytearray(mask)

    kernel = max(3, (radius_px * 2) + 1)
    if kernel % 2 == 0:
        kernel += 1

    image = _mask_to_binary_image(mask, width, height)
    closed = image.filter(ImageFilter.MaxFilter(kernel)).filter(ImageFilter.MinFilter(kernel))
    binary = closed.point(lambda value: 255 if value >= 128 else 0)
    return _binary_image_to_mask(binary)


def _image_png_base64(image: Image.Image) -> str:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _run_step7_pipeline(
    base_mask_image: Image.Image,
    normalized_params: dict[str, Any],
    um_per_px: float,
) -> tuple[Image.Image, Image.Image, dict[str, Any], dict[str, Any]]:
    mask_gray = base_mask_image.convert("L").point(lambda value: 255 if value > 0 else 0)
    width, height = mask_gray.size
    total = max(width * height, 1)
    solid_mask = _binary_image_to_mask(mask_gray)
    outer_mask = bytearray(solid_mask)

    hole_mode = str(normalized_params["hole_mode"])
    max_hole_area_um2 = normalized_params.get("max_hole_area_um2")

    max_hole_area_px: int | None = None
    if hole_mode == "fill_all":
        max_hole_area_px = width * height
        outer_mask = _fill_small_holes(outer_mask, width, height, max_hole_area_px)
    elif hole_mode == "fill_small":
        if not isinstance(max_hole_area_um2, (int, float)) or float(max_hole_area_um2) <= 0:
            raise ValueError("최대 공극 크기(µm²)가 필요합니다.")
        max_hole_area_px = max(1, int(round(float(max_hole_area_um2) / max((um_per_px * um_per_px), 1e-12))))
        outer_mask = _fill_small_holes(outer_mask, width, height, max_hole_area_px)
    elif hole_mode == "keep":
        max_hole_area_px = None
    else:
        raise ValueError("공극 처리 방식이 올바르지 않습니다.")

    closing_enabled = bool(normalized_params["closing_enabled"])
    closing_radius_um = normalized_params.get("closing_radius_um")
    closing_radius_px = 0
    if closing_enabled:
        closing_radius_px = _clamp_int(
            int(round((float(closing_radius_um or 0.0)) / max(um_per_px, 1e-12))),
            0,
            128,
        )
        if closing_radius_px > 0:
            outer_mask = _apply_binary_closing(outer_mask, width, height, closing_radius_px)
            for index, value in enumerate(solid_mask):
                if value:
                    outer_mask[index] = 1

    solid_mask = bytearray(1 if value else 0 for value in solid_mask)
    outer_mask = bytearray(1 if value else 0 for value in outer_mask)

    solid_area_px = int(sum(solid_mask))
    outer_area_px = int(sum(outer_mask))
    pore_area_px = 0
    for index in range(width * height):
        if outer_mask[index] and not solid_mask[index]:
            pore_area_px += 1

    porosity = pore_area_px / max(outer_area_px, 1)
    metrics = {
        "solid_area_px": solid_area_px,
        "outer_area_px": outer_area_px,
        "pore_area_px": pore_area_px,
        "porosity": round(porosity, 6),
    }

    solid_image = _mask_to_binary_image(solid_mask, width, height)
    outer_image = _mask_to_binary_image(outer_mask, width, height)
    solid_unique = sorted({int(pixel) for pixel in set(solid_image.getdata())})
    outer_unique = sorted({int(pixel) for pixel in set(outer_image.getdata())})

    internal = {
        "um_per_px": round(um_per_px, 8),
        "hole_mode": hole_mode,
        "max_hole_area_um2": None if max_hole_area_um2 is None else round(float(max_hole_area_um2), 8),
        "max_hole_area_px": max_hole_area_px,
        "closing_enabled": closing_enabled,
        "closing_radius_um": None if closing_radius_um is None else round(float(closing_radius_um), 8),
        "closing_radius_px": closing_radius_px,
        "solid_unique_values": solid_unique,
        "outer_unique_values": outer_unique,
    }
    return solid_image, outer_image, metrics, internal


def create_step7_preview_payload(
    session: Session,
    run: Run,
    params: dict[str, Any],
) -> dict[str, Any]:
    image = session.get(ImageAsset, run.image_id)
    if image is None:
        raise LookupError("원본 이미지를 찾을 수 없습니다.")

    _validate_step_prerequisite(session, run.id, 7)
    normalized_params = _normalize_step7_params(params)
    base_mask_rel_path, _, _, _ = _resolve_step7_base_inputs(session, run, normalized_params["base_mask_artifact_id"])
    base_mask_abs_path = storage_service.resolve(base_mask_rel_path)
    um_per_px = _resolve_um_per_px(session, run)

    with Image.open(base_mask_abs_path) as base_mask_image:
        solid_image, outer_image, metrics, _ = _run_step7_pipeline(base_mask_image, normalized_params, um_per_px)

    return {
        "solid_png_base64": _image_png_base64(solid_image),
        "outer_png_base64": _image_png_base64(outer_image),
        "metrics": {
            "solid_area_px": int(metrics["solid_area_px"]),
            "outer_area_px": int(metrics["outer_area_px"]),
            "porosity": float(metrics["porosity"]),
        },
    }


def _normalize_step8_params(params: dict[str, Any]) -> dict[str, Any]:
    base_mask_artifact_id = params.get("base_mask_artifact_id")
    normalized_base_mask_artifact_id: str | None = None
    if isinstance(base_mask_artifact_id, str) and base_mask_artifact_id.strip():
        normalized_base_mask_artifact_id = base_mask_artifact_id.strip()
    step7_artifact_id = params.get("step7_artifact_id")
    normalized_step7_artifact_id: str | None = None
    if isinstance(step7_artifact_id, str) and step7_artifact_id.strip():
        normalized_step7_artifact_id = step7_artifact_id.strip()
    return {
        "base_mask_artifact_id": normalized_base_mask_artifact_id,
        "step7_artifact_id": normalized_step7_artifact_id,
    }


def _resolve_step3_image_from_step5_or_6_artifact(
    session: Session,
    run: Run,
    mask_artifact: StepArtifact,
) -> tuple[str | None, str | None]:
    params = _safe_json_loads(mask_artifact.params_json, {})
    if not isinstance(params, dict):
        return None, None

    if mask_artifact.step_id == 6:
        step3_id = params.get("input_artifact_id")
        if isinstance(step3_id, str) and step3_id.strip():
            step3_artifact = session.get(StepArtifact, step3_id.strip())
            if step3_artifact is not None and step3_artifact.run_id == run.id and step3_artifact.step_id == 3:
                path = _artifact_first_image_path(step3_artifact)
                if path:
                    abs_path = storage_service.resolve(path)
                    if abs_path.exists():
                        return path, step3_artifact.id
        return None, None

    if mask_artifact.step_id == 5:
        step4_id = params.get("base_mask_artifact_id")
        if isinstance(step4_id, str) and step4_id.strip():
            step4_artifact = session.get(StepArtifact, step4_id.strip())
            if step4_artifact is not None and step4_artifact.run_id == run.id and step4_artifact.step_id == 4:
                step4_params = _safe_json_loads(step4_artifact.params_json, {})
                if isinstance(step4_params, dict):
                    step3_id = step4_params.get("input_artifact_id")
                    if isinstance(step3_id, str) and step3_id.strip():
                        step3_artifact = session.get(StepArtifact, step3_id.strip())
                        if step3_artifact is not None and step3_artifact.run_id == run.id and step3_artifact.step_id == 3:
                            path = _artifact_first_image_path(step3_artifact)
                            if path:
                                abs_path = storage_service.resolve(path)
                                if abs_path.exists():
                                    return path, step3_artifact.id
        return None, None

    return None, None


def _resolve_step8_base_inputs(
    session: Session,
    run: Run,
    requested_base_mask_artifact_id: str | None,
) -> tuple[str, str, int, str | None, str | None]:
    candidate_artifact: StepArtifact | None = None

    if requested_base_mask_artifact_id:
        selected = session.get(StepArtifact, requested_base_mask_artifact_id)
        if selected is None or selected.run_id != run.id or selected.step_id not in {5, 6}:
            raise ValueError("선택한 마스크 산출물(6단계 또는 5단계)을 찾을 수 없습니다.")
        candidate_artifact = selected
    else:
        latest_step6 = _latest_step_artifact(session, run.id, 6)
        if latest_step6 is not None:
            candidate_artifact = latest_step6
        else:
            latest_step5 = _latest_step_artifact(session, run.id, 5)
            if latest_step5 is not None:
                candidate_artifact = latest_step5

    if candidate_artifact is None:
        raise ValueError("윤곽선을 뽑으려면 먼저 마스크(6단계 또는 5단계)를 만들어야 합니다.")

    mask_path = _artifact_first_image_path(candidate_artifact)
    if not mask_path:
        raise ValueError("선택한 마스크 산출물에 이미지 파일이 없습니다.")
    mask_abs = storage_service.resolve(mask_path)
    if not mask_abs.exists():
        raise ValueError("선택한 마스크 파일을 찾을 수 없습니다.")

    source_path, source_artifact_id = _resolve_step3_image_from_step5_or_6_artifact(session, run, candidate_artifact)
    if source_path is None:
        latest_step3 = _latest_step_artifact(session, run.id, 3)
        latest_step3_path = _artifact_first_image_path(latest_step3)
        if latest_step3 and latest_step3_path:
            latest_step3_abs = storage_service.resolve(latest_step3_path)
            if latest_step3_abs.exists():
                source_path = latest_step3_path
                source_artifact_id = latest_step3.id

    return mask_path, candidate_artifact.id, candidate_artifact.step_id, source_path, source_artifact_id


def _normalize_binary_mask_image(image: Image.Image) -> Image.Image:
    return image.convert("L").point(lambda value: 255 if value > 0 else 0)


def _extract_connected_components_4(mask: bytearray, width: int, height: int) -> list[list[int]]:
    total = width * height
    visited = bytearray(total)
    components: list[list[int]] = []

    for index in range(total):
        if visited[index] or mask[index] == 0:
            continue

        component: list[int] = []
        queue: deque[int] = deque([index])
        visited[index] = 1

        while queue:
            current = queue.popleft()
            component.append(current)
            x = current % width
            y = current // width

            if x > 0:
                left = current - 1
                if not visited[left] and mask[left]:
                    visited[left] = 1
                    queue.append(left)
            if x + 1 < width:
                right = current + 1
                if not visited[right] and mask[right]:
                    visited[right] = 1
                    queue.append(right)
            if y > 0:
                up = current - width
                if not visited[up] and mask[up]:
                    visited[up] = 1
                    queue.append(up)
            if y + 1 < height:
                down = current + width
                if not visited[down] and mask[down]:
                    visited[down] = 1
                    queue.append(down)

        if component:
            components.append(component)

    return components


def _polygon_area(points: list[tuple[int, int]]) -> float:
    if len(points) < 3:
        return 0.0
    total = 0.0
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        total += (x1 * y2) - (x2 * y1)
    return total / 2.0


def _simplify_axis_aligned_closed_polyline(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if len(points) < 3:
        return points

    simplified = list(points)
    changed = True
    while changed and len(simplified) >= 3:
        changed = False
        output: list[tuple[int, int]] = []
        count = len(simplified)
        for index in range(count):
            prev = simplified[(index - 1) % count]
            curr = simplified[index]
            nxt = simplified[(index + 1) % count]
            if curr == prev or curr == nxt:
                changed = True
                continue
            if (prev[0] == curr[0] == nxt[0]) or (prev[1] == curr[1] == nxt[1]):
                changed = True
                continue
            output.append(curr)
        if len(output) >= 3:
            simplified = output
    return simplified


def _component_boundary_loops(
    component: list[int],
    width: int,
    height: int,
) -> list[list[tuple[int, int]]]:
    component_set = set(component)
    adjacency: dict[tuple[int, int], list[tuple[int, int]]] = {}

    def add_edge(start: tuple[int, int], end: tuple[int, int]) -> None:
        adjacency.setdefault(start, []).append(end)

    for index in component:
        x = index % width
        y = index // width

        if y == 0 or (index - width) not in component_set:
            add_edge((x, y), (x + 1, y))
        if x == width - 1 or (index + 1) not in component_set:
            add_edge((x + 1, y), (x + 1, y + 1))
        if y == height - 1 or (index + width) not in component_set:
            add_edge((x + 1, y + 1), (x, y + 1))
        if x == 0 or (index - 1) not in component_set:
            add_edge((x, y + 1), (x, y))

    loops: list[list[tuple[int, int]]] = []

    while True:
        start_point: tuple[int, int] | None = None
        for key, values in adjacency.items():
            if values:
                start_point = key
                break
        if start_point is None:
            break

        current = start_point
        loop: list[tuple[int, int]] = [start_point]
        visited_guard = 0
        max_steps = max(8, sum(len(values) for values in adjacency.values()) + 5)

        while visited_guard < max_steps:
            visited_guard += 1
            next_candidates = adjacency.get(current)
            if not next_candidates:
                break
            next_point = next_candidates.pop()
            if not next_candidates:
                adjacency.pop(current, None)
            current = next_point
            if current == start_point:
                break
            loop.append(current)

        if len(loop) >= 3 and current == start_point:
            loops.append(_simplify_axis_aligned_closed_polyline(loop))

    return loops


def _extract_external_contours_from_mask(mask_image: Image.Image) -> dict[str, Any]:
    normalized = _normalize_binary_mask_image(mask_image)
    width, height = normalized.size
    mask = _binary_image_to_mask(normalized)

    components = _extract_connected_components_4(mask, width, height)
    contours_payload: list[dict[str, Any]] = []

    def sort_key(item: dict[str, Any]) -> tuple[int, int, int]:
        bbox = item["bbox"]
        return int(bbox[1]), int(bbox[0]), int(item["id"])

    contour_id = 1
    for component in components:
        if not component:
            continue
        loops = _component_boundary_loops(component, width, height)
        if not loops:
            continue

        best_loop = max(loops, key=lambda loop: abs(_polygon_area(loop)))
        if len(best_loop) < 3:
            continue

        xs_component = [index % width for index in component]
        ys_component = [index // width for index in component]
        min_x = min(xs_component)
        min_y = min(ys_component)
        max_x = max(xs_component)
        max_y = max(ys_component)
        bbox = [int(min_x), int(min_y), int(max_x - min_x + 1), int(max_y - min_y + 1)]

        points = [[int(x), int(y)] for x, y in best_loop]
        contours_payload.append(
            {
                "id": contour_id,
                "bbox": bbox,
                "points": points,
            }
        )
        contour_id += 1

    contours_payload.sort(key=sort_key)
    for index, contour in enumerate(contours_payload, start=1):
        contour["id"] = index

    return {
        "image_width": width,
        "image_height": height,
        "contours": contours_payload,
    }


def _find_matching_step7_artifact_for_step8(
    session: Session,
    run_id: str,
    base_mask_artifact_id: str,
) -> StepArtifact | None:
    stmt = (
        select(StepArtifact)
        .where(
            StepArtifact.run_id == run_id,
            StepArtifact.step_id == 7,
        )
        .order_by(desc(StepArtifact.version), desc(StepArtifact.created_at))
    )
    for artifact in session.exec(stmt):
        params = _safe_json_loads(artifact.params_json, {})
        if not isinstance(params, dict):
            continue
        linked_base_id = params.get("base_mask_artifact_id")
        if isinstance(linked_base_id, str) and linked_base_id.strip() == base_mask_artifact_id:
            return artifact
    return None


def _resolve_step8_pore_mask_from_step7(
    session: Session,
    run: Run,
    base_mask_artifact_id: str,
    base_mask_step_id: int,
    requested_step7_artifact_id: str | None = None,
) -> tuple[Image.Image | None, str | None]:
    step7_artifact: StepArtifact | None = None

    # 1) 프론트에서 현재 선택된 Step7 버전을 전달한 경우 우선 사용
    if requested_step7_artifact_id:
        selected = session.get(StepArtifact, requested_step7_artifact_id)
        if selected is not None and selected.run_id == run.id and selected.step_id == 7:
            step7_artifact = selected

    # 2) Step8 기준 Step6 마스크와 정확히 연결된 Step7 버전을 찾는다.
    if step7_artifact is None and base_mask_step_id == 6:
        step7_artifact = _find_matching_step7_artifact_for_step8(session, run.id, base_mask_artifact_id)

    # 보강: 정확히 연결된 Step7가 없어도, 같은 런의 최신 Step7 버전이 있으면 공극 윤곽선을 포함한다.
    if step7_artifact is None:
        step7_artifact = _latest_step_artifact(session, run.id, 7)
    if step7_artifact is None:
        return None, None

    solid_path = _artifact_image_path_by_keywords(step7_artifact, ["mask_solid", "solid"])
    outer_path = _artifact_image_path_by_keywords(step7_artifact, ["mask_outer", "outer"])
    if not solid_path or not outer_path:
        return None, step7_artifact.id

    solid_abs = storage_service.resolve(solid_path)
    outer_abs = storage_service.resolve(outer_path)
    if not solid_abs.exists() or not outer_abs.exists():
        return None, step7_artifact.id

    with Image.open(solid_abs) as solid_image_raw, Image.open(outer_abs) as outer_image_raw:
        solid_image = _normalize_binary_mask_image(solid_image_raw.convert("L"))
        outer_image = _normalize_binary_mask_image(outer_image_raw.convert("L"))
        if solid_image.size != outer_image.size:
            return None, step7_artifact.id

        width, height = solid_image.size
        solid_mask = _binary_image_to_mask(solid_image)
        outer_mask = _binary_image_to_mask(outer_image)
        pore_mask = bytearray(
            1 if (outer_mask[index] and not solid_mask[index]) else 0
            for index in range(width * height)
        )
        return _mask_to_binary_image(pore_mask, width, height), step7_artifact.id


def _build_step8_contours_payload(
    base_mask_image: Image.Image,
    pore_mask_image: Image.Image | None = None,
) -> dict[str, Any]:
    base_payload = _extract_external_contours_from_mask(base_mask_image)
    width = int(base_payload.get("image_width", 0))
    height = int(base_payload.get("image_height", 0))

    merged_contours: list[dict[str, Any]] = []
    for contour in base_payload.get("contours", []):
        if isinstance(contour, dict):
            merged_contours.append({**contour, "kind": "solid"})

    if pore_mask_image is not None:
        pore_payload = _extract_external_contours_from_mask(pore_mask_image)
        pore_width = int(pore_payload.get("image_width", 0))
        pore_height = int(pore_payload.get("image_height", 0))
        if width <= 0 or height <= 0:
            width = pore_width
            height = pore_height
        if pore_width == width and pore_height == height:
            for contour in pore_payload.get("contours", []):
                if isinstance(contour, dict):
                    merged_contours.append({**contour, "kind": "pore"})

    def sort_key(item: dict[str, Any]) -> tuple[int, int, int]:
        bbox = item.get("bbox")
        if not isinstance(bbox, list) or len(bbox) < 2:
            return (0, 0, int(item.get("id", 0)))
        y = _to_int(bbox[1], 0)
        x = _to_int(bbox[0], 0)
        kind = str(item.get("kind", "solid"))
        kind_order = 1 if kind == "pore" else 0
        return (y, x, kind_order)

    merged_contours.sort(key=sort_key)
    for index, contour in enumerate(merged_contours, start=1):
        contour["id"] = index

    solid_contour_count = sum(1 for contour in merged_contours if str(contour.get("kind", "solid")) != "pore")
    pore_contour_count = sum(1 for contour in merged_contours if str(contour.get("kind", "")) == "pore")

    return {
        "image_width": width,
        "image_height": height,
        "solid_contour_count": solid_contour_count,
        "pore_contour_count": pore_contour_count,
        "has_pore_contours": pore_contour_count > 0,
        "contours": merged_contours,
    }


def _normalize_step9_params(params: dict[str, Any]) -> dict[str, Any]:
    requested_step8_artifact_id = params.get("step8_artifact_id")
    step8_artifact_id: str | None = None
    if isinstance(requested_step8_artifact_id, str) and requested_step8_artifact_id.strip():
        step8_artifact_id = requested_step8_artifact_id.strip()
    return {
        "step8_artifact_id": step8_artifact_id,
        "smooth_level": _clamp_float(float(_to_float(params.get("smooth_level"), 35.0) or 35.0), 0.0, 100.0),
        "resample_step_px": _clamp_float(float(_to_float(params.get("resample_step_px"), 2.0) or 2.0), 0.5, 5.0),
        "max_vertex_gap_px": _clamp_float(float(_to_float(params.get("max_vertex_gap_px"), 3.0) or 3.0), 1.0, 8.0),
    }


def _resolve_step9_inputs(session: Session, run: Run) -> tuple[str, str, str | None, str | None]:
    step6_artifact = _latest_step_artifact(session, run.id, 6)
    if step6_artifact is None:
        raise ValueError("먼저 6단계 마스크가 필요합니다.")

    step6_mask_rel_path = _artifact_first_image_path(step6_artifact)
    if not step6_mask_rel_path:
        raise ValueError("6단계 산출물에 마스크 이미지가 없습니다.")
    step6_mask_abs = storage_service.resolve(step6_mask_rel_path)
    if not step6_mask_abs.exists():
        raise ValueError("6단계 마스크 파일을 찾을 수 없습니다.")

    step3_image_rel_path: str | None = None
    step3_artifact_id: str | None = None

    step6_params = _safe_json_loads(step6_artifact.params_json, {})
    if isinstance(step6_params, dict):
        input_artifact_id = step6_params.get("input_artifact_id")
        if isinstance(input_artifact_id, str) and input_artifact_id.strip():
            step3_artifact = session.get(StepArtifact, input_artifact_id.strip())
            if step3_artifact is not None and step3_artifact.run_id == run.id and step3_artifact.step_id == 3:
                candidate = _artifact_first_image_path(step3_artifact)
                if candidate:
                    candidate_abs = storage_service.resolve(candidate)
                    if candidate_abs.exists():
                        step3_image_rel_path = candidate
                        step3_artifact_id = step3_artifact.id

    if step3_image_rel_path is None:
        latest_step3 = _latest_step_artifact(session, run.id, 3)
        latest_step3_path = _artifact_first_image_path(latest_step3)
        if latest_step3 and latest_step3_path:
            latest_step3_abs = storage_service.resolve(latest_step3_path)
            if latest_step3_abs.exists():
                step3_image_rel_path = latest_step3_path
                step3_artifact_id = latest_step3.id

    return step6_mask_rel_path, step6_artifact.id, step3_image_rel_path, step3_artifact_id


def _resolve_step9_preview_background_rel_path(session: Session, run: Run, image: ImageAsset) -> tuple[str, str | None]:
    latest_step3 = _latest_step_artifact(session, run.id, 3)
    if latest_step3 is not None:
        step3_image_rel = _artifact_first_image_path(latest_step3)
        if step3_image_rel:
            step3_abs = storage_service.resolve(step3_image_rel)
            if step3_abs.exists():
                return step3_image_rel, latest_step3.id

    latest_step1 = _latest_step_artifact(session, run.id, 1)
    if latest_step1 is not None:
        step1_preview_rel = _artifact_first_image_path(latest_step1)
        if step1_preview_rel:
            step1_abs = storage_service.resolve(step1_preview_rel)
            if step1_abs.exists():
                return step1_preview_rel, latest_step1.id

    return image.storage_path, None


def _step9_poly_distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _step9_ensure_closed_points(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(points) < 2:
        return points
    first = points[0]
    last = points[-1]
    if abs(first[0] - last[0]) < 1e-9 and abs(first[1] - last[1]) < 1e-9:
        return points[:]
    return [*points, first]


def _step9_resample_closed_contour(points: list[tuple[float, float]], step_px: float) -> list[tuple[float, float]]:
    if len(points) < 4:
        return points[:]
    closed = _step9_ensure_closed_points(points)
    ring = closed[:-1]
    n = len(ring)
    if n < 3:
        return closed

    segments: list[float] = []
    total_len = 0.0
    for idx in range(n):
        seg_len = _step9_poly_distance(ring[idx], ring[(idx + 1) % n])
        segments.append(seg_len)
        total_len += seg_len
    if total_len <= 1e-6:
        return closed

    sample_count = max(n, int(math.ceil(total_len / max(step_px, 0.1))))
    sample_count = max(12, sample_count)
    interval = total_len / sample_count

    sampled: list[tuple[float, float]] = []
    seg_index = 0
    seg_start_dist = 0.0
    seg_len = segments[0]
    for sample_idx in range(sample_count):
        target = sample_idx * interval
        while seg_index < n - 1 and target > seg_start_dist + seg_len:
            seg_start_dist += seg_len
            seg_index += 1
            seg_len = segments[seg_index]

        start = ring[seg_index]
        end = ring[(seg_index + 1) % n]
        if seg_len <= 1e-9:
            sampled.append((start[0], start[1]))
            continue
        t = (target - seg_start_dist) / seg_len
        t = _clamp_float(t, 0.0, 1.0)
        sampled.append((start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t))

    return _step9_ensure_closed_points(sampled)


def _step9_smooth_closed_contour(points: list[tuple[float, float]], smooth_level: float) -> list[tuple[float, float]]:
    if len(points) < 4 or smooth_level <= 0:
        return points[:]
    closed = _step9_ensure_closed_points(points)
    ring = closed[:-1]
    n = len(ring)
    if n < 3:
        return closed

    radius = int(round((smooth_level / 100.0) * 6.0))
    if radius <= 0:
        return closed
    radius = max(1, min(radius, max(1, n // 6)))
    window = (radius * 2) + 1

    smoothed: list[tuple[float, float]] = []
    for idx in range(n):
        sum_x = 0.0
        sum_y = 0.0
        for offset in range(-radius, radius + 1):
            px, py = ring[(idx + offset) % n]
            sum_x += px
            sum_y += py
        smoothed.append((sum_x / window, sum_y / window))

    return _step9_ensure_closed_points(smoothed)


def _step9_densify_closed_contour(points: list[tuple[float, float]], max_gap_px: float) -> list[tuple[float, float]]:
    if len(points) < 4:
        return points[:]
    closed = _step9_ensure_closed_points(points)
    ring = closed[:-1]
    n = len(ring)
    if n < 3:
        return closed

    dense: list[tuple[float, float]] = []
    for idx in range(n):
        start = ring[idx]
        end = ring[(idx + 1) % n]
        dense.append(start)
        seg_len = _step9_poly_distance(start, end)
        if seg_len <= max_gap_px + 1e-9:
            continue
        pieces = int(math.ceil(seg_len / max(max_gap_px, 0.1)))
        for step in range(1, pieces):
            t = step / pieces
            dense.append((start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t))

    if len(dense) < 3:
        return closed
    return _step9_ensure_closed_points(dense)


def _step9_polygonize_contours_payload(
    contours_payload: dict[str, Any],
    normalized_params: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(contours_payload, dict):
        raise ValueError("8단계 윤곽선 데이터를 읽을 수 없습니다.")

    width = _to_int(contours_payload.get("image_width"), 0)
    height = _to_int(contours_payload.get("image_height"), 0)
    contours_raw = contours_payload.get("contours")
    if width <= 0 or height <= 0 or not isinstance(contours_raw, list):
        raise ValueError("8단계 윤곽선 데이터 형식이 올바르지 않습니다.")

    smooth_level = float(normalized_params["smooth_level"])
    resample_step_px = float(normalized_params["resample_step_px"])
    max_vertex_gap_px = float(normalized_params["max_vertex_gap_px"])

    polygons: list[dict[str, Any]] = []
    for contour_raw in contours_raw:
        if not isinstance(contour_raw, dict):
            continue
        object_id = _to_int(contour_raw.get("id"), 0)
        points_raw = contour_raw.get("points")
        if not isinstance(points_raw, list):
            continue

        parsed: list[tuple[float, float]] = []
        for point in points_raw:
            if not isinstance(point, list) or len(point) < 2:
                continue
            parsed.append((float(_to_float(point[0], 0.0) or 0.0), float(_to_float(point[1], 0.0) or 0.0)))
        # 짧은 윤곽선도 생략하지 않는다. (폴리곤으로 성립 가능한 최소 점수만 검사)
        if len(parsed) < 3:
            continue

        closed = _step9_ensure_closed_points(parsed)
        resampled = _step9_resample_closed_contour(closed, resample_step_px)
        smoothed = _step9_smooth_closed_contour(resampled, smooth_level)
        dense = _step9_densify_closed_contour(smoothed, max_vertex_gap_px)
        dense_closed = _step9_ensure_closed_points(dense)
        if len(dense_closed) < 4:
            continue

        # JSON에는 중복 종단점을 제거하고 저장한다(뷰어에서 닫아 그림).
        stored_points = dense_closed[:-1]
        polygons.append(
            {
                "object_id": object_id,
                "points": [[round(x, 3), round(y, 3)] for x, y in stored_points],
                "meta": {
                    "smooth_level": round(smooth_level, 3),
                    "resample_step_px": round(resample_step_px, 3),
                    "max_vertex_gap_px": round(max_vertex_gap_px, 3),
                },
            }
        )

    return {
        "image_width": width,
        "image_height": height,
        "polygon_count": len(polygons),
        "polygons": polygons,
    }


def _step9_render_polygon_preview_image(
    background_image: Image.Image,
    polygons_payload: dict[str, Any],
) -> Image.Image:
    preview = background_image.convert("L").convert("RGB")
    draw = ImageDraw.Draw(preview)
    polygons = polygons_payload.get("polygons")
    if isinstance(polygons, list):
        for polygon in polygons:
            if not isinstance(polygon, dict):
                continue
            points_raw = polygon.get("points")
            if not isinstance(points_raw, list) or len(points_raw) < 2:
                continue
            points: list[tuple[float, float]] = []
            for point in points_raw:
                if not isinstance(point, list) or len(point) < 2:
                    continue
                x = float(_to_float(point[0], 0.0) or 0.0)
                y = float(_to_float(point[1], 0.0) or 0.0)
                points.append((x, y))
            if len(points) < 2:
                continue
            draw.line(points + [points[0]], fill=(37, 99, 235), width=2)
    return preview


def _step9_component_bbox(component: list[int], width: int) -> tuple[int, int, int, int]:
    min_x = width
    min_y = 10**9
    max_x = -1
    max_y = -1
    for index in component:
        x = index % width
        y = index // width
        if x < min_x:
            min_x = x
        if y < min_y:
            min_y = y
        if x > max_x:
            max_x = x
        if y > max_y:
            max_y = y
    return min_x, min_y, max_x, max_y


def _step9_local_component_mask(component: list[int], width: int, bbox: tuple[int, int, int, int]) -> tuple[bytearray, int, int]:
    min_x, min_y, max_x, max_y = bbox
    local_w = max_x - min_x + 1
    local_h = max_y - min_y + 1
    local_mask = bytearray(local_w * local_h)
    for index in component:
        x = (index % width) - min_x
        y = (index // width) - min_y
        local_mask[(y * local_w) + x] = 1
    return local_mask, local_w, local_h


def _step9_dijkstra_path(
    local_mask: bytearray,
    local_w: int,
    local_h: int,
    start: tuple[int, int],
    end: tuple[int, int],
    pixel_costs: list[float],
) -> list[tuple[int, int]]:
    if local_w <= 0 or local_h <= 0:
        return []
    sx, sy = start
    ex, ey = end
    if not (0 <= sx < local_w and 0 <= sy < local_h and 0 <= ex < local_w and 0 <= ey < local_h):
        return []

    start_idx = (sy * local_w) + sx
    end_idx = (ey * local_w) + ex
    if local_mask[start_idx] == 0 or local_mask[end_idx] == 0:
        return []

    total = local_w * local_h
    inf = float("inf")
    dist = [inf] * total
    prev = [-1] * total
    dist[start_idx] = 0.0
    heap: list[tuple[float, int]] = [(0.0, start_idx)]

    while heap:
        current_dist, index = heapq.heappop(heap)
        if current_dist != dist[index]:
            continue
        if index == end_idx:
            break
        x = index % local_w
        y = index // local_w
        for ny in range(max(0, y - 1), min(local_h, y + 2)):
            row = ny * local_w
            for nx in range(max(0, x - 1), min(local_w, x + 2)):
                neighbor = row + nx
                if neighbor == index or local_mask[neighbor] == 0:
                    continue
                diagonal = (nx != x) and (ny != y)
                step_cost = math.sqrt(2.0) if diagonal else 1.0
                next_dist = current_dist + (step_cost * (1.0 + pixel_costs[neighbor]))
                if next_dist >= dist[neighbor]:
                    continue
                dist[neighbor] = next_dist
                prev[neighbor] = index
                heapq.heappush(heap, (next_dist, neighbor))

    if not math.isfinite(dist[end_idx]):
        return []

    path_indices: list[int] = []
    cursor = end_idx
    while cursor >= 0:
        path_indices.append(cursor)
        if cursor == start_idx:
            break
        cursor = prev[cursor]
    if not path_indices or path_indices[-1] != start_idx:
        return []

    path_indices.reverse()
    return [(index % local_w, index // local_w) for index in path_indices]


def _step9_compress_polyline(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if len(points) < 3:
        return points
    compressed = [points[0]]
    for index in range(1, len(points) - 1):
        prev_x, prev_y = compressed[-1]
        cur_x, cur_y = points[index]
        next_x, next_y = points[index + 1]
        dx1 = cur_x - prev_x
        dy1 = cur_y - prev_y
        dx2 = next_x - cur_x
        dy2 = next_y - cur_y
        if (dx1, dy1) == (dx2, dy2):
            continue
        compressed.append((cur_x, cur_y))
    compressed.append(points[-1])
    return compressed


def _step9_generate_candidates(
    base_mask_image: Image.Image,
    gray_image: Image.Image,
    normalized_params: dict[str, Any],
    um_per_px: float,
    step8_contours_payload: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    del gray_image, um_per_px

    mask_image = _normalize_binary_mask_image(base_mask_image.convert("L"))
    width, height = mask_image.size
    base_mask = _binary_image_to_mask(mask_image)

    def _build_mask_outer_from_step8() -> bytearray:
        contours = step8_contours_payload.get("contours") if isinstance(step8_contours_payload, dict) else None
        if not isinstance(contours, list):
            return bytearray(base_mask)

        filled = Image.new("L", (width, height), 0)
        draw = ImageDraw.Draw(filled)
        used = 0
        for contour in contours:
            if not isinstance(contour, dict):
                continue
            if str(contour.get("kind", "solid")) == "pore":
                continue
            points_raw = contour.get("points")
            if not isinstance(points_raw, list):
                continue
            points: list[tuple[int, int]] = []
            for point in points_raw:
                if not isinstance(point, list) or len(point) < 2:
                    continue
                x = _clamp_int(_to_int(point[0]), 0, width - 1)
                y = _clamp_int(_to_int(point[1]), 0, height - 1)
                points.append((x, y))
            if len(points) < 3:
                continue
            draw.polygon(points, fill=255)
            used += 1

        if used <= 0:
            return bytearray(base_mask)
        return _binary_image_to_mask(_normalize_binary_mask_image(filled))

    def _polyline_length(points: list[tuple[int, int]]) -> float:
        if len(points) < 2:
            return 0.0
        total = 0.0
        for idx in range(1, len(points)):
            ax, ay = points[idx - 1]
            bx, by = points[idx]
            total += math.hypot(float(bx - ax), float(by - ay))
        return total

    def _build_local_boundary_mask(local_mask: bytearray, local_w: int, local_h: int) -> bytearray:
        boundary = bytearray(local_w * local_h)
        for y in range(local_h):
            row = y * local_w
            for x in range(local_w):
                index = row + x
                if local_mask[index] == 0:
                    continue
                if x == 0 or y == 0 or x == local_w - 1 or y == local_h - 1:
                    boundary[index] = 1
                    continue
                for ny in range(y - 1, y + 2):
                    nrow = ny * local_w
                    hit = False
                    for nx in range(x - 1, x + 2):
                        if nx == x and ny == y:
                            continue
                        if local_mask[nrow + nx] == 0:
                            boundary[index] = 1
                            hit = True
                            break
                    if hit:
                        break
        return boundary

    def _zhang_suen_thin(mask_binary: bytearray, local_w: int, local_h: int) -> bytearray:
        if local_w < 3 or local_h < 3:
            return bytearray(mask_binary)
        output = bytearray(1 if value else 0 for value in mask_binary)
        changed = True
        iteration = 0
        max_iter = max(32, (local_w * local_h) // 2)

        def _neighbors(ix: int, iy: int) -> tuple[int, int, int, int, int, int, int, int]:
            p2 = output[((iy - 1) * local_w) + ix]
            p3 = output[((iy - 1) * local_w) + (ix + 1)]
            p4 = output[(iy * local_w) + (ix + 1)]
            p5 = output[((iy + 1) * local_w) + (ix + 1)]
            p6 = output[((iy + 1) * local_w) + ix]
            p7 = output[((iy + 1) * local_w) + (ix - 1)]
            p8 = output[(iy * local_w) + (ix - 1)]
            p9 = output[((iy - 1) * local_w) + (ix - 1)]
            return p2, p3, p4, p5, p6, p7, p8, p9

        while changed and iteration < max_iter:
            iteration += 1
            changed = False
            for substep in (0, 1):
                to_remove: list[int] = []
                for y in range(1, local_h - 1):
                    row = y * local_w
                    for x in range(1, local_w - 1):
                        index = row + x
                        if output[index] == 0:
                            continue
                        p2, p3, p4, p5, p6, p7, p8, p9 = _neighbors(x, y)
                        arr = [p2, p3, p4, p5, p6, p7, p8, p9]
                        neighbor_sum = sum(arr)
                        if neighbor_sum < 2 or neighbor_sum > 6:
                            continue
                        transitions = 0
                        seq = arr + [arr[0]]
                        for i in range(8):
                            if seq[i] == 0 and seq[i + 1] == 1:
                                transitions += 1
                        if transitions != 1:
                            continue
                        if substep == 0:
                            if p2 * p4 * p6 != 0 or p4 * p6 * p8 != 0:
                                continue
                        else:
                            if p2 * p4 * p8 != 0 or p2 * p6 * p8 != 0:
                                continue
                        to_remove.append(index)
                if to_remove:
                    changed = True
                    for index in to_remove:
                        output[index] = 0
        return output

    def _extract_components_8(mask_binary: bytearray, local_w: int, local_h: int) -> list[list[int]]:
        total = local_w * local_h
        visited = bytearray(total)
        result: list[list[int]] = []
        for start in range(total):
            if visited[start] or mask_binary[start] == 0:
                continue
            q: deque[int] = deque([start])
            visited[start] = 1
            comp: list[int] = []
            while q:
                index = q.popleft()
                comp.append(index)
                x = index % local_w
                y = index // local_w
                for ny in range(max(0, y - 1), min(local_h, y + 2)):
                    row = ny * local_w
                    for nx in range(max(0, x - 1), min(local_w, x + 2)):
                        nidx = row + nx
                        if nidx == index or visited[nidx] or mask_binary[nidx] == 0:
                            continue
                        visited[nidx] = 1
                        q.append(nidx)
            if comp:
                result.append(comp)
        return result

    def _component_longest_path(component_nodes: list[int], local_w: int, local_h: int) -> list[tuple[int, int]]:
        if len(component_nodes) < 2:
            return []
        node_set = set(component_nodes)

        def _neighbors(index: int) -> list[int]:
            x = index % local_w
            y = index // local_w
            output: list[int] = []
            for ny in range(max(0, y - 1), min(local_h, y + 2)):
                row = ny * local_w
                for nx in range(max(0, x - 1), min(local_w, x + 2)):
                    nidx = row + nx
                    if nidx == index or nidx not in node_set:
                        continue
                    output.append(nidx)
            return output

        def _bfs(start: int) -> tuple[int, dict[int, int], dict[int, int]]:
            q: deque[int] = deque([start])
            dist = {start: 0}
            prev = {start: -1}
            far = start
            while q:
                cur = q.popleft()
                if dist[cur] > dist[far]:
                    far = cur
                for nidx in _neighbors(cur):
                    if nidx in dist:
                        continue
                    dist[nidx] = dist[cur] + 1
                    prev[nidx] = cur
                    q.append(nidx)
            return far, prev, dist

        degrees = {node: len(_neighbors(node)) for node in component_nodes}
        endpoints = [node for node, degree in degrees.items() if degree <= 1]
        seed = endpoints[0] if endpoints else component_nodes[0]
        far1, _, _ = _bfs(seed)
        far2, prev, dist = _bfs(far1)
        if far2 not in dist:
            return []
        nodes: list[int] = []
        cur = far2
        guard = 0
        while cur != -1 and guard < len(component_nodes) + 4:
            guard += 1
            nodes.append(cur)
            if cur == far1:
                break
            cur = prev.get(cur, -1)
        if not nodes or nodes[-1] != far1:
            return []
        nodes.reverse()
        return [(node % local_w, node // local_w) for node in nodes]

    def _skeleton_paths(mask_binary: bytearray, local_w: int, local_h: int, limit: int) -> list[list[tuple[int, int]]]:
        thinned = _zhang_suen_thin(mask_binary, local_w, local_h)
        comps = _extract_components_8(thinned, local_w, local_h)
        paths: list[list[tuple[int, int]]] = []
        for comp in comps:
            path = _step9_compress_polyline(_component_longest_path(comp, local_w, local_h))
            if len(path) >= 2:
                paths.append(path)
        paths.sort(key=_polyline_length, reverse=True)
        return paths[:limit]

    def _path_boundary_overlap_ratio(path: list[tuple[int, int]], local_boundary_mask: bytearray, local_w: int) -> float:
        if not path:
            return 1.0
        hits = 0
        for x, y in path:
            if local_boundary_mask[(y * local_w) + x]:
                hits += 1
        return hits / max(1, len(path))

    def _validate_and_globalize_path(
        path_local: list[tuple[int, int]],
        *,
        local_mask: bytearray,
        local_boundary_mask: bytearray,
        local_w: int,
        local_h: int,
        bbox: tuple[int, int, int, int],
    ) -> tuple[list[tuple[int, int]], float] | None:
        if len(path_local) < 2:
            return None
        for x, y in path_local:
            if not (0 <= x < local_w and 0 <= y < local_h):
                return None
            if local_mask[(y * local_w) + x] == 0:
                return None
        if _path_boundary_overlap_ratio(path_local, local_boundary_mask, local_w) >= 0.7:
            return None
        min_x, min_y, _, _ = bbox
        path_global = [(min_x + x, min_y + y) for x, y in path_local]
        return path_global, _polyline_length(path_local)

    def _simulate_split_components(
        local_mask: bytearray,
        local_w: int,
        local_h: int,
        path_local: list[tuple[int, int]],
        min_split_area: int,
    ) -> tuple[bool, int]:
        if len(path_local) < 2:
            return False, 1
        removed = bytearray(local_mask)
        for x, y in path_local:
            for ny in range(max(0, y - 1), min(local_h, y + 2)):
                row = ny * local_w
                for nx in range(max(0, x - 1), min(local_w, x + 2)):
                    removed[row + nx] = 0
        comps = _extract_connected_components_4(removed, local_w, local_h)
        if len(comps) < 2:
            return False, len(comps)
        if any(len(comp) < min_split_area for comp in comps):
            return False, len(comps)
        return True, len(comps)

    def _make_candidate(
        object_id: int,
        source: str,
        seq: int,
        path_global: list[tuple[int, int]],
        length_px: float,
        split_count: int,
    ) -> dict[str, Any]:
        return {
            "candidate_id": f"obj{object_id}_{source}_{seq}",
            "object_id": int(object_id),
            "qc_score": 0.0,
            "cut_points": [[int(x), int(y)] for x, y in path_global],
            "will_split_into": int(max(split_count, 0)),
            "source": source,
            "length_px": round(length_px, 2),
            "_sort_length": -float(length_px),
        }

    def _dedupe_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
        kept: list[dict[str, Any]] = []
        for item in sorted(lines, key=lambda row: (int(row.get("object_id", 0)), str(row.get("candidate_id", "")))):
            pts_raw = item.get("cut_points")
            if not isinstance(pts_raw, list):
                continue
            current = {tuple(p) for p in pts_raw if isinstance(p, list) and len(p) >= 2}
            if len(current) < 2:
                continue
            duplicated = False
            for prev in kept:
                if int(prev.get("object_id", -1)) != int(item.get("object_id", -2)):
                    continue
                prev_raw = prev.get("cut_points")
                if not isinstance(prev_raw, list):
                    continue
                previous = {tuple(p) for p in prev_raw if isinstance(p, list) and len(p) >= 2}
                if len(previous) < 2:
                    continue
                overlap = len(current & previous) / max(1, min(len(current), len(previous)))
                if overlap >= 0.7:
                    duplicated = True
                    break
            if not duplicated:
                kept.append(item)
        return kept

    mask_outer = _build_mask_outer_from_step8()
    components = _extract_connected_components_4(mask_outer, width, height)
    # helper returns distance to foreground(=1). Invert mask to get distance from object pixel to background.
    inv_mask = bytearray(0 if value else 1 for value in mask_outer)
    dist_to_background = _cityblock_distance_from_mask(inv_mask, width, height)

    neck_threshold = _clamp_float(float(normalized_params.get("neck_threshold", 35.0)), 0.0, 100.0)
    min_split_area = max(1, _to_int(normalized_params.get("min_split_area"), 80))
    min_object_area = max(24, min_split_area * 2)

    candidates: list[dict[str, Any]] = []
    fallback_context: dict[str, Any] | None = None

    for object_id, component in enumerate(components, start=1):
        if len(component) < min_object_area:
            continue

        bbox = _step9_component_bbox(component, width)
        local_mask, local_w, local_h = _step9_local_component_mask(component, width, bbox)
        if local_w < 3 or local_h < 3:
            continue

        min_x, min_y, _, _ = bbox
        local_boundary_mask = _build_local_boundary_mask(local_mask, local_w, local_h)
        local_dt = [0] * (local_w * local_h)
        inside_dt_values: list[int] = []
        for y in range(local_h):
            gy = min_y + y
            grow = gy * width
            lrow = y * local_w
            for x in range(local_w):
                lidx = lrow + x
                if local_mask[lidx] == 0:
                    continue
                dist_value = max(1, dist_to_background[grow + (min_x + x)])
                local_dt[lidx] = dist_value
                inside_dt_values.append(dist_value)

        if not inside_dt_values:
            continue
        inside_dt_values.sort()
        percentile = _clamp_float(0.05 + (0.75 * (neck_threshold / 100.0)), 0.01, 0.95)
        threshold_index = int(round((len(inside_dt_values) - 1) * percentile))
        threshold_index = max(0, min(len(inside_dt_values) - 1, threshold_index))
        threshold_px = max(1, inside_dt_values[threshold_index])

        neck_binary = bytearray(local_w * local_h)
        for idx, dist_value in enumerate(local_dt):
            if local_mask[idx] and dist_value <= threshold_px:
                neck_binary[idx] = 1

        neck_paths = _skeleton_paths(neck_binary, local_w, local_h, limit=12)
        if fallback_context is None:
            fallback_context = {
                "object_id": object_id,
                "bbox": bbox,
                "local_mask": local_mask,
                "local_boundary_mask": local_boundary_mask,
                "local_w": local_w,
                "local_h": local_h,
                "neck_binary": neck_binary,
                "local_dt": local_dt,
            }
        seq = 0
        for path_local in neck_paths:
            validated = _validate_and_globalize_path(
                path_local,
                local_mask=local_mask,
                local_boundary_mask=local_boundary_mask,
                local_w=local_w,
                local_h=local_h,
                bbox=bbox,
            )
            if validated is None:
                continue
            can_split, split_count = _simulate_split_components(local_mask, local_w, local_h, path_local, min_split_area)
            if not can_split:
                continue
            path_global, length_px = validated
            seq += 1
            candidates.append(_make_candidate(object_id, "neck", seq, path_global, length_px, split_count))
            if seq >= 4:
                break

    candidates = _dedupe_lines(candidates)

    if not candidates:
        if fallback_context is None and components:
            largest_object_id, largest_component = max(enumerate(components, start=1), key=lambda item: len(item[1]))
            bbox = _step9_component_bbox(largest_component, width)
            local_mask, local_w, local_h = _step9_local_component_mask(largest_component, width, bbox)
            fallback_context = {
                "object_id": largest_object_id,
                "bbox": bbox,
                "local_mask": local_mask,
                "local_boundary_mask": _build_local_boundary_mask(local_mask, local_w, local_h),
                "local_w": local_w,
                "local_h": local_h,
                "neck_binary": bytearray(local_mask),
                "local_dt": [1 if value else 0 for value in local_mask],
            }

        if fallback_context is not None:
            object_id = int(fallback_context["object_id"])
            bbox = fallback_context["bbox"]
            local_mask = bytearray(fallback_context["local_mask"])
            local_boundary_mask = bytearray(fallback_context["local_boundary_mask"])
            local_w = int(fallback_context["local_w"])
            local_h = int(fallback_context["local_h"])
            neck_binary = bytearray(fallback_context["neck_binary"])
            local_dt = list(fallback_context["local_dt"])

            fallback_paths = _skeleton_paths(neck_binary, local_w, local_h, limit=4)
            if not fallback_paths:
                fallback_paths = _skeleton_paths(local_mask, local_w, local_h, limit=4)

            chosen_path: list[tuple[int, int]] = []
            for path_local in fallback_paths:
                validated = _validate_and_globalize_path(
                    path_local,
                    local_mask=local_mask,
                    local_boundary_mask=local_boundary_mask,
                    local_w=local_w,
                    local_h=local_h,
                    bbox=bbox,
                )
                if validated is None:
                    continue
                chosen_path = path_local
                break

            if not chosen_path:
                boundary_pixels: list[tuple[int, int]] = []
                for y in range(local_h):
                    row = y * local_w
                    for x in range(local_w):
                        idx = row + x
                        if local_mask[idx] and local_boundary_mask[idx]:
                            boundary_pixels.append((x, y))
                if len(boundary_pixels) >= 2:
                    # boundary pair farthest apart, but path is computed inside mask (not direct straight line).
                    start_local = boundary_pixels[0]
                    end_local = boundary_pixels[1]
                    best_pair_distance = -1.0
                    for i in range(min(len(boundary_pixels), 120)):
                        ax, ay = boundary_pixels[i]
                        for j in range(i + 1, min(len(boundary_pixels), 120)):
                            bx, by = boundary_pixels[j]
                            dist = (ax - bx) * (ax - bx) + (ay - by) * (ay - by)
                            if dist > best_pair_distance:
                                best_pair_distance = float(dist)
                                start_local = (ax, ay)
                                end_local = (bx, by)
                    total = local_w * local_h
                    pixel_costs = [5.0] * total
                    max_dt = max((value for idx, value in enumerate(local_dt) if local_mask[idx]), default=1)
                    for idx in range(total):
                        if local_mask[idx] == 0:
                            continue
                        dt_norm = local_dt[idx] / max(1.0, float(max_dt))
                        pixel_costs[idx] = 1.6 - dt_norm
                    chosen_path = _step9_compress_polyline(
                        _step9_dijkstra_path(local_mask, local_w, local_h, start_local, end_local, pixel_costs)
                    )

            validated = _validate_and_globalize_path(
                chosen_path,
                local_mask=local_mask,
                local_boundary_mask=local_boundary_mask,
                local_w=local_w,
                local_h=local_h,
                bbox=bbox,
            )
            if validated is not None:
                path_global, length_px = validated
                candidates = [_make_candidate(object_id, "neck_fallback", 1, path_global, max(length_px, 1.0), 0)]
            elif len(chosen_path) >= 2:
                min_x, min_y, _, _ = bbox
                sanitized_local: list[tuple[int, int]] = []
                seen_local: set[tuple[int, int]] = set()
                for x, y in chosen_path:
                    if not (0 <= x < local_w and 0 <= y < local_h):
                        continue
                    if local_mask[(y * local_w) + x] == 0:
                        continue
                    point = (x, y)
                    if point in seen_local:
                        continue
                    seen_local.add(point)
                    sanitized_local.append(point)
                sanitized_local = _step9_compress_polyline(sanitized_local)
                if len(sanitized_local) >= 2:
                    path_global = [(min_x + x, min_y + y) for x, y in sanitized_local]
                    candidates = [
                        _make_candidate(
                            object_id,
                            "neck_fallback",
                            1,
                            path_global,
                            max(_polyline_length(sanitized_local), 1.0),
                            0,
                        )
                    ]

    candidates.sort(
        key=lambda item: (
            int(item.get("object_id", 0)),
            float(item.get("_sort_length", 0.0)),
            str(item.get("candidate_id", "")),
        )
    )
    for item in candidates:
        item.pop("_sort_length", None)

    return candidates, {
        "image_width": width,
        "image_height": height,
        "cut_count": len(candidates),
        "neck_threshold": float(neck_threshold),
        "min_split_area": int(min_split_area),
    }


def _load_step8_contours_payload_for_run(
    session: Session,
    run: Run,
    requested_step8_artifact_id: str | None = None,
) -> tuple[str | None, dict[str, Any] | None]:
    step8_artifact: StepArtifact | None = None
    if isinstance(requested_step8_artifact_id, str) and requested_step8_artifact_id.strip():
        candidate = session.get(StepArtifact, requested_step8_artifact_id.strip())
        if candidate is not None and candidate.run_id == run.id and int(candidate.step_id) == 8:
            step8_artifact = candidate
    if step8_artifact is None:
        step8_artifact = _latest_step_artifact(session, run.id, 8)
    if step8_artifact is None:
        return None, None
    json_rel_path = _artifact_json_path_by_keywords(step8_artifact, ["contours"])
    if not json_rel_path:
        return step8_artifact.id, None
    json_abs_path = storage_service.resolve(json_rel_path)
    if not json_abs_path.exists():
        return step8_artifact.id, None
    try:
        payload = json.loads(json_abs_path.read_text(encoding="utf-8"))
    except Exception:
        payload = None
    if not isinstance(payload, dict):
        return step8_artifact.id, None
    return step8_artifact.id, payload


def _labels_to_uint16_image(labels: list[int], width: int, height: int) -> Image.Image:
    output = bytearray(width * height * 2)
    write_index = 0
    for value in labels:
        clamped = 0 if value <= 0 else min(int(value), 65535)
        output[write_index] = clamped & 0xFF
        output[write_index + 1] = (clamped >> 8) & 0xFF
        write_index += 2
    return Image.frombytes("I;16", (width, height), bytes(output))


def _step9_build_mask_outer_from_step8(
    base_mask: bytearray,
    width: int,
    height: int,
    step8_contours_payload: dict[str, Any] | None,
) -> bytearray:
    contours = step8_contours_payload.get("contours") if isinstance(step8_contours_payload, dict) else None
    if not isinstance(contours, list) or not contours:
        return bytearray(base_mask)

    image = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(image)
    drawn = 0
    for contour in contours:
        if not isinstance(contour, dict):
            continue
        if str(contour.get("kind", "solid")) == "pore":
            continue
        points_raw = contour.get("points")
        if not isinstance(points_raw, list) or len(points_raw) < 3:
            continue
        points: list[tuple[int, int]] = []
        for point in points_raw:
            if not isinstance(point, list) or len(point) < 2:
                continue
            x = _clamp_int(_to_int(point[0]), 0, width - 1)
            y = _clamp_int(_to_int(point[1]), 0, height - 1)
            points.append((x, y))
        if len(points) < 3:
            continue
        draw.polygon(points, fill=255)
        drawn += 1

    if drawn <= 0:
        return bytearray(base_mask)
    return _binary_image_to_mask(_normalize_binary_mask_image(image))


def _step9_find_seed_peaks(
    mask: bytearray,
    dist_map: list[int],
    width: int,
    height: int,
    min_seed_distance_px: int,
    seed_h: float,
) -> list[tuple[int, int]]:
    if width < 1 or height < 1:
        return []
    min_peak_value = max(1, int(round(seed_h)))
    candidates: list[tuple[int, int, int]] = []

    for y in range(height):
        row = y * width
        for x in range(width):
            idx = row + x
            if mask[idx] == 0:
                continue
            value = dist_map[idx]
            if value < min_peak_value:
                continue
            is_local_max = True
            has_strict_drop = False
            for ny in range(max(0, y - 1), min(height, y + 2)):
                nrow = ny * width
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    if nx == x and ny == y:
                        continue
                    nidx = nrow + nx
                    if mask[nidx] == 0:
                        continue
                    nvalue = dist_map[nidx]
                    if nvalue > value:
                        is_local_max = False
                        break
                    if nvalue < value:
                        has_strict_drop = True
                if not is_local_max:
                    break
            if is_local_max and has_strict_drop:
                candidates.append((value, x, y))

    candidates.sort(key=lambda item: (-item[0], item[2], item[1]))
    selected: list[tuple[int, int]] = []
    min_dist_sq = float(min_seed_distance_px * min_seed_distance_px)
    for _, x, y in candidates:
        blocked = False
        for sx, sy in selected:
            dx = float(sx - x)
            dy = float(sy - y)
            if (dx * dx) + (dy * dy) < min_dist_sq:
                blocked = True
                break
        if blocked:
            continue
        selected.append((x, y))
    return selected


def _step9_label_connected_components(mask: bytearray, width: int, height: int) -> tuple[list[int], int]:
    labels = [0] * (width * height)
    components = _extract_connected_components_4(mask, width, height)
    for label_id, component in enumerate(components, start=1):
        for index in component:
            labels[index] = label_id
    return labels, len(components)


def _step9_build_gradient_scores(gray_image: Image.Image, width: int, height: int) -> list[float]:
    gray = gray_image.convert("L")
    if gray.size != (width, height):
        gray = gray.resize((width, height), Image.Resampling.BILINEAR)
    return _compute_sobel_magnitude(gray.tobytes(), width, height)


def _step9_run_watershed_labels(
    mask: bytearray,
    dist_map: list[int],
    width: int,
    height: int,
    markers: list[tuple[int, int]],
    edge_scores: list[float] | None,
    edge_weight: float,
) -> tuple[list[int], int]:
    total = width * height
    labels = [0] * total
    if not markers:
        return labels, 0

    max_dist = max((dist_map[index] for index in range(total) if mask[index]), default=1)
    if max_dist <= 0:
        max_dist = 1
    max_edge = max(edge_scores) if edge_scores else 0.0

    def _elevation(index: int) -> float:
        if mask[index] == 0:
            return 10.0
        base = 1.0 - (float(dist_map[index]) / float(max_dist))
        if edge_scores is None or max_edge <= 1e-9 or edge_weight <= 0.0:
            return base
        edge_norm = min(1.0, edge_scores[index] / max_edge)
        return base + (edge_weight * edge_norm)

    best_cost = [float("inf")] * total
    heap: list[tuple[float, int, int]] = []

    for label_id, (x, y) in enumerate(markers, start=1):
        if not (0 <= x < width and 0 <= y < height):
            continue
        index = (y * width) + x
        if mask[index] == 0:
            continue
        labels[index] = label_id
        cost = _elevation(index)
        if cost < best_cost[index]:
            best_cost[index] = cost
        heapq.heappush(heap, (cost, label_id, index))

    while heap:
        cost, label_id, index = heapq.heappop(heap)
        if cost > best_cost[index] + 1e-12:
            continue
        if labels[index] != label_id:
            continue
        x = index % width
        y = index // width
        for ny in range(max(0, y - 1), min(height, y + 2)):
            row = ny * width
            for nx in range(max(0, x - 1), min(width, x + 2)):
                nidx = row + nx
                if nidx == index or mask[nidx] == 0:
                    continue
                next_cost = max(cost, _elevation(nidx))
                if labels[nidx] == 0:
                    if next_cost + 1e-12 < best_cost[nidx]:
                        labels[nidx] = label_id
                        best_cost[nidx] = next_cost
                        heapq.heappush(heap, (next_cost, label_id, nidx))
                    continue
                if labels[nidx] == label_id:
                    if next_cost + 1e-12 < best_cost[nidx]:
                        best_cost[nidx] = next_cost
                        heapq.heappush(heap, (next_cost, label_id, nidx))

    # Any unlabeled mask pixels are assigned to nearest labeled neighbor by BFS fallback.
    queue: deque[int] = deque(index for index in range(total) if mask[index] and labels[index] > 0)
    visited = bytearray(1 if labels[index] > 0 else 0 for index in range(total))
    while queue:
        index = queue.popleft()
        label_id = labels[index]
        x = index % width
        y = index // width
        for ny in range(max(0, y - 1), min(height, y + 2)):
            row = ny * width
            for nx in range(max(0, x - 1), min(width, x + 2)):
                nidx = row + nx
                if nidx == index or visited[nidx] or mask[nidx] == 0:
                    continue
                labels[nidx] = label_id
                visited[nidx] = 1
                queue.append(nidx)

    label_count = len({label for label in labels if label > 0})
    return labels, label_count


def _step9_extract_split_lines_from_labels(labels: list[int], mask: bytearray, width: int, height: int) -> list[dict[str, Any]]:
    total = width * height
    boundary_mask = bytearray(total)
    outer_boundary_mask = bytearray(total)
    for y in range(height):
        row = y * width
        for x in range(width):
            idx = row + x
            if mask[idx] == 0:
                continue
            if x == 0 or x == width - 1 or y == 0 or y == height - 1:
                outer_boundary_mask[idx] = 1
                continue
            if (
                mask[idx - 1] == 0
                or mask[idx + 1] == 0
                or mask[idx - width] == 0
                or mask[idx + width] == 0
            ):
                outer_boundary_mask[idx] = 1
    for y in range(height):
        row = y * width
        for x in range(width):
            idx = row + x
            current_label = labels[idx]
            if current_label <= 0 or mask[idx] == 0:
                continue
            if x + 1 < width:
                right = idx + 1
                if mask[right] and labels[right] > 0 and labels[right] != current_label:
                    boundary_mask[idx] = 1
                    boundary_mask[right] = 1
            if y + 1 < height:
                down = idx + width
                if mask[down] and labels[down] > 0 and labels[down] != current_label:
                    boundary_mask[idx] = 1
                    boundary_mask[down] = 1

    def _thin(mask_binary: bytearray, w: int, h: int) -> bytearray:
        if w < 3 or h < 3:
            return bytearray(mask_binary)
        out = bytearray(1 if value else 0 for value in mask_binary)
        changed = True
        guard = 0
        max_iter = max(32, (w * h) // 2)

        def _neighbors(ix: int, iy: int) -> tuple[int, int, int, int, int, int, int, int]:
            p2 = out[((iy - 1) * w) + ix]
            p3 = out[((iy - 1) * w) + (ix + 1)]
            p4 = out[(iy * w) + (ix + 1)]
            p5 = out[((iy + 1) * w) + (ix + 1)]
            p6 = out[((iy + 1) * w) + ix]
            p7 = out[((iy + 1) * w) + (ix - 1)]
            p8 = out[(iy * w) + (ix - 1)]
            p9 = out[((iy - 1) * w) + (ix - 1)]
            return p2, p3, p4, p5, p6, p7, p8, p9

        while changed and guard < max_iter:
            guard += 1
            changed = False
            for substep in (0, 1):
                to_remove: list[int] = []
                for y in range(1, h - 1):
                    row = y * w
                    for x in range(1, w - 1):
                        idx = row + x
                        if out[idx] == 0:
                            continue
                        p2, p3, p4, p5, p6, p7, p8, p9 = _neighbors(x, y)
                        arr = [p2, p3, p4, p5, p6, p7, p8, p9]
                        b = sum(arr)
                        if b < 2 or b > 6:
                            continue
                        seq = arr + [arr[0]]
                        a = 0
                        for i in range(8):
                            if seq[i] == 0 and seq[i + 1] == 1:
                                a += 1
                        if a != 1:
                            continue
                        if substep == 0:
                            if p2 * p4 * p6 != 0 or p4 * p6 * p8 != 0:
                                continue
                        else:
                            if p2 * p4 * p8 != 0 or p2 * p6 * p8 != 0:
                                continue
                        to_remove.append(idx)
                if to_remove:
                    changed = True
                    for idx in to_remove:
                        out[idx] = 0
        return out

    def _extract_components_8(mask_binary: bytearray, w: int, h: int) -> list[list[int]]:
        visited = bytearray(w * h)
        comps: list[list[int]] = []
        for start in range(w * h):
            if visited[start] or mask_binary[start] == 0:
                continue
            q: deque[int] = deque([start])
            visited[start] = 1
            comp: list[int] = []
            while q:
                idx = q.popleft()
                comp.append(idx)
                x = idx % w
                y = idx // w
                for ny in range(max(0, y - 1), min(h, y + 2)):
                    row = ny * w
                    for nx in range(max(0, x - 1), min(w, x + 2)):
                        nidx = row + nx
                        if nidx == idx or visited[nidx] or mask_binary[nidx] == 0:
                            continue
                        visited[nidx] = 1
                        q.append(nidx)
            if comp:
                comps.append(comp)
        return comps

    def _longest_path(component_nodes: list[int], w: int, h: int) -> list[tuple[int, int]]:
        if len(component_nodes) < 2:
            return []
        node_set = set(component_nodes)

        def _nbrs(idx: int) -> list[int]:
            x = idx % w
            y = idx // w
            out: list[int] = []
            for ny in range(max(0, y - 1), min(h, y + 2)):
                row = ny * w
                for nx in range(max(0, x - 1), min(w, x + 2)):
                    nidx = row + nx
                    if nidx == idx or nidx not in node_set:
                        continue
                    out.append(nidx)
            return out

        def _bfs(start: int) -> tuple[int, dict[int, int], dict[int, int]]:
            q: deque[int] = deque([start])
            dist = {start: 0}
            prev = {start: -1}
            far = start
            while q:
                cur = q.popleft()
                if dist[cur] > dist[far]:
                    far = cur
                for nidx in _nbrs(cur):
                    if nidx in dist:
                        continue
                    dist[nidx] = dist[cur] + 1
                    prev[nidx] = cur
                    q.append(nidx)
            return far, prev, dist

        first = component_nodes[0]
        far1, _, _ = _bfs(first)
        far2, prev, dist = _bfs(far1)
        if far2 not in dist:
            return []
        nodes: list[int] = []
        cur = far2
        while cur != -1:
            nodes.append(cur)
            if cur == far1:
                break
            cur = prev.get(cur, -1)
        nodes.reverse()
        return [(node % w, node // w) for node in nodes]

    def _path_to_outer_boundary(start: tuple[int, int]) -> list[tuple[int, int]]:
        sx, sy = start
        if not (0 <= sx < width and 0 <= sy < height):
            return []
        start_idx = (sy * width) + sx
        if mask[start_idx] == 0:
            return []
        if outer_boundary_mask[start_idx]:
            return [start]

        visited = bytearray(total)
        prev = [-1] * total
        q: deque[int] = deque([start_idx])
        visited[start_idx] = 1
        target_idx = -1

        while q:
            idx = q.popleft()
            if outer_boundary_mask[idx]:
                target_idx = idx
                break
            x = idx % width
            y = idx // width
            for ny in range(max(0, y - 1), min(height, y + 2)):
                row = ny * width
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    nidx = row + nx
                    if nidx == idx or visited[nidx] or mask[nidx] == 0:
                        continue
                    visited[nidx] = 1
                    prev[nidx] = idx
                    q.append(nidx)

        if target_idx < 0:
            return []

        path_indices: list[int] = []
        cur = target_idx
        guard = 0
        while cur >= 0 and guard < (total + 2):
            guard += 1
            path_indices.append(cur)
            if cur == start_idx:
                break
            cur = prev[cur]
        if not path_indices or path_indices[-1] != start_idx:
            return []
        path_indices.reverse()  # start -> boundary
        return [(idx % width, idx // width) for idx in path_indices]

    thinned = _thin(boundary_mask, width, height)
    comps = _extract_components_8(thinned, width, height)
    lines: list[dict[str, Any]] = []
    next_id = 1
    for comp in comps:
        path = _step9_compress_polyline(_longest_path(comp, width, height))
        if len(path) < 2:
            continue
        start_extension = _path_to_outer_boundary(path[0])
        end_extension = _path_to_outer_boundary(path[-1])
        if len(start_extension) < 1 or len(end_extension) < 1:
            continue
        merged_path = list(reversed(start_extension[:-1])) + path + end_extension[1:]
        merged_path = _step9_compress_polyline(merged_path)
        if len(merged_path) < 2:
            continue
        start_idx = (merged_path[0][1] * width) + merged_path[0][0]
        end_idx = (merged_path[-1][1] * width) + merged_path[-1][0]
        if not outer_boundary_mask[start_idx] or not outer_boundary_mask[end_idx]:
            continue
        min_x = min(point[0] for point in merged_path)
        min_y = min(point[1] for point in merged_path)
        max_x = max(point[0] for point in merged_path)
        max_y = max(point[1] for point in merged_path)
        length_px = 0.0
        for i in range(1, len(merged_path)):
            ax, ay = merged_path[i - 1]
            bx, by = merged_path[i]
            length_px += math.hypot(float(bx - ax), float(by - ay))
        lines.append(
            {
                "id": next_id,
                "bbox": [int(min_x), int(min_y), int(max_x - min_x + 1), int(max_y - min_y + 1)],
                "points": [[int(x), int(y)] for x, y in merged_path],
                "length_px": round(length_px, 2),
            }
        )
        next_id += 1
    return lines


def _step9_run_concave_split_pipeline(
    base_mask_image: Image.Image,
    gray_image: Image.Image | None,
    normalized_params: dict[str, Any],
    step8_contours_payload: dict[str, Any] | None,
) -> dict[str, Any]:
    del gray_image, step8_contours_payload

    mask_image = _normalize_binary_mask_image(base_mask_image.convert("L"))
    width, height = mask_image.size
    base_mask = _binary_image_to_mask(mask_image)
    final_mask = bytearray(base_mask)
    concave_sensitivity = _clamp_float(float(normalized_params.get("concave_sensitivity", 55.0)), 0.0, 100.0)

    components = _extract_connected_components_4(base_mask, width, height)
    all_cut_records: list[dict[str, Any]] = []
    applied_cut_records: list[dict[str, Any]] = []
    all_vertices: list[dict[str, Any]] = []

    def _moving_average_closed(points: list[tuple[int, int]], window: int = 7) -> list[tuple[float, float]]:
        if len(points) == 0:
            return []
        n = len(points)
        radius = max(1, window // 2)
        smoothed: list[tuple[float, float]] = []
        for i in range(n):
            sx = 0.0
            sy = 0.0
            count = 0
            for k in range(-radius, radius + 1):
                x, y = points[(i + k) % n]
                sx += float(x)
                sy += float(y)
                count += 1
            smoothed.append((sx / count, sy / count))
        return smoothed

    def _boundary_mask(local_mask: bytearray, local_w: int, local_h: int) -> bytearray:
        result = bytearray(local_w * local_h)
        for y in range(local_h):
            row = y * local_w
            for x in range(local_w):
                idx = row + x
                if local_mask[idx] == 0:
                    continue
                if x == 0 or y == 0 or x == local_w - 1 or y == local_h - 1:
                    result[idx] = 1
                    continue
                if (
                    local_mask[idx - 1] == 0
                    or local_mask[idx + 1] == 0
                    or local_mask[idx - local_w] == 0
                    or local_mask[idx + local_w] == 0
                ):
                    result[idx] = 1
        return result

    def _nearest_boundary_pixel_to_vertex(
        vertex_x: int,
        vertex_y: int,
        local_mask: bytearray,
        local_boundary: bytearray,
        local_w: int,
        local_h: int,
    ) -> tuple[int, int] | None:
        candidates = [
            (vertex_x - 1, vertex_y - 1),
            (vertex_x - 1, vertex_y),
            (vertex_x, vertex_y - 1),
            (vertex_x, vertex_y),
            (vertex_x + 1, vertex_y),
            (vertex_x, vertex_y + 1),
        ]
        for x, y in candidates:
            if not (0 <= x < local_w and 0 <= y < local_h):
                continue
            idx = (y * local_w) + x
            if local_mask[idx] and local_boundary[idx]:
                return (x, y)
        for x, y in candidates:
            if not (0 <= x < local_w and 0 <= y < local_h):
                continue
            idx = (y * local_w) + x
            if local_mask[idx]:
                return (x, y)
        return None

    def _bresenham_line(x0: int, y0: int, x1: int, y1: int) -> list[tuple[int, int]]:
        points: list[tuple[int, int]] = []
        dx = abs(x1 - x0)
        dy = -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        x = x0
        y = y0
        while True:
            points.append((x, y))
            if x == x1 and y == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x += sx
            if e2 <= dx:
                err += dx
                y += sy
        return points

    def _largest_inside_segment(line_points: list[tuple[int, int]], local_mask: bytearray, local_w: int, local_h: int) -> list[tuple[int, int]]:
        best: list[tuple[int, int]] = []
        current: list[tuple[int, int]] = []
        for x, y in line_points:
            if 0 <= x < local_w and 0 <= y < local_h and local_mask[(y * local_w) + x]:
                current.append((x, y))
            else:
                if len(current) > len(best):
                    best = current
                current = []
        if len(current) > len(best):
            best = current
        return _step9_compress_polyline(best)

    def _erase_line_thickness(local_mask: bytearray, local_w: int, local_h: int, line_points: list[tuple[int, int]], radius: int = 1) -> bytearray:
        out = bytearray(local_mask)
        for x, y in line_points:
            for ny in range(max(0, y - radius), min(local_h, y + radius + 1)):
                row = ny * local_w
                for nx in range(max(0, x - radius), min(local_w, x + radius + 1)):
                    if (nx - x) * (nx - x) + (ny - y) * (ny - y) <= (radius + 0.3) * (radius + 0.3):
                        out[row + nx] = 0
        return out

    def _local_component_count(local_mask: bytearray, local_w: int, local_h: int) -> tuple[int, list[list[int]]]:
        comps = _extract_connected_components_4(local_mask, local_w, local_h)
        return len(comps), comps

    def _polyline_length(points: list[tuple[int, int]]) -> float:
        total = 0.0
        for i in range(1, len(points)):
            ax, ay = points[i - 1]
            bx, by = points[i]
            total += math.hypot(float(bx - ax), float(by - ay))
        return total

    for object_id, component in enumerate(components, start=1):
        if len(component) < 25:
            continue

        bbox = _step9_component_bbox(component, width)
        min_x, min_y, _, _ = bbox
        local_mask_original, local_w, local_h = _step9_local_component_mask(component, width, bbox)
        if local_w < 3 or local_h < 3:
            continue

        loops = _component_boundary_loops(component, width, height)
        if not loops:
            continue
        outer_loop_global = max(loops, key=lambda loop: abs(_polygon_area(loop)))
        if len(outer_loop_global) < 8:
            continue

        # Global contour vertex points (axis-aligned polygon vertices)
        contour_points = [(int(x), int(y)) for x, y in outer_loop_global]
        smooth = _moving_average_closed(contour_points, window=7)
        orient_sign = 1.0 if _polygon_area(contour_points) >= 0 else -1.0
        angle_threshold_deg = _clamp_float(70.0 - (concave_sensitivity * 0.55), 10.0, 80.0)
        offset = 3
        n = len(contour_points)

        concave_flags = [False] * n
        for i in range(n):
            px, py = smooth[(i - offset) % n]
            cx, cy = smooth[i]
            nx, ny = smooth[(i + offset) % n]
            v1x = cx - px
            v1y = cy - py
            v2x = nx - cx
            v2y = ny - cy
            norm1 = math.hypot(v1x, v1y)
            norm2 = math.hypot(v2x, v2y)
            if norm1 <= 1e-6 or norm2 <= 1e-6:
                continue
            cross = (v1x * v2y) - (v1y * v2x)
            dot = (v1x * v2x) + (v1y * v2y)
            cos_theta = _clamp_float(dot / max(norm1 * norm2, 1e-9), -1.0, 1.0)
            angle_deg = math.degrees(math.acos(cos_theta))
            is_concave = (cross * orient_sign) < 0
            if is_concave and angle_deg >= angle_threshold_deg:
                concave_flags[i] = True

        # Circular grouping
        groups: list[list[int]] = []
        visited = [False] * n
        for i in range(n):
            if visited[i] or not concave_flags[i]:
                continue
            group: list[int] = []
            j = i
            while not visited[j] and concave_flags[j]:
                visited[j] = True
                group.append(j)
                j = (j + 1) % n
            groups.append(group)
        if len(groups) >= 2 and concave_flags[0] and concave_flags[-1]:
            first = None
            last = None
            for idx, group in enumerate(groups):
                if 0 in group:
                    first = idx
                if (n - 1) in group:
                    last = idx
            if first is not None and last is not None and first != last:
                merged = groups[last] + groups[first]
                new_groups = [group for idx, group in enumerate(groups) if idx not in {first, last}]
                new_groups.append(sorted({int(v) for v in merged}, key=lambda v: ((v - merged[0]) % n)))
                groups = new_groups

        representatives: list[tuple[int, int]] = []
        for group in groups:
            if not group:
                continue
            # group length in px along smoothed contour
            length_px = 0.0
            ordered = sorted(group, key=lambda idx: idx)
            for idx in range(1, len(ordered)):
                ax, ay = smooth[ordered[idx - 1]]
                bx, by = smooth[ordered[idx]]
                length_px += math.hypot(bx - ax, by - ay)
            if length_px < 10.0:
                continue
            center_index = ordered[len(ordered) // 2]
            vx, vy = contour_points[center_index]
            representatives.append((vx, vy))

        for vertex_index, (vx, vy) in enumerate(representatives, start=1):
            all_vertices.append(
                {
                    "id": f"obj{int(object_id)}_v{vertex_index}",
                    "object_id": int(object_id),
                    "x": int(vx),
                    "y": int(vy),
                }
            )

        if len(representatives) < 2:
            continue

        local_mask_current = bytearray(local_mask_original)
        local_boundary_current = _boundary_mask(local_mask_current, local_w, local_h)
        pair_candidates: list[dict[str, Any]] = []
        for i in range(len(representatives)):
            axg, ayg = representatives[i]
            for j in range(i + 1, len(representatives)):
                bxg, byg = representatives[j]
                dist = math.hypot(float(bxg - axg), float(byg - ayg))
                if dist < 8.0:
                    continue
                a_local = _nearest_boundary_pixel_to_vertex(axg - min_x, ayg - min_y, local_mask_current, local_boundary_current, local_w, local_h)
                b_local = _nearest_boundary_pixel_to_vertex(bxg - min_x, byg - min_y, local_mask_current, local_boundary_current, local_w, local_h)
                if a_local is None or b_local is None or a_local == b_local:
                    continue
                line = _bresenham_line(a_local[0], a_local[1], b_local[0], b_local[1])
                segment = _largest_inside_segment(line, local_mask_current, local_w, local_h)
                if len(segment) < 2:
                    continue
                p1 = segment[0]
                p2 = segment[-1]
                pair_candidates.append(
                    {
                        "a_global": (min_x + p1[0], min_y + p1[1]),
                        "b_global": (min_x + p2[0], min_y + p2[1]),
                        "segment_local": segment,
                        "length_px": _polyline_length(segment),
                    }
                )

        pair_candidates.sort(key=lambda item: (float(item["length_px"]), item["a_global"], item["b_global"]))

        for candidate in pair_candidates:
            segment_local = candidate["segment_local"]
            before_count, _ = _local_component_count(local_mask_current, local_w, local_h)
            erased = _erase_line_thickness(local_mask_current, local_w, local_h, segment_local, radius=1)
            after_count, after_components = _local_component_count(erased, local_w, local_h)
            valid = after_count > before_count and after_count >= 2
            cut_record = {
                "object_id": int(object_id),
                "p1": [int(candidate["a_global"][0]), int(candidate["a_global"][1])],
                "p2": [int(candidate["b_global"][0]), int(candidate["b_global"][1])],
                "length_px": round(float(candidate["length_px"]), 2),
                "valid": bool(valid),
                "splits_into": int(after_count if valid else before_count),
                "cut_points": [[int(min_x + x), int(min_y + y)] for x, y in segment_local],
            }
            all_cut_records.append(cut_record)
            if not valid:
                continue
            local_mask_current = erased
            local_boundary_current = _boundary_mask(local_mask_current, local_w, local_h)
            applied_cut_records.append(cut_record)
            # keep cumulative application; continue checking remaining short cuts on updated mask

        # write back processed local object mask to final mask
        for y in range(local_h):
            gy = min_y + y
            grow = gy * width
            lrow = y * local_w
            for x in range(local_w):
                if local_mask_original[lrow + x] == 0:
                    continue
                final_mask[grow + (min_x + x)] = 1 if local_mask_current[lrow + x] else 0

    labels, label_count = _step9_label_connected_components(final_mask, width, height)
    split_lines = _step9_extract_split_lines_from_labels(labels, final_mask, width, height)

    return {
        "image_width": width,
        "image_height": height,
        "labels": labels,
        "label_count": int(label_count),
        "split_mask": final_mask,
        "split_lines": split_lines,
        "cuts": all_cut_records,
        "vertices": all_vertices,
        "applied_cut_count": sum(1 for item in all_cut_records if bool(item.get("valid"))),
        "used_gray_edge": False,
    }


def _step9_render_preview_image(
    gray_image: Image.Image,
    cuts: list[dict[str, Any]],
    step8_contours_payload: dict[str, Any] | None,
) -> Image.Image:
    preview = gray_image.convert("L").convert("RGB")
    draw = ImageDraw.Draw(preview)

    contours = step8_contours_payload.get("contours") if isinstance(step8_contours_payload, dict) else None
    if isinstance(contours, list):
        for contour in contours:
            if not isinstance(contour, dict):
                continue
            points = contour.get("points")
            if not isinstance(points, list) or len(points) < 2:
                continue
            parsed_points: list[tuple[int, int]] = []
            for point in points:
                if not isinstance(point, list) or len(point) < 2:
                    continue
                parsed_points.append((_to_int(point[0]), _to_int(point[1])))
            if len(parsed_points) >= 2:
                draw.line(parsed_points + [parsed_points[0]], fill=(34, 197, 94), width=1)

    for cut in cuts:
        points_raw = cut.get("cut_points")
        if not isinstance(points_raw, list) or len(points_raw) < 2:
            continue
        parsed_points = []
        for point in points_raw:
            if not isinstance(point, list) or len(point) < 2:
                continue
            parsed_points.append((_to_int(point[0]), _to_int(point[1])))
        if len(parsed_points) >= 2:
            draw.line(parsed_points, fill=(239, 68, 68), width=2)

    return preview


def create_step9_preview_payload(
    session: Session,
    run: Run,
    params: dict[str, Any],
) -> dict[str, Any]:
    _validate_step_prerequisite(session, run.id, 9)
    normalized_params = _normalize_step9_params(params)
    step8_artifact_id, step8_contours_payload = _load_step8_contours_payload_for_run(
        session,
        run,
        normalized_params.get("step8_artifact_id"),
    )
    if step8_artifact_id is None or not isinstance(step8_contours_payload, dict):
        raise ValueError("먼저 8단계 윤곽선이 필요합니다.")

    polygons_payload = _step9_polygonize_contours_payload(step8_contours_payload, normalized_params)
    polygons_payload["step8_artifact_id"] = step8_artifact_id
    polygons_payload["params"] = {
        "smooth_level": normalized_params["smooth_level"],
        "resample_step_px": normalized_params["resample_step_px"],
        "max_vertex_gap_px": normalized_params["max_vertex_gap_px"],
    }
    return polygons_payload


def _normalize_step10_params(params: dict[str, Any]) -> dict[str, Any]:
    step9_artifact_id = params.get("step9_artifact_id")
    step3_artifact_id = params.get("step3_artifact_id")
    return {
        "split_strength": _clamp_float(float(_to_float(params.get("split_strength"), 50.0) or 50.0), 0.0, 100.0),
        "min_center_distance_px": _clamp_int(_to_int(params.get("min_center_distance_px"), 18), 1, 512),
        "min_particle_area": _clamp_int(_to_int(params.get("min_particle_area"), 30), 1, 10_000_000),
        "step9_artifact_id": step9_artifact_id.strip() if isinstance(step9_artifact_id, str) and step9_artifact_id.strip() else None,
        "step3_artifact_id": step3_artifact_id.strip() if isinstance(step3_artifact_id, str) and step3_artifact_id.strip() else None,
    }


def _load_step9_polygons_payload_for_run(
    session: Session,
    run: Run,
    requested_step9_artifact_id: str | None = None,
) -> tuple[str | None, dict[str, Any] | None]:
    step9_artifact: StepArtifact | None = None
    if isinstance(requested_step9_artifact_id, str) and requested_step9_artifact_id.strip():
        candidate = session.get(StepArtifact, requested_step9_artifact_id.strip())
        if candidate is not None and candidate.run_id == run.id and int(candidate.step_id) == 9:
            step9_artifact = candidate
    if step9_artifact is None:
        step9_artifact = _latest_step_artifact(session, run.id, 9)
    if step9_artifact is None:
        return None, None

    json_rel_path = _artifact_json_path_by_keywords(step9_artifact, ["polygons"])
    if not json_rel_path:
        return step9_artifact.id, None
    json_abs_path = storage_service.resolve(json_rel_path)
    if not json_abs_path.exists():
        return step9_artifact.id, None
    try:
        payload = json.loads(json_abs_path.read_text(encoding="utf-8"))
    except Exception:
        payload = None
    if not isinstance(payload, dict):
        return step9_artifact.id, None
    return step9_artifact.id, payload


def _resolve_step10_inputs(
    session: Session,
    run: Run,
    image: ImageAsset,
    normalized_params: dict[str, Any],
) -> dict[str, Any]:
    _validate_step_prerequisite(session, run.id, 10)

    step9_artifact_id, step9_polygons_payload = _load_step9_polygons_payload_for_run(
        session,
        run,
        normalized_params.get("step9_artifact_id"),
    )
    if step9_artifact_id is None or not isinstance(step9_polygons_payload, dict):
        raise ValueError("먼저 9단계 폴리곤이 필요합니다.")

    step3_artifact: StepArtifact | None = None
    requested_step3_artifact_id = normalized_params.get("step3_artifact_id")
    if isinstance(requested_step3_artifact_id, str) and requested_step3_artifact_id:
        candidate = session.get(StepArtifact, requested_step3_artifact_id)
        if candidate is not None and candidate.run_id == run.id and int(candidate.step_id) == 3:
            step3_artifact = candidate
    if step3_artifact is None:
        step3_artifact = _latest_step_artifact(session, run.id, 3)
    step3_image_rel_path = _artifact_first_image_path(step3_artifact)
    if step3_artifact is None or not step3_image_rel_path:
        step3_artifact = None
        step3_image_rel_path = None
    elif not storage_service.resolve(step3_image_rel_path).exists():
        step3_artifact = None
        step3_image_rel_path = None

    preview_bg_rel_path = step3_image_rel_path
    preview_bg_artifact_id: str | None = step3_artifact.id if step3_artifact is not None and step3_image_rel_path else None
    if not preview_bg_rel_path:
        step1_artifact = _latest_step_artifact(session, run.id, 1)
        preview_bg_rel_path = _artifact_first_image_path(step1_artifact) if step1_artifact is not None else None
        preview_bg_artifact_id = step1_artifact.id if step1_artifact is not None and preview_bg_rel_path else None
    if not preview_bg_rel_path or not storage_service.resolve(preview_bg_rel_path).exists():
        preview_bg_rel_path = image.storage_path
        preview_bg_artifact_id = None

    return {
        "step9_artifact_id": step9_artifact_id,
        "step9_polygons_payload": step9_polygons_payload,
        "step3_artifact_id": step3_artifact.id if step3_artifact is not None else None,
        "step3_image_rel_path": step3_image_rel_path,
        "preview_bg_rel_path": preview_bg_rel_path,
        "preview_bg_artifact_id": preview_bg_artifact_id,
    }


def _step10_signed_area(points: list[tuple[float, float]]) -> float:
    if len(points) < 3:
        return 0.0
    total = 0.0
    for idx, (x1, y1) in enumerate(points):
        x2, y2 = points[(idx + 1) % len(points)]
        total += (x1 * y2) - (x2 * y1)
    return total / 2.0


def _step10_polygon_bbox(points: list[tuple[float, float]], width: int, height: int) -> tuple[int, int, int, int]:
    min_x = max(0, min(int(math.floor(point[0])) for point in points))
    min_y = max(0, min(int(math.floor(point[1])) for point in points))
    max_x = min(width - 1, max(int(math.ceil(point[0])) for point in points))
    max_y = min(height - 1, max(int(math.ceil(point[1])) for point in points))
    return min_x, min_y, max_x, max_y


def _step10_polygon_to_local_mask(
    points: list[tuple[float, float]],
    global_mask: bytearray,
    image_w: int,
    image_h: int,
) -> tuple[bytearray, int, int, tuple[int, int, int, int]]:
    bbox = _step10_polygon_bbox(points, image_w, image_h)
    min_x, min_y, max_x, max_y = bbox
    local_w = max(1, (max_x - min_x + 1))
    local_h = max(1, (max_y - min_y + 1))

    poly_img = Image.new("L", (local_w, local_h), 0)
    draw = ImageDraw.Draw(poly_img)
    shifted = [(point[0] - min_x, point[1] - min_y) for point in points]
    if len(shifted) >= 3:
        draw.polygon(shifted, fill=255)
    poly_mask = _binary_image_to_mask(_normalize_binary_mask_image(poly_img))

    merged = bytearray(local_w * local_h)
    for y in range(local_h):
        src_row = (min_y + y) * image_w
        dst_row = y * local_w
        for x in range(local_w):
            src_idx = src_row + (min_x + x)
            dst_idx = dst_row + x
            merged[dst_idx] = 1 if (poly_mask[dst_idx] and global_mask[src_idx]) else 0

    if any(merged):
        return merged, local_w, local_h, bbox
    return poly_mask, local_w, local_h, bbox


def _step10_turning_angle_deg(prev_point: tuple[float, float], curr_point: tuple[float, float], next_point: tuple[float, float]) -> float:
    v1x = curr_point[0] - prev_point[0]
    v1y = curr_point[1] - prev_point[1]
    v2x = next_point[0] - curr_point[0]
    v2y = next_point[1] - curr_point[1]
    len1 = math.hypot(v1x, v1y)
    len2 = math.hypot(v2x, v2y)
    if len1 <= 1e-6 or len2 <= 1e-6:
        return 0.0
    dot = (v1x * v2x) + (v1y * v2y)
    cosine = max(-1.0, min(1.0, dot / (len1 * len2)))
    return math.degrees(math.acos(cosine))


def _step10_find_concave_representatives(points: list[tuple[float, float]], concave_sensitivity: float) -> list[tuple[float, float]]:
    ring = points[:]
    if len(ring) >= 2 and abs(ring[0][0] - ring[-1][0]) < 1e-9 and abs(ring[0][1] - ring[-1][1]) < 1e-9:
        ring = ring[:-1]
    n = len(ring)
    if n < 5:
        return []

    area = _step10_signed_area(ring)
    orient_sign = 1.0 if area >= 0 else -1.0
    turn_threshold = _clamp_float(8.0 + ((100.0 - concave_sensitivity) * 0.55), 8.0, 65.0)

    concave_flags = [False] * n
    for idx in range(n):
        prev_pt = ring[(idx - 1) % n]
        curr_pt = ring[idx]
        next_pt = ring[(idx + 1) % n]
        v1x = curr_pt[0] - prev_pt[0]
        v1y = curr_pt[1] - prev_pt[1]
        v2x = next_pt[0] - curr_pt[0]
        v2y = next_pt[1] - curr_pt[1]
        cross = (v1x * v2y) - (v1y * v2x)
        turn_deg = _step10_turning_angle_deg(prev_pt, curr_pt, next_pt)
        if (cross * orient_sign) < 0 and turn_deg >= turn_threshold:
            concave_flags[idx] = True

    groups: list[list[int]] = []
    visited = [False] * n
    for idx in range(n):
        if visited[idx] or not concave_flags[idx]:
            continue
        group = []
        cursor = idx
        while not visited[cursor] and concave_flags[cursor]:
            visited[cursor] = True
            group.append(cursor)
            cursor = (cursor + 1) % n
        groups.append(group)

    if len(groups) >= 2 and concave_flags[0] and concave_flags[-1]:
        merged = groups[-1] + groups[0]
        groups = [*groups[1:-1], merged]

    representatives: list[tuple[float, float]] = []
    for group in groups:
        if not group:
            continue
        # arc length를 간단히 인덱스 길이/세그먼트 거리로 추정한다.
        arc_len = 0.0
        if len(group) >= 2:
            for index, point_idx in enumerate(group[:-1]):
                p1 = ring[point_idx]
                p2 = ring[group[index + 1]]
                arc_len += _step10_line_length(p1, p2)
        if len(group) < 1:
            continue
        if len(group) >= 2 and arc_len < 2.0:
            continue
        mid_idx = group[len(group) // 2]
        representatives.append(ring[mid_idx])
    return representatives


def _step10_line_length(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _step10_sample_line_points(a: tuple[float, float], b: tuple[float, float]) -> list[tuple[int, int]]:
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    steps = max(2, int(math.ceil(max(abs(dx), abs(dy)) * 2.0)))
    points: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()
    for step in range(steps + 1):
        t = step / steps
        x = int(round(a[0] + (dx * t)))
        y = int(round(a[1] + (dy * t)))
        key = (x, y)
        if key in seen:
            continue
        seen.add(key)
        points.append(key)
    return points


def _step10_polyline_inside_ratio(polyline: list[tuple[float, float]], object_mask: bytearray, local_w: int, local_h: int) -> float:
    if len(polyline) < 2:
        return 0.0
    inside = 0
    total = 0
    for idx in range(len(polyline) - 1):
        segment_points = _step10_sample_line_points(polyline[idx], polyline[idx + 1])
        for x, y in segment_points:
            if x < 0 or y < 0 or x >= local_w or y >= local_h:
                total += 1
                continue
            total += 1
            if object_mask[(y * local_w) + x]:
                inside += 1
    if total <= 0:
        return 0.0
    return inside / total


def _step10_draw_polyline_remove(mask: bytearray, width: int, height: int, polyline: list[tuple[float, float]], line_width: int = 2) -> bytearray:
    image = _mask_to_binary_image(mask, width, height)
    draw = ImageDraw.Draw(image)
    draw.line(polyline, fill=0, width=max(1, line_width))
    return _binary_image_to_mask(_normalize_binary_mask_image(image))


def _step10_validate_cut_polyline(object_mask: bytearray, local_w: int, local_h: int, polyline: list[tuple[float, float]]) -> tuple[bool, int]:
    if len(polyline) < 2:
        return False, 1
    inside_ratio = _step10_polyline_inside_ratio(polyline, object_mask, local_w, local_h)
    if inside_ratio < 0.78:
        return False, 1
    base_count = len(_extract_connected_components_4(object_mask, local_w, local_h))
    if base_count < 1:
        return False, 0
    cut_mask = _step10_draw_polyline_remove(object_mask, local_w, local_h, polyline, line_width=2)
    new_components = _extract_connected_components_4(cut_mask, local_w, local_h)
    new_count = len(new_components)
    if new_count <= base_count:
        return False, new_count
    return True, new_count


def _step10_build_edge_scores(gray_image: Image.Image | None, width: int, height: int) -> list[float] | None:
    if gray_image is None:
        return None
    gray = gray_image.convert("L")
    if gray.size != (width, height):
        gray = gray.resize((width, height), Image.Resampling.BILINEAR)
    return _compute_sobel_magnitude(gray.tobytes(), width, height)


def _step10_snap_polyline_to_edge(
    a_local: tuple[float, float],
    b_local: tuple[float, float],
    object_mask: bytearray,
    local_w: int,
    local_h: int,
    gray_local_bytes: bytes | None,
    edge_local_scores: list[float] | None,
    snap_strength: float,
) -> tuple[list[tuple[float, float]], bool]:
    base_polyline = [a_local, b_local]
    if snap_strength <= 0 or gray_local_bytes is None or edge_local_scores is None:
        return base_polyline, False

    dx = b_local[0] - a_local[0]
    dy = b_local[1] - a_local[1]
    line_len = math.hypot(dx, dy)
    if line_len < 8.0:
        return base_polyline, False

    nx = -dy / line_len
    ny = dx / line_len
    sample_count = max(8, int(line_len / 4.0))
    band_radius = _clamp_float(1.0 + (snap_strength / 100.0) * 3.5, 1.0, 4.5)
    offsets = [offset * 0.5 for offset in range(int(math.floor(-band_radius * 2)), int(math.ceil(band_radius * 2)) + 1)]

    snapped_points: list[tuple[float, float]] = [a_local]
    moved_hits = 0
    score_gain_sum = 0.0

    for sample_idx in range(1, sample_count):
        t = sample_idx / sample_count
        cx = a_local[0] + (dx * t)
        cy = a_local[1] + (dy * t)
        base_x = int(round(cx))
        base_y = int(round(cy))
        if base_x < 0 or base_y < 0 or base_x >= local_w or base_y >= local_h:
            snapped_points.append((cx, cy))
            continue
        base_idx = (base_y * local_w) + base_x
        base_edge = edge_local_scores[base_idx]
        base_dark = (255.0 - float(gray_local_bytes[base_idx])) / 255.0
        base_score = (base_edge * 0.65) + (base_dark * 0.35 * 64.0)

        best_x = cx
        best_y = cy
        best_score = base_score
        for offset in offsets:
            tx = cx + (nx * offset)
            ty = cy + (ny * offset)
            ix = int(round(tx))
            iy = int(round(ty))
            if ix < 0 or iy < 0 or ix >= local_w or iy >= local_h:
                continue
            idx = (iy * local_w) + ix
            if not object_mask[idx]:
                continue
            edge_score = edge_local_scores[idx]
            dark_score = (255.0 - float(gray_local_bytes[idx])) / 255.0
            score = (edge_score * 0.65) + (dark_score * 0.35 * 64.0) - (abs(offset) * 0.8)
            if score > best_score:
                best_score = score
                best_x = tx
                best_y = ty
        if (abs(best_x - cx) + abs(best_y - cy)) > 0.25:
            moved_hits += 1
            score_gain_sum += max(0.0, best_score - base_score)
        snapped_points.append((best_x, best_y))

    snapped_points.append(b_local)
    if moved_hits < max(2, sample_count // 4):
        return base_polyline, False
    if score_gain_sum <= (0.1 * sample_count):
        return base_polyline, False
    return snapped_points, True


def _step10_compact_polyline(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(points) <= 2:
        return points[:]
    compact = [points[0]]
    for point in points[1:]:
        prev = compact[-1]
        if _step10_line_length(prev, point) < 0.35:
            continue
        compact.append(point)
    if len(compact) < 2:
        return [points[0], points[-1]]
    return compact


def _step10_build_object_cuts(
    object_id: int,
    polygon_points: list[tuple[float, float]],
    global_mask: bytearray,
    image_w: int,
    image_h: int,
    gray_image: Image.Image | None,
    edge_scores_global: list[float] | None,
    concave_sensitivity: float,
    snap_strength: float,
) -> list[dict[str, Any]]:
    local_mask, local_w, local_h, bbox = _step10_polygon_to_local_mask(polygon_points, global_mask, image_w, image_h)
    if sum(local_mask) < 16:
        return []

    reps = _step10_find_concave_representatives(polygon_points, concave_sensitivity)
    if len(reps) < 2:
        return []

    min_pair_dist = 6.0
    pair_candidates: list[tuple[float, int, int]] = []
    for i in range(len(reps)):
        for j in range(i + 1, len(reps)):
            dist = _step10_line_length(reps[i], reps[j])
            if dist < min_pair_dist:
                continue
            pair_candidates.append((dist, i, j))
    pair_candidates.sort(key=lambda item: item[0])

    min_x, min_y, _, _ = bbox

    gray_local_img: Image.Image | None = None
    gray_local_bytes: bytes | None = None
    edge_local_scores: list[float] | None = None
    if gray_image is not None:
        gray_resized = gray_image.convert("L")
        if gray_resized.size != (image_w, image_h):
            gray_resized = gray_resized.resize((image_w, image_h), Image.Resampling.BILINEAR)
        gray_local_img = gray_resized.crop((min_x, min_y, min_x + local_w, min_y + local_h))
        gray_local_bytes = gray_local_img.tobytes()
        if edge_scores_global is not None:
            edge_local_scores = [0.0] * (local_w * local_h)
            for y in range(local_h):
                src_row = (min_y + y) * image_w
                dst_row = y * local_w
                for x in range(local_w):
                    edge_local_scores[dst_row + x] = edge_scores_global[src_row + (min_x + x)]

    cuts: list[dict[str, Any]] = []
    for pair_index, (_, i, j) in enumerate(pair_candidates, start=1):
        p1 = reps[i]
        p2 = reps[j]
        a_local = (p1[0] - min_x, p1[1] - min_y)
        b_local = (p2[0] - min_x, p2[1] - min_y)
        polyline_local, snapped = _step10_snap_polyline_to_edge(
            a_local,
            b_local,
            local_mask,
            local_w,
            local_h,
            gray_local_bytes,
            edge_local_scores,
            snap_strength,
        )
        polyline_local = _step10_compact_polyline(polyline_local)
        valid, split_count = _step10_validate_cut_polyline(local_mask, local_w, local_h, polyline_local)
        if not valid:
            continue

        polyline_global = [[int(round(x + min_x)), int(round(y + min_y))] for x, y in polyline_local]
        if len(polyline_global) < 2:
            continue
        cuts.append(
            {
                "cut_id": f"obj{object_id}_cut{pair_index}",
                "object_id": object_id,
                "p1": [int(round(p1[0])), int(round(p1[1]))],
                "p2": [int(round(p2[0])), int(round(p2[1]))],
                "polyline": polyline_global,
                "snapped": bool(snapped),
                "splits_into": int(split_count),
            }
        )

    return cuts


def _step10_labels_to_rgb_image(labels: list[int], width: int, height: int) -> Image.Image:
    raw = bytearray(width * height * 3)
    write_index = 0
    for value in labels:
        clamped = 0 if value <= 0 else min(int(value), 0xFFFFFF)
        raw[write_index] = clamped & 0xFF
        raw[write_index + 1] = (clamped >> 8) & 0xFF
        raw[write_index + 2] = (clamped >> 16) & 0xFF
        write_index += 3
    return Image.frombytes("RGB", (width, height), bytes(raw))


def _step10_apply_cuts_and_label(mask_image: Image.Image, cuts: list[dict[str, Any]]) -> tuple[list[int], int, dict[str, int]]:
    mask_bin = _normalize_binary_mask_image(mask_image.convert("L"))
    width, height = mask_bin.size
    image = mask_bin.copy()
    draw = ImageDraw.Draw(image)
    for cut in cuts:
        polyline_raw = cut.get("polyline")
        if not isinstance(polyline_raw, list) or len(polyline_raw) < 2:
            continue
        points: list[tuple[int, int]] = []
        for point in polyline_raw:
            if not isinstance(point, list) or len(point) < 2:
                continue
            points.append((_clamp_int(_to_int(point[0]), 0, width - 1), _clamp_int(_to_int(point[1]), 0, height - 1)))
        if len(points) < 2:
            continue
        draw.line(points, fill=0, width=2)

    final_mask = _binary_image_to_mask(_normalize_binary_mask_image(image))
    labels, label_count = _step9_label_connected_components(final_mask, width, height)
    label_areas: dict[str, int] = {}
    for label in labels:
        if label <= 0:
            continue
        key = str(label)
        label_areas[key] = label_areas.get(key, 0) + 1
    return labels, label_count, label_areas


def _step10_overlay_preview_image(
    background_image: Image.Image,
    polygons_payload: dict[str, Any],
    cuts: list[dict[str, Any]],
) -> Image.Image:
    preview = background_image.convert("L").convert("RGB")
    draw = ImageDraw.Draw(preview)
    polygons_raw = polygons_payload.get("polygons")
    if isinstance(polygons_raw, list):
        for polygon in polygons_raw:
            if not isinstance(polygon, dict):
                continue
            points_raw = polygon.get("points")
            if not isinstance(points_raw, list) or len(points_raw) < 2:
                continue
            points = []
            for point in points_raw:
                if not isinstance(point, list) or len(point) < 2:
                    continue
                points.append((float(_to_float(point[0], 0.0) or 0.0), float(_to_float(point[1], 0.0) or 0.0)))
            if len(points) >= 2:
                draw.line(points + [points[0]], fill=(34, 197, 94), width=1)
    for cut in cuts:
        polyline_raw = cut.get("polyline")
        if not isinstance(polyline_raw, list) or len(polyline_raw) < 2:
            continue
        points: list[tuple[int, int]] = []
        for point in polyline_raw:
            if not isinstance(point, list) or len(point) < 2:
                continue
            points.append((_to_int(point[0]), _to_int(point[1])))
        if len(points) >= 2:
            draw.line(points, fill=(239, 68, 68), width=2)
    return preview


def _step10_png_data_url(image: Image.Image) -> str:
    return f"data:image/png;base64,{_image_png_base64(image)}"


def _step10_relabel_sequential(labels: list[int]) -> tuple[list[int], int]:
    mapping: dict[int, int] = {}
    next_id = 1
    out = [0] * len(labels)
    for idx, label in enumerate(labels):
        if label <= 0:
            continue
        mapped = mapping.get(label)
        if mapped is None:
            mapped = next_id
            mapping[label] = mapped
            next_id += 1
        out[idx] = mapped
    return out, next_id - 1


def _step10_choose_fallback_peak(local_mask: bytearray, dist_map: list[int], width: int, height: int) -> list[tuple[int, int]]:
    best_index = -1
    best_value = -1
    for idx, selected in enumerate(local_mask):
        if not selected:
            continue
        value = dist_map[idx]
        if value > best_value:
            best_value = value
            best_index = idx
    if best_index < 0:
        return []
    return [(best_index % width, best_index // width)]


def _step10_remove_small_local_labels(labels: list[int], width: int, height: int, min_area: int, local_mask: bytearray) -> tuple[list[int], int]:
    if min_area <= 1:
        return labels[:], 0
    areas: dict[int, int] = {}
    for label in labels:
        if label <= 0:
            continue
        areas[label] = areas.get(label, 0) + 1
    removable = {label for label, area in areas.items() if area < min_area}
    if not removable:
        return labels[:], 0

    filtered = [0 if label in removable else label for label in labels]
    if not any(filtered):
        # 전부 제거되면 입력 객체를 통째로 유지한다(과도한 필터 방지).
        restored = [1 if local_mask[idx] else 0 for idx in range(width * height)]
        return restored, len(removable)
    return filtered, len(removable)


def _step10_build_polygon_split_result(
    polygons_payload: dict[str, Any],
    gray_image: Image.Image | None,
    normalized_params: dict[str, Any],
) -> dict[str, Any]:
    width = _to_int(polygons_payload.get("image_width"), 0)
    height = _to_int(polygons_payload.get("image_height"), 0)
    if width <= 0 or height <= 0:
        raise ValueError("9단계 폴리곤 이미지 크기 정보가 유효하지 않습니다.")

    polygons_raw = polygons_payload.get("polygons")
    if not isinstance(polygons_raw, list):
        raise ValueError("9단계 폴리곤 데이터 형식이 올바르지 않습니다.")

    total = width * height
    all_ones_mask = bytearray([1]) * total
    split_strength = float(normalized_params["split_strength"])
    min_center_distance_px = int(normalized_params["min_center_distance_px"])
    min_particle_area = int(normalized_params["min_particle_area"])
    strength_ratio = split_strength / 100.0
    seed_h = _clamp_float(4.5 - (strength_ratio * 3.5), 1.0, 4.5)
    edge_weight = 0.0 if gray_image is None else _clamp_float(0.08 + (strength_ratio * 0.37), 0.0, 0.45)

    gray_l = gray_image.convert("L") if gray_image is not None else None
    if gray_l is not None and gray_l.size != (width, height):
        gray_l = gray_l.resize((width, height), Image.Resampling.BILINEAR)

    global_labels = [0] * total
    next_global_label = 1
    valid_polygons: list[dict[str, Any]] = []
    input_object_count = 0
    split_object_count = 0
    unsplit_object_count = 0
    removed_small_label_count = 0
    no_peak_object_count = 0

    for polygon_raw in polygons_raw:
        if not isinstance(polygon_raw, dict):
            continue
        points_raw = polygon_raw.get("points")
        if not isinstance(points_raw, list):
            continue
        object_id = max(1, _to_int(polygon_raw.get("object_id"), 0))
        polygon_points: list[tuple[float, float]] = []
        for point in points_raw:
            if not isinstance(point, list) or len(point) < 2:
                continue
            polygon_points.append((float(_to_float(point[0], 0.0) or 0.0), float(_to_float(point[1], 0.0) or 0.0)))
        if len(polygon_points) < 3:
            continue

        local_mask, local_w, local_h, bbox = _step10_polygon_to_local_mask(polygon_points, all_ones_mask, width, height)
        local_area = int(sum(local_mask))
        if local_area <= 0:
            continue
        input_object_count += 1
        valid_polygons.append({"object_id": object_id, "points": [[x, y] for x, y in polygon_points]})
        min_x, min_y, _, _ = bbox

        if split_strength <= 0.0:
            local_labels = [1 if local_mask[idx] else 0 for idx in range(local_w * local_h)]
            local_label_count = 1
            peak_count = 0
        else:
            inv_local_mask = bytearray(0 if local_mask[idx] else 1 for idx in range(local_w * local_h))
            dist_map = _cityblock_distance_from_mask(inv_local_mask, local_w, local_h)
            peaks = _step9_find_seed_peaks(local_mask, dist_map, local_w, local_h, min_center_distance_px, seed_h)

            edge_local_scores: list[float] | None = None
            if gray_l is not None:
                gray_local = gray_l.crop((min_x, min_y, min_x + local_w, min_y + local_h))
                sobel_scores = _compute_sobel_magnitude(gray_local.tobytes(), local_w, local_h)
                edge_local_scores = sobel_scores

            if not peaks:
                no_peak_object_count += 1
                peaks = _step10_choose_fallback_peak(local_mask, dist_map, local_w, local_h)
            peak_count = len(peaks)

            local_labels, local_label_count = _step9_run_watershed_labels(
                local_mask,
                dist_map,
                local_w,
                local_h,
                peaks,
                edge_local_scores,
                edge_weight,
            )
            if local_label_count <= 1 and split_strength > 0:
                retry_seed_h = _clamp_float(seed_h * 0.7, 1.0, 4.5)
                retry_peaks = _step9_find_seed_peaks(local_mask, dist_map, local_w, local_h, max(1, int(round(min_center_distance_px * 0.8))), retry_seed_h)
                if retry_peaks:
                    local_labels, local_label_count = _step9_run_watershed_labels(
                        local_mask,
                        dist_map,
                        local_w,
                        local_h,
                        retry_peaks,
                        edge_local_scores,
                        edge_weight,
                    )
                    peak_count = max(peak_count, len(retry_peaks))

        filtered_local_labels, removed_local = _step10_remove_small_local_labels(
            local_labels,
            local_w,
            local_h,
            min_particle_area,
            local_mask,
        )
        removed_small_label_count += removed_local
        filtered_local_labels, filtered_count = _step10_relabel_sequential(filtered_local_labels)
        if filtered_count <= 0:
            continue

        if filtered_count > 1:
            split_object_count += 1
        else:
            unsplit_object_count += 1

        local_to_global: dict[int, int] = {}
        for y in range(local_h):
            local_row = y * local_w
            global_row = (min_y + y) * width
            for x in range(local_w):
                local_idx = local_row + x
                local_label = filtered_local_labels[local_idx]
                if local_label <= 0:
                    continue
                global_idx = global_row + (min_x + x)
                mapped = local_to_global.get(local_label)
                if mapped is None:
                    mapped = next_global_label
                    local_to_global[local_label] = mapped
                    next_global_label += 1
                global_labels[global_idx] = mapped

    global_labels, label_count = _step10_relabel_sequential(global_labels)
    segmented_mask = bytearray(1 if label > 0 else 0 for label in global_labels)
    segmented_mask_image = _mask_to_binary_image(segmented_mask, width, height)
    label_areas: dict[str, int] = {}
    for label in global_labels:
        if label <= 0:
            continue
        key = str(label)
        label_areas[key] = label_areas.get(key, 0) + 1

    raw_lines = _step9_extract_split_lines_from_labels(global_labels, segmented_mask, width, height)
    split_lines: list[dict[str, Any]] = []
    for line in raw_lines:
        if not isinstance(line, dict):
            continue
        points_raw = line.get("points")
        if not isinstance(points_raw, list) or len(points_raw) < 2:
            continue
        polyline: list[list[int]] = []
        for point in points_raw:
            if not isinstance(point, list) or len(point) < 2:
                continue
            polyline.append([_clamp_int(_to_int(point[0]), 0, width - 1), _clamp_int(_to_int(point[1]), 0, height - 1)])
        if len(polyline) < 2:
            continue
        split_lines.append(
            {
                "id": _to_int(line.get("id"), len(split_lines) + 1),
                "bbox": line.get("bbox") if isinstance(line.get("bbox"), list) else None,
                "polyline": polyline,
                "length_px": _to_float(line.get("length_px"), 0.0),
            }
        )

    warnings: list[str] = []
    if split_strength <= 0.0:
        warnings.append("분할 강도 0으로 설정되어 입력 폴리곤 라벨을 그대로 유지했습니다.")
    if no_peak_object_count > 0 and split_strength > 0.0:
        warnings.append(f"일부 객체({no_peak_object_count}개)는 중심 피크가 약해 대체 마커로 분할했습니다.")
    if removed_small_label_count > 0:
        warnings.append(f"최소 입자 면적 기준으로 작은 라벨 {removed_small_label_count}개를 제거했습니다.")
    if split_strength > 0.0 and split_object_count == 0 and input_object_count > 0:
        warnings.append("분할이 적용된 객체가 없습니다. 분할 강도를 높이거나 중심 거리 값을 줄여 보세요.")

    qc = {
        "input_object_count": input_object_count,
        "output_label_count": label_count,
        "split_object_count": split_object_count,
        "unsplit_object_count": unsplit_object_count,
        "removed_small_label_count": removed_small_label_count,
        "split_line_count": len(split_lines),
        "split_disabled": bool(split_strength <= 0.0),
        "warnings": warnings,
    }

    return {
        "image_width": width,
        "image_height": height,
        "polygons": valid_polygons,
        "labels": global_labels,
        "label_count": label_count,
        "label_areas": label_areas,
        "segmented_mask_image": segmented_mask_image,
        "split_lines": split_lines,
        "qc": qc,
        "gray_available": bool(gray_l is not None),
        "effective_params": {
            "split_strength": split_strength,
            "min_center_distance_px": min_center_distance_px,
            "min_particle_area": min_particle_area,
            "seed_h": round(seed_h, 4),
            "edge_weight": round(edge_weight, 4),
        },
    }


def _step10_render_boundary_overlay_image(
    background_image: Image.Image,
    polygons_payload: dict[str, Any],
    split_lines: list[dict[str, Any]],
) -> Image.Image:
    preview = background_image.convert("L").convert("RGB")
    draw = ImageDraw.Draw(preview)
    polygons_raw = polygons_payload.get("polygons")
    if isinstance(polygons_raw, list):
        for polygon in polygons_raw:
            if not isinstance(polygon, dict):
                continue
            points_raw = polygon.get("points")
            if not isinstance(points_raw, list) or len(points_raw) < 2:
                continue
            points: list[tuple[float, float]] = []
            for point in points_raw:
                if not isinstance(point, list) or len(point) < 2:
                    continue
                points.append((float(_to_float(point[0], 0.0) or 0.0), float(_to_float(point[1], 0.0) or 0.0)))
            if len(points) >= 2:
                draw.line(points + [points[0]], fill=(34, 197, 94), width=1)
    for line in split_lines:
        polyline_raw = line.get("polyline")
        if not isinstance(polyline_raw, list) or len(polyline_raw) < 2:
            continue
        points: list[tuple[int, int]] = []
        for point in polyline_raw:
            if not isinstance(point, list) or len(point) < 2:
                continue
            points.append((_to_int(point[0]), _to_int(point[1])))
        if len(points) >= 2:
            draw.line(points, fill=(239, 68, 68), width=2)
    return preview


def _run_step10_generate_result(
    step9_polygons_payload: dict[str, Any],
    gray_image: Image.Image | None,
    normalized_params: dict[str, Any],
) -> dict[str, Any]:
    return _step10_build_polygon_split_result(step9_polygons_payload, gray_image, normalized_params)


def create_step10_preview_payload(
    session: Session,
    run: Run,
    params: dict[str, Any],
) -> dict[str, Any]:
    image = session.get(ImageAsset, run.image_id)
    if image is None:
        raise LookupError("원본 이미지를 찾을 수 없습니다.")

    normalized_params = _normalize_step10_params(params)
    resolved = _resolve_step10_inputs(session, run, image, normalized_params)

    step3_rel = resolved.get("step3_image_rel_path")
    step3_abs = storage_service.resolve(str(step3_rel)) if isinstance(step3_rel, str) else None
    gray_ctx = Image.open(step3_abs) if step3_abs is not None and step3_abs.exists() else None
    try:
        result = _step10_build_polygon_split_result(
            resolved["step9_polygons_payload"],
            gray_ctx,
            normalized_params,
        )
    finally:
        if gray_ctx is not None:
            gray_ctx.close()

    width = int(result["image_width"])
    height = int(result["image_height"])
    labels = list(result["labels"])
    labels_rgb = _step10_labels_to_rgb_image(labels, width, height)

    return {
        "split_lines": result["split_lines"],
        "preview_labels_url": _step10_png_data_url(labels_rgb),
        "split_line_count": int(len(result["split_lines"])),
        "label_count": int(result["label_count"]),
        "image_width": width,
        "image_height": height,
        "label_areas": result["label_areas"],
        "qc": result["qc"],
    }


def _execute_step1(
    session: Session,
    run: Run,
    image: ImageAsset,
    version: int,
    params: dict[str, Any],
) -> list[StepArtifact]:
    original_path = storage_service.resolve(image.storage_path)
    with Image.open(original_path) as source:
        width, height = source.size
        if height <= 0:
            raise ValueError("원본 이미지 높이가 유효하지 않습니다.")

        requested_crop_bottom = _to_int(params.get("crop_bottom_px"), 0)
        max_crop_bottom = max(height - 1, 0)
        crop_bottom_px = max(0, min(requested_crop_bottom, max_crop_bottom))
        cropped_height = height - crop_bottom_px
        if cropped_height <= 0:
            raise ValueError("하단 커팅 값이 너무 커서 유효한 이미지가 남지 않습니다.")

        um_per_px = _to_float(params.get("um_per_px"))
        if um_per_px is None or um_per_px <= 0:
            raise ValueError("µm/px 값은 0보다 커야 합니다.")

        measurement_data = params.get("measurement")
        normalized_measurement: dict[str, Any] | None = None
        if isinstance(measurement_data, dict):
            ax = max(0, min(_to_int(measurement_data.get("ax")), width - 1))
            ay = max(0, min(_to_int(measurement_data.get("ay")), cropped_height - 1))
            bx = max(0, min(_to_int(measurement_data.get("bx")), width - 1))
            by = max(0, min(_to_int(measurement_data.get("by")), cropped_height - 1))

            pixel_distance = _to_float(measurement_data.get("pixel_distance"))
            real_um = _to_float(measurement_data.get("real_um"))
            if pixel_distance is None or pixel_distance <= 0:
                raise ValueError("픽셀 거리는 0보다 커야 합니다.")
            if real_um is None or real_um <= 0:
                raise ValueError("실제 길이(µm)는 0보다 커야 합니다.")

            normalized_measurement = {
                "ax": ax,
                "ay": ay,
                "bx": bx,
                "by": by,
                "pixel_distance": pixel_distance,
                "real_um": real_um,
            }

        normalized_params: dict[str, Any] = {
            "crop_bottom_px": crop_bottom_px,
            "um_per_px": um_per_px,
            "measurement": normalized_measurement,
        }

        artifact = StepArtifact(
            run_id=run.id,
            step_id=1,
            version=version,
            artifact_type="step1_calibration",
            params_json=json.dumps(normalized_params, ensure_ascii=False),
            files_json="[]",
        )
        session.add(artifact)
        session.flush()

        artifact_dir = storage_service.run_step1_artifact_dir(run.id, artifact.id)
        cropped_image = source.crop((0, 0, width, cropped_height)).convert("RGB")
        preview_rel_path = storage_service.write_image_png(artifact_dir / "step1_preview.png", cropped_image)

        calibration_payload = {
            "run_id": run.id,
            "step_id": 1,
            "version": version,
            "artifact_id": artifact.id,
            "params": normalized_params,
        }
        calibration_rel_path = storage_service.write_json(artifact_dir / "calibration.json", calibration_payload)

        files = [
            FileRef(path=preview_rel_path, mime_type="image/png"),
            FileRef(path=calibration_rel_path, mime_type="application/json"),
        ]
        artifact.files_json = _serialize_files(files)

    return [artifact]


def execute_step(
    session: Session,
    run: Run,
    step_id: int,
    params: dict[str, Any],
) -> tuple[int, list[StepArtifact]]:
    if step_id not in VALID_STEP_IDS:
        raise ValueError("지원하지 않는 단계입니다.")

    image = session.get(ImageAsset, run.image_id)
    if image is None:
        raise LookupError("원본 이미지를 찾을 수 없습니다.")

    _validate_step_prerequisite(session, run.id, step_id)

    version = _next_version(session, run.id, step_id)
    created: list[StepArtifact] = []

    if step_id == 1:
        created.extend(_execute_step1(session, run, image, version, params))

    elif step_id == 2:
        step_dir = storage_service.run_step_dir(run.id, step_id, version)
        source_rel_path = _resolve_input_image_path(session, run, image, step_id)
        source_abs_path = storage_service.resolve(source_rel_path)

        with Image.open(source_abs_path) as source_image:
            processed_image, normalized_params = _apply_step2_pipeline(source_image, params)
            preview_rel_path = storage_service.write_image_png(step_dir / "step2_preview.png", processed_image)

        created.append(
            _add_artifact(
                session,
                run_id=run.id,
                step_id=step_id,
                version=version,
                artifact_type="image_preview",
                params=normalized_params,
                files=[FileRef(path=preview_rel_path, mime_type="image/png")],
            )
        )

    elif step_id == 3:
        step_dir = storage_service.run_step_dir(run.id, step_id, version)
        normalized_params = _normalize_step3_params(params)
        source_rel_path, input_artifact_id = _resolve_step3_input_image_path(
            session,
            run,
            normalized_params["input_artifact_id"],
        )
        source_abs_path = storage_service.resolve(source_rel_path)

        with Image.open(source_abs_path) as source_image:
            source_gray = source_image.convert("L")
            exclude_mask = _normalize_step3_exclude_mask(
                normalized_params.get("exclude_mask"),
                source_gray.size[0],
                source_gray.size[1],
            )
            denoised_image, internal_params, qc_payload = _apply_step3_pipeline(source_gray, normalized_params, preview=False)
            denoised_image = _apply_step3_exclude_mask(denoised_image, source_gray, exclude_mask)
            denoised_rel_path = storage_service.write_image_png(step_dir / "step3_denoised.png", denoised_image)
            exclude_mask_rel_path = storage_service.write_image_png(step_dir / "step3_exclude_mask.png", exclude_mask)
            normalized_exclude_roi = _sanitize_step3_exclude_roi(
                normalized_params.get("exclude_roi"),
                source_gray.size[0],
                source_gray.size[1],
            )

        qc_rel_path = storage_service.write_json(step_dir / "qc.json", qc_payload)
        stored_params = {
            "method": normalized_params["method"],
            "strength": normalized_params["strength"],
            "edge_protect": normalized_params["edge_protect"],
            "quality_mode": normalized_params["quality_mode"],
            "input_artifact_id": input_artifact_id,
            "exclude_roi": normalized_exclude_roi,
            "internal": internal_params,
            "qc": qc_payload,
        }

        created.append(
            _add_artifact(
                session,
                run_id=run.id,
                step_id=step_id,
                version=version,
                artifact_type="image_preview",
                params=stored_params,
                files=[
                    FileRef(path=denoised_rel_path, mime_type="image/png"),
                    FileRef(path=exclude_mask_rel_path, mime_type="image/png"),
                    FileRef(path=qc_rel_path, mime_type="application/json"),
                ],
            )
        )

    elif step_id == 4:
        normalized_params = _normalize_step4_params(params)
        source_rel_path, input_artifact_id = _resolve_step4_input_image_path(
            session,
            run,
            normalized_params["input_artifact_id"],
        )
        source_abs_path = storage_service.resolve(source_rel_path)
        um_per_px = _resolve_um_per_px(session, run)
        exclude_mask_image = _load_step3_exclude_mask_image(session, input_artifact_id)

        artifact = StepArtifact(
            run_id=run.id,
            step_id=4,
            version=version,
            artifact_type="mask_binary",
            params_json="{}",
            files_json="[]",
        )
        session.add(artifact)
        session.flush()

        with Image.open(source_abs_path) as source_image:
            masks, internal, qc_payload, width, height = _run_step4_pipeline(
                source_image,
                normalized_params,
                um_per_px,
                exclude_mask_image,
                preview=False,
            )
            final_image = _mask_to_binary_image(masks["mask"], width, height)

        artifact_dir = storage_service.run_step4_artifact_dir(run.id, artifact.id)
        mask_rel_path = storage_service.write_image_png(artifact_dir / "step4_mask.png", final_image)
        params_payload = {
            "mode": normalized_params["mode"],
            "seed_sensitivity": normalized_params["seed_sensitivity"],
            "candidate_sensitivity": normalized_params["candidate_sensitivity"],
            "structure_scale_um": normalized_params["structure_scale_um"],
            "min_area_um2": normalized_params["min_area_um2"],
            "input_artifact_id": input_artifact_id,
            "um_per_px": um_per_px,
            "internal": internal,
        }
        params_rel_path = storage_service.write_json(artifact_dir / "params.json", params_payload)
        qc_rel_path = storage_service.write_json(artifact_dir / "qc.json", qc_payload)

        stored_params = dict(params_payload)
        stored_params["qc"] = qc_payload
        artifact.params_json = json.dumps(stored_params, ensure_ascii=False)
        artifact.files_json = _serialize_files(
            [
                FileRef(path=mask_rel_path, mime_type="image/png"),
                FileRef(path=params_rel_path, mime_type="application/json"),
                FileRef(path=qc_rel_path, mime_type="application/json"),
            ]
        )
        created.append(artifact)

    elif step_id == 45:
        step_dir = storage_service.run_step_dir(run.id, step_id, version)
        source = _resolve_input_image_path(session, run, image, step_id)
        suffix = Path(source).suffix.lower() or ".png"
        mime_type = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".bmp": "image/bmp",
            ".tif": "image/tiff",
            ".tiff": "image/tiff",
        }.get(suffix, "application/octet-stream")
        rel_path = storage_service.copy_file(source, step_dir / f"preview{suffix}")
        created.append(
            _add_artifact(
                session,
                run_id=run.id,
                step_id=step_id,
                version=version,
                artifact_type="image_preview",
                params=params,
                files=[FileRef(path=rel_path, mime_type=mime_type)],
            )
        )

    elif step_id == 5:
        normalized_params = _normalize_step5_params(params)
        base_mask_rel_path, base_mask_artifact_id = _resolve_step5_base_mask_path(
            session,
            run,
            normalized_params["base_mask_artifact_id"],
        )
        base_mask_abs_path = storage_service.resolve(base_mask_rel_path)

        artifact = StepArtifact(
            run_id=run.id,
            step_id=5,
            version=version,
            artifact_type="mask_edited",
            params_json="{}",
            files_json="[]",
        )
        session.add(artifact)
        session.flush()

        with Image.open(base_mask_abs_path) as base_mask_image:
            base_mask_gray = base_mask_image.convert("L")
            edited_mask = _normalize_step5_edited_mask(
                normalized_params["edited_mask_png_base64"],
                base_mask_gray.size[0],
                base_mask_gray.size[1],
            )

        artifact_dir = storage_service.run_step5_artifact_dir(run.id, artifact.id)
        edited_mask_rel_path = storage_service.write_image_png(artifact_dir / "step5_mask_edited.png", edited_mask)
        unique_values = sorted({int(value) for value in set(edited_mask.getdata())})

        stored_params: dict[str, Any] = {
            "base_mask_artifact_id": base_mask_artifact_id,
            "mask_shape": {
                "width": edited_mask.size[0],
                "height": edited_mask.size[1],
            },
            "mask_unique_values": unique_values,
        }
        if normalized_params["brush_mode"] is not None:
            stored_params["brush_mode"] = normalized_params["brush_mode"]
        if normalized_params["brush_size_px"] is not None:
            stored_params["brush_size_px"] = normalized_params["brush_size_px"]

        artifact.params_json = json.dumps(stored_params, ensure_ascii=False)
        artifact.files_json = _serialize_files([FileRef(path=edited_mask_rel_path, mime_type="image/png")])
        created.append(artifact)

    elif step_id == 6:
        normalized_params = _normalize_step6_params(params)
        base_mask_rel_path, base_mask_artifact_id, source_rel_path, source_artifact_id = _resolve_step6_base_inputs(
            session,
            run,
            normalized_params["base_mask_artifact_id"],
        )
        base_mask_abs_path = storage_service.resolve(base_mask_rel_path)
        source_abs_path = storage_service.resolve(source_rel_path)
        um_per_px = _resolve_um_per_px(session, run)

        artifact = StepArtifact(
            run_id=run.id,
            step_id=6,
            version=version,
            artifact_type="mask_recovered",
            params_json="{}",
            files_json="[]",
        )
        session.add(artifact)
        session.flush()

        with Image.open(source_abs_path) as source_image, Image.open(base_mask_abs_path) as base_mask_image:
            recovered_image, internal_payload, qc_payload = _run_step6_pipeline(
                source_image.convert("L"),
                base_mask_image.convert("L"),
                normalized_params,
                um_per_px,
            )

        artifact_dir = storage_service.run_step6_artifact_dir(run.id, artifact.id)
        recovered_rel_path = storage_service.write_image_png(artifact_dir / "step6_recovered_mask.png", recovered_image)
        params_payload = {
            "base_mask_artifact_id": base_mask_artifact_id,
            "input_artifact_id": source_artifact_id,
            "max_expand_um": normalized_params["max_expand_um"],
            "recover_sensitivity": normalized_params["recover_sensitivity"],
            "edge_protect": normalized_params["edge_protect"],
            "fill_small_holes": normalized_params["fill_small_holes"],
            "um_per_px": um_per_px,
            "internal": internal_payload,
        }
        params_rel_path = storage_service.write_json(artifact_dir / "params.json", params_payload)
        qc_rel_path = storage_service.write_json(artifact_dir / "qc.json", qc_payload)

        stored_params = dict(params_payload)
        stored_params["qc"] = qc_payload
        artifact.params_json = json.dumps(stored_params, ensure_ascii=False)
        artifact.files_json = _serialize_files(
            [
                FileRef(path=recovered_rel_path, mime_type="image/png"),
                FileRef(path=params_rel_path, mime_type="application/json"),
                FileRef(path=qc_rel_path, mime_type="application/json"),
            ]
        )
        created.append(artifact)

    elif step_id == 7:
        normalized_params = _normalize_step7_params(params)
        base_mask_rel_path, base_mask_artifact_id, source_rel_path, source_artifact_id = _resolve_step7_base_inputs(
            session,
            run,
            normalized_params["base_mask_artifact_id"],
        )
        base_mask_abs_path = storage_service.resolve(base_mask_rel_path)
        um_per_px = _resolve_um_per_px(session, run)

        artifact = StepArtifact(
            run_id=run.id,
            step_id=7,
            version=version,
            artifact_type="dual_mask",
            params_json="{}",
            files_json="[]",
        )
        session.add(artifact)
        session.flush()

        with Image.open(base_mask_abs_path) as base_mask_image:
            solid_image, outer_image, metrics_payload, internal_payload = _run_step7_pipeline(
                base_mask_image.convert("L"),
                normalized_params,
                um_per_px,
            )

        artifact_dir = storage_service.run_step7_artifact_dir(run.id, artifact.id)
        solid_rel_path = storage_service.write_image_png(artifact_dir / "mask_solid.png", solid_image)
        outer_rel_path = storage_service.write_image_png(artifact_dir / "mask_outer.png", outer_image)
        metrics_rel_path = storage_service.write_json(artifact_dir / "metrics.json", metrics_payload)

        stored_params: dict[str, Any] = {
            "base_mask_artifact_id": base_mask_artifact_id,
            "input_artifact_id": source_artifact_id,
            "input_image_path": source_rel_path,
            "hole_mode": normalized_params["hole_mode"],
            "max_hole_area_um2": normalized_params["max_hole_area_um2"],
            "closing_enabled": normalized_params["closing_enabled"],
            "closing_radius_um": normalized_params["closing_radius_um"],
            "um_per_px": um_per_px,
            "metrics": metrics_payload,
            "internal": internal_payload,
        }
        artifact.params_json = json.dumps(stored_params, ensure_ascii=False)
        artifact.files_json = _serialize_files(
            [
                FileRef(path=solid_rel_path, mime_type="image/png"),
                FileRef(path=outer_rel_path, mime_type="image/png"),
                FileRef(path=metrics_rel_path, mime_type="application/json"),
            ]
        )
        created.append(artifact)

    elif step_id == 8:
        normalized_params = _normalize_step8_params(params)
        (
            base_mask_rel_path,
            base_mask_artifact_id,
            base_mask_step_id,
            source_rel_path,
            source_artifact_id,
        ) = _resolve_step8_base_inputs(session, run, normalized_params["base_mask_artifact_id"])
        base_mask_abs_path = storage_service.resolve(base_mask_rel_path)

        artifact = StepArtifact(
            run_id=run.id,
            step_id=8,
            version=version,
            artifact_type="contours",
            params_json="{}",
            files_json="[]",
        )
        session.add(artifact)
        session.flush()

        pore_mask_image: Image.Image | None = None
        step7_artifact_id: str | None = None
        with Image.open(base_mask_abs_path) as base_mask_image:
            pore_mask_image, step7_artifact_id = _resolve_step8_pore_mask_from_step7(
                session,
                run,
                base_mask_artifact_id,
                base_mask_step_id,
                normalized_params.get("step7_artifact_id"),
            )
            contours_payload = _build_step8_contours_payload(base_mask_image.convert("L"), pore_mask_image)
        if pore_mask_image is not None:
            pore_mask_image.close()

        artifact_dir = storage_service.run_step8_artifact_dir(run.id, artifact.id)
        contours_rel_path = storage_service.write_json(artifact_dir / "contours.json", contours_payload)

        contour_items = contours_payload.get("contours", [])
        solid_contour_count = 0
        pore_contour_count = 0
        if isinstance(contour_items, list):
            for contour_item in contour_items:
                if not isinstance(contour_item, dict):
                    continue
                kind = str(contour_item.get("kind", "solid"))
                if kind == "pore":
                    pore_contour_count += 1
                else:
                    solid_contour_count += 1

        contour_mode = "solid_only"
        if pore_contour_count > 0:
            contour_mode = "solid_and_pore"

        stored_params = {
            "base_mask_artifact_id": base_mask_artifact_id,
            "base_mask_step_id": base_mask_step_id,
            "step7_artifact_id": step7_artifact_id,
            "requested_step7_artifact_id": normalized_params.get("step7_artifact_id"),
            "input_artifact_id": source_artifact_id,
            "input_image_path": source_rel_path,
            "contour_mode": contour_mode,
            "contour_count": len(contours_payload.get("contours", [])),
            "solid_contour_count": solid_contour_count,
            "pore_contour_count": pore_contour_count,
            "image_width": contours_payload.get("image_width"),
            "image_height": contours_payload.get("image_height"),
        }
        artifact.params_json = json.dumps(stored_params, ensure_ascii=False)
        artifact.files_json = _serialize_files([FileRef(path=contours_rel_path, mime_type="application/json")])
        created.append(artifact)

    elif step_id == 9:
        normalized_params = _normalize_step9_params(params)
        step8_artifact_id, step8_contours_payload = _load_step8_contours_payload_for_run(
            session,
            run,
            normalized_params.get("step8_artifact_id"),
        )
        if step8_artifact_id is None or not isinstance(step8_contours_payload, dict):
            raise ValueError("먼저 8단계 윤곽선이 필요합니다.")
        polygons_payload = _step9_polygonize_contours_payload(step8_contours_payload, normalized_params)
        preview_bg_rel_path, preview_bg_artifact_id = _resolve_step9_preview_background_rel_path(session, run, image)
        preview_bg_abs_path = storage_service.resolve(preview_bg_rel_path)

        artifact = StepArtifact(
            run_id=run.id,
            step_id=9,
            version=version,
            artifact_type="polygonized_contours",
            params_json="{}",
            files_json="[]",
        )
        session.add(artifact)
        session.flush()

        artifact_dir = storage_service.run_step9_artifact_dir(run.id, artifact.id)
        polygons_json_payload = {
            "image_width": polygons_payload.get("image_width"),
            "image_height": polygons_payload.get("image_height"),
            "polygon_count": polygons_payload.get("polygon_count"),
            "step8_artifact_id": step8_artifact_id,
            "params": {
                "smooth_level": normalized_params["smooth_level"],
                "resample_step_px": normalized_params["resample_step_px"],
                "max_vertex_gap_px": normalized_params["max_vertex_gap_px"],
            },
            "polygons": polygons_payload.get("polygons", []),
        }
        polygons_rel_path = storage_service.write_json(artifact_dir / "polygons.json", polygons_json_payload)

        with Image.open(preview_bg_abs_path) as preview_bg_image:
            preview_image = _step9_render_polygon_preview_image(preview_bg_image, polygons_json_payload)
        preview_rel_path = storage_service.write_image_png(artifact_dir / "step9_preview.png", preview_image)

        stored_params = {
            "step8_artifact_id": step8_artifact_id,
            "preview_background_artifact_id": preview_bg_artifact_id,
            "preview_background_path": preview_bg_rel_path,
            "smooth_level": normalized_params["smooth_level"],
            "resample_step_px": normalized_params["resample_step_px"],
            "max_vertex_gap_px": normalized_params["max_vertex_gap_px"],
            "polygon_count": int(_to_int(polygons_payload.get("polygon_count"), 0)),
            "image_width": int(_to_int(polygons_payload.get("image_width"), 0)),
            "image_height": int(_to_int(polygons_payload.get("image_height"), 0)),
        }
        artifact.params_json = json.dumps(stored_params, ensure_ascii=False)
        artifact.files_json = _serialize_files(
            [
                FileRef(path=polygons_rel_path, mime_type="application/json"),
                FileRef(path=preview_rel_path, mime_type="image/png"),
            ]
        )
        created.append(artifact)

    elif step_id == 10:
        normalized_params = _normalize_step10_params(params)
        resolved = _resolve_step10_inputs(session, run, image, normalized_params)

        step3_rel_path = resolved.get("step3_image_rel_path")
        step3_abs_path = storage_service.resolve(str(step3_rel_path)) if isinstance(step3_rel_path, str) else None
        preview_bg_abs_path = storage_service.resolve(str(resolved["preview_bg_rel_path"]))

        artifact = StepArtifact(
            run_id=run.id,
            step_id=10,
            version=version,
            artifact_type="overlap_watershed_split",
            params_json="{}",
            files_json="[]",
        )
        session.add(artifact)
        session.flush()

        gray_ctx = Image.open(step3_abs_path) if step3_abs_path is not None and step3_abs_path.exists() else None
        try:
            result = _run_step10_generate_result(
                resolved["step9_polygons_payload"],
                gray_ctx,
                normalized_params,
            )
        finally:
            if gray_ctx is not None:
                gray_ctx.close()

        width = int(result["image_width"])
        height = int(result["image_height"])
        labels = list(result["labels"])
        split_lines = list(result["split_lines"])
        label_areas = dict(result["label_areas"])
        qc_payload = dict(result["qc"])
        segmented_mask_image = result["segmented_mask_image"]

        labels_uint16_image = _labels_to_uint16_image(labels, width, height)
        labels_vis_image = _step10_labels_to_rgb_image(labels, width, height)
        with Image.open(preview_bg_abs_path) as preview_bg_image:
            overlay_preview_image = _step10_render_boundary_overlay_image(preview_bg_image, resolved["step9_polygons_payload"], split_lines)

        split_lines_payload = {
            "image_width": width,
            "image_height": height,
            "step9_artifact_id": resolved["step9_artifact_id"],
            "step3_artifact_id": resolved["step3_artifact_id"],
            "params": {
                "split_strength": normalized_params["split_strength"],
                "min_center_distance_px": normalized_params["min_center_distance_px"],
                "min_particle_area": normalized_params["min_particle_area"],
            },
            "split_line_count": int(len(split_lines)),
            "split_lines": split_lines,
            "label_count": int(result["label_count"]),
            "label_areas": label_areas,
            "gray_available": bool(result["gray_available"]),
            "qc": qc_payload,
        }

        artifact_dir = storage_service.run_step10_artifact_dir(run.id, artifact.id)
        split_lines_rel_path = storage_service.write_json(artifact_dir / "split_lines.json", split_lines_payload)
        labels_rel_path = storage_service.write_image_png(artifact_dir / "labels.png", labels_uint16_image)
        labels_vis_rel_path = storage_service.write_image_png(artifact_dir / "labels_vis.png", labels_vis_image)
        segmented_mask_rel_path = storage_service.write_image_png(artifact_dir / "segmented_mask.png", segmented_mask_image)
        boundary_overlay_rel_path = storage_service.write_image_png(artifact_dir / "boundary_overlay.png", overlay_preview_image)
        qc_rel_path = storage_service.write_json(artifact_dir / "qc.json", qc_payload)

        stored_params = {
            "step9_artifact_id": resolved["step9_artifact_id"],
            "step3_artifact_id": resolved["step3_artifact_id"],
            "preview_background_artifact_id": resolved.get("preview_bg_artifact_id"),
            "split_strength": normalized_params["split_strength"],
            "min_center_distance_px": normalized_params["min_center_distance_px"],
            "min_particle_area": normalized_params["min_particle_area"],
            "split_line_count": int(len(split_lines)),
            "label_count": int(result["label_count"]),
            "gray_available": bool(result["gray_available"]),
            "qc": qc_payload,
            "internal": result.get("effective_params", {}),
        }
        artifact.params_json = json.dumps(stored_params, ensure_ascii=False)
        artifact.files_json = _serialize_files(
            [
                FileRef(path=split_lines_rel_path, mime_type="application/json"),
                FileRef(path=labels_rel_path, mime_type="image/png"),
                FileRef(path=labels_vis_rel_path, mime_type="image/png"),
                FileRef(path=segmented_mask_rel_path, mime_type="image/png"),
                FileRef(path=boundary_overlay_rel_path, mime_type="image/png"),
                FileRef(path=qc_rel_path, mime_type="application/json"),
            ]
        )
        created.append(artifact)

    return version, created
