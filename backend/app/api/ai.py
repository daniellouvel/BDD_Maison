import uuid
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile

from app.api.deps import Admin, CurrentUser, DbSession, Writer
from app.api.files import read_upload
from app.schemas import AiSettingsIn, AiStatus, AnalysisOut, SimilarHit, SuggestionDecision
from app.services import ai as ai_service

router = APIRouter(tags=["ia"])


@router.get("/ai/status", response_model=AiStatus)
def ai_status(db: DbSession, _: CurrentUser) -> AiStatus:
    return ai_service.status(db)


@router.put("/ai/settings", response_model=AiStatus)
def ai_settings(body: AiSettingsIn, db: DbSession, _: Admin) -> AiStatus:
    ai_service.set_remote_enabled(db, body.remote_enabled)
    return ai_service.status(db)


@router.post("/ai/analyze", response_model=AnalysisOut)
def analyze(
    db: DbSession,
    user: Writer,
    file: Annotated[UploadFile, File()],
    identify: Annotated[bool, Form()] = False,
) -> AnalysisOut:
    """Lit le texte, repère les références, cherche les articles ressemblants et, si demandé et
    activé, interroge le service d'identification externe. N'écrit rien dans le catalogue."""
    return ai_service.analyze(db, read_upload(file), identify=identify, actor=user)


@router.post("/ai/suggestions/{suggestion_id}/decision", status_code=204)
def decide(suggestion_id: uuid.UUID, body: SuggestionDecision, db: DbSession, user: Writer) -> None:
    ai_service.decide(db, suggestion_id, body, user)


@router.post("/search/by-image", response_model=list[SimilarHit])
def search_by_image(db: DbSession, _: CurrentUser, file: Annotated[UploadFile, File()]) -> list[SimilarHit]:
    return ai_service.search_by_image(db, read_upload(file))


@router.get("/articles/{article_id}/similar", response_model=list[SimilarHit])
def similar(article_id: uuid.UUID, db: DbSession, _: CurrentUser) -> list[SimilarHit]:
    return ai_service.similar_articles(db, article_id)
