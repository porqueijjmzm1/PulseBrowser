// Foco: durante o cronômetro de foco, bloqueia os sites que distraem e mostra o tempo restante.
(() => {
  if (window.top !== window) return;
  const DEFAULT_SITES = ['youtube.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'facebook.com', 'reddit.com', 'netflix.com'];
  const DEFAULTS = { sites: DEFAULT_SITES, focus: 25, brk: 5, pill: true };
  const host = location.hostname.replace(/^www\./, '');
  let cfg = { ...DEFAULTS };
  let timer = null;
  let allow = {};
  let ui = null;
  let tick = 0;
  let prevOverflow = null;

  const matches = (site) => host === site || host.endsWith(`.${site}`);
  const running = () => !!(timer && !timer.paused && timer.endsAt > Date.now());
  const left = () => (timer ? (timer.paused ? timer.left : timer.endsAt - Date.now()) : 0);
  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const blocked = () => running() && timer.mode === 'focus' && cfg.sites.some(matches) && !((allow[host] || 0) > Date.now());

  function ensureUi() {
    if (ui) return ui;
    const el = document.createElement('tuff-foco');
    const root = el.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host { all: initial; }
      [hidden] { display: none !important; }
      .block { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; text-align: center; color: #fff;
        background: radial-gradient(1200px 700px at 30% 20%, #ff7a59 0%, transparent 60%), radial-gradient(900px 700px at 80% 90%, #7c5cff 0%, transparent 60%), #1a1424;
        font: 15px/1.5 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; animation: in .4s ease-out; }
      @keyframes in { from { opacity: 0; } }
      .card { padding: 36px 44px; border-radius: 28px; background: rgba(255,255,255,.08); backdrop-filter: blur(20px); box-shadow: inset 0 0 0 1px rgba(255,255,255,.14), 0 30px 80px rgba(0,0,0,.4); max-width: 440px; }
      .emoji { font-size: 54px; line-height: 1; }
      h1 { font-size: 26px; margin: 14px 0 6px; }
      p { margin: 0; opacity: .8; }
      .time { font-size: 64px; font-weight: 200; letter-spacing: -2px; margin: 16px 0 18px; font-variant-numeric: tabular-nums; }
      .btns { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
      button { height: 40px; padding: 0 18px; border: 0; border-radius: 14px; font: 600 14px "Segoe UI", system-ui, sans-serif; cursor: pointer; color: #1a1424; background: #fff; }
      button.ghost { background: rgba(255,255,255,.14); color: #fff; }
      button:hover { filter: brightness(1.08); }
      .pill { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px 0 10px; border-radius: 18px; cursor: pointer;
        color: #fff; background: rgba(26, 20, 36, .78); backdrop-filter: blur(12px); box-shadow: 0 8px 24px rgba(0,0,0,.28); font: 600 13.5px "Segoe UI", system-ui, sans-serif;
        font-variant-numeric: tabular-nums; animation: pop .4s cubic-bezier(.3,1.5,.5,1); user-select: none; }
      .pill.brk { background: rgba(19, 134, 106, .85); }
      .pill.mini span { display: none; }
      .pill.mini { padding: 0 10px; }
      .pill i { width: 10px; height: 10px; border-radius: 50%; background: #ff7a59; box-shadow: 0 0 0 3px rgba(255,122,89,.3); }
      .pill.brk i { background: #7dffc8; box-shadow: 0 0 0 3px rgba(125,255,200,.3); }
      @keyframes pop { from { transform: scale(.5); opacity: 0; } }
    </style><div class="block" hidden><div class="card"><div class="emoji">🎯</div><h1>Hora de focar</h1>
      <p class="why"></p><div class="time"></div>
      <div class="btns"><button class="back">Voltar</button><button class="ghost allow">Liberar por 5 minutos</button></div></div></div>
      <div class="pill" hidden title="Foco — clique para diminuir"><i></i><span></span></div>`;
    (document.body || document.documentElement).appendChild(el);
    ui = { el, root, block: root.querySelector('.block'), pill: root.querySelector('.pill') };
    root.querySelector('.back').addEventListener('click', () => {
      if (history.length > 1) history.back();
      else location.href = 'about:blank';
    });
    root.querySelector('.allow').addEventListener('click', async () => {
      allow = { ...allow, [host]: Date.now() + 5 * 60 * 1000 };
      await tuff.storage.set('allow', allow);
      render();
    });
    ui.pill.addEventListener('click', () => ui.pill.classList.toggle('mini'));
    return ui;
  }

  // Pausa vídeos e áudios enquanto o site estiver bloqueado.
  function stopMedia() {
    document.querySelectorAll('video, audio').forEach((m) => {
      try {
        m.pause();
      } catch { /* ignora */ }
    });
  }

  async function finish() {
    // Só a aba que você está olhando avisa e conta o foco (para não repetir em todas as abas).
    const t = timer;
    timer = null;
    if (!t || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    const now = await tuff.storage.get('timer');
    if (!now || now.endsAt !== t.endsAt) return;
    await tuff.storage.set('timer', null);
    if (t.mode === 'focus') {
      const day = new Date().toLocaleDateString('sv');
      const stats = (await tuff.storage.get('stats')) || {};
      if (stats.lastEnd !== t.endsAt) await tuff.storage.set('stats', { day, count: (stats.day === day ? stats.count || 0 : 0) + 1, lastEnd: t.endsAt });
      tuff.notify('Foco concluído! Que tal uma pausa?');
    } else {
      tuff.notify('A pausa acabou. Bora focar de novo?');
    }
  }

  function render() {
    clearInterval(tick);
    tick = 0;
    if (timer && !timer.paused && timer.endsAt <= Date.now()) {
      finish();
    }
    const isBlocked = blocked();
    const showPill = !isBlocked && cfg.pill && timer && (running() || timer.paused);
    if (!isBlocked && !showPill) {
      if (ui) {
        ui.block.hidden = true;
        ui.pill.hidden = true;
      }
      if (prevOverflow !== null) {
        document.documentElement.style.overflow = prevOverflow;
        prevOverflow = null;
      }
      return;
    }
    const u = ensureUi();
    u.block.hidden = !isBlocked;
    u.pill.hidden = !showPill;
    if (isBlocked) {
      u.root.querySelector('.why').textContent = `${host} fica bloqueado até o fim do foco.`;
      if (prevOverflow === null) {
        prevOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
      }
      stopMedia();
    } else if (prevOverflow !== null) {
      document.documentElement.style.overflow = prevOverflow;
      prevOverflow = null;
    }
    u.pill.classList.toggle('brk', timer.mode === 'break');
    const update = () => {
      // Acabou o tempo, ou terminou a liberação de 5 minutos deste site.
      if ((timer && !timer.paused && timer.endsAt <= Date.now()) || blocked() !== isBlocked) {
        render();
        return;
      }
      const text = fmt(left());
      if (isBlocked) {
        u.root.querySelector('.time').textContent = text;
        stopMedia();
      }
      u.pill.querySelector('span').textContent = timer?.paused ? `${text} · pausado` : `${timer?.mode === 'break' ? 'Pausa' : 'Foco'} · ${text}`;
    };
    update();
    if (running()) tick = setInterval(update, 1000);
  }

  tuff.storage.onChanged((c) => {
    if ('cfg' in c) cfg = { ...DEFAULTS, ...(c.cfg || {}) };
    if ('timer' in c) timer = c.timer || null;
    if ('allow' in c) allow = c.allow || {};
    render();
  });
  // Ao voltar para a aba, confere se o tempo acabou enquanto ela estava em segundo plano.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && render());
  (async () => {
    try {
      const all = (await tuff.storage.get()) || {};
      cfg = { ...DEFAULTS, ...(all.cfg || {}) };
      timer = all.timer || null;
      allow = all.allow || {};
    } catch { /* padrão */ }
    render();
  })();
})();
