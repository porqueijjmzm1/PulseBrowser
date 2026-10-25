(async () => {
  const $ = (s) => document.querySelector(s);
  const DEFAULTS = { all: false, smart: true, sites: {}, brightness: 100, contrast: 100, sepia: 0 };
  let cfg = { ...DEFAULTS, ...((await tuff.storage.get('cfg')) || {}) };
  cfg.sites = { ...(cfg.sites || {}) };

  let host = '';
  try {
    const tab = await tuff.tabs.active();
    const u = new URL(tab.url);
    if (/^https?:$/.test(u.protocol)) host = u.hostname.replace(/^www\./, '');
  } catch { /* aba sem site */ }

  // Estado que o script da página deixou marcado (site já escuro, ligado, desligado).
  let pageState = '';
  if (host) {
    try {
      pageState = await tuff.tabs.execute('document.documentElement.dataset.tuffDark || ""');
    } catch { /* página sem o script */ }
  }

  const save = () => tuff.storage.set('cfg', cfg);
  const siteOn = () => (cfg.sites[host] !== undefined ? cfg.sites[host] : cfg.all && !(cfg.smart && pageState === 'dark-site'));

  function render() {
    $('#host').textContent = host || 'Nenhum site aberto';
    $('#site').disabled = !host;
    $('#site').checked = !!host && siteOn();
    const custom = host && cfg.sites[host] !== undefined;
    $('#state').textContent = !host ? 'Abra um site para escurecer'
      : custom ? (cfg.sites[host] ? 'Sempre escuro neste site' : 'Nunca escuro neste site')
        : pageState === 'dark-site' && cfg.all && cfg.smart ? 'O site já é escuro' : siteOn() ? 'Escuro (todos os sites)' : 'Cores originais';
    $('#forget').hidden = !custom;
    $('#all').checked = !!cfg.all;
    $('#smart').checked = !!cfg.smart;
    for (const k of ['brightness', 'contrast', 'sepia']) {
      const input = $(`#${k}`);
      input.value = cfg[k];
      input.nextElementSibling.textContent = `${cfg[k]}%`;
    }
  }

  $('#site').addEventListener('change', (e) => {
    cfg.sites[host] = e.target.checked;
    if (cfg.sites[host] === (cfg.all && !(cfg.smart && pageState === 'dark-site'))) delete cfg.sites[host];
    save();
    render();
  });
  $('#all').addEventListener('change', (e) => {
    cfg.all = e.target.checked;
    save();
    render();
  });
  $('#smart').addEventListener('change', (e) => {
    cfg.smart = e.target.checked;
    save();
    render();
  });
  for (const k of ['brightness', 'contrast', 'sepia']) {
    $(`#${k}`).addEventListener('input', (e) => {
      cfg[k] = Number(e.target.value);
      e.target.nextElementSibling.textContent = `${cfg[k]}%`;
      save();
    });
  }
  $('#reset').addEventListener('click', () => {
    Object.assign(cfg, { brightness: 100, contrast: 100, sepia: 0 });
    save();
    render();
  });
  $('#forget').addEventListener('click', () => {
    delete cfg.sites[host];
    save();
    render();
  });
  render();
})();
