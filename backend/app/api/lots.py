import uuid

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession, Writer
from app.models import Node
from app.schemas import LendIn, LoanOut, NodeOut, RemoveIn, StockValueOut
from app.services import lots as service

router = APIRouter(tags=["stock"])


@router.post("/nodes/{node_id}/loan", response_model=LoanOut, status_code=201)
def lend(node_id: uuid.UUID, body: LendIn, db: DbSession, user: Writer) -> dict:
    node = service.item(db, node_id)
    return service.loan_view(db, service.lend(db, node, body, user))


@router.post("/nodes/{node_id}/return", response_model=LoanOut)
def give_back(node_id: uuid.UUID, db: DbSession, user: Writer) -> dict:
    node = service.item(db, node_id)
    return service.loan_view(db, service.give_back(db, node, user))


@router.post("/nodes/{node_id}/remove", response_model=NodeOut)
def remove(node_id: uuid.UUID, body: RemoveIn, db: DbSession, user: Writer) -> Node:
    node = service.item(db, node_id)
    return service.remove(db, node, body, user)


@router.get("/loans", response_model=list[LoanOut])
def list_loans(
    db: DbSession,
    _: CurrentUser,
    open: bool = Query(default=False),  # noqa: A002 - nom imposé par l'URL ?open=true
) -> list[dict]:
    return [service.loan_view(db, loan) for loan in service.list_loans(db, open_only=open)]


@router.get("/stock/value", response_model=StockValueOut)
def stock_value(db: DbSession, _: CurrentUser) -> dict:
    return service.stock_value(db)
