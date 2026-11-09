#!/bin/sh
# Hook certbot : exécuté après chaque obtention ou renouvellement du certificat.
# Copie le certificat là où Caddy peut le lire (la clé de /etc/letsencrypt est réservée à root)
# puis recharge Caddy. Installé dans /etc/letsencrypt/renewal-hooks/deploy/myworkshop.sh
set -eu

LINEAGE="${RENEWED_LINEAGE:-/etc/letsencrypt/live/daniel.ldns.fr}"

install -d -o root -g caddy -m 750 /etc/caddy/certs
install -o root -g caddy -m 644 "$LINEAGE/fullchain.pem" /etc/caddy/certs/fullchain.pem
install -o root -g caddy -m 640 "$LINEAGE/privkey.pem" /etc/caddy/certs/privkey.pem

if systemctl is-active --quiet caddy; then
  systemctl reload caddy
fi
