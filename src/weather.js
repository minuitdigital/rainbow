// =========================================================================
//  LA VRAIE MÉTÉO
//
//  La grille d'Open-Meteo : son chargement, sa fraîcheur, et sa lecture.
//  Ce module ne dépend de RIEN — il est tout en haut de la chaîne, avec
//  projection et legends — parce qu'il ne fait que tenir un tableau de
//  nombres et savoir y chercher.
//
//  Deux lecteurs, et ils doivent dire la même chose :
//
//      le shader   lit une texture en couches, un texel par pixel d'écran
//      sky.js      lit ce même tableau au réticule, en JavaScript
//
//  C'est la même duplication que le miroir du bruit fractal, pour la même
//  raison : on ne fait pas tourner du GLSL au réticule, ni du JavaScript
//  par pixel. Ici elle est bien plus facile à tenir, puisque les deux
//  lisent LES MÊMES OCTETS.
//
//  ----------------------------------------------------------------------
//  LA FORME DU FICHIER
//
//  data/weather.png est un atlas VERTICAL : trente-deux pas de temps de
//  trois heures, empilés l'un sous l'autre, 360 de large sur 5 760 de
//  haut. Chaque tranche est donc CONTIGUË en mémoire, et la découper ne
//  coûte rien — pas une recopie ligne à ligne sur un Raspberry Pi.
//
//  LA LIGNE 0 EST LA LATITUDE -89,5. L'image paraît à l'envers dans une
//  visionneuse : c'est voulu. On l'envoie telle quelle au processeur
//  graphique, sans retournement, et le shader lit v = (lat + 90) / 180.
//
//      R   la pluie DU VOISINAGE, dilatée d'une case
//      G   la clarté directe : des rayons non interceptés arrivent-ils ici
//      B   la pluie locale, pour les étiquettes
//
//  Le rouge est dilaté parce qu'on ne voit pas d'arc DANS l'averse : on
//  est dessous, il pleut, le ciel est gris. On le voit à côté.
//
//  ----------------------------------------------------------------------
//  LA FRAÎCHEUR
//
//  Le tableau reste allumé des mois. Le fichier, lui, couvre quatre jours.
//  On le redemande donc toutes les six heures — une requête, quelques
//  centaines de kilo-octets, et le navigateur répondra le plus souvent
//  « rien de neuf » sans rien transférer.
//
//  Et s'il n'y a pas de réseau, ou pas de fichier, RIEN NE CASSE : la
//  page retombe sur son bruit fractal et la case « météo » reste éteinte.
//  Sur un mur, une œuvre qui s'éteint parce qu'un serveur a hoqueté n'est
//  pas une œuvre, c'est une panne.
// =========================================================================

const PNG = 'data/weather.png';
const META = 'data/weather.json';

/** Toutes les six heures. Le fichier en couvre quatre-vingt-seize. */
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
 * UN HORODATAGE SANS FUSEAU EST UNE HEURE LOCALE, en JavaScript. C'est la
 * règle de la norme, et c'est un piège : Open-Meteo rend
 * « 2026-09-21T00:00 » même interrogé en UTC, et Date.parse le lirait
 * alors décalé du fuseau du spectateur — deux heures à Paris, neuf à
 * Tokyo, zéro à Londres. La carte serait juste chez les uns et fausse
 * chez les autres, ce qui est la pire des façons de s'en apercevoir.
 *
 * Le script pose désormais le Z lui-même ; cette fonction est la ceinture
 * qui va avec les bretelles, pour un vieux relevé ou un fichier écrit à
 * la main.
 */
function utcOf(s) {
  if (typeof s !== 'string') return NaN;
  const t = /Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s
          : s.length === 16 ? s + ':00Z'
          : s + 'Z';
  return Date.parse(t);
}

/** La grille est-elle utilisable ? C'est ce qui allume la case « météo ». */
export const hasWeather = () => grid !== null;

/** La grille entière — octets et dimensions — pour que map.js en fasse
 *  une texture en couches. */
export const weatherPixels = () => grid;

/**
 * Où l'on se trouve dans la fenêtre de prévision, en pas de temps
 * fractionnaires. Rendu borné aux extrémités : passé la fin du fichier on
 * répète le dernier pas plutôt que de s'éteindre, en attendant le
 * prochain relevé.
 */
export function weatherSlot(ms) {
  if (!grid) return 0;
  const k = (ms - grid.t0) / grid.stepMs;
  return k < 0 ? 0 : k > grid.nt - 1 ? grid.nt - 1 : k;
}

