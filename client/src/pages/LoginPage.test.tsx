import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({
    bootstrap: vi.fn(),
    login: vi.fn(),
  }),
}));

describe('ordinary login entry point', () => {
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
});
