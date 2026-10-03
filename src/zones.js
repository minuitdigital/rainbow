// =========================================================================
//  LES ZONES ET LEURS OBSERVATEURS
//
//  Cinq fois par seconde : balayer l'écran, retenir les sommets du champ,
//  les apparier aux zones vivantes (fondu au lieu de clignotement). Chaque
//  zone porte un à cinq OBSERVATEURS, chacun avec son propre chiffre.
// =========================================================================

import { DEG, wrap180, geoVec } from './projection.js';
import { view, scale, geoAt, slotNow, rig } from './view.js';
import { rainbowIndex, ingredients, openFor, nearestLegend } from './sky.js';
import { terrainAt } from './ground.js';

/** Réassigné à chaque passe : liaison vive. */
export let zones = [];

let nextId = 1;

const hash01 = n => {
  n = Math.imul(n ^ (n >>> 15), 2246822519);
  n = Math.imul(n ^ (n >>> 13), 3266489917);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

// -------------------------------------------------------- le chiffre porté

/**
 * Pourcentage VOLONTAIREMENT POÉTIQUE : champ, horizon, accessibilité et
 * une chance propre à l'observateur (`luck`, distincte de la CHANCE du
 * champ) qui oscille sans raison. La durée, elle, est exacte.
 */
export function estimate(lon, lat, sun, drift, driftC, w, seed, simH, here, slot) {
  const base = rainbowIndex(lon, lat, sun, drift, driftC, w, here, slot);
  if (base <= 0.02) return null;

  const ing = ingredients(lon, lat, sun, drift, driftC, here, w, slot);
  const [acc, open] = terrainAt(lon, lat);
  const luck = 0.5 + 0.5 * Math.sin(simH * (2 * Math.PI / 1.3) + seed * 6.2832);
  const soft = 0.58 + 0.42 * (0.34 * open + 0.24 * acc + 0.42 * luck);

  return {
    v: Math.max(0.05, Math.min(0.99, base * soft)),
    lon, lat,
    gate: ing.gate, meteo: ing.meteo, legende: ing.legende, chance: ing.chance,
    acc, open, luck,
    min: openFor(lon, lat, sun)
  };
}

const PHRASES = {
  imminent: ['imminent'],
  nul:      ['personne pour voir', 'pleine mer', 'nul témoin'],
  chance:   ['au hasard', 'un pressentiment', 'rien ne le justifie'],
  soleil:   ['soleil rasant', 'angle juste'],
  averse:   ['averse en cours', "l'averse s'éloigne"],
  horizon:  ['horizon ouvert', 'depuis la crête'],
  trouee:   ['le soleil perce', 'ciel déchiré']
};

const pick = (k, seed) => {
  const l = PHRASES[k];
  return l[Math.floor(seed * 9973) % l.length];
};

/**
 * La phrase dit ce qui PORTE le chiffre, pas ce qu'il vaut. Si c'est la
 * légende, on cite la croyance du lieu.
 */
export function phraseFor(e, seed, w) {
  if (e.v > 0.95) return pick('imminent', seed);
  if (e.acc < 0.34) return pick('nul', seed);

  // qui, des trois, porte réellement le chiffre ?
  const pm = w.m * e.meteo, pl = w.l * e.legende, pc = w.c * e.chance;

  if (pl >= pm && pl >= pc && e.legende > 0.35) {
    const L = nearestLegend(e.lon, e.lat);
    if (L) return L.dit;
  }
  if (pc >= pm && pc >= pl) return pick('chance', seed);

  if (e.gate > 0.78) return pick('soleil', seed);
  if (e.meteo > 0.88) return pick('averse', seed);
  if (e.open > 0.86) return pick('horizon', seed);
  return pick('trouee', seed);
}

// ------------------------------------------------------------- le balayage

function makePoints(id) {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    pts.push({
      seed: hash01(id * 7919 + i * 104729),
      ang: hash01(id * 131 + i * 977) * 6.2832,
      rf: i === 0 ? 0 : 0.30 + 0.55 * hash01(id * 13 + i * 37),
      on: 0, est: null, phrase: ''
    });
  }
  return pts;
}

