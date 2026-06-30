import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimatedMetricValue } from '@/components/animated-data';

function normalizeText(value: string | null) {
  return (value ?? '').replace(/[\u00a0\u202f]/g, ' ');
}

function renderMetricValue(value: string) {
  const { container } = render(<AnimatedMetricValue value={value} />);
  return normalizeText(container.textContent);
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: true,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AnimatedMetricValue', () => {
  it('keeps a three-digit Russian decimal comma in currency values', () => {
    expect(renderMetricValue('21 193,455 ₽')).toBe('21 193,455 ₽');
    expect(renderMetricValue('21 193,455 ₽')).not.toBe('21 193 455 ₽');
  });

  it('keeps a Russian decimal comma after grouped millions', () => {
    expect(renderMetricValue('2 212 457,545 ₽')).toBe('2 212 457,545 ₽');
    expect(renderMetricValue('2 212 457,545 ₽')).not.toBe('2 212 457 545 ₽');
  });

  it('keeps whole grouped currency values unchanged', () => {
    expect(renderMetricValue('2 233 651 ₽')).toBe('2 233 651 ₽');
  });

  it('keeps one-digit percentage decimals unchanged', () => {
    expect(renderMetricValue('94,4 %')).toBe('94,4 %');
  });
});
