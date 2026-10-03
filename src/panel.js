// =========================================================================
//  LE PANNEAU — estimateur, algorithme, légendes, réglages ; admin par /admin.
//  Tout ce qu'il affiche décrit LE RÉTICULE, le centre de l'écran.
//  Chaque commande de la plaque a une seule entrée : l'objet `plaque`, que
//  la page et le Raspberry Pi appellent. Ne calcule rien du ciel : lit
//  `history.past` et le pose à l'écran.
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

/** Posé par initPanel : retaille les deux calques (pixels réels changés). */
let remeasure = () => {};

/** Posé par initPanel : le détail du shader, mesuré à la demande (admin). */
let profile = () => null;

// ================================================================ LA CROYANCE
// Trois boutons INDÉPENDANTS : aucun ne pousse les autres, comme les
// boutons rotatifs de la plaque. `beliefWeights` normalise.

const SHARES = [['w-m', 'm', 'o-m'], ['w-l', 'l', 'o-l'], ['w-c', 'c', 'o-c']];

/** Le `sync` de chaque curseur, posé par initPanel. */
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
// [bouton, corps, ouvert d'usine]. Les registres, puis l'admin sur deux
// niveaux. Un parent replié cache ses enfants sans toucher à leur état.
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
  // `.sub` d'abord : sinon plier un sous-registre plierait toute la boîte.
  (body.closest('.sub') || body.closest('.box')).classList.toggle('folded', !open);
  const b = byId(btnId);
  b.textContent = open ? '−' : '+';
  b.setAttribute('aria-expanded', String(open));
  b.setAttribute('aria-label', open ? 'Replier' : 'Déplier');
}

// ============================================================ LES RÉGLAGES

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
 * Curseur des aplats en deux moitiés : 0–50 % du papier nu au tirage
 * d'origine, 50–100 % jusqu'à INK_MAX — l'origine tombe au milieu du rail.
 * La mer a une gamme d'encre plus courte, d'où une course plus longue.
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

  // COMBIEN DE FOIS LA PALETTE FAIT LE TOUR (ordre d'interférence).
  // Au-delà de deux tours la carte devient illisible.
  's-franges':  { fmt: t => Math.round(t * 100) + ' %',
                  apply: t => { view.look.franges = tween(0.30, 3.50, t); repaint(); } },

  // LA SENSIBILITÉ — le seuil : sous cette présence, du papier. La course
  // s'arrête à SEUIL_MAX et non à 1, où plus rien ne s'allumait.
  's-seuil':    { fmt: t => Math.round(t * 100) + ' %',
                  apply: t => { view.look.seuil = t * SEUIL_MAX; repaint(); } },

  // LA FINESSE : un gain sur ce que le zoom révèle ; sans effet au monde
  // entier. Milieu du rail = usine.
  's-fine':     { fmt: t => (t <= 0.005 ? 'aplat' : Math.round(t * 200) + ' %'),
                  apply: t => { view.look.fine = t * 2; repaint(); } },

  // LE COULOIR : écart des points et épaisseur du trait, indépendants.
  // Chiffres valables au monde entier ; de près l'écart s'allonge (uPorte).
  's-ecart':    { fmt: t => Math.round(tween(0.5, 3.0, t) * 12) + ' px',
                  apply: t => { view.look.pas = tween(0.5, 3.0, t); repaint(); } },

  's-trait':    { fmt: t => (tween(0.5, 3.0, t) * 1.6).toFixed(1) + ' px',
                  apply: t => { view.look.trait = tween(0.5, 3.0, t); repaint(); } },

  // LA PROFONDEUR D'ENCRE des aplats : le milieu du curseur est le tirage
  // d'origine (voir inkDepth).
  's-terres':   { fmt: t => Math.round(t * 100) + ' %',
                  apply: t => { view.look.land = inkDepth(t, 'land'); repaint(); } },

  's-mer':      { fmt: t => Math.round(t * 100) + ' %',
                  apply: t => { view.look.sea = inkDepth(t, 'sea'); repaint(); } },

  's-text':     { fmt: t => tween(9, 14, t).toFixed(0) + ' px',
                  apply: t => root.style.setProperty('--ui-pt', tween(9, 14, t).toFixed(1) + 'px') },

  // ICÔNES : la taille de toutes les icônes de la carte.
  's-icon':     { fmt: t => Math.round(t * 100) + ' %',
                  apply: t => { view.look.icon = tween(9, 28, t); repaint(); } },

  // LE POINT DU RÉTICULE. Zéro : à l'encre (usine). Au-delà, une teinte
  // franche, pour rester visible par-dessus une tache irisée.
  's-point':    { fmt: t => (t <= 0.02 ? 'encre' : Math.round(t * 360) + '°'),
                  apply: t => { view.look.dot = t; repaint(); } },

  // LA VITESSE, en dev seulement : cinq décades. En météo elle s'éteint
  // et c'est Temps qui dit quand.
  's-time':     { fmt: t => (t <= 0 ? 'figé'
                             : '×' + Math.round(Math.pow(10, t * 5)).toLocaleString('fr-FR')),
                  apply: t => { view.speed = t <= 0 ? 0 : Math.pow(10, t * 5); repaint(); } }
};

