from __future__ import annotations

import base64
import json
import logging
from io import UnsupportedOperation
import traceback
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func
from starlette.datastructures import UploadFile as StarletteUploadFile
from sqlmodel import Session, col, desc, select

from app.db.models import ImageAsset, Run, StepArtifact
from app.db.session import get_session
from app.schemas import (
    ArtifactRenameRequest,
    ArtifactStepGroup,
    ArtifactVersionGroup,
    FileRef,
    ImageAssetRead,
    RunArtifactsGroupedResponse,
    RunHistoryImportResponse,
    RunCreate,
    RunRead,
    StepArtifactRead,
    Step1ExecuteRequest,
    Step1ExecuteResponse,
    Step3ExecuteRequest,
    Step4ExecuteRequest,
    Step4PreviewRequest,
    Step5ExecuteRequest,
    Step6ExecuteRequest,
    Step7ExecuteRequest,
    Step7PreviewResponse,
    Step8ExecuteRequest,
    Step9ExecuteRequest,
    Step9PreviewResponse,
    Step10ExecuteRequest,
    Step10PreviewResponse,
    StepExecuteRequest,
    StepExecuteResponse,
)
from app.services.pipeline import (
    VALID_STEP_IDS,
    create_step3_preview_png,
    create_step4_preview_png,
    create_step6_preview_png,
    create_step7_preview_payload,
    create_step9_preview_payload,
    create_step10_preview_payload,
    execute_step,
)
from app.services.storage import storage_service

router = APIRouter(prefix="/api", tags=["api"])
logger = logging.getLogger("particlelab.api")
HISTORY_EXPORT_STEP_IDS = tuple(range(1, 9))


def _safe_json_loads(raw: str, fallback: Any) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback


def _artifact_to_schema(artifact: StepArtifact) -> StepArtifactRead:
    params = _safe_json_loads(artifact.params_json, {})
    files_data = _safe_json_loads(artifact.files_json, [])

    files: list[FileRef] = []
    file_urls: list[str] = []
    for file_item in files_data:
        if isinstance(file_item, dict) and "path" in file_item and "mime_type" in file_item:
            files.append(FileRef(path=str(file_item["path"]), mime_type=str(file_item["mime_type"])))
            file_urls.append(f"/api/artifacts/{artifact.id}/file?file_index={len(file_urls)}")

    return StepArtifactRead(
        id=artifact.id,
        run_id=artifact.run_id,
        step_id=artifact.step_id,
        version=artifact.version,
        artifact_type=artifact.artifact_type,
        params=params,
        files=files,
        file_urls=file_urls,
        created_at=artifact.created_at,
    )


def _next_artifact_version(session: Session, run_id: str, step_id: int) -> int:
    stmt = select(func.max(StepArtifact.version)).where(
        StepArtifact.run_id == run_id,
        StepArtifact.step_id == step_id,
    )
    current = session.exec(stmt).one()
    if current is None:
        return 1
    return int(current) + 1


