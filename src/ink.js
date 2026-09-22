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
//      3. les hauts lieux de la croyance
//      4. les noms de villes, dans ce qui reste
//
//  Une ville qui gênerait un arc disparaît, jamais l'inverse : c'est le
//  ciel le sujet, pas la géographie.
// =========================================================================

import { DEG, flatten, matT, geoVec, angDist } from './projection.js';
import { view, scale, sx, sy, gait } from './view.js';
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
 * L'emprise du panneau, en pixels d'écran. Les étiquettes ne s'y écrivent
 * pas : une ville imprimée derrière une boîte semi-transparente est du
 * bruit, et elle occupe une place qu'une ville visible aurait prise.
 * Mesurée une fois par redimensionnement — pas par image, pour ne pas
 * forcer un calcul de mise en page à chaque tour.
 */
let railBox = null;

/**
 * L'union des BOÎTES et non la colonne : la colonne fait toute la hauteur
 * de l'écran, même quand les registres sont repliés. À rappeler quand un
 * registre se plie ou se déplie — la carte récupère alors la place.
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
  measureRail();
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


// ----------------------------------------------------- les hauts lieux
// Un petit arc et une baguette : ici, on y croit. Dessinés à la main en
// gris, comme le glyphe des étiquettes — un emoji couleur deviendrait un
// pâté au tramage de l'e-ink, et ces points-là doivent survivre au
// tableau.
//
// Muets de loin, ils disent leur nom en s'approchant, puis la croyance
// elle-même. Même logique de paliers que les villes : ce qui mérite
// d'être lu dépend de la distance à laquelle on se tient.

const LEG_NAME_ZOOM = 2.5;
const LEG_SAY_ZOOM  = 5;

// Le glyphe est dessiné à sa taille de référence, quinze pixels, puis
// mis à l'échelle par `view.look.icon`. Tout est proportionnel, épaisseurs
// de trait comprises : sur un mur, la même page se regarde d'un mètre ou
// de dix, et un glyphe de quinze pixels ne survit pas aux deux.
const GLYPH_PX = 15;

function wandGlyph(cx, cy) {
  const k = view.look.icon / GLYPH_PX;
  const arcX = cx - 3 * k, arcY = cy + 5 * k;

  // deux passes : le halo blanc d'abord, l'encre ensuite. Le trait doit
  // tenir par-dessus une tache irisée.
  for (const pass of [0, 1]) {
    ink.lineCap = 'round';
    ink.lineJoin = 'round';

    if (pass === 0) {
      ink.strokeStyle = 'rgba(255,255,255,0.95)';
      ink.lineWidth = 3.4 * k;
    }

    // l'arc, trois bandes espacées de 2 px pour 1,1 px de trait
    for (let i = 0; i < 3; i++) {
      if (pass === 1) {
        ink.strokeStyle = ARC[i];
        ink.lineWidth = 1.1 * k;
      }
      ink.beginPath();
      ink.arc(arcX, arcY, (7 - i * 2) * k, Math.PI, 0);
      ink.stroke();
    }

    // la baguette, penchée, et son étincelle à quatre branches
    if (pass === 1) { ink.strokeStyle = ARC[1]; ink.lineWidth = 1.1 * k; }
    ink.beginPath();
    ink.moveTo(cx + 4 * k, cy + 7 * k);
    ink.lineTo(cx + 10 * k, cy - 4 * k);
    ink.stroke();

    if (pass === 1) { ink.strokeStyle = ARC[0]; ink.lineWidth = k; }
    const sx0 = cx + 11 * k, sy0 = cy - 6 * k, b = 3 * k;
    ink.beginPath();
    ink.moveTo(sx0 - b, sy0); ink.lineTo(sx0 + b, sy0);
    ink.moveTo(sx0, sy0 - b); ink.lineTo(sx0, sy0 + b);
    ink.stroke();
  }
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

    // Le haut lieu que l'on vise ne doit jamais être celui qu'on cache :
    // sous le réticule, le glyphe passe outre l'encombrement. Son nom,
    // lui, reste soumis à la règle commune.
    const aimed = Math.hypot(X - view.W / 2, Y - view.H / 2) < 26;

    // Visé, le glyphe est exactement là où se tient le piéton : il passe
    // donc à sa droite. Un décalage de quinze pixels ment moins que deux
    // dessins superposés — et le nom suit le glyphe.
    const ox = aimed ? 16 * gk : 0;

    const tw = Math.max(wn, wd);
    const box = [X + ox - 13 * gk, Y - 12 * gk,
                 X + ox + 13 * gk + (tw ? tw + 6 : 0),
                 Y + 12 * gk + (say ? 10 : 0)];
    if (!aimed && overlaps(box, boxes)) continue;
    if (!aimed) boxes.push(box);

    wandGlyph(X + ox, Y);

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
//
//  LE PIÉTON. Le point visé n'est pas une coordonnée, c'est un endroit où
//  quelqu'un se tiendrait : un arc-en-ciel n'existe pas *à un endroit*, il
//  existe *pour quelqu'un*. La silhouette dit « c'est nous », et c'est la
//  même figure que celle du panneau, à la ligne « Position ».
//
//  Elle se tient SUR le point, pieds au sol : le repère local a son
//  origine entre les pieds, y vers le haut négatif, hauteur 20.
//
//  Dessinée au trait plein et non en emoji : un emoji couleur devient un
//  pâté au tramage de l'e-ink, et sa forme dépend du système.

// Proportions de pictogramme et non de bonhomme : la tête vaut un
// cinquième de la hauteur, pas un quart. Au-delà, le halo l'épaissit
// encore et la figure devient un poupon.
const WALKER_TORSO = [[-1.9, -17.2], [2.1, -17.0], [2.5, -13.0],
                      [2.1, -9.6], [-2.2, -9.8], [-2.2, -13.4]];
const WALKER_HEAD = [0.4, -19.2, 2.1];

// LA FOULÉE. Les membres ne sont plus des coordonnées mais deux
// articulations : une hanche, un genou. À la phase de repos (π/2) le
// calcul retombe à un dixième de pixel près sur le dessin d'index.html —
// c'est voulu, la figure du panneau ne marche pas et les deux doivent
// rester la même.
//
// Les bras s'ouvrent DU MÊME CÔTÉ que la jambe voisine, ce qu'aucun
// marcheur ne fait. À quinze pixels, des bras en contre-balancement se
// croisent devant le torse et la figure devient un pâté ; l'écart
// symétrique se lit d'un coup d'œil. C'est un pictogramme, pas une
// planche d'anatomie.
//
// Le genou ne plie qu'en phase d'envol — quand la jambe part en avant.
// Une jambe qui plie en poussant donne une démarche d'ivrogne.
//
// LE PIED RESTE AU SOL, et c'est de là que vient le balancement : jambes
// écartées, la figure est plus courte ; jambes jointes, elle est plus
// haute d'une unité. Plutôt que de laisser le pied s'enfoncer sous le
// point visé — le contraire de ce que la silhouette est là pour dire —
// on relève toute la figure de ce qu'il faut. Le dandinement n'est donc
// pas un effet ajouté : c'est la conséquence du contact.
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

/**
 * `angle` fait pivoter TOUTE la figure autour de (cx, cy) — le point visé,
 * qui est aussi le sol sous ses pieds. Le repère local est donc tourné
 * d'un bloc : membres, torse et tête gardent leurs proportions, seule
 * l'orientation change.
 */
