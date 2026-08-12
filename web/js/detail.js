/* Ficha del juego: layout, descripcion con ver mas/menos y barra de estado (tengo/quiero). */
import { renderBGG } from './bgg.js';
import { stateBadge, weightbar } from './card.js';
import { loadOwners } from './data.js';
import { LANG, typeColor, typeEs } from './domain.js';
import { renderExpansions } from './expansions.js';
import { askConfirm, overlay } from './modal.js';
import { descLimit } from './responsive.js';
import { render } from './router.js';
import { mutationsLocked } from './safemode.js';
import { BGGV, S } from './state.js';
import { $, $$, _words, api, esc, node, safeImg, toast } from './util.js';

function playersViz(g) {
  const best = new Set(g.best_players || []); const rec = new Set(g.recommended_players || []);
  const mx = Math.min(g.maxplayers || 0, 10);
  let out = '<div class="players-row">';
  for (let n = g.minplayers || 1; n <= mx; n++) {
    const cls = best.has(n) ? 'best' : rec.has(n) ? 'rec' : '';
    out += `<span class="pcount ${cls}">${best.has(n) ? '<span class="crown">👑</span>' : ''}${n}</span>`;
  }
  return out + '</div>';
}
export function openDetail(g, opts = {}) {
  const t = (g.subdomains || [])[0];
  const ageCom = g.age_community ? esc(g.age_community) : '—';
  // Cada bloque lleva data-fb: en desktop van en dos columnas (detail-side / detail-main) como
  // siempre; en celular la ficha pasa a una sola columna y estos data-fb se reordenan por CSS
  // (ver bloque móvil en styles.css) → portada, título, año/rank, tipo, descripción, specs, nombre
  // español, jugadores, idioma, diseño, categorías, mecánicas, expansiones, dueños, link BGG.
  const inner = node(`<div>
    <div class="detail-hero">
      <div class="detail-side">
        <div class="cover" data-fb="cover"><img src="${esc(safeImg(g.image))}" alt=""></div>
        ${g.es_name && g.es_name !== g.name ? `<div data-fb="esname"><div class="section-h" style="margin-top:8px">Nombre en español</div><div style="color:var(--ink);font-size:14px">${esc(g.es_name)}</div></div>` : ''}
        ${g.designers && g.designers.length ? `<div data-fb="designers"><div class="section-h" style="margin-top:8px">Diseño</div><div class="chips-line" id="desigChips">${g.designers.map(d => `<span class="tagchip click" data-d="${esc(d.name)}">🖋 ${esc(d.name)}</span>`).join('')}</div></div>` : ''}
        <div id="expSection" data-fb="expansions"></div>
        ${g.owners_owning && g.owners_owning.length ? `<div data-fb="owners"><div class="section-h">Lo tienen</div><div class="chips-line">${g.owners_owning.map(n => `<span class="tagchip">👤 ${esc(n)}</span>`).join('')}</div></div>` : ''}
        <div data-fb="bgg" style="margin-top:auto;padding-top:6px"><a href="${esc(safeImg(g.href) || '#')}" target="_blank" rel="noopener">Ver en BoardGameGeek ↗</a></div>
      </div>
      <div class="detail-main">
        <div class="detail-title" data-fb="title">${esc(g.name)}</div>
        <div class="detail-sub" data-fb="sub">${esc(g.yearpublished || '')} ${g.rank_overall ? '· Ranking BGG #' + g.rank_overall : ''} ${g.rating_avg ? '· ★ ' + (+g.rating_avg).toFixed(1) : ''}</div>
        <div class="chips-line" data-fb="tags" style="margin-top:10px">
          ${(g.subdomains || []).map(s => `<span class="type-tag" style="--c:${typeColor(s)}">${typeEs(s)}</span>`).join('')}
        </div>
        <div class="detail-desc" id="detailDesc" data-fb="desc">${esc(g.short_description || '')}</div>
        <div class="spec-grid" data-fb="specs">
          <div class="spec"><div class="k">Complejidad</div><div class="v">${weightbar(g.weight, true)} ${g.weight ? (+g.weight).toFixed(1) + '/5' : ''}</div></div>
          <div class="spec"><div class="k">Duración</div><div class="v">⏱ ${g.minplaytime || '?'}–${g.maxplaytime || '?'} min</div></div>
          <div class="spec"><div class="k">Edad · editorial</div><div class="v">${g.minage_publisher ? g.minage_publisher + '+' : '—'}</div></div>
          <div class="spec"><div class="k">Edad · comunidad</div><div class="v">${ageCom}</div></div>
        </div>
        <div data-fb="players">
          <div class="section-h">Jugadores <span style="text-transform:none;font-weight:500">(👑 mejor · <span style="color:var(--brass-2)">recomendado</span>)</span></div>
          ${playersViz(g)}
        </div>
        <div class="spec" data-fb="lang" style="margin-top:14px"><div class="k">Dependencia del idioma</div><div class="v" style="font-size:14px">${esc(LANG[g.language_dependence] || g.language_dependence || '—')}</div></div>
        ${g.categories && g.categories.length ? `<div data-fb="categories"><div class="section-h">Categorías</div><div class="chips-line">${g.categories.map(c => `<span class="tagchip">${esc(c)}</span>`).join('')}</div></div>` : ''}
        ${g.mechanics && g.mechanics.length ? `<div data-fb="mechanics"><div class="section-h">Mecánicas</div><div class="chips-line">${g.mechanics.slice(0, 12).map(c => `<span class="tagchip">${esc(c)}</span>`).join('')}</div></div>` : ''}
      </div>
    </div>
    <div class="state-bar"></div>
  </div>`);

  // click en diseñador -> filtra por ese diseñador SIN salir de la vista actual (Biblioteca,
  // Wishlist o BGG). Deshabilitado en solo lectura (advisor). Desde una ficha suelta (alta) cae
  // en Biblioteca. Como el filtro es único (S.filters), queda activo también al cambiar de tab.
  if (opts.readonly) {
    inner.querySelectorAll('#desigChips .tagchip').forEach(ch => ch.classList.remove('click'));
  } else {
    inner.querySelectorAll('#desigChips .tagchip').forEach(ch => ch.addEventListener('click', () => {
      S.filters.designer = ch.dataset.d;
      ov.remove();
      if (S.view === 'bgg') { renderBGG($('#main')); return; }
      if (S.view !== 'library' && S.view !== 'wishlist') {
        S.view = 'library';
        $$('#nav button').forEach(x => x.classList.toggle('active', x.dataset.view === 'library'));
      }
      render();
    }));
  }

  // barra de estado — en el advisor la ficha es de SOLO LECTURA (no es el lugar para editar)
  const bar = inner.querySelector('.state-bar');
  if (opts.readonly) bar.remove();
  else bar.append(stateControls(g));
  const ov = overlay(inner);
  setupDescription(inner, g);
  renderExpansions(inner, g, opts);
}

