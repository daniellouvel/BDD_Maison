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


def test_history_lists_movements_and_undo_reverts_the_last_one(admin_client: TestClient) -> None:
    art = _article(admin_client)
    armoire = _location(admin_client)
    item = _item(admin_client, art["id"], armoire["id"], "5")
    admin_client.post(f"{API}/stock/movements", json={"node_id": item["id"], "kind": "out", "delta": "2"}, headers=CSRF)

    rows = admin_client.get(f"{API}/stock/history", params={"node_id": item["id"]}).json()
    assert [r["kind"] for r in rows] == ["out", "in"]
    assert rows[0]["actor"] and rows[0]["node_path"] == ["Armoire", "Condensateur 22 µF"] or rows[0]["node_path"]
    assert rows[0]["undoable"] is True and rows[1]["undoable"] is False  # seul le dernier s'annule

    r = admin_client.post(f"{API}/stock/movements/{rows[0]['id']}/undo", headers=CSRF)
    assert r.status_code == 201, r.text
    assert _node(admin_client, item["id"])["quantity"] == "5.000"

    again = admin_client.post(f"{API}/stock/movements/{rows[0]['id']}/undo", headers=CSRF)
    assert again.status_code == 409 and again.json()["code"] == "not_undoable"


def test_undo_of_a_move_puts_the_lot_back(admin_client: TestClient) -> None:
    art = _article(admin_client)
    a, b = _location(admin_client, "A"), _location(admin_client, "B")
    item = _item(admin_client, art["id"], a["id"])
    admin_client.post(f"{API}/stock/movements", json={"node_id": item["id"], "kind": "move", "to_node_id": b["id"]}, headers=CSRF)
    last = admin_client.get(f"{API}/stock/history", params={"node_id": item["id"]}).json()[0]
    assert last["kind"] == "move" and last["to_path"] == ["B"] and last["from_path"] == ["A"]
    assert admin_client.post(f"{API}/stock/movements/{last['id']}/undo", headers=CSRF).status_code == 201
    assert _node(admin_client, item["id"])["parent_id"] == a["id"]


def test_search_filters_by_place_category_low_stock_and_lent(admin_client: TestClient) -> None:
    a = _article(admin_client, "Vis M3")
    b = _article(admin_client, "Écrou M3")
    atelier = _location(admin_client, "Atelier")
    cave = _location(admin_client, "Cave")
    boite = admin_client.post(f"{API}/nodes", json={"kind": "container", "name": "Boîte", "parent_id": atelier["id"]}, headers=CSRF).json()
    item_a = _item(admin_client, a["id"], boite["id"], "4")
    _item(admin_client, b["id"], cave["id"], "9")

    def names(**params):  # type: ignore[no-untyped-def]
        r = admin_client.get(f"{API}/search", params=params)
        assert r.status_code == 200, r.text
        return sorted(h["article"]["name"] for h in r.json())

    assert names(place_id=atelier["id"]) == ["Vis M3"]  # le lieu inclut ce qu'il contient
    assert names(q="M3") == ["Vis M3", "Écrou M3"]
    assert names(q="M3", place_id=cave["id"]) == ["Écrou M3"]
    assert admin_client.get(f"{API}/search").status_code == 422

    admin_client.patch(f"{API}/articles/{a['id']}", json={"version": a["version"], "min_quantity": "10"}, headers=CSRF)
    assert names(low_stock="true") == ["Vis M3"]

    admin_client.post(f"{API}/nodes/{item_a['id']}/loan", json={"version": item_a["version"], "recipient": "Paul"}, headers=CSRF)
    assert names(lent="true") == ["Vis M3"]


def test_csv_import_preview_then_import_then_export(admin_client: TestClient) -> None:
    content = (
        "Nom;Marque;Quantité;Unité;Emplacement\n"
        "Vis M3x10;Acme;120;pcs;Atelier > Boîte vis > Case 1\n"
        "Vis M3x10;;30;pcs;Atelier > Boîte vis > Case 2\n"
        "Résistance 10k;;50;;Atelier > Boîte résistances\n"
        ";;1;;Atelier\n"
    ).encode("utf-8")
    files = {"file": ("inv.csv", content, "text/csv")}

    preview = admin_client.post(f"{API}/import/inventory?dry_run=true", files=files, headers=CSRF).json()
    assert preview["articles_created"] == 2 and preview["lots_created"] == 3
    assert len(preview["problems"]) == 1  # ligne sans nom
    assert admin_client.get(f"{API}/search", params={"q": "Vis"}).json() == []  # rien n'a été créé

    done = admin_client.post(f"{API}/import/inventory?dry_run=false", files=files, headers=CSRF).json()
    assert done["lots_created"] == 3 and done["places_created"] >= 4
    hit = admin_client.get(f"{API}/search", params={"q": "Vis M3x10"}).json()[0]
    assert hit["total_quantity"] == "150.000" and len(hit["locations"]) == 2

    exported = admin_client.get(f"{API}/export/inventory.csv")
    assert exported.status_code == 200
    text = exported.content.decode("utf-8-sig")
    assert text.splitlines()[0].startswith("Nom;Marque")
    assert "Atelier > Boîte vis > Case 1" in text and "Résistance 10k" in text


def test_csv_import_needs_a_name_column(admin_client: TestClient) -> None:
    r = admin_client.post(f"{API}/import/inventory", files={"file": ("x.csv", b"Truc;Autre\n1;2\n", "text/csv")}, headers=CSRF)
    assert r.status_code == 422 and r.json()["code"] == "missing_column"
