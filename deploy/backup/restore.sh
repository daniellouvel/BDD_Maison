#!/usr/bin/env bash
# Restauration complète. À lancer en root :
#   restore.sh /var/lib/myworkshop/backups/db/daily/myworkshop-AAAAMMJJ-HHMM.dump \
#              /var/lib/myworkshop/backups/files/AAAAMMJJ-HHMM
# ATTENTION : remplace la base et les fichiers actuels.
set -euo pipefail

DUMP="${1:?Chemin du dump PostgreSQL requis}"
FILES="${2:?Chemin de l'instantané de fichiers requis}"
DB_NAME="${MW_DB_NAME:-myworkshop}"
DATA_DIR="${MW_DATA_DIR:-/var/lib/myworkshop/data}"

[ -f "$DUMP" ] || { echo "Dump introuvable : $DUMP" >&2; exit 1; }
[ -d "$FILES" ] || { echo "Instantané introuvable : $FILES" >&2; exit 1; }

read -r -p "Remplacer la base « $DB_NAME » et $DATA_DIR ? Tapez OUI : " answer
[ "$answer" = "OUI" ] || { echo "Annulé."; exit 1; }

systemctl stop myworkshop-api
runuser -u postgres -- dropdb --if-exists "$DB_NAME"
runuser -u postgres -- createdb --owner=myworkshop "$DB_NAME"
runuser -u myworkshop -- pg_restore --no-owner --dbname="$DB_NAME" "$DUMP"
rsync -a --delete "$FILES/" "$DATA_DIR/"
chown -R myworkshop:myworkshop "$DATA_DIR"
systemctl start myworkshop-api
echo "Restauration terminée."
