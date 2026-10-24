'use strict';
// Gerenciador de senhas. As senhas ficam criptografadas com o cofre do sistema
// (DPAPI no Windows, Keychain no macOS) através do safeStorage do Electron.
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { safeStorage, net } = require('electron');
const { JsonStore } = require('./store');

const COMMON_PASSWORDS = new Set([
  '123456', '123456789', '12345678', '12345', '1234567', '1234567890', '111111', '000000', '123123', '654321',
  'password', 'password1', 'senha', 'senha123', 'qwerty', 'qwerty123', 'abc123', 'abcd1234', 'iloveyou', 'admin',
  'admin123', 'welcome', 'letmein', 'monkey', 'dragon', 'football', 'futebol', 'brasil', 'flamengo', 'corinthians',
  'palmeiras', 'sao paulo', 'gremio', 'vasco', 'cruzeiro', 'santos', 'amor', 'teamo', 'mudar123', '102030', '1q2w3e4r',
  '1q2w3e', 'qwe123', 'asdf1234', 'zaq12wsx', 'passw0rd', 'p@ssw0rd', 'master', 'sunshine', 'princess', 'baseball',
]);

function normalizeOrigin(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.origin;
  } catch {
    return '';
  }
}

// Site sem o "www." inicial (inclui a porta, se houver).
function siteKey(origin) {
  try {
    return new URL(origin).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function schemeOf(origin) {
  return origin.startsWith('https:') ? 'https' : 'http';
}

// Uma senha salva em http pode ser usada no mesmo site em https, mas não o contrário.
function originMatches(savedOrigin, pageOrigin) {
  if (siteKey(savedOrigin) !== siteKey(pageOrigin)) return false;
  const saved = schemeOf(savedOrigin);
  const page = schemeOf(pageOrigin);
  return saved === page || (saved === 'http' && page === 'https');
}

function strengthOf(password) {
  const p = String(password || '');
  if (!p) return 0;
  if (COMMON_PASSWORDS.has(p.toLowerCase())) return 0;
  let classes = 0;
  if (/[a-z]/.test(p)) classes++;
  if (/[A-Z]/.test(p)) classes++;
  if (/\d/.test(p)) classes++;
  if (/[^a-zA-Z0-9]/.test(p)) classes++;
  const unique = new Set(p).size;
  if (p.length < 8 || unique < 4) return 0;
  if (p.length < 10 && classes < 3) return 1;
  if (p.length < 12 && classes < 2) return 1;
  if (p.length >= 14 && classes >= 3) return 3;
  return 2;
}

// ---------------------------------------------------------------- CSV
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

class Passwords extends EventEmitter {
  constructor() {
    super();
    this.store = new JsonStore('passwords', { logins: [], never: [] }, { delay: 300 });
    if (!Array.isArray(this.store.data.logins)) this.store.data.logins = [];
    if (!Array.isArray(this.store.data.never)) this.store.data.never = [];
  }

  get logins() {
    return this.store.data.logins;
  }

  encryptionAvailable() {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  _encrypt(plain) {
    const text = String(plain ?? '');
    if (this.encryptionAvailable()) {
      return `v1:${safeStorage.encryptString(text).toString('base64')}`;
    }
    return `p0:${Buffer.from(text, 'utf8').toString('base64')}`;
  }

  _decrypt(stored) {
    const s = String(stored || '');
    try {
      if (s.startsWith('v1:')) return safeStorage.decryptString(Buffer.from(s.slice(3), 'base64'));
      if (s.startsWith('p0:')) return Buffer.from(s.slice(3), 'base64').toString('utf8');
    } catch (err) {
      console.warn('[passwords] não foi possível descriptografar uma senha:', err.message);
    }
    return '';
  }

  _changed() {
    this.store.save();
    this.emit('changed');
  }

  _public(l) {
    return {
      id: l.id,
      origin: l.origin,
      site: siteKey(l.origin),
      username: l.username,
      created: l.created,
      updated: l.updated,
      lastUsed: l.lastUsed || 0,
      timesUsed: l.timesUsed || 0,
      note: l.note || '',
    };
  }

  // Lista sem as senhas (para páginas e menus).
  list() {
    return this.logins
      .map((l) => this._public(l))
      .sort((a, b) => a.site.localeCompare(b.site) || a.username.localeCompare(b.username));
  }

  forOrigin(origin) {
    const o = normalizeOrigin(origin);
    if (!o) return [];
    return this.logins
      .filter((l) => originMatches(l.origin, o))
      .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0) || (b.timesUsed || 0) - (a.timesUsed || 0))
      .map((l) => this._public(l));
  }

  countFor(origin) {
    const o = normalizeOrigin(origin);
    if (!o) return 0;
    let n = 0;
    for (const l of this.logins) if (originMatches(l.origin, o)) n++;
    return n;
  }

  get(id) {
    return this.logins.find((l) => l.id === id) || null;
  }

  password(id) {
    const l = this.get(id);
    return l ? this._decrypt(l.password) : null;
  }

  find(origin, username) {
    const o = normalizeOrigin(origin);
    const key = siteKey(o);
    return this.logins.find((l) => siteKey(l.origin) === key && schemeOf(l.origin) === schemeOf(o) && l.username === username) || null;
  }

  // Retorna { id, created, updated, unchanged }.
  save({ origin, username = '', password, note }) {
    const o = normalizeOrigin(origin);
    if (!o) throw new Error('Endereço inválido');
    if (!password) throw new Error('Senha vazia');
    const user = String(username).trim().slice(0, 500);
    const now = Date.now();
    const existing = this.find(o, user);
    if (existing) {
      if (this._decrypt(existing.password) === password) return { id: existing.id, unchanged: true };
      existing.password = this._encrypt(password);
      existing.updated = now;
      if (note != null) existing.note = String(note).slice(0, 2000);
      this._changed();
      return { id: existing.id, updated: true };
    }
    const login = {
      id: crypto.randomUUID(),
      origin: o,
      username: user,
      password: this._encrypt(String(password).slice(0, 1000)),
      created: now,
      updated: now,
      lastUsed: 0,
      timesUsed: 0,
    };
    if (note) login.note = String(note).slice(0, 2000);
    this.logins.push(login);
    this.removeNever(o);
    this._changed();
    return { id: login.id, created: true };
  }

  update(id, changes = {}) {
    const l = this.get(id);
    if (!l) return false;
    if (typeof changes.username === 'string') l.username = changes.username.trim().slice(0, 500);
    if (typeof changes.password === 'string' && changes.password) l.password = this._encrypt(changes.password.slice(0, 1000));
    if (typeof changes.note === 'string') l.note = changes.note.slice(0, 2000);
    if (typeof changes.origin === 'string') {
      const o = normalizeOrigin(changes.origin);
      if (o) l.origin = o;
    }
    l.updated = Date.now();
    this._changed();
    return true;
  }

  remove(id) {
    const before = this.logins.length;
    this.store.data.logins = this.logins.filter((l) => l.id !== id);
    if (this.logins.length !== before) this._changed();
    return true;
  }

  markUsed(id) {
    const l = this.get(id);
    if (!l) return;
    l.lastUsed = Date.now();
    l.timesUsed = (l.timesUsed || 0) + 1;
    this.store.save();
  }

  clear() {
    this.store.data.logins = [];
    this._changed();
  }

  // ---- Sites em que o usuário escolheu "Nunca salvar".
  isNever(origin) {
    const key = siteKey(normalizeOrigin(origin));
    return !!key && this.store.data.never.includes(key);
  }

  addNever(origin) {
    const key = siteKey(normalizeOrigin(origin));
    if (!key || this.store.data.never.includes(key)) return;
    this.store.data.never.push(key);
    this._changed();
  }

  removeNever(originOrKey) {
    const key = originOrKey.includes('://') ? siteKey(originOrKey) : String(originOrKey).toLowerCase();
    const before = this.store.data.never.length;
    this.store.data.never = this.store.data.never.filter((k) => k !== key);
    if (before !== this.store.data.never.length) this._changed();
  }

  neverList() {
    return [...this.store.data.never].sort();
  }

  // ---- Verificação de senhas fracas e reutilizadas.
  health() {
    const byPassword = new Map();
    const result = [];
    for (const l of this.logins) {
      const pw = this._decrypt(l.password);
      const hash = crypto.createHash('sha256').update(pw).digest('hex');
      if (!byPassword.has(hash)) byPassword.set(hash, new Set());
      byPassword.get(hash).add(siteKey(l.origin));
      result.push({ login: l, hash, strength: strengthOf(pw) });
    }
    return result.map(({ login, hash, strength }) => ({
      ...this._public(login),
      strength,
      weak: strength === 0,
      reused: byPassword.get(hash).size > 1,
    }));
  }

  // Consulta o Have I Been Pwned com k-anonimato: só os 5 primeiros caracteres
  // do SHA-1 saem do computador; a senha nunca é enviada.
  async checkLeaks() {
    const byPrefix = new Map();
    for (const l of this.logins) {
      const sha1 = crypto.createHash('sha1').update(this._decrypt(l.password)).digest('hex').toUpperCase();
      const prefix = sha1.slice(0, 5);
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
      byPrefix.get(prefix).push({ id: l.id, suffix: sha1.slice(5) });
    }
    const leaked = new Set();
    for (const [prefix, items] of byPrefix) {
      const res = await net.fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const hits = new Map();
      for (const line of text.split(/\r?\n/)) {
        const [suffix, count] = line.trim().split(':');
        if (suffix && Number(count) > 0) hits.set(suffix.toUpperCase(), Number(count));
      }
      for (const it of items) if (hits.has(it.suffix)) leaked.add(it.id);
    }
    return [...leaked];
  }

  // ---- Importar e exportar CSV (formato do Chrome, Firefox, Edge e Bitwarden).
  importCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) return { added: 0, updated: 0, skipped: 0 };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
    const iUrl = col('url', 'login_uri', 'origin', 'website', 'web site', 'site');
    const iUser = col('username', 'login_username', 'login', 'user', 'email', 'usuário', 'usuario');
    const iPass = col('password', 'login_password', 'senha');
    const iNote = col('note', 'notes', 'extra');
    if (iUrl < 0 || iPass < 0) throw new Error('O arquivo não parece ser uma exportação de senhas (faltam as colunas url e password).');
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const r of rows.slice(1)) {
      let url = (r[iUrl] || '').trim();
      if (url && !/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
      const password = r[iPass] || '';
      if (!normalizeOrigin(url) || !password) {
        skipped++;
        continue;
      }
      const res = this.save({
        origin: url,
        username: iUser >= 0 ? r[iUser] || '' : '',
        password,
        note: iNote >= 0 ? r[iNote] || undefined : undefined,
      });
      if (res.created) added++;
      else if (res.updated) updated++;
      else skipped++;
    }
    return { added, updated, skipped };
  }

  exportCsv() {
    const lines = ['name,url,username,password,note'];
    for (const l of this.logins) {
      lines.push([siteKey(l.origin), `${l.origin}/`, l.username, this._decrypt(l.password), l.note || ''].map(csvCell).join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
  }
}

module.exports = { Passwords, normalizeOrigin, siteKey, originMatches, strengthOf, parseCsv };
