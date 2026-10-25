'use strict';
// Núcleo do tuff Shield: decide o que bloquear. Não depende do Electron, então dá para testar no Node.
//
// Ordem de decisão para cada requisição:
//   1. categoria desligada pelo usuário  -> permite (vale também para as listas de filtros)
//   2. listas de filtros (motor do Ghostery, sintaxe EasyList/uBlock): substituto, bloqueio ou exceção
//   3. lista interna por categoria
const { FiltersEngine, Request } = require('@ghostery/adblocker');
const tldts = require('tldts-experimental');
const { CATEGORIES, RULES } = require('./blocklist');

const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const OPTIONAL_CATEGORIES = CATEGORIES.filter((c) => c.optional).map((c) => c.id);

// Configuração do motor usada tanto na montagem (processo separado) quanto no uso.
const ENGINE_CONFIG = { loadPreprocessors: true, enableCompression: true, loadCSPFilters: false, enableHtmlFiltering: false };
// O "Env" do motor é um Map comum com as condições !#if das listas.
const ENGINE_ENV = new Map([['ext_ublock', true], ['env_chromium', true], ['cap_user_stylesheet', true]]);

const G = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets';
const UBO = 'https://ublockorigin.github.io/uAssets/filters';
const HAGEZI = 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock';
const HAGEZI_GH = 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock';
const NATIVE = ['apple', 'samsung', 'xiaomi', 'huawei', 'oppo-realme', 'vivo', 'lgwebos', 'winoffice', 'amazon', 'roku', 'tiktok'];

