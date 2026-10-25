'use strict';
// Pop-up do Desktop: troca o papel de parede na hora e abre a edição na nova aba.
(async () => {
  const WALLS = {
    aurora: ['#1a1033', '#ff4fd8', '#7c5cff', '#22d3ee', '#ff9f5a'],
    lagoon: ['#03203a', '#00e0c6', '#2f7bff', '#7cf5ff', '#1b4bff'],
    sunset: ['#2a0f1f', '#ff7a1a', '#ff3d7f', '#ffd23b', '#9b3dff'],
    bloom: ['#e9c9ff', '#ff9fcf', '#a48cff', '#7fdcff', '#ffd38a'],
    forest: ['#06261b', '#2fd38a', '#0f8f6a', '#b4f05a', '#1a6d8f'],
    midnight: ['#05060f', '#2b2dff', '#7b2bff', '#0a84ff', '#1d1d5a'],
    candy: ['#2a0b3d', '#ff5ea8', '#ffb86b', '#5ee7ff', '#c86bff'],
    graphite: ['#17171c', '#55556a', '#2c2c35', '#7a7a8c', '#24242c'],
  };
  const css = ([base, a, b, c, d]) => `radial-gradient(60% 70% at 12% 15%, ${a} 0, transparent 60%), radial-gradient(55% 65% at 88% 12%, ${b} 0, transparent 60%), radial-gradient(60% 70% at 80% 90%, ${c} 0, transparent 60%), radial-gradient(60% 70% at 15% 88%, ${d} 0, transparent 60%), ${base}`;

  let desk = await tuff.storage.get('desktop');
  const box = document.getElementById('walls');
  const draw = () => {
    const cur = desk && desk.wallpaper && desk.wallpaper.kind === 'preset' ? desk.wallpaper.preset : desk ? null : 'aurora';
    box.innerHTML = Object.entries(WALLS).map(([id, c], i) => `<button data-w="${id}" style="--i:${i};background:${css(c)}" class="${cur === id ? 'on' : ''}" title="${id}"></button>`).join('');
  };
  draw();

  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-w]');
    if (!b) return;
    desk = (await tuff.storage.get('desktop')) || desk;
    if (!desk) {
      // Ainda não abriu nenhuma nova aba com o Desktop: guarda só a escolha, o resto vem do padrão.
      await cmd('wallpaper');
      return;
    }
    desk.wallpaper = { ...(desk.wallpaper || {}), kind: 'preset', preset: b.dataset.w };
    desk.rev = Math.random().toString(36).slice(2);
    await tuff.storage.set('desktop', desk);
    draw();
  });

  async function cmd(name) {
    await tuff.storage.set('cmd', { cmd: name, t: Date.now() });
    const tab = await tuff.tabs.active();
    if (!tab || !/^tuff:\/\/newtab/.test(tab.url)) await tuff.tabs.create({ url: 'tuff://newtab/' });
    tuff.popup.close();
  }
  document.querySelector('.actions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) cmd(b.dataset.cmd);
  });
})();
