from typing import Annotated

from fastapi import Cookie, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ApiError
from app.models import User
from app.services.auth import user_from_token

COOKIE_NAME = "mw_session"
CSRF_HEADER = "X-Requested-With"


def current_user(
    db: Annotated[Session, Depends(get_db)],
    mw_session: Annotated[str | None, Cookie()] = None,
) -> User:
    user = user_from_token(db, mw_session)
    if user is None:
        raise ApiError(401, "unauthenticated", "Connexion requise.")
    return user


def require_writer(user: Annotated[User, Depends(current_user)]) -> User:
    if user.role == "lecture":
        raise ApiError(403, "forbidden", "Votre compte est en lecture seule.")
    return user


def require_admin(user: Annotated[User, Depends(current_user)]) -> User:
    if user.role != "admin":
        raise ApiError(403, "forbidden", "Réservé aux administrateurs.")
    return user


DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user)]
Writer = Annotated[User, Depends(require_writer)]
Admin = Annotated[User, Depends(require_admin)]
