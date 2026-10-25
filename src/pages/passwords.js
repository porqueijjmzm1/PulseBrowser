'use strict';
// tuff://passwords — lista, edição, verificação, importação e exportação das senhas salvas.
(async () => {
  const { $, $$, esc, icon, toast, colorFor } = window.Pulse;
  await window.Pulse.init();

  const call = (ch, ...args) => window.pulse.invoke(ch, ...args);
  const cleanError = (err) => String(err && err.message ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const animOn = () => !document.body.classList.contains('no-anim') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MASK = '••••••••••';

  let data = { logins: [], never: [], encrypted: true };
  let health = null; // { byId: Map, leaked: Set, leakError, when }
  const revealed = new Map(); // id -> { value, timer }
  let firstRender = true;

  // ---------------------------------------------------------------- Ícones dos botões
  $('#ed-eye').innerHTML = icon('eye', 17);
  $('#ed-gen').innerHTML = icon('wand', 17);

  function avatar(site) {
    const box = document.createElement('span');
    box.className = 'fav';
    box.textContent = (site[0] || '?').toUpperCase();
    box.style.background = colorFor(site);
    return box;
  }

  function iconButton(name, title, onClick) {
    const b = document.createElement('button');
    b.className = 'icon-btn';
    b.title = title;
    b.innerHTML = icon(name, 17);
    b.addEventListener('click', onClick);
    return b;
  }

  // ---------------------------------------------------------------- Força da senha (mesmas regras do gerenciador)
  const COMMON = new Set(['123456', '12345678', '123456789', 'password', 'senha', 'senha123', 'qwerty', 'abc123', '111111', '123123', 'admin', 'iloveyou', '000000', 'teste']);
  function strengthOf(p) {
    if (!p) return -1;
    if (COMMON.has(p.toLowerCase())) return 0;
    let classes = 0;
    if (/[a-z]/.test(p)) classes++;
    if (/[A-Z]/.test(p)) classes++;
    if (/\d/.test(p)) classes++;
    if (/[^a-zA-Z0-9]/.test(p)) classes++;
    if (p.length < 8 || new Set(p).size < 4) return 0;
    if (p.length < 10 && classes < 3) return 1;
    if (p.length < 12 && classes < 2) return 1;
    if (p.length >= 14 && classes >= 3) return 3;
    return 2;
  }
  const STRENGTH = [
    { label: 'Fraca — fácil de adivinhar', color: 'var(--danger)', w: '25%' },
    { label: 'Razoável', color: '#f59e0b', w: '50%' },
    { label: 'Boa', color: '#65a30d', w: '75%' },
    { label: 'Forte', color: 'var(--ok)', w: '100%' },
  ];

  function generatePassword(length = 16) {
    const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '-_!@#$%*?+='];
    const all = sets.join('');
    const rand = (n) => {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] % n;
    };
    const chars = sets.map((s) => s[rand(s.length)]);
    while (chars.length < length) chars.push(all[rand(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  // ---------------------------------------------------------------- Lista
  function matches(l, q) {
    if (!q) return true;
    return `${l.site} ${l.origin} ${l.username} ${l.note}`.toLowerCase().includes(q);
  }

  function issueTags(l) {
    const tags = [];
    if (!health) return tags;
    if (health.leaked.has(l.id)) tags.push(['leaked', 'Vazada']);
    const h = health.byId.get(l.id);
    if (h?.reused) tags.push(['reused', 'Reutilizada']);
    if (h?.weak) tags.push(['weak', 'Fraca']);
    return tags;
  }

  function renderSecret(el, l) {
    const r = revealed.get(l.id);
    el.textContent = r ? r.value : MASK;
    el.classList.toggle('shown', !!r);
  }

  function hide(id) {
    const r = revealed.get(id);
    if (r) clearTimeout(r.timer);
    revealed.delete(id);
    const l = data.logins.find((x) => x.id === id);
    if (!l) return;
    for (const row of $$(`.pw-item[data-id="${CSS.escape(id)}"]`)) {
      const sec = row.querySelector('.secret');
      if (sec) renderSecret(sec, l);
      row.querySelector('[data-eye]')?.replaceWith(eyeButton(l));
    }
  }

  function eyeButton(l) {
    const on = revealed.has(l.id);
    const b = iconButton(on ? 'eyeOff' : 'eye', on ? 'Ocultar senha' : 'Mostrar senha', async () => {
      if (revealed.has(l.id)) {
        hide(l.id);
        return;
      }
      const value = await call('internal:passwords-reveal', l.id);
      if (typeof value !== 'string') return;
      revealed.set(l.id, { value, timer: setTimeout(() => hide(l.id), 30_000) });
      for (const row of $$(`.pw-item[data-id="${CSS.escape(l.id)}"]`)) {
        const sec = row.querySelector('.secret');
        if (sec) renderSecret(sec, l);
        row.querySelector('[data-eye]')?.replaceWith(eyeButton(l));
      }
    });
    b.dataset.eye = '';
    if (on) b.classList.add('on');
    return b;
  }

  function row(l, i, { compact = false } = {}) {
    const el = document.createElement('div');
    el.className = `pw-item${firstRender && !compact ? ' enter' : ''}`;
    el.style.setProperty('--i', String(Math.min(i, 14)));
    el.dataset.id = l.id;
    el.appendChild(avatar(l.site));

    const who = document.createElement('div');
    who.className = 'who';
    const site = document.createElement('div');
    site.className = 'site';
    site.textContent = l.site;
    site.title = l.origin;
    const user = document.createElement('div');
    user.className = `user${l.username ? '' : ' none'}`;
    user.textContent = l.username || 'sem nome de usuário';
    who.append(site, user);
    const tags = issueTags(l);
    if (tags.length) {
      const t = document.createElement('div');
      t.className = 'tags';
      for (const [cls, label] of tags) {
        const s = document.createElement('span');
        s.className = `tag ${cls}`;
        s.textContent = label;
        t.appendChild(s);
      }
      who.appendChild(t);
    }
    el.appendChild(who);

    const secret = document.createElement('div');
    secret.className = 'secret';
    renderSecret(secret, l);
    el.appendChild(secret);

    const acts = document.createElement('div');
    acts.className = 'acts';
    if (compact) {
      const open = document.createElement('a');
      open.className = 'btn';
      open.href = l.origin;
      open.target = '_blank';
      open.innerHTML = `${icon('externalLink', 15)}Abrir site`;
      acts.appendChild(open);
      const change = document.createElement('button');
      change.className = 'btn';
      change.innerHTML = `${icon('edit', 15)}Alterar senha`;
      change.addEventListener('click', () => openEditor(l));
      acts.appendChild(change);
    } else {
      acts.appendChild(eyeButton(l));
      acts.appendChild(iconButton('copy', 'Copiar senha', async () => {
        if (await call('internal:passwords-copy', l.id, 'password')) toast('Senha copiada');
      }));
      if (l.username) {
        acts.appendChild(iconButton('user', 'Copiar nome de usuário', async () => {
          if (await call('internal:passwords-copy', l.id, 'username')) toast('Nome de usuário copiado');
        }));
      }
      acts.appendChild(iconButton('edit', 'Editar', () => openEditor(l)));
      acts.appendChild(iconButton('trash', 'Excluir', () => removeLogin(l, el)));
    }
    el.appendChild(acts);
    return el;
  }

  function render() {
    const n = data.logins.length;
    $('#count').textContent = n ? `${n} ${n === 1 ? 'senha salva' : 'senhas salvas'}` : 'Nenhuma senha salva';
    const enc = $('#enc');
    enc.classList.toggle('warn', !data.encrypted);
    enc.innerHTML = data.encrypted
      ? `${icon('lock', 14)}Criptografadas com a sua conta do Windows`
      : `${icon('alert', 14)}A criptografia do sistema não está disponível; as senhas ficam só codificadas neste computador`;

    const q = $('#filter').value.trim().toLowerCase();
    const box = $('#logins');
    box.textContent = '';
    const list = data.logins.filter((l) => matches(l, q));
    if (!n) {
      box.innerHTML = `<div class="empty"><div class="big">${icon('key', 28)}</div><b>Nenhuma senha salva ainda</b>Quando você entrar em um site, o tuff.browse oferece para guardar a senha. Você também pode adicionar uma senha ou importar de outro navegador.</div>`;
    } else if (!list.length) {
      box.innerHTML = `<div class="empty"><div class="big">${icon('search', 26)}</div><b>Nada encontrado</b>Nenhuma senha corresponde a “${esc(q)}”.</div>`;
    } else {
      list.forEach((l, i) => box.appendChild(row(l, i)));
    }
    firstRender = false;
  }

  function renderNever() {
    const box = $('#never-list');
    box.textContent = '';
    for (const key of data.never) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = key;
      const rm = iconButton('x', 'Remover', async () => {
        await call('internal:passwords-never-remove', key);
      });
      chip.appendChild(rm);
      box.appendChild(chip);
    }
  }

  async function load() {
    data = await call('internal:passwords-list');
    for (const [id] of revealed) if (!data.logins.some((l) => l.id === id)) hide(id);
    render();
    renderNever();
    if (health) {
      // Logins removidos saem da verificação; os novos só entram na próxima verificação.
      const ids = new Set(data.logins.map((l) => l.id));
      for (const id of [...health.byId.keys()]) if (!ids.has(id)) health.byId.delete(id);
      for (const id of [...health.leaked]) if (!ids.has(id)) health.leaked.delete(id);
      renderCheck(false);
    }
  }

  // ---------------------------------------------------------------- Excluir
  function confirmDialog(title, text, yes = 'Excluir') {
    return new Promise((resolve) => {
      const dlg = $('#confirm-dlg');
      $('#cf-title').textContent = title;
      $('#cf-text').textContent = text;
      $('#cf-yes').textContent = yes;
      const done = (v) => {
        dlg.close();
        $('#cf-yes').onclick = null;
        $('#cf-no').onclick = null;
        dlg.onclose = null;
        resolve(v);
      };
      $('#cf-yes').onclick = () => done(true);
      $('#cf-no').onclick = () => done(false);
      dlg.onclose = () => resolve(false);
      dlg.showModal();
      $('#cf-no').focus();
    });
  }

  async function removeLogin(l, el) {
    const ok = await confirmDialog('Excluir senha?', `A senha de ${l.username || 'sem nome de usuário'} em ${l.site} será apagada deste computador.`);
    if (!ok) return;
    if (el && animOn()) {
      el.style.height = `${el.offsetHeight}px`;
      el.classList.add('leaving');
      await new Promise((r) => setTimeout(r, 260));
    }
    await call('internal:passwords-remove', l.id);
    toast('Senha excluída');
  }

  // ---------------------------------------------------------------- Adicionar / editar
  let editing = null;

  function updateMeter() {
    const st = strengthOf($('#ed-pass').value);
    const bar = $('#ed-meter');
    const label = $('#ed-meter-label');
    if (st < 0) {
      bar.style.width = '0';
      label.textContent = '';
      return;
    }
    bar.style.width = STRENGTH[st].w;
    bar.style.background = STRENGTH[st].color;
    label.textContent = STRENGTH[st].label;
    label.style.color = STRENGTH[st].color;
  }

  function setEye(show) {
    $('#ed-pass').type = show ? 'text' : 'password';
    $('#ed-eye').innerHTML = icon(show ? 'eyeOff' : 'eye', 17);
    $('#ed-eye').title = show ? 'Ocultar senha' : 'Mostrar senha';
  }

  async function openEditor(login) {
    editing = login || null;
    $('#ed-title').textContent = login ? 'Editar senha' : 'Adicionar senha';
    $('#ed-site').value = login ? login.origin : '';
    $('#ed-user').value = login ? login.username : '';
    $('#ed-pass').value = '';
    $('#ed-note').value = login?.note || '';
    $('#ed-error').textContent = '';
    setEye(false);
    updateMeter();
    $('#edit-dlg').showModal();
    if (login) {
      const value = await call('internal:passwords-reveal', login.id);
      if (editing === login && typeof value === 'string') {
        $('#ed-pass').value = value;
        updateMeter();
      }
      $('#ed-pass').focus();
    } else {
      $('#ed-site').focus();
    }
  }

  $('#ed-pass').addEventListener('input', updateMeter);
  $('#ed-eye').addEventListener('click', () => setEye($('#ed-pass').type === 'password'));
  $('#ed-gen').addEventListener('click', () => {
    $('#ed-pass').value = generatePassword();
    setEye(true);
    updateMeter();
    const g = $('#ed-gen');
    g.classList.remove('spin');
    void g.offsetWidth;
    g.classList.add('spin');
  });
  $('#ed-cancel').addEventListener('click', () => $('#edit-dlg').close());

  $('#ed-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#ed-error');
    err.textContent = '';
    const origin = $('#ed-site').value.trim();
    const username = $('#ed-user').value.trim();
    const password = $('#ed-pass').value;
    const note = $('#ed-note').value;
    if (!origin) {
      err.textContent = 'Informe o endereço do site.';
      $('#ed-site').focus();
      return;
    }
    if (!password) {
      err.textContent = 'Informe a senha.';
      $('#ed-pass').focus();
      return;
    }
    $('#ed-save').disabled = true;
    try {
      let id;
      if (editing) {
        await call('internal:passwords-update', editing.id, { origin, username, password, note });
        id = editing.id;
        toast('Senha atualizada');
      } else {
        const res = await call('internal:passwords-save', { origin, username, password, note });
        id = res.id;
        toast(res.created ? 'Senha salva' : res.updated ? 'Senha atualizada' : 'Essa senha já estava salva');
      }
      revealed.delete(id);
      $('#edit-dlg').close();
      setTimeout(() => {
        const r = $(`.pw-item[data-id="${CSS.escape(id)}"]`);
        if (r) {
          r.scrollIntoView({ block: 'nearest', behavior: animOn() ? 'smooth' : 'auto' });
          r.classList.add('flash');
        }
      }, 120);
    } catch (ex) {
      err.textContent = cleanError(ex);
    } finally {
      $('#ed-save').disabled = false;
    }
  });
  $('#add').addEventListener('click', () => openEditor(null));

  // ---------------------------------------------------------------- Verificação
  function countUp(el, to) {
    if (!animOn() || to === 0) {
      el.textContent = String(to);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 650);
      el.textContent = String(Math.round(to * (1 - (1 - t) ** 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderCheck(animate = true) {
    if (!health) return;
    const leaked = data.logins.filter((l) => health.leaked.has(l.id));
    const reused = data.logins.filter((l) => health.byId.get(l.id)?.reused);
    const weak = data.logins.filter((l) => health.byId.get(l.id)?.weak);
    const counts = { leaked: leaked.length, reused: reused.length, weak: weak.length };
    $('#stats').hidden = false;
    for (const st of $$('#stats .stat')) {
      const kind = st.dataset.kind;
      const n = counts[kind];
      st.classList.toggle('bad', kind === 'leaked' && n > 0);
      st.classList.toggle('warn', kind !== 'leaked' && n > 0);
      if (animate) countUp(st.querySelector('.n'), n);
      else st.querySelector('.n').textContent = String(n);
    }
    const problems = data.logins.filter((l) => issueTags(l).length)
      .sort((a, b) => (health.leaked.has(b.id) ? 1 : 0) - (health.leaked.has(a.id) ? 1 : 0));
    const ic = $('#check-ic');
    ic.classList.remove('scanning', 'good', 'bad');
    ic.classList.add(problems.length ? 'bad' : 'good');
    if (animate) {
      ic.classList.remove('done');
      void ic.offsetWidth;
      ic.classList.add('done');
    }
    ic.innerHTML = icon(problems.length ? 'shieldAlert' : 'shieldCheck', 24);
    const when = new Date(health.when).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (!data.logins.length) {
      $('#check-title').textContent = 'Nenhuma senha para verificar';
    } else if (problems.length) {
      $('#check-title').textContent = `${problems.length} ${problems.length === 1 ? 'senha precisa' : 'senhas precisam'} de atenção`;
    } else {
      $('#check-title').textContent = 'Suas senhas estão seguras';
    }
    $('#check-desc').textContent = health.leakError
      ? `Verificado às ${when}. Não foi possível consultar vazamentos (${health.leakError}); senhas fracas e repetidas foram verificadas.`
      : `Verificado às ${when}.${problems.length ? ' Troque essas senhas no site e depois atualize aqui.' : ''}`;
    const box = $('#issues');
    box.textContent = '';
    problems.forEach((l, i) => box.appendChild(row(l, i, { compact: true })));
  }

  $('#check-run').addEventListener('click', async () => {
    const btn = $('#check-run');
    btn.disabled = true;
    const ic = $('#check-ic');
    ic.classList.remove('good', 'bad', 'done');
    ic.classList.add('scanning');
    $('#check-title').textContent = 'Verificando suas senhas...';
    try {
      const items = await call('internal:passwords-health');
      const leaks = await call('internal:passwords-leaks');
      health = {
        byId: new Map(items.map((it) => [it.id, it])),
        leaked: new Set(leaks.ok ? leaks.leaked : []),
        leakError: leaks.ok ? '' : leaks.error,
        when: Date.now(),
      };
      renderCheck(true);
      render();
    } catch (err) {
      ic.classList.remove('scanning');
      $('#check-title').textContent = 'Não foi possível verificar';
      $('#check-desc').textContent = cleanError(err);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------------------------------------------------------- Importar / exportar
  $('#import').addEventListener('click', async () => {
    const res = await call('internal:passwords-import');
    if (!res) return;
    if (!res.ok) {
      toast(`Não foi possível importar: ${res.error}`);
      return;
    }
    const parts = [];
    if (res.added) parts.push(`${res.added} ${res.added === 1 ? 'nova' : 'novas'}`);
    if (res.updated) parts.push(`${res.updated} ${res.updated === 1 ? 'atualizada' : 'atualizadas'}`);
    if (res.skipped) parts.push(`${res.skipped} ${res.skipped === 1 ? 'ignorada' : 'ignoradas'}`);
    toast(parts.length ? `Importação concluída: ${parts.join(', ')}` : 'Nenhuma senha encontrada no arquivo');
  });
  $('#export').addEventListener('click', async () => {
    if (!data.logins.length) {
      toast('Não há senhas para exportar');
      return;
    }
    if (await call('internal:passwords-export')) toast('Senhas exportadas');
  });

  // ---------------------------------------------------------------- Pesquisa, menu lateral e atualizações
  $('#filter').addEventListener('input', () => render());
  // Destaca no menu lateral a seção que está no topo da tela.
  const links = $$('#nav a[href^="#"]');
  const sections = $$('section');
  const syncNav = () => {
    let current = sections[0];
    for (const sec of sections) if (sec.getBoundingClientRect().top <= 140) current = sec;
    links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${current.id}`));
  };
  window.addEventListener('scroll', syncNav, { passive: true });
  syncNav();
  window.pulse.on('internal:passwords-changed', () => load());

  await load();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
})();
