'use strict';
// Modo de teste para desenvolvimento (desativado no app empacotado).
// PULSE_SCENARIO=<arquivo.js> executa um roteiro com acesso ao estado do navegador
// e salva capturas da janela composta (interface + aba + sobreposição).
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const ctx = require('./context');

let compositor = null;

async function getCompositor() {
  if (!compositor || compositor.isDestroyed()) {
    compositor = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
    await compositor.loadURL('data:text/html,<html><body></body></html>');
  }
  return compositor;
}

async function shot(pw, file) {
  const [w, h] = pw.win.getContentSize();
  const layers = [];
  layers.push({ img: await pw.win.webContents.capturePage(), x: 0, y: 0, w, h });
  const t = pw.activeTab;
  if (t && t.view) {
    const b = t.view.getBounds();
    layers.push({ img: await t.view.webContents.capturePage(), ...b, w: b.width, h: b.height });
  }
  if (t && t.devtoolsView) {
    const b = t.devtoolsView.getBounds();
    layers.push({ img: await t.devtoolsView.webContents.capturePage(), ...b, w: b.width, h: b.height });
  }
  if (pw.overlay.getVisible()) {
    const b = pw.overlay.getBounds();
    layers.push({ img: await pw.overlay.webContents.capturePage(), ...b, w: b.width, h: b.height });
  }
  const data = layers.filter((l) => !l.img.isEmpty()).map((l) => ({ url: l.img.toDataURL(), x: l.x, y: l.y, w: l.w, h: l.h }));
  const comp = await getCompositor();
  const png = await comp.webContents.executeJavaScript(`(async () => {
    const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h};
    const g = c.getContext('2d');
    for (const l of ${JSON.stringify(data)}) {
      const i = new Image(); i.src = l.url; await i.decode();
      g.drawImage(i, l.x, l.y, l.w, l.h);
    }
    return c.toDataURL('image/png').split(',')[1];
  })()`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(png, 'base64'));
  return file;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 15000, step = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* tenta de novo */ }
    await wait(step);
  }
  throw new Error('waitFor: tempo esgotado');
}

async function run(file) {
  const log = (...a) => console.log('[selftest]', ...a);
  try {
    const scenario = require(path.resolve(file));
    await scenario({ ctx, shot, wait, waitFor, log, app, PulseWindow: require('./window').PulseWindow });
    log('OK');
  } catch (err) {
    console.error('[selftest] FALHOU', err);
  } finally {
    if (process.env.PULSE_SCENARIO_KEEP !== '1') {
      ctx.quitting = true;
      app.quit();
    }
  }
}

module.exports = { run, shot };
