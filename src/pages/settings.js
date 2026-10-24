'use strict';
(async () => {
  const { $, $$, esc, icon, toast, debounce } = window.Pulse;
  const { ctx } = await window.Pulse.init();
  let s = await window.pulse.invoke('internal:get-settings');

  const cleanError = (err) => String(err && err.message ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const set = (k, v) => window.pulse.invoke('internal:set-setting', k, v).catch((err) => toast(`Não foi possível salvar: ${cleanError(err)}`));

  // ---------------------------------------------------------------- Montagem inicial
  $('#engines').innerHTML = s.engines.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
  const ACCENT_NAMES = { violet: 'Violeta', pink: 'Rosa', blue: 'Azul', teal: 'Turquesa', green: 'Verde', orange: 'Laranja', red: 'Vermelho' };
  $('#accents').innerHTML = Object.entries(s.accents)
    .map(([id, c]) => `<button class="swatch" data-accent="${esc(id)}" title="${esc(ACCENT_NAMES[id] || id)}" style="background:${esc(c)}"></button>`).join('');
  $$('#accents .swatch').forEach((b) => b.addEventListener('click', () => set('accent', b.dataset.accent)));

  $$('[data-setting]').forEach((el) => {
    el.addEventListener('change', () => {
      const v = el.type === 'checkbox' ? el.checked : el.value;
      set(el.dataset.setting, v);
      if (el.dataset.restart !== undefined) {
        const note = el.closest('.setting').querySelector('.restart-note');
        if (note) note.hidden = false;
        $('#restart-row').hidden = false;
      }
    });
  });
  $$('[data-seg]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => set(seg.dataset.seg, b.dataset.v));
  }));
  $$('input[name=startup]').forEach((r) => r.addEventListener('change', () => set('startup', r.value)));
  $('#startup-urls').addEventListener('change', (e) => {
    const urls = e.target.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 20);
    set('startupUrls', urls);
  });
  $('#homepage').addEventListener('change', (e) => set('homepage', e.target.value.trim() || 'pulse://newtab'));
  $('#ms-minutes').addEventListener('change', (e) => set('memorySaverMinutes', Number(e.target.value)));

  function fill() {
    $$('[data-setting]').forEach((el) => {
      const v = s[el.dataset.setting];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (v != null) el.value = v;
    });
    $$('[data-seg]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === s[seg.dataset.seg])));
    $$('#accents .swatch').forEach((b) => b.classList.toggle('on', b.dataset.accent === s.accent));
    $$('input[name=startup]').forEach((r) => {
      r.checked = r.value === s.startup;
    });
    $('#startup-urls').hidden = s.startup !== 'urls';
    if (document.activeElement !== $('#startup-urls')) $('#startup-urls').value = (s.startupUrls || []).join('\n');
    if (document.activeElement !== $('#homepage')) $('#homepage').value = s.homepage;
    $('#ms-minutes').value = String(s.memorySaverMinutes);
    $('#ms-minutes').disabled = !s.memorySaver;
    $('#dl-dir').textContent = s.downloadDirResolved;
    renderAllowlist();
  }

  // ---------------------------------------------------------------- Shield
  async function renderShieldStats() {
    const st = await window.pulse.invoke('internal:shield-stats');
    const ext = st.extended ? ` + ${st.extended.toLocaleString('pt-BR')} da lista ampliada` : '';
    $('#shield-stats').textContent = `${st.total.toLocaleString('pt-BR')} itens bloqueados até agora • ${st.builtin} domínios na lista interna${ext}`;
  }
  function normalizeHost(v) {
    let h = String(v || '').trim().toLowerCase();
    h = h.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/^www\./, '').replace(/:\d+$/, '');
    return /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(h) || h === 'localhost' ? h : '';
  }
  function renderAllowlist() {
    const box = $('#allowlist');
    box.textContent = '';
    for (const h of s.shieldAllowlist || []) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = h;
      const rm = document.createElement('button');
      rm.className = 'icon-btn';
      rm.title = 'Remover';
      rm.innerHTML = icon('x', 13);
      rm.addEventListener('click', () => set('shieldAllowlist', s.shieldAllowlist.filter((x) => x !== h)));
      chip.appendChild(rm);
      box.appendChild(chip);
    }
  }
  $('#allow-add').addEventListener('click', () => {
    const h = normalizeHost($('#allow-input').value);
    if (!h) {
      toast('Digite um domínio válido, como exemplo.com');
      return;
    }
    if (!s.shieldAllowlist.includes(h)) set('shieldAllowlist', [...s.shieldAllowlist, h]);
    $('#allow-input').value = '';
  });
  $('#allow-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#allow-add').click();
  });
  $('#shield-refresh').addEventListener('click', async () => {
    $('#shield-refresh').disabled = true;
    try {
      const n = await window.pulse.invoke('internal:shield-refresh');
      toast(n ? `Lista ampliada atualizada: ${n.toLocaleString('pt-BR')} domínios` : 'Não foi possível baixar a lista agora');
      renderShieldStats();
    } finally {
      $('#shield-refresh').disabled = false;
    }
  });

  // ---------------------------------------------------------------- Limpar dados
  $('#cl-go').addEventListener('click', async () => {
    const opts = {
      history: $('#cl-history').checked,
      cookies: $('#cl-cookies').checked,
      cache: $('#cl-cache').checked,
      downloads: $('#cl-downloads').checked,
      permissions: $('#cl-permissions').checked,
      passwords: $('#cl-passwords').checked,
      range: $('#cl-range').value,
    };
    if (!Object.entries(opts).some(([k, v]) => k !== 'range' && v)) {
      toast('Selecione o que deseja limpar');
      return;
    }
    $('#cl-go').disabled = true;
    try {
      await window.pulse.invoke('internal:clear-data', opts);
      toast('Dados de navegação limpos');
      renderPerms();
    } catch (err) {
      toast(`Erro: ${cleanError(err)}`);
    } finally {
      $('#cl-go').disabled = false;
    }
  });

  // ---------------------------------------------------------------- Permissões
  const PERM_ICONS = { camera: 'video', microphone: 'mic', geolocation: 'mapPin', notifications: 'bell', 'clipboard-read': 'copy', openExternal: 'externalLink' };
  async function renderPerms() {
    const list = await window.pulse.invoke('internal:site-permissions');
    const box = $('#perm-list');
    if (!list.length) {
      box.innerHTML = '<div class="card-pad muted">Nenhuma permissão salva. Quando um site pedir acesso à câmera, ao microfone, à localização ou a notificações, sua escolha aparece aqui.</div>';
      return;
    }
    box.innerHTML = list.map((site) => `<div class="perm-site" data-origin="${esc(site.origin)}">
      <div class="site">${icon('globe', 18)}<span class="grow ellipsis">${esc(site.origin)}</span>
        <button class="btn" data-reset>Redefinir</button></div>
      ${site.permissions.map((p) => `<div class="perm-line">${icon(PERM_ICONS[p.key] || 'settings', 16)}<span>${esc(p.label)}</span>
        <select data-key="${esc(p.key)}"><option value="allow" ${p.value === 'allow' ? 'selected' : ''}>Permitir</option><option value="deny" ${p.value === 'deny' ? 'selected' : ''}>Bloquear</option><option value="ask">Perguntar</option></select></div>`).join('')}
    </div>`).join('');
    box.querySelectorAll('.perm-site').forEach((row) => {
      const origin = row.dataset.origin;
      row.querySelectorAll('select').forEach((sel) => sel.addEventListener('change', async () => {
        await window.pulse.invoke('internal:site-permission-set', origin, sel.dataset.key, sel.value);
        if (sel.value === 'ask') renderPerms();
      }));
      row.querySelector('[data-reset]').addEventListener('click', async () => {
        for (const sel of row.querySelectorAll('select')) await window.pulse.invoke('internal:site-permission-set', origin, sel.dataset.key, 'ask');
        renderPerms();
      });
    });
  }

  // ---------------------------------------------------------------- Downloads
  $('#dl-change').addEventListener('click', async () => {
    const dir = await window.pulse.invoke('internal:choose-download-dir');
    if (dir) toast('Pasta de downloads alterada');
  });

  // ---------------------------------------------------------------- Idiomas
  const LANG_NAMES = {
    'pt-BR': 'Português (Brasil)', 'pt-PT': 'Português (Portugal)', 'en-US': 'Inglês (EUA)', 'en-GB': 'Inglês (Reino Unido)',
    es: 'Espanhol', 'es-ES': 'Espanhol (Espanha)', 'es-MX': 'Espanhol (México)', fr: 'Francês', 'fr-FR': 'Francês (França)',
    de: 'Alemão', 'de-DE': 'Alemão (Alemanha)', it: 'Italiano', 'it-IT': 'Italiano (Itália)', nl: 'Holandês', ru: 'Russo', pl: 'Polonês',
  };
  async function renderLangs() {
    const available = await window.pulse.invoke('internal:spellcheck-languages');
    const box = $('#langs');
    const shown = available.filter((l) => LANG_NAMES[l]);
    const list = shown.length ? shown : available;
    if (!list.length) {
      box.innerHTML = `<span class="muted small">${ctx.platform === 'darwin' ? 'No macOS, o corretor usa os idiomas do sistema.' : 'Nenhum dicionário disponível.'}</span>`;
      return;
    }
    box.innerHTML = list.map((l) => `<label><input type="checkbox" value="${esc(l)}" ${(s.spellcheckLanguages || []).includes(l) ? 'checked' : ''}> ${esc(LANG_NAMES[l] || l)}</label>`).join('');
    box.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', () => {
      const sel = [...box.querySelectorAll('input:checked')].map((i) => i.value);
      if (!sel.length) {
        cb.checked = true;
        toast('Mantenha pelo menos um idioma');
        return;
      }
      set('spellcheckLanguages', sel);
    }));
  }

  // ---------------------------------------------------------------- Extensões
  async function renderExts() {
    const list = await window.pulse.invoke('internal:extensions-list');
    const box = $('#ext-list');
    box.innerHTML = list.map((e) => `<div class="ext" data-id="${esc(e.id)}">
      <span class="fav">${icon('puzzle', 16)}</span>
      <div class="grow"><div><b>${esc(e.name)}</b> <span class="muted small">${esc(e.version)}</span></div><div class="muted small ellipsis">${esc(e.description || e.path)}</div></div>
      <button class="btn danger" data-remove>Remover</button></div>`).join('');
    box.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      await window.pulse.invoke('internal:extension-remove', b.closest('.ext').dataset.id);
      renderExts();
    }));
  }
  $('#ext-load').addEventListener('click', async () => {
    try {
      const ext = await window.pulse.invoke('internal:extension-load');
      if (ext) toast(`Extensão "${ext.name}" carregada`);
      renderExts();
    } catch (err) {
      toast(`Não foi possível carregar: ${cleanError(err)}`);
    }
  });

  // ---------------------------------------------------------------- Navegador padrão / reinício
  if (ctx.platform !== 'win32') $('#make-default').closest('.setting').querySelector('.desc').textContent = 'Registra o PulseBrowser para abrir links http e https';
  $('#make-default').addEventListener('click', async () => {
    const res = await window.pulse.invoke('internal:set-default-browser');
    toast(res.ok ? 'Confirme o PulseBrowser como navegador padrão na janela que abriu' : `Não foi possível registrar: ${res.error}`);
  });
  $('#restart').addEventListener('click', () => window.pulse.invoke('internal:relaunch'));

  // ---------------------------------------------------------------- Pesquisa nas configurações e menu lateral
  $('#filter').addEventListener('input', debounce(() => {
    const q = $('#filter').value.trim().toLowerCase();
    $$('section').forEach((sec) => {
      let any = false;
      sec.querySelectorAll('.setting').forEach((row) => {
        const hay = `${row.dataset.k || ''} ${row.textContent}`.toLowerCase();
        const match = !q || hay.includes(q);
        row.classList.toggle('filtered-out', !match);
        if (match) any = true;
      });
      if (sec.id === 'permissions') any = !q || 'permissões sites câmera microfone localização notificações'.includes(q);
      sec.classList.toggle('filtered-out', !any);
    });
  }, 120));

  const links = $$('#nav a[href^="#"]');
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${e.target.id}`));
    }
  }, { rootMargin: '-80px 0px -65% 0px' });
  $$('section').forEach((sec) => observer.observe(sec));

  document.addEventListener('pulse-settings', (e) => {
    s = e.detail;
    fill();
    renderShieldStats();
  });

  fill();
  renderShieldStats();
  renderPerms();
  renderLangs();
  renderExts();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
})();
