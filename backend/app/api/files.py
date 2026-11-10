import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile
from fastapi.responses import FileResponse, Response

from app.api.deps import CurrentUser, DbSession, Writer
from app.core.config import get_settings
from app.core.errors import ApiError, not_found
from app.models import Attachment
from app.schemas import AttachmentOut, AttachmentPatch
from app.services import ai as ai_service
from app.services import files as file_service

router = APIRouter(prefix="/attachments", tags=["fichiers"])

FILE_KINDS = {"photo", "datasheet", "document"}


def read_upload(upload: UploadFile) -> bytes:
    limit = get_settings().max_upload_bytes
    raw = upload.file.read(limit + 1)
    if len(raw) > limit:
        raise ApiError(413, "file_too_large", "Fichier trop volumineux.")
    return raw


@router.post("", response_model=AttachmentOut, status_code=201)
def upload(
    db: DbSession,
    user: Writer,
    background: BackgroundTasks,
    kind: Annotated[str, Form()],
    article_id: Annotated[uuid.UUID | None, Form()] = None,
    node_id: Annotated[uuid.UUID | None, Form()] = None,
    title: Annotated[str | None, Form(max_length=200)] = None,
    url: Annotated[str | None, Form(max_length=2048)] = None,
    link_type: Annotated[str | None, Form(pattern="^(datasheet|depot|notice|fournisseur|autre)$")] = None,
    file: Annotated[UploadFile | None, File()] = None,
) -> Attachment:
    if kind == "link":
        if not url:
            raise ApiError(422, "url_required", "Un lien est requis.")
        return file_service.add_link(
            db, url=url, article_id=article_id, node_id=node_id, title=title, actor=user,
            link_type=link_type,
        )
    if kind not in FILE_KINDS:
        raise ApiError(422, "invalid_kind", "Type de fichier non pris en charge.")
    if file is None:
        raise ApiError(422, "file_required", "Un fichier est requis.")
    raw = read_upload(file)
    if kind == "photo":
        attachment = file_service.add_photo(
            db, raw=raw, article_id=article_id, node_id=node_id, title=title, actor=user
        )
        # Empreinte pour la recherche par photo, après la réponse (le modèle peut être lent).
        background.add_task(ai_service.index_attachment_id, attachment.id)
        return attachment
    return file_service.add_pdf(
        db, kind=kind, raw=raw, article_id=article_id, node_id=node_id, title=title, actor=user
    )


@router.patch("/{attachment_id}", response_model=AttachmentOut)
def patch_attachment(attachment_id: uuid.UUID, body: AttachmentPatch, db: DbSession, user: Writer) -> Attachment:
    return file_service.update_attachment(db, attachment_id, body, user)


@router.delete("/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: uuid.UUID, db: DbSession, user: Writer) -> Response:
    file_service.delete_attachment(db, attachment_id, user)
    return Response(status_code=204)


@router.get("", response_model=list[AttachmentOut])
def list_attachments(
    db: DbSession,
    _: CurrentUser,
    article_id: uuid.UUID | None = None,
    node_id: uuid.UUID | None = None,
) -> list[Attachment]:
    return file_service.list_for(db, article_id, node_id)


def _file_response(db: DbSession, attachment_id: uuid.UUID, thumb: bool) -> FileResponse:
    attachment = db.get(Attachment, attachment_id)
    if attachment is None:
        raise not_found("Fichier")
    path = file_service.file_path(attachment, thumb=thumb)
    if path is None or not path.exists():
        raise not_found("Fichier")
    media = "image/jpeg" if thumb else (attachment.mime or "application/octet-stream")
    return FileResponse(path, media_type=media, headers={"Cache-Control": "private, max-age=3600"})


@router.get("/{attachment_id}/file")
def get_file(attachment_id: uuid.UUID, db: DbSession, _: CurrentUser) -> FileResponse:
    return _file_response(db, attachment_id, thumb=False)


@router.get("/{attachment_id}/thumb")
def get_thumb(attachment_id: uuid.UUID, db: DbSession, _: CurrentUser) -> FileResponse:
    return _file_response(db, attachment_id, thumb=True)
