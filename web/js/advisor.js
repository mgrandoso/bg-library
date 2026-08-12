/* Advisor: formulario por ocasion, motor (determinístico / agente) y resultados. */
import { weightbar } from './card.js';
import { openDetail } from './detail.js';
import { typeColor, typeEs } from './domain.js';
import { askName } from './modal.js';
import { isMobile } from './responsive.js';
import { refreshSavedCount, savedBar, savedTitle } from './saved.js';
import { S } from './state.js';
import { $, api, clampText, esc, node, safeImg, toast } from './util.js';

/* ================= ADVISOR ================= */
export const OCCASIONS = {
  couple: { ic: '🍷', t: 'Noche de pareja', d: 'Para dos', preset: { players: 2, vibe: 'medium', coop: 'any' } },
  family: { ic: '👨‍👩‍👧', t: 'Familia con chicos', d: 'Con los más chicos', preset: { min_age: 8, vibe: 'light', language_ok: 'light' } },
  party: { ic: '🎉', t: 'Fiesta', d: 'Mucha gente', preset: { players: 6, vibe: 'light', time: 'short', theme: 'fiesta' } },
  friends: { ic: '🍻', t: 'Con amigos', d: 'Junta informal', preset: { players: 4, vibe: 'medium' } },
  elders: { ic: '👵', t: 'Gente grande', d: 'No jugones', preset: { vibe: 'light', language_ok: 'light', experience: 'new' } },
  serious: { ic: '🧠', t: 'Algo en serio', d: 'Con ganas de pensar', preset: { vibe: 'heavy', time: 'long', experience: 'gamers' } },
  kidadult: { ic: '🧒', t: 'Grandes y chicos', d: 'Un adulto con chicos', preset: { players: 2, min_age: 6, vibe: 'light', language_ok: 'light' } },
  newbies: { ic: '🌱', t: 'Recién empiezan', d: 'Nunca jugaron / no jugones', preset: { vibe: 'light', time: 'short', experience: 'new', language_ok: 'light' } },
};
const PLAY_Q = [
  { k: 'players', type: 'step', q: '¿Cuántos van a jugar?', min: 1, max: 10 },
  { k: 'min_age', type: 'opt', q: 'El más chico, ¿qué edad?', opts: [['sin', 'Sin chicos', 99], ['6', '~6', 6], ['8', '~8', 8], ['10', '~10', 10], ['12', '12+', 12]] },
  { k: 'time', type: 'opt', q: '¿Cuánto rato tienen?', opts: [['short', 'Un rato (~30′)', 'short'], ['hour', 'Una hora', 'hour'], ['long', 'La tarde entera', 'long'], ['any', 'No importa', 'any']] },
  { k: 'vibe', type: 'opt', multi: true, q: '¿Con qué ganas vienen? (podés elegir varias)', opts: [['light', '😄 Reírse y charlar', 'light'], ['medium', '🎯 Enganchar sin quemarse', 'medium'], ['heavy', '🧠 Pensar en serio', 'heavy']] },
  { k: 'coop', type: 'opt', q: '¿Compiten o se unen?', opts: [['comp', '⚔ Competir', 'competitive'], ['coop', '🤝 Unirse contra el juego', 'coop'], ['any', 'Da igual', 'any']] },
  { k: 'experience', type: 'opt', q: '¿Cuánta calle tienen?', opts: [['new', 'Todos nuevos', 'new'], ['some', 'Alguno con experiencia', 'some'], ['gamers', 'Grupo jugón', 'gamers']] },
  { k: 'language_ok', type: 'opt', q: '¿Importa el idioma / texto?', opts: [['none', 'Sin texto', 'none'], ['light', 'Mejor poco texto', 'light'], ['any', 'No importa', 'any']] },
];
const BUY_Q = [
  { k: 'audience', type: 'opt', q: '¿Para quién es principalmente?', opts: [['group', 'Mi grupo habitual', 'group'], ['family', 'Familia con chicos', 'family'], ['couple', 'Para dos', 'couple'], ['party', 'Fiestas', 'party'], ['gift', 'Un regalo', 'gift']] },
  { k: 'usual_players', type: 'step', q: '¿Con cuánta gente jugás normalmente?', min: 1, max: 10 },
  { k: 'want_more', type: 'opt', multi: true, q: '¿Qué te gustaría sumar? (podés elegir varias)', opts: [['s', '♟ Más estrategia', 'Strategy Games'], ['p', '🎉 Más party', 'Party Games'], ['f', '👨‍👩‍👧 Más familiar', 'Family Games'], ['t', '🐉 Más temático', 'Thematic Games'], ['c', '🤝 Cooperativos', 'coop'], ['a', '🔷 Abstractos', 'Abstract Games']] },
  { k: 'vibe', type: 'opt', q: '¿Qué complejidad buscás?', opts: [['light', 'Livianos que salgan siempre', 'light'], ['medium', 'Medios', 'medium'], ['heavy', 'El juegazo de la tarde', 'heavy']] },
  { k: 'safe_or_niche', type: 'opt', q: '¿Gemas seguras o nicho?', opts: [['safe', '💎 Gemas seguras', 'safe'], ['niche', '🔍 Descubrir nicho', 'niche']] },
];

