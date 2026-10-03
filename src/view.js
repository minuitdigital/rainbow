// =========================================================================
//  L'ÉTAT DE LA CONTEMPLATION
//
//  Le seul module qui se souvienne de quelque chose : OÙ l'on regarde (une
//  rotation), DE QUELLE DISTANCE (le zoom), QUAND (l'horloge simulée).
//  Rien n'est déplacé, tout est recalculé.
// =========================================================================

import {
  RAD, DEG, XMAX, YMAX, clamp1,
  inverseEE, flatten, geoVec, matMul, matVec, matT, identity,
  orthonormalize, between, rodrigues
} from './projection.js';
import { hasWeather, weatherSlot } from './weather.js';

// Plafond de la DONNÉE, pas du moteur : au-delà de ×32 les sommets des
// côtes (Natural Earth 1:50 m) deviennent des polygones visibles.
export const ZMAX = 32;

export const view = {
  W: 0, H: 0, dpr: 1,
  baseScale: 1,

  /** relatif → géographique. Le globe tourne, le plan reste. */
  R: identity(),

  zoom: 1, zoomTarget: 1,

  /** Le point que le zoom doit garder sous le curseur, le temps de l'élan. */
  anchor: null,

  /** L'inertie de la rotation, après un glissé. */
  spin: { axis: null, rate: 0 },

  dragging: false,

  /** Vitesse du temps simulé. 0 fige tout. */
  speed: 3981,

  /**
   * LA CROYANCE. Trois poids bruts de 0 à 100, indépendants. Seul compte
   * leur rapport (`beliefWeights`). Tous à zéro : la carte ne montre rien.
   */
  belief: { m: 55, l: 20, c: 25 },

  /**
   * LES REPÈRES : { lon, lat, at }, `at` en ms d'horloge réelle. Aucun poids
   * dans la présence ; ils durent un jour au plus (REPERE_MS).
   */
  reperes: [],

  /**
   * L'ALLURE : réglages de rendu, pas des données.
   *
   *    sat    saturation de l'irisation, 0 = gris de luminance
   *    tache  gain sur la force de la tache
   *    grey   0 = irisé, 1 = densité tramée — l'interrupteur « Couleur » éteint
   *    porte  1 = tracer en pointillé la fenêtre du soleil, 0° et 42°
   *    pas    l'écart entre les points du couloir
   *    trait  l'épaisseur du couloir, 1 = 1,6 pixel
   *    icon   taille commune des icônes, en pixels
   *    sea    profondeur d'encre des aplats de mer
   *    land   idem pour les terres
   *    fine   gain sur les octaves profondes du grain, au zoom
   *    seuil  sous cette presence, pas de couleur du tout
   *    franges tours de palette dans l'irisation
   *    dot    teinte du point du réticule : 0 = encre, sinon 0 à 1 du
   *           cercle des teintes
   */
  look: { sat: 1.5, tache: 1, grey: 0, porte: 0, pas: 1.6, trait: 1, icon: 15,
          sea: 1, land: 1, fine: 1, seuil: 0.6, franges: 1.35, dot: 0 },

  /** LA MACHINE : `laptop` ou `mini` — voir RIGS. */
  rig: 'laptop',

  /**
   * LA RÉSOLUTION DU SHADER, en fraction des pixels de l'encre. Le calque
   * WebGL est calculé plus petit et agrandi ; l'encre reste nette. Admin,
   * mémorisé.
   */
  gls: 1,

  /** La même, pendant que la carte bouge — voir main.js. 1 = pas de baisse. */
  glsMove: 1,

  /**
   * PIXEL — la tache en blocs de `pix` pixels de page (option P, voir
   * map.js). 1 = calculée en direct à chaque pixel (option A). Admin, mémorisé.
   */
  pix: 1,

  /** PALETTE — teintes par tour d'irisation ; 0 = continue. Admin, mémorisé. */
  pal: 0,

  /**
   * Décalage du centre de la carte, en pixels de page, pour que le piéton
   * ne soit pas derrière le panneau. Posé par main.js à chaque mesure.
   */
  ox: 0,

  /** LES COUPURES de l'admin (performance). Mémorisées. */
  cut: { shader: false, ink: false, places: false,
         callouts: false, relief: false, tache: false, grain: false },

  /**
   * LES CÔTES : 'aucune', 'encre' (tracé vectoriel, lacs compris, cher sur
   * le Pi) ou 'shader' (iso-ligne 0,5 du relief, sans les lacs). Admin, mémorisé.
   */
  coasts: 'aucune',

  /**
   * D'OÙ VIENT L'HEURE, et donc la pluie : `dev` (temps accéléré, pluie de
   * bruit fractal) ou `meteo` (temps réel, vraie prévision). Indissociables.
   */
  clock: 'dev',

  /** Décalage en heures, mode météo seulement : −24 hier, +24 demain. */
  when: 0
};

