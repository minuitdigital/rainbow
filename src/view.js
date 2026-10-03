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
  RAD, DEG, XMAX, YMAX, clamp1,
  inverseEE, flatten, geoVec, matMul, matVec, matT, identity,
  orthonormalize, between, rodrigues
} from './projection.js';
import { hasWeather, weatherSlot } from './weather.js';

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

  /** Le point que le zoom doit garder sous le curseur, le temps de l'élan. */
  anchor: null,

  /** L'inertie de la rotation, après un glissé. */
  spin: { axis: null, rate: 0 },

  /** Un doigt est-il posé ? La boucle d'images le demande à chaque passe. */
  dragging: false,

  /** Vitesse du temps simulé. 0 fige tout. */
  speed: 3981,

  /**
   * LA CROYANCE. Trois poids bruts, de 0 à 100, tels que les trois boutons
   * de la plaque les posent — indépendants, aucun ne pousse les autres.
   * Ce qui compte est leur RAPPORT : `beliefWeights` les ramène à une
   * somme de 1. Tous à zéro, on ne croit à rien, et la carte ne montre
   * rien.
   */
  belief: { m: 55, l: 20, c: 25 },

  /**
   * LES REPÈRES, posés par le bouton « Repère » : { lon, lat, at }, `at`
   * en millisecondes de l'horloge réelle. Un arc que le spectateur a vu
   * là, une fois. Sans date affichée, sans source, sans aucun poids dans
   * la présence ; ils durent un jour au plus (REPERE_MS).
   */
  reperes: [],

  /**
   * L'ALLURE. Ce que le panneau « réglages » pilote et que les trois
   * dessinateurs lisent — la carte, l'encre, rien d'autre. Ce ne sont pas
   * des données : deux réglages différents décrivent le même ciel.
   *
   *    sat    saturation de l'irisation, 0 = gris de luminance
   *    tache  gain sur la force de la tache
   *    grey   0 = irisé, 1 = densité tramée — l'interrupteur « Couleur » éteint
   *    porte  1 = tracer en pointillé la fenêtre du soleil, 0° et 42°
   *    pas    l'écart entre les points du couloir, 1 = la course d'origine
   *    trait  l'épaisseur du couloir, 1 = 1,6 pixel
   *    icon   taille du glyphe des hauts lieux, en pixels
   *    sea    profondeur d'encre des aplats de mer, 1 = le tirage d'origine
   *    land   idem pour les terres
   *    fine   gain sur les octaves profondes du grain, au zoom
   *    seuil  sous cette presence, pas de couleur du tout
   *    franges tours de palette dans l'irisation
   *    dot    la teinte du point du réticule : 0 = encre, sinon 0 à 1 du
   *           cercle des teintes
   */
  look: { sat: 1.5, tache: 1, grey: 0, porte: 0, pas: 1.6, trait: 1, icon: 15,
          sea: 1, land: 1, fine: 1, seuil: 0.6, franges: 1.35, dot: 0 },

  /**
   * LA MACHINE. `laptop` ou `mini` — voir RIGS juste dessous. Ce n'est pas
   * une allure, c'est un aveu : la page dit de quel calculateur elle
   * dispose, et se règle en conséquence.
   */
  rig: 'laptop',

  /**
   * LES COUPURES de l'admin (performance). Mémorisées avec les autres
   * réglages (décision de l'auteur, 3 octobre) : le Pi les retrouve après
   * un rechargement.
   */
  /**
   * LA RÉSOLUTION DU SHADER, en fraction des pixels de l'encre : 0,8,
   * 0,85, 0,9, 0,95 ou 1 (cases de l'admin). Le calque WebGL est calculé plus petit et le navigateur
   * l'agrandit ; l'encre, elle, reste nette. 0,5 divise le travail du
   * processeur graphique par quatre, 0,25 par seize. Admin, mémorisé.
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
   * LE CENTRE DE LA CARTE, décalé du centre de l'écran, en pixels de page.
   * Le panneau couvre la droite : le piéton se tient au milieu de ce qui
   * reste, pas derrière les boîtes. Posé par main.js à chaque mesure —
   * négatif, la moitié de la largeur du panneau ; zéro sans interface.
   */
  ox: 0,

  //
  // Les côtes sont coupées par défaut (décision de l'auteur, 3 octobre) :
  // sur le Pi, elles coûtaient plus que tout le reste de l'encre.
  cut: { shader: false, ink: false, coast: true, places: false,
         callouts: false, relief: false, tache: false, grain: false },

  /**
   * D'OÙ VIENT L'HEURE, et donc d'où vient la pluie. `dev` invente un
   * temps que le curseur accélère et tire la pluie d'un bruit fractal ;
   * `meteo` suivra le temps réel et la vraie prévision. Les deux vont
   * ensemble : un temps inventé ne peut pas aller chercher une prévision,
   * et une prévision ne se laisse pas accélérer dix mille fois.
   */
  clock: 'dev',

  /**
   * LE DÉCALAGE, en heures, et seulement en mode météo. C'est le bouton
   * « Temps » de la plaque : −24 hier, 0 maintenant, +24 demain.
   */
  when: 0
};