/**
 * Haut de la course de Sensibilité : ~99e centile de la présence du globe
 * (mesuré en dev). À 100 %, il reste le centième le plus fort. À revoir
 * devant la vraie météo.
 */
const SEUIL_MAX = 0.7;

// COULEUR. ON, l'irisation ; OFF, le dégradé : la force passe par la
// densité, en paliers et en points.
function showCouleur() {
  const on = byId('s-couleur').checked;
  view.look.grey = on ? 0 : 1;
  byId('o-couleur').textContent = on ? 'ON' : 'OFF';
  // Sans teinte, saturation et irisation n'agissent plus : on les éteint.
  for (const k of ['colour', 'franges']) {
    byId('s-' + k).disabled = !on;
    byId('l-' + k).classList.toggle('off', !on);
  }
  repaint();
  saveKnobs();
}

// LE COULOIR. Deux pointillés, soleil à 0° et à 42° : la fenêtre rendue
// visible. Une région éteinte entre eux manque de pluie ; dehors, d'heure.
// Éteint par défaut.
function showPorte() {
  const on = byId('s-porte').checked;
  view.look.porte = on ? 1 : 0;
  byId('o-porte').textContent = on ? 'ON' : 'OFF';
  // Couloir éteint, ses deux mesures s'éteignent aussi.
  for (const k of ['ecart', 'trait']) {
    byId('s-' + k).disabled = !on;
    byId('l-' + k).classList.toggle('off', !on);
  }
  repaint();
  saveKnobs();
}

// ============================================================ LA PERFORMANCE

function showRig() {
  view.rig = byId('rig-mini').checked ? 'mini' : 'laptop';
  // Pixels réels changés : retailler, un redessin ne suffit pas.
  remeasure();
  saveKnobs();
}

// ================================================================ L'HORLOGE
// L'heure et la pluie vont ensemble : dev (temps inventé, pluie simulée)
// ou météo (temps réel, vraie prévision). `clockWanted` est le choix
// mémorisé ; la page reste en dev tant que data/weather.png n'est pas là.

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

// TEMPS — le bouton à trois positions, en heures. En dev il s'éteint et
// la vitesse de l'admin reprend la main.
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
 * Les jauges, quatre fois par seconde au plus : écrire dans le document à
 * chaque image fausserait la mesure elle-même.
 */
let gaugeAt = 0;

function showBeat() {
  const t = performance.now();
  if (t - gaugeAt < 250) return;
  gaugeAt = t;

  const rest = beatIdle();
  const ms = v => v.toFixed(v < 10 ? 2 : 1) + ' ms';

  // La boucle s'arrête quand rien ne bouge : « repos », pas une cadence figée.
  byId('g-fps').textContent = rest ? 'repos' : Math.round(beat.fps) + ' im/s';

  // Tiret : le navigateur refuse l'extension de mesure, pas un coût nul.
  const gpu = view.cut.shader ? null : gpuMs();
  byId('g-gpu').textContent = gpu == null ? '—' : ms(gpu);

  byId('g-ms').textContent    = ms(beat.ms);
  byId('g-map').textContent   = ms(beat.map);
  byId('g-ink').textContent   = ms(beat.ink);
  byId('g-panel').textContent = ms(beat.panel);
  byId('g-px').textContent    = (pixelCount() / 1e6).toFixed(2) + ' Mpx';
}

