// =========================================================================
//  L'ENCRE
//
//  Le calque 2D, posé par-dessus la carte peinte : les traits de côte, le
//  réticule, les étiquettes d'arc et les noms de lieux.
//
//  Les quatre tracés tiennent dans un seul fichier parce qu'ils partagent
//  une seule chose, et qu'elle est le cœur du calque : LA LISTE
//  D'ENCOMBREMENT. Une liste de rectangles déjà pris, remplie dans un
//  ordre qui est une hiérarchie —
//
//      1. les coins où vit l'interface, interdits d'emblée
//      2. les étiquettes d'arc
//      3. les noms de lieux, dans ce qui reste
//
//  Une ville qui gênerait un arc disparaît, jamais l'inverse : c'est le
//  ciel le sujet, pas la géographie.
// =========================================================================

import { DEG, flatten, matT, geoVec, angDist } from './projection.js';
import { view, scale, sx, sy } from './view.js';
import { zones } from './zones.js';
import { CITY, tierAt, placeLine } from './ground.js';
import { COAST } from '../data/coast.js';

const FACE = '"Fragment Mono", ui-monospace, monospace';

let ink = null;

export function initInk(canvas) {
  ink = canvas.getContext('2d');
  return ink;
}

/** À appeler après chaque redimensionnement : le canvas perd sa transformée. */
export function rescale() {
  ink.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
}

// ---------------------------------------------------------- les côtes

/**
 * Jusqu'où regarder autour du centre, en degrés. Dézoomé, on prend tout :
 * le test coûterait plus cher que le tracé.
 */
function visibleRadius() {
  if (view.zoom < 2) return 181;
  return Math.min(181, Math.hypot(view.W / 2, view.H / 2) / scale() * 75 + 15);
}

function drawRings(rings, radius, centre, Rt, width, alpha) {
  ink.lineWidth = width;
  ink.strokeStyle = `rgba(20,22,26,${alpha})`;
  ink.lineJoin = 'round';
  ink.lineCap = 'round';
  ink.beginPath();

  for (const ring of rings) {
    // Écartement grossier par boîte englobante, quand la boîte est assez
    // petite pour que son rayon veuille dire quelque chose.
    const b = ring.b;
    if (radius < 180 && Math.max(b[1] - b[0], b[3] - b[2]) < 300) {
      const rr = Math.hypot(b[1] - b[0], b[3] - b[2]) / 2 + 1;
      if (angDist((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, centre) - rr > radius) continue;
    }

    const p = ring.p;
    let started = false, prev = 0;
    for (let i = 0; i < p.length; i += 2) {
      const cp = Math.cos(p[i+1] * DEG);
      const f = flatten(Rt, [cp * Math.cos(p[i] * DEG), cp * Math.sin(p[i] * DEG),
                             Math.sin(p[i+1] * DEG)]);
      // Le trait passe derrière le méridien opposé : on lève le crayon.
      if (started && Math.abs(f[2] - prev) > 180) started = false;
      prev = f[2];
      const X = sx(f[0]), Y = sy(f[1]);
      if (!started) { ink.moveTo(X, Y); started = true; } else ink.lineTo(X, Y);
    }
  }
  ink.stroke();
}

// ------------------------------------------------------- les étiquettes

// Un arc dessiné à la main plutôt qu'un emoji : contraste franc sur le
// papier, et il survivra au tramage de l'e-ink là où un emoji couleur
// ferait un pâté. Quatre bandes largement espacées — à cette taille, cinq
// arcs serrés se referment en pâté noir. L'écart doit rester supérieur à
// l'épaisseur du trait.
const ARC = ['#14171c', '#474e57', '#7a818b', '#adb4be'];
const GLYPH = 24;
const MAX_CALLOUTS = 8;

function arcGlyph(cx, by) {
  ink.lineCap = 'butt';
  ink.strokeStyle = 'rgba(255,255,255,0.95)';
  ink.lineWidth = 13;
  ink.beginPath(); ink.arc(cx, by, 5.8, Math.PI, 0); ink.stroke();
  ink.lineWidth = 1.25;
  for (let i = 0; i < ARC.length; i++) {
    ink.strokeStyle = ARC[i];
    ink.beginPath();
    ink.arc(cx, by, 9.4 - i * 2.5, Math.PI, 0);
    ink.stroke();
  }
}

const overlaps = (box, boxes) => {
  for (const b of boxes)
    if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) return true;
  return false;
};

