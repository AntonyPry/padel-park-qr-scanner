const RUSSIAN_NATIONAL_NUMBER = /^[3-9]\d{9}$/u;

export function russianPhoneDigits(value: string) {
  const digits = value.replace(/\D/gu, '');
  const trimmed = value.trim();
  const hasVisiblePrefix = trimmed.startsWith('+7') || /^[78](?:\D|$)/u.test(trimmed);
  if (hasVisiblePrefix || (digits.length > 10 && /^[78]/u.test(digits))) {
    return digits.slice(1, 11);
  }
  return digits.slice(0, 10);
}

export function formatRussianPhone(value: string) {
  const digits = russianPhoneDigits(value);
  if (!digits) return '';

  const area = digits.slice(0, 3);
  const first = digits.slice(3, 6);
  const second = digits.slice(6, 8);
  const third = digits.slice(8, 10);
  let formatted = `+7 (${area}`;
  if (area.length === 3) formatted += ')';
  if (first) formatted += ` ${first}`;
  if (second) formatted += `-${second}`;
  if (third) formatted += `-${third}`;
  return formatted;
}

export function russianPhoneE164(value: string) {
  const digits = russianPhoneDigits(value);
  return RUSSIAN_NATIONAL_NUMBER.test(digits) ? `+7${digits}` : null;
}
