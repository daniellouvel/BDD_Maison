from fastapi.testclient import TestClient

from tests.conftest import CSRF

API = "/api/v1"


def test_saved_search_is_listed_and_deleted(admin_client: TestClient) -> None:
    r = admin_client.post(f"{API}/saved-searches", json={"name": "Résistances", "query": "résistance"}, headers=CSRF)
    assert r.status_code == 201, r.text
    view = r.json()
    listed = admin_client.get(f"{API}/saved-searches").json()
    assert [v["name"] for v in listed] == ["Résistances"]
    assert admin_client.delete(f"{API}/saved-searches/{view['id']}", headers=CSRF).status_code == 204
    assert admin_client.get(f"{API}/saved-searches").json() == []


def test_saved_search_needs_a_name_and_a_query(admin_client: TestClient) -> None:
    r = admin_client.post(f"{API}/saved-searches", json={"name": "  ", "query": "x"}, headers=CSRF)
    assert r.status_code == 422
