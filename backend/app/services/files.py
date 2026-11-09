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
    stmt = select(Attachment).order_by(Attachment.created_at.desc())
    if article_id is not None:
        stmt = stmt.where(Attachment.article_id == article_id)
    if node_id is not None:
        stmt = stmt.where(Attachment.node_id == node_id)
    return list(db.scalars(stmt))


def file_path(attachment: Attachment, thumb: bool = False) -> Path | None:
    if thumb:
        return thumbs_dir() / attachment.thumb_key if attachment.thumb_key else None
    return files_dir() / attachment.storage_key if attachment.storage_key else None
