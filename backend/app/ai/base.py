from dataclasses import dataclass, field
from typing import Protocol

from PIL import Image


class AiUnavailable(Exception):
    """Le fournisseur ne peut pas répondre (absent, panne, quota dépassé…). Message en français,
    affichable tel quel : l'utilisateur continue alors en saisie manuelle."""


@dataclass
class Identification:
    name: str | None = None
    category: str | None = None
    brand: str | None = None
    mpn: str | None = None
    description: str | None = None
    keywords: list[str] = field(default_factory=list)
    confidence: float | None = None


class OcrProvider(Protocol):
    name: str

    def available(self) -> bool: ...

    def ocr(self, image: Image.Image) -> str: ...


class Identifier(Protocol):
    name: str

    def identify(self, image: Image.Image, categories: list[str]) -> Identification: ...


class Embedder(Protocol):
    name: str
    model: str

    def available(self) -> bool: ...

    def embed(self, image: Image.Image) -> list[float]: ...
