import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { OtpCodeInput } from '@/components/otp-code-input';

function OtpHarness() {
  const [value, setValue] = useState('');
  return (
    <>
      <OtpCodeInput
        autoFocus
        idPrefix="test-code"
        onChange={setValue}
        value={value}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe('OtpCodeInput', () => {
  it('accepts only digits and lets a fresh code replace filled cells', async () => {
    const user = userEvent.setup();
    render(<OtpHarness />);
    const cells = screen.getAllByRole('textbox', { name: /Цифра/u });

    await user.keyboard('123456');
    expect(screen.getByTestId('value')).toHaveTextContent('123456');

    await user.click(cells[0]);
    await user.keyboard('A');
    expect(screen.getByTestId('value')).toHaveTextContent('123456');

    await user.click(cells[0]);
    await user.keyboard('9');
    expect(screen.getByTestId('value')).toHaveTextContent('923456');
  });
});