export const ADV = { mode: 'play', occasion: null, answers: {}, engine: 'rules', freetext: '', engineTouched: false,
  loading: false, result: null, reqId: 0, _loader: null };

export function renderAdvisor(m) {
  ADV.answers = ADV.answers || {};
  // si Gemini está configurado, arrancá en modo Agente (salvo que el usuario ya haya elegido)
  if (S.geminiReady && !ADV.engineTouched) ADV.engine = 'agent';
  const v = node('<div class="view advisor-wrap"></div>');

  // switch de modo (los botones son el título)
  const ms = node('<div class="mode-switch"></div>');
  ms.append(mkModeCard('play', '🎲', '¿Qué saco hoy?', 'De lo que ya tenés'));
  ms.append(mkModeCard('buy', '🛒', '¿Qué compro?', 'De tu wishlist, según tu colección'));
  v.append(ms);
  v.append(savedBar());

  const body = node('<div id="advBody"></div>');
  v.append(body);
  m.innerHTML = ''; m.append(v);
  renderAdvBody();
}
function mkModeCard(mode, ic, t, d) {
  const c = node(`<button class="mode-card ${ADV.mode === mode ? 'on' : ''}"><div class="ic">${ic}</div><h3>${t}</h3><p>${d}</p></button>`);
  c.addEventListener('click', () => { advReset(); ADV.mode = mode; ADV.occasion = null; ADV.answers = {}; renderAdvisor($('#main')); });
  return c;
}

