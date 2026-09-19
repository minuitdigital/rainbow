"""
Equirectangular greyscale earth texture + terrain mask, for GPU reprojection.

The browser reprojects per pixel, so we no longer bake an Equal Earth PNG:
we ship the plate carree source and let the shader do the work. That is what
makes zooming sharpen instead of blur.
"""
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = HERE                     # les sources téléchargées, à côté du script
OUT = os.path.join(os.path.dirname(HERE), 'data')   # ce que sert la page
os.makedirs(OUT, exist_ok=True)

SRC_W, SRC_H = 10800, 5400
TEX_W, TEX_H = 8192, 4096
MASK_W, MASK_H = 720, 360


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


# ------------------------------------------------------------------ texture
print('rasterising land ...')
is_land = rasterize(f'{DATA}/ne_50m_land.geojson', SRC_W, SRC_H)
is_lake = rasterize(f'{DATA}/ne_50m_lakes.geojson', SRC_W, SRC_H)
is_land = is_land & ~is_lake

print('composing greyscale ...')
relief = Image.open(f'{DATA}/shadedrelief.jpg').convert('L')
if relief.size != (SRC_W, SRC_H):
    relief = relief.resize((SRC_W, SRC_H), Image.LANCZOS)
lum = np.asarray(relief, dtype=np.float32) / 255.0


def big_blur(a, factor):
    im = Image.fromarray((a * 255).astype(np.uint8), 'L')
    small = im.resize((max(1, a.shape[1] // factor), max(1, a.shape[0] // factor)),
                      Image.BOX).filter(ImageFilter.GaussianBlur(2))
    return np.asarray(small.resize((a.shape[1], a.shape[0]), Image.BICUBIC),
                      dtype=np.float32) / 255.0


base = big_blur(lum, 24)
detail = lum - base
shadow = np.clip(-detail * 3.4, 0.0, 1.0) ** 0.85
rugged = big_blur(np.clip(np.abs(detail) * 4.0, 0, 1), 40)
rugged = np.clip((rugged - 0.06) / 0.5, 0.0, 1.0) ** 1.1

land_val = 1.0 - np.clip(shadow * 0.72 + rugged * 0.12, 0.0, 0.88)
sea_t = np.clip((lum - 0.05) / 0.55, 0.0, 1.0)
sea_val = 0.885 + sea_t * 0.060

grey = np.where(is_land, land_val, sea_val)
g8 = np.clip(grey * 255.0 + 0.5, 0, 255).astype(np.uint8)
del lum, base, detail, shadow, rugged, land_val, sea_val, grey, relief

print(f'writing earth.jpg {TEX_W}x{TEX_H} ...')
Image.fromarray(g8, 'L').resize((TEX_W, TEX_H), Image.LANCZOS).save(
    f'{OUT}/earth.jpg', quality=92, optimize=True, progressive=False)
del g8

# ------------------------------------------------------------------ mask
# On cuit directement le coefficient de surface dans la texture, puis on le
# floute : le littoral vaut une prime (averses et trouees s'y croisent), la
# haute mer beaucoup moins. Un champ continu, donc pas d'arete de texel.
print('writing mask.png ...')
land_s = rasterize(f'{DATA}/ne_50m_land.geojson', MASK_W, MASK_H)
near = np.zeros_like(land_s, dtype=bool)
for dj in range(-2, 3):
    for di in range(-2, 3):
        if di == 0 and dj == 0:
            continue
        shifted = np.roll(np.roll(land_s, dj, axis=0), di, axis=1)
        near |= (shifted != land_s)

surface = np.where(near, 1.00, np.where(land_s, 0.82, 0.40)).astype(np.float32)
surf_img = Image.fromarray(np.clip(surface * 255, 0, 255).astype(np.uint8), 'L')
surf_img = surf_img.filter(ImageFilter.GaussianBlur(1.6))
surf_img.save(f'{OUT}/mask.png', optimize=True)
print('done')
