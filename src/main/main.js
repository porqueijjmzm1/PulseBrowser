'use strict';
// tuff.browse - processo principal.
const fs = require('fs');
const path = require('path');
const { app, session, nativeTheme, Menu } = require('electron');
const ctx = require('./context');
const protocol = require('./protocol');

const isMac = process.platform === 'darwin';
const pendingUrls = [];

protocol.registerSchemes();
app.setName('tuff.browse');
// Pasta de dados separada para testes de desenvolvimento.
const devUserData = !app.isPackaged && (process.env.TUFF_USERDATA || process.env.PULSE_USERDATA);
if (devUserData) app.setPath('userData', path.resolve(devUserData));
else migrateUserData();
// O identificador antigo continua o mesmo: atalhos fixados na barra de tarefas seguem funcionando.
if (process.platform === 'win32') app.setAppUserModelId('com.pulsebrowser.app');

// O navegador se chamava PulseBrowser: na primeira vez com o nome novo, a pasta de dados
// (favoritos, senhas, histórico, configurações) é renomeada para tuff.browse.
function migrateUserData() {
  try {
    const appData = app.getPath('appData');
    const target = path.join(appData, 'tuff.browse');
    const old = path.join(appData, 'PulseBrowser');
    if (fs.existsSync(target) || !fs.existsSync(old)) return;
    try {
      fs.renameSync(old, target);
    } catch {
      // A pasta antiga está em uso (ex.: o PulseBrowser antigo aberto): continua usando-a.
      app.setPath('userData', old);
    }
  } catch { /* ignora */ }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap() {
  const { Settings } = require('./settings');
  ctx.settings = new Settings();
  if (!ctx.settings.get('hardwareAcceleration')) app.disableHardwareAcceleration();
  if (!ctx.settings.get('smoothScrolling')) app.commandLine.appendSwitch('disable-smooth-scrolling');
  app.commandLine.appendSwitch('enable-features', 'ParallelDownloading');

  app.on('second-instance', (_e, argv) => handleArgv(argv, true));
  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
  app.on('activate', () => {
    if (ctx.windows.length === 0 && app.isReady()) require('./window').PulseWindow.open();
  });
  app.on('before-quit', () => {
    // Salva todas as janelas abertas (se não houver nenhuma, mantém o último estado salvo).
    if (ctx.windows.length) require('./sessionstore').save();
    ctx.quitting = true;
    for (const s of [ctx.settings, ctx.history, ctx.bookmarks, ctx.downloads, ctx.passwords, ctx.accounts]) s?.store?.flush();
    ctx.grammar?.flush?.();
    ctx.injector?.flush();
    ctx.extensions?.flush();
    ctx.shield?.stats?.flush();
  });
  app.on('certificate-error', (event, webContents, url, _error, _cert, callback) => {
    const { getCertExceptions } = require('./sessions');
    let host = '';
    try {
      host = new URL(url).host;
    } catch { /* ignora */ }
    if (host && getCertExceptions(webContents.session).has(host)) {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });
  // Abrir links/arquivos no macOS.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (app.isReady()) openUrls([url]);
    else pendingUrls.push(url);
  });

  app.whenReady().then(init).catch((err) => {
    console.error('Falha ao iniciar o tuff.browse', err);
    app.quit();
  });
}

function parseArgv(argv) {
  const { looksLikeUrl } = require('./omnibox');
  const skip = process.defaultApp ? 2 : 1;
  const urls = [];
  for (const arg of argv.slice(skip)) {
    if (!arg || arg.startsWith('-')) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(arg) && !/^[a-zA-Z]:[\\/]/.test(arg)) {
      if (/^(https?|file|ftp|pulse):/i.test(arg)) urls.push(arg);
      continue;
    }
    try {
      if (fs.existsSync(arg)) {
        urls.push(`file:///${path.resolve(arg).replace(/\\/g, '/').replace(/^\/+/, '')}`);
        continue;
      }
    } catch { /* ignora */ }
    if (looksLikeUrl(arg)) urls.push(`https://${arg}`);
  }
  return {
    urls,
    incognito: argv.includes('--incognito'),
    newWindow: argv.includes('--new-window'),
  };
}

