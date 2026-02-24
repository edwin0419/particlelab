from __future__ import annotations

from pathlib import Path


class Settings:
    app_name = "입자 분석 API"
    app_version = "0.1.0"

    base_dir = Path(__file__).resolve().parents[1]
    storage_dir = base_dir / "storage"
    db_path = base_dir / "app.db"
    database_url = f"sqlite:///{db_path}"

    cors_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]


settings = Settings()