function drawWalker(cx, cy, k, phase, angle) {
  const { limbs: WALKER_LIMBS, lift } = walkerGait(phase);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const P = (x, y) => {
    const u = x * k, v = (y + lift) * k;
    return [cx + u * ca - v * sa, cy + u * sa + v * ca];
  };
  const X = (x, y) => P(x, y)[0], Y = (x, y) => P(x, y)[1];

  // deux passes : le halo blanc d'abord, l'encre ensuite. La figure doit
  // tenir par-dessus une tache irisée — c'est là qu'elle sert le plus.
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

function drawReticle(cx, cy) {
  const k = view.look.icon / GLYPH_PX;

  // UN POINT, plus une croix. Les bras marquaient le point exact parce
  // que la silhouette se tenait toujours au-dessus ; maintenant qu'elle
  // pivote tout autour, ils lui passeraient au travers. Un point noir dit
  // la même chose sans occuper de direction — et il reste vrai quel que
  // soit l'angle.
  ink.beginPath();
  ink.arc(cx, cy, 2.4 * k, 0, 6.2832);
  ink.strokeStyle = 'rgba(255,255,255,0.95)';
  ink.lineWidth = 2 * k;
  ink.stroke();
  // Encre par défaut — c'est ce qui partira sur l'e-ink, où il n'y aura
  // pas de teinte. Au-delà, une couleur franche : sur l'écran d'atelier
  // c'est le seul moyen de garder le point visible par-dessus une tache
  // irisée, qui prend toutes les valeurs de gris à tour de rôle.
  const d = view.look.dot;
  ink.fillStyle = d <= 0.02 ? 'rgba(20,22,26,0.92)'
                            : `hsl(${Math.round(d * 360)} 78% 44%)`;
  ink.fill();

  drawWalker(cx, cy, k, gait.phase, gait.angle);
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

  // L'emprise du réticule est devenue un CARRÉ centré : la figure pivote
  // tout autour du point, elle peut donc se tenir dans n'importe quelle
  // direction. Une boîte plus haute que large ne décrirait plus qu'un cas
  // sur quatre.
  const rk = view.look.icon / GLYPH_PX;
  const boxes = [
    [cx - 24 * rk, cy - 24 * rk, cx + 24 * rk, cy + 24 * rk]
  ];
  if (railBox) boxes.push(railBox);               // le panneau
  drawCallouts(boxes, Rt);
  drawLegends(boxes, Rt);
  drawPlaces(boxes, Rt);
}
