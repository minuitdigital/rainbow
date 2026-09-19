// =========================================================================
//  LE PANNEAU
//
//  Quatre registres dans une colonne à droite. Une boîte, une tâche :
//
//      ESTIMATEUR  montre      où l'on vise, le soleil, la présence
//      CROYANCE    règle       météo / légende / chance, somme 100 %
//      LÉGENDES    situe       les hauts lieux et ce qu'on y croit
//      RÉGLAGES    ajuste      l'allure du panneau et de la carte
//
//  Tout ce qu'il affiche décrit LE RÉTICULE — le centre exact de l'écran.
//  Le panneau ne choisit pas un lieu : il décrit celui qu'on regarde. Les
//  pastilles des hauts lieux ne sélectionnent rien, elles amènent le
//  réticule là-bas.
//
//  Les graphes empruntent leur structure aux moniteurs de débit : axe du
//  temps logarithmique, remplissage sous la courbe, étiquette de pic en
//  boîte à tige, valeur courante en chevron, graduations en bordure
//  droite. Les trois parts de la croyance sont des DENSITÉS D'ENCRE et
//  non des couleurs : elles doivent survivre au tramage de l'e-ink.
//
//  Ce fichier ne calcule rien du ciel : il lit `history.past` et le pose
//  à l'écran.
// =========================================================================

import { view, beliefWeights, anchorTo } from './view.js';
import { GAIN, SUN_MAX, openFor, nearestLegend, LEGEND_POINTS } from './sky.js';
import { past, recall, posOf, AGE_MAX } from './history.js';
import { measureRail } from './ink.js';

const byId = id => document.getElementById(id);
const root = document.documentElement;
const cssOf = n => getComputedStyle(root).getPropertyValue(n).trim();
const bound = (v, a, b) => (v < a ? a : v > b ? b : v);
const tween = (a, b, t) => a + (b - a) * t;

/** Posé par initPanel : le panneau ne connaît pas la boucle d'images. */
let repaint = () => {};

// ===================================================== LE PARTAGE DE LA CROYANCE
// Une croyance FINIE. Pousser l'une pousse physiquement les deux autres,
// au prorata de ce qu'elles valaient, et LEURS POIGNÉES BOUGENT. Une
// somme affichée qui se redistribue pendant que les curseurs restent en
// place ne se lit pas : on ne voit pas l'arbitrage, on le devine.

const SHARES = [['w-m', 'm', 'o-m'], ['w-l', 'l', 'o-l'], ['w-c', 'c', 'o-c']];

function pushBelief(key, v) {
  const b = view.belief;
  v = bound(v, 0, 100);
  const [a, c] = ['m', 'l', 'c'].filter(x => x !== key);
  const rest = 100 - v, sum = b[a] + b[c];
  if (sum <= 0.001) { b[a] = b[c] = rest / 2; }
  else { b[a] = b[a] / sum * rest; b[c] = b[c] / sum * rest; }
  b[key] = v;
  showBelief();
}

function showBelief() {
  for (const [id, key, out] of SHARES) {
    const input = byId(id), pct = Math.round(view.belief[key]);
    input.value = pct;
    input.style.setProperty('--p', pct + '%');
    byId(out).textContent = pct + ' %';
  }
  saveKnobs();
}

// ================================================================ LES PLIS
// Chaque registre se replie sur son bandeau. Au démarrage, seuls
// l'estimateur et la croyance sont ouverts : ce sont eux qu'on lit. Les
// légendes sont un index et les réglages un outil — ils s'appellent, ils
// ne s'imposent pas. Et le bandeau continue de dire l'essentiel une fois
// replié : la foi du lieu reste lisible sans déplier les vingt pastilles.

const FOLDS = [
  ['pli-est',  'corps-est',  true ],
  ['pli-croy', 'corps-croy', true ],
  ['pli-leg',  'corps-leg',  false],
  ['pli-reg',  'corps-reg',  false]
];

/** id du corps → est-il replié ? */
const folded = {};

