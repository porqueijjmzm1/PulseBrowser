'use strict';
// Permissões de sites (câmera, microfone, localização, notificações...).
const { dialog, desktopCapturer, webContents: WebContents, BrowserWindow } = require('electron');
const ctx = require('./context');

const ALWAYS_ALLOW = new Set([
  'fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'speaker-selection',
  'storage-access', 'top-level-storage-access', 'background-sync', 'persistent-storage', 'screen-wake-lock',
  'automatic-fullscreen', 'midi', 'background-fetch', 'periodic-background-sync', 'local-fonts', 'web-printing',
]);

const ASKABLE = new Set([
  'camera', 'microphone', 'camera+microphone', 'geolocation', 'notifications', 'clipboard-read',
  'midiSysex', 'idle-detection', 'window-management', 'openExternal', 'hid', 'serial', 'usb', 'sensors',
]);

const LABELS = {
  camera: 'Usar sua câmera',
  microphone: 'Usar seu microfone',
  'camera+microphone': 'Usar sua câmera e seu microfone',
  geolocation: 'Saber sua localização',
  notifications: 'Mostrar notificações',
  'clipboard-read': 'Ver textos e imagens copiados',
  midiSysex: 'Controlar e reprogramar dispositivos MIDI',
  'idle-detection': 'Saber quando você está usando o dispositivo',
  'window-management': 'Gerenciar janelas em todas as suas telas',
  openExternal: 'Abrir um aplicativo externo',
  hid: 'Conectar a um dispositivo HID',
  serial: 'Conectar a uma porta serial',
  usb: 'Conectar a um dispositivo USB',
  sensors: 'Usar sensores de movimento',
};

function originOf(url) {
  try {
    const u = new URL(url);
    return u.origin === 'null' ? `${u.protocol}//${u.host}` : u.origin;
  } catch {
    return '';
  }
}

function permissionKey(permission, details) {
  if (permission === 'media') {
    const types = details?.mediaTypes || [];
    const v = types.includes('video');
    const a = types.includes('audio');
    if (v && a) return 'camera+microphone';
    if (v) return 'camera';
    return 'microphone';
  }
  if (permission === 'geolocation-approximate') return 'geolocation';
  return permission;
}

function getStored(origin, key) {
  const perms = ctx.settings.get('sitePermissions')[origin];
  if (!perms) return null;
  if (key === 'camera+microphone') {
    if (perms.camera === 'deny' || perms.microphone === 'deny') return 'deny';
    if (perms.camera === 'allow' && perms.microphone === 'allow') return 'allow';
    return null;
  }
  return perms[key] || null;
}

function setStored(origin, key, value) {
  const all = { ...ctx.settings.get('sitePermissions') };
  const perms = { ...(all[origin] || {}) };
  const keys = key === 'camera+microphone' ? ['camera', 'microphone'] : [key];
  for (const k of keys) {
    if (value === 'ask' || value == null) delete perms[k];
    else perms[k] = value;
  }
  if (Object.keys(perms).length) all[origin] = perms;
  else delete all[origin];
  ctx.settings.set('sitePermissions', all);
}

function findPulseWindow(wc) {
  if (!wc) return null;
  return ctx.windows.find((w) => w.ownsWebContents(wc)) || null;
}

function attach(ses) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = details?.requestingUrl || wc?.getURL() || '';
    if (url.startsWith('tuff:')) return callback(true);
    if (ALWAYS_ALLOW.has(permission)) return callback(true);
    const key = permissionKey(permission, details);
    if (!ASKABLE.has(key)) return callback(permission !== 'unknown');
    const origin = originOf(url);
    const stored = getStored(origin, key);
    if (stored) return callback(stored === 'allow');

    const pw = findPulseWindow(wc);
    if (pw) {
      pw.promptPermission({
        origin,
        key,
        label: LABELS[key] || key,
        externalURL: details?.externalURL,
        callback: (allow, remember) => {
          if (remember) setStored(origin, key, allow ? 'allow' : 'deny');
          callback(allow);
        },
      });
      return;
    }
    // Janelas pop-up sem a interface do navegador: usa um diálogo nativo.
    const parent = BrowserWindow.fromWebContents(wc);
    const opts = {
      type: 'question',
      buttons: ['Permitir', 'Bloquear'],
      defaultId: 1,
      cancelId: 1,
      title: 'Permissão',
      message: `${origin} quer: ${LABELS[key] || key}`,
    };
    (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)).then(({ response }) => {
      setStored(origin, key, response === 0 ? 'allow' : 'deny');
      callback(response === 0);
    });
  });

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if ((requestingOrigin || '').startsWith('tuff:')) return true;
    if (ALWAYS_ALLOW.has(permission)) return true;
    let key = permission;
    if (permission === 'media') key = details?.mediaType === 'video' ? 'camera' : 'microphone';
    if (!ASKABLE.has(key)) return permission !== 'unknown';
    const origin = originOf(requestingOrigin || details?.requestingUrl || '');
    return getStored(origin, key) === 'allow';
  });

  // Compartilhamento de tela (getDisplayMedia).
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: false,
      });
      const wc = request.frame ? WebContents.fromFrame(request.frame) : null;
      const pw = findPulseWindow(wc);
      if (!pw || !sources.length) return callback(null);
      pw.promptScreenShare({
        origin: originOf(request.securityOrigin || request.frame?.url || ''),
        audio: request.audioRequested && process.platform === 'win32',
        sources: sources.map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() })),
        callback: (sourceId, withAudio) => {
          const source = sources.find((s) => s.id === sourceId);
          if (!source) return callback(null);
          callback(withAudio ? { video: source, audio: 'loopback' } : { video: source });
        },
      });
    } catch (err) {
      console.error('[permissions] captura de tela', err);
      callback(null);
    }
  }, { useSystemPicker: true });
}

function sitePermissions(origin) {
  const perms = ctx.settings.get('sitePermissions')[origin] || {};
  return Object.entries(perms).map(([key, value]) => ({ key, value, label: LABELS[key] || key }));
}

module.exports = { attach, originOf, setStored, getStored, sitePermissions, LABELS };
