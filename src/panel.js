// =========================================================================
//  LE PANNEAU
//
//  Quatre registres dans une colonne à droite, un cinquième caché.
//  Une boîte, une tâche :
//
//      ESTIMATEUR  montre      où l'on vise, le soleil
//      ALGORITHME  montre      la présence, et la formule qui la fait
//      LÉGENDES    situe       les hauts lieux et ce qu'on y croit
//      RÉGLAGES    règle       les commandes de la plaque, et elles seules
//      ADMIN       ajuste      tout le reste — n'apparaît que par /admin
//
//  CHAQUE COMMANDE DE LA PLAQUE A UN POINT D'ENTRÉE, et un seul : l'objet
//  `plaque`, plus bas. La page l'appelle quand on touche un curseur ; le
//  Raspberry Pi l'appellera quand on tournera un bouton. Chaque entrée
//  pose l'état ET remet le curseur de la page à la bonne place.
//
//  Tout ce qu'il affiche décrit LE RÉTICULE — le centre exact de l'écran.
//  Le panneau ne choisit pas un lieu : il décrit celui qu'on regarde. Les
//  pastilles des hauts lieux ne sélectionnent rien, elles amènent le
//  réticule là-bas.
//
//  Les graphes empruntent leur structure aux moniteurs de débit : axe du
//  temps logarithmique, remplissage sous la courbe, étiquette de pic en
//  boîte à tige, valeur courante en chevron, graduations en bordure
//  droite. Les trois parts de la croyance sont des DENSITÉS D'ENCRE et
//  non des couleurs : elles doivent survivre au tramage de l'e-ink.
//
//  Ce fichier ne calcule rien du ciel : il lit `history.past` et le pose
//  à l'écran.
// =========================================================================

import { view, beliefWeights, faceNorth, centre, centreVec, sx, sy,
         simDate, drift, driftChance, liveReperes,
         beat, beatIdle, pixelCount, loadState } from './view.js';
import { GAIN, SUN_MAX, SPILL_DEG, openFor, nearestLegend,
         LEGEND_POINTS, solar } from './sky.js';
import { flatten, matT, geoVec } from './projection.js';
import { past, recall, posOf, AGE_MAX } from './history.js';
import { brightest } from './zones.js';
import { weatherReach, weatherInfo } from './weather.js';
import { gpuMs } from './map.js';
import { measureRail } from './ink.js';

const byId = id => document.getElementById(id);
const root = document.documentElement;
const cssOf = n => getComputedStyle(root).getPropertyValue(n).trim();
const bound = (v, a, b) => (v < a ? a : v > b ? b : v);
const tween = (a, b, t) => a + (b - a) * t;

/** Posé par initPanel : le panneau ne connaît pas la boucle d'images. */
let repaint = () => {};

/**
 * Posé par initPanel également. Changer de machine change le nombre de
 * pixels réels : il faut remesurer les deux calques, pas seulement
 * redessiner. C'est la seule chose du panneau qui touche à la taille.
 */
let remeasure = () => {};

// ================================================================ LA CROYANCE
// Trois boutons INDÉPENDANTS : aucun ne pousse les autres. Chacun donne un
// poids brut, de 0 à 100 %, et c'est `beliefWeights` qui les ramène à une
// somme de 1. La plaque est en métal : un bouton rotatif ne bouge pas
// tout seul, et une page qui déplacerait ses poignées dirait autre chose
// que le tableau. Tous à zéro, la carte ne montre rien.

const SHARES = [['w-m', 'm', 'o-m'], ['w-l', 'l', 'o-l'], ['w-c', 'c', 'o-c']];

/** Les fonctions de rafraîchissement des curseurs, posées par initPanel. */
const SYNCS = {};

function setBelief(key, v) {
  view.belief[key] = bound(v, 0, 100);
  showBelief();
  repaint();
}

function showBelief() {
  for (const [id, key, out] of SHARES) {
    const input = byId(id), pct = Math.round(view.belief[key]);
    input.value = pct;
    input.style.setProperty('--p', pct + '%');
    byId(out).textContent = pct + ' %';
  }
  saveKnobs();
}

// ================================================================ LES PLIS
// Chaque registre se replie sur son bandeau. Au démarrage, seuls
// l'estimateur et la croyance sont ouverts : ce sont eux qu'on lit. Les
// légendes sont un index et les réglages un outil — ils s'appellent, ils
// ne s'imposent pas. Un bandeau replié ne dit QUE son nom : un chiffre
// posé là (« foi 9 % ») se lisait comme un titre, et un titre qui change
// tout seul fait du bruit — la croyance du lieu se dit dans le corps du
// registre, où on est venu la chercher.

// Les quatre registres, puis l'admin sur DEUX niveaux : trois familles —
// graphisme, données, performance — et sous chacune ce sur quoi les
// curseurs agissent. Les groupes de la plaque, eux, ne se replient pas :
// le métal n'a pas de pli.
//
// L'ordre compte : un parent replié cache ses enfants, mais leur propre
// état de pli est conservé et retrouvé tel quel à la réouverture.
const FOLDS = [
  ['pli-est',        'corps-est',        true ],
  ['pli-croy',       'corps-croy',       true ],
  ['pli-leg',        'corps-leg',        false],
  ['pli-reg',        'corps-reg',        false],
  ['pli-adm',        'corps-adm',        true ],

  ['pli-gfx',        'corps-gfx',        true ],
  ['pli-r-tache',    'corps-r-tache',    true ],
  ['pli-r-panneau',  'corps-r-panneau',  false],

  ['pli-dat',        'corps-dat',        true ],
  ['pli-r-temps',    'corps-r-temps',    true ],
  ['pli-data',       'corps-data',       true ],

  ['pli-cost',       'corps-cost',       false]
];

/** id du corps → est-il replié ? */
const folded = {};

function showFold(btnId, bodyId) {
  const body = byId(bodyId), open = !folded[bodyId];
  body.hidden = !open;
  // Un sous-registre replie son `.sub` ; un registre replie sa boîte. Sans
  // ce premier terme, plier « le fond » plierait tous les réglages.
  (body.closest('.sub') || body.closest('.box')).classList.toggle('folded', !open);
  const b = byId(btnId);
  b.textContent = open ? '−' : '+';
  b.setAttribute('aria-expanded', String(open));
  b.setAttribute('aria-label', open ? 'Replier' : 'Déplier');
}

// ============================================================ LES RÉGLAGES
// Ils ne disent rien du ciel : ils disent comment on le regarde. Deux
// réglages différents décrivent le même monde — d'où la boîte à part, et
// le titre volontairement discret.

/** Le contraste déplace toute la gamme d'encres d'un coup. */
function setContrast(t) {
  const L = (lo, hi) => `hsl(213 11% ${tween(lo, hi, t).toFixed(1)}%)`;
  root.style.setProperty('--ink',       L(52, 8));
  root.style.setProperty('--ink-soft',  L(68, 40));
  root.style.setProperty('--ink-faint', L(82, 62));
  root.style.setProperty('--rule',      L(93, 74));
  root.style.setProperty('--meteo',     L(58, 22));
  root.style.setProperty('--legende',   L(76, 52));
  root.style.setProperty('--chance',    L(90, 78));
}

/**
 * Le curseur des aplats, en deux moitiés : de 0 à 50 % on va du papier nu
 * au tirage d'origine, de 50 à 100 % on charge jusqu'à INK_MAX. Une
 * course linéaire de 0 à INK_MAX aurait mis l'origine à 38 % du rail —
 * introuvable à la main, et impossible à retrouver.
 *
 * Les deux surfaces n'ont pas la même course : la gamme de la mer est
 * bien plus courte que celle des terres — huit paliers contre sept, sur
 * un écart d'encre deux fois moindre — donc le même facteur l'aurait
 * laissée grise clair à fond de curseur.
 */
const INK_MAX = { land: 2.4, sea: 4.0 };
const inkDepth = (t, kind) =>
  (t <= 0.5 ? t * 2 : 1 + (t - 0.5) * 2 * (INK_MAX[kind] - 1));

