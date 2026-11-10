from fastapi.testclient import TestClient

from tests.conftest import CSRF

API = "/api/v1"


def _node(client: TestClient, **body) -> dict:  # type: ignore[no-untyped-def]
    r = client.post(f"{API}/nodes", json=body, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


def _put(client: TestClient, box: dict, levels: list[dict]):  # type: ignore[no-untyped-def]
    body = {"version": box["version"], "width_mm": 300, "height_mm": 200, "levels": levels}
    return client.put(f"{API}/nodes/{box['id']}/layout", json=body, headers=CSRF)


def test_cells_can_sit_directly_in_the_box_without_a_level(admin_client: TestClient) -> None:
    box = _node(admin_client, kind="container", name="Boîte")
    tiroir = _node(admin_client, kind="container", name="Tiroir", parent_id=box["id"])
    r = _put(admin_client, box, [{"node_id": None, "cells": [{"node_id": tiroir["id"], "x": 0, "y": 0, "w": 100, "h": 100}]}])
    assert r.status_code == 200, r.text
    layout = r.json()["layout"]
    assert layout["levels"][0]["node_id"] is None
    assert layout["levels"][0]["cells"][0]["node_id"] == tiroir["id"]


def test_base_block_cells_must_be_children_of_the_box(admin_client: TestClient) -> None:
    box = _node(admin_client, kind="container", name="Boîte")
    etage = _node(admin_client, kind="container", name="Étage", parent_id=box["id"])
    case = _node(admin_client, kind="container", name="Case", parent_id=etage["id"])
    r = _put(admin_client, box, [{"node_id": None, "cells": [{"node_id": case["id"], "x": 0, "y": 0, "w": 50, "h": 50}]}])
    assert r.status_code == 422 and r.json()["code"] == "invalid_cell"


def test_cells_of_the_same_level_cannot_overlap(admin_client: TestClient) -> None:
    box = _node(admin_client, kind="container", name="Boîte")
    etage = _node(admin_client, kind="container", name="Étage", parent_id=box["id"])
    a = _node(admin_client, kind="container", name="A", parent_id=etage["id"])
    b = _node(admin_client, kind="container", name="B", parent_id=etage["id"])
    r = _put(
        admin_client,
        box,
        [
            {
                "node_id": etage["id"],
                "cells": [
                    {"node_id": a["id"], "x": 0, "y": 0, "w": 100, "h": 100},
                    {"node_id": b["id"], "x": 50, "y": 50, "w": 100, "h": 100},
                ],
            }
        ],
    )
    assert r.status_code == 422 and r.json()["code"] == "cells_overlap"


def test_touching_cells_are_allowed(admin_client: TestClient) -> None:
    box = _node(admin_client, kind="container", name="Boîte")
    a = _node(admin_client, kind="container", name="A", parent_id=box["id"])
    b = _node(admin_client, kind="container", name="B", parent_id=box["id"])
    r = _put(
        admin_client,
        box,
        [
            {
                "node_id": None,
                "cells": [
                    {"node_id": a["id"], "x": 0, "y": 0, "w": 100, "h": 100},
                    {"node_id": b["id"], "x": 100, "y": 0, "w": 100, "h": 100},
                ],
            }
        ],
    )
    assert r.status_code == 200, r.text


def test_only_one_base_block(admin_client: TestClient) -> None:
    box = _node(admin_client, kind="container", name="Boîte")
    r = _put(admin_client, box, [{"node_id": None, "cells": []}, {"node_id": None, "cells": []}])
    assert r.status_code == 422 and r.json()["code"] == "duplicate_level"


def test_plan_with_base_block_creates_cells_directly_in_box(admin_client: TestClient) -> None:
    plan = admin_client.post(
        f"{API}/plans",
        json={
            "name": "Tiroirs",
            "width_mm": 200,
            "height_mm": 100,
            "levels": [{"base": True, "cells": [{"name": "T1", "x": 0, "y": 0, "w": 100, "h": 100}]}],
        },
        headers=CSRF,
    )
    assert plan.status_code == 201, plan.text
    box = _node(admin_client, kind="container", name="Armoire")
    r = admin_client.post(
        f"{API}/plans/{plan.json()['id']}/apply",
        json={"node_id": box["id"], "node_version": box["version"]},
        headers=CSRF,
    )
    assert r.status_code == 200, r.text
    cell = r.json()["layout"]["levels"][0]["cells"][0]
    assert r.json()["layout"]["levels"][0]["node_id"] is None
    child = admin_client.get(f"{API}/nodes/{cell['node_id']}").json()
    assert child["name"] == "T1" and child["parent_id"] == box["id"]
