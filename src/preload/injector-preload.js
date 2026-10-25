'use strict';
// Ponte da janela do JavaScript Injector: só os canais "injector:" e só nesta janela.
const { contextBridge, ipcRenderer } = require('electron');

const allowed = (ch) => typeof ch === 'string' && ch.startsWith('injector:');
contextBridge.exposeInMainWorld('injector', {
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
