'use strict';
(async () => {
  const { $, fmtTime, fmtDay, dayKey, hostOf, favicon, icon, debounce, toast } = window.Pulse;
  const { ctx } = await window.Pulse.init();
  const PAGE = 150;
  let offset = 0;
  let query = '';
  let groups = new Map(); // dayKey -> container
  const selected = new Set();

  if (ctx.incognito) {
    $('#empty-text').textContent = 'O histórico não é salvo em janelas anônimas. Abaixo estão as páginas das janelas normais.';
  }

  function updateSelbar() {
    $('#selbar').hidden = selected.size === 0;
    $('#selcount').textContent = `${selected.size} selecionado(s)`;
  }

  function row(v) {
    const el = document.createElement('div');
    el.className = 'item';
    el.dataset.id = String(v.id);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.title = 'Selecionar';
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(v.id);
      else selected.delete(v.id);
      el.classList.toggle('selected', cb.checked);
      updateSelbar();
    });
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = fmtTime(v.time);
    const a = document.createElement('a');
    a.className = 'title';
    a.href = v.url;
    a.textContent = v.title || v.url;
    a.title = v.url;
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = hostOf(v.url);
    const spacer = document.createElement('div');
    spacer.className = 'grow';
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    const more = document.createElement('button');
    more.className = 'icon-btn';
    more.title = 'Pesquisar mais deste site';
    more.innerHTML = icon('search', 16);
    more.addEventListener('click', () => {
      $('#q').value = hostOf(v.url);
      reload();
    });
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.title = 'Remover do histórico';
    del.innerHTML = icon('x', 16);
    del.addEventListener('click', async () => {
      await window.pulse.invoke('internal:history-remove', [v.id]);
      el.remove();
      toast('Removido do histórico');
    });
    actions.append(more, del);
    el.append(cb, time, favicon(v.url, v.favicon, 20), a, host, spacer, actions);
    return el;
  }

  function append(list) {
    const container = $('#list');
    for (const v of list) {
      const key = dayKey(v.time);
      let g = groups.get(key);
      if (!g) {
        const day = document.createElement('section');
        day.className = 'day';
        day.innerHTML = '<div class="day-title"></div><div class="card"></div>';
        day.querySelector('.day-title').textContent = fmtDay(v.time);
        container.appendChild(day);
        g = day.querySelector('.card');
        groups.set(key, g);
      }
      g.appendChild(row(v));
    }
  }

  async function load() {
    const list = await window.pulse.invoke('internal:history-query', { text: query, offset, limit: PAGE });
    append(list);
    offset += list.length;
    $('#more').hidden = list.length < PAGE;
    $('#empty').hidden = offset > 0;
    if (!offset && query) $('#empty-text').textContent = `Nenhum resultado para "${query}"`;
  }

  async function reload() {
    query = $('#q').value.trim();
    offset = 0;
    groups = new Map();
    selected.clear();
    updateSelbar();
    $('#list').textContent = '';
    await load();
  }

  $('#q').addEventListener('input', debounce(reload, 200));
  $('#load-more').addEventListener('click', load);
  window.addEventListener('scroll', debounce(() => {
    if (!$('#more').hidden && window.innerHeight + window.scrollY > document.body.scrollHeight - 300) load();
  }, 100));
  $('#sel-cancel').addEventListener('click', () => {
    document.querySelectorAll('.item.selected input').forEach((cb) => {
      cb.checked = false;
    });
    document.querySelectorAll('.item.selected').forEach((el) => el.classList.remove('selected'));
    selected.clear();
    updateSelbar();
  });
  $('#sel-delete').addEventListener('click', async () => {
    const ids = [...selected];
    await window.pulse.invoke('internal:history-remove', ids);
    toast(`${ids.length} item(ns) removido(s)`);
    reload();
  });

  await load();
})();
