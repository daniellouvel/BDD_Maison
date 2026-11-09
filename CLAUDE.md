# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MyWorkshop : inventaire d'atelier auto-hébergé (FastAPI + PostgreSQL + PWA React). L'interface,
les messages d'erreur et la documentation sont en français. La conception de référence est
`docs/phase1-conception.md` ; la développer phase par phase et ne pas commencer une phase sans
validation de l'utilisateur.

## Commandes

Backend (`backend/`, venv Python 3.13 dans `backend/.venv`, config lue depuis `backend/.env`) :

```bash
.venv/Scripts/python -m pytest                       # tous les tests (requiert MW_TEST_DATABASE_URL)
.venv/Scripts/python -m pytest -k nom_du_test        # un seul test
.venv/Scripts/alembic upgrade head                   # migrations
.venv/Scripts/uvicorn app.main:app --reload          # API sur :8000
.venv/Scripts/python -m app.cli create-user --username X --role admin
```

Frontend (`frontend/`) : `npm run dev` (Vite :5173, proxy `/api` → :8000), `npm run build`
(inclut `tsc -b`, c'est la vérification de types).

`.claude/launch.json` définit `api` et `web` pour le navigateur intégré.

## Environnement local

- PostgreSQL 16 tourne dans WSL Ubuntu (la production cible PostgreSQL 17 sur Debian 13).
  WSL arrête sa VM quand rien n'y tourne, ce qui coupe PostgreSQL et donne des
  `ConnectionTimeout` après ~2 min. Avant les tests, lancer en arrière-plan :
  `wsl -u root -e sh -c "service postgresql start; exec sleep 1800"`.
- L'API lancée via `.claude/launch.json` n'a pas `--reload` : la redémarrer après une modification
  du backend.
- `backend/.env` (ignoré par Git) contient `MW_DATABASE_URL`, `MW_TEST_DATABASE_URL` et le mot de
  passe du compte de dev `dev`. Pytest ne lit pas `.env` : exporter `MW_TEST_DATABASE_URL` à la main.
- Les tests exécutent `alembic downgrade base` puis `upgrade head`, et vident toutes les tables après
  chaque test : ne jamais pointer `MW_TEST_DATABASE_URL` vers la base de dev.

## Architecture

- `app/api/` : routes fines ; `app/services/` : toutes les règles métier ; `app/models.py` : tables ;
  `app/schemas.py` : Pydantic. Les services lèvent `ApiError(status, code, message)`, convertie en
  JSON `{code, message}` par `main.py`. Les tests vérifient le `code`.
- **Un seul arbre `nodes`** pour tout ce qui est physique : `kind` = `location` | `container` |
  `item`. Un `item` est un lot (article + quantité) ; un article (`articles`) est une référence sans
  quantité. Le stock total d'un article est la somme de ses `item` actifs. Déplacer un nœud ne
  change que son `parent_id` : le contenu suit. Les objets ne peuvent pas contenir d'éléments.
- **Stock = mouvements** : toute variation de quantité passe par `services/stock.apply` (ou la
  création d'un `item`, qui écrit un mouvement `in`). Ne jamais modifier `nodes.quantity` autrement :
  la somme des `movements.delta` d'un nœud doit égaler sa quantité. Pour `out`/`consume`, le client
  envoie une quantité positive ; le service la rend négative. `op_id` rend un mouvement idempotent
  (préparation du mode hors ligne).
- **Concurrence optimiste** : `articles` et `nodes` ont une `version` ; les PATCH doivent envoyer
  la version lue, sinon 409 `version_conflict`. Dans un PATCH, la *présence* d'un champ compte
  (`model_fields_set`) : `parent_id: null` explicite = déplacer à la racine.
- **Rien n'est supprimé** : DELETE = archivage (`archived_at`), refusé si un nœud a du contenu ou du
  stock. Les modifications de fiches écrivent un `audit_log` (avant/après).
- **Étiquettes QR** (`services/qr.py`, `services/printing.py`) : une seule série `QR-000001…`. Une
  étiquette n'existe en base qu'à partir de sa première impression ; « Nouvelle planche » prend
  toujours `max(seq)+1` sous verrou consultatif PostgreSQL. Réimprimer un code existant exige
  `confirm_reprint`. Une étiquette affectée ou désactivée ne redevient jamais disponible sans
  l'action admin « réactiver ». Une étiquette par nœud au plus (`assigned_node_id` unique) ;
  `qr_events` garde tout l'historique. `parse_code` accepte `qr-1`, `QR1`, `QR-000001`. Le PDF est
  regénéré à la demande depuis `print_items` + le gabarit figé dans `print_sheets.layout`.
- Les tests QR décodent réellement la planche PDF (pymupdf + zxing-cpp) : si le rendu change,
  `test_printed_pdf_contains_65_readable_qr_codes` doit continuer de passer.
- Champs personnalisés : `field_defs` par catégorie, hérités des catégories parentes ; les valeurs
  sont dans `articles.attributes` (JSON) et validées par `services/catalog.validate_attributes`.
- Photos : ré-encodées en JPEG (EXIF supprimé) + miniature 512 px dans `MW_DATA_DIR`.
- Sécurité : cookie de session `mw_session` (HttpOnly, hash SHA-256 en base), mots de passe Argon2id,
  rôles `admin`/`membre`/`lecture`. Toute requête non-GET sous `/api/` doit porter l'en-tête
  `X-Requested-With` (protection CSRF) ; `frontend/src/api.ts` l'ajoute.
- Les quantités sont des `Numeric(12,3)` sérialisées en chaînes JSON (`"70.000"`).
- `useAuth` vit dans `src/auth.ts`, pas dans `App.tsx` : sinon le rechargement à chaud de Vite
  recrée le contexte et les écrans plantent avec « useAuth hors du AuthContext ».
- Le scanner (`components/Scanner.tsx`) utilise `BarcodeDetector` quand il existe, sinon jsQR, et
  propose toujours la saisie manuelle (le navigateur intégré n'a pas de caméra).
- Le frontend passe toujours par `src/api.ts` ; cette couche deviendra IndexedDB + file d'attente en
  phase 5, ne pas appeler `fetch` ailleurs (sauf `/health` pour l'indicateur de connexion).

## Migrations

Les migrations sont écrites à la main dans `backend/migrations/versions/` et doivent rester
identiques aux modèles (noms d'index `ix_<table>_<colonne>`, contraintes `ck_…`). Toute modification
de modèle demande une nouvelle migration avec `downgrade`.

## Déploiement

Installation native (sans Docker) dans un LXC Debian 13 : systemd + Caddy + PostgreSQL, voir
`docs/installation.md` et `deploy/`. Adresse : `https://daniel.ldns.fr` (domaine familial chez
OVH, enregistrement A vers l'IP locale, jamais exposé sur Internet). Le certificat vient de
certbot + `python3-certbot-dns-ovh` (paquets Debian) ; `deploy/certbot/deploy-hook.sh` le copie
dans `/etc/caddy/certs`, Caddy ne fait pas d'ACME. Ne jamais versionner `ovh.ini` (clés d'API). Les scripts `.sh` et les unités systemd doivent rester en fins
de ligne LF (`.gitattributes`).
