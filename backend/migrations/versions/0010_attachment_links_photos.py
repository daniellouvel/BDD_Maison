"""Pièces jointes : type de lien et photo principale.

Revision ID: 0010_attachment_links_photos
Revises: 0009_release_orphan_labels
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_attachment_links_photos"
down_revision: str | None = "0009_release_orphan_labels"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("attachments", sa.Column("link_type", sa.String(length=24), nullable=True))
    op.add_column(
        "attachments",
        sa.Column("is_main", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # La photo la plus ancienne de chaque propriétaire devient la photo principale.
    op.execute(
        """
        UPDATE attachments a SET is_main = true
        WHERE a.kind = 'photo' AND a.id = (
            SELECT b.id FROM attachments b
            WHERE b.kind = 'photo'
              AND b.article_id IS NOT DISTINCT FROM a.article_id
              AND b.node_id IS NOT DISTINCT FROM a.node_id
            ORDER BY b.created_at ASC, b.id ASC LIMIT 1
        )
        """
    )


def downgrade() -> None:
    op.drop_column("attachments", "is_main")
    op.drop_column("attachments", "link_type")
