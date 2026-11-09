import io
import json
import shutil

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

from app.ai import registry
from app.ai.base import AiUnavailable, Identification
from app.ai.remote import OpenAiCompatibleIdentifier, parse_identification
from app.services.ai import extract_references
from tests.conftest import CSRF, PASSWORD, create_user

API = "/api/v1"


def _png(color: tuple[int, int, int]) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (400, 300), color).save(buf, format="PNG")
    return buf.getvalue()


class FakeOcr:
    name = "fake-ocr"

    def __init__(self, text: str) -> None:
        self.text = text

    def available(self) -> bool:
        return True

    def ocr(self, image: Image.Image) -> str:
        return self.text


class FakeEmbedder:
    """Empreinte = couleur moyenne : deux photos de teintes proches se ressemblent."""

    name = "fake-embed"
    model = "fake-color"

    def available(self) -> bool:
        return True

    def embed(self, image: Image.Image) -> list[float]:
        small = image.convert("RGB").resize((1, 1))
        return [float(c) for c in small.getpixel((0, 0))]


class FakeIdentifier:
    name = "fake-remote"

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls = 0

    def identify(self, image: Image.Image, categories: list[str]) -> Identification:
        self.calls += 1
        if self.fail:
            raise AiUnavailable("Quota gratuit du service d'identification atteint : réessayez plus tard.")
        return Identification(
            name="Régulateur de tension",
            category="électronique",
            mpn="LM317T",
            keywords=["régulateur"],
            confidence=0.8,
        )


def _analyze(client: TestClient, data: bytes, identify: bool = False) -> dict:
    r = client.post(
        f"{API}/ai/analyze",
        files={"file": ("p.png", data, "image/png")},
        data={"identify": "true" if identify else "false"},
        headers=CSRF,
    )
    assert r.status_code == 200, r.text
    return r.json()


# --- Références de composants ----------------------------------------------------------------


def test_extract_references_keeps_part_numbers_and_ignores_values() -> None:
    text = "TI  LM317T  KCS 2019\n1N4007  220V  10uF  ATMEGA328P-PU  12/03/2021  Made in China"
    assert extract_references(text) == ["LM317T", "1N4007", "ATMEGA328P-PU"]


def test_analyze_reads_text_and_finds_existing_part(admin_client: TestClient) -> None:
    r = admin_client.post(f"{API}/articles", json={"name": "Régulateur réglable", "mpn": "LM317T"}, headers=CSRF)
    article = r.json()
    registry.override(ocr=FakeOcr("lm317t\nKCS"))

    result = _analyze(admin_client, _png((20, 20, 20)))
    assert result["ocr_text"] == "lm317t\nKCS"
    assert [p["reference"] for p in result["parts"]] == ["LM317T"]
    part = result["parts"][0]
    assert part["matches"][0]["id"] == article["id"]
    assert part["datasheet_url"].endswith("LM317T")
    assert result["identification"] is None


def test_analyze_without_any_ai_still_answers(admin_client: TestClient) -> None:
    registry.override(ocr=type("NoOcr", (FakeOcr,), {"available": lambda self: False})(""))
    result = _analyze(admin_client, _png((20, 20, 20)), identify=True)
    assert result["ocr_text"] is None and result["similar"] == []
    assert any("pas activée" in w for w in result["warnings"])


def test_invalid_image_is_refused(admin_client: TestClient) -> None:
    r = admin_client.post(
        f"{API}/ai/analyze", files={"file": ("x.png", b"pas une image", "image/png")}, headers=CSRF
    )
    assert r.status_code == 422 and r.json()["code"] == "invalid_image"


# --- Identification externe : opt-in -----------------------------------------------------------


def test_remote_identification_requires_admin_opt_in(admin_client: TestClient) -> None:
    fake = FakeIdentifier()
    registry.override(identifier=fake, ocr=FakeOcr(""))
    admin_client.post(f"{API}/categories", json={"name": "Électronique"}, headers=CSRF)

    status = admin_client.get(f"{API}/ai/status").json()
    assert status["remote_configured"] is True and status["remote_enabled"] is False

    result = _analyze(admin_client, _png((20, 20, 20)), identify=True)
    assert fake.calls == 0 and result["identification"] is None

    r = admin_client.put(f"{API}/ai/settings", json={"remote_enabled": True}, headers=CSRF)
    assert r.status_code == 200 and r.json()["remote_enabled"] is True

    result = _analyze(admin_client, _png((20, 20, 20)), identify=True)
    assert fake.calls == 1
    ident = result["identification"]
    assert ident["name"] == "Régulateur de tension" and ident["mpn"] == "LM317T"
    assert ident["category_id"] is not None  # « électronique » rattachée à « Électronique »

    # Sans « identify », rien ne part vers le service externe.
    _analyze(admin_client, _png((20, 20, 20)))
    assert fake.calls == 1


def test_remote_failure_falls_back_to_warning(admin_client: TestClient) -> None:
    registry.override(identifier=FakeIdentifier(fail=True), ocr=FakeOcr(""))
    admin_client.put(f"{API}/ai/settings", json={"remote_enabled": True}, headers=CSRF)
    result = _analyze(admin_client, _png((20, 20, 20)), identify=True)
    assert result["identification"] is None
    assert any("Quota" in w for w in result["warnings"])


