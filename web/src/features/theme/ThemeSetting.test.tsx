import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { setThemeMode } from '@/lib/theme';
import { tr } from '@/strings/tr';
import { ThemeSetting } from './ThemeSetting';

const option = (label: string) => screen.getByRole('radio', { name: label });

beforeEach(() => {
  window.localStorage.clear();
  setThemeMode('system');
});

describe('ThemeSetting ("Görünüm")', () => {
  it('offers Sistem, Açık and Koyu as one radio group, with the current choice selected', () => {
    render(<ThemeSetting />);
    expect(screen.getByRole('radiogroup', { name: tr.theme.title })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([tr.theme.system, tr.theme.light, tr.theme.dark]);
    expect(option(tr.theme.system)).toHaveAttribute('aria-checked', 'true');
    expect(option(tr.theme.dark)).toHaveAttribute('aria-checked', 'false');
  });

  it('applies a choice at once, marks it, and remembers it', () => {
    render(<ThemeSetting />);
    fireEvent.click(option(tr.theme.dark));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(option(tr.theme.dark)).toHaveAttribute('aria-checked', 'true');
    expect(option(tr.theme.system)).toHaveAttribute('aria-checked', 'false');
    expect(window.localStorage.getItem('yk-theme')).toBe('dark');
    fireEvent.click(option(tr.theme.light));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('only the selected option is in the tab order, and the arrow keys move the choice', () => {
    render(<ThemeSetting />);
    expect(option(tr.theme.system)).toHaveAttribute('tabindex', '0');
    expect(option(tr.theme.light)).toHaveAttribute('tabindex', '-1');
    option(tr.theme.system).focus();
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(option(tr.theme.light)).toHaveAttribute('aria-checked', 'true');
  });
});
