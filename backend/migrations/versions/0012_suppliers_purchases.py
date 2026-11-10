"""Fournisseurs, offres, historique des prix et liste de courses.

Revision ID: 0012_suppliers_purchases
Revises: 0011_plans
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012_suppliers_purchases"
down_revision: str | None = "0011_plans"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "suppliers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False, unique=True),
        sa.Column("url", sa.String(length=500), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "supplier_offers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("article_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("articles.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("supplier_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("supplier_ref", sa.String(length=120), nullable=True),
        sa.Column("url", sa.String(length=500), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("article_id", "supplier_id", name="uq_supplier_offers_article_supplier"),
    )
    op.create_index("ix_supplier_offers_article_id", "supplier_offers", ["article_id"])
    op.create_index("ix_supplier_offers_supplier_id", "supplier_offers", ["supplier_id"])

    op.create_table(
        "price_points",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("offer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("supplier_offers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("unit_price", sa.Numeric(precision=12, scale=4), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("source IN ('manual', 'order')", name="ck_price_points_source"),
        sa.CheckConstraint("unit_price > 0", name="ck_price_points_unit_price_positive"),
    )
    op.create_index("ix_price_points_offer_id", "price_points", ["offer_id"])

    op.create_table(
        "purchase_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("article_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("articles.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("offer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("supplier_offers.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("quantity", sa.Numeric(precision=12, scale=3), nullable=False),
        sa.Column("unit_price", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("received_node_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("nodes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('to_buy', 'ordered', 'received', 'cancelled')", name="ck_purchase_items_status"),
        sa.CheckConstraint("quantity > 0", name="ck_purchase_items_quantity_positive"),
    )
    op.create_index("ix_purchase_items_article_id", "purchase_items", ["article_id"])
    op.create_index("ix_purchase_items_offer_id", "purchase_items", ["offer_id"])


def downgrade() -> None:
    op.drop_table("purchase_items")
    op.drop_table("price_points")
    op.drop_table("supplier_offers")
    op.drop_table("suppliers")
