'use strict';
// Protocolos internos: tuff:// (páginas do navegador; pulse:// é o nome antigo e continua aceito)
// e tuff-ext:// (arquivos das extensões).
const fs = require('fs');
const path = require('path');
const { protocol } = require('electron');

const PAGES_DIR = path.join(__dirname, '..', 'pages');
const SHARED_DIR = path.join(__dirname, '..', 'shared');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

const PAGES = new Set(['newtab', 'history', 'bookmarks', 'downloads', 'settings', 'about', 'error', 'passwords', 'extensions']);
const INTERNAL_SCHEMES = ['tuff', 'pulse'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
};

function registerSchemes() {
  const privileges = { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true };
  protocol.registerSchemesAsPrivileged([
    ...INTERNAL_SCHEMES.map((scheme) => ({ scheme, privileges })),
    { scheme: 'tuff-ext', privileges: { ...privileges, corsEnabled: true } },
  ]);
}

function resolveFile(url) {
  const u = new URL(url);
  const host = u.hostname;
  let pathname = decodeURIComponent(u.pathname || '/');
  if (pathname === '/' || pathname === '') {
    return PAGES.has(host) ? path.join(PAGES_DIR, `${host}.html`) : null;
  }
  pathname = pathname.replace(/^\/+/, '');
  let root = PAGES_DIR;
  if (pathname.startsWith('shared/')) {
    root = SHARED_DIR;
    pathname = pathname.slice('shared/'.length);
  } else if (pathname.startsWith('assets/')) {
    root = ASSETS_DIR;
    pathname = pathname.slice('assets/'.length);
  }
  const file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root + path.sep)) return null;
  return file;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob: tuff-ext:',
  "connect-src 'self'",
  "font-src 'self' data:",
].join('; ');

// As páginas de extensão são código do próprio usuário: a política é aberta (scripts inline,
// iframes como o player do Spotify, imagens e conexões a qualquer site).
const EXT_CSP = [
  "default-src 'self' tuff-ext: data: blob: https:",
  "script-src 'self' tuff-ext: 'unsafe-inline' 'unsafe-eval' https: blob:",
  "style-src 'self' tuff-ext: 'unsafe-inline' https:",
  'img-src * data: blob:',
  'media-src * data: blob:',
  'frame-src *',
  'connect-src *',
  'font-src * data:',
].join('; ');

const notFound = () => new Response('Página não encontrada', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

async function serve(file, csp) {
  const data = await fs.promises.readFile(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'content-type': type, 'cache-control': 'no-cache' };
  if (type.startsWith('text/html')) headers['content-security-policy'] = csp;
  return new Response(data, { status: 200, headers });
}

function attach(ses) {
  for (const scheme of INTERNAL_SCHEMES) {
    if (ses.protocol.isProtocolHandled(scheme)) continue;
    ses.protocol.handle(scheme, async (request) => {
      try {
        const file = resolveFile(request.url);
        return file ? await serve(file, CSP) : notFound();
      } catch {
        return notFound();
      }
    });
  }
  if (!ses.protocol.isProtocolHandled('tuff-ext')) {
    ses.protocol.handle('tuff-ext', async (request) => {
      try {
        const file = require('./context').extensions?.resolveFile(request.url);
        return file ? await serve(file, EXT_CSP) : notFound();
      } catch {
        return notFound();
      }
    });
  }
}

// Troca o nome antigo pulse:// pelo atual tuff:// (abas restauradas, favoritos, página inicial).
function normalizeInternal(url) {
  return typeof url === 'string' && /^pulse:/i.test(url) ? `tuff:${url.slice(6)}` : url;
}

module.exports = { registerSchemes, attach, PAGES, MIME, normalizeInternal };
