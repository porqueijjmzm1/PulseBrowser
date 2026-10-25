'use strict';
// Uma aba do navegador: envolve uma WebContentsView do Chromium.
const path = require('path');
const { WebContentsView, dialog, nativeTheme } = require('electron');
const ctx = require('./context');
const { showPageMenu } = require('./contextmenu');

const TAB_PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');
const NEW_TAB = 'pulse://newtab/';
let nextTabId = 1;

function isInternal(url) {
  return typeof url === 'string' && url.startsWith('pulse:');
}

function tabWebPreferences(ses) {
  return {
    preload: TAB_PRELOAD,
    session: ses,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    plugins: true, // visualizador de PDF do Chromium
    spellcheck: ctx.settings.get('spellcheck'),
    safeDialogs: true,
    safeDialogsMessage: 'Impedir que esta página crie mais caixas de diálogo',
    scrollBounce: true,
  };
}

class Tab {
  constructor(win, opts = {}) {
    this.id = nextTabId++;
    this.window = win;
    this.url = opts.url || NEW_TAB;
    this.title = opts.title || '';
    this.favicon = opts.favicon || '';
    this.pinned = !!opts.pinned;
    this.muted = !!opts.muted;
    this.loading = false;
    this.audible = false;
    this.crashed = false;
    this.blocked = 0;
    this.blockedHosts = new Set();
    this.blockedCats = {};
    this.zoom = 1;
    this.openerId = opts.opener ? opts.opener.id : null;
    this.lastActive = Date.now();
    this.historyId = null;
    this.errorInfo = null;
    this.devtoolsView = null;
    this.view = null;
    this.navEntries = Array.isArray(opts.entries) && opts.entries.length ? opts.entries : null;
    this.navIndex = Number.isInteger(opts.index) ? opts.index : undefined;
    this.closed = false;
    this.viewSource = this.url.startsWith('view-source:');

    if (opts.webContents) this._createView(opts.webContents);
    else if (!opts.discarded) this._createView();
  }

  get webContents() {
    return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
  }

  get discarded() {
    return !this.view;
  }

  get isNewTab() {
    return this.url.startsWith('pulse://newtab');
  }

  // URL mostrada ao usuário (a página de erro mostra o endereço original).
  get displayUrl() {
    if (this.url.startsWith('pulse://error')) {
      try {
        return new URL(this.url).searchParams.get('url') || this.url;
      } catch {
        return this.url;
      }
    }
    return this.url;
  }

  ensureView() {
    if (!this.view) this._createView();
    return this.view;
  }

  _createView(adopt) {
    const view = adopt
      ? new WebContentsView({ webContents: adopt })
      : new WebContentsView({ webPreferences: tabWebPreferences(this.window.session) });
    view.setBackgroundColor(this._backgroundFor(this.url));
    this.view = view;
    const wc = view.webContents;
    this._bind(wc);
    if (this.muted) wc.setAudioMuted(true);
    if (adopt) return;
    if (this.navEntries) {
      const entries = this.navEntries;
      const index = this.navIndex;
      this.navEntries = null;
      wc.navigationHistory.restore({ entries, index }).catch(() => wc.loadURL(this.url).catch(() => {}));
    } else {
      wc.loadURL(this.url).catch(() => {});
    }
  }

  _backgroundFor(url) {
    if (isInternal(url)) return nativeTheme.shouldUseDarkColors || this.window.incognito ? '#17161c' : '#f6f5fa';
    return '#ffffff';
  }

  _update() {
    this.window.onTabUpdated(this);
  }

