# =========================================================================
#  LA VRAIE MÉTÉO
#
#      python build/make_weather.py
#
#  Va chercher chez Open-Meteo la pluie et le rayonnement direct sur toute
#  la Terre, et en fait UNE IMAGE que la page charge comme elle charge
#  field.png. Rien d'autre ne change : pas de clé, pas de serveur, pas
#  d'appel réseau depuis le tableau. Le Pi accroché au mur télécharge un
#  fichier statique, une fois par jour, et c'est tout.
#
#  CE SCRIPT NE TOURNE JAMAIS SUR LE TABLEAU. Il tourne une fois par jour
#  sur un robot GitHub, qui publie l'image avec le site. Tout ce qui est
#  cher — les vingt et une requêtes, la hauteur du soleil en quatre cent
#  mille points, la dilatation des averses — est payé là, une fois, par
#  une machine qui n'a que ça à faire.
#
#  ----------------------------------------------------------------------
#  POURQUOI CES DEUX VARIABLES, ET PAS LA COUVERTURE NUAGEUSE
#
#  Un arc-en-ciel demande deux choses en même temps : de l'eau en
#  suspension EN FACE du soleil, et des rayons directs qui arrivent
#  JUSQU'À L'OBSERVATEUR. La couverture nuageuse ne dit ni l'un ni
#  l'autre — un ciel couvert à 90 % peut laisser passer un soleil rasant
#  par une déchirure à l'ouest, et c'est très exactement la situation qui
#  fabrique les plus beaux arcs.
#
#      precipitation      l'eau qui tombe, en millimètres par heure
#      direct_radiation   les rayons DIRECTS reçus au sol, en W/m²
#
#  `direct_radiation` est la mesure de la trouée. Elle dit littéralement
#  « des rayons non interceptés arrivent ici ». Elle remplace la
#  climatologie inventée de gapAt() — deux gaussiennes sur la latitude,
#  qui décrétaient qu'il fait beau sous les tropiques et sur les rails
#  dépressionnaires. C'était joli et c'était faux.
#
#  ----------------------------------------------------------------------
#  LA PLUIE EST DILATÉE, ET C'EST LE CŒUR DU SUJET
#
#  On ne voit pas d'arc-en-ciel DANS l'averse : on est dessous, il pleut,
#  et le ciel est gris. On le voit À CÔTÉ — l'averse devant soi, le soleil
#  derrière. Le canal rouge porte donc le maximum de la pluie sur les huit
#  cases voisines et non la pluie locale : « il pleut quelque part dans
#  les cent kilomètres, et le soleil arrive ici ».
#
#  La pluie locale, elle, est gardée à part dans le canal bleu : les
#  étiquettes de la carte s'en serviront pour distinguer « averse en
#  cours » de « l'averse s'éloigne ».
#
#  Dépendances : numpy, pillow. Rien d'autre — urllib suffit.
# =========================================================================

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
# QUATRE DEGRÉS, soit 444 km. Ce n'est pas un choix esthétique : c'est le
# plafond de ce qu'Open-Meteo laisse prendre en une passe.
#
# LA LEÇON QUI A COÛTÉ UNE SOIRÉE. Leur formule affichée — poids = nLieux
# x (nJours/14) x (nVariables/10) — laisse croire qu'un point coûte 0,057
# appel, donc qu'on pourrait en demander 64 800. En pratique le compteur
# monte d'environ UN PAR COORDONNÉE : un lot de 400 points passe, le
# suivant se fait refuser trois secondes plus tard par la limite de 600
# appels/minute. Le plancher d'un appel par lieu ne se voit nulle part
# dans la documentation ; il se découvre en se prenant des 429.
#
# ET IL Y A UN SECOND PLAFOND, celui qui a fait échouer le relevé de 3° :
# 5 000 appels par HEURE. 7 200 points ne peuvent donc pas tenir dans une
# heure, quelle que soit la pause — les 429 tombent en rafale au bout de
# 5 000, c'est-à-dire aux trois quarts du travail.
#
#     10 000 appels/jour   ->  le quota quotidien
#      5 000 appels/heure  ->  C'EST LUI QUI BORNE LA MAILLE
#        600 appels/minute ->  le rythme, incompressible
#
# 4° donne 4 050 points : 81 % du plafond horaire, 40 % du quotidien, et
# sept minutes de relevé. C'est le plus fin qui tienne en une seule passe.
#
# La finesse manquante est reprise par le bruit fractal, qui continue de
# jouer par-dessus la grille comme texture haute fréquence — c'était déjà
# le plan du §7 de REPRISE, qui visait 5°.
#
# POUR ALLER PLUS FIN, il faudra changer de source : les fichiers GRIB2 de
# la NOAA (GFS, 0,25° natif) donnent tout ce qu'il faut sans quota par
# point, au prix d'une bibliothèque de décodage. Cela ne toucherait QUE ce
# fichier : le format de sortie et tout le reste du projet n'en savent rien.
STEP_DEG = 4.0

