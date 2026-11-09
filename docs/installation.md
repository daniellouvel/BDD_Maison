# Installation sur Proxmox (LXC Debian 13)

> Procédure écrite pour Debian 13 « trixie ». Elle n'a pas encore été déroulée sur un vrai
> conteneur : les commandes sont à valider lors de la première installation.

## 1. Créer le conteneur (sur l'hôte Proxmox)

```bash
pveam update
pveam available --section system | grep debian-13
pveam download local debian-13-standard_13.1-2_amd64.tar.zst   # adapter au nom exact listé
pct create 120 local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst \
  --hostname myworkshop --unprivileged 1 --cores 2 --memory 2048 --swap 512 \
  --rootfs local-lvm:16 --net0 name=eth0,bridge=vmbr0,ip=dhcp --onboot 1
pct start 120
pct enter 120
```

Réserver une adresse IP fixe (bail DHCP statique ou `ip=192.168.x.y/24,gw=…`).

## 2. Paquets (dans le conteneur)

```bash
apt update && apt full-upgrade -y
apt install -y postgresql caddy python3-venv git rsync nodejs npm
```

Vérifier les versions : `apt policy postgresql` (17 attendu) et `python3 --version` (3.13 attendu).

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

cd /opt/myworkshop/app/backend
runuser -u myworkshop -- env $(cat /etc/myworkshop/myworkshop.env | xargs) /opt/myworkshop/venv/bin/alembic upgrade head
runuser -u myworkshop -- env $(cat /etc/myworkshop/myworkshop.env | xargs) /opt/myworkshop/venv/bin/python -m app.cli create-user --username daniel --role admin

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
sans).

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
cd backend && runuser -u myworkshop -- env $(cat /etc/myworkshop/myworkshop.env | xargs) /opt/myworkshop/venv/bin/alembic upgrade head
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
