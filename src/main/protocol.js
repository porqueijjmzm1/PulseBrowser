'use strict';
// Protocolo interno pulse:// para as páginas do navegador.
const fs = require('fs');
const path = require('path');
const { protocol } = require('electron');

const PAGES_DIR = path.join(__dirname, '..', 'pages');
const SHARED_DIR = path.join(__dirname, '..', 'shared');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

const PAGES = new Set(['newtab', 'history', 'bookmarks', 'downloads', 'settings', 'about', 'error', 'passwords']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'pulse',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
    },
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
  'img-src * data: blob:',
  "connect-src 'self'",
  "font-src 'self' data:",
].join('; ');

function attach(ses) {
  if (ses.protocol.isProtocolHandled('pulse')) return;
  ses.protocol.handle('pulse', async (request) => {
    try {
      const file = resolveFile(request.url);
      if (!file) return new Response('Página não encontrada', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      const data = await fs.promises.readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const headers = { 'content-type': type, 'cache-control': 'no-cache' };
      if (type.startsWith('text/html')) headers['content-security-policy'] = CSP;
      return new Response(data, { status: 200, headers });
    } catch {
      return new Response('Página não encontrada', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  });
}

module.exports = { registerSchemes, attach, PAGES };
