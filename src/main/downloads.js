'use strict';
// Gerenciador de downloads.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { app, shell, BrowserWindow } = require('electron');
const ctx = require('./context');
const { JsonStore } = require('./store');

const MAX_KEPT = 300;

function uniquePath(dir, filename) {
  const safe = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 200) || 'download';
  const ext = path.extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  let candidate = path.join(dir, safe);
  let i = 1;
  while (fs.existsSync(candidate) || fs.existsSync(`${candidate}.crdownload`)) {
    candidate = path.join(dir, `${base} (${i++})${ext}`);
  }
  return candidate;
}

class Downloads extends EventEmitter {
  constructor() {
    super();
    this.store = new JsonStore('downloads', { nextId: 1, items: [] }, { delay: 1500 });
    this.live = new Map(); // id -> DownloadItem
    this.records = new Map(); // id -> registro
    this.forceAsk = new Set(); // URLs que devem abrir "Salvar como"
    this.attached = new WeakSet();
    for (const r of this.store.data.items) {
      if (r.state === 'progressing' || r.state === 'paused') r.state = 'interrupted';
      this.records.set(r.id, r);
    }
    this._emitTimer = null;
  }

  downloadDir() {
    const dir = ctx.settings.get('downloadDir');
    if (dir && fs.existsSync(dir)) return dir;
    return app.getPath('downloads');
  }

  attach(ses, { incognito = false } = {}) {
    if (this.attached.has(ses)) return;
    this.attached.add(ses);
    ses.on('will-download', (_event, item, webContents) => this._onDownload(item, webContents, incognito));
  }

  _onDownload(item, webContents, incognito) {
    const id = `d${this.store.data.nextId++}`;
    const url = item.getURL();
    const filename = item.getFilename();
    const ask = ctx.settings.get('askDownload') || this.forceAsk.has(url);
    this.forceAsk.delete(url);
    const dir = this.downloadDir();
    if (ask) {
      item.setSaveDialogOptions({ defaultPath: path.join(dir, filename), title: 'Salvar como' });
    } else {
      item.setSavePath(uniquePath(dir, filename));
    }

    const record = {
      id,
      url,
      filename,
      path: item.getSavePath(),
      mime: item.getMimeType(),
      state: 'progressing',
      received: 0,
      total: item.getTotalBytes(),
      speed: 0,
      start: Date.now(),
      end: null,
      incognito,
      paused: false,
    };
    this.records.set(id, record);
    this.live.set(id, item);

    let lastBytes = 0;
    let lastTime = Date.now();
    item.on('updated', (_e, state) => {
      const now = Date.now();
      const received = item.getReceivedBytes();
      if (now - lastTime >= 500) {
        record.speed = Math.max(0, ((received - lastBytes) * 1000) / (now - lastTime));
        lastBytes = received;
        lastTime = now;
      }
      record.received = received;
      record.total = item.getTotalBytes();
      record.path = item.getSavePath() || record.path;
      record.filename = record.path ? path.basename(record.path) : record.filename;
      record.paused = item.isPaused();
      record.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
      this._emitSoon();
    });
    item.once('done', (_e, state) => {
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes() || record.received;
      record.path = item.getSavePath() || record.path;
      record.filename = record.path ? path.basename(record.path) : record.filename;
      record.state = state; // completed | cancelled | interrupted
      record.end = Date.now();
      record.speed = 0;
      this.live.delete(id);
      if (state === 'completed' && process.platform === 'darwin') app.dock?.downloadFinished(record.path);
      this._persist();
      this._emitSoon(true);
      this.emit('done', record, webContents);
    });

    this._persist();
    this._emitSoon(true);
    this.emit('started', record, webContents);
  }

  _persist() {
    const items = [...this.records.values()].filter((r) => !r.incognito).slice(-MAX_KEPT);
    this.store.data.items = items;
    this.store.save();
  }

  _emitSoon(immediate = false) {
    if (immediate) {
      clearTimeout(this._emitTimer);
      this._emitTimer = null;
      this._emit();
      return;
    }
    if (this._emitTimer) return;
    this._emitTimer = setTimeout(() => {
      this._emitTimer = null;
      this._emit();
    }, 250);
  }

  _emit() {
    this.emit('changed');
    // Barra de progresso na barra de tarefas.
    const active = [...this.records.values()].filter((r) => r.state === 'progressing' || r.state === 'paused');
    const total = active.reduce((s, r) => s + (r.total || 0), 0);
    const received = active.reduce((s, r) => s + (r.received || 0), 0);
    const progress = active.length === 0 ? -1 : total > 0 ? received / total : 2;
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.setProgressBar(progress, { mode: active.some((r) => r.paused) ? 'paused' : 'normal' });
    }
  }

  list({ incognito = true } = {}) {
    return [...this.records.values()]
      .filter((r) => incognito || !r.incognito)
      .map((r) => ({ ...r, exists: r.state === 'completed' ? fs.existsSync(r.path) : undefined }))
      .reverse();
  }

  summary() {
    const all = [...this.records.values()];
    const active = all.filter((r) => r.state === 'progressing' || r.state === 'paused');
    const total = active.reduce((s, r) => s + (r.total || 0), 0);
    const received = active.reduce((s, r) => s + (r.received || 0), 0);
    return {
      count: all.length,
      active: active.length,
      progress: active.length && total ? received / total : active.length ? -1 : 1,
      recent: all.slice(-6).reverse().map((r) => ({ ...r })),
    };
  }

  action(id, act, webContentsForRetry) {
    const record = this.records.get(id);
    if (!record) return;
    const item = this.live.get(id);
    switch (act) {
      case 'open':
        if (record.state === 'completed') shell.openPath(record.path);
        break;
      case 'show':
        if (record.path && fs.existsSync(record.path)) shell.showItemInFolder(record.path);
        else shell.openPath(this.downloadDir());
        break;
      case 'pause':
        item?.pause();
        break;
      case 'resume':
        if (item?.canResume()) item.resume();
        break;
      case 'cancel':
        item?.cancel();
        break;
      case 'retry':
        if (webContentsForRetry && !webContentsForRetry.isDestroyed()) webContentsForRetry.downloadURL(record.url);
        break;
      case 'remove':
        item?.cancel();
        this.records.delete(id);
        this._persist();
        this._emitSoon(true);
        break;
      case 'delete-file':
        if (record.state === 'completed' && record.path) {
          shell.trashItem(record.path).catch(() => {});
        }
        this.records.delete(id);
        this._persist();
        this._emitSoon(true);
        break;
      default:
        break;
    }
  }

  clearFinished() {
    for (const [id, r] of this.records) {
      if (r.state !== 'progressing' && r.state !== 'paused') this.records.delete(id);
    }
    this._persist();
    this._emitSoon(true);
  }

  hasActive() {
    return this.live.size > 0;
  }
}

module.exports = { Downloads };
