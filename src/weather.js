// =========================================================================
//  LA VRAIE MÉTÉO
//
//  La grille Open-Meteo : chargement, fraîcheur, lecture. Aucune dépendance.
//  Miroir du shader : les deux lisent les mêmes octets et doivent dire la
//  même chose. Sans réseau ni fichier, RIEN NE CASSE : retour au bruit.
// =========================================================================

// data/weather.png : atlas VERTICAL de 32 pas de 3 h (360 × 5 760), chaque
// tranche contiguë. LIGNE 0 = LATITUDE -89,5 : l'image paraît à l'envers,
// c'est voulu (envoyée sans retournement, le shader lit v = (lat+90)/180).
//
//      R   la pluie DU VOISINAGE, dilatée d'une case (l'arc se voit à côté
//          de l'averse, pas dessous)
//      G   la clarté directe : des rayons non interceptés arrivent-ils ici
//      B   la pluie locale, pour les étiquettes

const PNG = 'data/weather.png';
const META = 'data/weather.json';

/** Le fichier couvre 96 h ; on le redemande toutes les 6 h. */
const REFRESH_MS = 6 * 3600 * 1000;

/**
 * La grille en mémoire, ou null tant qu'elle n'est pas là.
 *
 *    px      Uint8Array RGBA, nt tranches de ny lignes de nx pixels
 *    t0      millisecondes UTC du premier pas de temps
 *    stepMs  la durée d'un pas
 */
let grid = null;

/** Appelé quand la grille arrive ou change. Posé par initWeather. */
let onArrival = () => {};

/** Où en est le téléchargement. Posé par initWeather également. */
let note = () => {};

let checking = false, checkedAt = 0;

/**
 * UN HORODATAGE SANS FUSEAU EST UNE HEURE LOCALE pour Date.parse, et
 * Open-Meteo en rend. Le script pose le Z ; ceci couvre les autres cas.
 */
function utcOf(s) {
  if (typeof s !== 'string') return NaN;
  const t = /Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s
          : s.length === 16 ? s + ':00Z'
          : s + 'Z';
  return Date.parse(t);
}

/** La grille est-elle utilisable ? */
export const hasWeather = () => grid !== null;

/** Octets et dimensions, pour la texture en couches de map.js. */
export const weatherPixels = () => grid;

/**
 * Position dans la prévision, en pas fractionnaires, bornée : passé la fin
 * on répète le dernier pas en attendant le relevé suivant.
 */
export function weatherSlot(ms) {
  if (!grid) return 0;
  const k = (ms - grid.t0) / grid.stepMs;
  return k < 0 ? 0 : k > grid.nt - 1 ? grid.nt - 1 : k;
}

/** Le dernier pas de temps couvert, en heures depuis maintenant. */
export function weatherReach(ms) {
  return grid ? (grid.t0 + (grid.nt - 1) * grid.stepMs - ms) / 3600000 : null;
}

/** La raison du dernier échec, ou null quand tout va bien. */
let trouble = null;

/** Pour le registre DONNÉES. Sans grille, `trouble` dit pourquoi. */
export function weatherInfo() {
  return {
    grid: grid && { t0: grid.t0, nt: grid.nt, nx: grid.nx, ny: grid.ny,
                    made: grid.made, stepMs: grid.stepMs },
    trouble,
    checkedAt,
    nextCheck: checkedAt ? checkedAt + REFRESH_MS : 0
  };
}

// ---------------------------------------------------------- la lecture
// BILINÉAIRE EN ESPACE, LINÉAIRE EN TEMPS, comme le GPU : sinon le chiffre
// du réticule ne décrit plus la couleur affichée.

