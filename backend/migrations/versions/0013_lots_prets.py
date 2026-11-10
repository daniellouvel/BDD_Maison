"""Statut des lots (en stock, prêté, sorti) et prêts.

Revision ID: 0013_lots_prets
Revises: 0012_suppliers_purchases
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013_lots_prets"
down_revision: str | None = "0012_suppliers_purchases"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "nodes",
        sa.Column("status", sa.String(length=16), nullable=False, server_default="in_stock"),
    )
    op.create_check_constraint(
        "ck_nodes_status", "nodes", "status IN ('in_stock', 'lent', 'removed')"
    )

    op.create_table(
        "loans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("node_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("nodes.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("recipient", sa.String(length=120), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=12, scale=3), nullable=False),
        sa.Column("out_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_loans_node_id", "loans", ["node_id"])


def downgrade() -> None:
    op.drop_index("ix_loans_node_id", table_name="loans")
    op.drop_table("loans")
    op.drop_constraint("ck_nodes_status", "nodes", type_="check")
    op.drop_column("nodes", "status")
