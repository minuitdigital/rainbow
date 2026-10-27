// Le son. Tout en Web Audio, sans fichier. Réglages repris de
// maquette-sonore.html (POUR-ORCA §8). Muet jusqu'au premier geste : le
// navigateur l'impose.
//
//   - le souffle : bruit rose, suit la vitesse du piéton ;
//   - les six notes : un bruit blanc, six filtres, un par couleur de l'icône ;
//   - les seuils : un son court à chaque seuil franchi (POUR-ORCA §8).
//
// `initSon(level)` : `level()` rend le chiffre de la LED (0 – 1, seuil compris).

import { gait, view, centre, scale } from './view.js';
import { LEGEND_POINTS } from './sky.js';
import { terrainAt } from './ground.js';
import { angDist, DEG } from './projection.js';

const C = 299792458, OCT = Math.pow(2, 40);
const NM = [650, 600, 580, 530, 470, 410];                  // rouge … violet
const F0 = NM.map(nm => C / (nm * 1e-9) / OCT);
const CENTRE = Math.sqrt(F0[0] * F0[5]);

// Le fond (souffle et six notes) par rapport aux sons de seuil : 0,5 = 6 dB plus bas.
const FOND = 0.5;

export const reglage = { volume: 0.6, ecart: 0.6, muet: false };

// L'écart étiré autour du centre : l'ordre reste vrai, l'écart ne l'est plus.
const etire = () => 1 + 3.5 * reglage.ecart;
const freq = i => CENTRE * Math.pow(2, Math.log2(F0[i] / CENTRE) * etire());

// Le petit arc du piéton (étape 3) lira ces éclats : l'instant où chaque bande s'allume.
export const flashs = [0, 0, 0, 0, 0, 0];

let ctx = null, level = () => 0, nodes = null, blanc = null, transpo = 1;
let vitesse = 0, kLisse = 0, kPrec = 0, tEntree = -100, tPrec = 0, wake = () => {};
const niveauxArc = [0, 0, 0, 0, 0, 0];   // ce que chantent les bandes, 0 – 1

function source(buf) {
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true; src.start();
  return src;
}
function bruitBlanc() {
  const len = ctx.sampleRate * 6;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const a = buf.getChannelData(0);
  for (let i = 0; i < len; i++) a[i] = Math.random() * 2 - 1;
  return buf;
}
function bruitRose() {
  const len = ctx.sampleRate * 6;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const a = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return buf;
}
// La salle : une réverbération douce, partagée (réponse générée, 2,8 s).
function salle(duree) {
  const sr = ctx.sampleRate, len = Math.floor(sr * duree);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const a = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      lp += (Math.random() * 2 - 1 - lp) * 0.35;
      a[i] = lp * Math.pow(1 - t / duree, 2.2) * Math.exp(-t * 1.6);
    }
  }
  const cv = ctx.createConvolver();
  cv.buffer = buf;
  return cv;
}

