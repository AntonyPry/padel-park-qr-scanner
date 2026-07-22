import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ShiftCashCloseDialog,
  ShiftCashPanel,
} from '@/components/shift-cash-panel';
import type { ShiftCashSummary } from '@/api/shift-cash';

Element.prototype.scrollIntoView = vi.fn();

const mocks = vi.hoisted(() => ({
  authRole: 'manager',
  cancelExpense: vi.fn(),
  createExpense: vi.fn(),
  fetchAttachment: vi.fn(),
  getActive: vi.fn(),
  removeAttachment: vi.fn(),
  saveOpening: vi.fn(),
  uploadAttachment: vi.fn(),
}));

vi.mock('@/api/shift-cash', async () => {
  const actual = await vi.importActual<typeof import('@/api/shift-cash')>(
    '@/api/shift-cash',
  );
  return {
    ...actual,
    cancelShiftCashExpense: mocks.cancelExpense,
    createShiftCashExpense: mocks.createExpense,
    fetchShiftCashAttachmentBlobUrl: mocks.fetchAttachment,
    getActiveShiftCash: mocks.getActive,
    removeShiftCashAttachment: mocks.removeAttachment,
    saveShiftCashOpening: mocks.saveOpening,
    uploadShiftCashAttachment: mocks.uploadAttachment,
  };
});

vi.mock('@/lib/realtime', () => ({
  useRealtimeRefresh: vi.fn(),
}));

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ account: { id: 7, role: mocks.authRole } }),
  useAuthorizationRole: () => mocks.authRole,
}));

function makeSummary({ opening = true, expenses = [] }: {
  opening?: boolean;
  expenses?: ShiftCashSummary['expenses'];
} = {}): ShiftCashSummary {
  return {
    activeExpensesTotal: expenses
      .filter((expense) => expense.status === 'active')
      .reduce((sum, expense) => sum + expense.amount, 0),
    cashSales: 12500,
    expenses,
    expectedClosingCash: opening ? 45450 : 12500,
    manualAdjustments: 0,
    session: opening
      ? {
          id: 3,
          manualAdjustmentsSnapshot: 0,
          openingBanknotes: 33000,
          openingCoins: 850,
          openingComment: 'Мелочь пересчитана',
          openingRecordedAt: '2026-07-14T06:00:00.000Z',
          openingRecordedBy: { id: 7, name: 'Администратор', role: 'admin' },
          openingTotal: 33850,
          shiftId: 12,
          status: 'open',
        }
      : null,
    shift: {
      adminName: 'Администратор',
      date: '2026-07-14',
      id: 12,
      startedAt: '2026-07-14T06:00:00.000Z',
      status: 'active',
    },
  };
}

afterEach(() => {
  cleanup();
  Object.values(mocks).forEach((mock) => {
    if (typeof mock !== 'string') mock.mockReset();
  });
});

beforeEach(() => {
  mocks.authRole = 'manager';
});

