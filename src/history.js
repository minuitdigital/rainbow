// =========================================================================
//  LE PASSÉ RECALCULÉ
//
//  Les vingt-quatre dernières heures sous le réticule, recalculées et non
//  mémorisées : le ciel est une fonction pure du lieu et de l'instant.
//  Axe du temps logarithmique : la dernière minute prend la moitié.
// =========================================================================

import { dateAt, driftAt, driftChanceAt, elapsedHours, slotAt } from './view.js';
import { solar, sunElev, sunGate, spillAt, meteoAt, chanceAt, legendAt } from './sky.js';

/** La profondeur de champ, en heures simulées. */
export const AGE_MAX = 24;

/** Deux bruits fractals par point : c'est le coût du tour. */
const NPAST = 320;

/** Âge (h) en deçà duquel on ne comprime plus : 36 s. */
const TAU = 0.01;
const LNSPAN = Math.log1p(AGE_MAX / TAU);

/** Âge en heures → abscisse de 0 (le plus vieux) à 1 (maintenant). */
export const posOf = age => 1 - Math.log1p(Math.max(0, age) / TAU) / LNSPAN;

/**
 * Échantillons du plus ancien au plus récent, reconstruits en place par
 * `recall` : les dessinateurs le lisent, ils ne le gardent pas.
 *
 *    t     heure simulée absolue
 *    h     hauteur du soleil, en degrés
 *    gate  la porte, de 0 à ~0,80
 *    spill fuite de la porte, AVANT pondération
 *    m l c les trois croyances, de 0 à 1, NON pondérées
 *
 *  Les poids s'appliquent au tracé : bouger un curseur repondère toute
 *  l'histoire sans recalcul. La flaque vaut 1 au réticule : le passé se
 *  lit à chance pleine.
 */
export const past = [];

/** Le ciel en un point, à une heure simulée quelconque. */
function skyAt(lon, lat, h, leg) {
  const sun = solar(dateAt(h));
  const e = sunElev(lon, lat, sun);
  return {
    t: h,
    h: e,
    gate: sunGate(e),
    spill: spillAt(e),
    // Chaque échantillon prend la météo de SON heure, pas celle d'à présent.
    m: meteoAt(lon, lat, sun, driftAt(h), slotAt(h)),
    l: leg,
    c: chanceAt(lon, lat, driftChanceAt(h))
  };
}

/**
 * Refait les vingt-quatre dernières heures en (lon, lat). Points espacés
 * selon l'axe, pas selon le temps : même finesse partout à l'écran.
 */
export function recall(lon, lat) {
  const now = elapsedHours();
  // La légende ne dépend pas de l'heure : une fois suffit.
  const leg = legendAt(lon, lat);

  past.length = 0;
  for (let i = NPAST; i >= 1; i--)
    past.push(skyAt(lon, lat, now - TAU * Math.expm1(LNSPAN * (i / NPAST)), leg));
  past.push(skyAt(lon, lat, now, leg));
  return past;
}
