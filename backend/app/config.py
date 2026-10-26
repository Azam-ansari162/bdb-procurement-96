"""
Application configuration via environment variables.
"""

import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables or .env file."""

    frontend_origin: str = "http://localhost:5173"
    elexon_base_url: str = "https://data.elexon.co.uk/bmrs/api/v1"
    log_level: str = "INFO"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
