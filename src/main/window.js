'use strict';
// Janela do navegador: barra de abas/ferramentas (interface), abas e sobreposição de pop-ups.
const fs = require('fs');
const path = require('path');
const {
  app, BrowserWindow, WebContentsView, session, nativeTheme, Menu, dialog, clipboard, screen, shell,
} = require('electron');
const ctx = require('./context');
const { Tab, NEW_TAB, isInternal } = require('./tab');
const shortcuts = require('./shortcuts');
const { resolveInput } = require('./omnibox');
const permissions = require('./permissions');
const sessions = require('./sessions');
const sessionstore = require('./sessionstore');
const { hostOf } = require('./shield');

const UI_PRELOAD = path.join(__dirname, '..', 'preload', 'ui-preload.js');
const UI_DIR = path.join(__dirname, '..', 'ui');
const ICON = path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const isMac = process.platform === 'darwin';
const TITLEBAR_HEIGHT = 40;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const PROMPT_TYPES = new Set(['permission', 'auth', 'screenshare', 'password']);
const SINGLETON_PAGES = new Set(['settings', 'history', 'downloads', 'bookmarks', 'about', 'passwords']);
const POPUP_EXIT_MS = 110;

let nextWindowId = 1;

function truncate(s, n = 50) {
  const t = String(s || '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function sanitizeFilename(s) {
  return String(s || 'pagina').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'pagina';
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

class PulseWindow {
  static open(opts = {}) {
    return new PulseWindow(opts);
  }

  constructor(opts = {}) {
    this.id = nextWindowId++;
    this.incognito = !!opts.incognito;
    this.session = this.incognito ? sessions.getIncognitoSession() : sessions.setupSession(session.defaultSession);
    this.tabs = [];
    this.activeTab = null;
    this.uiHeight = 82;
    this.metrics = { omnibox: { left: 160, right: 900, top: 44, bottom: 78 } };
    this.uiReady = false;
    this.overlayReady = false;
    this.overlayQueue = [];
    this.popup = null;
    this.promptQueue = [];
    this.statusText = '';
    this.toastTimer = null;
    this.toastActive = false;
    this.htmlFullscreenTab = null;
    this.closedTabs = [];
    this.closing = false;
    this._forceClose = false;
    this._updateTimer = null;

    const colors = this.chromeColors();
    this.win = new BrowserWindow({
      ...this._initialBounds(opts.bounds),
      minWidth: 480,
      minHeight: 320,
      show: false,
      title: 'PulseBrowser',
      icon: ICON,
      backgroundColor: colors.bg,
      titleBarStyle: 'hidden',
      ...(isMac
        ? { trafficLightPosition: { x: 14, y: 13 } }
        : { titleBarOverlay: { color: colors.bg, symbolColor: colors.fg, height: TITLEBAR_HEIGHT } }),
      webPreferences: {
        preload: UI_PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        session: this.session,
      },
    });
    if (opts.maximized) this.win.maximize();

    this.overlay = new WebContentsView({
      webPreferences: {
        preload: UI_PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        transparent: true,
        session: this.session,
      },
    });
    this.overlay.setBackgroundColor('#00000000');
    this.overlay.setVisible(false);
    this.win.contentView.addChildView(this.overlay);

    const query = { incognito: this.incognito ? '1' : '0', platform: process.platform };
    this.win.loadFile(path.join(UI_DIR, 'index.html'), { query });
    this.overlay.webContents.loadFile(path.join(UI_DIR, 'overlay.html'), { query });
    this._sendOverlay('overlay:settings', { animations: ctx.settings.get('animations') });

    this._bindWindow();
    ctx.windows.push(this);
    ctx.lastFocusedWindow = this;

    // Abas iniciais.
    if (Array.isArray(opts.restoreTabs) && opts.restoreTabs.length) {
      const activeIndex = Math.min(Math.max(0, opts.activeIndex || 0), opts.restoreTabs.length - 1);
      opts.restoreTabs.forEach((t, i) => {
        this.createTab({ ...t, active: i === activeIndex, discarded: i !== activeIndex, restoring: true });
      });
    } else if (opts.adoptTab) {
      this.adoptTab(opts.adoptTab);
    } else {
      const urls = opts.urls && opts.urls.length ? opts.urls : [opts.url || NEW_TAB];
      urls.forEach((u, i) => this.createTab({ url: u, active: i === 0 }));
    }
  }

  _initialBounds(saved) {
    const area = screen.getPrimaryDisplay().workArea;
    if (saved && saved.width >= 480 && saved.height >= 320) {
      const visible = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return saved.x < a.x + a.width - 50 && saved.x + saved.width > a.x + 50 && saved.y >= a.y - 10 && saved.y < a.y + a.height - 50;
      });
      if (visible) {
        const offset = ctx.windows.length ? 24 : 0;
        return { x: saved.x + offset, y: saved.y + offset, width: saved.width, height: saved.height };
      }
    }
    const width = Math.min(1360, Math.round(area.width * 0.85));
    const height = Math.min(880, Math.round(area.height * 0.88));
    const offset = (ctx.windows.length % 6) * 24;
    return {
      width,
      height,
      x: Math.round(area.x + (area.width - width) / 2 + offset),
      y: Math.round(area.y + (area.height - height) / 2 + offset),
    };
  }

  chromeColors() {
    if (this.incognito) return { bg: '#1c1527', fg: '#efe9fb' };
    return nativeTheme.shouldUseDarkColors ? { bg: '#1b1a20', fg: '#f1f1f4' } : { bg: '#e9e8ef', fg: '#1d1c22' };
  }

  updateTitleBarColors() {
    if (isMac || this.win.isDestroyed()) return;
    const c = this.chromeColors();
    try {
      this.win.setTitleBarOverlay({ color: c.bg, symbolColor: c.fg, height: TITLEBAR_HEIGHT });
    } catch { /* ignora */ }
    this.win.setBackgroundColor(c.bg);
  }

  _bindWindow() {
    const win = this.win;
    const ui = win.webContents;
    const ov = this.overlay.webContents;

    win.once('ready-to-show', () => win.show());
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    }, 3000);

    for (const wc of [ui, ov]) {
      wc.on('will-navigate', (e) => e.preventDefault());
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
      wc.on('before-input-event', (event, input) => this.handleInput(event, input, null, wc === ov ? 'overlay' : 'ui'));
    }
    ui.on('did-finish-load', () => {
      this.uiReady = true;
      this.sendFullState();
    });
    ui.on('render-process-gone', () => {
      if (!win.isDestroyed()) ui.reload();
    });
    ov.on('did-finish-load', () => {
      this.overlayReady = true;
      const q = this.overlayQueue;
      this.overlayQueue = [];
      for (const [ch, data] of q) ov.send(ch, data);
    });
    ov.on('render-process-gone', () => {
      this.overlayReady = false;
      if (!win.isDestroyed()) ov.reload();
    });

    win.on('resize', () => {
      this.layout();
      if (this.popup && !PROMPT_TYPES.has(this.popup.type)) this.hidePopup();
      else if (this.popup) this._layoutOverlay();
    });
    win.on('focus', () => {
      ctx.lastFocusedWindow = this;
      this.sendUI('ui:window-state', this.windowState());
    });
    win.on('blur', () => {
      if (this.popup && !PROMPT_TYPES.has(this.popup.type) && this.popup.type !== 'bookmark') this.hidePopup();
      this.sendUI('ui:window-state', this.windowState());
    });
    for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
      win.on(ev, () => {
        this.sendUI('ui:window-state', this.windowState());
        setTimeout(() => this.layout(), 0);
      });
    }
    win.on('app-command', (_e, cmd) => {
      if (cmd === 'browser-backward') this.activeTab?.goBack();
      else if (cmd === 'browser-forward') this.activeTab?.goForward();
      else if (cmd === 'browser-refresh') this.activeTab?.reload();
      else if (cmd === 'browser-home') this.command('home');
    });
    win.on('close', (e) => {
      if (!ctx.quitting && !this._forceClose && ctx.settings.get('confirmCloseMultipleTabs') && this.tabs.length > 1) {
        e.preventDefault();
        dialog.showMessageBox(win, {
          type: 'question',
          buttons: ['Fechar abas', 'Cancelar'],
          defaultId: 0,
          cancelId: 1,
          title: 'PulseBrowser',
          message: `Fechar ${this.tabs.length} abas?`,
          detail: this.incognito ? 'As abas anônimas serão perdidas.' : 'Você pode reabri-las ao iniciar se "Continuar de onde parou" estiver ativo.',
          checkboxLabel: 'Não perguntar novamente',
        }).then(({ response, checkboxChecked }) => {
          if (response !== 0) return;
          if (checkboxChecked) ctx.settings.set('confirmCloseMultipleTabs', false);
          this._forceClose = true;
          win.close();
        });
        return;
      }
      sessionstore.onWindowClosing(this);
      this.closing = true;
    });
    win.on('closed', () => this._onClosed());
  }

  _onClosed() {
    this.closing = true;
    for (const t of this.tabs) {
      if (!this.incognito) this._rememberClosed(t, this.tabs.indexOf(t), true);
      t.destroy();
    }
    this.tabs = [];
    this.activeTab = null;
    try {
      this.overlay.webContents.close();
    } catch { /* ignora */ }
    ctx.windows = ctx.windows.filter((w) => w !== this);
    if (ctx.lastFocusedWindow === this) ctx.lastFocusedWindow = ctx.windows[ctx.windows.length - 1] || null;
    if (this.incognito) sessions.disposeIncognitoIfUnused();
  }

  windowState() {
    if (this.win.isDestroyed()) return {};
    return {
      maximized: this.win.isMaximized(),
      fullscreen: this.win.isFullScreen(),
      focused: this.win.isFocused(),
      htmlFullscreen: !!this.htmlFullscreenTab,
    };
  }

  // ---------------------------------------------------------------- Comunicação
  sendUI(channel, data) {
    if (!this.uiReady || this.win.isDestroyed()) return;
    this.win.webContents.send(channel, data);
  }

  _sendOverlay(channel, data) {
    if (this.overlay.webContents.isDestroyed()) return;
    if (!this.overlayReady) {
      this.overlayQueue.push([channel, data]);
      return;
    }
    this.overlay.webContents.send(channel, data);
  }

  sendFullState() {
    this.sendUI('ui:settings', ctx.settings.publicData());
    this.sendUI('ui:bookmarks', this.bookmarksBarData());
    this.sendUI('ui:downloads', ctx.downloads.summary());
    if (!this.incognito) this.sendUI('ui:account', ctx.accounts.publicData());
    this.sendUI('ui:window-state', this.windowState());
    this._sendTabs();
    if (this.activeTab?.isNewTab) setTimeout(() => this.focusOmnibox(), 50);
  }

  bookmarksBarData() {
    const bar = ctx.bookmarks.find('bar')?.node;
    const other = ctx.bookmarks.find('other')?.node;
    const shallow = (n) => ({
      id: n.id, type: n.type, title: n.title, url: n.url, favicon: n.favicon, count: n.children ? n.children.length : 0,
    });
    return { bar: bar ? bar.children.map(shallow) : [], otherCount: other ? other.children.length : 0 };
  }

  onTabUpdated(tab) {
    if (tab === this.activeTab && !this.win.isDestroyed()) {
      const title = tab.title || (tab.isNewTab ? 'Nova aba' : tab.displayUrl);
      this.win.setTitle(`${title} - PulseBrowser${this.incognito ? ' (Anônima)' : ''}`);
    }
    this.scheduleUpdate();
    if (!this.incognito) sessionstore.saveSoon();
  }

  scheduleUpdate() {
    if (this._updateTimer) return;
    this._updateTimer = setTimeout(() => {
      this._updateTimer = null;
      this._sendTabs();
    }, 16);
  }

  _sendTabs() {
    this.sendUI('ui:tabs', { tabs: this.tabs.map((t) => t.serialize()), activeId: this.activeTab ? this.activeTab.id : null });
  }

  ownsWebContents(wc) {
    if (!wc || this.win.isDestroyed()) return false;
    if (wc === this.win.webContents || wc === this.overlay.webContents) return true;
    return this.tabs.some((t) => t.webContents === wc);
  }

  tabById(id) {
    return this.tabs.find((t) => t.id === id) || null;
  }

  certExceptions() {
    return sessions.getCertExceptions(this.session);
  }

  // ---------------------------------------------------------------- Abas
  createTab(opts = {}) {
    const tab = new Tab(this, {
      url: opts.url || NEW_TAB,
      title: opts.title,
      favicon: opts.favicon,
      pinned: opts.pinned,
      muted: opts.muted,
      opener: opts.opener,
      webContents: opts.webContents,
      discarded: opts.discarded,
      entries: opts.entries,
      index: opts.index,
    });
    let index;
    if (Number.isInteger(opts.position)) index = opts.position;
    else if (opts.restoring) index = this.tabs.length;
    else if (opts.opener && this.tabs.includes(opts.opener)) {
      index = this.tabs.indexOf(opts.opener) + 1;
      while (index < this.tabs.length && this.tabs[index].openerId === opts.opener.id) index++;
    } else index = this.tabs.length;
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    if (!tab.pinned) index = Math.max(index, pinnedCount);
    else index = Math.min(index, pinnedCount);
    this.tabs.splice(Math.min(index, this.tabs.length), 0, tab);

    if (opts.active !== false) this.activateTab(tab);
    else if (tab.view) this._sizeBackgroundView(tab);
    this.scheduleUpdate();
    return tab;
  }

  adoptTab(tab) {
    tab.window = this;
    this.tabs.push(tab);
    this.activateTab(tab);
  }

  _sizeBackgroundView(tab) {
    if (this.win.isDestroyed() || !tab.view) return;
    const [w, h] = this.win.getContentSize();
    tab.view.setBounds({ x: 0, y: this.uiHeight, width: w, height: Math.max(0, h - this.uiHeight) });
  }

  detachTabView(tab) {
    if (tab.view) {
      try {
        this.win.contentView.removeChildView(tab.view);
      } catch { /* ignora */ }
    }
    if (tab.devtoolsView) {
      try {
        this.win.contentView.removeChildView(tab.devtoolsView);
      } catch { /* ignora */ }
    }
  }

  _attachTabView(tab) {
    tab.ensureView();
    this.win.contentView.addChildView(tab.view);
    if (tab.devtoolsView) this.win.contentView.addChildView(tab.devtoolsView);
    if (this.overlay.getVisible()) this.win.contentView.addChildView(this.overlay);
  }

  activateTab(tab) {
    if (!tab || this.win.isDestroyed()) return;
    const prev = this.activeTab;
    if (prev === tab) {
      if (!tab.view) {
        this._attachTabView(tab);
        this.layout();
      }
      return;
    }
    if (prev) {
      prev.lastActive = Date.now();
      this.detachTabView(prev);
      prev.webContents?.stopFindInPage('clearSelection');
    }
    this.activeTab = tab;
    tab.lastActive = Date.now();
    this._attachTabView(tab);
    this.layout();
    this.setStatus('');
    if (this.popup && !PROMPT_TYPES.has(this.popup.type)) this.hidePopup();
    this.sendUI('ui:find-close');
    this.onTabUpdated(tab);
    this._sendTabs();
    if (tab.isNewTab) this.focusOmnibox();
    else if (this.win.isFocused()) tab.webContents?.focus();
  }

  _rememberClosed(tab, index, windowClosing = false) {
    if (tab.isNewTab && !tab.canGoBack()) return;
    const entry = { ...tab.serializeForSession(), position: index, windowId: this.id, windowClosing };
    const stack = this.incognito ? this.closedTabs : ctx.closedTabs;
    stack.push(entry);
    if (stack.length > 25) stack.shift();
  }

  closeTab(tab) {
    const index = this.tabs.indexOf(tab);
    if (index < 0) return;
    if (this.tabs.length === 1) {
      // Fechar a última aba fecha a janela (a aba é lembrada em _onClosed).
      this._forceClose = true;
      this.win.close();
      return;
    }
    this._rememberClosed(tab, index);
    this.tabs.splice(index, 1);
    if (this.activeTab === tab) {
      this.detachTabView(tab);
      this.activeTab = null;
      const opener = tab.openerId != null ? this.tabById(tab.openerId) : null;
      const next = this.tabs[index] && this.tabs[index].openerId === tab.openerId && tab.openerId != null
        ? this.tabs[index]
        : opener || this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activateTab(next);
    }
    tab.destroy();
    if (this.htmlFullscreenTab === tab) this.setHtmlFullscreen(false, tab);
    this.scheduleUpdate();
    if (!this.incognito) sessionstore.saveSoon();
  }

  closeOtherTabs(keep) {
    for (const t of [...this.tabs]) if (t !== keep && !t.pinned) this.closeTab(t);
  }

  closeTabsToRight(tab) {
    const i = this.tabs.indexOf(tab);
    for (const t of this.tabs.slice(i + 1)) this.closeTab(t);
  }

  reopenClosedTab() {
    const stack = this.incognito ? this.closedTabs : ctx.closedTabs;
    const entry = stack.pop();
    if (!entry) return;
    this.createTab({
      url: entry.url,
      title: entry.title,
      favicon: entry.favicon,
      pinned: entry.pinned,
      entries: entry.entries,
      index: entry.index,
      position: entry.position,
      active: true,
    });
  }

  moveTab(tab, newIndex) {
    const from = this.tabs.indexOf(tab);
    if (from < 0) return;
    this.tabs.splice(from, 1);
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    let to = Math.max(0, Math.min(newIndex, this.tabs.length));
    to = tab.pinned ? Math.min(to, pinnedCount) : Math.max(to, pinnedCount);
    this.tabs.splice(to, 0, tab);
    this.scheduleUpdate();
    if (!this.incognito) sessionstore.saveSoon();
  }

  togglePin(tab) {
    tab.pinned = !tab.pinned;
    const pinnedCount = this.tabs.filter((t) => t.pinned && t !== tab).length;
    this.moveTab(tab, tab.pinned ? pinnedCount : pinnedCount);
  }

  toggleMute(tab) {
    tab.setMuted(!tab.muted);
  }

  duplicateTab(tab) {
    const s = tab.serializeForSession();
    this.createTab({ url: s.url, title: s.title, favicon: s.favicon, entries: s.entries, index: s.index, opener: tab, active: true });
  }

  moveTabToNewWindow(tab) {
    if (this.tabs.length < 2) return;
    const index = this.tabs.indexOf(tab);
    this.tabs.splice(index, 1);
    if (this.activeTab === tab) {
      this.detachTabView(tab);
      this.activeTab = null;
      this.activateTab(this.tabs[Math.min(index, this.tabs.length - 1)]);
    }
    this.scheduleUpdate();
    PulseWindow.open({ incognito: this.incognito, adoptTab: tab });
  }

  selectTabIndex(i) {
    const t = this.tabs[i];
    if (t) this.activateTab(t);
  }

  cycleTab(dir) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.indexOf(this.activeTab);
    this.activateTab(this.tabs[(i + dir + this.tabs.length) % this.tabs.length]);
  }

  openInNewWindow(url, { incognito } = {}) {
    return PulseWindow.open({ incognito: incognito ?? this.incognito, url });
  }

  // Abre uma página interna; reaproveita a aba se ela já estiver aberta.
  openInternal(url) {
    const host = new URL(url).hostname;
    if (SINGLETON_PAGES.has(host)) {
      const existing = this.tabs.find((t) => t.url.startsWith(`pulse://${host}`));
      if (existing) {
        this.activateTab(existing);
        if (existing.url !== url && url.includes('#')) existing.loadURL(url);
        return existing;
      }
    }
    if (this.activeTab && this.activeTab.isNewTab && !this.activeTab.canGoBack()) {
      this.activeTab.loadURL(url);
      return this.activeTab;
    }
    return this.createTab({ url, active: true });
  }

  navigate({ text, url, disposition = 'current' }) {
    const target = url || resolveInput(text);
    if (!target) return;
    if (/^javascript:/i.test(target)) return;
    if (disposition === 'new-tab') this.createTab({ url: target, active: true });
    else if (disposition === 'background') this.createTab({ url: target, active: false, opener: this.activeTab });
    else if (disposition === 'new-window') this.openInNewWindow(target);
    else {
      const tab = this.activeTab || this.createTab({ url: target });
      tab.loadURL(target);
      tab.webContents?.focus();
    }
  }

  handleWindowOpen(tab, details) {
    const { url, disposition, features } = details;
    if (isInternal(url) && !isInternal(tab.url)) return { action: 'deny' };
    if (/^javascript:/i.test(url)) return { action: 'deny' };
    if (disposition === 'save-to-disk') {
      tab.webContents?.downloadURL(url);
      return { action: 'deny' };
    }
    if (disposition === 'new-window' && features) {
      // Pop-ups (ex.: login com Google) abrem em uma janela simples, mantendo window.opener.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          icon: ICON,
          backgroundColor: '#ffffff',
          minWidth: 200,
          minHeight: 150,
        },
      };
    }
    const background = disposition === 'background-tab';
    return {
      action: 'allow',
      outlivesOpener: true,
      createWindow: (options) => {
        const created = this.createTab({ webContents: options.webContents, url, active: !background, opener: tab });
        return created.webContents;
      },
    };
  }

  setupPopupWindow(child) {
    child.setMenu(null);
    child.webContents.setWindowOpenHandler((d) => {
      if (d.disposition === 'new-window' && d.features) return { action: 'allow' };
      this.createTab({ url: d.url, active: true });
      return { action: 'deny' };
    });
    child.webContents.on('before-input-event', (event, input) => {
      const m = shortcuts.match(input);
      if (m && m.cmd === 'close-tab') {
        event.preventDefault();
        child.close();
      }
    });
  }

  // ---------------------------------------------------------------- Layout
  setUiMetrics(m) {
    if (!m || typeof m.height !== 'number') return;
    const changed = Math.round(m.height) !== this.uiHeight;
    this.uiHeight = Math.max(0, Math.round(m.height));
    if (m.omnibox) this.metrics.omnibox = m.omnibox;
    if (changed) this.layout();
  }

  layout() {
    if (this.win.isDestroyed()) return;
    const [w, h] = this.win.getContentSize();
    const tab = this.activeTab;
    if (tab && tab.view) {
      const top = this.htmlFullscreenTab ? 0 : this.uiHeight;
      const height = Math.max(0, h - top);
      if (tab.devtoolsView && !this.htmlFullscreenTab) {
        const dw = Math.max(280, Math.min(Math.round(w * 0.4), w - 240));
        tab.view.setBounds({ x: 0, y: top, width: Math.max(0, w - dw), height });
        tab.devtoolsView.setBounds({ x: w - dw, y: top, width: dw, height });
      } else {
        tab.view.setBounds({ x: 0, y: top, width: w, height });
      }
    }
    if (this.popup) this._layoutOverlay();
    else if (this.statusText || this.toastActive) this._layoutStatus();
  }

  onDevtoolsChanged(tab, removedView) {
    if (removedView) {
      try {
        this.win.contentView.removeChildView(removedView);
      } catch { /* ignora */ }
    } else if (tab === this.activeTab && tab.devtoolsView) {
      this.win.contentView.addChildView(tab.devtoolsView);
    }
    this.layout();
    this.scheduleUpdate();
  }

  setHtmlFullscreen(on, tab) {
    if (on) {
      if (tab !== this.activeTab) return;
      this.htmlFullscreenTab = tab;
      this._wasFullscreen = this.win.isFullScreen();
      if (!this._wasFullscreen) this.win.setFullScreen(true);
    } else {
      if (!this.htmlFullscreenTab) return;
      this.htmlFullscreenTab = null;
      if (!this._wasFullscreen && !this.win.isDestroyed()) this.win.setFullScreen(false);
    }
    this.sendUI('ui:window-state', this.windowState());
    this.layout();
  }

  // ---------------------------------------------------------------- Sobreposição (pop-ups, status)
  _raiseOverlay() {
    this.win.contentView.addChildView(this.overlay);
  }

  _layoutOverlay() {
    if (!this.popup || this.win.isDestroyed()) return;
    const [w, h] = this.win.getContentSize();
    const y = this.popup.fullWindow ? 0 : Math.max(0, Math.round(this.popup.anchor?.bottom ?? this.uiHeight));
    this.overlay.setBounds({ x: 0, y, width: w, height: Math.max(0, h - y) });
    return { w, h, y };
  }

  _layoutStatus() {
    if (this.win.isDestroyed()) return;
    const [w, h] = this.win.getContentSize();
    if (this.toastActive) {
      const tw = Math.min(w - 32, 420);
      this.overlay.setBounds({ x: Math.round((w - tw) / 2), y: h - 76, width: tw, height: 56 });
      return;
    }
    const text = this.statusText;
    const width = Math.max(90, Math.min(Math.round(w * 0.55), 28 + Math.ceil(text.length * 6.7)));
    this.overlay.setBounds({ x: 0, y: h - 26, width, height: 26 });
  }

  showPopup(payload) {
    if (this.win.isDestroyed()) return;
    const enriched = this._enrichPopup(payload);
    if (!enriched) return;
    if (this.popup && this.popup.onDismiss && this.popup !== enriched) {
      const dismiss = this.popup.onDismiss;
      this.popup.onDismiss = null;
      dismiss();
    }
    this.popup = enriched;
    this.statusText = '';
    const { w, h, y } = this._layoutOverlay();
    this._raiseOverlay();
    this.overlay.setVisible(true);
    const { onDismiss, callback, ...data } = enriched;
    this._sendOverlay('overlay:show', { ...data, width: w, height: h - y, offsetY: y });
    if (enriched.focus) this.overlay.webContents.focus();
    this.sendUI('ui:popup', { type: enriched.type });
  }

  updatePopup(payload) {
    if (!this.popup || payload.type !== this.popup.type) return;
    Object.assign(this.popup, payload);
    if (payload.anchor) this._layoutOverlay();
    this._sendOverlay('overlay:update', payload);
  }

  hidePopup() {
    if (!this.popup) return;
    const p = this.popup;
    this.popup = null;
    if (p.onDismiss) p.onDismiss();
    const hadFocus = !this.overlay.webContents.isDestroyed() && this.overlay.webContents.isFocused();
    // Animação de saída: a sobreposição some só depois que o pop-up termina de encolher.
    const animate = p.type !== 'suggestions' && ctx.settings.get('animations') && !this.toastActive;
    this._sendOverlay('overlay:hide', { animate });
    const token = (this._hideToken = (this._hideToken || 0) + 1);
    const finish = () => {
      if (token !== this._hideToken || this.popup || this.toastActive || this.win.isDestroyed()) return;
      this.overlay.setVisible(false);
    };
    if (animate) setTimeout(finish, POPUP_EXIT_MS);
    else finish();
    this.sendUI('ui:popup', { type: null });
    if (hadFocus && p.type !== 'suggestions') this.activeTab?.webContents?.focus();
    setTimeout(() => this._pumpPrompts(), animate ? POPUP_EXIT_MS + 20 : 0);
  }

  setStatus(text) {
    this.statusText = text || '';
    if (this.popup || this.toastActive || this.win.isDestroyed()) return;
    if (!this.statusText) {
      this.overlay.setVisible(false);
      this._sendOverlay('overlay:status', '');
      return;
    }
    this._layoutStatus();
    this._raiseOverlay();
    this.overlay.setVisible(true);
    this._sendOverlay('overlay:status', this.statusText);
  }

  toast(text) {
    if (this.win.isDestroyed()) return;
    if (this.popup) this.hidePopup();
    clearTimeout(this.toastTimer);
    this.toastActive = true;
    this._layoutStatus();
    this._raiseOverlay();
    this.overlay.setVisible(true);
    this._sendOverlay('overlay:toast', text);
    this.toastTimer = setTimeout(() => {
      this.toastActive = false;
      if (this.popup || this.win.isDestroyed()) return;
      this._sendOverlay('overlay:toast', '');
      this.overlay.setVisible(false);
      if (this.statusText) this.setStatus(this.statusText);
    }, 2600);
  }

  _enrichPopup(payload) {
    const p = { ...payload, incognito: this.incognito, accent: ctx.settings.accentColor() };
    const tab = this.activeTab;
    switch (p.type) {
      case 'menu':
        p.data = {
          zoom: tab ? tab.serialize().zoom : 100,
          bookmarksBar: ctx.settings.get('showBookmarksBar'),
          fullscreen: this.win.isFullScreen(),
          incognito: this.incognito,
          hasClosed: (this.incognito ? this.closedTabs : ctx.closedTabs).length > 0,
        };
        p.focus = true;
        break;
      case 'downloads':
        p.data = ctx.downloads.summary();
        p.focus = true;
        break;
      case 'shield': {
        const host = tab ? hostOf(tab.displayUrl) : '';
        p.data = {
          host,
          enabled: ctx.settings.get('shieldEnabled'),
          allowed: ctx.shield.isAllowlisted(host),
          blocked: tab ? tab.blocked : 0,
          hosts: tab ? [...tab.blockedHosts].slice(0, 30) : [],
          total: ctx.shield.total,
        };
        p.focus = true;
        break;
      }
      case 'pageinfo': {
        if (!tab) return null;
        const url = tab.displayUrl;
        const origin = permissions.originOf(url);
        p.data = {
          url,
          host: hostOf(url),
          origin,
          security: tab.security(),
          permissions: permissions.sitePermissions(origin),
          blocked: tab.blocked,
          zoom: tab.serialize().zoom,
          certException: this.certExceptions().has(hostOf(url)),
        };
        p.focus = true;
        break;
      }
      case 'bookmark': {
        if (!tab) return null;
        const url = tab.displayUrl;
        let found = ctx.bookmarks.findByUrl(url);
        let created = false;
        if (!found) {
          if (!/^(https?|file|ftp):/i.test(url)) return null;
          const node = ctx.bookmarks.add({ parentId: 'bar', url, title: tab.title || url, favicon: tab.favicon });
          found = ctx.bookmarks.find(node.id);
          created = true;
        }
        p.data = {
          id: found.node.id,
          title: found.node.title,
          url: found.node.url,
          parentId: found.parent ? found.parent.id : 'bar',
          folders: ctx.bookmarks.folders(),
          created,
        };
        p.focus = true;
        break;
      }
      case 'bookmark-edit': {
        const found = ctx.bookmarks.find(p.id);
        if (!found) return null;
        p.type = 'bookmark';
        p.data = {
          id: found.node.id,
          title: found.node.title,
          url: found.node.url,
          isFolder: found.node.type === 'folder',
          parentId: found.parent ? found.parent.id : 'bar',
          folders: ctx.bookmarks.folders(),
          created: false,
        };
        p.focus = true;
        break;
      }
      case 'suggestions':
        p.focus = false;
        break;
      case 'zoom':
        p.data = { zoom: tab ? tab.serialize().zoom : 100 };
        p.focus = true;
        break;
      case 'site-passwords': {
        if (!tab || !/^https?:/i.test(tab.displayUrl)) return null;
        p.data = {
          host: hostOf(tab.displayUrl),
          accounts: ctx.passwords.forOrigin(tab.displayUrl).map((a) => ({ id: a.id, username: a.username, lastUsed: a.lastUsed })),
        };
        p.focus = true;
        break;
      }
      case 'profile':
        if (this.incognito) return null;
        p.data = this.profileData();
        p.focus = true;
        ctx.accounts.refresh().catch(() => {});
        break;
      default:
        break;
    }
    if (!p.anchor) p.anchor = { ...this.metrics.omnibox };
    return p;
  }

  profileData() {
    return {
      ...ctx.accounts.publicData(),
      passwords: ctx.passwords.logins.length,
      passwordManager: ctx.settings.get('passwordManager'),
    };
  }

  // Abre páginas do Google (entrar, gerenciar conta, Gmail...) em uma aba.
  openGoogle(page, index = 0) {
    const { URLS } = require('./accounts');
    const u = URLS[page];
    if (!u) return;
    const url = typeof u === 'function' ? u(Math.max(0, Number(index) || 0)) : u;
    if (page === 'signout') {
      dialog.showMessageBox(this.win, {
        type: 'question',
        buttons: ['Sair', 'Cancelar'],
        defaultId: 0,
        cancelId: 1,
        title: 'PulseBrowser',
        message: 'Sair de todas as contas do Google?',
        detail: 'Você vai sair do Gmail, YouTube e dos outros serviços do Google neste navegador. As senhas salvas não são apagadas.',
      }).then(({ response }) => {
        if (response === 0) this._openUrlInTab(url);
      });
      return;
    }
    this._openUrlInTab(url);
  }

  _openUrlInTab(url) {
    const t = this.activeTab;
    if (t && t.isNewTab && !t.canGoBack()) t.loadURL(url);
    else this.createTab({ url, active: true, opener: t });
  }

  // ---------------------------------------------------------------- Prompts
  _queuePrompt(prompt) {
    this.promptQueue.push(prompt);
    this._pumpPrompts();
  }

  _pumpPrompts() {
    if (this.win.isDestroyed()) return;
    if (this.popup && PROMPT_TYPES.has(this.popup.type)) return;
    const next = this.promptQueue.shift();
    if (!next) return;
    this.showPopup(next);
  }

  promptPermission({ origin, key, label, externalURL, callback }) {
    let done = false;
    const finish = (allow, remember) => {
      if (done) return;
      done = true;
      callback(allow, remember);
    };
    this._queuePrompt({
      type: 'permission',
      anchor: { ...this.metrics.omnibox },
      data: { origin, key, label, externalURL },
      focus: true,
      callback: finish,
      onDismiss: () => finish(false, false),
    });
  }

  promptAuth({ host, realm, isProxy, callback }) {
    let done = false;
    const finish = (user, pass) => {
      if (done) return;
      done = true;
      if (user == null) callback();
      else callback(user, pass);
    };
    this._queuePrompt({
      type: 'auth',
      anchor: { ...this.metrics.omnibox },
      data: { host, realm, isProxy },
      focus: true,
      callback: finish,
      onDismiss: () => finish(null),
    });
  }

  promptScreenShare({ origin, audio, sources, callback }) {
    let done = false;
    const finish = (id, withAudio) => {
      if (done) return;
      done = true;
      callback(id, withAudio);
    };
    this._queuePrompt({
      type: 'screenshare',
      anchor: { ...this.metrics.omnibox },
      data: { origin, audio, sources },
      focus: true,
      callback: finish,
      onDismiss: () => finish(null),
    });
  }

  promptSavePassword({ origin, username, password, update }) {
    let done = false;
    const finish = (choice, user, pass) => {
      if (done) return;
      done = true;
      if (choice === 'save') {
        try {
          const res = ctx.passwords.save({ origin, username: user ?? username, password: pass || password });
          this.toast(res.updated ? 'Senha atualizada' : 'Senha salva');
        } catch (err) {
          console.warn('[passwords]', err.message);
        }
      } else if (choice === 'never') {
        ctx.passwords.addNever(origin);
      }
    };
    // Um pedido novo para o mesmo site substitui o que ainda está na fila.
    this.promptQueue = this.promptQueue.filter((q) => !(q.type === 'password' && q.data.origin === origin));
    this._queuePrompt({
      type: 'password',
      align: 'right',
      anchor: { ...this.metrics.omnibox },
      data: { origin, host: hostOf(origin), username, password, update },
      focus: true,
      callback: finish,
      onDismiss: () => finish('dismiss'),
    });
  }

  // Ações vindas da sobreposição.
  handleOverlayAction(action) {
    if (!action || typeof action !== 'object') return;
    const p = this.popup;
    switch (action.act) {
      case 'close':
        this.hidePopup();
        break;
      case 'navigate':
        this.hidePopup();
        this.navigate({ url: action.url, disposition: action.disposition });
        break;
      case 'suggestion':
        this.hidePopup();
        if (action.item?.type === 'tab') this.switchToTab(action.item.windowId, action.item.tabId);
        else this.navigate({ url: action.item?.url, disposition: action.disposition });
        this.sendUI('ui:omnibox-done');
        break;
      case 'command':
        if (!action.keepOpen) this.hidePopup();
        this.command(action.cmd, action.arg);
        if (action.keepOpen && this.popup?.type === 'menu') {
          setTimeout(() => this.updatePopup({ type: 'menu', data: this._enrichPopup({ type: 'menu' }).data }), 30);
        }
        break;
      case 'download':
        ctx.downloads.action(action.id, action.action, this.activeTab?.webContents);
        break;
      case 'shield-toggle': {
        const host = action.host;
        if (!host) break;
        const list = ctx.settings.get('shieldAllowlist').filter((h) => h !== host);
        if (!action.enabled) list.push(host);
        ctx.settings.set('shieldAllowlist', list);
        this.hidePopup();
        this.activeTab?.reload();
        break;
      }
      case 'shield-global':
        ctx.settings.set('shieldEnabled', !!action.enabled);
        this.hidePopup();
        this.activeTab?.reload();
        break;
      case 'site-permission':
        if (action.origin && action.key) permissions.setStored(action.origin, action.key, action.value);
        break;
      case 'clear-site-data': {
        const origin = action.origin;
        if (!origin) break;
        this.session.clearStorageData({ origin }).then(() => {
          this.toast('Dados do site apagados');
          this.activeTab?.reload();
        });
        this.hidePopup();
        break;
      }
      case 'perm-response':
        if (p?.type === 'permission') {
          const cb = p.callback;
          p.onDismiss = null;
          this.hidePopup();
          cb(!!action.allow, action.remember !== false);
        }
        break;
      case 'auth-response':
        if (p?.type === 'auth') {
          const cb = p.callback;
          p.onDismiss = null;
          this.hidePopup();
          cb(String(action.username ?? ''), String(action.password ?? ''));
        }
        break;
      case 'screenshare-response':
        if (p?.type === 'screenshare') {
          const cb = p.callback;
          p.onDismiss = null;
          this.hidePopup();
          cb(action.sourceId || null, !!action.audio);
        }
        break;
      case 'bookmark-save':
        if (action.id) {
          ctx.bookmarks.update(action.id, { title: action.title, url: action.url });
          if (action.parentId) {
            const found = ctx.bookmarks.find(action.id);
            if (found && found.parent?.id !== action.parentId) ctx.bookmarks.move(action.id, action.parentId);
          }
        }
        this.hidePopup();
        break;
      case 'bookmark-remove':
        if (action.id) ctx.bookmarks.remove(action.id);
        this.hidePopup();
        break;
      case 'zoom':
        this.zoom(action.dir);
        this.updatePopup({ type: this.popup?.type, data: { ...(this.popup?.data || {}), zoom: this.activeTab ? this.activeTab.serialize().zoom : 100 } });
        break;
      case 'password-response':
        if (p?.type === 'password') {
          const cb = p.callback;
          p.onDismiss = null;
          this.hidePopup();
          cb(action.choice, typeof action.username === 'string' ? action.username : undefined, typeof action.password === 'string' ? action.password : undefined);
        }
        break;
      case 'pw-copy': {
        const login = typeof action.id === 'string' ? ctx.passwords.get(action.id) : null;
        if (!login) break;
        clipboard.writeText(action.field === 'password' ? ctx.passwords.password(action.id) : login.username);
        break;
      }
      case 'pw-fill':
        this.hidePopup();
        if (typeof action.id === 'string') this.activeTab?.webContents?.send('pw:fill-now', action.id);
        break;
      case 'google':
        this.hidePopup();
        this.openGoogle(action.page, action.index);
        break;
      default:
        break;
    }
  }

  switchToTab(windowId, tabId) {
    const w = ctx.windows.find((x) => x.id === windowId);
    const t = w?.tabById(tabId);
    if (!t) return;
    w.activateTab(t);
    w.win.focus();
  }

  // ---------------------------------------------------------------- Teclado e comandos
  handleInput(event, input, tab, source = 'tab') {
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape' && !input.control && !input.alt && !input.meta) {
      if (this.popup && source !== 'ui') {
        event.preventDefault();
        this.hidePopup();
        return;
      }
      if (this.htmlFullscreenTab && source === 'tab') {
        this.htmlFullscreenTab.webContents?.executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true).catch(() => {});
        return;
      }
      if (source === 'tab' && tab?.loading) tab.stop();
      return;
    }
    const m = shortcuts.match(input);
    if (!m) return;
    event.preventDefault();
    this.command(m.cmd, m.arg);
  }

  focusOmnibox() {
    if (this.win.isDestroyed()) return;
    this.win.webContents.focus();
    this.sendUI('ui:focus-omnibox');
  }

  zoom(dir, tab = this.activeTab) {
    const wc = tab?.webContents;
    if (!wc) return;
    const cur = wc.getZoomFactor();
    let f;
    if (dir === 0) f = 1;
    else if (dir > 0) f = ZOOM_STEPS.find((s) => s > cur + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    else f = [...ZOOM_STEPS].reverse().find((s) => s < cur - 0.001) ?? ZOOM_STEPS[0];
    wc.setZoomFactor(f);
    const host = hostOf(tab.displayUrl);
    for (const w of ctx.windows) {
      if (w.session !== this.session) continue;
      for (const t of w.tabs) {
        if (t === tab || (host && hostOf(t.displayUrl) === host)) t.zoom = f;
      }
      w.scheduleUpdate();
    }
  }

  async command(cmd, arg) {
    const tab = this.activeTab;
    const wc = tab?.webContents;
    try {
      switch (cmd) {
        case 'new-tab': this.createTab({ url: NEW_TAB, active: true }); break;
        case 'new-window': PulseWindow.open({ incognito: false }); break;
        case 'new-incognito': PulseWindow.open({ incognito: true }); break;
        case 'close-tab': if (tab) this.closeTab(tab); break;
        case 'close-window': this.win.close(); break;
        case 'reopen-closed': this.reopenClosedTab(); break;
        case 'next-tab': this.cycleTab(1); break;
        case 'prev-tab': this.cycleTab(-1); break;
        case 'select-tab': this.selectTabIndex(arg); break;
        case 'select-last-tab': this.selectTabIndex(this.tabs.length - 1); break;
        case 'back': tab?.goBack(); break;
        case 'forward': tab?.goForward(); break;
        case 'go-offset': tab?.goToOffset(arg); break;
        case 'reload': tab?.reload(); break;
        case 'hard-reload': tab?.reload(true); break;
        case 'stop': tab?.stop(); break;
        case 'home': tab?.loadURL(resolveInput(ctx.settings.get('homepage')) || NEW_TAB); break;
        case 'focus-omnibox': this.focusOmnibox(); break;
        case 'find': this.win.webContents.focus(); this.sendUI('ui:find-open'); break;
        case 'find-next': this.sendUI('ui:find-step', 1); break;
        case 'find-prev': this.sendUI('ui:find-step', -1); break;
        case 'zoom-in': this.zoom(1); break;
        case 'zoom-out': this.zoom(-1); break;
        case 'zoom-reset': this.zoom(0); break;
        case 'devtools': case 'devtools-inspect': tab?.toggleDevTools(); break;
        case 'view-source':
          if (tab && /^(https?|file):/i.test(tab.displayUrl)) this.createTab({ url: `view-source:${tab.displayUrl}`, opener: tab });
          break;
        case 'print': wc?.print({ printBackground: true }, () => {}); break;
        case 'save-page': await this.savePage(); break;
        case 'save-pdf': await this.savePdf(); break;
        case 'screenshot': await this.screenshot(); break;
        case 'bookmark-page': this.sendUI('ui:request-popup', { type: 'bookmark' }); break;
        case 'toggle-bookmarks-bar': ctx.settings.set('showBookmarksBar', !ctx.settings.get('showBookmarksBar')); break;
        case 'history': this.openInternal('pulse://history/'); break;
        case 'downloads': this.openInternal('pulse://downloads/'); break;
        case 'bookmarks': this.openInternal('pulse://bookmarks/'); break;
        case 'settings': this.openInternal(`pulse://settings/${arg ? `#${arg}` : ''}`); break;
        case 'clear-data': this.openInternal('pulse://settings/#privacy'); break;
        case 'about': this.openInternal('pulse://about/'); break;
        case 'passwords': this.openInternal('pulse://passwords/'); break;
        case 'google': this.openGoogle(arg?.page || arg, arg?.index); break;
        case 'fullscreen':
          if (this.htmlFullscreenTab) this.htmlFullscreenTab.webContents?.executeJavaScript('document.exitFullscreen()', true).catch(() => {});
          else this.win.setFullScreen(!this.win.isFullScreen());
          break;
        case 'mute-tab': if (tab) this.toggleMute(tab); break;
        case 'pin-tab': if (tab) this.togglePin(tab); break;
        case 'duplicate-tab': if (tab) this.duplicateTab(tab); break;
        case 'cert-proceed':
          if (tab?.errorInfo?.url || arg) {
            const target = arg || tab.errorInfo.url;
            this.certExceptions().add(new URL(target).host);
            tab.loadURL(target);
          }
          break;
        case 'quit': ctx.quitting = true; app.quit(); break;
        default: break;
      }
    } catch (err) {
      console.error('[command]', cmd, err);
    }
  }

  async savePage() {
    const tab = this.activeTab;
    const wc = tab?.webContents;
    if (!wc) return;
    const { canceled, filePath } = await dialog.showSaveDialog(this.win, {
      title: 'Salvar página como',
      defaultPath: path.join(ctx.downloads.downloadDir(), `${sanitizeFilename(tab.title)}.html`),
      filters: [{ name: 'Página da Web completa', extensions: ['html', 'htm'] }],
    });
    if (canceled || !filePath) return;
    await wc.savePage(filePath, 'HTMLComplete');
    this.toast('Página salva');
  }

  async savePdf() {
    const tab = this.activeTab;
    const wc = tab?.webContents;
    if (!wc) return;
    const { canceled, filePath } = await dialog.showSaveDialog(this.win, {
      title: 'Salvar como PDF',
      defaultPath: path.join(ctx.downloads.downloadDir(), `${sanitizeFilename(tab.title)}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return;
    const data = await wc.printToPDF({ printBackground: true });
    await fs.promises.writeFile(filePath, data);
    this.toast('PDF salvo');
  }

  async screenshot() {
    const wc = this.activeTab?.webContents;
    if (!wc) return;
    const image = await wc.capturePage();
    clipboard.writeImage(image);
    const file = path.join(ctx.downloads.downloadDir(), `Captura de tela ${timestamp()}.png`);
    await fs.promises.writeFile(file, image.toPNG());
    this.toast('Captura salva em Downloads e copiada');
  }

  // ---------------------------------------------------------------- Menus nativos
  showTabMenu(tabId) {
    const tab = this.tabById(tabId);
    if (!tab) return;
    const idx = this.tabs.indexOf(tab);
    const stack = this.incognito ? this.closedTabs : ctx.closedTabs;
    Menu.buildFromTemplate([
      { label: 'Nova aba à direita', click: () => this.createTab({ position: idx + 1, active: true }) },
      { type: 'separator' },
      { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => tab.reload() },
      { label: 'Duplicar', click: () => this.duplicateTab(tab) },
      { label: tab.pinned ? 'Desafixar' : 'Fixar', click: () => this.togglePin(tab) },
      { label: tab.muted ? 'Ativar som do site' : 'Desativar som do site', click: () => this.toggleMute(tab) },
      { label: 'Mover aba para nova janela', enabled: this.tabs.length > 1, click: () => this.moveTabToNewWindow(tab) },
      {
        label: ctx.bookmarks.isBookmarked(tab.displayUrl) ? 'Remover dos favoritos' : 'Adicionar aos favoritos',
        enabled: /^(https?|file):/.test(tab.displayUrl),
        click: () => ctx.bookmarks.toggle(tab.displayUrl, tab.title, tab.favicon),
      },
      { type: 'separator' },
      { label: 'Fechar', accelerator: 'CmdOrCtrl+W', click: () => this.closeTab(tab) },
      { label: 'Fechar outras abas', enabled: this.tabs.length > 1, click: () => this.closeOtherTabs(tab) },
      { label: 'Fechar abas à direita', enabled: idx < this.tabs.length - 1, click: () => this.closeTabsToRight(tab) },
      { type: 'separator' },
      { label: 'Reabrir aba fechada', accelerator: 'CmdOrCtrl+Shift+T', enabled: stack.length > 0, click: () => this.reopenClosedTab() },
    ]).popup({ window: this.win });
  }

  _bookmarkMenuItems(nodes) {
    if (!nodes.length) return [{ label: '(vazio)', enabled: false }];
    return nodes.map((n) => (n.type === 'folder'
      ? { label: truncate(n.title, 60), submenu: this._bookmarkMenuItems(n.children) }
      : { label: truncate(n.title || n.url, 60), click: () => this.navigate({ url: n.url }) }));
  }

  showBookmarkFolderMenu(folderId, rect, ids) {
    let nodes;
    if (folderId === '__overflow') {
      const bar = ctx.bookmarks.find('bar')?.node;
      const set = new Set(ids || []);
      nodes = bar ? bar.children.filter((n) => set.has(n.id)) : [];
    } else {
      const folder = ctx.bookmarks.find(folderId)?.node;
      if (!folder || folder.type !== 'folder') return;
      nodes = folder.children;
    }
    const menu = Menu.buildFromTemplate(this._bookmarkMenuItems(nodes));
    const opts = { window: this.win };
    if (rect) {
      opts.x = Math.round(rect.left);
      opts.y = Math.round(rect.bottom);
    }
    menu.popup(opts);
  }

  showBookmarkContextMenu(id) {
    const found = id ? ctx.bookmarks.find(id) : null;
    const node = found?.node;
    const items = [];
    if (node && node.type === 'url') {
      items.push(
        { label: 'Abrir', click: () => this.navigate({ url: node.url }) },
        { label: 'Abrir em nova aba', click: () => this.createTab({ url: node.url, active: false }) },
        { label: 'Abrir em nova janela', click: () => this.openInNewWindow(node.url, { incognito: false }) },
        { label: 'Abrir em janela anônima', click: () => this.openInNewWindow(node.url, { incognito: true }) },
        { type: 'separator' },
        { label: 'Editar...', click: () => this.sendUI('ui:edit-bookmark', { id: node.id }) },
        { label: 'Copiar endereço', click: () => clipboard.writeText(node.url) },
        { label: 'Excluir', click: () => ctx.bookmarks.remove(node.id) },
        { type: 'separator' },
      );
    } else if (node && node.type === 'folder') {
      const urls = node.children.filter((n) => n.type === 'url');
      items.push(
        { label: `Abrir tudo (${urls.length})`, enabled: urls.length > 0, click: () => urls.forEach((n) => this.createTab({ url: n.url, active: false })) },
        { label: 'Renomear...', click: () => this.sendUI('ui:edit-bookmark', { id: node.id }) },
        { label: 'Excluir pasta', enabled: !['bar', 'other'].includes(node.id), click: () => ctx.bookmarks.remove(node.id) },
        { type: 'separator' },
      );
    }
    const tab = this.activeTab;
    items.push(
      {
        label: 'Adicionar página atual',
        enabled: !!tab && /^(https?|file):/.test(tab.displayUrl) && !ctx.bookmarks.isBookmarked(tab.displayUrl),
        click: () => ctx.bookmarks.add({ parentId: 'bar', url: tab.displayUrl, title: tab.title, favicon: tab.favicon }),
      },
      { label: 'Adicionar pasta', click: () => ctx.bookmarks.add({ parentId: 'bar', type: 'folder', title: 'Nova pasta' }) },
      { type: 'separator' },
      { label: 'Gerenciador de favoritos', accelerator: 'CmdOrCtrl+Shift+O', click: () => this.command('bookmarks') },
      {
        label: 'Mostrar barra de favoritos',
        type: 'checkbox',
        checked: ctx.settings.get('showBookmarksBar'),
        accelerator: 'CmdOrCtrl+Shift+B',
        click: () => this.command('toggle-bookmarks-bar'),
      },
    );
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  showBackForwardMenu(direction) {
    const wc = this.activeTab?.webContents;
    if (!wc) return;
    const nav = wc.navigationHistory;
    const active = nav.getActiveIndex();
    const items = [];
    if (direction < 0) {
      for (let i = active - 1; i >= Math.max(0, active - 15); i--) {
        const e = nav.getEntryAtIndex(i);
        items.push({ label: truncate(e.title || e.url, 60), click: () => nav.goToIndex(i) });
      }
    } else {
      for (let i = active + 1; i < Math.min(nav.length(), active + 16); i++) {
        const e = nav.getEntryAtIndex(i);
        items.push({ label: truncate(e.title || e.url, 60), click: () => nav.goToIndex(i) });
      }
    }
    if (!items.length) return;
    items.push({ type: 'separator' }, { label: 'Mostrar histórico completo', click: () => this.command('history') });
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  // ---------------------------------------------------------------- Localizar
  find(text, { forward = true, newSession = false } = {}) {
    const wc = this.activeTab?.webContents;
    if (!wc) return;
    if (!text) {
      wc.stopFindInPage('clearSelection');
      this.sendUI('ui:find-result', { active: 0, total: 0 });
      return;
    }
    wc.findInPage(text, { forward, findNext: newSession, matchCase: false });
  }

  stopFind() {
    this.activeTab?.webContents?.stopFindInPage('clearSelection');
    this.activeTab?.webContents?.focus();
  }

  onFindResult(tab, result) {
    if (tab !== this.activeTab) return;
    this.sendUI('ui:find-result', { active: result.activeMatchOrdinal || 0, total: result.matches || 0 });
  }

  focusOrRestore() {
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  openExternal(url) {
    shell.openExternal(url);
  }
}

module.exports = { PulseWindow };
