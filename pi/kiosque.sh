#!/bin/sh
# Au démarrage du bureau (labwc, ~/.config/labwc/autostart) : le service, puis
# Chromium en plein écran sur la page locale. Pour les essais : PAGE=test/?pi.
PAGE='?pi'
cd "$(dirname "$0")/.." || exit 1

# Courant revenu avec ALLUMAGE sur – : on se rééteint. La touche « power » de
# gpio-shutdown (active_low=0) est tenue tant que le contact est ouvert.
python3 - <<'EOF' && exec /sbin/shutdown -h now
import fcntl, glob
for n in glob.glob('/sys/class/input/event*/device/name'):
    if 'shutdown' in open(n).read():
        keys = bytearray(96)
        fcntl.ioctl(open('/dev/input/' + n.split('/')[4]), 0x80604518, keys)  # EVIOCGKEY(96)
        exit(0 if keys[116 // 8] >> (116 % 8) & 1 else 1)                      # KEY_POWER
exit(1)
EOF

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
  --password-store=basic --disable-features=Translate \
  --autoplay-policy=no-user-gesture-required "http://localhost:8000/$PAGE"
