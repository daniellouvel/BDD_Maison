"""Modèles de plans réutilisables : création, modification, et affectation à un contenant.

Affecter un modèle copie sa grille dans le contenant : il crée les étages et les cases comme des
éléments ordinaires. Modifier ensuite le modèle ne touche pas les contenants déjà affectés.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError, conflict_version, not_found
from app.models import Node, Plan, User, utcnow
from app.schemas import PlanIn, PlanUpdate
from app.services.common import audit, snapshot
from app.services.nodes import assign_slug


def _checked_levels(data: PlanIn) -> list[dict]:
    """Vérifie que les cases tiennent dans le plan et ne se chevauchent pas, par étage."""
    levels: list[dict] = []
    for level in data.levels:
        cells: list[dict] = []
        for cell in level.cells:
            if cell.x + cell.w > data.width_mm + 0.01 or cell.y + cell.h > data.height_mm + 0.01:
                raise ApiError(422, "invalid_plan", "Une case dépasse les dimensions du plan.")
            for other in cells:
                if (
                    cell.x < other["x"] + other["w"]
                    and other["x"] < cell.x + cell.w
                    and cell.y < other["y"] + other["h"]
                    and other["y"] < cell.y + cell.h
                ):
                    raise ApiError(422, "invalid_plan", "Deux cases d'un même étage se chevauchent.")
            cells.append(
                {
                    "name": (cell.name or "").strip() or None,
                    "x": cell.x,
                    "y": cell.y,
                    "w": cell.w,
                    "h": cell.h,
                }
            )
        levels.append({"name": (level.name or "").strip() or None, "cells": cells})
    return levels


def list_plans(db: Session) -> list[Plan]:
    return list(db.scalars(select(Plan).where(Plan.archived_at.is_(None)).order_by(Plan.name)))


def get_plan(db: Session, plan_id: uuid.UUID) -> Plan:
    plan = db.get(Plan, plan_id)
    if plan is None or plan.archived_at is not None:
        raise not_found("Plan")
    return plan


def create_plan(db: Session, data: PlanIn, actor: User) -> Plan:
    name = data.name.strip()
    if not name:
        raise ApiError(422, "invalid_plan", "Le plan doit avoir un nom.")
    plan = Plan(
        name=name,
        width_mm=data.width_mm,
        height_mm=data.height_mm,
        levels=_checked_levels(data),
        version=1,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(plan)
    db.flush()
    audit(db, "plan", plan, actor, "create")
    db.commit()
    db.refresh(plan)
    return plan


def update_plan(db: Session, plan: Plan, data: PlanUpdate, actor: User) -> Plan:
    if data.version != plan.version:
        raise conflict_version()
    name = data.name.strip()
    if not name:
        raise ApiError(422, "invalid_plan", "Le plan doit avoir un nom.")
    before = snapshot(plan)
    plan.name = name
    plan.width_mm = data.width_mm
    plan.height_mm = data.height_mm
    plan.levels = _checked_levels(data)
    plan.version += 1
    plan.updated_at = utcnow()
    audit(db, "plan", plan, actor, "update", before=before)
    db.commit()
    db.refresh(plan)
    return plan


def archive_plan(db: Session, plan: Plan, actor: User) -> None:
    before = snapshot(plan)
    plan.archived_at = utcnow()
    plan.version += 1
    audit(db, "plan", plan, actor, "delete", before=before)
    db.commit()


def _container(db: Session, parent: Node, name: str, actor: User) -> Node:
    node = Node(kind="container", parent_id=parent.id, name=name, version=1)
    db.add(node)
    db.flush()
    assign_slug(db, node)
    audit(db, "node", node, actor, "create")
    return node


def apply_plan(db: Session, plan: Plan, box: Node, box_version: int, actor: User) -> Node:
    """Crée dans le contenant les étages et les cases du modèle, puis enregistre son plan.

    Refusé si le contenant a déjà un plan : on le modifie alors sur l'écran Plan.
    """
    if box.archived_at is not None:
        raise not_found("Élément")
    if box.kind == "item":
        raise ApiError(422, "invalid_fields", "Un objet n'a pas de plan : seuls les emplacements et contenants en ont un.")
    if box_version != box.version:
        raise conflict_version()
    if box.layout and box.layout.get("levels"):
        raise ApiError(409, "box_has_plan", "Ce contenant a déjà un plan. Modifiez-le sur l'écran Plan.")

    before = snapshot(box)
    levels_out: list[dict] = []
    for index, level in enumerate(plan.levels, start=1):
        level_node = _container(db, box, level.get("name") or f"Étage {index}", actor)
        cells_out: list[dict] = []
        for n, cell in enumerate(level["cells"], start=1):
            cell_node = _container(db, level_node, cell.get("name") or f"Case {n}", actor)
            cells_out.append(
                {"node_id": str(cell_node.id), "x": cell["x"], "y": cell["y"], "w": cell["w"], "h": cell["h"]}
            )
        levels_out.append({"node_id": str(level_node.id), "cells": cells_out})

    box.layout = {"width_mm": plan.width_mm, "height_mm": plan.height_mm, "levels": levels_out}
    box.version += 1
    box.updated_at = utcnow()
    audit(db, "node", box, actor, "update", before=before)
    db.commit()
    db.refresh(box)
    return box
