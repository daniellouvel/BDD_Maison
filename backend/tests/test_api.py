import io
import uuid

from fastapi.testclient import TestClient
from PIL import Image

from tests.conftest import CSRF, PASSWORD, create_user

API = "/api/v1"


def _login(client: TestClient, username: str) -> None:
    r = client.post(f"{API}/auth/login", json={"username": username, "password": PASSWORD}, headers=CSRF)
    assert r.status_code == 200, r.text


def _article(client: TestClient, **extra) -> dict:  # type: ignore[no-untyped-def]
    body = {"name": "Résistance 10 kΩ 0805", "keywords": "resistance smd"}
    body.update(extra)
    r = client.post(f"{API}/articles", json=body, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


def _node(client: TestClient, **body) -> dict:  # type: ignore[no-untyped-def]
    r = client.post(f"{API}/nodes", json=body, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


# --- Authentification ---------------------------------------------------------------------------


def test_login_and_session(client: TestClient) -> None:
    create_user("alice", "membre")
    assert client.get(f"{API}/nodes").status_code == 401
    assert client.post(f"{API}/auth/login", json={"username": "alice", "password": "faux"}, headers=CSRF).status_code == 401
    _login(client, "alice")
    me = client.get(f"{API}/auth/me")
    assert me.status_code == 200 and me.json()["username"] == "alice"
    assert client.post(f"{API}/auth/logout", headers=CSRF).status_code == 204
    assert client.get(f"{API}/auth/me").status_code == 401


def test_unsafe_request_without_csrf_header_is_refused(admin_client: TestClient) -> None:
    r = admin_client.post(f"{API}/categories", json={"name": "Électronique"})
    assert r.status_code == 403
    assert r.json()["code"] == "csrf"


def test_read_only_account_cannot_write(client: TestClient) -> None:
    create_user("lecteur", "lecture")
    _login(client, "lecteur")
    r = client.post(f"{API}/articles", json={"name": "Vis M3"}, headers=CSRF)
    assert r.status_code == 403


# --- Catalogue ----------------------------------------------------------------------------------


def test_custom_fields_are_validated(admin_client: TestClient) -> None:
    cat = admin_client.post(f"{API}/categories", json={"name": "Résistances"}, headers=CSRF).json()
    f = f"{API}/categories/{cat['id']}/fields"
    assert admin_client.post(f, json={"key": "valeur", "label": "Valeur", "type": "number", "unit": "Ω", "required": True}, headers=CSRF).status_code == 201
    assert admin_client.post(f, json={"key": "boitier", "label": "Boîtier", "type": "enum", "options": ["0603", "0805"]}, headers=CSRF).status_code == 201

    missing = admin_client.post(f"{API}/articles", json={"name": "R", "category_id": cat["id"]}, headers=CSRF)
    assert missing.status_code == 422 and missing.json()["code"] == "field_required"

    bad_enum = admin_client.post(
        f"{API}/articles",
        json={"name": "R", "category_id": cat["id"], "attributes": {"valeur": 10000, "boitier": "1206"}},
        headers=CSRF,
    )
    assert bad_enum.status_code == 422 and bad_enum.json()["code"] == "invalid_field_value"

    ok = admin_client.post(
        f"{API}/articles",
        json={"name": "R 10k", "category_id": cat["id"], "attributes": {"valeur": 10000, "boitier": "0805"}},
        headers=CSRF,
    )
    assert ok.status_code == 201


def test_article_with_stock_cannot_be_archived(admin_client: TestClient) -> None:
    article = _article(admin_client)
    loc = _node(admin_client, kind="location", name="Atelier")
    _node(admin_client, kind="item", parent_id=loc["id"], article_id=article["id"], quantity="100")
    r = admin_client.delete(f"{API}/articles/{article['id']}", headers=CSRF)
    assert r.status_code == 409 and r.json()["code"] == "article_in_use"


# --- Emplacements -------------------------------------------------------------------------------


def test_items_follow_their_container_when_it_moves(admin_client: TestClient) -> None:
    article = _article(admin_client)
    atelier = _node(admin_client, kind="location", name="Atelier")
    tiroir = _node(admin_client, kind="container", name="Tiroir 4", parent_id=atelier["id"])
    boite = _node(admin_client, kind="container", name="Boîte composants", parent_id=tiroir["id"])
    item = _node(admin_client, kind="item", parent_id=boite["id"], article_id=article["id"], quantity="100")

    garage = _node(admin_client, kind="location", name="Garage")
    r = admin_client.patch(
        f"{API}/nodes/{tiroir['id']}", json={"version": tiroir["version"], "parent_id": garage["id"]}, headers=CSRF
    )
    assert r.status_code == 200, r.text

    detail = admin_client.get(f"{API}/nodes/{item['id']}").json()
    names = [c["name"] for c in detail["breadcrumb"]]
    assert names == ["Garage", "Tiroir 4", "Boîte composants", "Résistance 10 kΩ 0805"]


def test_cannot_move_container_inside_itself(admin_client: TestClient) -> None:
    a = _node(admin_client, kind="container", name="A")
    b = _node(admin_client, kind="container", name="B", parent_id=a["id"])
    r = admin_client.patch(f"{API}/nodes/{a['id']}", json={"version": a["version"], "parent_id": b["id"]}, headers=CSRF)
    assert r.status_code == 422 and r.json()["code"] == "cycle"


def test_stale_version_is_refused(admin_client: TestClient) -> None:
    loc = _node(admin_client, kind="location", name="Étagère")
    admin_client.patch(f"{API}/nodes/{loc['id']}", json={"version": 1, "name": "Étagère 1"}, headers=CSRF)
    r = admin_client.patch(f"{API}/nodes/{loc['id']}", json={"version": 1, "name": "Étagère 2"}, headers=CSRF)
    assert r.status_code == 409 and r.json()["code"] == "version_conflict"


def test_container_with_contents_cannot_be_archived(admin_client: TestClient) -> None:
    article = _article(admin_client)
    box = _node(admin_client, kind="container", name="Boîte")
    _node(admin_client, kind="item", parent_id=box["id"], article_id=article["id"], quantity="5")
    r = admin_client.delete(f"{API}/nodes/{box['id']}", headers=CSRF)
    assert r.status_code == 409 and r.json()["code"] == "node_not_empty"


# --- Stock --------------------------------------------------------------------------------------


def test_stock_movements_keep_quantity_consistent(admin_client: TestClient) -> None:
    article = _article(admin_client)
    box = _node(admin_client, kind="container", name="Boîte")
    item = _node(admin_client, kind="item", parent_id=box["id"], article_id=article["id"], quantity="100")

    out = admin_client.post(
        f"{API}/stock/movements", json={"node_id": item["id"], "kind": "consume", "delta": "30"}, headers=CSRF
    )
    assert out.status_code == 201, out.text
    assert out.json()["delta"] == "-30.000"

    too_much = admin_client.post(
        f"{API}/stock/movements", json={"node_id": item["id"], "kind": "out", "delta": "500"}, headers=CSRF
    )
    assert too_much.status_code == 422 and too_much.json()["code"] == "stock_insuffisant"

    detail = admin_client.get(f"{API}/articles/{article['id']}").json()
    assert detail["total_quantity"] == "70.000"


def test_movement_with_op_id_is_idempotent(admin_client: TestClient) -> None:
    article = _article(admin_client)
    box = _node(admin_client, kind="container", name="Boîte")
    item = _node(admin_client, kind="item", parent_id=box["id"], article_id=article["id"], quantity="10")
    op = str(uuid.uuid4())
    body = {"op_id": op, "node_id": item["id"], "kind": "out", "delta": "4"}
    first = admin_client.post(f"{API}/stock/movements", json=body, headers=CSRF)
    second = admin_client.post(f"{API}/stock/movements", json=body, headers=CSRF)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert admin_client.get(f"{API}/articles/{article['id']}").json()["total_quantity"] == "6.000"


def test_adjustment_needs_a_reason(admin_client: TestClient) -> None:
    article = _article(admin_client)
    box = _node(admin_client, kind="container", name="Boîte")
    item = _node(admin_client, kind="item", parent_id=box["id"], article_id=article["id"], quantity="10")
    r = admin_client.post(
        f"{API}/stock/movements", json={"node_id": item["id"], "kind": "adjust", "delta": "-2"}, headers=CSRF
    )
    assert r.status_code == 422 and r.json()["code"] == "reason_required"


# --- Fichiers -----------------------------------------------------------------------------------


def test_photo_is_reencoded_and_served(admin_client: TestClient, photo_bytes: bytes) -> None:
    article = _article(admin_client)
    r = admin_client.post(
        f"{API}/attachments",
        data={"kind": "photo", "article_id": article["id"], "title": "Face avant"},
        files={"file": ("photo.png", photo_bytes, "image/png")},
        headers=CSRF,
    )
    assert r.status_code == 201, r.text
    att = r.json()
    f = admin_client.get(f"{API}/attachments/{att['id']}/file")
    assert f.status_code == 200 and f.headers["content-type"] == "image/jpeg"
    img = Image.open(io.BytesIO(f.content))
    assert img.format == "JPEG" and max(img.size) <= 2048
    thumb = admin_client.get(f"{API}/attachments/{att['id']}/thumb")
    assert thumb.status_code == 200 and max(Image.open(io.BytesIO(thumb.content)).size) <= 512


def test_non_image_is_refused(admin_client: TestClient) -> None:
    article = _article(admin_client)
    r = admin_client.post(
        f"{API}/attachments",
        data={"kind": "photo", "article_id": article["id"]},
        files={"file": ("x.jpg", b"pas une image", "image/jpeg")},
        headers=CSRF,
    )
    assert r.status_code == 422 and r.json()["code"] == "invalid_image"


def test_datasheet_must_be_pdf(admin_client: TestClient) -> None:
    article = _article(admin_client)
    r = admin_client.post(
        f"{API}/attachments",
        data={"kind": "datasheet", "article_id": article["id"]},
        files={"file": ("ds.pdf", b"<html>", "application/pdf")},
        headers=CSRF,
    )
    assert r.status_code == 422 and r.json()["code"] == "invalid_pdf"


# --- Recherche et tableau de bord ---------------------------------------------------------------


def test_search_matches_every_word_and_shows_locations(admin_client: TestClient) -> None:
    _article(admin_client, name="ESP32-C3 SuperMini", keywords="esp32 wifi")
    _article(admin_client, name="ESP32 DevKit", keywords="esp32")
    esp = admin_client.get(f"{API}/search", params={"q": "esp32 supermini"}).json()
    assert [h["article"]["name"] for h in esp] == ["ESP32-C3 SuperMini"]

    article = esp[0]["article"]
    box = _node(admin_client, kind="container", name="Boîte modules")
    _node(admin_client, kind="item", parent_id=box["id"], article_id=article["id"], quantity="4")
    hit = admin_client.get(f"{API}/search", params={"q": "supermini"}).json()[0]
    assert hit["total_quantity"] == "4.000"
    assert hit["locations"][0]["path"] == ["Boîte modules"]


def test_dashboard_reports_low_stock_and_unlocated_items(admin_client: TestClient) -> None:
    article = _article(admin_client, min_quantity="10")
    _node(admin_client, kind="item", article_id=article["id"], quantity="3")
    dash = admin_client.get(f"{API}/dashboard").json()
    assert [a["name"] for a in dash["low_stock"]] == ["Résistance 10 kΩ 0805"]
    assert len(dash["unlocated"]) == 1
    assert dash["items"] == 1