// ============================================================== LA MACHINE
//      dpr      pixels réels par pixel de page ; de 2 à 1, le travail du
//               processeur graphique est divisé par quatre
//      probe    pas du balayage des zones, en pixels (coût en carré)
//      scanMs   intervalle entre deux balayages
//
//  Choix MANUEL et mémorisé : une détection automatique changerait le rendu
//  sans le dire.
export const RIGS = {
  laptop: { dpr: 2, probe: 30, scanMs: 200 },
  mini:   { dpr: 1, probe: 44, scanMs: 320 }
};

export const rig = () => RIGS[view.rig] || RIGS.laptop;

// =============================================================== LA CADENCE
//  `performance.now()` autour de `paint()` ne mesure PAS le processeur
//  graphique : `drawArrays` rend la main aussitôt. Le temps GPU vient du
//  pilote, quand il le donne. Moyennes glissantes sur environ une seconde.
export const beat = {
  fps: 0,          // images par seconde, moyenne glissante
  ms: 0,           // temps passé dans le JavaScript, par image
  map: 0,          // dont la carte  (envoi des uniformes seulement)
  ink: 0,          // dont l'encre   (le calque 2D, tout compris)
  panel: 0,        // dont le panneau
  gpu: null,       // le vrai temps du shader, ou null si non mesurable
  idle: true       // aucune image depuis un moment : la carte ne coûte rien
};

/** Pondération de la moyenne glissante. Plus bas = plus lisse, plus lent. */
const SMOOTH = 0.12;

const glide = (was, now) => was ? was + (now - was) * SMOOTH : now;

let lastBeat = 0;

/** Une fois par image. `total` : temps JS de l'image ; `at` : horodatage rAF. */
export function beatFrame(at, total, map, ink, panel) {
  if (lastBeat) {
    const gap = at - lastBeat;
    // Plus d'une demi-seconde : une reprise après repos, pas une image lente.
    if (gap > 0 && gap < 500) beat.fps = glide(beat.fps, 1000 / gap);
  }
  lastBeat = at;
  beat.idle = false;
  beat.ms    = glide(beat.ms, total);
  beat.map   = glide(beat.map, map);
  beat.ink   = glide(beat.ink, ink);
  beat.panel = glide(beat.panel, panel);
}

/** Le repos est un état : le compteur doit le dire, pas afficher une cadence figée. */
export function beatIdle() {
  if (lastBeat && performance.now() - lastBeat > 400) beat.idle = true;
  return beat.idle;
}

// ======================================================== LE CHARGEMENT
//  Produit par map et weather, affiché par panel. Ici personne ne touche
//  au document : écrire dans la page depuis l'assembleur a déjà tué le
//  chargement du relief quand l'élément visé a disparu.
//
//      loadState.set(nom, { got, total })   en route
//      loadState.set(nom, null)             arrivé
//      loadState.set(nom, { err })          manquant, avec la raison

/** nom → { got, total } en cours, { err } en panne, ou absent si arrivé. */
export const loadState = new Map();

