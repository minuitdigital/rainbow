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
         advanceClock, stride, drift, driftChance, beliefWeights,
         beatFrame, rig, slotNow, wxOn } from './view.js';
import { initWeather, keepFresh } from './weather.js';
import { solar } from './sky.js';
import { scan } from './zones.js';
import { initMap, paint, uploadWeather } from './map.js';
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

  if (coast(dt)) animating = true;

  // La foulée se mesure APRÈS toutes les rotations : elle lit le
  // déplacement, elle ne le décide pas.
  if (stride(dt)) animating = true;

  // LE TEMPS AVANCE — mais pas à la même cadence selon d'où il vient.
  //
  // En dev, le curseur multiplie le temps par mille ou par cent mille : la
  // carte doit alors suivre image par image, sinon le soleil saute.
  //
  // En météo, une seconde vaut une seconde. Le soleil avance de quatre
  // centièmes de degré en dix secondes, et redessiner soixante fois par
  // seconde pour ça ferait chauffer un Raspberry Pi toute l'année sans que
  // personne ne voie la différence. La minuterie posée au démarrage réveille
  // la boucle de loin en loin ; entre deux, la carte dort pour de bon.
  if (view.clock === 'dev' && view.speed > 0) animating = true;

  if (dirty || animating) {
    dirty = false;
    const when = simDate();
    const sun = solar(when);

    // Les zones ne sont ré-examinées que quelques fois par seconde — la
    // machine dit combien. Le tracé, lui, suit chaque image : les points
    // sont rangés en coordonnées géographiques, pas en pixels.
    //
    // `centreVec` est le centre de la flaque de chance : le balayage doit
    // savoir où se tient le piéton, puisque sa chance le suit.
    if (now - lastScan > rig().scanMs) {
      lastScan = now;
      scan(sun, drift(), driftChance(), elapsedHours(), beliefWeights(), centreVec());
    }

    // LES TROIS CHRONOMÈTRES. Ils ne mesurent que le JavaScript — le
    // shader, lui, est encore en train de travailler quand `paint` rend la
    // main, et c'est le chronomètre du pilote qui le relève (voir map.js).
    // Le coût des `performance.now()` eux-mêmes est de l'ordre du dixième
    // de microseconde : quatre par image, c'est sous le bruit.
    const c = centre();
    const t0 = performance.now();
    paint(glCv, sun, slotNow());
    const t1 = performance.now();
    trace(c);
    const t2 = performance.now();
    refreshPanel(sun, c, when);
    const t3 = performance.now();

    beatFrame(now, t3 - t0, t1 - t0, t2 - t1, t3 - t2);

    // La fraîcheur se regarde ICI, dans la boucle, et pas sur une
    // minuterie : une page qui se réveille après trois jours de veille
    // aurait vu passer douze réveils pour rien. L'appel ne fait rien
    // pendant six heures, puis une requête.
    keepFresh();
  }

  if (animating) rafId = requestAnimationFrame(frame);
}

/**
 * LE BATTEMENT LENT du mode météo. Dix secondes : le soleil a bougé de
 * quatre centièmes de degré, ce qui est déjà plus fin que ce que la carte
 * sait montrer. Entre deux battements la boucle d'images est à l'arrêt
 * complet — c'est l'état normal d'un tableau sur un mur.
 */
setInterval(() => { if (wxOn()) invalidate(); }, 10000);

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
  // Deux fonctions et non une : le panneau redessine la plupart du temps,
  // mais changer de machine change le nombre de pixels réels et demande de
  // retailler les deux calques.
  initPanel(invalidate, resize);
  bind(inkCv, invalidate);
  window.addEventListener('resize', resize);
  resize();

  // LA MÉTÉO ARRIVE QUAND ELLE ARRIVE, et le plus souvent jamais du
  // premier coup : il faut aller chercher un fichier, le décoder, le
  // verser au processeur graphique. On ne conditionne donc rien à sa
  // présence — même règle que les textures, piège n°2. Quand elle tombe,
  // on la verse, on allume la case du panneau et on redessine.
  initWeather(() => {
    if (uploadWeather()) {
      document.getElementById('clk-meteo').disabled = false;
      document.getElementById('l-meteo').classList.remove('off');
      invalidate();
    }
  });
}