const KNOBS = {
  's-alpha':    { fmt: t => Math.round(t * 100) + ' %',
                  apply: t => root.style.setProperty('--alpha', tween(0.02, 0.96, t).toFixed(3)) },

  's-contrast': { fmt: t => Math.round(t * 100) + ' %', apply: setContrast },

  's-colour':   { fmt: t => (t < 0.02 ? 'gris' : Math.round(t * 100) + ' %'),
                  apply: t => { view.look.sat = tween(0, 1.8, t); repaint(); } },

  's-tache':    { fmt: t => Math.round(tween(0.3, 1.6, t) * 100) + ' %',
                  apply: t => { view.look.tache = tween(0.3, 1.6, t); repaint(); } },

  // COMBIEN DE FOIS LA PALETTE FAIT LE TOUR. C'est l'ordre
  // d'interférence, et c'est le réglage le plus brutal de la page :
  // au-delà de deux tours on voit un arc-en-ciel par-dessus le sujet,
  // et la carte n'est plus lisible. En deçà d'un, la tache tend vers une
  // seule teinte qui se contente de foncer.
  // Sur la plaque, 0 à 100 % : on affiche la position du bouton.
  's-franges':  { fmt: t => Math.round(t * 100) + ' %',
                  apply: t => { view.look.franges = tween(0.30, 3.50, t); repaint(); } },

  // LA SENSIBILITÉ — le seuil. Sous cette présence, du papier. C'est le
  // réglage qui décide si la carte est une nappe teintée ou un semis de
  // taches, et il agit à toute échelle. À 0 % de la couleur partout, à
  // 100 % seulement les endroits les plus forts : la course s'arrête à
  // SEUIL_MAX et non à 1, où plus rien ne s'allumait.
  's-seuil':    { fmt: t => Math.round(t * 100) + ' %',
                  apply: t => { view.look.seuil = t * SEUIL_MAX; repaint(); } },

  // LA FINESSE ne dit rien au monde entier : c'est un gain sur ce que le
  // zoom révèle. Le milieu du rail est le réglage d'usine.
  's-fine':     { fmt: t => (t <= 0.005 ? 'aplat' : Math.round(t * 200) + ' %'),
                  apply: t => { view.look.fine = t * 2; repaint(); } },

  // LE COULOIR A DEUX MESURES, et elles n'ont rien à voir l'une avec
  // l'autre : l'écart entre les points, et l'épaisseur du trait. Un seul
  // curseur pour les deux ferait grossir les points en les écartant, ce
  // qui est exactement ce qu'on ne veut pas quand on cherche le juste
  // pointillé. Les chiffres affichés sont ceux du MONDE ENTIER — de près,
  // l'écart s'allonge tout seul, voir le bloc uPorte du shader.
  's-ecart':    { fmt: t => Math.round(tween(0.5, 3.0, t) * 12) + ' px',
                  apply: t => { view.look.pas = tween(0.5, 3.0, t); repaint(); } },

  's-trait':    { fmt: t => (tween(0.5, 3.0, t) * 1.6).toFixed(1) + ' px',
                  apply: t => { view.look.trait = tween(0.5, 3.0, t); repaint(); } },

  // LA PROFONDEUR D'ENCRE des aplats. Le milieu du curseur EST le tirage
  // d'origine — c'est ce qui permet de revenir à la carte connue sans
  // chercher, et de voir d'un coup d'œil si on s'en est écarté. En deçà
  // l'encre s'allège jusqu'au papier nu, au-delà elle se charge.
  // Sur la plaque, 0 à 100 % : on affiche la position du bouton.
  's-terres':   { fmt: t => Math.round(t * 100) + ' %',
                  apply: t => { view.look.land = inkDepth(t, 'land'); repaint(); } },

  's-mer':      { fmt: t => Math.round(t * 100) + ' %',
                  apply: t => { view.look.sea = inkDepth(t, 'sea'); repaint(); } },

  's-text':     { fmt: t => tween(9, 14, t).toFixed(0) + ' px',
                  apply: t => root.style.setProperty('--ui-pt', tween(9, 14, t).toFixed(1) + 'px') },

  // ICÔNES, sur la plaque : la taille de toutes les icônes de la carte —
  // hauts lieux, repères, le piéton et son point. On affiche la position
  // du bouton, 0 à 100 %.
  's-icon':     { fmt: t => Math.round(t * 100) + ' %',
                  apply: t => { view.look.icon = tween(9, 28, t); repaint(); } },

  // LE POINT DU RÉTICULE. Zéro le laisse à l'encre — c'est le réglage
  // d'usine et celui qui part sur l'e-ink, où il n'y aura pas de teinte.
  // Au-delà, il parcourt le cercle des teintes : sur l'écran d'atelier,
  // une couleur franche est le seul moyen de garder le point visible
  // par-dessus une tache irisée.
  's-point':    { fmt: t => (t <= 0.02 ? 'encre' : Math.round(t * 360) + '°'),
                  apply: t => { view.look.dot = t; repaint(); } },

  // LA VITESSE, en dev seulement : cinq décades, de la seconde à
  // l'année. En météo elle n'a aucun sens — une prévision ne s'accélère
  // pas — et elle s'éteint ; c'est Temps, sur la plaque, qui dit quand.
  's-time':     { fmt: t => (t <= 0 ? 'figé'
                             : '×' + Math.round(Math.pow(10, t * 5)).toLocaleString('fr-FR')),
                  apply: t => { view.speed = t <= 0 ? 0 : Math.pow(10, t * 5); repaint(); } }
};

/**
 * Le haut de la course de Sensibilité. Mesuré sur la présence du globe
 * entier, en dev, le 30 septembre 2026 : le 99e centile des points allumés
 * tourne autour de 0,70. À 100 %, il reste donc à peu près le centième le
 * plus fort. À revoir devant la vraie météo.
 */
const SEUIL_MAX = 0.7;

// COULEUR. ON, l'irisation ; OFF, le dégradé — un ENCODAGE, pas une
// teinte en moins : la force passe alors par la densité, en paliers et en
// points.
function showCouleur() {
  const on = byId('s-couleur').checked;
  view.look.grey = on ? 0 : 1;
  byId('o-couleur').textContent = on ? 'ON' : 'OFF';
  // En dégradé il n'y a plus de teinte : ni saturation, ni ordre
  // d'interférence. Les deux curseurs s'éteignent plutôt que de mentir.
  for (const k of ['colour', 'franges']) {
    byId('s-' + k).disabled = !on;
    byId('l-' + k).classList.toggle('off', !on);
  }
  repaint();
  saveKnobs();
}

// LE COULOIR. Deux pointillés, à 0° et à 42° de hauteur du soleil. Ce
// n'est pas une donnée de plus : c'est la fenêtre elle-même, rendue
// visible. Toute la couleur de la carte vit entre ces deux traits, et
// quand une région reste éteinte, ils disent laquelle des deux raisons
// est la bonne — pas de pluie, ou pas la bonne heure.
//
// Éteint par défaut : la pièce se regarde sans ses coutures. On l'allume
// pour comprendre, puis on l'éteint.
function showPorte() {
  const on = byId('s-porte').checked;
  view.look.porte = on ? 1 : 0;
  byId('o-porte').textContent = on ? 'ON' : 'OFF';
  // Couloir éteint, ses deux mesures ne décrivent plus rien : elles
  // s'éteignent aussi, plutôt que de laisser croire qu'on règle quelque
  // chose. Même geste que Couleur avec la saturation et l'irisation.
  for (const k of ['ecart', 'trait']) {
    byId('s-' + k).disabled = !on;
    byId('l-' + k).classList.toggle('off', !on);
  }
  repaint();
  saveKnobs();
}

// ============================================================ LA PERFORMANCE
// Ce que la page coûte, et sur quelle machine. Ce registre ne dit rien du
// ciel : c'est un instrument d'atelier, replié par défaut, qu'on ne trouve
// que si on le cherche.

function showRig() {
  view.rig = byId('rig-mini').checked ? 'mini' : 'laptop';
  // Changer de machine change le nombre de pixels RÉELS : les deux calques
  // doivent être retaillés, un simple redessin n'y suffirait pas.
  remeasure();
  saveKnobs();
}

// ================================================================ L'HORLOGE
// D'où vient l'heure, et donc d'où vient la pluie. Les deux vont ensemble :
// un temps inventé ne peut pas aller chercher une prévision, et une vraie
// prévision ne se laisse pas accélérer dix mille fois.
//
// LA PAGE PUBLIQUE EST EN MÉTÉO dès que data/weather.png est arrivé. Le
// dev ne se choisit que dans l'admin, et le choix est mémorisé : c'est
// `clockWanted`. Tant que le fichier n'est pas là, la page reste en dev —
// une case qui prétendrait brancher des données absentes mentirait.

let clockWanted = 'meteo';

function showClock() {
  view.clock = byId('clk-meteo').checked ? 'meteo' : 'dev';
  clockWanted = view.clock;
  showTemps();
  remeasure();
}

/** Appelé par main.js quand la grille météo est versée. */
export function weatherArrived() {
  byId('clk-meteo').disabled = false;
  byId('l-meteo').classList.remove('off');
  if (clockWanted === 'meteo' && view.clock !== 'meteo') {
    byId('clk-meteo').checked = true;
    showClock();
  }
}

// TEMPS — le bouton à trois positions de la plaque. Il n'a de sens
// qu'avec la vraie météo : en dev il s'éteint, et c'est la vitesse de
// l'admin qui reprend la main. « Après-demain » n'existe plus.
const TEMPS = { hier: -24, maintenant: 0, demain: 24 };

