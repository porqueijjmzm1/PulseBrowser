'use strict';
// Ponte para a interface do navegador (barra de abas e sobreposição).
const { contextBridge, ipcRenderer } = require('electron');

const allowed = (ch) => typeof ch === 'string' && (ch.startsWith('ui:') || ch.startsWith('overlay:'));

contextBridge.exposeInMainWorld('pulse', {
  send(channel, ...args) {
    if (allowed(channel)) ipcRenderer.send(channel, ...args);
  },
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
  platform: process.platform,
});