NX = int(round(360 / STEP_DEG))
NY = int(round(180 / STEP_DEG))
# Centres de case, et non coins : à 4°, -178 ... 178 et -88 ... 88.
LONS = np.arange(NX) * STEP_DEG - 180 + STEP_DEG / 2
LATS = np.arange(NY) * STEP_DEG - 90 + STEP_DEG / 2

# Quatre jours d'un coup : hier, aujourd'hui, et deux jours devant. Ça fait
# 96 heures, et surtout ça laisse de la marge — si le robot rate un
# passage, le tableau a encore de quoi tenir le lendemain sans rien dire.
PAST_DAYS, FORECAST_DAYS = 1, 3
NHOURS = (PAST_DAYS + FORECAST_DAYS) * 24

# PAS DE TROIS HEURES. Au pas horaire on téléchargerait trois fois plus
# pour une carte qui ne bouge pas trois fois plus vite ; la page interpole
# entre deux pas, et personne ne verra la différence. 96 h / 3 = 32 pas.
STEP_H = 3
NT = NHOURS // STEP_H

# COMBIEN DE POINTS PAR REQUÊTE. Mille est le maximum documenté côté
# Open-Meteo — mais ce n'est pas la limite qui mord. Une coordonnée pèse
# une douzaine de caractères dans l'URL (« -178.5 », « 48.5 », et leurs
# virgules) : à mille points l'adresse fait douze mille caractères, et le
# serveur répond 414, l'URL est trop longue. La limite usuelle est de huit
# mille caractères.
#
# Deux cents laisse une marge confortable. Et si elle ne suffisait pas —
# si Open-Meteo resserrait un jour — `fetch` coupe le lot en deux tout seul
# plutôt que d'échouer.
CHUNK = 200

# CE QUE PÈSE UN POINT : un appel. Voir le commentaire de la grille — ce
# n'est pas ce que la formule publiée laisse croire, c'est ce que le
# serveur compte.
WEIGHT_PER_POINT = 1.0

# LA LIMITE MINUTÉE, et la pause qui en découle. 600 appels par minute,
# donc 600 points : une requête de 200 points doit être suivie de vingt
# secondes de silence. Le facteur 1,15 est la marge — le compteur du
# serveur et notre montre ne sont pas synchronisés, et se faire refuser
# coûte une minute entière d'attente.
RATE_PER_MIN = 600
PAUSE_S = CHUNK * WEIGHT_PER_POINT / RATE_PER_MIN * 60 * 1.15

API = "https://api.open-meteo.com/v1/forecast"
HOURLY = "precipitation,direct_radiation"


