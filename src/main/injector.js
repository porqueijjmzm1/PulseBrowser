'use strict';
// JavaScript Injector: uma janelinha que roda código na aba ativa (como o console do F12) e guarda
// scripts que podem rodar sozinhos nos sites escolhidos.
//
// O código roda pelo mesmo protocolo que o console das DevTools usa (Runtime.evaluate): funciona em sites
// com CSP rígida, aceita "await" no topo e mostra objetos, elementos e erros como o F12.
// Só a janela do injetor fala com estes canais; páginas de sites e páginas pulse:// não têm acesso.
const path = require('path');
const { BrowserWindow, ipcMain, nativeTheme, session } = require('electron');
const ctx = require('./context');
const { JsonStore } = require('./store');

const PRELOAD = path.join(__dirname, '..', 'preload', 'injector-preload.js');
const PAGE = path.join(__dirname, '..', 'pages', 'injector.html');
const ICON = path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const PARTITION = 'pulse-injector';
const SOURCE_URL = 'pulse-injector.js';
const MAX_CODE = 500000;
const MAX_SCRIPTS = 200;
const MAX_HISTORY = 60;
const MAX_LOGS_PER_FLUSH = 300;

function isWebUrl(url) {
  return /^(https?|file):/i.test(url || '');
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// "youtube.com, *.google.com" ou "*" (todos os sites)
function parseSites(text) {
  return String(text || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, ''))
    .filter(Boolean)
    .slice(0, 50);
}

function siteMatches(sites, host) {
  if (!host) return false;
  return parseSites(sites).some((p) => p === '*' || host === p || host.endsWith(`.${p}`));
}