/** Les sommets du champ visibles à l'écran, espacés d'au moins 150 px. */
function findPeaks(sun, drift, driftC, w, here, slot) {
  // LE PAS VIENT DE LA MACHINE : le coût monte comme son carré.
  const step = rig().probe, found = [];
  for (let py = step * 0.5; py < view.H; py += step) {
    for (let px = step * 0.5; px < view.W; px += step) {
      const g = geoAt(px, py);
      if (!g) continue;
      const v = rainbowIndex(g[0], g[1], sun, drift, driftC, w, here, slot);
      if (v > 0.55) found.push({ px, py, v, lon: g[0], lat: g[1] });
    }
  }
  found.sort((a, b) => b.v - a.v);

  const peaks = [];
  for (const c of found) {
    if (peaks.length >= 12) break;
    let far = true;
    for (const p of peaks)
      if (Math.hypot(p.px - c.px, p.py - c.py) < 150) { far = false; break; }
    if (far) peaks.push(c);
  }

  // Rayon apparent : on marche vers l'extérieur jusqu'à la mi-hauteur.
  for (const p of peaks) {
    let sum = 0;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      let r = 24;
      for (; r < 400; r += 24) {
        const g = geoAt(p.px + Math.cos(a) * r, p.py + Math.sin(a) * r);
        if (!g) break;
        if (rainbowIndex(g[0], g[1], sun, drift, driftC, w, here, slot) < p.v * 0.5) break;
      }
      sum += r;
    }
    p.r = sum / 8;
  }
  return peaks;
}

/**
 * Une passe : détection, appariement, fondu, observateurs. Cinq fois par
 * seconde ; le tracé suit chaque image (points rangés en lon/lat).
 */
export function scan(sun, drift, driftC, simH, w, here) {
  // Un seul pas de temps pour toute la passe : elle décrit UN instant.
  const slot = slotNow();
  const peaks = findPeaks(sun, drift, driftC, w, here, slot);

  // Appariement géographique avec les zones déjà vivantes.
  const free = zones.slice();
  for (const p of peaks) {
    let best = null, bd = 14;                     // 14° de tolérance
    for (const z of free) {
      const d = Math.hypot(wrap180(z.lon - p.lon), z.lat - p.lat);
      if (d < bd) { bd = d; best = z; }
    }
    if (best) {
      free.splice(free.indexOf(best), 1);
      best.lon += wrap180(p.lon - best.lon) * 0.45;
      best.lat += (p.lat - best.lat) * 0.45;
      best.r += (p.r - best.r) * 0.35;
      best.peak = p.v;
      best.seen = true;
    } else {
      const id = nextId++;
      zones.push({ id, lon: p.lon, lat: p.lat, r: p.r, peak: p.v,
                   a: 0, seen: true, pts: makePoints(id) });
    }
  }

  // Celles qu'on n'a pas revues s'effacent, puis s'en vont.
  for (const z of zones) if (!z.seen) z.a = Math.max(0, z.a - 0.12);
  zones = zones.filter(z => z.seen || z.a > 0.01);

  // Combien de points, où, et ce qu'ils valent.
  for (const z of zones) {
    z.a = z.seen ? Math.min(1, z.a + 0.18) : z.a;
    const n = Math.max(1, Math.min(5, Math.round(z.r / 90)));
    const rg = (z.r / scale()) * 58;              // rayon écran → degrés
    const cl = Math.max(0.2, Math.cos(z.lat * DEG));
    for (let i = 0; i < z.pts.length; i++) {
      const pt = z.pts[i];
      pt.on += ((i < n ? 1 : 0) - pt.on) * 0.22;
      pt.lat = z.lat + pt.rf * rg * Math.sin(pt.ang);
      pt.lon = wrap180(z.lon + pt.rf * rg * Math.cos(pt.ang) / cl);
      pt.est = estimate(pt.lon, pt.lat, sun, drift, driftC, w, pt.seed, simH, here, slot);
      pt.phrase = pt.est ? phraseFor(pt.est, pt.seed, w) : '';
    }
    z.seen = false;
  }
}

// ------------------------------------------------------------ l'arc-en-ciel
// Le point le plus fort de TOUTE la Terre, flaque à 1 (`here` null).
// Un degré, puis un dixième autour du meilleur : ~40 ms par appui.
// Entre égaux (plafond à 1), le plus proche du piéton.

export function brightest(sun, drift, driftC, w, here) {
  const slot = slotNow();
  let best = { v: -1, d: 9, lon: 0, lat: 0 };
  const probe = (lon, lat) => {
    const v = rainbowIndex(lon, lat, sun, drift, driftC, w, null, slot);
    if (v < best.v - 1e-3) return;
    const g = geoVec(lon, lat);
    const d = (g[0] - here[0]) ** 2 + (g[1] - here[1]) ** 2 + (g[2] - here[2]) ** 2;
    if (v > best.v + 1e-3 || d < best.d) best = { v, d, lon, lat };
  };
  for (let lat = -89.5; lat < 90; lat += 1)
    for (let lon = -179.5; lon < 180; lon += 1) probe(lon, lat);
  const { lon: l0, lat: b0 } = best;
  for (let lat = b0 - 1; lat <= b0 + 1; lat += 0.1)
    for (let lon = l0 - 1; lon <= l0 + 1; lon += 0.1)
      if (Math.abs(lat) < 90) probe(wrap180(lon), lat);
  return best;
}