function showTemps() {
  const met = view.clock === 'meteo';
  const pos = Object.keys(TEMPS).find(k => byId('t-' + k).checked) || 'maintenant';
  view.when = TEMPS[pos];
  for (const k of Object.keys(TEMPS)) {
    byId('t-' + k).disabled = !met;
    byId('l-' + k).classList.toggle('off', !met);
  }
  byId('s-time').disabled = met;
  byId('l-time').classList.toggle('off', met);
  repaint();
  saveKnobs();
}

/**
 * Les jauges, quatre fois par seconde et pas davantage.
 *
 * Écrire dans le document force un recalcul de mise en page. Le faire
 * soixante fois par seconde ralentirait très exactement ce qu'on essaie de
 * mesurer — l'instrument fausserait sa propre lecture. Et à soixante hertz,
 * un chiffre ne se lit de toute façon pas.
 */
let gaugeAt = 0;

function showBeat() {
  const t = performance.now();
  if (t - gaugeAt < 250) return;
  gaugeAt = t;

  const rest = beatIdle();
  const ms = v => v.toFixed(v < 10 ? 2 : 1) + ' ms';

  // LE REPOS EST UN ÉTAT, PAS UNE PANNE. La boucle s'arrête quand rien ne
  // bouge — c'est ce qui rend la pièce supportable sur un mur des années
  // durant. Afficher une cadence figée ferait croire à un gel.
  byId('g-fps').textContent = rest ? 'repos' : Math.round(beat.fps) + ' im/s';

  // Le seul chiffre qui dise vraiment ce que le shader coûte. Un tiret
  // veut dire que le navigateur refuse l'extension, pas que c'est gratuit.
  const gpu = view.cut.shader ? null : gpuMs();
  byId('g-gpu').textContent = gpu == null ? '—' : ms(gpu);

  byId('g-ms').textContent    = ms(beat.ms);
  byId('g-map').textContent   = ms(beat.map);
  byId('g-ink').textContent   = ms(beat.ink);
  byId('g-panel').textContent = ms(beat.panel);
  byId('g-px').textContent    = (pixelCount() / 1e6).toFixed(2) + ' Mpx';
}

// ============================================================== LES DONNÉES
//  L'ÉTAT DE CE QUE LA PAGE A SOUS LA MAIN, en permanence.
//
//  Un indicateur qui disparaît quand tout va bien ne dit rien : il dit
//  seulement qu'il a fini de regarder. Celui-ci reste, et il répond aux
//  trois questions qu'on se pose vraiment quand la carte paraît bizarre —
//  qu'est-ce qui est arrivé, de quand date la météo, et d'où tout ça vient.
//
//  LES TAILLES NE SONT PAS MESURÉES À LA MAIN. Le navigateur les tient
//  déjà dans `performance.getEntriesByType('resource')`, avec les durées
//  de transfert, et les modules chargés par `import` y figurent aussi.
//  Rien à instrumenter, et le chiffre est celui du réseau, pas le nôtre.

/** Les fichiers qui portent le monde, et le nom qu'on leur donne ici. */
const DATA_FILES = [
  ['data/field.png',   'relief'],
  ['data/coast.js',    'côtes'],
  ['data/cities.js',   'villes'],
  ['data/terrain.js',  'terrain'],
  ['data/mask.png',    'masque'],
  ['data/weather.png', 'météo']
];

const ko = o => o >= 1048576 ? (o / 1048576).toFixed(1) + ' Mo'
                             : Math.round(o / 1024) + ' Ko';

const HH = ms => {
  const d = new Date(ms);
  return `${HHMM(d.getUTCDate())}/${HHMM(d.getUTCMonth() + 1)} ` +
         `${HHMM(d.getUTCHours())}h`;
};

/** Une ligne du registre. `mood` : '' normal, 'deep' détail, 'bad' manquant. */
function dataRow(nom, val, mood) {
  const row = document.createElement('div');
  row.className = 'gauge' + (mood ? ' ' + mood : '');
  const a = document.createElement('span');
  a.textContent = nom;
  const b = document.createElement('em');
  b.textContent = val;
  row.append(a, b);
  return row;
}

/**
 * Reconstruit la liste. Appelée une fois par seconde au plus — voir la
 * minuterie d'`initPanel`, qui s'arrête quand le registre est replié.
 *
 * On refabrique les nœuds ici, à rebours du piège n°22 : rien n'y est
 * cliquable, et une fois par seconde n'est pas soixante fois.
 */
function showData() {
  const box = byId('data-list');
  const seen = new Map();
  for (const e of performance.getEntriesByType('resource'))
    seen.set(e.name.split('?')[0], e);

  const rows = [];
  let manque = 0;

  for (const [path, nom] of DATA_FILES) {
    // D'ABORD CE QUI EST EN ROUTE. `performance` ne connaît une ressource
    // qu'une fois qu'elle est arrivée : pendant les secondes où les huit
    // mégaoctets de relief descendent, elle n'en dit rien du tout. C'est
    // map.js et weather.js qui comptent les octets au passage.
    const live = loadState.get(nom);
    if (live && live.err) {
      rows.push(dataRow(nom, live.err, 'bad'));
      manque++;
      continue;
    }
    if (live) {
      rows.push(dataRow(nom, live.total
        ? `${ko(live.got)} / ${ko(live.total)}`
        : ko(live.got) + '…', 'live'));
      continue;
    }

    // L'entrée peut être indexée par URL absolue selon le serveur.
    const hit = [...seen.entries()].find(([u]) => u.endsWith('/' + path));
    if (!hit) {
      // La météo absente n'est pas une anomalie tant que le robot n'a pas
      // publié : c'est le relevé, juste dessous, qui l'explique.
      rows.push(dataRow(nom, nom === 'météo' ? 'absente' : 'en attente',
                        nom === 'météo' ? 'deep' : 'deep'));
      continue;
    }
    const e = hit[1];
    // transferSize vaut zéro quand le navigateur a servi depuis son cache :
    // la taille décodée reste juste, et c'est elle qui intéresse.
    const size = e.transferSize || e.encodedBodySize || e.decodedBodySize || 0;
    rows.push(dataRow(nom, size ? ko(size) : 'en cache', ''));
  }

  // ---- le relevé météo, et sa fraîcheur
  const w = weatherInfo();
  const now = Date.now();
  rows.push(dataRow('—', '', 'rule'));

  if (w.grid) {
    const fin = w.grid.t0 + (w.grid.nt - 1) * w.grid.stepMs;
    const reste = (fin - now) / 3600000;
    rows.push(dataRow('relevé', HH(w.grid.t0) + ' UTC', 'deep'));
    rows.push(dataRow('couvre', `${w.grid.nt} pas · ` +
      (reste >= 0 ? `+${Math.round(reste)} h devant` : 'DÉPASSÉ'),
      reste >= 0 ? 'deep' : 'bad'));
    rows.push(dataRow('maille', `${w.grid.nx}×${w.grid.ny}`, 'deep'));
  } else {
    rows.push(dataRow('relevé', w.trouble || 'en attente',
                      w.trouble ? 'bad' : 'deep'));
    rows.push(dataRow('la pluie est', 'simulée', 'bad'));
  }

  if (w.nextCheck) {
    const dans = Math.max(0, (w.nextCheck - now) / 3600000);
    rows.push(dataRow('prochain test',
      dans >= 1 ? `dans ${Math.round(dans)} h` : `dans ${Math.round(dans * 60)} min`,
      'deep'));
  }

  // ---- d'où la page est servie. « github.io » ou « localhost » répond à
  // la question « est-ce que je regarde le site en ligne ou ma copie ? »,
  // qu'on se pose plus souvent qu'on ne croit.
  rows.push(dataRow('servi par',
    location.protocol === 'file:' ? 'un fichier local'
      : (location.host || 'inconnu'), 'deep'));

  if (manque)
    rows.unshift(dataRow('attention', manque > 1 ? `${manque} fichiers absents`
                                                 : '1 fichier absent', 'bad'));

  box.replaceChildren(...rows);
}

// ================================================================= LA NOTE
// Un chiffre en millisecondes ne dit rien tout seul. Il faut savoir ce
// qu'il mesure, et SURTOUT ce qui le fait monter — sans quoi on optimise
// au hasard, ce qui est la façon la plus sûre de perdre une semaine.
//
// D'où deux phrases par note, jamais une : `quoi` dit ce que le chronomètre
// a mesuré, `pourquoi` dit sur quoi agir. La seconde est celle qui sert.

