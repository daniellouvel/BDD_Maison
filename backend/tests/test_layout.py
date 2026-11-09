from fastapi.testclient import TestClient

from tests.conftest import CSRF

API = "/api/v1"


def _node(client: TestClient, **body) -> dict:  # type: ignore[no-untyped-def]
    r = client.post(f"{API}/nodes", json=body, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


def _put_layout(client: TestClient, box_id: str, body: dict):  # type: ignore[no-untyped-def]
    return client.put(f"{API}/nodes/{box_id}/layout", json=body, headers=CSRF)


def test_layout_stores_levels_and_cells_in_mm(admin_client: TestClient) -> None:
    boite = _node(admin_client, kind="container", name="Boîte vis")
    etage = _node(admin_client, kind="container", name="Étage 1", parent_id=boite["id"])
    case_a = _node(admin_client, kind="container", name="A1", parent_id=etage["id"])
    case_b = _node(admin_client, kind="container", name="B1", parent_id=etage["id"])

    body = {
        "version": boite["version"],
        "width_mm": 300,
        "height_mm": 200,
        "levels": [
            {
                "node_id": etage["id"],
                "cells": [
                    {"node_id": case_a["id"], "x": 0, "y": 0, "w": 120, "h": 200},
                    {"node_id": case_b["id"], "x": 120, "y": 0, "w": 180, "h": 90},
                ],
            }
        ],
    }
    r = _put_layout(admin_client, boite["id"], body)
    assert r.status_code == 200, r.text
    layout = r.json()["layout"]
    assert layout["width_mm"] == 300 and layout["height_mm"] == 200
    assert layout["levels"][0]["node_id"] == etage["id"]
    assert [c["node_id"] for c in layout["levels"][0]["cells"]] == [case_a["id"], case_b["id"]]
    assert r.json()["version"] == boite["version"] + 1
    assert admin_client.get(f"{API}/nodes/{boite['id']}").json()["layout"] == layout


def test_cell_must_belong_to_its_level(admin_client: TestClient) -> None:
    boite = _node(admin_client, kind="container", name="Boîte")
    etage1 = _node(admin_client, kind="container", name="Étage 1", parent_id=boite["id"])
    etage2 = _node(admin_client, kind="container", name="Étage 2", parent_id=boite["id"])
    case = _node(admin_client, kind="container", name="Case", parent_id=etage2["id"])
    body = {
        "version": boite["version"],
        "width_mm": 300,
        "height_mm": 200,
        "levels": [
            {"node_id": etage1["id"], "cells": [{"node_id": case["id"], "x": 0, "y": 0, "w": 50, "h": 50}]}
        ],
    }
    r = _put_layout(admin_client, boite["id"], body)
    assert r.status_code == 422 and r.json()["code"] == "invalid_cell"


def test_level_must_belong_to_the_box(admin_client: TestClient) -> None:
    boite = _node(admin_client, kind="container", name="Boîte")
    autre = _node(admin_client, kind="container", name="Autre boîte")
    etage = _node(admin_client, kind="container", name="Étage", parent_id=autre["id"])
    body = {"version": boite["version"], "width_mm": 300, "height_mm": 200, "levels": [{"node_id": etage["id"]}]}
    r = _put_layout(admin_client, boite["id"], body)
    assert r.status_code == 422 and r.json()["code"] == "invalid_level"


def test_cell_outside_the_box_is_refused(admin_client: TestClient) -> None:
    boite = _node(admin_client, kind="container", name="Boîte")
    etage = _node(admin_client, kind="container", name="Étage 1", parent_id=boite["id"])
    case = _node(admin_client, kind="container", name="Case", parent_id=etage["id"])
    body = {
        "version": boite["version"],
        "width_mm": 300,
        "height_mm": 200,
        "levels": [
            {"node_id": etage["id"], "cells": [{"node_id": case["id"], "x": 250, "y": 0, "w": 100, "h": 50}]}
        ],
    }
    r = _put_layout(admin_client, boite["id"], body)
    assert r.status_code == 422 and r.json()["code"] == "invalid_cell"


def test_plan_dimensions_must_be_positive(admin_client: TestClient) -> None:
    boite = _node(admin_client, kind="container", name="Boîte")
    body = {"version": boite["version"], "width_mm": 0, "height_mm": 200, "levels": []}
    r = _put_layout(admin_client, boite["id"], body)
    assert r.status_code == 422


def test_archive_tree_archives_everything_inside(admin_client: TestClient) -> None:
    boite = _node(admin_client, kind="container", name="Boîte à archiver")
    etage = _node(admin_client, kind="container", name="Étage", parent_id=boite["id"])
    case = _node(admin_client, kind="container", name="Case", parent_id=etage["id"])
    r = admin_client.post(f"{API}/nodes/{boite['id']}/archive-tree", headers=CSRF)
    assert r.status_code == 200 and r.json() == {"archived": 3}
    for node_id in (boite["id"], etage["id"], case["id"]):
        assert admin_client.get(f"{API}/nodes/{node_id}").status_code == 404


def test_archive_tree_refuses_when_stock_remains(admin_client: TestClient) -> None:
    article = admin_client.post(f"{API}/articles", json={"name": "LM317T"}, headers=CSRF).json()
    boite = _node(admin_client, kind="container", name="Boîte")
    _node(admin_client, kind="item", parent_id=boite["id"], article_id=article["id"], quantity="2")
    r = admin_client.post(f"{API}/nodes/{boite['id']}/archive-tree", headers=CSRF)
    assert r.status_code == 409 and r.json()["code"] == "stock_remaining"
    assert "LM317T" in r.json()["message"]
    assert admin_client.get(f"{API}/nodes/{boite['id']}").status_code == 200


def test_nodes_get_a_readable_unique_address(admin_client: TestClient) -> None:
    premiere = _node(admin_client, kind="container", name="Boîte n°1")
    seconde = _node(admin_client, kind="container", name="Boîte n°1")
    assert premiere["slug"] == "boite-n1"
    assert seconde["slug"] == "boite-n1-2"
    by_slug = admin_client.get(f"{API}/nodes/boite-n1-2")
    assert by_slug.status_code == 200 and by_slug.json()["id"] == seconde["id"]
    by_id = admin_client.get(f"{API}/nodes/{premiere['id']}")
    assert by_id.status_code == 200 and by_id.json()["slug"] == "boite-n1"


def test_renaming_updates_the_address(admin_client: TestClient) -> None:
    boite = _node(admin_client, kind="container", name="Ancien nom")
    r = admin_client.patch(
        f"{API}/nodes/{boite['id']}", json={"version": boite["version"], "name": "Tiroir nouveau"}, headers=CSRF
    )
    assert r.status_code == 200 and r.json()["slug"] == "tiroir-nouveau"
    assert admin_client.get(f"{API}/nodes/tiroir-nouveau").status_code == 200


def test_stale_layout_version_is_refused(admin_client: TestClient) -> None:
    boite = _node(admin_client, kind="container", name="Boîte")
    body = {"version": boite["version"] + 5, "width_mm": 300, "height_mm": 200, "levels": []}
    r = _put_layout(admin_client, boite["id"], body)
    assert r.status_code == 409 and r.json()["code"] == "version_conflict"


def test_node_type_has_a_genre(admin_client: TestClient) -> None:
    r = admin_client.post(f"{API}/node-types", json={"name": "Casier", "genre": "contenant"}, headers=CSRF)
    assert r.status_code == 201 and r.json()["genre"] == "contenant"
    bad = admin_client.post(f"{API}/node-types", json={"name": "Autre", "genre": "n'importe"}, headers=CSRF)
    assert bad.status_code == 422
    listed = admin_client.get(f"{API}/node-types").json()
    assert {t["name"]: t["genre"] for t in listed}["Casier"] == "contenant"
