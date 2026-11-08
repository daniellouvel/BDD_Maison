# MyWorkshop

Inventaire auto-hébergé pour l'atelier et la maison : articles, stocks par boîte, emplacements
hiérarchiques, photos, recherche. Étiquettes QR, IA, projets et mode hors ligne arrivent dans les
phases suivantes (voir [docs/phase1-conception.md](docs/phase1-conception.md)).

## État

| Phase | Contenu | État |
|---|---|---|
| 1 | Conception | Validée |
| 2 | Socle : auth, catalogue, emplacements, stock, photos, recherche, déploiement | En cours |
| 3 | QR codes | À faire |
| 4 | IA | À faire |
| 5 | Projets, prêts, achats, hors ligne, accès distant | À faire |

## Développement local (Windows)

PostgreSQL tourne dans WSL (Ubuntu). WSL arrête sa machine virtuelle quand rien n'y tourne, ce qui
coupe PostgreSQL. Garder un terminal ouvert :

```bash
wsl -u root -e sh -c "service postgresql start; exec sleep infinity"
```

Backend (dans `backend/`, avec un fichier `.env` contenant `MW_DATABASE_URL`, `MW_COOKIE_SECURE=false`) :

```bash
py -3.13 -m venv .venv
.venv\Scripts\pip install -e .[dev]
.venv\Scripts\alembic upgrade head
.venv\Scripts\python -m app.cli create-user --username moi --role admin
.venv\Scripts\uvicorn app.main:app --reload
```

Frontend (dans `frontend/`, proxy `/api` vers `127.0.0.1:8000`) :

```bash
npm install
npm run dev
```

Tests (base dédiée, entièrement réinitialisée à chaque lancement) :

```bash
set MW_TEST_DATABASE_URL=postgresql+psycopg://myworkshop:MDP@127.0.0.1:5432/myworkshop_test
.venv\Scripts\python -m pytest
```

## Installation sur Proxmox

Voir [docs/installation.md](docs/installation.md).
