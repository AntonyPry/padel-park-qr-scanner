import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
