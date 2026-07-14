import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VisitKeyControl } from '@/components/visit-key-control';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('VisitKeyControl', () => {
  it('opens with the current number, accepts digits only and disables unchanged save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<VisitKeyControl keyNumber="17" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: /изменить номер ключа/i }));

    const input = screen.getByRole('textbox', { name: /новый номер ключа/i });
    expect(input).toHaveValue('17');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();

    await user.clear(input);
    await user.type(input, 'abc204');
    expect(input).toHaveValue('204');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.getByText('Выдан №17')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps the saved number and edit mode when save fails', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('API unavailable'));
    render(<VisitKeyControl keyNumber="17" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: /изменить номер ключа/i }));
    const input = screen.getByRole('textbox', { name: /новый номер ключа/i });
    await user.clear(input);
    await user.type(input, '204');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('204'));
    expect(screen.getByText('Текущий номер: №17')).toBeInTheDocument();
    expect(input).toHaveValue('204');
  });

  it('shows the corrected value immediately after a successful save', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [keyNumber, setKeyNumber] = useState('17');
      return (
        <VisitKeyControl
          keyNumber={keyNumber}
          onSave={async (nextKeyNumber) => setKeyNumber(nextKeyNumber)}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /изменить номер ключа/i }));
    const input = screen.getByRole('textbox', { name: /новый номер ключа/i });
    await user.clear(input);
    await user.type(input, '204');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByText('Выдан №204')).toBeInTheDocument(),
    );
  });
});
