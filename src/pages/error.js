'use strict';
(async () => {
  const { $, icon, hostOf } = window.Pulse;
  await window.Pulse.init();
  const params = new URLSearchParams(location.search);
  const url = params.get('url') || '';
  const code = params.get('code') || '';
  const desc = params.get('desc') || '';
  const host = hostOf(url) || url;
  const n = Number(code);
  document.title = host || 'Erro';

  const M = {
    '-105': ['Não foi possível acessar esse site', `Não foi possível encontrar o endereço IP do servidor de ${host}.`, ['Verifique se o endereço foi digitado corretamente', 'Verifique sua conexão com a internet', 'Verifique as configurações de DNS e proxy']],
    '-137': ['Não foi possível acessar esse site', `A resolução do nome de ${host} falhou.`, ['Verifique sua conexão com a internet', 'Tente novamente em instantes']],
    '-106': ['Sem conexão com a internet', 'Parece que você está offline.', ['Verifique os cabos de rede, o modem e o roteador', 'Reconecte-se ao Wi-Fi']],
    '-102': ['Não foi possível acessar esse site', `${host} recusou a conexão.`, ['Verifique se o endereço está correto', 'Verifique se há um firewall ou proxy bloqueando a conexão']],
    '-118': ['Não foi possível acessar esse site', `${host} demorou muito para responder.`, ['Verifique sua conexão', 'Tente novamente mais tarde']],
    '-7': ['Não foi possível acessar esse site', `${host} demorou muito para responder.`, ['Verifique sua conexão', 'Tente novamente mais tarde']],
    '-101': ['Não foi possível acessar esse site', 'A conexão foi redefinida.', ['Verifique sua conexão', 'Verifique o proxy e o firewall']],
    '-100': ['Esta página não está funcionando', `${host} encerrou a conexão inesperadamente.`, []],
    '-324': ['Esta página não está funcionando', `${host} não enviou nenhum dado.`, []],
    '-310': ['Esta página não está funcionando', `${host} redirecionou você muitas vezes.`, ['Tente limpar os cookies deste site em Configurações > Privacidade']],
    '-109': ['Não foi possível acessar esse site', `Não foi possível alcançar ${host}.`, []],
    '-21': ['Sua conexão foi interrompida', 'Uma alteração de rede foi detectada.', []],
    '-6': ['Arquivo não encontrado', 'O arquivo pode ter sido movido ou excluído.', []],
    '-10': ['Acesso negado', 'Não foi possível abrir este arquivo.', []],
    '-501': ['Esta página não é segura', `${host} enviou uma resposta inválida.`, []],
    '-300': ['Endereço inválido', 'O endereço digitado não é válido.', []],
    crash: ['Ah, não! A página travou', 'Ocorreu um problema ao exibir esta página.', ['Recarregue a página', 'Se o problema continuar, feche outras abas para liberar memória']],
  };

  const isCert = n <= -200 && n > -300;
  let [title, text, tips] = M[code] || ['Não foi possível carregar esta página', `Ocorreu um erro ao carregar ${host}.`, []];
  let bigIcon = code === '-106' ? 'wifiOff' : code === 'crash' ? 'frown' : 'globe';

  if (isCert) {
    title = 'Sua conexão não é particular';
    text = `Talvez criminosos estejam tentando roubar suas informações de ${host} (por exemplo, senhas, mensagens ou cartões de crédito).`;
    tips = [];
    bigIcon = 'alert';
    $('#err').classList.add('danger');
    $('#advanced').hidden = false;
    $('#adv-text').textContent = `O certificado de segurança de ${host} não é confiável (${desc}). Continue somente se você confia neste site.`;
    $('#advanced').addEventListener('click', () => {
      $('#advanced-box').hidden = !$('#advanced-box').hidden;
    });
    $('#proceed').textContent = `Continuar para ${host} (não seguro)`;
    $('#proceed').addEventListener('click', (e) => {
      e.preventDefault();
      window.pulse.invoke('internal:cert-proceed', url);
    });
    $('#retry').textContent = 'Voltar à segurança';
  }

  $('#big').innerHTML = icon(bigIcon, 64);
  $('#title').textContent = title;
  $('#desc').textContent = text;
  $('#tips').innerHTML = '';
  for (const t of tips) {
    const li = document.createElement('li');
    li.textContent = t;
    $('#tips').appendChild(li);
  }
  $('#code').textContent = code === 'crash' ? `Código: ${desc}` : desc || `Erro ${code}`;
  $('#retry').addEventListener('click', () => {
    if (isCert) {
      if (history.length > 1) history.back();
      else location.href = 'tuff://newtab/';
      return;
    }
    if (url) location.href = url;
    else location.reload();
  });

  if (code === '-106' || code === '-105' && !navigator.onLine) startGame();

  // ---------------------------------------------------------------- tuff Runner (jogo offline)
  function startGame() {
    const canvas = $('#game');
    canvas.hidden = false;
    $('#game-hint').hidden = false;
    const g = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const ground = 240;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#7c5cff';
    const muted = css.getPropertyValue('--muted').trim() || '#888';
    let player;
    let obstacles;
    let speed;
    let score;
    let best = 0;
    let state = 'idle';
    let tickCount = 0;
    let nextSpawn = 0;

    function reset() {
      player = { x: 120, y: ground, vy: 0, r: 18 };
      obstacles = [];
      speed = 8;
      score = 0;
      tickCount = 0;
      nextSpawn = 60;
    }

    function jump() {
      if (state !== 'running') {
        reset();
        state = 'running';
        return;
      }
      if (player.y >= ground - 0.5) player.vy = -15;
    }

    function update() {
      if (state !== 'running') return;
      tickCount++;
      speed = Math.min(20, 8 + tickCount / 400);
      player.vy += 0.8;
      player.y = Math.min(ground, player.y + player.vy);
      if (player.y >= ground) player.vy = 0;
      if (--nextSpawn <= 0) {
        const h = 30 + Math.random() * 40;
        const w = 22 + Math.random() * 30;
        obstacles.push({ x: W + 20, w, h });
        nextSpawn = 45 + Math.random() * 70 - speed;
      }
      for (const o of obstacles) o.x -= speed;
      obstacles = obstacles.filter((o) => o.x + o.w > -10);
      for (const o of obstacles) {
        const cx = Math.max(o.x, Math.min(player.x, o.x + o.w));
        const cy = Math.max(ground + player.r - o.h, Math.min(player.y, ground + player.r));
        if ((player.x - cx) ** 2 + (player.y - cy) ** 2 < (player.r - 4) ** 2) {
          state = 'over';
          best = Math.max(best, Math.floor(score));
        }
      }
      score += speed / 10;
    }

    function draw() {
      g.clearRect(0, 0, W, H);
      // Linha de "batimento" no chão.
      g.strokeStyle = muted;
      g.globalAlpha = 0.5;
      g.lineWidth = 3;
      g.beginPath();
      const offset = (tickCount * speed) % 300;
      for (let x = -offset; x < W; x += 300) {
        g.moveTo(x, ground + player.r);
        g.lineTo(x + 120, ground + player.r);
        g.lineTo(x + 140, ground + player.r - 26);
        g.lineTo(x + 160, ground + player.r + 18);
        g.lineTo(x + 175, ground + player.r);
        g.lineTo(x + 300, ground + player.r);
      }
      g.stroke();
      g.globalAlpha = 1;
      // Obstáculos.
      g.fillStyle = muted;
      for (const o of obstacles) {
        g.beginPath();
        g.moveTo(o.x, ground + player.r);
        g.lineTo(o.x + o.w / 2, ground + player.r - o.h);
        g.lineTo(o.x + o.w, ground + player.r);
        g.closePath();
        g.fill();
      }
      // Jogador.
      g.shadowColor = accent;
      g.shadowBlur = 24;
      g.fillStyle = accent;
      g.beginPath();
      g.arc(player.x, player.y, player.r, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      // Placar.
      g.fillStyle = muted;
      g.font = '600 28px "Segoe UI", sans-serif';
      g.textAlign = 'right';
      g.fillText(`${String(Math.floor(score)).padStart(5, '0')}   Recorde ${String(best).padStart(5, '0')}`, W - 30, 50);
      g.textAlign = 'center';
      if (state === 'idle') g.fillText('Pressione Espaço para começar', W / 2, 120);
      if (state === 'over') g.fillText('Fim de jogo — Espaço para jogar de novo', W / 2, 120);
    }

    function loop() {
      update();
      draw();
      requestAnimationFrame(loop);
    }

    reset();
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        jump();
      }
    });
    canvas.addEventListener('mousedown', jump);
    window.addEventListener('online', () => {
      if (url) location.href = url;
    });
    loop();
  }
})();
