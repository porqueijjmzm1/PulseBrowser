'use strict';
// Extensões do tuff.browse: pastas com um manifest.json (formato parecido com o do Chrome) que
// rodam JavaScript e CSS em qualquer página — inclusive na nova aba —, mostram um botão na barra
// de ferramentas com pop-up e podem substituir a nova aba.
//
// Extensões de fábrica ficam em src/extensions (só leitura); as do usuário, em <dados>/extensions.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { app, ipcMain, net, nativeTheme, shell, dialog, WebContentsView } = require('electron');
const ctx = require('./context');
const { JsonStore } = require('./store');

const BUILTIN_DIR = path.join(__dirname, '..', 'extensions');
const TAB_PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const TEXT_TYPES = new Set(['.js', '.mjs', '.css', '.html', '.htm', '.json', '.svg', '.txt', '.md']);
const FILE_TYPES = new Set([...TEXT_TYPES, '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.mp3', '.mp4', '.webm']);
const MAX_FILE = 4 * 1024 * 1024;
const MAX_STORAGE = 40 * 1024 * 1024;
const RUN_AT = new Set(['document_start', 'document_end', 'document_idle']);
const FIRST_WORLD = 2001;
const POPUP_MIN = { w: 80, h: 32 };
const POPUP_MAX = { w: 780, h: 580 };

// Métodos da API que os scripts de conteúdo (mundo isolado) podem usar.
const CONTENT_METHODS = new Set([
  'storage.get', 'storage.set', 'storage.remove', 'storage.clear', 'notify', 'fetch',
  'tabs.create', 'browser.resolve', 'browser.engine', 'runtime.openOptions',
]);

function str(v, max = 300) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'extensao';
}