function demarrer() {
  if (ctx) { ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain();
  master.gain.value = reglage.muet ? 0 : reglage.volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.01; comp.release.value = 0.3;
  master.connect(comp).connect(ctx.destination);

  const rev = salle(2.8);
  const revG = ctx.createGain(); revG.gain.value = 0.9;
  rev.connect(revG).connect(master);

  // Le souffle : bruit rose, filtré bas, dans la salle.
  const bs = source(bruitRose());
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.Q.value = 0.3;
  const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 2200; lp2.Q.value = 0.3;
  const sg = ctx.createGain(); sg.gain.value = 0;
  bs.connect(hp).connect(lp).connect(lp2).connect(sg);
  sg.connect(master);
  const sRev = ctx.createGain(); sRev.gain.value = 0.55;
  sg.connect(sRev).connect(rev);

  // Le prisme : six filtres sur un même bruit.
  blanc = bruitBlanc();
  const bm = source(blanc);
  const prisme = ctx.createGain();
  prisme.connect(master);
  const pRev = ctx.createGain(); pRev.gain.value = 0.6;
  prisme.connect(pRev).connect(rev);
  const bandes = F0.map((_, i) => {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq(i); bp.Q.value = 3;
    const gn = ctx.createGain(); gn.gain.value = 0;
    const pan = ctx.createStereoPanner(); pan.pan.value = -0.7 + 1.4 * i / 5;
    bm.connect(bp).connect(gn).connect(pan).connect(prisme);
    return { bp, gn, ph: Math.random() * 6.28, vit: 0.07 + Math.random() * 0.12 };
  });

  // Le bus des seuils, dans la salle.
  const eclatBus = ctx.createGain();
  eclatBus.connect(master);
  const eRev = ctx.createGain(); eRev.gain.value = 0.4;
  eclatBus.connect(eRev).connect(rev);

  nodes = { master, lp, sg, bandes, eclatBus };
  tPrec = performance.now() / 1000;
  setInterval(tick, 40);
}

// ------------------------------------------------------------ outils des sons
const F = (mult = 1) => F0.map((_, i) => freq(i) * mult * transpo);
const panDe = i => -0.7 + 1.4 * i / 5;
const allumer = (ordre, t0, pas) => ordre.forEach((i, n) => { flashs[i] = t0 + n * pas; });

function enveloppe(e, t, dur, g, att, forme) {
  e.gain.setValueAtTime(0.0001, t);
  if (forme === 'monte') {
    e.gain.exponentialRampToValueAtTime(g, t + dur * 0.85);
    e.gain.linearRampToValueAtTime(0.0001, t + dur);
  } else {
    e.gain.exponentialRampToValueAtTime(g, t + att);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
}
// Un gain qui bat de trem[0] à trem[1] Hz.
function tremolo(node, t, dur, trem) {
  const tg = ctx.createGain(); tg.gain.value = 0.55;
  const l = ctx.createOscillator();
  l.frequency.setValueAtTime(trem[0], t);
  l.frequency.linearRampToValueAtTime(trem[1], t + dur);
  const lg = ctx.createGain(); lg.gain.value = 0.45;
  l.connect(lg).connect(tg.gain);
  l.start(t); l.stop(t + dur + 0.1);
  node.connect(tg);
  return tg;
}
function souffleCourt({ t, dur, type = 'bandpass', f0, f1, Q = 1, g = 0.2, pan = 0, panVers = null, att = 0.01, forme = 'pic', trem = null }) {
  const s = ctx.createBufferSource(); s.buffer = blanc; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = Q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const e = ctx.createGain(); enveloppe(e, t, dur, g, att, forme);
  const p = ctx.createStereoPanner(); p.pan.setValueAtTime(pan, t);
  if (panVers !== null) p.pan.linearRampToValueAtTime(panVers, t + dur);
  s.connect(f).connect(e);
  (trem ? tremolo(e, t, dur, trem) : e).connect(p).connect(nodes.eclatBus);
  s.start(t, Math.random() * 5); s.stop(t + dur + 0.05);
}
function voix({ f, t, dur = 0.8, type = 'sine', g = 0.08, pan = 0, att = 0.004, ratio = 0, indice = 0, vers = null, glisse = 0.05, vib = 0, vibProf = 0.012, filtre = 0, forme = 'pic', trem = null, chemin = null, dest = null }) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (vers) o.frequency.exponentialRampToValueAtTime(vers, t + glisse);
  if (chemin) chemin.forEach(([x, d]) => o.frequency.exponentialRampToValueAtTime(x, t + d));
  let out = o;
  if (ratio) {
    const m = ctx.createOscillator(); m.type = 'sine'; m.frequency.value = f * ratio;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * indice, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, f * indice * 0.01), t + dur * 0.35);
    m.connect(mg).connect(o.frequency);
    m.start(t); m.stop(t + dur + 0.1);
  }
  if (vib) {
    const l = ctx.createOscillator(); l.frequency.value = vib;
    const lg = ctx.createGain(); lg.gain.value = f * vibProf;
    l.connect(lg).connect(o.frequency);
    l.start(t); l.stop(t + dur + 0.1);
  }
  if (filtre) {
    const lf = ctx.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = filtre;
    o.connect(lf); out = lf;
  }
  const e = ctx.createGain();
  enveloppe(e, t, dur, g, att, forme);
  const p = ctx.createStereoPanner(); p.pan.value = pan;
  out.connect(e);
  (trem ? tremolo(e, t, dur, trem) : e).connect(p).connect(dest || nodes.eclatBus);
  o.start(t); o.stop(t + dur + 0.1);
}
// Modulation en anneau : porteuse × modulante, sans composante continue.
function anneau({ t, dur, fc, fm, g = 0.1, pan = 0, att = 0.02, forme = 'pic' }) {
  const c = ctx.createOscillator(), m = ctx.createOscillator();
  const chem = (o, ch) => { o.frequency.setValueAtTime(ch[0][0], t); ch.slice(1).forEach(([f, d]) => o.frequency.exponentialRampToValueAtTime(f, t + d)); };
  chem(c, fc); chem(m, fm);
  const x = ctx.createGain(); x.gain.value = 0;
  m.connect(x.gain); c.connect(x);
  const e = ctx.createGain(); enveloppe(e, t, dur, g, att, forme);
  const p = ctx.createStereoPanner(); p.pan.value = pan;
  x.connect(e).connect(p).connect(nodes.eclatBus);
  c.start(t); m.start(t); c.stop(t + dur + 0.1); m.stop(t + dur + 0.1);
}
// Un écho de bande : la boucle s'use et la vitesse flotte.
function bande(t, temps = 0.23, retour = 0.55, duree = 4) {
  const entree = ctx.createGain();
  const d = ctx.createDelay(1); d.delayTime.value = temps;
  const fb = ctx.createGain(); fb.gain.value = retour;
  const lf = ctx.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 2400;
  const w = ctx.createOscillator(); w.frequency.value = 0.8;
  const wg = ctx.createGain(); wg.gain.value = 0.004;
  w.connect(wg).connect(d.delayTime);
  entree.connect(d); d.connect(lf).connect(fb).connect(d);
  entree.connect(nodes.eclatBus); lf.connect(nodes.eclatBus);
  w.start(t); w.stop(t + duree);
  setTimeout(() => { try { fb.gain.value = 0; entree.disconnect(); lf.disconnect(); } catch (e) { /* déjà coupé */ } }, (duree + 1) * 1000);
  return entree;
}

