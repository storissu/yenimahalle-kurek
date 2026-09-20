import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteAccessibility, SkipLink, titleFor } from './RouteAccessibility';

function Pages() {
  const navigate = useNavigate();
  return (
    <>
      <RouteAccessibility />
      <SkipLink />
      <nav>
        <button onClick={() => void navigate('/b')}>git b</button>
        <button onClick={() => void navigate('/a?x=1')}>aynı sayfa</button>
      </nav>
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/a" element={<h1>Sayfa A</h1>} />
          <Route path="/b" element={<h1>Sayfa B</h1>} />
        </Routes>
      </main>
    </>
  );
}

const show = () =>
  render(
    <MemoryRouter initialEntries={['/a']}>
      <Pages />
    </MemoryRouter>,
  );
const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

afterEach(() => {
  document.title = '';
});

describe('titleFor', () => {
  it('uses the heading and the app name, or just the app name', () => {
    expect(titleFor('  Bildirimler ')).toBe('Bildirimler · YSK');
    expect(titleFor('Antrenman\n 21 Eylül')).toBe('Antrenman 21 Eylül · YSK');
    expect(titleFor('')).toBe('YSK');
    expect(titleFor(null)).toBe('YSK');
  });
});

describe('RouteAccessibility', () => {
  it('sets the document title from the page heading on first load without stealing focus', async () => {
    show();
    await nextFrame();
    expect(document.title).toBe('Sayfa A · YSK');
    expect(document.activeElement).toBe(document.body);
  });

  it('on navigation, updates the title and moves focus to the new heading so it is announced', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'git b' }));
    await nextFrame();
    expect(document.title).toBe('Sayfa B · YSK');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sayfa B' }));
  });

  it('does nothing for a change of the query string only', async () => {
    show();
    const before = vi.spyOn(HTMLElement.prototype, 'focus');
    fireEvent.click(screen.getByRole('button', { name: 'aynı sayfa' }));
    await nextFrame();
    expect(before).not.toHaveBeenCalled();
    before.mockRestore();
  });
});

describe('SkipLink', () => {
  it('is the first thing in the tab order and moves focus to the main content', () => {
    show();
    const link = screen.getByRole('link', { name: 'Ana içeriğe geç' });
    fireEvent.click(link);
    expect(document.activeElement).toBe(document.getElementById('main'));
  });
});
