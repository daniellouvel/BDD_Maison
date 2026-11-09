"""Adresse lisible des éléments : slug unique, rempli pour l'existant.

Revision ID: 0005_node_slug
Revises: 0004_node_layout
Create Date: 2026-11-09
"""

import re
import unicodedata
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_node_slug"
down_revision: str | None = "0004_node_layout"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _slugify(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    return slug[:180] or "element"


def upgrade() -> None:
    op.add_column("nodes", sa.Column("slug", sa.String(length=200), nullable=True))
    op.create_index("uq_nodes_slug", "nodes", ["slug"], unique=True)

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT n.id, n.name, a.name AS article_name FROM nodes n "
            "LEFT JOIN articles a ON a.id = n.article_id ORDER BY n.created_at"
        )
    ).fetchall()
    used: set[str] = set()
    for row in rows:
        label = row.name or row.article_name or "element"
        base = _slugify(label)
        candidate, n = base, 2
        while candidate in used:
            candidate = f"{base}-{n}"
            n += 1
        used.add(candidate)
        bind.execute(sa.text("UPDATE nodes SET slug = :slug WHERE id = :id"), {"slug": candidate, "id": row.id})


def downgrade() -> None:
    op.drop_index("uq_nodes_slug", table_name="nodes")
    op.drop_column("nodes", "slug")
