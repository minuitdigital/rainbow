// =========================================================================
//  LE CIEL
//
//  Trois conditions doivent se rencontrer au même endroit pour qu'un arc
//  soit sur le point d'apparaître.
//
//    LA GÉOMÉTRIE DU SOLEIL — exacte. Il doit se tenir entre l'horizon et
//    42°. Au-delà, le centre de l'arc, situé à l'opposé du soleil, passe
//    sous l'horizon : il n'y a plus rien à voir. Cette seule contrainte
//    dessine un anneau qui fait deux fois le tour de la Terre chaque jour,
//    à l'aube et au crépuscule.
//
//    DES GOUTTES — simulée. Un bruit fractal cohérent sur la sphère, qui
//    dérive avec le temps. À remplacer par Open-Meteo.
//
//    UNE TROUÉE — approximée. Du soleil direct malgré l'averse. Une
//    climatologie grossière : zone de convergence intertropicale, rails
//    dépressionnaires, prime aux littoraux. À remplacer aussi.
//
//  Fonctions pures, sans état. Le bruit est le MIROIR EXACT de celui du
//  shader : si l'un change, l'autre doit changer, sinon le chiffre lu sous
//  le réticule cesse de décrire la couleur qu'on a sous les yeux.
// =========================================================================

import { DEG, RAD, wrap180 } from './projection.js';

/** Au-delà, le centre de l'arc passe sous l'horizon. */
export const SUN_MAX = 42;

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

/**
 * Combien de temps la porte reste ouverte, en minutes. C'est la seule
 * valeur exacte que la carte affiche : elle ne dépend que du soleil. La
 * porte se referme soit quand il monte au-dessus de 42°, soit quand il
 * touche l'horizon. null en jour ou nuit polaire.
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

/** Le bruit de pluie en un point, tel que le shader le voit. */
export function rainAt(lon, lat, drift) {
  const p = lat * DEG, lo = lon * DEG, cl = Math.cos(p);
  const raw = fbm(cl * Math.cos(lo) * FIELD_FREQ + drift,
                  cl * Math.sin(lo) * FIELD_FREQ,
                  Math.sin(p) * FIELD_FREQ);
  const t = (raw - 0.44) / 0.26;
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/** La part qui ne tient qu'à l'angle du soleil. */
export function geomAt(h) {
  const st = Math.max(0, Math.min(1, h / 6.5));
  return Math.pow(1 - h / SUN_MAX, 1.3) * st * st * (3 - 2 * st);
}

/**
 * L'indice brut : le produit des trois conditions. C'est ce que le shader
 * peint, et ce que le réticule affiche.
 *
 * Attention : le GRAIN des zooms profonds n'est appliqué que dans le
 * shader. Il dépolit la tache sans la déplacer — c'est de la matière, pas
 * de la donnée — donc la structure lue ici reste celle du champ.
 */
export function rainbowIndex(lon, lat, sun, drift) {
  const h = sunElev(lon, lat, sun);
  if (h <= 0.4 || h >= SUN_MAX) return 0;
  const rain = rainAt(lon, lat, drift);
  if (rain <= 0) return 0;
  const geom = geomAt(h);
  // La trouée, approchée : ZCIT autour de l'équateur thermique, rails
  // dépressionnaires vers 48° de latitude.
  const a = (lat - sun.decl * 0.45) / 9.5, b = (Math.abs(lat) - 48) / 15;
  const wet = 0.14 + 0.92 * Math.exp(-a * a) + 0.74 * Math.exp(-b * b);
  return 1 - Math.exp(-geom * rain * (wet / 1.2) * 6.0);
}
