"""Vues enregistrées : recherches sauvegardées par utilisateur.

Revision ID: 0007_saved_views
Revises: 0006_node_type_genre
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_saved_views"
down_revision: str | None = "0006_node_type_genre"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "saved_views",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("query", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_saved_views_user_id", "saved_views", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_saved_views_user_id", table_name="saved_views")
    op.drop_table("saved_views")
