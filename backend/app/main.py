import threading
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import text

from app.api import ai, auth, catalog, exchange, files, lots, nodes, plans, purchases, qr, search, stock, views
from app.api.deps import CSRF_HEADER
from app.core.db import get_session_factory
from app.core.errors import ApiError
from app.services import ai as ai_service

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Chargement du modèle de recherche par photo en arrière-plan : l'API répond tout de suite.
    threading.Thread(target=ai_service.warm_up, daemon=True, name="ai-warm-up").start()
    yield


app = FastAPI(
    title="MyWorkshop",
    version="0.4.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"code": exc.code, "message": exc.message})


@app.middleware("http")
async def csrf_guard(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    # Protection CSRF simple : un formulaire cross-site ne peut pas ajouter cet en-tête
    # personnalisé sans preflight CORS, qui n'est pas autorisé.
    if request.method in UNSAFE_METHODS and request.url.path.startswith("/api/"):
        if request.headers.get(CSRF_HEADER) is None:
            return JSONResponse(
                status_code=403,
                content={"code": "csrf", "message": f"En-tête {CSRF_HEADER} requis."},
            )
    return await call_next(request)


PREFIX = "/api/v1"
for router_module in (auth, catalog, nodes, plans, purchases, stock, lots, files, search, qr, ai, views, exchange):
    app.include_router(router_module.router, prefix=PREFIX)


@app.get(f"{PREFIX}/health")
def health() -> dict[str, str]:
    """Disponibilité du serveur (sans authentification). Utilisé par le client pour distinguer
    « pas d'Internet » de « serveur injoignable »."""
    with get_session_factory()() as session:
        session.execute(text("SELECT 1"))
    return {"status": "ok"}
