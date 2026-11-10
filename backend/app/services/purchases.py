"""Fournisseurs, offres et prix, liste de courses.

Rien ici ne modifie le stock : la liste de courses ne crée ni mouvement ni objet. Seule la
réception range un article, en passant par la création d'objet ordinaire (`nodes.create`), qui
écrit le mouvement d'entrée.
"""

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError, conflict_version
from app.models import Article, Node, PricePoint, PurchaseItem, Supplier, SupplierOffer, User, utcnow
from app.schemas import (
    NodeIn,
    OfferIn,
    PriceIn,
    PurchaseIn,
    PurchasePatch,
    ReceiveIn,
    SupplierIn,
    SupplierPatch,
)
from app.services import nodes as node_service
from app.services.common import audit, get_active, snapshot

# Transitions de statut permises par la liste de courses. La réception passe par `receive`.
TRANSITIONS: dict[str, set[str]] = {
    "to_buy": {"ordered", "cancelled"},
    "ordered": {"cancelled"},
}


# --- Fournisseurs -------------------------------------------------------------------------------


def list_suppliers(db: Session) -> list[Supplier]:
    return list(db.scalars(select(Supplier).where(Supplier.archived_at.is_(None)).order_by(Supplier.name)))


def _name_taken(db: Session, name: str, exclude: uuid.UUID | None = None) -> bool:
    query = select(Supplier.id).where(func.lower(Supplier.name) == name.lower())
    if exclude is not None:
        query = query.where(Supplier.id != exclude)
    return db.scalar(query) is not None


def _clean_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise ApiError(422, "invalid_supplier", "Le fournisseur doit avoir un nom.")
    return cleaned


def create_supplier(db: Session, data: SupplierIn, actor: User) -> Supplier:
    name = _clean_name(data.name)
    if _name_taken(db, name):
        raise ApiError(409, "supplier_exists", "Un fournisseur porte déjà ce nom.")
    supplier = Supplier(name=name, url=(data.url or "").strip() or None, notes=(data.notes or "").strip() or None)
    db.add(supplier)
    db.flush()
    audit(db, "supplier", supplier, actor, "create")
    db.commit()
    db.refresh(supplier)
    return supplier


def update_supplier(db: Session, supplier: Supplier, data: SupplierPatch, actor: User) -> Supplier:
    if data.version != supplier.version:
        raise conflict_version()
    before = snapshot(supplier)
    if "name" in data.model_fields_set and data.name is not None:
        name = _clean_name(data.name)
        if _name_taken(db, name, exclude=supplier.id):
            raise ApiError(409, "supplier_exists", "Un fournisseur porte déjà ce nom.")
        supplier.name = name
    if "url" in data.model_fields_set:
        supplier.url = (data.url or "").strip() or None
    if "notes" in data.model_fields_set:
        supplier.notes = (data.notes or "").strip() or None
    supplier.version += 1
    supplier.updated_at = utcnow()
    audit(db, "supplier", supplier, actor, "update", before=before)
    db.commit()
    db.refresh(supplier)
    return supplier


def archive_supplier(db: Session, supplier: Supplier, actor: User) -> None:
    open_purchases = db.scalar(
        select(func.count(PurchaseItem.id))
        .join(SupplierOffer, PurchaseItem.offer_id == SupplierOffer.id)
        .where(SupplierOffer.supplier_id == supplier.id, PurchaseItem.status.in_(("to_buy", "ordered")))
    )
    if open_purchases:
        raise ApiError(
            409,
            "supplier_in_use",
            "Ce fournisseur est encore lié à des achats en cours. Annulez-les ou changez leur fournisseur.",
        )
    before = snapshot(supplier)
    supplier.archived_at = utcnow()
    supplier.version += 1
    audit(db, "supplier", supplier, actor, "delete", before=before)
    db.commit()


# --- Offres et prix -----------------------------------------------------------------------------


def _last_price(db: Session, offer: SupplierOffer) -> PricePoint | None:
    return db.scalar(
        select(PricePoint)
        .where(PricePoint.offer_id == offer.id)
        .order_by(PricePoint.observed_at.desc(), PricePoint.id.desc())
        .limit(1)
    )


