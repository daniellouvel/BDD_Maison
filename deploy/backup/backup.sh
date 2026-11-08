#!/usr/bin/env bash
# Sauvegarde quotidienne : dump PostgreSQL + instantané des fichiers (liens physiques).
# Rotation : 14 dumps quotidiens, 8 dumps hebdomadaires (dimanche), 14 instantanés de fichiers.
set -euo pipefail

DB_NAME="${MW_DB_NAME:-myworkshop}"
DATA_DIR="${MW_DATA_DIR:-/var/lib/myworkshop/data}"
BACKUP_DIR="${MW_BACKUP_DIR:-/var/lib/myworkshop/backups}"
STAMP="$(date +%Y%m%d-%H%M)"

mkdir -p "$BACKUP_DIR/db/daily" "$BACKUP_DIR/db/weekly" "$BACKUP_DIR/files"

# 1. Base de données (format custom, compressé, restaurable avec pg_restore)
DUMP="$BACKUP_DIR/db/daily/$DB_NAME-$STAMP.dump"
pg_dump --format=custom --file="$DUMP.tmp" "$DB_NAME"
mv "$DUMP.tmp" "$DUMP"
if [ "$(date +%u)" = "7" ]; then
  cp --link "$DUMP" "$BACKUP_DIR/db/weekly/"
fi

# 2. Fichiers : instantané incrémental (les fichiers inchangés sont des liens physiques)
snapshots() { find "$BACKUP_DIR/files" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort; }
LAST="$(snapshots | tail -n 1)"
if [ -n "$LAST" ]; then
  rsync -a --delete --link-dest="$LAST" "$DATA_DIR/" "$BACKUP_DIR/files/$STAMP/"
else
  rsync -a "$DATA_DIR/" "$BACKUP_DIR/files/$STAMP/"
fi

# 3. Rotation (les noms horodatés se trient chronologiquement)
find "$BACKUP_DIR/db/daily" -maxdepth 1 -name '*.dump' | sort | head -n -14 | xargs -r rm -f
find "$BACKUP_DIR/db/weekly" -maxdepth 1 -name '*.dump' | sort | head -n -8 | xargs -r rm -f
snapshots | head -n -14 | xargs -r rm -rf

echo "Sauvegarde terminée : $DUMP"
