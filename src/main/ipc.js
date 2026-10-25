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
const { ACCENTS, engineList } = require('./settings');
const permissions = require('./permissions');

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

// Quais páginas internas podem usar cada canal (os ausentes valem para todas).
// Assim um script de extensão rodando na nova aba não alcança senhas, limpeza de dados etc.
const ACCESS = {
  'internal:set-setting': ['settings', 'newtab'],
  'internal:top-sites': ['newtab'],
  'internal:top-sites-remove': ['newtab'],
  'internal:top-sites-reset': ['newtab'],
  'internal:history-query': ['history'],
  'internal:history-remove': ['history'],
  'internal:history-clear': ['history', 'settings'],
  'internal:clear-data': ['settings'],
  'internal:choose-download-dir': ['settings'],
  'internal:accounts': ['settings'],
  'internal:accounts-refresh': ['settings'],
  'internal:google': ['settings'],
  'internal:site-permissions': ['settings'],
  'internal:site-permission-set': ['settings'],
  'internal:shield-stats': ['settings', 'newtab'],
  'internal:shield-refresh': ['settings'],
  'internal:spellcheck-languages': ['settings'],
  'internal:set-default-browser': ['settings'],
  'internal:relaunch': ['settings'],
  'internal:extensions-list': ['settings', 'extensions'],
  'internal:extension-load': ['settings', 'extensions'],
  'internal:extension-remove': ['settings', 'extensions'],
  'internal:cert-proceed': ['error'],
};
const PREFIX_ACCESS = [
  ['internal:passwords-', ['passwords', 'settings']],
  ['internal:bookmarks-', ['bookmarks']],
  ['internal:download', ['downloads']],
  ['internal:open-downloads-folder', ['downloads']],
  ['internal:ext-', ['extensions']],
];
// Configurações que a nova aba pode mudar (as outras só pela página de configurações).
const NEWTAB_SETTINGS = new Set(['newTabShortcuts', 'newTabBackground', 'hiddenTopSites', 'searchEngine']);

function allowedPages(channel) {
  if (ACCESS[channel]) return ACCESS[channel];
  const hit = PREFIX_ACCESS.find(([prefix]) => channel.startsWith(prefix));
  return hit ? hit[1] : null;
}

function internalPage(url) {
  try {
    const u = new URL(url);
    return /^(tuff|pulse):$/.test(u.protocol) ? u.hostname : null;
  } catch {
    return null;
  }
}

function internal(channel, fn) {
  const pages = allowedPages(channel);
  ipcMain.handle(channel, async (event, ...args) => {
    const frame = event.senderFrame;
    const page = frame && !frame.parent ? internalPage(frame.url || '') : null;
    if (!page || (pages && !pages.includes(page))) throw new Error('Acesso negado');
    const { window, tab } = windowFromTab(event.sender);
    const incognito = event.sender.session !== session.defaultSession;
    return fn({ event, window, tab, incognito, sender: event.sender, page }, ...args);
  });
}

