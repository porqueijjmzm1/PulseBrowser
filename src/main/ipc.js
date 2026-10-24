'use strict';
// Canais IPC: interface do navegador (ui:*), sobreposição (overlay:*) e páginas internas (internal:*).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { app, ipcMain, session, dialog, shell, clipboard, Menu } = require('electron');
const ctx = require('./context');
const { localSuggestions, remoteSuggestions, resolveInput, looksLikeUrl } = require('./omnibox');
const { ENGINES, ACCENTS } = require('./settings');
const permissions = require('./permissions');
const BUILTIN = require('./blocklist');

const execFileAsync = promisify(execFile);

function windowFromUi(sender) {
  return ctx.windows.find((w) => !w.win.isDestroyed() && (w.win.webContents === sender || w.overlay.webContents === sender)) || null;
}

function windowFromTab(sender) {
  for (const w of ctx.windows) {
    const tab = w.tabs.find((t) => t.webContents === sender);
    if (tab) return { window: w, tab };
  }
  return { window: null, tab: null };
}

function onUi(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    const w = windowFromUi(event.sender);
    if (!w) return;
    try {
      fn(w, ...args);
    } catch (err) {
      console.error(`[ipc] ${channel}`, err);
    }
  });
}

function internal(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    const url = event.senderFrame?.url || '';
    if (!url.startsWith('pulse://')) throw new Error('Acesso negado');
    const { window, tab } = windowFromTab(event.sender);
    const incognito = event.sender.session !== session.defaultSession;
    return fn({ event, window, tab, incognito, sender: event.sender }, ...args);
  });
}

function broadcastInternal(channel, data) {
  for (const w of ctx.windows) {
    for (const t of w.tabs) {
      const wc = t.webContents;
      if (wc && t.url.startsWith('pulse://')) wc.send(channel, data);
    }
  }
}

function extensionsApi() {
  return session.defaultSession.extensions || session.defaultSession;
}

async function registerAsDefaultBrowser() {
  if (process.platform !== 'win32') {
    app.setAsDefaultProtocolClient('http');
    app.setAsDefaultProtocolClient('https');
    return { ok: true };
  }
  const exe = process.execPath;
  const launch = process.defaultApp ? `"${exe}" "${app.getAppPath()}"` : `"${exe}"`;
  const cmd = `${launch} "%1"`;
  const icon = `"${exe}",0`;
  const base = 'HKCU\\Software\\Clients\\StartMenuInternet\\PulseBrowser';
  const entries = [
    [base, '', 'PulseBrowser'],
    [`${base}\\Capabilities`, 'ApplicationName', 'PulseBrowser'],
    [`${base}\\Capabilities`, 'ApplicationDescription', 'Navegador rápido e privado baseado em Chromium'],
    [`${base}\\Capabilities`, 'ApplicationIcon', icon],
    [`${base}\\Capabilities\\URLAssociations`, 'http', 'PulseBrowserURL'],
    [`${base}\\Capabilities\\URLAssociations`, 'https', 'PulseBrowserURL'],
    [`${base}\\Capabilities\\FileAssociations`, '.html', 'PulseBrowserHTML'],
    [`${base}\\Capabilities\\FileAssociations`, '.htm', 'PulseBrowserHTML'],
    [`${base}\\Capabilities\\FileAssociations`, '.pdf', 'PulseBrowserHTML'],
    [`${base}\\Capabilities\\StartMenu`, 'StartMenuInternet', 'PulseBrowser'],
    [`${base}\\DefaultIcon`, '', icon],
    [`${base}\\shell\\open\\command`, '', launch],
    ['HKCU\\Software\\RegisteredApplications', 'PulseBrowser', 'Software\\Clients\\StartMenuInternet\\PulseBrowser\\Capabilities'],
    ['HKCU\\Software\\Classes\\PulseBrowserURL', '', 'PulseBrowser URL'],
    ['HKCU\\Software\\Classes\\PulseBrowserURL', 'URL Protocol', ''],
    ['HKCU\\Software\\Classes\\PulseBrowserURL\\DefaultIcon', '', icon],
    ['HKCU\\Software\\Classes\\PulseBrowserURL\\shell\\open\\command', '', cmd],
    ['HKCU\\Software\\Classes\\PulseBrowserHTML', '', 'Documento do PulseBrowser'],
    ['HKCU\\Software\\Classes\\PulseBrowserHTML\\DefaultIcon', '', icon],
    ['HKCU\\Software\\Classes\\PulseBrowserHTML\\shell\\open\\command', '', cmd],
  ];
  for (const [key, name, value] of entries) {
    const args = ['add', key, ...(name ? ['/v', name] : ['/ve']), '/t', 'REG_SZ', '/d', value, '/f'];
    await execFileAsync('reg', args, { windowsHide: true });
  }
  await shell.openExternal('ms-settings:defaultapps?registeredAppUser=PulseBrowser');
  return { ok: true };
}

