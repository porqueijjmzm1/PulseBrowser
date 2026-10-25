(async () => {
  const $ = (s) => document.querySelector(s);
  const DEFAULTS = { speed: 1, step: 0.1, overlay: true, keys: true, skip: 10 };
  const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
  let cfg = { ...DEFAULTS, ...((await tuff.storage.get('cfg')) || {}) };
  const round = (n) => Math.round(n * 100) / 100;
  const label = (n) => `${String(round(n)).replace('.', ',')}×`;

  $('#presets').innerHTML = PRESETS.map((p) => `<button data-v="${p}">${label(p)}</button>`).join('');

  function render() {
    $('#speed').textContent = label(cfg.speed);
    document.querySelectorAll('#presets button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === cfg.speed));
    for (const k of ['step', 'skip']) document.querySelectorAll(`#${k} button`).forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === cfg[k]));
    $('#overlay').checked = !!cfg.overlay;
    $('#keys').checked = !!cfg.keys;
    $('#skip-label').textContent = `Pular ${cfg.skip} s`;
  }
  async function save() {
    render();
    await tuff.storage.set('cfg', cfg);
    tuff.action.setBadge(cfg.speed === 1 ? '' : String(round(cfg.speed)).slice(0, 4), '#ff5a5f');
  }
  const setSpeed = (n) => {
    cfg.speed = Math.min(16, Math.max(0.1, round(n)));
    save();
  };

  $('#minus').addEventListener('click', () => setSpeed(cfg.speed - cfg.step));
  $('#plus').addEventListener('click', () => setSpeed(cfg.speed + cfg.step));
  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setSpeed(Number(b.dataset.v));
  });
  for (const k of ['step', 'skip']) {
    $(`#${k}`).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      cfg[k] = Number(b.dataset.v);
      save();
    });
  }
  $('#overlay').addEventListener('change', (e) => {
    cfg.overlay = e.target.checked;
    save();
  });
  $('#keys').addEventListener('change', (e) => {
    cfg.keys = e.target.checked;
    save();
  });
  // Os mesmos atalhos funcionam com o pop-up aberto.
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 's' || k === 'arrowdown' || k === '-') setSpeed(cfg.speed - cfg.step);
    else if (k === 'd' || k === 'arrowup' || k === '+' || k === '=') setSpeed(cfg.speed + cfg.step);
    else if (k === 'r') setSpeed(1);
  });
  tuff.storage.onChanged((c) => {
    if ('cfg' in c && c.cfg) {
      cfg = { ...DEFAULTS, ...c.cfg };
      render();
    }
  });
  render();
})();
