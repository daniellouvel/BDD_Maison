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
cp /opt/myworkshop/app/deploy/caddy/Caddyfile /etc/caddy/Caddyfile   # puis adapter le nom d'hôte
systemctl reload caddy
```

## 6. HTTPS (obligatoire pour la caméra et la PWA)

- **Avec un nom de domaine** : créer un enregistrement DNS (ex. `workshop.mondomaine.fr`) vers l'IP
  LAN du conteneur. Pour un certificat Let's Encrypt sans ouvrir de port, il faut un Caddy avec le
  module DNS de votre registrar (challenge DNS-01).
- **Sans domaine** : `tls internal` dans le Caddyfile, puis installer le certificat racine
  `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` sur le PC et le smartphone.

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