describe('ShiftCashPanel', () => {
  it('shows a stable loading skeleton and then an empty cash state', async () => {
    let resolve!: (value: ShiftCashSummary) => void;
    mocks.getActive.mockReturnValueOnce(
      new Promise<ShiftCashSummary>((promiseResolve) => {
        resolve = promiseResolve;
      }),
    );

    render(<ShiftCashPanel />);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);

    resolve(makeSummary({ opening: false }));
    expect(await screen.findByText('Остаток на начало смены')).toBeInTheDocument();
    expect(screen.getByText('Сначала зафиксируйте остаток на начало смены.')).toBeInTheDocument();
    expect(screen.getByText('Расходов из кассы пока нет.')).toBeInTheDocument();
  });

  it('renders a local retry state when cash loading fails', async () => {
    mocks.getActive.mockRejectedValueOnce(new Error('Касса временно недоступна'));
    render(<ShiftCashPanel />);

    expect(await screen.findByText('Касса смены не загрузилась')).toBeInTheDocument();
    expect(screen.getByText('Касса временно недоступна')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /повторить/i })).toBeInTheDocument();
  });

  it('keeps an existing opening balance read-only after the initial load', async () => {
    mocks.getActive.mockResolvedValueOnce(makeSummary());
    render(<ShiftCashPanel />);

    expect(await screen.findByText('Зафиксировал')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Зафиксировать остаток' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeInTheDocument();
  });

  it('omits redundant cash headings and operator explanations', async () => {
    mocks.getActive.mockResolvedValueOnce(makeSummary());
    render(<ShiftCashPanel />);

    expect(await screen.findByText('Ожидаемый остаток')).toBeInTheDocument();
    expect(screen.queryByText('Касса', { exact: true })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Купюры, мелочь, наличная выручка и расходы текущей смены.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'Расход сразу попадет в P&L. Фото чека можно снять камерой телефона.',
      ),
    ).not.toBeInTheDocument();
  });

  it('keeps mobile KPI labels and closing placeholder fully visible', async () => {
    mocks.getActive.mockResolvedValueOnce(makeSummary());
    render(<ShiftCashPanel />);

    const expectedLabel = await screen.findByText('Ожидаемый остаток');
    const factLabel = screen.getByText('Факт / расхождение');
    const closingPlaceholder = screen.getByText('При закрытии');

    [expectedLabel, factLabel, closingPlaceholder].forEach((element) => {
      expect(element).not.toHaveClass('truncate');
      expect(element).toHaveClass('break-words');
    });
    expect(expectedLabel.parentElement).toHaveClass('h-full', 'min-h-24');
    expect(factLabel.parentElement).toHaveClass('h-full', 'min-h-24');
    expect(expectedLabel.parentElement?.parentElement).toHaveClass('auto-rows-fr');
  });

  it('records opening banknotes and coins', async () => {
    mocks.getActive.mockResolvedValueOnce(makeSummary({ opening: false }));
    mocks.saveOpening.mockResolvedValueOnce(makeSummary());
    render(<ShiftCashPanel />);

    fireEvent.change(await screen.findByLabelText('Купюры, ₽'), {
      target: { value: '33000' },
    });
    fireEvent.change(screen.getByLabelText('Мелочь, ₽'), {
      target: { value: '850' },
    });
    fireEvent.change(screen.getByLabelText('Комментарий по мелочи'), {
      target: { value: 'Мелочь пересчитана' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать остаток' }));

    await waitFor(() =>
      expect(mocks.saveOpening).toHaveBeenCalledWith({
        banknotes: 33000,
        coins: 850,
        comment: 'Мелочь пересчитана',
      }),
    );
    expect(await screen.findByText('Зафиксировал')).toBeInTheDocument();
  });

  it('adds an expense and refreshes the expected cash balance', async () => {
    const expense = {
      amount: 900,
      attachments: [],
      createdAt: '2026-07-14T10:00:00.000Z',
      createdBy: { id: 7, name: 'Администратор', role: 'admin' },
      createdByAccountId: 7,
      description: 'Сборка подставки на ресепшене',
      financeId: 55,
      id: 91,
      shiftId: 12,
      spentAt: '2026-07-14T10:00:00.000Z',
      status: 'active' as const,
    };
    mocks.getActive.mockResolvedValueOnce(makeSummary());
    mocks.createExpense.mockResolvedValueOnce({
      ...makeSummary({ expenses: [expense] }),
      activeExpensesTotal: 900,
      createdExpenseId: 91,
      expectedClosingCash: 44550,
    });
    render(<ShiftCashPanel />);

    expect(screen.queryByLabelText('Сумма, ₽')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить расход' }));

    fireEvent.change(screen.getByLabelText('Сумма, ₽'), {
      target: { value: '900' },
    });
    expect(screen.queryByText('Категория')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Описание'), {
      target: { value: 'Сборка подставки на ресепшене' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить расход' }));

    await waitFor(() =>
      expect(mocks.createExpense).toHaveBeenCalledWith({
        amount: 900,
        description: 'Сборка подставки на ресепшене',
      }),
    );
    expect(await screen.findByText('Сборка подставки на ресепшене')).toBeInTheDocument();
    expect(screen.queryByText('Finance #55')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the expense dialog and entered values after a save error', async () => {
    mocks.getActive.mockResolvedValueOnce(makeSummary());
    mocks.createExpense.mockRejectedValueOnce(new Error('P&L недоступен'));
    render(<ShiftCashPanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Добавить расход' }));
    fireEvent.change(screen.getByLabelText('Сумма, ₽'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Описание'), {
      target: { value: 'Покупка воды' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить расход' }));

    await waitFor(() => expect(mocks.createExpense).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Сумма, ₽')).toHaveValue(900);
    expect(screen.getByLabelText('Описание')).toHaveValue('Покупка воды');
  });

  it('opens a multi-photo gallery and navigates without breaking on the card layout', async () => {
    const attachments = [
      {
        id: 'receipt-1',
        mimeType: 'image/png',
        originalName: 'receipt-1.png',
        size: 100,
        uploadedAt: '2026-07-14T10:00:00.000Z',
        url: '/api/receipt-1',
      },
      {
        id: 'receipt-2',
        mimeType: 'image/png',
        originalName: 'receipt-2.png',
        size: 100,
        uploadedAt: '2026-07-14T10:01:00.000Z',
        url: '/api/receipt-2',
      },
    ];
    const expense = {
      amount: 900,
      attachments,
      createdAt: '2026-07-14T10:00:00.000Z',
      createdBy: { id: 7, name: 'Администратор', role: 'admin' },
      createdByAccountId: 7,
      description: 'Фото расхода',
      financeId: 55,
      id: 91,
      shiftId: 12,
      spentAt: '2026-07-14T10:00:00.000Z',
      status: 'active' as const,
    };
    mocks.fetchAttachment.mockResolvedValue('blob:receipt');
    mocks.getActive.mockResolvedValueOnce(makeSummary({ expenses: [expense] }));
    render(<ShiftCashPanel />);

    const firstImage = await screen.findByAltText('receipt-1.png');
    fireEvent.click(firstImage.closest('button')!);
    expect(await screen.findByText('1 из 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }));
    expect(await screen.findByText('2 из 2')).toBeInTheDocument();
  });

  it('requires the shared destructive confirmation before deleting a photo', async () => {
    const attachment = {
      id: 'receipt-1',
      mimeType: 'image/png',
      originalName: 'receipt-1.png',
      size: 100,
      uploadedAt: '2026-07-14T10:00:00.000Z',
      url: '/api/receipt-1',
    };
    const expense = {
      amount: 900,
      attachments: [attachment],
      createdAt: '2026-07-14T10:00:00.000Z',
      createdBy: { id: 7, name: 'Администратор', role: 'admin' },
      createdByAccountId: 7,
      description: 'Фото расхода',
      financeId: 55,
      id: 91,
      shiftId: 12,
      spentAt: '2026-07-14T10:00:00.000Z',
      status: 'active' as const,
    };
    mocks.fetchAttachment.mockResolvedValue('blob:receipt');
    mocks.getActive.mockResolvedValueOnce(makeSummary({ expenses: [expense] }));
    mocks.removeAttachment.mockResolvedValueOnce({ ...expense, attachments: [] });
    render(<ShiftCashPanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить фото чека' }));
    expect(screen.getByText('Удалить фото чека?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить фото' }));

    await waitFor(() =>
      expect(mocks.removeAttachment).toHaveBeenCalledWith(91, 'receipt-1'),
    );
  });
});

describe('ShiftCashCloseDialog', () => {
  it('requires a variance comment before closing the shift', async () => {
    const summary = makeSummary();
    mocks.getActive.mockResolvedValueOnce(summary);
    const onConfirm = vi.fn().mockResolvedValue(true);
    render(
      <ShiftCashCloseDialog
        loading={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        open
      />,
    );

    const banknotes = await screen.findByLabelText('Фактические купюры, ₽');
    expect(screen.queryByText('Расхождение')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Комментарий · обязательно')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Комментарий · необязательно')).not.toBeInTheDocument();

    fireEvent.change(banknotes, {
      target: { value: '45000' },
    });
    expect(screen.queryByText('Расхождение')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Комментарий · обязательно')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Фактическая мелочь, ₽'), {
      target: { value: '400' },
    });
    const submit = screen.getByRole('button', { name: 'Сверить кассу и завершить' });
    expect(submit).toBeDisabled();
    expect(screen.getByText('-50 ₽')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Комментарий · обязательно'), {
      target: { value: 'Недостача передана менеджеру' },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(
        {
          banknotes: 45000,
          coins: 400,
          comment: 'Недостача передана менеджеру',
        },
        summary,
      ),
    );
  });

  it('keeps expected cash and variance hidden from an administrator', async () => {
    mocks.authRole = 'admin';
    const summary = {
      ...makeSummary(),
      cashSales: null,
      expectedClosingCash: null,
      manualAdjustments: null,
    };
    mocks.getActive.mockResolvedValueOnce(summary);
    const onConfirm = vi.fn().mockResolvedValue(true);
    render(
      <ShiftCashCloseDialog
        loading={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        open
      />,
    );

    expect(await screen.findByText('Фактический остаток кассы')).toBeInTheDocument();
    expect(screen.queryByText('Ожидается')).not.toBeInTheDocument();
    expect(screen.queryByText('Наличные продажи')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Фактические купюры, ₽'), {
      target: { value: '45000' },
    });
    fireEvent.change(screen.getByLabelText('Фактическая мелочь, ₽'), {
      target: { value: '400' },
    });
    expect(screen.queryByText('Расхождение')).not.toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Сохранить факт и завершить' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(
      { banknotes: 45000, coins: 400, comment: null },
      summary,
    ));
  });
});
