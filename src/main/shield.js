'use strict';
// tuff Shield: bloqueio de anúncios, rastreadores, telemetria, avisos de cookies e golpes.
// Junta a lista interna (blocklist.js) com listas de filtros da comunidade (EasyList, uBlock Origin,
// HaGeZi...) interpretadas pelo motor do Ghostery. As listas são baixadas e montadas em segundo plano.
const fs = require('fs');
const path = require('path');
const { app, ipcMain, session, utilityProcess } = require('electron');
const ctx = require('./context');
const { JsonStore } = require('./store');
const {
  ShieldCore, FILTER_LISTS, RESOURCES_URLS, CATEGORIES, OPTIONAL_CATEGORIES, stripTrackingParams,
} = require('./shield-core');

const UPDATE_EVERY = 2 * 24 * 3600 * 1000; // listas são atualizadas a cada 2 dias
const CHECK_EVERY = 3 * 3600 * 1000;
const FIRST_CHECK_DELAY = 20 * 1000;
const BUILDER = path.join(__dirname, 'shield-builder.js');
const ENGINE_FORMAT = `${require('@ghostery/adblocker').ENGINE_VERSION}-1`;

// Acelera anúncios em vídeo do YouTube e clica em "Pular" (reserva para quando as listas não pegam).
const YOUTUBE_SCRIPT = `
(() => {
  if (window.__pulseYt) return; window.__pulseYt = true;
  const tick = () => {
    const player = document.querySelector('.html5-video-player');
    const video = player && player.querySelector('video');
    if (player && video && player.classList.contains('ad-showing')) {
      video.muted = true;
      if (isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration;
      video.playbackRate = 16;
    }
    document.querySelectorAll('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-overlay-close-button')
      .forEach((b) => b.click());
  };
  setInterval(tick, 300);
})();
`;

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isWeb(url) {
  return /^https?:\/\//i.test(url || '');
}

function countRules(text) {
  let n = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '!' || line[0] === '[') continue;
    if (line[0] === '#' && !/^#[@?$%]*#/.test(line)) continue;
    n++;
  }
  return n;
}

const strings = (v, max) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.length > 0 && s.length < 300).slice(0, max) : []);

class Shield {
  constructor() {
    this.core = new ShieldCore();
    this.stats = new JsonStore('shield-stats', { total: 0 }, { delay: 5000 });
    this.dir = path.join(app.getPath('userData'), 'shield');
    this.meta = new JsonStore(path.join('shield', 'shield-lists'), { lists: {}, resources: {}, engine: {} }, { delay: 300 });
    this.attached = new WeakSet();
    this.updating = null;
    this.lastError = '';
    this._rebuildTimer = null;
    this._catsRef = undefined;
    this._disabled = new Set();
    this._registerIpc();
  }

  get total() {
    return this.stats.data.total;
  }

  enabled() {
    return ctx.settings.get('shieldEnabled');
  }

  isAllowlisted(host) {
    if (!host) return false;
    const list = ctx.settings.get('shieldAllowlist');
    return list.some((h) => host === h || host.endsWith(`.${h}`));
  }

  categoryEnabled(id) {
    const cats = ctx.settings.get('shieldCategories') || {};
    return cats[id] !== false;
  }

  disabledCategories() {
    const cats = ctx.settings.get('shieldCategories');
    if (cats !== this._catsRef) {
      this._catsRef = cats;
      this._disabled = new Set(OPTIONAL_CATEGORIES.filter((id) => (cats || {})[id] === false));
    }
    return this._disabled;
  }

  listEnabled(list) {
    if (list.category) return this.categoryEnabled(list.category);
    const lists = ctx.settings.get('shieldLists') || {};
    return lists[list.id] !== false;
  }

  enabledLists() {
    return FILTER_LISTS.filter((l) => this.listEnabled(l));
  }

  // ------------------------------------------------------------------ Arquivos das listas
  listFile(id, i) {
    return path.join(this.dir, 'lists', `${id}-${i}.txt`);
  }

  get engineFile() {
    return path.join(this.dir, 'engine.bin');
  }

  get resourcesFile() {
    return path.join(this.dir, 'resources.json');
  }

  hasListFiles(list) {
    return list.files.some((_f, i) => fs.existsSync(this.listFile(list.id, i)));
  }

