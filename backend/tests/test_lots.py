from fastapi.testclient import TestClient

from tests.conftest import CSRF

API = "/api/v1"


def _article(client: TestClient, name: str = "Condensateur 22 µF") -> dict:
    r = client.post(f"{API}/articles", json={"name": name}, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


def _location(client: TestClient, name: str = "Armoire") -> dict:
    r = client.post(f"{API}/nodes", json={"kind": "location", "name": name}, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


def _item(client: TestClient, article_id: str, parent_id: str, quantity: str = "3") -> dict:
    r = client.post(
        f"{API}/nodes",
        json={"kind": "item", "article_id": article_id, "parent_id": parent_id, "quantity": quantity},
        headers=CSRF,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _node(client: TestClient, node_id: str) -> dict:
    r = client.get(f"{API}/nodes/{node_id}")
    assert r.status_code == 200, r.text
    return r.json()


def test_lend_keeps_stock_and_return_restores_availability(admin_client: TestClient) -> None:
    item = _item(admin_client, _article(admin_client)["id"], _location(admin_client)["id"])

    r = admin_client.post(
        f"{API}/nodes/{item['id']}/loan",
        json={"version": 1, "recipient": "Marc"},
        headers=CSRF,
    )
    assert r.status_code == 201, r.text
    loan = r.json()
    assert loan["recipient"] == "Marc" and loan["returned_at"] is None
    assert float(loan["quantity"]) == 3

    node = _node(admin_client, item["id"])
    assert node["status"] == "lent" and float(node["quantity"]) == 3

    # Un lot prêté ne se modifie pas tant qu'il n'est pas rendu.
    move = admin_client.post(
        f"{API}/stock/movements",
        json={"node_id": item["id"], "kind": "out", "delta": "1"},
        headers=CSRF,
    )
    assert move.status_code == 422 and move.json()["code"] == "item_not_in_stock"

    again = admin_client.post(
        f"{API}/nodes/{item['id']}/loan", json={"version": 2, "recipient": "Paul"}, headers=CSRF
    )
    assert again.status_code == 422 and again.json()["code"] == "item_not_in_stock"

    open_loans = admin_client.get(f"{API}/loans?open=true").json()
    assert [loan_row["recipient"] for loan_row in open_loans] == ["Marc"]

    returned = admin_client.post(f"{API}/nodes/{item['id']}/return", headers=CSRF)
    assert returned.status_code == 200, returned.text
    assert returned.json()["returned_at"] is not None
    assert _node(admin_client, item["id"])["status"] == "in_stock"
    assert admin_client.get(f"{API}/loans?open=true").json() == []

    no_loan = admin_client.post(f"{API}/nodes/{item['id']}/return", headers=CSRF)
    assert no_loan.status_code == 409 and no_loan.json()["code"] == "not_lent"


def test_lend_checks_version(admin_client: TestClient) -> None:
    item = _item(admin_client, _article(admin_client)["id"], _location(admin_client)["id"])
    r = admin_client.post(f"{API}/nodes/{item['id']}/loan", json={"version": 9, "recipient": "Marc"}, headers=CSRF)
    assert r.status_code == 409 and r.json()["code"] == "version_conflict"


def test_remove_moves_full_quantity_out(admin_client: TestClient) -> None:
    item = _item(admin_client, _article(admin_client)["id"], _location(admin_client)["id"], "5")

    r = admin_client.post(
        f"{API}/nodes/{item['id']}/remove", json={"version": 1, "reason": "Utilisé"}, headers=CSRF
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "removed" and float(r.json()["quantity"]) == 0

    movements = admin_client.get(f"{API}/stock/movements?node_id={item['id']}").json()
    out = [m for m in movements if m["kind"] == "out"]
    assert len(out) == 1 and float(out[0]["delta"]) == -5

    twice = admin_client.post(f"{API}/nodes/{item['id']}/remove", json={"version": 3}, headers=CSRF)
    assert twice.status_code == 409 and twice.json()["code"] == "already_removed"


def test_lent_item_cannot_be_removed(admin_client: TestClient) -> None:
    item = _item(admin_client, _article(admin_client)["id"], _location(admin_client)["id"])
    admin_client.post(f"{API}/nodes/{item['id']}/loan", json={"version": 1, "recipient": "Marc"}, headers=CSRF)

    r = admin_client.post(f"{API}/nodes/{item['id']}/remove", json={"version": 2}, headers=CSRF)
    assert r.status_code == 422 and r.json()["code"] == "lent_out"


def test_stock_value_splits_stock_lent_and_unpriced(admin_client: TestClient) -> None:
    article = _article(admin_client)
    supplier = admin_client.post(f"{API}/suppliers", json={"name": "Amazon"}, headers=CSRF).json()
    offer = admin_client.post(
        f"{API}/articles/{article['id']}/offers", json={"supplier_id": supplier["id"]}, headers=CSRF
    ).json()
    admin_client.post(f"{API}/offers/{offer['id']}/prices", json={"unit_price": "0.10"}, headers=CSRF)

    location = _location(admin_client)
    priced = _item(admin_client, article["id"], location["id"], "30")
    lent = _item(admin_client, article["id"], location["id"], "20")
    _item(admin_client, _article(admin_client, "Sans prix")["id"], location["id"], "7")

    admin_client.post(f"{API}/nodes/{lent['id']}/loan", json={"version": 1, "recipient": "Marc"}, headers=CSRF)

    value = admin_client.get(f"{API}/stock/value").json()
    assert float(value["in_stock"]) == 3.0
    assert float(value["lent"]) == 2.0
    assert value["unpriced_lots"] == 1 and value["priced_lots"] == 2
    assert priced["id"] != lent["id"]
