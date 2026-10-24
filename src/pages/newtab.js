'use strict';
(async () => {
  const { $, esc, favicon, icon } = window.Pulse;
  const { ctx, settings } = await window.Pulse.init();
  let s = settings;

  const BACKGROUNDS = {
    aurora: 'linear-gradient(135deg,#ff4d8d,#8b5cff,#3b82ff)',
    sunset: 'linear-gradient(135deg,#ff7a1a,#ff3d7f,#ffc531)',
    ocean: 'linear-gradient(135deg,#00b4d8,#2f7bff,#14b8a6)',
    forest: 'linear-gradient(135deg,#22a35a,#9acd32,#0f766e)',
    mono: 'linear-gradient(135deg,#8a8994,#3a3940)',
  };

  function applyPrefs() {
    document.body.dataset.bg = s.newTabBackground || 'aurora';
    $('#tiles').hidden = !s.newTabShortcuts;
    $('#opt-shortcuts').checked = !!s.newTabShortcuts;
    for (const id of ['#q', '#q2']) $(id).placeholder = `Pesquise no ${s.engineName} ou digite um endereço`;
    document.querySelectorAll('.bg-choice').forEach((b) => b.classList.toggle('on', b.dataset.bg === s.newTabBackground));
  }

  // Relógio e saudação.
  function tick() {
    const now = new Date();
    $('#clock').textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const h = now.getHours();
    const hello = h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#greeting').textContent = `${hello} — ${date}`;
  }
  tick();
  setInterval(tick, 10_000);

  // Pesquisa.
  async function go(text) {
    if (!text.trim()) return;
    const url = await window.pulse.invoke('internal:resolve', text);
    if (url) location.href = url;
  }
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    go($('#q').value);
  });
  $('#inc-search').addEventListener('submit', (e) => {
    e.preventDefault();
    go($('#q2').value);
  });

  // Atalhos (sites mais visitados).
  function renderTiles(list) {
    const box = $('#tiles');
    box.textContent = '';
    for (const site of list) {
      const a = document.createElement('a');
      a.className = 'tile';
      a.href = site.url;
      a.title = `${site.title || ''}\n${site.url}`;
      a.appendChild(favicon(site.url, site.favicon, 44));
      const t = document.createElement('span');
      t.className = 't-title';
      t.textContent = site.title || window.Pulse.hostOf(site.url);
      a.appendChild(t);
      const rm = document.createElement('button');
      rm.className = 'icon-btn t-remove';
      rm.title = 'Remover atalho';
      rm.innerHTML = icon('x', 14);
      rm.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        renderTiles(await window.pulse.invoke('internal:top-sites-remove', site.url));
      });
      a.appendChild(rm);
      box.appendChild(a);
    }
  }

  if (ctx.incognito) {
    $('#normal').hidden = true;
    $('#incognito').hidden = false;
    $('#customize-btn').hidden = true;
  } else {
    renderTiles(await window.pulse.invoke('internal:top-sites'));
    const stats = await window.pulse.invoke('internal:shield-stats');
    if (s.shieldEnabled && stats.total > 0) {
      const el = $('#shield-stat');
      el.innerHTML = `${icon('shieldCheck', 16)} <span>Pulse Shield: <b>${esc(stats.total.toLocaleString('pt-BR'))}</b> anúncios e rastreadores bloqueados</span>`;
      el.hidden = false;
    }
  }

  // Painel de personalização.
  const choices = $('#bg-choices');
  for (const [id, css] of Object.entries(BACKGROUNDS)) {
    const b = document.createElement('button');
    b.className = 'bg-choice';
    b.dataset.bg = id;
    b.style.background = css;
    b.title = { aurora: 'Aurora', sunset: 'Pôr do sol', ocean: 'Oceano', forest: 'Floresta', mono: 'Neutro' }[id];
    b.addEventListener('click', () => window.pulse.invoke('internal:set-setting', 'newTabBackground', id));
    choices.appendChild(b);
  }
  $('#customize-btn').addEventListener('click', () => {
    $('#customize').hidden = !$('#customize').hidden;
  });
  $('#customize-close').addEventListener('click', () => {
    $('#customize').hidden = true;
  });
  $('#opt-shortcuts').addEventListener('change', (e) => window.pulse.invoke('internal:set-setting', 'newTabShortcuts', e.target.checked));
  $('#restore-tiles').addEventListener('click', async () => renderTiles(await window.pulse.invoke('internal:top-sites-reset')));

  document.addEventListener('pulse-settings', (e) => {
    s = e.detail;
    applyPrefs();
  });
  applyPrefs();
})();
