/* Router: pinta la vista activa dentro de #main. */
import { renderAdvisor } from './advisor.js';
import { renderBGG } from './bgg.js';
import { renderCollection } from './collection.js';
import { renderPanel } from './panel.js';
import { S } from './state.js';
import { $ } from './util.js';

/* ================= router ================= */
export function render() {
  const m = $('#main'); m.innerHTML = '';
  if (S.view === 'library') m.append(renderCollection('own'));
  else if (S.view === 'wishlist') m.append(renderCollection('wishlist'));
  else if (S.view === 'bgg') renderBGG(m);
  else if (S.view === 'panel') renderPanel(m);
  else if (S.view === 'advisor') renderAdvisor(m);
}
