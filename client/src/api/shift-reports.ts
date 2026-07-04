import { apiFetch, apiRequest } from '@/lib/api';

export type ShiftReportScheduleType =
  | 'once_daily'
  | 'daily_times'
  | 'interval_hours'
  | 'shift_start'
  | 'shift_end';

export type ShiftReportItemType =
  | 'checkbox'
  | 'text'
  | 'number'
  | 'photo'
  | 'checkbox_with_photo';

export type ShiftReportStatus = 'pending' | 'draft' | 'submitted' | 'overdue';
export type ShiftReportTemplateStatus = 'active' | 'archived';

export interface ShiftReportScheduleConfig {
  endTime?: string;
  everyHours?: number | string | null;
  startTime?: string;
  time?: string;
  times?: string[];
}

export interface ShiftReportTemplateItem {
  archivedAt?: string | null;
  helperText?: string | null;
  id: number;
  isRequired: boolean;
  itemType: ShiftReportItemType;
  label: string;
  photoRequired: boolean;
  sortOrder: number;
  status: ShiftReportTemplateStatus;
  templateId: number;
}

export interface ShiftReportTemplate {
  archivedAt?: string | null;
  appliesToRole?: string | null;
  appliesToShiftType?: string | null;
  description?: string | null;
  gracePeriodMinutes: number;
  id: number;
  items: ShiftReportTemplateItem[];
  name: string;
  scheduleConfig: ShiftReportScheduleConfig;
  scheduleType: ShiftReportScheduleType;
  sortOrder: number;
  status: ShiftReportTemplateStatus;
  version: number;
}

export interface ShiftReportAttachment {
  id: string;
  mimeType: string;
  originalName: string;
  size: number;
  uploadedAt: string;
  uploadedByAccountId?: number | null;
  url: string;
}

export interface ShiftReportAnswer {
  attachments: ShiftReportAttachment[];
  booleanValue: boolean | null;
  comment?: string | null;
  id: number;
  isRequired: boolean;
  itemLabel: string;
  itemSnapshot: ShiftReportTemplateItem;
  itemType: ShiftReportItemType;
  numberValue: number | null;
  photoRequired: boolean;
  reportId: number;
  templateItemId?: number | null;
  textValue?: string | null;
}

export interface ShiftReport {
  answers: ShiftReportAnswer[];
  computedStatus: ShiftReportStatus;
  deadlineAt: string;
  id: number;
  itemsSnapshot: ShiftReportTemplateItem[];
  scheduledAt: string;
  scheduledSlotKey: string;
  shift?: {
    Staff?: { id: number; name: string; role?: string | null } | null;
    adminName: string;
    date: string;
    id: number;
    staffId?: number | null;
    status: string;
  };
  shiftId: number;
  status: ShiftReportStatus;
  submittedAt?: string | null;
  submittedBy?: { email?: string | null; id: number; role?: string | null } | null;
  submittedByAccountId?: number | null;
  templateId?: number | null;
  templateSnapshot: ShiftReportTemplate;
  templateVersion: number;
}

export interface ShiftReportSaveAnswer {
  booleanValue?: boolean | null;
  comment?: string | null;
  id: number;
  numberValue?: number | string | null;
  textValue?: string | null;
}

export interface ShiftReportTemplatePayload {
  appliesToRole?: string | null;
  appliesToShiftType?: string | null;
  description?: string | null;
  gracePeriodMinutes?: number | string | null;
  name: string;
  scheduleConfig?: ShiftReportScheduleConfig;
  scheduleType: ShiftReportScheduleType;
  sortOrder?: number | string | null;
  status?: ShiftReportTemplateStatus;
}

export interface ShiftReportTemplateItemPayload {
  helperText?: string | null;
  isRequired?: boolean;
  itemType: ShiftReportItemType;
  label: string;
  photoRequired?: boolean;
  sortOrder?: number | string | null;
  status?: ShiftReportTemplateStatus;
}

export function listShiftReportTemplates(status: ShiftReportTemplateStatus | 'all' = 'active') {
  const params = new URLSearchParams({ status });
  return apiRequest<ShiftReportTemplate[]>(
    `/api/shift-report-templates?${params.toString()}`,
    {},
    'Не удалось загрузить шаблоны отчетов смены',
  );
}

