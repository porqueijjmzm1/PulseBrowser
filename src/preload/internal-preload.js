'use strict';
// Carregado em todas as abas. Expõe a API interna só nas páginas tuff:// e a API "tuff"
// das extensões só nas páginas delas (tuff-ext://), como o pop-up e a nova aba personalizada.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'tuff:' || location.protocol === 'pulse:') {
  const allowed = (ch) => typeof ch === 'string' && ch.startsWith('internal:');
  contextBridge.exposeInMainWorld('pulse', {
    invoke(channel, ...args) {
      if (!allowed(channel)) return Promise.reject(new Error('Canal bloqueado'));
      return ipcRenderer.invoke(channel, ...args);
    },
    on(channel, callback) {
      if (!allowed(channel)) return () => {};
      const listener = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  });
} else if (location.protocol === 'tuff-ext:') {
  const extId = location.hostname;
  const call = (method, ...args) => ipcRenderer.invoke('ext:api', extId, method, args);
  const storageListeners = new Set();
  ipcRenderer.on('ext:event', (_e, ev) => {
    if (!ev || ev.extId !== extId || ev.type !== 'storage') return;
    for (const cb of storageListeners) {
      try {
        cb(ev.changes);
      } catch (err) {
        console.error(err);
      }
    }
  });
  contextBridge.exposeInMainWorld('tuff', {
    id: extId,
    getURL: (p) => `tuff-ext://${extId}/${String(p || '').replace(/^\/+/, '')}`,
    storage: {
      get: (key) => call('storage.get', key),
      set: (key, value) => call('storage.set', key, value),
      remove: (key) => call('storage.remove', key),
      clear: () => call('storage.clear'),
      onChanged: (cb) => {
        if (typeof cb !== 'function') return () => {};
        storageListeners.add(cb);
        return () => storageListeners.delete(cb);
      },
    },
    tabs: {
      create: (opts) => call('tabs.create', opts),
      update: (opts) => call('tabs.update', opts),
      active: () => call('tabs.active'),
      execute: (code) => call('tabs.execute', code),
    },
    browser: {
      search: (text, opts) => call('browser.search', text, opts),
      resolve: (text) => call('browser.resolve', text),
      engine: () => call('browser.engine'),
      engines: () => call('browser.engines'),
      setEngine: (id) => call('browser.setEngine', id),
      topSites: (n) => call('browser.topSites', n),
      bookmarks: () => call('browser.bookmarks'),
      theme: () => call('browser.theme'),
      openSettings: (section) => call('browser.openSettings', section),
    },
    action: { setBadge: (text, color) => call('action.setBadge', text, color) },
    popup: { close: () => call('popup.close') },
    runtime: {
      openOptions: () => call('runtime.openOptions'),
      info: () => call('runtime.info'),
    },
    notify: (text) => call('notify', text),
    fetch: (url, opts) => call('fetch', url, opts),
  });
}
