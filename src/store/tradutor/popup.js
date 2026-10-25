(async () => {
  const $ = (s) => document.querySelector(s);
  const DEFAULTS = { target: 'pt', button: true };
  const LANGS = [['pt', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol'], ['fr', 'Francês'], ['de', 'Alemão'], ['it', 'Italiano'], ['ja', 'Japonês'], ['ko', 'Coreano'], ['zh-CN', 'Chinês'], ['ru', 'Russo']];
  const NAMES = { pt: 'português', en: 'inglês', es: 'espanhol', fr: 'francês', de: 'alemão', it: 'italiano', ja: 'japonês', ko: 'coreano', 'zh-CN': 'chinês', zh: 'chinês', ru: 'russo', nl: 'holandês', ar: 'árabe', tr: 'turco', pl: 'polonês' };
  let cfg = { ...DEFAULTS, ...((await tuff.storage.get('cfg')) || {}) };
  const draft = (await tuff.storage.get('draft')) || '';

  $('#target').innerHTML = LANGS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
  $('#target').value = cfg.target;
  $('#button').checked = cfg.button;

  let seq = 0;
  async function run() {
    const text = $('#text').value.trim();
    tuff.storage.set('draft', $('#text').value);
    const out = $('#out');
    if (!text) {
      out.textContent = 'A tradução aparece aqui';
      out.classList.add('empty');
      $('#from').textContent = '';
      return;
    }
    const id = ++seq;
    out.classList.add('empty');
    out.textContent = 'Traduzindo…';
    try {
      const res = await tuff.fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(cfg.target)}&dt=t&dj=1`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `q=${encodeURIComponent(text)}`,
      });
      if (id !== seq) return;
      const data = JSON.parse(res.text);
      out.textContent = (data.sentences || []).map((s) => s.trans || '').join('') || '(sem tradução)';
      out.classList.remove('empty');
      $('#from').textContent = data.src ? `Detectado: ${NAMES[data.src] || data.src}` : '';
    } catch {
      if (id === seq) out.textContent = 'Não foi possível traduzir agora. Verifique a conexão.';
    }
  }
  let timer = 0;
  $('#text').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 350);
  });
  $('#target').addEventListener('change', (e) => {
    cfg.target = e.target.value;
    tuff.storage.set('cfg', cfg);
    run();
  });
  $('#button').addEventListener('change', (e) => {
    cfg.button = e.target.checked;
    tuff.storage.set('cfg', cfg);
  });
  $('#copy').addEventListener('click', async () => {
    const t = $('#out').classList.contains('empty') ? '' : $('#out').textContent;
    if (!t) return;
    await navigator.clipboard.writeText(t).catch(() => {});
    $('#copy').textContent = 'Copiado!';
    setTimeout(() => ($('#copy').textContent = 'Copiar'), 1200);
  });
  // A página inteira abre traduzida pelo Google Tradutor.
  $('#page').addEventListener('click', async () => {
    try {
      const tab = await tuff.tabs.active();
      if (!tab || !/^https?:/.test(tab.url)) throw new Error('internal');
      await tuff.tabs.update({ url: `https://translate.google.com/translate?sl=auto&tl=${encodeURIComponent(cfg.target)}&u=${encodeURIComponent(tab.url)}` });
    } catch {
      $('#from').textContent = 'Abra um site para traduzir a página.';
    }
  });

  // Com texto selecionado na aba, o pop-up já abre traduzindo ele.
  let selected = '';
  try {
    selected = String(await tuff.tabs.execute('String(getSelection()).slice(0, 5000)') || '').trim();
  } catch { /* página sem acesso */ }
  $('#text').value = selected || draft;
  if ($('#text').value.trim()) run();
  $('#text').focus();
})();
