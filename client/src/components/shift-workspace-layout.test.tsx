import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { LegacyShiftRedirect } from '@/components/legacy-shift-redirect';
import ShiftWorkspaceLayout from '@/components/shift-workspace-layout';

const sections = [
  { label: 'Мотивация', path: '/admin/shift/motivation' },
  { label: 'Отчеты', path: '/admin/shift/reports' },
  { label: 'Касса', path: '/admin/shift/cash' },
];

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

afterEach(() => cleanup());

describe('ShiftWorkspaceLayout', () => {
  it.each(sections)('keeps all top links visible and marks $label active', (section) => {
    render(
      <MemoryRouter initialEntries={[section.path]}>
        <Routes>
          <Route path="/admin/shift" element={<ShiftWorkspaceLayout />}>
            <Route path="motivation" element={<div>motivation content</div>} />
            <Route path="reports" element={<div>reports content</div>} />
            <Route path="cash" element={<div>cash content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Разделы смены' })).toHaveClass(
      'grid-cols-3',
    );
    for (const item of sections) {
      const link = screen.getByRole('link', { name: item.label });
      expect(link).toHaveAttribute('href', item.path);
      if (item.path === section.path) {
        expect(link).toHaveAttribute('aria-current', 'page');
      } else {
        expect(link).not.toHaveAttribute('aria-current');
      }
    }
  });

  it.each([
    ['/admin/motivation', '/admin/shift/motivation'],
    ['/admin/shift-reports', '/admin/shift/reports'],
    ['/admin/shift-cash', '/admin/shift/cash'],
  ])('redirects legacy %s to %s once', (legacyPath, canonicalPath) => {
    render(
      <MemoryRouter initialEntries={[legacyPath]}>
        <Routes>
          <Route
            path={legacyPath}
            element={<LegacyShiftRedirect to={canonicalPath} />}
          />
          <Route path={canonicalPath} element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('location')).toHaveTextContent(canonicalPath);
  });
});