export async function setupDescription(inner, g) {
  const box = inner.querySelector('#detailDesc'); if (!box) return;
  const short = g.short_description || '';
  const limit = descLimit();
  const collapse = (text) => {
    box.innerHTML = esc(_words(text, limit));
    if ((text.split(/\s+/).length) > limit) {
      const a = node('<button class="vermas">ver más ▾</button>');
      a.onclick = () => expand(text); box.append(' '); box.append(a);
    }
  };
  const expand = (text) => {
    box.innerHTML = esc(text).replace(/\n/g, '<br>');
    const a = node('<button class="vermas">ver menos ▴</button>');
    a.onclick = () => collapse(text); box.append(' '); box.append(a);
  };
  const loadFull = async () => {
    try {
      const d = await api('/games/' + g.objectid + '/description');
      g.description = d.description || '';
      const i = S.games.findIndex(x => x.objectid === g.objectid); if (i >= 0) S.games[i].description = g.description;
    } catch {}
    return g.description || '';
  };

  // placeholder instantáneo con la corta; luego auto-cargamos la larga (lectura de DB)
  box.innerHTML = esc(short || '');
  const full = g.description || await loadFull();
  if (full) collapse(full);
  else if (!short) box.innerHTML = '<span style="color:var(--ink-dim)">Sin descripción disponible.</span>';
}

