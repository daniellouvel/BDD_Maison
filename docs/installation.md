# Installation sur Proxmox (LXC Debian 13)

> Procédure déroulée le 2026-11-09 sur Proxmox VE 9.2 (hôte 192.168.1.50), conteneur 120
> `myworkshop`. Les pièges rencontrés sont signalés par **Attention**.

## 1. Créer le conteneur (sur l'hôte Proxmox)

```bash
pveam update
pveam available --section system | grep debian-13
# Attention : stocker le modèle sur un stockage qui accepte « vztmpl » (ici « Data », pas « local »)
pveam download Data debian-13-standard_13.6-1_amd64.tar.zst
pct create 120 Data:vztmpl/debian-13-standard_13.6-1_amd64.tar.zst \
  --hostname myworkshop --unprivileged 1 --features nesting=1 --cores 2 --memory 2048 --swap 512 \
  --rootfs local-lvm:16 --mp0 Data:50,mp=/var/lib/myworkshop \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp --onboot 1 --start 1
pct enter 120
```

**Attention, adresse IP** : la box refuse de router les adresses fixées à la main (le conteneur
joint le réseau local mais pas Internet). Le conteneur est donc en DHCP ; **réserver son adresse
dans la box** (bail DHCP statique pour l'adresse MAC du conteneur, `pct config 120 | grep net0`).

## 2. Langue et paquets (dans le conteneur)

**Attention** : le modèle Debian n'a aucune langue configurée ; sans cette étape, PostgreSQL crée
ses bases en `SQL_ASCII` et l'application ne démarre pas. À faire **avant** d'installer PostgreSQL :

```bash
apt update && apt full-upgrade -y
apt install -y locales
sed -i 's/^# *fr_FR.UTF-8 UTF-8/fr_FR.UTF-8 UTF-8/' /etc/locale.gen
locale-gen && update-locale LANG=fr_FR.UTF-8
export LANG=fr_FR.UTF-8 LC_ALL=fr_FR.UTF-8
apt install -y postgresql caddy python3-venv git rsync nodejs npm curl
```

Vérifier : `psql -l` doit montrer l'encodage `UTF8` (si `SQL_ASCII`, base encore vide :
`pg_dropcluster 17 main --stop && pg_createcluster 17 main --locale fr_FR.UTF-8 --start`).
Versions obtenues : PostgreSQL 17.11, Python 3.13.5, Node 20.19, Caddy 2.6.2.

## 3. Utilisateur, base, dossiers

```bash
adduser --system --group --home /opt/myworkshop myworkshop
runuser -u postgres -- createuser myworkshop
runuser -u postgres -- createdb --owner=myworkshop myworkshop
install -d -o myworkshop -g myworkshop -m 750 /var/lib/myworkshop /var/lib/myworkshop/data /var/lib/myworkshop/backups
install -d -o root -g myworkshop -m 750 /etc/myworkshop
```

L'authentification PostgreSQL se fait par socket Unix (« peer ») : aucun mot de passe n'est stocké.

## 4. Application

```bash
runuser -u myworkshop -- git clone https://github.com/daniellouvel/BDD_Maison.git /opt/myworkshop/app
runuser -u myworkshop -- python3 -m venv /opt/myworkshop/venv
runuser -u myworkshop -- /opt/myworkshop/venv/bin/pip install /opt/myworkshop/app/backend
cp /opt/myworkshop/app/deploy/myworkshop.env.example /etc/myworkshop/myworkshop.env
chmod 640 /etc/myworkshop/myworkshop.env && chown root:myworkshop /etc/myworkshop/myworkshop.env

install -m 750 /opt/myworkshop/app/deploy/myworkshop-admin /usr/local/sbin/myworkshop-admin

cd /opt/myworkshop/app/backend
set -a; . /etc/myworkshop/myworkshop.env; set +a     # (le fichier contient des commentaires)
runuser -u myworkshop -- env MW_DATABASE_URL="$MW_DATABASE_URL" /opt/myworkshop/venv/bin/alembic upgrade head
/usr/local/sbin/myworkshop-admin create-user --username daniel --role admin

cd /opt/myworkshop/app/frontend
runuser -u myworkshop -- npm ci
runuser -u myworkshop -- npm run build
```

## 5. Services

```bash
cp /opt/myworkshop/app/deploy/systemd/*.service /opt/myworkshop/app/deploy/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now myworkshop-api myworkshop-backup.timer
```

Caddy est configuré à l'étape suivante, une fois le certificat obtenu (il refuse de démarrer
sans). **En attendant**, un Caddyfile provisoire `:80` sert l'application en HTTP sur l'adresse
IP du conteneur, avec `MW_COOKIE_SECURE=false` dans `/etc/myworkshop/myworkshop.env`. Remettre
`MW_COOKIE_SECURE=true` (puis `systemctl restart myworkshop-api`) dès que HTTPS fonctionne.

