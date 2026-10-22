// Le Pi parle à la page : le service (pi/service.py) pousse chaque appui et
// chaque interrupteur par WebSocket ; la Leonardo, en manette, porte les
// rotatifs et le joystick. Actif seulement avec « ?pi » dans l'adresse.
import { plaque } from './panel.js';
import { nudge } from './view.js';

// Axe n de la manette = PINS[n] de arduino/leonardo/leonardo.ino.
const KNOBS = ['meteo', 'legendes', 'chance', 'contrasteTerre', 'contrasteMer',
  'irisation', 'sensibilite', 'icones', 'zoom'];
const JOY_X = 9, JOY_Y = 10;
const TEMPS = ['hier', 'maintenant', 'demain'];   // boutons 0, 1, 2
const DEAD = 0.12;       // zone morte du joystick, au centre
const SPEED = 700;       // px/s, joystick en butée

export function initPi(invalidate) {
  if (!new URLSearchParams(location.search).has('pi')) return;
  const open = () => {
    const ws = new WebSocket('ws://' + location.host + '/ws');
    ws.onmessage = e => {
      const { k, v } = JSON.parse(e.data);
      if (typeof plaque[k] === 'function') plaque[k](v);
    };
    ws.onclose = () => setTimeout(open, 2000);
  };
  open();

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
        if (sent[k] === undefined || Math.abs(p - sent[k]) > 0.7) plaque[k](sent[k] = p);
      });
      const t = TEMPS.findIndex((_, i) => pad.buttons[i] && pad.buttons[i].pressed);
      if (t >= 0 && sent.temps !== t) plaque.temps(TEMPS[sent.temps = t]);
      const dz = a => Math.abs(a) < DEAD ? 0 : (a - Math.sign(a) * DEAD) / (1 - DEAD);
      const x = dz(pad.axes[JOY_X] || 0), y = dz(pad.axes[JOY_Y] || 0);
      if (x || y) { nudge(-x * SPEED * dt, -y * SPEED * dt); invalidate(); }
    }
    requestAnimationFrame(read);
  };
  requestAnimationFrame(read);
}