function showFold(btnId, bodyId) {
  const body = byId(bodyId), open = !folded[bodyId];
  body.hidden = !open;
  body.closest('.box').classList.toggle('folded', !open);
  const b = byId(btnId);
  b.textContent = open ? '−' : '+';
  b.setAttribute('aria-expanded', String(open));
  b.setAttribute('aria-label', open ? 'Replier' : 'Déplier');
}

// ============================================================ LES RÉGLAGES
// Ils ne disent rien du ciel : ils disent comment on le regarde. Deux
// réglages différents décrivent le même monde — d'où la boîte à part, et
// le titre volontairement discret.

/** Le contraste déplace toute la gamme d'encres d'un coup. */
function setContrast(t) {
  const L = (lo, hi) => `hsl(213 11% ${tween(lo, hi, t).toFixed(1)}%)`;
  root.style.setProperty('--ink',       L(52, 8));
  root.style.setProperty('--ink-soft',  L(68, 40));
  root.style.setProperty('--ink-faint', L(82, 62));
  root.style.setProperty('--rule',      L(93, 74));
  root.style.setProperty('--meteo',     L(58, 22));
  root.style.setProperty('--legende',   L(76, 52));
  root.style.setProperty('--chance',    L(90, 78));
}

const KNOBS = {
  's-alpha':    { fmt: t => Math.round(t * 100) + ' %',
                  apply: t => root.style.setProperty('--alpha', tween(0.02, 0.96, t).toFixed(3)) },

  's-contrast': { fmt: t => Math.round(t * 100) + ' %', apply: setContrast },

  's-colour':   { fmt: t => (t < 0.02 ? 'gris' : Math.round(t * 100) + ' %'),
                  apply: t => { view.look.sat = tween(0, 1.8, t); repaint(); } },

  's-tache':    { fmt: t => Math.round(tween(0.3, 1.6, t) * 100) + ' %',
                  apply: t => { view.look.tache = tween(0.3, 1.6, t); repaint(); } },

  's-text':     { fmt: t => tween(9, 14, t).toFixed(0) + ' px',
                  apply: t => root.style.setProperty('--ui-pt', tween(9, 14, t).toFixed(1) + 'px') },

  's-icon':     { fmt: t => Math.round(tween(9, 28, t)) + ' px',
                  apply: t => { view.look.icon = tween(9, 28, t); repaint(); } },

  // Cinq décades, de la seconde à l'année.
  's-time':     { fmt: t => (t <= 0 ? 'figé' : '×' + Math.round(Math.pow(10, t * 5)).toLocaleString('fr-FR')),
                  apply: t => { view.speed = t <= 0 ? 0 : Math.pow(10, t * 5); repaint(); } }
};

// La case « dégradé » est un ENCODAGE, pas une teinte en moins : quand
// elle est mise, le curseur « couleur » n'a plus rien à dire.
function showGrey() {
  const on = byId('s-grey').checked;
  view.look.grey = on ? 1 : 0;
  byId('o-grey').textContent = on ? 'oui' : 'non';
  byId('s-colour').disabled = on;
  byId('l-colour').classList.toggle('off', on);
  repaint();
  saveKnobs();
}

// Sur un mur, on ne veut pas refaire ses réglages à chaque allumage. Tout
// est enveloppé : le stockage peut être refusé, et la page doit tenir sans.
// Le numéro fait partie de la clé : changer une valeur par défaut dans
// index.html ne sert à rien si la page relit l'ancienne. Quand un défaut
// bouge et qu'il doit s'imposer, on incrémente.
const STORE_KEY = 'estimateur.reglages.2';

function saveKnobs() {
  try {
    const o = { belief: view.belief, grey: byId('s-grey').checked, plis: folded };
    for (const id of Object.keys(KNOBS)) o[id] = +byId(id).value;
    localStorage.setItem(STORE_KEY, JSON.stringify(o));
  } catch (e) { /* sans mémoire, la page marche quand même */ }
}

