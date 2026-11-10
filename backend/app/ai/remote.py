"""Identification par un service externe au format « compatible OpenAI » (chat/completions avec
image). Fonctionne avec l'offre gratuite de Google Gemini, Groq, OpenRouter ou un Ollama local."""

import base64
import io
import json
import re
from typing import Any

import httpx
from PIL import Image

from app.ai.base import AiUnavailable, Identification

MAX_SIDE = 1024

PROMPT = """Tu aides à inventorier un atelier de bricolage et d'électronique.
Identifie l'objet principal de la photo. Réponds uniquement avec un objet JSON :
{{"name": "nom court et précis en français (type, caractéristique principale)",
 "category": "une des catégories ci-dessous, ou null",
 "brand": "marque lisible ou null",
 "mpn": "référence fabricant lisible ou null",
 "description": "une ou deux phrases en français",
 "keywords": ["mots-clés", "en français"],
 "confidence": 0.0 à 1.0}}
N'invente pas de marque ni de référence que tu ne lis pas sur la photo.
Catégories existantes : {categories}"""


def _image_data_url(image: Image.Image) -> str:
    img = image.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or value.lower() in {"null", "none", "inconnu", "unknown"}:
        return None
    return value[:limit]


def parse_identification(content: str) -> Identification:
    """Extrait le JSON de la réponse (tolère les blocs ```json et le texte autour)."""
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if not match:
        raise AiUnavailable("Réponse du service d'identification illisible.")
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise AiUnavailable("Réponse du service d'identification illisible.") from exc
    if not isinstance(data, dict):
        raise AiUnavailable("Réponse du service d'identification illisible.")
    keywords = data.get("keywords")
    confidence = data.get("confidence")
    return Identification(
        name=_text(data.get("name"), 200),
        category=_text(data.get("category"), 120),
        brand=_text(data.get("brand"), 120),
        mpn=_text(data.get("mpn"), 120),
        description=_text(data.get("description"), 2000),
        keywords=[k.strip()[:60] for k in keywords if isinstance(k, str) and k.strip()][:10]
        if isinstance(keywords, list)
        else [],
        confidence=max(0.0, min(1.0, float(confidence)))
        if isinstance(confidence, int | float)
        else None,
    )


class OpenAiCompatibleIdentifier:
    name = "remote"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.transport = transport

    def identify(self, image: Image.Image, categories: list[str]) -> Identification:
        body = {
            "model": self.model,
            "temperature": 0.2,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": PROMPT.format(categories=", ".join(categories) or "aucune"),
                        },
                        {"type": "image_url", "image_url": {"url": _image_data_url(image)}},
                    ],
                }
            ],
        }
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        try:
            with httpx.Client(timeout=self.timeout, transport=self.transport) as client:
                response = client.post(f"{self.base_url}/chat/completions", json=body, headers=headers)
        except httpx.TimeoutException as exc:
            raise AiUnavailable(
                "Le service d'identification n'a pas répondu à temps. Essayez un modèle plus rapide."
            ) from exc
        except httpx.HTTPError as exc:
            raise AiUnavailable("Service d'identification injoignable.") from exc
        if response.status_code == 429:
            raise AiUnavailable("Quota gratuit du service d'identification atteint : réessayez plus tard.")
        if response.status_code in (401, 403):
            raise AiUnavailable("Clé du service d'identification refusée.")
        if response.status_code >= 400:
            raise AiUnavailable(f"Le service d'identification a répondu {response.status_code}.")
        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise AiUnavailable("Réponse du service d'identification illisible.") from exc
        if not isinstance(content, str):
            raise AiUnavailable("Réponse du service d'identification illisible.")
        return parse_identification(content)