// ---------------------------------------------------------------- les sons
const GLISSADE = t => {
  const f = F(2);
  voix({ f: f[0], vers: f[5], glisse: 0.5, t, dur: 1.0, g: 0.1, att: 0.03, vib: 6.5 });
  voix({ f: f[0] * 2, vers: f[5] * 2, glisse: 0.5, t, dur: 0.8, g: 0.025, att: 0.03, vib: 6.5 });
  allumer([0, 1, 2, 3, 4, 5], t, 0.09);
};
const PEPIEMENT = t => {
  const f = F(2);
  [0, 0.11, 0.2].forEach((d, n) => voix({ f: f[2], vers: f[5] * 1.4, glisse: 0.045, t: t + d, dur: 0.08, g: 0.07, ratio: 2, indice: 0.15, pan: -0.3 + n * 0.3 }));
  allumer([2, 3, 5], t, 0.1);
};
const THEREMINE = t => {
  const f = F(1);
  voix({ f: f[0], chemin: [[f[5] * 1.5, 0.8], [f[2], 1.4]], t, dur: 1.7, g: 0.09, att: 0.12, vib: 5.5, vibProf: 0.03 });
  allumer([0, 1, 2, 3, 4, 5], t, 0.13);
};
const ONDES = t => {
  const f = F(2), ch = [[f[4], 0.5], [f[3], 1.1]];
  voix({ f: f[1], chemin: ch, t, dur: 1.5, type: 'triangle', g: 0.07, att: 0.08, vib: 6, vibProf: 0.015, filtre: 2600 });
  voix({ f: f[1] * 2.01, chemin: ch.map(([x, d]) => [x * 2.01, d]), t, dur: 1.5, g: 0.015, att: 0.1, vib: 6, vibProf: 0.015, pan: 0.4 });
  allumer([1, 4, 3], t, 0.5);
};
const ANNEAU = t => {
  const f = F(2);
  anneau({ t, dur: 1.5, fc: [[f[3], 0], [f[0], 1.4]], fm: [[330, 0], [95, 1.4]], g: 0.16, att: 0.03, pan: -0.3 });
  anneau({ t: t + 0.05, dur: 1.4, fc: [[f[5], 0], [f[2], 1.3]], fm: [[210, 0], [470, 1.3]], g: 0.08, att: 0.03, pan: 0.4 });
  allumer([3, 2, 1, 0], t, 0.3);
};
const BANDE_ENVERS = t => {
  const f = F(2);
  [0, 2, 5].forEach((i, n) => voix({ f: f[i], t, dur: 1.2, g: 0.06, forme: 'monte', vib: 0.6 + n * 0.3, vibProf: 0.004, pan: panDe(i) * 0.7 }));
  souffleCourt({ t, dur: 1.2, type: 'highpass', f0: 5000, f1: 7000, g: 0.03, forme: 'monte' });
  allumer([0, 2, 5], t + 0.95, 0.03);
};
const ECHO = t => {
  const f = F(2), e = bande(t);
  voix({ f: f[4], t, dur: 0.12, g: 0.12, att: 0.003, dest: e });
  voix({ f: f[1], t: t + 0.11, dur: 0.12, g: 0.1, att: 0.003, dest: e });
  for (let n = 0; n < 6; n++) flashs[n % 2 ? 1 : 4] = t + n * 0.23;
};
const SINUS = t => {
  const f = F(1);
  for (let n = 0; n < 5; n++) voix({ f: f[0] * Math.pow(5, n * 3 / 25), t: t + n * 0.22, dur: 1.9 - n * 0.15, g: 0.045, att: 0.25, pan: -0.6 + n * 0.3 });
  allumer([0, 1, 2, 3, 4], t, 0.22);
};
const BATTEMENTS = t => {
  const f = F(2);
  voix({ f: f[3], t, dur: 1.8, g: 0.07, att: 0.12, pan: -0.25 });
  voix({ f: f[3] * 1.035, chemin: [[f[3] * 1.0004, 1.4]], t, dur: 1.8, g: 0.07, att: 0.12, pan: 0.25 });
  allumer([3, 3], t, 0.6);
};
const BIPS = t => {
  const a = F(2), b = F(4);
  for (let n = 0; n < 12; n++) {
    const i = Math.floor(Math.random() * 6);
    voix({ f: (Math.random() < 0.5 ? a : b)[i], t: t + n * 0.075, dur: 0.065, g: 0.06, att: 0.002, ratio: 1.41, indice: 0.3, pan: Math.random() * 1.6 - 0.8 });
    flashs[i] = t + n * 0.075;
  }
};
const FILTRE = t => {
  souffleCourt({ t, dur: 1.4, f0: 380, f1: 3800, Q: 45, g: 1.6, att: 0.15, pan: -0.5, panVers: 0.5 });
  souffleCourt({ t: t + 0.1, dur: 1.3, f0: 570, f1: 2500, Q: 45, g: 1.1, att: 0.15, pan: 0.5, panVers: -0.3 });
  allumer([0, 1, 2, 3, 4, 5], t, 0.2);
};
const SIGNAL = t => {
  const f = F(2);
  souffleCourt({ t, dur: 1.4, f0: 1100, f1: 1500, Q: 3, g: 0.05, att: 0.1, trem: [3, 4] });
  for (let n = 0; n < 6; n++) voix({ f: f[5] * (1 - n * 0.004), t: t + 0.1 + n * 0.18, dur: 0.09, g: 0.07, att: 0.004, filtre: 1800, pan: 0.2 });
  allumer([5, 5, 5, 5, 5, 5], t + 0.1, 0.18);
};

