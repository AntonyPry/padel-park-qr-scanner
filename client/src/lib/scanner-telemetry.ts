import { apiRequest } from '@/lib/api';

export interface ScannerDiagnosticEventPayload {
  eventType: string;
  severity: 'info' | 'warning' | 'error';
  status?: string;
  message?: string;
  code?: string;
  source: 'web_serial';
  clientEventId: string;
  metadata: Record<string, unknown>;
}

interface ScannerDiagnosticEventResponse {
  status: 'ok' | 'duplicate';
  eventId: number | null;
}

export async function postScannerDiagnosticEvent(
  payload: ScannerDiagnosticEventPayload,
) {
  return apiRequest<ScannerDiagnosticEventResponse>(
    '/api/scanner-events',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Ошибка записи события сканера',
  );
}
