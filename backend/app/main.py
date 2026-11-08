from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import text

from app.api import auth, catalog, files, nodes, search, stock
from app.api.deps import CSRF_HEADER
from app.core.db import get_session_factory
from app.core.errors import ApiError

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

app = FastAPI(title="MyWorkshop", version="0.2.0", docs_url="/api/docs", openapi_url="/api/openapi.json")


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
for router_module in (auth, catalog, nodes, stock, files, search):
    app.include_router(router_module.router, prefix=PREFIX)


@app.get(f"{PREFIX}/health")
def health() -> dict[str, str]:
    """Disponibilité du serveur (sans authentification). Utilisé par le client pour distinguer
    « pas d'Internet » de « serveur injoignable »."""
    with get_session_factory()() as session:
        session.execute(text("SELECT 1"))
    return {"status": "ok"}
