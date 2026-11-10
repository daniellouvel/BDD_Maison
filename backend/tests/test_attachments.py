from fastapi.testclient import TestClient

from tests.conftest import CSRF

API = "/api/v1"


def _article(client: TestClient) -> dict:
    r = client.post(f"{API}/articles", json={"name": "ESP32-S3"}, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


def _photo(client: TestClient, article_id: str, photo_bytes: bytes) -> dict:
    r = client.post(
        f"{API}/attachments",
        data={"kind": "photo", "article_id": article_id},
        files={"file": ("p.png", photo_bytes, "image/png")},
        headers=CSRF,
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_link_has_a_type_and_can_be_edited_and_deleted(admin_client: TestClient) -> None:
    article = _article(admin_client)
    r = admin_client.post(
        f"{API}/attachments",
        data={"kind": "link", "article_id": article["id"], "url": "https://github.com/x/y", "title": "Dépôt", "link_type": "depot"},
        headers=CSRF,
    )
    assert r.status_code == 201 and r.json()["link_type"] == "depot"
    link_id = r.json()["id"]

    patched = admin_client.patch(
        f"{API}/attachments/{link_id}",
        json={"title": "Datasheet", "url": "https://exemple.fr/ds.pdf", "link_type": "datasheet"},
        headers=CSRF,
    )
    assert patched.status_code == 200
    assert patched.json()["link_type"] == "datasheet" and patched.json()["url"] == "https://exemple.fr/ds.pdf"

    bad = admin_client.patch(f"{API}/attachments/{link_id}", json={"url": "ftp://x"}, headers=CSRF)
    assert bad.status_code == 422 and bad.json()["code"] == "invalid_url"
    typo = admin_client.patch(f"{API}/attachments/{link_id}", json={"link_type": "inconnu"}, headers=CSRF)
    assert typo.status_code == 422

    assert admin_client.delete(f"{API}/attachments/{link_id}", headers=CSRF).status_code == 204
    assert admin_client.get(f"{API}/attachments?article_id={article['id']}").json() == []


def test_first_photo_is_main_and_main_can_change_or_be_deleted(admin_client: TestClient, photo_bytes: bytes) -> None:
    article = _article(admin_client)
    first = _photo(admin_client, article["id"], photo_bytes)
    second = _photo(admin_client, article["id"], photo_bytes)
    assert first["is_main"] is True and second["is_main"] is False

    r = admin_client.patch(f"{API}/attachments/{second['id']}", json={"is_main": True}, headers=CSRF)
    assert r.status_code == 200 and r.json()["is_main"] is True
    listed = admin_client.get(f"{API}/attachments?article_id={article['id']}").json()
    assert listed[0]["id"] == second["id"]
    assert {a["id"]: a["is_main"] for a in listed} == {first["id"]: False, second["id"]: True}

    # Supprimer la photo principale : l'autre prend le relais, et le fichier disparaît.
    assert admin_client.delete(f"{API}/attachments/{second['id']}", headers=CSRF).status_code == 204
    assert admin_client.get(f"{API}/attachments/{second['id']}/file").status_code == 404
    rest = admin_client.get(f"{API}/attachments?article_id={article['id']}").json()
    assert len(rest) == 1 and rest[0]["id"] == first["id"] and rest[0]["is_main"] is True