function renderAdvBody() {
  const b = $('#advBody'); b.innerHTML = '';
  // modo play arranca por ocasión
  if (ADV.mode === 'play' && !ADV.occasion) {
    b.append(node('<div class="section-h" style="text-align:center">Elegí la ocasión</div>'));
    const grid = node('<div class="occasion-grid"></div>');
    Object.entries(OCCASIONS).forEach(([k, o]) => {
      const el = node(`<button class="occ"><div class="ic">${o.ic}</div><div class="t">${o.t}</div><div class="d">${o.d}</div></button>`);
      el.addEventListener('click', () => { ADV.occasion = k; ADV.answers = { ...o.preset }; renderAdvBody(); });
      grid.append(el);
    });
    b.append(grid);
    const skip = node('<div style="text-align:center;margin-top:16px"><button class="btn ghost">o respondé sin elegir ocasión →</button></div>');
    skip.querySelector('button').addEventListener('click', () => { ADV.occasion = 'libre'; ADV.answers = {}; renderAdvBody(); });
    b.append(skip);
    return;
  }

  const form = node('<div id="advForm"></div>');
  // chip de la ocasión elegida (modo play), con opción de cambiarla
  if (ADV.mode === 'play' && ADV.occasion) {
    const o = OCCASIONS[ADV.occasion];
    const chip = node(`<div class="occ-chip"><span class="occ-chip-l">${o ? `${o.ic} <b>${esc(o.t)}</b>` : 'Sin ocasión — respondiendo libre'}</span><button class="occ-change">${o ? '↺ cambiar ocasión' : '＋ elegir ocasión'}</button></div>`);
    chip.querySelector('.occ-change').addEventListener('click', () => { advReset(); ADV.occasion = null; ADV.answers = {}; renderAdvBody(); });
    form.append(chip);
  }
  const qs = ADV.mode === 'play' ? PLAY_Q : BUY_Q;
  qs.forEach(q => form.append(renderQ(q)));
  form.append(engineSwitch());
  const go = node(`<button class="btn primary block" style="margin-top:6px">✨ Recomendame ${ADV.mode === 'buy' ? 'qué comprar' : 'qué jugar'}</button>`);
  go.addEventListener('click', runAdvisor);
  form.append(go);
  b.append(form);
  b.append(node('<div id="advResults"></div>'));

  // reanudar: si hay una búsqueda en curso o un resultado, mostrarlo (persiste al navegar)
  if (ADV.loading) showAdvLoading();
  else if (ADV.result && ADV.result.error) {
    form.style.display = 'none';
    const res = $('#advResults'); res.innerHTML = `<div class="empty">Error: ${esc(ADV.result.error)}</div>`; res.append(backButton());
  } else if (ADV.result) renderResults(ADV.result);
}

function renderQ(q) {
  const wrap = node(`<div class="q"><div class="qh">${q.q}</div></div>`);
  if (q.type === 'step') {
    const val = ADV.answers[q.k] || 0;
    const s = node(`<div class="stepper"><button aria-label="menos">−</button><span class="val">${val || '·'}</span><button aria-label="más">+</button></div>`);
    const [minus, plus] = s.querySelectorAll('button'); const disp = s.querySelector('.val');
    minus.addEventListener('click', () => { ADV.answers[q.k] = Math.max(q.min, (ADV.answers[q.k] || q.min) - 1); disp.textContent = ADV.answers[q.k]; });
    plus.addEventListener('click', () => { ADV.answers[q.k] = Math.min(q.max, (ADV.answers[q.k] || q.min - 1) + 1); disp.textContent = ADV.answers[q.k]; });
    wrap.append(s);
  } else {
    const opts = node('<div class="opts"></div>');
    const multi = !!q.multi;
    if (multi && !Array.isArray(ADV.answers[q.k]))    // normaliza escalar de preset -> lista
      ADV.answers[q.k] = ADV.answers[q.k] == null ? [] : [ADV.answers[q.k]];
    q.opts.forEach(([id, label, val]) => {
      const on = multi ? ADV.answers[q.k].includes(val)
                       : JSON.stringify(ADV.answers[q.k]) === JSON.stringify(val);
      const o = node(`<button class="opt ${on ? 'on' : ''}">${label}</button>`);
      o.addEventListener('click', () => {
        if (multi) {
          const arr = ADV.answers[q.k], i = arr.indexOf(val);
          if (i >= 0) arr.splice(i, 1); else arr.push(val);
          o.classList.toggle('on');
        } else {
          ADV.answers[q.k] = val;
          opts.querySelectorAll('.opt').forEach(x => x.classList.remove('on')); o.classList.add('on');
        }
      });
      opts.append(o);
    });
    wrap.append(opts);
  }
  return wrap;
}

