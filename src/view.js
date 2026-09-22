// =========================================================================
//  L'ÉTAT DE LA CONTEMPLATION
//
//  Le seul module qui se souvienne de quelque chose. Tous les autres sont
//  ou bien des fonctions pures, ou bien des dessinateurs qui lisent ici.
//
//  Trois choses, et trois seulement : OÙ l'on regarde (une rotation de la
//  sphère), DE QUELLE DISTANCE (le zoom), et QUAND (l'horloge simulée).
//  Elles vont ensemble parce qu'elles changent ensemble, à chaque geste.
//
//  Rien n'est déplacé, tout est recalculé : le zoom précise au lieu de
//  flouter, et la navigation n'a de butée nulle part.
// =========================================================================

import {
  RAD, XMAX, YMAX, clamp1,
  inverseEE, flatten, geoVec, matMul, matVec, matT, identity,
  orthonormalize, between, rodrigues
} from './projection.js';

// Le zoom ne coûte aucun octet : rien n'est chargé, tout est recalculé.
// Le plafond est celui de la DONNÉE, pas du moteur — au-delà de ×32 les
// sommets des traits de côte (Natural Earth 1:50 m, un point tous les 1 à
// 4 km) deviennent des polygones visibles.
export const ZMAX = 32;

export const view = {
  W: 0, H: 0, dpr: 1,
  baseScale: 1,

  /** relatif → géographique. Le globe tourne, le plan reste. */
  R: identity(),

  zoom: 1, zoomTarget: 1,

  /** 0 = aplats, 1 = relief ombré. La touche « r » fond de l'un à l'autre. */
  mode: 0, modeTarget: 0,

  /** Le point que le zoom doit garder sous le curseur, le temps de l'élan. */
  anchor: null,

  /** L'inertie de la rotation, après un glissé. */
  spin: { axis: null, rate: 0 },

  /** Un doigt est-il posé ? La boucle d'images le demande à chaque passe. */
  dragging: false,

  /** Vitesse du temps simulé. 0 fige tout. */
  speed: 3981,

  /**
   * LE PARTAGE DE LA CROYANCE. Trois parts brutes, telles que les
   * curseurs les posent ; ce qui compte est leur RAPPORT, pas leur
   * valeur. Pousser la météo affaiblit les deux autres sans toucher à
   * leurs poignées — c'est le pourcentage affiché qui bouge, et c'est là
   * que l'arbitrage se voit.
   */
  belief: { m: 55, l: 20, c: 25 },

  /**
   * L'ALLURE. Ce que le panneau « réglages » pilote et que les trois
   * dessinateurs lisent — la carte, l'encre, rien d'autre. Ce ne sont pas
   * des données : deux réglages différents décrivent le même ciel.
   *
   *    sat    saturation de l'irisation, 0 = gris de luminance
   *    tache  gain sur la force de la tache
   *    grey   0 = irisé, 1 = densité tramée (ce que fera l'e-ink)
   *    icon   taille du glyphe des hauts lieux, en pixels
   *    sea    profondeur d'encre des aplats de mer, 1 = le tirage d'origine
   *    land   idem pour les terres
   *    fine   gain sur les octaves profondes du grain, au zoom
   *    holes  gain sur le seuil qui troue la tache, au zoom
   *    franges tours de palette dans l'irisation
   *    dot    la teinte du point du réticule : 0 = encre, sinon 0 à 1 du
   *           cercle des teintes
   */
  look: { sat: 1.5, tache: 1, grey: 0, icon: 15,
          sea: 1, land: 1, fine: 1, holes: 0.5, franges: 1.35, dot: 0 }
};

/** Les trois parts ramenées à une somme de 1. */
export function beliefWeights() {
  const b = view.belief;
  const s = b.m + b.l + b.c;
  if (s <= 0) return { m: 1/3, l: 1/3, c: 1/3 };   // ne jamais tout éteindre
  return { m: b.m / s, l: b.l / s, c: b.c / s };
}

// --------------------------------------------------------------- l'échelle

export const scale = () => view.baseScale * view.zoom;

/** Unités de projection → pixels d'écran. */
export const sx = x =>  x * scale() + view.W / 2;
export const sy = y => -y * scale() + view.H / 2;

/**
 * Cadrage « couvrir » et non « contenir » : la carte remplit toujours
 * l'écran, on ne voit jamais la silhouette de la projection ni le monde
 * entier d'un seul coup. Une carte qu'on embrasse du regard est une image ;
 * une carte qui déborde est un lieu.
 */
