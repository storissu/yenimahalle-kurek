import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/env';
import { help } from '@/strings/help';
import { tr } from '@/strings/tr';
import { HelpPage } from './HelpPage';

const show = (role: 'member' | 'coach', feedbackUrl?: string) =>
  render(
    <MemoryRouter>
      <HelpPage role={role} {...(feedbackUrl ? { feedbackUrl } : {})} />
    </MemoryRouter>,
  );

describe('HelpPage', () => {
  it('members get the member questions, coaches the coach questions', () => {
    const { unmount } = show('member');
    expect(screen.getByRole('heading', { level: 1, name: help.title })).toBeInTheDocument();
    expect(screen.getByText(help.member[0]!.q)).toBeInTheDocument();
    expect(screen.queryByText(help.coach[0]!.q)).not.toBeInTheDocument();
    unmount();
    show('coach');
    expect(screen.getByText(help.coach[0]!.q)).toBeInTheDocument();
    expect(screen.queryByText(help.member[0]!.q)).not.toBeInTheDocument();
  });

  it('lists every question as a collapsible answer that opens on click', () => {
    show('member');
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(help.member.length);
    const first = items[0] as HTMLElement;
    const details = first.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(within(first).getByText(help.member[0]!.q));
    details.open = true; // happy-dom does not toggle <details> on summary clicks
    expect(within(first).getByText(help.member[0]!.a)).toBeInTheDocument();
  });

  it('shows the feedback button only when an address is configured, opening safely in a new tab', () => {
    const { unmount } = show('member');
    expect(screen.queryByRole('link', { name: help.feedbackAction })).not.toBeInTheDocument();
    expect(screen.getByText(help.feedbackNone)).toBeInTheDocument();
    unmount();
    show('member', 'https://wa.me/905550000000');
    const link = screen.getByRole('link', { name: help.feedbackAction });
    expect(link).toHaveAttribute('href', 'https://wa.me/905550000000');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('has a way back that fits the role', () => {
    const { unmount } = show('member');
    expect(screen.getByRole('link', { name: new RegExp(tr.profile.title) })).toHaveAttribute('href', '/uye/profil');
    unmount();
    show('coach');
    expect(screen.getByRole('link', { name: new RegExp(tr.more.title) })).toHaveAttribute('href', '/antrenor/diger');
  });
});

describe('VITE_FEEDBACK_URL', () => {
  const base = { VITE_SUPABASE_URL: 'https://abcdefghij.supabase.co', VITE_SUPABASE_ANON_KEY: 'a'.repeat(40) };

  it('is optional, and accepts only https addresses (WhatsApp links, forms)', () => {
    expect(parseEnv(base).ok).toBe(true);
    expect(parseEnv({ ...base, VITE_FEEDBACK_URL: '' }).ok).toBe(true);
    expect(parseEnv({ ...base, VITE_FEEDBACK_URL: 'https://wa.me/905550000000' }).ok).toBe(true);
    expect(parseEnv({ ...base, VITE_FEEDBACK_URL: 'http://example.com/form' }).ok).toBe(false);
    expect(parseEnv({ ...base, VITE_FEEDBACK_URL: 'javascript:alert(1)' }).ok).toBe(false);
    expect(parseEnv({ ...base, VITE_FEEDBACK_URL: 'wa.me/905550000000' }).ok).toBe(false);
  });
});

describe('help texts stay true to the app', () => {
  /** Every string value in the Turkish catalog (functions skipped). */
  const catalog = (value: unknown, out: string[] = []): string[] => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => catalog(v, out));
    else if (value && typeof value === 'object') Object.values(value).forEach((v) => catalog(v, out));
    return out;
  };
  const uiStrings = catalog(tr).map((s) => s.toLocaleLowerCase('tr'));
  // Quoted phrases that are examples or wording, not names of buttons or labels.
  const NOT_LABELS = new Set(["9'dan sonraya yazın", 'siz']);

  it('every quoted button/label name exists in the app, so a renamed button cannot leave the help wrong', () => {
    const missing: string[] = [];
    for (const item of [...help.member, ...help.coach]) {
      for (const match of item.a.matchAll(/"([^"]+)"/g)) {
        const label = (match[1] as string).toLocaleLowerCase('tr');
        if (NOT_LABELS.has(label)) continue;
        if (!uiStrings.some((s) => s.includes(label))) missing.push(`${item.q} → "${match[1]}"`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('has no empty questions or answers and no duplicates', () => {
    for (const list of [help.member, help.coach]) {
      expect(new Set(list.map((i) => i.q)).size).toBe(list.length);
      for (const item of list) {
        expect(item.q.trim().length).toBeGreaterThan(5);
        expect(item.a.trim().length).toBeGreaterThan(20);
      }
    }
  });
});
