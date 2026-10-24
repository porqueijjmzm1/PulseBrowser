'use strict';
// PulseBrowser - senhas nas páginas: detecta logins, oferece preenchimento automático,
// sugere senhas fortes e avisa o navegador quando uma senha nova foi usada.
// Roda no mundo isolado (o site não enxerga este script nem as senhas preenchidas por ele).
const { ipcRenderer, webFrame } = require('electron');

// Login do Google: a página de login recusa navegadores embutidos. No modo de compatibilidade
// o navegador se apresenta como Firefox só em accounts.google.com (cabeçalhos e navigator).
function googleCompat() {
  let compat = null;
  try {
    compat = ipcRenderer.sendSync('pw:google-compat');
  } catch {
    return;
  }
  if (!compat || typeof compat.ua !== 'string') return;
  const patch = (ua) => {
    const def = (prop, value) => {
      try {
        Object.defineProperty(Navigator.prototype, prop, { get: () => value, configurable: true, enumerable: true });
      } catch { /* ignora */ }
    };
    const os = (ua.match(/\(([^;)]+(?:; [^;)]+)*?); rv:/) || [])[1] || 'Windows NT 10.0; Win64; x64';
    def('userAgent', ua);
    def('appVersion', `5.0 (${os.startsWith('Windows') ? 'Windows' : os.split(';')[0]})`);
    def('vendor', '');
    def('productSub', '20100101');
    def('oscpu', os);
    def('buildID', '20181001000000');
    def('userAgentData', undefined);
  };
  webFrame.executeJavaScript(`(${patch.toString()})(${JSON.stringify(compat.ua)});`).catch(() => {});
}

