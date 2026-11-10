"""Tests d'intégration sur une vraie base PostgreSQL.

Définir MW_TEST_DATABASE_URL, par exemple :
    postgresql+psycopg://myworkshop:mdp@127.0.0.1:5432/myworkshop_test
La base est entièrement réinitialisée (migrations Alembic) au démarrage des tests.
"""

import io
import os
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text

TEST_DB = os.environ.get("MW_TEST_DATABASE_URL")
CSRF = {"X-Requested-With": "tests"}
PASSWORD = "mot-de-passe-de-test-12"


@pytest.fixture(scope="session", autouse=True)
def _configure(tmp_path_factory: pytest.TempPathFactory) -> Iterator[None]:
    if not TEST_DB:
        pytest.skip("MW_TEST_DATABASE_URL non défini : tests d'intégration ignorés")
    os.environ["MW_DATABASE_URL"] = TEST_DB
    os.environ["MW_DATA_DIR"] = str(tmp_path_factory.mktemp("data"))
    os.environ["MW_COOKIE_SECURE"] = "false"
    # IA : aucun modèle ni service réel pendant les tests (fournisseurs factices via override).
    os.environ["MW_AI_EMBEDDINGS"] = "false"
    os.environ["MW_AI_REMOTE_URL"] = ""

    from app.core.config import get_settings
    from app.core.db import get_engine, get_session_factory

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "migrations"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def _clean_tables() -> Iterator[None]:
    from app.ai import registry
    from app.core.db import get_engine

    yield
    registry.clear_overrides()
    with get_engine().begin() as conn:
        conn.execute(
            text(
                "TRUNCATE loans, purchase_items, price_points, supplier_offers, suppliers, plans, saved_views, ai_suggestions, image_embeddings, qr_events, print_items, print_sheets, qr_labels, app_settings, "
                "audit_log, attachments, movements, nodes, node_types, articles, "
                "field_defs, categories, sessions, users RESTART IDENTITY CASCADE"
            )
        )


@pytest.fixture
def client() -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as c:
        yield c


def create_user(username: str, role: str) -> None:
    from app.core.db import get_session_factory
    from app.core.security import hash_password
    from app.models import User

    with get_session_factory()() as db:
        db.add(User(username=username, password_hash=hash_password(PASSWORD), role=role))
        db.commit()


@pytest.fixture
def admin_client(client: TestClient) -> TestClient:
    create_user("admin", "admin")
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": PASSWORD}, headers=CSRF)
    assert r.status_code == 200, r.text
    return client


@pytest.fixture
def photo_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (1200, 800), (200, 80, 40)).save(buf, format="PNG")
    return buf.getvalue()
