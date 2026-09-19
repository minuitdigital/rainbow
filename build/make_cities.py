# -*- coding: utf-8 -*-
"""
cities.js — les lieux habités, gradués par zoom.

Le projet n'a pas de frontières : une frontière ne dit pas où est quelqu'un,
une ville si. « L'arc est à 40 km de Valparaíso » est la phrase que la carte
cherche ; « l'arc est au Chili » ne l'est pas.

Source : Natural Earth 1:10 m populated places (domaine public), noms français
quand ils existent, pays en français via ne_50m_admin_0_countries.

Chaque ville reçoit un PALIER (0 à 5) qui dit à partir de quel zoom elle a le
droit d'exister. Le palier vient du rang de la ville, pas de sa population
brute : une capitale de 40 000 habitants est un repère, une banlieue d'un
million n'en est pas un.

    palier 0  capitales nationales, mégapoles      dès le monde entier
    palier 1  > 1 M                                 à partir de ×1,8
    palier 2  > 500 k                               à partir de ×3
    palier 3  > 300 k                               à partir de ×5
    palier 4  > 150 k                               à partir de ×9
    palier 5  > 50 k                                à partir de ×16

La page applique ensuite un écartement en pixels : le palier ne fait que
limiter le vivier, c'est la densité à l'écran qui décide vraiment.

Sortie : deux chaînes. La table des pays, un par ligne, et les villes, une
par ligne :
    nom\tlon\tlat\tpalier\tindex du pays en base 36
lon/lat à trois décimales (110 m — sous le pixel même à ×32).
Le pays n'est pas écrit en toutes lettres 4 000 fois : « Inde » reviendrait
200 fois. Cinquante kilo-octets d'économie pour une ligne de code de plus.
"""

import json
import os
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), 'data')
os.makedirs(DATA, exist_ok=True)

PLACES    = os.path.join(HERE, 'ne_10m_populated_places.geojson')
COUNTRIES = os.path.join(HERE, 'ne_50m_admin_0_countries.geojson')
OUT       = os.path.join(DATA, 'cities.js')

# seuils de population pour les villes qui ne sont pas capitales
TIERS = [(3_000_000, 0), (1_000_000, 1), (500_000, 2),
         (300_000, 3), (150_000, 4), (50_000, 5)]

# Le palier le plus fin embarqué. 5 => 4 235 villes (~110 Ko) ;
# 4 => 2 512 villes (~65 Ko) si le poids devient un problème.
MAX_TIER = 5

# Natural Earth donne le nom protocolaire. Sur une carte, on veut le nom court.
SHORT = {
    'CHN': 'Chine',
    'COD': 'Congo-Kinshasa',
    'COG': 'Congo-Brazzaville',
    'PRK': 'Corée du Nord',
    'KOR': 'Corée du Sud',
    'LAO': 'Laos',
    'SYR': 'Syrie',
    'TZA': 'Tanzanie',
    'VEN': 'Venezuela',
    'IRN': 'Iran',
    'BOL': 'Bolivie',
    'MKD': 'Macédoine du Nord',
    'CAF': 'Centrafrique',
    'DOM': 'République dominicaine',
}


def french_countries():
    """ADM0_A3 -> nom français du pays."""
    with open(COUNTRIES, encoding='utf-8') as fh:
        data = json.load(fh)
    out = {}
    for feat in data['features']:
        p = feat['properties']
        a3 = p.get('ADM0_A3') or p.get('ISO_A3')
        fr = SHORT.get(a3) or p.get('NAME_FR') or p.get('NAME')
        if a3 and fr:
            out[a3] = fr
    return out


def tier_of(p):
    # Une capitale nationale est un repère quelle que soit sa taille.
    if p.get('ADM0CAP') == 1:
        return 0
    pop = p.get('POP_MAX') or 0
    for threshold, tier in TIERS:
        if pop >= threshold:
            return tier
    return None            # trop petite, on ne l'embarque pas


def clean(name):
    # Les tabulations et sauts de ligne sont nos séparateurs ; on s'en assure.
    return ' '.join((name or '').split())


def main():
    with open(PLACES, encoding='utf-8') as fh:
        places = json.load(fh)['features']
    fr_country = french_countries()

    rows = []
    for feat in places:
        p = feat['properties']
        tier = tier_of(p)
        if tier is None or tier > MAX_TIER:
            continue

        name = clean(p.get('NAME_FR') or p.get('NAME') or p.get('NAMEASCII'))
        if not name:
            continue

        lon = p.get('LONGITUDE')
        lat = p.get('LATITUDE')
        if lon is None or lat is None:
            lon, lat = feat['geometry']['coordinates'][:2]

        a3 = p.get('ADM0_A3')
        country = clean(fr_country.get(a3) or p.get('ADM0NAME') or '')

        rows.append((tier, -(p.get('POP_MAX') or 0), name,
                     round(float(lon), 3), round(float(lat), 3), country))

    # triées par palier puis par poids : la page peut s'arrêter de lire tôt,
    # et l'ordre de placement est déjà l'ordre d'importance.
    rows.sort(key=lambda r: (r[0], r[1], strip_accents(r[2])))

    # table des pays, dans l'ordre de première apparition
    index, table = {}, []
    for row in rows:
        c = row[5]
        if c not in index:
            index[c] = len(table)
            table.append(c)

    lines = []
    for tier, _, name, lon, lat, country in rows:
        lines.append('\t'.join([name, fmt(lon), fmt(lat), str(tier),
                                base36(index[country])]))

    payload = (
        '// Lieux habités — Natural Earth 1:10 m (domaine public).\n'
        '// Généré par build/make_cities.py, ne pas éditer à la main.\n'
        '// c : les pays, un par ligne.\n'
        '// d : nom, lon, lat, palier (0 = capitale/mégapole … 5 = > 50 000\n'
        '//     habitants), index du pays en base 36. Trié par importance.\n'
        'export const CITIES = {\n  c: "%s",\n  d: "%s"\n};\n'
        % ('\\n'.join(table), '\\n'.join(lines))
    )

    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(payload)

    per_tier = {}
    for r in rows:
        per_tier[r[0]] = per_tier.get(r[0], 0) + 1
    print('%d villes, %.0f Ko' % (len(rows), os.path.getsize(OUT) / 1024))
    for t in sorted(per_tier):
        print('  palier %d : %d' % (t, per_tier[t]))


def base36(n):
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    if n == 0:
        return '0'
    out = ''
    while n:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out


def fmt(v):
    s = ('%.3f' % v).rstrip('0').rstrip('.')
    return s if s not in ('', '-0') else '0'


def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn')


if __name__ == '__main__':
    main()
