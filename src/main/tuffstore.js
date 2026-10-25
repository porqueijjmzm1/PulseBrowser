'use strict';
// tuff Store: catálogo de extensões prontas para instalar com um clique.
//
// O catálogo vem do repositório do tuff.browse no GitHub, para que extensões novas e atualizações
// apareçam sem atualizar o navegador. Sem internet (ou se o GitHub falhar), vale a cópia que vem
// junto com o app em src/store. A extensão instalada vira uma extensão comum do usuário
// (<dados>/extensions/<id>) e pode ser editada, desativada ou removida como as outras.
const fs = require('fs');
const path = require('path');
const { net } = require('electron');
const { safeRel } = require('./extensions');

const BUNDLED_DIR = path.join(__dirname, '..', 'store');
const REMOTE_BASE = 'https://raw.githubusercontent.com/porqueijjmzm1/PulseBrowser/main/src/store/';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ALLOWED = new Set(['.js', '.mjs', '.css', '.html', '.htm', '.json', '.svg', '.txt', '.md', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.mp3', '.mp4', '.webm']);
const MAX_TOTAL = 20 * 1024 * 1024;
const CATALOG_TTL = 10 * 60 * 1000;

// "1.10.0" > "1.9.2"
function newer(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function validEntry(e) {
  return e && typeof e === 'object' && ID_RE.test(e.id || '') && typeof e.name === 'string'
    && Array.isArray(e.files) && e.files.includes('manifest.json') && e.files.length <= 200
    && e.files.every((f) => safeRel(f) === f && ALLOWED.has(path.extname(f).toLowerCase()));
}

async function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await net.fetch(url, { signal: controller.signal, cache: 'no-cache', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

class TuffStore {
  constructor(extensions) {
    this.exts = extensions;
    this.remote = null; // { at, entries }
    this.iconCache = new Map();
  }

  bundled() {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(BUNDLED_DIR, 'index.json'), 'utf8'));
      return (data.extensions || []).filter(validEntry);
    } catch {
      return [];
    }
  }

  async fetchRemote(force) {
    if (!force && this.remote && Date.now() - this.remote.at < CATALOG_TTL) return this.remote.entries;
    try {
      const data = JSON.parse((await fetchWithTimeout(`${REMOTE_BASE}index.json`)).toString('utf8'));
      const entries = (data.extensions || []).filter(validEntry);
      this.remote = { at: Date.now(), entries };
      return entries;
    } catch {
      this.remote = { at: Date.now(), entries: null };
      return null;
    }
  }

  // Junta as duas listas: a do GitHub ganha quando tem uma versão mais nova (ou uma extensão nova).
  async entries(force = false) {
    const local = this.bundled();
    const remote = await this.fetchRemote(force);
    const map = new Map(local.map((e) => [e.id, { ...e, source: 'bundled' }]));
    for (const e of remote || []) {
      const cur = map.get(e.id);
      if (!cur || newer(e.version, cur.version)) map.set(e.id, { ...e, source: 'remote' });
    }
    return { list: [...map.values()], online: !!remote };
  }

  iconOf(e) {
    const key = `${e.source}:${e.id}:${e.version}`;
    if (this.iconCache.has(key)) return this.iconCache.get(key);
    let url = '';
    const rel = safeRel(e.icon);
    if (rel && e.source === 'bundled') {
      try {
        const data = fs.readFileSync(path.join(BUNDLED_DIR, e.id, rel));
        const type = require('./protocol').MIME[path.extname(rel).toLowerCase()] || 'image/png';
        url = `data:${type.split(';')[0]};base64,${data.toString('base64')}`;
      } catch { /* sem ícone */ }
    } else if (rel) {
      url = `${REMOTE_BASE}${e.id}/${rel.split('/').map(encodeURIComponent).join('/')}`;
    }
    this.iconCache.set(key, url);
    return url;
  }

  async list({ refresh = false } = {}) {
    const { list, online } = await this.entries(refresh);
    const items = list.map((e) => {
      const installed = this.exts.byId.get(e.id);
      const st = this.exts.state.data.exts[e.id] || {};
      const fromStore = !!installed && !installed.builtin && st.source === 'store';
      return {
        id: e.id,
        name: e.name,
        version: e.version,
        author: e.author || '',
        description: e.description || '',
        about: e.about || '',
        features: Array.isArray(e.features) ? e.features.slice(0, 8).map(String) : [],
        category: e.category || 'Outros',
        color: /^#[0-9a-f]{3,8}$/i.test(e.color || '') ? e.color : '',
        size: Number(e.size) || 0,
        icon: this.iconOf(e),
        installed: fromStore,
        conflict: !!installed && !fromStore,
        installedVersion: fromStore ? installed.version : '',
        update: fromStore && newer(e.version, installed.version),
        enabled: fromStore ? this.exts.stateOf(e.id).enabled : false,
      };
    });
    return { items, online };
  }

  // Lê os arquivos da extensão (do GitHub ou da cópia do app) antes de mexer em qualquer pasta.
  async _download(e) {
    const files = new Map();
    let total = 0;
    for (const rel of e.files) {
      let buf;
      if (e.source === 'remote') buf = await fetchWithTimeout(`${REMOTE_BASE}${e.id}/${rel.split('/').map(encodeURIComponent).join('/')}`, 15000);
      else buf = fs.readFileSync(path.join(BUNDLED_DIR, e.id, rel));
      total += buf.length;
      if (total > MAX_TOTAL) throw new Error('A extensão é grande demais');
      files.set(rel, buf);
    }
    JSON.parse(files.get('manifest.json').toString('utf8'));
    return files;
  }

  async install(id) {
    const { list } = await this.entries();
    let e = list.find((x) => x.id === id);
    if (!e) throw new Error('Extensão não encontrada na tuff Store');
    const existing = this.exts.byId.get(id);
    const st = this.exts.state.data.exts[id] || {};
    if (existing && (existing.builtin || st.source !== 'store')) throw new Error(`Você já tem uma extensão chamada "${existing.name}" com o mesmo identificador`);

    let files;
    try {
      files = await this._download(e);
    } catch (err) {
      // Sem internet: instala a versão que veio com o app, se houver.
      const local = this.bundled().find((x) => x.id === id);
      if (e.source !== 'remote' || !local) throw new Error(`Não foi possível baixar a extensão (${err.message})`);
      e = { ...local, source: 'bundled' };
      files = await this._download(e);
    }

    const dir = path.join(this.exts.userDir, id);
    const tmp = path.join(this.exts.userDir, `.${id}-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    try {
      for (const [rel, buf] of files) {
        const full = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, buf);
      }
      this.exts.closePopupsOf(id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmp, dir);
    } catch (err) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw err;
    }

    const updating = !!existing;
    this.exts.state.data.exts[id] = {
      ...st,
      source: 'store',
      enabled: updating ? st.enabled !== false : true,
      pinned: updating ? st.pinned ?? !!e.pin : !!e.pin,
    };
    this.exts.state.save();
    this.exts.loadAll();
    this.exts._changed();
    if (updating) this.exts.reloadTabsFor(id);
    return { id, version: e.version, updated: updating };
  }
}

module.exports = { TuffStore, newer };
