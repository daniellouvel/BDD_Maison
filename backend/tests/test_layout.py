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


def test_stale_layout_version_is_refused(admin_client: TestClient) -> None:
    boite = _node(admin_client, kind="container", name="Boîte")
    body = {"version": boite["version"] + 5, "width_mm": 300, "height_mm": 200, "levels": []}
    r = _put_layout(admin_client, boite["id"], body)
    assert r.status_code == 409 and r.json()["code"] == "version_conflict"