/** Un canal, en un point et à un pas de temps entier. Bilinéaire. */
function tap(ch, lon, lat, k) {
  const { nx, ny, px } = grid;

  // Les centres de case sont à -179,5 ... 179,5 : d'où le demi-pixel.
  let u = (lon + 180) / 360 * nx - 0.5;
  const v = Math.min(ny - 1.001, Math.max(0, (lat + 90) / 180 * ny - 0.5));

  u = ((u % nx) + nx) % nx;                    // la longitude s'enroule
  const x0 = Math.floor(u), y0 = Math.floor(v);
  const fx = u - x0, fy = v - y0;
  const x1 = (x0 + 1) % nx, y1 = y0 + 1;

  const base = k * ny * nx;
  const at = (x, y) => px[(base + y * nx + x) * 4 + ch];

  const a = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx;
  const b = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx;
  return (a + (b - a) * fy) / 255;
}

/** Un canal à un instant quelconque ; `slot` vient de `weatherSlot`. */
function sample(ch, lon, lat, slot) {
  const k0 = Math.floor(slot), f = slot - k0;
  const k1 = Math.min(grid.nt - 1, k0 + 1);
  const a = tap(ch, lon, lat, k0);
  return f <= 0 ? a : a + (tap(ch, lon, lat, k1) - a) * f;
}

/** La pluie du voisinage : de l'eau en suspension quelque part par ici. */
export const wxRain = (lon, lat, slot) => grid ? sample(0, lon, lat, slot) : 0;

/** La clarté : des rayons directs arrivent-ils jusqu'ici. */
export const wxClear = (lon, lat, slot) => grid ? sample(1, lon, lat, slot) : 0;
// ------------------------------------------------------------ l'arrivée

/**
 * Lire les octets d'un PNG passe par un canvas ; `createImageBitmap`
 * décompresse hors du fil principal.
 */
async function decode(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('weather.png : ' + res.status);

  // Octets comptés au passage, pour afficher la progression.
  const total = +res.headers.get('content-length') || 0;
  const chunks = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    note('météo', { got, total });
  }

  const blob = new Blob(chunks);
  const bmp = await createImageBitmap(blob);

  const cv = document.createElement('canvas');
  cv.width = bmp.width;
  cv.height = bmp.height;
  const g = cv.getContext('2d', { willReadFrequently: false });
  g.drawImage(bmp, 0, 0);
  bmp.close?.();
  return { data: g.getImageData(0, 0, cv.width, cv.height).data,
           w: cv.width, h: cv.height };
}

/** Prend la grille si elle est nouvelle. Ne lève jamais. */
async function pull() {
  if (checking) return;
  checking = true;
  try {
    const res = await fetch(META, { cache: 'no-cache' });
    if (!res.ok) return;
    const meta = await res.json();

    // Déjà cette grille-là : rien à décoder ni à téléverser.
    if (grid && grid.made === meta.made) return;

    const { data, w, h } = await decode(PNG);
    if (w !== meta.nx || h !== meta.ny * meta.nt)
      throw new Error(`weather.png fait ${w}x${h}, le relevé annonce ` +
                      `${meta.nx}x${meta.ny * meta.nt}`);

    grid = {
      px: data, nx: meta.nx, ny: meta.ny, nt: meta.nt,
      made: meta.made,
      t0: utcOf(meta.t0),
      stepMs: meta.step_h * 3600000
    };
    trouble = null;
    note('météo', null);
    onArrival();
  } catch (e) {
    // La page continue avec son bruit fractal, mais `trouble` reste
    // affiché : le spectateur doit savoir que la pluie n'est plus vraie.
    trouble = /404/.test(e.message) ? 'aucun relevé publié'
            : /NetworkError|Failed to fetch/i.test(e.message) ? 'serveur injoignable'
            : e.message;
    if (!grid) console.info('météo : pas de grille (%s)', e.message);
    note('météo', null);
  } finally {
    checking = false;
    checkedAt = Date.now();
  }
}

/**
 * Une fois au démarrage ; `arrived` redessine quand la grille tombe. Pas
 * de minuterie : `keepFresh`, appelé par la boucle d'images, ne tourne
 * jamais quand la carte dort.
 */
export function initWeather(arrived, loading) {
  onArrival = arrived || (() => {});
  note = loading || (() => {});
  pull();
}

/** Depuis la boucle d'images ; agit toutes les six heures. */
export function keepFresh() {
  if (!checking && Date.now() - checkedAt > REFRESH_MS) pull();
}
