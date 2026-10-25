'use strict';
// Corretor gramatical e ortográfico (no estilo do Grammarly) usando o LanguageTool.
// O texto dos campos é enviado para api.languagetool.org (ou para um servidor próprio, se configurado).
const { ipcMain, net, BrowserWindow, nativeTheme } = require('electron');
const ctx = require('./context');
const { findTabByWebContentsId } = require('./sessions');

const PUBLIC_API = 'https://api.languagetool.org/v2/check';
const MAX_CHARS = 15000; // a API pública aceita até 20 mil caracteres por pedido
const PUBLIC_GAP = 3100; // no máximo 20 pedidos por minuto na API pública
const CACHE_MAX = 600;

const LANGUAGES = [
  { code: 'auto', name: 'Detectar automaticamente' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'pt-PT', name: 'Português (Portugal)' },
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de-DE', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'ca-ES', name: 'Català' },
  { code: 'gl-ES', name: 'Galego' },
  { code: 'pl-PL', name: 'Polski' },
  { code: 'ru-RU', name: 'Русский' },
  { code: 'uk-UA', name: 'Українська' },
  { code: 'sv', name: 'Svenska' },
  { code: 'da-DK', name: 'Dansk' },
  { code: 'ro-RO', name: 'Română' },
  { code: 'sk-SK', name: 'Slovenčina' },
  { code: 'sl-SI', name: 'Slovenščina' },
  { code: 'el-GR', name: 'Ελληνικά' },
  { code: 'ar', name: 'العربية' },
  { code: 'fa', name: 'فارسی' },
  { code: 'ja-JP', name: '日本語' },
  { code: 'zh-CN', name: '中文' },
  { code: 'eo', name: 'Esperanto' },
];
const LANG_NAMES = new Map(LANGUAGES.map((l) => [l.code, l.name]));

const GRAMMAR_KEYS = new Set([
  'grammarEnabled', 'grammarLanguage', 'grammarMotherTongue', 'grammarStyle', 'grammarPicky', 'grammarAutoFix',
  'grammarServer', 'grammarDictionary', 'grammarDisabledSites', 'animations', 'accent', 'theme',
]);

