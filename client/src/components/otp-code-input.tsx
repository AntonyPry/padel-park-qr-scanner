import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const OTP_LENGTH = 6;

interface OtpCodeInputProps {
  autoFocus?: boolean;
  className?: string;
  disabled?: boolean;
  idPrefix: string;
  onChange: (value: string) => void;
  value: string;
}

function digitsOnly(value: string) {
  return value.replace(/\D/gu, '').slice(0, OTP_LENGTH);
}

export function OtpCodeInput({
  autoFocus = false,
  className,
  disabled = false,
  idPrefix,
  onChange,
  value,
}: OtpCodeInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = digitsOnly(value);

  const focus = (index: number) => {
    refs.current[Math.max(0, Math.min(index, OTP_LENGTH - 1))]?.focus();
  };

  const setDigit = (index: number, rawValue: string) => {
    const incoming = digitsOnly(rawValue);
    if (rawValue && !incoming) return;
    if (incoming.length > 1) {
      onChange(incoming);
      focus(Math.min(incoming.length, OTP_LENGTH - 1));
      return;
    }
    if (!incoming) {
      onChange(digits.slice(0, index));
      return;
    }
    const next = digits.split('');
    next[index] = incoming;
    onChange(next.join('').slice(0, OTP_LENGTH));
    if (incoming && index < OTP_LENGTH - 1) focus(index + 1);
  };

  return (
    <div
      aria-label="Код подтверждения"
      className={cn('flex gap-2', className)}
      role="group"
    >
      {Array.from({ length: OTP_LENGTH }, (_, index) => (
        <Input
          aria-label={`Цифра ${index + 1}`}
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          autoFocus={autoFocus && index === 0}
          className="size-11 px-0 text-center font-mono text-lg"
          disabled={disabled}
          id={`${idPrefix}-${index + 1}`}
          inputMode="numeric"
          key={index}
          maxLength={1}
          onChange={(event) => setDigit(index, event.target.value)}
          onClick={(event) => event.currentTarget.select()}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (/^\d$/u.test(event.key)) {
              event.preventDefault();
              setDigit(index, event.key);
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault();
              focus(index - 1);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              focus(index + 1);
            } else if (event.key === 'Backspace' && !digits[index] && index > 0) {
              event.preventDefault();
              const next = digits.split('');
              next[index - 1] = '';
              onChange(next.join(''));
              focus(index - 1);
            }
          }}
          onPaste={(event) => {
            const pasted = digitsOnly(event.clipboardData.getData('text'));
            if (!pasted) return;
            event.preventDefault();
            onChange(pasted);
            focus(Math.min(pasted.length, OTP_LENGTH - 1));
          }}
          pattern="[0-9]"
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="text"
          value={digits[index] || ''}
        />
      ))}
    </div>
  );
}

export const OTP_CODE_LENGTH = OTP_LENGTH;
