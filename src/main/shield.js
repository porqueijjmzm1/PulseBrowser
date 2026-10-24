'use strict';
// Pulse Shield: bloqueio de anúncios, rastreadores e mineradores por domínio.
const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');
const ctx = require('./context');
const { JsonStore } = require('./store');
const BUILTIN = require('./blocklist');

const EXTENDED_URL = 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=nohtml&showintro=0&mimetype=plaintext';
const EXTENDED_MAX_AGE = 7 * 24 * 3600 * 1000;

// CSS cosmético conservador para esconder espaços de anúncio vazios.
const COSMETIC_CSS = `
ins.adsbygoogle, .adsbygoogle, [id^="div-gpt-ad"], [id^="google_ads_iframe"], [id^="google_ads_frame"],
iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"], iframe[src*="amazon-adsystem.com"],
div[id^="taboola-"], .trc_rbox_container, .OUTBRAIN, [data-widget-id^="outbrain"], .ob-widget,
amp-ad, amp-embed[type="taboola"] { display: none !important; }
`;

// Acelera anúncios em vídeo do YouTube e clica em "Pular" automaticamente.
const YOUTUBE_SCRIPT = `
(() => {
  if (window.__pulseYt) return; window.__pulseYt = true;
  const tick = () => {
    const player = document.querySelector('.html5-video-player');
    const video = player && player.querySelector('video');
    if (player && video && player.classList.contains('ad-showing')) {
      video.muted = true;
      if (isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration;
      video.playbackRate = 16;
    }
    document.querySelectorAll('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-overlay-close-button')
      .forEach((b) => b.click());
  };
  setInterval(tick, 300);
})();
`;

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

class Shield {
  constructor() {
    this.domains = new Set(BUILTIN);
    this.extended = new Set();
    this.stats = new JsonStore('shield-stats', { total: 0 }, { delay: 5000 });
    this.cacheFile = path.join(app.getPath('userData'), 'shield-extended.txt');
    this.attached = new WeakSet();
    if (ctx.settings.get('shieldExtendedList')) this.loadExtended();
  }

  get total() {
    return this.stats.data.total;
  }

  enabled() {
    return ctx.settings.get('shieldEnabled');
  }

  isAllowlisted(host) {
    if (!host) return false;
    const list = ctx.settings.get('shieldAllowlist');
    return list.some((h) => host === h || host.endsWith(`.${h}`));
  }

  _matches(set, host) {
    let h = host;
    while (h) {
      if (set.has(h)) return true;
      const i = h.indexOf('.');
      if (i < 0) break;
      h = h.slice(i + 1);
    }
    return false;
  }

  isBlockedHost(host) {
    if (!host) return false;
    return this._matches(this.domains, host) || (this.extended.size > 0 && this._matches(this.extended, host));
  }

  async loadExtended(force = false) {
    try {
      let text = null;
      const fresh = fs.existsSync(this.cacheFile) && Date.now() - fs.statSync(this.cacheFile).mtimeMs < EXTENDED_MAX_AGE;
      if (fresh && !force) text = fs.readFileSync(this.cacheFile, 'utf8');
      if (!text) {
        const res = await net.fetch(EXTENDED_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
        fs.writeFileSync(this.cacheFile, text);
      }
      const set = new Set();
      for (const line of text.split(/\r?\n/)) {
        const d = line.trim().toLowerCase();
        if (d && !d.startsWith('#') && /^[a-z0-9.-]+$/.test(d)) set.add(d);
      }
      this.extended = set;
      return set.size;
    } catch (err) {
      console.warn('[shield] lista ampliada indisponível:', err.message);
      if (fs.existsSync(this.cacheFile) && this.extended.size === 0) {
        try {
          const text = fs.readFileSync(this.cacheFile, 'utf8');
          this.extended = new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
        } catch { /* ignora */ }
      }
      return this.extended.size;
    }
  }

  unloadExtended() {
    this.extended = new Set();
  }

  attach(ses, findTab) {
    if (this.attached.has(ses)) return;
    this.attached.add(ses);

    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      if (!this.enabled() || details.resourceType === 'mainFrame') return callback({});
      const reqHost = hostOf(details.url);
      if (!this.isBlockedHost(reqHost)) return callback({});

      const tab = details.webContentsId ? findTab(details.webContentsId) : null;
      const pageHost = hostOf(tab ? tab.url : details.referrer || '');
      // Não bloqueia quando o próprio site visitado está na lista, nem em sites permitidos.
      if (pageHost && (this.isAllowlisted(pageHost) || this.isBlockedHost(pageHost))) return callback({});

      if (tab) tab.onRequestBlocked(reqHost);
      this.stats.data.total += 1;
      this.stats.save();
      callback({ cancel: true });
    });

    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      if (ctx.settings.get('doNotTrack')) {
        details.requestHeaders.DNT = '1';
        details.requestHeaders['Sec-GPC'] = '1';
      }
      callback({ requestHeaders: details.requestHeaders });
    });
  }

  // Chamado no dom-ready de cada aba.
  applyCosmetics(webContents, url) {
    if (!this.enabled()) return;
    const host = hostOf(url);
    if (!host || this.isAllowlisted(host)) return;
    webContents.insertCSS(COSMETIC_CSS, { cssOrigin: 'user' }).catch(() => {});
    if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') {
      webContents.executeJavaScript(YOUTUBE_SCRIPT, false).catch(() => {});
    }
  }
}

module.exports = { Shield, hostOf };
