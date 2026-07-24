import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';

const authMocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  completeTwoFactorLogin: vi.fn(),
  login: vi.fn(),
}));

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({
    bootstrap: authMocks.bootstrap,
    completeTwoFactorLogin: authMocks.completeTwoFactorLogin,
    login: authMocks.login,
  }),
}));

describe('ordinary login entry point', () => {
  beforeEach(() => {
    authMocks.bootstrap.mockReset();
    authMocks.completeTwoFactorLogin.mockReset();
    authMocks.login.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/login');
  });

  it('does not reveal the operator URL before the controlled ten-click trigger', () => {
    window.history.replaceState({}, '', '/login');
    render(<LoginPage mode="login" />);

    const brand = screen.getByLabelText('Setly');
    expect(screen.getByRole('button', { name: 'Setly' })).toBe(brand);
    expect(document.querySelector('a[href*="ops.setly.tech"]')).toBeNull();

    for (let index = 0; index < 9; index += 1) {
      fireEvent.click(brand);
      expect(window.location.pathname).toBe('/login');
      expect(document.body.textContent).not.toContain('ops.setly.tech');
    }

    expect(window.location.pathname).toBe('/login');
    expect(window.location.href).not.toContain('ops.setly.tech');
    expect(document.body.textContent).not.toContain('ops.setly.tech');
  });

  it('uses six OTP cells and keeps a separate recovery-code fallback', async () => {
    authMocks.login.mockResolvedValue({
      challengeExpiresAt: '2026-07-24T12:05:00.000Z',
      challengeToken: 'challenge-token',
    });
    render(<LoginPage mode="login" />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'owner@padelpark.demo' },
    });
    fireEvent.change(screen.getByLabelText('Пароль'), {
      target: { value: 'Demo1234!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => {
      expect(screen.getByText('Подтвердите вход'))
        .toBeInTheDocument();
    });
    expect(screen.getAllByLabelText(/^Цифра \d$/u)).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Подтвердить и войти' }))
      .toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Использовать резервный код' }));
    expect(screen.queryByLabelText('Цифра 1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Резервный код')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ввести код из приложения' }))
      .toBeInTheDocument();
  });
});
