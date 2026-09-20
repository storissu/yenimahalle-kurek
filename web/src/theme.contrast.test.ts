import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards WCAG AA (4.5:1) for every text/background pairing the UI uses, in both themes.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8'); // tests run from web/

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [m[1] as string, m[2] as string]));
}

const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='dark']"));
const darkBlock = css.slice(css.indexOf(":root[data-theme='dark']"), css.indexOf('@theme inline'));
const light = tokens(lightBlock);
const dark = { ...light, ...tokens(darkBlock) };

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// [text token, background token]
const pairs: Array<[string, string]> = [
  ['fg', 'bg'],
  ['fg', 'surface'],
  ['fg', 'surface-2'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'surface-2'],
  ['primary-fg', 'primary'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['primary', 'primary-soft'],
  ['fg', 'primary-soft'],
  ['success', 'success-soft'],
  ['warning', 'warning-soft'],
  ['danger', 'danger-soft'],
  ['danger', 'surface'],
  ['primary-fg', 'danger'],
  // boat accents: text on white, text on their own tint, and normal text on the tint
  ...[1, 2, 3, 4, 5, 6].flatMap((n): Array<[string, string]> => [
    [`boat-${n}`, 'surface'],
    [`boat-${n}`, `boat-${n}-soft`],
    ['fg', `boat-${n}-soft`],
  ]),
];

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme contrast', (_name, theme) => {
  it.each(pairs)('%s on %s is at least 4.5:1', (text, background) => {
    const fg = theme[text];
    const bg = theme[background];
    expect(fg, `missing token --${text}`).toBeDefined();
    expect(bg, `missing token --${background}`).toBeDefined();
    expect(contrast(fg as string, bg as string)).toBeGreaterThanOrEqual(4.5);
  });
});
