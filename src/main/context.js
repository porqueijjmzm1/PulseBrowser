'use strict';
// Estado global compartilhado entre os módulos do processo principal.
// Preenchido em main.js durante a inicialização.
module.exports = {
  settings: null,
  history: null,
  bookmarks: null,
  downloads: null,
  shield: null,
  windows: [], // PulseWindow[]
  closedTabs: [], // pilha de abas fechadas (janelas normais)
  quitting: false,
  lastFocusedWindow: null,
};
