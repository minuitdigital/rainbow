// =========================================================================
//  LE CIEL
//
//  LA PORTE, puis LA CROYANCE.
//
//  La porte est le soleil, et elle est exacte. Il doit se tenir entre
//  l'horizon et 42° : au-delà, le centre de l'arc — situé à l'opposé du
//  soleil — passe sous l'horizon, et il n'y a plus rien à voir, pour
//  personne, quoi qu'on en pense. Cette seule contrainte dessine un
//  anneau qui fait deux fois le tour de la Terre chaque jour.
//
//  Porte fermée : zéro pour ce qui a une raison. On ne croit pas en la
//  hauteur du soleil, on la calcule — c'est ce qui empêche la pièce de
//  devenir un jouet, et `sunGate` reste exacte au degré près.
//
//  Porte ouverte, trois raisons d'y croire se partagent ce qui reste :
//
//      MÉTÉO    la pluie et la trouée        ce qui est vrai
//      LÉGENDE  la foi attachée au lieu      ce qu'on raconte
//      CHANCE   ce qu'on porte sur soi       ce qui n'a pas de raison
//
//      indice = Soleil × ( wM·Météo + wL·Légende )
//             + wC · Chance · flaque · max(Soleil, fuite · wC)
//               avec wM + wL + wC = 1
//
//  LA CHANCE N'EST PAS UN LIEU DU MONDE, C'EST CE QUE LE PIÉTON PORTE.
//  Elle est multipliée par une FLAQUE centrée sur le réticule, qui
//  s'élargit à mesure qu'on croit en elle. Au réticule la flaque vaut
//  exactement 1 : le panneau lit donc toujours la chance pleine, et c'est
//  la carte alentour qui la perd. On promène sa chance sur la Terre.
//
//  Et c'est là, dans la flaque et nulle part ailleurs, que LA PORTE FUIT.
//  Un arc peut s'allumer alors que le soleil est couché ou trop haut,
//  parce qu'il n'a aucune raison de s'allumer — c'est très exactement ce
//  que le curseur dit. La fuite est en wC² : elle n'existe pas tant qu'on
//  ne l'a pas voulue, et elle ne touche que la chance. La météo et la
//  légende restent enfermées dans l'anneau, comme avant : ce qui est vrai
//  et ce qu'on raconte ont toujours besoin du soleil.
//
//  Une SOMME et non un produit : avec un produit, un seul zéro éteindrait
//  tout, et le spectateur qui ne croit qu'aux légendes ne verrait rien
//  nulle part. Avec une somme pondérée, il voit une carte allumée à ses
//  hauts lieux — et c'est précisément ce que la pièce a à dire.
//
//  Fonctions pures, sans état. Le bruit est le MIROIR EXACT de celui du
//  shader : si l'un change, l'autre doit changer, sinon le chiffre lu
//  cesse de décrire la couleur qu'on a sous les yeux.
// =========================================================================

import { DEG, RAD, wrap180, geoVec } from './projection.js';
import { LEGENDS, LEGEND_FLOOR } from './legends.js';
import { wxRain, wxClear } from './weather.js';

/** Au-delà, le centre de l'arc passe sous l'horizon. */
export const SUN_MAX = 42;

/**
 * Le gain final. La porte plafonne vers 0,80 et la croyance vers 1 :
 * sans lui, la carte la plus forte possible resterait tiède.
 */
export const GAIN = 1.8;

// ------------------------------------------------------------- le soleil