def fetch(lats, lons, tries=4):
    """Un lot de coordonnées, rendu comme une LISTE de sites.

    Trois choses peuvent mal tourner, et chacune demande une réponse
    différente — c'est tout l'objet de cette fonction :

        414  l'URL est trop longue. Réessayer à l'identique ne servirait à
             rien : on coupe le lot en deux et on recommence. Le script
             s'adapte donc tout seul si Open-Meteo resserre sa limite.
        429  le quota minuté est dépassé. Là il faut ATTENDRE, pas couper :
             couper ferait deux fois plus de requêtes, donc exactement le
             contraire de ce qu'il faut.
        le reste  un hoquet réseau. On patiente et on retente.

    Un robot qui abandonne au premier ennui ne sert à rien : il n'y aura
    pas de seconde chance avant demain matin.
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
            # Un lot d'un seul point rend un objet et non une liste. On ne
            # devrait jamais tomber dessus — mais la découpe récursive
            # ci-dessous peut très bien y descendre.
            return data if isinstance(data, list) else [data]

        except urllib.error.HTTPError as e:
            if e.code == 414 and len(lats) > 1:
                h = len(lats) // 2
                print(f"    URL trop longue, lot coupé en {h} + {len(lats) - h}",
                      file=sys.stderr)
                return (fetch(lats[:h], lons[:h], tries)
                        + fetch(lats[h:], lons[h:], tries))
            if e.code == 429:
                # ATTENDRE N'EST PAS ÉCHOUER. Un quota qui se recharge n'est
                # pas une panne, et compter ces pauses comme des tentatives
                # faisait abandonner le relevé au bout de quatre minutes —
                # alors qu'il suffisait de patienter. On attend donc aussi
                # longtemps qu'il le faut, en allongeant la pause : soixante
                # secondes si c'est la limite minutée, plusieurs minutes si
                # c'est l'horaire.
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
    pas. Les points sont demandés dans l'ordre de lecture de la grille, ce
    qui permet de reverser les réponses sans chercher : la réponse d'un lot
    arrive dans l'ordre où on a posé les coordonnées."""
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

        # Le temps restant, estimé sur ce qui s'est passé. Sans lui on
        # regarde défiler cent soixante-deux lignes sans savoir si l'on en
        # a pour cinq minutes ou pour une heure.
        if c:
            left = (time.time() - started) / c * (nchunks - c) / 60
            eta = f"  ~{left:.0f} min restantes"
        else:
            eta = ""
        print(f"  lot {c + 1}/{nchunks}{eta}", flush=True)

        data = fetch(flat_lat[a:b], flat_lon[a:b])

        for i, site in enumerate(data):
            h = site["hourly"]
            if t0 is None:
                t0 = h["time"][0]
            n = min(NHOURS, len(h["time"]))
            # `None` arrive sur les variables manquantes d'une maille, et
            # np.float32(None) lève. On remplace par zéro : pas de pluie,
            # pas de soleil — le neutre honnête.
            rain[a + i, :n] = [v or 0.0 for v in h["precipitation"][:n]]
            direct[a + i, :n] = [v or 0.0 for v in h["direct_radiation"][:n]]

        if c < nchunks - 1:
            time.sleep(PAUSE_S)

    return (rain.reshape(NY, NX, NHOURS),
            direct.reshape(NY, NX, NHOURS),
            t0)


