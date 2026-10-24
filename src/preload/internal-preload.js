'use strict';
// Carregado em todas as abas, mas só expõe a API nas páginas internas pulse://.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'pulse:') {
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
}
