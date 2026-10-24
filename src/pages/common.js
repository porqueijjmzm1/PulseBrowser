'use strict';
// Utilitários compartilhados pelas páginas internas pulse://.
(() => {
  const { icon, LOGO } = window.PulseIcons;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function fmtBytes(n) {
    if (!n || n < 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toLocaleString('pt-BR', { maximumFractionDigits: n < 10 && i > 0 ? 1 : 0 })} ${u[i]}`;
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function fmtDay(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(Date.now() - 864e5);
    const long = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (dayKey(ts) === dayKey(today.getTime())) return `Hoje — ${long}`;
    if (dayKey(ts) === dayKey(yesterday.getTime())) return `Ontem — ${long}`;
    return long.charAt(0).toUpperCase() + long.slice(1);
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  function colorFor(s) {
    let h = 0;
    for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360} 55% 48%)`;
  }

  // Ícone de site: favicon salvo, senão o /favicon.ico do próprio site, senão uma letra.
  function favicon(url, faviconUrl, size = 20) {
    const box = document.createElement('span');
    box.className = 'fav';
    box.style.width = box.style.height = `${size}px`;
    const host = hostOf(url);
    const letter = () => {
      box.textContent = (host[0] || '?').toUpperCase();
      box.style.background = colorFor(host);
    };
    let candidates = [];
    if (faviconUrl) candidates.push(faviconUrl);
    try {
      const u = new URL(url);
      if (/^https?:$/.test(u.protocol)) candidates.push(`${u.origin}/favicon.ico`);
    } catch { /* ignora */ }
    candidates = [...new Set(candidates)];
    const tryNext = () => {
      const src = candidates.shift();
      if (!src) {
        box.textContent = '';
        letter();
        return;
      }
      const img = new Image();
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.style.width = img.style.height = `${Math.round(size * 0.8)}px`;
      img.onload = () => {
        box.textContent = '';
        box.style.background = 'transparent';
        box.appendChild(img);
      };
      img.onerror = tryNext;
      img.src = src;
    };
    letter();
    tryNext();
    return box;
  }

  let toastTimer = null;
  function toast(msg) {
    let el = $('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    el.classList.remove('leaving');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.add('leaving');
      toastTimer = setTimeout(() => el.remove(), 220);
    }, 2600);
  }

  function applyAccent(color) {
    if (color) document.documentElement.style.setProperty('--accent', color);
  }

  async function init() {
    const ctx = await window.pulse.invoke('internal:context');
    if (ctx.incognito) document.body.classList.add('incognito');
    const settings = await window.pulse.invoke('internal:get-settings');
    applyAccent(settings.accentColor);
    const applyMotion = (st) => document.body.classList.toggle('no-anim', st.animations === false);
    applyMotion(settings);
    // Entrada em cascata do menu lateral e das seções.
    $$('.sidenav, .content').forEach((box) => [...box.children].forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, 8)))));
    window.pulse.on('internal:settings-changed', async () => {
      const s = await window.pulse.invoke('internal:get-settings');
      applyAccent(s.accentColor);
      applyMotion(s);
      document.dispatchEvent(new CustomEvent('pulse-settings', { detail: s }));
    });
    $$('[data-logo]').forEach((el) => {
      el.innerHTML = LOGO;
    });
    $$('[data-icon]').forEach((el) => {
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, Number(el.dataset.size) || 18));
    });
    return { ctx, settings };
  }

  function debounce(fn, ms) {
    let t = null;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }

  window.Pulse = { $, $$, esc, fmtBytes, fmtTime, fmtDay, dayKey, hostOf, colorFor, favicon, toast, init, icon, LOGO, debounce };
})();
