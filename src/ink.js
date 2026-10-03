// =========================================================================
//  L'ENCRE
//
//  Le calque 2D sur la carte peinte : côtes, réticule, étiquettes, lieux.
//  Tous partagent LA LISTE D'ENCOMBREMENT, remplie par ordre de priorité :
//  réticule et panneau, étiquettes d'arc, hauts lieux, villes. Une ville
//  qui gênerait un arc disparaît, jamais l'inverse.
// =========================================================================

import { DEG, RAD, M, fy, fyp, clamp1, flatten, matT, geoVec, angDist } from './projection.js';
import { view, scale, sx, sy, gait, liveReperes, coastWidth } from './view.js';
import { zones } from './zones.js';
import { CITY, tierAt, placeLine } from './ground.js';
import { LEGEND_POINTS } from './sky.js';
import { COAST } from '../data/coast.js';

const FACE = '"Fragment Mono", ui-monospace, monospace';

let ink = null;

export function initInk(canvas) {
  ink = canvas.getContext('2d');
  return ink;
}

/**
 * L'emprise du panneau, en pixels d'écran : aucune étiquette n'y est écrite.
 * Mesurée par redimensionnement, pas par image (calcul de mise en page).
 */
let railBox = null;

/**
 * L'union des BOÎTES, pas la colonne (toujours pleine hauteur). À rappeler
 * quand un registre se plie ou se déplie.
 */
export function measureRail() {
  railBox = null;
  for (const box of document.querySelectorAll('.rail .box')) {
    const r = box.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    railBox = railBox
      ? [Math.min(railBox[0], r.left), Math.min(railBox[1], r.top),
         Math.max(railBox[2], r.right), Math.max(railBox[3], r.bottom)]
      : [r.left, r.top, r.right, r.bottom];
  }
}

/** À appeler après chaque redimensionnement : le canvas perd sa transformée. */
export function rescale() {
  ink.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  sprites.clear();
  measureRail();
}

// ---------------------------------------------------------- les côtes

/** Rayon utile autour du centre, en degrés. Dézoomé, le test coûterait plus que le tracé. */
function visibleRadius() {
  if (view.zoom < 2) return 181;
  return Math.min(181, Math.hypot(view.W / 2, view.H / 2) / scale() * 75 + 15);
}

// Niveaux de détail, éclaircis une fois au chargement : un point n'est
// gardé que s'il s'écarte du précédent d'au moins `tol` degrés. Les
// vecteurs unitaires sont précalculés au passage.
const LOD = [0, 0.04, 0.1, 0.25, 0.6];

function prepare(rings) {
  for (const ring of rings) {
    const p = ring.p, n = p.length / 2;
    ring.lod = LOD.map(tol => {
      const keep = [];
      let lx = 1e9, ly = 1e9;
      for (let i = 0; i < n; i++) {
        const lon = p[2*i], lat = p[2*i+1];
        const d = Math.max(Math.abs(lon - lx) * Math.cos(lat * DEG), Math.abs(lat - ly));
        if (i === 0 || i === n - 1 || d >= tol) { keep.push(i); lx = lon; ly = lat; }
      }
      const v = new Float32Array(keep.length * 3);
      keep.forEach((i, k) => {
        const cp = Math.cos(p[2*i+1] * DEG);
        v[3*k]   = cp * Math.cos(p[2*i] * DEG);
        v[3*k+1] = cp * Math.sin(p[2*i] * DEG);
        v[3*k+2] = Math.sin(p[2*i+1] * DEG);
      });
      return v;
    });
  }
}
prepare(COAST.coast);
prepare(COAST.lakes);

/** Le niveau le plus clair dont l'écart reste sous un demi-pixel. */
function lodFor() {
  const tol = 0.5 * RAD / (scale() * view.dpr);
  let k = 0;
  while (k + 1 < LOD.length && LOD[k + 1] <= tol) k++;
  return k;
}

