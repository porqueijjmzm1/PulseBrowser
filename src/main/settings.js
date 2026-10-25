'use strict';
const { EventEmitter } = require('events');
const { JsonStore } = require('./store');

// Buscadores. Cada um tem uma marca simples (cor + letra) desenhada aqui mesmo, sem baixar ícones.
const ENGINES = {
  google: {
    name: 'Google',
    search: 'https://www.google.com/search?q=%s',
    suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&q=%s',
    mark: { bg: '#ffffff', fg: '#4285f4', text: 'G', ring: '#dadce0' },
    desc: 'Os resultados mais completos',
  },
  brave: {
    name: 'Brave Search',
    search: 'https://search.brave.com/search?q=%s',
    suggest: 'https://search.brave.com/api/suggest?q=%s',
    mark: { bg: '#fb542b', fg: '#ffffff', text: 'B' },
    desc: 'Índice próprio, privado, com respostas de IA',
  },
  duckduckgo: {
    name: 'DuckDuckGo',
    search: 'https://duckduckgo.com/?q=%s',
    suggest: 'https://duckduckgo.com/ac/?q=%s&type=list',
    mark: { bg: '#de5833', fg: '#ffffff', text: 'D' },
    desc: 'Privado, não rastreia suas buscas',
  },
  bing: {
    name: 'Bing',
    search: 'https://www.bing.com/search?q=%s',
    suggest: 'https://api.bing.com/osjson.aspx?query=%s',
    mark: { bg: '#0f7c82', fg: '#ffffff', text: 'b' },
    desc: 'Buscador da Microsoft, com Copilot',
  },
  perplexity: {
    name: 'Perplexity',
    search: 'https://www.perplexity.ai/search?q=%s',
    suggest: null,
    mark: { bg: '#1f6f78', fg: '#ffffff', text: '✳' },
    desc: 'Responde com IA e mostra as fontes',
  },
  startpage: {
    name: 'Startpage',
    search: 'https://www.startpage.com/do/search?q=%s',
    suggest: null,
    mark: { bg: '#6573ff', fg: '#ffffff', text: 'S' },
    desc: 'Resultados do Google, sem rastreamento',
  },
  ecosia: {
    name: 'Ecosia',
    search: 'https://www.ecosia.org/search?q=%s',
    suggest: 'https://ac.ecosia.org/autocomplete?q=%s&type=list',
    mark: { bg: '#2e9d5b', fg: '#ffffff', text: 'e' },
    desc: 'Planta árvores com o lucro dos anúncios',
  },
  yahoo: {
    name: 'Yahoo',
    search: 'https://search.yahoo.com/search?p=%s',
    suggest: null,
    mark: { bg: '#6001d2', fg: '#ffffff', text: 'Y!' },
    desc: 'Resultados do Bing com o portal Yahoo',
  },
};