function broadcastInternal(channel, data) {
  for (const w of ctx.windows) {
    for (const t of w.tabs) {
      const wc = t.webContents;
      if (wc && internalPage(t.url)) wc.send(channel, data);
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
  const base = 'HKCU\\Software\\Clients\\StartMenuInternet\\tuff.browse';
  const entries = [
    [base, '', 'tuff.browse'],
    [`${base}\\Capabilities`, 'ApplicationName', 'tuff.browse'],
    [`${base}\\Capabilities`, 'ApplicationDescription', 'Navegador rápido e privado baseado em Chromium'],
    [`${base}\\Capabilities`, 'ApplicationIcon', icon],
    [`${base}\\Capabilities\\URLAssociations`, 'http', 'TuffBrowseURL'],
    [`${base}\\Capabilities\\URLAssociations`, 'https', 'TuffBrowseURL'],
    [`${base}\\Capabilities\\FileAssociations`, '.html', 'TuffBrowseHTML'],
    [`${base}\\Capabilities\\FileAssociations`, '.htm', 'TuffBrowseHTML'],
    [`${base}\\Capabilities\\FileAssociations`, '.pdf', 'TuffBrowseHTML'],
    [`${base}\\Capabilities\\StartMenu`, 'StartMenuInternet', 'tuff.browse'],
    [`${base}\\DefaultIcon`, '', icon],
    [`${base}\\shell\\open\\command`, '', launch],
    ['HKCU\\Software\\RegisteredApplications', 'tuff.browse', 'Software\\Clients\\StartMenuInternet\\tuff.browse\\Capabilities'],
    ['HKCU\\Software\\Classes\\TuffBrowseURL', '', 'tuff.browse URL'],
    ['HKCU\\Software\\Classes\\TuffBrowseURL', 'URL Protocol', ''],
    ['HKCU\\Software\\Classes\\TuffBrowseURL\\DefaultIcon', '', icon],
    ['HKCU\\Software\\Classes\\TuffBrowseURL\\shell\\open\\command', '', cmd],
    ['HKCU\\Software\\Classes\\TuffBrowseHTML', '', 'Documento do tuff.browse'],
    ['HKCU\\Software\\Classes\\TuffBrowseHTML\\DefaultIcon', '', icon],
    ['HKCU\\Software\\Classes\\TuffBrowseHTML\\shell\\open\\command', '', cmd],
  ];
  for (const [key, name, value] of entries) {
    const args = ['add', key, ...(name ? ['/v', name] : ['/ve']), '/t', 'REG_SZ', '/d', value, '/f'];
    await execFileAsync('reg', args, { windowsHide: true });
  }
  await shell.openExternal('ms-settings:defaultapps?registeredAppUser=tuff.browse');
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
  onUi('ui:ext-action', (w, { id, anchor } = {}) => {
    if (typeof id === 'string') ctx.extensions.runAction(w, id, anchor);
  });
  onUi('ui:ext-menu', (w, { id } = {}) => {
    if (typeof id === 'string') w.showExtensionMenu(id);
  });

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
    engines: engineList(),
    accents: ACCENTS,
    downloadDirResolved: ctx.downloads.downloadDir(),
    grammarLanguages: require('./grammar').LANGUAGES,
  }));

  internal('internal:set-setting', ({ page }, key, value) => {
    if (page !== 'settings' && !NEWTAB_SETTINGS.has(key)) throw new Error('Acesso negado');
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
      defaultPath: path.join(app.getPath('documents'), 'favoritos-tuff.html'),
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
    if (opts.savedPasswords) ctx.passwords.clear();
    return true;
  });

  // ---- Senhas salvas (tuff://passwords)
  internal('internal:passwords-list', () => ({
    logins: ctx.passwords.list(),
    never: ctx.passwords.neverList(),
    encrypted: ctx.passwords.encryptionAvailable(),
  }));
  internal('internal:passwords-reveal', (_c, id) => ctx.passwords.password(String(id)));
  internal('internal:passwords-copy', (_c, id, field) => {
    const login = ctx.passwords.get(String(id));
    if (!login) return false;
    clipboard.writeText(field === 'password' ? ctx.passwords.password(login.id) : login.username);
    return true;
  });
  internal('internal:passwords-save', (_c, data = {}) => {
    let origin = String(data.origin || '').trim();
    if (origin && !/^[a-z]+:\/\//i.test(origin)) origin = `https://${origin}`;
    return ctx.passwords.save({ origin, username: String(data.username || ''), password: String(data.password || ''), note: data.note });
  });
  internal('internal:passwords-update', (_c, id, changes = {}) => ctx.passwords.update(String(id), {
    origin: typeof changes.origin === 'string' && changes.origin.trim()
      ? (/^[a-z]+:\/\//i.test(changes.origin.trim()) ? changes.origin.trim() : `https://${changes.origin.trim()}`)
      : undefined,
    username: typeof changes.username === 'string' ? changes.username : undefined,
    password: typeof changes.password === 'string' ? changes.password : undefined,
    note: typeof changes.note === 'string' ? changes.note : undefined,
  }));
  internal('internal:passwords-remove', (_c, id) => ctx.passwords.remove(String(id)));
  internal('internal:passwords-never-remove', (_c, key) => {
    ctx.passwords.removeNever(String(key));
    return true;
  });
  internal('internal:passwords-health', () => ctx.passwords.health());
  internal('internal:passwords-leaks', async () => {
    try {
      return { ok: true, leaked: await ctx.passwords.checkLeaks() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  internal('internal:passwords-import', async ({ window }) => {
    const res = await dialog.showOpenDialog(window?.win, {
      title: 'Importar senhas (CSV)',
      filters: [{ name: 'Arquivo CSV', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    try {
      const text = await fs.promises.readFile(res.filePaths[0], 'utf8');
      return { ok: true, ...ctx.passwords.importCsv(text) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  internal('internal:passwords-export', async ({ window }) => {
    const parent = window?.win;
    const { response } = await dialog.showMessageBox(parent, {
      type: 'warning',
      buttons: ['Exportar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Exportar senhas',
      message: 'Exportar senhas sem criptografia?',
      detail: 'O arquivo CSV terá todas as suas senhas em texto simples. Qualquer pessoa com acesso a ele poderá vê-las.',
    });
    if (response !== 0) return false;
    const res = await dialog.showSaveDialog(parent, {
      title: 'Exportar senhas',
      defaultPath: path.join(app.getPath('documents'), 'senhas-tuff.csv'),
      filters: [{ name: 'Arquivo CSV', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return false;
    await fs.promises.writeFile(res.filePath, `﻿${ctx.passwords.exportCsv()}`, 'utf8');
    return true;
  });

  // ---- Contas do Google
  internal('internal:accounts', () => ctx.accounts.publicData());
  internal('internal:accounts-refresh', () => ctx.accounts.refresh());
  internal('internal:google', ({ window }, page, index) => {
    if (window && typeof page === 'string') window.openGoogle(page, index);
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

  // ---- Extensões do tuff.browse (página tuff://extensions)
  const exts = () => ctx.extensions;
  const extId = (id) => {
    if (typeof id !== 'string' || !exts().byId.has(id)) throw new Error('Extensão não encontrada');
    return id;
  };
  internal('internal:ext-list', () => ({ items: exts().manageList(), folder: exts().userDir }));
  internal('internal:ext-set-enabled', (_c, id, on) => exts().setEnabled(extId(id), !!on));
  internal('internal:ext-set-pinned', (_c, id, on) => exts().setPinned(extId(id), !!on));
  internal('internal:ext-set-incognito', (_c, id, on) => exts().setIncognito(extId(id), !!on));
  internal('internal:ext-create', (_c, opts) => exts().create(opts && typeof opts === 'object' ? opts : {}));
  internal('internal:ext-files', (_c, id) => exts().files(extId(id)));
  internal('internal:ext-write', (_c, id, name, content) => exts().writeFile(extId(id), String(name || ''), content));
  internal('internal:ext-delete-file', (_c, id, name) => exts().deleteFile(extId(id), String(name || '')));
  internal('internal:ext-remove', (_c, id) => exts().remove(extId(id)));
  internal('internal:ext-duplicate', (_c, id) => exts().duplicate(extId(id)));
  internal('internal:ext-import', ({ window }) => exts().importFolder(window?.win));
  internal('internal:ext-open-folder', (_c, id) => exts().openFolder(id ? extId(id) : null));
  internal('internal:ext-reload', (_c, id) => {
    if (id) return { errors: exts().reload(extId(id)).errors };
    exts().loadAll();
    exts()._changed();
    return { errors: [] };
  });
  internal('internal:ext-reload-tabs', (_c, id) => exts().reloadTabsFor(extId(id)));
  internal('internal:ext-run', ({ window }, id) => exts().runAction(window, extId(id), null));
  internal('internal:ext-options', ({ window }, id) => exts().openOptions(window, exts().byId.get(extId(id))));

  // ---- tuff Store
  const tuffStore = () => {
    if (!ctx.tuffStore) ctx.tuffStore = new (require('./tuffstore').TuffStore)(exts());
    return ctx.tuffStore;
  };
  internal('internal:ext-store-list', (_c, opts) => tuffStore().list({ refresh: !!(opts && opts.refresh) }));
  internal('internal:ext-store-install', (_c, id) => {
    if (typeof id !== 'string') throw new Error('Extensão não encontrada');
    return tuffStore().install(id);
  });

  internal('internal:shield-stats', () => ctx.shield.status());
  internal('internal:shield-refresh', async () => ctx.shield.updateLists(true));

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
    const allowed = new Set(['new-tab', 'new-window', 'new-incognito', 'settings', 'history', 'downloads', 'bookmarks', 'about', 'focus-omnibox', 'passwords', 'extensions']);
    if (window && allowed.has(cmd)) window.command(cmd, arg);
  });
}

module.exports = { register, broadcastInternal, internal, windowFromUi, windowFromTab };