  engineKey(lists) {
    const parts = lists.map((l) => `${l.id}@${this.meta.data.lists[l.id]?.updatedAt || 0}`);
    return [ENGINE_FORMAT, app.getVersion(), this.meta.data.resources.updatedAt || 0, ...parts].join('|');
  }

  // ------------------------------------------------------------------ Início
  async start() {
    fs.mkdirSync(path.join(this.dir, 'lists'), { recursive: true });
    // Versões antigas guardavam uma lista ampliada separada; o arquivo não é mais usado.
    fs.rm(path.join(app.getPath('userData'), 'shield-extended.txt'), { force: true }, () => {});
    try {
      await this.loadEngine();
    } catch (err) {
      console.warn('[shield] motor não carregado:', err.message);
    }
    setTimeout(() => this.updateLists(false).catch(() => {}), this.core.engine ? FIRST_CHECK_DELAY : 1500);
    this._checkTimer = setInterval(() => this.updateLists(false).catch(() => {}), CHECK_EVERY);
  }

  // Carrega o motor salvo ou monta um novo a partir das listas já baixadas.
  async loadEngine() {
    const lists = this.enabledLists();
    if (!lists.length) {
      this.core.setEngine(null);
      return false;
    }
    const key = this.engineKey(lists);
    if (this.meta.data.engine.key === key && fs.existsSync(this.engineFile)) {
      const buf = await fs.promises.readFile(this.engineFile);
      this.core.setEngine(ShieldCore.engineFromBuffer(buf));
      return true;
    }
    if (!lists.some((l) => this.hasListFiles(l))) return false;
    return this.rebuild();
  }

  async rebuild() {
    const lists = this.enabledLists();
    if (!lists.length) {
      this.core.setEngine(null);
      this._changed();
      return false;
    }
    const files = [];
    for (const l of lists) l.files.forEach((_f, i) => files.push(this.listFile(l.id, i)));
    const key = this.engineKey(lists);
    this.building = true;
    this._changed();
    let res;
    try {
      res = await this._runBuilder({
        files: files.filter((f) => fs.existsSync(f)),
        resources: fs.existsSync(this.resourcesFile) ? this.resourcesFile : '',
        out: this.engineFile,
      });
    } finally {
      this.building = false;
    }
    if (ctx.quitting) return false;
    if (!res.ok) {
      this.lastError = `Não foi possível montar as listas: ${res.error}`;
      console.warn('[shield]', this.lastError);
      this._changed();
      return false;
    }
    const buf = await fs.promises.readFile(this.engineFile);
    this.core.setEngine(ShieldCore.engineFromBuffer(buf));
    this.meta.data.engine = { key, builtAt: Date.now(), network: res.network, cosmetic: res.cosmetic, ms: res.ms };
    this.meta.save();
    this.lastError = '';
    this._changed();
    return true;
  }

