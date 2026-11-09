"""Étiquette libérée : nouvel événement quand l'élément qui la portait est supprimé.

Revision ID: 0008_label_released
Revises: 0007_saved_views
Create Date: 2026-11-10
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008_label_released"
down_revision: str | None = "0007_saved_views"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD = "event IN ('created', 'printed', 'reprinted', 'assigned', 'disabled', 'replaced', 'reactivated')"
NEW = (
    "event IN ('created', 'printed', 'reprinted', 'assigned', 'disabled', 'replaced', "
    "'reactivated', 'released')"
)


def upgrade() -> None:
    op.drop_constraint("ck_qr_events_event", "qr_events", type_="check")
    op.create_check_constraint("ck_qr_events_event", "qr_events", NEW)


def downgrade() -> None:
    op.execute("UPDATE qr_events SET event = 'reactivated' WHERE event = 'released'")
    op.drop_constraint("ck_qr_events_event", "qr_events", type_="check")
    op.create_check_constraint("ck_qr_events_event", "qr_events", OLD)
