// =========================================================================
//  LE MIROIR
//
//      node build/check_mirror.mjs
//
//  src/shader.js calcule la présence POUR CHAQUE PIXEL, sur le processeur
//  graphique. src/sky.js la recalcule AU RÉTICULE, en JavaScript. Les deux
//  doivent dire exactement la même chose : sinon le chiffre affiché cesse
//  de décrire la couleur qu'on a sous les yeux, et la pièce ment.
//
//  Cette duplication ne peut pas être supprimée — on ne fait pas tourner
//  du GLSL au réticule, et on ne fait pas tourner du JavaScript par pixel.
//  Elle peut en revanche être SURVEILLÉE : ce fichier lit les deux sources
//  comme du texte et vérifie que toutes les constantes de la formule y
//  sont les mêmes. Changer un seuil d'un côté et pas de l'autre devient
//  une erreur bruyante au lieu d'une dérive silencieuse.
//
//  Ce n'est pas une preuve d'égalité : c'est un garde-fou sur les nombres,
//  qui sont ce qui dérive en pratique. La forme des formules, elle, se
//  relit à l'œil — les deux fichiers sont écrits pour ça.
// =========================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = rel => readFileSync(join(ROOT, rel), 'utf8');

const GLSL = src('src/shader.js');
const SKY  = src('src/sky.js');
const LEG  = src('src/legends.js');

/**
 * Chaque règle : un nom, un motif côté GLSL, un motif côté JavaScript.
 * Tous les nombres capturés par l'un doivent égaler ceux capturés par
 * l'autre, dans l'ordre.
 */
