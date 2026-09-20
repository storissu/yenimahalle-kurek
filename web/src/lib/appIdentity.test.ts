import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tr } from '@/strings/tr';

// The name under the icon on the phone's home screen is "YSK" (Android reads the manifest, iOS the apple-mobile-web-app-title
// meta tag). These files are plain text, so this keeps them — and the name used inside the app — in step.
const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('app name ("YSK") and icon', () => {
  const html = read('index.html');
  const viteConfig = read('vite.config.ts');

  it('is the home-screen label on Android (manifest) ...', () => {
    expect(viteConfig).toMatch(/\bname:\s*'YSK'/);
    expect(viteConfig).toMatch(/\bshort_name:\s*'YSK'/);
  });

  it('... and on iOS (Add to Home Screen), plus the browser tab and notifications', () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="YSK" />');
    expect(html).toContain('<meta name="application-name" content="YSK" />');
    expect(html).toContain('<title>YSK</title>');
    expect(tr.app.name).toBe('YSK');
  });

  it('never calls the app "Kürek" on the home screen any more', () => {
    expect(html).not.toMatch(/apple-mobile-web-app-title" content="Kürek"/);
    expect(viteConfig).not.toMatch(/short_name:\s*'Kürek'/);
  });

  it('has an icon whose background matches the one used for the maskable / Apple icons', () => {
    const background = /const BACKGROUND = '(#[0-9a-fA-F]{6})'/.exec(read('pwa-assets.config.ts'))?.[1];
    const svg = read('public/icon.svg');
    expect(svg).toContain('aria-label="YSK"');
    expect(svg).toContain(`<rect width="512" height="512" fill="${background}"/>`);
  });
});