// Ícone do buscador em SVG (data URL), usado na barra de endereço, nos menus e na nova aba.
function engineIcon(id) {
  const e = ENGINES[id] || ENGINES.google;
  const m = e.mark;
  const size = m.text.length > 1 ? 13 : 17;
  const ring = m.ring ? `<circle cx="16" cy="16" r="14.5" fill="none" stroke="${m.ring}" stroke-width="1.5"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="${m.bg}"/>${ring}`
    + `<text x="16" y="16" dy=".36em" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${size}" fill="${m.fg}">${m.text}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function engineList() {
  return Object.entries(ENGINES).map(([id, e]) => ({ id, name: e.name, desc: e.desc, icon: engineIcon(id), ai: id === 'perplexity' }));
}

const ACCENTS = {
  violet: '#7c5cff',
  pink: '#ff3d7f',
  blue: '#2f7bff',
  teal: '#14b8a6',
  green: '#22a35a',
  orange: '#ff7a1a',
  red: '#ef4444',
};

const DEFAULTS = {
  theme: 'system', // system | light | dark
  accent: 'violet',
  showBookmarksBar: true,
  showHomeButton: true,
  startup: 'restore', // restore | newtab | urls
  startupUrls: [],
  homepage: 'tuff://newtab',
  migratedBrand: false, // pulse:// -> tuff:// nas configurações salvas
  searchEngine: 'google',
  searchSuggestions: true,
  shieldEnabled: true,
  shieldAllowlist: [],
  // Listas de filtros e categorias opcionais (ausente = ligada)
  shieldLists: { easylist: true, easyprivacy: true, ublock: true, easylistpt: true, peterlowe: true, hagezi: true, hagezinative: true },
  shieldCategories: { social: true, affiliate: true, errors: true, consent: true, experiments: true, messaging: true },
  shieldStripParams: true,
  doNotTrack: true,
  downloadDir: '',
  askDownload: false,
  memorySaver: true,
  memorySaverMinutes: 30,
  spellcheck: true,
  spellcheckLanguages: ['pt-BR', 'en-US'],
  hardwareAcceleration: true,
  smoothScrolling: true,
  sitePermissions: {},
  extensions: [],
  newTabShortcuts: true,
  newTabBackground: 'aurora',
  hiddenTopSites: [],
  confirmCloseMultipleTabs: true,
  // Senhas e contas
  passwordManager: true,
  passwordAutofill: true,
  googleCompat: true,
  showProfileButton: true,
  // Corretor gramatical (LanguageTool)
  grammarEnabled: true,
  grammarLanguage: 'auto',
  grammarMotherTongue: 'pt-BR',
  grammarStyle: true,
  grammarPicky: false,
  grammarAutoFix: false,
  grammarServer: '',
  grammarDictionary: [],
  grammarDisabledSites: [],
  // Interface
  animations: true,
};

// Objeto { chave: true/false } só com chaves conhecidas.
function isFlagMap(v, keys) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && Object.entries(v).every(([k, b]) => keys.includes(k) && typeof b === 'boolean');
}

// Valores aceitos para cada configuração editável a partir das páginas internas.
const VALIDATORS = {
  theme: (v) => ['system', 'light', 'dark'].includes(v),
  accent: (v) => Object.hasOwn(ACCENTS, v),
  showBookmarksBar: (v) => typeof v === 'boolean',
  showHomeButton: (v) => typeof v === 'boolean',
  startup: (v) => ['restore', 'newtab', 'urls'].includes(v),
  startupUrls: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length < 2048),
  homepage: (v) => typeof v === 'string' && v.length < 2048,
  searchEngine: (v) => Object.hasOwn(ENGINES, v),
  searchSuggestions: (v) => typeof v === 'boolean',
  shieldEnabled: (v) => typeof v === 'boolean',
  shieldAllowlist: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'),
  shieldLists: (v) => isFlagMap(v, ['easylist', 'easyprivacy', 'ublock', 'easylistpt', 'peterlowe', 'hagezi', 'hagezinative']),
  shieldCategories: (v) => isFlagMap(v, ['social', 'affiliate', 'errors', 'consent', 'experiments', 'messaging']),
  shieldStripParams: (v) => typeof v === 'boolean',
  doNotTrack: (v) => typeof v === 'boolean',
  askDownload: (v) => typeof v === 'boolean',
  memorySaver: (v) => typeof v === 'boolean',
  memorySaverMinutes: (v) => Number.isInteger(v) && v >= 5 && v <= 720,
  spellcheck: (v) => typeof v === 'boolean',
  spellcheckLanguages: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'),
  hardwareAcceleration: (v) => typeof v === 'boolean',
  smoothScrolling: (v) => typeof v === 'boolean',
  newTabShortcuts: (v) => typeof v === 'boolean',
  newTabBackground: (v) => ['aurora', 'sunset', 'ocean', 'forest', 'mono'].includes(v),
  hiddenTopSites: (v) => Array.isArray(v),
  confirmCloseMultipleTabs: (v) => typeof v === 'boolean',
  passwordManager: (v) => typeof v === 'boolean',
  passwordAutofill: (v) => typeof v === 'boolean',
  googleCompat: (v) => typeof v === 'boolean',
  showProfileButton: (v) => typeof v === 'boolean',
  grammarEnabled: (v) => typeof v === 'boolean',
  grammarLanguage: (v) => typeof v === 'string' && /^(auto|[a-z]{2,3}(-[A-Z]{2})?)$/.test(v),
  grammarMotherTongue: (v) => typeof v === 'string' && /^([a-z]{2,3}(-[A-Z]{2})?)?$/.test(v),
  grammarStyle: (v) => typeof v === 'boolean',
  grammarPicky: (v) => typeof v === 'boolean',
  grammarAutoFix: (v) => typeof v === 'boolean',
  grammarServer: (v) => typeof v === 'string' && (v === '' || /^https?:\/\/[^\s]+$/i.test(v)) && v.length < 500,
  grammarDictionary: (v) => Array.isArray(v) && v.length <= 5000 && v.every((s) => typeof s === 'string' && s.length < 100),
  grammarDisabledSites: (v) => Array.isArray(v) && v.length <= 2000 && v.every((s) => typeof s === 'string' && s.length < 300),
  animations: (v) => typeof v === 'boolean',
};

class Settings extends EventEmitter {
  constructor() {
    super();
    this.store = new JsonStore('settings', DEFAULTS);
    this._migrate();
  }

  // Configurações salvas pelo PulseBrowser apontam para pulse://.
  _migrate() {
    const d = this.store.data;
    if (d.migratedBrand) return;
    const fix = (u) => (typeof u === 'string' && /^pulse:/i.test(u) ? `tuff:${u.slice(6)}` : u);
    d.homepage = fix(d.homepage);
    if (Array.isArray(d.startupUrls)) d.startupUrls = d.startupUrls.map(fix);
    d.migratedBrand = true;
    this.store.save();
  }

  get data() {
    return this.store.data;
  }

  get(key) {
    return this.store.data[key];
  }

  set(key, value) {
    if (!Object.hasOwn(VALIDATORS, key) && !['sitePermissions', 'extensions', 'downloadDir'].includes(key)) {
      throw new Error(`Configuração desconhecida: ${key}`);
    }
    if (VALIDATORS[key] && !VALIDATORS[key](value)) {
      throw new Error(`Valor inválido para ${key}`);
    }
    this.store.data[key] = value;
    this.store.save();
    this.emit('changed', key, value);
  }

  engine() {
    return ENGINES[this.get('searchEngine')] || ENGINES.google;
  }

  searchUrl(text) {
    return this.engine().search.replace('%s', encodeURIComponent(text));
  }

  accentColor() {
    return ACCENTS[this.get('accent')] || ACCENTS.violet;
  }

  // Dados enviados para a interface e para as páginas internas.
  publicData() {
    const d = this.store.data;
    return {
      ...d,
      accentColor: this.accentColor(),
      engineName: this.engine().name,
      engineIcon: engineIcon(this.get('searchEngine')),
    };
  }
}

module.exports = { Settings, ENGINES, ACCENTS, DEFAULTS, engineIcon, engineList };
