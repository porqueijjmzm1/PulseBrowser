'use strict';
// tuff.browse - scripts de conteúdo das extensões.
// Pergunta ao navegador quais extensões rodam neste endereço e executa o JavaScript e o CSS delas
// na hora certa (document_start, document_end ou document_idle). Scripts com "world": "MAIN"
// rodam junto com o código da página; os outros rodam num mundo isolado com a API "tuff".
const { ipcRenderer, webFrame, contextBridge } = require('electron');

(() => {
  if (!/^(https?|file|tuff|tuff-ext):$/.test(location.protocol)) return;
  let top = true;
  try {
    top = window.top === window;
  } catch {
    top = false;
  }
  let info = null;
  try {
    info = ipcRenderer.sendSync('ext:content', { top });
  } catch {
    return;
  }
  if (!info || !Array.isArray(info.scripts) || !info.scripts.length) return;

  const storageListeners = new Map(); // extId -> Set(callback)
  ipcRenderer.on('ext:event', (_e, ev) => {
    if (!ev || ev.type !== 'storage') return;
    const set = storageListeners.get(ev.extId);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(ev.changes);
      } catch (err) {
        console.error(err);
      }
    }
  });

  // API disponível no mundo isolado (o site não enxerga).
  function makeApi(extId) {
    const call = (method, ...args) => ipcRenderer.invoke('ext:api', extId, method, args);
    return {
      id: extId,
      getURL: (p) => `tuff-ext://${extId}/${String(p || '').replace(/^\/+/, '')}`,
      storage: {
        get: (key) => call('storage.get', key),
        set: (key, value) => call('storage.set', key, value),
        remove: (key) => call('storage.remove', key),
        clear: () => call('storage.clear'),
        onChanged: (cb) => {
          if (typeof cb !== 'function') return () => {};
          if (!storageListeners.has(extId)) storageListeners.set(extId, new Set());
          storageListeners.get(extId).add(cb);
          return () => storageListeners.get(extId)?.delete(cb);
        },
      },
      notify: (text) => call('notify', text),
      fetch: (url, opts) => call('fetch', url, opts),
      tabs: { create: (opts) => call('tabs.create', opts) },
      browser: {
        resolve: (text) => call('browser.resolve', text),
        engine: () => call('browser.engine'),
      },
      runtime: { openOptions: () => call('runtime.openOptions') },
    };
  }

  const exposed = new Set();
  function prepareWorld(s) {
    if (exposed.has(s.worldId)) return;
    exposed.add(s.worldId);
    try {
      webFrame.setIsolatedWorldInfo(s.worldId, { name: `tuff.browse: ${s.name}` });
    } catch { /* ignora */ }
    try {
      contextBridge.exposeInIsolatedWorld(s.worldId, 'tuff', makeApi(s.extId));
    } catch (err) {
      console.warn('[tuff.browse] API da extensão indisponível:', err.message);
    }
  }

  const report = (s) => (err) => console.error(`[tuff.browse] Erro na extensão "${s.name}":`, err);

  function runJs(s) {
    for (const js of s.js) {
      if (s.world === 'MAIN') {
        webFrame.executeJavaScript(`${js.code}\n//# sourceURL=${js.url}`).catch(report(s));
      } else {
        prepareWorld(s);
        webFrame.executeJavaScriptInIsolatedWorld(s.worldId, [{ code: js.code, url: js.url }]).catch(report(s));
      }
    }
  }

  // Estilos entram logo, antes da página aparecer (como no Chrome).
  for (const s of info.scripts) {
    for (const css of s.css || []) {
      try {
        webFrame.insertCSS(css, { cssOrigin: 'author' });
      } catch { /* documento descartado */ }
    }
  }

  const at = { document_start: [], document_end: [], document_idle: [] };
  for (const s of info.scripts) (at[s.runAt] || at.document_idle).push(s);
  at.document_start.forEach(runJs);

  let ended = false;
  const onEnd = () => {
    if (ended) return;
    ended = true;
    at.document_end.forEach(runJs);
    // document_idle: depois do "load" ou, no máximo, 300 ms após o DOM ficar pronto.
    let idleDone = false;
    const idle = () => {
      if (idleDone) return;
      idleDone = true;
      at.document_idle.forEach(runJs);
    };
    if (document.readyState === 'complete') setTimeout(idle, 0);
    else {
      window.addEventListener('load', () => setTimeout(idle, 0), { once: true });
      setTimeout(idle, 300);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onEnd, { once: true });
  else onEnd();
})();
