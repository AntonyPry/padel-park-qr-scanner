import { describe, expect, it, vi } from 'vitest';
import { getVisitsExportRequest, requestVisitsExport } from './visits-analytics-export';

describe('visits analytics export', () => {
  it('disables all-hidden lifecycle export and never sends a request', async () => {
    const input = {
      activeTab: 'cohorts-lifecycle',
      from: '2026-01-01',
      sourceFilter: { allHidden: true, sourceKeys: undefined },
      to: '2026-07-31',
    };
    expect(getVisitsExportRequest(input)).toEqual({ disabled: true, url: null });
    const request = vi.fn(async () => new Response());
    expect(await requestVisitsExport(request, input)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('disables all-hidden revenue export and applies revenue source keys', async () => {
    const hidden = {
      activeTab: 'revenue-ltv',
      from: '2026-01-01',
      sourceFilter: { allHidden: true, sourceKeys: undefined },
      to: '2026-07-31',
    };
    const request = vi.fn(async () => new Response());
    expect(await requestVisitsExport(request, hidden)).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(getVisitsExportRequest({
      ...hidden,
      sourceFilter: { allHidden: false, sourceKeys: ['id:7'] },
    }).url).toContain('sources=id%3A7');
  });
});
