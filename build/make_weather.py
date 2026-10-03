# La vraie météo : `python build/make_weather.py`.
#
# Relève chez Open-Meteo la pluie et le rayonnement direct sur toute la Terre
# et en fait une image (data/weather.png). Tourne sur le robot GitHub, jamais
# sur le tableau. Pas la nébulosité : un ciel couvert peut laisser passer un
# soleil rasant ; `direct_radiation` mesure la trouée.
# Canal R : pluie DILATÉE (maximum des voisines) — l'arc se voit à côté de
# l'averse, pas dessous. G : clarté directe. B : pluie locale.

import json
import math
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_PNG = ROOT / "data" / "weather.png"
OUT_JSON = ROOT / "data" / "weather.json"

# --------------------------------------------------------------- la grille
#
# QUATRE DEGRÉS : le plus fin qui tienne en une passe. Le serveur compte un
# appel par coordonnée (pas ce que dit la formule publiée), et le plafond
# qui borne la maille est celui de 5 000 appels/HEURE (10 000/jour, 600/min).
# 4° = 4 050 points. Plus fin exigerait une autre source (GRIB2 de la NOAA).
STEP_DEG = 4.0

NX = int(round(360 / STEP_DEG))
NY = int(round(180 / STEP_DEG))
# Centres de case, et non coins : à 4°, -178 ... 178 et -88 ... 88.
LONS = np.arange(NX) * STEP_DEG - 180 + STEP_DEG / 2
LATS = np.arange(NY) * STEP_DEG - 90 + STEP_DEG / 2

# Hier, aujourd'hui et deux jours devant : si le robot rate un passage,
# le tableau tient encore le lendemain.
PAST_DAYS, FORECAST_DAYS = 1, 3
NHOURS = (PAST_DAYS + FORECAST_DAYS) * 24

# Pas de trois heures : la page interpole, 96 h / 3 = 32 pas.
STEP_H = 3
NT = NHOURS // STEP_H

# 1000 points est le maximum documenté, mais l'URL dépasserait 8 000
# caractères (414). 200 laisse de la marge ; `fetch` coupe sinon.
CHUNK = 200

# Un point = un appel : c'est ce que le serveur compte (voir la grille).
WEIGHT_PER_POINT = 1.0

# 600 appels/minute : 20 s de pause après 200 points ; 1,15 de marge, car
# un refus coûte une minute entière.
RATE_PER_MIN = 600
PAUSE_S = CHUNK * WEIGHT_PER_POINT / RATE_PER_MIN * 60 * 1.15

API = "https://api.open-meteo.com/v1/forecast"
HOURLY = "precipitation,direct_radiation"


def fetch(lats, lons, tries=4):
    """Un lot de coordonnées, rendu comme une liste de sites.

        414  URL trop longue : on coupe le lot en deux.
        429  quota minuté : on attend, on ne coupe pas (deux fois plus de requêtes).
        le reste  hoquet réseau : on patiente et on retente.
    """
    url = (f"{API}?latitude={','.join(f'{v:.1f}' for v in lats)}"
           f"&longitude={','.join(f'{v:.1f}' for v in lons)}"
           f"&hourly={HOURLY}&past_days={PAST_DAYS}"
           f"&forecast_days={FORECAST_DAYS}&timezone=UTC")

    attempt = 0
    waited = 0
    while True:
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = json.load(r)
            # Open-Meteo répond parfois 200 avec {"error": true} : le reconnaître
            # ici plutôt qu'en KeyError bien plus loin.
            if isinstance(data, dict) and data.get("error"):
                raise RuntimeError("Open-Meteo refuse : "
                                   + str(data.get("reason", "sans raison")))

            # Un lot d'un seul point rend un objet (la découpe peut y descendre).
            return data if isinstance(data, list) else [data]

        except urllib.error.HTTPError as e:
            if e.code == 414 and len(lats) > 1:
                h = len(lats) // 2
                print(f"    URL trop longue, lot coupé en {h} + {len(lats) - h}",
                      file=sys.stderr)
                return (fetch(lats[:h], lons[:h], tries)
                        + fetch(lats[h:], lons[h:], tries))
            if e.code == 429:
                # Attendre n'est pas échouer : pause croissante, non comptée
                # comme tentative (60 s pour la limite minutée, plus pour l'horaire).
                waited += 1
                pause = min(60 * waited, 600)
                print(f"    quota atteint, pause de {pause // 60} min "
                      f"({waited}{'re' if waited == 1 else 'e'} fois)",
                      file=sys.stderr)
                if waited > 12:
                    raise RuntimeError(
                        "quota épuisé : la maille est trop fine pour le "
                        "plafond horaire. Élargis STEP_DEG.")
                time.sleep(pause)
                continue

            attempt += 1
            if attempt >= tries:
                raise
            wait = 15 * attempt
            print(f"    hoquet HTTP {e.code}, nouvelle tentative dans {wait} s",
                  file=sys.stderr)
            time.sleep(wait)

        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            attempt += 1
            if attempt >= tries:
                raise
            wait = 15 * attempt
            print(f"    hoquet ({e}), nouvelle tentative dans {wait} s",
                  file=sys.stderr)
            time.sleep(wait)


