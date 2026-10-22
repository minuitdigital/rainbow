#!/bin/sh
# Au démarrage du bureau (labwc, ~/.config/labwc/autostart) : le service, puis
# Chromium en plein écran sur la page locale. Pour les essais : PAGE=test/?pi.
PAGE='?pi'
cd "$(dirname "$0")/.." || exit 1

pgrep -f '^python3 pi/service.py' >/dev/null ||
  setsid python3 pi/service.py > /tmp/service.log 2>&1 < /dev/null &
for i in $(seq 30); do
  python3 -c "import socket; socket.create_connection(('localhost', 8000), 1)" 2>/dev/null && break
  sleep 1
done

# Courant coupé sans arrêt : verrou périmé et bandeau « restaurer » au prochain lancement.
P="$HOME/.config/chromium"
rm -f "$P"/Singleton*
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$P/Default/Preferences" 2>/dev/null

exec chromium --kiosk --noerrdialogs --disable-infobars --no-first-run \
  --password-store=basic "http://localhost:8000/$PAGE"
