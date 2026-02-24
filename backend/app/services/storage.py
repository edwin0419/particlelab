from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image
from fastapi import UploadFile

from app.settings import settings


class StorageService:
    def __init__(self) -> None:
        self.root = settings.storage_dir
        self.root.mkdir(parents=True, exist_ok=True)

    def image_dir(self, image_id: str) -> Path:
        path = self.root / image_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def image_original_dir(self, image_id: str) -> Path:
        path = self.image_dir(image_id) / "original"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def run_dir(self, run_id: str) -> Path:
        path = self.root / run_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def resolve(self, relative_path: str | Path) -> Path:
        return self.root / Path(relative_path)

    def remove_tree(self, relative_path: str | Path) -> None:
        target = self.resolve(relative_path)
        if target.exists() and target.is_dir():
            shutil.rmtree(target)

    def save_upload(self, file: UploadFile, image_id: str) -> tuple[str, int, int]:
        suffix = Path(file.filename or "").suffix.lower() or ".png"
        safe_name = Path(file.filename or f"original{suffix}").name.strip() or f"original{suffix}"
        if "." not in safe_name:
            safe_name = f"{safe_name}{suffix}"
        target_dir = self.image_original_dir(image_id)
        target_path = target_dir / safe_name

        with target_path.open("wb") as out:
            shutil.copyfileobj(file.file, out)

        with Image.open(target_path) as img:
            width, height = img.size

        rel_path = target_path.relative_to(self.root)
        return str(rel_path), width, height

    def copy_file(self, source_relative_path: str | Path, dest_relative_path: str | Path) -> str:
        source_path = self.resolve(source_relative_path)
        dest_path = self.resolve(dest_relative_path)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, dest_path)
        return str(Path(dest_relative_path))

    def write_json(self, relative_path: str | Path, payload: dict | list) -> str:
        target = self.resolve(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return str(Path(relative_path))

    def create_blank_mask(self, relative_path: str | Path, width: int, height: int) -> str:
        target = self.resolve(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        image = Image.new("L", (width, height), 0)
        image.save(target, format="PNG")
        return str(Path(relative_path))

    def run_step_dir(self, run_id: str, step_id: int, version: int) -> Path:
        path = Path(run_id) / f"step_{step_id}" / f"v{version}"
        full = self.resolve(path)
        full.mkdir(parents=True, exist_ok=True)
        return path

    def run_step1_artifact_dir(self, run_id: str, artifact_id: str) -> Path:
        path = Path(run_id) / "step1" / artifact_id
        full = self.resolve(path)
        full.mkdir(parents=True, exist_ok=True)
        return path

    def run_step4_artifact_dir(self, run_id: str, artifact_id: str) -> Path:
        path = Path(run_id) / "step4" / artifact_id
        full = self.resolve(path)
        full.mkdir(parents=True, exist_ok=True)
        return path

    def run_step5_artifact_dir(self, run_id: str, artifact_id: str) -> Path:
        path = Path(run_id) / "step5" / artifact_id
        full = self.resolve(path)
        full.mkdir(parents=True, exist_ok=True)
        return path

    def run_step6_artifact_dir(self, run_id: str, artifact_id: str) -> Path:
        path = Path(run_id) / "step6" / artifact_id
        full = self.resolve(path)
        full.mkdir(parents=True, exist_ok=True)
        return path

    def run_step7_artifact_dir(self, run_id: str, artifact_id: str) -> Path:
        path = Path(run_id) / "step7" / artifact_id
        full = self.resolve(path)
        full.mkdir(parents=True, exist_ok=True)
        return path

    def run_step8_artifact_dir(self, run_id: str, artifact_id: str) -> Path:
        path = Path(run_id) / "step8" / artifact_id
        full = self.resolve(path)
        full.mkdir(parents=True, exist_ok=True)
        return path

    def run_step9_artifact_dir(self, run_id: str, artifact_id: str) -> Path:
        path = Path(run_id) / "step9" / artifact_id
        full = self.resolve(path)
        full.mkdir(parents=True, exist_ok=True)
        return path

    def run_step10_artifact_dir(self, run_id: str, artifact_id: str) -> Path:
        path = Path(run_id) / "step10" / artifact_id
        full = self.resolve(path)
        full.mkdir(parents=True, exist_ok=True)
        return path

    def write_image_png(self, relative_path: str | Path, image: Image.Image) -> str:
        target = self.resolve(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, format="PNG")
        return str(Path(relative_path))


storage_service = StorageService()
