(async () => {
  const $ = (s) => document.querySelector(s);
  const DEFAULTS = { theme: 'light', font: 'serif', size: 20, width: 'medium', fab: false };
  let cfg = { ...DEFAULTS, ...((await tuff.storage.get('cfg')) || {}) };

  function render() {
    for (const k of ['font', 'width']) document.querySelectorAll(`#${k} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === cfg[k]));
    document.querySelectorAll('#themes button').forEach((b) => b.classList.toggle('on', b.dataset.v === cfg.theme));
    $('#size').textContent = `${cfg.size}px`;
    $('#fab').checked = !!cfg.fab;
  }
  const save = () => {
    render();
    tuff.storage.set('cfg', cfg);
  };

  $('#open').addEventListener('click', async () => {
    try {
      const tab = await tuff.tabs.active();
      if (!tab || !/^https?:/.test(tab.url)) throw new Error('internal');
      await tuff.tabs.execute("document.dispatchEvent(new Event('tuff-reader-toggle'))");
      tuff.popup.close();
    } catch {
      $('#msg').textContent = 'Abra um artigo ou notícia para usar o modo leitura.';
    }
  });
  for (const k of ['font', 'width', 'themes']) {
    $(`#${k}`).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      cfg[k === 'themes' ? 'theme' : k] = b.dataset.v;
      save();
    });
  }
  $('#smaller').addEventListener('click', () => {
    cfg.size = Math.max(14, cfg.size - 2);
    save();
  });
  $('#bigger').addEventListener('click', () => {
    cfg.size = Math.min(34, cfg.size + 2);
    save();
  });
  $('#fab').addEventListener('change', (e) => {
    cfg.fab = e.target.checked;
    save();
  });
  render();
})();