/** Déclinaison et longitude subsolaire. Suffisant : on n'est pas un éphéméride. */
export function solar(date) {
  const n = (date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000;
  const utc = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return {
    decl: -23.44 * Math.cos(2 * Math.PI * (n + 10) / 365.24),
    sublon: -15 * (utc - 12)
  };
}

/** Hauteur du soleil au-dessus de l'horizon, en degrés. */
export const sunElev = (lon, lat, sun) => {
  const d = sun.decl * DEG, p = lat * DEG, Hh = (lon - sun.sublon) * DEG;
  return Math.asin(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(Hh)) * RAD;
};

/** LA PORTE. 0 hors de la fenêtre, jusqu'à ~0,80 au plus ouvert. */
export function sunGate(h) {
  if (h <= 0.4 || h >= SUN_MAX) return 0;
  const st = Math.max(0, Math.min(1, h / 6.5));
  return Math.pow(1 - h / SUN_MAX, 1.3) * st * st * (3 - 2 * st);
}

/**
 * Combien de temps la porte reste ouverte, en minutes. C'est la seule
 * valeur exacte que la carte affiche : elle ne dépend que du soleil. Elle
 * se referme soit quand il monte au-dessus de 42°, soit quand il touche
 * l'horizon. null en jour ou nuit polaire.
 */
export function openFor(lon, lat, sun) {
  const phi = lat * DEG, dec = sun.decl * DEG;
  const Hn = wrap180(lon - sun.sublon);
  const cs = Math.cos(phi) * Math.cos(dec);
  if (Math.abs(cs) < 1e-7) return null;
  const sp = Math.sin(phi) * Math.sin(dec);

  let Hx = null;
  if (Hn < 0) {                                   // le soleil monte encore
    const c42 = (Math.sin(SUN_MAX * DEG) - sp) / cs;
    if (c42 >= -1 && c42 <= 1) {
      const H42 = Math.acos(c42) * RAD;
      if (-H42 > Hn) Hx = -H42;
    }
  }
  if (Hx === null) {
    const c0 = -sp / cs;
    if (c0 < -1 || c0 > 1) return null;
    Hx = Math.acos(c0) * RAD;
  }
  const d = Hx - Hn;
  return d > 0 ? d / 15 * 60 : null;              // 15° d'angle horaire par heure
}

// --------------------------------------------------------------- le bruit
// Miroir en JavaScript du bruit du shader. Math.fround reproduit la
// précision float32 du processeur graphique : sans lui, les deux versions
// divergent lentement et le chiffre lu ne correspond plus à la couleur.

const fr = Math.fround;
const fract = v => v - Math.floor(v);

function hash31(x, y, z) {
  x = fract(fr(x * 0.3183099 + 0.1)) * 17;
  y = fract(fr(y * 0.3183099 + 0.2)) * 17;
  z = fract(fr(z * 0.3183099 + 0.3)) * 17;
  return fract(fr(x * y * z * (x + y + z)));
}

function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fyy = y - iy, fz = z - iz;
  fx = fx*fx*(3-2*fx); fyy = fyy*fyy*(3-2*fyy); fz = fz*fz*(3-2*fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(hash31(ix,iy,iz),     hash31(ix+1,iy,iz),     fx),
             L(hash31(ix,iy+1,iz),   hash31(ix+1,iy+1,iz),   fx), fyy),
           L(L(hash31(ix,iy,iz+1),   hash31(ix+1,iy,iz+1),   fx),
             L(hash31(ix,iy+1,iz+1), hash31(ix+1,iy+1,iz+1), fx), fyy), fz);
}

/** Trois octaves : des motifs de 1 770, 830 et 405 km. Rien de plus fin. */
export const fbm = (x, y, z) =>
  0.56 * vnoise(x, y, z)
  + 0.29 * vnoise(x*2.13, y*2.13, z*2.13)
  + 0.15 * vnoise(x*4.37, y*4.37, z*4.37);

/** La fréquence du champ de pluie sur la sphère unité. */
const FIELD_FREQ = 3.6;

const smooth01 = (t, a, b) => {
  const u = (t - a) / (b - a);
  return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
};

// ============================================================== LA MÉTÉO
//  Ce qui est vrai — et depuis septembre 2026, ce qui est VRAIMENT vrai.
//
//  DEUX SOURCES, choisies par le dernier paramètre `slot` :
//
//      slot === null   le bruit fractal. C'est le mode « dev » : un temps
//                      inventé qu'on accélère pour voir la mécanique.
//      slot un nombre  la grille Open-Meteo, lue au pas de temps donné.
//
//  Ce module ne sait PAS dans quel mode la page se trouve, et c'est
//  voulu : il est au-dessus de view.js dans l'ordre de dépendance, il n'a
//  donc pas le droit de le lui demander. Ce sont les appelants qui
//  savent — et `slotAt()` dans view.js leur donne la réponse.

/** La pluie en un point, telle que le shader la voit. */
export function rainAt(lon, lat, drift, slot) {
  // LA VRAIE PLUIE EST CELLE DU VOISINAGE, dilatée d'une case par le
  // script qui fabrique la grille : on ne voit pas d'arc DANS l'averse,
  // on est dessous et le ciel est gris. On le voit à côté.
  if (slot != null) return wxRain(lon, lat, slot);

  const p = lat * DEG, lo = lon * DEG, cl = Math.cos(p);
  const raw = fbm(cl * Math.cos(lo) * FIELD_FREQ + drift,
                  cl * Math.sin(lo) * FIELD_FREQ,
                  Math.sin(p) * FIELD_FREQ);
  return smooth01(raw, 0.44, 0.70);
}

