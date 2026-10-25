'use strict';
// Menu de contexto das páginas (botão direito).
const { Menu, clipboard } = require('electron');
const ctx = require('./context');

function truncate(s, n = 30) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function buildPageMenu(tab, params) {
  const win = tab.window;
  const wc = tab.webContents;
  const items = [];
  const sep = () => {
    if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' });
  };
  const isMedia = params.mediaType === 'video' || params.mediaType === 'audio';

  // Correção ortográfica.
  if (params.isEditable && params.misspelledWord) {
    for (const s of params.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    }
    if (!params.dictionarySuggestions.length) items.push({ label: 'Nenhuma sugestão', enabled: false });
    items.push({
      label: 'Adicionar ao dicionário',
      click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });
    sep();
  }

  if (params.linkURL) {
    const link = params.linkURL;
    items.push(
      { label: 'Abrir link em nova aba', click: () => win.createTab({ url: link, active: false, opener: tab }) },
      { label: 'Abrir link em nova janela', click: () => win.openInNewWindow(link) },
      { label: 'Abrir link em janela anônima', click: () => win.openInNewWindow(link, { incognito: true }) },
      { type: 'separator' },
      {
        label: 'Salvar link como...',
        click: () => {
          ctx.downloads.forceAsk.add(link);
          wc.downloadURL(link);
        },
      },
      { label: 'Copiar endereço do link', click: () => clipboard.writeText(link) },
    );
    if (params.linkText && !params.hasImageContents) {
      items.push({ label: 'Copiar texto do link', click: () => clipboard.writeText(params.linkText) });
    }
    sep();
  }

  if (params.mediaType === 'image' && params.srcURL) {
    const src = params.srcURL;
    items.push(
      { label: 'Abrir imagem em nova aba', click: () => win.createTab({ url: src, active: false, opener: tab }) },
      {
        label: 'Salvar imagem como...',
        click: () => {
          ctx.downloads.forceAsk.add(src);
          wc.downloadURL(src);
        },
      },
      { label: 'Copiar imagem', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Copiar endereço da imagem', click: () => clipboard.writeText(src) },
      {
        label: `Pesquisar imagem no Google`,
        click: () => win.createTab({ url: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(src)}`, opener: tab }),
      },
    );
    sep();
  }

  if (isMedia) {
    const flags = params.mediaFlags || {};
    items.push(
      {
        label: flags.isPaused ? 'Reproduzir' : 'Pausar',
        click: () => wc.executeJavaScript(`(()=>{const m=document.elementFromPoint(${params.x},${params.y})?.closest('video,audio');if(m){m.paused?m.play():m.pause();}})()`, true),
      },
      {
        label: flags.isMuted ? 'Ativar som' : 'Desativar som',
        click: () => wc.executeJavaScript(`(()=>{const m=document.elementFromPoint(${params.x},${params.y})?.closest('video,audio');if(m)m.muted=!m.muted;})()`, true),
      },
      {
        label: 'Repetir',
        type: 'checkbox',
        checked: !!flags.isLooping,
        click: () => wc.executeJavaScript(`(()=>{const m=document.elementFromPoint(${params.x},${params.y})?.closest('video,audio');if(m)m.loop=!m.loop;})()`, true),
      },
      {
        label: 'Mostrar controles',
        type: 'checkbox',
        checked: !!flags.isControlsVisible,
        click: () => wc.executeJavaScript(`(()=>{const m=document.elementFromPoint(${params.x},${params.y})?.closest('video,audio');if(m)m.controls=!m.controls;})()`, true),
      },
    );
    if (params.mediaType === 'video') {
      items.push({
        label: 'Picture-in-picture',
        click: () => wc.executeJavaScript(`(()=>{const v=document.elementFromPoint(${params.x},${params.y})?.closest('video');if(v){document.pictureInPictureElement===v?document.exitPictureInPicture():v.requestPictureInPicture();}})()`, true).catch(() => {}),
      });
    }
    if (params.srcURL && !params.srcURL.startsWith('blob:')) {
      items.push({
        label: params.mediaType === 'video' ? 'Salvar vídeo como...' : 'Salvar áudio como...',
        click: () => {
          ctx.downloads.forceAsk.add(params.srcURL);
          wc.downloadURL(params.srcURL);
        },
      });
    }
    sep();
  }

  if (params.isEditable) {
    const f = params.editFlags;
    items.push(
      { label: 'Desfazer', enabled: f.canUndo, accelerator: 'CmdOrCtrl+Z', click: () => wc.undo() },
      { label: 'Refazer', enabled: f.canRedo, accelerator: 'CmdOrCtrl+Shift+Z', click: () => wc.redo() },
      { type: 'separator' },
      { label: 'Recortar', enabled: f.canCut, accelerator: 'CmdOrCtrl+X', click: () => wc.cut() },
      { label: 'Copiar', enabled: f.canCopy, accelerator: 'CmdOrCtrl+C', click: () => wc.copy() },
      { label: 'Colar', enabled: f.canPaste, accelerator: 'CmdOrCtrl+V', click: () => wc.paste() },
      { label: 'Colar como texto simples', enabled: f.canPaste, accelerator: 'CmdOrCtrl+Shift+V', click: () => wc.pasteAndMatchStyle() },
      { label: 'Selecionar tudo', enabled: f.canSelectAll, accelerator: 'CmdOrCtrl+A', click: () => wc.selectAll() },
    );
    sep();
  } else if (params.selectionText) {
    items.push({ label: 'Copiar', accelerator: 'CmdOrCtrl+C', click: () => wc.copy() });
    sep();
  }

  if (params.selectionText) {
    const text = params.selectionText.trim();
    const engine = ctx.settings.engine().name;
    items.push({
      label: `Pesquisar "${truncate(text)}" no ${engine}`,
      click: () => win.createTab({ url: ctx.settings.searchUrl(text), opener: tab }),
    });
    if (/^\S+\.\S{2,}$/.test(text) && !/\s/.test(text)) {
      items.push({
        label: `Ir para ${truncate(text)}`,
        click: () => win.createTab({ url: /^https?:/i.test(text) ? text : `https://${text}`, opener: tab }),
      });
    }
    items.push({
      label: 'Traduzir seleção',
      click: () => win.createTab({ url: `https://translate.google.com/?sl=auto&tl=pt&text=${encodeURIComponent(text)}&op=translate`, opener: tab }),
    });
    sep();
  }

  if (!params.linkURL && !params.isEditable && !params.selectionText && params.mediaType === 'none') {
    const nav = wc.navigationHistory;
    items.push(
      { label: 'Voltar', enabled: nav.canGoBack(), accelerator: 'Alt+Left', click: () => tab.goBack() },
      { label: 'Avançar', enabled: nav.canGoForward(), accelerator: 'Alt+Right', click: () => tab.goForward() },
      { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => tab.reload() },
      { type: 'separator' },
      { label: 'Salvar como...', accelerator: 'CmdOrCtrl+S', click: () => win.command('save-page') },
      { label: 'Imprimir...', accelerator: 'CmdOrCtrl+P', click: () => win.command('print') },
      { label: 'Capturar tela da página', accelerator: 'CmdOrCtrl+Shift+S', click: () => win.command('screenshot') },
    );
    if (/^https?:/.test(tab.url)) {
      items.push({
        label: 'Traduzir para português',
        click: () => win.createTab({ url: `https://translate.google.com/translate?sl=auto&tl=pt&u=${encodeURIComponent(tab.url)}`, opener: tab }),
      });
    }
    items.push({ type: 'separator' });
    if (!tab.url.startsWith('tuff:')) {
      items.push({ label: 'Exibir código-fonte da página', accelerator: 'CmdOrCtrl+U', click: () => win.command('view-source') });
    }
  }

  sep();
  items.push({
    label: 'Inspecionar',
    accelerator: 'CmdOrCtrl+Shift+C',
    click: () => tab.inspectElement(params.x, params.y),
  });
  return Menu.buildFromTemplate(items);
}

function showPageMenu(tab, params) {
  const menu = buildPageMenu(tab, params);
  menu.popup({ window: tab.window.win, frame: params.frame || undefined });
}

module.exports = { showPageMenu, buildPageMenu };
