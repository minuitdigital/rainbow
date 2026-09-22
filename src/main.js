// =========================================================================
//  L'ASSEMBLAGE
//
//  Le seul fichier qui connaisse tous les autres, et le seul qui touche
//  au document. Il fait trois choses : il branche, il mesure, et il tient
//  la boucle d'images.
//
//  L'ordre de dépendance de tout le programme, de haut en bas, sans
//  jamais de retour en arrière :
//
//      projection   maths pures, ne connaît personne
//      legends      les hauts lieux de la croyance, écrits à la main
//      sky          la porte du soleil, et le partage de la croyance
//      ground       le relief et les lieux
//      view         le seul état mutable : où, de quelle distance, quand
//      history      les 24 dernières heures, recalculées et non mémorisées
//      zones        ce qui vit d'une image à l'autre
//      shader       le GLSL
//      map          la carte peinte
//      ink          le calque 2D
//      panel        les quatre registres de droite
//      chrome       la main
//      main         ici
// =========================================================================

import { view, measure, centre, centreVec, coast, anchorTo, simDate, elapsedHours,
         advanceClock, stride, drift, driftChance, beliefWeights } from './view.js';
import { solar } from './sky.js';
import { scan } from './zones.js';
import { initMap, paint } from './map.js';
import { initInk, rescale, trace } from './ink.js';
import { initPanel, refreshPanel } from './panel.js';
import { bind } from './chrome.js';

const glCv = document.getElementById('gl');
const inkCv = document.getElementById('ink');

// --------------------------------------------------------------- la mesure

function resize() {
  measure(glCv.clientWidth, glCv.clientHeight);
  for (const c of [glCv, inkCv]) {
    c.width = Math.round(view.W * view.dpr);
    c.height = Math.round(view.H * view.dpr);
  }
  rescale();
  invalidate();
}

// -------------------------------------------------------- la boucle d'images
// On ne redessine que si quelque chose a changé : un geste, une animation
// en cours, ou le temps qui avance. Une carte figée ne consomme rien —
// c'est ce qui la rend supportable sur un mur, des années durant.

let dirty = true, rafId = 0, last = performance.now(), lastScan = -1e9;

function invalidate() {
  dirty = true;
  if (!rafId) rafId = requestAnimationFrame(frame);
}

/** Approche exponentielle : rend true tant qu'il reste du chemin. */
function ease(key, target, rate, dt, epsilon) {
  if (Math.abs(target - view[key]) > epsilon) {
    view[key] += (target - view[key]) * (1 - Math.exp(-dt * rate));
    return true;
  }
  if (view[key] !== target) { view[key] = target; return true; }
  return false;
}

function frame(now) {
  rafId = 0;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  let animating = false;

  // L'horloge simulée s'accumule ici, et nulle part ailleurs.
  advanceClock(dt);

  // Le zoom glisse vers sa cible, en gardant le point visé sous le curseur.
  const zooming = ease('zoom', view.zoomTarget, 16, dt, 1e-4);
  if (zooming) {
    if (view.anchor) anchorTo(view.anchor.lon, view.anchor.lat, view.anchor.px, view.anchor.py);
    if (view.zoom === view.zoomTarget) view.anchor = null;
    animating = true;
  }

  if (ease('mode', view.modeTarget, 8, dt, 1e-3)) animating = true;
  if (coast(dt)) animating = true;

  // La foulée se mesure APRÈS toutes les rotations : elle lit le
  // déplacement, elle ne le décide pas.
  if (stride(dt)) animating = true;

  if (view.speed > 0) animating = true;          // le temps avance

  if (dirty || animating) {
    dirty = false;
    const when = simDate();
    const sun = solar(when);

    // Les zones ne sont ré-examinées que cinq fois par seconde. Le tracé,
    // lui, suit chaque image : les points sont rangés en coordonnées
    // géographiques, pas en pixels.
    //
    // `centreVec` est le centre de la flaque de chance : le balayage doit
    // savoir où se tient le piéton, puisque sa chance le suit.
    if (now - lastScan > 200) {
      lastScan = now;
      scan(sun, drift(), driftChance(), elapsedHours(), beliefWeights(), centreVec());
    }

    const c = centre();
    paint(glCv, sun);
    trace(c);
    refreshPanel(sun, c, when);
  }

  if (animating) rafId = requestAnimationFrame(frame);
}

// ------------------------------------------------------------ le démarrage
// En dernier, et pas par coquetterie : les déclarations ci-dessus vivent
// dans leur zone morte temporelle tant que le module n'a pas fini de
// s'évaluer. Démarrer plus haut ferait lire `dirty` avant qu'il existe.

// La veille inscrite dans index.html attend ce drapeau : il dit « les
// modules sont arrivés ». Ce qui échoue ensuite a le droit de s'expliquer ;
// ce qui échoue avant ne le peut pas, d'où la veille.
window.__rainbow = true;

const fallback = document.getElementById('fallback');

if (!initMap(glCv, invalidate)) {
  fallback.innerHTML = 'Cette carte est calculée par le processeur graphique.'
                     + '<br>WebGL 2 n\'est pas disponible dans ce navigateur.';
  fallback.hidden = false;
} else {
  initInk(inkCv);
  // Le panneau avant la main : les réglages mémorisés doivent être posés
  // (vitesse, allure, croyance) avant la première image.
  initPanel(invalidate);
  bind(inkCv, invalidate);
  window.addEventListener('resize', resize);
  resize();
}
