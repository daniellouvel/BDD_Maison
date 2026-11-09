from fastapi.testclient import TestClient

from tests.conftest import CSRF

API = "/api/v1"


def _node(client: TestClient, **body) -> dict:  # type: ignore[no-untyped-def]
    r = client.post(f"{API}/nodes", json=body, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


def _photo(client: TestClient, node_id: str, photo_bytes: bytes) -> str:
    r = client.post(
        f"{API}/attachments",
        data={"kind": "photo", "node_id": node_id, "title": "Intérieur"},
        files={"file": ("photo.png", photo_bytes, "image/png")},
        headers=CSRF,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_layout_stores_photo_and_cells(admin_client: TestClient, photo_bytes: bytes) -> None:
    boite = _node(admin_client, kind="container", name="Boîte vis")
    photo_id = _photo(admin_client, boite["id"], photo_bytes)
    case_a = _node(admin_client, kind="container", name="Case A", parent_id=boite["id"])
    case_b = _node(admin_client, kind="container", name="Case B", parent_id=boite["id"])

    body = {
        "version": boite["version"],
        "photo_id": photo_id,
        "cells": [
            {"node_id": case_a["id"], "x": 0.0, "y": 0.0, "w": 0.4, "h": 1.0},
            {"node_id": case_b["id"], "x": 0.4, "y": 0.0, "w": 0.6, "h": 0.5},
        ],
    }
    r = admin_client.put(f"{API}/nodes/{boite['id']}/layout", json=body, headers=CSRF)
    assert r.status_code == 200, r.text
    layout = r.json()["layout"]
    assert layout["photo_id"] == photo_id
    assert [c["node_id"] for c in layout["cells"]] == [case_a["id"], case_b["id"]]
    assert r.json()["version"] == boite["version"] + 1

    again = admin_client.get(f"{API}/nodes/{boite['id']}").json()
    assert again["layout"] == layout


def test_cell_must_belong_to_the_box(admin_client: TestClient) -> None:
    boite = _node(admin_client, kind="container", name="Boîte")
    autre = _node(admin_client, kind="container", name="Autre boîte")
    etranger = _node(admin_client, kind="container", name="Case étrangère", parent_id=autre["id"])
    body = {
        "version": boite["version"],
        "cells": [{"node_id": etranger["id"], "x": 0, "y": 0, "w": 0.5, "h": 0.5}],
    }
    r = admin_client.put(f"{API}/nodes/{boite['id']}/layout", json=body, headers=CSRF)
    assert r.status_code == 422 and r.json()["code"] == "invalid_cell"


def test_cell_outside_photo_is_refused(admin_client: TestClient) -> None:
    boite = _node(admin_client, kind="container", name="Boîte")
    case = _node(admin_client, kind="container", name="Case", parent_id=boite["id"])
    body = {
        "version": boite["version"],
        "cells": [{"node_id": case["id"], "x": 0.8, "y": 0, "w": 0.5, "h": 0.5}],
    }
    r = admin_client.put(f"{API}/nodes/{boite['id']}/layout", json=body, headers=CSRF)
    assert r.status_code == 422 and r.json()["code"] == "invalid_cell"


def test_photo_must_belong_to_the_box(admin_client: TestClient, photo_bytes: bytes) -> None:
    boite = _node(admin_client, kind="container", name="Boîte")
    autre = _node(admin_client, kind="container", name="Autre")
    photo_id = _photo(admin_client, autre["id"], photo_bytes)
    body = {"version": boite["version"], "photo_id": photo_id, "cells": []}
    r = admin_client.put(f"{API}/nodes/{boite['id']}/layout", json=body, headers=CSRF)
    assert r.status_code == 422 and r.json()["code"] == "invalid_photo"


def test_stale_layout_version_is_refused(admin_client: TestClient) -> None:
    boite = _node(admin_client, kind="container", name="Boîte")
    body = {"version": boite["version"] + 5, "cells": []}
    r = admin_client.put(f"{API}/nodes/{boite['id']}/layout", json=body, headers=CSRF)
    assert r.status_code == 409 and r.json()["code"] == "version_conflict"