// ============================================================== LES DONNÉES
// Ce qui est arrivé, de quand date la météo, d'où la page est servie.
// Les tailles viennent de `performance.getEntriesByType('resource')`.

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
 * Reconstruit la liste, une fois par seconde au plus (minuterie
 * d'initPanel). Refabriquer les nœuds est sans risque : rien n'y est
 * cliquable.
 */
function showData() {
  const box = byId('data-list');
  const seen = new Map();
  for (const e of performance.getEntriesByType('resource'))
    seen.set(e.name.split('?')[0], e);

  const rows = [];
  let manque = 0;

  for (const [path, nom] of DATA_FILES) {
    // D'abord ce qui est en route : `performance` ignore une ressource
    // tant qu'elle n'est pas arrivée. map.js et weather.js comptent les
    // octets au passage.
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
      // Météo absente : pas une anomalie, le relevé dessous l'explique.
      rows.push(dataRow(nom, nom === 'météo' ? 'absente' : 'en attente',
                        nom === 'météo' ? 'deep' : 'deep'));
      continue;
    }
    const e = hit[1];
    // transferSize vaut zéro depuis le cache : se rabattre sur les autres.
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

  // ---- d'où la page est servie : site en ligne ou copie locale.
  rows.push(dataRow('servi par',
    location.protocol === 'file:' ? 'un fichier local'
      : (location.host || 'inconnu'), 'deep'));

  if (manque)
    rows.unshift(dataRow('attention', manque > 1 ? `${manque} fichiers absents`
                                                 : '1 fichier absent', 'bad'));

  box.replaceChildren(...rows);
}

// ================================================================= LA NOTE
// Les « ? » de l'admin : `quoi` dit ce qui est mesuré, `pourquoi` sur quoi
// agir. `pre` et `defs` pour une formule.

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
    // Pas de `pourquoi` : la formule se suffit, la feuille finit sur les symboles.
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

  // Une formule se lit en bloc, et la feuille s'élargit pour elle : en
  // colonne étroite, elle partirait en défilement horizontal.
  const pre = byId('note-pre');
  pre.textContent = n.pre || '';
  pre.hidden = !n.pre;

  byId('note-sheet').querySelector('.sheet-inner')
    .classList.toggle('narrow', !n.pre);

  // Les symboles juste dessous, un par ligne.
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

  // Sans `pourquoi`, le paragraphe se cache (sinon : « undefined »).
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

// Réglages mémorisés. Le stockage peut être refusé : tout est enveloppé.
// Pour imposer un nouveau défaut d'index.html, incrémenter le numéro.
const STORE_KEY = 'estimateur.reglages.3';

// PIXEL et PALETTE : les cases de l'admin, et seules valeurs admises.
const PIX = [1, 4, 6, 8, 12];
const PAL = [0, 6, 8, 12];
const COASTS = ['aucune', 'encre', 'shader'];

function saveKnobs() {
  try {
    const o = { belief: view.belief, couleur: byId('s-couleur').checked,
                porte: byId('s-porte').checked,
                iface: byId('p-interface').checked, poeme: byId('p-poeme').checked,
                temps: Object.keys(TEMPS).find(k => byId('t-' + k).checked),
                rig: view.rig, clock: clockWanted, plis: folded,
                cut: view.cut, gls: view.gls, glsMove: view.glsMove,
                pix: view.pix, pal: view.pal, coasts: view.coasts };
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
  // L'horloge voulue seulement : « météo » se coche dans weatherArrived.
  clockWanted = o.clock === 'dev' ? 'dev' : 'meteo';
  if (o.cut) for (const k of Object.keys(view.cut))
    if (typeof o.cut[k] === 'boolean') view.cut[k] = o.cut[k];
  if ([0.8, 0.85, 0.9, 0.95, 1].includes(o.gls)) view.gls = o.gls;
  if ([0.3, 0.45, 0.6, 1].includes(o.glsMove)) view.glsMove = o.glsMove;
  if (PIX.includes(o.pix)) view.pix = o.pix;
  if (PAL.includes(o.pal)) view.pal = o.pal;
  if (COASTS.includes(o.coasts)) view.coasts = o.coasts;
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
// Axe linéaire recadré sur la courbe, la fenêtre 0–42° toujours dans le
// champ. Hors fenêtre : pointillé léger.

function drawHeliodon() {
  const fitted = fitPlot(byId('p-sun'));
  if (!fitted || !past.length) return;
  const { g, w, h } = fitted;

  const plotW = w - 30, TOP = 4, BOT = h - 11;     // 11 px pour l'axe du temps

  // Borné à −18°/60° : suivre la nuit profonde écraserait la fenêtre.
  // Au-delà, la courbe sort du cadre.
  let lo = 0, hi = SUN_MAX;
  for (const s of past) { if (s.h < lo) lo = s.h; if (s.h > hi) hi = s.h; }
  const pad = Math.max(3, (hi - lo) * 0.07);
  lo = Math.max(lo - pad, -18);
  hi = Math.min(hi + pad, 60);
  const yOf = d => BOT - (d - lo) / (hi - lo) * (BOT - TOP);

  const y0 = yOf(0), y42 = yOf(SUN_MAX);

  // CE QUE LA PORTE LAISSE FUIR : deux bandes autour de la fenêtre, selon
  // la chance. Sans elles, une présence hors fenêtre passerait pour un bug.
  const wc = beliefWeights().c;
  if (wc > 0.02) {
    // Bornées au cadre, sinon elles débordent sous l'axe (tropiques).
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

  // --- les ordonnées. Le pas suit la PLACE disponible, pas l'amplitude :
  // sinon les graduations se chevauchent.
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

  // --- les abscisses
  g.textBaseline = 'top';
  g.fillStyle = cssOf('--ink-faint');
  g.fillText(AGE_MAX === 24 ? '1 j' : AGE_MAX + ' h', 0, BOT + 2);
  g.textAlign = 'right';
  g.fillStyle = cssOf('--ink-soft');
  g.fillText('maintenant', plotW, BOT + 2);
}

// ------------------------------------------------------------- la présence
// Les trois croyances empilées, chacune multipliée par sa porte. La somme
// est la courbe noire, chiffrée par le chevron.

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

  // Poids appliqués ici, pas à l'échantillonnage : un curseur repondère
  // toute l'histoire sans rien recalculer.
  const wt = beliefWeights();
  let base = past.map(() => 0);
  for (const [key, wk, colour] of [['m', wt.m, cssOf('--meteo')],
                                   ['l', wt.l, cssOf('--legende')],
                                   ['c', wt.c, cssOf('--chance')]]) {
    // La chance a sa propre porte : le soleil, ou la fuite — comme la carte.
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
  g.textAlign = 'right';
  g.fillStyle = cssOf('--ink-soft');
  g.fillText('maintenant', plotW, BOT + 4);

  const end = Math.min(1, base[base.length - 1]);
  nowTag(g, w, yOf(end), end.toFixed(2));
}

// ============================================================== LES PASTILLES
// Elles ne sélectionnent rien : elles amènent le réticule.

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
// Chaque phrase porte un renvoi vers sa source. LE MÊME MARQUEUR POUR
// TOUTES, sourcées ou non : le manque de source ne se voit qu'à l'ouverture.
// En SVG : il n'existe pas de triangle-i en Unicode.
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
 * Le dernier haut lieu écrit. Ne réécrire qu'au changement de lieu :
 * refabriqué à chaque image, le bouton deviendrait incliquable.
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

  // La boîte cite, elle ne commente pas : la critique vit dans LEGENDES.md.
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
// Les commandes gravées (TEXTES.md §9). Une entrée par commande, pour la
// page comme pour le Pi ; chacune pose l'état et remet le curseur.
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

// INTERFACE. Éteinte, il ne reste que la carte ; on la rallume par le
// bouton en coin ou la touche « i », l'interrupteur étant caché avec elle.
let bare = false;

function showInterface() {
  const on = byId('p-interface').checked;
  bare = !on;
  showSwitch('p-interface', on);
  document.body.classList.toggle('bare', bare);
  byId('iface-on').hidden = on;
  // Le centre de la carte suit le panneau : sans lui, il revient au milieu.
  remeasure();
  saveKnobs();
}

// FORMULE. La même feuille que le « ? » du registre ALGORITHME : ouvrir
// l'un coche l'autre, fermer la feuille éteint l'interrupteur.
function showFormule() {
  if (byId('p-formule').checked) openNote('formule');
  else if (noted === 'formule') closeNote();
  else showSwitch('p-formule', false);
}

// POÈME. Par-dessus la carte ; le texte est dans index.html.
function showPoeme() {
  const on = byId('p-poeme').checked;
  showSwitch('p-poeme', on);
  byId('poeme').hidden = !on;
  saveKnobs();
}

/** Le piéton au centre, nord en haut ; le zoom ne bouge pas. */
function walkTo(lon, lat) {
  faceNorth(lon, lat);
  repaint();
}

// ARC-EN-CIEL. Le point de plus haute présence de TOUTE la Terre, même
// faible. Présence nulle partout : on ne bouge pas.
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

// REPÈRE. Pose un repère sous le piéton, ou l'efface s'il y en a un —
// jugé À L'ÉCRAN, à la taille du signe. Vit un jour, mémorisé à part.
const REPERE_PX = 12;
const REPERE_KEY = 'estimateur.reperes.1';

function repere() {
  view.reperes = liveReperes();
  const Rt = matT(view.R), k = view.look.icon / 15;
  const hit = view.reperes.findIndex(r => {
    const f = flatten(Rt, geoVec(r.lon, r.lat));
    return Math.hypot(sx(f[0]) - view.W / 2 - view.ox, sy(f[1]) - view.H / 2) < REPERE_PX * k;
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

/** À chaque image. `c` : le réticule ; `sun` : le soleil de l'instant simulé. */
export function refreshPanel(sun, c, now) {
  if (bare) return;
  const [lon, lat] = c;
  recall(lon, lat);
  const last = past[past.length - 1];
  const wt = beliefWeights();

  byId('f-pos').textContent =
    `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'N' : 'S'}  ` +
    `${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'O'}`;
  // Date en chiffres : largeur fixe, la boîte ne saute pas.
  byId('f-clock').textContent =
    `${HHMM(now.getUTCHours())}:${HHMM(now.getUTCMinutes())} UTC · ` +
    `${HHMM(now.getUTCDate())}/${HHMM(now.getUTCMonth() + 1)}`;

  const mn = last.gate > 0 ? openFor(lon, lat, sun) : null;
  const reste = mn == null ? ''
    : ' ' + (mn >= 90 ? (mn / 60).toFixed(1) + ' h' : Math.round(mn) + ' min');
  // Porte fermée, la chance peut passer : le dire, sinon on croit à une panne.
  const leak = last.gate <= 0 && last.spill * wt.c > 0.02;
  byId('h-sun').textContent = last.h.toFixed(1) + '° · ' +
    (last.gate > 0 ? 'ouverte' + reste
                   : (last.h <= 0.4 ? 'nuit' : 'trop haut') +
                     (leak ? ' · la chance passe' : ''));

  // Même formule que le shader, au réticule (flaque = 1).
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

export function initPanel(invalidate, resize, shaderProfile) {
  repaint = invalidate;
  remeasure = resize || invalidate;
  profile = shaderProfile || (() => null);

  // Les plis d'usine d'abord : loadKnobs n'écrase que ce qu'il connaît.
  for (const [, bodyId, openByDefault] of FOLDS) folded[bodyId] = !openByDefault;

  loadKnobs();
  loadReperes();
  buildChips();

  // L'ADMIN par /admin, qui renvoie ici avec « ?admin ». Caché, pas protégé.
  const admin = new URLSearchParams(location.search).has('admin');
  byId('box-admin').hidden = !admin;
  // LÉGENDES et RÉGLAGES : admin seulement. La plaque passe toujours par `plaque`.
  byId('box-leg').hidden = !admin;
  byId('box-reg').hidden = !admin;

  for (const [id, key] of SHARES) {
    const input = byId(id);
    input.addEventListener('input', () => setBelief(key, +input.value));
  }
  showBelief();

  // L'ORDRE COMPTE. `view.rig` et `view.clock` sont posés plus bas avant
  // les curseurs : rig par affectation directe (showRig retaillerait une
  // seconde fois), clock parce que le curseur du temps en dépend.
  for (const id of ['rig-laptop', 'rig-mini'])
    byId(id).addEventListener('change', showRig);

  // LES COUPURES — voir `view.cut`. Cochée, le poste n'est plus dessiné.
  for (const key of Object.keys(view.cut)) {
    const input = byId('cut-' + key);
    input.checked = view.cut[key];
    input.addEventListener('change', () => { view.cut[key] = input.checked; repaint(); saveKnobs(); });
  }

  // LA RÉSOLUTION DU SHADER — voir `view.gls`. Retaille les calques.
  for (const pc of [80, 85, 90, 95, 100]) {
    const input = byId('gls-' + pc);
    input.checked = Math.round(view.gls * 100) === pc;
    input.addEventListener('change', () => { view.gls = pc / 100; remeasure(); saveKnobs(); });
  }
  // En mouvement : « idem » (1) ou une fraction plus basse — voir main.js.
  for (const pc of [30, 45, 60, 100]) {
    const input = byId('glm-' + pc);
    input.checked = Math.round(view.glsMove * 100) === pc;
    input.addEventListener('change', () => { view.glsMove = pc / 100; repaint(); saveKnobs(); });
  }

  // PIXEL et PALETTE — voir `view.pix`, `view.pal`.
  for (const n of PIX) {
    const input = byId('pix-' + n);
    input.checked = view.pix === n;
    input.addEventListener('change', () => { view.pix = n; repaint(); saveKnobs(); });
  }
  for (const k of COASTS) {
    const input = byId('cote-' + k);
    input.checked = view.coasts === k;
    input.addEventListener('change', () => { view.coasts = k; repaint(); saveKnobs(); });
  }
  for (const n of PAL) {
    const input = byId('pal-' + n);
    input.checked = view.pal === n;
    input.addEventListener('change', () => { view.pal = n; repaint(); saveKnobs(); });
  }

  // LE SHADER EN DÉTAIL. Le texte d'attente d'abord, la mesure à l'image
  // suivante : sinon la page se fige sans rien dire.
  byId('gpu-prof').addEventListener('click', () => {
    const list = byId('gpu-parts');
    list.innerHTML = '<div class="gauge deep"><span>mesure en cours</span><em>…</em></div>';
    setTimeout(() => requestAnimationFrame(() => {
      const r = profile();
      if (!r) return;
      const ms = v => v.toFixed(v < 10 ? 2 : 1) + ' ms';
      const rows = [['une image', r.tout], ['socle', r.socle], ['relief', r.relief],
                    ['tache', r.tache], ['· grain', r.grain], ['· chance', r.chance],
                    ['· météo', r['météo']], ['· légendes', r['légendes']]];
      list.innerHTML = rows.map(([n, v]) =>
        `<div class="gauge deep"><span>${n}</span><em>${ms(v)}</em></div>`).join('');
      repaint();
    }), 30);
  });

  // LE PLEIN ÉCRAN, pour le Pi sans clavier. Le bouton du coin se cache
  // en plein écran, ou si le navigateur ne sait pas le faire.
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
    // Rangée pour `plaque` et pour rejouer un rail dont le sens change.
    SYNCS[id] = sync;
    input.addEventListener('input', sync);
    sync();
  }

  // LA PLAQUE. Cases et boutons passent par `plaque`, comme le Pi ; les
  // curseurs par leur `sync`, que `plaque` appelle aussi.
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

  // LES APPELS DE NOTE, par délégation : un écouteur par registre.
  for (const zone of ['corps-adm', 'corps-croy'])
    byId(zone).addEventListener('click', e => {
      const b = e.target.closest('.ask');
      if (b) openNote(b.dataset.note);
    });

  // LE REGISTRE DES DONNÉES a sa propre minuterie (la boucle d'images peut
  // dormir), une fois par seconde, seulement dans l'admin et s'il est
  // ouvert à tous les niveaux.
  const dataSeen = () => admin && !bare && !folded['corps-data']
                       && !folded['corps-dat'] && !folded['corps-adm'];
  showData();
  setInterval(() => { if (dataSeen()) showData(); }, 1000);

  const note = byId('note-sheet');
  byId('note-close').addEventListener('click', closeNote);
  note.addEventListener('click', e => { if (e.target === note) closeNote(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && noted) closeNote(); });

  // La feuille de provenance : clic hors du cadre ou Échap. Ici et non dans
  // chrome.js : c'est le panneau qui sait quel haut lieu est au réticule.
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
      // Hauteur du panneau changée : la carte remesure sa place pour les noms.
      measureRail();
      repaint();
    });
  }

  // Contour de focus au clavier seulement : Chrome le dessine aussi au clic.
  addEventListener('keydown', e => { if (e.key === 'Tab') root.classList.add('kbd'); });
  addEventListener('pointerdown', () => root.classList.remove('kbd'));
}
