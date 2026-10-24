'use strict';
(async () => {
  const { $, esc, icon } = window.Pulse;
  const { ctx } = await window.Pulse.init();
  const v = ctx.versions;
  $('#ver').textContent = `Versão ${v.app} • Baseado no Chromium ${v.chrome}`;
  const rows = [
    ['Versão', v.app],
    ['Chromium', v.chrome],
    ['Electron', v.electron],
    ['V8', v.v8],
    ['Node.js', v.node],
    ['Sistema', ctx.os],
    ['Executável', ctx.exe],
    ['Dados do perfil', ctx.userData],
  ];
  $('#info').innerHTML = rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('');

  const features = [
    ['layers', 'Abas completas', 'Arrastar para reordenar, fixar, silenciar, duplicar, mover para nova janela e reabrir abas fechadas.'],
    ['shieldCheck', 'Pulse Shield', 'Bloqueio interno de anúncios, rastreadores e mineradores, com contador por página e exceções por site.'],
    ['incognito', 'Janela anônima', 'Sessão separada na memória, apagada ao fechar a última janela anônima.'],
    ['search', 'Barra de endereço inteligente', 'Sugestões de pesquisa, histórico, favoritos, abas abertas e autocompletar.'],
    ['bookmark', 'Favoritos', 'Barra de favoritos, pastas, gerenciador, importação do Chrome e de arquivos HTML.'],
    ['download', 'Downloads', 'Pausar, continuar, cancelar, progresso na barra de tarefas e histórico de downloads.'],
    ['zap', 'Economia de memória', 'Abas inativas entram em espera e voltam ao serem abertas.'],
    ['code', 'Ferramentas do desenvolvedor', 'DevTools do Chromium encaixadas na janela, código-fonte e inspecionar elemento.'],
    ['key', 'Permissões por site', 'Câmera, microfone, localização, notificações e compartilhamento de tela com controle por site.'],
    ['camera', 'Captura e PDF', 'Capture a página, salve como PDF ou como página completa e imprima.'],
    ['refreshCcw', 'Restauração de sessão', 'Continue de onde parou, com histórico de navegação de cada aba.'],
    ['palette', 'Temas', 'Claro, escuro ou do sistema, com cores de destaque e fundos para a nova aba.'],
  ];
  $('#features').innerHTML = features.map(([ic, t, d]) => `<div class="card feature">${icon(ic, 20)}<div><b>${esc(t)}</b><span class="muted small">${esc(d)}</span></div></div>`).join('');

  const keys = [
    ['Nova aba', 'Ctrl+T'], ['Nova janela', 'Ctrl+N'], ['Nova janela anônima', 'Ctrl+Shift+N'],
    ['Fechar aba', 'Ctrl+W'], ['Reabrir aba fechada', 'Ctrl+Shift+T'], ['Próxima / anterior aba', 'Ctrl+Tab / Ctrl+Shift+Tab'],
    ['Ir para a aba 1–8 / última', 'Ctrl+1…8 / Ctrl+9'], ['Barra de endereço', 'Ctrl+L / Alt+D / F6'],
    ['Voltar / avançar', 'Alt+← / Alt+→'], ['Recarregar / sem cache', 'F5 / Ctrl+F5'], ['Localizar na página', 'Ctrl+F'],
    ['Zoom', 'Ctrl++ / Ctrl+- / Ctrl+0'], ['Favoritar página', 'Ctrl+D'], ['Barra de favoritos', 'Ctrl+Shift+B'],
    ['Gerenciador de favoritos', 'Ctrl+Shift+O'], ['Histórico', 'Ctrl+H'], ['Downloads', 'Ctrl+J'],
    ['Imprimir', 'Ctrl+P'], ['Salvar página', 'Ctrl+S'], ['Capturar tela da página', 'Ctrl+Shift+S'],
    ['Código-fonte', 'Ctrl+U'], ['Ferramentas do desenvolvedor', 'F12 / Ctrl+Shift+I'], ['Tela cheia', 'F11'],
    ['Limpar dados de navegação', 'Ctrl+Shift+Delete'], ['Abrir em nova aba (barra de endereço)', 'Alt+Enter'], ['Completar .com', 'Ctrl+Enter'],
  ];
  $('#keys').innerHTML = keys.map(([k, c]) => `<tr><td>${esc(k)}</td><td>${c.split(' / ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ')}</td></tr>`).join('');
})();
