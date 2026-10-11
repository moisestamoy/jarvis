#!/bin/bash
# Prepara un droplet nuevo de Ubuntu 24.04 para JARVIS. Correr como root.
# Uso: bash setup.sh [hostname-público]
#   Sin hostname (Telegram): no instala Caddy ni abre puertos web; el bot sale a buscar los mensajes.
#   Con hostname (WhatsApp o HUD): instala Caddy con HTTPS automático (ej.: jarvis.tudominio.com, registro A al droplet).
set -euo pipefail
HOST=${1:-}
U=jarvis

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq git curl jq ufw debian-keyring debian-archive-keyring apt-transport-https

# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -yq nodejs

# Caddy (HTTPS automático delante del bridge), solo si hay dominio
if [ -n "$HOST" ]; then
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -q && apt-get install -yq caddy
fi

# Usuario sin privilegios que corre todo
id $U >/dev/null 2>&1 || useradd -m -s /bin/bash $U
mkdir -p /home/$U/.ssh /home/$U/.config/jarvis
[ -f /root/.ssh/authorized_keys ] && cp /root/.ssh/authorized_keys /home/$U/.ssh/authorized_keys
# Dos deploy keys: una de solo lectura para el código (jarvis) y otra con escritura SOLO para jarvis-memoria.
[ -f /home/$U/.ssh/jarvis_codigo ] || ssh-keygen -t ed25519 -N '' -C "jarvis codigo (lectura)" -f /home/$U/.ssh/jarvis_codigo
[ -f /home/$U/.ssh/jarvis_memoria ] || ssh-keygen -t ed25519 -N '' -C "jarvis-memoria (escritura)" -f /home/$U/.ssh/jarvis_memoria
cat > /home/$U/.ssh/config <<EOF
Host github-jarvis
  HostName github.com
  IdentityFile ~/.ssh/jarvis_codigo
  IdentitiesOnly yes
Host github-memoria
  HostName github.com
  IdentityFile ~/.ssh/jarvis_memoria
  IdentitiesOnly yes
EOF
ssh-keyscan github.com >> /home/$U/.ssh/known_hosts 2>/dev/null
chown -R $U:$U /home/$U
chmod 700 /home/$U/.ssh /home/$U/.config/jarvis
chmod 600 /home/$U/.ssh/config

# Claude Code para el usuario jarvis
sudo -iu $U bash -c 'curl -fsSL https://claude.ai/install.sh | bash'

# Servicio
cat > /etc/systemd/system/jarvis.service <<EOF
[Unit]
Description=JARVIS (bridge WhatsApp → Claude Code)
After=network-online.target

[Service]
User=$U
WorkingDirectory=/home/$U/jarvis
Environment=PATH=/home/$U/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=CLAUDE_BIN=/home/$U/.local/bin/claude
Environment=LANG=es_ES.UTF-8
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

if [ -n "$HOST" ]; then
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
  @bridge path /webhook /health /privacy /google/* /whoop/* /jarvis /jarvis/*
  handle @bridge {
    reverse_proxy 127.0.0.1:8787
  }
  handle {
    respond 404
  }
}
EOF
systemctl restart caddy
ufw allow 80 && ufw allow 443
fi

ufw allow OpenSSH && ufw --force enable

# Asistente de configuración (pide los tokens, detecta tu ID de Telegram y arranca el servicio)
DIR_SETUP=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo /root)
[ -f "$DIR_SETUP/configurar.sh" ] && install -m 755 "$DIR_SETUP/configurar.sh" /usr/local/bin/jarvis-configurar

echo
echo "Servidor listo. Ahora corre:  jarvis-configurar"
