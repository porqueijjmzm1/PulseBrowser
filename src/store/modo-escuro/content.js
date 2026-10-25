// Modo Escuro: inverte as cores da página e desinverte fotos e vídeos.
// Roda no mundo isolado (o site não enxerga este código) e escuta as mudanças feitas no pop-up.
(() => {
  if (window.top !== window) return;
  const host = location.hostname.replace(/^www\./, '');
  const DEFAULTS = { all: false, smart: true, sites: {}, brightness: 100, contrast: 100, sepia: 0 };
  let cfg = { ...DEFAULTS };
  let pageDark = false;
  let checked = false;
  const style = document.createElement('style');
  style.dataset.tuff = 'modo-escuro';

  const css = (c) => {
    const f = `invert(0.92) hue-rotate(180deg) brightness(${c.brightness / 100}) contrast(${c.contrast / 100}) sepia(${c.sepia / 100})`;
    const back = 'invert(1) hue-rotate(180deg)';
    return `html { filter: ${f} !important; background-color: #fff !important; }
      img, video, picture, canvas, iframe, embed, object, svg image, [style*="background-image"] { filter: ${back} !important; }
      picture img, [style*="background-image"] :is(img, video, picture, canvas, iframe, [style*="background-image"]) { filter: none !important; }
      ::-webkit-scrollbar { background: #eee; }
      ::-webkit-scrollbar-thumb { background: #bbb; border-radius: 6px; border: 2px solid #eee; }`;
  };

  // Se o site já for escuro, o modo "todos os sites" pula ele (opção "Pular sites escuros").
  const luminance = (color) => {
    const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?/.exec(color || '');
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
    const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
      const x = Number(v) / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  function detectDark() {
    if (!document.body) return;
    const was = style.disabled;
    style.disabled = true;
    const lum = luminance(getComputedStyle(document.body).backgroundColor) ?? luminance(getComputedStyle(document.documentElement).backgroundColor);
    style.disabled = was;
    pageDark = lum !== null && lum < 0.2;
    checked = true;
  }

  function active() {
    const site = cfg.sites?.[host];
    if (site === true) return true;
    if (site === false) return false;
    return !!cfg.all && !(cfg.smart && pageDark);
  }

  function apply() {
    const on = active() && !document.fullscreenElement;
    if (on) {
      style.textContent = css(cfg);
      if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
    } else {
      style.remove();
    }
    // O pop-up lê isto para saber o estado da aba.
    document.documentElement.dataset.tuffDark = active() ? 'on' : pageDark ? 'dark-site' : 'off';
  }

  async function load() {
    try {
      cfg = { ...DEFAULTS, ...((await tuff.storage.get('cfg')) || {}) };
    } catch { /* usa o padrão */ }
    apply();
  }

  tuff.storage.onChanged((changes) => {
    if ('cfg' in changes) {
      cfg = { ...DEFAULTS, ...(changes.cfg || {}) };
      apply();
    }
  });
  document.addEventListener('fullscreenchange', apply);
  const ready = () => {
    detectDark();
    // A tag <style> precisa estar por último no <head> para ganhar dos estilos do site.
    if (style.isConnected && document.head && style.parentNode !== document.head) document.head.appendChild(style);
    apply();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
  window.addEventListener('load', () => {
    if (!checked) detectDark();
    if (style.isConnected && document.head) document.head.appendChild(style);
  }, { once: true });
  load();
})();
