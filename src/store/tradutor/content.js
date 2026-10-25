// Tradutor: selecione um texto em qualquer site e clique em "Traduzir" (ou aperte Alt+T).
(() => {
  if (window.top !== window) return;
  const DEFAULTS = { target: 'pt', button: true };
  const NAMES = {
    pt: 'português', en: 'inglês', es: 'espanhol', fr: 'francês', de: 'alemão', it: 'italiano', ja: 'japonês', ko: 'coreano',
    'zh-CN': 'chinês', zh: 'chinês', ru: 'russo', ar: 'árabe', hi: 'hindi', nl: 'holandês', pl: 'polonês', tr: 'turco', uk: 'ucraniano', sv: 'sueco', id: 'indonésio', he: 'hebraico', iw: 'hebraico',
  };
  let cfg = { ...DEFAULTS };
  let host = null;
  let root = null;
  let btn = null;
  let card = null;
  let lastText = '';
  let lastRect = null;

  async function translate(text, target) {
    const res = await tuff.fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&dj=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `q=${encodeURIComponent(text)}`,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = JSON.parse(res.text);
    return { text: (data.sentences || []).map((s) => s.trans || '').join(''), from: data.src || '' };
  }

  const STYLE = `
    :host { all: initial; }
    .btn { position: fixed; z-index: 2147483647; display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 9px; border: 0; border-radius: 16px; cursor: pointer;
      color: #fff; background: linear-gradient(135deg, #3b8cff, #1f5fd1); box-shadow: 0 6px 18px rgba(20, 60, 160, .35); font: 600 13px "Segoe UI", system-ui, sans-serif;
      animation: pop .3s cubic-bezier(.3,1.5,.5,1); }
    .btn:hover { filter: brightness(1.08); }
    .btn svg { width: 16px; height: 16px; }
    @keyframes pop { from { transform: scale(.6); opacity: 0; } }
    .card { position: fixed; z-index: 2147483647; width: min(380px, calc(100vw - 24px)); max-height: 60vh; display: flex; flex-direction: column; border-radius: 16px; overflow: hidden;
      color: var(--text); background: var(--bg); box-shadow: 0 18px 50px rgba(0,0,0,.28), 0 0 0 1px var(--line); font: 14px/1.5 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
      --bg: #fff; --text: #1d1c22; --muted: #6b6a75; --line: rgba(20,16,40,.1); --accent: #2a7de1; animation: pop .3s cubic-bezier(.2,.9,.3,1.1); }
    @media (prefers-color-scheme: dark) { .card { --bg: #2b2a31; --text: #f1f1f4; --muted: #a8a7b3; --line: rgba(255,255,255,.12); --accent: #7fb5ff; } }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 8px 14px; border-bottom: 1px solid var(--line); font-size: 12px; color: var(--muted); }
    .head .grow { flex: 1; }
    .head select { font: 600 12px "Segoe UI", system-ui, sans-serif; color: var(--accent); background: transparent; border: 0; outline: 0; cursor: pointer; }
    .head select option { color: #1d1c22; }
    .out { padding: 12px 14px; overflow: auto; white-space: pre-wrap; user-select: text; font-size: 15px; }
    .out.wait { color: var(--muted); }
    .foot { display: flex; gap: 4px; padding: 6px 8px; border-top: 1px solid var(--line); }
    .foot button, .head button { height: 28px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font: 600 12px "Segoe UI", system-ui, sans-serif; cursor: pointer; }
    .foot button:hover, .head button:hover { background: var(--line); }
    .foot .grow { flex: 1; }
  `;
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h8M8 3v2M6 5c0 4 2 7 5 8M10 5c-.5 3.5-2.5 6.5-6 8"/><path d="M13 21l4-9 4 9M14.5 18h5"/></svg>';

  function ensureHost() {
    if (host?.isConnected) return;
    host = document.createElement('tuff-tradutor');
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${STYLE}</style>`;
    document.documentElement.appendChild(host);
    host.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  function hideButton() {
    btn?.remove();
    btn = null;
  }
  function hideCard() {
    card?.remove();
    card = null;
    speechSynthesis.cancel();
  }

  function selectionInfo() {
    const sel = getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text || text.length < 2 || text.length > 5000 || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { text, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
  }

  function showButton(info) {
    ensureHost();
    hideButton();
    btn = document.createElement('button');
    btn.className = 'btn';
    btn.innerHTML = `${ICON}Traduzir`;
    const x = Math.min(innerWidth - 120, Math.max(8, info.rect.right - 40));
    const y = info.rect.bottom + 40 > innerHeight ? info.rect.top - 40 : info.rect.bottom + 8;
    btn.style.left = `${x}px`;
    btn.style.top = `${y}px`;
    btn.addEventListener('click', () => openCard(info));
    root.appendChild(btn);
  }

  async function openCard(info, target = cfg.target) {
    ensureHost();
    hideButton();
    hideCard();
    lastText = info.text;
    lastRect = info.rect;
    card = document.createElement('div');
    card.className = 'card';
    const langs = ['pt', 'en', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'zh-CN', 'ru'];
    card.innerHTML = `<div class="head"><span class="from">Traduzindo…</span><span class="grow"></span>
        <select title="Traduzir para">${langs.map((l) => `<option value="${l}"${l === target ? ' selected' : ''}>${NAMES[l]}</option>`).join('')}</select>
        <button data-a="close" title="Fechar (Esc)">✕</button></div>
      <div class="out wait">Traduzindo…</div>
      <div class="foot"><button data-a="copy">Copiar</button><button data-a="speak">Ouvir</button><span class="grow"></span><button data-a="google">Abrir no Google Tradutor</button></div>`;
    const w = Math.min(380, innerWidth - 24);
    const x = Math.min(innerWidth - w - 12, Math.max(12, info.rect.left));
    const below = info.rect.bottom + 12;
    card.style.left = `${x}px`;
    if (below + 220 < innerHeight) card.style.top = `${below}px`;
    else card.style.bottom = `${Math.max(12, innerHeight - info.rect.top + 12)}px`;
    root.appendChild(card);
    const out = card.querySelector('.out');
    let result = '';
    card.querySelector('select').addEventListener('change', (e) => openCard({ text: lastText, rect: lastRect }, e.target.value));
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'close') hideCard();
      else if (b.dataset.a === 'copy' && result) {
        navigator.clipboard.writeText(result).then(() => {
          b.textContent = 'Copiado!';
          setTimeout(() => (b.textContent = 'Copiar'), 1200);
        }).catch(() => {});
      } else if (b.dataset.a === 'speak' && result) {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(result);
        u.lang = target;
        speechSynthesis.speak(u);
      } else if (b.dataset.a === 'google') {
        tuff.tabs.create({ url: `https://translate.google.com/?sl=auto&tl=${encodeURIComponent(target)}&text=${encodeURIComponent(lastText.slice(0, 4000))}&op=translate` });
      }
    });
    try {
      const r = await translate(info.text, target);
      if (!card?.isConnected || lastText !== info.text) return;
      result = r.text;
      out.classList.remove('wait');
      out.textContent = r.text || '(sem tradução)';
      card.querySelector('.from').textContent = r.from ? `Do ${NAMES[r.from] || r.from}` : 'Tradução';
    } catch {
      out.textContent = 'Não foi possível traduzir agora. Verifique a conexão.';
      card.querySelector('.from').textContent = 'Erro';
    }
  }

  document.addEventListener('mouseup', (e) => {
    if (!cfg.button || e.button !== 0 || e.composedPath().includes(host)) return;
    setTimeout(() => {
      const info = selectionInfo();
      if (info) showButton(info);
      else hideButton();
    }, 10);
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (e.composedPath().includes(host)) return;
    hideButton();
    hideCard();
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (card || btn)) {
      hideButton();
      hideCard();
    } else if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 't') {
      const info = selectionInfo();
      if (info) {
        e.preventDefault();
        openCard(info);
      }
    }
  }, true);
  window.addEventListener('scroll', hideButton, { passive: true, capture: true });
  tuff.storage.onChanged((c) => {
    if ('cfg' in c) cfg = { ...DEFAULTS, ...(c.cfg || {}) };
  });
  (async () => {
    try {
      cfg = { ...DEFAULTS, ...((await tuff.storage.get('cfg')) || {}) };
    } catch { /* padrão */ }
  })();
})();