/**
 * La trouée : du soleil direct malgré l'averse.
 *
 * EN MÉTÉO, c'est une mesure : `direct_radiation` rapporté à ce qu'un
 * ciel parfaitement clair donnerait à cette hauteur de soleil. Elle dit
 * littéralement « des rayons non interceptés arrivent ici », ce qui est
 * la condition physique exacte d'un arc-en-ciel.
 *
 * EN DEV, c'est une climatologie grossière et inventée — zone de
 * convergence intertropicale, rails dépressionnaires. C'était joli, et
 * c'était faux : il ne fait pas toujours beau à 48° de latitude.
 *
 * La remise à l'échelle 0,14 + 1,66 × clarté garde exactement la course
 * de l'ancienne formule, plancher compris : même sous une couverture
 * totale il reste un peu de trouée, parce qu'une carte où quelque chose
 * vaut zéro absolu cesse de respirer.
 *
 * Le shader multiplie EN PLUS par le masque littoral dans la branche du
 * bruit, que ce miroir n'a pas : la lecture sous le réticule est donc
 * légèrement plus généreuse que le pixel en pleine mer. C'était déjà vrai
 * avant, c'est assumé — et en météo la question ne se pose plus, le
 * masque disparaît des deux côtés.
 */
export function gapAt(lon, lat, sun, slot) {
  if (slot != null) return 0.14 + 1.66 * wxClear(lon, lat, slot);
  const a = (lat - sun.decl * 0.45) / 9.5;
  const b = (Math.abs(lat) - 48) / 15;
  return 0.14 + 0.92 * Math.exp(-a * a) + 0.74 * Math.exp(-b * b);
}

/** MÉTÉO, ramenée entre 0 et 1. */
export function meteoAt(lon, lat, sun, drift, slot) {
  const rain = rainAt(lon, lat, drift, slot);
  if (rain <= 0) return 0;
  return 1 - Math.exp(-rain * (gapAt(lon, lat, sun, slot) / 1.2) * 6);
}

// ============================================================ LA LÉGENDE
// Les hauts lieux, précalculés en vecteurs unitaires. On compare des
// CORDES et non des angles : à ces distances la différence est sous le
// pixel, et ça évite un arc-cosinus par point et par pixel.

const LEG = LEGENDS.map(l => {
  const v = geoVec(l.lon, l.lat);
  const chord = l.r * DEG;                    // approximation corde ≈ angle
  return { v, q: chord * chord, f: l.f, nom: l.nom, dit: l.dit,
           src: l.src || null, lon: l.lon, lat: l.lat };
});

export const LEGEND_POINTS = LEG;

/**
 * LÉGENDE en un point : le plancher, relevé par le haut lieu le plus
 * proche. Un MAXIMUM et non une somme — deux traditions voisines ne
 * s'additionnent pas, on croit à la plus forte des deux.
 */
export function legendAtVec(g) {
  let v = LEGEND_FLOOR;
  for (let i = 0; i < LEG.length; i++) {
    const p = LEG[i].v;
    const dx = g[0] - p[0], dy = g[1] - p[1], dz = g[2] - p[2];
    const e = LEG[i].f * Math.exp(-(dx*dx + dy*dy + dz*dz) / LEG[i].q);
    if (e > v) v = e;
  }
  return v > 1 ? 1 : v;
}

export const legendAt = (lon, lat) => legendAtVec(geoVec(lon, lat));

/** Le haut lieu dont on est le plus proche, s'il compte encore ici. */
export function nearestLegend(lon, lat) {
  const g = geoVec(lon, lat);
  let best = null, bv = LEGEND_FLOOR;
  for (const l of LEG) {
    const dx = g[0] - l.v[0], dy = g[1] - l.v[1], dz = g[2] - l.v[2];
    const e = l.f * Math.exp(-(dx*dx + dy*dy + dz*dz) / l.q);
    if (e > bv) { bv = e; best = l; }
  }
  return best;
}

// ============================================================= LA CHANCE
// Un second champ, plus lent et plus grand que la météo, et sans rapport
// avec elle. Seuillé serré : la chance n'est pas un voile uniforme sur le
// monde, c'est des poches. Ailleurs, elle ne vaut rien.

const CHANCE_FREQ = 0.62;                     // ~2 850 km de motif

export function chanceAt(lon, lat, driftC) {
  const p = lat * DEG, lo = lon * DEG, cl = Math.cos(p);
  const f = FIELD_FREQ * CHANCE_FREQ;
  const raw = fbm(cl * Math.cos(lo) * f + driftC + 41,
                  cl * Math.sin(lo) * f + 17,
                  Math.sin(p) * f + 7);
  return smooth01(raw, 0.46, 0.76);
}