  _runBuilder(job) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          child.kill();
        } catch { /* já saiu */ }
        resolve(r);
      };
      const child = utilityProcess.fork(BUILDER, [], { serviceName: 'tuff Shield', stdio: 'ignore' });
      const timer = setTimeout(() => finish({ ok: false, error: 'tempo esgotado' }), 180000);
      child.on('message', (m) => finish(m || { ok: false, error: 'sem resposta' }));
      child.on('exit', (code) => finish({ ok: false, error: `processo encerrado (${code})` }));
      child.postMessage(job);
    });
  }

  // ------------------------------------------------------------------ Atualização
  get net() {
    if (!this._net) this._net = session.fromPartition('pulse-shield-updates', { cache: false });
    return this._net;
  }

  async _download(urls, file, prev = {}) {
    let lastErr = '';
    for (const url of urls) {
      try {
        const headers = {};
        if (prev.url === url && fs.existsSync(file)) {
          if (prev.etag) headers['If-None-Match'] = prev.etag;
          if (prev.lastModified) headers['If-Modified-Since'] = prev.lastModified;
        }
        const res = await this.net.fetch(url, { headers, signal: AbortSignal.timeout(60000) });
        if (res.status === 304) return { ...prev, changed: false, ok: true };
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (text.length < 20 || /^\s*</.test(text)) throw new Error('conteúdo inválido');
        const tmp = `${file}.tmp`;
        await fs.promises.writeFile(tmp, text);
        await fs.promises.rename(tmp, file);
        return {
          ok: true, changed: true, url, rules: countRules(text),
          etag: res.headers.get('etag') || '', lastModified: res.headers.get('last-modified') || '',
        };
      } catch (err) {
        lastErr = err.message;
      }
    }
    return { ok: false, error: lastErr };
  }

  // Baixa as listas ligadas que estão velhas (ou todas, com force) e remonta o motor se algo mudou.
  updateLists(force = false) {
    if (this.updating) return this.updating;
    this.updating = (async () => {
      this._changed();
      const now = Date.now();
      let changed = false;
      const lists = this.enabledLists();
      const meta = this.meta.data;
      const jobs = [];
      for (const l of lists) {
        const m = meta.lists[l.id] || {};
        const stale = force || !m.updatedAt || now - m.updatedAt > UPDATE_EVERY || !this.hasListFiles(l);
        if (stale) jobs.push(l);
      }
      const resStale = force || !meta.resources.updatedAt || now - meta.resources.updatedAt > UPDATE_EVERY;
      const work = jobs.map((l) => async () => {
        const m = meta.lists[l.id] || {};
        const prevFiles = m.files || [];
        const results = [];
        for (let i = 0; i < l.files.length; i++) {
          results.push(await this._download(l.files[i], this.listFile(l.id, i), prevFiles[i] || {}));
        }
        const okAll = results.every((r) => r.ok);
        const anyOk = results.some((r) => r.ok);
        if (results.some((r) => r.changed)) changed = true;
        meta.lists[l.id] = {
          ...m,
          files: results.map((r, i) => (r.ok ? { url: r.url || prevFiles[i]?.url, etag: r.etag, lastModified: r.lastModified, rules: r.rules ?? prevFiles[i]?.rules ?? 0 } : prevFiles[i] || {})),
          updatedAt: anyOk ? Date.now() : m.updatedAt || 0,
          error: okAll ? '' : results.find((r) => !r.ok).error,
        };
        meta.lists[l.id].rules = meta.lists[l.id].files.reduce((s, f) => s + (f.rules || 0), 0);
        this.meta.save();
        this._changed();
      });
      if (resStale) {
        work.push(async () => {
          const r = await this._download(RESOURCES_URLS, this.resourcesFile, meta.resources);
          if (r.ok) {
            if (r.changed) changed = true;
            meta.resources = { url: r.url || meta.resources.url, etag: r.etag, lastModified: r.lastModified, updatedAt: Date.now() };
            this.meta.save();
          }
        });
      }
      // Até 4 downloads ao mesmo tempo.
      const queue = [...work];
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length) await queue.shift()();
      }));
      const key = this.engineKey(lists);
      if (changed || !this.core.engine || meta.engine.key !== key) await this.rebuild();
      const failed = lists.filter((l) => meta.lists[l.id]?.error && !this.hasListFiles(l));
      if (failed.length) this.lastError = `Não foi possível baixar: ${failed.map((l) => l.name).join(', ')}`;
      else if (this.lastError.startsWith('Não foi possível baixar')) this.lastError = '';
      return this.status();
    })().finally(() => {
      this.updating = null;
      this._changed();
    });
    return this.updating;
  }

  // Chamado quando o usuário liga/desliga listas ou categorias.
  reconfigure() {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      const lists = this.enabledLists();
      const missing = lists.some((l) => !this.hasListFiles(l));
      const run = missing ? () => this.updateLists(false) : () => this.loadEngine();
      (this.updating ? this.updating.then(run) : run()).catch((err) => console.warn('[shield]', err.message));
    }, 400);
  }

  _changed() {
    clearTimeout(this._changedTimer);
    this._changedTimer = setTimeout(() => {
      try {
        require('./ipc').broadcastInternal('internal:shield-changed', this.status());
      } catch { /* ipc ainda não registrado */ }
    }, 100);
  }

  status() {
    const meta = this.meta.data;
    return {
      total: this.total,
      builtin: this.core.rules.size,
      engine: this.core.engine ? { network: meta.engine.network || 0, cosmetic: meta.engine.cosmetic || 0, builtAt: meta.engine.builtAt || 0 } : null,
      updating: !!(this.updating || this.building),
      error: this.lastError,
      lists: FILTER_LISTS.filter((l) => !l.category).map((l) => ({
        id: l.id, name: l.name, desc: l.desc, enabled: this.listEnabled(l),
        rules: meta.lists[l.id]?.rules || 0, updatedAt: meta.lists[l.id]?.updatedAt || 0,
        error: meta.lists[l.id]?.error || '', downloaded: this.hasListFiles(l),
      })),
      categories: CATEGORIES.map((c) => ({
        id: c.id, label: c.label, desc: c.desc || '', color: c.color, optional: !!c.optional,
        enabled: c.optional ? this.categoryEnabled(c.id) : true,
      })),
    };
  }

  // ------------------------------------------------------------------ Bloqueio nas sessões
  attach(ses, findTab) {
    if (this.attached.has(ses)) return;
    this.attached.add(ses);

    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      if (!this.enabled()) return callback({});
      const type = details.resourceType;
      const url = details.url;
      const tab = details.webContentsId ? findTab(details.webContentsId) : null;

      if (type === 'mainFrame') {
        // Tira fbclid, gclid & cia. dos links abertos.
        if (url.includes('?') && ctx.settings.get('shieldStripParams') !== false && !this.isAllowlisted(hostOf(url))) {
          const clean = stripTrackingParams(url);
          if (clean !== url) return callback({ redirectURL: clean });
        }
        return callback({});
      }

      let sourceUrl = '';
      try {
        const f = details.frame;
        if (f) sourceUrl = type === 'subFrame' && f.parent ? f.parent.url : f.url;
      } catch { /* quadro já fechado */ }
      if (!isWeb(sourceUrl)) sourceUrl = details.referrer || (tab ? tab.url : '') || '';
      const topUrl = tab ? tab.url : sourceUrl;
      // Páginas internas do navegador e sites liberados pelo usuário não passam pelo Shield.
      if (topUrl.startsWith('tuff:') || this.isAllowlisted(hostOf(topUrl))) return callback({});

      let r;
      try {
        r = this.core.match({ url, sourceUrl, type }, { disabled: this.disabledCategories() });
      } catch {
        return callback({});
      }
      if (r.action === 'allow') return callback({});
      if (tab) tab.onRequestBlocked(hostOf(url), r.cat);
      this.stats.data.total += 1;
      this.stats.save();
      if (r.action === 'redirect') return callback({ redirectURL: r.redirectURL });
      return callback({ cancel: true });
    });

    // Só pode haver um tratador de cabeçalhos por sessão: DNT/GPC e o modo de compatibilidade do Google ficam aqui.
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = details.requestHeaders;
      if (ctx.settings.get('doNotTrack')) {
        headers.DNT = '1';
        headers['Sec-GPC'] = '1';
      }
      if (ctx.accounts && ctx.settings.get('googleCompat') && hostOf(details.url) === 'accounts.google.com') {
        headers['User-Agent'] = ctx.accounts.firefoxUA;
        for (const k of Object.keys(headers)) if (/^sec-ch-ua/i.test(k)) delete headers[k];
      }
      callback({ requestHeaders: headers });
    });
  }

  // ------------------------------------------------------------------ Cosméticos (script content-shield.js)
  _frameAllowed(event, url) {
    if (!this.enabled() || !isWeb(url)) return false;
    let top = url;
    try {
      const f = event.senderFrame;
      if (f && f.top && f.top !== f) top = f.top.url;
    } catch { /* ignora */ }
    return !this.isAllowlisted(hostOf(top));
  }

  _registerIpc() {
    ipcMain.on('shield:frame-start', (event, url) => {
      try {
        if (typeof url !== 'string' || !this._frameAllowed(event, url)) {
          event.returnValue = null;
          return;
        }
        const c = this.core.cosmetics(url);
        if (c) {
          const host = hostOf(url);
          if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') c.scripts = [...c.scripts, YOUTUBE_SCRIPT];
        }
        event.returnValue = c;
      } catch (err) {
        console.warn('[shield] cosméticos:', err.message);
        event.returnValue = null;
      }
    });

    ipcMain.handle('shield:dom', (event, payload) => {
      try {
        const url = event.senderFrame ? event.senderFrame.url : '';
        if (!payload || !this._frameAllowed(event, url)) return '';
        return this.core.domCosmetics(url, {
          classes: strings(payload.classes, 3000), ids: strings(payload.ids, 3000), hrefs: strings(payload.hrefs, 1000),
        });
      } catch {
        return '';
      }
    });
  }
}

module.exports = { Shield, hostOf };
