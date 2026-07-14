import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ShiftCashCloseDialog,
  ShiftCashPanel,
} from '@/components/shift-cash-panel';
import type { ShiftCashSummary } from '@/api/shift-cash';

Element.prototype.scrollIntoView = vi.fn();

const mocks = vi.hoisted(() => ({
  cancelExpense: vi.fn(),
  createExpense: vi.fn(),
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
    fetchShiftCashAttachmentBlobUrl: vi.fn(),
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
  useAuth: () => ({ account: { id: 7, role: 'admin' } }),
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
    expenseCategories: [
      {
        group: 'OPEX',
        id: 9,
        name: 'Хозяйственные расходы с очень длинным названием',
        parentId: null,
        type: 'expense',
      },
    ],
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
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

describe('ShiftCashPanel', () => {
  it('shows a stable loading skeleton and then an empty cash state', async () => {
    let resolve!: (value: ShiftCashSummary) => void;
    mocks.getActive.mockReturnValueOnce(
      new Promise<ShiftCashSummary>((promiseResolve) => {
        resolve = promiseResolve;
      }),
    );

    render(<ShiftCashPanel activeShiftId={12} />);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);

    resolve(makeSummary({ opening: false }));
    expect(await screen.findByText('Остаток на начало смены')).toBeInTheDocument();
    expect(screen.getByText('Сначала зафиксируйте остаток на начало смены.')).toBeInTheDocument();
    expect(screen.getByText('Расходов из кассы пока нет.')).toBeInTheDocument();
  });

  it('renders a local retry state when cash loading fails', async () => {
    mocks.getActive.mockRejectedValueOnce(new Error('Касса временно недоступна'));
    render(<ShiftCashPanel activeShiftId={12} />);

    expect(await screen.findByText('Касса смены не загрузилась')).toBeInTheDocument();
    expect(screen.getByText('Касса временно недоступна')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /повторить/i })).toBeInTheDocument();
  });

  it('keeps an existing opening balance read-only after the initial load', async () => {
    mocks.getActive.mockResolvedValueOnce(makeSummary());
    render(<ShiftCashPanel activeShiftId={12} />);

    expect(await screen.findByText('Зафиксировал')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Зафиксировать остаток' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeInTheDocument();
  });

  it('records opening banknotes and coins', async () => {
    mocks.getActive.mockResolvedValueOnce(makeSummary({ opening: false }));
    mocks.saveOpening.mockResolvedValueOnce(makeSummary());
    render(<ShiftCashPanel activeShiftId={12} />);

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
      categoryId: 9,
      categoryName: 'Хозяйственные расходы с очень длинным названием',
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
    render(<ShiftCashPanel activeShiftId={12} />);

    fireEvent.change(await screen.findByLabelText('Сумма, ₽'), {
      target: { value: '900' },
    });
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(
      await screen.findByRole('option', {
        name: 'Хозяйственные расходы с очень длинным названием',
      }),
    );
    fireEvent.change(screen.getByLabelText('Описание'), {
      target: { value: 'Сборка подставки на ресепшене' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить расход' }));

    await waitFor(() =>
      expect(mocks.createExpense).toHaveBeenCalledWith({
        amount: 900,
        categoryId: 9,
        description: 'Сборка подставки на ресепшене',
      }),
    );
    expect(await screen.findByText('Сборка подставки на ресепшене')).toBeInTheDocument();
    expect(screen.getByText('Finance #55')).toBeInTheDocument();
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

    fireEvent.change(await screen.findByLabelText('Фактические купюры, ₽'), {
      target: { value: '45000' },
    });
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
});