// Listas de filtros da comunidade. Cada arquivo tem um endereço principal e um reserva.
const FILTER_LISTS = [
  { id: 'easylist', name: 'EasyList', desc: 'Anúncios. A lista mais usada pelos bloqueadores.',
    files: [[`${G}/easylist/easylist.txt`, 'https://easylist.to/easylist/easylist.txt']] },
  { id: 'easyprivacy', name: 'EasyPrivacy', desc: 'Rastreadores, analytics e pixels.',
    files: [[`${G}/easylist/easyprivacy.txt`, 'https://easylist.to/easylist/easyprivacy.txt']] },
  { id: 'ublock', name: 'uBlock Origin', desc: 'Anúncios, privacidade, malware e correções para sites que quebram.',
    files: ['filters', 'filters-2020', 'filters-2021', 'filters-2022', 'filters-2023', 'filters-2024', 'badware', 'privacy',
      'quick-fixes', 'resource-abuse', 'unbreak'].map((f) => [`${G}/ublock-origin/${f}.txt`, `${UBO}/${f}.txt`]) },
  { id: 'easylistpt', name: 'EasyList Portuguese', desc: 'Anúncios de sites em português.',
    files: [['https://easylist-downloads.adblockplus.org/easylistportuguese.txt', 'https://easylist-msie.adblockplus.org/easylistportuguese.txt']] },
  { id: 'peterlowe', name: 'Lista de Peter Lowe', desc: 'Servidores de anúncios e rastreadores.',
    files: [[`${G}/peter-lowe/serverlist.txt`, 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext']] },
  { id: 'hagezi', name: 'HaGeZi Pro', desc: 'Mais de 180 mil domínios de anúncios, rastreadores, telemetria e golpes.',
    files: [[`${HAGEZI}/pro.txt`, `${HAGEZI_GH}/pro.txt`]] },
  { id: 'hagezinative', name: 'HaGeZi telemetria nativa', desc: 'Telemetria de Apple, Samsung, Xiaomi, Huawei, LG, Roku, Windows, Amazon e TikTok.',
    files: NATIVE.map((n) => [`${HAGEZI}/native.${n}.txt`, `${HAGEZI_GH}/native.${n}.txt`]) },
  // Ligada junto com a categoria "Avisos de cookies" (não aparece como lista separada).
  { id: 'cookies', name: 'Avisos de cookies', desc: 'EasyList Cookie e uBlock Origin Cookies.', category: 'consent',
    files: [[`${G}/easylist/easylist-cookie.txt`, 'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt'],
      [`${G}/ublock-origin/annoyances-cookies.txt`, `${UBO}/annoyances-cookies.txt`]] },
];
const RESOURCES_URLS = [`${G}/ublock-origin/resources.json`];

// Empresas com vários domínios. Para regras "só de terceiros", são tratadas como o mesmo site.
const FAMILIES = {
  google: ['google.com', 'youtube.com', 'googlevideo.com', 'ytimg.com', 'gstatic.com', 'googleapis.com', 'googleusercontent.com',
    'ggpht.com', 'youtube-nocookie.com', 'blogger.com', 'blogspot.com', 'withgoogle.com', 'gmail.com', 'google.dev', 'goo.gl', 'youtu.be'],
  meta: ['facebook.com', 'facebook.net', 'fbcdn.net', 'fb.com', 'fb.me', 'instagram.com', 'cdninstagram.com', 'messenger.com',
    'whatsapp.com', 'whatsapp.net', 'meta.com', 'threads.net', 'threads.com', 'oculus.com'],
  microsoft: ['microsoft.com', 'bing.com', 'msn.com', 'live.com', 'office.com', 'office.net', 'linkedin.com', 'licdn.com', 'skype.com',
    'xbox.com', 'windows.com', 'azure.com', 'microsoftonline.com', 'outlook.com', 'sharepoint.com', 'microsoft365.com', 'cloud.microsoft'],
  twitter: ['twitter.com', 'x.com', 'twimg.com', 't.co'],
  amazon: ['amazon.com', 'media-amazon.com', 'ssl-images-amazon.com', 'primevideo.com', 'amazon.dev', 'a2z.com', 'twitch.tv', 'ttvnw.net'],
  pinterest: ['pinterest.com', 'pinimg.com'],
  reddit: ['reddit.com', 'redditmedia.com', 'redditstatic.com', 'redd.it'],
  tiktok: ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'tiktokw.us', 'byteoversea.com', 'ibytedtos.com', 'tiktokcdn-us.com'],
  vk: ['vk.com', 'vk.ru', 'userapi.com', 'vkuser.net', 'mail.ru', 'ok.ru'],
  yahoo: ['yahoo.com', 'yimg.com', 'yahooinc.com', 'aol.com'],
  yandex: ['yandex.ru', 'yandex.net', 'yandex.com', 'ya.ru', 'yastatic.net'],
  apple: ['apple.com', 'icloud.com', 'mzstatic.com', 'apple.news', 'cdn-apple.com'],
  snap: ['snapchat.com', 'sc-static.net', 'snap.com', 'snapkit.com'],
  quora: ['quora.com', 'quoracdn.net'],
  hubspot: ['hubspot.com', 'hs-scripts.com', 'hs-analytics.net', 'hubspot.net', 'hsforms.com', 'usemessages.com', 'hs-banner.com'],
  mailchimp: ['mailchimp.com', 'list-manage.com', 'mailchi.mp', 'chimpstatic.com'],
  intercom: ['intercom.com', 'intercom.io', 'intercomcdn.com'],
  drift: ['drift.com', 'driftt.com'],
  zendesk: ['zendesk.com', 'zdassets.com', 'zopim.com'],
};
const FAMILY_OF = new Map();
for (const [name, domains] of Object.entries(FAMILIES)) for (const d of domains) FAMILY_OF.set(d, name);
// Domínios de país (google.com.br, amazon.de...) contam como a empresa.
const CC_FAMILY = /^(google|amazon|yahoo|pinterest|bing)\.(?:com?\.)?[a-z]{2,3}$/;

function familyOf(domain) {
  if (!domain) return '';
  const f = FAMILY_OF.get(domain);
  if (f) return f;
  const m = CC_FAMILY.exec(domain);
  if (m) return FAMILY_OF.get(`${m[1]}.com`) || m[1];
  return '';
}

function sameSite(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const fa = familyOf(a);
  return !!fa && fa === familyOf(b);
}

// Substitutos inofensivos (do uBlock Origin) para scripts que, bloqueados, quebram players de vídeo e páginas.
const SURROGATES = [
  [/^https?:\/\/imasdk\.googleapis\.com\/js\/sdkloader\/ima3(?:_dai)?\.js/, 'google-ima.js'],
  [/^https?:\/\/(?:www\.|ssl\.)?google-analytics\.com\/analytics\.js/, 'google-analytics_analytics.js'],
  [/^https?:\/\/(?:www\.|ssl\.)?google-analytics\.com\/ga\.js/, 'google-analytics_ga.js'],
  [/^https?:\/\/(?:www\.googletagservices\.com|securepubads\.g\.doubleclick\.net)\/tag\/js\/gpt\.js/, 'googletagservices_gpt.js'],
  [/^https?:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/, 'googlesyndication_adsbygoogle.js'],
  [/^https?:\/\/c\.amazon-adsystem\.com\/aax2\/apstag\.js/, 'amazon_apstag.js'],
  [/^https?:\/\/(?:sb|b)\.scorecardresearch\.com\/beacon\.js/, 'scorecardresearch_beacon.js'],
  [/^https?:\/\/widgets\.outbrain\.com\/outbrain\.js/, 'outbrain-widget.js'],
];

// CSS de reserva, usado antes de as listas de filtros serem baixadas.
const BASE_COSMETIC_CSS = `
ins.adsbygoogle, [id^="div-gpt-ad"], [id^="google_ads_iframe"], [id^="google_ads_frame"],
iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"], iframe[src*="amazon-adsystem.com"],
div[id^="taboola-"], .trc_rbox_container, .OUTBRAIN, [data-widget-id^="outbrain"], .ob-widget,
amp-ad, amp-embed[type="taboola"], amp-sticky-ad { display: none !important; }
`;

// Parâmetros de rastreamento removidos dos links abertos (como fazem Brave e Firefox).
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'gad_source', 'msclkid', 'mc_eid', 'igshid', 'yclid', 'ysclid',
  '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking', 'oly_anon_id', 'oly_enc_id', 'vero_id', 'vero_conv',
  'rb_clickid', 'ttclid', 'twclid', 'srsltid', '_openstat', 'wickedid', 'mkt_tok', 'ml_subscriber', 'ml_subscriber_hash',
  'epik', 'li_fat_id', 'sccid', '_kx', '__s', 'dm_i', 'ebisu_clid',
]);
const HOST_PARAMS = [
  [/(^|\.)(youtube\.com|youtu\.be)$/, ['si', 'pp', 'feature']],
  [/(^|\.)open\.spotify\.com$/, ['si']],
  [/(^|\.)(instagram\.com)$/, ['igsh']],
  [/(^|\.)(x|twitter)\.com$/, ['s', 't']],
];

