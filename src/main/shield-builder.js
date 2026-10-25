'use strict';
// Processo separado (utilityProcess) que monta o motor de filtros do Pulse Shield.
// Ler e compilar ~400 mil regras leva cerca de 1 segundo; aqui isso não trava o navegador.
const fs = require('fs');
const { FiltersEngine } = require('@ghostery/adblocker');
const { ENGINE_CONFIG } = require('./shield-core');

process.parentPort.once('message', (event) => {
  const { files = [], resources = '', out } = event.data || {};
  try {
    const t0 = Date.now();
    const text = files.map((f) => {
      try {
        return fs.readFileSync(f, 'utf8');
      } catch {
        return '';
      }
    }).join('\n');
    const engine = FiltersEngine.parse(text, ENGINE_CONFIG);
    if (resources) {
      try {
        const data = fs.readFileSync(resources, 'utf8');
        engine.updateResources(data, String(data.length));
      } catch { /* sem substitutos: o bloqueio continua funcionando */ }
    }
    const { networkFilters, cosmeticFilters } = engine.getFilters();
    const buf = engine.serialize();
    fs.writeFileSync(`${out}.tmp`, buf);
    fs.renameSync(`${out}.tmp`, out);
    process.parentPort.postMessage({
      ok: true, ms: Date.now() - t0, bytes: buf.length, network: networkFilters.length, cosmetic: cosmeticFilters.length,
    });
  } catch (err) {
    process.parentPort.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
});