function engineSwitch() {
  if (!S.geminiReady && ADV.engine === 'agent') ADV.engine = 'rules';   // sin Gemini, no hay agente
  const agentAttr = S.geminiReady ? '' : 'disabled title="Configurá tu API key de Gemini en ⚙ para activar el agente"';
  const box = node(`<div class="engine-switch">
    <span style="font-weight:600">Motor:</span>
    <div class="seg">
      <button data-e="rules" class="${ADV.engine === 'rules' ? 'on' : ''}">⚙ Determinístico</button>
      <button data-e="agent" class="${ADV.engine === 'agent' ? 'on' : ''}" ${agentAttr}>🤖 Agente</button>
    </div>
    <span style="color:var(--ink-dim);font-size:12.5px" id="engHint"></span>
    <div class="freetext ${ADV.engine === 'agent' ? '' : 'disabled'}" >
      <textarea id="advFree" placeholder="Contame algo más con tus palabras: preferencias del grupo, mecánicas, juegos similares que les gusten, etc.… ej: 'Somos 3 adultos y mi vieja se aburre rápido, solemos jugar juegos con dados'">${esc(ADV.freetext)}</textarea>
    </div>
  </div>`);
  const hint = box.querySelector('#engHint');
  const setHint = () => {
    if (!S.geminiReady) hint.innerHTML = 'Activá el agente con IA cargando tu API key de Gemini (gratis) en <b>⚙</b>.';
    else hint.textContent = ADV.engine === 'agent' ? `Razona sobre ${shortlistSize(poolTotal())} candidatos de tu colección.` : 'Puntuación transparente sobre los datos.';
  };
  setHint();
  box.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    ADV.engine = b.dataset.e; ADV.engineTouched = true;
    box.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
    box.querySelector('.freetext').classList.toggle('disabled', ADV.engine !== 'agent');
    setHint();
  }));
  box.querySelector('#advFree').addEventListener('input', e => ADV.freetext = e.target.value);
  return box;
}

// Secuencia de frases (5 s c/u → ~25 s). Si tarda más, itera AGENT_TAIL.
const AGENT_SEQ = [
  'Buscando las mejores sugerencias, bancame un minuto 🎲',  // 0–5 s
  'Barajando los candidatos de tu colección…',               // 5–10 s
  'Viendo qué encaja mejor con tu grupo…',                   // 10–15 s
  'Ya casi está…',                                           // 15–20 s
  'Afinando la recomendación…',                              // 20–25 s
];
const AGENT_TAIL = ['Dame unos segundos más…', 'Afinando la recomendación…'];
const AGENT_STEP_MS = 5000;   // cada frase 5s (la secuencia cubre ~25s, luego alterna la cola)
const AGENT_MIN_MS = 25000;   // mínimo 25s (= 5 frases × 5s); si el modelo tarda más, se sigue esperando

// cuántos candidatos ve el agente: ~15% del pool, tier más cercano de [15..50], tope 50 (espeja el backend)
const SHORTLIST_TIERS = [15, 20, 25, 30, 35, 40, 45, 50];
function shortlistSize(total) {
  if (total <= 15) return Math.max(1, total);
  const t = 0.15 * total;
  return Math.min(SHORTLIST_TIERS.reduce((a, b) => Math.abs(b - t) < Math.abs(a - t) ? b : a), 50);
}
function poolTotal() { return S.games.filter(g => ADV.mode === 'buy' ? g.wishlist : g.own).length; }

function agentLoader() {
  const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const el = node(`<div class="agent-loading"><div class="dice-roll"><span>⚀</span><span>⚄</span></div><div class="agent-msg">${AGENT_SEQ[0]}</div><div class="agent-sub">El agente analiza ${shortlistSize(poolTotal())} candidatos de tu colección</div></div>`);
  const dice = el.querySelectorAll('.dice-roll span'); const msg = el.querySelector('.agent-msg');
  let fi = 0, step = 0;
  const t1 = setInterval(() => { fi++; dice[0].textContent = faces[fi % 6]; dice[1].textContent = faces[(fi + 3) % 6]; }, 130);
  const t2 = setInterval(() => {
    step++;
    msg.textContent = step < AGENT_SEQ.length
      ? AGENT_SEQ[step]
      : AGENT_TAIL[(step - AGENT_SEQ.length) % 2];
  }, AGENT_STEP_MS);
  el._stop = () => { clearInterval(t1); clearInterval(t2); };
  return el;
}

function stopAdvLoader() { if (ADV._loader) { ADV._loader._stop(); ADV._loader = null; } }

