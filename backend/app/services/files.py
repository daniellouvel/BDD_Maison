import hashlib
import io
import uuid
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models import Article, Attachment, Node, User
from app.schemas import AttachmentPatch
from app.services.common import audit, get_active

PHOTO_MAX_SIDE = 2048
THUMB_MAX_SIDE = 512
PDF_MAGIC = b"%PDF-"


def files_dir() -> Path:
    path = get_settings().data_dir / "files"
    path.mkdir(parents=True, exist_ok=True)
    return path


def thumbs_dir() -> Path:
    path = get_settings().data_dir / "thumbs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _flatten_to_rgb(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return img.convert("RGB")


def open_image(raw: bytes) -> Image.Image:
    """Image RGB redressée selon l'EXIF, réduite à PHOTO_MAX_SIDE. 422 si illisible."""
    try:
        Image.open(io.BytesIO(raw)).verify()
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)
        img = _flatten_to_rgb(img)
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ApiError(422, "invalid_image", "Image illisible ou format non pris en charge.") from exc
    img.thumbnail((PHOTO_MAX_SIDE, PHOTO_MAX_SIDE))
    return img


def process_photo(raw: bytes) -> tuple[bytes, bytes]:
    """Retourne (photo, miniature) en JPEG. Supprime l'EXIF (position GPS, etc.)."""
    img = open_image(raw)

    photo_buf = io.BytesIO()
    img.save(photo_buf, format="JPEG", quality=88)

    thumb = img.copy()
    thumb.thumbnail((THUMB_MAX_SIDE, THUMB_MAX_SIDE))
    thumb_buf = io.BytesIO()
    thumb.save(thumb_buf, format="JPEG", quality=82)
    return photo_buf.getvalue(), thumb_buf.getvalue()


def _owner(db: Session, article_id: uuid.UUID | None, node_id: uuid.UUID | None) -> tuple[str, object]:
    if (article_id is None) == (node_id is None):
        raise ApiError(422, "single_owner", "Un fichier se rattache à un article OU à un élément.")
    if article_id is not None:
        return "article", get_active(db, Article, article_id, "Article")
    return "node", get_active(db, Node, node_id, "Élément")


def add_photo(
    db: Session,
    *,
    raw: bytes,
    article_id: uuid.UUID | None,
    node_id: uuid.UUID | None,
    title: str | None,
    actor: User,
) -> Attachment:
    _owner(db, article_id, node_id)
    photo, thumb = process_photo(raw)
    key = uuid.uuid4()
    (files_dir() / f"{key}.jpg").write_bytes(photo)
    (thumbs_dir() / f"{key}.jpg").write_bytes(thumb)
    attachment = Attachment(
        article_id=article_id,
        node_id=node_id,
        kind="photo",
        title=title,
        storage_key=f"{key}.jpg",
        thumb_key=f"{key}.jpg",
        mime="image/jpeg",
        size=len(photo),
        sha256=hashlib.sha256(photo).hexdigest(),
    )
    # La première photo d'un propriétaire en est la photo principale.
    has_main = db.scalar(
        select(Attachment.id).where(
            Attachment.kind == "photo",
            Attachment.is_main.is_(True),
            Attachment.article_id == article_id if article_id is not None else Attachment.node_id == node_id,
        )
    )
    attachment.is_main = has_main is None
    db.add(attachment)
    db.flush()
    audit(db, "attachment", attachment, actor, "create")
    db.commit()
    db.refresh(attachment)
    return attachment


def add_pdf(
    db: Session,
    *,
    kind: str,
    raw: bytes,
    article_id: uuid.UUID | None,
    node_id: uuid.UUID | None,
    title: str | None,
    actor: User,
) -> Attachment:
    _owner(db, article_id, node_id)
    if not raw.startswith(PDF_MAGIC):
        raise ApiError(422, "invalid_pdf", "Le fichier n'est pas un PDF valide.")
    key = uuid.uuid4()
    (files_dir() / f"{key}.pdf").write_bytes(raw)
    attachment = Attachment(
        article_id=article_id,
        node_id=node_id,
        kind=kind,
        title=title,
        storage_key=f"{key}.pdf",
        mime="application/pdf",
        size=len(raw),
        sha256=hashlib.sha256(raw).hexdigest(),
    )
    db.add(attachment)
    db.flush()
    audit(db, "attachment", attachment, actor, "create")
    db.commit()
    db.refresh(attachment)
    return attachment


