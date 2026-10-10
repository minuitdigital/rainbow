// Le Pi parle à la page : le service (pi/service.py) pousse chaque appui et
// chaque interrupteur par WebSocket. Actif seulement avec « ?pi » dans l'adresse.
import { plaque } from './panel.js';

export function initPi() {
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
}
