// Small platform sniffing helpers, only used to tailor install/notification instructions.

export type Platform = 'ios' | 'android' | 'other';

export function detectPlatform(ua: string = navigator.userAgent, maxTouchPoints: number = navigator.maxTouchPoints): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  // iPadOS 13+ reports itself as a Mac but has a touch screen.
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

/** True when running as an installed app (Home Screen icon) rather than in a browser tab. */
export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}
