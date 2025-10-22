"""Configuration management for the privacy-first assistant."""

from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Mahi Privacy Assistant"
    debug: bool = False

    api_host: str = "0.0.0.0"
    api_port: int = 5000
    allow_origins: List[str] = Field(default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"])

    storage_root: Path = Field(default_factory=lambda: Path.cwd() / "var")
    vector_db_path: Path = Field(default_factory=lambda: Path.cwd() / "var" / "pki.sqlite")
    encryption_key_service: str = "mahi-privacy-assistant"

    mlx_model_id: str = Field(
        default="mlx-community/Meta-Llama-3-8B-Instruct",
        description="Hugging Face repo or local path to MLX-compatible model",
    )
    mlx_embed_fallback: bool = True
    mlx_max_tokens: int = 512

    enable_plugin_sandbox: bool = True
    plugin_root: Path = Field(default_factory=lambda: Path.cwd() / "plugins" / "installed")

    class Config:
        env_file = ".env"
        env_prefix = "PRIVACY_ASSISTANT_"
        case_sensitive = False


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    settings.vector_db_path.parent.mkdir(parents=True, exist_ok=True)
    settings.plugin_root.mkdir(parents=True, exist_ok=True)
    return settings