  _bind(wc) {
    wc.setWindowOpenHandler((details) => this.window.handleWindowOpen(this, details));

    wc.on('did-start-loading', () => {
      this.loading = true;
      this.crashed = false;
      this._update();
    });
    wc.on('did-stop-loading', () => {
      this.loading = false;
      // Páginas sem <title>: mostra o endereço em vez do título da página anterior.
      if (!this.title && !this.url.startsWith('pulse://error')) {
        const t = wc.getTitle();
        if (t && t !== this.url) this.title = t;
      }
      this._update();
    });
    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      this.view?.setBackgroundColor(this._backgroundFor(details.url));
    });
    wc.on('dom-ready', () => ctx.injector?.onDomReady(this));
    wc.on('did-navigate', (_e, rawUrl, httpResponseCode) => {
      const url = this.viewSource && !rawUrl.startsWith('view-source:') && /^(https?|file):/i.test(rawUrl)
        ? `view-source:${rawUrl}`
        : rawUrl;
      this.url = url;
      this.title = '';
      this.historyId = null;
      this.blocked = 0;
      this.blockedHosts.clear();
      this.blockedCats = {};
      this.favicon = '';
      this.zoom = wc.getZoomFactor();
      if (url.startsWith('pulse://error')) {
        this._dropFailedEntry();
      } else {
        this.errorInfo = null;
        // Navegações que falharam (código <= 0) não entram no histórico.
        if (httpResponseCode > 0 || url.startsWith('file:')) this._recordHistory(url);
      }
      this._update();
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.url = url;
      this._recordHistory(url);
      this._update();
    });
    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      if (this.historyId != null) ctx.history.updateVisit(this.historyId, { title });
      this._update();
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.favicon = favicons && favicons.length ? favicons[0] : '';
      if (this.historyId != null && this.favicon) ctx.history.updateVisit(this.historyId, { favicon: this.favicon });
      this._update();
    });
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || !url || url.startsWith('pulse://error')) return;
      this.showError(url, code, desc);
    });
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      this.crashed = true;
      this.loading = false;
      this._update();
      const failed = this.displayUrl;
      setTimeout(() => {
        if (!this.webContents) return;
        this.showError(failed, 'crash', details.reason);
      }, 50);
    });
    wc.on('unresponsive', () => {
      dialog.showMessageBox(this.window.win, {
        type: 'warning',
        buttons: ['Esperar', 'Encerrar página'],
        defaultId: 0,
        cancelId: 0,
        title: 'Página sem resposta',
        message: 'A página não está respondendo',
        detail: this.title || this.displayUrl,
      }).then(({ response }) => {
        if (response === 1 && this.webContents) this.webContents.forcefullyCrashRenderer();
      });
    });
    wc.on('audio-state-changed', (event) => {
      this.audible = !!event.audible;
      this._update();
    });
    wc.on('enter-html-full-screen', () => this.window.setHtmlFullscreen(true, this));
    wc.on('leave-html-full-screen', () => this.window.setHtmlFullscreen(false, this));
    wc.on('found-in-page', (_e, result) => this.window.onFindResult(this, result));
    wc.on('context-menu', (_e, params) => showPageMenu(this, params));
    wc.on('before-input-event', (event, input) => this.window.handleInput(event, input, this));
    wc.on('zoom-changed', (_e, direction) => this.window.zoom(direction === 'in' ? 1 : -1, this));
    wc.on('update-target-url', (_e, url) => {
      if (this.window.activeTab === this) this.window.setStatus(url);
    });
    wc.on('will-navigate', (details) => {
      // Sites comuns não podem abrir páginas internas do navegador.
      if (isInternal(details.url) && !isInternal(wc.getURL())) details.preventDefault();
    });
    wc.on('will-prevent-unload', (event) => {
      const choice = dialog.showMessageBoxSync(this.window.win, {
        type: 'question',
        buttons: ['Sair', 'Cancelar'],
        defaultId: 0,
        cancelId: 1,
        title: 'Sair do site?',
        message: 'Sair do site?',
        detail: 'As alterações que você fez talvez não sejam salvas.',
      });
      if (choice === 0) event.preventDefault();
    });
    wc.on('login', (event, _details, authInfo, callback) => {
      event.preventDefault();
      this.window.promptAuth({ host: authInfo.host, realm: authInfo.realm, isProxy: authInfo.isProxy, callback });
    });
    wc.on('devtools-closed', () => this._removeDevtoolsView());
    wc.on('did-create-window', (child) => this.window.setupPopupWindow(child));
  }

  _recordHistory(url) {
    if (this.window.incognito) return;
    if (!/^(https?|file):/i.test(url)) {
      this.historyId = null;
      return;
    }
    this.historyId = ctx.history.addVisit(url, '', '');
  }

  // Remove do histórico de navegação a entrada em branco da navegação que falhou.
  _dropFailedEntry() {
    const wc = this.webContents;
    if (!wc || !this.errorInfo) return;
    try {
      const nav = wc.navigationHistory;
      const idx = nav.getActiveIndex();
      if (idx > 0) {
        const prev = nav.getEntryAtIndex(idx - 1);
        if (prev && prev.url === this.errorInfo.url) nav.removeEntryAtIndex(idx - 1);
      }
    } catch { /* ignora */ }
  }

  showError(url, code, desc) {
    const wc = this.webContents;
    if (!wc) return;
    this.errorInfo = { url, code, desc };
    const q = new URLSearchParams({ url, code: String(code), desc: desc || '' });
    wc.loadURL(`pulse://error/?${q.toString()}`).catch(() => {});
  }

  onRequestBlocked(host, cat = 'ads') {
    this.blocked += 1;
    this.blockedHosts.add(host);
    this.blockedCats[cat] = (this.blockedCats[cat] || 0) + 1;
    this._update();
  }

  // ---- Navegação ----
  loadURL(url) {
    this.ensureView();
    this.errorInfo = null;
    this.viewSource = url.startsWith('view-source:');
    this.url = url;
    this.webContents?.loadURL(url).catch(() => {});
    this._update();
  }

  goBack() {
    const wc = this.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward() {
    const wc = this.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  goToOffset(offset) {
    const wc = this.webContents;
    if (wc?.navigationHistory.canGoToOffset(offset)) wc.navigationHistory.goToOffset(offset);
  }

  reload(ignoreCache = false) {
    const wc = this.webContents;
    if (!wc) return;
    if (this.url.startsWith('pulse://error')) {
      const original = this.errorInfo?.url || this.displayUrl;
      if (original && !original.startsWith('pulse://error')) {
        this.loadURL(original);
        return;
      }
    }
    if (ignoreCache) wc.reloadIgnoringCache();
    else wc.reload();
  }

  stop() {
    this.webContents?.stop();
  }

  setMuted(muted) {
    this.muted = muted;
    this.webContents?.setAudioMuted(muted);
    this._update();
  }

  // ---- DevTools encaixadas à direita ----
  toggleDevTools() {
    const wc = this.webContents;
    if (!wc) return;
    if (this.devtoolsView) {
      try {
        wc.closeDevTools();
      } catch { /* ignora */ }
      this._removeDevtoolsView();
      return;
    }
    this._openDevtools();
  }

  _openDevtools() {
    const wc = this.webContents;
    if (!wc || this.devtoolsView) return;
    this.devtoolsView = new WebContentsView();
    this.devtoolsView.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#202124' : '#ffffff');
    wc.setDevToolsWebContents(this.devtoolsView.webContents);
    wc.openDevTools({ mode: 'detach', activate: true });
    this.window.onDevtoolsChanged(this);
  }

  inspectElement(x, y) {
    const wc = this.webContents;
    if (!wc) return;
    if (!this.devtoolsView) this._openDevtools();
    wc.inspectElement(x, y);
  }

  _removeDevtoolsView() {
    const dv = this.devtoolsView;
    if (!dv) return;
    this.devtoolsView = null;
    this.window.onDevtoolsChanged(this, dv);
    setTimeout(() => {
      try {
        if (!dv.webContents.isDestroyed()) dv.webContents.close();
      } catch { /* ignora */ }
    }, 0);
  }

  // ---- Economia de memória ----
  discard() {
    const wc = this.webContents;
    if (!wc) return false;
    try {
      this.navEntries = wc.navigationHistory.getAllEntries();
      this.navIndex = wc.navigationHistory.getActiveIndex();
    } catch {
      this.navEntries = null;
    }
    this.window.detachTabView(this);
    if (this.devtoolsView) this._removeDevtoolsView();
    const view = this.view;
    this.view = null;
    this.loading = false;
    this.audible = false;
    try {
      view.webContents.close();
    } catch { /* ignora */ }
    this._update();
    return true;
  }

  destroy() {
    this.closed = true;
    if (this.devtoolsView) {
      try {
        this.devtoolsView.webContents.close();
      } catch { /* ignora */ }
      this.devtoolsView = null;
    }
    const wc = this.webContents;
    this.view = null;
    if (wc) {
      try {
        wc.close();
      } catch { /* ignora */ }
    }
  }

  canGoBack() {
    const wc = this.webContents;
    if (wc) return wc.navigationHistory.canGoBack();
    return !!(this.navEntries && (this.navIndex ?? this.navEntries.length - 1) > 0);
  }

  canGoForward() {
    const wc = this.webContents;
    if (wc) return wc.navigationHistory.canGoForward();
    return !!(this.navEntries && (this.navIndex ?? this.navEntries.length - 1) < this.navEntries.length - 1);
  }

  security() {
    if (this.url.startsWith('pulse://error')) {
      const code = Number(this.errorInfo?.code ?? new URL(this.url).searchParams.get('code'));
      return code <= -200 && code > -300 ? 'dangerous' : 'error';
    }
    const u = this.displayUrl;
    if (isInternal(u)) return 'internal';
    if (u.startsWith('https:') || u.startsWith('wss:')) {
      try {
        if (this.window.certExceptions().has(new URL(u).host)) return 'dangerous';
      } catch { /* ignora */ }
      return 'secure';
    }
    if (u.startsWith('http:')) return 'insecure';
    if (u.startsWith('file:')) return 'file';
    if (u.startsWith('chrome-extension:')) return 'extension';
    return 'neutral';
  }

  serialize() {
    const url = this.displayUrl;
    let title = this.title;
    if (!title) title = this.isNewTab ? 'Nova aba' : url.replace(/^https?:\/\//, '');
    return {
      id: this.id,
      title,
      url,
      favicon: this.favicon,
      loading: this.loading,
      canGoBack: this.canGoBack(),
      canGoForward: this.canGoForward(),
      audible: this.audible,
      muted: this.muted,
      pinned: this.pinned,
      blocked: this.blocked,
      zoom: Math.round(this.zoom * 100),
      crashed: this.crashed,
      discarded: this.discarded,
      security: this.security(),
      bookmarked: ctx.bookmarks.isBookmarked(url),
      internal: isInternal(url),
      newTab: this.isNewTab,
      devtools: !!this.devtoolsView,
      passwords: ctx.passwords && /^https?:/i.test(url) ? ctx.passwords.countFor(url) : 0,
    };
  }

  serializeForSession() {
    let entries = null;
    let index;
    const wc = this.webContents;
    try {
      if (wc) {
        const all = wc.navigationHistory.getAllEntries();
        const active = wc.navigationHistory.getActiveIndex();
        const start = Math.max(0, all.length - 15);
        entries = all.slice(start).map((e) => ({ url: e.url, title: e.title }));
        index = Math.max(0, active - start);
      } else if (this.navEntries) {
        const start = Math.max(0, this.navEntries.length - 15);
        entries = this.navEntries.slice(start).map((e) => ({ url: e.url, title: e.title }));
        index = Math.max(0, (this.navIndex ?? this.navEntries.length - 1) - start);
      }
    } catch {
      entries = null;
    }
    if (entries && entries.length < 2) entries = null;
    return {
      url: this.displayUrl,
      title: this.title,
      favicon: this.favicon,
      pinned: this.pinned,
      muted: this.muted,
      entries,
      index,
    };
  }
}

module.exports = { Tab, NEW_TAB, isInternal };