def offer_view(db: Session, offer: SupplierOffer) -> dict[str, Any]:
    supplier = db.get(Supplier, offer.supplier_id)
    last = _last_price(db, offer)
    return {
        "id": offer.id,
        "article_id": offer.article_id,
        "supplier_id": offer.supplier_id,
        "supplier_name": supplier.name if supplier else "",
        "supplier_ref": offer.supplier_ref,
        "url": offer.url,
        "version": offer.version,
        "last_unit_price": last.unit_price if last else None,
        "last_currency": last.currency if last else None,
        "last_observed_at": last.observed_at if last else None,
    }


def list_offers(db: Session, article_id: uuid.UUID) -> list[SupplierOffer]:
    get_active(db, Article, article_id, "Article")
    return list(
        db.scalars(
            select(SupplierOffer)
            .where(SupplierOffer.article_id == article_id)
            .order_by(SupplierOffer.created_at)
        )
    )


def create_offer(db: Session, article_id: uuid.UUID, data: OfferIn, actor: User) -> SupplierOffer:
    get_active(db, Article, article_id, "Article")
    get_active(db, Supplier, data.supplier_id, "Fournisseur")
    taken = db.scalar(
        select(SupplierOffer.id).where(
            SupplierOffer.article_id == article_id, SupplierOffer.supplier_id == data.supplier_id
        )
    )
    if taken is not None:
        raise ApiError(409, "offer_exists", "Cet article est déjà proposé par ce fournisseur.")
    offer = SupplierOffer(
        article_id=article_id,
        supplier_id=data.supplier_id,
        supplier_ref=(data.supplier_ref or "").strip() or None,
        url=(data.url or "").strip() or None,
        version=1,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(offer)
    db.flush()
    audit(db, "supplier_offer", offer, actor, "create")
    db.commit()
    db.refresh(offer)
    return offer


def list_prices(db: Session, offer: SupplierOffer) -> list[PricePoint]:
    return list(
        db.scalars(
            select(PricePoint)
            .where(PricePoint.offer_id == offer.id)
            .order_by(PricePoint.observed_at.desc(), PricePoint.id.desc())
        )
    )


def add_price(db: Session, offer: SupplierOffer, data: PriceIn, actor: User, source: str = "manual") -> PricePoint:
    point = PricePoint(
        offer_id=offer.id,
        unit_price=data.unit_price,
        currency=data.currency.upper(),
        observed_at=data.observed_at or utcnow(),
        source=source,
        created_by=actor.id,
    )
    db.add(point)
    db.flush()
    audit(db, "price_point", point, actor, "create")
    db.commit()
    db.refresh(point)
    return point


# --- Liste de courses ---------------------------------------------------------------------------


def purchase_view(db: Session, item: PurchaseItem) -> dict[str, Any]:
    article = db.get(Article, item.article_id) if item.article_id else None
    supplier_name = None
    if item.offer_id:
        offer = db.get(SupplierOffer, item.offer_id)
        supplier = db.get(Supplier, offer.supplier_id) if offer else None
        supplier_name = supplier.name if supplier else None
    return {
        "id": item.id,
        "label": item.label,
        "article_id": item.article_id,
        "article_name": article.name if article else None,
        "offer_id": item.offer_id,
        "supplier_name": supplier_name,
        "quantity": item.quantity,
        "unit_price": item.unit_price,
        "status": item.status,
        "received_node_id": item.received_node_id,
        "version": item.version,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def list_purchases(db: Session, status: str | None = None) -> list[PurchaseItem]:
    query = select(PurchaseItem).order_by(PurchaseItem.created_at.desc())
    if status:
        query = query.where(PurchaseItem.status == status)
    return list(db.scalars(query))


def _check_offer(db: Session, offer_id: uuid.UUID | None, article_id: uuid.UUID | None) -> None:
    if offer_id is None:
        return
    offer = db.get(SupplierOffer, offer_id)
    if offer is None:
        raise ApiError(404, "not_found", "Offre introuvable")
    if article_id is not None and offer.article_id != article_id:
        raise ApiError(422, "invalid_offer", "Cette offre ne concerne pas cet article.")


def create_purchase(db: Session, data: PurchaseIn, actor: User) -> PurchaseItem:
    label = data.label.strip()
    article = None
    if data.article_id is not None:
        article = get_active(db, Article, data.article_id, "Article")
        label = label or article.name
    if not label:
        raise ApiError(422, "purchase_label_required", "Donnez un libellé ou choisissez un article.")
    _check_offer(db, data.offer_id, data.article_id)
    item = PurchaseItem(
        label=label,
        article_id=article.id if article else None,
        offer_id=data.offer_id,
        quantity=data.quantity,
        unit_price=data.unit_price,
        status="to_buy",
        version=1,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(item)
    db.flush()
    audit(db, "purchase_item", item, actor, "create")
    db.commit()
    db.refresh(item)
    return item


def _get_purchase(db: Session, item_id: uuid.UUID) -> PurchaseItem:
    item = db.get(PurchaseItem, item_id)
    if item is None:
        raise ApiError(404, "not_found", "Achat introuvable")
    return item


def update_purchase(db: Session, item_id: uuid.UUID, data: PurchasePatch, actor: User) -> PurchaseItem:
    item = _get_purchase(db, item_id)
    if data.version != item.version:
        raise conflict_version()
    if item.status in ("received", "cancelled"):
        raise ApiError(409, "purchase_closed", "Cet achat est terminé et ne peut plus être modifié.")
    fields = data.model_fields_set
    before = snapshot(item)

    if "label" in fields and data.label is not None:
        label = data.label.strip()
        if not label:
            raise ApiError(422, "purchase_label_required", "Le libellé ne peut pas être vide.")
        item.label = label
    if "quantity" in fields and data.quantity is not None:
        item.quantity = data.quantity
    if "unit_price" in fields:
        item.unit_price = data.unit_price
    if "offer_id" in fields:
        _check_offer(db, data.offer_id, item.article_id)
        item.offer_id = data.offer_id

    if "status" in fields and data.status is not None and data.status != item.status:
        if data.status == "received":
            raise ApiError(422, "use_receive", "Pour marquer un achat reçu, utilisez la réception.")
        if data.status not in TRANSITIONS.get(item.status, set()):
            raise ApiError(409, "invalid_transition", f"Passage de « {item.status} » à « {data.status} » impossible.")
        item.status = data.status
        # Commander à un prix connu enregistre ce prix dans l'historique de l'offre.
        if data.status == "ordered" and item.offer_id and item.unit_price:
            db.add(
                PricePoint(
                    offer_id=item.offer_id,
                    unit_price=item.unit_price,
                    currency="EUR",
                    observed_at=utcnow(),
                    source="order",
                    created_by=actor.id,
                )
            )

    item.version += 1
    item.updated_at = utcnow()
    audit(db, "purchase_item", item, actor, "update", before=before)
    db.commit()
    db.refresh(item)
    return item


def receive_purchase(db: Session, item_id: uuid.UUID, data: ReceiveIn, actor: User) -> PurchaseItem:
    """Range l'article reçu dans l'emplacement choisi, puis clôt la ligne.

    Le rangement passe par `nodes.create` (mouvement d'entrée). Ce sont deux transactions : si
    la seconde échouait, l'objet serait rangé et la ligne resterait à commander ; le cas est
    improbable et se corrige en annulant la ligne après vérification du rangement.
    """
    item = _get_purchase(db, item_id)
    if data.version != item.version:
        raise conflict_version()
    if item.status not in ("to_buy", "ordered"):
        raise ApiError(409, "invalid_transition", "Cet achat ne peut pas être reçu dans son état actuel.")
    if item.article_id is None:
        raise ApiError(422, "article_required", "Liez un article à cet achat avant de le recevoir.")
    location = db.get(Node, data.node_id)
    if location is None or location.archived_at is not None:
        raise ApiError(404, "not_found", "Emplacement introuvable")

    stored = node_service.create(
        db,
        NodeIn(kind="item", parent_id=location.id, article_id=item.article_id, quantity=item.quantity),
        actor,
    )
    before = snapshot(item)
    item.status = "received"
    item.received_node_id = stored.id
    item.version += 1
    item.updated_at = utcnow()
    audit(db, "purchase_item", item, actor, "update", before=before)
    db.commit()
    db.refresh(item)
    return item
