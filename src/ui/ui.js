'use strict';
// Interface do PulseBrowser: abas, barra de ferramentas, barra de endereço, favoritos e localizar.
(() => {
  const { icon, LOGO } = window.PulseIcons;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const INCOGNITO = params.get('incognito') === '1';

  document.body.classList.add(`platform-${window.pulse.platform}`);
  if (INCOGNITO) document.body.classList.add('incognito');

  const state = {
    tabs: [],
    activeId: null,
    settings: {},
    bookmarks: { bar: [], otherCount: 0 },
    downloads: null,
  };
  let active = null;
  let currentPopup = null;

  // ---------------------------------------------------------------- Ícones fixos
  $('#new-tab-btn').innerHTML = icon('plus', 18);
  $('#back-btn').innerHTML = icon('back', 18);
  $('#forward-btn').innerHTML = icon('forward', 18);
  $('#reload-btn').innerHTML = icon('reload', 17);
  $('#home-btn').innerHTML = icon('home', 18);
  $('#menu-btn').innerHTML = icon('more', 18);
  $('#star-btn').innerHTML = icon('star', 16);
  $('#downloads-btn .dl-icon').innerHTML = icon('download', 18);
  $('#shield-btn').insertAdjacentHTML('afterbegin', '<span class="sh-icon"></span>');
  $('#incognito-badge .inc-icon').innerHTML = icon('incognito', 16);
  $('#find-prev').innerHTML = icon('chevronUp', 16);
  $('#find-next').innerHTML = icon('chevronDown', 16);
  $('#find-close').innerHTML = icon('x', 16);
  $('.find-icon').innerHTML = icon('search', 15);

  // ---------------------------------------------------------------- Utilidades
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  function colorFor(s) {
    let h = 0;
    for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360} 55% 48%)`;
  }

  function letterEl(label) {
    const s = document.createElement('span');
    s.className = 'bm-letter';
    const clean = String(label || '?').replace(/^https?:\/\/(www\.)?/, '').trim();
    s.textContent = (clean[0] || '?').toUpperCase();
    s.style.background = colorFor(clean);
    return s;
  }

  function faviconImg(src, fallback) {
    const img = new Image(16, 16);
    img.alt = '';
    img.draggable = false;
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
    img.src = src;
    return img;
  }

  // URL exibida quando a barra de endereço não está em foco.
  function displayUrl(t) {
    if (!t || t.newTab) return '';
    const url = t.url || '';
    if (/^https?:\/\//i.test(url)) {
      try {
        const u = new URL(url);
        let s = u.host.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
        try {
          s = decodeURI(s);
        } catch { /* mantém */ }
        return s;
      } catch {
        return url;
      }
    }
    return url;
  }

  function allowlisted(host) {
    const list = state.settings.shieldAllowlist || [];
    return !!host && list.some((h) => host === h || host.endsWith(`.${h}`));
  }

  // ---------------------------------------------------------------- Métricas para o processo principal
  const chromeEl = $('#chrome');
  let metricsRaf = 0;
  function sendMetrics() {
    cancelAnimationFrame(metricsRaf);
    metricsRaf = requestAnimationFrame(() => {
      const fullscreen = document.body.classList.contains('html-fullscreen');
      window.pulse.send('ui:metrics', { height: fullscreen ? 0 : chromeEl.offsetHeight, omnibox: rectOf($('#omnibox')) });
    });
  }
  new ResizeObserver(sendMetrics).observe(chromeEl);
  window.addEventListener('resize', () => {
    sendMetrics();
    updateNarrowTabs();
    layoutBookmarksOverflow();
  });

  function updateCaptionSpacer() {
    const wco = navigator.windowControlsOverlay;
    if (!wco || !wco.visible) return;
    const r = wco.getTitlebarAreaRect();
    const w = window.innerWidth - (r.x + r.width);
    if (w > 0) $('#caption-spacer').style.width = `${Math.round(w + 4)}px`;
  }
  navigator.windowControlsOverlay?.addEventListener('geometrychange', updateCaptionSpacer);
  updateCaptionSpacer();

  // ---------------------------------------------------------------- Abas
  const tabsEl = $('#tabs');
  let drag = null;
  let pendingRender = false;

  function tabIconKey(t) {
    if (t.loading && !t.discarded) return 'loading';
    if (t.crashed) return 'crash';
    if (t.internal) return 'internal';
    if (t.favicon) return `fav:${t.favicon}`;
    return 'globe';
  }

  function renderTabIcon(box, t, key) {
    box.textContent = '';
    if (key === 'loading') {
      box.innerHTML = '<div class="spinner"></div>';
    } else if (key === 'crash') {
      box.innerHTML = icon('frown', 16);
    } else if (key === 'internal') {
      box.innerHTML = `<span class="logo">${LOGO}</span>`;
    } else if (key.startsWith('fav:')) {
      box.appendChild(faviconImg(t.favicon, () => {
        const s = document.createElement('span');
        s.innerHTML = icon('globe', 15);
        return s.firstChild;
      }));
    } else {
      box.innerHTML = icon('globe', 15);
    }
  }

  function createTabEl(t) {
    const el = document.createElement('div');
    el.className = 'tab entering';
    el.dataset.id = String(t.id);
    el.setAttribute('role', 'tab');
    el.innerHTML = `<div class="tab-icon"></div><span class="tab-title"></span>
      <button class="tab-audio" hidden></button>
      <button class="tab-close" title="Fechar aba (Ctrl+W)">${icon('x', 14)}</button>`;
    el.addEventListener('animationend', () => el.classList.remove('entering'), { once: true });
    bindTab(el);
    return el;
  }

  function updateTabEl(el, t, isActive) {
    el.classList.toggle('active', isActive);
    el.classList.toggle('pinned', !!t.pinned);
    el.classList.toggle('crashed', !!t.crashed);
    el.classList.toggle('discarded', !!t.discarded);
    el.setAttribute('aria-selected', String(isActive));
    const title = el.querySelector('.tab-title');
    if (title.textContent !== t.title) title.textContent = t.title;
    el.title = t.newTab ? t.title : `${t.title}\n${t.url}${t.discarded ? '\n(Em espera para economizar memória)' : ''}`;
    const key = tabIconKey(t);
    const box = el.querySelector('.tab-icon');
    if (el.dataset.icon !== key) {
      el.dataset.icon = key;
      renderTabIcon(box, t, key);
    }
    const audio = el.querySelector('.tab-audio');
    const showAudio = t.audible || t.muted;
    audio.hidden = !showAudio;
    const audioKey = t.muted ? 'muted' : 'on';
    if (showAudio && audio.dataset.k !== audioKey) {
      audio.dataset.k = audioKey;
      audio.innerHTML = icon(t.muted ? 'volumeX' : 'volume', 14);
      audio.title = t.muted ? 'Ativar som da aba' : 'Desativar som da aba';
    }
  }

  function renderTabs() {
    if (drag && drag.active) {
      pendingRender = true;
      return;
    }
    const existing = new Map();
    for (const el of tabsEl.children) existing.set(Number(el.dataset.id), el);
    state.tabs.forEach((t, i) => {
      let el = existing.get(t.id);
      if (!el) el = createTabEl(t);
      existing.delete(t.id);
      updateTabEl(el, t, t.id === state.activeId);
      if (tabsEl.children[i] !== el) tabsEl.insertBefore(el, tabsEl.children[i] || null);
    });
    for (const el of existing.values()) el.remove();
    requestAnimationFrame(() => {
      updateNarrowTabs();
      const act = tabsEl.querySelector('.tab.active');
      if (act) {
        const l = act.offsetLeft;
        const r = l + act.offsetWidth;
        if (l < tabsEl.scrollLeft) tabsEl.scrollLeft = l - 10;
        else if (r > tabsEl.scrollLeft + tabsEl.clientWidth) tabsEl.scrollLeft = r - tabsEl.clientWidth + 10;
      }
    });
  }

  function updateNarrowTabs() {
    for (const el of tabsEl.children) {
      el.classList.toggle('narrow', !el.classList.contains('pinned') && el.offsetWidth < 76);
    }
  }

  function bindTab(el) {
    const id = () => Number(el.dataset.id);
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        return;
      }
      if (e.button !== 0 || e.target.closest('.tab-close, .tab-audio')) return;
      window.pulse.send('ui:activate-tab', id());
      drag = { el, id: id(), startX: e.clientX, active: false };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.el !== el) return;
      const dx = e.clientX - drag.startX;
      if (!drag.active && Math.abs(dx) < 6) return;
      drag.active = true;
      el.classList.add('dragging');
      const pinned = el.classList.contains('pinned');
      const center = el.offsetLeft + dx + el.offsetWidth / 2;
      const next = el.nextElementSibling;
      const prev = el.previousElementSibling;
      if (next && next.classList.contains('pinned') === pinned && center > next.offsetLeft + next.offsetWidth / 2) {
        const before = el.offsetLeft;
        tabsEl.insertBefore(next, el);
        drag.startX += el.offsetLeft - before;
      } else if (prev && prev.classList.contains('pinned') === pinned && center < prev.offsetLeft + prev.offsetWidth / 2) {
        const before = el.offsetLeft;
        tabsEl.insertBefore(el, prev);
        drag.startX += el.offsetLeft - before;
      }
      el.style.transform = `translateX(${e.clientX - drag.startX}px)`;
    });
    const endDrag = () => {
      if (!drag || drag.el !== el) return;
      const wasActive = drag.active;
      const tabId = drag.id;
      drag = null;
      el.classList.remove('dragging');
      el.style.transform = '';
      if (wasActive) {
        const index = [...tabsEl.children].indexOf(el);
        window.pulse.send('ui:move-tab', { id: tabId, index });
      }
      if (pendingRender) {
        pendingRender = false;
        renderTabs();
      }
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        window.pulse.send('ui:close-tab', id());
      }
    });
    el.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      window.pulse.send('ui:close-tab', id());
    });
    el.querySelector('.tab-audio').addEventListener('click', (e) => {
      e.stopPropagation();
      window.pulse.send('ui:toggle-mute', id());
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.pulse.send('ui:tab-menu', id());
    });
  }

  tabsEl.addEventListener('wheel', (e) => {
    tabsEl.scrollLeft += e.deltaY || e.deltaX;
  }, { passive: true });

  // Arrastar um link para a barra de abas abre uma nova aba.
  for (const target of [tabsEl, $('.drag-fill')]) {
    target.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain')) e.preventDefault();
    });
    target.addEventListener('drop', (e) => {
      e.preventDefault();
      const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
      if (url) window.pulse.send('ui:navigate', { text: url, disposition: 'new-tab' });
    });
  }

  $('#new-tab-btn').addEventListener('click', () => window.pulse.send('ui:new-tab'));

  // ---------------------------------------------------------------- Barra de ferramentas
  const backBtn = $('#back-btn');
  const fwdBtn = $('#forward-btn');
  const reloadBtn = $('#reload-btn');
  const siteInfo = $('#site-info');
  const zoomBadge = $('#zoom-badge');
  const starBtn = $('#star-btn');
  const shieldBtn = $('#shield-btn');
  const dlBtn = $('#downloads-btn');
  const menuBtn = $('#menu-btn');
  const input = $('#url-input');
  const omni = $('#omnibox');

  let reloadIsStop = null;
  let siteKey = '';
  let shieldKey = '';

  function renderToolbar() {
    const t = active;
    backBtn.disabled = !t || !t.canGoBack;
    fwdBtn.disabled = !t || !t.canGoForward;
    const loading = !!(t && t.loading);
    if (reloadIsStop !== loading) {
      reloadIsStop = loading;
      reloadBtn.innerHTML = icon(loading ? 'x' : 'reload', loading ? 18 : 17);
      reloadBtn.title = loading ? 'Parar carregamento (Esc)' : 'Recarregar (Ctrl+R)';
    }

    const sec = t ? t.security : 'neutral';
    const key = `${sec}|${t && t.newTab}`;
    if (key !== siteKey) {
      siteKey = key;
      siteInfo.className = sec;
      const ic = siteInfo.querySelector('.si-icon');
      const label = siteInfo.querySelector('.si-label');
      label.textContent = '';
      if (sec === 'secure') {
        ic.innerHTML = icon('lock', 15);
        siteInfo.title = 'A conexão é segura';
      } else if (sec === 'insecure') {
        ic.innerHTML = icon('alert', 15);
        label.textContent = 'Não seguro';
        siteInfo.title = 'A conexão com este site não é segura';
      } else if (sec === 'dangerous') {
        ic.innerHTML = icon('alert', 15);
        label.textContent = 'Não seguro';
        siteInfo.title = 'O certificado deste site não é confiável';
      } else if (sec === 'internal') {
        ic.innerHTML = `<span class="logo">${LOGO}</span>`;
        siteInfo.title = 'Página do PulseBrowser';
      } else if (sec === 'file') {
        ic.innerHTML = icon('fileText', 15);
        label.textContent = 'Arquivo';
        siteInfo.title = 'Arquivo local';
      } else if (sec === 'extension') {
        ic.innerHTML = icon('puzzle', 15);
        siteInfo.title = 'Página de extensão';
      } else {
        ic.innerHTML = icon(t && t.newTab ? 'search' : 'info', 15);
        siteInfo.title = 'Informações do site';
      }
    }

    if (!omniFocused && !omniDirty) {
      const v = displayUrl(t);
      if (input.value !== v) input.value = v;
    }

    zoomBadge.hidden = !t || t.zoom === 100;
    if (t) zoomBadge.textContent = `${t.zoom}%`;

    const bookmarkable = t && /^(https?|file|ftp):/i.test(t.url);
    starBtn.hidden = !bookmarkable;
    starBtn.classList.toggle('on', !!(t && t.bookmarked));
    starBtn.title = t && t.bookmarked ? 'Editar favorito (Ctrl+D)' : 'Adicionar aos favoritos (Ctrl+D)';

    const host = t ? hostOf(t.url) : '';
    const shieldOn = state.settings.shieldEnabled !== false && !allowlisted(host);
    const blocked = t && shieldOn ? t.blocked : 0;
    const sk = `${shieldOn}|${blocked}`;
    if (sk !== shieldKey) {
      shieldKey = sk;
      shieldBtn.querySelector('.sh-icon').innerHTML = icon(shieldOn ? 'shieldCheck' : 'shieldOff', 18);
      shieldBtn.classList.toggle('on', shieldOn && blocked > 0);
      shieldBtn.classList.toggle('off', !shieldOn);
      const badge = shieldBtn.querySelector('.badge');
      badge.hidden = !blocked;
      badge.textContent = blocked > 99 ? '99+' : String(blocked);
      shieldBtn.title = shieldOn
        ? `Pulse Shield: ${blocked} anúncio(s) e rastreador(es) bloqueado(s) nesta página`
        : 'Pulse Shield desativado para este site';
    }
  }

  backBtn.addEventListener('click', () => window.pulse.send('ui:command', { cmd: 'back' }));
  fwdBtn.addEventListener('click', () => window.pulse.send('ui:command', { cmd: 'forward' }));
  for (const [btn, dir] of [[backBtn, -1], [fwdBtn, 1]]) {
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.pulse.send('ui:backforward-menu', dir);
    });
    let timer = null;
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      timer = setTimeout(() => window.pulse.send('ui:backforward-menu', dir), 550);
    });
    for (const ev of ['pointerup', 'pointerleave']) btn.addEventListener(ev, () => clearTimeout(timer));
  }
  reloadBtn.addEventListener('click', (e) => {
    if (active && active.loading) window.pulse.send('ui:command', { cmd: 'stop' });
    else window.pulse.send('ui:command', { cmd: e.shiftKey || e.ctrlKey ? 'hard-reload' : 'reload' });
  });
  $('#home-btn').addEventListener('click', () => window.pulse.send('ui:command', { cmd: 'home' }));

  // ---------------------------------------------------------------- Pop-ups (sobreposição)
  const POPUP_BUTTONS = {
    menu: '#menu-btn',
    downloads: '#downloads-btn',
    shield: '#shield-btn',
    pageinfo: '#site-info',
    bookmark: '#star-btn',
    zoom: '#zoom-badge',
  };

  function setPopupState(type) {
    currentPopup = type;
    for (const [t, sel] of Object.entries(POPUP_BUTTONS)) $(sel).classList.toggle('open', t === type);
  }

  function togglePopup(type, el, extra = {}) {
    if (currentPopup === type) {
      window.pulse.send('ui:popup-hide');
      setPopupState(null);
      return;
    }
    if (currentPopup === 'suggestions') closeSuggestions();
    setPopupState(type);
    window.pulse.send('ui:popup-show', { type, anchor: rectOf(el), ...extra });
  }

  document.addEventListener('mousedown', (e) => {
    if (!currentPopup) return;
    if (currentPopup === 'suggestions' && e.target.closest('#omnibox')) return;
    const sel = POPUP_BUTTONS[currentPopup];
    if (sel && e.target.closest(sel)) return;
    window.pulse.send('ui:popup-hide');
    setPopupState(null);
  }, true);

  siteInfo.addEventListener('click', () => {
    if (active && active.newTab) {
      input.focus();
      return;
    }
    togglePopup('pageinfo', siteInfo);
  });
  zoomBadge.addEventListener('click', () => togglePopup('zoom', zoomBadge, { align: 'right' }));
  starBtn.addEventListener('click', () => togglePopup('bookmark', starBtn, { align: 'right' }));
  shieldBtn.addEventListener('click', () => togglePopup('shield', shieldBtn, { align: 'right' }));
  dlBtn.addEventListener('click', () => togglePopup('downloads', dlBtn, { align: 'right' }));
  menuBtn.addEventListener('click', () => togglePopup('menu', menuBtn, { align: 'right' }));

  // ---------------------------------------------------------------- Barra de endereço
  let omniFocused = false;
  let omniDirty = false;
  let typed = '';
  let inlineText = null;
  let localItems = [];
  let remoteItems = [];
  let suggestions = [];
  let selected = 0;
  let suggestSeq = 0;

  input.addEventListener('mousedown', (e) => {
    if (!omniFocused && e.button === 0) {
      e.preventDefault();
      input.focus();
    }
  });
  input.addEventListener('focus', () => {
    omniFocused = true;
    omni.classList.add('focused');
    if (!omniDirty) input.value = active && !active.newTab ? active.url : '';
    input.select();
  });
  input.addEventListener('blur', () => {
    omniFocused = false;
    omni.classList.remove('focused');
    closeSuggestions();
    if (!input.value.trim()) omniDirty = false;
    if (!omniDirty) renderToolbar();
    input.scrollLeft = 0;
  });
  input.addEventListener('input', (e) => {
    omniDirty = true;
    typed = input.value;
    inlineText = null;
    const deleting = (e.inputType || '').startsWith('delete');
    requestSuggestions(typed, !deleting);
  });

  async function requestSuggestions(text, allowInline) {
    const seq = ++suggestSeq;
    if (!text.trim()) {
      closeSuggestions();
      return;
    }
    let res;
    try {
      res = await window.pulse.invoke('ui:suggest', text);
    } catch {
      return;
    }
    if (seq !== suggestSeq || !omniFocused || input.value !== text) return;
    remoteItems = [];
    localItems = res.items || [];
    inlineText = null;
    if (allowInline && res.inline && res.inline.toLowerCase().startsWith(text.toLowerCase())
      && input.selectionStart === text.length && input.selectionEnd === text.length) {
      input.value = text + res.inline.slice(text.length);
      input.setSelectionRange(text.length, input.value.length);
      inlineText = input.value;
    }
    selected = 0;
    buildSuggestions();
    showSuggestions();
  }

  function buildSuggestions() {
    const local = inlineText ? localItems : localItems.filter((i) => !i.inline);
    const seen = new Set(local.filter((i) => i.type === 'search').map((i) => i.text.toLowerCase()));
    const remote = remoteItems.filter((i) => !seen.has(i.text.toLowerCase()));
    // Pesquisas sugeridas logo após o que foi digitado; histórico/favoritos depois.
    const head = local.slice(0, 1);
    const rest = local.slice(1);
    suggestions = [...head, ...remote.slice(0, 4), ...rest].slice(0, 9);
  }

  function showSuggestions() {
    if (!suggestions.length) {
      closeSuggestions();
      return;
    }
    const payload = { type: 'suggestions', anchor: rectOf(omni), data: { items: suggestions, selected } };
    if (currentPopup === 'suggestions') {
      window.pulse.send('ui:popup-update', payload);
    } else {
      setPopupState('suggestions');
      window.pulse.send('ui:popup-show', payload);
    }
  }

  function closeSuggestions() {
    suggestSeq++;
    if (currentPopup === 'suggestions') {
      window.pulse.send('ui:popup-hide');
      setPopupState(null);
    }
  }

  window.pulse.on('ui:suggest-remote', ({ text, items }) => {
    if (!omniFocused || text !== typed || !Array.isArray(items)) return;
    remoteItems = items;
    buildSuggestions();
    showSuggestions();
  });

  function itemText(it) {
    if (it.type === 'search') return it.text;
    return it.url;
  }

  function finishOmnibox() {
    omniDirty = false;
    inlineText = null;
    closeSuggestions();
    input.blur();
  }

  function choose(item, disposition = 'current') {
    finishOmnibox();
    if (item.type === 'tab') window.pulse.send('ui:switch-tab', { windowId: item.windowId, tabId: item.tabId });
    else window.pulse.send('ui:navigate', { url: item.url, disposition });
  }

  function navigateText(text, disposition = 'current') {
    if (!text.trim()) return;
    finishOmnibox();
    window.pulse.send('ui:navigate', { text, disposition });
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (currentPopup !== 'suggestions' || !suggestions.length) return;
      e.preventDefault();
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      input.value = selected === 0 ? (inlineText || typed) : itemText(suggestions[selected]);
      window.pulse.send('ui:popup-update', { type: 'suggestions', data: { items: suggestions, selected } });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const disposition = e.altKey ? 'new-tab' : e.shiftKey ? 'new-window' : 'current';
      const raw = input.value.trim();
      if (e.ctrlKey && /^[\w-]+$/.test(raw)) {
        navigateText(`www.${raw}.com`, disposition);
        return;
      }
      const it = currentPopup === 'suggestions' ? suggestions[selected] : null;
      if (it && (selected > 0 || it.inline)) choose(it, disposition);
      else navigateText(input.value, disposition);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (currentPopup === 'suggestions') {
        closeSuggestions();
        if (inlineText) {
          input.value = typed;
          inlineText = null;
        }
        return;
      }
      omniDirty = false;
      input.value = active && !active.newTab ? active.url : '';
      input.select();
      if (!input.value) window.pulse.send('ui:focus-page');
    } else if (e.key === 'Tab' && inlineText && !e.shiftKey) {
      e.preventDefault();
      input.setSelectionRange(input.value.length, input.value.length);
      typed = input.value;
      inlineText = null;
      requestSuggestions(typed, false);
    }
  });

  input.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.pulse.send('ui:input-menu', { omnibox: true, hasSelection: input.selectionStart !== input.selectionEnd });
  });
  $('#find-input').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.pulse.send('ui:input-menu', { omnibox: false, hasSelection: true });
  });
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('input')) e.preventDefault();
  });

  // ---------------------------------------------------------------- Favoritos
  const bmItems = $('#bm-items');
  const bmOverflow = $('#bm-overflow');
  const bmOther = $('#bm-other');

  function bookmarkButton(n) {
    const b = document.createElement('button');
    b.className = 'bm-item';
    b.dataset.id = n.id;
    b.title = n.type === 'url' ? `${n.title}\n${n.url}` : n.title;
    if (n.type === 'folder') {
      b.insertAdjacentHTML('beforeend', icon('folder', 16));
    } else if (n.favicon) {
      b.appendChild(faviconImg(n.favicon, () => letterEl(n.title || n.url)));
    } else {
      b.appendChild(letterEl(n.title || n.url));
    }
    if (n.title) {
      const s = document.createElement('span');
      s.textContent = n.title;
      b.appendChild(s);
    }
    b.addEventListener('click', (e) => {
      const disposition = e.ctrlKey || e.metaKey ? 'background' : e.shiftKey ? 'new-window' : 'current';
      window.pulse.send('ui:bookmark-open', { id: n.id, disposition, rect: rectOf(b) });
    });
    b.addEventListener('auxclick', (e) => {
      if (e.button === 1) window.pulse.send('ui:bookmark-open', { id: n.id, disposition: 'background', rect: rectOf(b) });
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.pulse.send('ui:bookmark-menu', { id: n.id });
    });
    return b;
  }

  function renderBookmarks() {
    document.body.classList.toggle('show-bookmarks', !!state.settings.showBookmarksBar);
    bmItems.textContent = '';
    const bar = state.bookmarks.bar || [];
    if (!bar.length) {
      const hint = document.createElement('span');
      hint.className = 'bm-empty';
      hint.innerHTML = 'Para acesso rápido, adicione favoritos aqui (Ctrl+D). <a id="bm-import">Importar favoritos</a>';
      hint.querySelector('a').addEventListener('click', () => window.pulse.send('ui:command', { cmd: 'bookmarks' }));
      bmItems.appendChild(hint);
    }
    for (const n of bar) bmItems.appendChild(bookmarkButton(n));
    bmOther.hidden = !state.bookmarks.otherCount;
    bmOther.innerHTML = `${icon('folder', 16)}<span>Outros favoritos</span>`;
    requestAnimationFrame(layoutBookmarksOverflow);
    sendMetrics();
  }

  function layoutBookmarksOverflow() {
    const items = [...bmItems.querySelectorAll('.bm-item')];
    items.forEach((i) => i.classList.remove('hidden-overflow'));
    bmOverflow.hidden = true;
    if (!state.settings.showBookmarksBar) return;
    const container = $('#bookmarks-bar');
    const avail = container.clientWidth - 20 - (bmOther.hidden ? 0 : bmOther.offsetWidth + 8) - 36;
    let used = 0;
    const hidden = [];
    for (const it of items) {
      used += it.offsetWidth + 2;
      if (used > avail) {
        it.classList.add('hidden-overflow');
        hidden.push(it.dataset.id);
      }
    }
    bmOverflow.hidden = hidden.length === 0;
    bmOverflow.dataset.ids = hidden.join(',');
  }

  bmOverflow.addEventListener('click', () => {
    window.pulse.send('ui:bookmark-overflow', { ids: (bmOverflow.dataset.ids || '').split(',').filter(Boolean), rect: rectOf(bmOverflow) });
  });
  bmOther.addEventListener('click', () => window.pulse.send('ui:bookmark-open', { id: 'other', rect: rectOf(bmOther) }));
  bmOther.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.pulse.send('ui:bookmark-menu', { id: 'other' });
  });
  $('#bookmarks-bar').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.pulse.send('ui:bookmark-menu', { id: null });
  });

  // ---------------------------------------------------------------- Localizar na página
  const findbar = $('#findbar');
  const findInput = $('#find-input');
  const findCount = $('#find-count');

  function openFind() {
    findbar.hidden = false;
    findInput.focus();
    findInput.select();
    if (findInput.value) window.pulse.send('ui:find', { text: findInput.value, newSession: true });
    sendMetrics();
  }

  function hideFind() {
    if (findbar.hidden) return;
    findbar.hidden = true;
    findCount.textContent = '';
    findCount.classList.remove('none');
    sendMetrics();
  }

  function closeFind() {
    if (findbar.hidden) return;
    hideFind();
    window.pulse.send('ui:find-close');
  }

  function findStep(dir) {
    if (!findInput.value) return;
    window.pulse.send('ui:find', { text: findInput.value, forward: dir > 0, newSession: false });
  }

  findInput.addEventListener('input', () => {
    if (!findInput.value) {
      findCount.textContent = '';
      findCount.classList.remove('none');
    }
    window.pulse.send('ui:find', { text: findInput.value, newSession: true });
  });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findStep(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
  });
  $('#find-prev').addEventListener('click', () => findStep(-1));
  $('#find-next').addEventListener('click', () => findStep(1));
  $('#find-close').addEventListener('click', closeFind);

  window.pulse.on('ui:find-open', openFind);
  window.pulse.on('ui:find-close', hideFind);
  window.pulse.on('ui:find-step', (dir) => {
    if (findbar.hidden) openFind();
    else findStep(dir);
  });
  window.pulse.on('ui:find-result', ({ active: a, total }) => {
    if (!findInput.value) return;
    findCount.textContent = `${a}/${total}`;
    findCount.classList.toggle('none', total === 0);
  });

  // ---------------------------------------------------------------- Downloads
  function renderDownloads() {
    const d = state.downloads;
    dlBtn.hidden = !d || d.count === 0;
    if (!d) return;
    const running = d.active > 0;
    dlBtn.classList.toggle('active', running);
    dlBtn.classList.toggle('indeterminate', running && d.progress < 0);
    const C = 94.25;
    dlBtn.querySelector('.ring-bar').style.strokeDashoffset = String(running && d.progress >= 0 ? C * (1 - d.progress) : C);
    dlBtn.title = running ? `${d.active} download(s) em andamento` : 'Downloads (Ctrl+J)';
  }

  // ---------------------------------------------------------------- Eventos do processo principal
  function applySettings() {
    const s = state.settings;
    document.documentElement.style.setProperty('--accent', s.accentColor || '#7c5cff');
    $('#home-btn').hidden = !s.showHomeButton;
    input.placeholder = `Pesquise no ${s.engineName || 'Google'} ou digite um endereço`;
    shieldKey = '';
    renderBookmarks();
    renderToolbar();
  }

  window.pulse.on('ui:settings', (s) => {
    state.settings = s || {};
    applySettings();
  });
  window.pulse.on('ui:tabs', ({ tabs, activeId }) => {
    const prevActive = state.activeId;
    const prevUrl = active ? active.url : null;
    state.tabs = tabs;
    state.activeId = activeId;
    active = tabs.find((t) => t.id === activeId) || null;
    if (prevActive !== activeId) {
      omniDirty = false;
      if (omniFocused && !(active && active.newTab)) input.blur();
    } else if (active && prevUrl !== active.url && !omniFocused) {
      // A página navegou: descarta o texto que ficou editado na barra de endereço.
      omniDirty = false;
    }
    renderTabs();
    renderToolbar();
  });
  window.pulse.on('ui:bookmarks', (b) => {
    state.bookmarks = b || { bar: [], otherCount: 0 };
    renderBookmarks();
  });
  window.pulse.on('ui:downloads', (d) => {
    state.downloads = d;
    renderDownloads();
  });
  window.pulse.on('ui:download-started', () => {
    dlBtn.hidden = false;
    dlBtn.classList.remove('pulse');
    void dlBtn.offsetWidth;
    dlBtn.classList.add('pulse');
  });
  window.pulse.on('ui:popup', ({ type }) => setPopupState(type));
  window.pulse.on('ui:focus-omnibox', () => {
    input.focus();
    input.select();
  });
  window.pulse.on('ui:omnibox-done', () => {
    omniDirty = false;
    input.blur();
    renderToolbar();
  });
  window.pulse.on('ui:request-popup', ({ type }) => {
    if (type === 'bookmark' && !starBtn.hidden && currentPopup !== 'bookmark') togglePopup('bookmark', starBtn, { align: 'right' });
  });
  window.pulse.on('ui:edit-bookmark', ({ id }) => {
    const el = bmItems.querySelector(`.bm-item[data-id="${CSS.escape(id)}"]:not(.hidden-overflow)`);
    const anchorEl = el || (starBtn.hidden ? omni : starBtn);
    setPopupState('bookmark');
    window.pulse.send('ui:popup-show', { type: 'bookmark-edit', id, anchor: rectOf(anchorEl), align: el ? 'left' : 'right' });
  });
  window.pulse.on('ui:window-state', (s) => {
    document.body.classList.toggle('maximized', !!s.maximized);
    document.body.classList.toggle('fullscreen', !!s.fullscreen);
    document.body.classList.toggle('window-focused', s.focused !== false);
    const wasHtml = document.body.classList.contains('html-fullscreen');
    document.body.classList.toggle('html-fullscreen', !!s.htmlFullscreen);
    if (wasHtml !== !!s.htmlFullscreen) sendMetrics();
    updateCaptionSpacer();
  });

  document.body.classList.add('window-focused');
  sendMetrics();
})();