def gather():
    """Les deux champs bruts, en (NY, NX, NHOURS), et l'heure du premier
    pas. Les réponses arrivent dans l'ordre des coordonnées demandées, dans
    l'ordre de lecture de la grille."""
    glat, glon = np.meshgrid(LATS, LONS, indexing="ij")
    flat_lat, flat_lon = glat.ravel(), glon.ravel()
    total = flat_lat.size

    rain = np.zeros((total, NHOURS), dtype=np.float32)
    direct = np.zeros((total, NHOURS), dtype=np.float32)
    t0 = None

    nchunks = (total + CHUNK - 1) // CHUNK
    started = time.time()

    for c in range(nchunks):
        a, b = c * CHUNK, min((c + 1) * CHUNK, total)

        if c:
            left = (time.time() - started) / c * (nchunks - c) / 60
            eta = f"  ~{left:.0f} min restantes"
        else:
            eta = ""
        print(f"  lot {c + 1}/{nchunks}{eta}", flush=True)

        data = fetch(flat_lat[a:b], flat_lon[a:b])

        if len(data) != b - a:
            print(f"    {len(data)} sites reçus pour {b - a} demandés",
                  file=sys.stderr)

        for i, site in enumerate(data):
            # Un lot plus long que demandé : on jette le surplus.
            if a + i >= total:
                break
            h = site.get("hourly")
            if not h or "time" not in h:
                print(f"    point {a + i} sans données horaires, ignoré",
                      file=sys.stderr)
                continue
            if t0 is None:
                t0 = h["time"][0]
            n = min(NHOURS, len(h["time"]))
            # `None` sur une variable manquante : zéro, le neutre honnête.
            rain[a + i, :n] = [v or 0.0 for v in h["precipitation"][:n]]
            direct[a + i, :n] = [v or 0.0 for v in h["direct_radiation"][:n]]

        if c < nchunks - 1:
            time.sleep(PAUSE_S)

    return (rain.reshape(NY, NX, NHOURS),
            direct.reshape(NY, NX, NHOURS),
            t0)


# ------------------------------------------------------------- le soleil
#
# LA MÊME FORMULE QUE src/sky.js : si l'une bouge, l'autre aussi, sinon la
# page éclaire des endroits où il fait nuit.

def sun_elevation(lat, lon, when):
    """Hauteur du soleil en degrés, en (NY, NX)."""
    n = when.timetuple().tm_yday + when.hour / 24 + when.minute / 1440
    decl = -23.44 * math.cos(2 * math.pi * (n + 10) / 365.24)
    utc = when.hour + when.minute / 60
    sublon = -15 * (utc - 12)

    d, p = math.radians(decl), np.radians(lat)
    hh = np.radians(lon - sublon)
    s = np.sin(p) * math.sin(d) + np.cos(p) * math.cos(d) * np.cos(hh)
    return np.degrees(np.arcsin(np.clip(s, -1, 1)))


