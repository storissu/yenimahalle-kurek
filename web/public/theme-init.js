// Runs before the first paint (a plain, blocking script: the CSP allows 'self' scripts) so the page never flashes the wrong
// theme. It sets data-theme="light" | "dark" on <html> from the saved choice ("yk-theme": system | light | dark; system =
// the phone's setting) and the browser colour. The app (src/lib/theme.ts) keeps it in sync afterwards; keep both in step.
(function () {
  var saved = null;
  try {
    saved = window.localStorage.getItem('yk-theme');
  } catch (e) {
    /* private mode / blocked storage: follow the phone */
  }
  var prefersDark = false;
  try {
    prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (e) {
    /* no matchMedia: light */
  }
  var dark = saved === 'dark' || (saved !== 'light' && prefersDark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0a1a24' : '#0b6a9c');
})();