export function createShiftReportTemplate(payload: ShiftReportTemplatePayload) {
  return apiRequest<ShiftReportTemplate>(
    '/api/shift-report-templates',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Не удалось создать шаблон отчета',
  );
}

export function updateShiftReportTemplate(
  id: number,
  payload: Partial<ShiftReportTemplatePayload>,
) {
  return apiRequest<ShiftReportTemplate>(
    `/api/shift-report-templates/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    'Не удалось обновить шаблон отчета',
  );
}

export function updateShiftReportTemplateStatus(
  id: number,
  status: ShiftReportTemplateStatus,
) {
  const action = status === 'active' ? 'restore' : 'archive';
  return apiRequest<ShiftReportTemplate>(
    `/api/shift-report-templates/${id}/${action}`,
    { method: 'POST' },
    'Не удалось изменить статус шаблона',
  );
}

export function createShiftReportTemplateItem(
  templateId: number,
  payload: ShiftReportTemplateItemPayload,
) {
  return apiRequest<ShiftReportTemplate>(
    `/api/shift-report-templates/${templateId}/items`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Не удалось добавить пункт отчета',
  );
}

export function updateShiftReportTemplateItem(
  itemId: number,
  payload: Partial<ShiftReportTemplateItemPayload>,
) {
  return apiRequest<ShiftReportTemplate>(
    `/api/shift-report-template-items/${itemId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    'Не удалось обновить пункт отчета',
  );
}

export function updateShiftReportTemplateItemStatus(
  itemId: number,
  status: ShiftReportTemplateStatus,
) {
  const action = status === 'active' ? 'restore' : 'archive';
  return apiRequest<ShiftReportTemplate>(
    `/api/shift-report-template-items/${itemId}/${action}`,
    { method: 'POST' },
    'Не удалось изменить статус пункта отчета',
  );
}

export function listActiveShiftReports() {
  return apiRequest<{ reports: ShiftReport[]; shift: ShiftReport['shift'] | null }>(
    '/api/shifts/active/reports',
    {},
    'Не удалось загрузить отчеты активной смены',
  );
}

export function listShiftReports(params: {
  date?: string;
  from?: string;
  shiftId?: number | string | null;
  status?: ShiftReportStatus | 'all';
  templateId?: number | string | null;
  to?: string;
} = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return apiRequest<ShiftReport[]>(
    `/api/shift-reports${suffix}`,
    {},
    'Не удалось загрузить отчеты смен',
  );
}

export function getShiftReport(id: number) {
  return apiRequest<ShiftReport>(
    `/api/shift-reports/${id}`,
    {},
    'Не удалось загрузить отчет смены',
  );
}

export function saveShiftReportDraft(id: number, answers: ShiftReportSaveAnswer[]) {
  return apiRequest<ShiftReport>(
    `/api/shift-reports/${id}/draft`,
    {
      method: 'PUT',
      body: JSON.stringify({ answers }),
    },
    'Не удалось сохранить черновик отчета',
  );
}

export function submitShiftReport(id: number, answers: ShiftReportSaveAnswer[]) {
  return apiRequest<ShiftReport>(
    `/api/shift-reports/${id}/submit`,
    {
      method: 'POST',
      body: JSON.stringify({ answers }),
    },
    'Не удалось сдать отчет смены',
  );
}

export function uploadShiftReportAttachment(
  reportId: number,
  answerId: number,
  payload: { data: string; fileName: string; mimeType: string },
) {
  return apiRequest<ShiftReportAnswer>(
    `/api/shift-reports/${reportId}/answers/${answerId}/attachments`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Не удалось загрузить фото отчета',
  );
}

export function removeShiftReportAttachment(
  reportId: number,
  answerId: number,
  attachmentId: string,
) {
  return apiRequest<ShiftReportAnswer>(
    `/api/shift-reports/${reportId}/answers/${answerId}/attachments/${attachmentId}`,
    { method: 'DELETE' },
    'Не удалось удалить фото отчета',
  );
}

export async function fetchShiftReportAttachmentBlobUrl(url: string) {
  const response = await apiFetch(url);
  if (!response.ok) {
    throw new Error('Не удалось загрузить фото отчета');
  }
  return URL.createObjectURL(await response.blob());
}
