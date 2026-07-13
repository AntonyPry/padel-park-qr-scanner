import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisitsAnalyticsSegmentSelection } from '@/api/visits-analytics';
import { VisitsAnalyticsSegmentDialog } from './visits-analytics-segment-dialog';

const selection: VisitsAnalyticsSegmentSelection = {
  asOf: '2026-05-31T20:59:59.999Z',
  expectedCount: 3,
  from: '2026-01-01',
  kind: 'lifecycle',
  lifecycleStatus: 'atRisk',
  sourceKeys: ['id:7'],
  to: '2026-05-31',
};

function previewResponse(count = 3) {
  return {
    asOf: '2026-05-31T20:59:59.999Z',
    count,
    description: 'Под риском. Источник VK.',
    filters: { status: 'active', visitsAnalytics: { sourceKeys: ['id:7'] } },
    name: 'Под риском · 2026-05-31',
    origin: 'visits_analytics',
    originMetadata: { algorithmVersion: 'visits_analytics_segment_v1' },
    period: { from: '2026-01-01', to: '2026-05-31' },
    sourceLabels: ['VK'],
    timeZone: 'Europe/Moscow',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VisitsAnalyticsSegmentDialog', () => {
  it('keeps edited form state across a background parent rerender and uses server-owned create', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(previewResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 91, name: 'Моя база' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const view = render(
      <MemoryRouter>
        <VisitsAnalyticsSegmentDialog selection={selection} onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    const nameInput = await screen.findByLabelText('Название базы');
    await user.clear(nameInput);
    await user.type(nameInput, 'Моя база');

    view.rerender(
      <MemoryRouter>
        <VisitsAnalyticsSegmentDialog selection={selection} onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Название базы')).toHaveValue('Моя база');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Создать базу' }));
    await screen.findByText('База создана');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const createRequest = fetchMock.mock.calls[1];
    expect(String(createRequest[0])).toContain('/api/analytics/visits/client-bases');
    const body = JSON.parse(String(createRequest[1]?.body));
    expect(body).toMatchObject({
      name: 'Моя база',
      selection: {
        asOf: selection.asOf,
        from: selection.from,
        kind: selection.kind,
        lifecycleStatus: selection.lifecycleStatus,
        sourceKeys: selection.sourceKeys,
        to: selection.to,
      },
    });
    expect(body.selection).not.toHaveProperty('expectedCount');
    expect(body).not.toHaveProperty('filters');
    expect(body).not.toHaveProperty('origin');
    expect(body).not.toHaveProperty('originMetadata');
  });

  it('does not allow an empty segment to be created', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(previewResponse(0)), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <VisitsAnalyticsSegmentDialog selection={{ ...selection, expectedCount: 0 }} onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    const button = await screen.findByRole('button', { name: 'Пустой сегмент нельзя создать' });
    expect(button).toBeDisabled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('shows a recoverable preview error without exposing create controls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Preview unavailable' }), { status: 503 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <VisitsAnalyticsSegmentDialog selection={selection} onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Preview unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать базу' })).not.toBeInTheDocument();
  });
});