function drawRings(rings, radius, centre, Rt, width, alpha) {
  ink.lineWidth = width;
  ink.strokeStyle = `rgba(20,22,26,${alpha})`;
  ink.lineJoin = 'round';
  ink.lineCap = 'round';
  ink.beginPath();

  // Equal Earth déroulée ici : `flatten` allouerait un tableau par point.
  const r0 = Rt[0], r1 = Rt[1], r2 = Rt[2], r3 = Rt[3], r4 = Rt[4],
        r5 = Rt[5], r6 = Rt[6], r7 = Rt[7], r8 = Rt[8];
  const s = scale(), cxW = view.W / 2 + view.ox, cyH = view.H / 2;
  const lod = lodFor();

  for (const ring of rings) {
    // Écartement par boîte englobante, quand elle est assez petite pour
    // que son rayon veuille dire quelque chose.
    const b = ring.b;
    if (radius < 180 && Math.max(b[1] - b[0], b[3] - b[2]) < 300) {
      const rr = Math.hypot(b[1] - b[0], b[3] - b[2]) / 2 + 1;
      if (angDist((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, centre) - rr > radius) continue;
    }

    const v = ring.lod[lod];
    let started = false, prev = 0;
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i], y = v[i+1], z = v[i+2];
      const q0 = r0*x + r3*y + r6*z;
      const q1 = r1*x + r4*y + r7*z;
      const q2 = r2*x + r5*y + r8*z;
      const lam = Math.atan2(q1, q0);
      const th = Math.asin(M * clamp1(q2));
      // Le trait passe derrière le méridien opposé : on lève le crayon.
      const deg = lam * RAD;
      if (started && Math.abs(deg - prev) > 180) started = false;
      prev = deg;
      const X = lam * Math.cos(th) / (M * fyp(th)) * s + cxW;
      const Y = -fy(th) * s + cyH;
      if (!started) { ink.moveTo(X, Y); started = true; } else ink.lineTo(X, Y);
    }
  }
  ink.stroke();
}

// ------------------------------------------------------- les étiquettes

// Arc dessiné à la main, en gris. Quatre bandes espacées : l'écart doit
// rester supérieur à l'épaisseur du trait, sinon elles se referment.
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
 * Une étiquette : chiffre et durée, phrase, lieu. Première des quatre
 * diagonales qui tient sans chevaucher ; sinon false, et elle est abandonnée.
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
    // Trop près d'une boîte occupée : on n'essaie même pas.
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


// ----------------------------------------------------- les hauts lieux
// Muets de loin, ils disent leur nom en s'approchant, puis la croyance.

const LEG_NAME_ZOOM = 2.5;
const LEG_SAY_ZOOM  = 5;

// Taille de référence du glyphe ; tout, traits compris, est mis à
// l'échelle par `view.look.icon`.
const GLYPH_PX = 15;

// Quart d'arc-en-ciel, de bas-gauche vers le haut, six bandes du dehors
// vers le dedans. Couleurs fixes : une teinte qui tourne décalerait toutes
// les bandes ensemble. Les étiquettes des taches restent en gris.
const BANDS = ['#e23b3b', '#f08a24', '#f2c53d', '#47a95f', '#3a7bd5', '#7a4cc4'];

/** Le quart d'arc de côté S, centré sur (cx, cy), dans la palette donnée. */
function rainbowGlyph(g, cx, cy, S, bands) {
  const k = S / 10, R = S, w = 1.25 * k;
  const ox = cx + R / 2, oy = cy + R / 2;       // le centre du cercle
  const A0 = Math.PI, A1 = Math.PI * 1.5;       // de la gauche vers le haut
  g.lineCap = 'butt';

  // Liseré blanc autour des bandes, prolongé aux deux bouts pour qu'ils
  // aient un bord.
  const mid = R - (bands.length - 1) * w / 2, t = 0.45 * k;
  const ext = t / mid, band = bands.length * w;
  g.strokeStyle = '#ffffff';
  g.lineWidth = band + 2 * t;
  g.beginPath(); g.arc(ox, oy, mid, A0 - ext, A1 + ext); g.stroke();

  g.lineWidth = w * 1.05;                       // pas de jour entre les bandes
  for (let i = 0; i < bands.length; i++) {
    g.strokeStyle = bands[i];
    g.beginPath(); g.arc(ox, oy, R - i * w, A0, A1); g.stroke();
  }
}