function openUrls(urls) {
  const { PulseWindow } = require('./window');
  const target = ctx.lastFocusedWindow && !ctx.lastFocusedWindow.incognito && !ctx.lastFocusedWindow.win.isDestroyed()
    ? ctx.lastFocusedWindow
    : ctx.windows.find((w) => !w.incognito);
  if (!target) {
    PulseWindow.open({ urls });
    return;
  }
  urls.forEach((url, i) => target.createTab({ url, active: i === urls.length - 1 }));
  target.focusOrRestore();
}

function handleArgv(argv, fromSecondInstance) {
  const { PulseWindow } = require('./window');
  const { urls, incognito, newWindow } = parseArgv(argv);
  if (incognito) {
    PulseWindow.open({ incognito: true, urls });
    return;
  }
  if (newWindow) {
    PulseWindow.open({ urls });
    return;
  }
  if (urls.length) {
    openUrls(urls);
    return;
  }
  if (fromSecondInstance) {
    const w = ctx.lastFocusedWindow || ctx.windows[ctx.windows.length - 1];
    if (w && !w.win.isDestroyed()) w.focusOrRestore();
    else PulseWindow.open();
  }
}

function buildMacMenu() {
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]);
}

function wireEvents() {
  const ipc = require('./ipc');
  const sessions = require('./sessions');

  ctx.settings.on('changed', (key) => {
    const data = ctx.settings.publicData();
    if (key === 'theme') nativeTheme.themeSource = data.theme;
    if (key === 'grammarDictionary') {
      sessions.syncDictionary(session.defaultSession);
      if (ctx.incognitoSession) sessions.syncDictionary(ctx.incognitoSession);
    }
    if (key === 'spellcheck' || key === 'spellcheckLanguages') {
      sessions.applySpellcheck(session.defaultSession);
      if (ctx.incognitoSession) sessions.applySpellcheck(ctx.incognitoSession);
    }
    if (key === 'shieldLists' || key === 'shieldCategories') ctx.shield.reconfigure();
    for (const w of ctx.windows) {
      w.sendUI('ui:settings', data);
      if (key === 'animations') w._sendOverlay('overlay:settings', { animations: data.animations });
      if (key === 'shieldAllowlist' || key === 'shieldEnabled' || key === 'passwordManager') w.scheduleUpdate();
    }
    ipc.broadcastInternal('internal:settings-changed', { key });
  });

  nativeTheme.on('updated', () => {
    for (const w of ctx.windows) w.updateTitleBarColors();
  });

  ctx.extensions.on('changed', () => {
    for (const w of ctx.windows) {
      w.sendUI('ui:extensions', ctx.extensions.uiState(w.incognito));
      if (w.popup?.type === 'extensions') w.updatePopup({ type: 'extensions', data: { ...ctx.extensions.uiState(w.incognito), incognito: w.incognito } });
    }
    ipc.broadcastInternal('internal:ext-changed');
  });

  ctx.bookmarks.on('changed', () => {
    for (const w of ctx.windows) {
      w.sendUI('ui:bookmarks', w.bookmarksBarData());
      w.scheduleUpdate();
    }
    ipc.broadcastInternal('internal:bookmarks-changed');
  });

  ctx.history.on('changed', () => ipc.broadcastInternal('internal:history-changed'));

  ctx.accounts.on('changed', (data) => {
    for (const w of ctx.windows) {
      if (w.incognito) continue;
      w.sendUI('ui:account', data);
      if (w.popup?.type === 'profile') w.updatePopup({ type: 'profile', data: w.profileData() });
    }
    ipc.broadcastInternal('internal:accounts-changed', data);
  });

  ctx.downloads.on('changed', () => {
    const summary = ctx.downloads.summary();
    for (const w of ctx.windows) {
      w.sendUI('ui:downloads', summary);
      if (w.popup?.type === 'downloads') w.updatePopup({ type: 'downloads', data: summary });
    }
    ipc.broadcastInternal('internal:downloads-changed');
  });
  ctx.downloads.on('started', (record, wc) => {
    const w = ctx.windows.find((x) => x.ownsWebContents(wc)) || ctx.lastFocusedWindow;
    w?.sendUI('ui:download-started', { id: record.id });
  });
  ctx.downloads.on('done', (record, wc) => {
    if (record.state !== 'completed') return;
    const w = ctx.windows.find((x) => x.ownsWebContents(wc)) || ctx.lastFocusedWindow;
    w?.toast(`Download concluído: ${record.filename}`);
  });
}