function stateControls(g) {
  // modo seguro cerrado: no se muestran los controles de estado, solo un aviso
  if (mutationsLocked()) return node(`<div class="locked-note"><span>🔒</span> Modo seguro activo. Tocá el candado de arriba para editar el estado del juego.</div>`);
  const box = node(`<div style="display:flex;flex-direction:column;gap:12px;width:100%">
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
      <div class="seg">
        <button data-s="own" class="${g.own ? 'on' : ''}"><span class="seg-ic">📦</span><span class="seg-tx">Lo tengo</span></button>
        <button data-s="wishlist" class="${g.wishlist ? 'on' : ''}"><span class="seg-ic">⭐</span><span class="seg-tx">Lo quiero</span></button>
        <button data-s="none" class="${!g.own && !g.wishlist ? 'on' : ''}"><span class="seg-ic">⛔</span><span class="seg-tx">Ninguno</span></button>
      </div>
      <div class="prio ${g.wishlist ? '' : 'hidden'}" style="display:${g.wishlist ? 'flex' : 'none'};align-items:center;gap:8px">
        <span style="color:var(--ink-dim);font-size:13px">Prioridad</span>
        <div class="stars">${[1, 2, 3, 4, 5].map(i => `<span class="s ${(6 - (g.wishlist_priority || 3)) >= i ? 'on' : ''}" data-p="${i}">★</span>`).join('')}</div>
      </div>
    </div>
  </div>`);
  async function set(patch) {
    try {
      const upd = await api(`/games/${g.objectid}/state?owner=${S.owner}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
      });
      if (upd.removed) {
        // era no-preseed y quedó huérfano al desmarcarlo -> se fue del catálogo (ítem 7)
        S.games = S.games.filter(x => x.objectid !== g.objectid);
        BGGV.games = BGGV.games.filter(x => x.objectid !== g.objectid);
        const cardEl = document.querySelector(`.card[data-oid="${g.objectid}"] .statebadge`);
        if (cardEl) cardEl.remove();
        g.own = 0; g.wishlist = 0; g.status = 'none';
        toast('Sacado de tu ludoteca');
        await loadOwners();
        return;
      }
      Object.assign(g, upd);
      // reflejar el nuevo estado en las listas en memoria
      const i = S.games.findIndex(x => x.objectid === g.objectid);
      if (i >= 0) Object.assign(S.games[i], upd);
      else if (upd.own || upd.wishlist) S.games.push(upd);   // agregado desde BGG -> entra a la colección
      const j = BGGV.games.findIndex(x => x.objectid === g.objectid);
      if (j >= 0) Object.assign(BGGV.games[j], { own: upd.own, wishlist: upd.wishlist });
      // actualizar el badge de la card sin re-render (para BGG): recrea el chip de estado
      const cardEl = document.querySelector(`.card[data-oid="${g.objectid}"]`);
      if (cardEl && S.view === 'bgg') {
        const cover = cardEl.querySelector('.cover');
        const old = cover.querySelector('.statebadge'); if (old) old.remove();
        const html = stateBadge({ own: upd.own, wishlist: upd.wishlist });
        if (html) cover.append(node(html));
      }
      toast('Guardado');
      await loadOwners();
    } catch (e) { toast('Error: ' + e.message); }
  }
  box.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', async () => {
    const s = b.dataset.s;
    // juego en PREVIEW (ítem 8): traído de BGG para mostrar la ficha, todavía NO está en la base.
    // "Ninguno" no guarda nada (si cerrás así, no queda huérfano); own/wish lo persiste con /add.
    if (g._preview) {
      box.querySelectorAll('.seg button').forEach(x => x.classList.remove('on')); b.classList.add('on');
      box.querySelector('.prio').style.display = s === 'wishlist' ? 'flex' : 'none';
      if (s === 'none') return;
      try {
        const g2 = await api('/games/add?owner=' + S.owner, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objectid: g.objectid, status: s })
        });
        delete g._preview; Object.assign(g, g2);
        const i = S.games.findIndex(x => x.objectid === g.objectid);
        if (i >= 0) Object.assign(S.games[i], g2); else S.games.push(g2);
        toast(`Agregado: ${g2.name}`);
        await loadOwners();
        if (S.view === 'library' || S.view === 'wishlist') render();
      } catch (e) { toast('Error: ' + e.message); }
      return;
    }
    // "Ninguno": si el juego es top del catálogo (preseed) sale sin más y queda en la base.
    // Si NO es preseed, quedaría huérfano y se borra de la base -> confirmamos primero (ítem 7).
    if (s === 'none' && (g.own || g.wishlist) && !g.is_top) {
      const ok = await askConfirm(`¿Sacar "${g.name}" de tu ludoteca?\n\nNo está en el top del catálogo: si ningún otro perfil lo tiene, se borra de la base y para recuperarlo vas a tener que buscarlo de nuevo.`);
      if (!ok) return;
    }
    box.querySelectorAll('.seg button').forEach(x => x.classList.remove('on')); b.classList.add('on');
    const patch = { own: s === 'own' ? 1 : 0, wishlist: s === 'wishlist' ? 1 : 0 };
    box.querySelector('.prio').style.display = s === 'wishlist' ? 'flex' : 'none';
    await set(patch);
    // en biblioteca/wishlist cambia la membresía -> re-render; en BGG el badge ya se actualizó
    if (S.view === 'library' || S.view === 'wishlist') render();
  }));
  box.querySelectorAll('.stars .s').forEach(st => st.addEventListener('click', async () => {
    const stars = +st.dataset.p; const prio = 6 - stars; // 5★ = prio1
    box.querySelectorAll('.stars .s').forEach((x, i) => x.classList.toggle('on', i < stars));
    await set({ wishlist: 1, wishlist_priority: prio });
  }));
  return box;
}
