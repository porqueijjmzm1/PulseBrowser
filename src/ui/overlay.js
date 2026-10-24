'use strict';
// Sobreposição transparente acima das páginas: pop-ups, sugestões, prompts, status e avisos.
(() => {
  const { icon, LOGO } = window.PulseIcons;
  const $ = (s) => document.querySelector(s);
  const popup = $('#popup');
  const backdrop = $('#backdrop');
  const statusEl = $('#status');
  const toastEl = $('#toast');
  const params = new URLSearchParams(location.search);
  if (params.get('incognito') === '1') document.body.classList.add('incognito');

  let current = null;
  const act = (a) => window.pulse.send('overlay:action', a);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function fmtBytes(n) {
    if (!n || n < 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toLocaleString('pt-BR', { maximumFractionDigits: n < 10 && i > 0 ? 1 : 0 })} ${u[i]}`;
  }

  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  const WIDTHS = {
    suggestions: null, menu: 300, downloads: 380, shield: 330, pageinfo: 350, bookmark: 340,
    permission: 380, auth: 380, screenshare: 660, zoom: 260,
  };
  const CENTERED = new Set(['auth', 'screenshare']);

  function position() {
    const type = current.type;
    const W = window.innerWidth;
    const a = current.anchor || { left: 8, right: W - 8, width: 300 };
    let width = WIDTHS[type] || 320;
    if (type === 'suggestions') width = Math.max(320, a.width);
    width = Math.min(width, W - 16);
    let left;
    if (CENTERED.has(type)) left = (W - width) / 2;
    else if (current.align === 'right') left = a.right - width;
    else left = a.left;
    left = Math.max(8, Math.min(left, W - width - 8));
    popup.style.width = `${width}px`;
    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = CENTERED.has(type) ? '40px' : type === 'suggestions' ? '4px' : '6px';
    popup.style.maxHeight = `${Math.max(120, window.innerHeight - (CENTERED.has(type) ? 60 : 20))}px`;
  }

  // ---------------------------------------------------------------- Renderizadores
  function favOrIcon(url, fallbackName) {
    if (!url) return icon(fallbackName, 15);
    return `<img src="${esc(url)}" alt="" data-fallback="${fallbackName}">`;
  }

  function fixImages(root) {
    root.querySelectorAll('img[data-fallback]').forEach((img) => {
      img.addEventListener('error', () => {
        const span = document.createElement('span');
        span.innerHTML = icon(img.dataset.fallback, 15);
        img.replaceWith(span.firstChild);
      }, { once: true });
    });
  }

  function renderSuggestions(d) {
    const ICONS = { search: 'search', history: 'clock', bookmark: 'star', url: 'globe', tab: 'layers' };
    popup.innerHTML = d.items.map((it, i) => {
      const ic = it.type === 'history' || it.type === 'bookmark' ? favOrIcon(it.favicon, ICONS[it.type]) : icon(ICONS[it.type] || 'globe', 15);
      let sub = '';
      if (it.type === 'search' && it.title) sub = `<span class="sg-sub">— ${esc(it.title)}</span>`;
      else if (it.type === 'history' || it.type === 'bookmark') sub = `<span class="sg-sub url">— ${esc(it.title)}</span>`;
      const chip = it.type === 'tab' ? '<span class="sg-chip">Mudar para esta aba</span>' : '';
      return `<div class="sg-row${i === d.selected ? ' sel' : ''}" data-i="${i}">
        <span class="sg-icon">${ic}</span><span class="sg-text">${esc(it.text)}</span>${sub}${chip}</div>`;
    }).join('');
    fixImages(popup);
    popup.querySelectorAll('.sg-row').forEach((row) => {
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const item = d.items[Number(row.dataset.i)];
        const disposition = e.button === 1 || e.ctrlKey ? 'background' : e.shiftKey ? 'new-window' : 'current';
        act({ act: 'suggestion', item, disposition });
      });
      row.addEventListener('mouseenter', () => {
        popup.querySelectorAll('.sg-row.sel').forEach((r) => r.classList.remove('sel'));
        row.classList.add('sel');
      });
    });
  }

  function menuItem(it) {
    if (it === 'sep') return '<div class="sep"></div>';
    if (it === 'zoom') {
      const z = current.data.zoom;
      return `<div class="zoom-row">
        <span class="lbl">${icon('search', 16)}Zoom</span>
        <button class="zbtn" data-zoom="-1" title="Diminuir (Ctrl+-)">${icon('minus', 16)}</button>
        <span class="zval">${z}%</span>
        <button class="zbtn" data-zoom="1" title="Aumentar (Ctrl++)">${icon('plus', 16)}</button>
        <button class="zbtn" data-cmd="fullscreen" title="Tela cheia (F11)">${icon('maximize', 16)}</button>
      </div>`;
    }
    const right = it.check != null
      ? (it.check ? `<span class="chk">${icon('check', 16)}</span>` : '')
      : it.key ? `<span class="key">${esc(it.key)}</span>` : '';
    return `<button class="mi" data-cmd="${it.cmd}" ${it.keepOpen ? 'data-keep="1"' : ''} ${it.disabled ? 'disabled' : ''}>
      ${icon(it.icon, 16)}<span class="lbl">${esc(it.label)}</span>${right}</button>`;
  }

  function renderMenu(d) {
    const items = [
      { icon: 'plus', label: 'Nova aba', key: 'Ctrl+T', cmd: 'new-tab' },
      { icon: 'window', label: 'Nova janela', key: 'Ctrl+N', cmd: 'new-window' },
      { icon: 'incognito', label: 'Nova janela anônima', key: 'Ctrl+Shift+N', cmd: 'new-incognito' },
      'sep',
      { icon: 'clock', label: 'Histórico', key: 'Ctrl+H', cmd: 'history' },
      { icon: 'download', label: 'Downloads', key: 'Ctrl+J', cmd: 'downloads' },
      { icon: 'bookmark', label: 'Favoritos', key: 'Ctrl+Shift+O', cmd: 'bookmarks' },
      { icon: 'refreshCcw', label: 'Reabrir aba fechada', key: 'Ctrl+Shift+T', cmd: 'reopen-closed', disabled: !d.hasClosed },
      'sep',
      'zoom',
      'sep',
      { icon: 'printer', label: 'Imprimir...', key: 'Ctrl+P', cmd: 'print' },
      { icon: 'fileText', label: 'Salvar como PDF...', cmd: 'save-pdf' },
      { icon: 'file', label: 'Salvar página como...', key: 'Ctrl+S', cmd: 'save-page' },
      { icon: 'camera', label: 'Capturar tela da página', key: 'Ctrl+Shift+S', cmd: 'screenshot' },
      { icon: 'search', label: 'Localizar na página...', key: 'Ctrl+F', cmd: 'find' },
      { icon: 'code', label: 'Ferramentas do desenvolvedor', key: 'F12', cmd: 'devtools' },
      'sep',
      { icon: 'bookmark', label: 'Mostrar barra de favoritos', cmd: 'toggle-bookmarks-bar', check: !!d.bookmarksBar, keepOpen: true },
      { icon: 'settings', label: 'Configurações', cmd: 'settings' },
      { icon: 'info', label: 'Sobre o PulseBrowser', cmd: 'about' },
      'sep',
      { icon: 'exit', label: 'Sair', cmd: 'quit' },
    ];
    popup.innerHTML = `<div class="menu">${items.map(menuItem).join('')}</div>`;
    popup.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => {
      act({ act: 'command', cmd: b.dataset.cmd, keepOpen: !!b.dataset.keep });
    }));
    popup.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => act({ act: 'zoom', dir: Number(b.dataset.zoom) })));
  }

  function dlStatus(r) {
    switch (r.state) {
      case 'progressing': {
        const total = r.total ? ` de ${fmtBytes(r.total)}` : '';
        const speed = r.speed ? ` • ${fmtBytes(r.speed)}/s` : '';
        return { text: `${fmtBytes(r.received)}${total}${speed}`, bar: true };
      }
      case 'paused': return { text: `Pausado • ${fmtBytes(r.received)}${r.total ? ` de ${fmtBytes(r.total)}` : ''}`, bar: true };
      case 'completed': return { text: `${fmtBytes(r.total || r.received)} • Concluído` };
      case 'cancelled': return { text: 'Cancelado', bad: true };
      default: return { text: 'Falhou', bad: true };
    }
  }

  function renderDownloads(d) {
    const rows = (d.recent || []).map((r) => {
      const st = dlStatus(r);
      const pct = r.total ? Math.round((r.received / r.total) * 100) : 0;
      let actions = '';
      if (r.state === 'progressing') actions = `<button class="icon-btn" data-a="pause" title="Pausar">${icon('pause', 15)}</button><button class="icon-btn" data-a="cancel" title="Cancelar">${icon('x', 15)}</button>`;
      else if (r.state === 'paused') actions = `<button class="icon-btn" data-a="resume" title="Continuar">${icon('play', 15)}</button><button class="icon-btn" data-a="cancel" title="Cancelar">${icon('x', 15)}</button>`;
      else if (r.state === 'completed') actions = `<button class="icon-btn" data-a="show" title="Mostrar na pasta">${icon('folderOpen', 15)}</button>`;
      else actions = `<button class="icon-btn" data-a="retry" title="Tentar novamente">${icon('reload', 15)}</button>`;
      return `<div class="dl-row ${r.state === 'completed' ? 'clickable' : ''}" data-id="${esc(r.id)}">
        <div class="dl-ficon">${icon(r.state === 'completed' ? 'file' : 'download', 16)}</div>
        <div class="dl-main">
          <div class="dl-name ${r.state === 'cancelled' ? 'strike' : ''}" title="${esc(r.filename)}">${esc(r.filename)}</div>
          <div class="dl-sub ${st.bad ? 'bad' : ''}">${esc(st.text)}</div>
          ${st.bar ? `<div class="dl-bar ${r.total ? '' : 'indet'}"><i style="width:${pct}%"></i></div>` : ''}
        </div>${actions}</div>`;
    }).join('');
    popup.innerHTML = `<div class="dl-head"><h3>Downloads recentes</h3></div>
      <div class="dl-list">${rows || '<div class="empty">Nenhum download ainda</div>'}</div>
      <div class="dl-foot"><button class="mi" data-cmd="downloads">${icon('download', 16)}<span class="lbl">Ver todos os downloads</span><span class="key">Ctrl+J</span></button></div>`;
    popup.querySelectorAll('.dl-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-a]');
        if (btn) act({ act: 'download', id: row.dataset.id, action: btn.dataset.a });
        else if (row.classList.contains('clickable')) {
          act({ act: 'download', id: row.dataset.id, action: 'open' });
          act({ act: 'close' });
        }
      });
    });
    popup.querySelector('[data-cmd]').addEventListener('click', () => act({ act: 'command', cmd: 'downloads' }));
  }

  function renderShield(d) {
    if (!d.enabled) {
      popup.innerHTML = `<div class="pad">
        <div class="sh-head"><div class="sh-logo off">${icon('shieldOff', 22)}</div>
        <div class="sh-title"><b>Pulse Shield</b><div class="muted">A proteção está desativada</div></div></div>
        <p class="muted" style="margin-top:12px">Ative o Shield para bloquear anúncios, rastreadores e mineradores de criptomoeda.</p>
        <div class="row-end"><button class="btn primary" id="sh-on">Ativar proteção</button></div></div>`;
      $('#sh-on').addEventListener('click', () => act({ act: 'shield-global', enabled: true }));
      return;
    }
    if (!d.host) {
      popup.innerHTML = `<div class="pad"><div class="sh-head"><div class="sh-logo">${icon('shieldCheck', 22)}</div>
        <div class="sh-title"><b>Pulse Shield</b><div class="muted">Ativo</div></div></div>
        <p class="muted" style="margin-top:12px">O Shield não atua em páginas internas do navegador.</p>
        <div class="sh-foot"><span>${d.total.toLocaleString('pt-BR')} bloqueados no total</span><a class="link" id="sh-settings">Configurações</a></div></div>`;
      $('#sh-settings').addEventListener('click', () => act({ act: 'command', cmd: 'settings', arg: 'shield' }));
      return;
    }
    const on = !d.allowed;
    popup.innerHTML = `<div class="pad">
      <div class="sh-head"><div class="sh-logo ${on ? '' : 'off'}">${icon(on ? 'shieldCheck' : 'shieldOff', 22)}</div>
        <div class="sh-title"><b>Pulse Shield</b><div class="muted" title="${esc(d.host)}">${esc(d.host)}</div></div>
        <label class="switch" title="${on ? 'Desativar para este site' : 'Ativar para este site'}"><input type="checkbox" id="sh-toggle" ${on ? 'checked' : ''}></label></div>
      ${on ? `<div class="sh-count"><span class="big">${d.blocked}</span><span>anúncios e rastreadores bloqueados nesta página</span></div>
      ${d.hosts.length ? `<details><summary>Ver domínios bloqueados (${d.hosts.length})</summary><ul class="sh-list">${d.hosts.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></details>` : ''}`
    : '<p class="muted" style="margin-top:12px">A proteção está desligada para este site. Ligue-a para bloquear anúncios e rastreadores.</p>'}
      <div class="sh-foot"><span>${d.total.toLocaleString('pt-BR')} bloqueados no total</span><a class="link" id="sh-settings">Configurações</a></div>
    </div>`;
    $('#sh-toggle').addEventListener('change', (e) => act({ act: 'shield-toggle', host: d.host, enabled: e.target.checked }));
    $('#sh-settings').addEventListener('click', () => act({ act: 'command', cmd: 'settings', arg: 'shield' }));
  }

  const PERM_ICONS = {
    camera: 'video', microphone: 'mic', 'camera+microphone': 'video', geolocation: 'mapPin', notifications: 'bell',
    'clipboard-read': 'copy', openExternal: 'externalLink', midiSysex: 'zap', 'window-management': 'monitor',
  };

  function renderPageInfo(d) {
    const SEC = {
      secure: ['lock', 'A conexão é segura', 'Suas informações (como senhas e números de cartão) ficam protegidas quando são enviadas para este site.'],
      insecure: ['alert', 'A conexão com este site não é segura', 'Evite digitar informações sensíveis neste site (como senhas ou cartões), pois elas podem ser interceptadas.'],
      dangerous: ['alert', 'Certificado não confiável', 'O certificado de segurança deste site tem problemas. Alguém pode estar tentando interceptar seus dados.'],
      internal: ['pulse', 'Página segura do PulseBrowser', 'Esta é uma página interna do navegador.'],
      file: ['fileText', 'Arquivo local', 'Este arquivo está salvo no seu computador.'],
      extension: ['puzzle', 'Página de extensão', 'Esta página pertence a uma extensão instalada.'],
      error: ['info', 'Não foi possível carregar a página', 'Verifique o endereço e sua conexão.'],
      neutral: ['info', 'Informações do site', ''],
    };
    const [ic, title, desc] = SEC[d.security] || SEC.neutral;
    const icHtml = d.security === 'internal' ? LOGO : icon(ic, 18);
    const perms = d.permissions.map((p) => `<div class="perm-row">${icon(PERM_ICONS[p.key] || 'settings', 16)}<span>${esc(p.label)}</span>
      <select data-key="${esc(p.key)}"><option value="ask">Perguntar</option><option value="allow" ${p.value === 'allow' ? 'selected' : ''}>Permitir</option><option value="deny" ${p.value === 'deny' ? 'selected' : ''}>Bloquear</option></select></div>`).join('');
    const web = /^https?:/i.test(d.url);
    popup.innerHTML = `<div class="pad">
      <div class="pi-host">${esc(d.host || d.url)}</div>
      <div class="pi-head ${d.security}"><div class="ic">${icHtml}</div><div><b>${esc(title)}</b><div class="muted small">${esc(desc)}</div></div></div>
      ${d.certException ? '<p class="small" style="margin-top:10px;color:var(--danger)">Você optou por ignorar o aviso de certificado deste site.</p>' : ''}
      ${web ? `<div class="pi-section">Permissões</div>${perms || '<div class="muted small">Este site não pediu nenhuma permissão.</div>'}` : ''}
      ${web ? `<div class="actions-col">
        <button class="mi" id="pi-clear">${icon('trash', 16)}<span class="lbl">Limpar cookies e dados do site</span></button>
        <button class="mi" id="pi-settings">${icon('settings', 16)}<span class="lbl">Configurações de sites</span></button>
      </div>` : ''}
    </div>`;
    popup.querySelectorAll('select[data-key]').forEach((s) => s.addEventListener('change', () => {
      act({ act: 'site-permission', origin: d.origin, key: s.dataset.key, value: s.value });
    }));
    $('#pi-clear')?.addEventListener('click', () => act({ act: 'clear-site-data', origin: d.origin }));
    $('#pi-settings')?.addEventListener('click', () => act({ act: 'command', cmd: 'settings', arg: 'permissions' }));
  }

  function renderBookmark(d) {
    const heading = d.created ? 'Favorito adicionado' : d.isFolder ? 'Renomear pasta' : 'Editar favorito';
    const folders = d.folders.map((f) => `<option value="${esc(f.id)}" ${f.id === d.parentId ? 'selected' : ''}>${'  '.repeat(f.depth)}${esc(f.title)}</option>`).join('');
    popup.innerHTML = `<div class="pad">
      <h3>${heading}</h3>
      <label class="field"><span>Nome</span><input id="bm-name" value="${esc(d.title)}"></label>
      ${!d.isFolder && !d.created ? `<label class="field"><span>Endereço</span><input id="bm-url" value="${esc(d.url)}"></label>` : ''}
      ${!d.isFolder ? `<label class="field"><span>Pasta</span><select id="bm-folder">${folders}</select></label>` : ''}
      <div class="row-end">
        <button class="btn" id="bm-remove">Remover</button>
        <button class="btn primary" id="bm-done">Concluído</button>
      </div></div>`;
    const name = $('#bm-name');
    setTimeout(() => {
      name.focus();
      name.select();
    }, 20);
    const save = () => act({
      act: 'bookmark-save',
      id: d.id,
      title: name.value.trim() || d.title,
      url: $('#bm-url') ? $('#bm-url').value.trim() || d.url : undefined,
      parentId: $('#bm-folder') ? $('#bm-folder').value : undefined,
    });
    $('#bm-done').addEventListener('click', save);
    $('#bm-remove').addEventListener('click', () => act({ act: 'bookmark-remove', id: d.id }));
    popup.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    }));
  }

  function renderPermission(d) {
    const isExternal = d.key === 'openExternal';
    popup.innerHTML = `<div class="pad">
      <div><span class="pm-origin">${esc(hostOf(d.origin) || d.origin)}</span> quer</div>
      <div class="pm-item">${icon(PERM_ICONS[d.key] || 'info', 18)}<span>${esc(d.label)}</span></div>
      ${isExternal && d.externalURL ? `<div class="muted small" style="word-break:break-all">${esc(d.externalURL.slice(0, 200))}</div>` : ''}
      <div class="row-end">
        <button class="btn" id="pm-block">Bloquear</button>
        ${isExternal ? '' : '<button class="btn" id="pm-once">Permitir desta vez</button>'}
        <button class="btn primary" id="pm-allow">${isExternal ? 'Abrir' : 'Permitir'}</button>
      </div></div>`;
    $('#pm-block').addEventListener('click', () => act({ act: 'perm-response', allow: false, remember: true }));
    $('#pm-once')?.addEventListener('click', () => act({ act: 'perm-response', allow: true, remember: false }));
    $('#pm-allow').addEventListener('click', () => act({ act: 'perm-response', allow: true, remember: !isExternal }));
    setTimeout(() => $('#pm-allow').focus(), 20);
  }

  function renderAuth(d) {
    popup.innerHTML = `<div class="pad">
      <h3>Fazer login</h3>
      <p class="muted">${esc(d.host)} ${d.isProxy ? '(proxy) ' : ''}requer nome de usuário e senha.${d.realm ? `<br>Mensagem do site: “${esc(d.realm)}”` : ''}</p>
      <input class="input" id="au-user" placeholder="Nome de usuário" autocomplete="off">
      <input class="input" id="au-pass" type="password" placeholder="Senha" style="margin-top:8px">
      <div class="row-end"><button class="btn" id="au-cancel">Cancelar</button><button class="btn primary" id="au-ok">Fazer login</button></div>
    </div>`;
    const submit = () => act({ act: 'auth-response', username: $('#au-user').value, password: $('#au-pass').value });
    $('#au-ok').addEventListener('click', submit);
    $('#au-cancel').addEventListener('click', () => act({ act: 'close' }));
    popup.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    }));
    setTimeout(() => $('#au-user').focus(), 20);
  }

  function renderScreenShare(d) {
    let sel = null;
    const screens = d.sources.filter((s) => s.id.startsWith('screen'));
    const wins = d.sources.filter((s) => !s.id.startsWith('screen'));
    const tile = (s) => `<button class="ss-src" data-id="${esc(s.id)}"><img src="${esc(s.thumb)}" alt=""><span title="${esc(s.name)}">${esc(s.name)}</span></button>`;
    popup.innerHTML = `<div class="pad">
      <h3>Compartilhar sua tela</h3>
      <p class="muted">${esc(hostOf(d.origin) || d.origin)} quer compartilhar o conteúdo da sua tela. Escolha o que compartilhar:</p>
      ${screens.length ? `<div class="pi-section">Telas</div><div class="ss-grid">${screens.map(tile).join('')}</div>` : ''}
      ${wins.length ? `<div class="pi-section">Janelas</div><div class="ss-grid">${wins.map(tile).join('')}</div>` : ''}
      ${d.audio ? '<label class="check"><input type="checkbox" id="ss-audio" checked> Compartilhar também o áudio do sistema</label>' : ''}
      <div class="row-end"><button class="btn" id="ss-cancel">Cancelar</button><button class="btn primary" id="ss-ok" disabled>Compartilhar</button></div>
    </div>`;
    popup.querySelectorAll('.ss-src').forEach((b) => b.addEventListener('click', () => {
      popup.querySelectorAll('.ss-src.sel').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      sel = b.dataset.id;
      $('#ss-ok').disabled = false;
    }));
    $('#ss-cancel').addEventListener('click', () => act({ act: 'close' }));
    $('#ss-ok').addEventListener('click', () => act({ act: 'screenshare-response', sourceId: sel, audio: !!$('#ss-audio')?.checked }));
  }

  function renderZoom(d) {
    popup.innerHTML = `<div class="pad"><div class="row">
      <b style="flex:1">Zoom: ${d.zoom}%</b>
      <button class="zbtn" data-zoom="-1" title="Diminuir">${icon('minus', 16)}</button>
      <button class="zbtn" data-zoom="1" title="Aumentar">${icon('plus', 16)}</button>
      <button class="btn" data-zoom="0">Redefinir</button></div></div>`;
    popup.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => act({ act: 'zoom', dir: Number(b.dataset.zoom) })));
  }

  const RENDER = {
    suggestions: renderSuggestions,
    menu: renderMenu,
    downloads: renderDownloads,
    shield: renderShield,
    pageinfo: renderPageInfo,
    bookmark: renderBookmark,
    permission: renderPermission,
    auth: renderAuth,
    screenshare: renderScreenShare,
    zoom: renderZoom,
  };

  function render(isUpdate = false) {
    if (!current) return;
    const fn = RENDER[current.type];
    if (!fn) return;
    if (current.accent) document.documentElement.style.setProperty('--accent', current.accent);
    // Atualizações de formulários não devem apagar o que o usuário está digitando.
    if (isUpdate && ['bookmark', 'auth', 'permission', 'screenshare'].includes(current.type)) return;
    const scroll = popup.scrollTop;
    popup.className = `popup-${current.type}`;
    fn(current.data || {});
    popup.hidden = false;
    backdrop.hidden = false;
    backdrop.classList.toggle('dim', CENTERED.has(current.type));
    position();
    if (isUpdate) popup.scrollTop = scroll;
    else popup.style.animation = current.type === 'suggestions' ? 'none' : '';
    if (!isUpdate && current.type === 'menu') setTimeout(() => popup.querySelector('.mi')?.focus({ preventScroll: true }), 10);
  }

  backdrop.addEventListener('mousedown', () => act({ act: 'close' }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') act({ act: 'close' });
    if (current?.type === 'menu' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const items = [...popup.querySelectorAll('.mi:not(:disabled)')];
      const i = items.indexOf(document.activeElement);
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      next?.focus();
    }
  });

  window.pulse.on('overlay:show', (p) => {
    current = p;
    statusEl.hidden = true;
    toastEl.hidden = true;
    render(false);
  });
  window.pulse.on('overlay:update', (p) => {
    if (!current || p.type !== current.type) return;
    if (p.data) current.data = p.data;
    if (p.anchor) current.anchor = p.anchor;
    render(true);
  });
  window.pulse.on('overlay:hide', () => {
    current = null;
    popup.hidden = true;
    backdrop.hidden = true;
    popup.innerHTML = '';
  });
  window.pulse.on('overlay:status', (text) => {
    if (current) return;
    statusEl.querySelector('span').textContent = text || '';
    statusEl.hidden = !text;
  });
  window.pulse.on('overlay:toast', (text) => {
    if (!text) {
      toastEl.hidden = true;
      return;
    }
    if (current) return;
    statusEl.hidden = true;
    toastEl.querySelector('.t-icon').innerHTML = icon('check', 16);
    toastEl.querySelector('.t-text').textContent = text;
    toastEl.hidden = false;
  });
})();
