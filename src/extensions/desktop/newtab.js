'use strict';
// Desktop — extensão de fábrica do tuff.browse que transforma a nova aba numa área de trabalho:
// papel de parede, ícones de vidro líquido arrastáveis, dock, widgets e Spotify embutido.
(async () => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const NS = 'http://www.w3.org/2000/svg';

  // Sem a API (página aberta fora do navegador): guarda no localStorage para não quebrar.
  const api = typeof tuff !== 'undefined' ? tuff : {
    storage: {
      get: async (k) => { try { return JSON.parse(localStorage.getItem(`desk:${k}`)); } catch { return null; } },
      set: async (k, v) => { try { localStorage.setItem(`desk:${k}`, JSON.stringify(v)); } catch { /* cheio */ } },
      onChanged: () => () => {},
    },
    tabs: { create: async ({ url }) => window.open(url), update: async ({ url }) => { location.href = url; } },
    browser: {
      search: async (t) => { location.href = `https://www.google.com/search?q=${encodeURIComponent(t)}`; },
      resolve: async (t) => (/^\w+:/.test(t) ? t : `https://${t}`),
      engine: async () => ({ id: 'google', name: 'Google', icon: '' }),
      engines: async () => ({ current: 'google', engines: [] }),
      setEngine: async () => {}, topSites: async () => [],
    },
    fetch: async (url, o) => { const r = await fetch(url); return { ok: r.ok, status: r.status, text: await r.text(), ...(o?.as ? { dataUrl: '' } : {}) }; },
    notify: () => {},
  };

  // ---------------------------------------------------------------- Ícones (traços)
  const P = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    puzzle: '<path d="M19.4 13.6a2 2 0 1 0 0-3.2V7a1 1 0 0 0-1-1h-3.4a2 2 0 1 0-3.2 0H8.4a1 1 0 0 0-1 1v3.4a2 2 0 1 0 0 3.2V17a1 1 0 0 0 1 1h3.4a2 2 0 1 0 3.2 0h3.4a1 1 0 0 0 1-1z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    pencil: '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 11.5 3.3 3.3 0 0 0 7 18z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/>',
    external: '<path d="M14 3h7v7M10 14 21 3M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
    pin: '<path d="M12 17v5M5 17h14l-2-4V5h1V3H6v2h1v8z"/>',
    sort: '<path d="M3 6h18M6 12h12M10 18h4"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8M14 7h7v7"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
    dock: '<rect x="3" y="14" width="18" height="7" rx="3"/><path d="M8 10h8"/>',
    sparkles: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
    open: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  };
  const svg = (name, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${P[name] || ''}</svg>`;

  // Ícones do clima (coloridos)
  const WX = {
    sun: '<circle cx="32" cy="32" r="12" fill="#FFD23F"/><g stroke="#FFD23F" stroke-width="4" stroke-linecap="round"><path d="M32 6v7M32 51v7M6 32h7M51 32h7M13.6 13.6l5 5M45.4 45.4l5 5M13.6 50.4l5-5M45.4 18.6l5-5"/></g>',
    moon: '<path d="M38 10a22 22 0 1 0 16 34 18 18 0 0 1-16-34z" fill="#E9E6FF"/>',
    cloud: '<path d="M19 50h28a11 11 0 0 0 1.4-21.9A15 15 0 0 0 19.6 31 9.6 9.6 0 0 0 19 50z" fill="#F4F6FF"/>',
    partly: '<circle cx="24" cy="22" r="10" fill="#FFD23F"/><g stroke="#FFD23F" stroke-width="3.4" stroke-linecap="round"><path d="M24 4v4M8 22H4M11.3 9.3l2.8 2.8M36.7 9.3l-2.8 2.8"/></g><path d="M22 52h26a10 10 0 0 0 1.3-19.9A13.5 13.5 0 0 0 22.6 35 8.5 8.5 0 0 0 22 52z" fill="#F4F6FF"/>',
    rain: '<path d="M19 40h28a10 10 0 0 0 1.3-19.9A14 14 0 0 0 19.6 23 8.6 8.6 0 0 0 19 40z" fill="#E3E8F6"/><g stroke="#5AB8FF" stroke-width="3.6" stroke-linecap="round"><path d="M24 46l-3 8M34 46l-3 8M44 46l-3 8"/></g>',
    drizzle: '<path d="M19 40h28a10 10 0 0 0 1.3-19.9A14 14 0 0 0 19.6 23 8.6 8.6 0 0 0 19 40z" fill="#E3E8F6"/><g fill="#7CC8FF"><circle cx="24" cy="49" r="2.4"/><circle cx="33" cy="53" r="2.4"/><circle cx="42" cy="49" r="2.4"/></g>',
    snow: '<path d="M19 40h28a10 10 0 0 0 1.3-19.9A14 14 0 0 0 19.6 23 8.6 8.6 0 0 0 19 40z" fill="#E3E8F6"/><g fill="#fff"><circle cx="24" cy="49" r="3"/><circle cx="34" cy="54" r="3"/><circle cx="44" cy="49" r="3"/></g>',
    storm: '<path d="M19 38h28a10 10 0 0 0 1.3-19.9A14 14 0 0 0 19.6 21 8.6 8.6 0 0 0 19 38z" fill="#B9BFD3"/><path d="M33 38l-7 12h7l-3 10 11-15h-7l4-7z" fill="#FFD23F"/>',
    fog: '<g stroke="#E3E8F6" stroke-width="4" stroke-linecap="round"><path d="M12 24h40M8 34h44M14 44h36"/></g>',
  };
  const wx = (k) => `<svg viewBox="0 0 64 64">${WX[k] || WX.cloud}</svg>`;
  const WCODES = {
    0: ['Céu limpo', 'sun'], 1: ['Quase limpo', 'partly'], 2: ['Parcialmente nublado', 'partly'], 3: ['Nublado', 'cloud'],
    45: ['Neblina', 'fog'], 48: ['Neblina', 'fog'], 51: ['Garoa fraca', 'drizzle'], 53: ['Garoa', 'drizzle'], 55: ['Garoa forte', 'drizzle'],
    56: ['Garoa congelante', 'drizzle'], 57: ['Garoa congelante', 'drizzle'], 61: ['Chuva fraca', 'rain'], 63: ['Chuva', 'rain'], 65: ['Chuva forte', 'rain'],
    66: ['Chuva congelante', 'rain'], 67: ['Chuva congelante', 'rain'], 71: ['Neve fraca', 'snow'], 73: ['Neve', 'snow'], 75: ['Neve forte', 'snow'], 77: ['Grãos de neve', 'snow'],
    80: ['Pancadas de chuva', 'rain'], 81: ['Pancadas de chuva', 'rain'], 82: ['Pancadas fortes', 'rain'], 85: ['Pancadas de neve', 'snow'], 86: ['Pancadas de neve', 'snow'],
    95: ['Trovoadas', 'storm'], 96: ['Trovoadas com granizo', 'storm'], 99: ['Trovoadas com granizo', 'storm'],
  };

  // ---------------------------------------------------------------- Papéis de parede
  const WALLS = {
    aurora: { name: 'Aurora', base: '#1a1033', c: ['#ff4fd8', '#7c5cff', '#22d3ee', '#ff9f5a'] },
    lagoon: { name: 'Lagoa', base: '#03203a', c: ['#00e0c6', '#2f7bff', '#7cf5ff', '#1b4bff'] },
    sunset: { name: 'Pôr do sol', base: '#2a0f1f', c: ['#ff7a1a', '#ff3d7f', '#ffd23b', '#9b3dff'] },
    bloom: { name: 'Florescer', base: '#e9c9ff', c: ['#ff9fcf', '#a48cff', '#7fdcff', '#ffd38a'] },
    forest: { name: 'Floresta', base: '#06261b', c: ['#2fd38a', '#0f8f6a', '#b4f05a', '#1a6d8f'] },
    midnight: { name: 'Meia-noite', base: '#05060f', c: ['#2b2dff', '#7b2bff', '#0a84ff', '#1d1d5a'] },
    candy: { name: 'Doce', base: '#2a0b3d', c: ['#ff5ea8', '#ffb86b', '#5ee7ff', '#c86bff'] },
    graphite: { name: 'Grafite', base: '#17171c', c: ['#55556a', '#2c2c35', '#7a7a8c', '#24242c'] },
  };
  const wallCss = (w) => `radial-gradient(60% 70% at 12% 15%, ${w.c[0]} 0, transparent 60%), radial-gradient(55% 65% at 88% 12%, ${w.c[1]} 0, transparent 60%), radial-gradient(60% 70% at 80% 90%, ${w.c[2]} 0, transparent 60%), radial-gradient(60% 70% at 15% 88%, ${w.c[3]} 0, transparent 60%), ${w.base}`;

  // ---------------------------------------------------------------- Spotify
  const SPOTIFY_PRESETS = [
    ['Top 50 Brasil', 'https://open.spotify.com/playlist/37i9dQZEVXbMXbN3EUUhlg'],
    ['Top 50 Global', 'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF'],
    ["Today's Top Hits", 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'],
    ['Lofi Beats', 'https://open.spotify.com/playlist/37i9dQZF1DWWQRwui0ExPn'],
    ['Deep Focus', 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ'],
    ['Peaceful Piano', 'https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO'],
    ['Rock Classics', 'https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U'],
  ];
  function spotifyEmbed(link) {
    const s = String(link || '').trim();
    let m = s.match(/^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]+)/);
    if (!m) m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/);
    return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator&theme=0` : null;
  }

  // ---------------------------------------------------------------- Estado
  const site = (title, url, extra = {}) => ({ id: uid(), title, url, ...extra });
  function defaults() {
    const desk = [
      site('Google Drive', 'https://drive.google.com/'), site('Google Maps', 'https://maps.google.com/'),
      site('Wikipedia', 'https://pt.wikipedia.org/'), site('Netflix', 'https://www.netflix.com/'),
      site('Instagram', 'https://www.instagram.com/'), site('Reddit', 'https://www.reddit.com/'),
      site('Configurações', 'tuff://settings/'), site('Extensões', 'tuff://extensions/'),
    ].map((it, i) => ({ ...it, place: 'desk', col: Math.floor(i / 4), row: i % 4 }));
    const dock = [
      site('YouTube', 'https://www.youtube.com/'), site('Gmail', 'https://mail.google.com/'),
      site('WhatsApp', 'https://web.whatsapp.com/'), site('Spotify', 'https://open.spotify.com/'),
      site('ChatGPT', 'https://chatgpt.com/'), site('GitHub', 'https://github.com/'),
    ].map((it, i) => ({ ...it, place: 'dock', order: i }));
    return {
      v: 1,
      wallpaper: { kind: 'preset', preset: 'aurora', url: '', dim: 0.1, blur: 0, motion: false },
      look: { size: 64, style: 'glass', labels: true, refraction: true, dock: true },
      clock24: true,
      items: [...desk, ...dock],
      widgets: [
        { id: uid(), type: 'clock', ax: 0.5, ay: 0.1, opts: { style: 'digital', seconds: false, greet: true, card: false } },
        { id: uid(), type: 'search', ax: 0.5, ay: 0.36, w: 600 },
        { id: uid(), type: 'spotify', ax: 1, ay: 0, w: 340, h: 168, opts: { url: SPOTIFY_PRESETS[0][1] } },
        { id: uid(), type: 'weather', ax: 1, ay: 0.42, opts: { city: 'São Paulo', lat: -23.5475, lon: -46.63611 } },
        { id: uid(), type: 'notes', ax: 1, ay: 0.84, w: 300, h: 160, opts: { text: '' } },
      ],
    };
  }
  function migrate(s) {
    const d = defaults();
    if (!s || typeof s !== 'object' || !Array.isArray(s.items)) return d;
    return {
      ...d, ...s,
      wallpaper: { ...d.wallpaper, ...(s.wallpaper || {}) },
      look: { ...d.look, ...(s.look || {}) },
      widgets: Array.isArray(s.widgets) ? s.widgets.filter((w) => w && WIDGETS[w.type]) : d.widgets,
    };
  }

  let state = null;
  let iconCache = {};
  let lastRev = null;
  let saveTimer = 0;
  function save() {
    state.rev = uid();
    lastRev = state.rev;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.storage.set('desktop', state).catch(() => {}), 220);
  }
  let iconSaveTimer = 0;
  const saveIcons = () => {
    clearTimeout(iconSaveTimer);
    iconSaveTimer = setTimeout(() => api.storage.set('icons-v2', iconCache).catch(() => {}), 800);
  };

  // ---------------------------------------------------------------- Vidro líquido (refração)
  // Um mapa de deslocamento por tamanho: as bordas do vidro "puxam" a imagem de trás para dentro,
  // como uma lente. Vai no backdrop-filter junto com o desfoque.
  const filters = $('#filters');
  const filterCache = new Map();
  function displacementMap(w, h, r, bezel) {
    const k = Math.min(1, 160 / Math.max(w, h));
    const cw = Math.max(8, Math.round(w * k));
    const ch = Math.max(8, Math.round(h * k));
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const g = c.getContext('2d');
    const img = g.createImageData(cw, ch);
    const d = img.data;
    const bx = w / 2 - r;
    const by = h / 2 - r;
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const px = ((i + 0.5) / cw) * w - w / 2;
        const py = ((j + 0.5) / ch) * h - h / 2;
        const qx = Math.abs(px) - bx;
        const qy = Math.abs(py) - by;
        const ox = Math.max(qx, 0);
        const oy = Math.max(qy, 0);
        const out = Math.hypot(ox, oy);
        const dist = out + Math.min(Math.max(qx, qy), 0) - r;
        let nx = 0;
        let ny = 0;
        if (qx > 0 && qy > 0) {
          nx = ox / (out || 1);
          ny = oy / (out || 1);
        } else if (qx > qy) nx = 1;
        else ny = 1;
        nx *= px < 0 ? -1 : 1;
        ny *= py < 0 ? -1 : 1;
        const t = dist < 0 ? clamp(1 + dist / bezel, 0, 1) : 0;
        const m = t * t * (3 - 2 * t);
        const o = (j * cw + i) * 4;
        d[o] = 128 - nx * m * 127;
        d[o + 1] = 128 - ny * m * 127;
        d[o + 2] = 128;
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL();
  }
  function glassFilter(w, h, r, { bezel, scale }) {
    w = Math.max(8, Math.round(w / 2) * 2);
    h = Math.max(8, Math.round(h / 2) * 2);
    const key = `${w}x${h}x${Math.round(r)}x${bezel}x${scale}`;
    if (filterCache.has(key)) return filterCache.get(key);
    if (filterCache.size > 40) {
      filterCache.clear();
      filters.textContent = '';
    }
    const id = `lg${uid()}`;
    const f = document.createElementNS(NS, 'filter');
    f.setAttribute('id', id);
    for (const [k, v] of Object.entries({ x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v);
    const im = document.createElementNS(NS, 'feImage');
    for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'map' })) im.setAttribute(k, String(v));
    im.setAttribute('href', displacementMap(w, h, Math.min(r, w / 2, h / 2), bezel));
    const dm = document.createElementNS(NS, 'feDisplacementMap');
    for (const [k, v] of Object.entries({ in: 'SourceGraphic', in2: 'map', scale, xChannelSelector: 'R', yChannelSelector: 'G' })) dm.setAttribute(k, String(v));
    f.append(im, dm);
    filters.appendChild(f);
    filterCache.set(key, id);
    return id;
  }
  function glassFor(el, w, h, r, opts = {}) {
    if (!state.look.refraction) {
      el.style.backdropFilter = '';
      return;
    }
    const id = glassFilter(w, h, r, { bezel: opts.bezel || Math.round(Math.min(w, h) * 0.28), scale: opts.scale || 46 });
    el.style.backdropFilter = `url(#${id}) blur(${opts.blur ?? 3}px) saturate(1.9) brightness(1.06)`;
  }
  function applyTileGlass() {
    const s = state.look.size;
    const root = document.documentElement.style;
    if (!state.look.refraction) {
      root.removeProperty('--tile-bf');
      return;
    }
    const id = glassFilter(s, s, s * 0.27, { bezel: Math.round(s * 0.3), scale: Math.round(s * 0.42) });
    root.setProperty('--tile-bf', `url(#${id}) blur(2px) saturate(1.9) brightness(1.07)`);
  }
  // Reflexo que segue o mouse no vidro.
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('.glass, .tile');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${Math.round(((e.clientX - r.left) / r.width) * 100)}%`);
    el.style.setProperty('--my', `${Math.round(((e.clientY - r.top) / r.height) * 100)}%`);
  }, { passive: true });

  // ---------------------------------------------------------------- Ícones dos sites
  const GLYPHS = { settings: 'gear', extensions: 'puzzle', history: 'clock', downloads: 'download', bookmarks: 'star', passwords: 'pin' };
  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }
  function glyphOf(url) {
    const m = /^(?:tuff|pulse):\/\/([a-z]+)/i.exec(url || '');
    return m ? svg(GLYPHS[m[1]] || 'grid') : null;
  }
  function hashColor(s) {
    let h = 0;
    for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360} 70% 52%)`;
  }
  function colorOf(item) {
    if (item.color) return item.color;
    if (/^(tuff|pulse):/i.test(item.url)) return '#7c5cff';
    const c = iconCache[hostOf(item.url)];
    return (c && c.c) || hashColor(hostOf(item.url) || item.title);
  }
  function faceHtml(item) {
    if (item.icon) return `<img class="logo" src="${esc(item.icon)}" alt="">`;
    const g = glyphOf(item.url);
    if (g) return `<span class="glyph">${g}</span>`;
    const host = hostOf(item.url);
    const c = iconCache[host];
    if (c && c.d) return `<img class="logo" src="${esc(c.d)}" alt="">`;
    if (host && (!c || (!c.d && Date.now() - (c.t || 0) > 3 * 864e5))) fetchIcon(host);
    return `<span class="letter">${esc((item.title || host || '?').trim()[0]?.toUpperCase() || '?')}</span>`;
  }

  const pendingIcons = new Set();
  async function fetchIcon(host) {
    if (pendingIcons.has(host) || !api.fetch) return;
    pendingIcons.add(host);
    try {
      // Pede pelo endereço completo (assim Gmail, Drive e WhatsApp vêm com o ícone certo, não o "G" genérico).
      const sources = [
        `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${host}/`)}&size=128`,
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
      ];
      let entry = { t: Date.now() };
      for (const src of sources) {
        const res = await api.fetch(src, { as: 'dataurl' }).catch(() => null);
        if (!res || !res.ok || !res.dataUrl || res.dataUrl.length < 120) continue;
        const info = await imageInfo(res.dataUrl);
        // Quando não conhece o site, o serviço devolve um globo de 16 px: aí tenta o próximo ou fica a letra.
        if (info && info.w > 16) {
          entry = { d: res.dataUrl, c: info.color, t: Date.now() };
          break;
        }
      }
      iconCache[host] = entry;
      saveIcons();
      if (entry.d) refreshFaces(host);
    } catch {
      iconCache[host] = { t: Date.now() };
    } finally {
      pendingIcons.delete(host);
    }
  }
  function imageInfo(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = c.height = 24;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0, 24, 24);
          const px = g.getImageData(0, 0, 24, 24).data;
          let r = 0;
          let gg = 0;
          let b = 0;
          let n = 0;
          for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 140) continue;
            const mx = Math.max(px[i], px[i + 1], px[i + 2]);
            const mn = Math.min(px[i], px[i + 1], px[i + 2]);
            const wgt = 0.15 + (mx - mn) / 255; // cores vivas pesam mais que branco/preto
            r += px[i] * wgt;
            gg += px[i + 1] * wgt;
            b += px[i + 2] * wgt;
            n += wgt;
          }
          const color = n ? `rgb(${Math.round(r / n)}, ${Math.round(gg / n)}, ${Math.round(b / n)})` : null;
          resolve({ w: img.naturalWidth, h: img.naturalHeight, color });
        } catch {
          resolve({ w: img.naturalWidth, h: img.naturalHeight, color: null });
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  function refreshFaces(host) {
    for (const it of state.items) {
      if (hostOf(it.url) !== host || it.icon) continue;
      for (const el of $$(`[data-id="${it.id}"]`)) {
        const face = el.querySelector('.face');
        if (face) face.innerHTML = faceHtml(it);
        const tint = el.querySelector('.tint');
        if (tint) tint.style.setProperty('--c', colorOf(it));
      }
    }
    $$('.w-top [data-host]').forEach((a) => {
      if (a.dataset.host === host && iconCache[host]?.d) a.querySelector('.mini').innerHTML = `<img src="${esc(iconCache[host].d)}" alt="">`;
    });
  }

  // ---------------------------------------------------------------- Abrir sites
  function open(url, { newTab = false, background = false } = {}) {
    if (!url) return;
    if (newTab) {
      api.tabs.create({ url, active: !background });
      return;
    }
    if (/^(tuff|pulse|tuff-ext):/i.test(url)) api.tabs.update({ url });
    else location.assign(url);
  }

  // ---------------------------------------------------------------- Papel de parede
  const wallImg = $('#wall-img');
  const wallVideo = $('#wall-video');
  let objectUrl = null;
  const idb = (() => {
    let dbp = null;
    const db = () => {
      if (!dbp) {
        dbp = new Promise((resolve, reject) => {
          const req = indexedDB.open('desktop', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('files');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      return dbp;
    };
    const tx = async (mode, fn) => {
      const d = await db();
      return new Promise((resolve, reject) => {
        const t = d.transaction('files', mode);
        const r = fn(t.objectStore('files'));
        t.oncomplete = () => resolve(r && r.result);
        t.onerror = () => reject(t.error);
      });
    };
    return {
      get: (k) => tx('readonly', (s) => s.get(k)),
      put: (k, v) => tx('readwrite', (s) => s.put(v, k)),
    };
  })();

  async function bingPhoto() {
    const today = new Date().toDateString();
    let cached = null;
    try {
      cached = await api.storage.get('bing');
    } catch { /* ignora */ }
    if (cached && cached.day === today && cached.url) return cached;
    try {
      const res = await api.fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=pt-BR');
      const img = JSON.parse(res.text).images[0];
      const out = { day: today, url: `https://www.bing.com${img.urlbase}_UHD.jpg`, title: img.title || '', credit: img.copyright || '' };
      api.storage.set('bing', out).catch(() => {});
      return out;
    } catch {
      return cached;
    }
  }

  let wallKey = '';
  async function applyWallpaper() {
    const w = state.wallpaper;
    const root = document.documentElement.style;
    root.setProperty('--dim', String(clamp(Number(w.dim) || 0, 0, 0.8)));
    root.setProperty('--wblur', `${clamp(Number(w.blur) || 0, 0, 30)}px`);
    const preset = WALLS[w.preset] || WALLS.aurora;
    root.setProperty('--w-base', preset.base);
    preset.c.forEach((c, i) => root.setProperty(`--w${i + 1}`, `radial-gradient(closest-side, ${c}, transparent)`));
    document.body.classList.toggle('motion', w.kind === 'preset' && !!w.motion);
    for (const el of [wallImg, wallVideo]) el.classList.toggle('blur', (Number(w.blur) || 0) > 0);
    const key = `${w.kind}|${w.url}|${w.kind === 'custom' ? w.fileId : ''}`;
    if (key === wallKey) return;
    wallKey = key;
    const credit = $('#credit');
    credit.hidden = true;
    const showImage = (url) => {
      wallVideo.classList.remove('on');
      wallVideo.pause();
      wallVideo.hidden = true;
      const probe = new Image();
      probe.onload = () => {
        if (wallKey !== key) return;
        wallImg.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
        wallImg.classList.add('on');
      };
      probe.onerror = () => toast('Não foi possível carregar o papel de parede');
      probe.src = url;
    };
    const showVideo = (url) => {
      wallImg.classList.remove('on');
      wallVideo.hidden = false;
      wallVideo.src = url;
      wallVideo.oncanplay = () => wallVideo.classList.add('on');
      wallVideo.play().catch(() => {});
    };
    if (w.kind === 'preset') {
      wallImg.classList.remove('on');
      wallVideo.classList.remove('on');
      wallVideo.pause();
      return;
    }
    if (w.kind === 'bing') {
      const b = await bingPhoto();
      if (wallKey !== key) return;
      if (b && b.url) {
        showImage(b.url);
        if (b.credit) {
          credit.textContent = b.credit;
          credit.title = b.title || b.credit;
          credit.hidden = false;
        }
      } else toast('Sem internet para a foto do dia');
      return;
    }
    if (w.kind === 'url' && w.url) {
      if (/\.(mp4|webm)(\?|#|$)/i.test(w.url)) showVideo(w.url);
      else showImage(w.url);
      return;
    }
    if (w.kind === 'custom') {
      try {
        const f = await idb.get('wallpaper');
        if (wallKey !== key) return;
        if (!f || !f.blob) throw new Error('sem arquivo');
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(f.blob);
        if (String(f.type).startsWith('video/')) showVideo(objectUrl);
        else showImage(objectUrl);
      } catch {
        toast('Escolha a imagem do papel de parede de novo');
      }
    }
  }

  // ---------------------------------------------------------------- Grade de ícones
  const PAD = 20;
  let grid = { cols: 1, rows: 1, cw: 106, ch: 110 };
  function computeGrid() {
    const s = state.look.size;
    const cw = s + 42;
    const ch = s + 46;
    const bottom = state.look.dock ? 96 : 20;
    grid = {
      cw, ch,
      cols: Math.max(1, Math.floor((innerWidth - PAD * 2) / cw)),
      rows: Math.max(1, Math.floor((innerHeight - PAD - bottom) / ch)),
    };
  }
  const cellXY = (col, row) => ({ x: PAD + col * grid.cw, y: PAD + row * grid.ch });
  function placeDesk() {
    // Resolve a posição visível de cada ícone (sem sobrepor e dentro da tela).
    const taken = new Set();
    const out = new Map();
    const desk = state.items.filter((i) => i.place === 'desk');
    const ok = (c, r) => c >= 0 && r >= 0 && c < grid.cols && r < grid.rows && !taken.has(`${c},${r}`);
    const pending = [];
    for (const it of desk) {
      if (Number.isInteger(it.col) && Number.isInteger(it.row) && ok(it.col, it.row)) {
        taken.add(`${it.col},${it.row}`);
        out.set(it.id, { col: it.col, row: it.row });
      } else pending.push(it);
    }
    for (const it of pending) {
      let found = null;
      for (let c = 0; c < grid.cols && !found; c++) for (let r = 0; r < grid.rows && !found; r++) if (ok(c, r)) found = { col: c, row: r };
      if (!found) found = { col: grid.cols - 1, row: grid.rows - 1 };
      taken.add(`${found.col},${found.row}`);
      out.set(it.id, found);
    }
    return out;
  }
  function firstFreeCell() {
    const pos = placeDesk();
    const taken = new Set([...pos.values()].map((p) => `${p.col},${p.row}`));
    for (let c = 0; c < grid.cols; c++) for (let r = 0; r < grid.rows; r++) if (!taken.has(`${c},${r}`)) return { col: c, row: r };
    return { col: 0, row: 0 };
  }

  let selection = new Set();
  let firstRender = true;
  function renderIcons() {
    computeGrid();
    document.documentElement.style.setProperty('--icon', `${state.look.size}px`);
    const box = $('#icons');
    const pos = placeDesk();
    const keep = new Set();
    let i = 0;
    for (const it of state.items.filter((x) => x.place === 'desk')) {
      keep.add(it.id);
      let el = box.querySelector(`.icon[data-id="${it.id}"]`);
      const sig = `${it.title}|${it.url}|${it.icon || ''}|${colorOf(it)}`;
      if (!el) {
        el = document.createElement('div');
        el.className = `icon${firstRender ? ' appear' : ''}`;
        el.dataset.id = it.id;
        el.style.setProperty('--i', String(i));
        el.style.setProperty('--j', String((i * 7) % 5));
        box.appendChild(el);
      }
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        el.innerHTML = `<button class="rm" data-rm title="Remover">−</button>
          <span class="tile"><span class="tint" style="--c:${esc(colorOf(it))}"></span><span class="face">${faceHtml(it)}</span></span>
          <span class="label">${esc(it.title)}</span>`;
        el.title = `${it.title}\n${it.url}`;
      }
      const p = pos.get(it.id);
      const { x, y } = cellXY(p.col, p.row);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.classList.toggle('sel', selection.has(it.id));
      i++;
    }
    for (const el of $$('.icon', box)) if (!keep.has(el.dataset.id)) el.remove();
  }

  function renderDock() {
    const dock = $('#dock');
    const items = state.items.filter((x) => x.place === 'dock').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    dock.innerHTML = items.map((it, i) => `<div class="dock-item" data-id="${it.id}" style="--j:${(i * 3) % 5}">
        <span class="dtile"><span class="tint" style="--c:${esc(colorOf(it))}"></span><span class="face">${faceHtml(it)}</span></span>
        <span class="tip">${esc(it.title)}</span></div>`).join('')
      + `${items.length ? '<span class="dock-sep"></span>' : ''}<button class="dock-btn" data-cmd="widgets" title="Widgets">${svg('grid')}</button>
        <button class="dock-btn" data-cmd="settings" title="Ajustes do desktop">${svg('gear')}</button>`;
    // As faces das docks reaproveitam a classe .face; a letra fica maior.
    document.body.classList.toggle('no-dock', !state.look.dock);
  }

  function applyLook() {
    const b = document.body.classList;
    b.toggle('no-labels', !state.look.labels);
    b.toggle('style-color', state.look.style === 'color');
    b.toggle('style-dark', state.look.style === 'dark');
    applyTileGlass();
  }

  // ---------------------------------------------------------------- Widgets
  const WIDGETS = {
    clock: {
      name: 'Relógio', desc: 'Hora grande e data', icon: 'clock', color: '#ff9f5a',
      size: (w) => (w.opts?.style === 'analog' ? { w: 210, h: 210 } : { w: 440, h: 170 }),
      glass: (w) => !!w.opts?.card,
      mount(el, w) {
        const o = w.opts || {};
        if (o.style === 'analog') {
          let ticks = '';
          for (let k = 0; k < 12; k++) ticks += `<line class="tick" x1="50" y1="${k % 3 ? 9 : 7}" x2="50" y2="${k % 3 ? 12 : 15}" transform="rotate(${k * 30} 50 50)"/>`;
          el.innerHTML = `<div class="w-clock"><svg class="analog" viewBox="0 0 100 100"><circle class="face" cx="50" cy="50" r="47"/>${ticks}
            <line class="hand h" x1="50" y1="50" x2="50" y2="27" stroke-width="4.5"/><line class="hand m" x1="50" y1="50" x2="50" y2="16" stroke-width="3"/>
            <line class="hand s" x1="50" y1="56" x2="50" y2="12" stroke-width="1.4"/><circle cx="50" cy="50" r="2.6" fill="#fff"/></svg></div>`;
        } else {
          el.innerHTML = '<div class="w-clock"><div class="time"></div><div class="date"></div><div class="greet"></div></div>';
        }
        const tick = () => {
          const now = new Date();
          if (o.style === 'analog') {
            const s = now.getSeconds();
            const m = now.getMinutes() + s / 60;
            const h = (now.getHours() % 12) + m / 60;
            el.querySelector('.h').setAttribute('transform', `rotate(${h * 30} 50 50)`);
            el.querySelector('.m').setAttribute('transform', `rotate(${m * 6} 50 50)`);
            el.querySelector('.s').setAttribute('transform', `rotate(${s * 6} 50 50)`);
            return;
          }
          const opts = { hour: '2-digit', minute: '2-digit', hour12: state.clock24 === false };
          let t = now.toLocaleTimeString('pt-BR', opts);
          if (o.seconds) t += `<span class="sec">${String(now.getSeconds()).padStart(2, '0')}</span>`;
          el.querySelector('.time').innerHTML = t;
          const d = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
          el.querySelector('.date').textContent = d.charAt(0).toUpperCase() + d.slice(1);
          const hr = now.getHours();
          el.querySelector('.greet').textContent = o.greet === false ? '' : hr < 5 ? 'Boa noite' : hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite';
        };
        tick();
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
      },
      settings: (w) => ({
        title: 'Relógio',
        html: `${seg('style', 'Estilo', [['digital', 'Digital'], ['analog', 'Analógico']], w.opts.style || 'digital')}
          ${toggleRow('seconds', 'Mostrar segundos', !!w.opts.seconds)}
          ${toggleRow('greet', 'Saudação (bom dia, boa tarde…)', w.opts.greet !== false)}
          ${toggleRow('card', 'Fundo de vidro', !!w.opts.card)}`,
        apply: (f) => ({ ...w.opts, style: segVal(f, 'style'), seconds: f.seconds.checked, greet: f.greet.checked, card: f.card.checked }),
      }),
    },

    search: {
      name: 'Pesquisa', desc: 'Barra de pesquisa com o seu buscador', icon: 'search', color: '#7c5cff',
      size: () => ({ w: 600, h: 58 }), glass: () => true, resize: { minW: 320, maxW: 980, fixedH: true },
      mount(el) {
        el.innerHTML = `<form class="w-search"><button type="button" class="eng" title="Trocar o buscador"><img alt=""><span>${svg('chevron')}</span></button>
          <input name="q" placeholder="Pesquise ou digite um endereço" autocomplete="off" spellcheck="false">
          <button class="go" type="submit" title="Pesquisar">${svg('search')}</button></form>`;
        const form = el.querySelector('form');
        const input = form.q;
        const refresh = async () => {
          try {
            const e = await api.browser.engine();
            if (e.icon) el.querySelector('.eng img').src = e.icon;
            input.placeholder = `Pesquise no ${e.name} ou digite um endereço`;
          } catch { /* ignora */ }
        };
        refresh();
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (text) api.browser.search(text);
        });
        el.querySelector('.eng').addEventListener('click', async (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          let list;
          try {
            list = await api.browser.engines();
          } catch {
            return;
          }
          showMenu(r.left, r.bottom + 6, [{ head: 'Buscador' }, ...list.engines.map((en) => ({
            label: en.name, img: en.icon, check: en.id === list.current,
            run: async () => {
              await api.browser.setEngine(en.id);
              refresh();
              toast(`Buscador: ${en.name}`);
            },
          }))]);
        });
        const onVis = () => {
          if (document.visibilityState === 'visible') refresh();
        };
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('focus', refresh);
        searchInput = input;
        return () => {
          document.removeEventListener('visibilitychange', onVis);
          window.removeEventListener('focus', refresh);
          if (searchInput === input) searchInput = null;
        };
      },
    },

    spotify: {
      name: 'Spotify', desc: 'Player com playlist, álbum ou música', icon: 'music', color: '#1ed760',
      size: () => ({ w: 340, h: 168 }), glass: () => true, resize: { minW: 260, maxW: 760, minH: 100, maxH: 560 },
      mount(el, w) {
        const src = spotifyEmbed(w.opts?.url);
        el.innerHTML = src
          ? `<div class="w-spotify"><iframe src="${esc(src)}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" title="Spotify"></iframe></div>`
          : '<div class="w-spotify"><div class="sp-empty">Cole um link do Spotify nos ajustes do widget (⚙)</div></div>';
      },
      settings: (w) => ({
        title: 'Spotify',
        html: `<label><span>Link de playlist, álbum, música, artista ou podcast</span><input name="url" value="${esc(w.opts.url || '')}" placeholder="https://open.spotify.com/playlist/…"></label>
          <div class="chips">${SPOTIFY_PRESETS.map(([n, u]) => `<button type="button" class="chip${u === w.opts.url ? ' on' : ''}" data-url="${esc(u)}">${esc(n)}</button>`).join('')}</div>
          <div class="p-row" style="margin-top:10px"><span class="grow">Tamanho</span>${segHtml('size', [['168', 'Compacto'], ['368', 'Grande']], String((w.h || 168) > 260 ? 368 : 168))}</div>
          <p class="p-note">Dica: no Spotify, clique em Compartilhar → Copiar link e cole aqui. Sem uma conta conectada, o player toca prévias de 30 segundos.</p>`,
        init: (f) => f.querySelectorAll('[data-url]').forEach((b) => b.addEventListener('click', () => {
          f.url.value = b.dataset.url;
          f.querySelectorAll('[data-url]').forEach((x) => x.classList.toggle('on', x === b));
        })),
        validate: (f) => (spotifyEmbed(f.url.value) ? null : 'Esse não parece um link do Spotify'),
        apply: (f, wd) => {
          wd.h = Number(segVal(f, 'size')) || 168;
          return { ...wd.opts, url: f.url.value.trim() };
        },
      }),
    },

    weather: {
      name: 'Clima', desc: 'Temperatura e previsão (Open-Meteo)', icon: 'cloud', color: '#5ab8ff',
      size: () => ({ w: 300, h: 176 }), glass: () => true,
      mount(el, w) {
        const o = w.opts || {};
        el.innerHTML = '<div class="w-weather"><div class="msg">Carregando o clima…</div></div>';
        let alive = true;
        (async () => {
          const data = await weather(o);
          if (!alive) return;
          const box = el.querySelector('.w-weather');
          if (!data) {
            box.innerHTML = `<div class="msg">Não foi possível carregar o clima${o.city ? ` de ${esc(o.city)}` : ''}.<br>Confira a cidade nos ajustes (⚙).</div>`;
            return;
          }
          const cur = data.current;
          const [desc, kind0] = WCODES[cur.weather_code] || ['—', 'cloud'];
          const kind = cur.is_day === 0 && kind0 === 'sun' ? 'moon' : kind0;
          const days = data.daily.time.slice(1, 5).map((t, i) => {
            const k = (WCODES[data.daily.weather_code[i + 1]] || [])[1] || 'cloud';
            const name = new Date(`${t}T12:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
            return `<div><span>${esc(name)}</span>${wx(k)}<b>${Math.round(data.daily.temperature_2m_max[i + 1])}°</b><span>${Math.round(data.daily.temperature_2m_min[i + 1])}°</span></div>`;
          }).join('');
          box.innerHTML = `<div class="now"><span class="wicon">${wx(kind)}</span><span class="temp">${Math.round(cur.temperature_2m)}°</span>
            <div><div class="city">${esc(o.city || '')}</div><div class="desc">${esc(desc)}</div>
            <div class="desc">Máx. ${Math.round(data.daily.temperature_2m_max[0])}° · Mín. ${Math.round(data.daily.temperature_2m_min[0])}°</div></div></div>
            <div class="days">${days}</div>`;
        })();
        return () => {
          alive = false;
        };
      },
      settings: (w) => ({
        title: 'Clima',
        html: `<label><span>Cidade</span><input name="city" value="${esc(w.opts.city || '')}" placeholder="Ex.: Rio de Janeiro"></label>
          <div class="chips" id="city-results"></div>
          <p class="p-note">Previsão do Open-Meteo, gratuita e sem conta.</p>`,
        validate: async (f) => {
          const name = f.city.value.trim();
          if (!name) return 'Digite uma cidade';
          if (f.dataset.pick) return null;
          try {
            const r = await api.fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=pt&format=json`);
            const list = (JSON.parse(r.text).results || []);
            if (!list.length) return 'Cidade não encontrada';
            const pick = list[0];
            f.dataset.pick = JSON.stringify({ city: pick.name, lat: pick.latitude, lon: pick.longitude });
            return null;
          } catch {
            return 'Sem conexão para procurar a cidade';
          }
        },
        init: (f) => f.city.addEventListener('input', () => delete f.dataset.pick),
        apply: (f, wd) => ({ ...wd.opts, ...JSON.parse(f.dataset.pick || '{}') }),
      }),
    },

    notes: {
      name: 'Notas', desc: 'Bloco de notas que salva sozinho', icon: 'note', color: '#ffd23b',
      size: () => ({ w: 300, h: 170 }), glass: () => true, resize: { minW: 200, maxW: 720, minH: 110, maxH: 640 },
      mount(el, w) {
        el.innerHTML = '<div class="w-notes"><div class="n-title">Notas</div><textarea placeholder="Escreva algo…" spellcheck="true"></textarea></div>';
        const ta = el.querySelector('textarea');
        ta.value = w.opts?.text || '';
        let t = 0;
        ta.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(() => {
            const wd = state.widgets.find((x) => x.id === w.id);
            if (!wd) return;
            wd.opts = { ...(wd.opts || {}), text: ta.value };
            mounted.get(w.id).sig = widgetSig(wd);
            save();
          }, 400);
        });
      },
    },

    calendar: {
      name: 'Calendário', desc: 'O mês atual', icon: 'cal', color: '#ff5a6e',
      size: () => ({ w: 250, h: 234 }), glass: () => true,
      mount(el) {
        const draw = () => {
          const now = new Date();
          const y = now.getFullYear();
          const m = now.getMonth();
          const first = new Date(y, m, 1).getDay();
          const days = new Date(y, m + 1, 0).getDate();
          const prevDays = new Date(y, m, 0).getDate();
          let cells = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d) => `<div class="h">${d}</div>`).join('');
          for (let i = 0; i < first; i++) cells += `<div class="d out">${prevDays - first + i + 1}</div>`;
          for (let d = 1; d <= days; d++) cells += `<div class="d${d === now.getDate() ? ' today' : ''}">${d}</div>`;
          const rest = (7 - ((first + days) % 7)) % 7;
          for (let i = 1; i <= rest; i++) cells += `<div class="d out">${i}</div>`;
          el.innerHTML = `<div class="w-cal"><div class="month">${esc(now.toLocaleDateString('pt-BR', { month: 'long' }))}<span>${y}</span></div><div class="grid">${cells}</div></div>`;
        };
        draw();
        const timer = setInterval(draw, 60_000);
        return () => clearInterval(timer);
      },
    },

    topsites: {
      name: 'Mais visitados', desc: 'Seus sites mais abertos', icon: 'trend', color: '#34c759',
      size: () => ({ w: 330, h: 196 }), glass: () => true,
      mount(el) {
        el.innerHTML = '<div class="w-top"></div>';
        api.browser.topSites(8).then((list) => {
          el.querySelector('.w-top').innerHTML = (list || []).slice(0, 8).map((s) => {
            const host = hostOf(s.url);
            const c = iconCache[host];
            if (host && !c) fetchIcon(host);
            const face = c && c.d ? `<img src="${esc(c.d)}" alt="">` : `<b>${esc((s.title || host || '?')[0].toUpperCase())}</b>`;
            return `<a href="${esc(s.url)}" data-host="${esc(host)}" title="${esc(s.title || s.url)}"><span class="mini">${face}</span><span>${esc(s.title || host)}</span></a>`;
          }).join('') || '<div class="msg">Navegue um pouco e seus sites aparecem aqui.</div>';
        }).catch(() => {});
      },
    },
  };

  let searchInput = null;
  const mounted = new Map(); // id -> { el, body, sig, cleanup }
  const widgetSig = (w) => JSON.stringify([w.type, w.opts || {}, w.w || 0, w.h || 0, state.clock24]);
  function sizeOf(w) {
    const def = WIDGETS[w.type].size(w);
    const r = WIDGETS[w.type].resize;
    let width = w.w || def.w;
    let height = r && r.fixedH ? def.h : w.h || def.h;
    width = Math.min(width, innerWidth - 32);
    height = Math.min(height, innerHeight - 32);
    return { w: width, h: height };
  }
  function areaFor(size) {
    const bottom = state.look.dock ? 92 : 16;
    return { x0: 16, y0: 16, x1: innerWidth - 16 - size.w, y1: innerHeight - bottom - size.h };
  }
  function placeWidget(w, el) {
    const size = sizeOf(w);
    const a = areaFor(size);
    const left = a.x0 + clamp(w.ax ?? 0.5, 0, 1) * Math.max(0, a.x1 - a.x0);
    const top = a.y0 + clamp(w.ay ?? 0.5, 0, 1) * Math.max(0, a.y1 - a.y0);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.width = `${size.w}px`;
    el.style.height = `${size.h}px`;
    return size;
  }
  function renderWidgets() {
    const box = $('#widgets');
    const keep = new Set();
    state.widgets.forEach((w, i) => {
      const def = WIDGETS[w.type];
      if (!def) return;
      keep.add(w.id);
      let m = mounted.get(w.id);
      const sig = widgetSig(w);
      if (!m || m.sig !== sig) {
        if (m) {
          m.cleanup?.();
          m.el.remove();
        }
        const el = document.createElement('div');
        el.className = `widget w-${w.type}-box${firstRender || (m && m.isNew) ? ' appear' : ''}`;
        el.dataset.wid = w.id;
        el.style.setProperty('--i', String(i));
        // O vidro fica numa camada própria atrás do conteúdo: com o desfoque no próprio widget,
        // o Chromium borra por cima de iframes de outros sites (ex.: o player do Spotify).
        el.innerHTML = `<div class="w-glass"></div><div class="w-handle" title="Arraste para mover"></div>
          <div class="w-tools">${def.settings ? `<button data-wt="settings" title="Ajustes do widget">${svg('gear')}</button>` : ''}<button data-wt="remove" title="Remover widget">${svg('x')}</button></div>
          <div class="w-body"></div>${def.resize ? '<div class="w-resize" title="Redimensionar"></div>' : ''}`;
        box.appendChild(el);
        m = { el, body: el.querySelector('.w-body'), sig, cleanup: null };
        mounted.set(w.id, m);
        m.cleanup = def.mount(m.body, w) || null;
      }
      m.el.classList.toggle('glass', def.glass(w));
      const size = placeWidget(w, m.el);
      const glassEl = m.el.querySelector('.w-glass');
      if (def.glass(w)) glassFor(glassEl, size.w, size.h, 28, { scale: Math.round(clamp(Math.min(size.w, size.h) * 0.45, 30, 80)) });
      else glassEl.style.backdropFilter = '';
    });
    for (const [id, m] of mounted) {
      if (keep.has(id)) continue;
      m.cleanup?.();
      m.el.remove();
      mounted.delete(id);
    }
  }
  function addWidget(type) {
    const def = WIDGETS[type];
    if (!def) return;
    const w = { id: uid(), type, ax: 0.5, ay: 0.55, opts: {} };
    if (type === 'spotify') w.opts.url = SPOTIFY_PRESETS[0][1];
    if (type === 'weather') Object.assign(w.opts, { city: 'São Paulo', lat: -23.5475, lon: -46.63611 });
    if (type === 'clock') Object.assign(w.opts, { style: 'digital', greet: true });
    state.widgets.push(w);
    save();
    renderWidgets();
    const m = mounted.get(w.id);
    m?.el.classList.add('appear');
    toast(`Widget "${def.name}" adicionado — arraste pela alça de cima`);
  }

  // Clima com cache de 20 minutos.
  const weatherMem = new Map();
  async function weather(o) {
    if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) return null;
    const key = `${o.lat.toFixed(2)},${o.lon.toFixed(2)}`;
    const now = Date.now();
    const mem = weatherMem.get(key);
    if (mem && now - mem.t < 20 * 60e3) return mem.data;
    let stored = null;
    try {
      stored = await api.storage.get('weather');
    } catch { /* ignora */ }
    if (stored && stored.key === key && now - stored.t < 20 * 60e3) return stored.data;
    try {
      const r = await api.fetch(`https://api.open-meteo.com/v1/forecast?latitude=${o.lat}&longitude=${o.lon}&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`);
      const data = JSON.parse(r.text);
      if (!data.current || !data.daily) throw new Error('resposta inválida');
      weatherMem.set(key, { t: now, data });
      api.storage.set('weather', { key, t: now, data }).catch(() => {});
      return data;
    } catch {
      return stored && stored.key === key ? stored.data : null;
    }
  }

  // ---------------------------------------------------------------- Menu e aviso
  const menu = $('#menu');
  let menuItems = [];
  function showMenu(x, y, items) {
    menuItems = items;
    menu.innerHTML = items.map((it, i) => {
      if (it === 'sep') return '<div class="sep"></div>';
      if (it.head) return `<div class="mh">${esc(it.head)}</div>`;
      const ic = it.img ? `<img src="${esc(it.img)}" alt="">` : it.icon ? svg(it.icon) : '';
      return `<button data-i="${i}" class="${it.danger ? 'danger' : ''}"><span class="mi">${ic}</span>${esc(it.label)}${it.check ? '<span class="chk">✓</span>' : ''}</button>`;
    }).join('');
    menu.hidden = false;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const left = x + w > innerWidth - 8 ? Math.max(8, x - w) : x;
    const top = y + h > innerHeight - 8 ? Math.max(8, y - h) : y;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.setProperty('--ox', left < x ? 'right' : 'left');
    menu.style.setProperty('--oy', top < y ? 'bottom' : 'top');
  }
  const hideMenu = () => {
    menu.hidden = true;
  };
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const it = menuItems[Number(b.dataset.i)];
    hideMenu();
    it?.run?.();
  });

  const toastEl = $('#toast');
  let toastTimer = 0;
  function toast(text, action) {
    toastEl.innerHTML = `<span>${esc(text)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
    toastEl.hidden = false;
    toastEl.style.animation = 'none';
    void toastEl.offsetWidth;
    toastEl.style.animation = '';
    if (action) toastEl.querySelector('button').onclick = () => {
      toastEl.hidden = true;
      action.run();
    };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, action ? 6000 : 2600);
  }

  // Desfazer (remover ícones, widgets, restaurar padrão).
  let undoSnap = null;
  function snapshot() {
    undoSnap = JSON.stringify(state);
  }
  function undo() {
    if (!undoSnap) return;
    state = migrate(JSON.parse(undoSnap));
    undoSnap = null;
    save();
    renderAll();
  }

  // ---------------------------------------------------------------- Janela de edição
  const modal = $('#modal');
  const dialog = $('#dialog');
  let dialogCtx = null;
  const seg = (name, label, options, value) => `<div class="p-row"><span class="grow">${esc(label)}</span>${segHtml(name, options, value)}</div>`;
  const segHtml = (name, options, value) => `<span class="seg" data-seg="${name}">${options.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${String(v) === String(value) ? 'on' : ''}">${esc(l)}</button>`).join('')}</span>`;
  const segVal = (root, name) => root.querySelector(`[data-seg="${name}"] .on`)?.dataset.v;
  const toggleRow = (name, label, on, hint = '') => `<div class="p-row"><span class="grow">${esc(label)}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</span><label class="toggle"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}></label></div>`;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.seg button');
    if (!b) return;
    b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    b.parentElement.dispatchEvent(new CustomEvent('segchange', { bubbles: true, detail: b.dataset.v }));
  });

  function openDialog({ title, html, init, validate, submit, okLabel = 'Salvar' }) {
    dialog.innerHTML = `<h2>${esc(title)}</h2>${html}<div class="err" hidden></div>
      <div class="actions"><button type="button" class="btn" data-cancel>Cancelar</button><button type="submit" class="btn primary">${esc(okLabel)}</button></div>`;
    dialogCtx = { validate, submit };
    modal.hidden = false;
    init?.(dialog);
    setTimeout(() => dialog.querySelector('input:not([type=checkbox])')?.focus(), 40);
  }
  function closeDialog() {
    modal.hidden = true;
    dialogCtx = null;
  }
  dialog.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!dialogCtx) return;
    const err = dialog.querySelector('.err');
    const msg = dialogCtx.validate ? await dialogCtx.validate(dialog) : null;
    if (msg) {
      err.textContent = msg;
      err.hidden = false;
      return;
    }
    const ok = await dialogCtx.submit(dialog);
    if (ok !== false) closeDialog();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-cancel]')) closeDialog();
  });
  modal.addEventListener('mousedown', (e) => {
    if (e.target === modal) closeDialog();
  });

  let pendingIcon = undefined;
  function editItem(item) {
    const isNew = !item;
    const it = item || { title: '', url: '' };
    pendingIcon = undefined;
    openDialog({
      title: isNew ? 'Novo atalho' : 'Editar atalho',
      okLabel: isNew ? 'Adicionar' : 'Salvar',
      html: `<div class="row" style="margin-bottom:12px"><span class="tile prev"><span class="tint" style="--c:${esc(colorOf(it))}"></span><span class="face">${faceHtml(it)}</span></span>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn" data-pick>Escolher imagem</button>${it.icon ? '<button type="button" class="btn" data-auto>Ícone automático</button>' : ''}</div></div>
        <label><span>Nome</span><input name="title" value="${esc(it.title)}" maxlength="40" placeholder="Ex.: YouTube"></label>
        <label><span>Endereço</span><input name="url" value="${esc(it.url)}" placeholder="youtube.com"></label>`,
      init: (f) => {
        f.querySelector('[data-pick]').addEventListener('click', () => $('#file-icon').click());
        f.querySelector('[data-auto]')?.addEventListener('click', () => {
          pendingIcon = null;
          f.querySelector('.prev .face').innerHTML = faceHtml({ ...it, icon: null });
        });
      },
      validate: (f) => (f.url.value.trim() ? null : 'Digite o endereço do site'),
      submit: async (f) => {
        let url = f.url.value.trim();
        if (!/^[a-z][\w+.-]*:/i.test(url)) url = await api.browser.resolve(url).catch(() => `https://${url}`);
        const title = f.title.value.trim() || hostOf(url) || url;
        if (isNew) {
          const cell = firstFreeCell();
          state.items.push({ id: uid(), title, url, place: 'desk', ...cell, ...(pendingIcon ? { icon: pendingIcon } : {}) });
        } else {
          item.title = title;
          item.url = url;
          if (pendingIcon !== undefined) item.icon = pendingIcon || undefined;
        }
        save();
        renderIcons();
        renderDock();
        return true;
      },
    });
  }
  $('#file-icon').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const url = await resizeImage(file, 128);
    if (!url) return toast('Imagem inválida');
    pendingIcon = url;
    const face = dialog.querySelector('.prev .face');
    if (face) face.innerHTML = `<img class="logo" src="${esc(url)}" alt="">`;
  });
  function resizeImage(file, size) {
    return new Promise((resolve) => {
      const img = new Image();
      const u = URL.createObjectURL(file);
      img.onload = () => {
        const c = document.createElement('canvas');
        const k = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = u;
    });
  }

  function widgetSettings(w) {
    const def = WIDGETS[w.type];
    if (!def?.settings) return;
    w.opts = w.opts || {};
    const s = def.settings(w);
    openDialog({
      title: s.title,
      html: s.html,
      init: s.init,
      validate: s.validate,
      submit: (f) => {
        w.opts = s.apply(f, w);
        save();
        renderWidgets();
        return true;
      },
    });
  }

  // ---------------------------------------------------------------- Painel de ajustes
  const panel = $('#panel');
  let panelTab = 'wallpaper';
  function openPanel(tab = panelTab) {
    panelTab = tab;
    panel.classList.remove('leaving');
    panel.hidden = false;
    $$('#panel-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    renderPanel();
  }
  function closePanel() {
    if (panel.hidden) return;
    panel.classList.add('leaving');
    setTimeout(() => {
      panel.hidden = true;
      panel.classList.remove('leaving');
    }, 240);
  }
  $('#panel-close').addEventListener('click', closePanel);
  $('#panel-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) openPanel(b.dataset.tab);
  });

  function renderPanel() {
    const body = $('#panel-body');
    const w = state.wallpaper;
    if (panelTab === 'wallpaper') {
      const presets = Object.entries(WALLS).map(([id, p]) => `<button class="wall-opt${w.kind === 'preset' && w.preset === id ? ' on' : ''}" data-wall="${id}" style="background:${wallCss(p)}"><span>${esc(p.name)}</span></button>`).join('');
      body.innerHTML = `<div class="p-sec">Cores</div><div class="walls">${presets}</div>
        <div class="p-sec">Imagens</div>
        <div class="walls">
          <button class="wall-opt special${w.kind === 'bing' ? ' on' : ''}" data-wall-kind="bing"><div>${svg('sparkles')}Foto do dia</div></button>
          <button class="wall-opt special${w.kind === 'custom' ? ' on' : ''}" data-wall-kind="file"><div>${svg('image')}Imagem ou vídeo</div></button>
          <button class="wall-opt special${w.kind === 'url' ? ' on' : ''}" data-wall-kind="url"><div>${svg('globe')}Da internet</div></button>
        </div>
        <div class="p-sec">Ajustes</div>
        <div class="p-row"><span class="grow">Escurecer</span><input type="range" min="0" max="0.7" step="0.02" value="${w.dim}" data-range="dim"></div>
        <div class="p-row"><span class="grow">Desfoque<div class="hint">Para fotos e vídeos</div></span><input type="range" min="0" max="24" step="1" value="${w.blur}" data-range="blur"></div>
        ${toggleRow('motion', 'Cores em movimento', !!w.motion, 'Anima suavemente o papel de parede de cores')}`;
    } else if (panelTab === 'widgets') {
      const count = (t) => state.widgets.filter((x) => x.type === t).length;
      body.innerHTML = `<div class="p-sec">Adicionar widget</div><div class="gallery">${Object.entries(WIDGETS).map(([type, d]) => `<button class="gal" data-add="${type}">
          <span class="gi" style="background:${d.color}33;color:${d.color}">${svg(d.icon)}</span><b>${esc(d.name)}</b><span>${esc(d.desc)}</span>${count(type) ? `<span class="added">${count(type)} na tela</span>` : ''}</button>`).join('')}</div>
        <p class="p-note">Passe o mouse sobre um widget e arraste pela alça de cima para mover. Clique com o botão direito para ajustar ou remover.</p>`;
    } else if (panelTab === 'icons') {
      const l = state.look;
      body.innerHTML = `<div class="p-sec">Ícones</div>
        <div class="p-row"><span class="grow">Tamanho</span><input type="range" min="48" max="92" step="2" value="${l.size}" data-range="size"></div>
        ${seg('style', 'Estilo do vidro', [['glass', 'Vidro'], ['color', 'Colorido'], ['dark', 'Escuro']], l.style)}
        ${toggleRow('labels', 'Mostrar nomes', l.labels)}
        ${toggleRow('refraction', 'Refração do vidro líquido', l.refraction, 'Desligue se o computador ficar lento')}
        ${toggleRow('dock', 'Mostrar a dock', l.dock)}
        <div class="p-sec">Organizar</div>
        <div class="p-row" style="gap:8px;flex-wrap:wrap"><button class="btn" data-act="new-icon">Novo atalho</button><button class="btn" data-act="arrange">Organizar por nome</button><button class="btn" data-act="top">Adicionar mais visitados</button></div>
        <p class="p-note">Arraste os ícones para qualquer lugar, ou para a dock. Clique com o botão direito num ícone para editar, trocar a imagem ou remover.</p>`;
    } else {
      body.innerHTML = `<div class="p-sec">Relógio</div>
        ${toggleRow('clock24', 'Formato 24 horas', state.clock24 !== false)}
        <div class="p-sec">Desktop</div>
        <div class="p-row" style="gap:8px;flex-wrap:wrap"><button class="btn" data-act="edit">Editar desktop</button><button class="btn danger" data-act="reset">Restaurar padrão</button></div>
        <p class="p-note">O Desktop é uma extensão de fábrica do tuff.browse. Para voltar à nova aba normal, desative-a na página de extensões. Você também pode duplicá-la e editar o código.</p>
        <div class="p-row"><button class="btn" data-act="extensions">Abrir extensões</button></div>`;
    }
  }
  $('#panel-body').addEventListener('click', async (e) => {
    const t = e.target;
    const wall = t.closest('[data-wall]');
    if (wall) {
      state.wallpaper = { ...state.wallpaper, kind: 'preset', preset: wall.dataset.wall };
      save();
      applyWallpaper();
      renderPanel();
      return;
    }
    const kind = t.closest('[data-wall-kind]');
    if (kind) {
      const k = kind.dataset.wallKind;
      if (k === 'file') $('#file-wall').click();
      else if (k === 'bing') {
        state.wallpaper = { ...state.wallpaper, kind: 'bing' };
        save();
        applyWallpaper();
        renderPanel();
      } else {
        openDialog({
          title: 'Papel de parede da internet',
          html: `<label><span>Endereço da imagem (ou vídeo .mp4/.webm)</span><input name="url" value="${esc(state.wallpaper.url || '')}" placeholder="https://…/foto.jpg"></label>`,
          validate: (f) => (/^https?:\/\//i.test(f.url.value.trim()) ? null : 'Use um endereço que comece com https://'),
          submit: (f) => {
            state.wallpaper = { ...state.wallpaper, kind: 'url', url: f.url.value.trim() };
            save();
            applyWallpaper();
            renderPanel();
          },
        });
      }
      return;
    }
    const add = t.closest('[data-add]');
    if (add) {
      addWidget(add.dataset.add);
      renderPanel();
      return;
    }
    const a = t.closest('[data-act]');
    if (!a) return;
    switch (a.dataset.act) {
      case 'new-icon': editItem(null); break;
      case 'arrange': arrange(); break;
      case 'top': addTopSites(); break;
      case 'edit': closePanel(); setEditing(true); break;
      case 'extensions': api.tabs.create({ url: 'tuff://extensions/#desktop' }); break;
      case 'reset':
        snapshot();
        state = defaults();
        save();
        renderAll();
        renderPanel();
        toast('Desktop restaurado', { label: 'Desfazer', run: undo });
        break;
      default: break;
    }
  });
  $('#panel-body').addEventListener('input', (e) => {
    const r = e.target.closest('[data-range]');
    if (!r) return;
    const v = Number(r.value);
    if (r.dataset.range === 'size') {
      state.look.size = v;
      applyLook();
      renderIcons();
    } else {
      state.wallpaper[r.dataset.range] = v;
      applyWallpaper();
    }
    save();
  });
  $('#panel-body').addEventListener('change', (e) => {
    const c = e.target;
    if (c.type !== 'checkbox') return;
    if (c.name === 'motion') state.wallpaper.motion = c.checked;
    else if (c.name === 'clock24') state.clock24 = c.checked;
    else if (c.name in state.look) state.look[c.name] = c.checked;
    save();
    renderAll();
  });
  $('#panel-body').addEventListener('segchange', (e) => {
    if (e.target.dataset.seg === 'style') {
      state.look.style = e.detail;
      save();
      applyLook();
      renderDock();
    }
  });
  $('#file-wall').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 300 * 1024 * 1024) return toast('Arquivo grande demais (máximo 300 MB)');
    try {
      await idb.put('wallpaper', { blob: file, type: file.type, name: file.name });
      state.wallpaper = { ...state.wallpaper, kind: 'custom', fileId: uid() };
      save();
      applyWallpaper();
      renderPanel();
    } catch {
      toast('Não foi possível salvar o arquivo');
    }
  });

  function arrange() {
    const desk = state.items.filter((i) => i.place === 'desk').sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
    desk.forEach((it, i) => {
      it.col = Math.floor(i / grid.rows);
      it.row = i % grid.rows;
    });
    save();
    renderIcons();
  }
  async function addTopSites() {
    const list = await api.browser.topSites(12).catch(() => []);
    let n = 0;
    for (const s of list || []) {
      const h = hostOf(s.url);
      if (state.items.some((i) => hostOf(i.url) === h)) continue;
      const cell = firstFreeCell();
      state.items.push({ id: uid(), title: s.title || h, url: s.url, place: 'desk', ...cell });
      n++;
      renderIcons();
    }
    save();
    toast(n ? `${n} site(s) adicionado(s)` : 'Seus sites mais visitados já estão no desktop');
  }

  // ---------------------------------------------------------------- Modo de edição
  function setEditing(on) {
    document.body.classList.toggle('editing', on);
    $('#editbar').hidden = !on;
    hideMenu();
  }
  $('#editbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) command(b.dataset.cmd);
  });
  $('#dock').addEventListener('click', (e) => {
    const b = e.target.closest('.dock-btn');
    if (b) command(b.dataset.cmd);
  });
  function command(cmd) {
    switch (cmd) {
      case 'done': setEditing(false); break;
      case 'edit': setEditing(true); break;
      case 'widgets': openPanel('widgets'); break;
      case 'wallpaper': openPanel('wallpaper'); break;
      case 'settings': openPanel(panel.hidden || panelTab === 'wallpaper' ? 'wallpaper' : panelTab); break;
      case 'new-icon': editItem(null); break;
      default: break;
    }
  }

  function removeItems(ids) {
    if (!ids.length) return;
    snapshot();
    state.items = state.items.filter((i) => !ids.includes(i.id));
    selection = new Set();
    save();
    renderIcons();
    renderDock();
    toast(ids.length > 1 ? `${ids.length} atalhos removidos` : 'Atalho removido', { label: 'Desfazer', run: undo });
  }
  function removeWidget(id) {
    snapshot();
    state.widgets = state.widgets.filter((w) => w.id !== id);
    save();
    renderWidgets();
    toast('Widget removido', { label: 'Desfazer', run: undo });
  }

  // ---------------------------------------------------------------- Arrastar ícones (área de trabalho e dock)
  const desk = $('#desk');
  let drag = null;
  const itemById = (id) => state.items.find((i) => i.id === id);

  function startPress(e, item, srcEl) {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    const rect = srcEl.getBoundingClientRect();
    drag = { item, srcEl, start, rect, active: false, ghost: null, float: null, over: null };
    srcEl.setPointerCapture(e.pointerId);
  }
  function beginDrag() {
    drag.active = true;
    hideMenu();
    const { item, srcEl, rect } = drag;
    const f = document.createElement('div');
    f.className = 'icon dragging';
    f.style.position = 'fixed';
    f.innerHTML = `<span class="tile"><span class="tint" style="--c:${esc(colorOf(item))}"></span><span class="face">${faceHtml(item)}</span></span><span class="label">${esc(item.title)}</span>`;
    document.body.appendChild(f);
    drag.float = f;
    const s = state.look.size;
    drag.offset = { x: drag.start.x - (rect.left + rect.width / 2) + (s + 42) / 2, y: Math.min(drag.start.y - rect.top, s / 2 + 6) };
    srcEl.style.opacity = '0.25';
    const g = document.createElement('div');
    g.className = 'drop-ghost';
    g.hidden = true;
    $('#icons').appendChild(g);
    drag.ghost = g;
  }
  function moveDrag(e) {
    const f = drag.float;
    const x = e.clientX - drag.offset.x;
    const y = e.clientY - drag.offset.y;
    f.style.left = `${x}px`;
    f.style.top = `${y}px`;
    const dockRect = $('#dock').getBoundingClientRect();
    const overDock = state.look.dock && e.clientY > dockRect.top - 24 && e.clientX > dockRect.left - 40 && e.clientX < dockRect.right + 40;
    $('#dock').classList.toggle('drop-target', overDock);
    $$('.dock-item.drop-before').forEach((d) => d.classList.remove('drop-before'));
    if (overDock) {
      drag.ghost.hidden = true;
      const items = $$('.dock-item').filter((d) => d.dataset.id !== drag.item.id);
      let before = null;
      for (const d of items) {
        const r = d.getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) {
          before = d;
          break;
        }
      }
      before?.classList.add('drop-before');
      drag.over = { dock: true, beforeId: before ? before.dataset.id : null };
      return;
    }
    const col = clamp(Math.round((x - PAD) / grid.cw), 0, grid.cols - 1);
    const row = clamp(Math.round((y - PAD) / grid.ch), 0, grid.rows - 1);
    const { x: gx, y: gy } = cellXY(col, row);
    drag.ghost.hidden = false;
    drag.ghost.style.left = `${gx}px`;
    drag.ghost.style.top = `${gy}px`;
    drag.over = { dock: false, col, row };
  }
  function endDrag() {
    const { item, over } = drag;
    drag.float?.remove();
    drag.ghost?.remove();
    drag.srcEl.style.opacity = '';
    $('#dock').classList.remove('drop-target');
    $$('.dock-item.drop-before').forEach((d) => d.classList.remove('drop-before'));
    if (!over) return;
    if (over.dock) {
      const dockItems = state.items.filter((i) => i.place === 'dock' && i.id !== item.id).sort((a, b) => a.order - b.order);
      let idx = over.beforeId ? dockItems.findIndex((i) => i.id === over.beforeId) : dockItems.length;
      if (idx < 0) idx = dockItems.length;
      dockItems.splice(idx, 0, item);
      item.place = 'dock';
      dockItems.forEach((it, i) => {
        it.order = i;
      });
    } else {
      // Se a casa estiver ocupada, os dois ícones trocam de lugar.
      const pos = placeDesk();
      const occupant = state.items.find((i) => i.place === 'desk' && i.id !== item.id && pos.get(i.id)?.col === over.col && pos.get(i.id)?.row === over.row);
      if (occupant) {
        const mine = item.place === 'desk' ? pos.get(item.id) : null;
        if (mine) {
          occupant.col = mine.col;
          occupant.row = mine.row;
        } else {
          Object.assign(occupant, firstFreeCellExcept(over));
        }
      }
      item.place = 'desk';
      item.col = over.col;
      item.row = over.row;
    }
    save();
    renderIcons();
    renderDock();
  }
  function firstFreeCellExcept(cell) {
    const pos = placeDesk();
    const taken = new Set([...pos.values()].map((p) => `${p.col},${p.row}`));
    taken.add(`${cell.col},${cell.row}`);
    for (let c = 0; c < grid.cols; c++) for (let r = 0; r < grid.rows; r++) if (!taken.has(`${c},${r}`)) return { col: c, row: r };
    return { col: 0, row: 0 };
  }

  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) hideMenu();
    const iconEl = e.target.closest('.icon:not(.dragging), .dock-item');
    if (iconEl && !e.target.closest('[data-rm]')) {
      const item = itemById(iconEl.dataset.id);
      if (item) startPress(e, item, iconEl);
    }
  });
  document.addEventListener('pointermove', (e) => {
    if (drag) {
      if (!drag.active && Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) > 5) beginDrag();
      if (drag.active) moveDrag(e);
    } else if (marquee) moveMarquee(e);
  });
  document.addEventListener('pointerup', (e) => {
    if (drag) {
      const d = drag;
      drag = null;
      if (d.active) {
        drag = d;
        endDrag();
        drag = null;
        return;
      }
      if (e.button !== 0) return;
      // Clique simples: abre o site (Ctrl ou botão do meio: nova aba).
      if (document.body.classList.contains('editing')) {
        editItem(d.item);
        return;
      }
      if (d.srcEl.classList.contains('icon') && (e.shiftKey)) {
        toggleSel(d.item.id);
        return;
      }
      open(d.item.url, { newTab: e.ctrlKey || e.metaKey, background: e.ctrlKey || e.metaKey });
    } else if (marquee) endMarquee(e);
  });
  document.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const el = e.target.closest('.icon, .dock-item');
    const item = el && itemById(el.dataset.id);
    if (item) {
      e.preventDefault();
      open(item.url, { newTab: true, background: true });
    }
  });
  $('#icons').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) removeItems([rm.closest('.icon').dataset.id]);
  });

  // ---------------------------------------------------------------- Seleção com retângulo
  let marquee = null;
  const marqueeEl = $('#marquee');
  function toggleSel(id) {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    renderIcons();
  }
  desk.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.icon, .widget')) return;
    if (!panel.hidden && !panel.contains(e.target)) closePanel();
    marquee = { x: e.clientX, y: e.clientY, moved: false, add: e.shiftKey || e.ctrlKey, base: new Set(selection) };
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  });
  function moveMarquee(e) {
    const x0 = Math.min(marquee.x, e.clientX);
    const y0 = Math.min(marquee.y, e.clientY);
    const w = Math.abs(e.clientX - marquee.x);
    const h = Math.abs(e.clientY - marquee.y);
    if (!marquee.moved && w + h < 6) return;
    marquee.moved = true;
    Object.assign(marqueeEl.style, { left: `${x0}px`, top: `${y0}px`, width: `${w}px`, height: `${h}px` });
    marqueeEl.hidden = false;
    const next = new Set(marquee.add ? marquee.base : []);
    for (const el of $$('#icons .icon')) {
      const r = el.getBoundingClientRect();
      if (r.right > x0 && r.left < x0 + w && r.bottom > y0 && r.top < y0 + h) next.add(el.dataset.id);
    }
    selection = next;
    for (const el of $$('#icons .icon')) el.classList.toggle('sel', selection.has(el.dataset.id));
  }
  function endMarquee() {
    if (!marquee.moved && !marquee.add && selection.size) {
      selection = new Set();
      renderIcons();
    }
    marquee = null;
    marqueeEl.hidden = true;
  }

  // ---------------------------------------------------------------- Arrastar e redimensionar widgets
  let wdrag = null;
  document.addEventListener('pointerdown', (e) => {
    const wel = e.target.closest('.widget');
    if (!wel || e.button !== 0) return;
    const tool = e.target.closest('[data-wt]');
    if (tool) return;
    const resize = e.target.closest('.w-resize');
    const handle = e.target.closest('.w-handle');
    const editing = document.body.classList.contains('editing');
    if (!resize && !handle && !editing) return;
    e.preventDefault();
    const w = state.widgets.find((x) => x.id === wel.dataset.wid);
    if (!w) return;
    const r = wel.getBoundingClientRect();
    wdrag = { w, el: wel, mode: resize ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, r };
    wel.classList.add('dragging');
    wel.setPointerCapture(e.pointerId);
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (!wdrag) return;
    const { el, r, mode, w } = wdrag;
    const dx = e.clientX - wdrag.sx;
    const dy = e.clientY - wdrag.sy;
    if (mode === 'move') {
      el.style.left = `${clamp(r.left + dx, 0, innerWidth - r.width)}px`;
      el.style.top = `${clamp(r.top + dy, 0, innerHeight - r.height)}px`;
    } else {
      const lim = WIDGETS[w.type].resize || {};
      const nw = clamp(r.width + dx, lim.minW || 160, Math.min(lim.maxW || 900, innerWidth - r.left - 8));
      const nh = lim.fixedH ? r.height : clamp(r.height + dy, lim.minH || 100, Math.min(lim.maxH || 700, innerHeight - r.top - 8));
      el.style.width = `${nw}px`;
      el.style.height = `${nh}px`;
    }
  });
  document.addEventListener('pointerup', () => {
    if (!wdrag) return;
    const { el, w, mode } = wdrag;
    wdrag = null;
    el.classList.remove('dragging');
    const rect = el.getBoundingClientRect();
    if (mode === 'resize') {
      w.w = Math.round(rect.width);
      if (!WIDGETS[w.type].resize?.fixedH) w.h = Math.round(rect.height);
    }
    const size = sizeOf(w);
    const a = areaFor(size);
    w.ax = a.x1 > a.x0 ? clamp((rect.left - a.x0) / (a.x1 - a.x0), 0, 1) : 0.5;
    w.ay = a.y1 > a.y0 ? clamp((rect.top - a.y0) / (a.y1 - a.y0), 0, 1) : 0.5;
    // Só reposiciona (sem recarregar o conteúdo, ex.: o player do Spotify continua tocando).
    const m = mounted.get(w.id);
    if (m) m.sig = widgetSig(w);
    save();
    renderWidgets();
  });
  $('#widgets').addEventListener('click', (e) => {
    const t = e.target.closest('[data-wt]');
    if (!t) return;
    const id = t.closest('.widget').dataset.wid;
    const w = state.widgets.find((x) => x.id === id);
    if (!w) return;
    if (t.dataset.wt === 'remove') removeWidget(id);
    else widgetSettings(w);
  });

  // ---------------------------------------------------------------- Menu do botão direito
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, textarea, #panel, .dialog')) return; // menu normal para copiar/colar
    e.preventDefault();
    const iconEl = e.target.closest('.icon, .dock-item');
    const wel = e.target.closest('.widget');
    if (iconEl) {
      const it = itemById(iconEl.dataset.id);
      if (!it) return;
      const inDock = it.place === 'dock';
      const ids = selection.has(it.id) && selection.size > 1 ? [...selection] : [it.id];
      showMenu(e.clientX, e.clientY, [
        { label: 'Abrir', icon: 'open', run: () => open(it.url) },
        { label: 'Abrir em nova aba', icon: 'external', run: () => open(it.url, { newTab: true }) },
        'sep',
        { label: 'Editar atalho…', icon: 'pencil', run: () => editItem(it) },
        inDock
          ? { label: 'Mover para a área de trabalho', icon: 'grid', run: () => { Object.assign(it, { place: 'desk', ...firstFreeCell() }); save(); renderIcons(); renderDock(); } }
          : { label: 'Fixar na dock', icon: 'dock', run: () => { it.place = 'dock'; it.order = 999; save(); renderIcons(); renderDock(); } },
        'sep',
        { label: ids.length > 1 ? `Remover ${ids.length} atalhos` : 'Remover', icon: 'trash', danger: true, run: () => removeItems(ids) },
      ]);
      return;
    }
    if (wel) {
      const w = state.widgets.find((x) => x.id === wel.dataset.wid);
      if (!w) return;
      const def = WIDGETS[w.type];
      showMenu(e.clientX, e.clientY, [
        { head: def.name },
        ...(def.settings ? [{ label: 'Ajustes do widget…', icon: 'gear', run: () => widgetSettings(w) }] : []),
        { label: 'Editar desktop', icon: 'pencil', run: () => setEditing(true) },
        'sep',
        { label: 'Remover widget', icon: 'trash', danger: true, run: () => removeWidget(w.id) },
      ]);
      return;
    }
    showMenu(e.clientX, e.clientY, [
      { label: 'Novo atalho…', icon: 'plus', run: () => editItem(null) },
      { label: 'Adicionar widget…', icon: 'grid', run: () => openPanel('widgets') },
      { label: 'Trocar papel de parede…', icon: 'image', run: () => openPanel('wallpaper') },
      'sep',
      { label: 'Organizar ícones por nome', icon: 'sort', run: arrange },
      { label: document.body.classList.contains('editing') ? 'Concluir edição' : 'Editar desktop', icon: 'pencil', run: () => setEditing(!document.body.classList.contains('editing')) },
      'sep',
      { label: 'Mostrar a dock', icon: 'dock', check: state.look.dock, run: () => { state.look.dock = !state.look.dock; save(); renderAll(); } },
      { label: 'Mostrar nomes dos ícones', icon: 'type', check: state.look.labels, run: () => { state.look.labels = !state.look.labels; save(); applyLook(); } },
      { label: 'Ajustes do desktop…', icon: 'gear', run: () => openPanel('icons') },
    ]);
  });

  // ---------------------------------------------------------------- Teclado
  document.addEventListener('keydown', (e) => {
    const inField = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape') {
      if (!menu.hidden) return hideMenu();
      if (!modal.hidden) return closeDialog();
      if (!panel.hidden) return closePanel();
      if (document.body.classList.contains('editing')) return setEditing(false);
      if (selection.size) {
        selection = new Set();
        renderIcons();
      }
      return;
    }
    if (inField) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) {
      e.preventDefault();
      removeItems([...selection]);
      return;
    }
    if (e.key === 'Enter' && selection.size) {
      const it = itemById([...selection][0]);
      if (it) open(it.url);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selection = new Set(state.items.filter((i) => i.place === 'desk').map((i) => i.id));
      renderIcons();
      return;
    }
    // Começou a digitar: vai para a pesquisa.
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && searchInput && modal.hidden) searchInput.focus();
  });

  // ---------------------------------------------------------------- Montagem
  function renderAll() {
    applyLook();
    applyWallpaper();
    renderIcons();
    renderDock();
    renderWidgets();
  }

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      renderIcons();
      renderWidgets();
    });
  });

  // Pedidos vindos do pop-up da extensão (botão na barra).
  async function handleCmd(c) {
    if (!c || !c.cmd || Date.now() - (c.t || 0) > 5000 || document.visibilityState !== 'visible') return;
    api.storage.remove?.('cmd');
    if (c.cmd === 'edit') setEditing(true);
    else command(c.cmd);
  }

  api.storage.onChanged((changes) => {
    if (changes.desktop && changes.desktop.rev !== lastRev) {
      state = migrate(changes.desktop);
      lastRev = state.rev;
      renderAll();
      if (!panel.hidden) renderPanel();
    }
    if ('cmd' in changes) handleCmd(changes.cmd);
  });

  try {
    const [stored, icons, cmd] = await Promise.all([api.storage.get('desktop'), api.storage.get('icons-v2'), api.storage.get('cmd')]);
    iconCache = icons && typeof icons === 'object' ? icons : {};
    state = migrate(stored);
    lastRev = state.rev || null;
    if (!stored) save();
    renderAll();
    firstRender = false;
    setTimeout(() => $$('.appear').forEach((el) => el.classList.remove('appear')), 1500);
    handleCmd(cmd);
  } catch (err) {
    console.error('[Desktop]', err);
    state = defaults();
    renderAll();
  }
})();
