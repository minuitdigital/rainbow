// =========================================================================
//  LA MAIN
//
//  Le geste seul : glissé, molette, touches, feuille d'explication, veille.
//  Rien ne s'affiche ici (voir panel.js). Rotation libre de la sphère :
//  le point saisi reste sous le doigt, le nord ne reste pas en haut.
// =========================================================================

import { between } from './projection.js';
import {
  view, ZMAX, geoAt, relDir, anchorTo, nudge, recentre, setZoomTarget, turnFrom
} from './view.js';

const el = id => document.getElementById(id);

/** `invalidate`, fourni par main.js, dit « quelque chose a bougé ». */
export function bind(canvas, invalidate) {
  let idleTimer = 0;

  /** Au repos, le mobilier s'estompe et il ne reste que la carte. */
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 4200);
  };
  // Le panneau réveille aussi : il vit hors du canvas.
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown'])
    window.addEventListener(ev, wake, { passive: true });

  let drag = null;
  let pinch = null;
  const pointers = new Map();

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

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
    aimAt(e.clientX, e.clientY);
    setZoomTarget(view.zoomTarget * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.03 : 0.0022)));
    invalidate();
  }, { passive: false });

  canvas.addEventListener('dblclick', e => {
    e.preventDefault();
    aimAt(e.clientX, e.clientY);
    setZoomTarget(view.zoomTarget * (e.shiftKey ? 0.5 : 2));
    invalidate();
  });

  // ---- l'explication
  const sheet = el('help');
  const openHelp = () => { sheet.hidden = false; el('help-close').focus(); };
  const closeHelp = () => { sheet.hidden = true; el('help-open').focus(); };
  el('help-open').addEventListener('click', openHelp);
  el('help-close').addEventListener('click', closeHelp);
  sheet.addEventListener('click', e => { if (e.target === sheet) closeHelp(); });

  // N'IMPORTE QUELLE feuille ouverte (le panneau a la sienne) coupe le
  // clavier ; chacune se referme elle-même sur Échap.
  const anySheet = () => document.querySelector('.sheet:not([hidden])');

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !sheet.hidden) { closeHelp(); return; }
    if (anySheet()) return;

    // Une touche tapée dans un curseur du panneau appartient au curseur.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'BUTTON')) return;

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
      case '?': openHelp(); break;
      case 'f': case 'F':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
        break;
      default: hit = false;
    }
    if (!hit) return;
    e.preventDefault();
    invalidate();
  });

  wake();
}
