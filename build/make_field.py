"""
Champ scalaire des aplats, à partir des altitudes réelles (ETOPO 2022, 60").

  0.0 ............ 0.5 ............ 1.0
  fosses          côte          sommets

Les seuils hypsométriques sont cuits DANS le champ : la valeur stockée est
déjà la fraction de palier, si bien que le découpage uniforme du shader tombe
exactement sur les altitudes voulues. Changer les paliers, c'est changer deux
listes ici — rien à toucher dans le shader.

Le trait de côte vient de Natural Earth, pas du signe de l'altitude : les
polders et la vallée de la Mort restent des terres, la Caspienne reste une eau.
"""
import json
import numpy as np
import tifffile
from PIL import Image, ImageDraw, ImageFilter

import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = HERE                     # les sources téléchargées, à côté du script
OUT = os.path.join(os.path.dirname(HERE), 'data')   # ce que sert la page
os.makedirs(OUT, exist_ok=True)

SRC = f'{DATA}/etopo.tif'          # 21600 x 10800, float32, mètres
GW, GH = 10800, 5400               # grille de travail (source / 2)
TW, TH = 8192, 4096                # texture finale

# paliers, en mètres — huit bandes sur terre, sept en mer
LAND = [0, 100, 300, 700, 1200, 2000, 3000, 4200, 5600]
SEA  = [0, 200, 1000, 2500, 3500, 4500, 5500, 7000]


def rasterize(path, w, h):
    img = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(img)

    def px(ring):
        return [((lon + 180.0) / 360.0 * w, (90.0 - lat) / 180.0 * h)
                for lon, lat in ring]

    def draw_poly(poly):
        d.polygon(px(poly[0]), fill=255)
        for hole in poly[1:]:
            d.polygon(px(hole), fill=0)

    gj = json.load(open(path))
    for feat in gj['features']:
        g = feat.get('geometry')
        if not g:
            continue
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for poly in polys:
            draw_poly(poly)
    return np.asarray(img, dtype=np.uint8) > 127


# ------------------------------------------------------------------ altitude
print('lecture ETOPO ...')
src = tifffile.imread(SRC)                       # (10800, 21600) float32
print('  ', src.shape, src.dtype, f'{src.min():.0f} à {src.max():.0f} m')

print('sous-échantillonnage 2x ...')
elev = np.empty((GH, GW), dtype=np.float32)
STEP = 540
for r in range(0, GH, STEP):
    r1 = min(r + STEP, GH)
    blk = src[r*2:r1*2].reshape(r1 - r, 2, GW, 2)
    elev[r:r1] = blk.mean(axis=(1, 3), dtype=np.float32)
del src

# un léger lissage évite des courbes de niveau nerveuses à 2 km de maille
# (PIL ne floute pas le mode 'F' : noyau séparable [1,2,1] à la main)
def smooth(a):
    b = a.copy()
    b[:, 1:-1] = (a[:, :-2] + 2.0 * a[:, 1:-1] + a[:, 2:]) * 0.25
    b[:, 0] = (a[:, -1] + 2.0 * a[:, 0] + a[:, 1]) * 0.25       # la carte boucle
    b[:, -1] = (a[:, -2] + 2.0 * a[:, -1] + a[:, 0]) * 0.25
    c = b.copy()
    c[1:-1, :] = (b[:-2, :] + 2.0 * b[1:-1, :] + b[2:, :]) * 0.25
    return c

elev = smooth(smooth(elev))

# ------------------------------------------------------------------ terre/mer
print('trait de côte ...')
land = rasterize(f'{DATA}/ne_50m_land.geojson', GW, GH)
lake = rasterize(f'{DATA}/ne_50m_lakes.geojson', GW, GH)
land = land & ~lake

# ------------------------------------------------------------------ champ
print('paliers ...')
fpL = np.linspace(0.0, 1.0, len(LAND), dtype=np.float32)
fpS = np.linspace(0.0, 1.0, len(SEA), dtype=np.float32)
field = np.empty((GH, GW), dtype=np.float32)
for r in range(0, GH, STEP):
    r1 = min(r + STEP, GH)
    e = elev[r:r1]
    up = np.interp(np.clip(e, 0, None), LAND, fpL).astype(np.float32)
    dn = np.interp(np.clip(-e, 0, None), SEA, fpS).astype(np.float32)
    field[r:r1] = np.where(land[r:r1], 0.5 + up * 0.5, 0.5 - dn * 0.5)
del elev, land, lake

print(f'écriture field.png {TW}x{TH} ...')
img = Image.fromarray(np.clip(field * 255 + 0.5, 0, 255).astype(np.uint8), 'L')
del field
img.resize((TW, TH), Image.LANCZOS).save(f'{OUT}/field.png', optimize=True)
print('fait')