function stripTrackingParams(url) {
  const q = url.indexOf('?');
  if (q < 0) return url;
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const host = u.hostname;
  const extra = new Set();
  for (const [re, names] of HOST_PARAMS) if (re.test(host)) for (const n of names) extra.add(n);
  // Em x.com/twitter.com, "s" e "t" só são rastreio nos links de posts compartilhados.
  if (/(^|\.)(x|twitter)\.com$/.test(host) && !/\/status\//.test(u.pathname)) {
    extra.delete('s');
    extra.delete('t');
  }
  let changed = false;
  for (const key of [...u.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (TRACKING_PARAMS.has(k) || extra.has(k)) {
      u.searchParams.delete(key);
      changed = true;
    }
  }
  if (!changed) return url;
  let out = u.toString();
  if (!u.search) out = out.replace('?#', '#').replace(/\?$/, '');
  return out;
}

function pathOf(url) {
  // Mais rápido que new URL() para cada requisição.
  const s = url.indexOf('//');
  const p = url.indexOf('/', s < 0 ? 0 : s + 2);
  if (p < 0) return '/';
  let end = url.length;
  const q = url.indexOf('?', p);
  if (q >= 0) end = q;
  const h = url.indexOf('#', p);
  if (h >= 0 && h < end) end = h;
  return url.slice(p, end);
}

class BuiltinRules {
  constructor(rules = RULES) {
    this.hosts = new Map();
    this.paths = new Map();
    this.size = 0;
    for (const [cat, list] of Object.entries(rules)) {
      for (const raw of list) {
        let item = raw;
        let tp = !!CATEGORY[cat]?.thirdPartyOnly;
        if (item.startsWith('~')) {
          tp = true;
          item = item.slice(1);
        }
        const slash = item.indexOf('/');
        if (slash < 0) {
          if (!this.hosts.has(item)) {
            this.hosts.set(item, { cat, tp, rule: raw });
            this.size++;
          }
        } else {
          const host = item.slice(0, slash);
          const list2 = this.paths.get(host) || [];
          list2.push({ path: item.slice(slash), cat, tp, rule: raw });
          this.paths.set(host, list2);
          this.size++;
        }
      }
    }
  }

  // Procura do subdomínio mais específico para o mais geral; regras com caminho vêm antes.
  lookup(hostname, pathname = '/') {
    let h = hostname;
    while (h) {
      const paths = this.paths.get(h);
      if (paths) {
        for (const r of paths) {
          if (pathname === r.path || (pathname.startsWith(r.path) && (r.path.endsWith('/') || '/.?_-'.includes(pathname[r.path.length])))) return r;
        }
      }
      const hit = this.hosts.get(h);
      if (hit) return hit;
      const i = h.indexOf('.');
      if (i < 0) break;
      h = h.slice(i + 1);
    }
    return null;
  }

  hasHost(hostname) {
    let h = hostname;
    while (h) {
      if (this.hosts.has(h)) return true;
      const i = h.indexOf('.');
      if (i < 0) break;
      h = h.slice(i + 1);
    }
    return false;
  }
}

function guessCategory(hostname, pathname, type) {
  const s = `${hostname}${pathname}`;
  if (type === 'media' || /\b(vast|vpaid|vmap|preroll|ima3|videoads?)\b/i.test(s)) return 'video';
  if (/coinhive|cryptonight|miner|monero/i.test(s)) return 'malware';
  if (/analytic|track|pixel|collect|beacon|metric|stats?\b|telemetry|insight|measure|event|\blog|count|tag(manager)?\b/i.test(s)) return 'trackers';
  return 'ads';
}

const ALLOW = Object.freeze({ action: 'allow' });

// Pedidos do player do YouTube que as listas bloqueiam, mas que ele usa para medir a conexão: sem as
// respostas, o player acha que a internet está ruim e mostra "Está a ter interrupções?" o tempo todo.
// Só valem dentro do próprio YouTube (ou do player embutido em outros sites).
const YOUTUBE_HOSTS = new Set(['youtube.com', 'youtube-nocookie.com']);
const YOUTUBE_PLAYER_PATHS = /^\/(?:api\/stats\/(?:qoe|watchtime|playback|delayplay|atr)|ptracking|generate_204)(?:$|[/?])/;
function isYoutubePlayerPing(domain, sourceDomain, pathname) {
  return YOUTUBE_HOSTS.has(domain) && YOUTUBE_HOSTS.has(sourceDomain) && YOUTUBE_PLAYER_PATHS.test(pathname);
}

// Junta os scripts de correção num só, cada um no seu escopo: rodando soltos no mesmo escopo global,
// as declarações de topo (class/let) colidem e o script falha (quebrava o player do YouTube).
// Repetidos saem; um script com erro não impede os outros.
function bundleScriptlets(scripts) {
  const list = [...new Set(scripts || [])];
  if (!list.length) return [];
  return [list.map((code) => `(function(){try{${code}\n}catch(e){}})();`).join('\n')];
}

class ShieldCore {
  constructor() {
    this.rules = new BuiltinRules();
    this.engine = null;
  }

  setEngine(engine) {
    if (engine) engine.updateEnv(ENGINE_ENV);
    this.engine = engine || null;
  }

  static engineFromBuffer(buf) {
    return FiltersEngine.deserialize(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  }

  surrogate(url) {
    if (!this.engine) return null;
    for (const [re, name] of SURROGATES) {
      if (re.test(url)) {
        try {
          return this.engine.resources.getResource(name).dataUrl;
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  // details: { url, sourceUrl, type }  opts: { disabled: Set de categorias desligadas }
  match({ url, sourceUrl = '', type = 'other' }, { disabled } = {}) {
    const src = sourceUrl ? tldts.parse(sourceUrl) : null;
    const sourceHostname = (src && src.hostname) || '';
    const sourceDomain = (src && (src.domain || src.hostname)) || '';
    const req = Request.fromRawDetails({ url, sourceUrl, type, sourceHostname, sourceDomain });
    if (!req.isSupported) return ALLOW;
    const pathname = pathOf(url);
    if (isYoutubePlayerPing(req.domain, sourceDomain, pathname)) return ALLOW;
    const hit = this.rules.lookup(req.hostname, pathname);
    if (hit && disabled && disabled.has(hit.cat)) return ALLOW;

    if (this.engine) {
      const r = this.engine.match(req);
      if (r.redirect) return { action: 'redirect', redirectURL: r.redirect.dataUrl, cat: hit ? hit.cat : guessCategory(req.hostname, pathname, type) };
      if (r.match) return this._block(url, type, hit ? hit.cat : guessCategory(req.hostname, pathname, type), 'list');
      // Exceções das listas: as feitas para um site específico sempre valem; as genéricas não
      // derrubam um domínio que a lista interna bloqueia de propósito.
      if (r.exception && (!hit || r.exception.hasDomains())) return ALLOW;
    }

    if (!hit) return ALLOW;
    const firstParty = sameSite(req.domain || req.hostname, sourceDomain);
    if (firstParty && hit.tp) return ALLOW;
    // Visitando o site da própria empresa (ex.: criteo.com): deixa o site funcionar.
    if (firstParty && sourceHostname && this.rules.hasHost(sourceHostname)) return ALLOW;
    return this._block(url, type, hit.cat, 'builtin');
  }

  _block(url, type, cat, source) {
    if (type === 'script' || type === 'xhr' || type === 'other') {
      const dataUrl = this.surrogate(url);
      if (dataUrl) return { action: 'redirect', redirectURL: dataUrl, cat, source };
    }
    return { action: 'block', cat, source };
  }

  // Estilos e scripts para o início de uma página.
  cosmetics(url) {
    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return null;
    }
    if (!this.engine) return { styles: BASE_COSMETIC_CSS, scripts: [], generic: false };
    const req = Request.fromRawDetails({ url, type: 'mainFrame' });
    const c = this.engine.getCosmeticsFilters({
      url, hostname, domain: req.domain || hostname,
      getBaseRules: true, getInjectionRules: true, getExtendedRules: false, getRulesFromHostname: true, getRulesFromDOM: false,
    });
    if (!c.active) return null;
    return { styles: `${BASE_COSMETIC_CSS}\n${c.styles || ''}`, scripts: bundleScriptlets(c.scripts), generic: true };
  }

  // Regras genéricas que dependem das classes, ids e links presentes na página.
  domCosmetics(url, { classes = [], ids = [], hrefs = [] }) {
    if (!this.engine) return '';
    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return '';
    }
    const req = Request.fromRawDetails({ url, type: 'mainFrame' });
    const c = this.engine.getCosmeticsFilters({
      url, hostname, domain: req.domain || hostname, classes, ids, hrefs,
      getBaseRules: false, getInjectionRules: false, getExtendedRules: false, getRulesFromHostname: false, getRulesFromDOM: true,
    });
    return c.active ? c.styles || '' : '';
  }
}

module.exports = {
  ShieldCore, BuiltinRules, FILTER_LISTS, RESOURCES_URLS, ENGINE_CONFIG, ENGINE_ENV, CATEGORIES, OPTIONAL_CATEGORIES,
  stripTrackingParams, sameSite, familyOf, pathOf,
};