export function noteLoad(nom, what) {
  if (what === null) loadState.delete(nom);
  else loadState.set(nom, what);
}

/** Les pixels réellement calculés par le shader, par image. */
export const pixelCount = () => view.W * view.dpr * view.H * view.dpr * view.gls * view.gls;

/** Les trois poids ramenés à une somme de 1. Tous à zéro : tous nuls, voulu. */
export function beliefWeights() {
  const b = view.belief;
  const s = b.m + b.l + b.c;
  if (s <= 0) return { m: 0, l: 0, c: 0 };
  return { m: b.m / s, l: b.l / s, c: b.c / s };
}

/** Un repère dure un jour au plus, en temps réel. */
export const REPERE_MS = 24 * 3600000;

export const liveReperes = () =>
  view.reperes.filter(r => Date.now() - r.at < REPERE_MS);

// --------------------------------------------------------------- l'échelle

export const scale = () => view.baseScale * view.zoom;

/** Unités de projection → pixels d'écran. */
export const sx = x =>  x * scale() + view.W / 2 + view.ox;
export const sy = y => -y * scale() + view.H / 2;

/** Cadrage « couvrir » : la carte remplit toujours l'écran. */
export function measure(cssW, cssH) {
  view.dpr = Math.min(window.devicePixelRatio || 1, rig().dpr);
  view.W = cssW;
  view.H = cssH;
  // Avec le centre décalé de `ox`, le monde doit couvrir |ox| de plus de
  // chaque côté, sinon son bord apparaît sous le panneau.
  view.baseScale = Math.max((cssW + 2 * Math.abs(view.ox)) / (2 * XMAX), cssH / (2 * YMAX));
}

// ------------------------------------------------- écran ⇄ géographique

/** Direction unitaire, dans le repère de la projection, sous un point écran. */
export function relDir(px, py) {
  const r = inverseEE((px - view.W / 2 - view.ox) / scale(), -(py - view.H / 2) / scale());
  if (!r) return null;
  const cp = Math.cos(r[1]);
  return [cp * Math.cos(r[0]), cp * Math.sin(r[0]), Math.sin(r[1])];
}

/** (longitude, latitude) en degrés sous un point écran, ou null hors monde. */
export function geoAt(px, py) {
  const p = relDir(px, py);
  if (!p) return null;
  const g = matVec(view.R, p);
  return [Math.atan2(g[1], g[0]) * RAD, Math.asin(clamp1(g[2])) * RAD];
}

/** Le centre de l'écran (le piéton), en vecteur unitaire : la première ligne de R. */
export const centreVec = () => [view.R[0], view.R[1], view.R[2]];

/** Le centre de l'écran, en géographique. */
export function centre() {
  const g = centreVec();
  return [Math.atan2(g[1], g[0]) * RAD, Math.asin(clamp1(g[2])) * RAD];
}

// ------------------------------------------------------------- la rotation

let ops = 0;
/** Tous les soixante-quatre produits, on ré-orthonormalise R. */
function bump() { if ((++ops & 63) === 0) view.R = orthonormalize(view.R); }

export function turn(q) {
  if (q) { view.R = matMul(view.R, q); bump(); }
}

export function turnFrom(R0, q) {
  view.R = q ? matMul(R0, q) : R0.slice();
  bump();
}

/** Amène (lon, lat) sous (px, py), sans contrainte d'orientation. */
export function anchorTo(lon, lat, px, py) {
  const pNew = relDir(px, py);
  if (!pNew) return;
  const q = between(pNew, matVec(matT(view.R), geoVec(lon, lat)));
  if (q) view.R = matMul(view.R, q);
}

/**
 * (lon, lat) au centre, LE NORD EN HAUT : les trois lignes de R sont le
 * lieu, son est, son nord. anchorTo laisserait la carte de travers.
 */