const NOTES = {
  fps: {
    nom: 'images par seconde',
    quoi: 'La cadence réelle, tout compris — matériel et logiciel ensemble. '
        + "C'est le seul chiffre qui dise si l'expérience est fluide : au-dessus "
        + 'de cinquante on ne sent rien, en dessous de trente le glissé accroche.',
    pourquoi: '« repos » n’est pas un gel. La boucle d’images s’arrête quand '
        + 'rien ne bouge, et c’est exactement ce qui permet au tableau de ne '
        + 'rien consommer sur un mur pendant des années. Bouge la carte et le '
        + 'compteur repart. Si ce chiffre est bas, regarde lequel des deux '
        + 'chronomètres ci-dessous est gros : celui-là est le coupable.'
  },
  gpu: {
    nom: 'shader',
    quoi: 'Le temps que la carte graphique passe à peindre la carte, mesuré '
        + 'par le pilote lui-même et non à la montre. C’est du MATÉRIEL pur : '
        + 'la projection inversée, le bruit, les aplats, l’irisation — tout ce '
        + 'qui est calculé pixel par pixel.',
    pourquoi: 'Il monte avec le nombre de pixels (voir « pixels » plus bas), '
        + 'avec « trous » et « finesse » au zoom profond, et avec le nombre de '
        + 'hauts lieux. Pour le faire baisser d’un coup : passer la machine sur '
        + '« mini ». Un tiret veut dire que le navigateur refuse l’extension de '
        + 'mesure — pas que c’est gratuit.'
  },
  js: {
    nom: 'javascript',
    quoi: 'Le temps que le processeur central passe à préparer une image. '
        + 'C’est du LOGICIEL, et c’est la somme exacte des trois lignes en '
        + 'retrait juste en dessous.',
    pourquoi: 'Il ne dépend presque pas de la taille de la fenêtre — un écran '
        + 'deux fois plus grand ne le change pas — mais du nombre de POINTS à '
        + 'parcourir : sommets des côtes, villes, échantillons d’histoire. '
        + 'Si ce chiffre dépasse celui du shader, c’est le JavaScript qu’il '
        + 'faut alléger, pas la carte.'
  },
  map: {
    nom: 'carte',
    quoi: 'L’envoi des réglages au processeur graphique : une vingtaine de '
        + 'nombres, et l’ordre de dessiner un triangle.',
    pourquoi: 'Ce chiffre est toujours minuscule, et c’est normal — il ne dit '
        + 'RIEN du coût de la carte. L’ordre de dessiner rend la main avant que '
        + 'le shader ait commencé son travail ; ce travail est sur la ligne '
        + '« shader ». Ne cherche pas à optimiser ici.'
  },
  ink: {
    nom: 'encre',
    quoi: 'Le calque en deux dimensions posé par-dessus la carte : les traits '
        + 'de côte, les villes, les étiquettes d’arc, les hauts lieux et le '
        + 'piéton du réticule.',
    pourquoi: 'C’est le poste le plus lourd du logiciel au monde entier, parce '
        + 'qu’il reparcourt les sommets des côtes à chaque image. Il BAISSE '
        + 'quand on zoome : moins de côtes tiennent à l’écran. Si tu vois un '
        + 'gros chiffre ici au monde entier et un petit à ×32, c’est le '
        + 'comportement attendu.'
  },
  panel: {
    nom: 'panneau',
    quoi: 'Les deux graphes, et les vingt-quatre heures passées sous le '
        + 'réticule — recalculées à chaque fois, jamais mémorisées.',
    pourquoi: 'Il ne dépend ni du zoom ni de la taille de l’écran, seulement '
        + 'du nombre de points d’histoire et de la fréquence à laquelle on les '
        + 'refait. Replier le registre ESTIMATEUR le met à zéro : les graphes '
        + 'ne se dessinent plus.'
  },
  formule: {
    nom: 'la formule de la présence',
    quoi: 'La présence est le chiffre que la carte peint — 0 à 1. Voici '
        + 'd’où il vient.',
    pre: 'présence = S · (wM·météo + wL·légende)\n'
       + '         + wC · chance · flaque · max(S, fuite·wC)',
    defs: [
      ['présence', 'ce que la carte colore, de 0 à 1'],
      ['S',        'le soleil, ouvert de 0° à 42°'],
      ['wM wL wC', 'les trois curseurs, somme 100 %'],
      ['météo',    'pluie du voisinage × trouée'],
      ['légende',  'le haut lieu le plus proche'],
      ['chance',   'un bruit lent, seuillé en poches'],
      ['flaque',   'décroît en s’éloignant du piéton'],
      ['fuite',    'ce que la porte laisse passer la nuit']
    ]
    // PAS DE « POURQUOI » ICI. Toutes les autres notes en ont un, et c'est
    // leur raison d'être : un chiffre ne dit rien sans ce qui le fait
    // monter. Une formule, si — elle EST son propre commentaire, et le
    // paragraphe qui la glosait ne faisait que repousser la liste des
    // symboles plus bas. La feuille s'arrête donc sur les symboles.
  },

  px: {
    nom: 'pixels',
    quoi: 'Combien de pixels RÉELS le shader calcule à chaque image : la '
        + 'largeur par la hauteur de la fenêtre, multipliées par la densité de '
        + 'l’écran.',
    pourquoi: 'C’est le levier le plus brutal de toute la page, et il agit '
        + 'directement sur la ligne « shader ». Sur un écran dense, passer la '
        + 'machine sur « mini » divise ce nombre par QUATRE — et le temps du '
        + 'shader avec lui. Aucun autre réglage n’a cet effet.'
  },
  rig: {
    nom: 'la machine',
    quoi: 'De quel calculateur la page dispose. « laptop » pour l’écran '
        + 'd’atelier, « mini » pour le Raspberry Pi du tableau.',
    pourquoi: 'Trois choses changent, et ce sont les trois qui comptent : les '
        + 'pixels réels passent de deux à un par pixel de page (quatre fois '
        + 'moins de travail pour le shader), le balayage des zones s’élargit de '
        + '30 à 44 pixels (moitié moins d’appels), et l’intervalle entre deux '
        + 'balayages passe de 200 à 320 millisecondes. Le choix est mémorisé.'
  },
  clock: {
    nom: 'l’horloge',
    quoi: 'D’où vient l’heure, et donc d’où vient la pluie. « dev » invente '
        + 'un temps que le curseur accélère, de la seconde à l’année, et la '
        + 'pluie est un bruit fractal. « météo » suit le temps réel et va '
        + 'chercher la vraie prévision.',
    pourquoi: 'Les deux vont ensemble : un temps inventé ne peut pas aller '
        + 'chercher une prévision, et une vraie prévision ne se laisse pas '
        + 'accélérer dix mille fois. « météo » restera éteint tant que le '
        + 'fichier data/weather.png ne sera pas à côté de la page — une case '
        + 'qui prétendrait brancher des données absentes mentirait.'
  }
};

/** La note ouverte, ou null. */
let noted = null;

function openNote(key) {
  const n = NOTES[key];
  if (!n) return;
  noted = key;
  showSwitch('p-formule', key === 'formule');
  byId('note-nom').textContent = n.nom;
  byId('note-quoi').textContent = n.quoi;

  // UNE FORMULE SE LIT EN BLOC. Noyée dans une phrase, elle ne se lit
  // pas du tout — les parenthèses et les points médians n'ont plus de
  // rang, et l'œil ne voit qu'une file de mots.
  const pre = byId('note-pre');
  pre.textContent = n.pre || '';
  pre.hidden = !n.pre;

  // ET LA FEUILLE S'ÉLARGIT POUR ELLE. Une note ordinaire tient dans une
  // colonne courte, qui se lit mieux ; une formule, non — coupée, elle
  // part dans une barre de défilement horizontale et le lecteur doit la
  // faire glisser pour en voir la fin. C'est le contraire de ce qu'on lui
  // demande. La feuille prend donc toute sa largeur quand il y a un bloc,
  // et la reprend quand il n'y en a plus.
  byId('note-sheet').querySelector('.sheet-inner')
    .classList.toggle('narrow', !n.pre);

  // Et les symboles juste dessous, un par ligne : le lecteur regarde la
  // formule, bute sur un signe, descend d'un centimètre.
  const defs = byId('note-defs');
  defs.replaceChildren();
  if (n.defs) {
    for (const [sigle, dit] of n.defs) {
      const dt = document.createElement('dt'); dt.textContent = sigle;
      const dd = document.createElement('dd'); dd.textContent = dit;
      defs.append(dt, dd);
    }
  }
  defs.hidden = !n.defs;

  // Une note sans « pourquoi » n'affiche pas un paragraphe vide — et
  // surtout pas le mot « undefined », qui est ce qu'écrivait la ligne
  // précédente le jour où j'ai retiré celui de la formule.
  const pq = byId('note-pourquoi');
  pq.textContent = n.pourquoi || '';
  pq.hidden = !n.pourquoi;

  byId('note-sheet').hidden = false;
  byId('note-close').focus();
}

function closeNote() {
  byId('note-sheet').hidden = true;
  noted = null;
  showSwitch('p-formule', false);
}