function loadKnobs() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { /* tant pis */ }
  if (!o) return;
  for (const id of Object.keys(KNOBS))
    if (typeof o[id] === 'number') byId(id).value = bound(o[id], 0, 100);
  if (o.belief && typeof o.belief.m === 'number') Object.assign(view.belief, o.belief);
  byId('s-grey').checked = !!o.grey;
  if (o.plis) for (const [, bodyId] of FOLDS)
    if (typeof o.plis[bodyId] === 'boolean') folded[bodyId] = o.plis[bodyId];
}

// ================================================================ LE DESSIN

function fitPlot(cv) {
  const w = cv.clientWidth, h = cv.clientHeight, r = view.dpr;
  if (!w || !h) return null;
  if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) {
    cv.width = Math.round(w * r);
    cv.height = Math.round(h * r);
  }
  const g = cv.getContext('2d');
  g.setTransform(r, 0, 0, r, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

function dashAcross(g, x0, y0, x1, y1, colour, dash) {
  g.save();
  g.setLineDash(dash || [1, 3]);
  g.strokeStyle = colour;
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(x0, y0 + .5); g.lineTo(x1, y1 + .5); g.stroke();
  g.restore();
}

/** L'étiquette d'un pic : une boîte sur papier, posée au bout d'une tige. */
function peakTag(g, x, y, text, stemTo, plotW) {
  g.font = '9px ' + cssOf('--mono');
  const bw = g.measureText(text).width + 7, bh = 12;
  const bx = bound(Math.round(x - bw / 2), 1, plotW - bw - 1);
  const by = Math.round(y);
  if (stemTo != null) {
    g.strokeStyle = cssOf('--ink-faint');
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(x) + .5, by + bh);
    g.lineTo(Math.round(x) + .5, stemTo);
    g.stroke();
  }
  g.fillStyle = cssOf('--paper');
  g.fillRect(bx, by, bw, bh);
  g.strokeStyle = cssOf('--ink-faint');
  g.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);
  g.fillStyle = cssOf('--ink');
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText(text, bx + 4, by + bh / 2 + .5);
}

/** La valeur courante, contre le bord droit, pointée vers la courbe. */
function nowTag(g, w, y, text) {
  g.font = '12px ' + cssOf('--mono');
  const bw = g.measureText(text).width + 13, bh = 17, x = w - bw - 6;
  g.beginPath();
  g.moveTo(x, y - bh / 2); g.lineTo(x + bw - 6, y - bh / 2);
  g.lineTo(x + bw, y); g.lineTo(x + bw - 6, y + bh / 2);
  g.lineTo(x, y + bh / 2); g.closePath();
  g.fillStyle = cssOf('--paper'); g.fill();
  g.strokeStyle = cssOf('--ink'); g.lineWidth = 1; g.stroke();
  g.fillStyle = cssOf('--ink');
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(text, x + 6, y + 1);
}

// ------------------------------------------------------------- l'héliodon
// L'ÉCHELLE SUIT LES DONNÉES. Une compression hors fenêtre était astucieuse
// et illisible : on ne savait plus ce que valait une hauteur. L'axe est donc
// linéaire et se recadre sur ce que la courbe parcourt, en gardant toujours
// la fenêtre 0–42° dans le champ. Ce qui se passe dehors est en pointillé
// léger : ça ne compte pas, mais ça dit que le soleil est passé par là.

