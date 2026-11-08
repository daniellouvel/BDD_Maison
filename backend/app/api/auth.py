from fastapi import APIRouter, Cookie, Response
from fastapi.responses import JSONResponse

from app.api.deps import COOKIE_NAME, CurrentUser, DbSession
from app.core.config import get_settings
from app.schemas import LoginIn, UserOut
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, db: DbSession) -> JSONResponse:
    user = auth_service.authenticate(db, body.username, body.password)
    token = auth_service.create_session(db, user)
    settings = get_settings()
    response = JSONResponse(UserOut.model_validate(user).model_dump(mode="json"))
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.session_ttl_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return response


@router.post("/logout", status_code=204)
def logout(db: DbSession, mw_session: str | None = Cookie(default=None)) -> Response:
    auth_service.delete_session(db, mw_session)
    response = Response(status_code=204)
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
