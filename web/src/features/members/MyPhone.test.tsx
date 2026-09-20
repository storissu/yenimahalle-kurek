import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tr } from '@/strings/tr';

const state = { phone: '0532 111 22 33' as string | null };
const refreshProfile = vi.fn(async () => undefined);
const show = vi.fn();
const updateMyPhone = vi.fn(async (_phone: string) => undefined);

vi.mock('../auth/AuthProvider', () => ({
  useProfile: () => ({ id: 'me', phone: state.phone }),
  useAuth: () => ({ refreshProfile }),
}));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ show }) }));
vi.mock('./api', () => ({ updateMyPhone: (phone: string) => updateMyPhone(phone), memberNamesKey: ['member-directory'], membersKey: ['members'] }));

import { MyPhone } from './MyPhone';

const renderIt = () => render(<QueryClientProvider client={new QueryClient()}><MyPhone /></QueryClientProvider>);
const openEditor = () => fireEvent.click(screen.getByRole('button', { name: tr.profile.editPhone }));
const field = () => screen.getByLabelText(tr.members.phone) as HTMLInputElement;

beforeEach(() => {
  state.phone = '0532 111 22 33';
  refreshProfile.mockClear();
  show.mockClear();
  updateMyPhone.mockClear();
  updateMyPhone.mockResolvedValue(undefined);
});

describe('MyPhone (on the member\'s own profile)', () => {
  it('shows the number, or says there is none', () => {
    const { unmount } = renderIt();
    expect(screen.getByText('0532 111 22 33')).toBeInTheDocument();
    unmount();
    state.phone = null;
    renderIt();
    expect(screen.getByText(tr.profile.phoneEmpty)).toBeInTheDocument();
  });

  it('opens an editor with the current number and a hint that other members can see it', () => {
    renderIt();
    openEditor();
    expect(field().value).toBe('0532 111 22 33');
    expect(screen.getByText(tr.members.phoneHint)).toBeInTheDocument();
  });

  it('keeps "Kaydet" off until the number really changed, and off for something that is not a phone number', () => {
    renderIt();
    openEditor();
    const save = screen.getByRole('button', { name: tr.common.save });
    expect(save).toBeDisabled(); // unchanged
    fireEvent.change(field(), { target: { value: 'ara beni' } });
    expect(save).toBeDisabled();
    expect(screen.getByText(tr.profile.phoneInvalid)).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: '0'.repeat(31) } });
    expect(screen.getByText(tr.members.phoneTooLong)).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: '0533 999 88 77' } });
    expect(save).toBeEnabled();
  });

  it('saves the new number, refreshes the profile, tells the person, and closes the editor', async () => {
    renderIt();
    openEditor();
    fireEvent.change(field(), { target: { value: '0533 999 88 77' } });
    fireEvent.click(screen.getByRole('button', { name: tr.common.save }));
    await waitFor(() => expect(show).toHaveBeenCalledWith(tr.members.phoneSaved, 'success'));
    expect(updateMyPhone).toHaveBeenCalledWith('0533 999 88 77');
    expect(refreshProfile).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(tr.members.phone)).not.toBeInTheDocument(); // back to the display
  });

  it('lets somebody remove their number by emptying the field', async () => {
    renderIt();
    openEditor();
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: tr.common.save }));
    await waitFor(() => expect(updateMyPhone).toHaveBeenCalledWith(''));
  });

  it('shows the server\'s refusal in the editor and stays open', async () => {
    updateMyPhone.mockRejectedValue(new Error('Geçerli bir telefon numarası yazın'));
    renderIt();
    openEditor();
    fireEvent.change(field(), { target: { value: '0533 999 88 77' } });
    fireEvent.click(screen.getByRole('button', { name: tr.common.save }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(show).not.toHaveBeenCalled();
    expect(field()).toBeInTheDocument();
  });

  it('cancelling changes nothing', () => {
    renderIt();
    openEditor();
    fireEvent.change(field(), { target: { value: '0533 999 88 77' } });
    fireEvent.click(screen.getByRole('button', { name: tr.common.cancel }));
    expect(updateMyPhone).not.toHaveBeenCalled();
    expect(screen.getByText('0532 111 22 33')).toBeInTheDocument();
  });
});
