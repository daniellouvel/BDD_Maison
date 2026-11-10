import uuid

from fastapi import APIRouter, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, DbSession, Writer
from app.core.errors import ApiError
from app.models import PricePoint, Supplier, SupplierOffer
from app.schemas import (
    OfferIn,
    OfferOut,
    PriceIn,
    PriceOut,
    PurchaseIn,
    PurchaseOut,
    PurchasePatch,
    ReceiveIn,
    SupplierIn,
    SupplierOut,
    SupplierPatch,
)
from app.services import purchases as service
from app.services.common import get_active

router = APIRouter(tags=["achats"])


# --- Fournisseurs -------------------------------------------------------------------------------


@router.get("/suppliers", response_model=list[SupplierOut])
def list_suppliers(db: DbSession, _: CurrentUser) -> list[Supplier]:
    return service.list_suppliers(db)


@router.post("/suppliers", response_model=SupplierOut, status_code=201)
def create_supplier(body: SupplierIn, db: DbSession, user: Writer) -> Supplier:
    return service.create_supplier(db, body, user)


@router.get("/suppliers/{supplier_id}", response_model=SupplierOut)
def get_supplier(supplier_id: uuid.UUID, db: DbSession, _: CurrentUser) -> Supplier:
    return get_active(db, Supplier, supplier_id, "Fournisseur")


@router.patch("/suppliers/{supplier_id}", response_model=SupplierOut)
def update_supplier(supplier_id: uuid.UUID, body: SupplierPatch, db: DbSession, user: Writer) -> Supplier:
    supplier = get_active(db, Supplier, supplier_id, "Fournisseur")
    return service.update_supplier(db, supplier, body, user)


@router.delete("/suppliers/{supplier_id}", status_code=204)
def archive_supplier(supplier_id: uuid.UUID, db: DbSession, user: Writer) -> Response:
    supplier = get_active(db, Supplier, supplier_id, "Fournisseur")
    service.archive_supplier(db, supplier, user)
    return Response(status_code=204)


# --- Offres et prix -----------------------------------------------------------------------------


@router.get("/articles/{article_id}/offers", response_model=list[OfferOut])
def list_offers(article_id: uuid.UUID, db: DbSession, _: CurrentUser) -> list[dict]:
    return [service.offer_view(db, offer) for offer in service.list_offers(db, article_id)]


@router.post("/articles/{article_id}/offers", response_model=OfferOut, status_code=201)
def create_offer(article_id: uuid.UUID, body: OfferIn, db: DbSession, user: Writer) -> dict:
    offer = service.create_offer(db, article_id, body, user)
    return service.offer_view(db, offer)


def _offer(db: Session, offer_id: uuid.UUID) -> SupplierOffer:
    offer = db.get(SupplierOffer, offer_id)
    if offer is None:
        raise ApiError(404, "not_found", "Offre introuvable")
    return offer


@router.get("/offers/{offer_id}/prices", response_model=list[PriceOut])
def list_prices(offer_id: uuid.UUID, db: DbSession, _: CurrentUser) -> list[PricePoint]:
    return service.list_prices(db, _offer(db, offer_id))


@router.post("/offers/{offer_id}/prices", response_model=PriceOut, status_code=201)
def add_price(offer_id: uuid.UUID, body: PriceIn, db: DbSession, user: Writer) -> PricePoint:
    return service.add_price(db, _offer(db, offer_id), body, user)


# --- Liste de courses ---------------------------------------------------------------------------


@router.get("/purchases", response_model=list[PurchaseOut])
def list_purchases(
    db: DbSession,
    _: CurrentUser,
    status: str | None = Query(default=None, pattern="^(to_buy|ordered|received|cancelled)$"),
) -> list[dict]:
    return [service.purchase_view(db, item) for item in service.list_purchases(db, status)]


@router.post("/purchases", response_model=PurchaseOut, status_code=201)
def create_purchase(body: PurchaseIn, db: DbSession, user: Writer) -> dict:
    return service.purchase_view(db, service.create_purchase(db, body, user))


@router.patch("/purchases/{purchase_id}", response_model=PurchaseOut)
def update_purchase(purchase_id: uuid.UUID, body: PurchasePatch, db: DbSession, user: Writer) -> dict:
    return service.purchase_view(db, service.update_purchase(db, purchase_id, body, user))


@router.post("/purchases/{purchase_id}/receive", response_model=PurchaseOut)
def receive_purchase(purchase_id: uuid.UUID, body: ReceiveIn, db: DbSession, user: Writer) -> dict:
    return service.purchase_view(db, service.receive_purchase(db, purchase_id, body, user))
