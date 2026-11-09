import pymupdf
import zxingcpp
from fastapi.testclient import TestClient
from PIL import Image

from tests.conftest import CSRF

API = "/api/v1"


def _sheet(client: TestClient, **body) -> dict:  # type: ignore[no-untyped-def]
    r = client.post(f"{API}/qr/sheets", json=body, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


def _node(client: TestClient, **body) -> dict:  # type: ignore[no-untyped-def]
    r = client.post(f"{API}/nodes", json=body, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()


def _decode_pdf(pdf_bytes: bytes) -> list[str]:
    """Rastérise la page à 300 dpi et décode tous les QR, comme le ferait une caméra."""
    page = pymupdf.open(stream=pdf_bytes, filetype="pdf")[0]
    pix = page.get_pixmap(dpi=300, colorspace=pymupdf.csGRAY)
    image = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    return sorted(r.text for r in zxingcpp.read_barcodes(image))


# --- Séquence et impression ---------------------------------------------------------------------


def test_new_sheets_continue_the_sequence(admin_client: TestClient) -> None:
    first = _sheet(admin_client)
    assert (first["first_code"], first["last_code"], first["label_count"]) == ("QR-000001", "QR-000065", 65)
    second = _sheet(admin_client, count=10)
    assert (second["first_code"], second["last_code"]) == ("QR-000066", "QR-000075")
    assert second["number"] == first["number"] + 1
    stats = admin_client.get(f"{API}/qr/stats").json()
    assert stats["available"] == 75 and stats["next_code"] == "QR-000076"


def test_printed_pdf_contains_65_readable_qr_codes(admin_client: TestClient) -> None:
    sheet = _sheet(admin_client)
    r = admin_client.get(f"{API}/qr/sheets/{sheet['id']}/pdf")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    decoded = _decode_pdf(r.content)
    assert decoded == [f"QR-{i:06d}" for i in range(1, 66)]


def test_partial_sheet_starts_at_requested_position(admin_client: TestClient) -> None:
    sheet = _sheet(admin_client, start_position=61)
    assert sheet["label_count"] == 5
    too_many = admin_client.post(f"{API}/qr/sheets", json={"start_position": 61, "count": 6}, headers=CSRF)
    assert too_many.status_code == 422 and too_many.json()["code"] == "too_many_labels"


def test_reprint_requires_explicit_confirmation(admin_client: TestClient) -> None:
    _sheet(admin_client, count=20)
    body = {"mode": "range", "start_seq": 5, "count": 3}

    preview = admin_client.post(f"{API}/qr/sheets/preview", json=body, headers=CSRF).json()
    assert preview["requires_confirmation"] is True
    assert [c["code"] for c in preview["already_printed"]] == ["QR-000005", "QR-000006", "QR-000007"]

    refused = admin_client.post(f"{API}/qr/sheets", json=body, headers=CSRF)
    assert refused.status_code == 409 and refused.json()["code"] == "reprint_confirmation_required"

    sheet = _sheet(admin_client, **body, confirm_reprint=True)
    assert sheet["is_reprint"] is True
    label = admin_client.get(f"{API}/qr/labels/QR-000005").json()
    assert label["print_count"] == 2
    assert [e["event"] for e in label["events"]] == ["created", "printed", "reprinted"]

    # La séquence reprend après le plus grand code, pas après la réimpression.
    assert _sheet(admin_client, count=1)["first_code"] == "QR-000021"


def test_reprint_of_never_printed_codes_is_refused(admin_client: TestClient) -> None:
    _sheet(admin_client, count=5)
    r = admin_client.post(
        f"{API}/qr/sheets", json={"mode": "range", "start_seq": 4, "count": 5, "confirm_reprint": True}, headers=CSRF
    )
    assert r.status_code == 422 and r.json()["code"] == "unknown_codes"


def test_layout_is_validated_and_used_by_new_sheets(admin_client: TestClient) -> None:
    bad = admin_client.put(f"{API}/qr/layout", json={"columns": 6}, headers=CSRF)
    assert bad.status_code == 422
    ok = admin_client.put(
        f"{API}/qr/layout", json={"margin_top": 12.0, "pitch_y": 21.0, "label_height": 21.0}, headers=CSRF
    )
    assert ok.status_code == 200, ok.text
    test_pdf = admin_client.get(f"{API}/qr/layout/test.pdf")
    assert test_pdf.status_code == 200
    assert len(_decode_pdf(test_pdf.content)) == 65
    assert admin_client.get(f"{API}/qr/stats").json()["total"] == 0  # la planche d'essai ne crée rien


# --- Affectation --------------------------------------------------------------------------------


def test_assign_label_and_resolve_scan(admin_client: TestClient) -> None:
    _sheet(admin_client, count=3)
    tiroir = _node(admin_client, kind="container", name="Tiroir 1")

    r = admin_client.post(f"{API}/qr/labels/QR-000001/assign", json={"node_id": tiroir["id"]}, headers=CSRF)
    assert r.status_code == 200 and r.json()["status"] == "assigned"

    # Le code est normalisé (le client extrait déjà le code d'une URL scannée).
    for scanned in ("QR-000001", "qr-1", "QR1"):
        label = admin_client.get(f"{API}/qr/labels/{scanned}").json()
        assert label["node"]["name"] == "Tiroir 1"

    assert admin_client.get(f"{API}/nodes/{tiroir['id']}").json()["qr_code"] == "QR-000001"


def test_assigned_label_is_never_reused(admin_client: TestClient) -> None:
    _sheet(admin_client, count=3)
    a = _node(admin_client, kind="container", name="A")
    b = _node(admin_client, kind="container", name="B")
    admin_client.post(f"{API}/qr/labels/QR-000001/assign", json={"node_id": a["id"]}, headers=CSRF)

    other_node = admin_client.post(f"{API}/qr/labels/QR-000001/assign", json={"node_id": b["id"]}, headers=CSRF)
    assert other_node.status_code == 409 and other_node.json()["code"] == "label_assigned"
    second_label = admin_client.post(f"{API}/qr/labels/QR-000002/assign", json={"node_id": a["id"]}, headers=CSRF)
    assert second_label.status_code == 409 and second_label.json()["code"] == "node_has_label"
    unknown = admin_client.get(f"{API}/qr/labels/QR-000999")
    assert unknown.status_code == 404 and unknown.json()["code"] == "unknown_label"


def test_replace_damaged_label_keeps_history(admin_client: TestClient) -> None:
    _sheet(admin_client, count=3)
    box = _node(admin_client, kind="container", name="Boîte")
    admin_client.post(f"{API}/qr/labels/QR-000001/assign", json={"node_id": box["id"]}, headers=CSRF)

    r = admin_client.post(f"{API}/qr/labels/QR-000001/replace", json={"new_code": "QR-000002"}, headers=CSRF)
    assert r.status_code == 200, r.text
    assert admin_client.get(f"{API}/nodes/{box['id']}").json()["qr_code"] == "QR-000002"

    old = admin_client.get(f"{API}/qr/labels/QR-000001").json()
    assert old["status"] == "disabled" and old["node"] is None
    assert old["events"][-1]["event"] == "replaced"
    retry = admin_client.post(f"{API}/qr/labels/QR-000001/assign", json={"node_id": box["id"]}, headers=CSRF)
    assert retry.status_code == 409 and retry.json()["code"] == "label_disabled"


def test_lost_label_can_only_come_back_through_admin(admin_client: TestClient) -> None:
    _sheet(admin_client, count=1)
    r = admin_client.post(f"{API}/qr/labels/QR-000001/disable", json={"reason": "Perdue"}, headers=CSRF)
    assert r.json()["status"] == "disabled" and r.json()["disabled_reason"] == "Perdue"
    back = admin_client.post(f"{API}/qr/labels/QR-000001/reactivate", headers=CSRF)
    assert back.status_code == 200 and back.json()["status"] == "available"


def test_move_by_scanning_keeps_contents_attached(admin_client: TestClient) -> None:
    """Scénario : scanner le tiroir, scanner la destination, confirmer."""
    _sheet(admin_client, count=2)
    salon = _node(admin_client, kind="location", name="Salon")
    garage = _node(admin_client, kind="location", name="Garage")
    tiroir = _node(admin_client, kind="container", name="Tiroir 1", parent_id=salon["id"])
    admin_client.post(f"{API}/qr/labels/QR-000001/assign", json={"node_id": tiroir["id"]}, headers=CSRF)
    admin_client.post(f"{API}/qr/labels/QR-000002/assign", json={"node_id": garage["id"]}, headers=CSRF)

    source = admin_client.get(f"{API}/qr/labels/QR-000001").json()["node"]
    destination = admin_client.get(f"{API}/qr/labels/QR-000002").json()["node"]
    moved = admin_client.patch(
        f"{API}/nodes/{source['id']}",
        json={"version": source["version"], "parent_id": destination["id"]},
        headers=CSRF,
    )
    assert moved.status_code == 200
    assert [b["name"] for b in moved.json()["breadcrumb"]] == ["Garage", "Tiroir 1"]
