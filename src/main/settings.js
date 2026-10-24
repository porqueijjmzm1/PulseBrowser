'use strict';
const { EventEmitter } = require('events');
const { JsonStore } = require('./store');

const ENGINES = {
  google: {
    name: 'Google',
    search: 'https://www.google.com/search?q=%s',
    suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&q=%s',
  },
  bing: {
    name: 'Bing',
    search: 'https://www.bing.com/search?q=%s',
    suggest: 'https://api.bing.com/osjson.aspx?query=%s',
  },
  duckduckgo: {
    name: 'DuckDuckGo',
    search: 'https://duckduckgo.com/?q=%s',
    suggest: 'https://duckduckgo.com/ac/?q=%s&type=list',
  },
  brave: {
    name: 'Brave Search',
    search: 'https://search.brave.com/search?q=%s',
    suggest: 'https://search.brave.com/api/suggest?q=%s',
  },
  ecosia: {
    name: 'Ecosia',
    search: 'https://www.ecosia.org/search?q=%s',
    suggest: 'https://ac.ecosia.org/autocomplete?q=%s&type=list',
  },
  yahoo: {
    name: 'Yahoo',
    search: 'https://search.yahoo.com/search?p=%s',
    suggest: null,
  },
};

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
  homepage: 'pulse://newtab',
  searchEngine: 'google',
  searchSuggestions: true,
  shieldEnabled: true,
  shieldExtendedList: false,
  shieldAllowlist: [],
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
};

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
  shieldExtendedList: (v) => typeof v === 'boolean',
  shieldAllowlist: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'),
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
};

class Settings extends EventEmitter {
  constructor() {
    super();
    this.store = new JsonStore('settings', DEFAULTS);
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
    };
  }
}

module.exports = { Settings, ENGINES, ACCENTS, DEFAULTS };
