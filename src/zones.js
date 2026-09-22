// =========================================================================
//  LES ZONES ET LEURS OBSERVATEURS
//
//  Ce qui vit d'une image à l'autre. Cinq fois par seconde, on balaie
//  l'écran, on retient les sommets du champ, et on les APPARIE avec les
//  zones déjà vivantes : une zone garde son identité tant qu'elle reste au
//  même endroit du globe, si bien qu'elle apparaît et disparaît en fondu
//  au lieu de clignoter.
//
//  Chaque zone porte de un à cinq points selon sa taille à l'écran. Ce ne
//  sont pas cinq mesures du même endroit mais CINQ OBSERVATEURS : celui
//  qui est sur la crête voit l'arc, celui du fond de la vallée non. C'est
//  le sujet même du projet — un arc-en-ciel n'existe pas à un endroit, il
//  existe pour un observateur.
// =========================================================================

import { DEG, wrap180 } from './projection.js';
import { view, scale, geoAt } from './view.js';
import { rainbowIndex, ingredients, openFor, nearestLegend } from './sky.js';
import { terrainAt } from './ground.js';

/** Les zones vivantes. Réassigné à chaque passe : c'est une liaison vive. */
export let zones = [];

let nextId = 1;

const hash01 = n => {
  n = Math.imul(n ^ (n >>> 15), 2246822519);
  n = Math.imul(n ^ (n >>> 13), 3266489917);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

// -------------------------------------------------------- le chiffre porté

/**
 * Les ingrédients du pourcentage. Il est COMPOSITE ET VOLONTAIREMENT
 * POÉTIQUE : ce que la carte affiche, le dégagement de l'horizon,
 * l'accessibilité du lieu, et une part de chance propre à l'observateur
 * qui oscille sans raison. Il est fait pour osciller et déplacer le regard
 * d'une zone à l'autre. La durée, elle, est exacte.
 *
 * À ne pas confondre : la CHANCE du champ est un lieu du monde où la
 * chance se tient ; la chance d'ici est celle d'une personne. La première
 * se partage entre voisins, la seconde non.
 */
export function estimate(lon, lat, sun, drift, driftC, w, seed, simH, here) {
  const base = rainbowIndex(lon, lat, sun, drift, driftC, w, here);
  if (base <= 0.02) return null;

  const ing = ingredients(lon, lat, sun, drift, driftC, here, w);
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
 * La phrase dit ce qui PORTE le chiffre, pas ce qu'il vaut.
 *
 * Quand c'est la légende qui le porte, c'est la légende qui parle : la
 * carte cite la croyance du lieu plutôt que de la résumer. « Au pied de
 * l'arc, le chaudron d'or du leprechaun » — voilà ce que dit une carte
 * dont le spectateur a poussé le curseur vers la légende.
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
function findPeaks(sun, drift, driftC, w, here) {
  const step = 30, found = [];
  for (let py = step * 0.5; py < view.H; py += step) {
    for (let px = step * 0.5; px < view.W; px += step) {
      const g = geoAt(px, py);
      if (!g) continue;
      const v = rainbowIndex(g[0], g[1], sun, drift, driftC, w, here);
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
        if (rainbowIndex(g[0], g[1], sun, drift, driftC, w, here) < p.v * 0.5) break;
      }
      sum += r;
    }
    p.r = sum / 8;
  }
  return peaks;
}

/**
 * Une passe complète : détection, appariement, fondu, puis les cinq
 * observateurs de chaque zone. Appelée cinq fois par seconde — le TRACÉ,
 * lui, suit chaque image, parce que les points sont rangés en coordonnées
 * géographiques et non en pixels.
 */
export function scan(sun, drift, driftC, simH, w, here) {
  const peaks = findPeaks(sun, drift, driftC, w, here);

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
      pt.est = estimate(pt.lon, pt.lat, sun, drift, driftC, w, pt.seed, simH, here);
      pt.phrase = pt.est ? phraseFor(pt.est, pt.seed, w) : '';
    }
    z.seen = false;
  }
}
