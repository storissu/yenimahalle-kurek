import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { tr } from '@/strings/tr';

const headingOrMain = (): HTMLElement | null => document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('main');

/** "Antrenman 21 Eylül 2026 · Yeni Mahalle Kürek" — the page's own <h1> gives the tab / history / screen-reader title. */
export function titleFor(heading: string | null | undefined): string {
  const text = (heading ?? '').replace(/\s+/g, ' ').trim();
  return text ? `${text} · ${tr.app.name}` : tr.app.name;
}

/**
 * A single-page app never reloads, so screen readers hear nothing when the page changes. On every navigation
 * (pathname change) this component
 *   1. keeps `document.title` equal to the page's <h1> (also when the heading arrives a moment later, after data loads), and
 *   2. moves keyboard/screen-reader focus to that heading, which makes assistive tech announce the new page.
 * The very first load is left alone (the browser already handles it). Search-string and hash changes do nothing.
 */
export function RouteAccessibility() {
  const { pathname } = useLocation();
  const firstLoad = useRef(true);

  useEffect(() => {
    const syncTitle = () => {
      document.title = titleFor(headingOrMain()?.tagName === 'H1' ? headingOrMain()?.textContent : null);
    };
    syncTitle();

    // Headings that depend on loaded data (e.g. a training's date) show up shortly after navigation.
    const main = document.querySelector('main');
    const observer = main ? new MutationObserver(syncTitle) : null;
    observer?.observe(main as Element, { childList: true, subtree: true, characterData: true });
    const stopWatching = window.setTimeout(() => observer?.disconnect(), 3000);

    let frame = 0;
    if (!firstLoad.current) {
      frame = window.requestAnimationFrame(() => {
        const target = headingOrMain();
        if (!target) return;
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      });
    }
    firstLoad.current = false;

    return () => {
      observer?.disconnect();
      window.clearTimeout(stopWatching);
      window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return null;
}

/** First tab stop of every screen: jumps over the header and navigation to the page content. */
export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(event) => {
        event.preventDefault();
        const main = document.getElementById('main');
        main?.focus({ preventScroll: false });
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-3 focus:text-sm focus:font-bold focus:text-primary-fg"
    >
      {tr.a11y.skipToContent}
    </a>
  );
}
