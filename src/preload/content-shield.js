'use strict';
// Pulse Shield nas páginas: esconde espaços de anúncio e avisos de cookies (regras cosméticas) e roda os
// scripts de correção das listas de filtros (ex.: anúncios do YouTube) antes dos scripts do próprio site.
// Roda no mundo isolado: o site não enxerga este script.
const { ipcRenderer, webFrame } = require('electron');

(() => {
  if (!/^https?:$/.test(location.protocol)) return;
  let start = null;
  try {
    start = ipcRenderer.sendSync('shield:frame-start', location.href);
  } catch {
    return;
  }
  if (!start) return;

  for (const code of start.scripts || []) {
    webFrame.executeJavaScript(code).catch(() => {});
  }
  const addCss = (css) => {
    if (!css) return;
    try {
      webFrame.insertCSS(css, { cssOrigin: 'user' });
    } catch { /* documento já descartado */ }
  };
  addCss(start.styles);
  if (!start.generic) return;

  // Regras genéricas por classe, id e link: o navegador só devolve os seletores que existem na página,
  // em vez de aplicar dezenas de milhares de seletores em todo site.
  const seen = { classes: new Set(), ids: new Set(), hrefs: new Set() };
  let batch = { classes: [], ids: [], hrefs: [] };
  let timer = 0;
  let sent = 0;

  const flush = () => {
    timer = 0;
    const msg = batch;
    batch = { classes: [], ids: [], hrefs: [] };
    if (!msg.classes.length && !msg.ids.length && !msg.hrefs.length) return;
    sent++;
    ipcRenderer.invoke('shield:dom', msg).then(addCss).catch(() => {});
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(flush, sent === 0 ? 0 : 250);
  };

  const add = (kind, value) => {
    if (!value || value.length > 200 || seen[kind].has(value)) return;
    seen[kind].add(value);
    batch[kind].push(value);
  };
  const collect = (el) => {
    if (el.nodeType !== 1) return;
    const cls = el.classList;
    if (cls) for (let i = 0; i < cls.length; i++) add('classes', cls[i]);
    if (el.id) add('ids', el.id);
    if (el.tagName === 'A' && seen.hrefs.size < 3000) {
      const href = el.getAttribute('href');
      if (href && /^https?:/i.test(href)) add('hrefs', href);
    }
  };
  const scan = (root) => {
    collect(root);
    if (!root.querySelectorAll) return;
    const all = root.querySelectorAll('[class],[id],a[href]');
    for (let i = 0; i < all.length; i++) collect(all[i]);
  };

  const begin = () => {
    if (!document.documentElement) return;
    scan(document.documentElement);
    schedule();
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') collect(r.target);
        else for (const n of r.addedNodes) if (n.nodeType === 1) scan(n);
      }
      if (batch.classes.length || batch.ids.length || batch.hrefs.length) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'id', 'href'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true });
  else begin();
})();
