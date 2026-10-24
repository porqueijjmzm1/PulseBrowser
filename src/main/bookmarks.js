'use strict';
// Favoritos em árvore: raiz -> "Barra de favoritos" e "Outros favoritos".
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { JsonStore } = require('./store');

const DEFAULT_TREE = {
  nextId: 1,
  roots: [
    { id: 'bar', type: 'folder', title: 'Barra de favoritos', children: [] },
    { id: 'other', type: 'folder', title: 'Outros favoritos', children: [] },
  ],
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

class Bookmarks extends EventEmitter {
  constructor() {
    super();
    this.store = new JsonStore('bookmarks', DEFAULT_TREE);
    this._urls = null;
  }

  get roots() {
    return this.store.data.roots;
  }

  _changed() {
    this._urls = null;
    this.store.save();
    this.emit('changed');
  }

  _newId() {
    return `b${this.store.data.nextId++}`;
  }

  find(id, nodes = this.roots, parent = null) {
    for (const n of nodes) {
      if (n.id === id) return { node: n, parent };
      if (n.children) {
        const r = this.find(id, n.children, n);
        if (r) return r;
      }
    }
    return null;
  }

  *walk(nodes = this.roots, parent = null) {
    for (const n of nodes) {
      yield { node: n, parent };
      if (n.children) yield* this.walk(n.children, n);
    }
  }

  urlSet() {
    if (!this._urls) {
      this._urls = new Set();
      for (const { node } of this.walk()) if (node.type === 'url') this._urls.add(node.url);
    }
    return this._urls;
  }

  isBookmarked(url) {
    return !!url && this.urlSet().has(url);
  }

  findByUrl(url) {
    for (const { node, parent } of this.walk()) if (node.type === 'url' && node.url === url) return { node, parent };
    return null;
  }

  add({ parentId = 'bar', title, url, type = 'url', favicon = '', index }) {
    const parent = this.find(parentId)?.node;
    if (!parent || parent.type !== 'folder') throw new Error('Pasta inválida');
    const node = type === 'folder'
      ? { id: this._newId(), type: 'folder', title: title || 'Nova pasta', children: [], added: Date.now() }
      : { id: this._newId(), type: 'url', title: title || url, url, favicon, added: Date.now() };
    if (index == null || index < 0 || index > parent.children.length) parent.children.push(node);
    else parent.children.splice(index, 0, node);
    this._changed();
    return node;
  }

  update(id, { title, url, favicon }) {
    const found = this.find(id);
    if (!found) return null;
    if (typeof title === 'string') found.node.title = title;
    if (typeof url === 'string' && found.node.type === 'url') found.node.url = url;
    if (typeof favicon === 'string') found.node.favicon = favicon;
    this._changed();
    return found.node;
  }

  move(id, parentId, index) {
    if (id === 'bar' || id === 'other') return;
    const found = this.find(id);
    const target = this.find(parentId)?.node;
    if (!found || !target || target.type !== 'folder') return;
    // Impede mover uma pasta para dentro dela mesma.
    if (found.node.type === 'folder' && (found.node.id === target.id || this.find(target.id, found.node.children))) return;
    const siblings = found.parent ? found.parent.children : this.roots;
    const oldIndex = siblings.indexOf(found.node);
    siblings.splice(oldIndex, 1);
    let i = index ?? target.children.length;
    if (siblings === target.children && oldIndex < i) i -= 1;
    target.children.splice(Math.max(0, Math.min(i, target.children.length)), 0, found.node);
    this._changed();
  }

  remove(id) {
    if (id === 'bar' || id === 'other') return;
    const found = this.find(id);
    if (!found?.parent) return;
    found.parent.children.splice(found.parent.children.indexOf(found.node), 1);
    this._changed();
  }

  // Alterna o favorito de uma página (usado pela estrela da barra de endereço).
  toggle(url, title, favicon) {
    const found = this.findByUrl(url);
    if (found) {
      this.remove(found.node.id);
      return null;
    }
    return this.add({ parentId: 'bar', url, title, favicon });
  }

  search(text, limit = 4) {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const { node } of this.walk()) {
      if (node.type !== 'url') continue;
      if (node.url.toLowerCase().includes(q) || (node.title || '').toLowerCase().includes(q)) out.push(node);
      if (out.length >= limit) break;
    }
    return out;
  }

  folders() {
    const out = [];
    const visit = (nodes, depth) => {
      for (const n of nodes) {
        if (n.type !== 'folder') continue;
        out.push({ id: n.id, title: n.title, depth });
        visit(n.children, depth + 1);
      }
    };
    visit(this.roots, 0);
    return out;
  }

  // Importa nós no formato { type, title, url, children }.
  importNodes(nodes, parentId = 'other', folderTitle = 'Importados') {
    const folder = this.add({ parentId, type: 'folder', title: folderTitle });
    let count = 0;
    const insert = (list, target) => {
      for (const n of list || []) {
        if (n.type === 'folder' || Array.isArray(n.children)) {
          const f = { id: this._newId(), type: 'folder', title: String(n.title || 'Pasta'), children: [], added: Date.now() };
          target.children.push(f);
          insert(n.children, f);
        } else if (typeof n.url === 'string' && /^(https?|file|ftp):/i.test(n.url)) {
          target.children.push({ id: this._newId(), type: 'url', title: String(n.title || n.url), url: n.url, favicon: '', added: Date.now() });
          count++;
        }
      }
    };
    insert(nodes, folder);
    this._changed();
    return count;
  }

  importFromChrome() {
    const base = process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
        : path.join(os.homedir(), '.config', 'google-chrome');
    const file = path.join(base, 'Default', 'Bookmarks');
    if (!fs.existsSync(file)) throw new Error('Não encontrei os favoritos do Google Chrome neste computador.');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const convert = (n) => (n.type === 'folder'
      ? { type: 'folder', title: n.name, children: (n.children || []).map(convert) }
      : { type: 'url', title: n.name, url: n.url });
    const nodes = [];
    for (const key of ['bookmark_bar', 'other', 'synced']) {
      const root = data.roots?.[key];
      if (root?.children?.length) nodes.push({ type: 'folder', title: root.name, children: root.children.map(convert) });
    }
    return this.importNodes(nodes, 'other', 'Importados do Chrome');
  }

  exportHtml() {
    const render = (nodes, indent) => nodes.map((n) => {
      const pad = '    '.repeat(indent);
      if (n.type === 'folder') {
        return `${pad}<DT><H3>${escapeHtml(n.title)}</H3>\n${pad}<DL><p>\n${render(n.children, indent + 1)}${pad}</DL><p>\n`;
      }
      const added = Math.floor((n.added || Date.now()) / 1000);
      return `${pad}<DT><A HREF="${escapeHtml(n.url)}" ADD_DATE="${added}">${escapeHtml(n.title)}</A>\n`;
    }).join('');
    return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Favoritos do PulseBrowser</H1>
<DL><p>
${render(this.roots, 1)}</DL><p>
`;
  }
}

module.exports = { Bookmarks };
