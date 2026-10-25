'use strict';
// Gera os ícones do tuff.browse (PNG + ICO) renderizando o SVG do logo com o Chromium.
// Uso: npm run icon
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

function logoSvg(stroke) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff4d8d"/>
      <stop offset="0.55" stop-color="#8b5cff"/>
      <stop offset="1" stop-color="#3b82ff"/>
    </linearGradient>
    <radialGradient id="h" cx="0.3" cy="0.22" r="0.75">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="256" cy="256" r="244" fill="url(#g)"/>
  <circle cx="256" cy="256" r="244" fill="url(#h)"/>
  <g fill="none" stroke="#ffffff" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M205 122V300Q205 368 262 368"/>
    <path d="M141 204H295"/>
  </g>
  <circle cx="356" cy="368" r="${Math.round(stroke * 0.62)}" fill="#ffffff"/>
</svg>`;
}

function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((im, i) => {
    const o = i * 16;
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, o);
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(im.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += im.data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512];
  const jobs = sizes.map((s) => ({ s, svg: logoSvg(s <= 24 ? 78 : s <= 48 ? 68 : 58) }));
  const pngs = await win.webContents.executeJavaScript(`(async () => {
    const out = {};
    for (const { s, svg } of ${JSON.stringify(jobs)}) {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(svg);
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, s, s);
      out[s] = c.toDataURL('image/png').split(',')[1];
    }
    return out;
  })()`);
  const root = path.join(__dirname, '..');
  const buf = (s) => Buffer.from(pngs[s], 'base64');
  const buildDir = path.join(root, 'build');
  const assetsDir = path.join(root, 'src', 'assets');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, 'icon.png'), buf(512));
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), buf(256));
  fs.writeFileSync(path.join(assetsDir, 'icon.svg'), logoSvg(58));
  const ico = makeIco([16, 20, 24, 32, 40, 48, 64, 128, 256].map((size) => ({ size, data: buf(size) })));
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
  fs.writeFileSync(path.join(assetsDir, 'icon.ico'), ico);
  console.log('Ícones gerados em build/ e src/assets/');
  app.quit();
});
