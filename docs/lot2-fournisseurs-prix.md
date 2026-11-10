# Lot 2 : fournisseurs, prix et liste de courses (proposition)

Statut : **schéma validé** le 2026-11-10. Les choix de la section 6 sont tranchés ci-dessous. Aucun code n'est encore écrit.

Décisions retenues (section 6) :
1. Prix saisis **TTC** (proposition retenue).
2. Liste de courses **globale**, avec `project_id` optionnel pour le lien projet.
3. Réception : **emplacement obligatoire** (proposition : cohérent avec « Ranger »).
4. Historique des prix en **tableau** seulement, pas de courbe pour l'instant.
5. Champ `url` : **lien seulement**, pas de vérification automatique.

Ce lot reprend les tables `purchase_items` et les fournisseurs prévus dans `docs/phase1-conception.md` (§5.2), sans en changer le principe : le stock reste dans `movements`, la liste de courses ne touche jamais au stock.

## 1. Objectif

- Savoir où acheter un article, à quel prix et avec quelle référence fournisseur.
- Garder l'historique des prix d'achat par article et par fournisseur.
- Préparer une liste de courses (ce qu'il faut acheter), puis la marquer commandée et reçue.
- À la réception, ranger les articles reçus : la réception crée un `item` (comme aujourd'hui) et ne crée aucun mouvement hors de cette règle.

## 2. Tables proposées

### `suppliers`
| Colonne | Type | Remarque |
|---|---|---|
| `id` | uuid PK | |
| `name` | text, unique (insensible à la casse) | ex. « Amazon », « Leroy Merlin » |
| `url` | text, null | site d'accueil |
| `notes` | text, null | |
| `version` | int | concurrence optimiste |
| `created_at`, `updated_at`, `archived_at` | timestamptz | archivage, pas de suppression |

### `supplier_offers` (référence d'un article chez un fournisseur)
| Colonne | Type | Remarque |
|---|---|---|
| `id` | uuid PK | |
| `article_id` | FK `articles`, index | |
| `supplier_id` | FK `suppliers`, index | |
| `supplier_ref` | text, null | référence chez le fournisseur |
| `url` | text, null | page produit |
| `version`, `archived_at`, timestamps | | |

Contrainte : une seule offre active par couple (`article_id`, `supplier_id`), index unique partiel sur `archived_at IS NULL`.

### `price_points` (historique des prix)
| Colonne | Type | Remarque |
|---|---|---|
| `id` | uuid PK | |
| `offer_id` | FK `supplier_offers`, index | |
| `unit_price` | numeric(12,4) | prix HT ou TTC : à trancher (§6) |
| `currency` | char(3), défaut `EUR` | |
| `quantity_basis` | numeric(12,3), défaut 1 | le prix porte sur combien d'unités |
| `observed_at` | timestamptz | date de la saisie ou de la commande |
| `source` | text | `manual` ou `order` |
| `created_by` | FK `users`, null | |

Un prix n'est jamais modifié, on ajoute un point. Le « prix courant » est le dernier point de l'offre.

### `purchase_items` (liste de courses)
Reprend la table prévue, avec les colonnes précisées :
| Colonne | Type | Remarque |
|---|---|---|
| `id` | uuid PK | |
| `label` | text | libellé libre si pas d'article |
| `article_id` | FK `articles`, null | |
| `offer_id` | FK `supplier_offers`, null | fournisseur retenu |
| `quantity` | numeric(12,3) | |
| `unit_price` | numeric(12,4), null | prix indicatif au moment de l'ajout |
| `project_id` | FK `projects`, null | lien avec un projet (déjà prévu) |
| `status` | enum `to_buy` / `ordered` / `received` / `cancelled` | |
| `received_node_id` | FK `nodes`, null | emplacement où l'article a été rangé |
| `version`, timestamps | | |

Contrainte `ck_purchase_items_label_or_article` : `label` non vide ou `article_id` renseigné.

## 3. Règles métier

1. **Stock intact** : la liste de courses ne crée aucun `movement` ni `item`. Seule la réception crée un `item` (flux « Ranger » existant) avec `movement` `in`.
2. **Réception** : passer à `received` exige un emplacement (`received_node_id`) ; l'article est rangé via le service de création d'`item` existant. Si l'article n'existe pas, on demande de le créer d'abord.
3. **Prix** : un point de prix est ajouté à chaque commande passée (`source = order`) et à la saisie manuelle. Jamais de modification d'un point existant.
4. **Annulation** : `cancelled` est un état final, la ligne reste visible dans l'historique.
5. **Archivage** : un fournisseur avec des offres actives ne peut pas être archivé (même logique que les contenants).

## 4. API proposée

| Méthode | Route | Rôle |
|---|---|---|
| GET/POST | `/suppliers` | liste, création |
| GET/PATCH/DELETE | `/suppliers/{id}` | détail, modification, archivage |
| GET/POST | `/articles/{id}/offers` | offres d'un article, ajout |
| POST | `/offers/{id}/prices` | ajouter un point de prix |
| GET | `/offers/{id}/prices` | historique |
| GET/POST | `/purchases` | liste de courses (filtres par statut, fournisseur, projet) |
| PATCH | `/purchases/{id}` | statut, quantité, prix (version obligatoire) |
| POST | `/purchases/{id}/receive` | réception : crée l'`item` et passe à `received` |

## 5. Écrans proposés

- **Fournisseurs** : liste simple et fiche (nom, site, notes).
- **Fiche article** : nouvel onglet « Achats » avec offres, prix courant, historique (tableau, sans graphique au départ).
- **Liste de courses** : tableau regroupé par fournisseur, actions « Commander », « Reçu → ranger », « Annuler ». Accessible depuis le menu de gauche.
- Pas d'écran téléphone pour l'instant, cohérent avec le reste du plan.

## 6. Points à trancher

1. Les prix sont-ils saisis **TTC** ou **HT** ? (je propose TTC, car c'est ce que tu vois sur les factures.)
2. Une liste de courses **par projet** ou **une seule liste globale** ? (le schéma gère les deux via `project_id` nul.)
3. La réception **doit-elle** toujours choisir un emplacement, ou peut-on recevoir « sans emplacement » comme dans « Ranger » ?
4. Faut-il un **historique de prix visible** (tableau seul, ou courbe) ?
5. Le champ `url` des fournisseurs et offres sert seulement de lien, ou faut-il une vérification de prix automatique (hors périmètre pour l'instant) ?

## 7. Hors périmètre de ce lot

- Import de factures ou de commandes depuis les sites marchands.
- Vérification automatique des prix.
- Lot 3 (statut sorti/prêté, étiquettes libres, valeur du stock) : traité après.