function register() {
  // ------------------------------------------------------------ Interface (ui:*)
  onUi('ui:metrics', (w, m) => w.setUiMetrics(m));
  onUi('ui:new-tab', (w) => w.command('new-tab'));
  onUi('ui:activate-tab', (w, id) => w.activateTab(w.tabById(id)));
  onUi('ui:close-tab', (w, id) => {
    const t = w.tabById(id);
    if (t) w.closeTab(t);
  });
  onUi('ui:move-tab', (w, { id, index }) => {
    const t = w.tabById(id);
    if (t && Number.isInteger(index)) w.moveTab(t, index);
  });
  onUi('ui:tab-menu', (w, id) => w.showTabMenu(id));
  onUi('ui:toggle-mute', (w, id) => {
    const t = w.tabById(id);
    if (t) w.toggleMute(t);
  });
  onUi('ui:navigate', (w, payload) => w.navigate(payload || {}));
  onUi('ui:command', (w, { cmd, arg } = {}) => w.command(cmd, arg));
  onUi('ui:popup-show', (w, payload) => {
    if (payload && typeof payload.type === 'string') w.showPopup(payload);
  });
  onUi('ui:popup-update', (w, payload) => {
    if (payload && typeof payload.type === 'string') w.updatePopup(payload);
  });
  onUi('ui:popup-hide', (w) => w.hidePopup());
  onUi('ui:find', (w, { text, forward, newSession } = {}) => w.find(String(text || ''), { forward: forward !== false, newSession: !!newSession }));
  onUi('ui:find-close', (w) => w.stopFind());
  onUi('ui:bookmark-open', (w, { id, disposition, rect } = {}) => {
    const node = ctx.bookmarks.find(id)?.node;
    if (!node) return;
    if (node.type === 'folder') w.showBookmarkFolderMenu(id, rect);
    else w.navigate({ url: node.url, disposition: disposition || 'current' });
  });
  onUi('ui:bookmark-menu', (w, { id } = {}) => w.showBookmarkContextMenu(id));
  onUi('ui:bookmark-overflow', (w, { ids, rect } = {}) => w.showBookmarkFolderMenu('__overflow', rect, ids));
  onUi('ui:backforward-menu', (w, dir) => w.showBackForwardMenu(dir));
  onUi('ui:switch-tab', (w, { windowId, tabId } = {}) => w.switchToTab(windowId, tabId));
  onUi('ui:focus-page', (w) => w.activeTab?.webContents?.focus());
  onUi('ui:input-menu', (w, { omnibox, hasSelection } = {}) => {
    const wc = w.win.webContents;
    const clip = clipboard.readText().trim();
    const items = [
      { label: 'Recortar', enabled: !!hasSelection, click: () => wc.cut() },
      { label: 'Copiar', enabled: !!hasSelection, click: () => wc.copy() },
      { label: 'Colar', enabled: !!clip, click: () => wc.paste() },
    ];
    if (omnibox && clip) {
      items.push({
        label: looksLikeUrl(clip) ? 'Colar e acessar' : 'Colar e pesquisar',
        click: () => {
          w.sendUI('ui:omnibox-done');
          w.navigate({ text: clip.slice(0, 4000) });
        },
      });
    }
    items.push({ type: 'separator' }, { label: 'Selecionar tudo', click: () => wc.selectAll() });
    Menu.buildFromTemplate(items).popup({ window: w.win });
  });
  onUi('overlay:action', (w, action) => w.handleOverlayAction(action));

  ipcMain.handle('ui:suggest', async (event, text) => {
    const w = windowFromUi(event.sender);
    if (!w) return { items: [], inline: null };
    const q = String(text || '').slice(0, 500);
    const local = localSuggestions(q, { incognito: w.incognito });
    remoteSuggestions(q).then((items) => {
      if (items.length) w.sendUI('ui:suggest-remote', { text: q, items });
    });
    return local;
  });

  // ------------------------------------------------------------ Páginas internas (internal:*)
  internal('internal:context', ({ incognito }) => ({
    incognito,
    platform: process.platform,
    versions: {
      app: app.getVersion(),
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      v8: process.versions.v8,
      node: process.versions.node,
    },
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    userData: app.getPath('userData'),
    exe: process.execPath,
  }));

  internal('internal:get-settings', () => ({
    ...ctx.settings.publicData(),
    engines: Object.entries(ENGINES).map(([id, e]) => ({ id, name: e.name })),
    accents: ACCENTS,
    downloadDirResolved: ctx.downloads.downloadDir(),
  }));

  internal('internal:set-setting', (_c, key, value) => {
    ctx.settings.set(key, value);
    return true;
  });

  internal('internal:resolve', (_c, text) => resolveInput(text));

  internal('internal:top-sites', () => ctx.history.topSites(8));
  internal('internal:top-sites-remove', (_c, url) => {
    let origin = url;
    try {
      origin = new URL(url).origin;
    } catch { /* ignora */ }
    const list = new Set(ctx.settings.get('hiddenTopSites'));
    list.add(origin);
    ctx.settings.set('hiddenTopSites', [...list]);
    return ctx.history.topSites(8);
  });
  internal('internal:top-sites-reset', () => {
    ctx.settings.set('hiddenTopSites', []);
    return ctx.history.topSites(8);
  });

  internal('internal:history-query', (_c, opts) => ctx.history.query(opts || {}));
  internal('internal:history-remove', (_c, ids) => {
    if (Array.isArray(ids)) ctx.history.remove(ids);
    return true;
  });
  internal('internal:history-clear', () => {
    ctx.history.clear();
    return true;
  });

  internal('internal:bookmarks-tree', () => ({ roots: ctx.bookmarks.roots, folders: ctx.bookmarks.folders() }));
  internal('internal:bookmarks-add', (_c, data) => ctx.bookmarks.add(data || {}));
  internal('internal:bookmarks-update', (_c, id, changes) => ctx.bookmarks.update(id, changes || {}));
  internal('internal:bookmarks-move', (_c, id, parentId, index) => {
    ctx.bookmarks.move(id, parentId, index);
    return true;
  });
  internal('internal:bookmarks-remove', (_c, id) => {
    ctx.bookmarks.remove(id);
    return true;
  });
  internal('internal:bookmarks-import-nodes', (_c, nodes, title) => ctx.bookmarks.importNodes(nodes, 'other', title || 'Importados'));
  internal('internal:bookmarks-import-chrome', () => ctx.bookmarks.importFromChrome());
  internal('internal:bookmarks-pick-file', async ({ window }) => {
    const parent = window?.win;
    const res = await dialog.showOpenDialog(parent, {
      title: 'Importar favoritos (HTML)',
      filters: [{ name: 'Arquivo de favoritos', extensions: ['html', 'htm'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return fs.promises.readFile(res.filePaths[0], 'utf8');
  });
  internal('internal:bookmarks-export', async ({ window }) => {
    const res = await dialog.showSaveDialog(window?.win, {
      title: 'Exportar favoritos',
      defaultPath: path.join(app.getPath('documents'), 'favoritos-pulsebrowser.html'),
      filters: [{ name: 'Arquivo de favoritos', extensions: ['html'] }],
    });
    if (res.canceled || !res.filePath) return false;
    await fs.promises.writeFile(res.filePath, ctx.bookmarks.exportHtml(), 'utf8');
    return true;
  });

  internal('internal:downloads-list', ({ incognito }) => ctx.downloads.list({ incognito }));
  internal('internal:download-action', ({ tab }, id, act) => {
    ctx.downloads.action(id, act, tab?.webContents);
    return true;
  });
  internal('internal:downloads-clear', () => {
    ctx.downloads.clearFinished();
    return true;
  });
  internal('internal:open-downloads-folder', () => shell.openPath(ctx.downloads.downloadDir()));
  internal('internal:choose-download-dir', async ({ window }) => {
    const res = await dialog.showOpenDialog(window?.win, {
      title: 'Pasta de downloads',
      defaultPath: ctx.downloads.downloadDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    ctx.settings.set('downloadDir', res.filePaths[0]);
    return res.filePaths[0];
  });

  internal('internal:clear-data', async ({ incognito }, opts = {}) => {
    const ranges = { hour: 3600e3, day: 864e5, week: 7 * 864e5, month: 28 * 864e5 };
    const since = ranges[opts.range] ? Date.now() - ranges[opts.range] : 0;
    const ses = incognito && ctx.incognitoSession ? ctx.incognitoSession : session.defaultSession;
    if (opts.history) ctx.history.clear(since);
    if (opts.downloads) ctx.downloads.clearFinished();
    if (opts.cookies) {
      await ses.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache'],
      });
    }
    if (opts.cache) {
      await ses.clearCache();
      await ses.clearCodeCaches({});
    }
    if (opts.permissions) ctx.settings.set('sitePermissions', {});
    if (opts.passwords) await ses.clearAuthCache();
    return true;
  });

  internal('internal:site-permissions', () => {
    const all = ctx.settings.get('sitePermissions');
    return Object.keys(all).sort().map((origin) => ({ origin, permissions: permissions.sitePermissions(origin) }));
  });
  internal('internal:site-permission-set', (_c, origin, key, value) => {
    permissions.setStored(origin, key, value);
    return true;
  });

  internal('internal:extensions-list', () => extensionsApi().getAllExtensions().map((e) => ({
    id: e.id, name: e.name, version: e.version, path: e.path, description: e.manifest?.description || '',
  })));
  internal('internal:extension-load', async ({ window }) => {
    const res = await dialog.showOpenDialog(window?.win, {
      title: 'Selecione a pasta da extensão (descompactada)',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const dir = res.filePaths[0];
    const ext = await extensionsApi().loadExtension(dir, { allowFileAccess: true });
    const list = new Set(ctx.settings.get('extensions'));
    list.add(dir);
    ctx.settings.set('extensions', [...list]);
    return { id: ext.id, name: ext.name, version: ext.version };
  });
  internal('internal:extension-remove', (_c, id) => {
    const api = extensionsApi();
    const ext = api.getExtension(id);
    if (ext) {
      api.removeExtension(id);
      ctx.settings.set('extensions', ctx.settings.get('extensions').filter((p) => path.resolve(p) !== path.resolve(ext.path)));
    }
    return true;
  });

  internal('internal:shield-stats', () => ({
    total: ctx.shield.total,
    builtin: new Set(BUILTIN).size,
    extended: ctx.shield.extended.size,
  }));
  internal('internal:shield-refresh', async () => ctx.shield.loadExtended(true));

  internal('internal:spellcheck-languages', () => session.defaultSession.availableSpellCheckerLanguages);

  internal('internal:set-default-browser', async () => {
    try {
      return await registerAsDefaultBrowser();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  internal('internal:relaunch', () => {
    ctx.quitting = true;
    app.relaunch();
    app.quit();
  });

  internal('internal:cert-proceed', ({ window }, url) => {
    if (window && typeof url === 'string' && /^https:/i.test(url)) window.command('cert-proceed', url);
  });

  internal('internal:open-url', ({ window, tab }, url, disposition = 'new-tab') => {
    if (!window || typeof url !== 'string') return;
    if (disposition === 'current' && tab) tab.loadURL(url);
    else window.createTab({ url, active: disposition !== 'background', opener: tab });
  });

  internal('internal:command', ({ window }, cmd, arg) => {
    const allowed = new Set(['new-tab', 'new-window', 'new-incognito', 'settings', 'history', 'downloads', 'bookmarks', 'about', 'focus-omnibox']);
    if (window && allowed.has(cmd)) window.command(cmd, arg);
  });
}

module.exports = { register, broadcastInternal };
