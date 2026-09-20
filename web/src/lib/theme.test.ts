import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, getThemeMode, initTheme, isThemeMode, readThemeMode, resolveTheme, setThemeMode, THEME_COLORS, THEME_STORAGE_KEY } from './theme';

// A phone whose colour setting the test controls (and can change while the app runs).
let systemDark = false;
const changeListeners = new Set<() => void>();
function stubSystem(dark: boolean) {
  systemDark = dark;
  changeListeners.clear();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return systemDark;
    },
    addEventListener: (_type: string, fn: () => void) => changeListeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => changeListeners.delete(fn),
  }));
}
const phoneChangesTo = (dark: boolean) => {
  systemDark = dark;
  changeListeners.forEach((fn) => fn());
};
const attr = () => document.documentElement.getAttribute('data-theme');
const barColour = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="#000000">';
  stubSystem(false);
  setThemeMode('system'); // the module remembers the last choice between tests
  window.localStorage.clear();
});

describe('resolveTheme', () => {
  it('follows the phone for "system" and is absolute otherwise', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('the saved choice', () => {
  it('is "system" until somebody chooses, and for anything unknown', () => {
    expect(readThemeMode()).toBe('system');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readThemeMode()).toBe('system');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readThemeMode()).toBe('dark');
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('purple')).toBe(false);
  });

  it('survives storage that throws (private mode): the app still works and follows the phone', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readThemeMode()).toBe('system');
    expect(() => setThemeMode('dark')).not.toThrow();
    expect(attr()).toBe('dark');
    vi.restoreAllMocks();
  });
});

describe('applying a theme', () => {
  it('puts data-theme on <html> and the matching browser bar colour', () => {
    expect(applyTheme('dark')).toBe('dark');
    expect(attr()).toBe('dark');
    expect(barColour()).toBe(THEME_COLORS.dark);
    expect(applyTheme('light')).toBe('light');
    expect(attr()).toBe('light');
    expect(barColour()).toBe(THEME_COLORS.light);
  });

  it('"system" uses the phone\'s current setting', () => {
    stubSystem(true);
    expect(applyTheme('system')).toBe('dark');
    stubSystem(false);
    expect(applyTheme('system')).toBe('light');
  });

  it('falls back to light when the browser has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(applyTheme('system')).toBe('light');
  });
});

describe('choosing a theme', () => {
  it('applies it at once, remembers it on this device and reports it', () => {
    stubSystem(false);
    setThemeMode('dark');
    expect(attr()).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(getThemeMode()).toBe('dark');
    setThemeMode('light');
    expect(attr()).toBe('light');
  });

  it('an explicit choice ignores the phone; "system" follows it again — also while the app is open', () => {
    stubSystem(true);
    initTheme();
    setThemeMode('light');
    phoneChangesTo(false);
    phoneChangesTo(true);
    expect(attr()).toBe('light'); // the phone going dark does not matter now
    setThemeMode('system');
    expect(attr()).toBe('dark');
    phoneChangesTo(false);
    expect(attr()).toBe('light'); // ... and now it does
  });
});

describe('initTheme (start-up)', () => {
  it('applies the saved choice', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    initTheme();
    expect(attr()).toBe('dark');
    expect(getThemeMode()).toBe('dark');
  });
});

describe('public/theme-init.js (runs before the first paint) stays in step with this module', () => {
  const script = readFileSync(resolve(process.cwd(), 'public/theme-init.js'), 'utf8');

  it('uses the same storage key and browser bar colours', () => {
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
    expect(script).toContain(`'${THEME_COLORS.dark}'`);
    expect(script).toContain(`'${THEME_COLORS.light}'`);
  });

  it.each([
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
    [null, true, 'dark'], // nothing saved: the phone decides
    ['garbage', false, 'light'],
  ] as const)('saved %s + phone dark=%s gives %s, exactly like resolveTheme', (saved, dark, expected) => {
    if (saved) window.localStorage.setItem(THEME_STORAGE_KEY, saved);
    stubSystem(dark);
    document.documentElement.removeAttribute('data-theme');
    new Function(script)();
    expect(attr()).toBe(expected);
    expect(expected).toBe(resolveTheme(isThemeMode(saved) ? saved : 'system', dark));
    expect(barColour()).toBe(THEME_COLORS[expected]);
  });
});
