import uuid

from fastapi import APIRouter
from fastapi.responses import Response

from app.api.deps import CurrentUser, DbSession, Writer
from app.core.errors import not_found
from app.models import Node, Plan
from app.schemas import NodeDetail, PlanApply, PlanIn, PlanOut, PlanUpdate
from app.services import nodes as node_service
from app.services import plans as plan_service

router = APIRouter(prefix="/plans", tags=["plans"])


@router.get("", response_model=list[PlanOut])
def list_plans(db: DbSession, _: CurrentUser) -> list[Plan]:
    return plan_service.list_plans(db)


@router.post("", response_model=PlanOut, status_code=201)
def create_plan(body: PlanIn, db: DbSession, user: Writer) -> Plan:
    return plan_service.create_plan(db, body, user)


@router.get("/{plan_id}", response_model=PlanOut)
def get_plan(plan_id: uuid.UUID, db: DbSession, _: CurrentUser) -> Plan:
    return plan_service.get_plan(db, plan_id)


@router.put("/{plan_id}", response_model=PlanOut)
def update_plan(plan_id: uuid.UUID, body: PlanUpdate, db: DbSession, user: Writer) -> Plan:
    plan = plan_service.get_plan(db, plan_id)
    return plan_service.update_plan(db, plan, body, user)


@router.delete("/{plan_id}", status_code=204)
def archive_plan(plan_id: uuid.UUID, db: DbSession, user: Writer) -> Response:
    plan = plan_service.get_plan(db, plan_id)
    plan_service.archive_plan(db, plan, user)
    return Response(status_code=204)


@router.post("/{plan_id}/apply", response_model=NodeDetail)
def apply_plan(plan_id: uuid.UUID, body: PlanApply, db: DbSession, user: Writer) -> NodeDetail:
    plan = plan_service.get_plan(db, plan_id)
    box = db.get(Node, body.node_id)
    if box is None:
        raise not_found("Élément")
    box = plan_service.apply_plan(db, plan, box, body.node_version, user)
    return node_service.detail(db, box)
