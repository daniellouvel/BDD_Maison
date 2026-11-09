"""Genre des types d'emplacement : emplacement, contenant, boîte, ou tous.

Revision ID: 0006_node_type_genre
Revises: 0005_node_slug
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_node_type_genre"
down_revision: str | None = "0005_node_slug"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "node_types",
        sa.Column("genre", sa.String(length=16), nullable=False, server_default="tous"),
    )
    op.create_check_constraint(
        "ck_node_types_genre",
        "node_types",
        "genre IN ('emplacement', 'contenant', 'boite', 'tous')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_node_types_genre", "node_types", type_="check")
    op.drop_column("node_types", "genre")