function languageName(code) {
  if (!code) return '';
  if (LANG_NAMES.has(code)) return LANG_NAMES.get(code);
  const base = LANGUAGES.find((l) => l.code.split('-')[0] === code.split('-')[0] && l.code !== 'auto');
  return base ? base.name : code;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Tipo do problema: ortografia, gramática, estilo ou pontuação.
function kindOf(m) {
  const issue = (m.rule?.issueType || '').toLowerCase();
  const cat = (m.rule?.category?.id || '').toUpperCase();
  if (issue === 'misspelling' || cat === 'TYPOS') return 'spelling';
  if (['style', 'locale-violation', 'register'].includes(issue)
    || ['STYLE', 'REDUNDANCY', 'PLAIN_ENGLISH', 'REPETITIONS_STYLE', 'COLLOQUIALISMS', 'GENDER_NEUTRALITY'].includes(cat)) return 'style';
  if (['PUNCTUATION', 'TYPOGRAPHY', 'CASING'].includes(cat) || issue === 'typographical' || issue === 'whitespace') return 'punct';
  return 'grammar';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class Grammar {
  constructor() {
    this.cache = new Map(); // chave do parágrafo -> { matches, lang }
    this.latest = new Map(); // solicitante -> último token
    this.nextSlot = 0;
    this.blockedUntil = 0;
    this.queue = Promise.resolve();
    this.stats = { requests: 0, chars: 0 };
  }

  flush() { /* nada para gravar */ }

  endpoint() {
    const custom = (ctx.settings.get('grammarServer') || '').trim().replace(/\/+$/, '');
    if (!custom) return { url: PUBLIC_API, public: true };
    return { url: /\/v2\/check$/.test(custom) ? custom : `${custom}/v2/check`, public: false };
  }

  config(origin) {
    const host = hostOf(origin);
    const disabledSites = ctx.settings.get('grammarDisabledSites') || [];
    return {
      enabled: !!ctx.settings.get('grammarEnabled'),
      disabled: !!host && disabledSites.some((h) => host === h || host.endsWith(`.${h}`)),
      host,
      language: ctx.settings.get('grammarLanguage'),
      languages: LANGUAGES,
      style: !!ctx.settings.get('grammarStyle'),
      autoFix: !!ctx.settings.get('grammarAutoFix'),
      accent: ctx.settings.accentColor(),
      dark: nativeTheme.shouldUseDarkColors,
      animations: ctx.settings.get('animations'),
      server: this.endpoint().public ? 'LanguageTool' : 'servidor próprio',
    };
  }

  _cacheGet(key) {
    const v = this.cache.get(key);
    if (v) {
      this.cache.delete(key);
      this.cache.set(key, v);
    }
    return v;
  }

  _cacheSet(key, v) {
    this.cache.set(key, v);
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
  }

  clearCache() {
    this.cache.clear();
  }

  // Divide o texto em parágrafos (linhas) com o deslocamento de cada um.
  _paragraphs(text) {
    const out = [];
    let start = 0;
    for (const line of text.split('\n')) {
      if (line.trim()) out.push({ start, text: line });
      start += line.length + 1;
    }
    return out;
  }

  async _request(text, language) {
    const { url, public: isPublic } = this.endpoint();
    const now = Date.now();
    if (now < this.blockedUntil) throw Object.assign(new Error('Limite de verificações atingido. Tente de novo em instantes.'), { code: 'rate' });
    // Fila com intervalo mínimo entre pedidos (limite da API pública).
    const gap = isPublic ? PUBLIC_GAP : 250;
    const wait = Math.max(0, this.nextSlot - now);
    this.nextSlot = Math.max(now, this.nextSlot) + gap;
    if (wait) await sleep(wait);

    const params = new URLSearchParams();
    params.set('text', text);
    params.set('language', language);
    if (language === 'auto') {
      params.set('preferredVariants', 'pt-BR,en-US,de-DE,ca-ES');
      const mother = ctx.settings.get('grammarMotherTongue');
      if (mother) params.set('motherTongue', mother);
    }
    if (ctx.settings.get('grammarPicky')) params.set('level', 'picky');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await net.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: params.toString(),
        signal: controller.signal,
      });
      if (res.status === 429) {
        this.blockedUntil = Date.now() + 60_000;
        throw Object.assign(new Error('Limite de verificações atingido. Tente de novo em um minuto.'), { code: 'rate' });
      }
      if (!res.ok) throw Object.assign(new Error(`O serviço de correção respondeu com erro ${res.status}.`), { code: 'http' });
      this.stats.requests++;
      this.stats.chars += text.length;
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') throw Object.assign(new Error('O serviço de correção demorou demais para responder.'), { code: 'timeout' });
      if (!err.code) err.code = 'offline';
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  _filter(matches, text) {
    const dict = new Set((ctx.settings.get('grammarDictionary') || []).map((w) => w.toLowerCase()));
    const style = ctx.settings.get('grammarStyle');
    return matches.filter((m) => {
      if (!style && m.kind === 'style') return false;
      if (m.kind === 'spelling') {
        const word = text.slice(m.offset, m.offset + m.length).toLowerCase();
        if (dict.has(word)) return false;
      }
      return true;
    });
  }

  // Verifica o texto inteiro, reaproveitando os parágrafos já verificados.
  async check(text, requester, token) {
    if (requester) this.latest.set(requester, token);
    const language = ctx.settings.get('grammarLanguage') || 'auto';
    const picky = ctx.settings.get('grammarPicky') ? 'p' : 'd';
    const prefix = `${this.endpoint().url}|${language}|${picky}|`;
    const paragraphs = this._paragraphs(String(text).replace(/ /g, ' '));
    const results = [];
    const missing = [];
    let budget = MAX_CHARS;
    let truncated = false;
    for (const p of paragraphs) {
      const hit = this._cacheGet(prefix + p.text);
      if (hit) results.push({ p, hit });
      else if (p.text.length + 2 <= budget) {
        missing.push(p);
        budget -= p.text.length + 2;
      } else truncated = true;
    }

    let detected = null;
    if (missing.length) {
      // Espera a vez na fila; se o campo mudou enquanto isso, desiste deste pedido.
      const run = async () => {
        if (requester && this.latest.get(requester) !== token) return { stale: true };
        const joined = missing.map((p) => p.text).join('\n\n');
        const data = await this._request(joined, language);
        if (data?.language?.detectedLanguage?.code) detected = data.language.detectedLanguage.code;
        else if (data?.language?.code) detected = data.language.code;
        // Separa os resultados de volta em cada parágrafo.
        const starts = [];
        let pos = 0;
        for (const p of missing) {
          starts.push(pos);
          pos += p.text.length + 2;
        }
        const per = missing.map(() => []);
        for (const m of data?.matches || []) {
          let i = starts.length - 1;
          while (i > 0 && starts[i] > m.offset) i--;
          const rel = m.offset - starts[i];
          if (rel < 0 || rel + m.length > missing[i].text.length) continue;
          per[i].push({
            offset: rel,
            length: m.length,
            message: String(m.message || '').slice(0, 400),
            short: String(m.shortMessage || '').slice(0, 120),
            replacements: (m.replacements || []).slice(0, 6).map((r) => String(r.value)),
            kind: kindOf(m),
            rule: m.rule?.id || '',
            category: m.rule?.category?.name || '',
          });
        }
        missing.forEach((p, i) => {
          const hit = { matches: per[i], lang: detected };
          this._cacheSet(prefix + p.text, hit);
          results.push({ p, hit });
        });
        return null;
      };
      const job = this.queue.then(run, run);
      this.queue = job.catch(() => {});
      const r = await job;
      if (r && r.stale) return { stale: true };
    }

    const matches = [];
    for (const { p, hit } of results) {
      if (!detected && hit.lang) detected = hit.lang;
      for (const m of hit.matches) matches.push({ ...m, offset: m.offset + p.start });
    }
    matches.sort((a, b) => a.offset - b.offset);
    const code = language === 'auto' ? detected || '' : language;
    return {
      matches: this._filter(matches, text),
      language: { code, name: languageName(code), auto: language === 'auto' },
      truncated,
    };
  }

  // Avisa as páginas abertas que as configurações do corretor mudaram.
  broadcast() {
    // Vai para todos os frames (o corretor também roda em iframes).
    const send = (wc) => {
      if (!wc || wc.isDestroyed()) return;
      let frames = [];
      try {
        frames = wc.mainFrame.framesInSubtree;
      } catch { /* ignora */ }
      for (const f of frames) {
        try {
          if (/^https?:/.test(f.origin || f.url || '')) f.send('grammar:config-changed');
        } catch { /* frame já foi embora */ }
      }
    };
    for (const w of ctx.windows) for (const t of w.tabs) send(t.webContents);
    for (const bw of BrowserWindow.getAllWindows()) if (!ctx.windows.some((w) => w.win === bw)) send(bw.webContents);
  }

  register() {
    // Páginas da web (o frame principal ou iframes). A lista de sites desativados vale pelo site da aba.
    const contentOnly = (event) => {
      const frame = event.senderFrame;
      if (!frame) return null;
      const origin = frame.origin || '';
      if (!/^https?:\/\//.test(origin)) return null;
      let top = origin;
      try {
        const t = frame.top;
        if (t && t !== frame && /^https?:\/\//.test(t.origin || '')) top = t.origin;
      } catch { /* ignora */ }
      return { origin: top, frameOrigin: origin, wc: event.sender, frameKey: `${frame.processId}:${frame.routingId}`, isTop: !frame.parent };
    };

    ctx.settings.on('changed', (key) => {
      if (!GRAMMAR_KEYS.has(key)) return;
      if (['grammarLanguage', 'grammarPicky', 'grammarServer', 'grammarMotherTongue'].includes(key)) this.clearCache();
      this.broadcast();
    });
    try {
      nativeTheme.on('updated', () => this.broadcast());
    } catch { /* ignora */ }

    ipcMain.handle('grammar:config', (event) => {
      const c = contentOnly(event);
      return c ? this.config(c.origin) : null;
    });

    ipcMain.handle('grammar:check', async (event, payload) => {
      const c = contentOnly(event);
      if (!c || !ctx.settings.get('grammarEnabled')) return { matches: [], disabled: true };
      const text = typeof payload?.text === 'string' ? payload.text.slice(0, 60000) : '';
      if (!text.trim()) return { matches: [], language: null };
      const requester = `${c.wc.id}:${c.frameKey}:${String(payload?.field || '')}`;
      try {
        return await this.check(text, requester, payload?.token);
      } catch (err) {
        return { matches: [], error: err.message, code: err.code || 'error' };
      }
    });

    ipcMain.on('grammar:set-language', (event, code) => {
      if (!contentOnly(event) || typeof code !== 'string' || !LANG_NAMES.has(code)) return;
      ctx.settings.set('grammarLanguage', code);
    });

    ipcMain.on('grammar:add-word', (event, word) => {
      if (!contentOnly(event) || typeof word !== 'string') return;
      const w = word.trim().slice(0, 60);
      if (!w || /\s/.test(w)) return;
      const list = ctx.settings.get('grammarDictionary') || [];
      if (list.some((x) => x.toLowerCase() === w.toLowerCase())) return;
      ctx.settings.set('grammarDictionary', [...list, w].slice(-5000));
    });

    ipcMain.on('grammar:disable-site', (event) => {
      const c = contentOnly(event);
      if (!c) return;
      const host = hostOf(c.origin).replace(/^www\./, '');
      const list = ctx.settings.get('grammarDisabledSites') || [];
      if (host && !list.includes(host)) ctx.settings.set('grammarDisabledSites', [...list, host]);
    });

    // Google Docs desenha o texto num canvas: para trocar uma palavra, seleciona com clique e
    // shift+clique de verdade nas posições calculadas pela página e digita a sugestão.
    ipcMain.handle('grammar:docs-replace', async (event, p) => {
      const c = contentOnly(event);
      if (!c || !c.isTop || hostOf(c.frameOrigin) !== 'docs.google.com' || !ctx.settings.get('grammarEnabled')) return false;
      const nums = [p?.x1, p?.y1, p?.x2, p?.y2];
      if (!nums.every((n) => Number.isFinite(n) && n >= 0 && n < 20000)) return false;
      const text = typeof p.text === 'string' ? p.text.slice(0, 500) : '';
      const wc = c.wc;
      if (wc.isDestroyed()) return false;
      const z = typeof wc.getZoomFactor === 'function' ? wc.getZoomFactor() || 1 : 1;
      const at = (x, y) => ({ x: Math.round(x * z), y: Math.round(y * z) });
      const a = at(p.x1, p.y1);
      const b = at(p.x2, p.y2);
      const send = (ev) => {
        if (!wc.isDestroyed()) wc.sendInputEvent(ev);
      };
      try {
        wc.focus();
        send({ type: 'mouseMove', ...a });
        send({ type: 'mouseDown', ...a, button: 'left', clickCount: 1 });
        send({ type: 'mouseUp', ...a, button: 'left', clickCount: 1 });
        await sleep(70);
        send({ type: 'mouseMove', ...b, modifiers: ['shift'] });
        send({ type: 'mouseDown', ...b, button: 'left', clickCount: 1, modifiers: ['shift'] });
        send({ type: 'mouseUp', ...b, button: 'left', clickCount: 1, modifiers: ['shift'] });
        await sleep(90);
        if (wc.isDestroyed()) return false;
        if (text) wc.insertText(text);
        else {
          send({ type: 'keyDown', keyCode: 'Delete' });
          send({ type: 'keyUp', keyCode: 'Delete' });
        }
        return true;
      } catch {
        return false;
      }
    });

    ipcMain.on('grammar:open-settings', (event) => {
      const c = contentOnly(event);
      if (!c) return;
      const tab = findTabByWebContentsId(c.wc.id);
      const w = tab?.window || ctx.lastFocusedWindow;
      w?.command('settings', 'grammar');
    });
  }
}

module.exports = { Grammar, LANGUAGES, kindOf, languageName };
