(async () => {
  const $ = (s) => document.querySelector(s);
  const DEFAULT_SITES = ['youtube.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'facebook.com', 'reddit.com', 'netflix.com'];
  const DEFAULTS = { sites: DEFAULT_SITES, focus: 25, brk: 5, pill: true };
  const all = (await tuff.storage.get()) || {};
  let cfg = { ...DEFAULTS, ...(all.cfg || {}) };
  let timer = all.timer || null;
  let stats = all.stats || {};
  const RING = 2 * Math.PI * 44;
  $('#prog').style.strokeDasharray = RING;

  let host = '';
  try {
    const u = new URL((await tuff.tabs.active()).url);
    if (/^https?:$/.test(u.protocol)) host = u.hostname.replace(/^www\./, '');
  } catch { /* sem site */ }

  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const left = () => (timer ? (timer.paused ? timer.left : timer.endsAt - Date.now()) : 0);
  const today = () => new Date().toLocaleDateString('sv');
  const cleanSite = (s) => String(s || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#:].*$/, '');

  async function start(mode) {
    const total = (mode === 'focus' ? cfg.focus : cfg.brk) * 60 * 1000;
    timer = { mode, total, endsAt: Date.now() + total, paused: false, left: total };
    await tuff.storage.set('timer', timer);
    render();
  }
  async function finishIfDone() {
    if (!timer || timer.paused || timer.endsAt > Date.now()) return;
    const t = timer;
    timer = null;
    await tuff.storage.set('timer', null);
    if (t.mode === 'focus' && stats.lastEnd !== t.endsAt) {
      stats = { day: today(), count: (stats.day === today() ? stats.count || 0 : 0) + 1, lastEnd: t.endsAt };
      await tuff.storage.set('stats', stats);
    }
    $('#mode').textContent = t.mode === 'focus' ? 'Foco concluído! 🎉' : 'Pausa encerrada';
  }

  function render() {
    const active = !!timer;
    const ms = active ? left() : cfg.focus * 60 * 1000;
    const total = timer?.total || ms || 1;
    document.body.classList.toggle('brk', timer?.mode === 'break');
    $('#time').textContent = fmt(ms);
    $('#prog').style.strokeDashoffset = active ? RING * (1 - ms / total) : 0;
    if (active) $('#mode').textContent = timer.paused ? 'Pausado' : timer.mode === 'focus' ? 'Focando' : 'Pausa';
    else if (!/conclu|encerr/.test($('#mode').textContent)) $('#mode').textContent = 'Pronto para focar';
    $('#main').textContent = !active ? 'Começar foco' : timer.paused ? 'Continuar' : 'Pausar';
    $('#second').textContent = active ? 'Parar' : `Pausa de ${cfg.brk} min`;
    const n = stats.day === today() ? stats.count || 0 : 0;
    $('#stats').textContent = n ? `Hoje: ${n} ${n === 1 ? 'foco concluído' : 'focos concluídos'}` : 'Nenhum foco concluído hoje ainda';

    $('#sites').innerHTML = cfg.sites.map((s) => `<span class="chip">${s.replace(/[<>&"]/g, '')}<button data-del="${s.replace(/[<>&"]/g, '')}" title="Remover">×</button></span>`).join('') || '<span class="hint">Nenhum site na lista</span>';
    const listed = host && cfg.sites.some((s) => host === s || host.endsWith(`.${s}`));
    $('#this').hidden = !host || listed;
    $('#this').textContent = `+ Bloquear ${host}`;
    for (const k of ['focus', 'brk']) document.querySelectorAll(`#${k} button`).forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === cfg[k]));
    $('#pill').checked = !!cfg.pill;
  }

  const saveCfg = () => {
    tuff.storage.set('cfg', cfg);
    render();
  };

  $('#main').addEventListener('click', async () => {
    if (!timer) return start('focus');
    if (timer.paused) timer = { ...timer, paused: false, endsAt: Date.now() + timer.left };
    else timer = { ...timer, paused: true, left: left() };
    await tuff.storage.set('timer', timer);
    render();
  });
  $('#second').addEventListener('click', async () => {
    if (!timer) return start('break');
    timer = null;
    await tuff.storage.set('timer', null);
    $('#mode').textContent = 'Pronto para focar';
    render();
  });
  $('#sites').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    cfg.sites = cfg.sites.filter((s) => s !== b.dataset.del);
    saveCfg();
  });
  $('#add').addEventListener('submit', (e) => {
    e.preventDefault();
    const s = cleanSite($('#site').value);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) {
      $('#site').select();
      return;
    }
    if (!cfg.sites.includes(s)) cfg.sites = [...cfg.sites, s];
    $('#site').value = '';
    saveCfg();
  });
  $('#this').addEventListener('click', () => {
    cfg.sites = [...cfg.sites, host];
    saveCfg();
  });
  for (const k of ['focus', 'brk']) {
    $(`#${k}`).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      cfg[k] = Number(b.dataset.v);
      saveCfg();
    });
  }
  $('#pill').addEventListener('change', (e) => {
    cfg.pill = e.target.checked;
    saveCfg();
  });
  tuff.storage.onChanged((c) => {
    if ('timer' in c) timer = c.timer || null;
    if ('stats' in c) stats = c.stats || {};
    if ('cfg' in c && c.cfg) cfg = { ...DEFAULTS, ...c.cfg };
    render();
  });

  await finishIfDone();
  render();
  setInterval(async () => {
    await finishIfDone();
    if (timer && !timer.paused) {
      $('#time').textContent = fmt(left());
      $('#prog').style.strokeDashoffset = RING * (1 - left() / (timer.total || 1));
    }
  }, 1000);
})();
