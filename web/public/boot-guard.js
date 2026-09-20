// Safety net for a blank screen. A plain, blocking script (the CSP allows 'self' scripts) that sits right before the app's
// module script in index.html. If the app has not put anything into #root after a failed script/chunk download (some
// phone networks reset large downloads, e.g. "The network connection was lost") or after 15 seconds, it reloads the page
// once and, if that fails too, shows a Turkish message with a retry button and the raw error, instead of leaving the
// screen blank. It never touches #root once the app has mounted (React clears it anyway if the app arrives late).
// The Turkish texts are duplicated here on purpose: this script cannot import src/strings/tr.ts.
(function () {
  var FLAG = 'ysk-boot-retry'; // sessionStorage: set when the automatic reload has been used
  var WAIT_MS = 15000; // no content by then = something is wrong
  var ERROR_DELAY_MS = 2000; // after an error, give the app a moment before judging
  var TEXT = {
    title: 'Uygulama açılamadı',
    body: "Bağlantınız kesilmiş olabilir. Wi-Fi'den mobil veriye (veya tersine) geçip tekrar deneyin.",
    retry: 'Yeniden dene',
    detail: 'Hata ayrıntısı (sorun sürerse antrenörünüze gösterin):',
    timeout: 'Sayfa 15 saniyede açılmadı.',
  };

  var root = document.getElementById('root');
  if (!root) return;

  var detail = '';
  var shown = false;

  function reloadUsed() {
    try {
      return window.sessionStorage.getItem(FLAG) === '1';
    } catch (e) {
      return true; // storage blocked: behave as if the reload was already used, so we can never loop
    }
  }
  function markReloadUsed() {
    try {
      window.sessionStorage.setItem(FLAG, '1');
    } catch (e) {
      /* see reloadUsed */
    }
  }
  function clearReloadUsed() {
    try {
      window.sessionStorage.removeItem(FLAG);
    } catch (e) {
      /* nothing to clear */
    }
  }

  function isEmpty() {
    return root.childElementCount === 0;
  }

  // The app arrived: forget the used reload so a later failure in this session gets its automatic retry again.
  if (typeof MutationObserver === 'function') {
    var observer = new MutationObserver(function () {
      if (!shown && !isEmpty()) {
        clearReloadUsed();
        observer.disconnect();
      }
    });
    observer.observe(root, { childList: true });
  }

  function render() {
    shown = true;
    var theme = document.documentElement.getAttribute('data-theme');
    document.documentElement.style.colorScheme = theme === 'dark' || theme === 'light' ? theme : 'light dark';

    var box = document.createElement('main');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'box-sizing:border-box;max-width:28rem;min-height:100vh;margin:0 auto;padding:2.5rem 1.25rem;display:flex;flex-direction:column;justify-content:center;gap:1rem;font-family:system-ui,-apple-system,sans-serif;line-height:1.5';

    var title = document.createElement('h1');
    title.textContent = TEXT.title;
    title.style.cssText = 'margin:0;font-size:1.5rem;font-weight:700';

    var body = document.createElement('p');
    body.textContent = TEXT.body;
    body.style.cssText = 'margin:0';

    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = TEXT.retry;
    button.style.cssText = 'align-self:flex-start;min-height:2.75rem;padding:0 1.25rem;border:0;border-radius:0.75rem;background:#0b6a9c;color:#fff;font:inherit;font-weight:600';
    button.addEventListener('click', function () {
      window.location.reload();
    });

    var label = document.createElement('p');
    label.textContent = TEXT.detail;
    label.style.cssText = 'margin:1rem 0 0;font-size:0.875rem';

    var code = document.createElement('code');
    code.textContent = detail || TEXT.timeout;
    code.style.cssText = 'display:block;font-size:0.8125rem;word-break:break-all;white-space:pre-wrap';

    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(button);
    box.appendChild(label);
    box.appendChild(code);
    root.appendChild(box);
  }

  function judge() {
    if (shown || !isEmpty()) return;
    if (reloadUsed()) {
      render();
      return;
    }
    markReloadUsed();
    window.location.reload();
  }

  function remember(text) {
    if (!detail && text) detail = String(text).slice(0, 300);
  }

  // Failed <script>/<link> downloads only fire "error" on the element, so listen in the capture phase.
  window.addEventListener(
    'error',
    function (event) {
      var target = event.target;
      if (target && target !== window && (target.src || target.href)) remember('Yüklenemedi: ' + (target.src || target.href));
      else remember(event.message);
      window.setTimeout(judge, ERROR_DELAY_MS);
    },
    true,
  );
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    remember(reason && reason.message ? reason.message : reason);
    window.setTimeout(judge, ERROR_DELAY_MS);
  });
  window.setTimeout(judge, WAIT_MS);
})();