// Les dix sons tirés au sort, dans l'ordre de la maquette (ENERGIE).
const ENERGIE = [THEREMINE, ONDES, ANNEAU, BANDE_ENVERS, ECHO, SINUS, BATTEMENTS, BIPS, FILTRE, SIGNAL];

// Les seuils : niveau et temps de garde (s) ; le son est tiré au sort, jamais le
// même que le précédent, et transposé au hasard (× 0,89 · 1 · 1 · 1,12 · 1,26).
// Glissade et Pépiement sont fixes, et ne sont pas transposés. POUR-ORCA §8.
const SEUILS = {
  entrer:   { niveau: 0.55, garde: 1.5 },
  fort:     { niveau: 1,    garde: 4, fixe: PEPIEMENT },
  sortir:   { niveau: 0.5,  garde: 1.5 },
  lieu:     { niveau: 1,    garde: 0, fixe: GLISSADE },
  cote:     { niveau: 0.4,  garde: 1.2 },
  demitour: { niveau: 0.6,  garde: 1.5 },
  vite:     { niveau: 0.5,  garde: 3 },
  arret:    { niveau: 0.6,  garde: 2 },
  bord:     { niveau: 0.6,  garde: 2 },
  tour:     { niveau: 0.8,  garde: 2 },
  tele:     { niveau: 0.9,  garde: 0 },
  arc:      { niveau: 0.9,  garde: 0 },
};
let precedent = -1;
const dernier = {};

