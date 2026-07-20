import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OperatorLogoShortcut,
} from './operator-logo-shortcut';

describe('OperatorLogoShortcut', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/login?token=crm-token&returnUrl=%2Fadmin');
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  it('navigates only after the tenth consecutive activation to the exact destination', () => {
    const navigate = vi.fn();
    render(<OperatorLogoShortcut navigate={navigate} />);
    const logo = screen.getByRole('button', { name: 'Setly' });

    for (let index = 0; index < 9; index += 1) fireEvent.click(logo);
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(logo);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('https://ops.setly.tech');
    expect(navigate.mock.calls[0][0]).not.toContain('token');
    expect(navigate.mock.calls[0][0]).not.toContain('returnUrl');
  });

  it('resets after inactivity and after unmount', () => {
    const navigate = vi.fn();
    const view = render(<OperatorLogoShortcut navigate={navigate} />);
    const logo = screen.getByRole('button', { name: 'Setly' });
    for (let index = 0; index < 9; index += 1) fireEvent.click(logo);

    act(() => vi.advanceTimersByTime(1_500));
    fireEvent.click(logo);
    expect(navigate).not.toHaveBeenCalled();

    view.unmount();
    act(() => vi.runOnlyPendingTimers());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps only activations inside the five-second rolling window', () => {
    const navigate = vi.fn();
    render(<OperatorLogoShortcut navigate={navigate} />);
    const logo = screen.getByRole('button', { name: 'Setly' });
    for (let index = 0; index < 9; index += 1) {
      fireEvent.click(logo);
      if (index < 8) act(() => vi.advanceTimersByTime(500));
    }
    act(() => vi.advanceTimersByTime(1_100));
    fireEvent.click(logo);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('supports native keyboard activation', async () => {
    const navigate = vi.fn();
    vi.useRealTimers();
    const view = render(<OperatorLogoShortcut navigate={navigate} />);
    try {
      const user = userEvent.setup();
      const logo = screen.getByRole('button', { name: 'Setly' });
      logo.focus();
      await user.keyboard('{Enter>10/}');
      expect(navigate).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      vi.useFakeTimers();
    }
  });

  it('supports native click semantics used by mobile taps', () => {
    const navigate = vi.fn();
    render(<OperatorLogoShortcut navigate={navigate} />);
    const logo = screen.getByRole('button', { name: 'Setly' });

    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(logo, { detail: 1, pointerType: 'touch' });
    }

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('looks non-interactive on hover', () => {
    render(<OperatorLogoShortcut navigate={vi.fn()} />);
    const logo = screen.getByRole('button', { name: 'Setly' });

    expect(window.getComputedStyle(logo).cursor).toBe('default');
    expect(logo).not.toHaveAttribute('title');
    expect(logo.className).not.toMatch(
      /hover:|cursor-pointer|transition|animate|scale|opacity|underline/u,
    );
  });
});
