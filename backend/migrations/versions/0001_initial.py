"""Schéma initial : utilisateurs, catalogue, emplacements, stock, fichiers, audit.

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def _ts() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("username", sa.String(64), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("created_at", _ts(), nullable=False),
        sa.CheckConstraint("role IN ('admin', 'membre', 'lecture')", name="ck_users_role"),
    )

    op.create_table(
        "sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", _ts(), nullable=False),
        sa.Column("expires_at", _ts(), nullable=False),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])

    op.create_table(
        "categories",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("parent_id", UUID, sa.ForeignKey("categories.id", ondelete="RESTRICT")),
        sa.Column("name", sa.String(120), nullable=False),
    )
    op.create_index("ix_categories_parent_id", "categories", ["parent_id"])

    op.create_table(
        "field_defs",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "category_id", UUID, sa.ForeignKey("categories.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("unit", sa.String(16)),
        sa.Column("options", postgresql.JSON()),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("category_id", "key", name="uq_field_defs_category_key"),
        sa.CheckConstraint(
            "type IN ('text', 'number', 'enum', 'bool')", name="ck_field_defs_type"
        ),
    )
    op.create_index("ix_field_defs_category_id", "field_defs", ["category_id"])

    op.create_table(
        "articles",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("category_id", UUID, sa.ForeignKey("categories.id", ondelete="RESTRICT")),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("brand", sa.String(120)),
        sa.Column("mpn", sa.String(120)),
        sa.Column("description", sa.Text()),
        sa.Column("keywords", sa.Text()),
        sa.Column("attributes", postgresql.JSON(), nullable=False),
        sa.Column("min_quantity", sa.Numeric(12, 3)),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", _ts(), nullable=False),
        sa.Column("updated_at", _ts(), nullable=False),
        sa.Column("archived_at", _ts()),
    )
    op.create_index("ix_articles_category_id", "articles", ["category_id"])
    op.create_index("ix_articles_name", "articles", ["name"])
    op.create_index("ix_articles_mpn", "articles", ["mpn"])

    op.create_table(
        "node_types",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.String(80), nullable=False, unique=True),
    )

    op.create_table(
        "nodes",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("parent_id", UUID, sa.ForeignKey("nodes.id", ondelete="RESTRICT")),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("node_type_id", UUID, sa.ForeignKey("node_types.id", ondelete="SET NULL")),
        sa.Column("name", sa.String(200)),
        sa.Column("article_id", UUID, sa.ForeignKey("articles.id", ondelete="RESTRICT")),
        sa.Column("quantity", sa.Numeric(12, 3)),
        sa.Column("unit", sa.String(16)),
        sa.Column("notes", sa.Text()),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", _ts(), nullable=False),
        sa.Column("updated_at", _ts(), nullable=False),
        sa.Column("archived_at", _ts()),
        sa.CheckConstraint(
            "kind IN ('location', 'container', 'item')", name="ck_nodes_kind"
        ),
        sa.CheckConstraint("kind = 'item' OR name IS NOT NULL", name="ck_nodes_name_required"),
        sa.CheckConstraint(
            "(kind = 'item' AND article_id IS NOT NULL AND quantity IS NOT NULL AND quantity >= 0)"
            " OR (kind <> 'item' AND article_id IS NULL AND quantity IS NULL)",
            name="ck_nodes_item_fields",
        ),
    )
    op.create_index("ix_nodes_parent_id", "nodes", ["parent_id"])
    op.create_index("ix_nodes_article_id", "nodes", ["article_id"])

    op.create_table(
        "movements",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("op_id", UUID, unique=True),
        sa.Column("node_id", UUID, sa.ForeignKey("nodes.id", ondelete="RESTRICT"), nullable=False),
        sa.Column(
            "article_id", UUID, sa.ForeignKey("articles.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("delta", sa.Numeric(12, 3), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("from_node_id", UUID, sa.ForeignKey("nodes.id", ondelete="RESTRICT")),
        sa.Column("to_node_id", UUID, sa.ForeignKey("nodes.id", ondelete="RESTRICT")),
        sa.Column("reason", sa.Text()),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", _ts(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('in', 'out', 'consume', 'adjust', 'move')", name="ck_movements_kind"
        ),
    )
    op.create_index("ix_movements_node_id", "movements", ["node_id"])
    op.create_index("ix_movements_article_id", "movements", ["article_id"])

    op.create_table(
        "attachments",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("article_id", UUID, sa.ForeignKey("articles.id", ondelete="CASCADE")),
        sa.Column("node_id", UUID, sa.ForeignKey("nodes.id", ondelete="CASCADE")),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("title", sa.String(200)),
        sa.Column("url", sa.String(2048)),
        sa.Column("storage_key", sa.String(80)),
        sa.Column("thumb_key", sa.String(80)),
        sa.Column("mime", sa.String(100)),
        sa.Column("size", sa.Integer()),
        sa.Column("sha256", sa.String(64)),
        sa.Column("created_at", _ts(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('photo', 'datasheet', 'document', 'link', 'note')",
            name="ck_attachments_kind",
        ),
        sa.CheckConstraint(
            "(article_id IS NOT NULL)::int + (node_id IS NOT NULL)::int = 1",
            name="ck_attachments_single_owner",
        ),
    )
    op.create_index("ix_attachments_article_id", "attachments", ["article_id"])
    op.create_index("ix_attachments_node_id", "attachments", ["node_id"])

    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("entity", sa.String(32), nullable=False),
        sa.Column("entity_id", UUID, nullable=False),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("before", postgresql.JSON()),
        sa.Column("after", postgresql.JSON()),
        sa.Column("at", _ts(), nullable=False),
    )
    op.create_index("ix_audit_log_entity_id", "audit_log", ["entity_id"])


def downgrade() -> None:
    for table in (
        "audit_log",
        "attachments",
        "movements",
        "nodes",
        "node_types",
        "articles",
        "field_defs",
        "categories",
        "sessions",
        "users",
    ):
        op.drop_table(table)
