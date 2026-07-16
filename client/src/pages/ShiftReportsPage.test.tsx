import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShiftReportsPage, {
  ShiftReportTemplatesSettings,
} from '@/pages/ShiftReportsPage';

const mocks = vi.hoisted(() => ({
  listReports: vi.fn(),
  listTemplates: vi.fn(),
  updateTemplateStatus: vi.fn(),
  role: 'admin',
}));

vi.mock('@/api/shift-reports', async () => {
  const actual = await vi.importActual<typeof import('@/api/shift-reports')>(
    '@/api/shift-reports',
  );
  return {
    ...actual,
    listShiftReports: mocks.listReports,
    listShiftReportTemplates: mocks.listTemplates,
    updateShiftReportTemplateStatus: mocks.updateTemplateStatus,
  };
});

vi.mock('@/lib/realtime', () => ({
  useRealtimeRefresh: vi.fn(),
}));

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ account: { id: 7, role: mocks.role } }),
}));

function reportFixture() {
  return {
    answers: [],
    computedStatus: 'pending' as const,
    deadlineAt: '2026-07-15T12:00:00.000Z',
    id: 21,
    itemsSnapshot: [],
    scheduledAt: '2026-07-15T11:00:00.000Z',
    scheduledSlotKey: '11:00',
    shift: {
      adminName: 'Администратор',
      date: '2026-07-15',
      id: 12,
      status: 'active',
    },
    shiftId: 12,
    status: 'pending' as const,
    templateSnapshot: {
      description: 'Проверить ресепшен',
      gracePeriodMinutes: 10,
      id: 3,
      items: [],
      name: 'Контроль смены',
      scheduleConfig: { times: ['11:00'] },
      scheduleType: 'daily_times' as const,
      sortOrder: 10,
      status: 'active' as const,
      version: 1,
    },
    templateVersion: 1,
  };
}

function templateFixture() {
  return {
    ...reportFixture().templateSnapshot,
    appliesToRole: 'admin',
    appliesToShiftType: 'day',
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.role = 'admin';
  mocks.listReports.mockReset().mockResolvedValue([reportFixture()]);
  mocks.listTemplates.mockReset().mockResolvedValue([templateFixture()]);
  mocks.updateTemplateStatus.mockReset();
});

afterEach(() => cleanup());

describe('ShiftReportsPage', () => {
  it('lets admin work with reports without template management controls', async () => {
    render(<ShiftReportsPage />);

    const reportTitle = await screen.findByText('Контроль смены');
    expect(reportTitle).toHaveClass('break-words');
    expect(reportTitle).not.toHaveClass('truncate');
    expect(screen.queryByRole('button', { name: 'Обновить' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Шаблоны' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать шаблон' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /июля 2026/ })).toHaveAttribute(
      'data-size',
      'sm',
    );
    expect(screen.getByRole('combobox')).toHaveAttribute('data-size', 'sm');
    expect(screen.getByText('Дата').closest('[data-slot="card"]')).toHaveAttribute(
      'data-size',
      'sm',
    );
    expect(mocks.listTemplates).not.toHaveBeenCalled();
  });

  it('keeps template management in the owner settings view', async () => {
    mocks.role = 'owner';
    render(<ShiftReportTemplatesSettings />);

    const templateTitle = await screen.findByText('Контроль смены');
    expect(templateTitle).toHaveClass('break-words');
    expect(templateTitle).not.toHaveClass('truncate');
    expect(screen.getByRole('button', { name: 'Создать шаблон' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Редактировать' })).toBeInTheDocument();
    expect(screen.getByText('Роль: admin · Тип смены: day')).toBeInTheDocument();
    expect(mocks.listTemplates).toHaveBeenCalledWith('all');
    expect(mocks.listReports).not.toHaveBeenCalled();
  });

  it('restores an archived template from settings', async () => {
    const user = userEvent.setup();
    const archived = { ...templateFixture(), status: 'archived' as const };
    mocks.role = 'manager';
    mocks.listTemplates.mockResolvedValueOnce([archived]);
    mocks.updateTemplateStatus.mockResolvedValueOnce({
      ...archived,
      archivedAt: null,
      status: 'active',
    });
    render(<ShiftReportTemplatesSettings />);

    await user.click(await screen.findByRole('button', { name: 'Восстановить' }));
    expect(mocks.updateTemplateStatus).toHaveBeenCalledWith(archived.id, 'active');
    expect(await screen.findByText('Активен')).toBeInTheDocument();
  });

  it('shows the completed shift text on Reports after closing and allows copying it', async () => {
    window.sessionStorage.setItem(
      'setly:last-completed-shift-report',
      JSON.stringify({
        createdAt: '2026-07-15T12:30:00.000Z',
        shiftId: 12,
        text: 'Отчет по смене\nАдминистратор: Тест',
      }),
    );
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    render(<ShiftReportsPage />);

    expect(await screen.findByText('Отчет по завершенной смене')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('Отчет по смене\nАдминистратор: Тест'),
    );
  });
});
