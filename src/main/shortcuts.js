'use strict';
// Atalhos de teclado do navegador (capturados em todas as webContents da janela).
const isMac = process.platform === 'darwin';

// Retorna { cmd, arg } ou null.
function match(input) {
  if (input.type !== 'keyDown') return null;
  const ctrl = isMac ? input.meta : input.control;
  const { shift, alt } = input;
  const key = (input.key || '').toLowerCase();
  const code = input.code || '';

  if (ctrl && !alt) {
    if (/^Digit[1-9]$/.test(code) || /^Numpad[1-9]$/.test(code)) {
      const n = Number(code.slice(-1));
      return n === 9 ? { cmd: 'select-last-tab' } : { cmd: 'select-tab', arg: n - 1 };
    }
    if (shift) {
      switch (key) {
        case 'n': return { cmd: 'new-incognito' };
        case 't': return { cmd: 'reopen-closed' };
        case 'w': return { cmd: 'close-window' };
        case 'tab': return { cmd: 'prev-tab' };
        case 'r': return { cmd: 'hard-reload' };
        case 'b': return { cmd: 'toggle-bookmarks-bar' };
        case 'o': return { cmd: 'bookmarks' };
        case 'i': return { cmd: 'devtools' };
        case 'j': return { cmd: 'devtools' };
        case 'c': return { cmd: 'devtools-inspect' };
        case 'delete': return { cmd: 'clear-data' };
        case 'g': return { cmd: 'find-prev' };
        case 's': return { cmd: 'screenshot' };
        case '+': case '=': return { cmd: 'zoom-in' };
        case '_': case '-': return { cmd: 'zoom-out' };
        default: break;
      }
      return null;
    }
    switch (key) {
      case 't': return { cmd: 'new-tab' };
      case 'n': return { cmd: 'new-window' };
      case 'w': case 'f4': return { cmd: 'close-tab' };
      case 'tab': case 'pagedown': return { cmd: 'next-tab' };
      case 'pageup': return { cmd: 'prev-tab' };
      case 'r': return { cmd: 'reload' };
      case 'f5': return { cmd: 'hard-reload' };
      case 'l': case 'k': case 'e': return { cmd: 'focus-omnibox' };
      case 'f': return { cmd: 'find' };
      case 'g': return { cmd: 'find-next' };
      case '=': case '+': case 'add': return { cmd: 'zoom-in' };
      case '-': case 'subtract': return { cmd: 'zoom-out' };
      case '0': return code === 'Digit0' || code === 'Numpad0' ? { cmd: 'zoom-reset' } : null;
      case 'u': return { cmd: 'view-source' };
      case 'p': return { cmd: 'print' };
      case 's': return { cmd: 'save-page' };
      case 'd': return { cmd: 'bookmark-page' };
      case 'h': return { cmd: 'history' };
      case 'j': return { cmd: 'downloads' };
      case 'q': return isMac ? { cmd: 'quit' } : null;
      default: break;
    }
    return null;
  }

  if (alt && !ctrl) {
    switch (key) {
      case 'arrowleft': return { cmd: 'back' };
      case 'arrowright': return { cmd: 'forward' };
      case 'home': return { cmd: 'home' };
      case 'd': return { cmd: 'focus-omnibox' };
      case 'f4': return isMac ? null : { cmd: 'close-window' };
      default: return null;
    }
  }

  if (!ctrl && !alt) {
    switch (key) {
      case 'f5': return shift ? { cmd: 'hard-reload' } : { cmd: 'reload' };
      case 'f6': return { cmd: 'focus-omnibox' };
      case 'f3': return shift ? { cmd: 'find-prev' } : { cmd: 'find-next' };
      case 'f11': return { cmd: 'fullscreen' };
      case 'f12': return { cmd: 'devtools' };
      case 'browserback': return { cmd: 'back' };
      case 'browserforward': return { cmd: 'forward' };
      case 'browserrefresh': return { cmd: 'reload' };
      case 'browserhome': return { cmd: 'home' };
      default: return null;
    }
  }
  return null;
}

module.exports = { match };