/** L'épingle : goutte renversée, rond blanc dans la tête, pointe en (tx, ty). */
function pinGlyph(g, tx, ty, k) {
  const r = 3.6 * k, h = 8.6 * k;               // rayon de la tête, pointe → centre
  const cy = ty - h, b = Math.acos(r / h);
  const drop = () => {
    g.beginPath();
    g.moveTo(tx, ty);
    g.arc(tx, cy, r, Math.PI / 2 - b, Math.PI / 2 + b, true);
    g.closePath();
  };
  g.lineJoin = 'round';
  drop();
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 2.2 * k;
  g.stroke();
  g.fillStyle = '#1d2127';
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(tx, cy, 1.35 * k, 0, 6.2832); g.fill();
}

function drawLegends(boxes, Rt) {
  const say = view.zoom >= LEG_SAY_ZOOM;
  const named = view.zoom >= LEG_NAME_ZOOM;
  const gk = view.look.icon / GLYPH_PX;       // l'encombrement suit le glyphe

  ink.textAlign = 'left';
  ink.textBaseline = 'alphabetic';

  for (const l of LEGEND_POINTS) {
    const f = flatten(Rt, l.v);
    if (Math.abs(f[2]) > 179.1) continue;
    const X = sx(f[0]), Y = sy(f[1]);
    if (X < 14 * gk || X > view.W - 14 * gk || Y < 16 * gk || Y > view.H - 10 * gk) continue;

    ink.font = `10px ${FACE}`;
    const wn = named ? ink.measureText(l.nom).width : 0;
    ink.font = `italic 9px ${FACE}`;
    const wd = say ? ink.measureText(l.dit).width : 0;

    // Sous le réticule, le glyphe passe outre l'encombrement (on ne cache
    // pas ce qu'on vise) et se décale à droite du piéton ; le nom, non.
    const aimed = Math.hypot(X - view.W / 2 - view.ox, Y - view.H / 2) < 26;

    const ox = aimed ? 16 * gk : 0;

    const tw = Math.max(wn, wd);
    const box = [X + ox - 13 * gk, Y - 12 * gk,
                 X + ox + 13 * gk + (tw ? tw + 6 : 0),
                 Y + 12 * gk + (say ? 10 : 0)];
    if (!aimed && overlaps(box, boxes)) continue;
    if (!aimed) boxes.push(box);

    rainbowGlyph(ink, X + ox, Y, view.look.icon, BANDS);

    if (!named || (aimed && overlaps(box, boxes))) continue;
    if (aimed) boxes.push(box);
    const tx = X + ox + 17 * gk;
    ink.strokeStyle = 'rgba(255,255,255,0.95)';

    ink.font = `10px ${FACE}`;
    ink.lineWidth = 4;
    ink.strokeText(l.nom, tx, Y + 3);
    ink.fillStyle = '#4b525b';
    ink.fillText(l.nom, tx, Y + 3);

    if (!say) continue;
    ink.font = `italic 9px ${FACE}`;
    ink.lineWidth = 4;
    ink.strokeText(l.dit, tx, Y + 15);
    ink.fillStyle = '#878e98';
    ink.fillText(l.dit, tx, Y + 15);
  }
}

// ---------------------------------------------------------- les villes

const MAX_PLACES = 44;

// Les étiquettes de ville sont des IMAGES : un texte cerné de blanc, tracé
// à chaque image, coûtait sur le Pi plus que tout le reste de l'encre.
// Écrites une fois, recopiées ensuite. Cache vidé si le dpr change ou si
// la police arrive après coup.
const sprites = new Map();
const SPR_X = 4, SPR_Y = 12, SPR_H = 24;

