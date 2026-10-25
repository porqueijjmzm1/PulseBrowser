'use strict';
// Gera src/store/index.json, o catálogo da tuff Store, a partir das pastas em src/store.
// Rode depois de criar ou mudar uma extensão da loja: node scripts/build-store.js
const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, '..', 'src', 'store');

function walk(dir, prefix = '') {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (d.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...walk(path.join(dir, d.name), rel));
    else out.push(rel);
  }
  return out;
}

const extensions = [];
for (const d of fs.readdirSync(STORE, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const dir = path.join(STORE, d.name);
  const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const files = walk(dir);
  const size = files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  const s = mf.store || {};
  extensions.push({
    id: d.name,
    name: mf.name,
    version: mf.version,
    author: mf.author || '',
    description: mf.description || '',
    icon: mf.icon || '',
    category: s.category || 'Outros',
    color: s.color || '',
    pin: !!s.pin,
    about: s.about || '',
    features: s.features || [],
    files,
    size,
  });
}
extensions.sort((a, b) => a.name.localeCompare(b.name, 'pt'));
fs.writeFileSync(path.join(STORE, 'index.json'), `${JSON.stringify({ format: 1, extensions }, null, 2)}\n`);
console.log(`index.json: ${extensions.length} extensões (${extensions.map((e) => e.id).join(', ')})`);
