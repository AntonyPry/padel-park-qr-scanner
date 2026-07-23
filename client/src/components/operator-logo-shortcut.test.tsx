import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperatorLogoShortcut } from './operator-logo-shortcut';

describe('OperatorLogoShortcut', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps the operator URL hidden through nine clicks and navigates on exactly click ten', () => {
    const navigate = vi.fn();
    render(<OperatorLogoShortcut navigate={navigate} />);
    const logo = screen.getByRole('button', { name: 'Setly' });

    expect(document.body.textContent).not.toContain('ops.setly.tech');
    for (let index = 0; index < 9; index += 1) {
      fireEvent.click(logo);
      expect(navigate).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('ops.setly.tech');
    }

    fireEvent.click(logo);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('https://ops.setly.tech/installation');
  });

  it('exposes a native focusable button for deliberate keyboard activation', () => {
    const navigate = vi.fn();
    render(<OperatorLogoShortcut navigate={navigate} destination="/installation" />);
    const logo = screen.getByRole('button', { name: 'Setly' });
    logo.focus();

    expect(logo).toHaveAttribute('type', 'button');
    expect(document.activeElement).toBe(logo);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('counts native Enter activation once and navigates exactly on activation ten', async () => {
    vi.useRealTimers();
    const navigate = vi.fn();
    render(<OperatorLogoShortcut navigate={navigate} destination="/installation" />);
    const user = userEvent.setup();
    const logo = screen.getByRole('button', { name: 'Setly' });
    logo.focus();

    for (let index = 0; index < 9; index += 1) {
      await user.keyboard('{Enter}');
    }
    expect(navigate).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/installation');

    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('counts native Space activation once and navigates exactly on activation ten', async () => {
    vi.useRealTimers();
    const navigate = vi.fn();
    render(<OperatorLogoShortcut navigate={navigate} destination="/installation" />);
    const user = userEvent.setup();
    const logo = screen.getByRole('button', { name: 'Setly' });
    logo.focus();

    for (let index = 0; index < 9; index += 1) {
      await user.keyboard('[Space]');
    }
    expect(navigate).not.toHaveBeenCalled();

    await user.keyboard('[Space]');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/installation');

    await user.keyboard('[Space]');
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('keeps the covert shortcut visually non-interactive before activation', () => {
    render(<OperatorLogoShortcut navigate={vi.fn()} />);
    const logo = screen.getByRole('button', { name: 'Setly' });

    expect(window.getComputedStyle(logo).cursor).toBe('default');
    expect(logo).not.toHaveAttribute('title');
    expect(logo.className).not.toMatch(
      /hover:|cursor-pointer|transition|animate|scale|opacity|underline/u,
    );
    expect(document.body.textContent).not.toContain('ops.setly.tech');
  });

  it('resets the sequence after inactivity', () => {
    const navigate = vi.fn();
    render(<OperatorLogoShortcut navigate={navigate} />);
    const logo = screen.getByRole('button', { name: 'Setly' });
    for (let index = 0; index < 9; index += 1) fireEvent.click(logo);

    act(() => vi.advanceTimersByTime(1_500));
    fireEvent.click(logo);
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

  it('cleans the delayed reset timer when unmounted and preserves touch clicks', () => {
    const navigate = vi.fn();
    const view = render(<OperatorLogoShortcut navigate={navigate} />);
    const logo = screen.getByRole('button', { name: 'Setly' });
    for (let index = 0; index < 9; index += 1) fireEvent.click(logo);

    view.unmount();
    act(() => vi.runOnlyPendingTimers());
    expect(navigate).not.toHaveBeenCalled();

    render(<OperatorLogoShortcut navigate={navigate} />);
    const touchLogo = screen.getByRole('button', { name: 'Setly' });
    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(touchLogo, { detail: 1, pointerType: 'touch' });
    }
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
