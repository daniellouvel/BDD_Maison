from fastapi.testclient import TestClient

from tests.conftest import CSRF

API = "/api/v1"


def _article(client: TestClient, name: str = "Résistance 10 kΩ") -> dict:
    r = client.post(f"{API}/articles", json={"name": name}, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


def _supplier(client: TestClient, name: str = "Leroy Merlin") -> dict:
    r = client.post(f"{API}/suppliers", json={"name": name}, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


def _offer(client: TestClient, article_id: str, supplier_id: str) -> dict:
    r = client.post(
        f"{API}/articles/{article_id}/offers",
        json={"supplier_id": supplier_id, "supplier_ref": "RC-10K"},
        headers=CSRF,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _location(client: TestClient, name: str = "Armoire") -> dict:
    r = client.post(f"{API}/nodes", json={"kind": "location", "name": name}, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


def test_supplier_create_duplicate_update_and_archive(admin_client: TestClient) -> None:
    supplier = _supplier(admin_client)
    assert supplier["version"] == 1

    dup = admin_client.post(f"{API}/suppliers", json={"name": "  leroy merlin "}, headers=CSRF)
    assert dup.status_code == 409 and dup.json()["code"] == "supplier_exists"

    body = {"version": 1, "url": "https://example.test", "notes": "Magasin de quartier"}
    r = admin_client.patch(f"{API}/suppliers/{supplier['id']}", json=body, headers=CSRF)
    assert r.status_code == 200, r.text
    assert r.json()["url"] == "https://example.test" and r.json()["version"] == 2

    stale = admin_client.patch(f"{API}/suppliers/{supplier['id']}", json=body, headers=CSRF)
    assert stale.status_code == 409 and stale.json()["code"] == "version_conflict"

    assert admin_client.delete(f"{API}/suppliers/{supplier['id']}", headers=CSRF).status_code == 204
    assert admin_client.get(f"{API}/suppliers").json() == []


def test_offer_is_unique_per_article_and_supplier(admin_client: TestClient) -> None:
    article = _article(admin_client)
    supplier = _supplier(admin_client)
    offer = _offer(admin_client, article["id"], supplier["id"])

    again = admin_client.post(
        f"{API}/articles/{article['id']}/offers", json={"supplier_id": supplier["id"]}, headers=CSRF
    )
    assert again.status_code == 409 and again.json()["code"] == "offer_exists"

    offers = admin_client.get(f"{API}/articles/{article['id']}/offers").json()
    assert [o["id"] for o in offers] == [offer["id"]]
    assert offers[0]["supplier_name"] == "Leroy Merlin"
    assert offers[0]["last_unit_price"] is None


def test_price_history_gives_current_price(admin_client: TestClient) -> None:
    article = _article(admin_client)
    offer = _offer(admin_client, article["id"], _supplier(admin_client)["id"])

    url = f"{API}/offers/{offer['id']}/prices"
    assert admin_client.post(url, json={"unit_price": "0.12"}, headers=CSRF).status_code == 201
    r = admin_client.post(url, json={"unit_price": "0.10", "observed_at": "2020-01-01T00:00:00Z"}, headers=CSRF)
    assert r.status_code == 201, r.text

    history = admin_client.get(url).json()
    assert [float(p["unit_price"]) for p in history] == [0.12, 0.10]
    # Le prix courant est le point le plus récent (la date saisie peut être plus ancienne).
    offers = admin_client.get(f"{API}/articles/{article['id']}/offers").json()
    assert float(offers[0]["last_unit_price"]) == 0.12

    invalid = admin_client.post(url, json={"unit_price": "0"}, headers=CSRF)
    assert invalid.status_code == 422


def test_purchase_needs_a_label_or_an_article(admin_client: TestClient) -> None:
    r = admin_client.post(f"{API}/purchases", json={"quantity": "2"}, headers=CSRF)
    assert r.status_code == 422 and r.json()["code"] == "purchase_label_required"

    r = admin_client.post(f"{API}/purchases", json={"label": "Colle époxy", "quantity": "1"}, headers=CSRF)
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "to_buy" and r.json()["label"] == "Colle époxy"


def test_purchase_lifecycle_and_receive_into_location(admin_client: TestClient) -> None:
    article = _article(admin_client)
    supplier = _supplier(admin_client)
    offer = _offer(admin_client, article["id"], supplier["id"])
    location = _location(admin_client)

    r = admin_client.post(
        f"{API}/purchases",
        json={"article_id": article["id"], "offer_id": offer["id"], "quantity": "3", "unit_price": "0.25"},
        headers=CSRF,
    )
    assert r.status_code == 201, r.text
    purchase = r.json()
    assert purchase["label"] == "Résistance 10 kΩ" and purchase["supplier_name"] == "Leroy Merlin"

    purchase_id = purchase["id"]
    ordered = admin_client.patch(
        f"{API}/purchases/{purchase_id}",
        json={"version": 1, "status": "ordered"},
        headers=CSRF,
    )
    assert ordered.status_code == 200, ordered.text
    assert ordered.json()["status"] == "ordered" and ordered.json()["version"] == 2

    # Commander à un prix connu alimente l'historique de l'offre.
    prices = admin_client.get(f"{API}/offers/{offer['id']}/prices").json()
    assert [p["source"] for p in prices] == ["order"]

    received = admin_client.post(
        f"{API}/purchases/{purchase_id}/receive",
        json={"version": 2, "node_id": location["id"]},
        headers=CSRF,
    )
    assert received.status_code == 200, received.text
    done = received.json()
    assert done["status"] == "received" and done["received_node_id"]

    stored = admin_client.get(f"{API}/nodes/{done['received_node_id']}").json()
    assert stored["kind"] == "item" and float(stored["quantity"]) == 3
    assert stored["parent_id"] == location["id"]

    again = admin_client.post(
        f"{API}/purchases/{purchase_id}/receive",
        json={"version": 3, "node_id": location["id"]},
        headers=CSRF,
    )
    assert again.status_code == 409 and again.json()["code"] == "invalid_transition"

    closed = admin_client.patch(
        f"{API}/purchases/{purchase_id}", json={"version": 3, "label": "autre"}, headers=CSRF
    )
    assert closed.status_code == 409 and closed.json()["code"] == "purchase_closed"


def test_receive_requires_an_article(admin_client: TestClient) -> None:
    purchase = admin_client.post(f"{API}/purchases", json={"label": "Vis M3", "quantity": "10"}, headers=CSRF).json()
    location = _location(admin_client)
    r = admin_client.post(
        f"{API}/purchases/{purchase['id']}/receive",
        json={"version": 1, "node_id": location["id"]},
        headers=CSRF,
    )
    assert r.status_code == 422 and r.json()["code"] == "article_required"


def test_purchase_transitions_and_filters(admin_client: TestClient) -> None:
    purchase = admin_client.post(f"{API}/purchases", json={"label": "Vis M3", "quantity": "10"}, headers=CSRF).json()
    url = f"{API}/purchases/{purchase['id']}"

    # Passer directement à « reçu » par la modification est refusé : c'est la réception qui le fait.
    r = admin_client.patch(url, json={"version": 1, "status": "received"}, headers=CSRF)
    assert r.status_code == 422 and r.json()["code"] == "use_receive"

    cancelled = admin_client.patch(url, json={"version": 1, "status": "cancelled"}, headers=CSRF)
    assert cancelled.status_code == 200, cancelled.text

    back = admin_client.patch(url, json={"version": 2, "status": "ordered"}, headers=CSRF)
    assert back.status_code == 409 and back.json()["code"] == "purchase_closed"

    assert len(admin_client.get(f"{API}/purchases?status=cancelled").json()) == 1
    assert admin_client.get(f"{API}/purchases?status=to_buy").json() == []


def test_supplier_with_open_purchase_cannot_be_archived(admin_client: TestClient) -> None:
    article = _article(admin_client)
    supplier = _supplier(admin_client)
    offer = _offer(admin_client, article["id"], supplier["id"])
    admin_client.post(
        f"{API}/purchases", json={"article_id": article["id"], "offer_id": offer["id"], "quantity": "1"}, headers=CSRF
    )

    r = admin_client.delete(f"{API}/suppliers/{supplier['id']}", headers=CSRF)
    assert r.status_code == 409 and r.json()["code"] == "supplier_in_use"