# ------------------------------------------------------------- le soleil
#
# LA MÊME FORMULE QUE src/sky.js, au mot près. Si l'une bouge, l'autre
# doit bouger : la clarté calculée ici est divisée par un maximum de ciel
# clair qui dépend de la hauteur du soleil, et si les deux ne s'accordent
# pas, la page éclaire des endroits où il fait nuit.

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
    """Le rayonnement direct qu'on recevrait par ciel parfaitement clair,
    sur plan horizontal, en W/m².

    Modèle de masse d'air (Meinel) : plus le soleil est bas, plus ses
    rayons traversent d'atmosphère, et moins il en arrive. Sans ce
    dénominateur variable, la clarté serait faible PARTOUT au lever et au
    coucher — c'est-à-dire très exactement dans la fenêtre où la porte est
    ouverte, et la carte serait éteinte en permanence.

    C'est le piège de tout ce fichier : normaliser, ou ne rien mesurer."""
    s = np.sin(np.radians(np.clip(elev_deg, 0.0, 90.0)))
    # Masse d'air bornée : à l'horizon 1/sin explose, et la formule perd
    # tout sens en dessous d'un degré et demi.
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
        # LE SEUIL EST BAS, ET C'EST DÉLIBÉRÉ. Sous ce plancher le rapport
        # ne veut plus rien dire et l'on rend zéro. Mais il ne faut pas le
        # monter : trois watts correspondent à un soleil à 2,7°, et la
        # porte y est déjà ouverte à plus de moitié. Un seuil à huit watts
        # l'aurait coupée jusqu'à 3,5° — c'est-à-dire qu'il aurait éteint
        # la météo précisément à l'heure où les arcs se lèvent.
        # np.where évalue ses DEUX branches : sans ce plancher au
        # dénominateur, la division par zéro de la face nuit crierait à
        # chaque pas de temps, pour un résultat de toute façon jeté.
        clear[:, :, k] = np.where(top > 3.0,
                                  np.clip(direct[:, :, k] / np.maximum(top, 1e-3),
                                          0.0, 1.0),
                                  0.0)

    # --- la pluie dilatée : le maximum des huit voisines et d'elle-même.
    # La longitude s'enroule (np.roll fait le tour), la latitude non — aux
    # pôles on se contente de ce qu'on a plutôt que de recoller l'Arctique
    # à l'Antarctique.
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
    # Une exponentielle plutôt qu'un seuil : la bruine compte un peu, et
    # le déluge ne compte pas dix fois plus qu'une bonne averse. À 1 mm/h
    # on est à 0,57, à 3 mm/h à 0,92.
    wet = lambda mm: 1.0 - np.exp(-np.maximum(mm, 0.0) / 1.2)

    # --- le pas de trois heures. MAXIMUM pour la pluie, MOYENNE pour la
    # clarté : une averse d'une heure dans un bloc de trois doit compter
    # entièrement — c'est un événement — tandis qu'un rayon de soleil
    # d'une heure sur trois ne fait pas un après-midi lumineux.
    fold = lambda a: a.reshape(NY, NX, NT, STEP_H)
    r = wet(fold(spread).max(axis=3))
    g = fold(clear).mean(axis=3)
    b = wet(fold(rain).max(axis=3))

    out = np.empty((NY, NX, NT, 3), dtype=np.uint8)
    for i, ch in enumerate((r, g, b)):
        out[:, :, :, i] = np.clip(ch * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return out


def write(cube, t0_iso):
    """L'atlas, empilé VERTICALEMENT : les 32 pas de temps l'un sous
    l'autre, 360 de large sur 5 760 de haut.

    Vertical et pas en damier, pour une raison qui n'a l'air de rien : un
    empilement vertical laisse chaque pas de temps CONTIGU en mémoire. La
    page n'a donc qu'à découper le tableau de pixels en tranches, sans
    recopier ligne à ligne — une opération à coût nul là où un damier
    aurait demandé 32 recopies sur un Raspberry Pi.

    LA LIGNE 0 EST LA LATITUDE -89,5. L'image paraît donc à l'envers si on
    l'ouvre dans une visionneuse : c'est VOULU. La page l'envoie telle
    quelle au processeur graphique, sans retournement, et le shader lit
    v = (lat + 90) / 180 — donc v = 0 doit être le sud. Retourner l'image
    pour qu'elle soit « jolie » mettrait l'Australie au Groenland."""
    # (NY, NX, NT, 3) -> (NT, NY, NX, 3) -> (NT*NY, NX, 3)
    atlas = np.transpose(cube, (2, 0, 1, 3)).reshape(NT * NY, NX, 3)
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(atlas, mode="RGB").save(OUT_PNG, optimize=True)

    # LE Z EST OBLIGATOIRE. Open-Meteo rend « 2026-09-21T00:00 » sans
    # suffixe de fuseau, même interrogé en timezone=UTC. En JavaScript,
    # Date.parse d'une chaîne pareille l'interprète comme une heure LOCALE
    # — donc décalée d'autant que le fuseau du spectateur. Toute la météo
    # glisse alors de deux heures à Paris, de neuf à Tokyo, et de rien du
    # tout à Londres, ce qui est la pire des façons de s'en apercevoir.
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


def main():
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


if __name__ == "__main__":
    # UNE MAILLE PLUS GROSSIÈRE POUR VÉRIFIER LA CHAÎNE. Douze minutes
    # pour découvrir qu'on s'est trompé d'un signe, c'est douze minutes de
    # trop. `python build/make_weather.py 12` relève une grille de douze
    # degrés en une poignée de secondes : la carte est inutilisable, mais
    # tout le reste — le relevé, l'encodage, l'image, la page — se vérifie
    # à l'identique.
    if len(sys.argv) > 1:
        STEP_DEG = float(sys.argv[1])
        NX = int(round(360 / STEP_DEG))
        NY = int(round(180 / STEP_DEG))
        LONS = np.arange(NX) * STEP_DEG - 180 + STEP_DEG / 2
        LATS = np.arange(NY) * STEP_DEG - 90 + STEP_DEG / 2
        PAUSE_S = CHUNK * WEIGHT_PER_POINT / RATE_PER_MIN * 60 * 1.15
        print(f"[maille d'essai : {STEP_DEG}°]\n")
    main()