function citySprite(i) {
  let sp = sprites.get(i);
  if (sp) return sp;
  const cap = CITY.tier[i] === 0;               // une capitale : un cran plus franc
  const font = `${cap ? 10 : 9}px ${FACE}`;
  const label = CITY.name[i];
  ink.font = font;
  const tw = ink.measureText(label).width;
  const w = Math.ceil(tw + SPR_X + 12), k = view.dpr;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * k);
  cv.height = Math.ceil(SPR_H * k);
  const g = cv.getContext('2d');
  g.setTransform(k, 0, 0, k, SPR_X * k, SPR_Y * k);   // origine = le point
  g.font = font;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = 3;
  g.strokeText(label, 6, 3);
  g.fillStyle = cap ? '#5f666f' : '#858c96';
  g.fillText(label, 6, 3);
  g.fillStyle = cap ? 'rgba(20,22,26,0.70)' : 'rgba(20,22,26,0.42)';
  g.beginPath();
  g.arc(0, 0, cap ? 1.9 : 1.3, 0, 6.2832);
  g.fill();
  sp = { cv, w, tw };
  sprites.set(i, sp);
  return sp;
}
document.fonts?.addEventListener?.('loadingdone', () => sprites.clear());

function drawPlaces(boxes, Rt) {
  const top = tierAt(view.zoom);
  if (top < 0) return;

  let placed = 0;
  for (let i = 0; i < CITY.n && placed < MAX_PLACES; i++) {
    const tier = CITY.tier[i];
    if (tier > top) continue;

    const f = flatten(Rt, [CITY.vec[i*3], CITY.vec[i*3+1], CITY.vec[i*3+2]]);
    if (Math.abs(f[2]) > 179.1) continue;
    // Au pixel entier : une image recopiée entre deux pixels serait floue.
    const X = Math.round(sx(f[0])), Y = Math.round(sy(f[1]));
    if (X < 6 || X > view.W - 6 || Y < 14 || Y > view.H - 6) continue;

    const sp = citySprite(i);
    const box = [X - 5, Y - 10, X + sp.tw + 10, Y + 6];
    if (overlaps(box, boxes)) continue;
    boxes.push(box);

    ink.drawImage(sp.cv, X - SPR_X, Y - SPR_Y, sp.w, SPR_H);
    placed++;
  }
}

// ------------------------------------------------------------ le réticule
//  LE PIÉTON : un arc-en-ciel n'existe que pour quelqu'un. Même figure que
//  celle du panneau. Repère local : origine entre les pieds, y négatif
//  vers le haut, hauteur 20.

// Proportions de pictogramme : la tête vaut un cinquième de la hauteur.
const WALKER_TORSO = [[-1.9, -17.2], [2.1, -17.0], [2.5, -13.0],
                      [2.1, -9.6], [-2.2, -9.8], [-2.2, -13.4]];
const WALKER_HEAD = [0.4, -19.2, 2.1];

// LA FOULÉE. Hanche et genou. À la phase de repos (π/2), le calcul doit
// retomber sur le dessin d'index.html : les deux figures restent la même.
// Bras du même côté que la jambe voisine (lisible à quinze pixels) ; genou
// plié en envol seulement. Le pied reste au sol : la figure est relevée
// d'autant, d'où le dandinement.
const HIP      = [[-0.5, -9.7], [0.7, -9.7]];
const SHOULDER = [[-1.7, -16.2], [1.7, -16.2]];
const THIGH = 4.95, SHIN = 4.45, ARM = 5.4;
const SWING = 0.47, ARM_SWING = 0.50, KNEE = 0.72;
const GROUND = -1.3;

