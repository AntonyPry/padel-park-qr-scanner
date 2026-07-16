import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ShiftSettingsPage from '@/pages/ShiftSettingsPage';

vi.mock('@/pages/AdminMotivationPage', () => ({
  AdminMotivationSettings: () => <div>motivation settings content</div>,
}));

vi.mock('@/pages/ShiftReportsPage', () => ({
  ShiftReportTemplatesSettings: () => <div>report template settings content</div>,
}));

describe('ShiftSettingsPage', () => {
  it('switches between motivation rules and report templates', async () => {
    const user = userEvent.setup();
    render(<ShiftSettingsPage />);

    expect(screen.getByText('motivation settings content')).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Правила мотивации сотрудников и шаблоны обязательных отчетов.',
      ),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Шаблоны отчетов' }));
    expect(screen.getByText('report template settings content')).toBeInTheDocument();
  });
});
