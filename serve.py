# -*- coding: utf-8 -*-
"""
Le serveur de développement. À lancer depuis la racine du dépôt :

    python serve.py

puis http://localhost:8000

Pourquoi pas `python -m http.server` tout court : il laisse le navigateur
mettre les fichiers en cache. Or la page est faite de douze modules qui
s'importent les uns les autres — il suffit que le navigateur reprenne un
seul d'entre eux dans son cache pendant qu'il recharge les autres pour
que la page mélange deux versions et se comporte de façon absurde. On a
perdu une heure là-dessus une fois.

Ce serveur répond donc `no-store` : rien n'est jamais gardé, chaque
rechargement lit le disque. Un peu plus lent, et ça ne ment jamais.

Il fixe aussi les types MIME de `.js` et `.mjs`, parce que sous Windows
`http.server` les lit dans la base de registre, où `.js` est parfois
déclaré `text/plain` — et un module ES servi en `text/plain` est refusé
par le navigateur, sans sniffing ni recours.
"""

import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js':   'application/javascript',
        '.mjs':  'application/javascript',
        '.css':  'text/css',
        '.html': 'text/html',
        '.json': 'application/json',
        '.svg':  'image/svg+xml',
        '.png':  'image/png',
        '.jpg':  'image/jpeg',
        '.jpeg': 'image/jpeg',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Une ligne par requête, mais seulement quand ça se passe mal.
        status = args[1] if len(args) > 1 else ''
        if not str(status).startswith('2'):
            sys.stderr.write('  %s %s\n' % (status, args[0]))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    print('Estimateur d\'arcs-en-ciel')
    print('  http://localhost:%d' % PORT)
    print('  sans cache — Ctrl+C pour arrêter\n')
    try:
        with Server(('', PORT), Handler) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print('\narrêté.')
