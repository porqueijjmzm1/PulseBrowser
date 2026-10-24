'use strict';
(async () => {
  const { $, hostOf, favicon, icon, debounce, toast } = window.Pulse;
  await window.Pulse.init();
  let tree = { roots: [], folders: [] };
  let currentId = 'bar';
  let dragId = null;

  function find(id, nodes = tree.roots) {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const r = find(id, n.children);
        if (r) return r;
      }
    }
    return null;
  }

  function parentOf(id, nodes = tree.roots, parent = null) {
    for (const n of nodes) {
      if (n.id === id) return parent;
      if (n.children) {
        const r = parentOf(id, n.children, n);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  }

  function allUrls(nodes = tree.roots, out = []) {
    for (const n of nodes) {
      if (n.type === 'url') out.push(n);
      if (n.children) allUrls(n.children, out);
    }
    return out;
  }

  async function refresh() {
    tree = await window.pulse.invoke('internal:bookmarks-tree');
    if (!find(currentId)) currentId = 'bar';
    renderFolders();
    renderList();
  }

  // ---------------------------------------------------------------- Árvore de pastas
  function renderFolders() {
    const nav = $('#folders');
    nav.textContent = '';
    for (const f of tree.folders) {
      const b = document.createElement('button');
      b.className = `folder-link${f.id === currentId ? ' active' : ''}`;
      b.style.paddingLeft = `${14 + f.depth * 18}px`;
      b.innerHTML = icon(f.id === currentId ? 'folderOpen' : 'folder', 18);
      const s = document.createElement('span');
      s.className = 'ellipsis';
      s.textContent = f.title;
      b.appendChild(s);
      b.addEventListener('click', () => {
        currentId = f.id;
        $('#q').value = '';
        renderFolders();
        renderList();
      });
      b.addEventListener('dragover', (e) => {
        if (!dragId || dragId === f.id) return;
        e.preventDefault();
        b.classList.add('drop-into');
      });
      b.addEventListener('dragleave', () => b.classList.remove('drop-into'));
      b.addEventListener('drop', async (e) => {
        e.preventDefault();
        b.classList.remove('drop-into');
        if (dragId) await window.pulse.invoke('internal:bookmarks-move', dragId, f.id);
        dragId = null;
      });
      nav.appendChild(b);
    }
  }

  // ---------------------------------------------------------------- Lista
  function itemRow(n, { showPath = false } = {}) {
    const el = document.createElement('div');
    el.className = 'item';
    el.dataset.id = n.id;
    el.draggable = !showPath;
    const ic = n.type === 'folder'
      ? Object.assign(document.createElement('span'), { className: 'fav', innerHTML: icon('folder', 18) })
      : favicon(n.url, n.favicon, 20);
    if (n.type === 'folder') ic.style.color = 'var(--accent)';
    const title = document.createElement(n.type === 'folder' ? 'span' : 'a');
    title.className = 'title';
    title.textContent = n.title || n.url;
    if (n.type === 'url') {
      title.href = n.url;
      title.title = n.url;
    } else {
      title.style.cursor = 'default';
      title.textContent = `${n.title} (${n.children.length})`;
    }
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = n.type === 'url' ? hostOf(n.url) : '';
    const spacer = document.createElement('div');
    spacer.className = 'grow';
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    const edit = document.createElement('button');
    edit.className = 'icon-btn';
    edit.title = n.type === 'folder' ? 'Renomear' : 'Editar';
    edit.innerHTML = icon('edit', 16);
    edit.addEventListener('click', () => openDialog(n));
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.title = 'Excluir';
    del.innerHTML = icon('trash', 16);
    del.addEventListener('click', async () => {
      await window.pulse.invoke('internal:bookmarks-remove', n.id);
      toast(n.type === 'folder' ? 'Pasta excluída' : 'Favorito excluído');
    });
    actions.append(edit, del);
    el.append(ic, title, host, spacer, actions);

    if (n.type === 'folder') {
      el.addEventListener('dblclick', () => {
        currentId = n.id;
        renderFolders();
        renderList();
      });
      title.addEventListener('click', () => {
        currentId = n.id;
        renderFolders();
        renderList();
      });
    }

    el.addEventListener('dragstart', (e) => {
      dragId = n.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', n.url || n.title);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragId = null;
    });
    el.addEventListener('dragover', (e) => {
      if (!dragId || dragId === n.id) return;
      e.preventDefault();
      el.classList.add('drop-before');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drop-before');
      if (!dragId) return;
      const parent = find(currentId);
      const index = parent.children.findIndex((c) => c.id === n.id);
      await window.pulse.invoke('internal:bookmarks-move', dragId, currentId, index);
      dragId = null;
    });
    return el;
  }

  function renderList() {
    const list = $('#list');
    list.textContent = '';
    const q = $('#q').value.trim().toLowerCase();
    let items;
    if (q) {
      $('#crumb').textContent = `Resultados para "${$('#q').value.trim()}"`;
      items = allUrls().filter((n) => n.url.toLowerCase().includes(q) || (n.title || '').toLowerCase().includes(q));
    } else {
      const folder = find(currentId);
      $('#crumb').textContent = folder ? folder.title : '';
      items = folder ? folder.children : [];
    }
    for (const n of items) list.appendChild(itemRow(n, { showPath: !!q }));
    list.hidden = items.length === 0;
    $('#empty').hidden = items.length > 0;
    $('#empty-text').textContent = q ? 'Nenhum favorito encontrado' : 'Esta pasta está vazia. Arraste itens para cá ou use "Adicionar favorito".';
  }

  // ---------------------------------------------------------------- Diálogo de edição
  let dlgTarget = null;
  function openDialog(node, { isNew = false, type = 'url' } = {}) {
    dlgTarget = { node, isNew, type: node ? node.type : type };
    const isFolder = dlgTarget.type === 'folder';
    $('#dlg-title').textContent = isNew ? (isFolder ? 'Nova pasta' : 'Adicionar favorito') : isFolder ? 'Renomear pasta' : 'Editar favorito';
    $('#dlg-name').value = node ? node.title : isFolder ? 'Nova pasta' : '';
    $('#dlg-url').value = node && node.url ? node.url : '';
    $('#dlg-url-wrap').hidden = isFolder;
    $('#dlg-url').required = !isFolder;
    const sel = $('#dlg-folder');
    sel.textContent = '';
    const parent = node ? parentOf(node.id) : find(currentId);
    for (const f of tree.folders) {
      if (node && isFolder && (f.id === node.id)) continue;
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = `${'   '.repeat(f.depth)}${f.title}`;
      if (parent && parent.id === f.id) o.selected = true;
      sel.appendChild(o);
    }
    $('#dlg').showModal();
    $('#dlg-name').select();
  }

  $('#dlg').addEventListener('close', async () => {
    if ($('#dlg').returnValue !== 'ok' || !dlgTarget) return;
    const title = $('#dlg-name').value.trim();
    let url = $('#dlg-url').value.trim();
    if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    const parentId = $('#dlg-folder').value;
    const { node, isNew, type } = dlgTarget;
    if (isNew) {
      await window.pulse.invoke('internal:bookmarks-add', { parentId, title, url, type });
    } else {
      await window.pulse.invoke('internal:bookmarks-update', node.id, type === 'folder' ? { title } : { title, url });
      const parent = parentOf(node.id);
      if (parent && parent.id !== parentId) await window.pulse.invoke('internal:bookmarks-move', node.id, parentId);
    }
    dlgTarget = null;
  });

  $('#add-bm').addEventListener('click', () => openDialog(null, { isNew: true, type: 'url' }));
  $('#add-folder').addEventListener('click', () => openDialog(null, { isNew: true, type: 'folder' }));

  // ---------------------------------------------------------------- Importar / exportar
  function parseNetscape(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const walk = (dl) => {
      const out = [];
      for (const dt of dl.children) {
        if (dt.tagName !== 'DT') continue;
        const h3 = dt.querySelector(':scope > h3');
        const a = dt.querySelector(':scope > a');
        if (h3) {
          let sub = dt.querySelector(':scope > dl');
          if (!sub && dt.nextElementSibling && dt.nextElementSibling.tagName === 'DL') sub = dt.nextElementSibling;
          out.push({ type: 'folder', title: h3.textContent.trim(), children: sub ? walk(sub) : [] });
        } else if (a) {
          out.push({ type: 'url', title: a.textContent.trim(), url: a.getAttribute('href') });
        }
      }
      return out;
    };
    const root = doc.querySelector('dl');
    return root ? walk(root) : [];
  }

  $('#import-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#import-menu').hidden = !$('#import-menu').hidden;
  });
  document.addEventListener('click', () => {
    $('#import-menu').hidden = true;
  });
  $('#import-chrome').addEventListener('click', async () => {
    try {
      const n = await window.pulse.invoke('internal:bookmarks-import-chrome');
      toast(`${n} favoritos importados do Chrome (em "Outros favoritos")`);
    } catch (err) {
      toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  });
  $('#import-html').addEventListener('click', async () => {
    const html = await window.pulse.invoke('internal:bookmarks-pick-file');
    if (!html) return;
    const nodes = parseNetscape(html);
    const n = await window.pulse.invoke('internal:bookmarks-import-nodes', nodes, 'Importados');
    toast(`${n} favoritos importados (em "Outros favoritos")`);
  });
  $('#export-btn').addEventListener('click', async () => {
    if (await window.pulse.invoke('internal:bookmarks-export')) toast('Favoritos exportados');
  });

  $('#q').addEventListener('input', debounce(renderList, 150));
  window.pulse.on('internal:bookmarks-changed', refresh);
  await refresh();
})();
