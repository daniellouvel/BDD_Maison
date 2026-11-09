"""Identification assistée : lecture du texte, références de composants, identification externe,
recherche par photo. Rien n'est écrit dans le catalogue : les résultats sont des suggestions
(`ai_suggestions`) que l'utilisateur applique ou non dans le formulaire."""

import logging
import re
import uuid
from urllib.parse import quote

import numpy as np
from fastapi.encoders import jsonable_encoder
from PIL import Image
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.ai import registry
from app.ai.base import AiUnavailable
from app.core.db import get_session_factory
from app.core.errors import ApiError, not_found
from app.models import (
    AiSuggestion,
    AppSetting,
    Article,
    Attachment,
    Category,
    ImageEmbedding,
    Node,
    User,
    utcnow,
)
from app.schemas import (
    AiStatus,
    AnalysisOut,
    ArticleOut,
    IdentificationOut,
    PartReference,
    SimilarHit,
    SuggestionDecision,
)
from app.services import files as file_service
from app.services.common import get_active, like_escape

log = logging.getLogger(__name__)

SETTINGS_KEY = "ai"
MAX_REFERENCES = 8
SIMILAR_MIN_SCORE = 0.75
SIMILAR_LIMIT = 8

# --- Réglages ----------------------------------------------------------------------------------


def remote_enabled(db: Session) -> bool:
    setting = db.get(AppSetting, SETTINGS_KEY)
    return bool(setting and setting.value.get("remote_enabled"))


def set_remote_enabled(db: Session, enabled: bool) -> None:
    if enabled and registry.identifier() is None:
        raise ApiError(
            409,
            "ai_remote_not_configured",
            "Aucun service d'identification n'est configuré sur le serveur.",
        )
    setting = db.get(AppSetting, SETTINGS_KEY)
    if setting is None:
        db.add(AppSetting(key=SETTINGS_KEY, value={"remote_enabled": enabled}))
    else:
        setting.value = {**setting.value, "remote_enabled": enabled}
    db.commit()


def status(db: Session) -> AiStatus:
    return AiStatus(
        ocr=registry.ocr().available(),
        embeddings=registry.embedder() is not None,
        remote_configured=registry.identifier() is not None,
        remote_enabled=remote_enabled(db) and registry.identifier() is not None,
        remote_host=registry.remote_host(),
    )


# --- Références de composants ------------------------------------------------------------------

_TOKEN = re.compile(r"[A-Z0-9][A-Z0-9\-/.]{2,23}")
_UNIT = re.compile(
    r"^\d+([.,]\d+)?(V|VAC|VDC|A|MA|MAH|AH|W|KW|MM|CM|M|KG|G|HZ|KHZ|MHZ|GHZ|K|R|UF|NF|PF|F|OHM|DB|C)$"
)
_DATE = re.compile(r"^\d{1,4}([-/.]\d{1,4}){1,2}$")


def extract_references(text: str) -> list[str]:
    """Repère les références probables (LM317T, 1N4007, ATMEGA328P-PU…) dans le texte lu :
    au moins une lettre et deux chiffres, hors valeurs avec unité (220V, 10UF) et dates."""
    found: list[str] = []
    for raw in _TOKEN.findall(text.upper()):
        token = raw.strip("-/.")
        if len(token) < 4 or token in found:
            continue
        letters = sum(c.isalpha() for c in token)
        digits = sum(c.isdigit() for c in token)
        if letters < 1 or digits < 2 or _UNIT.match(token) or _DATE.match(token):
            continue
        found.append(token)
        if len(found) == MAX_REFERENCES:
            break
    return found


def datasheet_url(reference: str) -> str:
    return f"https://octopart.com/search?q={quote(reference)}"


def articles_for_reference(db: Session, reference: str, limit: int = 5) -> list[Article]:
    pattern = f"%{like_escape(reference)}%"
    compact = func.upper(func.replace(Article.mpn, " ", ""))
    stmt = (
        select(Article)
        .where(
            Article.archived_at.is_(None),
            or_(compact == reference, Article.mpn.ilike(pattern), Article.name.ilike(pattern)),
        )
        .order_by((compact == reference).desc(), func.lower(Article.name))
        .limit(limit)
    )
    return list(db.scalars(stmt))


def part_references(db: Session, text: str) -> list[PartReference]:
    return [
        PartReference(
            reference=ref,
            datasheet_url=datasheet_url(ref),
            matches=[ArticleOut.model_validate(a) for a in articles_for_reference(db, ref)],
        )
        for ref in extract_references(text)
    ]