export function faceNorth(lon, lat) {
  const a = lon * DEG, b = lat * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  view.anchor = null;
  view.spin.rate = 0;
  view.R = new Float32Array([cb * ca, cb * sa, sb,
                             -sa,     ca,      0,
                             -sb * ca, -sb * sa, cb]);
}

/** Déplacement par pas, depuis le centre. */
export function nudge(dx, dy) {
  const cx = view.W / 2 + view.ox, cy = view.H / 2;
  const a = relDir(cx, cy), b = relDir(cx + dx, cy + dy);
  if (a && b) turn(between(b, a));
}

export function recentre() {
  view.anchor = null;
  view.R = identity();
  view.zoom = view.zoomTarget = 1;
}

export const setZoomTarget = z => {
  view.zoomTarget = Math.max(1, Math.min(ZMAX, z));
};

/** L'élan qui reste après le glissé. Rend true tant qu'il faut redessiner. */
export function coast(dt) {
  const s = view.spin;
  if (view.dragging || !s.axis || Math.abs(s.rate) <= 0.02) return false;
  turn(rodrigues(s.axis, s.rate * dt));
  s.rate *= Math.exp(-dt / 0.2);
  return true;
}

// ----------------------------------------------------------- l'horloge

const T0_MS = Date.now();

/**
 * En dev, les heures simulées S'ACCUMULENT (piège n°18) : les déduire de
 * l'horloge réelle × vitesse réécrirait tout le passé à chaque cran du curseur.
 */
let simH = 0;

/** Appelé une fois par image, avec le temps réel écoulé en secondes. */
export function advanceClock(dt) {
  if (view.clock === 'dev' && view.speed > 0) simH += dt / 3600 * view.speed;
}

/**
 * En météo, l'horloge EST l'heure réelle plus le décalage : sans
 * multiplication, pas de piège n°18, et pas de dérive entre deux battements.
 */
export const elapsedHours = () =>
  view.clock === 'meteo' ? (Date.now() - T0_MS) / 3600000 + view.when : simH;

/** La date simulée à une heure quelconque — le passé se visite. */
export const dateAt = h => new Date(T0_MS + h * 3600000);

/**
 * UNE SEULE SOURCE D'HEURE : `elapsedHours`. Jamais `dateAt(simH)` — en
 * météo `simH` garde l'heure accélérée d'avant le basculement.
 */
export const simDate = () => dateAt(elapsedHours());

/**
 * Le décalage du bruit DOIT rester petit : en float32, un grand décalage
 * ne laisse que deux décimales et le champ se casse en blocs.
 */
export const driftAt = h => (h * 0.03) % 512;

/** La chance dérive plus lentement que la météo : sinon on croirait à une cause. */
export const driftChanceAt = h => (h * 0.011) % 512;

export const drift = () => driftAt(elapsedHours());
export const driftChance = () => driftChanceAt(elapsedHours());

// ---------------------------------------------------- OÙ L'ON EN EST
//  `slotAt` rend NULL en dev, ou tant que la grille n'est pas arrivée :
//  c'est ce qui fait retomber sky.js sur son bruit (sky.js ne peut pas
//  importer view.js, il est au-dessus dans l'ordre de dépendance).

/** La vraie météo est-elle branchée ? */
export const wxOn = () => view.clock === 'meteo' && hasWeather();

/** Le pas de temps de la grille pour une heure simulée donnée, ou null. */
export const slotAt = h =>
  wxOn() ? weatherSlot(T0_MS + h * 3600000) : null;

/** Le pas de temps de l'instant affiché. */
export const slotNow = () => slotAt(elapsedHours());

// ------------------------------------------------------------- LA MARCHE
//  La cadence du piéton suit la DISTANCE glissée, pas le temps : le même
//  geste fait le même nombre de pas à tout zoom. L'état S'ACCUMULE :
//  `stride` est appelé une fois par image, dans main.js seulement (piège n°18).

const TAU = Math.PI * 2;
const wrap = v => ((v % TAU) + TAU) % TAU;