// ============================================================== LA MACHINE
//  Le tableau tournera sur un Raspberry Pi, pas sur l'écran d'atelier. Le
//  même programme doit donc savoir se tenir des deux côtés — et il n'y a
//  pas de réglage unique qui convienne aux deux, parce que le rapport
//  entre le coût par pixel et le coût par point n'est pas le même.
//
//  Trois nombres seulement, et ce sont les trois qui comptent :
//
//      dpr      combien de pixels réels pour un pixel de page. C'est le
//               levier le plus brutal de toute la page : passer de 2 à 1
//               divise par QUATRE le travail du processeur graphique.
//      probe    le pas du balayage des zones, en pixels. Le coût monte
//               comme le carré : 30 -> 44 fait moitié moins d'appels.
//      scanMs   l'intervalle entre deux balayages.
//
//  Le choix est MANUEL et mémorisé. Une détection automatique aurait paru
//  élégante ; elle aurait surtout changé le rendu sans le dire, et sur une
//  oeuvre on ne veut pas d'un tableau qui se règle tout seul dans notre dos.
export const RIGS = {
  laptop: { dpr: 2, probe: 30, scanMs: 200 },
  mini:   { dpr: 1, probe: 44, scanMs: 320 }
};

export const rig = () => RIGS[view.rig] || RIGS.laptop;

// =============================================================== LA CADENCE
//  Ce que coûte une image, mesuré et non supposé.
//
//  DEUX CHRONOMÈTRES, et il faut les deux. `performance.now()` autour de
//  `paint()` ne mesure PAS le processeur graphique : `drawArrays` rend la
//  main aussitôt, le shader travaille encore après. Un tableau saturé
//  afficherait 0,1 ms en toute bonne foi. D'où le second chronomètre,
//  celui du pilote graphique lui-même — quand le navigateur veut bien le
//  donner. Ensemble ils disent OÙ ça coince ; l'un sans l'autre ment.
//
//  Les moyennes sont glissantes sur une seconde : un chiffre qui saute à
//  chaque image ne se lit pas, et on cherche une tendance, pas un instant.
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

/**
 * Appelé une fois par image, à la fin de `frame`, avec le détail des
 * temps. `total` est le temps JavaScript de toute l'image ; `at` est
 * l'horodatage que requestAnimationFrame a donné.
 */
export function beatFrame(at, total, map, ink, panel) {
  if (lastBeat) {
    const gap = at - lastBeat;
    // Un écart de plus d'une demi-seconde n'est pas une image lente :
    // c'est une reprise après repos, ou un volet qui redevient visible.
    // La compter écraserait la moyenne pour plusieurs secondes.
    if (gap > 0 && gap < 500) beat.fps = glide(beat.fps, 1000 / gap);
  }
  lastBeat = at;
  beat.idle = false;
  beat.ms    = glide(beat.ms, total);
  beat.map   = glide(beat.map, map);
  beat.ink   = glide(beat.ink, ink);
  beat.panel = glide(beat.panel, panel);
}

