// =========================================================================
//  L'ASSEMBLAGE
//
//  Le seul module qui connaisse tous les autres et touche au document :
//  il branche, il mesure, il tient la boucle d'images.
// =========================================================================

import { view, measure, centre, centreVec, coast, anchorTo, simDate, elapsedHours,
         advanceClock, stride, drift, driftChance, beliefWeights,
         beatFrame, rig, slotNow, wxOn, noteLoad } from './view.js';
import { initWeather, keepFresh } from './weather.js';
import { solar } from './sky.js';
import { scan } from './zones.js';
import { initMap, paint, uploadWeather, profileShader } from './map.js';
import { initInk, rescale, trace } from './ink.js';
import { initPanel, refreshPanel, weatherArrived, plaque } from './panel.js';
import { bind } from './chrome.js';

const glCv = document.getElementById('gl');
const inkCv = document.getElementById('ink');

// --------------------------------------------------------------- la mesure

function resize() {
  // Le piéton au milieu de la carte libre : décalé de la moitié du panneau,
  // sauf si le panneau prend tout l'écran. Avant `measure`, qui en tient compte.
  const rail = document.querySelector('.rail');
  const rw = rail && !document.body.classList.contains('bare') ? rail.offsetWidth : 0;
  view.ox = rw && rw < glCv.clientWidth * 0.6 ? -Math.round(rw / 2) : 0;
  measure(glCv.clientWidth, glCv.clientHeight);
  glSize(view.gls);
  inkCv.width = Math.round(view.W * view.dpr);
  inkCv.height = Math.round(view.H * view.dpr);
  rescale();
  invalidate();
}

/** Taille le calque du shader à la fraction k ; ne fait rien si elle y est. */
function glSize(k) {
  const w = Math.round(view.W * view.dpr * k), h = Math.round(view.H * view.dpr * k);
  if (glCv.width !== w || glCv.height !== h) { glCv.width = w; glCv.height = h; }
}

// En mouvement, le shader peut descendre à `glsMove` ; à l'arrêt, une image
// à `gls`. L'œil ne lit pas le détail d'une carte qui bouge.
const SETTLE_MS = 140;
let lastR = null, lastZoom = 0, movedAt = -1e9, wasMoving = false;

function trackMotion(now) {
  const R = view.R;
  let moved = view.zoom !== lastZoom;
  if (!moved && lastR) for (let i = 0; i < 9; i++) if (R[i] !== lastR[i]) { moved = true; break; }
  lastR = Float32Array.from(R);
  lastZoom = view.zoom;
  if (moved) movedAt = now;
  return now - movedAt < SETTLE_MS;
}

// -------------------------------------------------------- la boucle d'images
// On ne redessine que si quelque chose a changé. Une carte figée ne
// consomme rien : c'est ce qui la rend supportable sur un mur.

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

  // Le zoom glisse vers sa cible en gardant le point visé sous le curseur.
  const zooming = ease('zoom', view.zoomTarget, 16, dt, 1e-4);
  if (zooming) {
    if (view.anchor) anchorTo(view.anchor.lon, view.anchor.lat, view.anchor.px, view.anchor.py);
    if (view.zoom === view.zoomTarget) view.anchor = null;
    animating = true;
  }

  if (coast(dt)) animating = true;

  // La foulée se mesure APRÈS toutes les rotations : elle lit le
  // déplacement, elle ne le décide pas.
  const walking = stride(dt);

  // En dev, le temps accéléré exige chaque image. En météo, une seconde vaut
  // une seconde : le battement de dix secondes (plus bas) suffit.
  if (view.clock === 'dev' && view.speed > 0) animating = true;

  // La boucle continue SETTLE_MS après le mouvement, et l'image nette est
  // demandée explicitement à l'image où il cesse.
  const moving = trackMotion(now);
  if (moving && view.glsMove < view.gls) animating = true;
  if (wasMoving && !moving) dirty = true;
  wasMoving = moving;

  // Le piéton seul (il finit son pas après un glissé) ne redessine que
  // l'encre : refaire le shader pour ses jambes saccadait sur le Pi.
  const legsOnly = walking && !dirty && !animating;
  if (walking) animating = true;

  if (legsOnly) trace(centre());
  else if (dirty || animating) {
    dirty = false;
    glSize(moving ? Math.min(view.gls, view.glsMove) : view.gls);
    const when = simDate();
    const sun = solar(when);

    // Les zones sont ré-examinées quelques fois par seconde (`rig().scanMs`) ;
    // le tracé suit chaque image, les points étant rangés en géographique.
    // `centreVec` : la chance suit le piéton.
    if (now - lastScan > rig().scanMs) {
      lastScan = now;
      scan(sun, drift(), driftChance(), elapsedHours(), beliefWeights(), centreVec());
    }

    // Chronomètres JavaScript seulement : le shader travaille encore quand
    // `paint` rend la main (le temps GPU est relevé dans map.js).
    const c = centre();
    const t0 = performance.now();
    paint(glCv, sun, slotNow());
    const t1 = performance.now();
    trace(c);
    const t2 = performance.now();
    refreshPanel(sun, c, when);
    const t3 = performance.now();

    beatFrame(now, t3 - t0, t1 - t0, t2 - t1, t3 - t2);

    // Dans la boucle et non sur une minuterie : une page qui sort de veille
    // n'accumule pas de réveils. Ne fait rien pendant six heures.
    keepFresh();
  }

  if (animating) rafId = requestAnimationFrame(frame);
}

/** Le battement lent du mode météo. Entre deux, la boucle est à l'arrêt. */
setInterval(() => { if (wxOn()) invalidate(); }, 10000);

// ------------------------------------------------------------ le démarrage
// En dernier : les déclarations ci-dessus sont en zone morte temporelle
// tant que le module n'a pas fini de s'évaluer.

// La veille d'index.html attend ce drapeau : « les modules sont arrivés ».
window.__rainbow = true;

const fallback = document.getElementById('fallback');

if (!initMap(glCv, invalidate, noteLoad)) {
  fallback.innerHTML = 'Cette carte est calculée par le processeur graphique.'
                     + '<br>WebGL 2 n\'est pas disponible dans ce navigateur.';
  fallback.hidden = false;
} else {
  initInk(inkCv);
  // Le panneau avant la main : les réglages mémorisés doivent être posés
  // avant la première image. `resize` sert au changement de machine (dpr).
  initPanel(invalidate, resize, () => profileShader(glCv, solar(simDate()), slotNow()));
  bind(inkCv, invalidate);

  // La plaque, appelable par le Pi : window.plaque.maison(), .meteo(40)…
  window.plaque = plaque;
  window.addEventListener('resize', resize);
  resize();

  // Rien n'attend la météo (piège n°2) : quand elle arrive, on la verse,
  // le panneau passe en météo, on redessine.
  initWeather(() => {
    if (uploadWeather()) {
      weatherArrived();
      invalidate();
    }
  }, noteLoad);
}