(() => {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  try {
    if (window.top !== window) return;
  } catch {
    return;
  }
  if (location.hostname === 'accounts.google.com') googleCompat();

  const SVGNS = 'http://www.w3.org/2000/svg';
  const USER_RE = /user|login|e-?mail|mail|conta|account|usu[aá]rio|ident|cpf|cnpj|phone|telefone|celular|nick|apelido|matr[ií]cula/i;
  const SUBMIT_RE = /entrar|login|log in|logon|sign ?in|acessar|continuar|continue|next|pr[oó]xim|avan[cç]ar|submit|enviar|confirmar|cadastr|sign ?up|register|registrar|criar conta|create account|salvar|alterar senha|change password|ok\b/i;
  const TEXT_TYPES = new Set(['text', 'email', 'tel', 'number', '']);
  const SKIP_AC = /one-time-code|cc-|otp/i;

  let config = null;
  let configPromise = null;
  const pwElements = new Set(); // campos que já foram de senha (mesmo se viraram "texto" pelo botão de mostrar)
  let lastSent = { key: '', time: 0 };
  let outcomeTimer = null;

  // ---------------------------------------------------------------- Utilidades
  function visible(el) {
    if (!el || !el.isConnected || el.disabled) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  }

  function isTextLike(el) {
    return el instanceof HTMLInputElement && TEXT_TYPES.has((el.getAttribute('type') || '').toLowerCase()) && !pwElements.has(el);
  }

  function isPassword(el) {
    return el instanceof HTMLInputElement && (el.type === 'password' || pwElements.has(el)) && !SKIP_AC.test(el.autocomplete || '');
  }

  function looksLikeUsername(el) {
    if (!isTextLike(el)) return false;
    if (/\b(username|email)\b/i.test(el.autocomplete || '') || el.type === 'email') return true;
    const hay = `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`;
    return USER_RE.test(hay);
  }

  function isNewPassword(el) {
    return /new-password/i.test(el.autocomplete || '');
  }

  function scopeOf(el) {
    return (el && (el.form || el.closest('form'))) || document;
  }

  function passwordFields(scope = document) {
    const list = [...scope.querySelectorAll('input[type="password"]')].filter((el) => visible(el) && isPassword(el));
    for (const el of pwElements) if (el.isConnected && scope.contains(el) && !list.includes(el) && visible(el)) list.push(el);
    return list.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }

  function usernameFieldFor(pw) {
    const scope = scopeOf(pw);
    const inputs = [...scope.querySelectorAll('input')];
    const byAc = inputs.find((i) => i !== pw && isTextLike(i) && /\b(username|email)\b/i.test(i.autocomplete || '') && (visible(i) || i.value));
    if (byAc) return byAc;
    let before = null;
    let beforeLikely = null;
    for (const i of inputs) {
      if (i === pw) break;
      if (!isTextLike(i) || !visible(i)) continue;
      before = i;
      if (looksLikeUsername(i)) beforeLikely = i;
    }
    if (beforeLikely) return beforeLikely;
    if (before && scope !== document) return before;
    // Login em duas etapas: o nome de usuário pode estar em um campo escondido.
    return inputs.find((i) => isTextLike(i) && i.value && /ident|user|email|login/i.test(`${i.name} ${i.id} ${i.autocomplete}`)) || before;
  }

  function passwordFor(userEl) {
    const scope = scopeOf(userEl);
    const list = passwordFields(scope).filter((p) => !isNewPassword(p));
    const after = list.find((p) => userEl.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING);
    return after || list[0] || null;
  }

  // Campo de nome de usuário sozinho (primeira etapa de logins como o do Google).
  function usernameOnlyField(scope) {
    const inputs = [...scope.querySelectorAll('input')].filter((i) => isTextLike(i) && visible(i));
    return inputs.find((i) => /\busername\b/i.test(i.autocomplete || ''))
      || inputs.find((i) => i.type === 'email')
      || inputs.find(looksLikeUsername)
      || null;
  }

  // ---------------------------------------------------------------- Configuração
  function loadConfig(force = false) {
    if (configPromise && !force) return configPromise;
    configPromise = ipcRenderer.invoke('pw:query').then((c) => {
      config = c;
      return c;
    }).catch(() => {
      config = null;
      return null;
    });
    return configPromise;
  }

  ipcRenderer.on('pw:refresh', () => {
    loadConfig(true).then(() => {
      if (dropdown.field && document.activeElement === dropdown.field) openFor(dropdown.field);
    });
  });

  // ---------------------------------------------------------------- Captura de logins
  function capture(target) {
    if (config && !config.enabled) return;
    const scope = scopeOf(target);
    let pws = passwordFields(scope).filter((p) => p.value);
    if (!pws.length && scope !== document) pws = passwordFields(document).filter((p) => p.value);
    if (!pws.length) {
      if (passwordFields(document).length) return;
      const u = usernameOnlyField(scope) || (scope !== document ? null : usernameOnlyField(document));
      const value = u && u.value.trim();
      if (value && value.length < 200) ipcRenderer.send('pw:username', { username: value });
      return;
    }
    let password;
    let isNew = false;
    const values = pws.map((p) => p.value);
    if (values.length >= 2) {
      const last = values[values.length - 1];
      if (values.filter((v) => v === last).length >= 2) {
        password = last;
        isNew = true;
      } else {
        password = values[values.length - 1];
      }
    } else {
      password = values[0];
      isNew = isNewPassword(pws[0]);
    }
    if (!password || password.length > 500) return;
    const userEl = usernameFieldFor(pws[0]);
    const username = userEl ? userEl.value.trim() : '';
    const key = `${username}\n${password}`;
    const now = Date.now();
    if (lastSent.key === key && now - lastSent.time < 3000) return;
    lastSent = { key, time: now };
    ipcRenderer.send('pw:submitted', { username, password, isNew });
    watchOutcome(pws);
  }

  // Se os campos de senha sumirem sem trocar de página, o login provavelmente deu certo.
  function watchOutcome(fields) {
    clearInterval(outcomeTimer);
    const started = Date.now();
    outcomeTimer = setInterval(() => {
      if (fields.every((f) => !f.isConnected || !visible(f))) {
        clearInterval(outcomeTimer);
        ipcRenderer.send('pw:login-done');
      } else if (Date.now() - started > 10000) {
        clearInterval(outcomeTimer);
      }
    }, 450);
  }

  document.addEventListener('submit', (e) => {
    try {
      capture(e.target);
    } catch { /* ignora */ }
  }, true);

  document.addEventListener('click', (e) => {
    try {
      const path = e.composedPath ? e.composedPath() : [e.target];
      if (path.includes(dropdown.host)) return;
      const t = e.target instanceof Element ? e.target : null;
      const btn = t && t.closest('button, input[type="submit"], input[type="button"], input[type="image"], [role="button"], a');
      if (!btn) return;
      const isSubmit = btn.type === 'submit' || (btn.tagName === 'BUTTON' && !btn.getAttribute('type') && btn.form);
      const label = `${btn.textContent || ''} ${btn.value || ''} ${btn.getAttribute('aria-label') || ''} ${btn.id} ${btn.getAttribute('name') || ''}`;
      if (isSubmit || SUBMIT_RE.test(label.slice(0, 200))) capture(btn);
    } catch { /* ignora */ }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (dropdown.visible && handleDropdownKey(e)) return;
    if (e.key !== 'Enter' || e.isComposing) return;
    const t = e.target;
    if (t instanceof HTMLInputElement) {
      try {
        capture(t);
      } catch { /* ignora */ }
    }
  }, true);

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'password' && !SKIP_AC.test(t.autocomplete || '')) pwElements.add(t);
    if (dropdown.visible && t === dropdown.field) {
      if (dropdown.mode === 'accounts' && !isPassword(t)) openFor(t, true);
      else if (t.value) hideDropdown();
    }
  }, true);

  // ---------------------------------------------------------------- Lista de preenchimento
  const dropdown = {
    host: null,
    root: null,
    box: null,
    field: null,
    visible: false,
    items: [],
    index: -1,
    mode: '',
  };

  const CSS = `
    :host { all: initial; }
    .box {
      position: fixed; z-index: 2147483647; min-width: 250px; max-width: 380px;
      font: 13px/1.35 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
      background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 12px;
      box-shadow: 0 12px 32px rgba(15, 12, 30, .24), 0 2px 6px rgba(15, 12, 30, .14);
      padding: 6px; box-sizing: border-box; overflow: hidden; user-select: none;
      transform-origin: top left;
    }
    .box.anim { animation: pulse-in .22s cubic-bezier(.2, .9, .3, 1.15); }
    .box.up { transform-origin: bottom left; }
    @keyframes pulse-in { from { opacity: 0; transform: translateY(-6px) scale(.97); } to { opacity: 1; transform: none; } }
    .item { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 8px; cursor: default; }
    .item.anim { animation: item-in .26s cubic-bezier(.2, .9, .3, 1) backwards; }
    @keyframes item-in { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
    .item.sel { background: var(--hover); }
    .av { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; flex: none; color: #fff; font-weight: 600; font-size: 13px; }
    .txt { min-width: 0; flex: 1; }
    .t1 { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .t2 { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: .5px; }
    .mono { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: 0; }
    .sep { height: 1px; background: var(--border); margin: 5px 4px; }
    .foot { color: var(--muted); }
    .foot .ic { width: 28px; display: grid; place-items: center; flex: none; }
    .glow { position: fixed; z-index: 2147483646; pointer-events: none; box-sizing: border-box; border-radius: 6px;
      box-shadow: 0 0 0 2px var(--accent), 0 0 18px var(--accent-soft); animation: glow 1.1s ease-out forwards; }
    @keyframes glow { 0% { opacity: 0; transform: scale(.98); } 18% { opacity: 1; transform: none; } 100% { opacity: 0; } }
    svg { display: block; }
  `;

  function svgIcon(shapes, size = 16) {
    const s = document.createElementNS(SVGNS, 'svg');
    const attrs = {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    };
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, String(v));
    for (const [tag, a] of shapes) {
      const el = document.createElementNS(SVGNS, tag);
      for (const [k, v] of Object.entries(a)) el.setAttribute(k, String(v));
      s.appendChild(el);
    }
    return s;
  }

  const KEY_ICON = [['path', { d: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4' }]];
  const SPARK_ICON = [
    ['path', { d: 'M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z' }],
    ['path', { d: 'M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z' }],
  ];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Mesma cor usada no popup de senhas da barra de endereço.
  function colorFor(s) {
    let h = 0;
    for (const c of String(s || '?').trim()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360} 55% 50%)`;
  }

  function animationsOn() {
    return config?.animations !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function ensureHost() {
    if (dropdown.host && dropdown.host.isConnected) return true;
    const root = document.documentElement;
    if (!root) return false;
    const host = document.createElement('pulse-autofill');
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('top', '0', 'important');
    host.style.setProperty('left', '0', 'important');
    host.style.setProperty('width', '0', 'important');
    host.style.setProperty('height', '0', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    const shadow = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);
    }
    // Cliques na lista não devem tirar o foco do campo.
    shadow.addEventListener('mousedown', (e) => e.preventDefault());
    root.appendChild(host);
    dropdown.host = host;
    dropdown.root = shadow;
    return true;
  }

  function applyTheme(node) {
    const dark = config?.dark ?? matchMedia('(prefers-color-scheme: dark)').matches;
    const accent = config?.accent || '#7c5cff';
    const vars = dark
      ? { '--bg': '#2b2a31', '--fg': '#f1f1f4', '--muted': '#a8a7b3', '--border': 'rgba(255,255,255,.1)', '--hover': 'rgba(255,255,255,.08)' }
      : { '--bg': '#ffffff', '--fg': '#1d1c22', '--muted': '#6b6a75', '--border': 'rgba(20,16,40,.12)', '--hover': 'rgba(20,16,40,.06)' };
    vars['--accent'] = accent;
    vars['--accent-soft'] = `${accent}66`;
    for (const [k, v] of Object.entries(vars)) node.style.setProperty(k, v);
  }

  function hideDropdown() {
    if (dropdown.box) dropdown.box.remove();
    dropdown.box = null;
    dropdown.visible = false;
    dropdown.items = [];
    dropdown.index = -1;
  }

  function positionDropdown() {
    const box = dropdown.box;
    const f = dropdown.field;
    if (!box || !f) return;
    if (!visible(f)) {
      hideDropdown();
      return;
    }
    const r = f.getBoundingClientRect();
    const width = Math.min(380, Math.max(250, r.width));
    box.style.width = `${width}px`;
    const h = box.offsetHeight;
    const below = window.innerHeight - r.bottom;
    const up = below < h + 8 && r.top > h + 8;
    box.classList.toggle('up', up);
    box.style.top = `${Math.round(up ? r.top - h - 4 : r.bottom + 4)}px`;
    box.style.left = `${Math.round(Math.max(4, Math.min(r.left, window.innerWidth - width - 4)))}px`;
  }

  function select(i) {
    dropdown.index = i;
    dropdown.items.forEach((it, j) => it.node.classList.toggle('sel', j === i));
  }

  function addItem(node, run, delay) {
    const index = dropdown.items.length;
    if (animationsOn()) {
      node.classList.add('anim');
      node.style.animationDelay = `${delay}ms`;
    }
    node.addEventListener('mouseenter', () => select(index));
    node.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      run();
    });
    dropdown.items.push({ node, run });
    dropdown.box.appendChild(node);
  }

  function showDropdown(field, mode, entries) {
    if (!ensureHost()) return;
    hideDropdown();
    dropdown.field = field;
    dropdown.mode = mode;
    const box = el('div', 'box');
    applyTheme(box);
    if (animationsOn()) box.classList.add('anim');
    dropdown.box = box;
    dropdown.root.appendChild(box);
    let delay = 30;
    for (const entry of entries) {
      if (entry === 'sep') {
        box.appendChild(el('div', 'sep'));
        continue;
      }
      const row = el('div', `item${entry.foot ? ' foot' : ''}`);
      if (entry.avatar) {
        const av = el('div', 'av', entry.avatar.letter);
        av.style.background = entry.avatar.color;
        row.appendChild(av);
      } else {
        const ic = el('div', entry.foot ? 'ic' : 'av');
        if (!entry.foot) ic.style.background = config?.accent || '#7c5cff';
        ic.appendChild(svgIcon(entry.icon, entry.foot ? 16 : 15));
        row.appendChild(ic);
      }
      const txt = el('div', 'txt');
      txt.appendChild(el('div', 't1', entry.title));
      if (entry.sub) txt.appendChild(el('div', `t2${entry.mono ? ' mono' : ''}`, entry.sub));
      row.appendChild(txt);
      addItem(row, entry.run, delay);
      delay += 35;
    }
    dropdown.visible = true;
    positionDropdown();
  }

  function glow(field) {
    if (!animationsOn() || !ensureHost() || !visible(field)) return;
    const r = field.getBoundingClientRect();
    const g = el('div', 'glow');
    applyTheme(g);
    g.style.top = `${r.top}px`;
    g.style.left = `${r.left}px`;
    g.style.width = `${r.width}px`;
    g.style.height = `${r.height}px`;
    g.style.borderRadius = getComputedStyle(field).borderRadius || '6px';
    dropdown.root.appendChild(g);
    setTimeout(() => g.remove(), 1200);
  }

  function setValue(input, value) {
    if (!input) return;
    input.focus({ preventScroll: true });
    let ok = false;
    try {
      input.select();
      ok = document.execCommand('insertText', false, value);
    } catch {
      ok = false;
    }
    if (!ok || input.value !== value) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    glow(input);
  }

  async function fillAccount(id, focused) {
    hideDropdown();
    const cred = await ipcRenderer.invoke('pw:fill', id).catch(() => null);
    if (!cred) return;
    let userEl = null;
    let pwEl = null;
    if (focused && isPassword(focused)) {
      pwEl = focused;
      userEl = usernameFieldFor(focused);
    } else if (focused) {
      userEl = focused;
      pwEl = passwordFor(focused);
    } else {
      pwEl = passwordFields(document).find((p) => !isNewPassword(p)) || null;
      userEl = pwEl ? usernameFieldFor(pwEl) : usernameOnlyField(document);
    }
    if (userEl && cred.username && visible(userEl)) setValue(userEl, cred.username);
    if (pwEl) setValue(pwEl, cred.password);
    (pwEl || userEl)?.focus({ preventScroll: true });
  }

  function generatePassword(length = 16) {
    const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '-_.!@#$%*?'];
    const all = sets.join('');
    const rnd = (n) => {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] % n;
    };
    const chars = sets.map((s) => s[rnd(s.length)]);
    while (chars.length < length) chars.push(all[rnd(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  function fillGenerated(field, password) {
    hideDropdown();
    const scope = scopeOf(field);
    const targets = passwordFields(scope).filter((p) => p === field || isNewPassword(p) || !p.value);
    const current = passwordFields(scope).filter((p) => /current-password/i.test(p.autocomplete || ''));
    for (const p of targets) if (!current.includes(p)) setValue(p, password);
    field.focus({ preventScroll: true });
  }

  function isSignupField(field) {
    if (!isPassword(field)) return false;
    if (isNewPassword(field)) return true;
    if (/current-password/i.test(field.autocomplete || '')) return false;
    return passwordFields(scopeOf(field)).length >= 2;
  }

  function relevantField(field) {
    if (!(field instanceof HTMLInputElement) || field.readOnly || field.disabled) return false;
    if (isPassword(field)) return true;
    if (!isTextLike(field)) return false;
    const pw = passwordFor(field);
    if (pw) return usernameFieldFor(pw) === field;
    return !passwordFields(document).length && looksLikeUsername(field);
  }

  async function openFor(field, filtering = false) {
    if (!relevantField(field)) {
      hideDropdown();
      return;
    }
    if (!config) await loadConfig();
    if (!config || !config.enabled || document.activeElement !== field) return;
    if (isSignupField(field)) {
      if (field.value) return;
      const pw = generatePassword();
      showDropdown(field, 'generate', [
        { icon: SPARK_ICON, title: 'Usar senha forte sugerida', sub: pw, mono: true, run: () => fillGenerated(field, pw) },
        'sep',
        { icon: KEY_ICON, foot: true, title: 'Gerenciar senhas', run: () => ipcRenderer.send('pw:open-manager') },
      ]);
      return;
    }
    if (!config.autofill || !config.accounts.length) {
      hideDropdown();
      return;
    }
    const typed = !isPassword(field) && filtering ? field.value.trim().toLowerCase() : '';
    const accounts = config.accounts.filter((a) => !typed || a.username.toLowerCase().startsWith(typed));
    if (!accounts.length) {
      hideDropdown();
      return;
    }
    const entries = accounts.slice(0, 8).map((a) => ({
      avatar: { letter: (a.username || '?').trim().charAt(0).toUpperCase() || '?', color: colorFor(a.username) },
      title: a.username || '(sem nome de usuário)',
      sub: '••••••••••',
      run: () => fillAccount(a.id, field),
    }));
    entries.push('sep', { icon: KEY_ICON, foot: true, title: 'Gerenciar senhas', run: () => ipcRenderer.send('pw:open-manager') });
    showDropdown(field, 'accounts', entries);
  }

  function handleDropdownKey(e) {
    if (e.target !== dropdown.field) return false;
    const n = dropdown.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      select(dropdown.index < 0 ? (dir > 0 ? 0 : n - 1) : (dropdown.index + dir + n) % n);
      return true;
    }
    if (e.key === 'Enter' && dropdown.index >= 0) {
      e.preventDefault();
      e.stopPropagation();
      dropdown.items[dropdown.index].run();
      return true;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      hideDropdown();
      return true;
    }
    if (e.key === 'Tab') hideDropdown();
    return false;
  }

  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement) openFor(t);
    else hideDropdown();
  }, true);
  document.addEventListener('focusout', (e) => {
    if (e.target === dropdown.field) setTimeout(() => {
      if (document.activeElement !== dropdown.field) hideDropdown();
    }, 120);
  }, true);
  document.addEventListener('mousedown', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t === document.activeElement && !dropdown.visible) setTimeout(() => openFor(t), 0);
  }, true);
  window.addEventListener('scroll', () => {
    if (dropdown.visible) positionDropdown();
  }, { capture: true, passive: true });
  window.addEventListener('resize', () => {
    if (dropdown.visible) positionDropdown();
  }, { passive: true });

  // Preencher a partir do menu de senhas do navegador (ícone de chave na barra de endereço).
  ipcRenderer.on('pw:fill-now', (_e, id) => {
    if (typeof id !== 'string') return;
    const active = document.activeElement instanceof HTMLInputElement && relevantField(document.activeElement) ? document.activeElement : null;
    fillAccount(id, active);
  });

  // ---------------------------------------------------------------- Estado da página
  let stateSent = false;
  function sendPageState() {
    if (stateSent) return;
    stateSent = true;
    ipcRenderer.send('pw:page-state', { hasPassword: passwordFields(document).length > 0 });
  }

  function onReady() {
    loadConfig().then(() => {
      const a = document.activeElement;
      if (a instanceof HTMLInputElement) openFor(a);
    });
    setTimeout(sendPageState, 2000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
  else onReady();
  window.addEventListener('load', () => setTimeout(sendPageState, 300), { once: true });
})();