/**
 * Une étiquette : le chiffre et la durée, la phrase, le lieu. On essaie
 * les quatre diagonales et on prend la première qui tient sans chevaucher.
 * Rend false si aucune ne tient — l'étiquette est alors abandonnée, pas
 * empilée sur une autre.
 */
function drawCallout(x, y, l1, l2, l3, alpha, boxes) {
  ink.font = `12px ${FACE}`;
  const t1 = ink.measureText(l1).width;
  ink.font = `italic 10px ${FACE}`;
  const w2 = ink.measureText(l2).width;
  ink.font = `9px ${FACE}`;
  const w3 = l3 ? ink.measureText(l3).width : 0;

  const tw = Math.max(t1 + GLYPH, w2, w3), LEAD = 17, BAR = Math.max(62, tw + 8);
  const TOP = l3 ? 46 : 34;        // la ligne de lieu pousse la boîte d'un cran

  let dx = 1, dy = -1, ok = false;
  for (const [cx, cy] of [[1,-1], [-1,-1], [1,1], [-1,1]]) {
    const ex = x + cx * LEAD, bx = ex + cx * BAR, by = y + cy * LEAD;
    const box = [Math.min(ex, bx) - 4, by - TOP, Math.max(ex, bx) + 4, by + 6];
    if (box[0] < 6 || box[2] > view.W - 6 || box[1] < 6 || box[3] > view.H - 6) continue;
    if (overlaps(box, boxes)) continue;
    dx = cx; dy = cy; boxes.push(box); ok = true; break;
  }
  if (!ok) return false;

  const ex = x + dx * LEAD, ey = y + dy * LEAD, bx = ex + dx * BAR;
  ink.globalAlpha = alpha;

  ink.lineCap = 'butt';
  ink.strokeStyle = 'rgba(20,22,26,0.78)';
  ink.lineWidth = 1;
  ink.beginPath();
  ink.moveTo(x + dx * 4, y + dy * 4);
  ink.lineTo(ex, ey);
  ink.lineTo(bx, ey);
  ink.stroke();

  ink.fillStyle = 'rgba(14,17,22,0.95)';
  ink.beginPath(); ink.arc(x, y, 2.1, 0, 6.2832); ink.fill();

  ink.textBaseline = 'alphabetic';
  ink.lineJoin = 'round';
  const tx = ex + dx * 3;
  const y1 = ey - (l3 ? 30 : 18), y2 = ey - (l3 ? 18 : 6), y3 = ey - 6;

  // Un halo blanc : le texte doit rester lisible par-dessus une tache.
  const halo = (txt, px, py) => {
    ink.strokeStyle = 'rgba(255,255,255,0.95)';
    ink.lineWidth = 4;
    ink.strokeText(txt, px, py);
  };

  ink.font = `12px ${FACE}`;
  ink.textAlign = dx > 0 ? 'left' : 'right';
  arcGlyph(dx > 0 ? tx + 11 : tx - t1 - 12, y1);
  const lx = dx > 0 ? tx + GLYPH : tx;
  halo(l1, lx, y1);
  ink.fillStyle = '#0d1015';
  ink.fillText(l1, lx, y1);

  ink.font = `italic 10px ${FACE}`;
  halo(l2, tx, y2);
  ink.fillStyle = '#565d66';
  ink.fillText(l2, tx, y2);

  if (l3) {
    ink.font = `9px ${FACE}`;
    halo(l3, tx, y3);
    ink.fillStyle = '#8c939d';
    ink.fillText(l3, tx, y3);
  }

  ink.globalAlpha = 1;
  return true;
}

