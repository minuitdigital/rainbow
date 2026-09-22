// =========================================================================
//  LE PASSÉ RECALCULÉ
//
//  Les deux graphes du panneau montrent les vingt-quatre dernières heures
//  simulées SOUS LE RÉTICULE. Rien n'est mémorisé : le ciel est une
//  fonction pure du lieu et de l'instant, donc son passé se recalcule
//  aussi bien qu'il s'observe.
//
//  C'est le même principe que la carte — rien n'est déplacé, tout est
//  recalculé — et c'est ce qui permet de déplacer le réticule : l'histoire
//  du nouveau lieu apparaît entière, au lieu de recommencer à zéro. Une
//  mémoire à tampon, elle, aurait montré vingt-quatre heures d'un endroit
//  où l'on n'est plus.
//
//  L'AXE DU TEMPS EST LOGARITHMIQUE, emprunté aux moniteurs de débit : la
//  dernière minute occupe la moitié de la largeur, la dernière journée
//  l'autre moitié. Sans quoi, à ×100 000, la dernière heure serait un
//  cheveu contre le bord droit.
// =========================================================================

import { dateAt, driftAt, driftChanceAt, elapsedHours, slotAt } from './view.js';
import { solar, sunElev, sunGate, spillAt, meteoAt, chanceAt, legendAt } from './sky.js';

/** La profondeur de champ, en heures simulées. */
export const AGE_MAX = 24;

/** Combien de points. Deux bruits fractals chacun : c'est le coût du tour. */
const NPAST = 320;

/**
 * L'échelle du temps. TAU est l'âge en deçà duquel on ne comprime plus —
 * 0,01 h, soit trente-six secondes.
 */
const TAU = 0.01;
const LNSPAN = Math.log1p(AGE_MAX / TAU);

/** Âge en heures → abscisse de 0 (le plus vieux) à 1 (maintenant). */
export const posOf = age => 1 - Math.log1p(Math.max(0, age) / TAU) / LNSPAN;

/**
 * Le tableau des échantillons, du plus ancien au plus récent. Reconstruit
 * en place à chaque appel de `recall` : les dessinateurs le lisent, ils ne
 * le gardent pas.
 *
 *    t     heure simulée absolue
 *    h     hauteur du soleil, en degrés
 *    gate  la porte, de 0 à ~0,80
 *    spill ce que la porte laisserait fuir ici, AVANT pondération
 *    m l c les trois croyances, chacune de 0 à 1, NON pondérées
 *
 *  Les poids sont appliqués au dessin et non ici : bouger un curseur
 *  repondère toute l'histoire d'un coup, sans rien recalculer. C'est
 *  aussi pourquoi `spill` est rangé brut : la fuite dépend du curseur de
 *  chance, et le curseur n'entre qu'au tracé.
 *
 *  La FLAQUE, elle, n'apparaît nulle part : on est au réticule, elle y
 *  vaut 1. Le passé se lit donc toujours à chance pleine.
 */
export const past = [];

/** Le ciel en un point, à une heure simulée quelconque — passée ou non. */
function skyAt(lon, lat, h, leg) {
  const sun = solar(dateAt(h));
  const e = sunElev(lon, lat, sun);
  return {
    t: h,
    h: e,
    gate: sunGate(e),
    spill: spillAt(e),
    // CHAQUE ÉCHANTILLON A SON PROPRE PAS DE TEMPS. C'est tout l'intérêt
    // de télécharger quatre jours : la courbe des vingt-quatre heures
    // passées montre la VRAIE météo qu'il a fait, heure par heure, et non
    // la météo d'à présent étalée en arrière.
    m: meteoAt(lon, lat, sun, driftAt(h), slotAt(h)),
    l: leg,
    c: chanceAt(lon, lat, driftChanceAt(h))
  };
}

/**
 * Refait l'histoire des vingt-quatre dernières heures en (lon, lat).
 * Les points sont espacés selon l'axe, pas selon le temps : serrés à
 * droite, lâches à gauche, de sorte que la courbe ait la même finesse
 * partout à l'écran.
 */
export function recall(lon, lat) {
  const now = elapsedHours();
  // La légende ne dépend pas de l'heure : une fois suffit pour les 320.
  const leg = legendAt(lon, lat);

  past.length = 0;
  for (let i = NPAST; i >= 1; i--)
    past.push(skyAt(lon, lat, now - TAU * Math.expm1(LNSPAN * (i / NPAST)), leg));
  past.push(skyAt(lon, lat, now, leg));
  return past;
}
