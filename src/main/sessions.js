'use strict';
// Configuração de cada sessão do Chromium (normal e anônima).
const path = require('path');
const { session, app } = require('electron');
const ctx = require('./context');
const protocol = require('./protocol');
const permissions = require('./permissions');

const configured = new WeakSet();
// Scripts de conteúdo carregados em todas as páginas da sessão (cada um ignora o que não é http/https).
const CONTENT_SCRIPTS = [
  { id: 'pulse-passwords', file: 'content-passwords.js' },
  { id: 'pulse-grammar', file: 'content-grammar.js' },
  { id: 'pulse-shield', file: 'content-shield.js' },
];
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

// O dicionário pessoal do corretor gramatical também vale para o corretor ortográfico do Chromium,
// para a mesma palavra não continuar sublinhada pelos dois.
const syncedWords = new WeakMap();
function syncDictionary(ses) {
  const want = new Set(ctx.settings.get('grammarDictionary') || []);
  const had = syncedWords.get(ses) || new Set();
  for (const w of want) {
    if (had.has(w)) continue;
    try {
      ses.addWordToSpellCheckerDictionary(w);
    } catch { /* ignora */ }
  }
  for (const w of had) {
    if (want.has(w)) continue;
    try {
      ses.removeWordFromSpellCheckerDictionary(w);
    } catch { /* ignora */ }
  }
  syncedWords.set(ses, want);
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
  for (const script of CONTENT_SCRIPTS) {
    try {
      ses.registerPreloadScript({ type: 'frame', id: script.id, filePath: path.join(__dirname, '..', 'preload', script.file) });
    } catch (err) {
      console.warn('[sessions] script de conteúdo não registrado:', script.id, err.message);
    }
  }
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
  applySpellcheck(ses);
  syncDictionary(ses);
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
  syncDictionary,
  loadExtensions,
  cleanAppUserAgent,
};
