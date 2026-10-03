// =========================================================================
//  LE SOL
//
//  De quoi l'endroit est fait (relief) et comment on l'appelle (villes).
//  Pas de frontières : « à 40 km de Valparaíso », pas « au Chili ».
//  Fonctions pures ; le zoom arrive en argument.
// =========================================================================

import { DEG } from './projection.js';
import { TERRAIN } from '../data/terrain.js';
import { CITIES } from '../data/cities.js';

/** Rayon terrestre moyen, en kilomètres. */
export const RE = 6371;

// ------------------------------------------------------------- le relief
// Un octet par degré carré : quartet haut = accessibilité, quartet bas =
// dégagement de l'horizon.

const TERR = (() => {
  const b = atob(TERRAIN.d), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
})();

/** Rend [accessibilité, dégagement], chacun de 0 à 1. */
export function terrainAt(lon, lat) {
  let i = Math.floor((lon + 180) / 360 * TERRAIN.w);
  let j = Math.floor((90 - lat) / 180 * TERRAIN.h);
  i = ((i % TERRAIN.w) + TERRAIN.w) % TERRAIN.w;
  j = j < 0 ? 0 : j >= TERRAIN.h ? TERRAIN.h - 1 : j;
  const b = TERR[j * TERRAIN.w + i];
  return [(b >> 4) / 15, (b & 15) / 15];
}

// -------------------------------------------------------------- les lieux
// PALIER : zoom à partir duquel une ville peut paraître. Il limite le
// vivier ; l'encombrement décide, les étiquettes d'arc d'abord.

export const TIER_ZOOM = [1, 1.8, 3, 5, 9, 16];

/** Le dernier palier qu'on s'autorise à ce zoom. −1 si aucun. */
export function tierAt(zoom) {
  let top = -1;
  for (let t = 0; t < TIER_ZOOM.length; t++) if (zoom >= TIER_ZOOM[t]) top = t;
  return top;
}

export const CITY = (() => {
  const rows = CITIES.d.split('\n');
  const countries = CITIES.c.split('\n');
  const n = rows.length;
  const name = new Array(n), ctry = new Array(n);
  const tier = new Uint8Array(n);
  const lon = new Float32Array(n), lat = new Float32Array(n);
  const vec = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    const f = rows[i].split('\t');
    name[i] = f[0];
    lon[i] = +f[1];
    lat[i] = +f[2];
    tier[i] = +f[3];
    ctry[i] = countries[parseInt(f[4], 36)] || '';
    const cl = Math.cos(lat[i] * DEG);
    vec[i*3]     = cl * Math.cos(lon[i] * DEG);
    vec[i*3 + 1] = cl * Math.sin(lon[i] * DEG);
    vec[i*3 + 2] = Math.sin(lat[i] * DEG);
  }

  // Grille de 10° pour la recherche du plus proche.
  const GW = 36, GH = 18, cell = [];
  for (let i = 0; i < GW * GH; i++) cell.push([]);
  for (let i = 0; i < n; i++) {
    let ci = Math.floor((lon[i] + 180) / 10); ci = ((ci % GW) + GW) % GW;
    let cj = Math.floor((lat[i] + 90) / 10);
    cj = cj < 0 ? 0 : cj > GH - 1 ? GH - 1 : cj;
    cell[cj * GW + ci].push(i);
  }

  return { n, name, ctry, tier, lon, lat, vec, GW, GH, cell };
})();

/** La ville la plus proche, dans la limite d'un palier et d'une distance. */
export function nearestCity(lo, la, maxTier, maxKm) {
  const cl = Math.cos(la * DEG);
  const gx = cl * Math.cos(lo * DEG), gy = cl * Math.sin(lo * DEG),
        gz = Math.sin(la * DEG);

  // Près des pôles les cases rétrécissent : on élargit en longitude.
  const span = Math.min(17, 1 + Math.ceil(1 / Math.max(0.06, cl)));
  const j0 = Math.floor((la + 90) / 10), i0 = Math.floor((lo + 180) / 10);

  let best = -1, bd = Math.cos(maxKm / RE);       // comparer des cosinus
  for (let dj = -1; dj <= 1; dj++) {
    const j = j0 + dj;
    if (j < 0 || j >= CITY.GH) continue;
    for (let di = -span; di <= span; di++) {
      let i = (i0 + di) % CITY.GW; if (i < 0) i += CITY.GW;
      const list = CITY.cell[j * CITY.GW + i];
      for (let k = 0; k < list.length; k++) {
        const c = list[k];
        if (CITY.tier[c] > maxTier) continue;
        const d = CITY.vec[c*3] * gx + CITY.vec[c*3+1] * gy + CITY.vec[c*3+2] * gz;
        if (d > bd) { bd = d; best = c; }
      }
    }
  }
  if (best < 0) return null;
  return { i: best, km: Math.acos(Math.min(1, bd)) * RE };
}

// Élision : « d'Oulan-Oudé ». Pas de « y » : « de York ».
const VOWEL = /^[aeiouàâäéèêëîïôöùûü]/i;
const de = name => (VOWEL.test(name) ? "d'" : 'de ') + name;

/** « à 185 km d'Oulan-Oudé, Russie », ou rien s'il n'y a personne. */
export function placeLine(lon, lat, zoom) {
  const c = nearestCity(lon, lat, zoom >= 9 ? 5 : 4, 300);
  if (!c) return '';
  const where = CITY.name[c.i] + (CITY.ctry[c.i] ? ', ' + CITY.ctry[c.i] : '');
  if (c.km < 9) return 'à ' + where;
  return 'à ' + Math.max(5, Math.round(c.km / 5) * 5) + ' km '
       + de(CITY.name[c.i]) + (CITY.ctry[c.i] ? ', ' + CITY.ctry[c.i] : '');
}