// Sur un mur, on ne veut pas refaire ses réglages à chaque allumage. Tout
// est enveloppé : le stockage peut être refusé, et la page doit tenir sans.
// Le numéro fait partie de la clé : changer une valeur par défaut dans
// index.html ne sert à rien si la page relit l'ancienne. Quand un défaut
// bouge et qu'il doit s'imposer, on incrémente.
const STORE_KEY = 'estimateur.reglages.3';

function saveKnobs() {
  try {
    const o = { belief: view.belief, couleur: byId('s-couleur').checked,
                porte: byId('s-porte').checked,
                iface: byId('p-interface').checked, poeme: byId('p-poeme').checked,
                temps: Object.keys(TEMPS).find(k => byId('t-' + k).checked),
                rig: view.rig, clock: clockWanted, plis: folded };
    for (const id of Object.keys(KNOBS)) o[id] = +byId(id).value;
    localStorage.setItem(STORE_KEY, JSON.stringify(o));
  } catch (e) { /* sans mémoire, la page marche quand même */ }
}

function loadKnobs() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { /* tant pis */ }
  if (!o) return;
  for (const id of Object.keys(KNOBS))
    if (typeof o[id] === 'number') byId(id).value = bound(o[id], 0, 100);
  if (o.belief && typeof o.belief.m === 'number') Object.assign(view.belief, o.belief);
  byId('s-couleur').checked = o.couleur !== false;
  byId('s-porte').checked = !!o.porte;
  byId('p-interface').checked = o.iface !== false;
  byId('p-poeme').checked = !!o.poeme;
  if (o.temps in TEMPS) byId('t-' + o.temps).checked = true;
  byId(o.rig === 'mini' ? 'rig-mini' : 'rig-laptop').checked = true;
  // L'horloge voulue seulement : la case « météo » ne se coche qu'à
  // l'arrivée du fichier, dans weatherArrived.
  clockWanted = o.clock === 'dev' ? 'dev' : 'meteo';
  if (o.plis) for (const [, bodyId] of FOLDS)
    if (typeof o.plis[bodyId] === 'boolean') folded[bodyId] = o.plis[bodyId];
}

// ================================================================ LE DESSIN

function fitPlot(cv) {
  const w = cv.clientWidth, h = cv.clientHeight, r = view.dpr;
  if (!w || !h) return null;
  if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) {
    cv.width = Math.round(w * r);
    cv.height = Math.round(h * r);
  }
  const g = cv.getContext('2d');
  g.setTransform(r, 0, 0, r, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

function dashAcross(g, x0, y0, x1, y1, colour, dash) {
  g.save();
  g.setLineDash(dash || [1, 3]);
  g.strokeStyle = colour;
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(x0, y0 + .5); g.lineTo(x1, y1 + .5); g.stroke();
  g.restore();
}

/** L'étiquette d'un pic : une boîte sur papier, posée au bout d'une tige. */
function peakTag(g, x, y, text, stemTo, plotW) {
  g.font = '9px ' + cssOf('--mono');
  const bw = g.measureText(text).width + 7, bh = 12;
  const bx = bound(Math.round(x - bw / 2), 1, plotW - bw - 1);
  const by = Math.round(y);
  if (stemTo != null) {
    g.strokeStyle = cssOf('--ink-faint');
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(x) + .5, by + bh);
    g.lineTo(Math.round(x) + .5, stemTo);
    g.stroke();
  }
  g.fillStyle = cssOf('--paper');
  g.fillRect(bx, by, bw, bh);
  g.strokeStyle = cssOf('--ink-faint');
  g.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);
  g.fillStyle = cssOf('--ink');
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText(text, bx + 4, by + bh / 2 + .5);
}

/** La valeur courante, contre le bord droit, pointée vers la courbe. */
function nowTag(g, w, y, text) {
  g.font = '12px ' + cssOf('--mono');
  const bw = g.measureText(text).width + 13, bh = 17, x = w - bw - 6;
  g.beginPath();
  g.moveTo(x, y - bh / 2); g.lineTo(x + bw - 6, y - bh / 2);
  g.lineTo(x + bw, y); g.lineTo(x + bw - 6, y + bh / 2);
  g.lineTo(x, y + bh / 2); g.closePath();
  g.fillStyle = cssOf('--paper'); g.fill();
  g.strokeStyle = cssOf('--ink'); g.lineWidth = 1; g.stroke();
  g.fillStyle = cssOf('--ink');
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(text, x + 6, y + 1);
}

// ------------------------------------------------------------- l'héliodon
// L'ÉCHELLE SUIT LES DONNÉES. Une compression hors fenêtre était astucieuse
// et illisible : on ne savait plus ce que valait une hauteur. L'axe est donc
// linéaire et se recadre sur ce que la courbe parcourt, en gardant toujours
// la fenêtre 0–42° dans le champ. Ce qui se passe dehors est en pointillé
// léger : ça ne compte pas, mais ça dit que le soleil est passé par là.

