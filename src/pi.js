// Le Pi parle à la page : le service (pi/service.py) pousse chaque appui et
// chaque interrupteur par WebSocket ; la Leonardo, en manette, porte les
// rotatifs et le joystick. Actif seulement avec « ?pi » dans l'adresse.
import { plaque, hereIdx } from './panel.js';
import { nudge } from './view.js';

// Axe n de la manette = PINS[n] de arduino/leonardo/leonardo.ino.
const KNOBS = ['meteo', 'legendes', 'chance', 'contrasteTerre', 'contrasteMer',
  'irisation', 'sensibilite', 'icones', 'zoom'];
const JOY_X = 9, JOY_Y = 10;
const TEMPS = ['hier', 'maintenant', 'demain'];   // boutons 0, 1, 2
// Le nom gravé (TEXTES §9), pour le libellé en bas à gauche.
const LABEL = { meteo: 'MÉTÉO', legendes: 'LÉGENDES', chance: 'CHANCE', temps: 'HORAIRE',
  contrasteTerre: 'TERRE', contrasteMer: 'MER', irisation: 'IRISATION',
  sensibilite: 'SENSIBILITÉ', icones: 'ICÔNES', zoom: 'ZOOM',
  arcEnCiel: 'ARC-EN-CIEL', teleportation: 'TÉLÉPORTATION', repere: 'REPÈRE', maison: 'MAISON',
  couloir: 'COULOIR', couleur: 'COULEUR', interface: 'INTERFACE', formule: 'FORMULE', poeme: 'POÈME' };
const DEAD = 0.12;       // zone morte du joystick, au centre
const SPEED = 700;       // px/s, joystick en butée

export function initPi(invalidate) {
  if (!new URLSearchParams(location.search).has('pi')) return;

  const tag = document.body.appendChild(document.createElement('div'));
  tag.className = 'touche';
  let tagTimer = 0;
  const show = (k, text) => {
    tag.textContent = LABEL[k] + (text ? ' ' + text : '');
    tag.classList.add('on');
    clearTimeout(tagTimer);
    tagTimer = setTimeout(() => tag.classList.remove('on'), 1500);
  };
  const was = {};        // interrupteurs : l'état à la connexion ne s'affiche pas
  const open = () => {
    const ws = new WebSocket('ws://' + location.host + '/ws');
    ws.onmessage = e => {
      const { k, v } = JSON.parse(e.data);
      if (typeof plaque[k] !== 'function') return;
      plaque[k](v);
      if (v === undefined) show(k, '');
      else if (k in was && was[k] !== v) show(k, v ? 'ON' : 'OFF');
      was[k] = v;
    };
    ws.onclose = () => setTimeout(open, 2000);
  };
  open();

  // La LED (GPIO 18) suit l'indice sous le piéton ; le service fixe la plage.
  let led = -1;
  setInterval(() => {
    if (Math.abs(hereIdx - led) < 0.01) return;
    led = hereIdx;
    fetch('/led?' + led.toFixed(3)).catch(() => {});
  }, 250);

  const sent = {};       // dernière valeur passée à la plaque, par commande
  let last = performance.now();
  const read = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const pad = [...navigator.getGamepads()].find(x => x);
    if (pad) {
      KNOBS.forEach((k, i) => {
        const a = pad.axes[i];
        if (a === undefined) return;
        const p = (a + 1) * 50;
        // Un pas de plus de 0,7 % seulement : le bruit du convertisseur ne recalcule pas la carte.
        if (sent[k] === undefined) plaque[k](sent[k] = p);
        else if (Math.abs(p - sent[k]) > 0.7) { plaque[k](sent[k] = p); show(k, Math.round(p) + ' %'); }
      });
      const t = TEMPS.findIndex((_, i) => pad.buttons[i] && pad.buttons[i].pressed);
      if (t >= 0 && sent.temps !== t) {
        if (sent.temps !== undefined) show('temps', TEMPS[t]);
        plaque.temps(TEMPS[sent.temps = t]);
      }
      const dz = a => Math.abs(a) < DEAD ? 0 : (a - Math.sign(a) * DEAD) / (1 - DEAD);
      const x = dz(pad.axes[JOY_X] || 0), y = dz(pad.axes[JOY_Y] || 0);
      if (x || y) { nudge(-x * SPEED * dt, -y * SPEED * dt); invalidate(); }
    }
    requestAnimationFrame(read);
  };
  requestAnimationFrame(read);
}