/**
 * LE REPOS EST UN ÉTAT, PAS UNE PANNE. La boucle s'arrête quand rien ne
 * bouge — c'est ce qui rend la pièce supportable sur un mur des années
 * durant. Le compteur doit donc le DIRE plutôt que d'afficher une cadence
 * figée qui ferait croire à un gel.
 */
export function beatIdle() {
  if (lastBeat && performance.now() - lastBeat > 400) beat.idle = true;
  return beat.idle;
}

// ======================================================== LE CHARGEMENT
//  CE QUI EST EN ROUTE, ET CE QUI MANQUE. L'état vit ici et non dans
//  main.js, pour une raison que la panne du 22 septembre a rendue
//  évidente : c'est une donnée que DEUX modules produisent (map et
//  weather) et qu'un TROISIÈME affiche (panel). La faire transiter par
//  une variable de main.js obligeait à écrire dans le document depuis
//  l'assembleur — et le jour où cet élément a disparu de la page, une
//  exception a tué le chargement du relief qu'elle était censée décrire.
//
//  Ici, personne ne touche au document : on range, et le panneau lit.
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

/**
 * Les trois poids ramenés à une somme de 1 : wM = m / (m + l + c).
 * Tous à zéro, tous nuls — la carte ne montre rien, et c'est voulu.
 */
export function beliefWeights() {
  const b = view.belief;
  const s = b.m + b.l + b.c;
  if (s <= 0) return { m: 0, l: 0, c: 0 };
  return { m: b.m / s, l: b.l / s, c: b.c / s };
}

/** Un repère dure un jour au plus, en temps réel. */
export const REPERE_MS = 24 * 3600000;

/** Les repères encore vivants. */
export const liveReperes = () =>
  view.reperes.filter(r => Date.now() - r.at < REPERE_MS);

// --------------------------------------------------------------- l'échelle

export const scale = () => view.baseScale * view.zoom;

/** Unités de projection → pixels d'écran. */
export const sx = x =>  x * scale() + view.W / 2 + view.ox;
export const sy = y => -y * scale() + view.H / 2;

/**
 * Cadrage « couvrir » et non « contenir » : la carte remplit toujours
 * l'écran, on ne voit jamais la silhouette de la projection ni le monde
 * entier d'un seul coup. Une carte qu'on embrasse du regard est une image ;
 * une carte qui déborde est un lieu.
 */
export function measure(cssW, cssH) {
  // Le plafond vient de la MACHINE et non d'une constante : c'est le seul
  // réglage qui divise par quatre le travail du processeur graphique d'un
  // seul coup, et c'est tout l'objet du mode « mini ».
  view.dpr = Math.min(window.devicePixelRatio || 1, rig().dpr);
  view.W = cssW;
  view.H = cssH;
  // Le centre décalé de `ox` : le monde doit couvrir |ox| de plus de
  // chaque côté, sinon son bord apparaît à droite, sous le panneau.
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

/**
 * (lon, lat) au centre, LE NORD EN HAUT. Les trois colonnes de R sont ce
 * que deviennent le centre, la droite et le haut de l'écran : le lieu, son
 * est, son nord. anchorTo, lui, prend la rotation la plus courte et laisse
 * la carte de travers — bien pour un glissé, pas pour un saut.
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

/** Déplacement par pas, depuis le centre — parité avec le futur joystick. */
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
  if (view.clock === 'dev' && view.speed > 0) simH += dt / 3600 * view.speed;
}

/**
 * EN MÉTÉO, L'HORLOGE N'ACCUMULE RIEN — elle EST l'heure réelle, plus le
 * décalage du curseur.
 *
 * Ce n'est pas une entorse au piège n°18 mais sa conséquence. Le piège
 * disait : une horloge qui se DÉDUIT d'une multiplication réécrit tout le
 * passé dès qu'on touche au curseur. Ici il n'y a pas de multiplication :
 * une seconde vaut une seconde, et lire Date.now() est exact par
 * construction. Mieux : c'est la seule façon de ne pas dériver quand la
 * carte ne se redessine que toutes les dix secondes — ce qu'elle fait en
 * météo, puisque le soleil avance de quatre centièmes de degré pendant
 * ce temps-là et qu'un tableau sur un mur n'a pas à chauffer pour ça.
 */
