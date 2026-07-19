import { describe, expect, it } from 'vitest';
import {
  formatRussianPhone,
  russianPhoneDigits,
  russianPhoneE164,
} from './russian-phone';

describe('Russian owner phone input', () => {
  it('formats digits with the Russian +7 mask', () => {
    expect(formatRussianPhone('9991234567')).toBe('+7 (999) 123-45-67');
    expect(formatRussianPhone('99912')).toBe('+7 (999) 12');
  });

  it('normalizes pasted numbers that start with 8 or 7', () => {
    expect(russianPhoneDigits('8 (999) 123-45-67')).toBe('9991234567');
    expect(russianPhoneDigits('+7 999 123 45 67')).toBe('9991234567');
    expect(formatRussianPhone('тел. 8 999 123-45-67')).toBe('+7 (999) 123-45-67');
    expect(formatRussianPhone('8 999 123 45')).toBe('+7 (999) 123-45');
  });

  it('returns canonical E.164 only for a complete valid number', () => {
    expect(russianPhoneE164('+7 (999) 123-45-67')).toBe('+79991234567');
    expect(russianPhoneE164('+7 (999) 123-45')).toBeNull();
    expect(russianPhoneE164('+7 (099) 123-45-67')).toBeNull();
  });
});
