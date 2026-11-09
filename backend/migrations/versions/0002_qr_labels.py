"""Étiquettes QR universelles, historique, planches d'impression, réglages.

Revision ID: 0002_qr_labels
Revises: 0001_initial
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_qr_labels"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def _ts() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "qr_labels",
        sa.Column("code", sa.String(16), primary_key=True),
        sa.Column("seq", sa.Integer(), nullable=False, unique=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column(
            "assigned_node_id",
            UUID,
            sa.ForeignKey("nodes.id", ondelete="RESTRICT"),
            unique=True,
        ),
        sa.Column("disabled_reason", sa.Text()),
        sa.Column("print_count", sa.Integer(), nullable=False),
        sa.Column("created_at", _ts(), nullable=False),
        sa.Column("printed_at", _ts()),
        sa.Column("updated_at", _ts(), nullable=False),
        sa.CheckConstraint(
            "status IN ('available', 'assigned', 'disabled')", name="ck_qr_labels_status"
        ),
        sa.CheckConstraint(
            "(status = 'assigned') = (assigned_node_id IS NOT NULL)",
            name="ck_qr_labels_assigned_node",
        ),
    )

    op.create_table(
        "print_sheets",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("number", sa.Integer(), sa.Identity(), nullable=False, unique=True),
        sa.Column("is_reprint", sa.Boolean(), nullable=False),
        sa.Column("start_position", sa.Integer(), nullable=False),
        sa.Column("label_count", sa.Integer(), nullable=False),
        sa.Column("layout", postgresql.JSON(), nullable=False),
        sa.Column("created_by", UUID, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", _ts(), nullable=False),
    )

    op.create_table(
        "print_items",
        sa.Column(
            "sheet_id",
            UUID,
            sa.ForeignKey("print_sheets.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("position", sa.Integer(), primary_key=True),
        sa.Column(
            "code", sa.String(16), sa.ForeignKey("qr_labels.code", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("is_reprint", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_print_items_code", "print_items", ["code"])

    op.create_table(
        "qr_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "code", sa.String(16), sa.ForeignKey("qr_labels.code", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("event", sa.String(16), nullable=False),
        sa.Column("node_id", UUID, sa.ForeignKey("nodes.id", ondelete="SET NULL")),
        sa.Column("sheet_id", UUID, sa.ForeignKey("print_sheets.id", ondelete="SET NULL")),
        sa.Column("detail", sa.Text()),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("at", _ts(), nullable=False),
        sa.CheckConstraint(
            "event IN ('created', 'printed', 'reprinted', 'assigned', 'disabled', 'replaced',"
            " 'reactivated')",
            name="ck_qr_events_event",
        ),
    )
    op.create_index("ix_qr_events_code", "qr_events", ["code"])

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", postgresql.JSON(), nullable=False),
    )


def downgrade() -> None:
    for table in ("app_settings", "qr_events", "print_items", "print_sheets", "qr_labels"):
        op.drop_table(table)