# --- Empreintes visuelles ----------------------------------------------------------------------


def _normalized(vector: list[float]) -> np.ndarray:
    arr = np.asarray(vector, dtype=np.float32)
    norm = float(np.linalg.norm(arr))
    return arr / norm if norm > 0 else arr


def index_attachment(db: Session, attachment: Attachment) -> bool:
    """Calcule et enregistre l'empreinte d'une photo. Faux si l'IA est indisponible."""
    engine = registry.embedder()
    path = file_service.file_path(attachment)
    if engine is None or attachment.kind != "photo" or path is None or not path.exists():
        return False
    with Image.open(path) as img:
        vector = _normalized(engine.embed(img))
    row = db.get(ImageEmbedding, attachment.id)
    if row is None:
        row = ImageEmbedding(attachment_id=attachment.id)
        db.add(row)
    row.model = engine.model
    row.vector = vector.tobytes()
    row.created_at = utcnow()
    db.commit()
    return True


def index_attachment_id(attachment_id: uuid.UUID) -> None:
    """Tâche de fond après l'envoi d'une photo : un échec ne doit jamais gêner l'utilisateur."""
    try:
        with get_session_factory()() as db:
            attachment = db.get(Attachment, attachment_id)
            if attachment is not None:
                index_attachment(db, attachment)
    except Exception:
        log.exception("Empreinte visuelle impossible pour la photo %s", attachment_id)


def index_missing(db: Session) -> tuple[int, int]:
    """(Ré)indexe les photos sans empreinte ou calculées avec un autre modèle. (faites, échecs)"""
    engine = registry.embedder()
    if engine is None:
        raise AiUnavailable("Recherche par photo indisponible (fastembed absent ou désactivé).")
    current = select(ImageEmbedding.attachment_id).where(ImageEmbedding.model == engine.model)
    todo = list(
        db.scalars(
            select(Attachment).where(Attachment.kind == "photo", Attachment.id.not_in(current))
        )
    )
    done = failed = 0
    for attachment in todo:
        try:
            if index_attachment(db, attachment):
                done += 1
        except Exception:
            db.rollback()
            failed += 1
            log.exception("Empreinte visuelle impossible pour la photo %s", attachment.id)
    return done, failed


def _similar(
    db: Session,
    query: np.ndarray,
    model: str,
    exclude_article: uuid.UUID | None = None,
    exclude_attachment: uuid.UUID | None = None,
    min_score: float = SIMILAR_MIN_SCORE,
    limit: int = SIMILAR_LIMIT,
) -> list[SimilarHit]:
    article_id = func.coalesce(Attachment.article_id, Node.article_id)
    rows = db.execute(
        select(ImageEmbedding.vector, Attachment.id, article_id)
        .join(Attachment, Attachment.id == ImageEmbedding.attachment_id)
        .outerjoin(Node, Node.id == Attachment.node_id)
        .where(ImageEmbedding.model == model, article_id.is_not(None))
    ).all()
    rows = [r for r in rows if r[2] != exclude_article and r[1] != exclude_attachment]
    if not rows:
        return []
    matrix = np.frombuffer(b"".join(r[0] for r in rows), dtype=np.float32).reshape(len(rows), -1)
    if matrix.shape[1] != query.shape[0]:
        return []
    scores = matrix @ query

    best: dict[uuid.UUID, tuple[float, uuid.UUID]] = {}
    for (_, att_id, art_id), score in zip(rows, scores, strict=True):
        if score >= min_score and (art_id not in best or score > best[art_id][0]):
            best[art_id] = (float(score), att_id)
    ranked = sorted(best.items(), key=lambda kv: kv[1][0], reverse=True)

    hits: list[SimilarHit] = []
    for art_id, (score, att_id) in ranked:
        article = db.get(Article, art_id)
        if article is None or article.archived_at is not None:
            continue
        hits.append(
            SimilarHit(article=ArticleOut.model_validate(article), score=round(score, 3), attachment_id=att_id)
        )
        if len(hits) == limit:
            break
    return hits