def _safe_step_id(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("단계 번호 형식이 올바르지 않습니다.") from exc
    if parsed <= 0:
        raise ValueError("단계 번호는 1 이상이어야 합니다.")
    return parsed


def _safe_filename(value: Any, fallback: str) -> str:
    raw = str(value or "").strip()
    name = Path(raw).name
    if not name:
        return fallback
    return name


def _remap_artifact_refs(value: Any, artifact_id_map: dict[str, str], *, parent_key: Optional[str] = None) -> Any:
    if isinstance(value, dict):
        return {
            str(key): _remap_artifact_refs(item, artifact_id_map, parent_key=str(key))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_remap_artifact_refs(item, artifact_id_map, parent_key=parent_key) for item in value]
    if isinstance(value, str) and parent_key and parent_key.endswith("_artifact_id"):
        mapped = artifact_id_map.get(value.strip())
        return mapped if mapped is not None else value
    return value


def _estimate_upload_size(upload: UploadFile) -> Optional[int]:
    stream = upload.file
    try:
        current = stream.tell()
        stream.seek(0, 2)
        size = stream.tell()
        stream.seek(current)
        return size
    except (OSError, UnsupportedOperation):
        return None


def _to_image_schema(image: ImageAsset) -> ImageAssetRead:
    return ImageAssetRead(
        id=image.id,
        filename=image.filename,
        mime_type=image.content_type,
        width=image.width,
        height=image.height,
        created_at=image.created_at,
        original_url=f"/api/images/{image.id}/original",
    )


@router.post("/images", response_model=ImageAssetRead, status_code=201)
async def upload_image(
    request: Request,
    session: Session = Depends(get_session),
) -> ImageAssetRead:
    form = await request.form()
    upload: Optional[UploadFile] = None
    file_item = form.get("file")
    if isinstance(file_item, StarletteUploadFile):
        upload = file_item
    if upload is None:
        files_items = form.getlist("files")
        for item in files_items:
            if isinstance(item, StarletteUploadFile):
                upload = item
                break
    if upload is None:
        raise HTTPException(status_code=422, detail="파일 필드가 비어 있습니다. file 또는 files를 사용해 주세요.")

    logger.info(
        "이미지 업로드 요청 수신: headers=%s content_type=%s filename=%s size=%s",
        dict(request.headers),
        upload.content_type,
        upload.filename,
        _estimate_upload_size(upload),
    )

    suffix = Path(upload.filename or "").suffix.lower()
    allowed_suffixes = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}
    allowed_mimes = {"image/png", "image/jpeg", "image/jpg", "image/tiff", "image/x-tiff"}
    has_image_mime = bool(upload.content_type and upload.content_type.lower() in allowed_mimes)
    if not has_image_mime and suffix not in allowed_suffixes:
        raise HTTPException(status_code=422, detail="이미지 파일만 업로드할 수 있습니다.")

    image = ImageAsset(
        filename=upload.filename or "원본이미지.png",
        content_type=upload.content_type,
        storage_path="",
    )
    try:
        storage_path, width, height = storage_service.save_upload(upload, image.id)
        image.storage_path = storage_path
        image.width = width
        image.height = height
    except PermissionError as exc:
        logger.error("스토리지 권한 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail="스토리지 쓰기 권한이 없습니다.") from exc
    except Exception as exc:
        logger.error("업로드 저장 실패: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail="이미지 저장 중 오류가 발생했습니다.") from exc

    session.add(image)
    session.commit()
    session.refresh(image)
    await upload.close()

    logger.info("이미지 업로드 완료: image_id=%s storage_path=%s", image.id, image.storage_path)
    return _to_image_schema(image)


@router.get("/images", response_model=list[ImageAssetRead])
def list_images(session: Session = Depends(get_session)) -> list[ImageAssetRead]:
    stmt = select(ImageAsset).order_by(desc(ImageAsset.created_at))
    items = session.exec(stmt).all()
    return [_to_image_schema(item) for item in items]


@router.get("/images/{image_id}", response_model=ImageAssetRead)
def get_image(image_id: str, session: Session = Depends(get_session)) -> ImageAssetRead:
    image = session.get(ImageAsset, image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다.")
    return _to_image_schema(image)


@router.get("/images/{image_id}/original")
def get_image_original(image_id: str, session: Session = Depends(get_session)) -> FileResponse:
    image = session.get(ImageAsset, image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다.")

    file_path = storage_service.resolve(image.storage_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="이미지 파일을 찾을 수 없습니다.")

    media_type = image.content_type or "application/octet-stream"
    return FileResponse(path=file_path, media_type=media_type, filename=Path(image.filename).name)


@router.get("/images/{image_id}/file")
def get_image_file_alias(image_id: str, session: Session = Depends(get_session)) -> FileResponse:
    return get_image_original(image_id, session)


@router.delete("/images/{image_id}", status_code=204, response_class=Response)
def delete_image(image_id: str, session: Session = Depends(get_session)) -> Response:
    image = session.get(ImageAsset, image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="삭제할 이미지를 찾을 수 없습니다.")

    image_dir_to_remove = Path(image_id)

    run_stmt = select(Run).where(Run.image_id == image_id)
    runs = session.exec(run_stmt).all()
    run_ids = [run.id for run in runs]

    if run_ids:
        artifact_stmt = select(StepArtifact).where(StepArtifact.run_id.in_(run_ids))
        artifacts = session.exec(artifact_stmt).all()
        for artifact in artifacts:
            session.delete(artifact)

    for run in runs:
        session.delete(run)

    session.delete(image)
    session.commit()

    try:
        storage_service.remove_tree(image_dir_to_remove)
        for run_id in run_ids:
            storage_service.remove_tree(Path(run_id))
    except Exception:
        logger.error("이미지 삭제 후 파일 정리 실패: %s", traceback.format_exc())

    return Response(status_code=204)


@router.post("/runs", response_model=RunRead, status_code=201)
def create_run(payload: RunCreate, session: Session = Depends(get_session)) -> RunRead:
    image = session.get(ImageAsset, payload.image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다.")

    run = Run(image_id=payload.image_id, name=payload.name)
    session.add(run)
    session.commit()
    session.refresh(run)
    storage_service.run_dir(run.id)
    return RunRead.model_validate(run)


@router.get("/runs", response_model=list[RunRead])
def list_runs(
    image_id: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
) -> list[RunRead]:
    stmt = select(Run)
    if image_id:
        stmt = stmt.where(Run.image_id == image_id)
    stmt = stmt.order_by(desc(Run.created_at))

    runs = session.exec(stmt).all()
    return [RunRead.model_validate(run) for run in runs]


@router.get("/runs/{run_id}", response_model=RunRead)
def get_run(run_id: str, session: Session = Depends(get_session)) -> RunRead:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")
    return RunRead.model_validate(run)


@router.get("/runs/{run_id}/history/export")
def export_run_history(
    run_id: str,
    session: Session = Depends(get_session),
) -> Response:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    stmt = (
        select(StepArtifact)
        .where(StepArtifact.run_id == run_id)
        .order_by(col(StepArtifact.step_id), col(StepArtifact.version), col(StepArtifact.created_at))
    )
    artifacts = [artifact for artifact in session.exec(stmt).all() if int(artifact.step_id) in HISTORY_EXPORT_STEP_IDS]

    exported_artifacts: list[dict[str, Any]] = []
    for artifact in artifacts:
        params = _safe_json_loads(artifact.params_json, {})
        if not isinstance(params, dict):
            params = {}

        files_data = _safe_json_loads(artifact.files_json, [])
        exported_files: list[dict[str, str]] = []
        for file_item in files_data:
            if not isinstance(file_item, dict):
                continue
            relative_path = str(file_item.get("path") or "").strip()
            if not relative_path:
                continue
            mime_type = str(file_item.get("mime_type") or "application/octet-stream")

            absolute_path = storage_service.resolve(relative_path)
            if not absolute_path.exists() or not absolute_path.is_file():
                logger.warning("버전 이력 내보내기 중 파일 누락: artifact_id=%s path=%s", artifact.id, relative_path)
                continue

            try:
                encoded = base64.b64encode(absolute_path.read_bytes()).decode("ascii")
            except Exception:
                logger.error("버전 이력 내보내기 파일 읽기 실패: %s", traceback.format_exc())
                continue

            exported_files.append(
                {
                    "filename": absolute_path.name,
                    "mime_type": mime_type,
                    "data_base64": encoded,
                }
            )

        exported_artifacts.append(
            {
                "source_artifact_id": artifact.id,
                "step_id": artifact.step_id,
                "version": artifact.version,
                "artifact_type": artifact.artifact_type,
                "params": params,
                "created_at": artifact.created_at.isoformat(),
                "files": exported_files,
            }
        )

    payload = {
        "schema_version": 1,
        "export_steps": list(HISTORY_EXPORT_STEP_IDS),
        "run_id": run.id,
        "image_id": run.image_id,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "artifacts": exported_artifacts,
    }

    filename = f"run-{run.id}-version-history.json"
    return Response(
        content=json.dumps(payload, ensure_ascii=False, indent=2),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/runs/{run_id}/history/import", response_model=RunHistoryImportResponse)
async def import_run_history(
    run_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> RunHistoryImportResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    form = await request.form()
    upload: Optional[UploadFile] = None
    file_item = form.get("file")
    if isinstance(file_item, StarletteUploadFile):
        upload = file_item
    if upload is None:
        alt_item = form.get("history_file")
        if isinstance(alt_item, StarletteUploadFile):
            upload = alt_item
    if upload is None:
        raise HTTPException(status_code=422, detail="가져올 파일을 선택해 주세요.")

    try:
        raw_bytes = await upload.read()
        if not raw_bytes:
            raise HTTPException(status_code=422, detail="가져올 파일 내용이 비어 있습니다.")
        try:
            payload = json.loads(raw_bytes.decode("utf-8"))
        except UnicodeDecodeError as exc:
            raise HTTPException(status_code=422, detail="파일 인코딩 형식이 올바르지 않습니다.") from exc
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail="버전 이력 파일 형식이 올바르지 않습니다.") from exc

        if not isinstance(payload, dict):
            raise HTTPException(status_code=422, detail="버전 이력 파일 형식이 올바르지 않습니다.")

        artifacts_payload = payload.get("artifacts")
        if not isinstance(artifacts_payload, list):
            raise HTTPException(status_code=422, detail="버전 이력 데이터에 산출물 목록이 없습니다.")

        next_versions: dict[int, int] = {}
        source_to_new_artifact_id: dict[str, str] = {}
        imported_count = 0
        staged_items: list[dict[str, Any]] = []

        for item_index, artifact_item in enumerate(artifacts_payload):
            if not isinstance(artifact_item, dict):
                raise ValueError(f"{item_index + 1}번째 항목 형식이 올바르지 않습니다.")

            step_id = _safe_step_id(artifact_item.get("step_id"))
            if step_id not in HISTORY_EXPORT_STEP_IDS:
                continue
            artifact_type = str(artifact_item.get("artifact_type") or "").strip()
            if not artifact_type:
                raise ValueError(f"{item_index + 1}번째 항목의 산출물 종류가 비어 있습니다.")

            params = artifact_item.get("params")
            if not isinstance(params, dict):
                params = {}

            files_payload = artifact_item.get("files")
            if files_payload is None:
                files_payload = []
            if not isinstance(files_payload, list):
                raise ValueError(f"{item_index + 1}번째 항목의 파일 목록 형식이 올바르지 않습니다.")

            version = next_versions.get(step_id)
            if version is None:
                version = _next_artifact_version(session, run_id, step_id)
            next_versions[step_id] = version + 1

            source_artifact_id_raw = artifact_item.get("source_artifact_id")
            source_artifact_id = str(source_artifact_id_raw).strip() if source_artifact_id_raw is not None else None
            if source_artifact_id == "":
                source_artifact_id = None

            artifact = StepArtifact(
                run_id=run_id,
                step_id=step_id,
                version=version,
                artifact_type=artifact_type,
                params_json="{}",
                files_json="[]",
            )
            session.add(artifact)
            session.flush()

            if source_artifact_id:
                source_to_new_artifact_id[source_artifact_id] = artifact.id
            staged_items.append(
                {
                    "item_index": item_index,
                    "artifact": artifact,
                    "step_id": step_id,
                    "version": version,
                    "params": params,
                    "files_payload": files_payload,
                }
            )

        for staged in staged_items:
            item_index = int(staged["item_index"])
            artifact = staged["artifact"]
            step_id = int(staged["step_id"])
            version = int(staged["version"])
            params = staged["params"]
            files_payload = staged["files_payload"]

            remapped_params = _remap_artifact_refs(params, source_to_new_artifact_id)
            if not isinstance(remapped_params, dict):
                remapped_params = {}
            artifact.params_json = json.dumps(remapped_params, ensure_ascii=False)

            artifact_dir = Path(run.id) / "history_import" / f"step_{step_id}" / f"v{version}" / artifact.id
            restored_files: list[dict[str, str]] = []
            for file_index, file_item_data in enumerate(files_payload):
                if not isinstance(file_item_data, dict):
                    continue
                encoded_data = file_item_data.get("data_base64")
                if not isinstance(encoded_data, str) or len(encoded_data.strip()) == 0:
                    continue
                try:
                    decoded = base64.b64decode(encoded_data.encode("ascii"), validate=True)
                except Exception as exc:
                    raise ValueError(f"{item_index + 1}번째 항목의 파일 데이터가 올바르지 않습니다.") from exc

                filename = _safe_filename(file_item_data.get("filename"), f"파일_{file_index + 1}.bin")
                mime_type = str(file_item_data.get("mime_type") or "application/octet-stream")

                relative_path = artifact_dir / filename
                absolute_path = storage_service.resolve(relative_path)
                absolute_path.parent.mkdir(parents=True, exist_ok=True)
                absolute_path.write_bytes(decoded)
                restored_files.append({"path": str(relative_path), "mime_type": mime_type})

            artifact.files_json = json.dumps(restored_files, ensure_ascii=False)
            session.add(artifact)
            imported_count += 1

        if imported_count == 0:
            raise HTTPException(status_code=422, detail="가져올 1~8단계 산출물이 없습니다.")

        session.commit()
        return RunHistoryImportResponse(run_id=run_id, imported_count=imported_count)
    except HTTPException:
        session.rollback()
        raise
    except ValueError as exc:
        session.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        session.rollback()
        logger.error("버전 이력 가져오기 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"버전 이력 가져오기 중 오류가 발생했습니다: {exc}") from exc
    finally:
        if upload is not None:
            await upload.close()


@router.post("/runs/{run_id}/steps/1/execute", response_model=Step1ExecuteResponse)
def execute_step1(
    run_id: str,
    payload: Step1ExecuteRequest,
    session: Session = Depends(get_session),
) -> Step1ExecuteResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        version, artifacts = execute_step(session, run, 1, payload.model_dump())
        session.commit()
    except LookupError as exc:
        session.rollback()
        logger.error("Step1 실행 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        session.rollback()
        logger.error("Step1 실행 검증 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        session.rollback()
        logger.error("Step1 실행 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"단계 실행 중 오류가 발생했습니다: {exc}") from exc

    if not artifacts:
        raise HTTPException(status_code=500, detail="스케일 보정 산출물 생성에 실패했습니다.")

    artifact_schema = _artifact_to_schema(artifacts[0])
    return Step1ExecuteResponse(
        run_id=run_id,
        step_id=1,
        version=version,
        artifact=artifact_schema,
    )


@router.post("/runs/{run_id}/steps/3/preview")
def preview_step3(
    run_id: str,
    payload: Step3ExecuteRequest,
    session: Session = Depends(get_session),
) -> Response:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        png_bytes = create_step3_preview_png(session, run, payload.model_dump(exclude_none=True))
    except LookupError as exc:
        logger.error("Step3 미리보기 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        logger.error("Step3 미리보기 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저 완료" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Step3 미리보기 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"미리보기 생성 중 오류가 발생했습니다: {exc}") from exc

    return Response(content=png_bytes, media_type="image/png")


@router.post("/runs/{run_id}/steps/3/execute", response_model=StepExecuteResponse)
def execute_step3(
    run_id: str,
    payload: Step3ExecuteRequest,
    session: Session = Depends(get_session),
) -> StepExecuteResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        version, artifacts = execute_step(session, run, 3, payload.model_dump(exclude_none=True))
        session.commit()
    except LookupError as exc:
        session.rollback()
        logger.error("Step3 실행 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        session.rollback()
        logger.error("Step3 실행 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저 완료" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        session.rollback()
        logger.error("Step3 실행 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"3단계 실행 중 오류가 발생했습니다: {exc}") from exc

    return StepExecuteResponse(
        run_id=run_id,
        step_id=3,
        version=version,
        artifacts=[_artifact_to_schema(item) for item in artifacts],
    )


@router.post("/runs/{run_id}/steps/4/preview")
def preview_step4(
    run_id: str,
    payload: Step4PreviewRequest,
    session: Session = Depends(get_session),
) -> Response:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        png_bytes = create_step4_preview_png(session, run, payload.model_dump(exclude_none=True))
    except LookupError as exc:
        logger.error("Step4 미리보기 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        logger.error("Step4 미리보기 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저 완료" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Step4 미리보기 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"미리보기 생성 중 오류가 발생했습니다: {exc}") from exc

    return Response(content=png_bytes, media_type="image/png")


@router.post("/runs/{run_id}/steps/4/execute", response_model=StepExecuteResponse)
def execute_step4(
    run_id: str,
    payload: Step4ExecuteRequest,
    session: Session = Depends(get_session),
) -> StepExecuteResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        version, artifacts = execute_step(session, run, 4, payload.model_dump(exclude_none=True))
        session.commit()
    except LookupError as exc:
        session.rollback()
        logger.error("Step4 실행 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        session.rollback()
        logger.error("Step4 실행 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저 완료" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        session.rollback()
        logger.error("Step4 실행 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"4단계 실행 중 오류가 발생했습니다: {exc}") from exc

    return StepExecuteResponse(
        run_id=run_id,
        step_id=4,
        version=version,
        artifacts=[_artifact_to_schema(item) for item in artifacts],
    )


@router.post("/runs/{run_id}/steps/5/execute", response_model=StepExecuteResponse)
def execute_step5(
    run_id: str,
    payload: Step5ExecuteRequest,
    session: Session = Depends(get_session),
) -> StepExecuteResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        version, artifacts = execute_step(session, run, 5, payload.model_dump(exclude_none=True))
        session.commit()
    except LookupError as exc:
        session.rollback()
        logger.error("Step5 실행 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        session.rollback()
        logger.error("Step5 실행 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저 완료" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        session.rollback()
        logger.error("Step5 실행 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"5단계 실행 중 오류가 발생했습니다: {exc}") from exc

    return StepExecuteResponse(
        run_id=run_id,
        step_id=5,
        version=version,
        artifacts=[_artifact_to_schema(item) for item in artifacts],
    )


@router.post("/runs/{run_id}/steps/6/preview")
def preview_step6(
    run_id: str,
    payload: Step6ExecuteRequest,
    session: Session = Depends(get_session),
) -> Response:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        png_bytes = create_step6_preview_png(session, run, payload.model_dump(exclude_none=True))
    except LookupError as exc:
        logger.error("Step6 미리보기 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        logger.error("Step6 미리보기 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저 완료" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Step6 미리보기 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"미리보기 생성 중 오류가 발생했습니다: {exc}") from exc

    return Response(content=png_bytes, media_type="image/png")


@router.post("/runs/{run_id}/steps/6/execute", response_model=StepExecuteResponse)
def execute_step6(
    run_id: str,
    payload: Step6ExecuteRequest,
    session: Session = Depends(get_session),
) -> StepExecuteResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        version, artifacts = execute_step(session, run, 6, payload.model_dump(exclude_none=True))
        session.commit()
    except LookupError as exc:
        session.rollback()
        logger.error("Step6 실행 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        session.rollback()
        logger.error("Step6 실행 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저 완료" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        session.rollback()
        logger.error("Step6 실행 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"6단계 실행 중 오류가 발생했습니다: {exc}") from exc

    return StepExecuteResponse(
        run_id=run_id,
        step_id=6,
        version=version,
        artifacts=[_artifact_to_schema(item) for item in artifacts],
    )


@router.post("/runs/{run_id}/steps/7/preview", response_model=Step7PreviewResponse)
def preview_step7(
    run_id: str,
    payload: Step7ExecuteRequest,
    session: Session = Depends(get_session),
) -> Step7PreviewResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        preview_payload = create_step7_preview_payload(session, run, payload.model_dump(exclude_none=True))
    except LookupError as exc:
        logger.error("Step7 미리보기 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        logger.error("Step7 미리보기 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저 완료" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Step7 미리보기 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"미리보기 생성 중 오류가 발생했습니다: {exc}") from exc

    return Step7PreviewResponse.model_validate(preview_payload)


@router.post("/runs/{run_id}/steps/7/execute", response_model=StepExecuteResponse)
def execute_step7(
    run_id: str,
    payload: Step7ExecuteRequest,
    session: Session = Depends(get_session),
) -> StepExecuteResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        version, artifacts = execute_step(session, run, 7, payload.model_dump(exclude_none=True))
        session.commit()
    except LookupError as exc:
        session.rollback()
        logger.error("Step7 실행 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        session.rollback()
        logger.error("Step7 실행 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저 완료" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        session.rollback()
        logger.error("Step7 실행 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"7단계 실행 중 오류가 발생했습니다: {exc}") from exc

    return StepExecuteResponse(
        run_id=run_id,
        step_id=7,
        version=version,
        artifacts=[_artifact_to_schema(item) for item in artifacts],
    )


@router.post("/runs/{run_id}/steps/8/execute", response_model=StepExecuteResponse)
def execute_step8(
    run_id: str,
    payload: Step8ExecuteRequest,
    session: Session = Depends(get_session),
) -> StepExecuteResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        version, artifacts = execute_step(session, run, 8, payload.model_dump(exclude_none=True))
        session.commit()
    except LookupError as exc:
        session.rollback()
        logger.error("Step8 실행 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        session.rollback()
        logger.error("Step8 실행 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        session.rollback()
        logger.error("Step8 실행 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"8단계 실행 중 오류가 발생했습니다: {exc}") from exc

    return StepExecuteResponse(
        run_id=run_id,
        step_id=8,
        version=version,
        artifacts=[_artifact_to_schema(item) for item in artifacts],
    )


@router.post("/runs/{run_id}/steps/9/preview", response_model=Step9PreviewResponse)
def preview_step9(
    run_id: str,
    payload: Step9ExecuteRequest,
    session: Session = Depends(get_session),
) -> Step9PreviewResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        preview_payload = create_step9_preview_payload(session, run, payload.model_dump(exclude_none=True))
    except LookupError as exc:
        logger.error("Step9 미리보기 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        logger.error("Step9 미리보기 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Step9 미리보기 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"미리보기 생성 중 오류가 발생했습니다: {exc}") from exc

    return Step9PreviewResponse.model_validate(preview_payload)


@router.post("/runs/{run_id}/steps/9/execute", response_model=StepExecuteResponse)
def execute_step9(
    run_id: str,
    payload: Step9ExecuteRequest,
    session: Session = Depends(get_session),
) -> StepExecuteResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        version, artifacts = execute_step(session, run, 9, payload.model_dump(exclude_none=True))
        session.commit()
    except LookupError as exc:
        session.rollback()
        logger.error("Step9 실행 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        session.rollback()
        logger.error("Step9 실행 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        session.rollback()
        logger.error("Step9 실행 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"9단계 실행 중 오류가 발생했습니다: {exc}") from exc

    return StepExecuteResponse(
        run_id=run_id,
        step_id=9,
        version=version,
        artifacts=[_artifact_to_schema(item) for item in artifacts],
    )


@router.post("/runs/{run_id}/steps/10/preview", response_model=Step10PreviewResponse)
def preview_step10(
    run_id: str,
    payload: Step10ExecuteRequest,
    session: Session = Depends(get_session),
) -> Step10PreviewResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        preview_payload = create_step10_preview_payload(session, run, payload.model_dump(exclude_none=True))
    except LookupError as exc:
        logger.error("Step10 미리보기 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        logger.error("Step10 미리보기 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Step10 미리보기 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"미리보기 생성 중 오류가 발생했습니다: {exc}") from exc

    return Step10PreviewResponse.model_validate(preview_payload)


@router.post("/runs/{run_id}/steps/10/execute", response_model=StepExecuteResponse)
def execute_step10(
    run_id: str,
    payload: Step10ExecuteRequest,
    session: Session = Depends(get_session),
) -> StepExecuteResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        version, artifacts = execute_step(session, run, 10, payload.model_dump(exclude_none=True))
        session.commit()
    except LookupError as exc:
        session.rollback()
        logger.error("Step10 실행 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        session.rollback()
        logger.error("Step10 실행 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        session.rollback()
        logger.error("Step10 실행 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"10단계 실행 중 오류가 발생했습니다: {exc}") from exc

    return StepExecuteResponse(
        run_id=run_id,
        step_id=10,
        version=version,
        artifacts=[_artifact_to_schema(item) for item in artifacts],
    )


@router.post("/runs/{run_id}/steps/{step_id}/execute", response_model=StepExecuteResponse)
def execute_pipeline_step(
    run_id: str,
    step_id: int,
    payload: StepExecuteRequest,
    session: Session = Depends(get_session),
) -> StepExecuteResponse:
    if step_id not in VALID_STEP_IDS:
        raise HTTPException(status_code=422, detail="지원하지 않는 단계입니다.")

    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    try:
        version, artifacts = execute_step(session, run, step_id, payload.params)
        session.commit()
    except LookupError as exc:
        session.rollback()
        logger.error("단계 실행 조회 오류: %s", traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        session.rollback()
        logger.error("단계 실행 검증 오류: %s", traceback.format_exc())
        status_code = 409 if "먼저 완료" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        session.rollback()
        logger.error("단계 실행 예외: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"단계 실행 중 오류가 발생했습니다: {exc}") from exc

    return StepExecuteResponse(
        run_id=run_id,
        step_id=step_id,
        version=version,
        artifacts=[_artifact_to_schema(item) for item in artifacts],
    )


@router.get("/runs/{run_id}/artifacts", response_model=RunArtifactsGroupedResponse)
def list_run_artifacts(
    run_id: str,
    session: Session = Depends(get_session),
) -> RunArtifactsGroupedResponse:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")

    stmt = (
        select(StepArtifact)
        .where(StepArtifact.run_id == run_id)
        .order_by(col(StepArtifact.step_id), desc(StepArtifact.version), desc(StepArtifact.created_at))
    )
    artifacts = session.exec(stmt).all()

    grouped: dict[int, dict[int, list[StepArtifactRead]]] = defaultdict(lambda: defaultdict(list))
    for artifact in artifacts:
        schema_item = _artifact_to_schema(artifact)
        grouped[schema_item.step_id][schema_item.version].append(schema_item)

    steps: list[ArtifactStepGroup] = []
    for step_key in sorted(grouped.keys()):
        versions: list[ArtifactVersionGroup] = []
        for version_key in sorted(grouped[step_key].keys(), reverse=True):
            versions.append(ArtifactVersionGroup(version=version_key, artifacts=grouped[step_key][version_key]))
        steps.append(ArtifactStepGroup(step_id=step_key, versions=versions))

    return RunArtifactsGroupedResponse(run_id=run_id, steps=steps)


@router.get("/artifacts/{artifact_id}", response_model=StepArtifactRead)
def get_artifact(artifact_id: str, session: Session = Depends(get_session)) -> StepArtifactRead:
    artifact = session.get(StepArtifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="산출물을 찾을 수 없습니다.")
    return _artifact_to_schema(artifact)


@router.get("/artifacts/{artifact_id}/file")
def get_artifact_file(
    artifact_id: str,
    file_index: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> FileResponse:
    artifact = session.get(StepArtifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="산출물을 찾을 수 없습니다.")

    files = _safe_json_loads(artifact.files_json, [])
    if file_index >= len(files):
        raise HTTPException(status_code=404, detail="요청한 파일 인덱스를 찾을 수 없습니다.")

    file_item = files[file_index]
    if not isinstance(file_item, dict):
        raise HTTPException(status_code=404, detail="파일 메타데이터 형식이 올바르지 않습니다.")
    relative_path = file_item.get("path")
    media_type = file_item.get("mime_type", "application/octet-stream")
    if not relative_path:
        raise HTTPException(status_code=404, detail="파일 경로 정보가 없습니다.")

    absolute_path = storage_service.resolve(relative_path).resolve()
    try:
        absolute_path.relative_to(storage_service.root.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="유효하지 않은 파일 경로입니다.") from exc

    if not absolute_path.exists():
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")

    return FileResponse(
        path=absolute_path,
        media_type=media_type,
        filename=absolute_path.name,
    )


@router.patch("/artifacts/{artifact_id}/name", response_model=StepArtifactRead)
def rename_artifact_version(
    artifact_id: str,
    payload: ArtifactRenameRequest,
    session: Session = Depends(get_session),
) -> StepArtifactRead:
    artifact = session.get(StepArtifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="산출물을 찾을 수 없습니다.")

    new_name = payload.name.strip()
    if len(new_name) == 0:
        raise HTTPException(status_code=422, detail="버전 이름을 입력해 주세요.")

    stmt = select(StepArtifact).where(
        StepArtifact.run_id == artifact.run_id,
        StepArtifact.step_id == artifact.step_id,
        StepArtifact.version == artifact.version,
    )
    targets = session.exec(stmt).all()
    for target in targets:
        params = _safe_json_loads(target.params_json, {})
        if not isinstance(params, dict):
            params = {}
        params["version_name"] = new_name
        target.params_json = json.dumps(params, ensure_ascii=False)
        session.add(target)

    session.commit()
    session.refresh(artifact)
    return _artifact_to_schema(artifact)


@router.delete("/artifacts/{artifact_id}", status_code=204, response_class=Response)
def delete_artifact_version(
    artifact_id: str,
    session: Session = Depends(get_session),
) -> Response:
    artifact = session.get(StepArtifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="삭제할 산출물을 찾을 수 없습니다.")

    stmt = select(StepArtifact).where(
        StepArtifact.run_id == artifact.run_id,
        StepArtifact.step_id == artifact.step_id,
        StepArtifact.version == artifact.version,
    )
    targets = session.exec(stmt).all()

    dirs_to_remove: set[Path] = set()
    for target in targets:
        files = _safe_json_loads(target.files_json, [])
        for file_item in files:
            if isinstance(file_item, dict) and file_item.get("path"):
                dirs_to_remove.add(Path(str(file_item["path"])).parent)
        session.delete(target)

    session.commit()

    for target_dir in sorted(dirs_to_remove, key=lambda item: len(item.parts), reverse=True):
        try:
            storage_service.remove_tree(target_dir)
        except Exception:
            logger.error("버전 삭제 후 파일 정리 실패: %s", traceback.format_exc())

    return Response(status_code=204)