// Muestra el loader/spinner en #advResults (si estás en la vista advisor). Idempotente.
function showAdvLoading() {
  const res = $('#advResults'); if (!res) return;
  const form = $('#advForm'); if (form) form.style.display = 'none';
  stopAdvLoader();
  if (ADV.engine === 'agent') { res.innerHTML = ''; ADV._loader = agentLoader(); res.append(ADV._loader); }
  else { res.innerHTML = '<div style="text-align:center;padding:30px 0"><div class="spinner"></div></div>'; }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function runAdvisor() {
  const myId = ++ADV.reqId;             // cada búsqueda tiene su id; la última manda
  ADV.loading = true; ADV.result = null;
  showAdvLoading();
  const started = performance.now();
  const answers = { ...ADV.answers };
  if (ADV.engine === 'agent' && ADV.freetext.trim()) answers.texto_libre = ADV.freetext.trim();
  try {
    const out = await api('/advisor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: ADV.mode, engine: ADV.engine, answers, owner: S.owner, limit: 5 })
    });
    if (myId !== ADV.reqId) return;     // otra búsqueda la reemplazó
    const totalS = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`[advisor] click→respuesta: ${totalS}s | motor: ${out.engine}` +
      (out.elapsed_ms ? ` | gemini: ${(out.elapsed_ms / 1000).toFixed(1)}s` : ''));
    // mínimo de animación SOLO si el agente realmente respondió (si cayó al determinístico, mostrar ya)
    const fromGemini = out.engine && String(out.engine).startsWith('gemini');
    if (fromGemini) {
      const left = AGENT_MIN_MS - (performance.now() - started);
      if (left > 0) await new Promise(r => setTimeout(r, left));
      if (myId !== ADV.reqId) return;
    }
    ADV.loading = false; ADV.result = out; stopAdvLoader();
    if (S.view === 'advisor') renderResults(out);   // si navegaste, queda guardado para cuando vuelvas
  } catch (e) {
    if (myId !== ADV.reqId) return;
    ADV.loading = false; ADV.result = { error: e.message }; stopAdvLoader();
    if (S.view === 'advisor') {
      const res = $('#advResults'); if (res) { res.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; res.append(backButton()); }
    }
  }
}

export function advReset() {                    // volver al formulario, descartar resultado en curso
  ADV.reqId++; ADV.loading = false; ADV.result = null; stopAdvLoader();
}