export function measure(cssW, cssH) {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.W = cssW;
  view.H = cssH;
  view.baseScale = Math.max(cssW / (2 * XMAX), cssH / (2 * YMAX));
}

// ------------------------------------------------- écran ⇄ géographique

/** Direction unitaire, dans le repère de la projection, sous un point écran. */
export function relDir(px, py) {
  const r = inverseEE((px - view.W / 2) / scale(), -(py - view.H / 2) / scale());
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

/**
 * Le centre de l'écran en vecteur unitaire géographique — là où se tient
 * le piéton. C'est la première ligne de la rotation, sans détour par les
 * degrés : le shader et la flaque de chance le veulent sous cette forme.
 */
export const centreVec = () => [view.R[0], view.R[1], view.R[2]];

/** Le centre de l'écran, en géographique. */
export function centre() {
  const g = centreVec();
  return [Math.atan2(g[1], g[0]) * RAD, Math.asin(clamp1(g[2])) * RAD];
}

// ------------------------------------------------------------- la rotation

let ops = 0;
/** Une rotation de plus. Tous les soixante-quatre tours, on redresse. */
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

/** Déplacement par pas, depuis le centre — parité avec le futur joystick. */
export function nudge(dx, dy) {
  const cx = view.W / 2, cy = view.H / 2;
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
// Le curseur du bas accélère le temps : le soleil tourne, et les
// précipitations simulées dérivent avec lui. C'est faux, mais ça montre le
// mouvement. Le jour où la vraie météo arrivera, ce curseur fera défiler la
// prévision plutôt qu'un temps inventé.

const T0_MS = Date.now();

/**
 * Les heures simulées S'ACCUMULENT, elles ne se déduisent pas de l'horloge
 * réelle multipliée par la vitesse. La formule d'avant réécrivait tout le
 * passé dès qu'on touchait au curseur du temps : à ×10 000, reculer d'un
 * cran ramenait la date de plusieurs jours d'un coup. Inoffensif tant que
 * rien ne regardait en arrière ; inacceptable depuis que le panneau trace
 * les vingt-quatre dernières heures.
 */
let simH = 0;

/** Appelé une fois par image, avec le temps réel écoulé en secondes. */
export function advanceClock(dt) {
  if (view.speed > 0) simH += dt / 3600 * view.speed;
}

export const elapsedHours = () => simH;

/** La date simulée à une heure quelconque — le passé se visite. */
export const dateAt = h => new Date(T0_MS + h * 3600000);

export const simDate = () => dateAt(simH);

/**
 * Le décalage du bruit DOIT rester petit. En float32, ajouter ~45 000 aux
 * coordonnées de bruit — ce que donnait Date.now() converti en heures — ne
 * laissait plus que deux décimales : le champ se cassait en blocs à bords
 * droits, et une longue coupure nette traversait l'Atlantique.
 */
export const driftAt = h => (h * 0.03) % 512;

/**
 * La chance a sa propre horloge, plus lente que la météo. Sans quoi les
 * deux champs dériveraient de concert et l'on croirait à une cause.
 */
export const driftChanceAt = h => (h * 0.011) % 512;

export const drift = () => driftAt(simH);
export const driftChance = () => driftChanceAt(simH);

// ------------------------------------------------------------- LA MARCHE
//  Le piéton du réticule marche quand le monde défile sous lui.
//
//  Sa cadence ne suit PAS le temps mais la DISTANCE : un pas vaut tant de
//  pixels de sol glissé. C'est la seule mesure qui ait un sens pour une
//  silhouette posée sur l'écran — à ×32 comme au monde entier, le même
//  geste de la main fait le même nombre de pas. Une carte immobile ne le
//  fait pas piétiner, et ne coûte donc toujours rien.
//
//  L'état vit ici parce qu'il vit d'une image à l'autre, et il
//  S'ACCUMULE : `stride` est appelé une fois par image dans main.js, et
//  nulle part ailleurs. Même règle que l'horloge, pour la même raison
//  (piège n°18).

const TAU = Math.PI * 2;
const wrap = v => ((v % TAU) + TAU) % TAU;

/** La pose de repos : jambes au plein écart. C'est celle d'index.html. */
const GAIT_REST = Math.PI / 2;

/** Pixels de sol glissé pour une demi-foulée. */
const STRIDE_PX = 26;

/** Par image. Une téléportation — une pastille cliquée — n'est pas une course. */
const GAIT_MAX = 58;

// ------------------------------------------------------------- LA GIRATION
//  Le piéton PIVOTE AUTOUR DU POINT VISÉ, et il prend l'envers de la
//  direction choisie : on monte vers le nord, il se retrouve la tête en
//  bas. Ses pieds restent au point — c'est lui qui tourne autour, pas le
//  point qui se déplace.
//
//  La règle tient en une phrase : SA TÊTE POINTE À L'OPPOSÉ DU
//  DÉPLACEMENT. C'est ce qui donne les cent quatre-vingts degrés quand on
//  va vers le haut, et le quart de tour quand on va sur le côté.
//
//  L'angle ne revient pas à l'endroit quand on s'arrête : il garde le
//  dernier cap. La figure se souvient d'où l'on vient.

/** Vitesse de rattrapage de l'angle, par seconde. Plus bas = plus lourd. */
const TURN_RATE = 5;

/** En deçà, le déplacement est du bruit et ne dicte aucun cap. */
const TURN_MIN_PX = 0.6;

/**
 *  phase  où en est la foulée
 *  angle  de combien la figure est tournée autour du point visé
 */
export const gait = { phase: GAIT_REST, angle: 0 };

let gaitPrev = null, gaitAim = 0;

/** Le plus court chemin d'un angle à l'autre : par la gauche ou la droite. */
const shortest = a => { a = wrap(a); return a > Math.PI ? a - TAU : a; };

/**
 * Appelé une fois par image, APRÈS toutes les rotations. Rend true tant
 * qu'il reste du mouvement à dessiner.
 */
export function stride(dt) {
  const c = centre();
  if (!gaitPrev) { gaitPrev = c; return false; }

  // Où le centre de l'image précédente se trouve-t-il maintenant ? L'écart
  // est le glissement APPARENT du sol, en pixels. Le zoom, lui, ne bouge
  // pas le centre : on ne marche donc pas en s'approchant.
  const f = flatten(matT(view.R), geoVec(gaitPrev[0], gaitPrev[1]));
  const dx = view.W / 2 - sx(f[0]), dy = view.H / 2 - sy(f[1]);
  gaitPrev = c;

  const d = Math.min(GAIT_MAX, Math.hypot(dx, dy));
  const moving = d > 0.25;

  if (moving) {
    gait.phase = wrap(gait.phase + d / STRIDE_PX * Math.PI);

    // (dx, dy) est là où NOUS allons : le sol part à gauche, donc nous
    // allons à droite. La tête vise l'opposé — d'où le signe.
    if (d > TURN_MIN_PX) gaitAim = Math.atan2(-dx, dy);
  } else {
    // Arrêté, il FINIT SON PAS : la phase continue vers le repos en
    // ralentissant, elle ne revient pas en arrière — on ne marche pas à
    // reculons pour s'immobiliser.
    const left = wrap(GAIT_REST - gait.phase);
    if (left > 2e-3) {
      gait.phase = wrap(gait.phase +
        Math.max(left * (1 - Math.exp(-dt * 7)), Math.min(left, dt * 1.6)));
    } else gait.phase = GAIT_REST;
  }

  // L'INERTIE. On rattrape le cap par le plus court chemin — sans quoi un
  // passage par 359° ferait faire un tour complet à la figure pour un
  // degré de correction.
  const off = shortest(gaitAim - gait.angle);
  gait.angle = wrap(gait.angle + off * (1 - Math.exp(-dt * TURN_RATE)));

  return moving
      || wrap(GAIT_REST - gait.phase) > 2e-3
      || Math.abs(off) > 3e-3;
}

/**
 * Combien de grain, et combien la tache s'efface. Nul au monde entier —
 * le grain n'y ferait que du bruit et ferait mentir la lecture d'ensemble ;
 * plein à partir de ×10.
 */
export const detail = () => Math.max(0, Math.min(1, (view.zoom - 2.5) / 7.5));

/**
 * LA RAMPE DU ZOOM PROFOND, bien plus tardive que `detail`. Nulle
 * jusqu'à ×6 — avant, ce qu'elle pilote serait sous le pixel — pleine à
 * ×26. Deux réglages s'y accrochent, et chacun a son gain :
 *
 *    fine   les octaves profondes du grain
 *    holes  le seuil qui troue la tache
 *
 * Tous deux nuls au monde entier : la lecture d'ensemble ne se discute
 * pas, elle doit rester celle du champ.
 */
const zoomDeep = () => Math.max(0, Math.min(1, (view.zoom - 6) / 20));

export const fine  = () => zoomDeep() * view.look.fine;
export const holes = () => zoomDeep() * view.look.holes;
