class ApiError(Exception):
    """Erreur métier renvoyée au client sous forme JSON {code, message}."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def not_found(what: str) -> ApiError:
    return ApiError(404, "not_found", f"{what} introuvable")


def conflict_version() -> ApiError:
    return ApiError(
        409,
        "version_conflict",
        "Cet élément a été modifié entre-temps. Rechargez-le avant de réessayer.",
    )
