// =========================================================================
//  LE CIEL — la porte, puis la croyance. Fonctions pures.
//  La porte est le soleil, entre 0,4 et 42° : exacte, rien d'autre ne l'ouvre.
//      indice = Soleil × (wM·Météo + wL·Légende)
//             + wC · Chance · flaque · max(Soleil, fuite · wC)
//  Une somme et non un produit : un seul zéro n'éteint pas tout.
//  MIROIR de src/shader.js (build/check_mirror.mjs).
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
// Math.fround reproduit le float32 du shader : sans lui, les deux bruits
// divergent et le chiffre lu ne correspond plus à la couleur.

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
//  `slot` null : le bruit fractal (mode « dev ») ; un nombre : la grille
//  Open-Meteo à ce pas de temps. Ce module ne connaît pas le mode :
//  l'appelant le passe (slotAt() dans view.js).

/** La pluie en un point, telle que le shader la voit. */
export function rainAt(lon, lat, drift, slot) {
  // Pluie du voisinage, dilatée d'une case : on ne voit pas d'arc dans
  // l'averse, on le voit à côté.
  if (slot != null) return wxRain(lon, lat, slot);

  const p = lat * DEG, lo = lon * DEG, cl = Math.cos(p);
  const raw = fbm(cl * Math.cos(lo) * FIELD_FREQ + drift,
                  cl * Math.sin(lo) * FIELD_FREQ,
                  Math.sin(p) * FIELD_FREQ);
  return smooth01(raw, 0.44, 0.70);
}

/**
 * La trouée : du soleil direct malgré l'averse. En météo, la clarté
 * directe mesurée, remise sur la course de la formule du bruit (plancher
 * 0,14 compris). En dev, une climatologie inventée.
 * Écart assumé : en dev, le shader multiplie aussi par le masque littoral.
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
// Des cordes et non des angles : l'écart est sous le pixel, et on évite
// un arc-cosinus par point.

const LEG = LEGENDS.map(l => {
  const v = geoVec(l.lon, l.lat);
  const chord = l.r * DEG;                    // approximation corde ≈ angle
  return { v, q: chord * chord, f: l.f, nom: l.nom, dit: l.dit,
           src: l.src || null, lon: l.lon, lat: l.lat };
});

export const LEGEND_POINTS = LEG;

/** Le plancher, relevé par le haut lieu le plus fort : un maximum, pas une somme. */
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
// Un champ plus lent que la météo, sans rapport avec elle, seuillé serré :
// des poches, pas un voile.

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
// La chance ne compte que près du piéton : gaussienne centrée sur le
// réticule, où elle vaut toujours 1 (le panneau lit la chance pleine).
// Son rayon va de LUCK_NEAR à LUCK_FAR degrés avec la part de chance.
export const LUCK_NEAR = 10, LUCK_FAR = 48;

/** `g` et `here` sont des vecteurs unitaires ; `wc` la part de chance. */
export function luckAt(g, here, wc) {
  if (!here) return 1;
  const r = (LUCK_NEAR + (LUCK_FAR - LUCK_NEAR) * wc) * DEG;
  const dx = g[0] - here[0], dy = g[1] - here[1], dz = g[2] - here[2];
  return Math.exp(-(dx*dx + dy*dy + dz*dz) / (r * r));
}

// --------------------------------------------------------------- LA FUITE
// Ce que la porte laisse passer hors de sa fenêtre : pleine au bord,
// éteinte SPILL_DEG plus loin. Pour la chance seule, et repondérée par
// wC : elle est en wC², elle n'apparaît pas par accident.
export const SPILL_AMP = 0.55, SPILL_DEG = 18;

export function spillAt(h) {
  const d = Math.max(0.4 - h, h - SUN_MAX, 0);
  return SPILL_AMP * (1 - smooth01(d, 0, SPILL_DEG));
}

// ============================================================== L'INDICE

/**
 * Ce que le shader peint et ce que le réticule affiche.
 * `w` : le partage de croyance { m, l, c }, de somme 1. Le grain des
 * zooms n'existe que dans le shader : il ne déplace pas la tache.
 */
export function rainbowIndex(lon, lat, sun, drift, driftC, w, here, slot) {
  const h = sunElev(lon, lat, sun);
  const S = sunGate(h);

  // La porte de la chance : celle du soleil, ou la fuite si elle est plus
  // généreuse. Le seul endroit où un curseur pèse sur le soleil.
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
 * Les parts séparément, pour la lecture. Porte fermée, météo et légende
 * valent 0 : elles n'ont rien porté du chiffre.
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
