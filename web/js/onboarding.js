/* Onboarding de primer arranque: como cargar la coleccion + tema + modo seguro. */
import { openAdd } from './add.js';
import { renderAppearanceGrid } from './appearance.js';
import { enrichLoop, loadGames, loadOwners } from './data.js';
import { overlay } from './modal.js';
import { openData } from './profiles.js';
import { render } from './router.js';
import { renderSafeBox } from './safemode.js';
import { S } from './state.js';
import { $, api, esc, node, toast } from './util.js';

export function maybeOnboard() {
  const me = S.owners.find(o => o.is_me);
  if (me && (me.own_count + me.wish_count) === 0) openOnboarding();
}

function openOnboarding() {
  const inner = node(`<div class="sheet-body" style="text-align:center">
    <div class="die" style="width:64px;height:64px;font-size:34px;border-radius:18px;margin:0 auto 14px;display:grid;place-items:center;background:linear-gradient(150deg,var(--brass-2),var(--brass));color:var(--brass-ink);transform:rotate(-6deg)">🎲</div>
    <h2 style="font-size:26px">Bienvenido a tu Ludoteca</h2>
    <p style="color:var(--ink-dim);margin:6px auto 22px;max-width:420px">¿Cómo querés empezar? Podés cargar tu colección en segundos o ir sumando juegos a mano.</p>
    <div style="display:flex;flex-direction:column;gap:12px;text-align:left">
      <button class="onb" data-c="bgg"><div class="oic">📥</div><div><b>Tengo un export de BoardGameGeek</b><span>Subí el CSV de tu colección y lo completo con imágenes y datos.</span></div></button>
      <button class="onb" data-c="backup"><div class="oic">💾</div><div><b>Tengo un backup de esta app</b><span>Restaurá un CSV que descargaste antes desde acá.</span></div></button>
      <button class="onb" data-c="scratch"><div class="oic">✨</div><div><b>Empezar de cero</b><span>Buscá y agregá tus juegos uno por uno.</span></div></button>
    </div>
    <div style="margin-top:20px;text-align:left">
      <div class="section-h" style="margin:0 0 8px">Elegí un tema <span style="text-transform:none;font-weight:500;color:var(--ink-dim)">(lo cambiás cuando quieras)</span></div>
      <div class="appear-grid" id="onbAppear"></div>
    </div>
    <div style="margin-top:16px;text-align:left">
      <div class="section-h" style="margin:0 0 6px">Modo seguro <span style="text-transform:none;font-weight:500;color:var(--ink-dim)">(opcional)</span></div>
      <p class="tab-hint" style="margin:0 0 8px">Un candado que bloquea los cambios — para que un chico mire sin tocar la colección. Lo activás y configurás el PIN cuando quieras.</p>
      <div id="onbSafe"></div>
    </div>
    <div class="onb-key" style="margin-top:18px">💡 El <b>Advisor con IA</b> es opcional: usa una API key <b>gratis</b> de Google Gemini. Podés cargarla ahora o cuando quieras en <b>⚙ → Configurar</b>. Sin ella, la app anda completa (búsqueda, panel y advisor determinístico).
      <div style="margin-top:8px"><button class="btn ghost sm" id="onbKey">Configurar el Advisor (opcional)</button></div>
    </div>
    <div id="onbProg" style="margin-top:18px"></div>
  </div>`);
  renderAppearanceGrid(inner.querySelector('#onbAppear'));
  renderSafeBox(inner.querySelector('#onbSafe'));
  inner.querySelector('#onbKey').addEventListener('click', () => { ov.remove(); openData('config'); });
  // estilos inline para los botones de onboarding
  inner.querySelectorAll('.onb').forEach(b => {
    b.style.cssText = 'display:flex;gap:14px;align-items:center;padding:16px;border-radius:14px;background:var(--surface);border:1px solid var(--line);transition:.15s;text-align:left';
    b.onmouseenter = () => { b.style.borderColor = 'var(--brass)'; b.style.transform = 'translateY(-2px)'; };
    b.onmouseleave = () => { b.style.borderColor = 'var(--line)'; b.style.transform = 'none'; };
    b.querySelector('.oic').style.cssText = 'font-size:28px;flex:none';
    const d = b.querySelector('div:last-child'); d.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    b.querySelector('b').style.cssText = 'font-family:Bricolage Grotesque;font-size:15px';
    b.querySelector('span').style.cssText = 'color:var(--ink-dim);font-size:13px';
  });

  const prog = inner.querySelector('#onbProg');
  async function handleFile(mode) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv';
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      prog.innerHTML = '<div class="spinner"></div><p style="color:var(--ink-dim)">Importando tu colección…</p>';
      const fd = new FormData(); fd.append('file', file); fd.append('mode', 'both');
      try {
        const r = await api('/import', { method: 'POST', body: fd });
        await loadOwners();
        if (mode === 'bgg') {
          prog.innerHTML = `<p style="color:var(--ink-dim)">Trayendo imágenes y datos de BGG…</p>
            <div class="bar-row"><span class="track"><span class="fill" id="obfill" style="width:0%"></span></span><span class="num" id="obnum"></span></div>`;
          await enrichLoop(S.owner, (d, t, rem) => {
            const pc = t ? Math.round(d / t * 100) : 100;
            const f = $('#obfill'), n = $('#obnum'); if (f) f.style.width = pc + '%'; if (n) n.textContent = rem;
          });
        }
        await loadGames(); render();   // poblá la biblioteca detrás SIN cerrar: el onboarding sigue
        // No auto-cerramos: el tema / modo seguro / API key viven en esta misma pantalla. El usuario
        // sigue configurando y cierra con "Entrar" (o desde "Configurar el Advisor"). (fix onboarding)
        inner.querySelectorAll('.onb').forEach(x => { x.disabled = true; x.style.opacity = '.45'; x.style.pointerEvents = 'none'; });
        prog.innerHTML = `<div class="onb-key">✅ <b>¡Listo! ${r.updated} juegos cargados.</b> Si querés, configurá el Advisor acá arriba (opcional); cuando estés, entrá.</div>
          <button class="btn primary" id="onbEnter" style="margin-top:12px">Entrar a la Ludoteca →</button>`;
        prog.querySelector('#onbEnter').addEventListener('click', () => ov.remove());
        toast(`¡Listo! ${r.updated} juegos cargados.`);
      } catch (e) { prog.innerHTML = `<p style="color:var(--danger)">Error: ${esc(e.message)}</p>`; }
    };
    inp.click();
  }
  inner.querySelectorAll('.onb').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.c;
    if (c === 'scratch') { ov.remove(); openAdd(); }
    else handleFile(c);
  }));
  const ov = overlay(inner, 'sheet');
}
