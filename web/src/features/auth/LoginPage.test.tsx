import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tr } from '@/strings/tr';

const signIn = vi.fn();
vi.mock('./AuthProvider', () => ({ useAuth: () => ({ signIn }) }));

import { LoginPage } from './LoginPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    signIn.mockReset();
    signIn.mockResolvedValue(undefined);
  });

  it('asks for both fields before submitting', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: tr.auth.submit }));
    expect(await screen.findByText(tr.auth.usernameRequired)).toBeInTheDocument();
    expect(screen.getByText(tr.auth.passwordRequired)).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('signs in with the trimmed username and the password', async () => {
    signIn.mockResolvedValue(undefined);
    renderPage();
    await userEvent.type(screen.getByLabelText(tr.auth.username), '  ali  ');
    await userEvent.type(screen.getByLabelText(tr.auth.password), 'Secret123');
    await userEvent.click(screen.getByRole('button', { name: tr.auth.submit }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('ali', 'Secret123'));
  });

  it('shows a Turkish message for wrong credentials', async () => {
    const failure = Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials', status: 400 });
    signIn.mockImplementation(async () => {
      throw failure;
    });
    renderPage();
    await userEvent.type(screen.getByLabelText(tr.auth.username), 'ali');
    await userEvent.type(screen.getByLabelText(tr.auth.password), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: tr.auth.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(tr.auth.invalidCredentials);
  });

  it('can reveal and hide the password', async () => {
    renderPage();
    const field = screen.getByLabelText(tr.auth.password);
    expect(field).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: tr.common.show }));
    expect(field).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: tr.common.hide }));
    expect(field).toHaveAttribute('type', 'password');
  });

  it('links to the privacy notice and explains there is no self-registration', () => {
    renderPage();
    expect(screen.getByRole('link', { name: tr.profile.privacy })).toHaveAttribute('href', '/gizlilik');
    expect(screen.getByText(tr.auth.noAccount)).toBeInTheDocument();
  });
});
