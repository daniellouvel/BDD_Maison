from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MW_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://myworkshop:change-me@127.0.0.1:5432/myworkshop"
    data_dir: Path = Path("./data")
    cookie_secure: bool = True
    session_ttl_days: int = 30
    max_upload_bytes: int = 15 * 1024 * 1024
    cors_origins: list[str] = []
    # Contenu encodé dans les QR. Vide : le QR contient seulement le code (« QR-000001 »),
    # ce qui reste valable même si l'adresse du serveur change. Sinon, URL du type
    # https://workshop.mondomaine.fr : le QR contient https://…/l/QR-000001 et s'ouvre
    # aussi avec l'appareil photo du téléphone. Attention : une fois imprimée, l'URL est définitive.
    qr_public_url: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
