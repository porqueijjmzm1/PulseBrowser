'use strict';
// Salva e restaura as janelas/abas abertas ("Continuar de onde parou").
const ctx = require('./context');
const { JsonStore } = require('./store');

let store = null;
let timer = null;

function getStore() {
  if (!store) store = new JsonStore('session', { windows: [] }, { delay: 300 });
  return store;
}

function snapshot(w) {
  const bounds = w.win.isDestroyed() ? null : w.win.getNormalBounds();
  return {
    bounds,
    maximized: !w.win.isDestroyed() && w.win.isMaximized(),
    active: Math.max(0, w.tabs.indexOf(w.activeTab)),
    tabs: w.tabs.map((t) => t.serializeForSession()).filter((t) => t.url && !t.url.startsWith('view-source:')),
  };
}

function save() {
  clearTimeout(timer);
  timer = null;
  const normal = ctx.windows.filter((w) => !w.incognito && !w.closing && !w.win.isDestroyed());
  if (!normal.length) return;
  const s = getStore();
  s.data = { windows: normal.map(snapshot).filter((w) => w.tabs.length), time: Date.now() };
  s.flush();
}

function saveSoon() {
  if (timer) return;
  timer = setTimeout(save, 1000);
}

// Ao fechar uma janela: se houver outras janelas normais, ela sai da sessão.
function onWindowClosing(w) {
  if (w.incognito || ctx.quitting) return;
  const others = ctx.windows.filter((x) => x !== w && !x.incognito && !x.closing);
  if (others.length) {
    w.closing = true;
    save();
  } else {
    save();
    w.closing = true;
  }
}

function load() {
  const data = getStore().data;
  return Array.isArray(data.windows) ? data.windows : [];
}

module.exports = { save, saveSoon, onWindowClosing, load };
