#!/bin/bash
# Genera deploy/cloud-init.sh: setup.sh + configurar.sh en un solo archivo, para pegarlo en
# DigitalOcean → Create Droplet → Advanced options → "Add initialization scripts".
set -euo pipefail
cd "$(dirname "$0")"
{
  echo '#!/bin/bash'
  echo '# GENERADO por deploy/generar-cloud-init.sh: no lo edites a mano.'
  echo '# Pégalo completo en DigitalOcean al crear el droplet. Luego, en la consola: jarvis-configurar'
  echo 'mkdir -p /root/jarvis-setup'
  echo "cat > /root/jarvis-setup/configurar.sh <<'JARVIS_CONFIGURAR'"
  cat configurar.sh
  echo 'JARVIS_CONFIGURAR'
  echo "cat > /root/jarvis-setup/setup.sh <<'JARVIS_SETUP'"
  cat setup.sh
  echo 'JARVIS_SETUP'
  echo 'bash /root/jarvis-setup/setup.sh > /var/log/jarvis-setup.log 2>&1'
} > cloud-init.sh
echo "deploy/cloud-init.sh generado ($(wc -c < cloud-init.sh) bytes)"