def search_by_image(db: Session, raw: bytes) -> list[SimilarHit]:
    engine = registry.embedder()
    if engine is None:
        raise ApiError(503, "ai_unavailable", "La recherche par photo n'est pas disponible sur ce serveur.")
    image = file_service.open_image(raw)
    try:
        query = _normalized(engine.embed(image))
    except AiUnavailable as exc:
        raise ApiError(503, "ai_unavailable", str(exc)) from exc
    return _similar(db, query, engine.model)


def similar_articles(db: Session, article_id: uuid.UUID) -> list[SimilarHit]:
    """Articles dont une photo ressemble à une photo de cet article (empreintes déjà calculées)."""
    get_active(db, Article, article_id, "Article")
    engine = registry.embedder()
    model = engine.model if engine else None
    own = db.execute(
        select(ImageEmbedding.vector, ImageEmbedding.model)
        .join(Attachment, Attachment.id == ImageEmbedding.attachment_id)
        .outerjoin(Node, Node.id == Attachment.node_id)
        .where(func.coalesce(Attachment.article_id, Node.article_id) == article_id)
    ).all()
    best: dict[uuid.UUID, SimilarHit] = {}
    for vector, row_model in own:
        if model is not None and row_model != model:
            continue
        for hit in _similar(
            db, np.frombuffer(vector, dtype=np.float32), row_model, exclude_article=article_id
        ):
            if hit.article.id not in best or hit.score > best[hit.article.id].score:
                best[hit.article.id] = hit
    return sorted(best.values(), key=lambda h: h.score, reverse=True)[:SIMILAR_LIMIT]


def warm_up() -> None:
    """Charge le modèle d'empreintes au démarrage (téléchargement au premier lancement)."""
    try:
        engine = registry.embedder()
        if engine is not None:
            engine.embed(Image.new("RGB", (32, 32)))
    except Exception:
        log.warning("Modèle de recherche par photo non chargé", exc_info=True)


# --- Analyse d'une photo -----------------------------------------------------------------------


def _category_names(db: Session) -> dict[str, uuid.UUID]:
    return {c.name: c.id for c in db.scalars(select(Category).order_by(Category.name))}


def analyze(db: Session, raw: bytes, *, identify: bool, actor: User) -> AnalysisOut:
    image = file_service.open_image(raw)
    providers: list[str] = []
    warnings: list[str] = []
    result = AnalysisOut(suggestion_id=uuid.uuid4())

    ocr = registry.ocr()
    if ocr.available():
        try:
            text = ocr.ocr(image).strip()
            providers.append(ocr.name)
            result.ocr_text = text or None
            result.parts = part_references(db, text) if text else []
        except AiUnavailable as exc:
            warnings.append(str(exc))

    engine = registry.embedder()
    if engine is not None:
        try:
            result.similar = _similar(db, _normalized(engine.embed(image)), engine.model)
            providers.append(engine.name)
        except AiUnavailable as exc:
            warnings.append(str(exc))

    if identify:
        identifier = registry.identifier()
        if identifier is None or not remote_enabled(db):
            warnings.append("L'identification externe n'est pas activée (réglages, administrateur).")
        else:
            categories = _category_names(db)
            try:
                found = identifier.identify(image, list(categories))
                providers.append(identifier.name)
                by_lower = {name.lower(): cid for name, cid in categories.items()}
                result.identification = IdentificationOut(
                    **found.__dict__,
                    category_id=by_lower.get((found.category or "").lower()),
                )
            except AiUnavailable as exc:
                warnings.append(str(exc))

    result.warnings = warnings
    suggestion = AiSuggestion(
        id=result.suggestion_id,
        providers=providers,
        result=jsonable_encoder(result.model_dump(exclude={"suggestion_id"})),
        status="pending",
        created_by=actor.id,
    )
    db.add(suggestion)
    db.commit()
    return result


def decide(db: Session, suggestion_id: uuid.UUID, decision: SuggestionDecision, actor: User) -> None:
    suggestion = db.get(AiSuggestion, suggestion_id, with_for_update=True)
    if suggestion is None:
        raise not_found("Suggestion")
    if suggestion.created_by != actor.id and actor.role != "admin":
        raise ApiError(403, "forbidden", "Cette suggestion appartient à un autre utilisateur.")
    if suggestion.status != "pending":
        raise ApiError(409, "already_decided", "Cette suggestion a déjà été traitée.")
    if decision.article_id is not None:
        get_active(db, Article, decision.article_id, "Article")
    suggestion.status = decision.status
    suggestion.article_id = decision.article_id
    suggestion.decided_at = utcnow()
    db.commit()