// Caminho relativo seguro dentro da pasta da extensão.
function safeRel(p) {
  const rel = String(p || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '').trim();
  if (!rel || rel.length > 200 || rel.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  if (/[<>:"|?*\u0000-\u001f]/.test(rel)) return null;
  return rel;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- Padrões de endereço
// Aceita os padrões do Chrome (<all_urls>, *://*.site.com/*, https://site.com/caminho*),
// "newtab" (a nova aba) e atalhos simples como "youtube.com" ou "*".
function compilePattern(raw) {
  const p = String(raw || '').trim();
  if (!p) return null;
  if (p === '<all_urls>') return (u) => /^(https?|file):$/.test(u.protocol) || u.newtab;
  if (p === 'newtab' || /^(tuff|pulse):\/\/newtab\/?\*?$/i.test(p)) return (u) => u.newtab;
  if (p === '*') return (u) => /^https?:$/.test(u.protocol);
  if (!p.includes('://')) {
    const host = p.toLowerCase().replace(/^\*\./, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]+$/.test(host)) return null;
    return (u) => /^https?:$/.test(u.protocol) && (u.hostname === host || u.hostname.endsWith(`.${host}`));
  }
  const m = /^(\*|https?|file|ftp|tuff):\/\/([^/]*)(\/.*)?$/i.exec(p);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase().replace(/:\d+$/, '');
  const pathGlob = m[3] || '/*';
  const re = new RegExp(`^${pathGlob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return (u) => {
    if (scheme === 'tuff') {
      if (!u.newtab || (host !== '*' && host !== 'newtab')) return false;
    } else if (scheme === '*') {
      if (!/^https?:$/.test(u.protocol)) return false;
    } else if (u.protocol !== `${scheme}:`) return false;
    if (scheme !== 'file' && scheme !== 'tuff' && host !== '*') {
      if (host.startsWith('*.')) {
        const base = host.slice(2);
        if (u.hostname !== base && !u.hostname.endsWith(`.${base}`)) return false;
      } else if (u.hostname !== host) return false;
    }
    return re.test(scheme === 'tuff' ? '/' : u.pathname + u.search);
  };
}

function toList(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
  if (typeof v === 'string') return v.split(/[\s,;]+/).filter(Boolean);
  return [];
}

// Cópia recursiva simples (funciona também de dentro do app.asar, onde fs.cpSync não chega).
function copyDir(src, dst, skip = () => false) {
  fs.mkdirSync(dst, { recursive: true });
  for (const d of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, d.name);
    if (skip(from)) continue;
    const to = path.join(dst, d.name);
    if (d.isDirectory()) copyDir(from, to, skip);
    else if (d.isFile()) fs.writeFileSync(to, fs.readFileSync(from));
  }
}

// ---------------------------------------------------------------- Leitura do manifest
function readManifest(dir, id, builtin) {
  const ext = {
    id, builtin, dir, name: id, version: '', description: '', author: '', icon: null,
    contentScripts: [], popup: null, title: '', run: null, newtab: null, options: null,
    incognito: false, errors: [], manifest: null,
  };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch (err) {
    ext.errors.push(fs.existsSync(path.join(dir, 'manifest.json')) ? `manifest.json inválido: ${err.message}` : 'Falta o arquivo manifest.json');
    return ext;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    ext.errors.push('manifest.json precisa ser um objeto JSON');
    return ext;
  }
  ext.manifest = raw;
  ext.name = str(raw.name, 80) || id;
  ext.version = str(raw.version, 30);
  ext.description = str(raw.description, 400);
  ext.author = str(raw.author, 80);
  ext.incognito = raw.incognito === true || raw.incognito === 'spanning' || raw.incognito === 'split';

  const file = (p, what) => {
    const rel = safeRel(p);
    if (!rel) {
      if (p) ext.errors.push(`Caminho inválido em ${what}: ${p}`);
      return null;
    }
    if (!fs.existsSync(path.join(dir, rel))) {
      ext.errors.push(`Arquivo não encontrado (${what}): ${rel}`);
      return null;
    }
    return rel;
  };

  // Ícone: "icon", o maior de "icons" ou o ícone do botão.
  const pickIcon = (v) => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const sizes = Object.keys(v).sort((a, b) => Number(b) - Number(a));
      return sizes.length ? v[sizes[0]] : null;
    }
    return null;
  };
  const action = raw.action || raw.browser_action || raw.page_action || null;
  const iconPath = pickIcon(raw.icon) || pickIcon(raw.icons) || pickIcon(action?.default_icon);
  if (iconPath) ext.icon = file(iconPath, 'ícone');

  if (action && typeof action === 'object') {
    ext.title = str(action.default_title, 80);
    if (action.default_popup) ext.popup = file(action.default_popup, 'pop-up');
    if (action.run) ext.run = file(action.run, 'action.run');
  }
  const newtab = raw.newtab || raw.chrome_url_overrides?.newtab;
  if (newtab) ext.newtab = file(newtab, 'nova aba');
  const options = raw.options_page || raw.options_ui?.page;
  if (options) ext.options = file(options, 'opções');

  const scripts = Array.isArray(raw.content_scripts) ? raw.content_scripts : [];
  scripts.slice(0, 50).forEach((cs, i) => {
    if (!cs || typeof cs !== 'object') return;
    const matches = [...toList(cs.matches), ...toList(cs.sites)].map((p) => [p, compilePattern(p)]);
    const bad = matches.filter(([, fn]) => !fn).map(([p]) => p);
    if (bad.length) ext.errors.push(`Padrão de endereço inválido: ${bad.join(', ')}`);
    const good = matches.filter(([, fn]) => fn).map(([, fn]) => fn);
    if (!good.length) {
      ext.errors.push(`content_scripts[${i}] não tem "matches" (ex.: ["<all_urls>"] ou ["youtube.com"])`);
      return;
    }
    const exclude = toList(cs.exclude_matches).map(compilePattern).filter(Boolean);
    const js = toList(cs.js).map((p) => file(p, 'content_scripts.js')).filter(Boolean);
    const css = toList(cs.css).map((p) => file(p, 'content_scripts.css')).filter(Boolean);
    if (!js.length && !css.length) return;
    const runAt = RUN_AT.has(cs.run_at) ? cs.run_at : 'document_idle';
    const world = String(cs.world || '').toUpperCase() === 'MAIN' ? 'MAIN' : 'ISOLATED';
    const patterns = matches.filter(([, fn]) => fn).map(([raw]) => raw);
    ext.contentScripts.push({ matches: good, patterns, exclude, js, css, runAt, world, allFrames: cs.all_frames === true });
  });
  return ext;
}

// ---------------------------------------------------------------- Modelos para "Criar extensão"
const TEMPLATES = {
  script: (name) => ({
    'manifest.json': JSON.stringify({
      name,
      version: '1.0',
      description: 'Roda um script nas páginas escolhidas.',
      icon: 'icon.svg',
      content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'], run_at: 'document_idle', world: 'MAIN' }],
    }, null, 2),
    'content.js': `// Este código roda em todas as páginas (e na nova aba).\n// Troque "matches" no manifest.json para escolher os sites, por exemplo ["youtube.com"].\n\nconsole.log('[${name}] rodando em', location.href);\n\n// Exemplo: deixar todas as imagens arredondadas\n// for (const img of document.images) img.style.borderRadius = '12px';\n`,
    'icon.svg': iconSvg(name),
  }),
  popup: (name) => ({
    'manifest.json': JSON.stringify({
      name,
      version: '1.0',
      description: 'Botão na barra de ferramentas com um pop-up.',
      icon: 'icon.svg',
      action: { default_popup: 'popup.html', default_title: name },
    }, null, 2),
    'popup.html': `<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="utf-8">\n  <link rel="stylesheet" href="popup.css">\n</head>\n<body>\n  <h1>${name}</h1>\n  <p id="info">Carregando…</p>\n  <button id="dark">Escurecer a página</button>\n  <button id="count">Contar cliques</button>\n  <script src="popup.js"></script>\n</body>\n</html>\n`,
    'popup.css': 'body { width: 260px; margin: 0; padding: 14px 16px; }\nh1 { font-size: 16px; margin: 0 0 6px; }\np { margin: 0 0 12px; opacity: .75; }\nbutton { display: block; width: 100%; margin-top: 6px; padding: 8px; border: 0; border-radius: 10px; background: #7c5cff; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }\nbutton:hover { filter: brightness(1.1); }\n',
    'popup.js': `// O pop-up tem acesso à API "tuff" (veja a página de extensões para a lista completa).\n(async () => {\n  const tab = await tuff.tabs.active();\n  document.getElementById('info').textContent = tab ? tab.title : 'Nenhuma aba';\n\n  document.getElementById('dark').onclick = () => {\n    // Roda este código na aba aberta\n    tuff.tabs.execute("document.documentElement.style.filter = document.documentElement.style.filter ? '' : 'invert(1) hue-rotate(180deg)'");\n  };\n\n  const btn = document.getElementById('count');\n  let n = (await tuff.storage.get('clicks')) || 0;\n  btn.textContent = 'Cliques: ' + n;\n  btn.onclick = async () => {\n    n++;\n    await tuff.storage.set('clicks', n);\n    btn.textContent = 'Cliques: ' + n;\n    tuff.action.setBadge(String(n));\n  };\n})();\n`,
    'icon.svg': iconSvg(name),
  }),
  newtab: (name) => ({
    'manifest.json': JSON.stringify({
      name,
      version: '1.0',
      description: 'Substitui a página de nova aba.',
      icon: 'icon.svg',
      newtab: 'newtab.html',
    }, null, 2),
    'newtab.html': `<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="utf-8">\n  <title>Nova aba</title>\n  <style>\n    html, body { height: 100%; margin: 0; }\n    body { display: grid; place-items: center; background: linear-gradient(135deg, #1e1b4b, #7c3aed); color: #fff; font-family: "Segoe UI", system-ui, sans-serif; }\n    h1 { font-size: 72px; font-weight: 300; margin: 0; }\n    input { width: 420px; padding: 14px 20px; border-radius: 26px; border: 0; font-size: 16px; outline: 0; }\n  </style>\n</head>\n<body>\n  <main style="text-align:center">\n    <h1 id="clock"></h1>\n    <form id="f"><input id="q" placeholder="Pesquisar"></form>\n  </main>\n  <script>\n    const tick = () => document.getElementById('clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });\n    tick(); setInterval(tick, 1000);\n    document.getElementById('f').onsubmit = (e) => { e.preventDefault(); tuff.browser.search(document.getElementById('q').value); };\n  </script>\n</body>\n</html>\n`,
    'icon.svg': iconSvg(name),
  }),
};

function iconSvg(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const letter = (String(name).trim()[0] || 'E').toUpperCase().replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 85% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 80% 48%)"/></linearGradient></defs>\n  <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#g)"/>\n  <text x="32" y="32" dy=".35em" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="700" font-size="30" fill="#fff">${letter}</text>\n</svg>\n`;
}

// ---------------------------------------------------------------- Armazenamento de cada extensão
class ExtStorage {
  constructor(file) {
    this.file = file;
    this.data = null;
    this.timer = null;
  }

  load() {
    if (this.data) return this.data;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      this.data = {};
    }
    return this.data;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.data) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn('[extensions] falha ao salvar dados', this.file, err.message);
    }
  }
}

// ---------------------------------------------------------------- Gerenciador
class Extensions extends EventEmitter {
  constructor() {
    super();
    this.userDir = path.join(app.getPath('userData'), 'extensions');
    this.dataDir = path.join(app.getPath('userData'), 'extension-data');
    this.state = new JsonStore('extensions', { exts: {} });
    this.list = []; // extensões carregadas (na ordem de exibição)
    this.byId = new Map();
    this.code = new Map(); // "id/arquivo" -> conteúdo (scripts e estilos)
    this.iconCache = new Map();
    this.storages = new Map();
    this.worlds = new Map(); // id -> número do mundo isolado
    this.nextWorld = FIRST_WORLD;
    this.badges = new Map(); // id -> { text, color }
    this.loadAll();
  }

  // ---- Carregamento
  loadAll() {
    const found = [];
    const scan = (root, builtin) => {
      let names = [];
      try {
        names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      } catch { /* pasta ainda não existe */ }
      for (const name of names.sort()) {
        if (!ID_RE.test(name)) continue;
        if (found.some((e) => e.id === name)) continue;
        found.push(readManifest(path.join(root, name), name, builtin));
      }
    };
    scan(BUILTIN_DIR, true);
    scan(this.userDir, false);
    this.list = found;
    this.byId = new Map(found.map((e) => [e.id, e]));
    this.code.clear();
    this.iconCache.clear();
    for (const e of found) this._cacheCode(e);
  }

  _cacheCode(ext) {
    for (const cs of ext.contentScripts) {
      for (const rel of [...cs.js, ...cs.css]) {
        try {
          this.code.set(`${ext.id}/${rel}`, fs.readFileSync(path.join(ext.dir, rel), 'utf8'));
        } catch (err) {
          ext.errors.push(`Não foi possível ler ${rel}: ${err.message}`);
        }
      }
    }
  }

  reload(id) {
    const old = this.byId.get(id);
    if (!old) return null;
    for (const key of [...this.code.keys()]) if (key.startsWith(`${id}/`)) this.code.delete(key);
    this.iconCache.delete(id);
    const fresh = readManifest(old.dir, id, old.builtin);
    this._cacheCode(fresh);
    const i = this.list.indexOf(old);
    this.list[i] = fresh;
    this.byId.set(id, fresh);
    this._changed();
    return fresh;
  }

  _changed() {
    this.emit('changed');
  }

  stateOf(id) {
    const ext = this.byId.get(id);
    const s = this.state.data.exts[id] || {};
    return {
      enabled: s.enabled !== false,
      pinned: s.pinned ?? !!ext?.builtin,
      incognito: s.incognito ?? !!ext?.incognito,
    };
  }

  _setState(id, changes) {
    if (!this.byId.has(id)) return;
    this.state.data.exts[id] = { ...(this.state.data.exts[id] || {}), ...changes };
    this.state.save();
    this._changed();
  }

  setEnabled(id, on) {
    this._setState(id, { enabled: !!on });
    if (!on) this.closePopupsOf(id);
  }

  setPinned(id, on) {
    this._setState(id, { pinned: !!on });
  }

  setIncognito(id, on) {
    this._setState(id, { incognito: !!on });
  }

  enabled() {
    return this.list.filter((e) => this.stateOf(e.id).enabled && e.manifest);
  }

  flush() {
    this.state.flush();
    for (const s of this.storages.values()) s.flush();
  }

  // ---- Arquivos servidos em tuff-ext://<id>/<arquivo>
  resolveFile(url) {
    const u = new URL(url);
    const ext = this.byId.get(u.hostname);
    if (!ext) return null;
    if (!ext.builtin && !this.stateOf(ext.id).enabled && !u.pathname.endsWith('.svg') && !u.pathname.endsWith('.png')) return null;
    const rel = safeRel(decodeURIComponent(u.pathname) === '/' ? 'index.html' : decodeURIComponent(u.pathname));
    if (!rel) return null;
    const file = path.normalize(path.join(ext.dir, rel));
    if (!file.startsWith(path.normalize(ext.dir) + path.sep)) return null;
    return file;
  }

  urlOf(ext, rel) {
    return `tuff-ext://${ext.id}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  }

  // ---- Nova aba
  newTabUrl() {
    const ext = this.enabled().find((e) => e.newtab);
    return ext ? this.urlOf(ext, ext.newtab) : null;
  }

  isNewTabUrl(url, { anyExtension = false } = {}) {
    if (typeof url !== 'string' || !url.startsWith('tuff-ext://')) return false;
    let u;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    const ext = this.byId.get(u.hostname);
    if (!ext || !ext.newtab) return false;
    if (!anyExtension && !this.stateOf(ext.id).enabled) return false;
    return decodeURIComponent(u.pathname.replace(/^\//, '')) === ext.newtab;
  }

  // Página de uma extensão que não existe mais (ex.: aba restaurada depois de remover a extensão).
  isOrphanUrl(url) {
    if (typeof url !== 'string' || !url.startsWith('tuff-ext://')) return false;
    return !this.byId.has(hostOf(url));
  }

  // ---- Scripts de conteúdo
  worldOf(id) {
    if (!this.worlds.has(id)) this.worlds.set(id, this.nextWorld++);
    return this.worlds.get(id);
  }

  _urlInfo(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const newtab = /^(tuff|pulse):$/.test(u.protocol) ? u.hostname === 'newtab' : this.isNewTabUrl(url);
    if (/^(tuff|pulse):$/.test(u.protocol) && !newtab) return null; // outras páginas internas: nunca
    return { protocol: u.protocol, hostname: u.hostname, pathname: u.pathname, search: u.search, newtab };
  }

  scriptsFor(url, { top = true, incognito = false } = {}) {
    const u = this._urlInfo(url);
    if (!u) return [];
    const out = [];
    for (const ext of this.enabled()) {
      if (incognito && !this.stateOf(ext.id).incognito) continue;
      // A página da própria extensão não recebe os scripts de conteúdo dela mesma.
      if (u.protocol === 'tuff-ext:' && u.hostname === ext.id) continue;
      ext.contentScripts.forEach((cs) => {
        if (!top && !cs.allFrames) return;
        if (!cs.matches.some((fn) => fn(u)) || cs.exclude.some((fn) => fn(u))) return;
        out.push({
          extId: ext.id,
          name: ext.name,
          world: cs.world,
          worldId: cs.world === 'ISOLATED' ? this.worldOf(ext.id) : 0,
          runAt: cs.runAt,
          js: cs.js.map((rel) => ({ code: this.code.get(`${ext.id}/${rel}`) || '', url: this.urlOf(ext, rel) })).filter((j) => j.code),
          css: cs.css.map((rel) => this.code.get(`${ext.id}/${rel}`) || '').filter(Boolean),
        });
      });
    }
    return out;
  }

  // A extensão tem script no mundo isolado deste endereço? (para validar chamadas da API)
  _contentAllowed(ext, url) {
    const u = this._urlInfo(url);
    if (!u) return false;
    return ext.contentScripts.some((cs) => cs.world === 'ISOLATED' && cs.matches.some((fn) => fn(u)));
  }

  // ---- Interface (barra de ferramentas)
  iconUrl(ext) {
    if (this.iconCache.has(ext.id)) return this.iconCache.get(ext.id);
    let url = '';
    if (ext.icon) {
      try {
        const data = fs.readFileSync(path.join(ext.dir, ext.icon));
        const type = require('./protocol').MIME[path.extname(ext.icon).toLowerCase()] || 'image/png';
        if (data.length < 512 * 1024) url = `data:${type.split(';')[0]};base64,${data.toString('base64')}`;
      } catch { /* usa o ícone padrão */ }
    }
    if (!url) url = `data:image/svg+xml;base64,${Buffer.from(iconSvg(ext.name)).toString('base64')}`;
    this.iconCache.set(ext.id, url);
    return url;
  }

  uiState(incognito = false) {
    const items = this.list.filter((e) => e.manifest).map((e) => {
      const st = this.stateOf(e.id);
      return {
        id: e.id,
        name: e.name,
        title: e.title || e.name,
        icon: this.iconUrl(e),
        enabled: st.enabled && (!incognito || st.incognito),
        disabled: !st.enabled,
        pinned: st.pinned,
        builtin: e.builtin,
        hasPopup: !!e.popup,
        hasAction: !!(e.popup || e.run),
        hasOptions: !!e.options,
        newtab: !!e.newtab,
        scripts: e.contentScripts.length,
        badge: this.badges.get(e.id) || null,
        error: e.errors[0] || '',
      };
    });
    return { items };
  }

  // ---- Página de gerenciamento (tuff://extensions)
  manageList() {
    const chosenNewtab = this.enabled().find((e) => e.newtab);
    return this.list.map((e) => {
      const st = this.stateOf(e.id);
      return {
        id: e.id,
        name: e.name,
        version: e.version,
        description: e.description,
        author: e.author,
        icon: this.iconUrl(e),
        builtin: e.builtin,
        enabled: st.enabled,
        pinned: st.pinned,
        incognito: st.incognito,
        errors: e.errors.slice(0, 8),
        popup: !!e.popup,
        run: !!e.run,
        newtab: !!e.newtab,
        newtabActive: !!chosenNewtab && chosenNewtab.id === e.id,
        options: !!e.options,
        scripts: e.contentScripts.map((cs) => ({ world: cs.world, runAt: cs.runAt, files: [...cs.js, ...cs.css], allFrames: cs.allFrames })),
        sites: [...new Set(e.contentScripts.flatMap((cs) => cs.patterns))].slice(0, 12),
        path: e.dir,
      };
    });
  }

  _userExt(id) {
    const ext = this.byId.get(id);
    if (!ext) throw new Error('Extensão não encontrada');
    if (ext.builtin) throw new Error('Extensões de fábrica não podem ser alteradas. Use "Duplicar" para criar uma cópia editável.');
    return ext;
  }

  _newId(name) {
    const base = slug(name);
    let id = base;
    for (let i = 2; this.byId.has(id) || fs.existsSync(path.join(this.userDir, id)); i++) id = `${base}-${i}`;
    return id;
  }

  create({ name, template } = {}) {
    const title = str(name, 60) || 'Minha extensão';
    const files = (TEMPLATES[template] || TEMPLATES.script)(title.replace(/["\\<>]/g, ''));
    const id = this._newId(title);
    const dir = path.join(this.userDir, id);
    fs.mkdirSync(dir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), content, 'utf8');
    this.loadAll();
    this._changed();
    return id;
  }

  files(id) {
    const ext = this.byId.get(id);
    if (!ext) throw new Error('Extensão não encontrada');
    const out = [];
    const walk = (dir, prefix, depth) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (out.length >= 200) return;
        const rel = prefix ? `${prefix}/${d.name}` : d.name;
        if (d.isDirectory()) {
          if (depth < 4 && !d.name.startsWith('.') && d.name !== 'node_modules') walk(path.join(dir, d.name), rel, depth + 1);
          continue;
        }
        const full = path.join(dir, d.name);
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch { /* ignora */ }
        const text = TEXT_TYPES.has(path.extname(d.name).toLowerCase()) && size <= MAX_FILE;
        out.push({ name: rel, size, text, content: text ? fs.readFileSync(full, 'utf8') : null });
      }
    };
    walk(ext.dir, '', 0);
    out.sort((a, b) => (a.name === 'manifest.json' ? -1 : b.name === 'manifest.json' ? 1 : a.name.localeCompare(b.name)));
    return { id, builtin: ext.builtin, files: out };
  }

  writeFile(id, name, content) {
    const ext = this._userExt(id);
    const rel = safeRel(name);
    if (!rel || !FILE_TYPES.has(path.extname(rel).toLowerCase())) {
      throw new Error('Nome de arquivo inválido (use letras, números e uma extensão como .js, .css, .html ou .json)');
    }
    if (!TEXT_TYPES.has(path.extname(rel).toLowerCase())) throw new Error('Só arquivos de texto podem ser editados aqui');
    const text = String(content ?? '');
    if (Buffer.byteLength(text) > MAX_FILE) throw new Error('Arquivo grande demais (máximo 4 MB)');
    const full = path.join(ext.dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
    const fresh = this.reload(id);
    return { errors: fresh.errors };
  }

  deleteFile(id, name) {
    const ext = this._userExt(id);
    const rel = safeRel(name);
    if (!rel || rel === 'manifest.json') throw new Error('Este arquivo não pode ser apagado');
    fs.rmSync(path.join(ext.dir, rel), { force: true });
    this.reload(id);
    return true;
  }

  async remove(id) {
    const ext = this._userExt(id);
    this.closePopupsOf(id);
    try {
      await shell.trashItem(ext.dir);
    } catch {
      fs.rmSync(ext.dir, { recursive: true, force: true });
    }
    delete this.state.data.exts[id];
    this.state.save();
    this.storages.get(id)?.flush();
    this.storages.delete(id);
    this.loadAll();
    this._changed();
    return true;
  }

  duplicate(id) {
    const ext = this.byId.get(id);
    if (!ext) throw new Error('Extensão não encontrada');
    const newId = this._newId(`${ext.id}-copia`);
    const dir = path.join(this.userDir, newId);
    fs.mkdirSync(this.userDir, { recursive: true });
    copyDir(ext.dir, dir);
    try {
      const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      mf.name = `${mf.name || ext.name} (cópia)`;
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(mf, null, 2), 'utf8');
    } catch { /* mantém o manifest como está */ }
    // A cópia começa desligada para não brigar com a original (ex.: duas novas abas).
    this.state.data.exts[newId] = { enabled: false, pinned: false };
    this.state.save();
    this.loadAll();
    this._changed();
    return newId;
  }

  async importFolder(win) {
    const res = await dialog.showOpenDialog(win, {
      title: 'Escolha a pasta da extensão (com o manifest.json)',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const src = res.filePaths[0];
    if (!fs.existsSync(path.join(src, 'manifest.json'))) throw new Error('A pasta escolhida não tem um manifest.json');
    let name = path.basename(src);
    try {
      name = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')).name || name;
    } catch { /* usa o nome da pasta */ }
    const id = this._newId(name);
    fs.mkdirSync(this.userDir, { recursive: true });
    copyDir(src, path.join(this.userDir, id), (p) => /[\\/](node_modules|\.git)$/.test(p));
    this.loadAll();
    this._changed();
    return id;
  }

  openFolder(id) {
    const ext = id ? this.byId.get(id) : null;
    const dir = ext ? ext.dir : this.userDir;
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  }

  // Recarrega as abas onde a extensão roda (depois de editar o código).
  reloadTabsFor(id) {
    const ext = this.byId.get(id);
    if (!ext) return 0;
    let n = 0;
    for (const w of ctx.windows) {
      for (const t of w.tabs) {
        const wc = t.webContents;
        if (!wc) continue;
        const url = wc.getURL();
        const u = this._urlInfo(url);
        const own = url.startsWith(`tuff-ext://${id}/`);
        if (own || (u && ext.contentScripts.some((cs) => cs.matches.some((fn) => fn(u))))) {
          wc.reload();
          n++;
        }
      }
    }
    return n;
  }

  // ---- Armazenamento (tuff.storage)
  storage(id) {
    let s = this.storages.get(id);
    if (!s) {
      s = new ExtStorage(path.join(this.dataDir, `${id}.json`));
      this.storages.set(id, s);
    }
    return s;
  }

  _storageChanged(id, changes) {
    const payload = { extId: id, type: 'storage', changes };
    for (const wc of this._allContents()) {
      try {
        wc.send('ext:event', payload);
      } catch { /* ignora */ }
    }
  }

  _allContents() {
    const out = [];
    for (const w of ctx.windows) {
      for (const t of w.tabs) if (t.webContents) out.push(t.webContents);
      if (w.extPopup && !w.extPopup.view.webContents.isDestroyed()) out.push(w.extPopup.view.webContents);
    }
    return out;
  }

  // ---- Botão da extensão
  runAction(window, id, anchor) {
    const ext = this.byId.get(id);
    if (!ext || !window) return;
    if (!this.stateOf(id).enabled) {
      window.toast(`A extensão "${ext.name}" está desativada`);
      return;
    }
    if (ext.popup) {
      this.openPopup(window, ext, anchor);
      return;
    }
    if (ext.run) {
      const tab = window.activeTab;
      const wc = tab?.webContents;
      const url = wc?.getURL() || '';
      if (!wc || (/^(tuff|pulse):/.test(url) && !tab.isNewTab)) {
        window.toast('As extensões não rodam nesta página');
        return;
      }
      let code = '';
      try {
        code = fs.readFileSync(path.join(ext.dir, ext.run), 'utf8');
      } catch {
        window.toast('Não foi possível ler o script da extensão');
        return;
      }
      wc.executeJavaScript(`${code}\n//# sourceURL=${this.urlOf(ext, ext.run)}`, true).catch((err) => {
        console.warn(`[extensions] ${ext.name}:`, err.message);
        window.toast(`Erro na extensão "${ext.name}"`);
      });
      return;
    }
    if (ext.options) {
      this.openOptions(window, ext);
      return;
    }
    window.toast(ext.newtab ? `"${ext.name}" muda a nova aba` : `"${ext.name}" roda sozinha nas páginas`);
  }

  openOptions(window, ext) {
    if (!ext?.options) return;
    window.createTab({ url: this.urlOf(ext, ext.options), active: true });
  }

  // Pop-up da extensão: uma área própria (WebContentsView) flutuando sob o botão, com sombra
  // desenhada pela sobreposição e fechando ao clicar fora ou apertar Esc.
  openPopup(window, ext, anchor) {
    if (window.extPopup && window.extPopup.id === ext.id) {
      window.hidePopup();
      return;
    }
    const a = anchor || window.metrics.ext?.btn || window.metrics.omnibox;
    const dark = window.incognito || nativeTheme.shouldUseDarkColors;
    const view = new WebContentsView({
      webPreferences: {
        preload: TAB_PRELOAD,
        session: window.session,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        enablePreferredSizeMode: true,
        spellcheck: ctx.settings.get('spellcheck'),
      },
    });
    view.setBackgroundColor(dark ? '#2b2a31' : '#ffffff');
    try {
      view.setBorderRadius(12);
    } catch { /* versões antigas */ }
    view.setVisible(false);
    const popup = { id: ext.id, view, size: { w: 320, h: 120 }, shown: false, anchor: a };
    const wc = view.webContents;

    const show = () => {
      if (popup.shown || wc.isDestroyed() || window.extPopup !== popup) return;
      popup.shown = true;
      this._layoutPopup(window);
      view.setVisible(true);
      wc.focus();
    };
    wc.on('preferred-size-changed', (_e, size) => {
      popup.size = {
        w: Math.max(POPUP_MIN.w, Math.min(POPUP_MAX.w, Math.ceil(size.width))),
        h: Math.max(POPUP_MIN.h, Math.min(POPUP_MAX.h, Math.ceil(size.height))),
      };
      if (popup.shown) this._layoutPopup(window);
      else setTimeout(show, 30);
    });
    wc.on('dom-ready', () => {
      wc.insertCSS(':root { color-scheme: light dark; font: 13px/1.45 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }', { cssOrigin: 'user' }).catch(() => {});
    });
    wc.on('did-finish-load', () => setTimeout(show, 120));
    setTimeout(show, 1500);
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        window.hidePopup();
      }
    });
    wc.setWindowOpenHandler(({ url }) => {
      window.createTab({ url, active: true });
      return { action: 'deny' };
    });
    wc.on('will-navigate', (details) => {
      if (details.url.startsWith(`tuff-ext://${ext.id}/`)) return;
      details.preventDefault();
      window.createTab({ url: details.url, active: true });
      window.hidePopup();
    });
    wc.on('render-process-gone', () => window.hidePopup());

    window.showPopup({
      type: 'ext-popup',
      anchor: a,
      data: { box: this._popupBox(window, popup), name: ext.name },
      focus: false,
      onDismiss: () => this._destroyPopup(window, popup),
    });
    window.extPopup = popup;
    window.win.contentView.addChildView(view);
    wc.loadURL(this.urlOf(ext, ext.popup)).catch(() => {});
    window.sendUI('ui:ext-popup', { id: ext.id });
  }

  _popupBox(window, popup) {
    const [winW] = window.win.getContentSize();
    const a = popup.anchor || {};
    const w = popup.size.w + 2;
    const h = popup.size.h + 2;
    const right = Number.isFinite(a.right) ? a.right : winW - 8;
    const left = Math.round(Math.max(8, Math.min(right - w, winW - w - 8)));
    return { left, top: 6, width: w, height: h };
  }

  _layoutPopup(window) {
    const popup = window.extPopup;
    if (!popup || window.win.isDestroyed()) return;
    const box = this._popupBox(window, popup);
    const y = Math.max(0, Math.round(popup.anchor?.bottom ?? window.uiHeight));
    popup.view.setBounds({ x: box.left + 1, y: y + box.top + 1, width: box.width - 2, height: box.height - 2 });
    window.updatePopup({ type: 'ext-popup', data: { box, name: this.byId.get(popup.id)?.name || '', ready: popup.shown } });
  }

  _destroyPopup(window, popup) {
    if (window.extPopup === popup) window.extPopup = null;
    try {
      window.win.contentView.removeChildView(popup.view);
    } catch { /* ignora */ }
    try {
      if (!popup.view.webContents.isDestroyed()) popup.view.webContents.close();
    } catch { /* ignora */ }
    window.sendUI('ui:ext-popup', { id: null });
  }

  closePopupsOf(id) {
    for (const w of ctx.windows) if (w.extPopup && w.extPopup.id === id) w.hidePopup();
  }

  setBadge(id, text, color) {
    const t = String(text ?? '').slice(0, 4);
    if (!t) this.badges.delete(id);
    else this.badges.set(id, { text: t, color: /^#[0-9a-f]{3,8}$/i.test(color || '') ? color : '' });
    this._changed();
  }

  // ---- API "tuff" usada pelas extensões
  _caller(event, claimedId) {
    const frame = event.senderFrame;
    const url = frame?.url || '';
    const wc = event.sender;
    let ext = null;
    let kind = null;
    if (url.startsWith('tuff-ext://')) {
      // Página de extensão dentro de um iframe de um site comum: sem acesso à API.
      if (frame.parent && !/^(tuff|tuff-ext):/.test(frame.top?.url || '')) return null;
      ext = this.byId.get(hostOf(url));
      kind = 'page';
    } else if (typeof claimedId === 'string') {
      const claimed = this.byId.get(claimedId);
      if (claimed && this._contentAllowed(claimed, url)) {
        ext = claimed;
        kind = 'content';
      }
    }
    if (!ext || !this.stateOf(ext.id).enabled) return null;
    let window = null;
    let tab = null;
    for (const w of ctx.windows) {
      if (w.extPopup && w.extPopup.view.webContents === wc) {
        window = w;
        kind = kind === 'page' ? 'popup' : kind;
        break;
      }
      const t = w.tabs.find((x) => x.webContents === wc);
      if (t) {
        window = w;
        tab = t;
        break;
      }
    }
    if (!window) window = ctx.lastFocusedWindow || ctx.windows[0] || null;
    return { ext, kind, window, tab, wc };
  }

  _targetTab(c) {
    return c.kind === 'popup' ? c.window?.activeTab : c.tab || c.window?.activeTab;
  }

  _resolveUrl(raw) {
    const { resolveInput } = require('./omnibox');
    const url = resolveInput(String(raw || '').slice(0, 4000));
    if (!url || /^javascript:/i.test(url)) throw new Error('Endereço inválido');
    return url;
  }

  async _call(c, method, args) {
    const [a, b] = args;
    const ext = c.ext;
    switch (method) {
      case 'storage.get': {
        const data = this.storage(ext.id).load();
        if (a == null) return structuredClone(data);
        return structuredClone(data[String(a)]);
      }
      case 'storage.set': {
        const s = this.storage(ext.id);
        const data = s.load();
        const entries = a && typeof a === 'object' && !Array.isArray(a) ? Object.entries(a) : [[String(a), b]];
        const changes = {};
        for (const [k, v] of entries) {
          if (v === undefined) delete data[k];
          else data[k] = v;
          changes[k] = v;
        }
        if (Buffer.byteLength(JSON.stringify(data)) > MAX_STORAGE) {
          for (const [k] of entries) delete data[k];
          throw new Error('Limite de armazenamento da extensão atingido (40 MB)');
        }
        s.save();
        this._storageChanged(ext.id, changes);
        return true;
      }
      case 'storage.remove': {
        const s = this.storage(ext.id);
        const data = s.load();
        const keys = Array.isArray(a) ? a.map(String) : [String(a)];
        const changes = {};
        for (const k of keys) {
          delete data[k];
          changes[k] = undefined;
        }
        s.save();
        this._storageChanged(ext.id, changes);
        return true;
      }
      case 'storage.clear': {
        const s = this.storage(ext.id);
        const changes = Object.fromEntries(Object.keys(s.load()).map((k) => [k, undefined]));
        s.data = {};
        s.save();
        this._storageChanged(ext.id, changes);
        return true;
      }
      case 'notify':
        c.window?.toast(String(a ?? '').slice(0, 140));
        return true;
      case 'fetch': {
        const url = String(a || '');
        if (!/^https?:\/\//i.test(url)) throw new Error('Só endereços http e https');
        const opts = b && typeof b === 'object' ? b : {};
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          const res = await net.fetch(url, {
            method: typeof opts.method === 'string' ? opts.method.toUpperCase() : 'GET',
            headers: opts.headers && typeof opts.headers === 'object' ? opts.headers : undefined,
            body: typeof opts.body === 'string' ? opts.body : undefined,
            credentials: 'omit',
            signal: controller.signal,
          });
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 15 * 1024 * 1024) throw new Error('Resposta grande demais');
          const out = { ok: res.ok, status: res.status, url: res.url, headers: Object.fromEntries(res.headers.entries()) };
          // as: 'dataurl' ou 'base64' para imagens e outros arquivos binários.
          if (opts.as === 'dataurl') out.dataUrl = `data:${(res.headers.get('content-type') || 'application/octet-stream').split(';')[0]};base64,${buf.toString('base64')}`;
          else if (opts.as === 'base64') out.base64 = buf.toString('base64');
          else out.text = buf.toString('utf8');
          return out;
        } finally {
          clearTimeout(timer);
        }
      }
      case 'tabs.create': {
        const o = a && typeof a === 'object' ? a : { url: a };
        const w = c.window;
        if (!w) return false;
        w.createTab({ url: this._resolveUrl(o.url), active: o.active !== false, opener: c.tab || undefined });
        return true;
      }
      case 'tabs.update': {
        const o = a && typeof a === 'object' ? a : { url: a };
        const tab = this._targetTab(c);
        if (!tab) return false;
        tab.loadURL(this._resolveUrl(o.url));
        if (c.kind === 'popup') c.window.hidePopup();
        return true;
      }
      case 'tabs.active': {
        const tab = this._targetTab(c);
        return tab ? { id: tab.id, url: tab.isNewTab ? 'tuff://newtab/' : tab.displayUrl, title: tab.title || '', incognito: !!c.window?.incognito } : null;
      }
      case 'tabs.execute': {
        const tab = this._targetTab(c);
        const wc = tab?.webContents;
        if (!wc) throw new Error('Nenhuma aba aberta');
        const url = wc.getURL();
        if (/^(tuff|pulse):/.test(url) && !tab.isNewTab) throw new Error('As extensões não rodam nas páginas internas do navegador');
        return wc.executeJavaScript(`${String(a ?? '')}\n//# sourceURL=tuff-ext://${ext.id}/tabs.execute.js`, true);
      }
      case 'browser.search': {
        const text = String(a ?? '').trim();
        if (!text) return false;
        const url = this._resolveUrl(text);
        const o = b && typeof b === 'object' ? b : {};
        const tab = this._targetTab(c);
        if (o.newTab || !tab) c.window?.createTab({ url, active: true });
        else tab.loadURL(url);
        if (c.kind === 'popup') c.window.hidePopup();
        return true;
      }
      case 'browser.resolve':
        return this._resolveUrl(a);
      case 'browser.engine': {
        const { engineIcon } = require('./settings');
        const id = ctx.settings.get('searchEngine');
        return { id, name: ctx.settings.engine().name, icon: engineIcon(id) };
      }
      case 'browser.engines': {
        const { engineList } = require('./settings');
        return { current: ctx.settings.get('searchEngine'), engines: engineList() };
      }
      case 'browser.setEngine': {
        const { ENGINES } = require('./settings');
        if (!Object.hasOwn(ENGINES, String(a))) throw new Error('Buscador desconhecido');
        ctx.settings.set('searchEngine', String(a));
        return true;
      }
      case 'browser.topSites':
        if (c.window?.incognito) return [];
        return ctx.history.topSites(Math.max(1, Math.min(24, Number(a) || 8)));
      case 'browser.bookmarks': {
        if (c.window?.incognito) return [];
        const out = [];
        const walk = (nodes, folder) => {
          for (const n of nodes || []) {
            if (out.length >= 400) return;
            if (n.type === 'folder') walk(n.children, n.title);
            else if (n.url) out.push({ title: n.title, url: n.url, favicon: n.favicon || '', folder });
          }
        };
        for (const root of ['bar', 'other']) walk(ctx.bookmarks.find(root)?.node?.children, root === 'bar' ? 'Barra de favoritos' : 'Outros favoritos');
        return out;
      }
      case 'browser.theme':
        return {
          dark: nativeTheme.shouldUseDarkColors,
          accent: ctx.settings.accentColor(),
          animations: ctx.settings.get('animations') !== false,
          incognito: !!c.window?.incognito,
        };
      case 'browser.openSettings':
        c.window?.command('settings', typeof a === 'string' ? a : undefined);
        return true;
      case 'action.setBadge':
        this.setBadge(ext.id, a, b);
        return true;
      case 'popup.close':
        if (c.kind === 'popup') c.window?.hidePopup();
        return true;
      case 'runtime.openOptions':
        if (ext.options && c.window) this.openOptions(c.window, ext);
        return !!ext.options;
      case 'runtime.info':
        return { id: ext.id, name: ext.name, version: ext.version, builtin: ext.builtin };
      default:
        throw new Error(`Função desconhecida: ${method}`);
    }
  }

  register() {
    // Lista dos scripts para o quadro que está carregando (pedido síncrono do preload).
    ipcMain.on('ext:content', (event, opts) => {
      try {
        const frame = event.senderFrame;
        const wc = event.sender;
        const isUi = ctx.windows.some((w) => w.win.webContents === wc || w.overlay.webContents === wc);
        if (!frame || isUi) {
          event.returnValue = null;
          return;
        }
        const incognito = wc.session !== require('electron').session.defaultSession;
        const scripts = this.scriptsFor(frame.url, { top: !frame.parent, incognito });
        event.returnValue = scripts.length ? { scripts } : null;
      } catch (err) {
        console.warn('[extensions] scripts:', err.message);
        event.returnValue = null;
      }
    });

    ipcMain.handle('ext:api', async (event, claimedId, method, args) => {
      const c = this._caller(event, claimedId);
      if (!c) throw new Error('Extensão sem permissão');
      if (c.kind === 'content' && !CONTENT_METHODS.has(method)) throw new Error(`Função não disponível em scripts de conteúdo: ${method}`);
      return this._call(c, String(method), Array.isArray(args) ? args : []);
    });

    nativeTheme.on('updated', () => {
      for (const w of ctx.windows) {
        const p = w.extPopup;
        if (p) p.view.setBackgroundColor(w.incognito || nativeTheme.shouldUseDarkColors ? '#2b2a31' : '#ffffff');
      }
    });
  }
}

module.exports = { Extensions, compilePattern, readManifest, safeRel, TEMPLATES };