export const elapsedHours = () =>
  view.clock === 'meteo' ? (Date.now() - T0_MS) / 3600000 + view.when : simH;

/** La date simulée à une heure quelconque — le passé se visite. */
export const dateAt = h => new Date(T0_MS + h * 3600000);

/**
 * UNE SEULE SOURCE D'HEURE, et c'est `elapsedHours`.
 *
 * Cette ligne a dit `dateAt(simH)` pendant une demi-journée après
 * l'arrivée du mode météo, et c'était faux : `simH` est l'horloge
 * ACCUMULÉE du mode dev, celle que le curseur multiplie par quatre mille.
 * En météo elle continue de porter ce que le temps accéléré avait
 * engrangé avant le basculement, tandis que `elapsedHours` rend l'heure
 * vraie.
 *
 * Le panneau et le shader lisaient donc une heure, `recall` et le
 * balayage des zones en lisaient une autre. Le symptôme était joliment
 * retors : l'héliodon affichait un soleil à 44° — la bonne hauteur pour
 * l'heure réelle — juste au-dessus d'une pendule qui annonçait six heures
 * plus tard. Deux horloges dans la même boîte, et toutes les deux
 * sincères.
 */
export const simDate = () => dateAt(elapsedHours());

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

export const drift = () => driftAt(elapsedHours());
export const driftChance = () => driftChanceAt(elapsedHours());

// ---------------------------------------------------- OÙ L'ON EN EST
//  La grille météo est-elle en service, et à quel pas de temps la lire.
//
//  `slotAt` rend NULL en mode dev, ou quand le fichier n'est pas encore
//  arrivé. C'est cette valeur nulle qui dit à sky.js de retomber sur son
//  bruit fractal — sky.js n'a pas le droit d'interroger view.js, il est
//  au-dessus dans l'ordre de dépendance.

/** La vraie météo est-elle branchée ? C'est ce qui allume la case. */
export const wxOn = () => view.clock === 'meteo' && hasWeather();

/** Le pas de temps de la grille pour une heure simulée donnée, ou null. */
export const slotAt = h =>
  wxOn() ? weatherSlot(T0_MS + h * 3600000) : null;

/** Le pas de temps de l'instant affiché. */
export const slotNow = () => slotAt(elapsedHours());

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

// ------------------------------------------------------------- LE CAP
//  Le piéton reste DROIT : il marche, il ne pivote plus (1er octobre
//  2026). L'angle sert à la FLÈCHE qui tourne autour de lui (drawArrow,
//  ink.js). Il est gardé tel qu'il était : le cap de la tête, qui vise
//  l'opposé du déplacement — la flèche en prend l'envers.
//
//  L'angle ne revient pas en arrière quand on s'arrête : la flèche garde
//  le dernier cap. `moved` dit si l'on a déjà fait un pas.

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
  const dx = view.W / 2 + view.ox - sx(f[0]), dy = view.H / 2 - sy(f[1]);
  gaitPrev = c;

  const d = Math.min(GAIT_MAX, Math.hypot(dx, dy));
  const moving = d > 0.25;

  if (moving) {
    gait.phase = wrap(gait.phase + d / STRIDE_PX * Math.PI);

    // (dx, dy) est là où NOUS allons : le sol part à gauche, donc nous
    // allons à droite. La tête vise l'opposé — d'où le signe.
    if (d > TURN_MIN_PX) { gaitAim = Math.atan2(-dx, dy); gait.moved = true; }
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
 * ×26. Un seul réglage s'y accroche désormais : les octaves profondes du
 * grain, qui n'auraient aucun sens au monde entier.
 */
const zoomDeep = () => Math.max(0, Math.min(1, (view.zoom - 6) / 20));

export const fine = () => zoomDeep() * view.look.fine;

/**
 * LE SEUIL NE DÉPEND PLUS DU ZOOM, et c'est tout le changement. Accroché
 * à `zoomDeep`, il ne faisait rien avant ×6 et coupait au mieux à 36 % —
 * autant dire rien. Or le défaut qu'il vise existe à toute échelle : une
 * carte uniformément teintée, où le regard n'a aucun bord à saisir.
 */
export const seuil = () => view.look.seuil;