function backButton() {
  const b = node('<div style="text-align:center;margin-top:8px"><button class="btn ghost">↩ Volver a buscar</button></div>');
  b.querySelector('button').addEventListener('click', () => {
    advReset();
    const form = $('#advForm'); if (form) form.style.display = '';
    const res = $('#advResults'); if (res) res.innerHTML = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  return b;
}

function renderResults(out) {
  const res = $('#advResults'); if (!res) return; res.innerHTML = '';
  const form = $('#advForm'); if (form) form.style.display = 'none';   // los resultados pisan el form
  const engLabel = out.engine.startsWith('gemini') ? '🤖 Gemini' : '⚙ determinístico';
  res.append(node(`<div class="rec-head">Seleccioné los mejores <b>${out.picks.length}</b> de <b>${out.considered}</b> que se adaptaban a lo que pediste <span class="rec-eng">${engLabel}</span></div>`));
  if (out.note) res.append(node(`<div class="gap-note" style="background:color-mix(in srgb,var(--brass) 12%,transparent);border-color:color-mix(in srgb,var(--brass) 30%,transparent)">${esc(out.note)}</div>`));
  if (!out.picks.length) { res.append(node('<div class="empty"><div class="ic">🤔</div><p>No encontré nada que encaje. Aflojá algún filtro.</p></div>')); res.append(backButton()); return; }
  const byId = Object.fromEntries(S.games.map(g => [g.objectid, g]));
  out.picks.forEach((p, idx) => {
    const g = byId[p.objectid] || p;
    const c = node(`<div class="rec-card">
      <div class="rec-rank">${idx + 1}</div>
      <div class="rec-media">
        <div class="cover"><img src="${esc(safeImg(p.image || p.thumb))}" alt=""></div>
        <button class="btn ghost rec-ficha">Ver ficha</button>
      </div>
      <div>
        <h3>${esc(p.name)}</h3>
        <div class="chips-line" style="margin:6px 0">${(p.subdomains || []).map(s => `<span class="type-tag" style="--c:${typeColor(s)}">${typeEs(s)}</span>`).join('')} ${weightbar(p.weight)}</div>
        <div class="rec-pitch"></div>
        <div class="rec-why">${(p.reasons || []).map(r => `<span class="tagchip">✓ ${esc(r)}</span>`).join('')}</div>
      </div>
    </div>`);
    // "ver más / ver menos" solo en celular; en tablet/PC hay lugar de sobra → mostrar todo el pitch
    if (isMobile()) clampText(c.querySelector('.rec-pitch'), p.pitch, 28);
    else c.querySelector('.rec-pitch').textContent = p.pitch;
    c.querySelector('.rec-ficha').addEventListener('click', () => openDetail(g, { readonly: true }));
    res.append(c);
  });
  // acciones: guardar + reintentar con Gemini (si cayó al determinístico) + sorprendeme + volver
  const actions = node('<div class="rec-actions"></div>');
  if (!out._saved) {   // no ofrecer "Guardar" cuando ya estás viendo una guardada
    const saveBtn = node('<button class="btn">💾 Guardar</button>');
    saveBtn.addEventListener('click', async () => {
      const name = await askName('Guardar recomendación', savedTitle(out));
      if (name == null) return;                 // canceló
      try {
        const r = await api('/saved?owner=' + S.owner, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: name, mode: out.mode, engine: out.engine, result: out })
        });
        if (r.error) throw new Error(r.error);
        saveBtn.textContent = '✓ Guardada'; saveBtn.disabled = true;
        refreshSavedCount();                     // actualiza "Guardadas (N)" sin re-render
        toast('Recomendación guardada');
      } catch (e) { toast('Error: ' + e.message); }
    });
    actions.append(saveBtn);
  }
  if (out.engine === 'rules' && ADV.engine === 'agent') {
    const retry = node('<button class="btn primary">🔁 Reintentar con Gemini</button>');
    retry.addEventListener('click', () => runAdvisor());   // reusa tus respuestas, no recompletás nada
    actions.append(retry);
  }
  if (ADV.mode === 'play') {
    const sp = node('<button class="btn">🎲 Sorprendeme</button>');
    sp.addEventListener('click', () => {
      sp.classList.add('dice-rolling'); setTimeout(() => sp.classList.remove('dice-rolling'), 600);
      const top = out.picks.slice(0, 3);                 // al azar entre los 3 de mejor fit
      const pick = top[Math.floor(Math.random() * top.length)];
      const g = byId[pick.objectid] || pick; setTimeout(() => openDetail(g, { readonly: true }), 300);
    });
    actions.append(sp);
  }
  const back = node('<button class="btn ghost">↩ Volver a buscar</button>');
  back.addEventListener('click', () => {
    advReset();
    const form = $('#advForm'); if (form) form.style.display = '';
    res.innerHTML = ''; window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  actions.append(back);
  res.append(actions);

  // transparencia: los N candidatos que analizó el determinístico (lista simple)
  if (out.candidates && out.candidates.length) {
    const det = node(`<details class="candlist">
      <summary>Ver los ${out.candidates.length} candidatos que analicé <span>(${poolTotal()} → ${out.candidates.length} determinístico → ${out.picks.length} agente)</span></summary>
      <ol>${out.candidates.map(c => `<li class="${c.picked ? 'picked' : ''}">${esc(c.name)}${(c.subdomains || [])[0] ? ` <small>· ${typeEs(c.subdomains[0])}</small>` : ''}${c.picked ? ' <b>✓ elegido</b>' : ''}</li>`).join('')}</ol>
    </details>`);
    res.append(det);
  }
}
