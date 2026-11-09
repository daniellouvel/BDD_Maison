"""Empreintes visuelles avec un modèle CLIP local (ONNX, CPU) via fastembed."""

import importlib.util
import threading
from pathlib import Path
from typing import Any

from PIL import Image

from app.ai.base import AiUnavailable


class ClipEmbedder:
    name = "clip"

    def __init__(self, model: str, cache_dir: Path) -> None:
        self.model = model
        self.cache_dir = cache_dir
        self._engine: Any = None
        self._lock = threading.Lock()

    def available(self) -> bool:
        return importlib.util.find_spec("fastembed") is not None

    def _load(self) -> Any:
        with self._lock:
            if self._engine is None:
                if not self.available():
                    raise AiUnavailable("Recherche par photo indisponible : fastembed n'est pas installé.")
                from fastembed import ImageEmbedding

                self.cache_dir.mkdir(parents=True, exist_ok=True)
                try:
                    self._engine = ImageEmbedding(self.model, cache_dir=str(self.cache_dir))
                except Exception as exc:  # téléchargement ou chargement du modèle
                    raise AiUnavailable("Le modèle de recherche par photo n'a pas pu être chargé.") from exc
            return self._engine

    def embed(self, image: Image.Image) -> list[float]:
        engine = self._load()
        vector = next(iter(engine.embed([image.convert("RGB")])))
        return [float(x) for x in vector]