def test_only_admin_changes_ai_settings_and_needs_configuration(client: TestClient) -> None:
    create_user("membre", "membre")
    client.post(f"{API}/auth/login", json={"username": "membre", "password": PASSWORD}, headers=CSRF)
    r = client.put(f"{API}/ai/settings", json={"remote_enabled": True}, headers=CSRF)
    assert r.status_code == 403


def test_enabling_unconfigured_remote_is_refused(admin_client: TestClient) -> None:
    r = admin_client.put(f"{API}/ai/settings", json={"remote_enabled": True}, headers=CSRF)
    assert r.status_code == 409 and r.json()["code"] == "ai_remote_not_configured"


def test_suggestion_decision(admin_client: TestClient) -> None:
    registry.override(ocr=FakeOcr("BC547"))
    sid = _analyze(admin_client, _png((20, 20, 20)))["suggestion_id"]
    article = admin_client.post(f"{API}/articles", json={"name": "BC547"}, headers=CSRF).json()
    url = f"{API}/ai/suggestions/{sid}/decision"
    r = admin_client.post(url, json={"status": "accepted", "article_id": article["id"]}, headers=CSRF)
    assert r.status_code == 204
    r = admin_client.post(url, json={"status": "rejected"}, headers=CSRF)
    assert r.status_code == 409 and r.json()["code"] == "already_decided"


# --- Service compatible OpenAI ----------------------------------------------------------------


def test_parse_identification_tolerates_code_fences() -> None:
    content = 'Voici :\n```json\n{"name": "Scie sauteuse", "brand": "null", "keywords": ["coupe", 3], "confidence": 1.7}\n```'
    ident = parse_identification(content)
    assert ident.name == "Scie sauteuse" and ident.brand is None
    assert ident.keywords == ["coupe"] and ident.confidence == 1.0


def test_openai_compatible_request_and_quota() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        if seen.get("quota"):
            return httpx.Response(429)
        content = '{"name": "Pince coupante", "confidence": 0.9}'
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    ident = OpenAiCompatibleIdentifier(
        "https://exemple.test/v1/", "cle", "modele", 5, transport=httpx.MockTransport(handler)
    )
    image = Image.new("RGB", (3000, 2000), (1, 2, 3))
    assert ident.identify(image, ["Outils"]).name == "Pince coupante"
    assert seen["url"] == "https://exemple.test/v1/chat/completions"
    assert seen["auth"] == "Bearer cle" and seen["body"]["model"] == "modele"
    parts = seen["body"]["messages"][0]["content"]
    assert "Outils" in parts[0]["text"]
    assert parts[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")

    seen["quota"] = True
    with pytest.raises(AiUnavailable, match="Quota"):
        ident.identify(image, [])


# --- Recherche par photo ----------------------------------------------------------------------


def _article_with_photo(client: TestClient, name: str, color: tuple[int, int, int]) -> dict:
    article = client.post(f"{API}/articles", json={"name": name}, headers=CSRF).json()
    r = client.post(
        f"{API}/attachments",
        data={"kind": "photo", "article_id": article["id"]},
        files={"file": ("p.png", _png(color), "image/png")},
        headers=CSRF,
    )
    assert r.status_code == 201, r.text
    return article


def test_search_by_image_and_similar_articles(admin_client: TestClient) -> None:
    registry.override(embedder=FakeEmbedder(), ocr=FakeOcr(""))
    red = _article_with_photo(admin_client, "Boîte rouge", (200, 40, 30))
    red2 = _article_with_photo(admin_client, "Caisse rouge", (190, 50, 40))
    blue = _article_with_photo(admin_client, "Boîte bleue", (30, 40, 200))

    r = admin_client.post(
        f"{API}/search/by-image", files={"file": ("q.png", _png((210, 45, 35)), "image/png")}, headers=CSRF
    )
    assert r.status_code == 200, r.text
    names = [h["article"]["name"] for h in r.json()]
    assert set(names) == {"Boîte rouge", "Caisse rouge"}
    assert blue["id"] not in [h["article"]["id"] for h in r.json()]

    similar = admin_client.get(f"{API}/articles/{red['id']}/similar").json()
    assert [h["article"]["id"] for h in similar] == [red2["id"]]

    # L'analyse d'une photo propose aussi les articles ressemblants.
    result = _analyze(admin_client, _png((200, 40, 30)))
    assert result["similar"][0]["article"]["id"] == red["id"]


def test_search_by_image_unavailable_without_model(admin_client: TestClient) -> None:
    r = admin_client.post(
        f"{API}/search/by-image", files={"file": ("q.png", _png((1, 2, 3)), "image/png")}, headers=CSRF
    )
    assert r.status_code == 503 and r.json()["code"] == "ai_unavailable"


# --- Tesseract réel (si installé) -------------------------------------------------------------


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="Tesseract non installé")
def test_real_tesseract_reads_a_part_number() -> None:
    from app.ai.tesseract import TesseractOcr

    img = Image.new("RGB", (900, 200), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 80)
    except OSError:
        font = ImageFont.load_default(size=80)
    draw.text((40, 50), "LM317T", fill="black", font=font)
    text = TesseractOcr("tesseract", "eng").ocr(img)
    assert "LM317T" in extract_references(text)