function drawCallouts(boxes, Rt) {
  const all = [];
  for (const z of zones)
    for (const pt of z.pts) {
      if (pt.on < 0.05 || !pt.est) continue;
      const f = flatten(Rt, geoVec(pt.lon, pt.lat));
      if (Math.abs(f[2]) > 179.1) continue;         // derrière la coupure
      const X = sx(f[0]), Y = sy(f[1]);
      if (X < -40 || X > view.W + 40 || Y < -40 || Y > view.H + 40) continue;
      all.push({ X, Y, a: z.a * pt.on, e: pt.est, ph: pt.phrase,
                 lon: pt.lon, lat: pt.lat });
    }
  all.sort((a, b) => b.e.v - a.e.v);

  let n = 0;
  for (const c of all) {
    if (n >= MAX_CALLOUTS) break;
    // Trop près d'un coin occupé : on n'essaie même pas.
    let near = false;
    for (const b of boxes) {
      const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      if (Math.hypot(cx - c.X, cy - c.Y) < 96) { near = true; break; }
    }
    if (near) continue;

    const pct = Math.round(c.e.v * 100) + ' %';
    const dur = c.e.min == null ? ''
      : c.e.min >= 90 ? '  ·  ' + Math.round(c.e.min / 60 * 10) / 10 + ' h'
      : '  ·  ' + Math.round(c.e.min) + ' min';

    if (drawCallout(c.X, c.Y, pct + dur, c.ph,
                    placeLine(c.lon, c.lat, view.zoom), c.a, boxes)) n++;
  }
}

// ---------------------------------------------------------- les lieux

const MAX_PLACES = 44;

function drawPlaces(boxes, Rt) {
  const top = tierAt(view.zoom);
  if (top < 0) return;

  ink.textAlign = 'left';
  ink.textBaseline = 'alphabetic';
  ink.lineJoin = 'round';

  let placed = 0;
  for (let i = 0; i < CITY.n && placed < MAX_PLACES; i++) {
    const tier = CITY.tier[i];
    if (tier > top) continue;

    const f = flatten(Rt, [CITY.vec[i*3], CITY.vec[i*3+1], CITY.vec[i*3+2]]);
    if (Math.abs(f[2]) > 179.1) continue;
    const X = sx(f[0]), Y = sy(f[1]);
    if (X < 6 || X > view.W - 6 || Y < 14 || Y > view.H - 6) continue;

    const cap = tier === 0;                       // une capitale : un cran plus franc
    ink.font = `${cap ? 10 : 9}px ${FACE}`;
    const label = CITY.name[i];
    const box = [X - 5, Y - 10, X + ink.measureText(label).width + 10, Y + 6];
    if (overlaps(box, boxes)) continue;
    boxes.push(box);

    ink.strokeStyle = 'rgba(255,255,255,0.92)';
    ink.lineWidth = 3;
    ink.strokeText(label, X + 6, Y + 3);
    ink.fillStyle = cap ? '#5f666f' : '#858c96';
    ink.fillText(label, X + 6, Y + 3);

    ink.fillStyle = cap ? 'rgba(20,22,26,0.70)' : 'rgba(20,22,26,0.42)';
    ink.beginPath();
    ink.arc(X, Y, cap ? 1.9 : 1.3, 0, 6.2832);
    ink.fill();

    placed++;
  }
}

// ------------------------------------------------------------ le réticule

function drawReticle(cx, cy) {
  const g = 7, a = 17;
  ink.strokeStyle = 'rgba(20,22,26,0.45)';
  ink.lineWidth = 1;
  ink.beginPath();
  ink.moveTo(cx - a, cy); ink.lineTo(cx - g, cy);
  ink.moveTo(cx + g, cy); ink.lineTo(cx + a, cy);
  ink.moveTo(cx, cy - a); ink.lineTo(cx, cy - g);
  ink.moveTo(cx, cy + g); ink.lineTo(cx, cy + a);
  ink.stroke();
}

// --------------------------------------------------------------- la passe

export function trace(centre) {
  const { W, H } = view;
  ink.clearRect(0, 0, W, H);

  const Rt = matT(view.R);
  const lw = Math.max(0.55, Math.min(1.5, 0.55 + Math.log2(view.zoom) * 0.24));
  const radius = visibleRadius();
  drawRings(COAST.coast, radius, centre, Rt, lw, 0.92);
  drawRings(COAST.lakes, radius, centre, Rt, lw * 0.8, 0.5);

  const cx = W / 2, cy = H / 2;
  drawReticle(cx, cy);

  const boxes = [
    [0, 0, 300, 74],                              // le titre
    [0, H - 96, 176, H],                          // la lecture
    [W - 336, H - 116, W, H],                     // la légende
    [W / 2 - 134, H - 62, W / 2 + 134, H],        // le curseur
    [cx - 26, cy - 26, cx + 26, cy + 26]          // le réticule
  ];
  drawCallouts(boxes, Rt);
  drawPlaces(boxes, Rt);
}
