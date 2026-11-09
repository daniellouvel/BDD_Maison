"""IA : suggestions à valider, empreintes visuelles des photos.

Revision ID: 0003_ai
Revises: 0002_qr_labels
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_ai"
down_revision: str | None = "0002_qr_labels"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "ai_suggestions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("providers", postgresql.JSON(), nullable=False),
        sa.Column("result", postgresql.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("article_id", UUID, sa.ForeignKey("articles.id", ondelete="SET NULL")),
        sa.Column("created_by", UUID, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('pending', 'accepted', 'rejected')", name="ck_ai_suggestions_status"
        ),
    )
    op.create_table(
        "image_embeddings",
        sa.Column(
            "attachment_id",
            UUID,
            sa.ForeignKey("attachments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("vector", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("image_embeddings")
    op.drop_table("ai_suggestions")
