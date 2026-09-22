// =========================================================================
//  LES HAUTS LIEUX SE VOIENT-ILS ?
//
//      node build/check_legends.mjs
//
//  Un point de légende peut être parfaitement écrit dans src/legends.js et
//  n'apparaître JAMAIS à l'écran : il suffit que sa force, multipliée par
//  la porte du soleil et passée au seuil, ne franchisse pas la barre. La
//  carte ne le dit pas — elle montre du papier blanc, exactement comme
//  s'il n'y avait pas de croyance là-bas.
//
//  Ce fichier va donc voir. Pour chaque haut lieu, il balaie une journée
//  entière à quatre dates de l'année, en croyance « légende pure », et
//  répond à deux questions :
//
//      1. le lieu s'allume-t-il, à un moment quelconque ?
//      2. combien de temps par jour, et dans quelle tranche de hauteur ?
//
//  La réponse à la deuxième est le vrai sujet. Un arc-en-ciel demande un
//  soleil bas : la couleur ne vit donc que dans un COULOIR, une bande
//  étroite qui suit le terminateur autour du globe. Un lieu « invisible »
//  est presque toujours un lieu qu'on regarde à la mauvaise heure — et
//  c'est ce que le pointillé du réglage « couloir » montre à l'écran.
//
//  ATTENTION : le dernier étage du calcul — la puissance 1,15, le seuil,
//  le ré-étalement — vit dans src/shader.js et nulle part ailleurs, parce
//  qu'il ne concerne que la COULEUR et pas la présence. Il est donc
//  recopié ici, et c'est la seule copie du projet que le miroir ne garde
//  pas. Si le bloc « LE SEUIL » du shader bouge, ce fichier ment.
// =========================================================================

import { LEGENDS } from '../src/legends.js';
import { solar, sunElev, sunGate, legendAt, GAIN } from '../src/sky.js';

/** Les valeurs par défaut du panneau : c'est ce que l'on voit en arrivant. */
const SEUIL = 0.60, TACHE = 1.0;

/** Quatre dates : les solstices et les équinoxes encadrent toute l'année. */
const DATES = ['2026-03-21', '2026-06-21', '2026-09-22', '2026-12-21'];

/** Le pas du balayage, en minutes. Cinq suffit : le couloir dure des heures. */
const STEP = 5;

/** Recopie du dernier étage de src/shader.js — voir l'avertissement en tête. */
function couleur(t) {
  let fv = Math.min(1, Math.pow(Math.min(t, 1), 1.15) * 0.98 * TACHE);
  if (SEUIL > 0.001) fv = fv > SEUIL
    ? 0.30 + 0.70 * Math.min(1, (fv - SEUIL) / Math.max(1 - SEUIL, 1e-3))
    : 0;
  return fv;
}

let muets = 0;

for (const jour of DATES) {
  console.log('\n===== ' + jour + ' — croyance « légende » à 100 % =====');

  for (const l of LEGENDS) {
    const force = legendAt(l.lon, l.lat);      // la force au centre du lieu
    let minutes = 0, hBas = Infinity, hHaut = -Infinity, pic = 0;

    for (let m = 0; m < 1440; m += STEP) {
      const d = new Date(jour + 'T00:00:00Z');
      d.setUTCMinutes(m);
      const h = sunElev(l.lon, l.lat, solar(d));
      const fv = couleur(sunGate(h) * force * GAIN);
      if (fv <= 0) continue;
      minutes += STEP;
      if (fv > pic) pic = fv;
      if (h < hBas)  hBas  = h;
      if (h > hHaut) hHaut = h;
    }

    const vu = minutes > 0;
    if (!vu) muets++;
    console.log(
      (vu ? '  vu   ' : '  MUET ') + l.nom.padEnd(18) +
      ' force ' + force.toFixed(2) +
      ' · ' + String(Math.round(minutes / 60 * 10) / 10).padStart(4) + ' h/jour' +
      (vu ? ' · soleil ' + hBas.toFixed(1) + '° à ' + hHaut.toFixed(1) + '°'
          + ' · pic ' + pic.toFixed(2)
          : ''));
  }
}

console.log(muets === 0
  ? '\nTous les hauts lieux s’allument. Chacun dans son couloir, et nulle part ailleurs.'
  : `\n✗ ${muets} lieu(x) ne s’allument jamais : trop faibles pour le seuil.`);

process.exit(muets === 0 ? 0 : 1);
