'use strict';
// Contas do Google conectadas no navegador. A lista vem do próprio Google
// (mesma consulta que o Chrome usa), a partir dos cookies da sessão normal.
const { EventEmitter } = require('events');
const { session } = require('electron');
const { JsonStore } = require('./store');

const LIST_URL = 'https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard';
const AUTH_COOKIES = new Set(['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', 'LSID', '__Secure-1PSID', '__Secure-3PSID']);

const URLS = {
  signin: 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmyaccount.google.com%2F',
  add: 'https://accounts.google.com/AddSession?continue=https%3A%2F%2Fmyaccount.google.com%2F',
  signout: 'https://accounts.google.com/Logout?continue=https%3A%2F%2Fwww.google.com%2F',
  manage: (i) => `https://myaccount.google.com/?authuser=${i}`,
  gmail: (i) => `https://mail.google.com/mail/u/${i}/`,
  drive: (i) => `https://drive.google.com/drive/u/${i}/`,
  calendar: (i) => `https://calendar.google.com/calendar/u/${i}/r`,
  youtube: (i) => `https://www.youtube.com/?authuser=${i}`,
};

// Firefox estável aproximado para a data atual (uma versão nova a cada 4 semanas).
function firefoxUserAgent() {
  const base = Date.UTC(2024, 6, 9); // Firefox 128
  const weeks = Math.floor((Date.now() - base) / (28 * 864e5));
  const version = Math.max(128, 128 + weeks - 1);
  const os = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10.15'
    : process.platform === 'linux' ? 'X11; Linux x86_64' : 'Windows NT 10.0; Win64; x64';
  return `Mozilla/5.0 (${os}; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`;
}

function parseListAccounts(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^\)\]\}'\s*/, ''));
  } catch {
    return null;
  }
  const list = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : null;
  if (!list) return null;
  const out = [];
  list.forEach((a, index) => {
    if (!Array.isArray(a)) return;
    const email = a.find((v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) || '';
    if (!email) return;
    if (a.length > 5 && a[5] === 0) return; // conta inválida
    const signedOut = a.length > 14 && a[14] === 1;
    const photo = a.find((v) => typeof v === 'string' && /^https:\/\/[^/]*googleusercontent\.com\//.test(v)) || '';
    out.push({
      email,
      name: typeof a[2] === 'string' && a[2] ? a[2] : email.split('@')[0],
      photo,
      id: typeof a[10] === 'string' ? a[10] : email,
      index,
      signedOut,
    });
  });
  return out;
}

class GoogleAccounts extends EventEmitter {
  constructor() {
    super();
    this.store = new JsonStore('google-accounts', { accounts: [], checked: 0 }, { delay: 300 });
    this._timer = null;
    this._inflight = null;
    this.firefoxUA = firefoxUserAgent();
  }

  get accounts() {
    return this.store.data.accounts || [];
  }

  publicData() {
    const active = this.accounts.filter((a) => !a.signedOut);
    return { accounts: this.accounts, primary: active[0] || null, signedIn: active.length > 0 };
  }

  start() {
    setTimeout(() => this.refresh(), 3000);
    setInterval(() => this.refresh(), 30 * 60_000).unref?.();
    // Entrar ou sair do Google muda os cookies de sessão: atualiza a lista.
    session.defaultSession.cookies.on('changed', (_e, cookie) => {
      const domain = (cookie.domain || '').replace(/^\./, '');
      if ((domain === 'google.com' || domain.endsWith('.google.com')) && AUTH_COOKIES.has(cookie.name)) this.refreshSoon(1500);
    });
  }

  refreshSoon(delay = 1500) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.refresh(), delay);
  }

  refresh() {
    if (this._inflight) return this._inflight;
    this._inflight = (async () => {
      try {
        const res = await session.defaultSession.fetch(LIST_URL, {
          method: 'POST',
          body: ' ',
          credentials: 'include',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseListAccounts(await res.text());
        if (!parsed) throw new Error('resposta inesperada');
        const before = JSON.stringify(this.accounts);
        this.store.data.accounts = parsed;
        this.store.data.checked = Date.now();
        this.store.save();
        if (JSON.stringify(parsed) !== before) this.emit('changed', this.publicData());
      } catch (err) {
        console.warn('[accounts] não foi possível ler as contas do Google:', err.message);
      } finally {
        this._inflight = null;
      }
      return this.publicData();
    })();
    return this._inflight;
  }
}

module.exports = { GoogleAccounts, URLS, parseListAccounts, firefoxUserAgent };
