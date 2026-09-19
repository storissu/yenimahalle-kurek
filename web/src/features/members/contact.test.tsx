import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { tr } from '@/strings/tr';
import { telHref } from './contact';
import { ContactDialog } from './ContactDialog';

describe('telHref', () => {
  it('keeps digits only, so the phone can dial whatever formatting was typed', () => {
    expect(telHref('0555 123 45 67')).toBe('tel:05551234567');
    expect(telHref('(0555) 123-45-67')).toBe('tel:05551234567');
  });

  it('keeps a leading plus for international numbers', () => {
    expect(telHref('+90 555 123 45 67')).toBe('tel:+905551234567');
    expect(telHref('0090+555')).toBe('tel:0090555'); // a plus in the middle is not dialable
  });

  it('gives no link when there is nothing to dial', () => {
    expect(telHref(null)).toBeNull();
    expect(telHref(undefined)).toBeNull();
    expect(telHref('')).toBeNull();
    expect(telHref('  -  ')).toBeNull();
  });
});

describe('ContactDialog', () => {
  it('shows the name and a call link with the number', () => {
    render(<ContactDialog contact={{ name: 'Ahmet Kaya', phone: '0555 111 22 33' }} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Ahmet Kaya' })).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'tel:05551112233');
    expect(link).toHaveTextContent('0555 111 22 33');
    expect(link).toHaveTextContent(tr.contact.call);
  });

  it('says so when no number is saved, with nothing to call', () => {
    render(<ContactDialog contact={{ name: 'Ahmet Kaya', phone: null }} onClose={vi.fn()} />);
    expect(screen.getByText(tr.contact.noPhone)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders nothing while closed and can be closed', () => {
    const onClose = vi.fn();
    const { rerender } = render(<ContactDialog contact={null} onClose={onClose} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    rerender(<ContactDialog contact={{ name: 'Ahmet Kaya', phone: null }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: tr.common.close }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ContactDialog profile link', () => {
  it("links to the member's profile when their id is known, and closes the card on the way", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <ContactDialog contact={{ id: 'm-1', name: 'Ahmet Kaya', phone: null }} onClose={onClose} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: tr.contact.openProfileLabel('Ahmet Kaya') });
    expect(link).toHaveAttribute('href', '/uye/uyeler/m-1');
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows no profile link without an id', () => {
    render(<ContactDialog contact={{ name: 'Ahmet Kaya', phone: '0555 111 22 33' }} onClose={vi.fn()} />);
    expect(screen.queryByText(tr.contact.openProfile)).not.toBeInTheDocument();
  });
});
