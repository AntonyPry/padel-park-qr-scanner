import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShiftReportsPage, {
  ShiftReportTemplatesSettings,
} from '@/pages/ShiftReportsPage';

const mocks = vi.hoisted(() => ({
  createTemplate: vi.fn(),
  createTemplateItem: vi.fn(),
  deleteTemplate: vi.fn(),
  listReports: vi.fn(),
  listTemplates: vi.fn(),
  updateTemplate: vi.fn(),
  updateTemplateStatus: vi.fn(),
  role: 'admin',
}));

vi.mock('@/api/shift-reports', async () => {
  const actual = await vi.importActual<typeof import('@/api/shift-reports')>(
    '@/api/shift-reports',
  );
  return {
    ...actual,
    createShiftReportTemplate: mocks.createTemplate,
    createShiftReportTemplateItem: mocks.createTemplateItem,
    deleteShiftReportTemplate: mocks.deleteTemplate,
    listShiftReports: mocks.listReports,
    listShiftReportTemplates: mocks.listTemplates,
    updateShiftReportTemplate: mocks.updateTemplate,
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
    items: [
      {
        id: 31,
        itemType: 'checkbox' as const,
        label: 'Проверить ресепшен',
        photoRequired: false,
        sortOrder: 10,
        status: 'active' as const,
        templateId: 3,
      },
    ],
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.role = 'admin';
  mocks.createTemplate.mockReset().mockResolvedValue({
    ...templateFixture(),
    id: 44,
    items: [],
    name: 'Новый отчет смены',
  });
  mocks.createTemplateItem.mockReset().mockResolvedValue({
    ...templateFixture(),
    id: 44,
    name: 'Новый отчет смены',
  });
  mocks.deleteTemplate.mockReset().mockResolvedValue({
    ...templateFixture(),
    archivedAt: '2026-07-17T10:00:00.000Z',
    status: 'archived',
  });
  mocks.listReports.mockReset().mockResolvedValue([reportFixture()]);
  mocks.listTemplates.mockReset().mockResolvedValue([templateFixture()]);
  mocks.updateTemplate.mockReset().mockResolvedValue({
    ...templateFixture(),
    name: 'Контроль вечерней смены',
  });
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
    expect(screen.getByTestId('shift-report-date-filter')).toHaveClass(
      'grid-cols-[48px_minmax(0,1fr)]',
    );
    expect(screen.getByTestId('shift-report-date-filter')).not.toHaveClass('sm:flex');
    expect(screen.getByTestId('shift-report-status-filter')).toHaveClass(
      'grid-cols-[48px_minmax(0,1fr)]',
    );
    expect(screen.getByTestId('shift-report-status-filter')).not.toHaveClass('sm:flex');
    expect(mocks.listTemplates).not.toHaveBeenCalled();
  });

  it('keeps template management in the owner settings view', async () => {
    mocks.role = 'owner';
    render(<ShiftReportTemplatesSettings />);

    const templateTitle = await screen.findByText('Контроль смены');
    expect(templateTitle).toHaveClass('break-words');
    expect(templateTitle).not.toHaveClass('truncate');
    expect(screen.getByRole('button', { name: 'Создать шаблон' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Открыть шаблон «Контроль смены»' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Редактировать' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Архивировать' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Список чеклистов, из которых создаются новые отчеты смены.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Роль:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Тип смены:/)).not.toBeInTheDocument();
    expect(mocks.listTemplates).toHaveBeenCalledWith('all');
    expect(mocks.listReports).not.toHaveBeenCalled();
  });

  it('omits removed scope fields from the create dialog and payload', async () => {
    const user = userEvent.setup();
    mocks.role = 'owner';
    render(<ShiftReportTemplatesSettings />);

    await user.click(await screen.findByRole('button', { name: 'Создать шаблон' }));
    expect(screen.queryByText('Роль сотрудника')).not.toBeInTheDocument();
    expect(screen.queryByText('Тип смены')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Добавить пункт' }));
    await user.type(screen.getByLabelText('Пункт'), 'Проверить зону ожидания');
    await user.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(mocks.createTemplate).toHaveBeenCalledTimes(1));
    const payload = mocks.createTemplate.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: 'Новый отчет смены',
      scheduleConfig: { times: ['09:00'] },
      scheduleType: 'daily_times',
    });
    expect(payload).not.toHaveProperty('appliesToRole');
    expect(payload).not.toHaveProperty('appliesToShiftType');
  });

  it('omits removed scope fields from the edit dialog and payload', async () => {
    const user = userEvent.setup();
    mocks.role = 'manager';
    render(<ShiftReportTemplatesSettings />);

    await user.click(
      await screen.findByRole('button', {
        name: 'Открыть шаблон «Контроль смены»',
      }),
    );
    expect(screen.queryByText('Роль сотрудника')).not.toBeInTheDocument();
    expect(screen.queryByText('Тип смены')).not.toBeInTheDocument();

    const nameInput = screen.getByDisplayValue('Контроль смены');
    await user.clear(nameInput);
    await user.type(nameInput, 'Контроль вечерней смены');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(mocks.updateTemplate).toHaveBeenCalledTimes(1));
    const payload = mocks.updateTemplate.mock.calls[0][1];
    expect(payload).toMatchObject({ name: 'Контроль вечерней смены' });
    expect(payload).not.toHaveProperty('appliesToRole');
    expect(payload).not.toHaveProperty('appliesToShiftType');
  });

  it('opens a template card with the keyboard and keeps lifecycle actions in the dialog', async () => {
    const user = userEvent.setup();
    mocks.role = 'owner';
    render(<ShiftReportTemplatesSettings />);

    const templateCard = await screen.findByRole('button', {
      name: 'Открыть шаблон «Контроль смены»',
    });
    templateCard.focus();
    await user.keyboard('{Enter}');

    expect(
      screen.getByRole('dialog', { name: 'Настройки шаблона' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Архивировать шаблон' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Архивировать' })).not.toBeInTheDocument();
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

    await user.click(
      await screen.findByRole('button', {
        name: 'Открыть шаблон «Контроль смены»',
      }),
    );
    expect(screen.getByDisplayValue('Контроль смены')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Восстановить шаблон' }));
    expect(mocks.updateTemplateStatus).toHaveBeenCalledWith(archived.id, 'active');
    expect(await screen.findByText('Активен')).toBeInTheDocument();
  });

  it('archives an active template from the dialog instead of the card', async () => {
    const user = userEvent.setup();
    mocks.role = 'owner';
    render(<ShiftReportTemplatesSettings />);

    await user.click(
      await screen.findByRole('button', {
        name: 'Открыть шаблон «Контроль смены»',
      }),
    );
    expect(screen.queryByRole('button', { name: 'Архивировать' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Архивировать шаблон' }));

    expect(mocks.deleteTemplate).toHaveBeenCalledWith(templateFixture().id);
    expect(await screen.findByText('В архиве')).toBeInTheDocument();
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
