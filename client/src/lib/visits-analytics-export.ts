export interface LifecycleSourceFilterState {
  allHidden: boolean;
  sourceKeys?: string[];
}

export interface VisitsExportInput {
  activeTab: string;
  from: string;
  sourceFilter: LifecycleSourceFilterState;
  to: string;
}

export function getVisitsExportRequest(input: VisitsExportInput) {
  const usesSourceFilter = ['cohorts-lifecycle', 'revenue-ltv'].includes(input.activeTab);
  if (usesSourceFilter && input.sourceFilter.allHidden) {
    return { disabled: true, url: null };
  }
  const query = new URLSearchParams({ from: input.from, to: input.to });
  if (usesSourceFilter && input.sourceFilter.sourceKeys?.length) {
    query.set('sources', input.sourceFilter.sourceKeys.join(','));
  }
  return { disabled: false, url: `/api/export/visits?${query}` };
}

export async function requestVisitsExport(
  request: (url: string) => Promise<Response>,
  input: VisitsExportInput,
) {
  const exportRequest = getVisitsExportRequest(input);
  if (exportRequest.disabled || !exportRequest.url) return null;
  return request(exportRequest.url);
}