function drawHeliodon() {
  const fitted = fitPlot(byId('p-sun'));
  if (!fitted || !past.length) return;
  const { g, w, h } = fitted;

  const plotW = w - 30, TOP = 4, BOT = h - 11;     // 11 px pour l'axe du temps

  // Le cadre s'ouvre sur ce que la courbe parcourt, mais PAS jusqu'à la
  // nuit profonde : à une latitude moyenne le soleil descend à −50°, et
  // laisser l'échelle suivre écrasait la fenêtre 0–42° — la seule qui
  // compte — sur un tiers de la hauteur. Au-delà des bornes, la courbe
  // sort du cadre en pointillé : ça se lit « très bas », « très haut »,
  // et c'est tout ce qu'on a besoin d'en savoir.
  let lo = 0, hi = SUN_MAX;
  for (const s of past) { if (s.h < lo) lo = s.h; if (s.h > hi) hi = s.h; }
  const pad = Math.max(3, (hi - lo) * 0.07);
  lo = Math.max(lo - pad, -18);
  hi = Math.min(hi + pad, 60);
  const yOf = d => BOT - (d - lo) / (hi - lo) * (BOT - TOP);

  const y0 = yOf(0), y42 = yOf(SUN_MAX);

  // CE QUE LA PORTE LAISSE FUIR. Deux bandes plus claires de part et
  // d'autre de la fenêtre, d'autant plus marquées qu'on croit à la
  // chance. Sans elles, une présence non nulle avec la courbe du soleil
  // hors de la bande grise passerait pour un bug.
  //
  // Les bornes de la fuite tombent sur −17,6° et 60° : exactement le
  // cadre que ce graphe se donnait déjà. Heureuse coïncidence, rien de
  // plus — mais elle veut dire que la fuite est toujours dans le champ.
  const wc = beliefWeights().c;
  if (wc > 0.02) {
    // Bornées au cadre : sous les tropiques la courbe ne descend pas à
    // −17°, et la bande déborderait sous l'axe du temps.
    const yb = v => bound(yOf(v), TOP, BOT);
    g.fillStyle = `rgba(20,22,26,${(0.055 * wc).toFixed(3)})`;
    g.fillRect(0, yb(SUN_MAX + SPILL_DEG), plotW, y42 - yb(SUN_MAX + SPILL_DEG));
    g.fillRect(0, y0, plotW, yb(0.4 - SPILL_DEG) - y0);
  }

  g.fillStyle = 'rgba(20,22,26,0.05)';
  g.fillRect(0, y42, plotW, y0 - y42);

  for (const age of [24, 6, 1]) {
    const x = plotW * posOf(age);
    if (x > 8 && x < plotW - 8) dashAcross(g, x, TOP, x, BOT, 'rgba(20,22,26,0.07)');
  }

  const now = past[past.length - 1].t;
  const X = s => plotW * posOf(now - s.t);
  const inBand = s => s.h > 0.4 && s.h < SUN_MAX;

  g.save();
  g.setLineDash([1, 4]);
  g.strokeStyle = 'rgba(20,22,26,0.24)';
  g.lineWidth = 1;
  g.beginPath();
  past.forEach((s, i) => { const x = X(s), y = yOf(s.h); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke();
  g.restore();

  // dans la fenêtre : plein, rempli jusqu'à l'horizon
  g.save();
  g.beginPath(); g.rect(0, y42, plotW, y0 - y42); g.clip();
  let open = false;
  g.beginPath();
  for (const s of past) {
    if (inBand(s)) {
      const x = X(s), y = yOf(s.h);
      if (!open) { g.moveTo(x, y0); g.lineTo(x, y); open = true; } else g.lineTo(x, y);
    } else if (open) { g.lineTo(X(s), y0); open = false; }
  }
  if (open) g.lineTo(X(past[past.length - 1]), y0);
  g.fillStyle = 'rgba(20,22,26,0.17)';
  g.fill();
  g.restore();

  open = false;
  g.beginPath();
  for (const s of past) {
    if (inBand(s)) {
      const x = X(s), y = yOf(s.h);
      open ? g.lineTo(x, y) : (g.moveTo(x, y), open = true);
    } else open = false;
  }
  g.strokeStyle = cssOf('--ink');
  g.lineWidth = 1.3;
  g.lineJoin = 'round';
  g.stroke();

  dashAcross(g, 0, y42, plotW, y42, cssOf('--ink-faint'));
  dashAcross(g, 0, y0,  plotW, y0,  cssOf('--ink-soft'));

  // --- les ordonnées. Le pas se choisit sur la PLACE disponible et non
  // sur l'amplitude : un graphe court ne peut pas porter cinq
  // graduations, elles se chevauchent et on ne lit plus rien.
  g.font = '9px ' + cssOf('--mono');
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const rows = Math.max(2, Math.floor((BOT - TOP) / 15));
  const step = [10, 20, 30, 60, 90, 180].find(v => v >= (hi - lo) / rows) || 180;
  for (let d = Math.ceil(lo / step) * step; d <= hi; d += step) {
    const y = yOf(d);
    if (Math.abs(y - y0) < 11 || Math.abs(y - y42) < 11) continue;
    dashAcross(g, 0, y, plotW, y, 'rgba(20,22,26,0.07)');
    g.fillStyle = cssOf('--ink-faint');
    g.fillText(d + '°', plotW + 4, y);
  }
  g.fillStyle = cssOf('--ink-soft');
  g.fillText('42°', plotW + 4, y42);
  g.fillText('0°',  plotW + 4, y0);

  // --- les abscisses : sans ça, on ne sait pas que c'est un temps
  g.textBaseline = 'top';
  g.fillStyle = cssOf('--ink-faint');
  g.fillText(AGE_MAX === 24 ? '1 j' : AGE_MAX + ' h', 0, BOT + 2);
  g.textAlign = 'right';
  g.fillStyle = cssOf('--ink-soft');
  g.fillText('maintenant', plotW, BOT + 2);
}

// ------------------------------------------------------------- la présence
// Les trois croyances empilées, chacune déjà multipliée par la porte : ce
// qu'on voit monter, c'est la part de chacune dans le résultat. La somme
// est la courbe noire, et c'est elle que le chevron chiffre.

function drawPresence() {
  const fitted = fitPlot(byId('p-idx'));
  if (!fitted || !past.length) return;
  const { g, w, h } = fitted;

  const plotW = w - 30, TOP = 14, BOT = h - 16;
  const yOf = v => BOT - v * (BOT - TOP);

  dashAcross(g, 0, yOf(0.5), plotW, yOf(0.5), cssOf('--ink-faint'));
  dashAcross(g, 0, yOf(1),   plotW, yOf(1),   cssOf('--ink-faint'));
  g.strokeStyle = cssOf('--ink-soft');
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, BOT + .5); g.lineTo(plotW, BOT + .5); g.stroke();

  const now = past[past.length - 1].t;
  const X = s => plotW * posOf(now - s.t);

  // Les poids sont appliqués ICI et non à l'échantillonnage : bouger un
  // curseur repondère toute l'histoire d'un coup, sans rien recalculer.
  const wt = beliefWeights();
  let base = past.map(() => 0);
  for (const [key, wk, colour] of [['m', wt.m, cssOf('--meteo')],
                                   ['l', wt.l, cssOf('--legende')],
                                   ['c', wt.c, cssOf('--chance')]]) {
    // La chance a sa propre porte : celle du soleil, ou la fuite. C'est
    // ce qui fait que la bande de chance dépasse maintenant la nuit,
    // exactement comme la carte.
    const gateOf = key === 'c'
      ? s => Math.max(s.gate, s.spill * wt.c)
      : s => s.gate;
    g.beginPath();
    past.forEach((s, i) => {
      const x = X(s), y = yOf(Math.min(1, base[i] + s[key] * wk * gateOf(s) * GAIN));
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    for (let i = past.length - 1; i >= 0; i--) g.lineTo(X(past[i]), yOf(Math.min(1, base[i])));
    g.closePath();
    g.fillStyle = colour;
    g.fill();
    base = past.map((s, i) => base[i] + s[key] * wk * gateOf(s) * GAIN);
  }

  g.beginPath();
  past.forEach((s, i) => {
    const x = X(s), y = yOf(Math.min(1, base[i]));
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.strokeStyle = cssOf('--ink');
  g.lineWidth = 1;
  g.stroke();

  // les deux derniers pics qui valaient la peine d'être nommés
  const peaks = [];
  for (let i = 3; i < past.length - 3; i++) {
    const v = base[i];
    if (v < 0.25) continue;
    if (v >= base[i-1] && v >= base[i+1] && v > base[i-3] && v > base[i+3]) {
      if (!peaks.length || X(past[i]) - X(past[peaks[peaks.length-1]]) > 50) peaks.push(i);
    }
  }
  for (const i of peaks.slice(-2)) {
    const v = Math.min(1, base[i]);
    peakTag(g, X(past[i]), Math.max(0, yOf(v) - 16), v.toFixed(2), yOf(v), plotW);
  }

  g.font = '9px ' + cssOf('--mono');
  g.fillStyle = cssOf('--ink-faint');
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  for (const [v, t] of [[1, '1.0'], [0.5, '0.5'], [0, '0']]) g.fillText(t, plotW + 4, yOf(v));

  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const [age, t] of [[24, '1 j'], [6, '6 h'], [1, '1 h']]) {
    const x = plotW * posOf(age);
    if (x < 10 || x > plotW - 64) continue;
    g.fillStyle = cssOf('--ink-faint');
    g.fillText(t, x, BOT + 4);
    dashAcross(g, x, TOP, x, BOT, 'rgba(20,22,26,0.07)');
  }
  // Sans ce mot, personne ne devine que l'axe est un temps, ni dans quel
  // sens il coule.
  g.textAlign = 'right';
  g.fillStyle = cssOf('--ink-soft');
  g.fillText('maintenant', plotW, BOT + 4);

  const end = Math.min(1, base[base.length - 1]);
  nowTag(g, w, yOf(end), end.toFixed(2));
}

// ============================================================== LES PASTILLES
// Elles ne sélectionnent rien : elles amènent le réticule. Le sujet reste
// le centre de l'écran, toujours.

function buildChips() {
  const box = byId('chips');
  for (const l of LEGEND_POINTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = l.nom;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => walkTo(l.lon, l.lat));
    box.appendChild(b);
  }
}

// ============================================================ LA PROVENANCE
// Citer une croyance sans dire d'où elle vient, sur un mur, sous un nom
// propre, c'est de l'appropriation avec une jolie police. La phrase porte
// donc un renvoi, et le renvoi dit d'où elle vient.
//
// LE MÊME MARQUEUR POUR TOUTES, sourcées ou non : un triangle avec un i.
// Deux signes différents auraient trié les légendes à la lecture, avant
// même qu'on ait cliqué — et fait du manque de source un défaut visible
// plutôt qu'un fait à constater. Le triangle ne juge pas : il dit qu'il y
// a quelque chose à savoir. Ce qu'on y trouve, c'est la boîte qui le dit.
//
// Dessiné au trait et non en caractère : « ⓘ » est un cercle, il n'existe
// pas de triangle-i en Unicode, et un glyphe de police ne survivrait pas
// au tramage de l'e-ink de la même façon qu'un tracé.
const INFO_SVG =
  '<svg viewBox="0 0 12 11" aria-hidden="true">' +
    '<path d="M6 1 L11.2 10 L0.8 10 Z" fill="none" stroke="currentColor"' +
      ' stroke-width="1" stroke-linejoin="round"/>' +
    '<circle cx="6" cy="5" r="0.62" fill="currentColor"/>' +
    '<path d="M6 6.5 L6 8.6" stroke="currentColor" stroke-width="1.1"' +
      ' stroke-linecap="round"/>' +
  '</svg>';

const FLOOR_SAID = 'Partout on y croit un peu — c’est le plancher.';

/** Le haut lieu dont la bulle parle. Null quand elle est fermée. */
let shown = null;

/**
 * Le dernier haut lieu écrit. `refreshPanel` passe soixante fois par
 * seconde : refabriquer le bouton à chaque image le rendrait incliquable
 * — le clic partirait sur un nœud déjà remplacé — en plus d'être du
 * gâchis. On ne réécrit que quand le lieu change.
 */
let saidFor;

function showSaid(leg) {
  if (leg === saidFor) return;
  saidFor = leg;

  const p = byId('said');
  p.textContent = leg ? leg.dit : FLOOR_SAID;
  if (!leg) return;

  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'src-mark';
  b.innerHTML = INFO_SVG;
  b.title = 'D’où vient cette phrase';
  b.setAttribute('aria-label', b.title);
  b.addEventListener('click', () => openSrc(leg));
  p.append(' ', b);
}

function openSrc(leg) {
  shown = leg;
  byId('src-nom').textContent = leg.nom;
  byId('src-dit').textContent = leg.dit;

  // La boîte ne commente pas, elle cite. Un avertissement sur ce que la
  // source atteste vraiment tenait ici : il pesait plus que la phrase
  // qu'il accompagnait, et une œuvre n'a pas à se justifier dans sa
  // propre marge. Ce travail-là vit dans LEGENDES.md.
  const qui = byId('src-qui');
  qui.textContent = 'Source : ';
  if (leg.src) {
    const a = document.createElement('a');
    a.href = leg.src.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = leg.src.qui;
    qui.append(a);
  } else {
    qui.append('(sans source)');
  }
  byId('src-sheet').hidden = false;
  byId('src-close').focus();
}

function closeSrc() {
  byId('src-sheet').hidden = true;
  shown = null;
}

// ================================================================ LA PLAQUE
// Les commandes gravées dans l'inox, TEXTES.md §9. Une entrée par
// commande, et c'est la seule : la page y passe, le Raspberry Pi y
// passera. Chaque entrée pose l'état et remet le curseur de la page à sa
// place — la page reste le miroir exact du métal.
//
//     boutons rotatifs 0–100 %     plaque.meteo(55), plaque.icones(32)…
//     interrupteurs                plaque.couloir(true)
//     boutons poussoirs            plaque.maison()
//     Temps                        plaque.temps('hier' | 'maintenant' | 'demain')

/** Un interrupteur affiché : la case, et ON / OFF à côté. */
function showSwitch(id, on) {
  byId(id).checked = on;
  byId('o-' + id.slice(2)).textContent = on ? 'ON' : 'OFF';
}

/** Un bouton rotatif : on pose la valeur, et le curseur fait le reste. */
function turnKnob(id, p) {
  byId(id).value = bound(Math.round(p), 0, 100);
  SYNCS[id]();
}

// INTERFACE. Éteinte, il ne reste que la carte — et, dans un navigateur,
// un petit bouton en coin et la touche « i » pour la rallumer, puisque
// l'interrupteur de la page est lui-même dans le panneau qu'on cache.
let bare = false;

function showInterface() {
  const on = byId('p-interface').checked;
  bare = !on;
  showSwitch('p-interface', on);
  document.body.classList.toggle('bare', bare);
  byId('iface-on').hidden = on;
  measureRail();
  repaint();
  saveKnobs();
}

// FORMULE. La même feuille que le « ? » du registre ALGORITHME : ouvrir
// l'un coche l'autre, fermer la feuille éteint l'interrupteur.
function showFormule() {
  if (byId('p-formule').checked) openNote('formule');
  else if (noted === 'formule') closeNote();
  else showSwitch('p-formule', false);
}

// POÈME. Par-dessus la carte. Le texte reste à écrire : index.html tient
// la place.
function showPoeme() {
  const on = byId('p-poeme').checked;
  showSwitch('p-poeme', on);
  byId('poeme').hidden = !on;
  saveKnobs();
}

/**
 * Le piéton est posé là, au centre de l'écran, la carte remise droite —
 * le nord en haut. Le zoom ne bouge pas.
 */
function walkTo(lon, lat) {
  faceNorth(lon, lat);
  repaint();
}

// ARC-EN-CIEL. Le point de plus haute présence de TOUTE la Terre, à
// l'instant de l'appui — pas seulement de l'écran. Aucune remise à
// l'échelle : le maximum peut être faible, on y va quand même. Si l'on ne
// croit à rien, il n'y a nulle part où aller.
function arcEnCiel() {
  const best = brightest(solar(simDate()), drift(), driftChance(),
                         beliefWeights(), centreVec());
  if (best.v > 0) walkTo(best.lon, best.lat);
}

// TÉLÉPORTATION. Un haut lieu, au hasard — jamais celui où l'on est déjà.
function teleportation() {
  const [lon, lat] = centre();
  const here = nearestLegend(lon, lat);
  const pool = LEGEND_POINTS.filter(l => l !== here);
  const l = pool[Math.floor(Math.random() * pool.length)];
  walkTo(l.lon, l.lat);
}

// MAISON. Paris. Le nom de la ville n'est pas gravé.
const MAISON = { lon: 2.3522, lat: 48.8566 };

function maison() { walkTo(MAISON.lon, MAISON.lat); }

// REPÈRE. Pose un repère sous le piéton ; si le piéton est déjà sur un
// repère, l'efface. « Sur » se juge À L'ÉCRAN, à la taille du signe : ce
// qu'on voit sous ses pieds, à n'importe quel zoom. Un jour au plus, en
// temps réel, et mémorisé à part — ce n'est pas un réglage.
const REPERE_PX = 12;
const REPERE_KEY = 'estimateur.reperes.1';

function repere() {
  view.reperes = liveReperes();
  const Rt = matT(view.R), k = view.look.icon / 15;
  const hit = view.reperes.findIndex(r => {
    const f = flatten(Rt, geoVec(r.lon, r.lat));
    return Math.hypot(sx(f[0]) - view.W / 2, sy(f[1]) - view.H / 2) < REPERE_PX * k;
  });
  if (hit >= 0) view.reperes.splice(hit, 1);
  else {
    const [lon, lat] = centre();
    view.reperes.push({ lon, lat, at: Date.now() });
  }
  try { localStorage.setItem(REPERE_KEY, JSON.stringify(view.reperes)); }
  catch (e) { /* sans mémoire, le repère vit jusqu'au rechargement */ }
  repaint();
}

function loadReperes() {
  try {
    const a = JSON.parse(localStorage.getItem(REPERE_KEY) || '[]');
    if (Array.isArray(a)) view.reperes = a.filter(r =>
      typeof r.lon === 'number' && typeof r.lat === 'number' && typeof r.at === 'number');
  } catch (e) { /* tant pis */ }
  view.reperes = liveReperes();
}

export const plaque = {
  interface:      on => { byId('p-interface').checked = !!on; showInterface(); },
  formule:        on => { byId('p-formule').checked = !!on; showFormule(); },
  poeme:          on => { byId('p-poeme').checked = !!on; showPoeme(); },

  meteo:          p => setBelief('m', p),
  legendes:       p => setBelief('l', p),
  chance:         p => setBelief('c', p),
  arcEnCiel,
  repere,
  teleportation,
  maison,

  temps:          pos => {
    if (!(pos in TEMPS)) return;
    byId('t-' + pos).checked = true;
    showTemps();
  },

  contrasteTerre: p => turnKnob('s-terres', p),
  contrasteMer:   p => turnKnob('s-mer', p),
  irisation:      p => turnKnob('s-franges', p),
  sensibilite:    p => turnKnob('s-seuil', p),
  icones:         p => turnKnob('s-icon', p),
  couloir:        on => { byId('s-porte').checked = !!on; showPorte(); },
  couleur:        on => { byId('s-couleur').checked = !!on; showCouleur(); }
};

// ================================================================ LA LECTURE

const HHMM = n => String(n).padStart(2, '0');

/**
 * Appelé à chaque image dessinée. `c` est le centre géographique de
 * l'écran — le réticule — et `sun` le soleil de l'instant simulé.
 */
export function refreshPanel(sun, c, now) {
  // Interface éteinte, personne ne lit le panneau : on ne le calcule pas.
  if (bare) return;
  const [lon, lat] = c;
  recall(lon, lat);
  const last = past[past.length - 1];
  const wt = beliefWeights();

  byId('f-pos').textContent =
    `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'N' : 'S'}  ` +
    `${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'O'}`;
  // Date en chiffres : « 19 sept. » passait à la ligne et faisait sauter
  // la boîte d'un pixel à chaque changement de mois.
  byId('f-clock').textContent =
    `${HHMM(now.getUTCHours())}:${HHMM(now.getUTCMinutes())} UTC · ` +
    `${HHMM(now.getUTCDate())}/${HHMM(now.getUTCMonth() + 1)}`;

  // La durée restante est la SEULE valeur exacte de la page : elle ne
  // dépend que du soleil.
  const mn = last.gate > 0 ? openFor(lon, lat, sun) : null;
  const reste = mn == null ? ''
    : ' ' + (mn >= 90 ? (mn / 60).toFixed(1) + ' h' : Math.round(mn) + ' min');
  // Porte fermée, la chance peut encore passer — il faut le dire, sinon
  // une présence non nulle en pleine nuit ressemble à une panne.
  const leak = last.gate <= 0 && last.spill * wt.c > 0.02;
  byId('h-sun').textContent = last.h.toFixed(1) + '° · ' +
    (last.gate > 0 ? 'ouverte' + reste
                   : (last.h <= 0.4 ? 'nuit' : 'trop haut') +
                     (leak ? ' · la chance passe' : ''));

  // Même formule que le shader, au réticule : la flaque y vaut 1, et la
  // chance a sa propre porte.
  const gC = Math.max(last.gate, last.spill * wt.c);
  const idx = Math.min(1, ((last.m * wt.m + last.l * wt.l) * last.gate
                        + last.c * wt.c * gC) * GAIN);
  byId('h-idx').textContent = idx.toFixed(2);

  const near = nearestLegend(lon, lat);
  showSaid(near);
  const kids = byId('chips').children;
  for (let i = 0; i < kids.length; i++)
    kids[i].setAttribute('aria-pressed', String(LEGEND_POINTS[i] === near));

  drawHeliodon();
  drawPresence();
  showBeat();
}

// ============================================================== LE DÉMARRAGE

export function initPanel(invalidate, resize) {
  repaint = invalidate;
  remeasure = resize || invalidate;

  // Les plis d'usine d'abord : loadKnobs n'écrase que ce qu'il connaît.
  for (const [, bodyId, openByDefault] of FOLDS) folded[bodyId] = !openByDefault;

  loadKnobs();
  loadReperes();
  buildChips();

  // L'ADMIN ne se montre que par /admin — admin/index.html renvoie ici
  // avec « ?admin ». Caché, pas protégé.
  const admin = new URLSearchParams(location.search).has('admin');
  byId('box-admin').hidden = !admin;
  // La page publique ne garde que les trois boîtes du tableau — titre,
  // héliodon, algorithme. LÉGENDES et RÉGLAGES ne restent que dans
  // l'admin ; la plaque, elle, appelle toujours `plaque` (décision de
  // l'auteur, 3 octobre).
  byId('box-leg').hidden = !admin;
  byId('box-reg').hidden = !admin;

  for (const [id, key] of SHARES) {
    const input = byId(id);
    input.addEventListener('input', () => setBelief(key, +input.value));
  }
  showBelief();

  // LES DEUX CHOIX D'ABORD, ET L'ORDRE COMPTE.
  //
  // La machine, parce que `measure` lit son plafond de pixels : la poser
  // après taillerait les deux calques une seconde fois au démarrage. D'où
  // l'affectation directe plutôt qu'un appel à showRig, qui déclencherait
  // très exactement ce second taillage.
  //
  // L'horloge, parce que le curseur du temps lui demande s'il est une
  // vitesse ou un « quand ». Le synchroniser avant que `view.clock` soit
  // restauré afficherait une vitesse là où un réglage mémorisé dit
  // « maintenant ».
  for (const id of ['rig-laptop', 'rig-mini'])
    byId(id).addEventListener('change', showRig);

  // LES COUPURES. Une case par poste ; cochée, le poste n'est plus dessiné.
  // Jamais mémorisées — voir `view.cut`.
  for (const key of Object.keys(view.cut)) {
    const input = byId('cut-' + key);
    input.checked = view.cut[key];
    input.addEventListener('change', () => { view.cut[key] = input.checked; repaint(); });
  }

  // LA RÉSOLUTION DU SHADER — voir `view.gls`. Retaille les calques.
  const gls = byId('s-gls');
  const showGls = () => {
    view.gls = +gls.value / 100;
    gls.style.setProperty('--p', gls.value + '%');
    byId('o-gls').textContent = gls.value + ' %';
    remeasure();
  };
  gls.value = Math.round(view.gls * 100);
  gls.addEventListener('input', showGls);

  // LE PLEIN ÉCRAN, pour le Pi qui n'a pas de clavier (la touche « f ») :
  // un bouton dans l'admin, un autre dans le coin de la carte. Celui du
  // coin s'efface une fois en plein écran, et n'existe pas si le
  // navigateur ne sait pas le faire.
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };
  byId('plein-ecran').addEventListener('click', toggleFull);
  const plein = byId('plein');
  plein.addEventListener('click', toggleFull);
  const showFull = () => {
    plein.hidden = !document.fullscreenEnabled || !!document.fullscreenElement;
  };
  document.addEventListener('fullscreenchange', showFull);
  showFull();
  view.rig = byId('rig-mini').checked ? 'mini' : 'laptop';

  for (const id of ['clk-dev', 'clk-meteo'])
    byId(id).addEventListener('change', showClock);
  view.clock = 'dev';

  for (const [id, knob] of Object.entries(KNOBS)) {
    const input = byId(id);
    const sync = () => {
      const t = +input.value / 100;
      input.style.setProperty('--p', input.value + '%');
      byId('o-' + id.slice(2)).textContent = knob.fmt(t);
      knob.apply(t);
      saveKnobs();
    };
    // Rangée pour que l'horloge puisse rejouer celle du temps : quand le
    // rail change de signification, il faut relire sa valeur avec la
    // nouvelle règle, sans attendre que la main y revienne.
    SYNCS[id] = sync;
    input.addEventListener('input', sync);
    sync();
  }

  // LA PLAQUE. Les cases et les boutons de la page passent par `plaque`,
  // comme le fera le Pi ; les curseurs, par leur `sync`, qui est ce que
  // `plaque` appelle aussi.
  byId('s-couleur').addEventListener('change', e => plaque.couleur(e.target.checked));
  byId('s-porte').addEventListener('change', e => plaque.couloir(e.target.checked));
  byId('p-interface').addEventListener('change', e => plaque.interface(e.target.checked));
  byId('p-formule').addEventListener('change', e => plaque.formule(e.target.checked));
  byId('p-poeme').addEventListener('change', e => plaque.poeme(e.target.checked));
  byId('p-arc').addEventListener('click', plaque.arcEnCiel);
  byId('p-repere').addEventListener('click', plaque.repere);
  byId('p-teleport').addEventListener('click', plaque.teleportation);
  byId('p-maison').addEventListener('click', plaque.maison);
  for (const k of Object.keys(TEMPS))
    byId('t-' + k).addEventListener('change', () => plaque.temps(k));
  byId('iface-on').addEventListener('click', () => plaque.interface(true));
  addEventListener('keydown', e => {
    if (e.key !== 'i' && e.key !== 'I') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'BUTTON')) return;
    plaque.interface(bare);
  });

  showCouleur();
  showPorte();
  showTemps();
  showInterface();
  showPoeme();

  // LES APPELS DE NOTE, par délégation. Les boutons vivent dans index.html
  // et ne sont jamais refabriqués — un seul écouteur sur le registre entier
  // suffit, et il survivra aux lignes qu'on ajoutera.
  for (const zone of ['corps-adm', 'corps-croy'])
    byId(zone).addEventListener('click', e => {
      const b = e.target.closest('.ask');
      if (b) openNote(b.dataset.note);
    });

  // LE REGISTRE DES DONNÉES bat à sa propre cadence : une fois par
  // seconde, et SEULEMENT s'il est ouvert. La boucle d'images, elle, peut
  // dormir des heures — c'est tout l'intérêt de la pièce — et l'état des
  // données doit rester vrai pendant ce temps. Replié sur le tableau du
  // mur, il ne coûte plus rien du tout.
  // La minuterie s'arrête dès que le registre est replié — À N'IMPORTE
  // QUEL niveau — et hors de l'admin : sur le tableau du mur, elle ne
  // coûtera plus rien.
  const dataSeen = () => admin && !bare && !folded['corps-data']
                       && !folded['corps-dat'] && !folded['corps-adm'];
  showData();
  setInterval(() => { if (dataSeen()) showData(); }, 1000);

  const note = byId('note-sheet');
  byId('note-close').addEventListener('click', closeNote);
  note.addEventListener('click', e => { if (e.target === note) closeNote(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && noted) closeNote(); });

  // La feuille de provenance. Même mécanique que l'explication : clic hors
  // du cadre ou Échap. Elle vit ici et non dans chrome.js parce que son
  // contenu est celui du registre — c'est le panneau qui sait quel haut
  // lieu est sous le réticule.
  const sheet = byId('src-sheet');
  byId('src-close').addEventListener('click', closeSrc);
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSrc(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && shown) closeSrc(); });

  for (const [btnId, bodyId] of FOLDS) {
    showFold(btnId, bodyId);
    byId(btnId).addEventListener('click', () => {
      folded[bodyId] = !folded[bodyId];
      showFold(btnId, bodyId);
      saveKnobs();
      // Le panneau a changé de hauteur : la carte peut regagner la place
      // libérée pour y écrire des noms.
      measureRail();
      repaint();
    });
  }

  // Le contour de focus n'apparaît qu'au clavier. Chrome le dessine aussi
  // au clic sur une case à cocher, ce qui salit le panneau sans rendre
  // service à personne.
  addEventListener('keydown', e => { if (e.key === 'Tab') root.classList.add('kbd'); });
  addEventListener('pointerdown', () => root.classList.remove('kbd'));
}
