(function () {
  var A = window.dodi || window.api;
  function onAccent(hex) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.55 ? '#0B1417' : '#FFFFFF';
  }
  function apply(s) {
    if (!s) return;
    var root = document.documentElement;
    var accent = /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : '#3DDBB0';
    root.setAttribute('data-theme', s.theme === 'light' ? 'light' : 'dark');
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--on-accent', onAccent(accent));
  }
  if (A) { A.getSettings().then(apply); A.onSettings(apply); }
})();
