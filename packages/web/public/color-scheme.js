// Applies the stored light/dark choice before the app renders, so the dark theme never flashes light.
// A separate file because the Content-Security-Policy allows no inline scripts. Mirrors src/color-scheme.ts.
(function () {
  var scheme = null;
  try {
    scheme = localStorage.getItem('sendless.colorScheme');
  } catch (e) {
    // Storage can be unavailable (private mode); follow the system then.
  }
  var dark = scheme === 'dark' || (scheme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