// -------------------------------------------------------------- LA FLAQUE
// Ce qu'on porte sur soi. Le champ de chance existe partout, mais il ne
// compte que près de celui qui le porte — la flaque décroît en gaussienne
// depuis le réticule, comme un haut lieu, et par la même formule.
//
// AU RÉTICULE ELLE VAUT 1, toujours. C'est ce qui sauve le panneau : il
// lit la chance pleine où qu'on soit, et `history.js` n'a rien à savoir de
// tout ceci. Ce qui change, c'est la carte alentour.
//
// Son rayon s'élargit avec la croyance : huit degrés quand on n'y croit
// pas — la flaque est alors à peu près sous nos pieds — trente quand on
// n'y croit que.
export const LUCK_NEAR = 8, LUCK_FAR = 30;

/** `g` et `here` sont des vecteurs unitaires ; `wc` la part de chance. */
export function luckAt(g, here, wc) {
  if (!here) return 1;
  const r = (LUCK_NEAR + (LUCK_FAR - LUCK_NEAR) * wc) * DEG;
  const dx = g[0] - here[0], dy = g[1] - here[1], dz = g[2] - here[2];
  return Math.exp(-(dx*dx + dy*dy + dz*dz) / (r * r));
}

// --------------------------------------------------------------- LA FUITE
// De combien la porte laisse passer, hors de sa fenêtre. Pleine au bord,
// éteinte dix-huit degrés plus loin — soit très exactement les bornes que
// l'héliodon se donnait déjà (−18°, 60°), par une coïncidence commode.
//
// Elle ne sert QU'À LA CHANCE, et elle est repondérée par wC une seconde
// fois : la fuite est donc en wC², elle n'apparaît pas par accident.
export const SPILL_AMP = 0.42, SPILL_DEG = 18;

export function spillAt(h) {
  const d = Math.max(0.4 - h, h - SUN_MAX, 0);
  return SPILL_AMP * (1 - smooth01(d, 0, SPILL_DEG));
}

// ============================================================== L'INDICE

/**
 * Ce que le shader peint et ce que le réticule affiche.
 * `w` est le partage de croyance : { m, l, c }, de somme 1.
 *
 * Attention : le GRAIN des zooms profonds n'existe que dans le shader. Il
 * dépolit la tache sans la déplacer — c'est de la matière, pas de la
 * donnée — donc la structure lue ici reste celle du champ.
 */
export function rainbowIndex(lon, lat, sun, drift, driftC, w, here, slot) {
  const h = sunElev(lon, lat, sun);
  const S = sunGate(h);

  // La porte de la chance : celle du soleil, ou la fuite si elle est plus
  // généreuse. C'est le seul endroit du projet où un curseur pèse sur le
  // soleil, et il ne pèse que sur ce qui n'a pas de raison.
  const gateC = Math.max(S, spillAt(h) * w.c);
  if (S <= 0 && gateC <= 0.002) return 0;

  const g = geoVec(lon, lat);
  let sum = w.c * chanceAt(lon, lat, driftC) * luckAt(g, here, w.c) * gateC;
  if (S > 0) sum += S * (w.m * meteoAt(lon, lat, sun, drift, slot)
                       + w.l * legendAtVec(g));

  const t = sum * GAIN;
  return t > 1 ? 1 : t;
}

/**
 * Les parts séparément — pour l'étiquette et pour la lecture.
 *
 * Porte fermée, la météo et la légende sont rendues NULLES et non
 * calculées à vide : elles n'ont rien porté du chiffre, et c'est ce que
 * l'étiquette doit dire. Sans quoi une tache de pleine nuit annoncerait
 * « averse en cours » là où il n'y a que de la chance.
 */
export function ingredients(lon, lat, sun, drift, driftC, here, w, slot) {
  const h = sunElev(lon, lat, sun), S = sunGate(h);
  const wc = w ? w.c : 0;
  const g = geoVec(lon, lat);
  return {
    sun:     h,
    gate:    S,
    gateC:   Math.max(S, spillAt(h) * wc),
    luck:    luckAt(g, here, wc),
    meteo:   S > 0 ? meteoAt(lon, lat, sun, drift, slot) : 0,
    legende: S > 0 ? legendAtVec(g) : 0,
    chance:  chanceAt(lon, lat, driftC) * luckAt(g, here, wc)
  };
}
