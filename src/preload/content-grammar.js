'use strict';
// PulseBrowser - corretor gramatical nas páginas (no estilo do Grammarly).
// Sublinha erros em caixas de texto e campos editáveis, mostra sugestões ao passar o mouse
// e permite corrigir com um clique. Roda no mundo isolado: o site não vê este script.
const { ipcRenderer } = require('electron');

(() => {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  try {
    if (window.top !== window) return;
  } catch {
    return;
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  const KIND_LABEL = { spelling: 'Ortografia', grammar: 'Gramática', style: 'Estilo', punct: 'Pontuação' };
  const KIND_TITLE = {
    spelling: 'Possível erro de ortografia',
    grammar: 'Possível erro de gramática',
    style: 'Sugestão de estilo',
    punct: 'Pontuação ou digitação',
  };
  const SKIP = '.CodeMirror, .cm-editor, .monaco-editor, .ace_editor, .ql-code-block, pre, code, [data-gramm="false"], [data-enable-grammarly="false"], [data-pulse-grammar="off"]';
  const WORD = /[\p{L}\p{N}_'’-]/u;

  let config = null;
  let configPromise = null;
  const checkers = new WeakMap(); // campo -> Checker
  const active = new Set();
  let focused = null;
  let fieldSeq = 0;
  const ui = { host: null, root: null, badge: null, card: null, panel: null };
  let docSheet = null;
  let tickTimer = null;

  // ---------------------------------------------------------------- Utilidades
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function svgIcon(shapes, size = 14) {
    const s = document.createElementNS(SVGNS, 'svg');
    const attrs = {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    };
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, String(v));
    for (const [tag, a] of shapes) {
      const n = document.createElementNS(SVGNS, tag);
      for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
      s.appendChild(n);
    }
    return s;
  }
  const ICON = {
    check: [['polyline', { points: '20 6 9 17 4 12' }]],
    x: [['line', { x1: 18, y1: 6, x2: 6, y2: 18 }], ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]],
    alert: [['circle', { cx: 12, cy: 12, r: 9 }], ['line', { x1: 12, y1: 8, x2: 12, y2: 12.5 }], ['line', { x1: 12, y1: 16, x2: 12.01, y2: 16 }]],
    spell: [['path', { d: 'm6 16 6-12 6 12' }], ['path', { d: 'M8 12h8' }], ['path', { d: 'm16 20 2 2 4-4' }]],
    arrow: [['line', { x1: 5, y1: 12, x2: 19, y2: 12 }], ['polyline', { points: '13 6 19 12 13 18' }]],
    wand: [['path', { d: 'm3 21 9-9' }], ['path', { d: 'M15 4V2' }], ['path', { d: 'M15 16v-2' }], ['path', { d: 'M8 9h2' }], ['path', { d: 'M20 9h2' }], ['path', { d: 'M17.8 11.8 19 13' }], ['path', { d: 'M17.8 6.2 19 5' }], ['path', { d: 'M12.2 6.2 11 5' }]],
    globe: [['circle', { cx: 12, cy: 12, r: 9 }], ['line', { x1: 3, y1: 12, x2: 21, y2: 12 }], ['path', { d: 'M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18' }]],
  };

  function animationsOn() {
    return config?.animations !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function kindColor(kind) {
    if (kind === 'spelling') return '#e5484d';
    if (kind === 'style') return config?.accent || '#7c5cff';
    return '#f59e0b';
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0];
      prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
        diag = tmp;
      }
    }
    return prev[b.length];
  }

  // Ajusta as posições dos erros depois de uma edição (sem esperar nova verificação).
  function rebase(matches, a, b) {
    if (a === b) return matches;
    const max = Math.min(a.length, b.length);
    let p = 0;
    while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
    let s = 0;
    while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
    const oldEnd = a.length - s;
    const delta = b.length - a.length;
    const out = [];
    for (const m of matches) {
      const end = m.offset + m.length;
      if (end < p || (end === p && !WORD.test(b[p] || ' '))) out.push(m);
      else if (m.offset > oldEnd || (m.offset === oldEnd && !WORD.test(b[oldEnd + delta - 1] || ' '))) out.push({ ...m, offset: m.offset + delta });
    }
    return out;
  }

  function editingHost(node) {
    if (!(node instanceof HTMLElement)) return null;
    if (node instanceof HTMLTextAreaElement) return node;
    if (!node.isContentEditable) return null;
    let host = node;
    while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement;
    return host;
  }

  function eligible(field) {
    if (!field || !field.isConnected) return false;
    if (field instanceof HTMLTextAreaElement) {
      if (field.readOnly || field.disabled) return false;
    } else if (!field.isContentEditable || field === document.body || field === document.documentElement) {
      return false;
    }
    if (field.getAttribute('spellcheck') === 'false') return false;
    if (field.closest(SKIP)) return false;
    const r = field.getBoundingClientRect();
    return r.width >= 120 && r.height >= 22;
  }

  function insideOurUi(node) {
    return !!ui.host && (node === ui.host || ui.host.contains(node));
  }

  // ---------------------------------------------------------------- Configuração e estilos
  function loadConfig(force = false) {
    if (configPromise && !force) return configPromise;
    configPromise = ipcRenderer.invoke('grammar:config').then((c) => {
      config = c;
      applyTheme();
      return c;
    }).catch(() => {
      config = null;
      return null;
    });
    return configPromise;
  }

  function usable() {
    return !!config && config.enabled && !config.disabled;
  }

  function docCss() {
    const accent = config?.accent || '#7c5cff';
    const deco = (c) => `text-decoration: underline wavy ${c}; text-decoration-thickness: 1.5px; text-underline-offset: 3px; text-decoration-skip-ink: none;`;
    return `
      ::highlight(pulse-gr-spelling) { ${deco('#e5484d')} }
      ::highlight(pulse-gr-grammar), ::highlight(pulse-gr-punct) { ${deco('#f59e0b')} }
      ::highlight(pulse-gr-style) { ${deco(accent)} }
      ::highlight(pulse-gr-active) { background-color: rgba(229, 72, 77, .18); }
      ::highlight(pulse-gr-fixed) { background-color: rgba(34, 163, 90, .28); }
    `;
  }

  function ensureDocSheet() {
    try {
      if (!docSheet) {
        docSheet = new CSSStyleSheet();
        docSheet.replaceSync(docCss());
      }
      if (!document.adoptedStyleSheets.includes(docSheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, docSheet];
    } catch { /* ignora */ }
  }

  const UI_CSS = `
    :host { all: initial; }
    .mirror {
      position: fixed; z-index: 2147483640; pointer-events: none; overflow: hidden; box-sizing: border-box;
      margin: 0; border: 0; background: transparent; color: transparent; -webkit-text-fill-color: transparent;
    }
    .mirror .u { text-decoration: underline wavy var(--c); text-decoration-thickness: 1.5px; text-underline-offset: 3px;
      text-decoration-skip-ink: none; border-radius: 3px; transition: background-color .15s; }
    .mirror .u.spelling { --c: #e5484d; }
    .mirror .u.grammar, .mirror .u.punct { --c: #f59e0b; }
    .mirror .u.style { --c: var(--accent); }
    .mirror .u.on { background: color-mix(in srgb, var(--c) 20%, transparent); }
    .anim .mirror .u.fresh { animation: u-in .45s ease-out; }
    @keyframes u-in { from { text-decoration-color: transparent; } }

    .badge {
      position: fixed; z-index: 2147483646; width: 24px; height: 24px; border-radius: 50%; box-sizing: border-box;
      display: grid; place-items: center; cursor: pointer; pointer-events: auto; user-select: none;
      font: 700 11px/1 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; color: #fff;
      background: var(--accent); box-shadow: 0 2px 10px rgba(15, 12, 30, .28);
      transition: transform .25s cubic-bezier(.3, 1.6, .5, 1), background-color .3s, opacity .2s;
    }
    .badge:hover { transform: scale(1.15); }
    .badge:active { transform: scale(.9); }
    .badge.ok { background: #22a35a; }
    .badge.issues { background: #e5484d; }
    .badge.issues.soft { background: #f59e0b; }
    .badge.issues.styleonly { background: var(--accent); }
    .badge.error { background: #8a8994; }
    .badge.checking::after {
      content: ""; position: absolute; inset: -4px; border-radius: 50%;
      border: 2px solid transparent; border-top-color: var(--accent); border-right-color: var(--accent);
      animation: spin .8s linear infinite;
    }
    .badge svg { display: block; }
    .anim .badge.enter { animation: badge-in .4s cubic-bezier(.2, 1.6, .4, 1); }
    .anim .badge .n, .anim .badge svg { animation: pop .35s cubic-bezier(.2, 1.6, .4, 1); }
    @keyframes badge-in { from { transform: scale(0); opacity: 0; } }
    @keyframes pop { from { transform: scale(.3); opacity: 0; } }
    @keyframes spin { to { transform: rotate(360deg); } }

    .card, .panel {
      position: fixed; z-index: 2147483647; box-sizing: border-box; pointer-events: auto;
      background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 14px;
      box-shadow: 0 14px 38px rgba(15, 12, 30, .26), 0 2px 8px rgba(15, 12, 30, .14);
      font: 13px/1.4 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
      user-select: none; transform-origin: top left;
    }
    .card { width: 330px; padding: 12px 14px 10px; }
    .panel { width: 360px; max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; transform-origin: bottom right; }
    .anim .card, .anim .panel { animation: card-in .26s cubic-bezier(.2, .9, .3, 1.15); }
    .anim .card.up { transform-origin: bottom left; }
    .card.leaving, .panel.leaving { animation: card-out .12s ease-in forwards !important; pointer-events: none; }
    @keyframes card-in { from { opacity: 0; transform: translateY(-6px) scale(.95); } }
    @keyframes card-out { to { opacity: 0; transform: translateY(-4px) scale(.97); } }
    .head { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--kc); flex: none; }
    .grow { flex: 1; }
    .x { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; color: var(--muted); cursor: pointer; }
    .x:hover { background: var(--hover); color: var(--fg); }
    .title { font-weight: 600; font-size: 14px; margin: 6px 0 2px; }
    .msg { color: var(--muted); }
    .fix { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 10px 0 4px; }
    .orig { text-decoration: line-through; text-decoration-color: var(--kc); color: var(--muted); white-space: pre; max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
    .arr { color: var(--muted); display: grid; }
    .pill {
      border: 0; font: inherit; font-weight: 600; color: #fff; background: var(--kc); cursor: pointer;
      padding: 5px 12px; border-radius: 16px; white-space: pre; max-width: 260px; overflow: hidden; text-overflow: ellipsis;
      transition: transform .2s cubic-bezier(.3, 1.6, .5, 1), filter .15s, box-shadow .2s;
    }
    .pill:hover { filter: brightness(1.08); transform: translateY(-1px); box-shadow: 0 4px 12px color-mix(in srgb, var(--kc) 40%, transparent); }
    .pill:active { transform: scale(.94); }
    .pill.alt { background: color-mix(in srgb, var(--kc) 14%, transparent); color: var(--fg); }
    .anim .pill { animation: pill-in .3s cubic-bezier(.2, 1.3, .4, 1) backwards; animation-delay: calc(var(--i, 0) * 35ms + 60ms); }
    @keyframes pill-in { from { opacity: 0; transform: translateY(4px) scale(.9); } }
    .acts { display: flex; gap: 4px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
    .act { border: 0; background: none; font: inherit; color: var(--muted); padding: 5px 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .act:hover { background: var(--hover); color: var(--fg); }
    .lang { color: var(--muted); font-size: 11px; font-weight: 500; text-transform: none; letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }

    .p-head { display: flex; align-items: center; gap: 10px; padding: 14px 14px 10px; }
    .logo { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; color: #fff; flex: none;
      background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 50%, #ff4d8d)); }
    .p-title { font-weight: 700; font-size: 14px; }
    .p-sub { color: var(--muted); font-size: 12px; }
    .p-body { overflow: auto; padding: 0 8px 6px; }
    .row { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 10px; }
    .row:hover { background: var(--hover); }
    .anim .row { animation: row-in .3s cubic-bezier(.2, .9, .3, 1) backwards; animation-delay: calc(var(--i, 0) * 25ms + 40ms); }
    @keyframes row-in { from { opacity: 0; transform: translateX(-6px); } }
    .row .txt { flex: 1; min-width: 0; }
    .row .w { display: flex; gap: 6px; align-items: center; font-weight: 600; white-space: nowrap; overflow: hidden; }
    .row .w .orig { max-width: 110px; }
    .row .m { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row .pill { padding: 3px 10px; font-size: 12px; max-width: 120px; }
    .empty { text-align: center; padding: 18px 12px 22px; color: var(--muted); }
    .empty .big { width: 46px; height: 46px; border-radius: 50%; margin: 0 auto 10px; display: grid; place-items: center; color: #fff; background: #22a35a; }
    .anim .empty .big { animation: pop .5s cubic-bezier(.2, 1.6, .4, 1); }
    .p-foot { border-top: 1px solid var(--border); padding: 10px 14px 12px; display: grid; gap: 8px; }
    .line { display: flex; align-items: center; gap: 8px; }
    .line label { color: var(--muted); font-size: 12px; display: flex; align-items: center; gap: 6px; }
    select { flex: 1; min-width: 0; height: 30px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg2); color: var(--fg); font: inherit; padding: 0 6px; outline: 0; }
    select:focus { border-color: var(--accent); }
    .btn { border: 0; font: inherit; font-weight: 600; cursor: pointer; height: 32px; padding: 0 14px; border-radius: 16px; color: #fff; background: var(--accent);
      display: inline-flex; align-items: center; gap: 6px; justify-content: center; transition: transform .2s cubic-bezier(.3, 1.6, .5, 1), filter .15s; }
    .btn:hover { filter: brightness(1.08); }
    .btn:active { transform: scale(.95); }
    .links { display: flex; justify-content: space-between; gap: 8px; }
    .link { border: 0; background: none; font: inherit; font-size: 12px; color: var(--accent); cursor: pointer; padding: 2px 0; }
    .link:hover { text-decoration: underline; }
    .note { color: var(--muted); font-size: 11.5px; }
    .err { color: #e5484d; }
  `;

  function ensureUi() {
    if (ui.host && ui.host.isConnected) return ui.root;
    const root = document.documentElement;
    if (!root) return null;
    const host = document.createElement('pulse-grammar');
    for (const [k, v] of [['all', 'initial'], ['position', 'fixed'], ['top', '0'], ['left', '0'], ['width', '0'], ['height', '0'], ['z-index', '2147483647']]) {
      host.style.setProperty(k, v, 'important');
    }
    const shadow = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(UI_CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      shadow.appendChild(el('style', null, UI_CSS));
    }
    const wrap = el('div', 'wrap');
    shadow.appendChild(wrap);
    // Cliques no cartão não tiram o foco do texto (exceto na lista de idiomas).
    shadow.addEventListener('mousedown', (e) => {
      const path = e.composedPath();
      if (!path.some((n) => n instanceof HTMLSelectElement)) e.preventDefault();
    });
    root.appendChild(host);
    ui.host = host;
    ui.root = wrap;
    // Mirrors dos campos que já existiam.
    for (const c of active) if (c.mirror) wrap.appendChild(c.mirror);
    applyTheme();
    return wrap;
  }

  function applyTheme() {
    if (docSheet) {
      try {
        docSheet.replaceSync(docCss());
      } catch { /* ignora */ }
    }
    if (!ui.root) return;
    const dark = config?.dark ?? matchMedia('(prefers-color-scheme: dark)').matches;
    const vars = dark
      ? { '--bg': '#2b2a31', '--bg2': '#232228', '--fg': '#f1f1f4', '--muted': '#a8a7b3', '--border': 'rgba(255,255,255,.1)', '--hover': 'rgba(255,255,255,.08)' }
      : { '--bg': '#ffffff', '--bg2': '#f5f4f9', '--fg': '#1d1c22', '--muted': '#6b6a75', '--border': 'rgba(20,16,40,.12)', '--hover': 'rgba(20,16,40,.06)' };
    vars['--accent'] = config?.accent || '#7c5cff';
    for (const [k, v] of Object.entries(vars)) ui.root.style.setProperty(k, v);
    ui.root.classList.toggle('anim', animationsOn());
  }

  // ---------------------------------------------------------------- Realces (campos editáveis)
  function updateHighlights() {
    if (!window.CSS || !CSS.highlights || typeof Highlight !== 'function') return;
    const groups = { spelling: [], grammar: [], style: [], punct: [] };
    let hover = null;
    for (const c of active) {
      if (c.isTA || !c.ranges) continue;
      c.ranges.forEach((r, i) => {
        if (!r) return;
        (groups[c.matches[i]?.kind] || groups.grammar).push(r);
        if (i === c.hoverIndex) hover = r;
      });
    }
    try {
      for (const [k, list] of Object.entries(groups)) {
        const name = `pulse-gr-${k}`;
        if (list.length) CSS.highlights.set(name, new Highlight(...list));
        else CSS.highlights.delete(name);
      }
      if (hover) CSS.highlights.set('pulse-gr-active', new Highlight(hover));
      else CSS.highlights.delete('pulse-gr-active');
    } catch { /* ignora */ }
    ensureDocSheet();
  }

  function flashFixed(range) {
    if (!range || !window.CSS || !CSS.highlights || !animationsOn()) return;
    try {
      CSS.highlights.set('pulse-gr-fixed', new Highlight(range));
      setTimeout(() => CSS.highlights.delete('pulse-gr-fixed'), 650);
    } catch { /* ignora */ }
  }

  // ---------------------------------------------------------------- Verificador de um campo
  class Checker {
    constructor(field) {
      this.field = field;
      this.id = `f${++fieldSeq}`;
      this.isTA = field instanceof HTMLTextAreaElement;
      this.text = '';
      this.segs = [];
      this.matches = [];
      this.ranges = [];
      this.ignored = new Set();
      this.token = 0;
      this.timer = null;
      this.status = 'idle';
      this.language = null;
      this.error = '';
      this.mirror = null;
      this.hoverIndex = -1;
      this.freshUntil = 0;
      checkers.set(field, this);
      active.add(this);
      this.read();
      if (this.isTA) this.buildMirror();
      else {
        this.observer = new MutationObserver(() => {
          clearTimeout(this.mutTimer);
          this.mutTimer = setTimeout(() => this.onInput(), 120);
        });
        this.observer.observe(field, { characterData: true, childList: true, subtree: true });
      }
      startTick();
      this.schedule(400);
    }

    destroy() {
      clearTimeout(this.timer);
      clearTimeout(this.mutTimer);
      this.observer?.disconnect();
      if (this.mirror) this.mirror.remove();
      if (this.onScroll) this.field.removeEventListener('scroll', this.onScroll);
      active.delete(this);
      checkers.delete(this.field);
      if (focused === this) focused = null;
      this.ranges = [];
      updateHighlights();
      renderBadge();
    }

    // Lê o texto do campo (e, em campos editáveis, guarda onde está cada pedaço no DOM).
    read() {
      if (this.isTA) {
        this.text = this.field.value;
        return;
      }
      const segs = [];
      let text = '';
      const BLOCK = /^(P|DIV|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|TR|TABLE|SECTION|ARTICLE|HEADER|FOOTER|DD|DT|FIGURE|FIGCAPTION)$/;
      const walk = (node) => {
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 3) {
            const v = c.nodeValue;
            if (v) {
              segs.push({ node: c, start: text.length, end: text.length + v.length });
              text += v;
            }
          } else if (c.nodeType === 1) {
            const tag = c.tagName;
            if (tag === 'BR') {
              text += '\n';
              continue;
            }
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || c.getAttribute('contenteditable') === 'false' || c.matches(SKIP)) {
              text += ' ';
              continue;
            }
            const block = BLOCK.test(tag);
            if (block && text && !text.endsWith('\n')) text += '\n';
            walk(c);
            if (block && text && !text.endsWith('\n')) text += '\n';
          }
        }
      };
      walk(this.field);
      this.text = text;
      this.segs = segs;
    }

    posAt(off, isEnd) {
      const segs = this.segs;
      let lo = 0;
      let hi = segs.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const s = segs[mid];
        if (off < s.start) hi = mid - 1;
        else if (off > s.end) lo = mid + 1;
        else {
          if (!isEnd && off === s.end && segs[mid + 1] && segs[mid + 1].start === off) return { node: segs[mid + 1].node, offset: 0 };
          return { node: s.node, offset: off - s.start };
        }
      }
      return null;
    }

    rangeFor(offset, length) {
      const a = this.posAt(offset, false);
      const b = this.posAt(offset + length, true);
      if (!a || !b) return null;
      try {
        const r = document.createRange();
        r.setStart(a.node, a.offset);
        r.setEnd(b.node, b.offset);
        return r;
      } catch {
        return null;
      }
    }

    offsetOf(node, offset) {
      if (node.nodeType === 3) {
        const s = this.segs.find((x) => x.node === node);
        return s ? s.start + Math.min(offset, s.end - s.start) : -1;
      }
      const child = node.childNodes[offset];
      if (!child) {
        let last = -1;
        for (const s of this.segs) if (node.contains(s.node)) last = s.end;
        return last < 0 ? this.text.length : last;
      }
      for (const s of this.segs) {
        if (child === s.node || child.contains(s.node) || (child.compareDocumentPosition(s.node) & Node.DOCUMENT_POSITION_FOLLOWING)) return s.start;
      }
      return this.text.length;
    }

    caretOffset() {
      if (this.isTA) return this.field.selectionEnd ?? -1;
      const sel = getSelection();
      if (!sel || !sel.rangeCount || !this.field.contains(sel.focusNode)) return -1;
      return this.offsetOf(sel.focusNode, sel.focusOffset);
    }

    setCaret(offset) {
      if (this.isTA) {
        this.field.setSelectionRange(offset, offset);
        return;
      }
      this.read();
      const p = this.posAt(offset, true);
      if (!p) return;
      const sel = getSelection();
      const r = document.createRange();
      r.setStart(p.node, p.offset);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }

    onInput() {
      if (!this.field.isConnected) {
        this.destroy();
        return;
      }
      const old = this.text;
      this.read();
      if (old === this.text) return;
      this.matches = rebase(this.matches, old, this.text);
      if (this.hoverIndex >= this.matches.length) this.hoverIndex = -1;
      hideCard();
      this.render();
      this.schedule();
    }

    schedule(delay = 1100) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.check(), delay);
    }

    setStatus(status) {
      this.status = status;
      if (focused === this) renderBadge();
      if (ui.panel && ui.panel.checker === this) renderPanel(this);
    }

    async check() {
      if (!this.field.isConnected) {
        this.destroy();
        return;
      }
      if (!usable()) return;
      this.read();
      const text = this.text;
      if (text.trim().length < 3) {
        this.matches = [];
        this.render();
        this.setStatus('idle');
        return;
      }
      const token = ++this.token;
      this.setStatus('checking');
      let res;
      try {
        res = await ipcRenderer.invoke('grammar:check', { text, field: this.id, token });
      } catch {
        res = { error: 'Não foi possível verificar o texto.', matches: [] };
      }
      if (token !== this.token || !this.field.isConnected) return;
      if (!res || res.stale) return;
      if (res.disabled) {
        this.matches = [];
        this.render();
        this.setStatus('idle');
        return;
      }
      if (res.error) {
        this.error = res.error;
        this.setStatus('error');
        if (res.code === 'rate') this.schedule(20000);
        return;
      }
      this.error = '';
      this.language = res.language || null;
      this.read();
      let matches = (res.matches || [])
        .map((m) => ({ ...m, word: text.slice(m.offset, m.offset + m.length) }))
        .filter((m) => !this.ignored.has(`${m.rule}|${m.word}`));
      if (this.text !== text) matches = rebase(matches, text, this.text);
      this.matches = matches;
      this.freshUntil = Date.now() + 600;
      this.render();
      this.setStatus(this.matches.length ? 'issues' : 'ok');
      if (config.autoFix && focused === this) this.autoFix();
    }

    render() {
      if (this.isTA) this.renderMirror();
      else {
        this.ranges = this.matches.map((m) => this.rangeFor(m.offset, m.length));
        updateHighlights();
      }
      if (focused === this) renderBadge();
    }

    // ---- Caixas de texto (textarea): uma cópia invisível do texto desenha os sublinhados.
    buildMirror() {
      const m = el('div', 'mirror');
      this.mirror = m;
      const root = ensureUi();
      if (root) root.appendChild(m);
      this.onScroll = () => {
        m.scrollTop = this.field.scrollTop;
        m.scrollLeft = this.field.scrollLeft;
      };
      this.field.addEventListener('scroll', this.onScroll, { passive: true });
      this.syncMirror();
    }

    syncMirror() {
      const m = this.mirror;
      if (!m) return;
      const f = this.field;
      const cs = getComputedStyle(f);
      if (!f.isConnected || cs.display === 'none' || cs.visibility === 'hidden') {
        m.style.display = 'none';
        return;
      }
      const props = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch', 'fontKerning', 'lineHeight', 'letterSpacing', 'wordSpacing',
        'textIndent', 'textTransform', 'textAlign', 'direction', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'whiteSpace', 'wordBreak', 'overflowWrap', 'textRendering'];
      for (const p of props) if (m.style[p] !== cs[p]) m.style[p] = cs[p];
      const r = f.getBoundingClientRect();
      const bl = parseFloat(cs.borderLeftWidth) || 0;
      const bt = parseFloat(cs.borderTopWidth) || 0;
      m.style.display = '';
      m.style.left = `${r.left + bl}px`;
      m.style.top = `${r.top + bt}px`;
      m.style.width = `${f.clientWidth}px`;
      m.style.height = `${f.clientHeight}px`;
      // Recorta o que estiver escondido por áreas roláveis da página.
      const vis = visibleRect(f);
      if (!vis) {
        m.style.display = 'none';
        return;
      }
      const top = Math.max(0, vis.top - (r.top + bt));
      const left = Math.max(0, vis.left - (r.left + bl));
      const bottom = Math.max(0, (r.top + bt + f.clientHeight) - vis.bottom);
      const right = Math.max(0, (r.left + bl + f.clientWidth) - vis.right);
      m.style.clipPath = top || left || bottom || right ? `inset(${top}px ${right}px ${bottom}px ${left}px)` : '';
      m.scrollTop = f.scrollTop;
      m.scrollLeft = f.scrollLeft;
    }

    renderMirror() {
      const m = this.mirror;
      if (!m) return;
      if (!m.isConnected) ensureUi()?.appendChild(m);
      m.textContent = '';
      const text = this.text;
      const fresh = Date.now() < this.freshUntil;
      let pos = 0;
      const frag = document.createDocumentFragment();
      this.matches.forEach((mt, i) => {
        if (mt.offset < pos) return;
        if (mt.offset > pos) frag.appendChild(document.createTextNode(text.slice(pos, mt.offset)));
        const span = el('span', `u ${mt.kind}${i === this.hoverIndex ? ' on' : ''}${fresh ? ' fresh' : ''}`, text.slice(mt.offset, mt.offset + mt.length));
        span.dataset.i = String(i);
        frag.appendChild(span);
        pos = mt.offset + mt.length;
      });
      frag.appendChild(document.createTextNode(`${text.slice(pos)}​`));
      m.appendChild(frag);
      this.syncMirror();
    }

    rectsOf(i) {
      if (this.isTA) {
        const span = this.mirror?.querySelector(`.u[data-i="${i}"]`);
        return span ? [...span.getClientRects()] : [];
      }
      const r = this.ranges[i];
      return r ? [...r.getClientRects()] : [];
    }

    matchAt(x, y) {
      for (let i = 0; i < this.matches.length; i++) {
        for (const r of this.rectsOf(i)) {
          if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 2 && y <= r.bottom + 4) return i;
        }
      }
      return -1;
    }

    setHover(i) {
      if (this.hoverIndex === i) return;
      this.hoverIndex = i;
      if (this.isTA) {
        this.mirror?.querySelectorAll('.u.on').forEach((s) => s.classList.remove('on'));
        if (i >= 0) this.mirror?.querySelector(`.u[data-i="${i}"]`)?.classList.add('on');
      } else {
        updateHighlights();
      }
    }

    // Troca o trecho errado pela sugestão (com desfazer funcionando, via insertText).
    apply(index, value, { keepCaret = false } = {}) {
      const m = this.matches[index];
      if (!m) return false;
      this.read();
      if (this.text.slice(m.offset, m.offset + m.length) !== m.word) {
        this.schedule(0);
        return false;
      }
      const caret = keepCaret ? this.caretOffset() : -1;
      let ok = false;
      if (this.isTA) {
        const ta = this.field;
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(m.offset, m.offset + m.length);
        try {
          ok = value ? document.execCommand('insertText', false, value) : document.execCommand('delete');
        } catch {
          ok = false;
        }
        if (!ok) {
          ta.setRangeText(value, m.offset, m.offset + m.length, 'end');
          ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value }));
        }
      } else {
        const range = this.rangeFor(m.offset, m.length);
        if (!range) return false;
        this.field.focus({ preventScroll: true });
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        try {
          ok = value ? document.execCommand('insertText', false, value) : document.execCommand('delete');
        } catch {
          ok = false;
        }
        if (!ok) {
          range.deleteContents();
          if (value) range.insertNode(document.createTextNode(value));
          this.field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value }));
        }
      }
      this.onInput();
      if (!this.isTA) flashFixed(this.rangeFor(m.offset, value.length));
      if (keepCaret && caret >= 0) {
        const delta = value.length - m.length;
        this.setCaret(caret > m.offset ? caret + delta : caret);
      }
      return true;
    }

    fixable() {
      return this.matches.filter((m) => m.replacements.length && m.kind !== 'style');
    }

    fixAll() {
      const targets = this.fixable().sort((a, b) => b.offset - a.offset);
      let n = 0;
      for (const m of targets) {
        const i = this.matches.indexOf(m);
        if (i >= 0 && this.apply(i, m.replacements[0])) n++;
      }
      return n;
    }

    ignore(index) {
      const m = this.matches[index];
      if (!m) return;
      this.ignored.add(`${m.rule}|${m.word}`);
      this.matches = this.matches.filter((x) => x !== m);
      this.hoverIndex = -1;
      this.render();
      this.setStatus(this.matches.length ? 'issues' : 'ok');
    }

    // Correção automática (opcional): só erros de digitação óbvios em palavras já terminadas.
    autoFix() {
      const caret = this.caretOffset();
      if (caret < 0) return;
      const fixes = this.matches.filter((m) => m.kind === 'spelling' && m.replacements.length
        && m.offset + m.length < caret - 1 && m.length >= 3 && /^\p{Ll}/u.test(m.word)
        && !/\s/.test(m.replacements[0]) && levenshtein(m.word.toLowerCase(), m.replacements[0].toLowerCase()) <= 2);
      for (const m of fixes.sort((a, b) => b.offset - a.offset)) {
        const i = this.matches.indexOf(m);
        if (i >= 0) this.apply(i, m.replacements[0], { keepCaret: true });
      }
    }
  }

  function visibleRect(node) {
    let r = node.getBoundingClientRect();
    let top = Math.max(0, r.top);
    let left = Math.max(0, r.left);
    let bottom = Math.min(window.innerHeight, r.bottom);
    let right = Math.min(window.innerWidth, r.right);
    let p = node.parentElement;
    for (let depth = 0; p && p !== document.body && depth < 25; depth++, p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      r = p.getBoundingClientRect();
      top = Math.max(top, r.top);
      left = Math.max(left, r.left);
      bottom = Math.min(bottom, r.bottom);
      right = Math.min(right, r.right);
    }
    if (bottom - top < 2 || right - left < 2) return null;
    return { top, left, bottom, right };
  }

  // ---------------------------------------------------------------- Botão flutuante
  function badgeVisual(c) {
    const issues = c.matches.length;
    if (c.status === 'error') return { cls: 'error', icon: ICON.alert, title: c.error || 'Não foi possível verificar' };
    if (c.status === 'checking') return { cls: 'checking', icon: ICON.spell, title: 'Verificando...' };
    if (issues) {
      const hard = c.matches.some((m) => m.kind === 'spelling' || m.kind === 'grammar');
      const styleOnly = c.matches.every((m) => m.kind === 'style');
      return { cls: `issues${hard ? '' : styleOnly ? ' styleonly' : ' soft'}`, text: issues > 99 ? '99+' : String(issues), title: `${issues} sugestão(ões) — clique para ver` };
    }
    if (c.status === 'ok') return { cls: 'ok', icon: ICON.check, title: 'Tudo certo!' };
    return { cls: '', icon: ICON.spell, title: 'Corretor do PulseBrowser' };
  }

  function renderBadge() {
    const c = focused;
    if (!c || !usable() || !c.field.isConnected) {
      if (ui.badge) {
        ui.badge.remove();
        ui.badge = null;
      }
      return;
    }
    const root = ensureUi();
    if (!root) return;
    let b = ui.badge;
    const isNew = !b;
    if (!b) {
      b = el('div', 'badge enter');
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (ui.panel) hidePanel();
        else if (focused) showPanel(focused);
      });
      b.addEventListener('animationend', () => b.classList.remove('enter'));
      root.appendChild(b);
      ui.badge = b;
    }
    const v = badgeVisual(c);
    const key = `${v.cls}|${v.text || ''}`;
    if (b.dataset.key !== key) {
      b.dataset.key = key;
      b.className = `badge ${v.cls}${isNew ? ' enter' : ''}`;
      b.textContent = '';
      if (v.text) b.appendChild(el('span', 'n', v.text));
      else b.appendChild(svgIcon(v.icon, 13));
    }
    b.title = v.title;
    positionBadge();
  }

  function positionBadge() {
    const b = ui.badge;
    const c = focused;
    if (!b || !c) return;
    const r = c.field.getBoundingClientRect();
    const vis = visibleRect(c.field);
    if (!vis) {
      b.style.display = 'none';
      return;
    }
    b.style.display = '';
    const scrollbar = c.isTA ? Math.max(0, c.field.offsetWidth - c.field.clientWidth - 2) : 0;
    const left = Math.min(vis.right, r.right) - 30 - scrollbar;
    const top = r.height < 46 ? r.top + (r.height - 24) / 2 : Math.min(vis.bottom, r.bottom) - 30;
    b.style.left = `${Math.round(left)}px`;
    b.style.top = `${Math.round(Math.max(vis.top + 2, top))}px`;
  }

  // ---------------------------------------------------------------- Cartão de sugestão
  let cardTimer = null;
  let hideTimer = null;

  function hideCard(immediate = false) {
    clearTimeout(cardTimer);
    clearTimeout(hideTimer);
    const card = ui.card;
    if (!card) return;
    ui.card = null;
    if (card.checker && card.checker.hoverIndex >= 0) card.checker.setHover(-1);
    if (immediate || !animationsOn()) card.remove();
    else {
      card.classList.add('leaving');
      setTimeout(() => card.remove(), 130);
    }
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hideCard(), 320);
  }

  function place(box, rect, { prefer = 'below', align = 'left', gap = 6 } = {}) {
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    let top = prefer === 'below' ? rect.bottom + gap : rect.top - h - gap;
    let up = prefer !== 'below';
    if (prefer === 'below' && top + h > window.innerHeight - 6 && rect.top - h - gap > 6) {
      top = rect.top - h - gap;
      up = true;
    } else if (prefer !== 'below' && top < 6) {
      top = rect.bottom + gap;
      up = false;
    }
    let left = align === 'right' ? rect.right - w : rect.left;
    left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(Math.max(6, top))}px`;
    box.classList.toggle('up', up);
  }

  function showCard(c, index) {
    const m = c.matches[index];
    if (!m) return;
    const root = ensureUi();
    if (!root) return;
    hidePanel(true);
    hideCard(true);
    c.setHover(index);
    const card = el('div', 'card');
    card.checker = c;
    card.style.setProperty('--kc', kindColor(m.kind));
    const head = el('div', 'head');
    head.append(el('span', 'dot'), el('span', null, KIND_LABEL[m.kind] || 'Sugestão'), el('span', 'grow'));
    if (c.language?.name) head.appendChild(el('span', 'lang', c.language.name));
    const x = el('span', 'x');
    x.title = 'Fechar';
    x.appendChild(svgIcon(ICON.x, 14));
    x.addEventListener('click', () => hideCard());
    head.appendChild(x);
    card.appendChild(head);
    card.appendChild(el('div', 'title', m.short || KIND_TITLE[m.kind] || 'Sugestão'));
    if (m.message && m.message !== m.short) card.appendChild(el('div', 'msg', m.message));

    if (m.replacements.length) {
      const fix = el('div', 'fix');
      fix.append(el('span', 'orig', m.word || ' '));
      const arr = el('span', 'arr');
      arr.appendChild(svgIcon(ICON.arrow, 14));
      fix.appendChild(arr);
      m.replacements.slice(0, 5).forEach((rep, i) => {
        const b = el('button', `pill${i ? ' alt' : ''}`, rep === '' ? '(remover)' : rep);
        b.style.setProperty('--i', String(i));
        b.addEventListener('click', () => {
          const idx = c.matches.indexOf(m);
          hideCard(true);
          if (idx >= 0) c.apply(idx, rep);
        });
        fix.appendChild(b);
      });
      card.appendChild(fix);
    }

    const acts = el('div', 'acts');
    const ignore = el('button', 'act', 'Ignorar');
    ignore.addEventListener('click', () => {
      const idx = c.matches.indexOf(m);
      hideCard(true);
      if (idx >= 0) c.ignore(idx);
    });
    acts.appendChild(ignore);
    if (m.kind === 'spelling' && m.word && !/\s/.test(m.word)) {
      const add = el('button', 'act', 'Adicionar ao dicionário');
      add.addEventListener('click', () => {
        ipcRenderer.send('grammar:add-word', m.word);
        const idx = c.matches.indexOf(m);
        hideCard(true);
        if (idx >= 0) c.ignore(idx);
        for (const other of active) {
          other.matches = other.matches.filter((x2) => !(x2.kind === 'spelling' && x2.word.toLowerCase() === m.word.toLowerCase()));
          other.render();
        }
      });
      acts.appendChild(add);
    }
    card.appendChild(acts);

    card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    card.addEventListener('mouseleave', scheduleHide);
    root.appendChild(card);
    ui.card = card;
    const rect = c.rectsOf(index)[0];
    if (rect) place(card, rect, { prefer: 'below' });
    else hideCard(true);
  }

  // ---------------------------------------------------------------- Painel (lista de sugestões)
  function hidePanel(immediate = false) {
    const p = ui.panel;
    if (!p) return;
    ui.panel = null;
    if (immediate || !animationsOn()) p.remove();
    else {
      p.classList.add('leaving');
      setTimeout(() => p.remove(), 130);
    }
  }

  function showPanel(c) {
    const root = ensureUi();
    if (!root) return;
    hideCard(true);
    hidePanel(true);
    const p = el('div', 'panel');
    p.checker = c;
    root.appendChild(p);
    ui.panel = p;
    renderPanel(c);
  }

  function renderPanel(c) {
    const p = ui.panel;
    if (!p || p.checker !== c) return;
    const scroll = p.querySelector('.p-body')?.scrollTop || 0;
    p.textContent = '';

    const head = el('div', 'p-head');
    const logo = el('div', 'logo');
    logo.appendChild(svgIcon(ICON.spell, 17));
    const titles = el('div', 'grow');
    titles.appendChild(el('div', 'p-title', 'Corretor do PulseBrowser'));
    const n = c.matches.length;
    let sub;
    if (c.status === 'checking') sub = 'Verificando o texto...';
    else if (c.status === 'error') sub = c.error || 'Não foi possível verificar o texto.';
    else if (n) sub = `${n} ${n === 1 ? 'sugestão' : 'sugestões'}`;
    else sub = c.text.trim().length < 3 ? 'Escreva algo para verificar' : 'Nenhum problema encontrado';
    const subEl = el('div', `p-sub${c.status === 'error' ? ' err' : ''}`, sub);
    titles.appendChild(subEl);
    const x = el('span', 'x');
    x.appendChild(svgIcon(ICON.x, 14));
    x.addEventListener('click', () => hidePanel());
    head.append(logo, titles, x);
    p.appendChild(head);

    const body = el('div', 'p-body');
    if (n) {
      c.matches.slice(0, 40).forEach((m, i) => {
        const row = el('div', 'row');
        row.style.setProperty('--i', String(Math.min(i, 12)));
        row.style.setProperty('--kc', kindColor(m.kind));
        row.appendChild(el('span', 'dot'));
        const txt = el('div', 'txt');
        const w = el('div', 'w');
        w.appendChild(el('span', 'orig', m.word || ' '));
        txt.appendChild(w);
        txt.appendChild(el('div', 'm', m.short || m.message || KIND_TITLE[m.kind]));
        row.appendChild(txt);
        if (m.replacements.length) {
          const b = el('button', 'pill', m.replacements[0] === '' ? '(remover)' : m.replacements[0]);
          b.title = 'Aplicar sugestão';
          b.addEventListener('click', () => {
            const idx = c.matches.indexOf(m);
            if (idx >= 0) c.apply(idx, m.replacements[0]);
            renderPanel(c);
          });
          row.appendChild(b);
        }
        row.addEventListener('mouseenter', () => c.setHover(c.matches.indexOf(m)));
        row.addEventListener('mouseleave', () => c.setHover(-1));
        body.appendChild(row);
      });
    } else if (c.status === 'ok') {
      const empty = el('div', 'empty');
      const big = el('div', 'big');
      big.appendChild(svgIcon(ICON.check, 24));
      empty.append(big, el('div', null, 'Tudo certo! Seu texto está sem erros.'));
      body.appendChild(empty);
    }
    p.appendChild(body);
    body.scrollTop = scroll;

    const foot = el('div', 'p-foot');
    if (c.fixable().length > 1) {
      const all = el('button', 'btn');
      all.appendChild(svgIcon(ICON.wand, 15));
      all.appendChild(document.createTextNode(`Corrigir tudo (${c.fixable().length})`));
      all.addEventListener('click', () => {
        c.fixAll();
        renderPanel(c);
      });
      foot.appendChild(all);
    }
    const line = el('div', 'line');
    const label = el('label');
    label.appendChild(svgIcon(ICON.globe, 14));
    label.appendChild(document.createTextNode('Idioma'));
    const select = document.createElement('select');
    for (const l of config?.languages || []) {
      const o = document.createElement('option');
      o.value = l.code;
      o.textContent = l.code === 'auto' && c.language?.auto && c.language.name ? `Automático · ${c.language.name}` : l.name;
      if (l.code === config.language) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => {
      ipcRenderer.send('grammar:set-language', select.value);
      setTimeout(() => c.field.focus({ preventScroll: true }), 0);
    });
    line.append(label, select);
    foot.appendChild(line);
    const links = el('div', 'links');
    const off = el('button', 'link', 'Desativar neste site');
    off.addEventListener('click', () => {
      ipcRenderer.send('grammar:disable-site');
      hidePanel();
    });
    const settings = el('button', 'link', 'Configurações');
    settings.addEventListener('click', () => {
      ipcRenderer.send('grammar:open-settings');
      hidePanel();
    });
    links.append(off, settings);
    foot.appendChild(links);
    foot.appendChild(el('div', 'note', `Verificação feita pelo ${config?.server || 'LanguageTool'}.`));
    p.appendChild(foot);

    const anchor = ui.badge ? ui.badge.getBoundingClientRect() : c.field.getBoundingClientRect();
    place(p, anchor, { prefer: 'above', align: 'right', gap: 8 });
  }

  // ---------------------------------------------------------------- Eventos da página
  function activate(field) {
    if (!eligible(field)) return null;
    return checkers.get(field) || new Checker(field);
  }

  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (insideOurUi(t)) return;
    const field = editingHost(t);
    if (!field) return;
    loadConfig().then(() => {
      if (!usable() || document.activeElement !== t) return;
      const c = activate(field);
      if (!c) return;
      focused = c;
      renderBadge();
      if (c.status === 'idle' && c.text.trim().length >= 3) c.schedule(200);
    });
  }, true);

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const a = document.activeElement;
      if (insideOurUi(a)) return;
      const field = editingHost(a);
      if (focused && field === focused.field) return;
      if (ui.panel) hidePanel();
      focused = field ? checkers.get(field) || null : null;
      renderBadge();
    }, 150);
  }, true);

  document.addEventListener('input', (e) => {
    const field = editingHost(e.target);
    const c = field && checkers.get(field);
    if (c) c.onInput();
  }, true);

  let moveRaf = 0;
  let lastMove = null;
  document.addEventListener('mousemove', (e) => {
    lastMove = e;
    if (moveRaf) return;
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      const ev = lastMove;
      if (!ev || insideOurUi(ev.target)) {
        clearTimeout(hideTimer);
        return;
      }
      const field = editingHost(ev.target);
      const c = field && checkers.get(field);
      const i = c ? c.matchAt(ev.clientX, ev.clientY) : -1;
      if (c && i >= 0) {
        clearTimeout(hideTimer);
        if (ui.card && ui.card.checker === c && c.hoverIndex === i) return;
        clearTimeout(cardTimer);
        cardTimer = setTimeout(() => showCard(c, i), ui.card ? 60 : 280);
      } else {
        clearTimeout(cardTimer);
        if (ui.card) scheduleHide();
      }
    });
  }, { passive: true });

  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || insideOurUi(e.target)) return;
    const field = editingHost(e.target);
    const c = field && checkers.get(field);
    if (!c) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed && !c.isTA) return;
    const i = c.matchAt(e.clientX, e.clientY);
    if (i >= 0) {
      clearTimeout(cardTimer);
      showCard(c, i);
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (ui.card || ui.panel)) {
      hideCard();
      hidePanel();
      return;
    }
    if (ui.card && !insideOurUi(e.target)) hideCard();
  }, true);

  const reposition = () => {
    for (const c of active) if (c.mirror) c.syncMirror();
    positionBadge();
    if (ui.card) hideCard(true);
  };
  window.addEventListener('scroll', () => requestAnimationFrame(reposition), { capture: true, passive: true });
  window.addEventListener('resize', () => requestAnimationFrame(reposition), { passive: true });

  // Tarefa periódica: limpa campos removidos e acompanha mudanças de tamanho e de valor.
  function startTick() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      if (!active.size) {
        clearInterval(tickTimer);
        tickTimer = null;
        return;
      }
      for (const c of [...active]) {
        if (!c.field.isConnected) {
          c.destroy();
          continue;
        }
        if (c.isTA) {
          if (c.field.value !== c.text) c.onInput();
          c.syncMirror();
        }
      }
      positionBadge();
      if (CSS.highlights && [...active].some((c) => !c.isTA && c.matches.length)) ensureDocSheet();
      if (ui.host && !ui.host.isConnected && document.documentElement) document.documentElement.appendChild(ui.host);
    }, 700);
  }

  ipcRenderer.on('grammar:config-changed', () => {
    loadConfig(true).then(() => {
      if (!usable()) {
        for (const c of [...active]) c.destroy();
        hideCard(true);
        hidePanel(true);
        renderBadge();
        return;
      }
      for (const c of active) {
        c.matches = [];
        c.render();
        c.schedule(150);
      }
      if (ui.panel) renderPanel(ui.panel.checker);
    });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => loadConfig(), { once: true });
  else loadConfig();
})();
