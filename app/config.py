import os
from typing import List
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    db_path: str = "queuecraft.db"
    host: str = "127.0.0.1"
    port: int = 5000
    cors_origins: List[str] = ["http://localhost:5173", "http://localhost:3000", "http://localhost:5000", "http://127.0.0.1:5173", "http://127.0.0.1:3000"]
    environment: str = "development"
    mock_auth: bool = False
    jwt_secret: str = "queuecraft_jwt_secret_key_2026"



    @model_validator(mode="after")
    def validate_production_mock_auth(self) -> "Settings":
        if self.environment == "production" and self.mock_auth:
            raise ValueError("mock_auth must be disabled in production environment")
        return self

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )



# Instantiate settings
settings = Settings()