/** La pose de repos : jambes au plein écart. C'est celle d'index.html. */
const GAIT_REST = Math.PI / 2;

/** Pixels de sol glissé pour une demi-foulée. */
const STRIDE_PX = 26;

/** Par image. Une téléportation — une pastille cliquée — n'est pas une course. */
const GAIT_MAX = 58;

// ------------------------------------------------------------- LE CAP
//  Le piéton reste droit ; l'angle sert à la flèche (drawArrow, ink.js).
//  C'est le cap de la tête, opposé au déplacement : la flèche en prend
//  l'envers. Il garde sa dernière valeur à l'arrêt.

/** Vitesse de rattrapage de l'angle, par seconde. Plus bas = plus lourd. */
const TURN_RATE = 5;

/** En deçà, le déplacement est du bruit et ne dicte aucun cap. */
const TURN_MIN_PX = 0.6;

/**
 *  phase  où en est la foulée
 *  angle  le cap, pour la flèche
 *  moved  a-t-on déjà marché
 */
export const gait = { phase: GAIT_REST, angle: 0, moved: false };

let gaitPrev = null, gaitAim = 0;

/** Le plus court chemin d'un angle à l'autre : par la gauche ou la droite. */
const shortest = a => { a = wrap(a); return a > Math.PI ? a - TAU : a; };

/** Une fois par image, APRÈS toutes les rotations. True tant qu'il reste à dessiner. */
export function stride(dt) {
  const c = centre();
  if (!gaitPrev) { gaitPrev = c; return false; }

  // Glissement apparent du sol, en pixels : où est passé le centre de
  // l'image précédente. Le zoom ne bouge pas le centre : pas de pas.
  const f = flatten(matT(view.R), geoVec(gaitPrev[0], gaitPrev[1]));
  const dx = view.W / 2 + view.ox - sx(f[0]), dy = view.H / 2 - sy(f[1]);
  gaitPrev = c;

  const d = Math.min(GAIT_MAX, Math.hypot(dx, dy));
  const moving = d > 0.25;

  if (moving) {
    gait.phase = wrap(gait.phase + d / STRIDE_PX * Math.PI);

    // (dx, dy) est là où nous allons ; la tête vise l'opposé, d'où le signe.
    if (d > TURN_MIN_PX) { gaitAim = Math.atan2(-dx, dy); gait.moved = true; }
  } else {
    // Arrêté, il finit son pas : la phase avance vers le repos, jamais en arrière.
    const left = wrap(GAIT_REST - gait.phase);
    if (left > 2e-3) {
      gait.phase = wrap(gait.phase +
        Math.max(left * (1 - Math.exp(-dt * 7)), Math.min(left, dt * 1.6)));
    } else gait.phase = GAIT_REST;
  }

  // Par le plus court chemin : sinon 359° → 0° ferait un tour complet.
  const off = shortest(gaitAim - gait.angle);
  gait.angle = wrap(gait.angle + off * (1 - Math.exp(-dt * TURN_RATE)));

  return moving
      || wrap(GAIT_REST - gait.phase) > 2e-3
      || Math.abs(off) > 3e-3;
}

/** L'épaisseur du trait de côte, en pixels de page : plus gras de près. */
export const coastWidth = () =>
  Math.max(0.55, Math.min(1.5, 0.55 + Math.log2(view.zoom) * 0.24));

/** Combien de grain : nul au monde entier, plein à partir de ×10. */
export const detail = () => Math.max(0, Math.min(1, (view.zoom - 2.5) / 7.5));

/** Rampe du zoom profond : nulle jusqu'à ×6 (sous le pixel), pleine à ×26. */
const zoomDeep = () => Math.max(0, Math.min(1, (view.zoom - 6) / 20));

export const fine = () => zoomDeep() * view.look.fine;

/** Le seuil ne dépend pas du zoom : une carte uniformément teintée existe à toute échelle. */
export const seuil = () => view.look.seuil;
