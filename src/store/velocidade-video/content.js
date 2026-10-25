// Velocidade de Vídeo: controla a velocidade de qualquer vídeo (YouTube, cursos, redes sociais…)
// com atalhos de teclado e mostra a velocidade por cima do vídeo.
(() => {
  const DEFAULTS = { speed: 1, step: 0.1, overlay: true, keys: true, skip: 10 };
  let cfg = { ...DEFAULTS };
  const media = new Set();
  const round = (n) => Math.round(n * 100) / 100;
  const clamp = (n) => Math.min(16, Math.max(0.1, round(n)));
  const label = (n) => `${round(n).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}×`;

  function setRate(v, rate) {
    if (Math.abs(v.playbackRate - rate) < 0.001) return;
    try {
      v.playbackRate = rate;
    } catch { /* vídeo sem suporte */ }
  }

  function track(v) {
    if (media.has(v)) return;
    media.add(v);
    // Os sites costumam voltar para 1× ao trocar de vídeo; aplica de novo quando ele começa.
    for (const ev of ['loadedmetadata', 'play']) v.addEventListener(ev, () => setRate(v, cfg.speed));
    setRate(v, cfg.speed);
  }

  function scan(root = document) {
    root.querySelectorAll?.('video').forEach(track);
  }

  // O vídeo "da vez": o que está tocando e aparece maior na tela.
  function mainVideo() {
    let best = null;
    let bestScore = 0;
    for (const v of media) {
      if (!v.isConnected) {
        media.delete(v);
        continue;
      }
      const r = v.getBoundingClientRect();
      const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      const score = area * (v.paused ? 1 : 4);
      if (score > bestScore) {
        best = v;
        bestScore = score;
      }
    }
    return best;
  }

  // ---- Aviso da velocidade por cima do vídeo
  let host = null;
  let pill = null;
  let hideTimer = 0;
  function flash(text, v = mainVideo()) {
    if (!cfg.overlay || !v) return;
    if (!host) {
      host = document.createElement('tuff-video-speed');
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>
        :host { all: initial; position: fixed; z-index: 2147483647; pointer-events: none; }
        div { font: 700 15px/1 "Segoe UI", system-ui, sans-serif; color: #fff; padding: 8px 12px; border-radius: 12px; background: rgba(20, 18, 30, 0.72);
          backdrop-filter: blur(10px); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35); transition: opacity 0.25s, transform 0.25s cubic-bezier(0.3, 1.5, 0.5, 1); font-variant-numeric: tabular-nums; }
        div.hide { opacity: 0; transform: scale(0.85); }
      </style><div class="hide"></div>`;
      pill = root.querySelector('div');
    }
    // Em tela cheia, o aviso precisa estar dentro do elemento em tela cheia para aparecer.
    const parent = document.fullscreenElement && document.fullscreenElement.tagName !== 'VIDEO' ? document.fullscreenElement : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
    const r = v.getBoundingClientRect();
    host.style.left = `${Math.max(8, r.left + 14)}px`;
    host.style.top = `${Math.max(8, r.top + 14)}px`;
    pill.textContent = text;
    pill.classList.remove('hide');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => pill.classList.add('hide'), 1300);
  }

  async function setSpeed(n, { save = true } = {}) {
    cfg.speed = clamp(n);
    for (const v of media) setRate(v, cfg.speed);
    flash(label(cfg.speed));
    if (save) {
      try {
        await tuff.storage.set('cfg', { ...cfg });
        tuff.action.setBadge(cfg.speed === 1 ? '' : String(round(cfg.speed)).slice(0, 4), '#ff5a5f');
      } catch { /* extensão desligada */ }
    }
  }

  // ---- Atalhos: S mais devagar, D mais rápido, R volta para 1×, Z volta e X avança alguns segundos
  window.addEventListener('keydown', (e) => {
    if (!cfg.keys || e.ctrlKey || e.altKey || e.metaKey || (e.repeat && !/^[sd]$/i.test(e.key))) return;
    const t = e.composedPath()[0];
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const key = e.key.toLowerCase();
    if (!['s', 'd', 'r', 'z', 'x', 'g'].includes(key)) return;
    const v = mainVideo();
    if (!v) return;
    if (key === 's') setSpeed(cfg.speed - cfg.step);
    else if (key === 'd') setSpeed(cfg.speed + cfg.step);
    else if (key === 'r') setSpeed(1);
    else if (key === 'g') setSpeed(cfg.speed === 1 ? 2 : 1);
    else {
      v.currentTime = Math.max(0, v.currentTime + (key === 'x' ? cfg.skip : -cfg.skip));
      flash(`${key === 'x' ? '+' : '−'}${cfg.skip} s`, v);
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  tuff.storage.onChanged((changes) => {
    if (!('cfg' in changes)) return;
    const prev = cfg.speed;
    cfg = { ...DEFAULTS, ...(changes.cfg || {}) };
    for (const v of media) setRate(v, cfg.speed);
    if (prev !== cfg.speed && document.hasFocus()) flash(label(cfg.speed));
  });

  // Vídeos que aparecem depois (rolagem infinita, players carregados sob demanda).
  document.addEventListener('play', (e) => {
    if (e.target?.tagName === 'VIDEO') track(e.target);
  }, true);
  new MutationObserver((list) => {
    for (const m of list) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'VIDEO') track(n);
        else if (n.firstElementChild) scan(n);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  (async () => {
    try {
      cfg = { ...DEFAULTS, ...((await tuff.storage.get('cfg')) || {}) };
    } catch { /* padrão */ }
    scan();
  })();
})();