def clear_sky_direct(elev_deg):
    """Rayonnement direct par ciel clair, sur plan horizontal, en W/m²
    (masse d'air, Meinel). Sans ce dénominateur variable, la clarté serait
    faible partout au lever et au coucher : justement l'heure des arcs."""
    s = np.sin(np.radians(np.clip(elev_deg, 0.0, 90.0)))
    # Masse d'air bornée : 1/sin explose à l'horizon.
    am = np.clip(1.0 / np.maximum(s, 1e-3), 1.0, 38.0)
    return 1361.0 * np.power(0.7, np.power(am, 0.678)) * s


def encode(rain, direct, t0_iso):
    """Les trois canaux, en (NY, NX, NT, 3) octets."""
    t0 = datetime.fromisoformat(t0_iso.replace("Z", "+00:00"))
    if t0.tzinfo is None:
        t0 = t0.replace(tzinfo=timezone.utc)

    glat, glon = np.meshgrid(LATS, LONS, indexing="ij")

    # --- la clarté, heure par heure
    clear = np.zeros_like(direct)
    for k in range(NHOURS):
        elev = sun_elevation(glat, glon, t0 + timedelta(hours=k))
        top = clear_sky_direct(elev)
        # Seuil bas, délibéré : 3 W correspondent à un soleil à 2,7°, où les
        # arcs se lèvent déjà. Le plancher du dénominateur évite la division
        # par zéro de la face nuit (np.where évalue les deux branches).
        clear[:, :, k] = np.where(top > 3.0,
                                  np.clip(direct[:, :, k] / np.maximum(top, 1e-3),
                                          0.0, 1.0),
                                  0.0)

    # --- la pluie dilatée : maximum des huit voisines et d'elle-même.
    # La longitude s'enroule, la latitude non.
    spread = rain.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            shifted = np.roll(rain, dx, axis=1)
            if dy:
                shifted = np.roll(shifted, dy, axis=0)
                if dy > 0:
                    shifted[0] = rain[0]
                else:
                    shifted[-1] = rain[-1]
            spread = np.maximum(spread, shifted)

    # --- de millimètres par heure à une intensité de 0 à 1.
    # Exponentielle plutôt que seuil : 1 mm/h -> 0,57 ; 3 mm/h -> 0,92.
    wet = lambda mm: 1.0 - np.exp(-np.maximum(mm, 0.0) / 1.2)

    # --- pas de trois heures : MAXIMUM pour la pluie (une averse d'une heure
    # compte entière), MOYENNE pour la clarté.
    fold = lambda a: a.reshape(NY, NX, NT, STEP_H)
    r = wet(fold(spread).max(axis=3))
    g = fold(clear).mean(axis=3)
    b = wet(fold(rain).max(axis=3))

    out = np.empty((NY, NX, NT, 3), dtype=np.uint8)
    for i, ch in enumerate((r, g, b)):
        out[:, :, :, i] = np.clip(ch * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return out


def write(cube, t0_iso):
    """L'atlas, empilé verticalement (360 x 5 760) : chaque pas de temps
    reste contigu, la page le découpe sans recopie.

    La ligne 0 est la latitude -89,5 : l'image paraît à l'envers, c'est
    voulu. Le shader lit v = (lat + 90) / 180 ; la retourner inverserait
    les hémisphères."""
    # (NY, NX, NT, 3) -> (NT, NY, NX, 3) -> (NT*NY, NX, 3)
    atlas = np.transpose(cube, (2, 0, 1, 3)).reshape(NT * NY, NX, 3)
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(atlas, mode="RGB").save(OUT_PNG, optimize=True)

    # Le Z est obligatoire : Open-Meteo rend « 2026-09-21T00:00 » sans fuseau,
    # et Date.parse le lirait en heure locale du spectateur.
    stamp = t0_iso
    if not stamp.endswith("Z"):
        if len(stamp) == 16:        # « 2026-09-21T00:00 », les secondes manquent
            stamp += ":00"
        stamp += "Z"

    meta = {
        "t0": stamp,
        "nx": NX, "ny": NY, "nt": NT, "step_h": STEP_H,
        "made": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "canaux": {"r": "pluie du voisinage", "g": "clarte directe",
                   "b": "pluie locale"},
        "source": "Open-Meteo.com, CC-BY 4.0"
    }
    OUT_JSON.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    ko = OUT_PNG.stat().st_size / 1024
    print(f"\n{OUT_PNG.relative_to(ROOT)}  {NX}x{NT * NY}  {ko:.0f} Ko")
    print(f"{OUT_JSON.relative_to(ROOT)}  t0 = {t0_iso}, {NT} pas de {STEP_H} h")


# ------------------------------------------------- ne pas relever pour rien
#
# Le quota quotidien est partagé avec d'autres sur les machines GitHub : un
# relevé peut échouer au dernier lot. Le robot repasse donc ; seul le premier
# passage utile consomme.

def already_fresh(max_age_h=20):
    """Un relevé de moins de vingt heures existe-t-il déjà ?
    Vingt et non vingt-quatre : sinon le relevé de 4 h 10 bloquerait celui
    du lendemain à la même heure."""
    try:
        meta = json.loads(OUT_JSON.read_text(encoding="utf-8"))
        made = datetime.fromisoformat(meta["made"].replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - made).total_seconds() / 3600
        return age < max_age_h, age
    except Exception:
        return False, None


def main():
    # Passages de rattrapage du robot. À la main, on relève toujours.
    if "--si-besoin" in sys.argv:
        fresh, age = already_fresh()
        if fresh:
            print(f"Relevé déjà frais ({age:.1f} h) — rien à faire.")
            return

    n = NX * NY
    chunks = (n + CHUNK - 1) // CHUNK
    minutes = n * WEIGHT_PER_POINT / RATE_PER_MIN * 1.15

    print(f"Open-Meteo : grille de {STEP_DEG}°, {NX}x{NY} = {n} points")
    print(f"  {NHOURS} h au pas de {STEP_H} h, soit {NT} images")
    print(f"  {chunks} requêtes de {CHUNK} points, {PAUSE_S:.0f} s entre chacune")
    print(f"  quota : {n:.0f} appels sur les 10 000 du jour "
          f"({n / 100:.0f} %), environ {minutes:.0f} min")
    if n > 5000:
        print(f"\n  ATTENTION : {n} points dépassent le plafond HORAIRE de "
              f"5 000.\n  Le relevé s'arrêtera en route. Élargis STEP_DEG.",
              file=sys.stderr)
    print()

    started = time.time()
    rain, direct, t0 = gather()
    if t0 is None:
        sys.exit("aucune donnée reçue")
    print(f"\n  reçu en {(time.time() - started) / 60:.1f} min, t0 = {t0}")
    write(encode(rain, direct, t0), t0)


def guarded():
    """Une ligne `::error::` : sur GitHub, l'échec se lit dans les annotations."""
    try:
        main()
    except Exception as e:
        print(f"::error::relevé météo interrompu : {type(e).__name__} — {e}",
              file=sys.stderr)
        raise


if __name__ == "__main__":
    # Maille d'essai : `python build/make_weather.py 12` relève 12° en
    # quelques secondes ; carte inutilisable, mais toute la chaîne se vérifie.
    # Les drapeaux (--si-besoin, passé par le robot) ne sont pas une maille.
    pas = [a for a in sys.argv[1:] if not a.startswith("--")]
    if pas:
        STEP_DEG = float(pas[0])
        NX = int(round(360 / STEP_DEG))
        NY = int(round(180 / STEP_DEG))
        LONS = np.arange(NX) * STEP_DEG - 180 + STEP_DEG / 2
        LATS = np.arange(NY) * STEP_DEG - 90 + STEP_DEG / 2
        PAUSE_S = CHUNK * WEIGHT_PER_POINT / RATE_PER_MIN * 60 * 1.15
        print(f"[maille d'essai : {STEP_DEG}°]\n")
    guarded()
