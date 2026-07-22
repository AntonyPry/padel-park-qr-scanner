import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientProfileDialog } from '@/components/client-profile-dialog';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  fetchReferences: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, apiFetch: mocks.apiFetch };
});

vi.mock('@/lib/references', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/references')>();
  return { ...actual, fetchReferences: mocks.fetchReferences };
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function clientDetails(note = 'Предпочитает вечернее время') {
  return {
    activeCallTasks: [
      {
        assignedTo: { name: 'Мария Менеджер' },
        clientBase: { name: 'Вернуть постоянных клиентов' },
        deadlineAt: '2026-07-24T10:00:00.000Z',
        id: 3,
        status: 'callback',
        summary: 'Перезвонить после работы',
        title: 'Уточнить продление',
      },
    ],
    bookingSeries: [
      {
        court: { id: 1, name: 'Корт №1' },
        durationMinutes: 60,
        endsOn: '2026-09-30',
        id: 5,
        name: 'Каждый вторник',
        price: 3000,
        startTime: '19:00',
        startsOn: '2026-07-01',
        status: 'active',
        weekday: 2,
      },
    ],
    bookingStats: {
      activeCount: 4,
      canceledCount: 1,
      nextBookingAt: '2026-07-28T16:00:00.000Z',
      paidAmount: 3000,
      plannedAmount: 6000,
      totalCount: 5,
      upcomingCount: 2,
    },
    bookings: [
      {
        comment: 'Окно у корта',
        court: { id: 1, name: 'Корт №1' },
        durationMinutes: 60,
        id: 11,
        paidAmount: 3000,
        paymentMethod: 'cashless',
        paymentStatus: 'paid',
        price: 3000,
        startsAt: '2026-07-28T16:00:00.000Z',
        status: 'new',
      },
    ],
    client: {
      birthDate: '1991-02-03',
      createdAt: '2025-01-10T09:00:00.000Z',
      id: 42,
      name: 'Егор Смирнов',
      note,
      phone: '+7 (999) 555-02-77',
      segment: 'Постоянный',
      source: 'Рекомендация',
      sourceId: 7,
      stats: {
        firstVisitAt: '2025-01-12T10:00:00.000Z',
        lastVisitAt: '2026-07-21T15:00:00.000Z',
        visitCount: 18,
      },
      status: 'active',
      statusLabel: 'Активный',
      telegramId: 'egor_sm',
      training: { latestLevel: 'C+' },
    },
    clientCertificates: [
      {
        amountRemaining: 2500,
        amountTotal: 5000,
        certificateType: 'money',
        code: 'CERT-2026-001',
        expiresAt: '2026-12-31',
        id: 8,
        saleAmount: 5000,
        startsAt: '2026-07-01',
        status: 'active',
        title: 'Подарочный сертификат',
      },
    ],
    clientSubscriptions: [
      {
        expiresAt: '2026-09-01',
        id: 7,
        isUnlimited: false,
        remainingSessions: 6,
        saleAmount: 12000,
        sessionsTotal: 10,
        sessionsUsed: 4,
        startsAt: '2026-07-01',
        status: 'active',
        typeName: '10 персональных тренировок',
      },
    ],
    duplicateCandidates: [{ id: 99 }],
    timeline: [
      {
        actor: { name: 'Анна Администратор' },
        description: 'Выдан ключ №27',
        id: 'visit:91',
        occurredAt: '2026-07-21T15:00:00.000Z',
        title: 'Вход клиента',
        type: 'visit',
      },
    ],
    visits: [
      {
        categories: [{ id: 2, name: 'Тренировка' }],
        id: 91,
        keyNumber: '27',
        scannedAt: '2026-07-21T15:00:00.000Z',
      },
    ],
  };
}

beforeEach(() => {
  mocks.apiFetch.mockReset().mockResolvedValue(jsonResponse(clientDetails()));
  mocks.fetchReferences.mockReset().mockResolvedValue([
    { id: 7, name: 'Рекомендация', status: 'active' },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ClientProfileDialog', () => {
  it('shows the full client card from the monitor, including prepayments, bookings and history', async () => {
    const user = userEvent.setup();
    render(<ClientProfileDialog clientId={42} onOpenChange={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Егор Смирнов' })).toBeInTheDocument();
    expect(screen.getByText('Рекомендация')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('Предпочитает вечернее время')).toBeInTheDocument();
    expect(screen.getByText('Уточнить продление')).toBeInTheDocument();
    expect(screen.getByText(/Найдено похожих карточек: 1/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Предоплаты/ }));
    expect(screen.getByText('10 персональных тренировок')).toBeInTheDocument();
    expect(screen.getByText('Подарочный сертификат')).toBeInTheDocument();
    expect(screen.getByText('CERT-2026-001')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Бронирования' }));
    expect(screen.getByText('Каждый вторник')).toBeInTheDocument();
    const bookingsTable = screen.getByRole('table');
    expect(within(bookingsTable).getByText('Корт №1')).toBeInTheDocument();
    expect(within(bookingsTable).getByText('Окно у корта')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'История' }));
    expect(screen.getByText('Вход клиента')).toBeInTheDocument();
    expect(screen.getByText('Выдан ключ №27')).toBeInTheDocument();
    expect(screen.getByText('Тренировка')).toBeInTheDocument();
    expect(screen.getByText('№27')).toBeInTheDocument();
  });

  it('keeps basic editing in the same full card and reloads details after save', async () => {
    const user = userEvent.setup();
    mocks.apiFetch
      .mockResolvedValueOnce(jsonResponse(clientDetails()))
      .mockResolvedValueOnce(jsonResponse(clientDetails('Обновленная заметка')))
      .mockResolvedValueOnce(jsonResponse(clientDetails('Обновленная заметка')));

    render(<ClientProfileDialog clientId={42} onOpenChange={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Егор Смирнов' });
    await user.click(screen.getByRole('button', { name: 'Изменить' }));

    const note = screen.getByLabelText('Заметка');
    await user.clear(note);
    await user.type(note, 'Обновленная заметка');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Обновленная заметка')).toBeInTheDocument();
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(2, '/api/clients/42', {
      body: expect.stringContaining('Обновленная заметка'),
      method: 'PUT',
    });
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(3, '/api/clients/42');
  });
});
