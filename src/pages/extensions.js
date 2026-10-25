'use strict';
// tuff://extensions — gerencia, cria e edita as extensões do tuff.browse.
(async () => {
  const { $, $$, esc, toast, init, icon, debounce } = window.Pulse;
  const api = (ch, ...args) => window.pulse.invoke(`internal:${ch}`, ...args);
  const cleanError = (err) => String(err && err.message ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  await init();

  let items = [];
  const q = $('#q');

  // ---------------------------------------------------------------- Lista
  async function load() {
    try {
      const res = await api('ext-list');
      items = res.items || [];
    } catch (err) {
      toast(cleanError(err));
      items = [];
    }
    renderList();
  }

  function chips(x) {
    const out = [];
    if (x.builtin) out.push('<span class="chip builtin">De fábrica</span>');
    if (x.newtab) out.push(`<span class="chip ${x.newtabActive ? 'accent' : ''}">${icon('sparkles', 12)}${x.newtabActive ? 'Nova aba ativa' : 'Nova aba'}</span>`);
    if (x.popup) out.push(`<span class="chip">${icon('puzzle', 12)}Pop-up</span>`);
    if (x.run) out.push(`<span class="chip">${icon('play', 12)}Script de clique</span>`);
    if (x.scripts.length) {
      const sites = x.sites.includes('<all_urls>') || x.sites.includes('*') ? 'Todos os sites' : x.sites.slice(0, 3).join(', ') + (x.sites.length > 3 ? '…' : '');
      out.push(`<span class="chip" title="${esc(x.sites.join('\n'))}">${icon('globe', 12)}${esc(sites)}</span>`);
      if (x.scripts.some((s) => s.world === 'MAIN')) out.push('<span class="chip" title="Roda junto com o JavaScript do site">MAIN</span>');
    }
    if (x.incognito) out.push(`<span class="chip">${icon('incognito', 12)}Anônimo</span>`);
    return out.join('');
  }

  function card(x, i) {
    const errors = x.errors.length ? `<div class="ext-errors">${x.errors.map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : '';
    const runLabel = x.popup ? 'Abrir' : x.run ? 'Executar' : '';
    return `<div class="card ext${x.enabled ? '' : ' off'}" data-id="${esc(x.id)}" style="--i:${Math.min(i, 12)}">
      <div class="ext-top">
        <img class="ext-icon" src="${esc(x.icon)}" alt="">
        <div class="ext-title"><b title="${esc(x.name)}">${esc(x.name)}</b><span class="muted">${esc(x.version ? `v${x.version}` : '')}${x.author ? ` • ${esc(x.author)}` : ''}</span></div>
        <label class="switch" title="${x.enabled ? 'Desativar' : 'Ativar'}"><input type="checkbox" data-a="enable" ${x.enabled ? 'checked' : ''}></label>
      </div>
      <div class="ext-desc">${esc(x.description || 'Sem descrição')}</div>
      <div class="chips">${chips(x)}</div>
      ${errors}
      <div class="ext-actions">
        <button class="btn" data-a="edit">${x.builtin ? 'Ver código' : 'Editar código'}</button>
        ${runLabel && x.enabled ? `<button class="btn" data-a="run">${runLabel}</button>` : ''}
        ${x.options && x.enabled ? '<button class="btn" data-a="options">Opções</button>' : ''}
        <span class="grow"></span>
        <button class="icon-btn ${x.pinned ? 'on' : ''}" data-a="pin" title="${x.pinned ? 'Desafixar da barra' : 'Fixar na barra'}">${icon('pin', 16)}</button>
        <button class="icon-btn" data-a="more" title="Mais opções">${icon('more', 16)}</button>
      </div>
    </div>`;
  }

  function renderList() {
    const text = q.value.trim().toLowerCase();
    const match = (x) => !text || `${x.name} ${x.description} ${x.id}`.toLowerCase().includes(text);
    const mine = items.filter((x) => !x.builtin && match(x));
    const builtin = items.filter((x) => x.builtin && match(x));
    let html = '';
    let i = 0;
    if (mine.length || !text) {
      html += `<div class="group-title">${icon('user', 14)}Suas extensões</div>`;
      html += mine.length
        ? `<div class="grid">${mine.map((x) => card(x, i++)).join('')}</div>`
        : `<div class="card card-pad muted">Você ainda não criou nenhuma extensão. <a href="#new">Criar a primeira</a> leva 10 segundos.</div>`;
    }
    if (builtin.length) {
      html += `<div class="group-title">${icon('sparkles', 14)}De fábrica</div>`;
      html += `<div class="grid">${builtin.map((x) => card(x, i++)).join('')}</div>`;
    }
    $('#groups').innerHTML = html;
    $('#empty').hidden = !!(mine.length || builtin.length || !text);
  }

  $('#groups').addEventListener('click', async (e) => {
    const el = e.target.closest('[data-a]');
    const cardEl = e.target.closest('.ext');
    if (!el || !cardEl || el.dataset.a === 'enable') return;
    const id = cardEl.dataset.id;
    const x = items.find((it) => it.id === id);
    if (!x) return;
    try {
      switch (el.dataset.a) {
        case 'edit': location.hash = `edit/${id}`; break;
        case 'run': await api('ext-run', id); break;
        case 'options': await api('ext-options', id); break;
        case 'pin':
          await api('ext-set-pinned', id, !x.pinned);
          toast(x.pinned ? 'Desafixada da barra' : 'Fixada na barra de ferramentas');
          break;
        case 'more': openMenu(el, x); break;
        default: break;
      }
    } catch (err) {
      toast(cleanError(err));
    }
  });
  $('#groups').addEventListener('change', async (e) => {
    const input = e.target.closest('[data-a="enable"]');
    if (!input) return;
    const id = input.closest('.ext').dataset.id;
    try {
      await api('ext-set-enabled', id, input.checked);
      toast(input.checked ? 'Extensão ativada' : 'Extensão desativada');
    } catch (err) {
      toast(cleanError(err));
    }
  });

  // Menu "mais opções" de cada extensão.
  let menuEl = null;
  function closeMenu() {
    menuEl?.remove();
    menuEl = null;
  }
  function openMenu(anchor, x) {
    closeMenu();
    const entries = [
      ['dup', 'copy', x.builtin ? 'Duplicar (cópia editável)' : 'Duplicar'],
      ['incognito', 'incognito', x.incognito ? 'Não rodar no modo anônimo' : 'Permitir no modo anônimo'],
      ['reload', 'reload', 'Recarregar do disco'],
      ['reload-tabs', 'refreshCcw', 'Recarregar abas onde ela roda'],
      ['folder', 'folderOpen', 'Abrir pasta'],
    ];
    if (!x.builtin) entries.push(['remove', 'trash', 'Remover']);
    menuEl = document.createElement('div');
    menuEl.className = 'menu-pop';
    menuEl.innerHTML = entries.map(([a, ic, label]) => `<button data-m="${a}">${icon(ic, 16)}${esc(label)}</button>`).join('');
    document.body.appendChild(menuEl);
    const r = anchor.getBoundingClientRect();
    const w = menuEl.offsetWidth;
    const h = menuEl.offsetHeight;
    menuEl.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    menuEl.style.top = `${r.bottom + 4 + h > innerHeight ? r.top - h - 4 : r.bottom + 4}px`;
    menuEl.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      closeMenu();
      try {
        switch (b.dataset.m) {
          case 'dup': {
            const id = await api('ext-duplicate', x.id);
            toast('Cópia criada (começa desativada)');
            location.hash = `edit/${id}`;
            break;
          }
          case 'incognito': await api('ext-set-incognito', x.id, !x.incognito); break;
          case 'reload': {
            const res = await api('ext-reload', x.id);
            toast(res.errors.length ? `Recarregada com ${res.errors.length} erro(s)` : 'Extensão recarregada');
            break;
          }
          case 'reload-tabs': {
            const n = await api('ext-reload-tabs', x.id);
            toast(n ? `${n} aba(s) recarregada(s)` : 'Nenhuma aba aberta usa esta extensão');
            break;
          }
          case 'folder': await api('ext-open-folder', x.id); break;
          case 'remove':
            if (!window.confirm(`Remover a extensão "${x.name}"? A pasta vai para a Lixeira.`)) return;
            await api('ext-remove', x.id);
            toast('Extensão removida');
            break;
          default: break;
        }
      } catch (err) {
        toast(cleanError(err));
      }
    });
  }
  document.addEventListener('mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  });
  window.addEventListener('blur', closeMenu);

  q.addEventListener('input', debounce(renderList, 80));
  $('#btn-new').addEventListener('click', () => {
    location.hash = 'new';
  });
  $('#btn-import').addEventListener('click', async () => {
    try {
      const id = await api('ext-import');
      if (id) {
        toast('Extensão importada');
        location.hash = id;
      }
    } catch (err) {
      toast(cleanError(err));
    }
  });
  $('#nav-folder').addEventListener('click', () => api('ext-open-folder'));
  $('#nav-reload').addEventListener('click', async () => {
    await api('ext-reload');
    toast('Extensões recarregadas');
  });

  // ---------------------------------------------------------------- Criar extensão
  let template = 'script';
  const modal = $('#modal-new');
  function openNew() {
    modal.hidden = false;
    $('#new-name').value = '';
    setTimeout(() => $('#new-name').focus(), 30);
  }
  function closeNew() {
    modal.hidden = true;
    if (location.hash === '#new') history.replaceState(null, '', location.pathname);
  }
  $('#tpl-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.tpl');
    if (!b) return;
    template = b.dataset.tpl;
    $$('.tpl').forEach((t) => t.classList.toggle('on', t === b));
  });
  $('#new-cancel').addEventListener('click', closeNew);
  modal.addEventListener('mousedown', (e) => {
    if (e.target === modal) closeNew();
  });
  $('#new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const id = await api('ext-create', { name: $('#new-name').value.trim(), template });
      modal.hidden = true;
      toast('Extensão criada! Edite o código e salve.');
      location.hash = `edit/${id}`;
    } catch (err) {
      toast(cleanError(err));
    }
  });

  // ---------------------------------------------------------------- Editor de código
  const code = $('#code');
  const hl = $('#hl');
  const gutter = $('#gutter');
  const ed = { id: null, builtin: false, files: [], current: null, buffers: new Map(), saved: new Map() };
  $('#ed-back').innerHTML = icon('chevronLeft', 18);
  $('#ed-folder').innerHTML = icon('folderOpen', 16);

  const KW = 'const|let|var|function|return|if|else|for|while|do|break|continue|switch|case|default|new|delete|typeof|instanceof|in|of|class|extends|super|this|try|catch|finally|throw|async|await|yield|import|export|from|null|undefined|true|false|void|static|get|set';
  const JS_TOKENS = new RegExp([
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)|<!--[\\s\\S]*?(?:-->|$))',
    '(`(?:\\\\[\\s\\S]|[^\\\\`])*`?|"(?:\\\\.|[^\\\\"\\n])*"?|\'(?:\\\\.|[^\\\\\'\\n])*\'?)',
    '(\\b(?:0[xX][\\da-fA-F_]+n?|\\d[\\d_]*(?:\\.[\\d_]+)?(?:[eE][+-]?\\d+)?n?)(?:px|em|rem|%|s|ms|vh|vw|deg)?\\b)',
    `(\\b(?:${KW})\\b)`,
    '([A-Za-z_$][\\w$-]*(?=\\s*\\())',
    '(<\\/?[a-zA-Z][\\w-]*|\\/?>)',
  ].join('|'), 'g');
  const CLS = [null, 'tk-com', 'tk-str', 'tk-num', 'tk-kw', 'tk-fn', 'tk-tag'];
  function highlight(src) {
    if (src.length > 400000) return esc(src);
    let html = '';
    let last = 0;
    JS_TOKENS.lastIndex = 0;
    let m;
    while ((m = JS_TOKENS.exec(src))) {
      if (m.index > last) html += esc(src.slice(last, m.index));
      let k = 1;
      while (!m[k]) k++;
      html += `<span class="${CLS[k]}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
      if (m[0].length === 0) JS_TOKENS.lastIndex++;
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
  code.addEventListener('input', () => {
    refreshEditor();
    if (ed.current) {
      ed.buffers.set(ed.current, code.value);
      markDirty();
    }
  });
  const insert = (text, s = code.selectionStart, e = code.selectionEnd) => {
    code.setSelectionRange(s, e);
    document.execCommand('insertText', false, text);
  };
  code.addEventListener('keydown', (e) => {
    if (code.readOnly) return;
    const v = code.value;
    const s = code.selectionStart;
    const end = code.selectionEnd;
    if (e.key === 'Tab') {
      e.preventDefault();
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      if (s === end && !e.shiftKey) {
        insert('  ');
        return;
      }
      const block = v.slice(lineStart, end);
      const changed = e.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
      insert(changed, lineStart, end);
      code.setSelectionRange(lineStart, lineStart + changed.length);
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey) {
      e.preventDefault();
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const indent = (v.slice(lineStart, s).match(/^[ \t]*/) || [''])[0];
      const prev = v.slice(0, s).trimEnd().slice(-1);
      const next = v.slice(end, end + 1);
      if (prev && '{[('.includes(prev) && next && '}])'.includes(next)) {
        insert(`\n${indent}  \n${indent}`);
        const pos = s + indent.length + 3;
        code.setSelectionRange(pos, pos);
      } else {
        insert(`\n${indent}${prev && '{[('.includes(prev) ? '  ' : ''}`);
      }
    }
  });

  function dirtyFiles() {
    return [...ed.buffers.entries()].filter(([name, text]) => ed.saved.get(name) !== text).map(([name]) => name);
  }
  function markDirty() {
    const dirty = new Set(dirtyFiles());
    $('#ed-dirty').hidden = !dirty.has(ed.current);
    $$('.file').forEach((f) => {
      const dot = f.querySelector('.dot');
      if (dot) dot.hidden = !dirty.has(f.dataset.name);
    });
  }

  const FILE_ICONS = { js: 'code', mjs: 'code', css: 'palette', html: 'globe', htm: 'globe', json: 'settings', svg: 'camera', png: 'camera', jpg: 'camera', jpeg: 'camera', webp: 'camera', gif: 'camera', md: 'fileText', txt: 'fileText' };
  function renderFiles() {
    $('#file-list').innerHTML = ed.files.map((f) => {
      const ext = f.name.split('.').pop().toLowerCase();
      return `<button class="file${f.name === ed.current ? ' on' : ''}" data-name="${esc(f.name)}" title="${esc(f.name)}">
        ${icon(FILE_ICONS[ext] || 'file', 15)}<span class="fname">${esc(f.name)}</span><span class="dot" hidden></span></button>`;
    }).join('') + (ed.builtin ? '' : `<form class="file new-file" id="new-file-form" hidden><input id="new-file-name" placeholder="nome.js" maxlength="80"></form>`);
    markDirty();
  }
  $('#file-list').addEventListener('click', (e) => {
    const b = e.target.closest('button.file');
    if (b) selectFile(b.dataset.name);
  });

  function selectFile(name) {
    const f = ed.files.find((x) => x.name === name);
    if (!f) return;
    ed.current = name;
    $('#ed-file').textContent = name;
    const preview = $('#ed-preview');
    if (!f.text) {
      preview.hidden = false;
      const ext = name.split('.').pop().toLowerCase();
      preview.innerHTML = /^(png|jpe?g|gif|webp|ico|svg)$/.test(ext)
        ? `<img src="tuff-ext://${esc(ed.id)}/${name.split('/').map(encodeURIComponent).join('/')}" alt="">`
        : '<div>Arquivo binário — edite pela pasta da extensão.</div>';
      code.value = '';
    } else {
      preview.hidden = true;
      if (!ed.buffers.has(name)) ed.buffers.set(name, f.content || '');
      code.value = ed.buffers.get(name);
    }
    code.readOnly = ed.builtin || !f.text;
    lastLines = 0;
    refreshEditor();
    code.scrollTop = 0;
    $('#ed-delfile').hidden = ed.builtin || name === 'manifest.json';
    renderFiles();
    if (!code.readOnly) code.focus();
  }

  function showErrors(errors) {
    const box = $('#ed-errors');
    box.hidden = !errors || !errors.length;
    box.innerHTML = (errors || []).map((e) => `<div>${esc(e)}</div>`).join('');
  }

  async function openEditor(id, preferred) {
    let res;
    try {
      res = await api('ext-files', id);
    } catch (err) {
      toast(cleanError(err));
      location.hash = '';
      return;
    }
    const x = items.find((it) => it.id === id) || {};
    ed.id = id;
    ed.builtin = !!res.builtin;
    ed.files = res.files;
    ed.buffers = new Map();
    ed.saved = new Map(res.files.filter((f) => f.text).map((f) => [f.name, f.content || '']));
    document.body.classList.add('editing');
    $('#editor-view').hidden = false;
    $('#ed-name').textContent = x.name || id;
    $('#ed-id').textContent = ed.builtin ? 'Extensão de fábrica' : id;
    $('#ed-icon').src = x.icon || '';
    $('#ed-ro').hidden = !ed.builtin;
    $('#ed-dup').hidden = !ed.builtin;
    $('#ed-save').hidden = ed.builtin;
    $('#ed-save-reload').hidden = ed.builtin;
    $('#ed-newfile').hidden = ed.builtin;
    showErrors(x.errors);
    const first = preferred && res.files.some((f) => f.name === preferred) ? preferred
      : (res.files.find((f) => /\.(m?js)$/.test(f.name) && !f.name.includes('/')) || res.files.find((f) => f.name === 'manifest.json') || res.files[0])?.name;
    if (first) selectFile(first);
    else renderFiles();
  }

  function closeEditor() {
    document.body.classList.remove('editing');
    $('#editor-view').hidden = true;
    ed.id = null;
  }

  async function save(reloadTabs) {
    if (ed.builtin || !ed.id) return;
    const dirty = dirtyFiles();
    let errors = [];
    try {
      for (const name of dirty) {
        const res = await api('ext-write', ed.id, name, ed.buffers.get(name));
        ed.saved.set(name, ed.buffers.get(name));
        errors = res.errors || [];
      }
      if (!dirty.length) {
        const res = await api('ext-reload', ed.id);
        errors = res.errors || [];
      }
      markDirty();
      showErrors(errors);
      let msg = dirty.length ? 'Salvo' : 'Nada para salvar';
      if (reloadTabs) {
        const n = await api('ext-reload-tabs', ed.id);
        msg += n ? ` — ${n} aba(s) recarregada(s)` : ' — nenhuma aba aberta usa a extensão';
      }
      toast(errors.length ? `${msg} (com ${errors.length} aviso(s))` : msg);
    } catch (err) {
      toast(cleanError(err));
    }
  }

  $('#ed-save').addEventListener('click', () => save(false));
  $('#ed-save-reload').addEventListener('click', () => save(true));
  $('#ed-back').addEventListener('click', () => {
    if (dirtyFiles().length && !window.confirm('Há alterações não salvas. Sair mesmo assim?')) return;
    location.hash = ed.id || '';
  });
  $('#ed-folder').addEventListener('click', () => api('ext-open-folder', ed.id));
  $('#ed-dup').addEventListener('click', async () => {
    try {
      const id = await api('ext-duplicate', ed.id);
      toast('Cópia editável criada (começa desativada)');
      location.hash = `edit/${id}`;
    } catch (err) {
      toast(cleanError(err));
    }
  });
  $('#ed-delfile').addEventListener('click', async () => {
    const name = ed.current;
    if (!name || !window.confirm(`Apagar o arquivo "${name}"?`)) return;
    try {
      await api('ext-delete-file', ed.id, name);
      await openEditor(ed.id);
      toast('Arquivo apagado');
    } catch (err) {
      toast(cleanError(err));
    }
  });
  $('#ed-newfile').addEventListener('click', () => {
    const form = $('#new-file-form');
    if (!form) return;
    form.hidden = false;
    $('#new-file-name').value = '';
    $('#new-file-name').focus();
  });
  $('#file-list').addEventListener('submit', async (e) => {
    if (e.target.id !== 'new-file-form') return;
    e.preventDefault();
    const name = $('#new-file-name').value.trim();
    if (!name) return;
    try {
      await api('ext-write', ed.id, name, '');
      await openEditor(ed.id, name);
    } catch (err) {
      toast(cleanError(err));
    }
  });
  $('#file-list').addEventListener('keydown', (e) => {
    if (e.target.id === 'new-file-name' && e.key === 'Escape') $('#new-file-form').hidden = true;
  });

  document.addEventListener('keydown', (e) => {
    if (!ed.id) {
      if (e.key === 'Escape' && !modal.hidden) closeNew();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save(e.shiftKey);
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (ed.id && dirtyFiles().length) e.preventDefault();
  });

  // ---------------------------------------------------------------- Navegação (#new, #api, #edit/id, #id)
  async function route() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (h.startsWith('edit/')) {
      modal.hidden = true;
      await openEditor(h.slice(5));
      return;
    }
    if (ed.id) closeEditor();
    const apiView = h === 'api';
    $('#sec-list').hidden = apiView;
    $('#sec-api').hidden = !apiView;
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (apiView ? 'api' : 'list')));
    if (h === 'new') openNew();
    else modal.hidden = true;
    if (h && !apiView && h !== 'new') {
      const el = $(`.ext[data-id="${CSS.escape(h)}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
      }
    }
  }
  window.addEventListener('hashchange', route);

  window.pulse.on('internal:ext-changed', async () => {
    await load();
    if (ed.id) {
      const x = items.find((it) => it.id === ed.id);
      if (x) {
        $('#ed-name').textContent = x.name;
        $('#ed-icon').src = x.icon;
      }
    }
  });

  await load();
  route();
})();
