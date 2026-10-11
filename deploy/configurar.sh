#!/bin/bash
# jarvis-configurar: asistente de puesta en marcha. Correr como root en la consola del droplet, después de setup.sh.
# Pide lo mínimo, detecta tu ID de Telegram solo y deja JARVIS corriendo.
set -euo pipefail
U=jarvis
H=/home/$U
ENV_FILE=$H/.config/jarvis/jarvis.env
REPO_CODIGO=${REPO_CODIGO:-moisestamoy/jarvis}
REPO_MEMORIA=${REPO_MEMORIA:-moisestamoy/jarvis-memoria}
como() { sudo -iu $U bash -lc "$1"; }
paso() { echo; echo "━━━ $1 ━━━"; }

paso "1/5 · Llaves de GitHub (dos copiar y pegar)"
echo "Abre: https://github.com/$REPO_CODIGO/settings/keys/new"
echo "  Title: servidor · Key: la línea de abajo · NO marques 'Allow write access' · Add key"
echo; cat $H/.ssh/jarvis_codigo.pub; echo
read -rp "Presiona Enter cuando la hayas agregado... " _
echo "Abre: https://github.com/$REPO_MEMORIA/settings/keys/new"
echo "  Title: servidor · Key: la línea de abajo · SÍ marca 'Allow write access' · Add key"
echo; cat $H/.ssh/jarvis_memoria.pub; echo
read -rp "Presiona Enter cuando la hayas agregado... " _

until como "test -d ~/jarvis || git clone -q git@github-jarvis:$REPO_CODIGO.git ~/jarvis"; do
  read -rp "No pude clonar $REPO_CODIGO. Revisa la llave y presiona Enter para reintentar... " _
done
until como "test -d ~/jarvis-memoria || git clone -q git@github-memoria:$REPO_MEMORIA.git ~/jarvis-memoria"; do
  read -rp "No pude clonar $REPO_MEMORIA. Revisa la llave (con 'Allow write access') y presiona Enter... " _
done
como 'git config --global user.name JARVIS && git config --global user.email jarvis@localhost'
echo "✔ Repos clonados"

paso "2/5 · Bot de Telegram"
until [ -n "${TG:-}" ] && curl -fsS "https://api.telegram.org/bot$TG/getMe" >/dev/null 2>&1; do
  read -rsp "Pega el token que te dio @BotFather (no se verá al pegar) y Enter: " TG; echo
done
BOT=$(curl -fsS "https://api.telegram.org/bot$TG/getMe" | jq -r .result.username)
echo "✔ Bot @$BOT"

paso "3/5 · Tu ID de Telegram"
curl -fsS "https://api.telegram.org/bot$TG/deleteWebhook" >/dev/null || true
ULTIMO=$(curl -fsS "https://api.telegram.org/bot$TG/getUpdates" | jq '[.result[].update_id] | max // 0')
echo "Abre Telegram, busca @$BOT y escríbele cualquier cosa (por ejemplo: hola)."
OWNER=""
while [ -z "$OWNER" ]; do
  R=$(curl -fsS "https://api.telegram.org/bot$TG/getUpdates?offset=$((ULTIMO + 1))&timeout=30" || echo '{}')
  OWNER=$(echo "$R" | jq -r '[.result[]? | .message? | select(. != null) | .from.id] | last // empty')
  NOMBRE=$(echo "$R" | jq -r '[.result[]? | .message? | select(. != null) | .from.first_name] | last // empty')
done
read -rp "Recibí un mensaje de $NOMBRE (ID $OWNER). ¿Eres tú? [s/n] " OK
[[ "$OK" =~ ^[sS] ]] || { echo "Vuelve a correr jarvis-configurar."; exit 1; }
echo "✔ Solo te va a responder a ti"

paso "4/5 · Claude (tu plan Max)"
echo "Se abre un enlace: ábrelo, inicia sesión con tu cuenta de Claude y pega el código que te da."
echo "Al final te muestra un token que empieza con sk-ant-oat: cópialo."
como "~/.local/bin/claude setup-token" || true
until [[ "${CT:-}" == sk-ant-* ]]; do read -rsp "Pega el token de Claude (no se verá) y Enter: " CT; echo; done
echo "✔ Claude listo"

paso "5/5 · Opcionales"
read -rsp "API key de ElevenLabs para entender tus audios (Enter para omitir): " EL; echo
read -rp "Zona horaria inicial [Europe/Lisbon]: " TZI; TZI=${TZI:-Europe/Lisbon}

umask 077
cat > "$ENV_FILE" <<EOF
CANAL=telegram
TELEGRAM_BOT_TOKEN=$TG
OWNER_TELEGRAM_ID=$OWNER
CLAUDE_CODE_OAUTH_TOKEN=$CT
ELEVENLABS_API_KEY=$EL
MEMORIA_PATH=$H/jarvis-memoria
GIT_SYNC=1
TZ_DEFAULT=$TZI
EOF
chown $U:$U "$ENV_FILE"
systemctl enable --now jarvis >/dev/null 2>&1 || systemctl restart jarvis
sleep 3
if systemctl is-active --quiet jarvis; then
  echo; echo "✅ JARVIS está corriendo. Escríbele \"hola\" a @$BOT para empezar el onboarding."
  echo "   Ver qué pasa: journalctl -u jarvis -f   ·   Cambiar algo: nano $ENV_FILE && systemctl restart jarvis"
else
  echo "⚠️ El servicio no arrancó. Mira el error con: journalctl -u jarvis -n 50"
fi
