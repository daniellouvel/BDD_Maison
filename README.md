# MyWorkshop

Inventaire auto-hébergé pour l'atelier et la maison : articles, stocks par boîte, emplacements
hiérarchiques, photos, recherche, étiquettes QR universelles, identification assistée par IA.
Projets et mode hors ligne arrivent en phase 5 (voir [docs/phase1-conception.md](docs/phase1-conception.md)).

## IA (facultative, gratuite)

L'IA ne fait que **proposer** : rien n'est enregistré sans un clic, la saisie manuelle reste complète.

- **Sur le serveur** (rien ne sort de la maison) :
  - lecture du texte d'une photo (Tesseract), repérage des références de composants (`LM317T`,
    `1N4007`…), lien vers la datasheet et articles déjà en stock ;
  - recherche par photo et « objets ressemblants » (modèle CLIP local, CPU, ~340 Mo téléchargés au
    premier démarrage).
- **Identification par un service externe** (nommer l'objet, proposer catégorie, marque,
  description) : format compatible OpenAI, par exemple l'offre gratuite de Google Gemini.
  Désactivée par défaut ; un administrateur l'active dans **Accueil → Réglages**. Avec une offre
  gratuite, le service peut utiliser les photos pour entraîner ses modèles.

## Étiquettes QR

- Menu **Accueil → étiquettes QR** : générer une planche A4 de 65 étiquettes (PDF), finir une
  planche entamée (« commencer à la position »), réimprimer un code abîmé (avec confirmation).
- Avant la première vraie impression : régler le gabarit puis imprimer la **planche d'essai**
  (contours, aucun code consommé), à 100 % sans « ajuster à la page ».
- Par défaut le QR contient seulement le code (`QR-000001`) et se lit avec le scanner de
  l'application. `MW_QR_PUBLIC_URL=https://…` y met une URL ouvrable par l'appareil photo du
  téléphone ; à décider **avant** d'imprimer, car le contenu imprimé est définitif.
- La caméra exige HTTPS (ou `localhost`). Sans caméra, le code se saisit à la main.

## État

| Phase | Contenu | État |
|---|---|---|
| 1 | Conception | Validée |
| 2 | Socle : auth, catalogue, emplacements, stock, photos, recherche, déploiement | Fait |
| 3 | QR codes : planches de 65, doublons, affectation, déplacement par scan | Fait |
| 4 | IA : lecture du texte, références, recherche par photo, identification externe (opt-in) | Fait, tests réels à faire |
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
.venv\Scripts\pip install -e .[dev,ai]
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

Tesseract n'existe pas sous Windows dans cet environnement : l'installer dans WSL
(`apt install tesseract-ocr tesseract-ocr-fra`) et pointer `MW_AI_TESSERACT_CMD` (dans `.env`)
vers `backend/scripts/tesseract-wsl.cmd` (chemin absolu).

## Installation sur Proxmox

Voir [docs/installation.md](docs/installation.md).
