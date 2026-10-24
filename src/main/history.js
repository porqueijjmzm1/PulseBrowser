'use strict';
// Histórico de navegação: lista de visitas + índice agregado por URL.
const { EventEmitter } = require('events');
const { JsonStore } = require('./store');

const MAX_VISITS = 20000;

const DEFAULT_TOP_SITES = [
  { url: 'https://www.google.com/', title: 'Google' },
  { url: 'https://www.youtube.com/', title: 'YouTube' },
  { url: 'https://www.wikipedia.org/', title: 'Wikipedia' },
  { url: 'https://github.com/', title: 'GitHub' },
  { url: 'https://www.reddit.com/', title: 'Reddit' },
  { url: 'https://web.whatsapp.com/', title: 'WhatsApp' },
  { url: 'https://mail.google.com/', title: 'Gmail' },
  { url: 'https://www.netflix.com/', title: 'Netflix' },
];

function recordable(url) {
  return /^(https?|file):/i.test(url || '');
}

class History extends EventEmitter {
  constructor() {
    super();
    this.store = new JsonStore('history', { nextId: 1, visits: [] }, { delay: 2000 });
    this.index = new Map(); // url -> { url, title, favicon, visits, last }
    for (const v of this.store.data.visits) this._indexAdd(v);
  }

  _indexAdd(v) {
    const e = this.index.get(v.url);
    if (e) {
      e.visits += 1;
      if (v.time >= e.last) {
        e.last = v.time;
        if (v.title) e.title = v.title;
        if (v.favicon) e.favicon = v.favicon;
      }
    } else {
      this.index.set(v.url, { url: v.url, title: v.title || '', favicon: v.favicon || '', visits: 1, last: v.time });
    }
  }

  _rebuildIndex() {
    this.index.clear();
    for (const v of this.store.data.visits) this._indexAdd(v);
  }

  // Retorna o id da visita (para atualizar título/ícone depois).
  addVisit(url, title = '', favicon = '') {
    if (!recordable(url)) return null;
    const visits = this.store.data.visits;
    const last = visits[visits.length - 1];
    const now = Date.now();
    if (last && last.url === url && now - last.time < 60_000) {
      last.time = now;
      if (title) last.title = title;
      this.store.save();
      return last.id;
    }
    const visit = { id: this.store.data.nextId++, url, title, favicon, time: now };
    visits.push(visit);
    if (visits.length > MAX_VISITS) {
      visits.splice(0, visits.length - MAX_VISITS);
      this._rebuildIndex();
    } else {
      this._indexAdd(visit);
    }
    this.store.save();
    this.emit('changed');
    return visit.id;
  }

  updateVisit(id, { title, favicon }) {
    if (id == null) return;
    const visits = this.store.data.visits;
    for (let i = visits.length - 1; i >= Math.max(0, visits.length - 200); i--) {
      const v = visits[i];
      if (v.id !== id) continue;
      if (title) v.title = title;
      if (favicon) v.favicon = favicon;
      const e = this.index.get(v.url);
      if (e) {
        if (title) e.title = title;
        if (favicon) e.favicon = favicon;
      }
      this.store.save();
      return;
    }
  }

  query({ text = '', offset = 0, limit = 100 } = {}) {
    const q = text.trim().toLowerCase();
    const out = [];
    let skipped = 0;
    const visits = this.store.data.visits;
    for (let i = visits.length - 1; i >= 0 && out.length < limit; i--) {
      const v = visits[i];
      if (q && !v.url.toLowerCase().includes(q) && !(v.title || '').toLowerCase().includes(q)) continue;
      if (skipped < offset) {
        skipped++;
        continue;
      }
      out.push(v);
    }
    return out;
  }

  remove(ids) {
    const set = new Set(ids);
    this.store.data.visits = this.store.data.visits.filter((v) => !set.has(v.id));
    this._rebuildIndex();
    this.store.save();
    this.emit('changed');
  }

  removeUrl(url) {
    this.store.data.visits = this.store.data.visits.filter((v) => v.url !== url);
    this.index.delete(url);
    this.store.save();
    this.emit('changed');
  }

  clear(sinceMs = 0) {
    if (!sinceMs) this.store.data.visits = [];
    else this.store.data.visits = this.store.data.visits.filter((v) => v.time < sinceMs);
    this._rebuildIndex();
    this.store.save();
    this.emit('changed');
  }

  // Busca para a barra de endereço.
  search(text, limit = 6) {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const results = [];
    for (const e of this.index.values()) {
      const url = e.url.toLowerCase();
      const bare = url.replace(/^https?:\/\/(www\.)?/, '');
      const title = (e.title || '').toLowerCase();
      let score = 0;
      if (bare.startsWith(q)) score = 100;
      else if (url.includes(q)) score = 40;
      else if (title.includes(q)) score = 30;
      if (!score) continue;
      score += Math.min(e.visits, 50) + (Date.now() - e.last < 7 * 864e5 ? 10 : 0);
      results.push({ ...e, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  // Sugestão de autocompletar em linha (ex.: "you" -> "youtube.com/").
  inlineCompletion(text) {
    const q = text.trim().toLowerCase();
    if (!q || /\s/.test(q)) return null;
    let best = null;
    for (const e of this.index.values()) {
      const bare = e.url.replace(/^https?:\/\/(www\.)?/i, '');
      if (!bare.toLowerCase().startsWith(q)) continue;
      // Prefere a raiz do site.
      const host = bare.split('/')[0];
      const candidate = host.toLowerCase().startsWith(q) && host.length >= q.length ? `${host}/` : bare;
      const score = e.visits + (candidate.endsWith('/') && candidate.indexOf('/') === candidate.length - 1 ? 20 : 0);
      if (!best || score > best.score) best = { text: candidate, url: e.url.replace(bare, candidate), score };
    }
    return best;
  }

  topSites(limit = 8) {
    const hidden = new Set(require('./context').settings.get('hiddenTopSites'));
    const byOrigin = new Map();
    for (const e of this.index.values()) {
      if (!/^https?:/i.test(e.url)) continue;
      let origin;
      try {
        origin = new URL(e.url).origin;
      } catch {
        continue;
      }
      if (hidden.has(origin) || hidden.has(e.url)) continue;
      const cur = byOrigin.get(origin);
      if (cur) {
        cur.visits += e.visits;
        if (new URL(e.url).pathname === '/' || !cur.title) {
          cur.title = e.title || cur.title;
          if (e.favicon) cur.favicon = e.favicon;
        }
      } else {
        byOrigin.set(origin, { url: `${origin}/`, title: e.title, favicon: e.favicon, visits: e.visits });
      }
    }
    const list = [...byOrigin.values()].sort((a, b) => b.visits - a.visits).slice(0, limit);
    if (list.length < limit) {
      for (const d of DEFAULT_TOP_SITES) {
        if (list.length >= limit) break;
        const origin = new URL(d.url).origin;
        if (hidden.has(origin) || list.some((s) => s.url.startsWith(origin))) continue;
        list.push({ ...d, favicon: '', visits: 0 });
      }
    }
    return list;
  }
}

module.exports = { History, recordable };
