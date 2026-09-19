"""
Carte du sol, pour les étiquettes : accessibilité et dégagement de l'horizon.

Un arc-en-ciel n'existe pas à un endroit, il existe pour un observateur. Deux
facteurs en découlent :

  accessibilité  peut-on seulement être là ? pleine mer, calotte, haute
                 altitude comptent contre
  dégagement     l'horizon est-il ouvert ? une plaine ou une côte valent mieux
                 qu'une vallée encaissée

Sortie : terrain.js, 360 x 180 octets encodés en base64, un octet par degré
carré — quartet haut = accessibilité, quartet bas = dégagement.
"""
import base64, json
import numpy as np
import tifffile
from PIL import Image, ImageDraw

DATA = '/home/claude/rainbow/data'
OUT = '/home/claude/rainbow/site'

MW, MH = 360, 180          # grille de sortie, un degré
RW, RH = 2160, 1080        # grille de travail pour le relief local


def rasterize(path, w, h):
    img = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(img)

    def px(ring):
        return [((lon + 180.0) / 360.0 * w, (90.0 - lat) / 180.0 * h)
                for lon, lat in ring]

    gj = json.load(open(path))
    for feat in gj['features']:
        g = feat.get('geometry')
        if not g:
            continue
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for poly in polys:
            d.polygon(px(poly[0]), fill=255)
            for hole in poly[1:]:
                d.polygon(px(hole), fill=0)
    return np.asarray(img, dtype=np.uint8) > 127


print('lecture ETOPO ...')
src = tifffile.imread(f'{DATA}/etopo.tif')          # 21600 x 10800
f = src.shape[1] // RW                              # 10
elev = src[:RH * (src.shape[0] // RH)].reshape(RH, src.shape[0] // RH, RW, f) \
          .mean(axis=(1, 3), dtype=np.float32)
del src
print('  grille de travail', elev.shape)

# ------------------------------------------------------------------ dégagement
# amplitude du relief dans un voisinage de 5 cases (~1000 km... non : ~90 km)
print('relief local ...')
hi = elev.copy()
lo = elev.copy()
for dj in (-2, -1, 0, 1, 2):
    for di in (-2, -1, 0, 1, 2):
        s = np.roll(np.roll(elev, dj, axis=0), di, axis=1)
        np.maximum(hi, s, out=hi)
        np.minimum(lo, s, out=lo)
rng = hi - lo
del hi, lo

# vers la grille de sortie
k = RW // MW                                        # 6
rng = rng.reshape(MH, RH // MH, MW, k).mean(axis=(1, 3))
el = elev.reshape(MH, RH // MH, MW, k).mean(axis=(1, 3))
del elev

# 0 m d'amplitude = horizon parfaitement ouvert ; 1200 m = vallée encaissée
openness = np.clip(1.0 - rng / 1200.0, 0.0, 1.0) ** 0.8

# ------------------------------------------------------------------ accès
print('accessibilité ...')
land = rasterize(f'{DATA}/ne_50m_land.geojson', MW, MH)
lat = (np.arange(MH, dtype=np.float32)[:, None] + 0.5)
lat = 90.0 - lat * (180.0 / MH)
lat = np.repeat(lat, MW, axis=1)

acc = np.where(land, 1.0, 0.22).astype(np.float32)
acc *= np.clip(1.0 - (el - 2200.0) / 4200.0, 0.30, 1.0)      # haute altitude
acc *= np.clip(1.0 - (np.abs(lat) - 62.0) / 26.0, 0.35, 1.0)  # hautes latitudes
acc = np.clip(acc, 0.0, 1.0)

# ------------------------------------------------------------------ paquet
hi4 = np.clip(np.round(acc * 15), 0, 15).astype(np.uint8)
lo4 = np.clip(np.round(openness * 15), 0, 15).astype(np.uint8)
packed = ((hi4 << 4) | lo4).astype(np.uint8)

b64 = base64.b64encode(packed.tobytes()).decode()
with open(f'{OUT}/terrain.js', 'w') as fh:
    fh.write('window.TERRAIN={w:%d,h:%d,d:"%s"};\n' % (MW, MH, b64))
print('terrain.js', len(b64), 'caractères')
