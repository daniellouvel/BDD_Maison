import datetime as dt
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.security import hash_password, hash_token, new_session_token, verify_password
from app.models import Session as UserSession
from app.models import User, utcnow


@lru_cache
def _dummy_hash() -> str:
    """Hash factice pour que les noms d'utilisateur inconnus prennent le même temps de vérification."""
    return hash_password("invalid-password-placeholder")


def authenticate(db: Session, username: str, password: str) -> User:
    user = db.scalar(select(User).where(User.username == username))
    if user is None:
        verify_password(_dummy_hash(), password)
        raise ApiError(401, "invalid_credentials", "Identifiant ou mot de passe incorrect.")
    if not verify_password(user.password_hash, password):
        raise ApiError(401, "invalid_credentials", "Identifiant ou mot de passe incorrect.")
    return user


def create_session(db: Session, user: User) -> str:
    token = new_session_token()
    expires = utcnow() + dt.timedelta(days=get_settings().session_ttl_days)
    db.add(UserSession(token_hash=hash_token(token), user_id=user.id, expires_at=expires))
    db.commit()
    return token


def user_from_token(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    session = db.get(UserSession, hash_token(token))
    if session is None or session.expires_at <= utcnow():
        return None
    return db.get(User, session.user_id)


def delete_session(db: Session, token: str | None) -> None:
    if not token:
        return
    session = db.get(UserSession, hash_token(token))
    if session is not None:
        db.delete(session)
        db.commit()
