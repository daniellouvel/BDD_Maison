"""Plan des boîtes : photo et cases tracées sur les contenants.

Revision ID: 0004_node_layout
Revises: 0003_ai
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_node_layout"
down_revision: str | None = "0003_ai"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("nodes", sa.Column("layout", postgresql.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("nodes", "layout")