function drawHeliodon() {
  const fitted = fitPlot(byId('p-sun'));
  if (!fitted || !past.length) return;
  const { g, w, h } = fitted;

  const plotW = w - 30, TOP = 4, BOT = h - 11;     // 11 px pour l'axe du temps

  // Le cadre s'ouvre sur ce que la courbe parcourt, mais PAS jusqu'à la
  // nuit profonde : à une latitude moyenne le soleil descend à −50°, et
  // laisser l'échelle suivre écrasait la fenêtre 0–42° — la seule qui
  // compte — sur un tiers de la hauteur. Au-delà des bornes, la courbe
  // sort du cadre en pointillé : ça se lit « très bas », « très haut »,
  // et c'est tout ce qu'on a besoin d'en savoir.
  let lo = 0, hi = SUN_MAX;
  for (const s of past) { if (s.h < lo) lo = s.h; if (s.h > hi) hi = s.h; }
  const pad = Math.max(3, (hi - lo) * 0.07);
  lo = Math.max(lo - pad, -18);
  hi = Math.min(hi + pad, 60);
  const yOf = d => BOT - (d - lo) / (hi - lo) * (BOT - TOP);

  const y0 = yOf(0), y42 = yOf(SUN_MAX);
  g.fillStyle = 'rgba(20,22,26,0.05)';
  g.fillRect(0, y42, plotW, y0 - y42);

  for (const age of [24, 6, 1]) {
    const x = plotW * posOf(age);
    if (x > 8 && x < plotW - 8) dashAcross(g, x, TOP, x, BOT, 'rgba(20,22,26,0.07)');
  }

  const now = past[past.length - 1].t;
  const X = s => plotW * posOf(now - s.t);
  const inBand = s => s.h > 0.4 && s.h < SUN_MAX;

  g.save();
  g.setLineDash([1, 4]);
  g.strokeStyle = 'rgba(20,22,26,0.24)';
  g.lineWidth = 1;
  g.beginPath();
  past.forEach((s, i) => { const x = X(s), y = yOf(s.h); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke();
  g.restore();

  // dans la fenêtre : plein, rempli jusqu'à l'horizon
  g.save();
  g.beginPath(); g.rect(0, y42, plotW, y0 - y42); g.clip();
  let open = false;
  g.beginPath();
  for (const s of past) {
    if (inBand(s)) {
      const x = X(s), y = yOf(s.h);
      if (!open) { g.moveTo(x, y0); g.lineTo(x, y); open = true; } else g.lineTo(x, y);
    } else if (open) { g.lineTo(X(s), y0); open = false; }
  }
  if (open) g.lineTo(X(past[past.length - 1]), y0);
  g.fillStyle = 'rgba(20,22,26,0.17)';
  g.fill();
  g.restore();

  open = false;
  g.beginPath();
  for (const s of past) {
    if (inBand(s)) {
      const x = X(s), y = yOf(s.h);
      open ? g.lineTo(x, y) : (g.moveTo(x, y), open = true);
    } else open = false;
  }
  g.strokeStyle = cssOf('--ink');
  g.lineWidth = 1.3;
  g.lineJoin = 'round';
  g.stroke();

  dashAcross(g, 0, y42, plotW, y42, cssOf('--ink-faint'));
  dashAcross(g, 0, y0,  plotW, y0,  cssOf('--ink-soft'));

  // --- les ordonnées. Le pas se choisit sur la PLACE disponible et non
  // sur l'amplitude : un graphe court ne peut pas porter cinq
  // graduations, elles se chevauchent et on ne lit plus rien.
  g.font = '9px ' + cssOf('--mono');
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const rows = Math.max(2, Math.floor((BOT - TOP) / 15));
  const step = [10, 20, 30, 60, 90, 180].find(v => v >= (hi - lo) / rows) || 180;
  for (let d = Math.ceil(lo / step) * step; d <= hi; d += step) {
    const y = yOf(d);
    if (Math.abs(y - y0) < 11 || Math.abs(y - y42) < 11) continue;
    dashAcross(g, 0, y, plotW, y, 'rgba(20,22,26,0.07)');
    g.fillStyle = cssOf('--ink-faint');
    g.fillText(d + '°', plotW + 4, y);
  }
  g.fillStyle = cssOf('--ink-soft');
  g.fillText('42°', plotW + 4, y42);
  g.fillText('0°',  plotW + 4, y0);

  // --- les abscisses : sans ça, on ne sait pas que c'est un temps
  g.textBaseline = 'top';
  g.fillStyle = cssOf('--ink-faint');
  g.fillText(AGE_MAX === 24 ? '1 j' : AGE_MAX + ' h', 0, BOT + 2);
  g.textAlign = 'right';
  g.fillStyle = cssOf('--ink-soft');
  g.fillText('maintenant', plotW, BOT + 2);
}

// ------------------------------------------------------------- la présence
// Les trois croyances empilées, chacune déjà multipliée par la porte : ce
// qu'on voit monter, c'est la part de chacune dans le résultat. La somme
// est la courbe noire, et c'est elle que le chevron chiffre.

function drawPresence() {
  const fitted = fitPlot(byId('p-idx'));
  if (!fitted || !past.length) return;
  const { g, w, h } = fitted;

  const plotW = w - 30, TOP = 14, BOT = h - 16;
  const yOf = v => BOT - v * (BOT - TOP);

  dashAcross(g, 0, yOf(0.5), plotW, yOf(0.5), cssOf('--ink-faint'));
  dashAcross(g, 0, yOf(1),   plotW, yOf(1),   cssOf('--ink-faint'));
  g.strokeStyle = cssOf('--ink-soft');
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, BOT + .5); g.lineTo(plotW, BOT + .5); g.stroke();

  const now = past[past.length - 1].t;
  const X = s => plotW * posOf(now - s.t);

  // Les poids sont appliqués ICI et non à l'échantillonnage : bouger un
  // curseur repondère toute l'histoire d'un coup, sans rien recalculer.
  const wt = beliefWeights();
  let base = past.map(() => 0);
  for (const [key, wk, colour] of [['m', wt.m, cssOf('--meteo')],
                                   ['l', wt.l, cssOf('--legende')],
                                   ['c', wt.c, cssOf('--chance')]]) {
    g.beginPath();
    past.forEach((s, i) => {
      const x = X(s), y = yOf(Math.min(1, base[i] + s[key] * wk * s.gate * GAIN));
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    for (let i = past.length - 1; i >= 0; i--) g.lineTo(X(past[i]), yOf(Math.min(1, base[i])));
    g.closePath();
    g.fillStyle = colour;
    g.fill();
    base = past.map((s, i) => base[i] + s[key] * wk * s.gate * GAIN);
  }

  g.beginPath();
  past.forEach((s, i) => {
    const x = X(s), y = yOf(Math.min(1, base[i]));
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.strokeStyle = cssOf('--ink');
  g.lineWidth = 1;
  g.stroke();

  // les deux derniers pics qui valaient la peine d'être nommés
  const peaks = [];
  for (let i = 3; i < past.length - 3; i++) {
    const v = base[i];
    if (v < 0.25) continue;
    if (v >= base[i-1] && v >= base[i+1] && v > base[i-3] && v > base[i+3]) {
      if (!peaks.length || X(past[i]) - X(past[peaks[peaks.length-1]]) > 50) peaks.push(i);
    }
  }
  for (const i of peaks.slice(-2)) {
    const v = Math.min(1, base[i]);
    peakTag(g, X(past[i]), Math.max(0, yOf(v) - 16), v.toFixed(2), yOf(v), plotW);
  }

  g.font = '9px ' + cssOf('--mono');
  g.fillStyle = cssOf('--ink-faint');
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  for (const [v, t] of [[1, '1.0'], [0.5, '0.5'], [0, '0']]) g.fillText(t, plotW + 4, yOf(v));

  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const [age, t] of [[24, '1 j'], [6, '6 h'], [1, '1 h']]) {
    const x = plotW * posOf(age);
    if (x < 10 || x > plotW - 64) continue;
    g.fillStyle = cssOf('--ink-faint');
    g.fillText(t, x, BOT + 4);
    dashAcross(g, x, TOP, x, BOT, 'rgba(20,22,26,0.07)');
  }
  // Sans ce mot, personne ne devine que l'axe est un temps, ni dans quel
  // sens il coule.
  g.textAlign = 'right';
  g.fillStyle = cssOf('--ink-soft');
  g.fillText('maintenant', plotW, BOT + 4);

  const end = Math.min(1, base[base.length - 1]);
  nowTag(g, w, yOf(end), end.toFixed(2));
}

// ============================================================== LES PASTILLES
// Elles ne sélectionnent rien : elles amènent le réticule. Le sujet reste
// le centre de l'écran, toujours.

function buildChips() {
  const box = byId('chips');
  for (const l of LEGEND_POINTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = l.nom;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      anchorTo(l.lon, l.lat, view.W / 2, view.H / 2);
      repaint();
    });
    box.appendChild(b);
  }
}

// ================================================================ LA LECTURE

const HHMM = n => String(n).padStart(2, '0');

/**
 * Appelé à chaque image dessinée. `c` est le centre géographique de
 * l'écran — le réticule — et `sun` le soleil de l'instant simulé.
 */
export function refreshPanel(sun, c, now) {
  const [lon, lat] = c;
  recall(lon, lat);
  const last = past[past.length - 1];
  const wt = beliefWeights();

  byId('f-pos').textContent =
    `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'N' : 'S'}  ` +
    `${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'O'}`;
  // Date en chiffres : « 19 sept. » passait à la ligne et faisait sauter
  // la boîte d'un pixel à chaque changement de mois.
  byId('f-clock').textContent =
    `${HHMM(now.getUTCHours())}:${HHMM(now.getUTCMinutes())} UTC · ` +
    `${HHMM(now.getUTCDate())}/${HHMM(now.getUTCMonth() + 1)}`;

  // La durée restante est la SEULE valeur exacte de la page : elle ne
  // dépend que du soleil.
  const mn = last.gate > 0 ? openFor(lon, lat, sun) : null;
  const reste = mn == null ? ''
    : ' ' + (mn >= 90 ? (mn / 60).toFixed(1) + ' h' : Math.round(mn) + ' min');
  byId('h-sun').textContent = last.h.toFixed(1) + '° · ' +
    (last.gate > 0 ? 'ouverte' + reste : last.h <= 0.4 ? 'nuit' : 'trop haut');

  const idx = Math.min(1, (last.m * wt.m + last.l * wt.l + last.c * wt.c) * last.gate * GAIN);
  byId('h-idx').textContent = idx.toFixed(2);

  byId('h-leg').textContent = 'foi ' + Math.round(last.l * 100) + ' %';
  const near = nearestLegend(lon, lat);
  byId('said').textContent = near ? near.dit : 'Partout on y croit un peu — c’est le plancher.';
  const kids = byId('chips').children;
  for (let i = 0; i < kids.length; i++)
    kids[i].setAttribute('aria-pressed', String(LEGEND_POINTS[i] === near));

  drawHeliodon();
  drawPresence();
}

// ============================================================== LE DÉMARRAGE

export function initPanel(invalidate) {
  repaint = invalidate;

  // Les plis d'usine d'abord : loadKnobs n'écrase que ce qu'il connaît.
  for (const [, bodyId, openByDefault] of FOLDS) folded[bodyId] = !openByDefault;

  loadKnobs();
  buildChips();

  for (const [id, key] of SHARES.map(s => [s[0], s[1]])) {
    const input = byId(id);
    input.addEventListener('input', () => { pushBelief(key, +input.value); repaint(); });
  }
  showBelief();

  for (const [id, knob] of Object.entries(KNOBS)) {
    const input = byId(id);
    const sync = () => {
      const t = +input.value / 100;
      input.style.setProperty('--p', input.value + '%');
      byId('o-' + id.slice(2)).textContent = knob.fmt(t);
      knob.apply(t);
      saveKnobs();
    };
    input.addEventListener('input', sync);
    sync();
  }

  byId('s-grey').addEventListener('change', showGrey);
  showGrey();

  for (const [btnId, bodyId] of FOLDS) {
    showFold(btnId, bodyId);
    byId(btnId).addEventListener('click', () => {
      folded[bodyId] = !folded[bodyId];
      showFold(btnId, bodyId);
      saveKnobs();
      // Le panneau a changé de hauteur : la carte peut regagner la place
      // libérée pour y écrire des noms.
      measureRail();
      repaint();
    });
  }

  // Le contour de focus n'apparaît qu'au clavier. Chrome le dessine aussi
  // au clic sur une case à cocher, ce qui salit le panneau sans rendre
  // service à personne.
  addEventListener('keydown', e => { if (e.key === 'Tab') root.classList.add('kbd'); });
  addEventListener('pointerdown', () => root.classList.remove('kbd'));
}
