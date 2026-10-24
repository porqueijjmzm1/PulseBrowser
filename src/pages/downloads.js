'use strict';
(async () => {
  const { $, esc, fmtBytes, fmtDay, fmtTime, icon, debounce } = window.Pulse;
  await window.Pulse.init();

  const action = (id, act) => window.pulse.invoke('internal:download-action', id, act);

  function status(r) {
    switch (r.state) {
      case 'progressing': {
        const pct = r.total ? ` (${Math.round((r.received / r.total) * 100)}%)` : '';
        const eta = r.speed && r.total ? ` • ${Math.max(1, Math.round((r.total - r.received) / r.speed))} s restantes` : '';
        return { text: `${fmtBytes(r.received)}${r.total ? ` de ${fmtBytes(r.total)}` : ''}${pct} • ${fmtBytes(r.speed)}/s${eta}`, bar: true };
      }
      case 'paused': return { text: `Pausado • ${fmtBytes(r.received)}${r.total ? ` de ${fmtBytes(r.total)}` : ''}`, bar: true };
      case 'completed': return { text: r.exists === false ? 'Arquivo removido do disco' : `${fmtBytes(r.total || r.received)} • ${fmtDay(r.end || r.start)} às ${fmtTime(r.end || r.start)}`, bad: r.exists === false };
      case 'cancelled': return { text: 'Cancelado', bad: true };
      default: return { text: 'Falhou — o download foi interrompido', bad: true };
    }
  }

  function render(list) {
    const q = $('#q').value.trim().toLowerCase();
    const items = q ? list.filter((r) => r.filename.toLowerCase().includes(q) || r.url.toLowerCase().includes(q)) : list;
    const box = $('#list');
    box.innerHTML = items.map((r) => {
      const st = status(r);
      const pct = r.total ? Math.round((r.received / r.total) * 100) : 0;
      const canOpen = r.state === 'completed' && r.exists !== false;
      let btns = '';
      if (r.state === 'progressing') btns = `<button class="btn" data-a="pause">${icon('pause', 14)}Pausar</button><button class="btn danger" data-a="cancel">${icon('x', 14)}Cancelar</button>`;
      else if (r.state === 'paused') btns = `<button class="btn" data-a="resume">${icon('play', 14)}Continuar</button><button class="btn danger" data-a="cancel">${icon('x', 14)}Cancelar</button>`;
      else if (canOpen) btns = `<button class="btn" data-a="open">${icon('externalLink', 14)}Abrir</button><button class="btn" data-a="show">${icon('folderOpen', 14)}Mostrar na pasta</button><button class="btn danger" data-a="delete-file">${icon('trash', 14)}Mover para a lixeira</button>`;
      else btns = `<button class="btn" data-a="retry">${icon('reload', 14)}Tentar novamente</button>`;
      return `<div class="dl" data-id="${esc(r.id)}">
        <div class="dl-icon">${icon(r.state === 'completed' ? 'file' : 'download', 20)}</div>
        <div class="dl-main">
          <span class="dl-name ${canOpen ? 'link' : ''} ${r.state === 'cancelled' ? 'strike' : ''}" ${canOpen ? 'data-a="open"' : ''} title="${esc(r.path || r.filename)}">${esc(r.filename)}</span>
          <div class="dl-url" title="${esc(r.url)}">${esc(r.url)}</div>
          <div class="dl-status ${st.bad ? 'bad' : ''}">${esc(st.text)}</div>
          ${st.bar ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
          <div class="dl-btns">${btns}</div>
        </div>
        <button class="icon-btn" data-a="remove" title="Remover da lista">${icon('x', 16)}</button>
      </div>`;
    }).join('');
    box.hidden = items.length === 0;
    $('#empty').hidden = items.length > 0;
    $('#empty-text').textContent = q ? 'Nenhum download encontrado' : 'Os arquivos que você baixar aparecerão aqui';
  }

  $('#list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-a]');
    const row = e.target.closest('.dl');
    if (btn && row) action(row.dataset.id, btn.dataset.a);
  });

  async function refresh() {
    render(await window.pulse.invoke('internal:downloads-list'));
  }

  $('#q').addEventListener('input', debounce(refresh, 150));
  $('#open-folder').addEventListener('click', () => window.pulse.invoke('internal:open-downloads-folder'));
  $('#clear-all').addEventListener('click', () => window.pulse.invoke('internal:downloads-clear'));
  window.pulse.on('internal:downloads-changed', debounce(refresh, 100));
  await refresh();
})();
