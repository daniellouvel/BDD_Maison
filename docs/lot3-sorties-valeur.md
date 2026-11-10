# Lot 3 : sorties, prêts et valeur du stock (proposition)

Statut : **schéma validé et implémenté** (migration `0013_lots_prets`, tests `test_lots.py`, écran « Prêts », actions dans la fiche article). Pas encore déployé. Points de la section 7 tranchés comme proposé.

Écarts avec le schéma :
- Un prêt porte sur le **lot entier** uniquement. Le prêt partiel (scission) n'est pas implémenté.
- Une sortie crée un mouvement `out` de la quantité entière, puis passe le lot à `removed`. Les deux écritures ne sont pas dans une même transaction (comme la réception d'achat).
- Les lots `removed` n'apparaissent plus dans la liste des lots d'un article. Les étiquettes libres sont retirées de ce lot : elles existent déjà (étiquette imprimée non affectée = `available`, voir `services/qr.py`).

## 1. Objectif

- Savoir où se trouve un lot qui n'est plus en stock : **prêté** (à revenir) ou **sorti** (consommé, vendu, donné, jeté).
- Connaître la **valeur du stock** à partir des prix d'achat enregistrés au lot 2.

## 2. Statut d'un lot

Ajout d'une colonne `status` sur `nodes`, utilisée seulement pour `kind = item` :

| Valeur | Sens | Compte dans le stock disponible |
|---|---|---|
| `in_stock` | en stock (défaut, comportement actuel) | oui |
| `lent` | prêté à quelqu'un, à revenir | non |
| `removed` | sorti définitivement (consommé, vendu, donné, jeté) | non |

Règles :
1. Le défaut est `in_stock` : aucune donnée existante ne change de sens.
2. `removed` est un état final : on ne repasse pas de `removed` à `in_stock`, un nouvel achat crée un nouveau lot.
3. Un lot `lent` ou `removed` garde sa quantité : le stock total de l'article n'est pas réduit par un prêt. Seule la **disponibilité** change.
4. Une sortie `removed` passe par `services/stock.apply` avec un mouvement `out` (ou `consume`), comme aujourd'hui. Aucun changement direct de `nodes.quantity`.

## 3. Prêts

Table `loans` (déjà prévue en §5.2 de `docs/phase1-conception.md`) :

| Colonne | Type | Remarque |
|---|---|---|
| `id` | uuid PK | |
| `node_id` | FK `nodes`, index | lot prêté (item) |
| `recipient` | text | nom de la personne, libre |
| `quantity` | numeric(12,3) | quantité prêtée, > 0, ≤ quantité du lot |
| `out_at` | timestamptz | date du prêt |
| `due_at` | timestamptz, null | date de retour prévue |
| `returned_at` | timestamptz, null | renseigné au retour |
| `version`, timestamps | | |

Décisions proposées (à valider) :
1. **Prêt partiel** : si la quantité prêtée est inférieure au lot, on scinde (`split`) comme aujourd'hui ; le lot prêté prend le statut `lent`. Le lot restant reste `in_stock`.
2. **Pas de déplacement** vers un nœud « Prêts » : la conception initiale le prévoyait, mais le statut suffit et évite un emplacement système. *Choix à confirmer.*
3. **Retour** : `POST /loans/{id}/return` passe le lot en `in_stock` et renseigne `returned_at`. Un mouvement `return` est écrit si la quantité a changé.
4. Un lot n'a qu'un prêt actif à la fois.

## 4. Valeur du stock

- Valeur d'un lot = `quantity` × **prix courant de l'article**.
- Prix courant = dernier point de prix (`price_points`) de l'offre la plus récemment mise à jour pour cet article (lot 2 : « prix courant » = dernier point de l'offre).
- Un lot sans prix connu est compté à part : « non évalué » (nombre de lots), sans être compté à zéro silencieusement.
- Valeur totale affichée = somme des lots `in_stock` évalués ; les `lent` sont affichés séparément (« valeur prêtée »), les `removed` sont exclus.

Décisions proposées :
5. Valeur calculée **à la demande** (pas de colonne stockée) : évite toute dérive.
6. Pas d'historique de valeur dans le temps pour ce lot.

## 5. API proposée

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/nodes/{id}/status` | passer un lot à `removed` (avec version) |
| POST | `/loans` | créer un prêt (lot, destinataire, quantité, retour prévu) |
| POST | `/loans/{id}/return` | enregistrer le retour |
| GET | `/loans?open=1` | prêts en cours |
| GET | `/stock/value` | valeur totale, prêtée, non évaluée |

## 6. Écrans proposés

- Fiche d'un lot : boutons « Prêter » et « Marquer sorti », statut affiché.
- Écran « Prêts » : liste des prêts ouverts, date de retour prévue en retard en évidence, bouton « Retour ».
- Tableau de bord simple : valeur du stock, valeur prêtée, nombre de lots non évalués.

## 7. Points tranchés

1. Le prêt **ne déplace pas** le lot : seul le statut change (`lent`). Pas d'emplacement « Prêts ».
2. La consommation reste un **simple mouvement** (`consume`), sans changer le statut du reste du lot.
3. Le prix courant pour la valeur : le **dernier prix saisi, toutes offres confondues**.

## 8. Hors périmètre

- Projets (table `projects`, absente du code pour l'instant).
- Rappels automatiques de retour de prêt.
- Valeur historisée et graphiques.
