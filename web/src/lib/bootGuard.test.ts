import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// public/boot-guard.js is a plain script that runs before the app: it must never leave a blank screen.
const script = readFileSync(resolve(process.cwd(), 'public/boot-guard.js'), 'utf8');

const reload = vi.fn();
const listeners: Array<[string, EventListener, boolean | undefined]> = [];
let addEventListener: typeof window.addEventListener;

const root = () => document.getElementById('root') as HTMLElement;
const start = () => new Function(script)();
// A failed download fires a non-bubbling "error" on the element itself; the guard sees it through the capture phase.
// (A <link> stands in for the module <script>: same `href`/`src` reading, and it does not try to load anything.)
const scriptFails = (href = 'https://x.test/assets/mountApp-abc.js') => {
  const target = document.createElement('link');
  target.rel = 'x-test';
  target.href = href;
  document.head.appendChild(target);
  target.dispatchEvent(new Event('error'));
  target.remove();
};

beforeEach(() => {
  vi.useFakeTimers();
  reload.mockClear();
  window.sessionStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = '';
  vi.stubGlobal('location', { ...window.location, reload });
  // The guard listens on window for the life of the page: remove its listeners between tests.
  addEventListener = window.addEventListener;
  window.addEventListener = ((type: string, fn: EventListener, options?: boolean) => {
    listeners.push([type, fn, options]);
    addEventListener.call(window, type, fn, options);
  }) as typeof window.addEventListener;
});

afterEach(() => {
  window.addEventListener = addEventListener;
  for (const [type, fn, options] of listeners.splice(0)) window.removeEventListener(type, fn, options);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('public/boot-guard.js', () => {
  it('does nothing while the app mounts in time', () => {
    start();
    root().appendChild(document.createElement('main'));
    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();
    expect(root().textContent).toBe('');
  });

  it('reloads once, quietly, when a script fails and the screen is still blank', () => {
    start();
    scriptFails();
    vi.advanceTimersByTime(2000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('ysk-boot-retry')).toBe('1');
    expect(root().childElementCount).toBe(0);
  });

  it('shows the Turkish fallback with the failed file and a working retry button when the reload was already used', () => {
    window.sessionStorage.setItem('ysk-boot-retry', '1');
    start();
    scriptFails();
    vi.advanceTimersByTime(2000);
    expect(reload).not.toHaveBeenCalled();
    expect(root().querySelector('h1')?.textContent).toBe('Uygulama açılamadı');
    expect(root().querySelector('code')?.textContent).toBe('Yüklenemedi: https://x.test/assets/mountApp-abc.js');
    const button = root().querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('Yeniden dene');
    button.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports a failed dynamic import (unhandled rejection) and follows the saved theme', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    window.sessionStorage.setItem('ysk-boot-retry', '1');
    start();
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new TypeError('Importing a module script failed.') }));
    vi.advanceTimersByTime(2000);
    expect(root().querySelector('code')?.textContent).toBe('Importing a module script failed.');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('gives up waiting after 15 seconds of blank screen even without an error', () => {
    window.sessionStorage.setItem('ysk-boot-retry', '1');
    start();
    vi.advanceTimersByTime(14_999);
    expect(root().childElementCount).toBe(0);
    vi.advanceTimersByTime(1);
    expect(root().querySelector('code')?.textContent).toBe('Sayfa 15 saniyede açılmadı.');
  });

  it('never reloads in a loop when session storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    start();
    scriptFails();
    vi.advanceTimersByTime(2000);
    expect(reload).not.toHaveBeenCalled();
    expect(root().querySelector('h1')).not.toBeNull();
  });

  it('forgets the used reload once the app has mounted, so a later failure gets its retry again', async () => {
    window.sessionStorage.setItem('ysk-boot-retry', '1');
    start();
    root().appendChild(document.createElement('main'));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve(); // MutationObserver callbacks are microtasks
    expect(window.sessionStorage.getItem('ysk-boot-retry')).toBeNull();
  });

  it('leaves a late-arriving app alone: an error while the app is already on screen changes nothing', () => {
    start();
    root().appendChild(document.createElement('main'));
    scriptFails();
    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();
    expect(root().querySelector('h1')).toBeNull();
  });
});