/**
 * De quand date le relevé, en heures. Négatif si la fenêtre a commencé
 * avant maintenant — ce qui est le cas normal, puisqu'elle couvre hier.
 * Null si pas de grille.
 */
export function weatherAge(ms) {
  return grid ? (ms - grid.t0) / 3600000 : null;
}

/** Le dernier pas de temps couvert, en heures depuis maintenant. */
export function weatherReach(ms) {
  return grid ? (grid.t0 + (grid.nt - 1) * grid.stepMs - ms) / 3600000 : null;
}

/** La raison du dernier échec, ou null quand tout va bien. */
let trouble = null;

/**
 * Ce que la page tient, pour le registre DONNÉES. `grid` est null s'il n'y
 * a rien, et `trouble` porte alors la raison — une absence sans motif
 * n'apprend rien à personne.
 */
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
//
// BILINÉAIRE EN ESPACE, LINÉAIRE EN TEMPS — exactement ce que fait le
// processeur graphique, et il le faut : ce module est le miroir du
// shader. Une lecture au plus proche voisin donnerait ici des marches
// d'escalier là où l'écran montre un dégradé, et le chiffre sous le
// réticule cesserait de décrire la couleur qu'on a sous les yeux.

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

/**
 * Un canal, en un point et à un instant quelconque. `slot` vient de
 * `weatherSlot` et peut tomber entre deux pas.
 */
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

/** La pluie locale — pleut-il SUR nous. Pour les étiquettes. */
export const wxHere = (lon, lat, slot) => grid ? sample(2, lon, lat, slot) : 0;

// ------------------------------------------------------------ l'arrivée

/**
 * Le décodage. On passe par un canvas parce que c'est le seul moyen, dans
 * un navigateur, de lire les octets d'un PNG — et `createImageBitmap` le
 * fait hors du fil principal, donc sans figer la carte pendant que deux
 * millions de pixels se décompressent.
 */
async function decode(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('weather.png : ' + res.status);

  // Les octets sont comptés au passage, comme pour le relief : un demi-
  // mégaoctet sur une connexion lente, c'est plusieurs secondes pendant
  // lesquelles la case « météo » reste grise sans rien dire.
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

/**
 * Va voir s'il y a une grille, et la prend si elle est nouvelle. Ne lève
 * jamais : l'absence de météo est un état normal, pas une panne.
 */
async function pull() {
  if (checking) return;
  checking = true;
  try {
    const res = await fetch(META, { cache: 'no-cache' });
    if (!res.ok) return;
    const meta = await res.json();

    // Déjà cette grille-là : rien à décoder, et surtout rien à téléverser
    // au processeur graphique.
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
    // UN RELEVÉ PÉRIMÉ NE SE VOIT PAS. La carte affiche le dernier pas
    // disponible sans rien dire, et l'on croit regarder demain. Si le
    // robot n'a pas tourné depuis deux jours, autant que ce soit écrit
    // quelque part pour qui va chercher.
    // À L'ÉCRAN, ET PAS SEULEMENT DANS LA CONSOLE. Un relevé dépassé ne
    // se voit pas : la carte affiche son dernier pas disponible sans rien
    // dire, et l'on croit regarder demain.
    trouble = null;
    note('météo', null);
    onArrival();
  } catch (e) {
    // Pas de fichier, pas de réseau, fichier malformé : la page continue
    // avec son bruit fractal, et RIEN NE CASSE. Mais la carte ne montre
    // alors plus la vraie pluie, et c'est une différence que le spectateur
    // a le droit de connaître — d'où la ligne rouge, qui reste.
    //
    // Si une grille est déjà en mémoire, on se tait : un relevé plus
    // récent qui n'arrive pas n'enlève rien à celui qu'on a déjà.
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
 * Appelé une fois au démarrage. `arrived` sert à rallumer la case
 * « météo » et à redessiner quand la grille tombe.
 *
 * Pas de minuterie : une page qui se réveille après trois jours de veille
 * aurait vu passer douze réveils pour rien. On regarde l'heure à chaque
 * appel de `keepFresh`, qui vient de la boucle d'images — donc jamais
 * quand la carte dort.
 */
export function initWeather(arrived, loading) {
  onArrival = arrived || (() => {});
  note = loading || (() => {});
  pull();
}

/** Appelé depuis la boucle d'images. Ne fait rien, sauf toutes les six heures. */
export function keepFresh() {
  if (!checking && Date.now() - checkedAt > REFRESH_MS) pull();
}
