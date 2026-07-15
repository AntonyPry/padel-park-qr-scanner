import { apiFetch } from '@/lib/api';

export interface ShiftCashAccount {
  email?: string | null;
  id: number;
  name?: string | null;
  role?: string | null;
}

export interface ShiftCashAttachment {
  id: string;
  mimeType: string;
  originalName: string;
  size: number;
  uploadedAt: string;
  uploadedByAccountId?: number | null;
  url: string;
}

export interface ShiftCashCategory {
  group: string;
  id: number;
  name: string;
  parentId?: number | null;
  type: string;
}

export interface ShiftCashExpense {
  amount: number;
  attachments: ShiftCashAttachment[];
  canceledAt?: string | null;
  canceledBy?: ShiftCashAccount | null;
  cancelReason?: string | null;
  category?: ShiftCashCategory | null;
  categoryId?: number | null;
  categoryName: string;
  createdAt: string;
  createdBy?: ShiftCashAccount | null;
  createdByAccountId?: number | null;
  description: string;
  finance?: {
    amount: number;
    category: string;
    date: string;
    id: number;
    type: string;
  } | null;
  financeId?: number | null;
  id: number;
  shiftId: number;
  spentAt: string;
  status: 'active' | 'canceled';
}

export interface ShiftCashSession {
  cashSalesSnapshot?: number | null;
  closingBanknotes?: number | null;
  closingCoins?: number | null;
  closingComment?: string | null;
  closingRecordedAt?: string | null;
  closingRecordedBy?: ShiftCashAccount | null;
  closingTotal?: number | null;
  expectedClosingCash?: number | null;
  expensesSnapshot?: number | null;
  id: number;
  manualAdjustmentsSnapshot: number;
  openingBanknotes?: number | null;
  openingCoins?: number | null;
  openingComment?: string | null;
  openingRecordedAt?: string | null;
  openingRecordedBy?: ShiftCashAccount | null;
  openingTotal?: number | null;
  shiftId: number;
  status: 'open' | 'closed';
  variance?: number | null;
}

export interface ShiftCashSummary {
  activeExpensesTotal: number;
  cashSales: number;
  createdExpenseId?: number;
  expenseCategories: ShiftCashCategory[];
  expenses: ShiftCashExpense[];
  expectedClosingCash: number;
  manualAdjustments: number;
  session: ShiftCashSession | null;
  shift: {
    adminName: string;
    date: string;
    id: number;
    startedAt?: string | null;
    status: string;
  } | null;
}

export interface ShiftCashBalancePayload {
  banknotes: number;
  coins: number;
  comment?: string | null;
}

export interface ShiftCashExpensePayload {
  amount: number;
  categoryId: number;
  description: string;
  spentAt?: string;
}

export interface ShiftCashAttachmentPayload {
  data: string;
  fileName: string;
  mimeType: 'image/gif' | 'image/heic' | 'image/heif' | 'image/jpeg' | 'image/png' | 'image/webp';
}

async function readApiError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || fallback;
  } catch {
    return fallback;
  }
}

async function requestJson<T>(path: string, init: RequestInit | undefined, fallback: string) {
  const response = await apiFetch(path, init);
  if (!response.ok) throw new Error(await readApiError(response, fallback));
  return (await response.json()) as T;
}

export function getActiveShiftCash() {
  return requestJson<ShiftCashSummary>(
    '/api/shifts/active/cash',
    undefined,
    'Не удалось загрузить кассу смены',
  );
}

export function getShiftCash(shiftId: number) {
  return requestJson<ShiftCashSummary>(
    `/api/shifts/${shiftId}/cash`,
    undefined,
    'Не удалось загрузить кассу смены',
  );
}

export function saveShiftCashOpening(payload: ShiftCashBalancePayload) {
  return requestJson<ShiftCashSummary>(
    '/api/shifts/active/cash/opening',
    { body: JSON.stringify(payload), method: 'PUT' },
    'Не удалось сохранить начальный остаток',
  );
}

export function createShiftCashExpense(payload: ShiftCashExpensePayload) {
  return requestJson<ShiftCashSummary>(
    '/api/shifts/active/cash/expenses',
    { body: JSON.stringify(payload), method: 'POST' },
    'Не удалось добавить расход',
  );
}

export function updateShiftCashExpense(
  expenseId: number,
  payload: ShiftCashExpensePayload,
) {
  return requestJson<ShiftCashSummary>(
    `/api/shifts/active/cash/expenses/${expenseId}`,
    { body: JSON.stringify(payload), method: 'PUT' },
    'Не удалось обновить расход',
  );
}

export function cancelShiftCashExpense(expenseId: number, reason: string) {
  return requestJson<ShiftCashSummary>(
    `/api/shifts/active/cash/expenses/${expenseId}/cancel`,
    { body: JSON.stringify({ reason }), method: 'POST' },
    'Не удалось отменить расход',
  );
}

export function uploadShiftCashAttachment(
  expenseId: number,
  payload: ShiftCashAttachmentPayload,
) {
  return requestJson<ShiftCashExpense>(
    `/api/shifts/active/cash/expenses/${expenseId}/attachments`,
    { body: JSON.stringify(payload), method: 'POST' },
    'Не удалось загрузить фото чека',
  );
}

export function removeShiftCashAttachment(expenseId: number, attachmentId: string) {
  return requestJson<ShiftCashExpense>(
    `/api/shifts/active/cash/expenses/${expenseId}/attachments/${attachmentId}`,
    { method: 'DELETE' },
    'Не удалось удалить фото чека',
  );
}

export async function fetchShiftCashAttachmentBlobUrl(url: string) {
  const response = await apiFetch(url);
  if (!response.ok) {
    throw new Error(await readApiError(response, 'Не удалось открыть фото чека'));
  }
  return URL.createObjectURL(await response.blob());
}
