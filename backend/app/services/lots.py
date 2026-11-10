"""Statut des lots : prêt, retour, sortie du stock, valeur du stock.

Un prêt porte sur le lot entier : il ne touche pas au stock, seul le statut passe à « lent ».
Une sortie passe par un mouvement `out` de la quantité entière (règle « stock = mouvements »),
puis le statut passe à « removed ». Les deux écritures ne sont pas dans une même transaction
(même choix que la réception d'achat) : en cas de coupure, le lot reste à quantité nulle en stock.
"""

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Article, Loan, Node, PricePoint, SupplierOffer, User, utcnow
from app.schemas import LendIn, MovementIn, RemoveIn
from app.services import stock
from app.services.common import audit, get_active

ZERO = Decimal("0")


def item(db: Session, node_id: uuid.UUID) -> Node:
    node = get_active(db, Node, node_id, "Objet")
    if node.kind != "item":
        raise ApiError(422, "not_item", "Seuls les objets peuvent être prêtés ou sortis.")
    return node


def _check_version(node: Node, version: int) -> None:
    if node.version != version:
        raise ApiError(409, "version_conflict", "Ce lot a été modifié entre-temps : rechargez la fiche.")


def lend(db: Session, node: Node, data: LendIn, actor: User) -> Loan:
    _check_version(node, data.version)
    if node.status != "in_stock":
        raise ApiError(422, "item_not_in_stock", "Ce lot est déjà prêté ou sorti.")
    if not node.quantity or node.quantity <= 0:
        raise ApiError(422, "nothing_to_lend", "Ce lot n'a pas de quantité à prêter.")
    loan = Loan(
        node_id=node.id,
        recipient=data.recipient.strip(),
        quantity=node.quantity,
        due_at=data.due_at,
        notes=data.notes,
        actor_id=actor.id,
    )
    node.status = "lent"
    node.version += 1
    node.updated_at = utcnow()
    db.add(loan)
    audit(db, "node", node, actor, "lend")
    db.commit()
    db.refresh(loan)
    return loan


def give_back(db: Session, node: Node, actor: User) -> Loan:
    loan = db.scalar(select(Loan).where(Loan.node_id == node.id, Loan.returned_at.is_(None)))
    if node.status != "lent" or loan is None:
        raise ApiError(409, "not_lent", "Ce lot n'est pas prêté.")
    loan.returned_at = utcnow()
    node.status = "in_stock"
    node.version += 1
    node.updated_at = utcnow()
    audit(db, "node", node, actor, "return")
    db.commit()
    db.refresh(loan)
    return loan


def remove(db: Session, node: Node, data: RemoveIn, actor: User) -> Node:
    _check_version(node, data.version)
    if node.status == "removed":
        raise ApiError(409, "already_removed", "Ce lot est déjà sorti du stock.")
    if node.status == "lent":
        raise ApiError(422, "lent_out", "Ce lot est prêté : rendez-le avant de le sortir.")
    quantity = node.quantity or ZERO
    if quantity > 0:
        # Mouvement de sortie de la quantité entière (commit interne du service stock).
        stock.apply(
            db,
            MovementIn(node_id=node.id, kind="out", delta=quantity, reason=data.reason or "Sortie du stock"),
            actor,
        )
        db.refresh(node)
    node.status = "removed"
    node.version += 1
    node.updated_at = utcnow()
    audit(db, "node", node, actor, "remove")
    db.commit()
    db.refresh(node)
    return node


def list_loans(db: Session, open_only: bool) -> list[Loan]:
    stmt = select(Loan).order_by(Loan.out_at.desc())
    if open_only:
        stmt = stmt.where(Loan.returned_at.is_(None))
    return list(db.scalars(stmt))


def loan_view(db: Session, loan: Loan) -> dict:
    node = db.get(Node, loan.node_id)
    article = db.get(Article, node.article_id) if node and node.article_id else None
    return {
        "id": loan.id,
        "node_id": loan.node_id,
        "node_name": article.name if article else "Objet",
        "recipient": loan.recipient,
        "quantity": loan.quantity,
        "out_at": loan.out_at,
        "due_at": loan.due_at,
        "returned_at": loan.returned_at,
        "notes": loan.notes,
    }


def _latest_prices(db: Session, article_ids: set[uuid.UUID]) -> dict[uuid.UUID, Decimal]:
    """Dernier prix saisi pour chaque article, toutes offres confondues."""
    if not article_ids:
        return {}
    rows = db.execute(
        select(SupplierOffer.article_id, PricePoint.unit_price)
        .join(PricePoint, PricePoint.offer_id == SupplierOffer.id)
        .where(SupplierOffer.article_id.in_(article_ids))
        .order_by(PricePoint.observed_at.desc())
    ).all()
    latest: dict[uuid.UUID, Decimal] = {}
    for article_id, unit_price in rows:
        latest.setdefault(article_id, unit_price)
    return latest


def stock_value(db: Session) -> dict:
    """Valeur des lots en stock et des lots prêtés (quantité × dernier prix connu de l'article)."""
    lots = list(
        db.scalars(
            select(Node).where(
                Node.kind == "item",
                Node.archived_at.is_(None),
                Node.status.in_(["in_stock", "lent"]),
                Node.quantity > 0,
            )
        )
    )
    prices = _latest_prices(db, {lot.article_id for lot in lots})
    in_stock = ZERO
    lent = ZERO
    unpriced = 0
    for lot in lots:
        price = prices.get(lot.article_id)
        if price is None:
            unpriced += 1
            continue
        value = lot.quantity * price
        if lot.status == "lent":
            lent += value
        else:
            in_stock += value
    return {
        "currency": "EUR",
        "in_stock": in_stock,
        "lent": lent,
        "unpriced_lots": unpriced,
        "priced_lots": len(lots) - unpriced,
    }