/** Un seuil franchi. Son pas démarré, ou coupé : rien. */
export function evenement(id) {
  const sn = SEUILS[id];
  if (!sn || !nodes || reglage.muet) return;
  const t = performance.now() / 1000;
  if (dernier[id] !== undefined && t - dernier[id] < sn.garde) return;
  dernier[id] = t;
  const bus = ctx.createGain(); bus.gain.value = sn.niveau;
  bus.connect(nodes.eclatBus);
  const avant = nodes.eclatBus;
  nodes.eclatBus = bus;
  let jouer = sn.fixe;
  if (!jouer) {
    let i;
    do { i = Math.floor(Math.random() * ENERGIE.length); } while (i === precedent);
    precedent = i; jouer = ENERGIE[i];
    transpo = [0.89, 1, 1, 1.12, 1.26][Math.floor(Math.random() * 5)];
  }
  try { jouer(ctx.currentTime + 0.03); }
  finally { nodes.eclatBus = avant; transpo = 1; }
}

// ------------------------------------------------- les seuils du déplacement
const etat = { terre: null, tache: false, lon: null, marche: false, dx: 0, dy: 0, dirOk: false,
               viteT: 0, viteFait: false, fortArme: true, lieux: new Set() };

function seuils(dt, saut) {
  const [lon, lat] = centre();
  const k = level();
  const surTerre = terrainAt(lon, lat)[0] > 0.25;   // shortcut: la mer vaut 0,2 ; un degré de côte
  const dansTache = k > 0;

  if (!saut && etat.terre !== null) {
    if (surTerre !== etat.terre && vitesse > 0.05) evenement('cote');
    if (dansTache && !etat.tache) evenement('entrer');
    if (!dansTache && etat.tache) evenement('sortir');
    // L'antiméridien : un vrai passage, pas un saut de TÉLÉPORTATION.
    if (etat.lon !== null && Math.abs(lon - etat.lon) > 180 && vitesse > 0.05) evenement('tour');
  }
  etat.terre = surTerre; etat.tache = dansTache; etat.lon = lon;

  // Une tache très forte : réarmée sous 0,55.
  if (etat.fortArme && k > 0.75) { evenement('fort'); etat.fortArme = false; }
  else if (k < 0.55) etat.fortArme = true;

  // Un haut lieu : à moins de 15 px, réarmé à plus de 45 px.
  for (const l of LEGEND_POINTS) {
    const px = angDist(l.lon, l.lat, [lon, lat]) * DEG * scale() * 0.9;
    if (px < 15 && !etat.lieux.has(l)) { etat.lieux.add(l); if (!saut) evenement('lieu'); }
    else if (px > 45) etat.lieux.delete(l);
  }

  if (vitesse > 0.25) etat.marche = true;
  if (etat.marche && vitesse < 0.03) { etat.marche = false; evenement('arret'); }

  // Demi-tour : le cap lissé et le cap instantané s'opposent.
  const inst = Math.hypot(gait.dx, gait.dy);
  if (inst > 1e-7 && vitesse > 0.2 && !saut) {
    const ux = gait.dx / inst, uy = gait.dy / inst;
    if (etat.dirOk && etat.dx * ux + etat.dy * uy < -0.4) evenement('demitour');
    const a = 1 - Math.exp(-dt / 0.25);
    etat.dx += (ux - etat.dx) * a; etat.dy += (uy - etat.dy) * a;
    const n = Math.hypot(etat.dx, etat.dy) || 1;
    etat.dx /= n; etat.dy /= n; etat.dirOk = true;
  }
  if (vitesse < 0.05) etat.dirOk = false;

  // Plein gaz plus de 1,2 s.
  if (vitesse > 0.65) {
    etat.viteT += dt;
    if (etat.viteT > 1.2 && !etat.viteFait) { evenement('vite'); etat.viteFait = true; }
  } else if (vitesse < 0.45) { etat.viteT = 0; etat.viteFait = false; }
}

