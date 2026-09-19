// =========================================================================
//  LE MOBILIER
//
//  Tout ce qui n'est pas la carte : la lecture contre le réticule, le
//  partage de la croyance, l'échelle, l'explication, et la main posée
//  dessus.
//
//  La navigation est une ROTATION LIBRE DE LA SPHÈRE, façon boule de
//  commande : le point saisi reste sous le doigt, partout, y compris aux
//  pôles. Aucune singularité, aucune butée. Le nord ne reste pas en haut —
//  c'est assumé, c'est le comportement d'un globe, pas d'un plan.
//
//  Les flèches du clavier déplacent par pas depuis le centre : c'est déjà
//  le geste du futur mini-joystick du tableau, où l'e-ink interdira tout
//  glissement fluide.
// =========================================================================

import { between } from './projection.js';
import {
  view, ZMAX, geoAt, relDir, anchorTo, nudge, recentre, setZoomTarget,
  turnFrom, simDate, drift, driftChance, beliefWeights
} from './view.js';
import { sunElev, rainbowIndex, SUN_MAX } from './sky.js';

const el = id => document.getElementById(id);

// ------------------------------------------------------------- la lecture

export function readout(sun, centre) {
  const now = simDate();
  const [lon, lat] = centre;

  el('r-lat').textContent = `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'N' : 'S'}`;
  el('r-lon').textContent = `${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'O'}`;

  const h = sunElev(lon, lat, sun);
  el('r-sun').textContent = `${h.toFixed(1)}°`;

  // L'indice était vide presque tout le temps sans jamais dire pourquoi.
  // Il dit maintenant ce qui ferme la porte.
  const idx = el('r-idx');
  idx.classList.remove('hot', 'mute');
  if (h <= 0.4) {
    idx.textContent = 'nuit';
    idx.classList.add('mute');
  } else if (h >= SUN_MAX) {
    idx.textContent = 'trop haut';
    idx.classList.add('mute');
  } else {
    const v = rainbowIndex(lon, lat, sun, drift(), driftChance(), beliefWeights());
    idx.textContent = v.toFixed(2);
    if (v > 0.6) idx.classList.add('hot');
  }

  el('r-time').textContent =
    `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')} UTC`;
  el('r-date').textContent =
    now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  el('r-speed').textContent = view.speed < 1
    ? 'figé'
    : '×' + Math.round(view.speed).toLocaleString('fr-FR');
  el('r-simtime').textContent = now.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC'
  });
}

// ------------------------------------------------------------- l'échelle
// Peinte avec la formule même du shader. Une légende écrite à la main
// finit toujours par mentir : l'ancienne montrait un dégradé monotone
// violet→rouge, alors que la teinte de la carte est CYCLIQUE — une
// palette d'interférence — et que ce qui code la force est l'intensité.

