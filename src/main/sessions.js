'use strict';
// Configuração de cada sessão do Chromium (normal e anônima).
const { session, app } = require('electron');
const ctx = require('./context');
const protocol = require('./protocol');
const permissions = require('./permissions');

const configured = new WeakSet();
const certExceptions = new WeakMap(); // session -> Set(host)

function cleanUserAgent(ua) {
  return ua
    .replace(/\s?Electron\/[\d.]+/i, '')
    .replace(/\s?pulsebrowser\/[\d.]+/i, '')
    .replace(/\s?PulseBrowser\/[\d.]+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function findTabByWebContentsId(id) {
  for (const w of ctx.windows) {
    for (const t of w.tabs) {
      if (t.webContents && t.webContents.id === id) return t;
    }
  }
  return null;
}

function applySpellcheck(ses) {
  const enabled = ctx.settings.get('spellcheck');
  ses.setSpellCheckerEnabled(enabled);
  if (process.platform === 'darwin' || !enabled) return;
  const available = new Set(ses.availableSpellCheckerLanguages);
  const langs = ctx.settings.get('spellcheckLanguages').filter((l) => available.has(l));
  if (langs.length) ses.setSpellCheckerLanguages(langs);
}

function getCertExceptions(ses) {
  let set = certExceptions.get(ses);
  if (!set) {
    set = new Set();
    certExceptions.set(ses, set);
  }
  return set;
}

function setupSession(ses, { incognito = false } = {}) {
  if (configured.has(ses)) return ses;
  configured.add(ses);
  protocol.attach(ses);
  ctx.shield.attach(ses, findTabByWebContentsId);
  ctx.downloads.attach(ses, { incognito });
  permissions.attach(ses);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
  applySpellcheck(ses);
  return ses;
}

function getIncognitoSession() {
  if (!ctx.incognitoSession) {
    ctx.incognitoSession = session.fromPartition(`incognito-${Date.now()}`, { cache: true });
    setupSession(ctx.incognitoSession, { incognito: true });
  }
  return ctx.incognitoSession;
}

async function disposeIncognitoIfUnused() {
  const ses = ctx.incognitoSession;
  if (!ses) return;
  if (ctx.windows.some((w) => w.incognito && !w.closing)) return;
  ctx.incognitoSession = null;
  try {
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
  } catch { /* ignora */ }
}

async function loadExtensions() {
  const ses = session.defaultSession;
  const api = ses.extensions || ses;
  for (const p of ctx.settings.get('extensions')) {
    try {
      await api.loadExtension(p, { allowFileAccess: true });
    } catch (err) {
      console.warn('[extensions] não foi possível carregar', p, err.message);
    }
  }
}

function cleanAppUserAgent() {
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
}

module.exports = {
  setupSession,
  getIncognitoSession,
  disposeIncognitoIfUnused,
  getCertExceptions,
  findTabByWebContentsId,
  applySpellcheck,
  loadExtensions,
  cleanAppUserAgent,
};