const RULES = [
  ['la porte, hauteur maximale',
    /const float SUN_MAX = ([\d.]+);/,
    /export const SUN_MAX = ([\d.]+);/],

  ['le gain final',
    /const float GAIN = ([\d.]+);/,
    /export const GAIN = ([\d.]+);/],

  ['le plancher de la légende',
    /const float LEGEND_FLOOR = ([\d.]+);/,
    /export const LEGEND_FLOOR = ([\d.]+);/, LEG],

  ['la fréquence du champ',
    /const float FIELD_FREQ = ([\d.]+);/,
    /const FIELD_FREQ = ([\d.]+);/],

  ['la fréquence de la chance',
    /const float CHANCE_FREQ = ([\d.]+);/,
    /const CHANCE_FREQ = ([\d.]+);/],

  ['le bord bas de la porte',
    /\(h > ([\d.]+) && h < SUN_MAX\)/,
    /if \(h <= ([\d.]+) \|\| h >= SUN_MAX\) return 0;/],

  ['la flaque de chance',
    /const float LUCK_NEAR = ([\d.]+), LUCK_FAR = ([\d.]+);/,
    /export const LUCK_NEAR = ([\d.]+), LUCK_FAR = ([\d.]+);/],

  ['la fuite de la porte',
    /const float SPILL_AMP = ([\d.]+), SPILL_DEG = ([\d.]+);/,
    /export const SPILL_AMP = ([\d.]+), SPILL_DEG = ([\d.]+);/],

  ['le bord de la fuite',
    /float dOut = max\(max\(([\d.]+) - h, h - SUN_MAX\), 0\.0\);/,
    /const d = Math\.max\(([\d.]+) - h, h - SUN_MAX, 0\);/],

  ['le seuil au-dessous duquel on ne calcule rien',
    /gateC > ([\d.]+)\)\{/,
    /gateC <= ([\d.]+)\) return 0;/],

  ['la courbe de la porte',
    /pow\(1\.0 - h \/ SUN_MAX, ([\d.]+)\)/,
    /Math\.pow\(1 - h \/ SUN_MAX, ([\d.]+)\)/],

  ['la montée de la porte',
    /smoothstep\(0\.0, ([\d.]+), h\)/,
    /Math\.min\(1, h \/ ([\d.]+)\)\)/],

  ['le seuil de la pluie',
    /smoothstep\(([\d.]+), ([\d.]+), fbm\(sp \+ vec3\(uDrift/,
    /smooth01\(raw, ([\d.]+), ([\d.]+)\);\s*\}/],

  ['le seuil de la chance',
    /smoothstep\(([\d.]+), ([\d.]+),\s*\n?\s*fbm\(sp \* CHANCE_FREQ/,
    /driftC \+ 41[\s\S]*?smooth01\(raw, ([\d.]+), ([\d.]+)\)/],

  ['la trouée',
    /\(([\d.]+) \+ ([\d.]+) \* exp\(-a \* a\) \+ ([\d.]+) \* exp\(-b \* b\)\)/,
    /return ([\d.]+) \+ ([\d.]+) \* Math\.exp\(-a \* a\) \+ ([\d.]+) \* Math\.exp\(-b \* b\);/],

  ['les latitudes de la trouée',
    /float a = \(lat - uDecl \* ([\d.]+)\) \/ ([\d.]+);\s*\n\s*float b = \(abs\(lat\) - ([\d.]+)\) \/ ([\d.]+);/,
    /const a = \(lat - sun\.decl \* ([\d.]+)\) \/ ([\d.]+);\s*\n\s*const b = \(Math\.abs\(lat\) - ([\d.]+)\) \/ ([\d.]+);/],

  ['la météo',
    /1\.0 - exp\(-rain \* \(gap \/ ([\d.]+)\) \* ([\d.]+)\)/,
    /1 - Math\.exp\(-rain \* \(gapAt\(lon, lat, sun, slot\) \/ ([\d.]+)\) \* ([\d.]+)\)/],

  // LA BRANCHE MÉTÉO. Depuis qu'Open-Meteo remplace le bruit, la trouée a
  // DEUX formules selon le mode, et il faut que les deux tiennent le
  // miroir. Celle-ci remet la clarté mesurée sur la course exacte de
  // l'ancienne climatologie — même plancher, même amplitude — pour que
  // basculer de « dev » à « météo » ne change pas l'échelle de la carte,
  // seulement ce qu'elle raconte.
  ['la trouée mesurée',
    /gap = ([\d.]+) \+ ([\d.]+) \* w\.g;/,
    /if \(slot != null\) return ([\d.]+) \+ ([\d.]+) \* wxClear\(lon, lat, slot\);/],

  ['les trois octaves',
    /return ([\d.]+) \* vnoise\(p\) \+ ([\d.]+) \* vnoise\(p \* ([\d.]+)\) \+ ([\d.]+) \* vnoise\(p \* ([\d.]+)\);/,
    /([\d.]+) \* vnoise\(x, y, z\)\s*\+ ([\d.]+) \* vnoise\(x\*([\d.]+), y\*[\d.]+, z\*[\d.]+\)\s*\+ ([\d.]+) \* vnoise\(x\*([\d.]+), y\*[\d.]+, z\*[\d.]+\);/],

  ['le hachage',
    /p = fract\(p \* ([\d.]+) \+ vec3\(([\d.]+), ([\d.]+), ([\d.]+)\)\);\s*\n\s*p \*= ([\d.]+);/,
    /x = fract\(fr\(x \* ([\d.]+) \+ ([\d.]+)\)\) \* (?:17)[\s\S]*?\+ ([\d.]+)\)\) \* 17;\s*\n\s*z = fract\(fr\(z \* [\d.]+ \+ ([\d.]+)\)\) \* ([\d.]+);/],

  ['le décalage de la chance',
    /vec3\(uDriftC \+ ([\d.]+), ([\d.]+), ([\d.]+)\)/,
    /driftC \+ (\d+),\s*\n?\s*[\s\S]*?\+ (\d+),\s*\n?\s*[\s\S]*?\+ (\d+)\)/],
];

const num = s => Number(s);
let bad = 0;

for (const [label, reGl, reJs, altJs] of RULES) {
  const a = GLSL.match(reGl);
  const b = (altJs ?? SKY).match(reJs);
  if (!a || !b) {
    console.error(`✗ ${label} — motif introuvable ${a ? 'côté JavaScript' : 'côté GLSL'}`);
    console.error('  (la formule a été réécrite : relire les deux fichiers, '
                + 'puis corriger le motif ici)');
    bad++;
    continue;
  }
  const va = a.slice(1).map(num), vb = b.slice(1).map(num);
  const same = va.length === vb.length && va.every((v, i) => v === vb[i]);
  if (!same) {
    console.error(`✗ ${label}`);
    console.error(`    shader : ${va.join(', ')}`);
    console.error(`    sky    : ${vb.join(', ')}`);
    bad++;
  } else {
    console.log(`✓ ${label.padEnd(30)} ${va.join(', ')}`);
  }
}

if (bad) {
  console.error(`\n${bad} divergence(s). Le chiffre lu sous le réticule ne `
              + 'décrit plus la couleur affichée.');
  process.exit(1);
}
console.log('\nLe miroir tient.');