function setupJumpList() {
  if (process.platform !== 'win32') return;
  const prefix = process.defaultApp ? `"${app.getAppPath()}" ` : '';
  try {
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: `${prefix}--new-window`,
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'Nova janela',
        description: 'Abrir uma nova janela do tuff.browse',
      },
      {
        program: process.execPath,
        arguments: `${prefix}--incognito`,
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'Nova janela anônima',
        description: 'Navegar sem salvar histórico',
      },
    ]);
  } catch { /* ignora */ }
}

function startMemorySaver() {
  setInterval(() => {
    if (!ctx.settings.get('memorySaver')) return;
    const limit = ctx.settings.get('memorySaverMinutes') * 60_000;
    const now = Date.now();
    for (const w of ctx.windows) {
      for (const t of w.tabs) {
        if (t === w.activeTab || t.discarded || t.audible || t.pinned || t.loading || t.devtoolsView) continue;
        if (now - t.lastActive > limit) t.discard();
      }
    }
  }, 60_000);
}

function startupWindows(argv) {
  const { PulseWindow } = require('./window');
  const sessionstore = require('./sessionstore');
  const { resolveInput } = require('./omnibox');
  const { NEW_TAB } = require('./tab');
  const parsed = parseArgv(argv);
  const extraUrls = [...parsed.urls, ...pendingUrls];

  if (parsed.incognito) {
    PulseWindow.open({ incognito: true, urls: extraUrls });
    return;
  }

  let opened = false;
  const mode = ctx.settings.get('startup');
  if (mode === 'restore') {
    for (const w of sessionstore.load()) {
      if (!w.tabs || !w.tabs.length) continue;
      PulseWindow.open({ bounds: w.bounds, maximized: w.maximized, restoreTabs: w.tabs, activeIndex: w.active });
      opened = true;
    }
  }
  if (!opened) {
    const list = mode === 'urls' ? ctx.settings.get('startupUrls').map(resolveInput).filter(Boolean) : [];
    if (extraUrls.length && !list.length) {
      PulseWindow.open({ urls: extraUrls });
      return;
    }
    PulseWindow.open({ urls: list.length ? list : [NEW_TAB] });
  }
  if (extraUrls.length) openUrls(extraUrls);
}

async function init() {
  const { History } = require('./history');
  const { Bookmarks } = require('./bookmarks');
  const { Downloads } = require('./downloads');
  const { Shield } = require('./shield');
  const sessions = require('./sessions');

  const { Passwords } = require('./passwords');
  const { GoogleAccounts } = require('./accounts');
  const { Grammar } = require('./grammar');
  const { Injector } = require('./injector');
  const { Extensions } = require('./extensions');

  ctx.history = new History();
  ctx.bookmarks = new Bookmarks();
  ctx.downloads = new Downloads();
  ctx.shield = new Shield();
  ctx.passwords = new Passwords();
  ctx.accounts = new GoogleAccounts();
  ctx.grammar = new Grammar();
  ctx.injector = new Injector();
  ctx.extensions = new Extensions();

  sessions.cleanAppUserAgent();
  nativeTheme.themeSource = ctx.settings.get('theme');
  Menu.setApplicationMenu(isMac ? buildMacMenu() : null);
  sessions.setupSession(session.defaultSession);

  require('./ipc').register();
  require('./autofill').register();
  ctx.grammar.register();
  ctx.injector.register();
  ctx.extensions.register();
  wireEvents();
  ctx.accounts.start();
  ctx.shield.start();
  setupJumpList();
  startMemorySaver();

  await sessions.loadExtensions().catch(() => {});
  startupWindows(process.argv);

  const scenario = process.env.TUFF_SCENARIO || process.env.PULSE_SCENARIO;
  if (!app.isPackaged && scenario) require('./selftest').run(scenario);
}
