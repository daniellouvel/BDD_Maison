"""Régularisation : libère les étiquettes restées affectées à des éléments déjà supprimés.

Revision ID: 0009_release_orphan_labels
Revises: 0008_label_released
Create Date: 2026-11-10
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0009_release_orphan_labels"
down_revision: str | None = "0008_label_released"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Historique d'abord (il lit encore l'élément affecté), puis libération.
    op.execute(
        """
        INSERT INTO qr_events (code, event, node_id, detail, at)
        SELECT l.code, 'released', l.assigned_node_id, 'Élément supprimé (régularisation)', now()
        FROM qr_labels l JOIN nodes n ON n.id = l.assigned_node_id
        WHERE l.status = 'assigned' AND n.archived_at IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE qr_labels SET status = 'available', assigned_node_id = NULL, updated_at = now()
        WHERE status = 'assigned'
          AND assigned_node_id IN (SELECT id FROM nodes WHERE archived_at IS NOT NULL)
        """
    )


def downgrade() -> None:
    # Régularisation de données : pas de retour en arrière.
    pass
