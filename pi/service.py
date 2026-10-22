# -*- coding: utf-8 -*-
"""
Service du Pi : `python3 pi/service.py [port]`. Un seul processus.
Sert la page (comme serve.py), lit les GPIO avec 20 ms d'anti-rebond et
pousse chaque changement à la page par WebSocket sur /ws. Broches : MATERIEL §7.

La page se branche avec « ?pi » (src/pi.js). Sans gpiozero (ordinateur),
le service sert quand même la page ; /ws reste ouvert, muet.
"""

import base64
import glob
import hashlib
import json
import os
import struct
import sys
import threading

try:
    import fcntl
except ImportError:  # Windows : pas de manette à régler
    fcntl = None

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import serve  # noqa: E402

try:
    from gpiozero import Button, PWMLED
except ImportError:
    Button = PWMLED = None

# commande -> numéro GPIO (BCM). Poussoirs : un message à l'appui, et
# {'k': 'relache'} au relâché (pour /test/ ; plaque.relache n'existe pas).
# Interrupteurs : un message à chaque changement, et l'état à la connexion.
# ALLUMAGE (GPIO 3) n'est pas lu ici : l'overlay gpio-shutdown le tient (config.txt).
PUSH = {'arcEnCiel': 5, 'teleportation': 6, 'repere': 13, 'maison': 19}
SWITCH = {'couloir': 17, 'couleur': 27, 'interface': 22, 'formule': 23, 'poeme': 24}
# LED du tableau, en PWM : la page envoie /led?0..1 (l'indice sous le piéton).
# 3,3 kΩ en série : 20 % ≈ 0,04 mA, 100 % ≈ 0,2 mA (mesuré le 22/10).
LED, LED_MIN = 18, 0.2
led = None

clients = set()
lock = threading.Lock()
switches = {}


def frame(text):
    """Trame WebSocket texte, serveur -> client (non masquée)."""
    b = text.encode('utf-8')
    n = len(b)
    head = bytes([0x81, n]) if n < 126 else bytes([0x81, 126]) + n.to_bytes(2, 'big')
    return head + b


def send(wfile, msg):
    wfile.write(frame(json.dumps(msg)))
    wfile.flush()


def broadcast(msg):
    with lock:
        for w in list(clients):
            try:
                send(w, msg)
            except OSError:
                clients.discard(w)


def start_gpio():
    global led
    if Button is None:
        print('  gpiozero absent : pas de GPIO')
        return
    led = PWMLED(LED, initial_value=LED_MIN)
    for name, pin in PUSH.items():
        b = Button(pin, pull_up=True, bounce_time=0.02)
        b.when_pressed = lambda n=name: broadcast({'k': n})
        b.when_released = lambda n=name: broadcast({'k': 'relache', 'v': n})
        switches[name] = b  # garde la référence : sinon le ramasse-miettes la ferme
    for name, pin in SWITCH.items():
        b = Button(pin, pull_up=True, bounce_time=0.02)
        # Câblés à l'envers sur le tableau (22/10) : contact fermé = sur –.
        b.when_pressed = lambda n=name: broadcast({'k': n, 'v': False})
        b.when_released = lambda n=name: broadcast({'k': n, 'v': True})
        switches[name] = b


def no_dead_zone():
    """Linux (joydev) met une zone morte de 1/16 de la course au milieu de
    chaque axe, et Chromium lit joydev : on la retire. La Leonardo envoie
    0..65535. Refait à chaque connexion de la page, car un nouveau
    branchement (ou un nouveau chargement du croquis) la remet."""
    if fcntl is None:
        return
    for js in glob.glob('/dev/input/js*'):
        try:
            fd = os.open(js, os.O_RDONLY | os.O_NONBLOCK)
            n = struct.unpack('B', fcntl.ioctl(fd, 0x80016a11, bytes(1)))[0]  # JSIOCGAXES
            # JS_CORR_BROKEN, centre 32767, pente 2^29 / 32767, sans zone morte
            corr = struct.pack('8ihH', 32767, 32767, 16384, 16384, 0, 0, 0, 0, 0, 1) * n
            fcntl.ioctl(fd, 0x40246a21, corr)  # JSIOCSCORR
            os.close(fd)
        except OSError as e:
            print('  %s : %s' % (js, e))


class Handler(serve.Handler):

    def do_GET(self):
        path, _, query = self.path.partition('?')
        if path == '/led':
            try:
                v = min(1.0, max(0.0, float(query)))
            except ValueError:
                return self.send_error(400)
            if led is not None:
                led.value = LED_MIN + (1 - LED_MIN) * v
            self.send_response(204)
            return serve.http.server.SimpleHTTPRequestHandler.end_headers(self)
        if path != '/ws':
            return super().do_GET()
        key = self.headers.get('Sec-WebSocket-Key')
        if not key:
            return self.send_error(400)
        accept = base64.b64encode(hashlib.sha1(
            (key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        self.send_response(101, 'Switching Protocols')
        self.send_header('Upgrade', 'websocket')
        self.send_header('Connection', 'Upgrade')
        self.send_header('Sec-WebSocket-Accept', accept)
        # Pas serve.Handler.end_headers : le cache n'a rien à faire ici.
        http_end = serve.http.server.SimpleHTTPRequestHandler.end_headers
        http_end(self)
        self.close_connection = True
        no_dead_zone()
        with lock:
            try:
                for name in SWITCH:
                    if name in switches:
                        send(self.wfile, {'k': name, 'v': not switches[name].is_pressed})
            except OSError:
                return
            clients.add(self.wfile)
        try:
            while self.rfile.read(1024):  # on ignore ce que dit la page ; EOF = fermée
                pass
        except OSError:
            pass
        finally:
            with lock:
                clients.discard(self.wfile)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    start_gpio()
    no_dead_zone()
    print('Estimateur — service du Pi\n  http://localhost:%d/?pi\n' % port)
    try:
        with serve.Server(('', port), Handler) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print('\narrêté.')