## 6. HTTPS : https://daniel.ldns.fr (obligatoire pour la caméra et la PWA)

Le domaine familial `ldns.fr` est géré chez OVH. Le sous-domaine `daniel.ldns.fr` pointe vers
l'adresse **locale** du conteneur : il ne répond qu'à la maison (ou via VPN), rien n'est ouvert
sur Internet. Le certificat Let's Encrypt est obtenu par un challenge DNS : certbot crée un
enregistrement TXT temporaire chez OVH via l'API, puis le supprime.

### 6.1 Chez OVH (personne qui gère le compte, une seule fois)

1. **Zone DNS** : espace client OVH → Noms de domaine → `ldns.fr` → Zone DNS → Ajouter une
   entrée → type **A**, sous-domaine `daniel`, cible = IP locale du conteneur (ex.
   `192.168.1.50`), TTL par défaut. Ne rien modifier d'autre dans la zone.
2. **Clé d'API limitée à la zone** : ouvrir https://eu.api.ovh.com/createToken/ , se connecter,
   puis renseigner :
   - Application name : `myworkshop-certbot`, description : `Certificat daniel.ldns.fr`
   - Validity : `Unlimited`
   - Rights (une ligne par droit) :
     - `GET` `/domain/zone/`
     - `GET` `/domain/zone/ldns.fr/*`
     - `POST` `/domain/zone/ldns.fr/*`
     - `PUT` `/domain/zone/ldns.fr/*`
     - `DELETE` `/domain/zone/ldns.fr/*`
   - Restriction d'IP : facultative (IP publique de la maison).

   OVH affiche trois valeurs : *Application key*, *Application secret*, *Consumer key*. Les
   transmettre de façon sûre (pas par e-mail en clair) : elles permettent de modifier la zone
   `ldns.fr`, et rien d'autre sur le compte.

### 6.2 Dans le conteneur

```bash
apt install -y certbot python3-certbot-dns-ovh
cp /opt/myworkshop/app/deploy/certbot/ovh.ini.example /etc/letsencrypt/ovh.ini
chmod 600 /etc/letsencrypt/ovh.ini
nano /etc/letsencrypt/ovh.ini          # coller les trois clés OVH

install -m 755 /opt/myworkshop/app/deploy/certbot/deploy-hook.sh \
  /etc/letsencrypt/renewal-hooks/deploy/myworkshop.sh

certbot certonly --dns-ovh --dns-ovh-credentials /etc/letsencrypt/ovh.ini \
  --dns-ovh-propagation-seconds 60 -d daniel.ldns.fr \
  --agree-tos -m VOTRE_ADRESSE_EMAIL --non-interactive

/etc/letsencrypt/renewal-hooks/deploy/myworkshop.sh   # première copie vers /etc/caddy/certs

cp /opt/myworkshop/app/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy
```

Le renouvellement est automatique (timer `certbot.timer` de Debian) ; le hook recopie le
certificat et recharge Caddy. Vérifier avec `certbot renew --dry-run`.

### 6.3 Si daniel.ldns.fr ne répond pas depuis la maison

Certaines box refusent les noms qui pointent vers une adresse locale (protection « DNS
rebinding »). Vérifier depuis le PC : `nslookup daniel.ldns.fr`. Si aucune adresse n'est
renvoyée, ajouter dans la box une entrée DNS locale `daniel.ldns.fr` → IP du conteneur (ou
désactiver la protection pour ce seul nom si la box le permet).

## 7. Mise à jour

```bash
cd /opt/myworkshop/app && runuser -u myworkshop -- git pull
runuser -u myworkshop -- /opt/myworkshop/venv/bin/pip install ./backend
cd backend && set -a && . /etc/myworkshop/myworkshop.env && set +a \
  && runuser -u myworkshop -- env MW_DATABASE_URL="$MW_DATABASE_URL" /opt/myworkshop/venv/bin/alembic upgrade head
cd ../frontend && runuser -u myworkshop -- npm ci && runuser -u myworkshop -- npm run build
systemctl restart myworkshop-api
```

## 8. Sauvegardes et restauration

- `myworkshop-backup.timer` lance `deploy/backup/backup.sh` chaque nuit à 02:30 : dump PostgreSQL
  (14 quotidiens, 8 hebdomadaires) et instantanés incrémentaux de `/var/lib/myworkshop/data` (14).
- Ajouter dans Proxmox une sauvegarde `vzdump` hebdomadaire du conteneur.
- Les sauvegardes sont sur le même disque : prévoir une copie vers un autre support (NAS, USB).
- Restauration : `deploy/backup/restore.sh <dump> <instantané>` (en root). À tester une fois par
  trimestre sur un conteneur de test.
