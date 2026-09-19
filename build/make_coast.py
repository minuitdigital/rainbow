"""Coastlines: finer simplification + per-ring bbox for culling, flat arrays."""
import json

DATA = '/home/claude/rainbow/data'
OUT = '/home/claude/rainbow/site'
TOL = 0.012          # degrees — fine enough to stay crisp when zoomed in
MIN_AREA = 0.0012
Q = 3


def dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    t2 = tol * tol
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        ax, ay = pts[i]; bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        best, bi = -1.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if den == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / den
                t = 0.0 if t < 0 else 1.0 if t > 1 else t
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best:
                best, bi = d, k
        if best > t2:
            keep[bi] = True
            stack.append((i, bi)); stack.append((bi, j))
    return [p for p, k in zip(pts, keep) if k]


def area(ring):
    s = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def collect(path, tol, min_area):
    out = []
    gj = json.load(open(path))
    for feat in gj['features']:
        g = feat.get('geometry')
        if not g:
            continue
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for poly in polys:
            for ring in poly:
                if area(ring) < min_area:
                    continue
                r = dp([(float(a), float(b)) for a, b in ring], tol)
                if len(r) < 4:
                    continue
                lons = [p[0] for p in r]; lats = [p[1] for p in r]
                flat = []
                for a, b in r:
                    flat.append(round(a, Q)); flat.append(round(b, Q))
                out.append({
                    'b': [round(min(lons), 2), round(max(lons), 2),
                          round(min(lats), 2), round(max(lats), 2)],
                    'p': flat,
                })
    return out


coast = collect(f'{DATA}/ne_50m_land.geojson', TOL, MIN_AREA)
lakes = collect(f'{DATA}/ne_50m_lakes.geojson', TOL, 0.02)

with open(f'{OUT}/coast.js', 'w') as f:
    f.write('window.COAST=' +
            json.dumps({'coast': coast, 'lakes': lakes}, separators=(',', ':')) + ';\n')

print('coast rings', len(coast), 'pts', sum(len(r['p']) // 2 for r in coast))
print('lake rings ', len(lakes), 'pts', sum(len(r['p']) // 2 for r in lakes))
