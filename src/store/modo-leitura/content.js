// Modo Leitura: mostra só o texto do artigo, sem anúncios nem menus, com fonte e tema à escolha.
// Abre pelo pop-up, pelo atalho Alt+R ou pelo botão flutuante (opcional) nas páginas de artigo.
(() => {
  if (window.top !== window) return;
  const DEFAULTS = { theme: 'light', font: 'serif', size: 20, width: 'medium', fab: false };
  let cfg = { ...DEFAULTS };
  let host = null;
  let root = null;
  let fab = null;
  let open = false;
  let prevOverflow = '';

  // ---- Encontrar o artigo
  const NEG = /comment|meta|footer|footnote|foot|related|share|social|sponsor|promo|advert|\bad[s-]?\b|banner|newsletter|subscribe|sidebar|widget|cookie|popup|modal|breadcrumb|pagination|menu|nav|recommend|outbrain|taboola/i;
  const POS = /article|body|content|entry|main|page|post|text|story|materia|noticia|texto/i;
  const textLen = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().length;
  function linkDensity(el) {
    const total = textLen(el) || 1;
    let links = 0;
    for (const a of el.querySelectorAll('a')) links += textLen(a);
    return links / total;
  }

  function findArticle() {
    const scores = new Map();
    const add = (el, s) => {
      if (!el || el === document.documentElement) return;
      let base = scores.get(el);
      if (base === undefined) {
        const sig = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`;
        base = (/^(ARTICLE|MAIN)$/.test(el.tagName) ? 8 : 0) + (POS.test(sig) ? 5 : 0) - (NEG.test(sig) ? 12 : 0);
      }
      scores.set(el, base + s);
    };
    for (const p of document.querySelectorAll('p, pre, blockquote, li')) {
      const len = textLen(p);
      if (len < 50 || p.closest('nav, header, footer, aside, form')) continue;
      const s = 1 + Math.min(len / 100, 3) + ((p.textContent.match(/[,.;:]/g) || []).length * 0.1);
      add(p.parentElement, s);
      add(p.parentElement?.parentElement, s / 2);
      add(p.parentElement?.parentElement?.parentElement, s / 4);
    }
    let best = null;
    let bestScore = 0;
    for (const [el, s] of scores) {
      const score = s * (1 - linkDensity(el));
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best && textLen(best) > 400 ? best : null;
  }

  const KEEP_ATTR = { A: ['href', 'title'], IMG: ['src', 'alt', 'title'], VIDEO: ['src', 'controls', 'poster'], AUDIO: ['src', 'controls'], SOURCE: ['src', 'type'], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'], OL: ['start'] };
  function absolute(url) {
    try {
      return new URL(url, location.href).href;
    } catch {
      return '';
    }
  }
  function clean(src) {
    const node = src.cloneNode(true);
    node.querySelectorAll('script, style, noscript, iframe, form, button, input, select, textarea, nav, aside, footer, svg, canvas, object, embed, dialog, [hidden], [aria-hidden="true"], [role="navigation"], [role="complementary"]').forEach((el) => el.remove());
    // Vídeos sem endereço (players montados por script) só deixariam um buraco.
    node.querySelectorAll('video, audio').forEach((m) => {
      if (!m.getAttribute('src') && !m.querySelector('source[src]')) m.remove();
      else m.setAttribute('controls', '');
    });
    // Imagens com carregamento preguiçoso guardam o endereço em outro atributo.
    node.querySelectorAll('img').forEach((img) => {
      const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
      const set = img.getAttribute('data-srcset') || img.getAttribute('srcset');
      let src = lazy || img.getAttribute('src') || '';
      if ((!src || src.startsWith('data:')) && set) src = set.split(',').pop().trim().split(/\s+/)[0];
      const w = img.getAttribute('width');
      if (!src || src.startsWith('data:image/gif') || (w && Number(w) < 40)) img.remove();
      else img.setAttribute('src', absolute(src));
    });
    node.querySelectorAll('video[src], audio[src], source[src], video[poster]').forEach((m) => {
      if (m.getAttribute('src')) m.setAttribute('src', absolute(m.getAttribute('src')));
      if (m.getAttribute('poster')) m.setAttribute('poster', absolute(m.getAttribute('poster')));
    });
    // Blocos com muitos links e pouco texto (listas de "leia também", menus).
    node.querySelectorAll('div, section, ul, ol, header, table').forEach((el) => {
      if (!el.isConnected) return;
      const len = textLen(el);
      const sig = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`;
      if ((NEG.test(sig) && len < 1500) || (len < 200 && linkDensity(el) > 0.5 && !el.querySelector('img'))) el.remove();
    });
    node.querySelectorAll('h1').forEach((h, i) => i === 0 && h.remove());
    // Só os atributos que importam para ler.
    node.querySelectorAll('*').forEach((el) => {
      const keep = KEEP_ATTR[el.tagName] || [];
      for (const a of [...el.attributes]) if (!keep.includes(a.name)) el.removeAttribute(a.name);
      if (el.tagName === 'A') {
        const href = el.getAttribute('href') || '';
        if (/^javascript:/i.test(href)) el.removeAttribute('href');
        else if (href) el.setAttribute('href', absolute(href));
      }
    });
    return node;
  }

  function meta(...names) {
    for (const n of names) {
      const v = document.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.content;
      if (v && v.trim()) return v.trim();
    }
    return '';
  }

  // ---- Interface
  const ICONS = {
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    minus: '<path d="M7 12h10"/>',
    plus: '<path d="M12 7v10M7 12h10"/>',
    play: '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;
  const STYLE = `
    :host { all: initial; }
    .wrap { position: fixed; inset: 0; z-index: 2147483646; overflow: auto; --bg: #fbfaf7; --text: #24222b; --muted: #75727f; --line: rgba(0,0,0,.08); --link: #3a5bd9; --bar: rgba(251,250,247,.86);
      background: var(--bg); color: var(--text); animation: in .3s cubic-bezier(.2,.9,.3,1); scroll-behavior: smooth; }
    .wrap.sepia { --bg: #f4ecd8; --text: #4a3b2a; --muted: #8a7760; --line: rgba(90,60,20,.12); --link: #8a4b14; --bar: rgba(244,236,216,.86); }
    .wrap.dark { --bg: #1b1a20; --text: #e6e4ea; --muted: #9b98a6; --line: rgba(255,255,255,.09); --link: #9db3ff; --bar: rgba(27,26,32,.86); }
    @keyframes in { from { opacity: 0; transform: translateY(14px); } }
    .bar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: var(--bar); backdrop-filter: blur(14px) saturate(1.6); border-bottom: 1px solid var(--line); font: 13px "Segoe UI", system-ui, sans-serif; }
    .bar .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
    .bar button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; min-width: 32px; padding: 0 10px; border: 0; border-radius: 10px; background: transparent; color: var(--text); font: 600 13px "Segoe UI", system-ui, sans-serif; cursor: pointer; }
    .bar button:hover { background: var(--line); }
    .bar button.on { background: var(--line); }
    .bar svg { width: 17px; height: 17px; }
    .sep { width: 1px; height: 20px; background: var(--line); margin: 0 4px; }
    .dot { width: 18px; height: 18px; min-width: 18px !important; padding: 0 !important; border-radius: 50% !important; box-shadow: inset 0 0 0 1.5px var(--line), 0 0 0 0 var(--link); }
    .dot.on { box-shadow: inset 0 0 0 1.5px var(--line), 0 0 0 2px var(--link); }
    .doc { margin: 0 auto; padding: 48px 24px 120px; max-width: var(--w, 700px); font-size: var(--size, 20px); line-height: 1.7; }
    .doc.serif { font-family: Georgia, "Iowan Old Style", "Times New Roman", serif; }
    .doc.sans { font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
    .site { font: 600 13px "Segoe UI", system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase; color: var(--link); }
    h1.title { font-size: 1.9em; line-height: 1.2; margin: .3em 0 .35em; letter-spacing: -.01em; }
    .info { font: 13.5px "Segoe UI", system-ui, sans-serif; color: var(--muted); margin-bottom: 2em; padding-bottom: 1.4em; border-bottom: 1px solid var(--line); }
    .body h2, .body h3, .body h4 { line-height: 1.3; margin: 1.6em 0 .5em; }
    .body p { margin: 0 0 1.1em; }
    .body img, .body video { display: block; max-width: 100%; height: auto; margin: 1.4em auto; border-radius: 10px; }
    .body figure { margin: 1.4em 0; }
    .body figcaption { font: 14px "Segoe UI", system-ui, sans-serif; color: var(--muted); text-align: center; margin-top: -.6em; }
    .body a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 3px; }
    .body blockquote { margin: 1.4em 0; padding: .2em 0 .2em 1.1em; border-left: 3px solid var(--link); color: var(--muted); font-style: italic; }
    .body pre, .body code { font-family: "Cascadia Code", Consolas, monospace; font-size: .82em; }
    .body pre { padding: 14px 16px; border-radius: 10px; background: var(--line); overflow: auto; line-height: 1.5; }
    .body table { border-collapse: collapse; width: 100%; font-size: .85em; margin: 1.2em 0; }
    .body td, .body th { border: 1px solid var(--line); padding: 6px 8px; }
    .body ul, .body ol { padding-left: 1.4em; margin: 0 0 1.1em; }
    .body li { margin: .3em 0; }
    .reading { background: color-mix(in srgb, var(--link) 18%, transparent); border-radius: 4px; }
    @media (max-width: 700px) { .bar .label { display: none; } .doc { padding-top: 28px; } }
    .fab { position: fixed; right: 22px; bottom: 22px; z-index: 2147483645; width: 46px; height: 46px; border: 0; border-radius: 50%; display: grid; place-items: center; cursor: pointer; color: #fff;
      background: linear-gradient(135deg, #2fb67c, #13866a); box-shadow: 0 8px 24px rgba(0,0,0,.25); transition: transform .25s cubic-bezier(.3,1.5,.5,1), opacity .2s; animation: pop .4s cubic-bezier(.3,1.5,.5,1); }
    .fab:hover { transform: scale(1.08); }
    .fab svg { width: 20px; height: 20px; }
    @keyframes pop { from { transform: scale(.4); opacity: 0; } }
  `;

  function ensureHost() {
    if (host) return;
    host = document.createElement('tuff-reader');
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${STYLE}</style>`;
    document.documentElement.appendChild(host);
  }

  const WIDTHS = { narrow: '600px', medium: '700px', wide: '860px' };
  function applyCfg() {
    const wrap = root?.querySelector('.wrap');
    if (!wrap) return;
    wrap.className = `wrap ${cfg.theme === 'light' ? '' : cfg.theme}`;
    const art = wrap.querySelector('.doc');
    art.className = `doc ${cfg.font}`;
    art.style.setProperty('--size', `${cfg.size}px`);
    art.style.setProperty('--w', WIDTHS[cfg.width] || WIDTHS.medium);
    wrap.querySelectorAll('[data-theme]').forEach((b) => b.classList.toggle('on', b.dataset.theme === cfg.theme));
    wrap.querySelector('[data-a="font"] .label').textContent = cfg.font === 'serif' ? 'Serifa' : 'Sem serifa';
  }
  const saveCfg = () => tuff.storage.set('cfg', { ...cfg }).catch(() => {});

  function openReader() {
    const art = findArticle();
    if (!art) {
      tuff.notify('Não encontrei um artigo para ler nesta página');
      return;
    }
    ensureHost();
    const body = clean(art);
    const title = meta('og:title', 'twitter:title') || document.querySelector('h1')?.textContent.trim() || document.title;
    const site = meta('og:site_name', 'application-name') || location.hostname.replace(/^www\./, '');
    const author = meta('author', 'article:author', 'parsely-author');
    const words = (body.textContent.match(/\S+/g) || []).length;
    const minutes = Math.max(1, Math.round(words / 200));
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `<div class="bar">
        <button data-a="close" title="Fechar (Esc)">${svg('close')}</button>
        <span class="grow"></span>
        <button data-a="smaller" title="Diminuir a letra">${svg('minus')}</button>
        <button data-a="bigger" title="Aumentar a letra">${svg('plus')}</button>
        <span class="sep"></span>
        <button data-a="font" title="Trocar a fonte"><span class="label"></span></button>
        <span class="sep"></span>
        <button class="dot" data-theme="light" title="Claro" style="background:#fbfaf7"></button>
        <button class="dot" data-theme="sepia" title="Sépia" style="background:#f4ecd8"></button>
        <button class="dot" data-theme="dark" title="Escuro" style="background:#1b1a20"></button>
        <span class="sep"></span>
        <button data-a="speak" title="Ouvir o texto">${svg('play')}<span class="label">Ouvir</span></button>
      </div>
      <main class="doc"><div class="site"></div><h1 class="title"></h1><div class="info"></div><div class="body"></div></main>`;
    wrap.querySelector('.grow').textContent = site;
    wrap.querySelector('.site').textContent = site;
    wrap.querySelector('.title').textContent = title;
    wrap.querySelector('.info').textContent = `${author ? `${author} · ` : ''}${minutes} min de leitura`;
    wrap.querySelector('.body').appendChild(body);
    root.querySelector('.wrap')?.remove();
    root.appendChild(wrap);
    applyCfg();
    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    open = true;
    fab?.remove();
    fab = null;

    wrap.querySelector('.bar').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.theme) cfg.theme = b.dataset.theme;
      else if (b.dataset.a === 'close') return closeReader();
      else if (b.dataset.a === 'smaller') cfg.size = Math.max(14, cfg.size - 2);
      else if (b.dataset.a === 'bigger') cfg.size = Math.min(34, cfg.size + 2);
      else if (b.dataset.a === 'font') cfg.font = cfg.font === 'serif' ? 'sans' : 'serif';
      else if (b.dataset.a === 'speak') return speak(b);
      applyCfg();
      saveCfg();
    });
    wrap.querySelector('.body').addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (a) {
        e.preventDefault();
        location.href = a.href;
      }
    });
  }

  function closeReader() {
    if (!open) return;
    open = false;
    speechSynthesis.cancel();
    root.querySelector('.wrap')?.remove();
    document.documentElement.style.overflow = prevOverflow;
    maybeFab();
  }

  // ---- Ouvir o texto (voz do Windows)
  function speak(btn) {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      btn.innerHTML = `${svg('play')}<span class="label">Ouvir</span>`;
      return;
    }
    const body = root.querySelector('.body');
    const blocks = [...body.querySelectorAll('h2, h3, h4, p, li, blockquote')].filter((el) => textLen(el) > 1);
    const lang = document.documentElement.lang || 'pt-BR';
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
    btn.innerHTML = `${svg('pause')}<span class="label">Parar</span>`;
    let i = 0;
    const next = () => {
      body.querySelector('.reading')?.classList.remove('reading');
      if (i >= blocks.length || !open) {
        btn.innerHTML = `${svg('play')}<span class="label">Ouvir</span>`;
        return;
      }
      const el = blocks[i++];
      el.classList.add('reading');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const u = new SpeechSynthesisUtterance(el.textContent.trim());
      u.lang = lang;
      if (voice) u.voice = voice;
      u.onend = next;
      u.onerror = () => body.querySelector('.reading')?.classList.remove('reading');
      speechSynthesis.speak(u);
    };
    next();
  }

  // ---- Botão flutuante nas páginas de artigo (opcional)
  function maybeFab() {
    if (!cfg.fab || open) {
      fab?.remove();
      fab = null;
      return;
    }
    if (fab || !findArticle()) return;
    ensureHost();
    fab = document.createElement('button');
    fab.className = 'fab';
    fab.title = 'Abrir no modo leitura (Alt+R)';
    fab.innerHTML = svg('book');
    fab.addEventListener('click', openReader);
    root.appendChild(fab);
  }

  const toggle = () => (open ? closeReader() : openReader());
  document.addEventListener('tuff-reader-toggle', toggle);
  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      toggle();
    } else if (open && e.key === 'Escape') {
      e.preventDefault();
      closeReader();
    }
  }, true);
  tuff.storage.onChanged((c) => {
    if (!('cfg' in c)) return;
    cfg = { ...DEFAULTS, ...(c.cfg || {}) };
    applyCfg();
    maybeFab();
  });
  (async () => {
    try {
      cfg = { ...DEFAULTS, ...((await tuff.storage.get('cfg')) || {}) };
    } catch { /* padrão */ }
    if (cfg.fab) setTimeout(maybeFab, 1200);
  })();
})();
