'use strict';
// Lógica da barra de endereço: interpretar o que foi digitado e gerar sugestões.
const { net } = require('electron');
const ctx = require('./context');

const INTERNAL_ALIASES = {
  'chrome://settings': 'tuff://settings',
  'chrome://history': 'tuff://history',
  'chrome://downloads': 'tuff://downloads',
  'chrome://bookmarks': 'tuff://bookmarks',
  'chrome://newtab': 'tuff://newtab',
  'about:settings': 'tuff://settings',
  'about:history': 'tuff://history',
  'about:downloads': 'tuff://downloads',
  'about:newtab': 'tuff://newtab',
  'about:pulse': 'tuff://about',
  'about:tuff': 'tuff://about',
  'chrome://extensions': 'tuff://extensions',
  'about:extensions': 'tuff://extensions',
  'about:addons': 'tuff://extensions',
  'tuff://store': 'tuff://extensions/#store',
  'pulse://store': 'tuff://extensions/#store',
  'about:store': 'tuff://extensions/#store',
};

const SCHEME_RE = /^(https?|file|tuff|tuff-ext|pulse|view-source|about|data|chrome|chrome-extension|ftp|blob|mailto|tel):/i;

function looksLikeUrl(text) {
  if (/\s/.test(text)) return false;
  if (SCHEME_RE.test(text)) return true;
  if (/^localhost(:\d+)?([/?#].*)?$/i.test(text)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(text)) return true;
  if (/^\[[0-9a-f:]+\](:\d+)?([/?#].*)?$/i.test(text)) return true;
  return /^([a-z0-9¡-￿-]+\.)+[a-z¡-￿]{2,}(:\d+)?([/?#].*)?$/i.test(text);
}

function resolveInput(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const lower = text.toLowerCase().replace(/\/$/, '');
  if (INTERNAL_ALIASES[lower]) return INTERNAL_ALIASES[lower];
  if (/^pulse:/i.test(text)) return `tuff:${text.slice(6)}`;
  if (/^[a-zA-Z]:[\\/]/.test(text)) return `file:///${text.replace(/\\/g, '/')}`;
  if (text.startsWith('/') && process.platform !== 'win32' && !/\s/.test(text)) return `file://${text}`;
  if (looksLikeUrl(text)) {
    if (SCHEME_RE.test(text)) return text;
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[)/i.test(text)) return `http://${text}`;
    return `https://${text}`;
  }
  return ctx.settings.searchUrl(text);
}

function localSuggestions(text, { incognito = false } = {}) {
  const q = text.trim();
  const items = [];
  if (!q) return { items, inline: null };

  const isUrl = looksLikeUrl(q);
  const resolved = resolveInput(q);
  const inline = isUrl || /\s/.test(q) ? null : ctx.history.inlineCompletion(q);
  const engineName = ctx.settings.engine().name;

  if (inline && inline.text.toLowerCase() !== q.toLowerCase()) {
    items.push({ type: 'url', text: inline.text, url: inline.url, title: '', inline: true });
  }
  if (isUrl) {
    items.push({ type: 'url', text: q, url: resolved, title: '' });
  } else {
    items.push({ type: 'search', text: q, url: resolved, title: `Pesquisar no ${engineName}` });
  }

  const seen = new Set(items.map((i) => i.url));
  for (const b of ctx.bookmarks.search(q, 3)) {
    if (seen.has(b.url)) continue;
    seen.add(b.url);
    items.push({ type: 'bookmark', text: b.title, url: b.url, title: b.url, favicon: b.favicon });
  }
  for (const h of ctx.history.search(q, 6)) {
    if (seen.has(h.url) || items.length >= 7) continue;
    seen.add(h.url);
    items.push({ type: 'history', text: h.title || h.url, url: h.url, title: h.url, favicon: h.favicon });
  }
  // Abas abertas que correspondem à busca ("mudar para esta aba").
  if (!incognito) {
    const ql = q.toLowerCase();
    for (const w of ctx.windows) {
      if (w.incognito) continue;
      for (const t of w.tabs) {
        if (items.length >= 8) break;
        if (!/^https?:/.test(t.url) || seen.has(t.url)) continue;
        if (t.url.toLowerCase().includes(ql) || (t.title || '').toLowerCase().includes(ql)) {
          seen.add(t.url);
          items.push({ type: 'tab', text: t.title || t.url, url: t.url, title: 'Mudar para esta aba', tabId: t.id, windowId: w.id });
        }
      }
    }
  }
  return { items, inline: inline && inline.text.toLowerCase() !== q.toLowerCase() ? inline.text : null };
}

async function remoteSuggestions(text) {
  const q = text.trim();
  if (!q || !ctx.settings.get('searchSuggestions') || looksLikeUrl(q)) return [];
  const engine = ctx.settings.engine();
  if (!engine.suggest) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await net.fetch(engine.suggest.replace('%s', encodeURIComponent(q)), {
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!res.ok) return [];
    const data = await res.json();
    let list = [];
    if (Array.isArray(data) && Array.isArray(data[1])) list = data[1];
    else if (Array.isArray(data?.suggestions)) list = data.suggestions.map((s) => (typeof s === 'string' ? s : s.phrase || s.value));
    else if (Array.isArray(data)) list = data.map((s) => s.phrase || s.value || s);
    return list
      .filter((s) => typeof s === 'string' && s.toLowerCase() !== q.toLowerCase())
      .slice(0, 5)
      .map((s) => ({ type: 'search', text: s, url: ctx.settings.searchUrl(s), title: '' }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { resolveInput, looksLikeUrl, localSuggestions, remoteSuggestions };