function paintRamp() {
  const cv = el('ramp');
  const g = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  const img = g.createImageData(w, h);

  for (let x = 0; x < w; x++) {
    const t = x / (w - 1);
    const field = Math.pow(t, 1.15) * 0.98;
    const k = t * 1.35;                        // le même parcours que le shader
    const c = [0, 2.0944, 4.1888].map(p => 0.5 + 0.5 * Math.cos(6.28318 * k + p));
    const grey = (c[0] + c[1] + c[2]) / 3;
    for (let i = 0; i < 3; i++) {
      const sat = grey + (c[i] - grey) * 1.50;
      const hue = Math.max(0, Math.min(1, 0.10 + 0.90 * sat));
      // sur le papier, la tache teinte au lieu d'éclairer : multiplication
      c[i] = Math.round(255 * (1 - field + field * hue));
    }
    for (let y = 0; y < h; y++) {
      const o = (y * w + x) * 4;
      img.data[o] = c[0]; img.data[o+1] = c[1]; img.data[o+2] = c[2];
      img.data[o+3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

// ------------------------------------------------- le partage de la croyance

function showShares() {
  const w = beliefWeights();
  el('p-m').textContent = Math.round(w.m * 100) + ' %';
  el('p-l').textContent = Math.round(w.l * 100) + ' %';
  el('p-c').textContent = Math.round(w.c * 100) + ' %';
}

// ------------------------------------------------------------ la main
// `invalidate` est passé par main.js : le mobilier ne connaît pas la
// boucle d'images, il se contente de dire « quelque chose a bougé ».

export function bind(canvas, invalidate) {
  let idleTimer = 0;
  /** Au repos, l'interface s'estompe. Il ne reste que la carte. */
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 4200);
  };

  let drag = null;
  let pinch = null;
  const pointers = new Map();

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    wake();

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y),
        z: view.zoom,
        geo: geoAt((a.x + b.x) / 2, (a.y + b.y) / 2)
      };
      drag = null;
    } else {
      const p = relDir(e.clientX, e.clientY);
      drag = { R0: view.R.slice(), p0: p, pPrev: p, t: performance.now() };
      view.dragging = true;
      view.spin.rate = 0;
      canvas.classList.add('dragging');
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      view.zoom = view.zoomTarget =
        Math.max(1, Math.min(ZMAX, pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)));
      if (pinch.geo) anchorTo(pinch.geo[0], pinch.geo[1], mx, my);
      invalidate();
      return;
    }
    if (!drag || !drag.p0) return;

    const pNow = relDir(e.clientX, e.clientY);
    if (!pNow) return;
    turnFrom(drag.R0, between(pNow, drag.p0));

    // Vitesse angulaire du dernier fragment de geste, pour l'élan.
    const now = performance.now();
    const dt = Math.max(8, now - drag.t) / 1000;
    const inc = between(pNow, drag.pPrev);
    if (inc) {
      const ax = [inc[5] - inc[7], inc[6] - inc[2], inc[1] - inc[3]];
      const s = Math.hypot(...ax) / 2, c = (inc[0] + inc[4] + inc[8] - 1) / 2;
      if (s > 1e-7) {
        view.spin.axis = ax.map(v => v / (2 * s));
        view.spin.rate = view.spin.rate * 0.55 + (Math.atan2(s, c) / dt) * 0.45;
      }
    }
    drag.pPrev = pNow;
    drag.t = now;
    invalidate();
  });

  const release = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0 && drag) {
      drag = null;
      view.dragging = false;
      canvas.classList.remove('dragging');
      invalidate();
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  /** Le zoom vise le curseur : c'est le point pointé qui reste immobile. */
  const aimAt = (px, py) => {
    const g = geoAt(px, py);
    if (g) view.anchor = { lon: g[0], lat: g[1], px, py };
  };

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    wake();
    aimAt(e.clientX, e.clientY);
    setZoomTarget(view.zoomTarget * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.03 : 0.0022)));
    invalidate();
  }, { passive: false });

  canvas.addEventListener('dblclick', e => {
    e.preventDefault();
    wake();
    aimAt(e.clientX, e.clientY);
    setZoomTarget(view.zoomTarget * (e.shiftKey ? 0.5 : 2));
    invalidate();
  });

  // ---- l'explication
  const sheet = el('help');
  const openHelp = () => { sheet.hidden = false; el('help-close').focus(); };
  const closeHelp = () => { sheet.hidden = true; el('help-open').focus(); };
  el('help-open').addEventListener('click', () => { wake(); openHelp(); });
  el('help-close').addEventListener('click', closeHelp);
  sheet.addEventListener('click', e => { if (e.target === sheet) closeHelp(); });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !sheet.hidden) { closeHelp(); return; }
    if (!sheet.hidden) return;                 // la feuille ouverte, le globe dort

    const s = 90;
    let hit = true;
    switch (e.key) {
      case 'ArrowLeft':  nudge( s, 0); break;
      case 'ArrowRight': nudge(-s, 0); break;
      case 'ArrowUp':    nudge(0,  s); break;
      case 'ArrowDown':  nudge(0, -s); break;
      case '+': case '=': view.anchor = null; setZoomTarget(view.zoomTarget * 1.3); break;
      case '-': case '_': view.anchor = null; setZoomTarget(view.zoomTarget / 1.3); break;
      case '0': recentre(); break;
      case 'r': case 'R': view.modeTarget = view.modeTarget > 0.5 ? 0 : 1; break;
      case '?': openHelp(); break;
      case 'f': case 'F':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
        break;
      default: hit = false;
    }
    if (!hit) return;
    e.preventDefault();
    wake();
    invalidate();
  });

  // ---- le partage de la croyance
  // Les poignées ne bougent pas toutes seules : chacune dit combien on
  // tient à sa raison. C'est le POURCENTAGE affiché qui se redistribue,
  // et c'est là que l'arbitrage se voit.
  for (const [id, key] of [['w-m', 'm'], ['w-l', 'l'], ['w-c', 'c']]) {
    const input = el(id);
    input.value = view.belief[key];
    input.addEventListener('input', () => {
      wake();
      view.belief[key] = +input.value;
      showShares();
      invalidate();
    });
  }
  showShares();

  // ---- le curseur de vitesse
  // Échelle logarithmique sur cinq décades — de la seconde à l'année.
  const spd = el('spd');
  const applySpeed = () => {
    const v = +spd.value;
    view.speed = v <= 0 ? 0 : Math.pow(10, (v / 100) * 5);
    invalidate();
  };
  spd.addEventListener('input', () => { wake(); applySpeed(); });
  applySpeed();

  paintRamp();
  wake();
}
