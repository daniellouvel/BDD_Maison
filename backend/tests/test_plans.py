from fastapi.testclient import TestClient

from tests.conftest import CSRF

API = "/api/v1"

PLAN = {
    "name": "Armoire 4 tiroirs",
    "width_mm": 300,
    "height_mm": 200,
    "levels": [
        {
            "name": "Haut",
            "cells": [
                {"name": "Vis", "x": 0, "y": 0, "w": 150, "h": 100},
                {"x": 150, "y": 0, "w": 150, "h": 100},
            ],
        },
        {"name": "Bas", "cells": [{"name": "Résistances", "x": 0, "y": 0, "w": 300, "h": 200}]},
    ],
}


def _node(client: TestClient, **body) -> dict:  # type: ignore[no-untyped-def]
    r = client.post(f"{API}/nodes", json=body, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


def _create_plan(client: TestClient, body: dict = PLAN):  # type: ignore[no-untyped-def]
    return client.post(f"{API}/plans", json=body, headers=CSRF)


def test_plan_create_list_get_and_update(admin_client: TestClient) -> None:
    r = _create_plan(admin_client)
    assert r.status_code == 201, r.text
    plan = r.json()
    assert plan["version"] == 1 and plan["levels"][0]["name"] == "Haut"

    assert [p["id"] for p in admin_client.get(f"{API}/plans").json()] == [plan["id"]]
    assert admin_client.get(f"{API}/plans/{plan['id']}").json()["name"] == "Armoire 4 tiroirs"

    body = {**PLAN, "name": "Armoire 6 tiroirs", "version": plan["version"]}
    r = admin_client.put(f"{API}/plans/{plan['id']}", json=body, headers=CSRF)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Armoire 6 tiroirs" and r.json()["version"] == 2

    stale = admin_client.put(f"{API}/plans/{plan['id']}", json=body, headers=CSRF)
    assert stale.status_code == 409
    assert stale.json()["code"] == "version_conflict"


def test_plan_cells_must_fit_and_not_overlap(admin_client: TestClient) -> None:
    too_big = {**PLAN, "levels": [{"cells": [{"x": 250, "y": 0, "w": 100, "h": 50}]}]}
    r = _create_plan(admin_client, too_big)
    assert r.status_code == 422 and r.json()["code"] == "invalid_plan"

    overlap = {
        **PLAN,
        "levels": [{"cells": [{"x": 0, "y": 0, "w": 100, "h": 100}, {"x": 50, "y": 50, "w": 100, "h": 100}]}],
    }
    r = _create_plan(admin_client, overlap)
    assert r.status_code == 422 and r.json()["code"] == "invalid_plan"


def test_apply_creates_levels_and_cells_in_the_box(admin_client: TestClient) -> None:
    plan = _create_plan(admin_client).json()
    box = _node(admin_client, kind="container", name="Armoire garage")

    r = admin_client.post(
        f"{API}/plans/{plan['id']}/apply",
        json={"node_id": box["id"], "node_version": box["version"]},
        headers=CSRF,
    )
    assert r.status_code == 200, r.text
    layout = r.json()["layout"]
    assert layout["width_mm"] == 300 and layout["height_mm"] == 200
    assert len(layout["levels"]) == 2

    haut = admin_client.get(f"{API}/nodes/{layout['levels'][0]['node_id']}").json()
    assert haut["name"] == "Haut" and haut["parent_id"] == box["id"]
    cells = layout["levels"][0]["cells"]
    assert len(cells) == 2
    assert admin_client.get(f"{API}/nodes/{cells[0]['node_id']}").json()["name"] == "Vis"
    # Une case sans nom reçoit « Case n » selon son rang dans l'étage.
    assert admin_client.get(f"{API}/nodes/{cells[1]['node_id']}").json()["name"] == "Case 2"
    assert r.json()["version"] == box["version"] + 1


def test_box_with_a_plan_cannot_get_another_one(admin_client: TestClient) -> None:
    plan = _create_plan(admin_client).json()
    box = _node(admin_client, kind="container", name="Boîte")
    first = admin_client.post(
        f"{API}/plans/{plan['id']}/apply", json={"node_id": box["id"], "node_version": box["version"]}, headers=CSRF
    ).json()
    r = admin_client.post(
        f"{API}/plans/{plan['id']}/apply",
        json={"node_id": box["id"], "node_version": first["version"]},
        headers=CSRF,
    )
    assert r.status_code == 409 and r.json()["code"] == "box_has_plan"


def test_apply_with_stale_box_version_is_refused(admin_client: TestClient) -> None:
    plan = _create_plan(admin_client).json()
    box = _node(admin_client, kind="container", name="Boîte")
    r = admin_client.post(
        f"{API}/plans/{plan['id']}/apply",
        json={"node_id": box["id"], "node_version": box["version"] + 5},
        headers=CSRF,
    )
    assert r.status_code == 409 and r.json()["code"] == "version_conflict"


def test_changing_the_model_does_not_change_boxes_already_built(admin_client: TestClient) -> None:
    plan = _create_plan(admin_client).json()
    box = _node(admin_client, kind="container", name="Boîte")
    applied = admin_client.post(
        f"{API}/plans/{plan['id']}/apply", json={"node_id": box["id"], "node_version": box["version"]}, headers=CSRF
    ).json()
    model_update = {**PLAN, "levels": [{"name": "Unique", "cells": []}], "version": plan["version"]}
    assert admin_client.put(f"{API}/plans/{plan['id']}", json=model_update, headers=CSRF).status_code == 200

    kept = admin_client.get(f"{API}/nodes/{box['id']}").json()
    assert kept["layout"] == applied["layout"]
    assert len(kept["layout"]["levels"]) == 2


def test_archived_plan_disappears(admin_client: TestClient) -> None:
    plan = _create_plan(admin_client).json()
    assert admin_client.delete(f"{API}/plans/{plan['id']}", headers=CSRF).status_code == 204
    assert admin_client.get(f"{API}/plans").json() == []
    assert admin_client.get(f"{API}/plans/{plan['id']}").status_code == 404
