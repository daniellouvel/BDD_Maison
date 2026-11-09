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

    # --- IA (phase 4). Tout est facultatif : sans IA, la saisie manuelle reste complète. ---
    # Lecture du texte : binaire Tesseract (paquets Debian tesseract-ocr + tesseract-ocr-fra).
    ai_tesseract_cmd: str = "tesseract"
    ai_ocr_lang: str = "fra+eng"
    # Recherche par photo : modèle CLIP local (extra Python « ai » : fastembed). Téléchargé au
    # premier usage dans MW_DATA_DIR/models (~340 Mo).
    ai_embeddings: bool = True
    ai_embedding_model: str = "Qdrant/clip-ViT-B-32-vision"
    # Identification par un service externe compatible OpenAI (Gemini, Groq, OpenRouter, Ollama…).
    # Même configuré, il reste désactivé tant qu'un administrateur ne l'active pas dans les
    # réglages : les photos quittent alors le serveur.
    ai_remote_url: str = ""
    ai_remote_key: str = ""
    ai_remote_model: str = ""
    ai_remote_timeout: float = 60.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