const lisse = (x, cible, dt, montee, descente) =>
  x + (cible - x) * (1 - Math.exp(-dt / (cible > x ? montee : descente)));

function tick() {
  if (ctx.state !== 'running') return;
  const t = performance.now() / 1000;
  const dt = Math.min(0.1, Math.max(0.001, t - tPrec)); tPrec = t;

  // `gait.speed` n'est mis à jour que quand la page se redessine : périmé = à l'arrêt.
  const brut = performance.now() - gait.at > 150 ? 0 : gait.speed / view.W / 0.8;
  const saut = brut > 3;                      // un saut (TÉLÉPORTATION), pas une marche
  const v = saut ? 0 : Math.min(1, brut);
  vitesse = lisse(vitesse, v, dt, 0.06, 0.35);
  const k = level();
  kLisse = lisse(kLisse, k, dt, 0.12, 0.12);
  // L'ouverture : elle part à l'entrée dans une tache, qu'on y reste ou non.
  if (k > 0 && kPrec === 0) tEntree = t;
  kPrec = k;
  const u = t - tEntree;
  const ouverture = u < 0.4 ? u / 0.4 : u < 1.2 ? 1 : Math.exp(-(u - 1.2) / 0.9);
  seuils(dt, saut);

  const souffle = 0.3 * vitesse * (1 - 0.75 * kLisse);
  const notes = kLisse * ouverture;
  const Q = 3 * Math.pow(400 / 3, Math.pow(kLisse, 0.6));
  const respire = 0.85 + 0.15 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1);
  const now = ctx.currentTime, nyq = ctx.sampleRate / 2;

  nodes.sg.gain.setTargetAtTime(FOND * souffle * respire, now, 0.06);
  nodes.lp.frequency.setTargetAtTime(300 + 1400 * vitesse, now, 0.08);
  nodes.bandes.forEach((b, i) => {
    const tremble = 0.8 + 0.2 * Math.sin(t * b.vit * 6.28 + b.ph);
    const comp = 0.05 / (0.577 * Math.sqrt(freq(i) / (Q * nyq)));
    b.bp.frequency.setTargetAtTime(freq(i), now, 0.05);
    b.bp.Q.setTargetAtTime(Q, now, 0.08);
    b.gn.gain.setTargetAtTime(FOND * notes * tremble * comp, now, 0.08);
    niveauxArc[i] = Math.min(1, notes * tremble * 1.4);
  });
  if (arcActive()) wake();
  nodes.master.gain.setTargetAtTime(reglage.muet ? 0 : reglage.volume, now, 0.05);
}

/** Ce que chante la bande i (0 rouge … 5 violet), pour le petit arc : la note, ou son éclat. */
export function arcLevel(i) {
  let a = niveauxArc[i];
  const df = ctx ? ctx.currentTime - flashs[i] : -1;
  if (df >= 0 && df < 1.2) a = Math.max(a, Math.exp(-df * 3));
  return Math.min(1, a);
}
export const arcActive = () => niveauxArc.some((_, i) => arcLevel(i) > 0.01);

export function initSon(levelFn, wakeFn) {
  level = levelFn;
  wake = wakeFn;
  // Muet jusqu'au premier geste. Le tableau (?pi) démarre tout de suite : son
  // Chromium est lancé sans cette exigence ; sur un PC, le geste reprend la main.
  const go = () => {
    removeEventListener('pointerdown', go, true);
    removeEventListener('keydown', go, true);
    demarrer();
  };
  addEventListener('pointerdown', go, true);
  addEventListener('keydown', go, true);
  if (new URLSearchParams(location.search).has('pi')) demarrer();
}
