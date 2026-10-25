'use strict';
// Janela do JavaScript Injector: editor, saída do console e scripts salvos.
(() => {
  const api = window.injector;
  const { icon } = window.PulseIcons;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const code = $('#code');
  const hl = $('#hl');
  const gutter = $('#gutter');
  const out = $('#out');
  const drawer = $('#drawer');
  const runBtn = $('#btn-run');
  const MAX_LINES = 1500;

  let target = { ok: false };
  let scripts = [];
  let history = [];
  let histPos = -1;
  let current = null; // script salvo que está no editor
  let running = 0;

  if (!api) {
    document.body.innerHTML = '<p style="padding:20px">Abra o JavaScript Injector pelo menu ⋮ › Ferramentas do desenvolvedor.</p>';
    return;
  }

  // ---------------------------------------------------------------- Ícones
  $('#btn-reload').innerHTML = icon('reload', 16);
  $('#btn-clear').innerHTML = icon('trash', 16);
  $('#btn-scripts').innerHTML = icon('save', 16);
  $('#d-close').innerHTML = icon('x', 16);
  runBtn.querySelector('.run-ico').innerHTML = icon('play', 14);

  // ---------------------------------------------------------------- Realce de sintaxe
  const KW = 'const|let|var|function|return|if|else|for|while|do|break|continue|switch|case|default|new|delete|typeof|instanceof|in|of|class|extends|super|this|try|catch|finally|throw|async|await|yield|import|export|from|null|undefined|true|false|void|static|get|set';
  const TOKENS = new RegExp([
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))', // comentários
    '(`(?:\\\\[\\s\\S]|[^\\\\`])*`?|"(?:\\\\.|[^\\\\"\\n])*"?|\'(?:\\\\.|[^\\\\\'\\n])*\'?)', // textos
    '(\\b(?:0[xX][\\da-fA-F_]+n?|\\d[\\d_]*(?:\\.[\\d_]+)?(?:[eE][+-]?\\d+)?n?)\\b)', // números
    `(\\b(?:${KW})\\b)`, // palavras-chave
    '([A-Za-z_$][\\w$]*(?=\\s*\\())', // chamadas
  ].join('|'), 'g');
  const CLS = [null, 'tk-com', 'tk-str', 'tk-num', 'tk-kw', 'tk-fn'];

  function highlight(src) {
    let html = '';
    let last = 0;
    TOKENS.lastIndex = 0;
    let m;
    while ((m = TOKENS.exec(src))) {
      if (m.index > last) html += esc(src.slice(last, m.index));
      let k = 1;
      while (!m[k]) k++;
      html += `<span class="${CLS[k]}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
      if (m[0].length === 0) TOKENS.lastIndex++;
    }
    return html + esc(src.slice(last));
  }

  let lastLines = 0;
  function refreshEditor() {
    hl.innerHTML = `${highlight(code.value)}\n `;
    const lines = code.value.split('\n').length;
    if (lines !== lastLines) {
      lastLines = lines;
      let g = '';
      for (let i = 1; i <= lines; i++) g += `${i}\n`;
      gutter.textContent = g;
    }
    syncScroll();
  }
  function syncScroll() {
    hl.scrollTop = code.scrollTop;
    hl.scrollLeft = code.scrollLeft;
    gutter.scrollTop = code.scrollTop;
  }
  code.addEventListener('scroll', syncScroll);

  let draftTimer = 0;
  code.addEventListener('input', () => {
    refreshEditor();
    histPos = -1;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => api.invoke('injector:draft', code.value).catch(() => {}), 500);
  });

  function setCode(text) {
    code.value = text;
    refreshEditor();
    api.invoke('injector:draft', text).catch(() => {});
  }

  // Edita o texto mantendo o desfazer (Ctrl+Z) do navegador.
  function insert(text, selStart = code.selectionStart, selEnd = code.selectionEnd) {
    code.setSelectionRange(selStart, selEnd);
    document.execCommand('insertText', false, text);
  }

  code.addEventListener('keydown', (e) => {
    const v = code.value;
    const s = code.selectionStart;
    const end = code.selectionEnd;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      run();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      if (s === end && !e.shiftKey) {
        insert('  ');
        return;
      }
      // Recuo de várias linhas
      const block = v.slice(lineStart, end);
      const changed = e.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
      insert(changed, lineStart, end);
      code.setSelectionRange(lineStart, lineStart + changed.length);
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      // Mantém o recuo da linha e abre um nível depois de { [ (
      e.preventDefault();
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const indent = (v.slice(lineStart, s).match(/^[ \t]*/) || [''])[0];
      const prev = v.slice(0, s).trimEnd().slice(-1);
      const next = v.slice(end, end + 1);
      if ('{[('.includes(prev) && prev && '}])'.includes(next) && next) {
        insert(`\n${indent}  \n${indent}`);
        const pos = s + indent.length + 3;
        code.setSelectionRange(pos, pos);
      } else {
        insert(`\n${indent}${'{[('.includes(prev) && prev ? '  ' : ''}`);
      }
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      stepHistory(e.key === 'ArrowUp' ? -1 : 1);
    } else if ('([{"\'`'.includes(e.key) && !e.ctrlKey && !e.altKey && s !== end) {
      // Envolve a seleção
      e.preventDefault();
      const close = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' }[e.key];
      const sel = v.slice(s, end);
      insert(`${e.key}${sel}${close}`);
      code.setSelectionRange(s + 1, s + 1 + sel.length);
    }
  });

  function stepHistory(dir) {
    if (!history.length) return;
    if (histPos === -1) histPos = history.length;
    histPos = Math.max(0, Math.min(history.length, histPos + dir));
    const text = histPos === history.length ? '' : history[histPos];
    code.value = text;
    refreshEditor();
    code.setSelectionRange(text.length, text.length);
  }

  // ---------------------------------------------------------------- Divisória arrastável
  const split = $('#split');
  try {
    const h = localStorage.getItem('injector-editor-h');
    if (h) document.documentElement.style.setProperty('--editor-h', h);
  } catch { /* sem armazenamento */ }
  split.addEventListener('pointerdown', (e) => {
    split.setPointerCapture(e.pointerId);
    split.classList.add('drag');
    const main = $('#main').getBoundingClientRect();
    const move = (ev) => {
      const pct = Math.max(15, Math.min(85, ((ev.clientY - main.top) / main.height) * 100));
      document.documentElement.style.setProperty('--editor-h', `${pct.toFixed(1)}%`);
    };
    const up = () => {
      split.classList.remove('drag');
      split.removeEventListener('pointermove', move);
      try {
        localStorage.setItem('injector-editor-h', getComputedStyle(document.documentElement).getPropertyValue('--editor-h').trim());
      } catch { /* sem armazenamento */ }
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up, { once: true });
  });

  // ---------------------------------------------------------------- Saída
  const nearBottom = () => out.scrollHeight - out.scrollTop - out.clientHeight < 40;
  function addLine(cls, glyph, html, where = '', { pageOnly = false } = {}) {
    const stick = nearBottom();
    const el = document.createElement('div');
    el.className = `ln ${cls}${pageOnly ? ' page' : ''}`;
    el.innerHTML = `<span class="g">${glyph}</span><span class="v">${html}</span>${where ? `<span class="w">${esc(where)}</span>` : ''}`;
    out.querySelector('.welcome')?.remove();
    out.appendChild(el);
    while (out.childElementCount > MAX_LINES) out.firstElementChild.remove();
    if (stick) out.scrollTop = out.scrollHeight;
    return el;
  }
  const part = (p) => `<span class="${esc(p.cls)}">${esc(p.text)}</span>`;

  function welcome() {
    out.innerHTML = `<div class="welcome">
      <b>Rode JavaScript na aba aberta</b>, como no console do F12. O código roda na própria página.
      <ul>
        <li><kbd>Ctrl+Enter</kbd> roda · <kbd>Alt+↑</kbd> <kbd>Alt+↓</kbd> navegam no histórico · <kbd>Ctrl+L</kbd> limpa</li>
        <li><code>await</code> funciona direto: <code>await fetch('/').then(r => r.status)</code></li>
        <li>Atalhos do console: <code>$('h1')</code>, <code>$$('a').length</code>, <code>copy(texto)</code></li>
        <li>Salve scripts no botão ${icon('save', 12)} e marque "Rodar sozinho" para eles rodarem sempre que abrir um site.</li>
      </ul></div>`;
  }

  function onLogs(batch) {
    for (const m of batch) {
      if (m.kind === 'nav') {
        if (out.lastElementChild?.classList.contains('nav')) continue;
        addLine('nav', '', `↻ Página carregada${target.host ? ` — ${esc(target.host)}` : ''}`);
      } else if (m.kind === 'auto') {
        const el = addLine(`auto${m.error ? ' bad' : ''}`, '⚡', m.error
          ? `Script "${esc(m.name)}" falhou em ${esc(m.host)}: ${esc(m.error)}`
          : `Script "${esc(m.name)}" rodou sozinho em ${esc(m.host)}`);
        el.title = 'Script salvo com "Rodar sozinho"';
      } else {
        const glyph = m.level === 'error' ? '✕' : m.level === 'warn' ? '⚠' : m.level === 'info' || m.level === 'debug' ? 'ℹ' : ' ';
        const tag = m.mine ? '' : '<span class="page-tag">página</span>';
        addLine(m.level, glyph, tag + m.parts.map(part).join(' '), m.where, { pageOnly: !m.mine });
      }
    }
  }

  async function run(text = code.value) {
    if (!text.trim()) {
      code.focus();
      return;
    }
    const preview = text.length > 600 ? `${text.slice(0, 600)}…` : text;
    const lines = preview.split('\n');
    const short = lines.length > 8 ? `${lines.slice(0, 8).join('\n')}\n…` : preview;
    const input = addLine('in', '›', esc(short));
    input.querySelector('.v').title = 'Clique para trazer de volta ao editor';
    input.querySelector('.v').addEventListener('click', () => {
      setCode(text);
      code.focus();
    });
    history = history.filter((h) => h !== text);
    history.push(text);
    histPos = -1;
    const pending = addLine('res pending', '…', '<span class="undef">rodando…</span>');
    running++;
    runBtn.classList.add('busy');
    try {
      const r = await api.invoke('injector:run', text);
      if (r.ok) {
        pending.className = 'ln res';
        pending.querySelector('.g').textContent = '←';
        pending.querySelector('.v').innerHTML = part(r.value);
      } else {
        pending.className = 'ln error';
        pending.querySelector('.g').textContent = '✕';
        pending.querySelector('.v').innerHTML = esc(r.error);
      }
    } catch (err) {
      pending.className = 'ln error';
      pending.querySelector('.g').textContent = '✕';
      pending.querySelector('.v').textContent = err.message;
    } finally {
      running--;
      if (!running) runBtn.classList.remove('busy');
      if (nearBottom()) out.scrollTop = out.scrollHeight;
    }
  }

  // ---------------------------------------------------------------- Aba alvo
  function setTarget(t, flash = true) {
    const changed = target.id !== t.id;
    target = t;
    const box = $('#target');
    box.classList.toggle('ok', !!t.ok);
    $('#t-title').textContent = t.title || 'Sem título';
    $('#t-host').textContent = t.ok ? `Rodando em ${t.host || t.url}` : t.reason || '';
    box.title = t.url || '';
    runBtn.disabled = false;
    $('#btn-reload').disabled = !t.ok;
    if (changed && flash) {
      box.classList.remove('flash');
      void box.offsetWidth;
      box.classList.add('flash');
    }
  }

  // ---------------------------------------------------------------- Scripts salvos
  const fName = $('#f-name');
  const fAuto = $('#f-auto');
  const fSites = $('#f-sites');
  const fErr = $('#f-err');

  function toggleDrawer(open = !drawer.classList.contains('open')) {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    $('#btn-scripts').classList.toggle('on', open);
    if (open) {
      if (!fName.value) fName.value = current ? current.name : '';
      setTimeout(() => (current ? code : fName).focus(), 50);
    }
  }

  function syncForm() {
    fName.value = current ? current.name : '';
    fAuto.checked = current ? !!current.auto : false;
    fSites.value = current ? current.sites || '' : target.ok && target.host && !target.url.startsWith('file:') ? target.host.replace(/^www\./, '') : '';
    fSites.disabled = !fAuto.checked;
    $('#f-save').textContent = current ? 'Salvar alterações' : 'Salvar código atual';
    fErr.hidden = true;
    const ed = $('#editing');
    ed.hidden = !current;
    if (current) ed.querySelector('span').textContent = `Editando "${current.name}"`;
  }
  fAuto.addEventListener('change', () => {
    fSites.disabled = !fAuto.checked;
    if (fAuto.checked && !fSites.value && target.host) fSites.value = target.host.replace(/^www\./, '');
    if (fAuto.checked) fSites.focus();
  });

  function renderScripts() {
    const list = $('#d-list');
    if (current) current = scripts.find((s) => s.id === current.id) || null;
    if (!scripts.length) {
      list.innerHTML = '<div class="d-empty">Nenhum script salvo ainda.<br>Escreva um código e clique em "Salvar código atual".</div>';
      return;
    }
    list.innerHTML = scripts.map((s, i) => `<div class="s-item ${current && current.id === s.id ? 'cur' : ''}" data-id="${esc(s.id)}" style="--i:${i}">
      <div class="s-main" title="Abrir no editor"><b>${esc(s.name)}</b>
        <span class="${s.auto ? 'auto' : ''}">${s.auto ? `Roda sozinho: ${esc(s.sites === '*' ? 'todos os sites' : s.sites)}` : s.sites ? `Pausado · ${esc(s.sites)}` : 'Só manual'}</span></div>
      <label class="switch" title="${s.sites ? 'Rodar sozinho nos sites escolhidos' : 'Abra o script e informe os sites para rodar sozinho'}"><input type="checkbox" data-auto ${s.auto ? 'checked' : ''} ${s.sites ? '' : 'disabled'}></label>
      <button class="ib" data-run title="Rodar agora nesta página">${icon('play', 14)}</button>
      <button class="ib" data-del title="Excluir">${icon('trash', 14)}</button>
    </div>`).join('');
  }

  $('#d-list').addEventListener('click', (e) => {
    const item = e.target.closest('.s-item');
    if (!item) return;
    const s = scripts.find((x) => x.id === item.dataset.id);
    if (!s) return;
    if (e.target.closest('[data-run]')) {
      run(s.code);
    } else if (e.target.closest('[data-del]')) {
      const b = e.target.closest('[data-del]');
      if (!b.classList.contains('confirm')) {
        b.classList.add('confirm');
        b.textContent = 'Excluir?';
        setTimeout(() => {
          if (b.isConnected) {
            b.classList.remove('confirm');
            b.innerHTML = icon('trash', 14);
          }
        }, 3000);
        return;
      }
      if (current && current.id === s.id) current = null;
      api.invoke('injector:delete-script', s.id);
      syncForm();
    } else if (e.target.closest('.s-main')) {
      current = s;
      setCode(s.code);
      syncForm();
      renderScripts();
      code.focus();
    }
  });
  $('#d-list').addEventListener('change', (e) => {
    const box = e.target.closest('[data-auto]');
    if (!box) return;
    api.invoke('injector:set-auto', box.closest('.s-item').dataset.id, box.checked);
  });

  async function saveScript() {
    fErr.hidden = true;
    if (!code.value.trim()) {
      fErr.textContent = 'O editor está vazio.';
      fErr.hidden = false;
      return;
    }
    if (fAuto.checked && !fSites.value.trim()) {
      fErr.textContent = 'Informe em quais sites ele deve rodar (ou * para todos).';
      fErr.hidden = false;
      fSites.focus();
      return;
    }
    try {
      const saved = await api.invoke('injector:save-script', {
        id: current ? current.id : null,
        name: fName.value.trim() || firstLineName(code.value),
        code: code.value,
        auto: fAuto.checked,
        sites: fSites.value,
      });
      current = saved;
      syncForm();
      renderScripts();
      addLine('note', '✓', `Script "${esc(saved.name)}" salvo${saved.auto ? ` — roda sozinho em ${esc(saved.sites === '*' ? 'todos os sites' : saved.sites)}` : ''}`);
    } catch (err) {
      fErr.textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      fErr.hidden = false;
    }
  }
  function firstLineName(text) {
    const line = text.split('\n').map((l) => l.trim()).find(Boolean) || 'Script';
    return line.replace(/^\/\/\s*/, '').slice(0, 40);
  }
  $('#save-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveScript();
  });
  $('#f-new').addEventListener('click', () => {
    current = null;
    setCode('');
    syncForm();
    renderScripts();
    fName.focus();
  });
  $('#editing-close').addEventListener('click', () => {
    current = null;
    syncForm();
    renderScripts();
  });

  // ---------------------------------------------------------------- Botões e atalhos
  runBtn.addEventListener('click', () => run());
  $('#btn-clear').addEventListener('click', () => {
    out.innerHTML = '';
    code.focus();
  });
  $('#btn-reload').addEventListener('click', () => api.invoke('injector:reload-target'));
  $('#btn-scripts').addEventListener('click', () => toggleDrawer());
  $('#d-close').addEventListener('click', () => toggleDrawer(false));
  $('#all-logs').addEventListener('change', (e) => {
    out.classList.toggle('all', e.target.checked);
    try {
      localStorage.setItem('injector-all-logs', e.target.checked ? '1' : '0');
    } catch { /* sem armazenamento */ }
    out.scrollTop = out.scrollHeight;
  });
  try {
    if (localStorage.getItem('injector-all-logs') === '1') {
      $('#all-logs').checked = true;
      out.classList.add('all');
    }
  } catch { /* sem armazenamento */ }

  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === 'l') {
      e.preventDefault();
      out.innerHTML = '';
    } else if (e.ctrlKey && k === 's') {
      e.preventDefault();
      if (!drawer.classList.contains('open')) toggleDrawer(true);
      if (current) saveScript();
      else fName.focus();
    } else if (e.key === 'Escape' && drawer.classList.contains('open')) {
      toggleDrawer(false);
      code.focus();
    } else if (e.ctrlKey && e.key === 'Enter' && document.activeElement !== code) {
      e.preventDefault();
      run();
    }
  });

  // ---------------------------------------------------------------- Início
  api.on('injector:target', (t) => setTarget(t));
  api.on('injector:logs', onLogs);
  api.on('injector:scripts', (list) => {
    scripts = list;
    renderScripts();
  });

  api.invoke('injector:init').then((d) => {
    if (d.accent) document.documentElement.style.setProperty('--accent', d.accent);
    if (d.incognito) document.body.classList.add('incognito');
    history = d.history || [];
    scripts = d.scripts || [];
    setTarget(d.target, false);
    code.value = d.draft || '';
    refreshEditor();
    renderScripts();
    syncForm();
    welcome();
    code.focus();
    code.setSelectionRange(code.value.length, code.value.length);
  });
  refreshEditor();
})();
