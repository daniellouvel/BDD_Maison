"""Choix des fournisseurs selon la configuration. Les tests remplacent les fournisseurs avec
override()."""

from functools import lru_cache
from typing import Any

from app.ai.base import Embedder, Identifier, OcrProvider
from app.ai.clip import ClipEmbedder
from app.ai.remote import OpenAiCompatibleIdentifier
from app.ai.tesseract import TesseractOcr
from app.core.config import get_settings

_overrides: dict[str, Any] = {}


def override(**providers: Any) -> None:
    """override(ocr=…, identifier=…, embedder=…) ; une valeur None annule le remplacement."""
    for key, value in providers.items():
        if value is None:
            _overrides.pop(key, None)
        else:
            _overrides[key] = value


def clear_overrides() -> None:
    _overrides.clear()


@lru_cache
def _ocr() -> OcrProvider:
    s = get_settings()
    return TesseractOcr(s.ai_tesseract_cmd, s.ai_ocr_lang)


@lru_cache
def _embedder() -> Embedder | None:
    s = get_settings()
    if not s.ai_embeddings:
        return None
    return ClipEmbedder(s.ai_embedding_model, s.data_dir / "models")


def ocr() -> OcrProvider:
    return _overrides.get("ocr") or _ocr()


def embedder() -> Embedder | None:
    if "embedder" in _overrides:
        return _overrides["embedder"]
    engine = _embedder()
    return engine if engine is not None and engine.available() else None


def identifier() -> Identifier | None:
    """Service externe configuré (l'activation par l'administrateur est vérifiée par le service)."""
    if "identifier" in _overrides:
        return _overrides["identifier"]
    s = get_settings()
    if not (s.ai_remote_url and s.ai_remote_model):
        return None
    return OpenAiCompatibleIdentifier(
        s.ai_remote_url, s.ai_remote_key, s.ai_remote_model, s.ai_remote_timeout
    )


def remote_host() -> str | None:
    if "identifier" in _overrides:
        return "test"
    url = get_settings().ai_remote_url
    if not url:
        return None
    from urllib.parse import urlparse

    return urlparse(url).hostname