// ---------------------------------------------------------------- Formatação dos valores (RemoteObject)
function clip(s, n = 2000) {
  s = String(s);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function previewValue(p) {
  // Propriedade de uma prévia (ObjectPreview.properties[i])
  if (p.type === 'string') return JSON.stringify(p.value);
  if (p.type === 'function') return 'ƒ';
  if (p.type === 'object' && p.valuePreview) return previewText(p.valuePreview);
  return p.value ?? p.subtype ?? p.type;
}

function previewText(pv) {
  if (!pv) return '';
  const props = (pv.properties || []).map((p) => (pv.subtype === 'array' || pv.subtype === 'typedarray' ? previewValue(p) : `${p.name}: ${previewValue(p)}`));
  const entries = (pv.entries || []).map((e) => (e.key ? `${previewText(e.key)} => ${previewText(e.value)}` : previewText(e.value)));
  // Map e Set: só as entradas (como no F12), sem o "size".
  const items = entries.length ? entries : props;
  if (pv.overflow) items.push('…');
  if (pv.type !== 'object') return pv.description || String(pv.value ?? '');
  if (pv.subtype === 'array' || pv.subtype === 'typedarray') {
    // Como no F12: "(3) [1, 2, 3]" ou "Uint8Array(3) [1, 2, 3]"
    const d = pv.description || '';
    const prefix = /^Array\(\d+\)$/.test(d) ? `${d.slice(5)} ` : d ? `${d} ` : '';
    return `${prefix}[${items.join(', ')}]`;
  }
  if (pv.subtype === 'node' || pv.subtype === 'regexp' || pv.subtype === 'date' || pv.subtype === 'error') return pv.description || '';
  const name = pv.description && pv.description !== 'Object' ? `${pv.description} ` : '';
  return `${name}{${items.join(', ')}}`;
}

// Converte um RemoteObject em { cls, text }. Em "raw", strings saem sem aspas (como no console.log).
function formatRemote(ro, raw = false) {
  if (!ro) return { cls: 'undef', text: 'undefined' };
  switch (ro.type) {
    case 'undefined': return { cls: 'undef', text: 'undefined' };
    case 'string': return { cls: raw ? 'plain' : 'str', text: clip(raw ? ro.value : JSON.stringify(ro.value), 20000) };
    case 'number': return { cls: 'num', text: ro.unserializableValue || String(ro.value) };
    case 'bigint': return { cls: 'num', text: ro.unserializableValue || ro.description || '' };
    case 'boolean': return { cls: 'bool', text: String(ro.value) };
    case 'symbol': return { cls: 'sym', text: ro.description || 'Symbol()' };
    case 'function': return { cls: 'fn', text: clip((ro.description || 'ƒ ()').split('\n')[0], 200) };
    case 'object':
      if (ro.subtype === 'null') return { cls: 'null', text: 'null' };
      if (ro.subtype === 'error') return { cls: 'err', text: clip(ro.description || 'Error') };
      if (ro.subtype === 'node') return { cls: 'node', text: clip(ro.description || 'Node', 300) };
      if (ro.preview) return { cls: 'obj', text: clip(previewText(ro.preview)) };
      return { cls: 'obj', text: clip(ro.description || 'Object') };
    default:
      return { cls: 'plain', text: clip(ro.description || String(ro.value ?? '')) };
  }
}

// console.log("%s tem %d itens", a, b): aplica os formatos simples e ignora estilos (%c).
function formatLogArgs(args) {
  const list = [...(args || [])];
  const parts = [];
  if (list[0] && list[0].type === 'string' && /%[sdifoOc]/.test(list[0].value)) {
    const fmt = list.shift().value;
    let text = '';
    let last = 0;
    fmt.replace(/%[sdifoOc%]/g, (m, i) => {
      text += fmt.slice(last, i);
      last = i + m.length;
      if (m === '%%') text += '%';
      else if (m === '%c') list.shift();
      else {
        const a = list.shift();
        if (!a) text += m;
        else if (m === '%d' || m === '%i') text += String(Math.trunc(Number(a.value ?? NaN)));
        else if (m === '%f') text += String(Number(a.value ?? NaN));
        else text += formatRemote(a, true).text;
      }
      return m;
    });
    text += fmt.slice(last);
    parts.push({ cls: 'plain', text: clip(text, 20000) });
  }
  for (const a of list) parts.push(formatRemote(a, true));
  return parts;
}

function isMine(stackTrace, url) {
  if (url === SOURCE_URL || (url || '').startsWith('pulse-injector')) return true;
  for (let st = stackTrace; st; st = st.parent) {
    if ((st.callFrames || []).some((f) => (f.url || '').startsWith('pulse-injector'))) return true;
  }
  return false;
}

function whereOf(stackTrace) {
  const f = stackTrace?.callFrames?.[0];
  if (!f || !f.url) return '';
  const file = f.url.startsWith('pulse-injector') ? f.url : f.url.replace(/[?#].*$/, '').split('/').pop() || f.url;
  return `${file}:${f.lineNumber + 1}`;
}

// ---------------------------------------------------------------- Painel (uma janelinha por janela do navegador)
class Panel {
  constructor(injector, owner) {
    this.injector = injector;
    this.owner = owner;
    this.attached = null; // webContents com o depurador ligado
    this.targetKey = '';
    this.queue = [];
    this.dropped = 0;
    this.flushTimer = null;
    this.onMessage = (_e, method, params) => this._onDebuggerMessage(method, params);
    this.onDetach = () => {
      this.attached = null;
    };

    const dark = nativeTheme.shouldUseDarkColors || owner.incognito;
    this.win = new BrowserWindow({
      width: 680,
      height: 540,
      minWidth: 440,
      minHeight: 320,
      parent: owner.win,
      title: 'JavaScript Injector',
      icon: ICON,
      show: false,
      backgroundColor: dark ? '#17161c' : '#f6f5fa',
      autoHideMenuBar: true,
      webPreferences: {
        preload: PRELOAD,
        partition: PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    this.win.removeMenu();
    this._placeNearOwner();
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.win.webContents.on('will-navigate', (e) => e.preventDefault());
    this.win.once('ready-to-show', () => this.win.show());
    this.win.on('closed', () => this._dispose());
    this.win.loadFile(PAGE, { query: owner.incognito ? { incognito: '1' } : {} });
    this.poll = setInterval(() => this._checkTarget(), 600);
  }

  _placeNearOwner() {
    try {
      const b = this.owner.win.getBounds();
      const [w, h] = this.win.getSize();
      this.win.setPosition(Math.round(b.x + b.width - w - 24), Math.round(b.y + b.height - h - 24));
    } catch { /* ignora */ }
  }

  get wc() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  send(channel, data) {
    const wc = this.wc;
    if (wc && !wc.isDestroyed()) wc.send(channel, data);
  }

  focus() {
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  targetTab() {
    const t = this.owner.activeTab;
    return t && t.webContents && !t.webContents.isDestroyed() ? t : null;
  }

  target() {
    const t = this.targetTab();
    if (!t) return { ok: false, title: 'Nenhuma aba', url: '', host: '', reason: 'Nenhuma aba aberta.' };
    const url = t.webContents.getURL() || t.url || '';
    const ok = isWebUrl(url);
    return {
      ok,
      id: t.id,
      title: t.title || url,
      url,
      host: hostOf(url) || (url.startsWith('file:') ? 'arquivo local' : ''),
      reason: ok ? '' : 'O injetor só roda em sites (http/https) e arquivos locais, não em páginas internas do navegador.',
    };
  }

  _checkTarget() {
    if (!this.wc) return;
    const t = this.target();
    const key = `${t.id}|${t.url}|${t.title}`;
    if (key === this.targetKey) return;
    const tabChanged = this.targetKey.split('|')[0] !== String(t.id);
    this.targetKey = key;
    this.win.setTitle(t.host ? `JavaScript Injector — ${t.host}` : 'JavaScript Injector');
    this.send('injector:target', t);
    // Trocou de aba: o console passa a acompanhar a aba nova.
    if (tabChanged) {
      this._detach();
      if (t.ok) this._attach(this.targetTab().webContents).catch(() => {});
    }
  }

  async _attach(wc) {
    if (this.attached === wc) return;
    this._detach();
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    this.attached = wc;
    wc.debugger.on('message', this.onMessage);
    wc.debugger.on('detach', this.onDetach);
    await wc.debugger.sendCommand('Runtime.enable');
  }

  _detach() {
    const wc = this.attached;
    this.attached = null;
    if (!wc || wc.isDestroyed()) return;
    wc.debugger.removeListener('message', this.onMessage);
    wc.debugger.removeListener('detach', this.onDetach);
    try {
      if (wc.debugger.isAttached()) wc.debugger.detach();
    } catch { /* ignora */ }
  }

  _onDebuggerMessage(method, params) {
    if (method === 'Runtime.consoleAPICalled') {
      if (params.type === 'endGroup' || params.type === 'clear') return;
      const level = { warning: 'warn', assert: 'error', trace: 'log', dir: 'log', dirxml: 'log', table: 'log', count: 'info', timeEnd: 'info' }[params.type] || params.type;
      this._push({ kind: 'log', level, parts: formatLogArgs(params.args), mine: isMine(params.stackTrace), where: whereOf(params.stackTrace) });
    } else if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails || {};
      const text = d.exception ? formatRemote(d.exception).text : d.text || 'Erro';
      this._push({ kind: 'log', level: 'error', parts: [{ cls: 'err', text: `Erro não tratado: ${text}` }], mine: isMine(d.stackTrace, d.url), where: whereOf(d.stackTrace) || (d.url ? `${d.url.split('/').pop()}:${(d.lineNumber || 0) + 1}` : '') });
    } else if (method === 'Runtime.executionContextsCleared') {
      this._push({ kind: 'nav' });
    }
  }

  // Junta as mensagens e manda em lotes: um site que escreve muito no console não trava a janelinha.
  _push(msg) {
    if (this.queue.length >= MAX_LOGS_PER_FLUSH) {
      this.dropped++;
    } else {
      this.queue.push(msg);
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const batch = this.queue;
        if (this.dropped) batch.push({ kind: 'log', level: 'info', parts: [{ cls: 'plain', text: `${this.dropped} mensagens do console omitidas (muitas de uma vez)` }], mine: false });
        this.queue = [];
        this.dropped = 0;
        this.send('injector:logs', batch);
      }, 80);
    }
  }

  async run(code) {
    const tab = this.targetTab();
    const t = this.target();
    if (!tab || !t.ok) return { ok: false, error: t.reason };
    const wc = tab.webContents;
    try {
      await this._attach(wc);
    } catch (err) {
      // Outro depurador ocupando a aba: roda direto na página, sem a prévia de objetos.
      return this._runPlain(wc, code, err);
    }
    try {
      const r = await wc.debugger.sendCommand('Runtime.evaluate', {
        expression: `${code}\n//# sourceURL=${SOURCE_URL}`,
        replMode: true,
        awaitPromise: true,
        userGesture: true,
        generatePreview: true,
        includeCommandLineAPI: true,
        allowUnsafeEvalBlockedByCSP: true,
        objectGroup: 'pulse-injector',
      });
      wc.debugger.sendCommand('Runtime.releaseObjectGroup', { objectGroup: 'pulse-injector' }).catch(() => {});
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        const text = d.exception ? formatRemote(d.exception).text : d.text;
        return { ok: false, error: `Uncaught ${text}` };
      }
      return { ok: true, value: formatRemote(r.result) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  async _runPlain(wc, code) {
    try {
      const v = await wc.executeJavaScript(code, true);
      let text;
      try {
        text = v === undefined ? 'undefined' : JSON.stringify(v);
      } catch {
        text = String(v);
      }
      return { ok: true, value: { cls: typeof v === 'string' ? 'str' : 'obj', text: clip(text ?? String(v)) } };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  _dispose() {
    clearInterval(this.poll);
    clearTimeout(this.flushTimer);
    this._detach();
    this.injector.panels.delete(this.owner);
    this.win = null;
  }
}

// ---------------------------------------------------------------- Gerenciador
class Injector {
  constructor() {
    this.store = new JsonStore('injector', { scripts: [], history: [], draft: '' });
    this.panels = new Map(); // PulseWindow -> Panel
  }

  open(owner) {
    if (!owner || owner.win.isDestroyed()) return;
    const existing = this.panels.get(owner);
    if (existing && existing.win && !existing.win.isDestroyed()) {
      existing.focus();
      return;
    }
    this.panels.set(owner, new Panel(this, owner));
  }

  _panelFor(sender) {
    for (const p of this.panels.values()) if (p.wc === sender) return p;
    return null;
  }

  scripts() {
    return this.store.data.scripts;
  }

  _publicScripts() {
    return this.scripts().map((s) => ({ ...s }));
  }

  _broadcastScripts() {
    const list = this._publicScripts();
    for (const p of this.panels.values()) p.send('injector:scripts', list);
  }

  saveScript(input) {
    const name = String(input?.name || '').trim().slice(0, 80) || 'Sem nome';
    const code = String(input?.code || '').slice(0, MAX_CODE);
    const sites = parseSites(input?.sites).join(', ');
    const auto = !!input?.auto && !!sites;
    const list = this.scripts();
    let s = input?.id ? list.find((x) => x.id === input.id) : null;
    if (!s) {
      if (list.length >= MAX_SCRIPTS) throw new Error(`Limite de ${MAX_SCRIPTS} scripts salvos.`);
      s = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: Date.now() };
      list.push(s);
    }
    Object.assign(s, { name, code, sites, auto, updatedAt: Date.now() });
    this.store.save();
    this._broadcastScripts();
    return { ...s };
  }

  setAuto(id, auto) {
    const s = this.scripts().find((x) => x.id === id);
    if (!s) return;
    s.auto = !!auto && !!s.sites;
    this.store.save();
    this._broadcastScripts();
  }

  deleteScript(id) {
    this.store.data.scripts = this.scripts().filter((s) => s.id !== id);
    this.store.save();
    this._broadcastScripts();
  }

  _remember(code) {
    const h = this.store.data.history.filter((c) => c !== code);
    h.push(code.slice(0, 20000));
    this.store.data.history = h.slice(-MAX_HISTORY);
    this.store.save();
  }

  // Scripts automáticos: rodam quando o DOM da página fica pronto, no mundo da própria página.
  onDomReady(tab) {
    const wc = tab.webContents;
    if (!wc || wc.isDestroyed()) return;
    const auto = this.scripts().filter((s) => s.auto && s.code);
    if (!auto.length) return;
    const url = wc.getURL();
    if (!/^https?:/i.test(url)) return;
    const host = hostOf(url);
    for (const s of auto) {
      if (!siteMatches(s.sites, host)) continue;
      const file = `pulse-injector-${s.name.replace(/[^\w.-]+/g, '_').slice(0, 40)}.js`;
      wc.executeJavaScript(`${s.code}\n//# sourceURL=${file}`, true)
        .then(() => this._notify(tab, { kind: 'auto', name: s.name, host }))
        .catch((err) => this._notify(tab, { kind: 'auto', name: s.name, host, error: err.message || String(err) }));
    }
  }

  _notify(tab, msg) {
    const p = this.panels.get(tab.window);
    if (p && p.targetTab() === tab) p._push(msg);
  }

  register() {
    const handle = (channel, fn) => {
      ipcMain.handle(channel, (event, ...args) => {
        const panel = this._panelFor(event.sender);
        if (!panel) throw new Error('Acesso negado');
        return fn(panel, ...args);
      });
    };
    handle('injector:init', (panel) => ({
      target: panel.target(),
      scripts: this._publicScripts(),
      history: [...this.store.data.history],
      draft: this.store.data.draft || '',
      accent: ctx.settings.get('accentColor'),
      incognito: !!panel.owner.incognito,
    }));
    handle('injector:run', async (panel, code) => {
      if (typeof code !== 'string' || !code.trim()) return { ok: false, error: 'Nada para rodar.' };
      if (code.length > MAX_CODE) return { ok: false, error: 'Código grande demais.' };
      this._remember(code);
      return panel.run(code);
    });
    handle('injector:draft', (_panel, code) => {
      if (typeof code !== 'string') return;
      this.store.data.draft = code.slice(0, MAX_CODE);
      this.store.save();
    });
    handle('injector:save-script', (_panel, input) => this.saveScript(input));
    handle('injector:set-auto', (_panel, id, auto) => this.setAuto(String(id), auto));
    handle('injector:delete-script', (_panel, id) => this.deleteScript(String(id)));
    handle('injector:reload-target', (panel) => {
      const t = panel.targetTab();
      if (t && panel.target().ok) t.reload();
    });
    handle('injector:clear-history', () => {
      this.store.data.history = [];
      this.store.save();
    });
    // A janelinha usa uma sessão própria, sem rede: só carrega os próprios arquivos.
    session.fromPartition(PARTITION).webRequest.onBeforeRequest((details, cb) => cb({ cancel: !/^(file|devtools):/i.test(details.url) }));
  }

  flush() {
    this.store.flush();
  }
}

module.exports = { Injector, siteMatches, parseSites, formatRemote, formatLogArgs };
