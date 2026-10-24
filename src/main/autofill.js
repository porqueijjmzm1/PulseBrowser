'use strict';
// Ponte entre o script de senhas das páginas (preload/content-passwords.js) e o gerenciador de senhas.
// Decide quando oferecer "Salvar senha?" depois de um login.
const { ipcMain, BrowserWindow, nativeTheme } = require('electron');
const ctx = require('./context');
const { siteKey, originMatches } = require('./passwords');
const { findTabByWebContentsId } = require('./sessions');

const pending = new Map(); // webContents.id -> login aguardando confirmação
const hints = new Map(); // webContents.id -> { origin, username, time } (login em duas etapas)
const watched = new Set();

const HINT_TTL = 10 * 60_000;
const PENDING_TTL = 60_000;

// Só aceita mensagens do frame principal de páginas http(s) em abas ou pop-ups do navegador.
function contentContext(event) {
  const frame = event.senderFrame;
  if (!frame || frame.parent) return null;
  const origin = frame.origin || '';
  if (!/^https?:\/\//.test(origin)) return null;
  const wc = event.sender;
  const tab = findTabByWebContentsId(wc.id);
  let window = tab ? tab.window : null;
  if (!window) {
    if (!BrowserWindow.fromWebContents(wc)) return null;
    const last = ctx.lastFocusedWindow;
    window = last && !last.win.isDestroyed() && last.session === wc.session
      ? last
      : ctx.windows.find((w) => !w.win.isDestroyed() && w.session === wc.session) || null;
  }
  if (!window) return null;
  return { wc, origin, tab, window };
}

function enabled() {
  return ctx.settings.get('passwordManager');
}

function clearPending(id) {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.expire);
  clearTimeout(p.stateTimer);
  pending.delete(id);
}

function showPrompt(p) {
  clearPending(p.wcId);
  if (!enabled() || ctx.passwords.isNever(p.origin)) return;
  const existing = ctx.passwords.find(p.origin, p.username);
  if (existing && ctx.passwords.password(existing.id) === p.password) return;
  let w = p.window;
  if (!w || w.win.isDestroyed()) w = ctx.lastFocusedWindow;
  if (!w || w.win.isDestroyed()) return;
  w.promptSavePassword({
    origin: p.origin,
    username: p.username,
    password: p.password,
    update: !!existing,
  });
}

function watch(wc) {
  const id = wc.id;
  if (watched.has(id)) return;
  watched.add(id);
  wc.on('did-navigate', () => {
    const p = pending.get(id);
    if (!p) return;
    // Espera a nova página dizer se ainda há um campo de senha (login que falhou).
    p.awaitingState = true;
    clearTimeout(p.stateTimer);
    p.stateTimer = setTimeout(() => {
      if (pending.get(id) === p) showPrompt(p);
    }, 4000);
  });
  wc.once('destroyed', () => {
    watched.delete(id);
    hints.delete(id);
    const p = pending.get(id);
    // Pop-up de login fechado logo depois de enviar a senha: o login deu certo.
    if (p) showPrompt(p);
  });
}

function broadcastRefresh() {
  for (const w of ctx.windows) {
    for (const t of w.tabs) {
      const wc = t.webContents;
      if (wc && /^https?:/.test(t.url)) wc.send('pw:refresh');
    }
    w.scheduleUpdate();
  }
  for (const bw of BrowserWindow.getAllWindows()) {
    if (ctx.windows.some((w) => w.win === bw)) continue;
    const wc = bw.webContents;
    if (!wc.isDestroyed() && /^https?:/.test(wc.getURL())) wc.send('pw:refresh');
  }
}

function register() {
  ctx.passwords.on('changed', () => {
    broadcastRefresh();
    require('./ipc').broadcastInternal('internal:passwords-changed');
  });

  ipcMain.handle('pw:query', (event) => {
    const c = contentContext(event);
    if (!c) return null;
    const on = enabled();
    return {
      enabled: on,
      autofill: on && ctx.settings.get('passwordAutofill'),
      accounts: on ? ctx.passwords.forOrigin(c.origin).map((a) => ({ id: a.id, username: a.username })) : [],
      never: ctx.passwords.isNever(c.origin),
      accent: ctx.settings.accentColor(),
      dark: nativeTheme.shouldUseDarkColors,
      animations: ctx.settings.get('animations'),
    };
  });

  ipcMain.handle('pw:fill', (event, id) => {
    const c = contentContext(event);
    if (!c || !enabled() || typeof id !== 'string') return null;
    const login = ctx.passwords.get(id);
    if (!login || !originMatches(login.origin, c.origin)) return null;
    ctx.passwords.markUsed(id);
    return { username: login.username, password: ctx.passwords.password(id) };
  });

  ipcMain.on('pw:username', (event, data) => {
    const c = contentContext(event);
    if (!c) return;
    const username = String(data?.username || '').trim().slice(0, 500);
    if (!username) return;
    hints.set(c.wc.id, { origin: c.origin, username, time: Date.now() });
    watch(c.wc);
  });

  ipcMain.on('pw:submitted', (event, data) => {
    const c = contentContext(event);
    if (!c || !enabled() || ctx.passwords.isNever(c.origin)) return;
    const password = String(data?.password || '');
    if (!password || password.length > 1000) return;
    let username = String(data?.username || '').trim().slice(0, 500);
    const hint = hints.get(c.wc.id);
    if (!username && hint && Date.now() - hint.time < HINT_TTL && siteKey(hint.origin) === siteKey(c.origin)) {
      username = hint.username;
    }
    const existing = ctx.passwords.find(c.origin, username);
    if (existing && ctx.passwords.password(existing.id) === password) {
      ctx.passwords.markUsed(existing.id);
      clearPending(c.wc.id);
      return;
    }
    clearPending(c.wc.id);
    const p = {
      wcId: c.wc.id,
      origin: c.origin,
      username,
      password,
      isNew: !!data?.isNew,
      window: c.window,
      awaitingState: false,
      stateTimer: null,
    };
    p.expire = setTimeout(() => {
      if (pending.get(p.wcId) === p) pending.delete(p.wcId);
    }, PENDING_TTL);
    pending.set(c.wc.id, p);
    watch(c.wc);
  });

  // O formulário de login sumiu sem trocar de página (sites de página única).
  ipcMain.on('pw:login-done', (event) => {
    const c = contentContext(event);
    if (!c) return;
    const p = pending.get(c.wc.id);
    if (p && !p.awaitingState) showPrompt(p);
  });

  ipcMain.on('pw:page-state', (event, data) => {
    const c = contentContext(event);
    if (!c) return;
    const p = pending.get(c.wc.id);
    if (!p || !p.awaitingState) return;
    clearTimeout(p.stateTimer);
    const failed = !!data?.hasPassword && siteKey(c.origin) === siteKey(p.origin) && !p.isNew;
    if (failed) clearPending(p.wcId);
    else showPrompt(p);
  });

  // Pedido síncrono feito antes dos scripts da página de login do Google.
  ipcMain.on('pw:google-compat', (event) => {
    const frame = event.senderFrame;
    const ok = frame && !frame.parent && frame.origin === 'https://accounts.google.com' && ctx.settings.get('googleCompat');
    event.returnValue = ok ? { ua: ctx.accounts.firefoxUA } : null;
  });

  ipcMain.on('pw:open-manager', (event) => {
    const c = contentContext(event);
    if (c) c.window.command('passwords');
  });
}

module.exports = { register };