function walkerGait(phase) {
  const s = Math.sin(phase), c = Math.cos(phase);
  const limbs = [];

  for (let i = 0; i < 2; i++) {
    const w = i ? 1 : -1;                          // arrière, puis avant
    const [ax, ay] = SHOULDER[i], a = w * ARM_SWING * s;
    limbs.push([[ax, ay], [ax + ARM * Math.sin(a), ay + ARM * Math.cos(a)]]);
  }

  let low = -Infinity;
  for (let i = 0; i < 2; i++) {
    const w = i ? 1 : -1;
    const [hx, hy] = HIP[i];
    const t = w * SWING * s;                       // la cuisse
    const f = KNEE * Math.max(0, w * c);           // le genou, en envol
    const kx = hx + THIGH * Math.sin(t), ky = hy + THIGH * Math.cos(t);
    const fx = kx + SHIN * Math.sin(t - f), fy = ky + SHIN * Math.cos(t - f);
    if (fy > low) low = fy;
    limbs.push([[hx, hy], [kx, ky], [fx, fy]]);
  }

  return { limbs, lift: GROUND - low };
}

/** Le piéton debout sur (cx, cy), à l'échelle k. */
function drawWalker(cx, cy, k, phase) {
  const { limbs: WALKER_LIMBS, lift } = walkerGait(phase);
  const P = (x, y) => [cx + x * k, cy + (y + lift) * k];
  const X = (x, y) => P(x, y)[0], Y = (x, y) => P(x, y)[1];

  // Deux passes : halo blanc, puis encre — lisible par-dessus une tache.
  for (const pass of [0, 1]) {
    const halo = pass === 0;
    const paint = halo ? 'rgba(255,255,255,0.95)' : 'rgba(20,22,26,0.78)';
    ink.lineCap = 'round';
    ink.lineJoin = 'round';
    ink.strokeStyle = paint;
    ink.fillStyle = paint;

    for (const limb of WALKER_LIMBS) {
      ink.lineWidth = (limb.length > 2 ? 2.6 : 2.0) * k + (halo ? 2.0 * k : 0);
      ink.beginPath();
      limb.forEach(([x, y], i) => (i ? ink.lineTo(X(x, y), Y(x, y))
                                     : ink.moveTo(X(x, y), Y(x, y))));
      ink.stroke();
    }

    ink.beginPath();
    WALKER_TORSO.forEach(([x, y], i) => (i ? ink.lineTo(X(x, y), Y(x, y))
                                           : ink.moveTo(X(x, y), Y(x, y))));
    ink.closePath();
    if (halo) { ink.lineWidth = 2.0 * k; ink.stroke(); }
    ink.fill();

    ink.beginPath();
    ink.arc(X(WALKER_HEAD[0], WALKER_HEAD[1]), Y(WALKER_HEAD[0], WALKER_HEAD[1]),
            (WALKER_HEAD[2] + (halo ? 0.9 : 0)) * k, 0, 6.2832);
    ink.fill();
  }
}

// ---------------------------------------------------------- les repères
// Une étoile surmontée d'une épingle, taille d'un haut lieu, sous le piéton.

/** L'étoile à cinq branches de diamètre S, centrée sur (cx, cy), à l'encre. */
function starGlyph(g, cx, cy, S) {
  const ro = S / 2, ri = ro * 0.42;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro, a = -Math.PI / 2 + i * Math.PI / 5;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = Math.max(2, S * 0.14);
  g.stroke();
  g.fillStyle = '#1d2127';
  g.fill();
}

function drawReperes(Rt) {
  const S = view.look.icon, k = S / 10;
  for (const r of liveReperes()) {
    const f = flatten(Rt, geoVec(r.lon, r.lat));
    if (Math.abs(f[2]) > 179.1) continue;
    const X = sx(f[0]), Y = sy(f[1]);
    if (X < -30 || X > view.W + 30 || Y < -30 || Y > view.H + 30) continue;
    starGlyph(ink, X, Y, S);
    // la pointe de l'épingle sur la branche du haut, plus le halo
    pinGlyph(ink, X, Y - S / 2 - 0.8 * k, k * 0.8);
  }
}

