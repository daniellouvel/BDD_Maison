"""Commandes d'administration : python -m app.cli create-user --username NOM --role admin"""

import argparse
import getpass
import sys

from sqlalchemy import select

from app.core.db import get_session_factory
from app.core.security import hash_password
from app.models import ROLES, User


def create_user(username: str, role: str) -> int:
    if role not in ROLES:
        print(f"Rôle invalide. Valeurs possibles : {', '.join(ROLES)}", file=sys.stderr)
        return 2
    password = getpass.getpass("Mot de passe : ")
    if len(password) < 12:
        print("Le mot de passe doit comporter au moins 12 caractères.", file=sys.stderr)
        return 2
    if password != getpass.getpass("Confirmation : "):
        print("Les mots de passe ne correspondent pas.", file=sys.stderr)
        return 2
    with get_session_factory()() as db:
        if db.scalar(select(User).where(User.username == username)):
            print("Cet utilisateur existe déjà.", file=sys.stderr)
            return 1
        db.add(User(username=username, password_hash=hash_password(password), role=role))
        db.commit()
    print(f"Utilisateur « {username} » créé ({role}).")
    return 0


def index_images() -> int:
    from app.ai.base import AiUnavailable
    from app.services import ai as ai_service

    with get_session_factory()() as db:
        try:
            done, failed = ai_service.index_missing(db)
        except AiUnavailable as exc:
            print(str(exc), file=sys.stderr)
            return 1
    print(f"Photos indexées : {done}, échecs : {failed}.")
    return 0 if failed == 0 else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="myworkshop")
    sub = parser.add_subparsers(dest="command", required=True)
    cu = sub.add_parser("create-user", help="Créer un utilisateur")
    cu.add_argument("--username", required=True)
    cu.add_argument("--role", default="membre", choices=ROLES)
    sub.add_parser(
        "index-images", help="Calculer les empreintes des photos (recherche par photo)"
    )
    args = parser.parse_args(argv)
    if args.command == "create-user":
        return create_user(args.username, args.role)
    if args.command == "index-images":
        return index_images()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