def add_link(
    db: Session,
    *,
    url: str,
    article_id: uuid.UUID | None,
    node_id: uuid.UUID | None,
    title: str | None,
    actor: User,
    link_type: str | None = None,
) -> Attachment:
    _owner(db, article_id, node_id)
    if not url.startswith(("https://", "http://")):
        raise ApiError(422, "invalid_url", "Le lien doit commencer par http:// ou https://.")
    attachment = Attachment(
        article_id=article_id,
        node_id=node_id,
        kind="link",
        title=title,
        url=url,
        link_type=link_type,
    )
    db.add(attachment)
    db.flush()
    audit(db, "attachment", attachment, actor, "create")
    db.commit()
    db.refresh(attachment)
    return attachment


def list_for(
    db: Session, article_id: uuid.UUID | None, node_id: uuid.UUID | None
) -> list[Attachment]:
    stmt = select(Attachment).order_by(Attachment.is_main.desc(), Attachment.created_at.desc())
    if article_id is not None:
        stmt = stmt.where(Attachment.article_id == article_id)
    if node_id is not None:
        stmt = stmt.where(Attachment.node_id == node_id)
    return list(db.scalars(stmt))


def file_path(attachment: Attachment, thumb: bool = False) -> Path | None:
    if thumb:
        return thumbs_dir() / attachment.thumb_key if attachment.thumb_key else None
    return files_dir() / attachment.storage_key if attachment.storage_key else None


# --- Modification et suppression d'une pièce jointe ---------------------------------------------


def _same_owner(attachment: Attachment):  # type: ignore[no-untyped-def]
    if attachment.article_id is not None:
        return Attachment.article_id == attachment.article_id
    return Attachment.node_id == attachment.node_id


def update_attachment(db: Session, attachment_id: uuid.UUID, data: AttachmentPatch, actor: User) -> Attachment:
    attachment = db.get(Attachment, attachment_id)
    if attachment is None:
        raise ApiError(404, "not_found", "Fichier introuvable")
    fields = data.model_fields_set
    if "title" in fields:
        attachment.title = (data.title or "").strip() or None
    if attachment.kind == "link":
        if "url" in fields and data.url is not None:
            if not data.url.startswith(("https://", "http://")):
                raise ApiError(422, "invalid_url", "Le lien doit commencer par http:// ou https://.")
            attachment.url = data.url
        if "link_type" in fields:
            attachment.link_type = data.link_type
    if "is_main" in fields and data.is_main is not None:
        if attachment.kind != "photo":
            raise ApiError(422, "not_photo", "Seule une photo peut être la photo principale.")
        if data.is_main:
            for other in db.scalars(
                select(Attachment).where(_same_owner(attachment), Attachment.kind == "photo", Attachment.is_main.is_(True))
            ):
                other.is_main = False
        attachment.is_main = data.is_main
    audit(db, "attachment", attachment, actor, "update")
    db.commit()
    db.refresh(attachment)
    return attachment


def delete_attachment(db: Session, attachment_id: uuid.UUID, actor: User) -> None:
    """Supprime la pièce jointe et ses fichiers. Si c'était la photo principale, la suivante la devient."""
    attachment = db.get(Attachment, attachment_id)
    if attachment is None:
        raise ApiError(404, "not_found", "Fichier introuvable")
    was_main = attachment.kind == "photo" and attachment.is_main
    owner_filter = _same_owner(attachment)
    for path in (file_path(attachment), file_path(attachment, thumb=True)):
        if path is not None and path.exists():
            path.unlink()
    audit(db, "attachment", attachment, actor, "delete")
    db.delete(attachment)
    db.flush()
    if was_main:
        nxt = db.scalar(
            select(Attachment).where(owner_filter, Attachment.kind == "photo").order_by(Attachment.created_at)
        )
        if nxt is not None:
            nxt.is_main = True
    db.commit()