/** Le piéton, par rapport à la taille commune des icônes. */
const WALKER_SCALE = 1.25;

/** Du sommet de la tête au sol, en unités de la figure. */
const WALKER_H = -(WALKER_HEAD[1] - WALKER_HEAD[2]);

// LA FLÈCHE tourne autour du piéton et dit où l'on va, au cap de
// `gait.angle`. Absente avant le premier pas ; garde ensuite le dernier cap.
function drawArrow(cx, cy, S) {
  if (!gait.moved) return;
  // gait.angle est le cap de la TÊTE, opposé au déplacement : (−sin, cos).
  const a = gait.angle, ux = -Math.sin(a), uy = Math.cos(a);
  const ox = cx, oy = cy - S / 2;               // le milieu de la figure
  const r = S * 0.85, L = S * 0.32, W = S * 0.22;
  const tx = ox + ux * (r + L / 2), ty = oy + uy * (r + L / 2);
  const bx = ox + ux * (r - L / 2), by = oy + uy * (r - L / 2);
  ink.beginPath();
  ink.moveTo(tx, ty);
  ink.lineTo(bx - uy * W, by + ux * W);
  ink.lineTo(bx + uy * W, by - ux * W);
  ink.closePath();
  ink.lineJoin = 'round';
  ink.strokeStyle = 'rgba(255,255,255,0.95)';
  ink.lineWidth = Math.max(2, S * 0.12);
  ink.stroke();
  ink.fillStyle = 'rgba(20,22,26,0.78)';
  ink.fill();
}

function drawReticle(cx, cy) {
  const k = view.look.icon / GLYPH_PX;

  // Un point, sans croix : il marque l'endroit exact sans occuper de direction.
  ink.beginPath();
  ink.arc(cx, cy, 2.4 * k, 0, 6.2832);
  ink.strokeStyle = 'rgba(255,255,255,0.95)';
  ink.lineWidth = 2 * k;
  ink.stroke();
  // Encre par défaut ; une teinte franche le garde visible sur une tache
  // irisée, qui passe par tous les gris.
  const d = view.look.dot;
  ink.fillStyle = d <= 0.02 ? 'rgba(20,22,26,0.92)'
                            : `hsl(${Math.round(d * 360)} 78% 44%)`;
  ink.fill();

  // Le piéton fait un quart de plus que les autres icônes ; sa flèche le suit.
  const S = view.look.icon * WALKER_SCALE;
  drawWalker(cx, cy, S / WALKER_H, gait.phase);
  drawArrow(cx, cy, S);
}

// --------------------------------------------------------------- la passe

export function trace(centre) {
  const { W, H } = view;
  ink.clearRect(0, 0, W, H);

  // Les coupures de l'admin, une par poste — pour savoir lequel coûte.
  const cut = view.cut;
  if (cut.ink) return;

  const Rt = matT(view.R);
  if (view.coasts === 'encre') {
    const lw = coastWidth();
    const radius = visibleRadius();
    drawRings(COAST.coast, radius, centre, Rt, lw, 0.92);
    drawRings(COAST.lakes, radius, centre, Rt, lw * 0.8, 0.5);
  }

  // Le repère SOUS le piéton : tracé d'abord, le piéton se tient dessus.
  drawReperes(Rt);

  const cx = W / 2 + view.ox, cy = H / 2;
  drawReticle(cx, cy);

  // Emprise du réticule : un carré centré, la flèche pouvant tourner tout autour.
  const rk = view.look.icon / GLYPH_PX;
  const boxes = [
    [cx - 24 * rk, cy - 24 * rk, cx + 24 * rk, cy + 24 * rk]
  ];
  if (railBox) boxes.push(railBox);               // le panneau
  if (!cut.callouts) drawCallouts(boxes, Rt);
  drawLegends(boxes, Rt);
  if (!cut.places) drawPlaces(boxes, Rt);
}
