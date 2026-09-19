# -*- coding: utf-8 -*-
"""
Recolle tout le site en un seul index.html autonome.

Le projet est fait de modules ES : c'est ce qui le rend lisible, mais un
fichier unique reste utile deux fois — pour publier la page en Artifact
Claude, et plus tard pour le rendu serveur vers l'écran e-ink, où il n'y
aura ni serveur HTTP ni résolution d'imports.

    python build/bundle.py            -> dist/index.html

CE QUE LE RECOLLEUR SUPPOSE, et qui doit rester vrai :

  1. L'ordre des modules ci-dessous est un ordre topologique : un module
     ne dépend que de ceux qui le précèdent. C'est déjà la règle du
     projet, le recolleur ne fait que s'y appuyer.
  2. Tous les exports sont NOMMÉS (`export const`, `export function`,
     `export let`) et les noms sont uniques dans tout le projet. Pas
     d'`export default`, pas d'`import * as`. C'est pourquoi map.js
     exporte `initMap` et `paint` plutôt que `init` et `draw` : un nom
     un peu plus long, contre un recolleur de quarante lignes qui ne
     renomme rien.
  3. Les images restent des fichiers à côté : les inliner en base64
     ajouterait 16 Mo au HTML. Le recolleur réécrit donc leurs chemins.

Si l'une de ces règles est enfreinte, le recolleur s'arrête en le disant
plutôt que de produire un fichier silencieusement cassé.
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DIST = os.path.join(ROOT, 'dist')

# Ordre topologique. Les données d'abord : elles ne dépendent de rien.
ORDER = [
    'data/coast.js',
    'data/terrain.js',
    'data/cities.js',
    'src/projection.js',
    'src/sky.js',
    'src/ground.js',
    'src/view.js',
    'src/zones.js',
    'src/shader.js',
    'src/map.js',
    'src/ink.js',
    'src/chrome.js',
    'src/main.js',
]

IMPORT = re.compile(r'^\s*import\s[^;]*?;\s*$', re.M | re.S)
EXPORT = re.compile(r'^(\s*)export\s+(const|let|var|function|class)\b', re.M)
FORBIDDEN = re.compile(r'export\s+default|import\s*\*\s*as|export\s*\{')


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as fh:
        return fh.read()


def strip(rel, src):
    """Retire les imports, dénude les exports. Le reste ne bouge pas."""
    if FORBIDDEN.search(src):
        sys.exit('%s : export default / import * as / export { } — '
                 'le recolleur ne sait pas les traiter.' % rel)
    return EXPORT.sub(r'\1\2', IMPORT.sub('', src))


def main():
    parts = []
    for rel in ORDER:
        parts.append('// ' + '=' * 70 + '\n// %s\n// %s\n%s'
                     % (rel, '=' * 70, strip(rel, read(rel))))

    js = '\n\n'.join(parts)
    css = read('style.css')
    html = read('index.html')

    LINK = '<link rel="stylesheet" href="style.css">'
    SCRIPT = '<script type="module" src="src/main.js"></script>'
    if html.count(LINK) != 1 or html.count(SCRIPT) != 1:
        sys.exit('index.html : les balises attendues ont changé, '
                 'le recolleur ne sait plus où insérer.')

    html = html.replace(LINK, '<style>\n%s\n</style>' % css)
    html = html.replace(SCRIPT, '<script>\n(() => {\n%s\n})();\n</script>' % js)

    # Les images restent dehors : les inliner ajouterait 16 Mo.
    html = html.replace("'data/", "'")

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, 'index.html')
    with open(out, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(html)

    print('dist/index.html — %.0f Ko' % (os.path.getsize(out) / 1024))
    print('à servir avec field.png, earth.jpg et mask.png à côté.')


if __name__ == '__main__':
    main()
