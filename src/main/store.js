'use strict';
// Armazenamento simples em JSON dentro da pasta de dados do usuário.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

class JsonStore {
  constructor(name, defaults, { delay = 500 } = {}) {
    this.file = path.join(app.getPath('userData'), `${name}.json`);
    this.defaults = defaults;
    this.delay = delay;
    this._timer = null;
    this.data = this._load();
  }

  _load() {
    const base = structuredClone(this.defaults);
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (isPlainObject(base) && isPlainObject(parsed)) return Object.assign(base, parsed);
      return parsed ?? base;
    } catch {
      return base;
    }
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), this.delay);
  }

  flush() {
    clearTimeout(this._timer);
    this._timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] falha ao salvar', this.file, err);
    }
  }
}

module.exports = { JsonStore };
