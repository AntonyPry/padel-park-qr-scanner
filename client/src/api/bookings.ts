import { apiRequest } from '@/lib/api';

export type BookingStatus = 'new' | 'confirmed' | 'canceled' | 'arrived' | 'no_show';
export type BookingPaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded';
export type BookingPaymentMethod = 'unknown' | 'cash' | 'cashless' | 'mixed';
export type BookingSource = 'phone' | 'admin' | 'walk_in' | 'other';
export type BookingType =
  | 'game'
  | 'tournament'
  | 'personal_training'
  | 'master_class'
  | 'group_training'
  | 'corporate';
export type BookingDurationMinutes = number;
export type BookingRuleStatus = 'active' | 'archived';
export type BookingCourtType = 'all' | 'padel_double' | 'padel_single' | 'other';

export interface Court {
  id: number;
  isActive: boolean;
  name: string;
  sortOrder: number;
  type: 'padel_double' | 'padel_single' | 'other';
}

export interface BookingResourcePayload {
  isActive?: boolean;
  name: string;
  sortOrder?: number;
  type?: 'padel_double' | 'padel_single' | 'other';
}

export interface BookingClient {
  id: number;
  name: string;
  phone: string;
  status: 'active' | 'archived';
}

export interface BookingResponsibleStaff {
  id: number;
  name: string;
  phone?: string | null;
  position?: string | null;
  status?: 'active' | 'inactive' | 'archived';
}

export interface Booking {
  bookingType: BookingType;
  canceledAt?: string | null;
  cancellationReason?: string | null;
  bookingSeriesId?: number | null;
  client?: BookingClient | null;
  clientName: string;
  clientPhone: string;
  comment?: string | null;
  court?: Court | null;
  courtId: number;
  createdAt: string;
  durationMinutes: number;
  endsAt: string;
  id: number;
  isFirstBooking?: boolean;
  paidAmount: number;
  paymentMethod: BookingPaymentMethod;
  paymentStatus: BookingPaymentStatus;
  price: number;
  responsibleStaff?: BookingResponsibleStaff | null;
  responsibleStaffId?: number | null;
  source: BookingSource;
  startsAt: string;
  status: BookingStatus;
  updatedAt: string;
  userId: number;
}

export interface BookingSeries {
  archiveReason?: string | null;
  archivedAt?: string | null;
  bookingType: BookingType;
  client?: BookingClient | null;
  clientName: string;
  clientPhone: string;
  comment?: string | null;
  court?: Court | null;
  courtId: number;
  createdAt: string;
  durationMinutes: number;
  endsOn: string;
  futureActiveBookingsCount?: number;
  generatedBookingsCount?: number;
  id: number;
  lastGeneratedUntil?: string | null;
  name: string;
  paymentMethod: BookingPaymentMethod;
  paymentStatus: BookingPaymentStatus;
  price?: number | null;
  responsibleStaff?: BookingResponsibleStaff | null;
  responsibleStaffId?: number | null;
  source: BookingSource;
  startTime: string;
  startsOn: string;
  status: BookingRuleStatus;
  updatedAt: string;
  userId: number;
  weekday: number;
}

export interface BookingSeriesOccurrence {
  conflictBooking?: Booking;
  date: string;
  endsAt: string;
  price?: number;
  reason?: string;
  startsAt: string;
  status: 'ok' | 'conflict';
}

export interface BookingSeriesPreview {
  availableCount: number;
  conflictCount: number;
  conflicts: BookingSeriesOccurrence[];
  occurrenceCount: number;
  occurrences: BookingSeriesOccurrence[];
  totalPrice: number;
}

export interface BookingSchedule {
  blocks: CourtBlock[];
  bookings: Booking[];
  courts: Court[];
  date: string;
  stats: {
    activeCount: number;
    canceledCount: number;
    noShowCount: number;
    paidAmount: number;
    plannedAmount: number;
    unpaidAmount: number;
  };
  workingHours: {
    cancellationDeadlineHours: number;
    end: string;
    exception?: BookingScheduleException | null;
    isClosed?: boolean;
    maxDurationMinutes: number;
    minDurationMinutes: number;
    rescheduleDeadlineHours: number;
    start: string;
    stepMinutes: number;
  };
}

export interface BookingSettings {
  cancellationDeadlineHours: number;
  id: number;
  maxDurationMinutes: number;
  minDurationMinutes: number;
  rescheduleDeadlineHours: number;
  slotStepMinutes: number;
  workingHoursEnd: string;
  workingHoursStart: string;
}

export interface BookingPriceRule {
  courtType: BookingCourtType;
  endTime: string;
  id: number;
  name: string;
  pricePerHour: number;
  priority: number;
  startTime: string;
  status: BookingRuleStatus;
  weekdays: number[];
}

export interface CourtBlock {
  court?: Court | null;
  courtId: number;
  endsAt: string;
  id: number;
  reason: string;
  startsAt: string;
  status: BookingRuleStatus;
}

export interface BookingScheduleException {
  date: string;
  id: number;
  isClosed: boolean;
  reason?: string | null;
  status: BookingRuleStatus;
  workingHoursEnd?: string | null;
  workingHoursStart?: string | null;
}

export interface BookingQuote {
  appliedRules: BookingPriceRule[];
  court: Court;
  durationMinutes: number;
  price: number;
  startsAt: string;
}

export interface BookingChangeLog {
  action: 'created' | 'updated' | 'status_changed' | 'canceled' | 'rescheduled';
  actor?: { email: string; id: number; name: string; role: string } | null;
  bookingId: number;
  createdAt: string;
  fromStatus?: string | null;
  id: number;
  reason?: string | null;
  snapshot?: Booking | null;
  toStatus?: string | null;
}

export interface BookingPayload {
  bookingType?: BookingType;
  cancellationReason?: string;
  changeReason?: string;
  client?: {
    name: string;
    note?: string;
    phone: string;
    source?: string;
    sourceId?: number;
  };
  comment?: string;
  courtId: number;
  durationMinutes: BookingDurationMinutes;
  paidAmount?: number;
  paymentMethod?: BookingPaymentMethod;
  paymentStatus?: BookingPaymentStatus;
  price?: number;
  responsibleStaffId?: number | null;
  source?: BookingSource;
  startsAt: string;
  status?: BookingStatus;
  userId?: number;
}

export interface BookingSeriesPayload {
  bookingType?: BookingType;
  client?: {
    name: string;
    note?: string;
    phone: string;
    source?: string;
    sourceId?: number;
  };
  comment?: string;
  courtId: number;
  durationMinutes: BookingDurationMinutes;
  endsOn: string;
  name: string;
  paymentMethod?: BookingPaymentMethod;
  paymentStatus?: BookingPaymentStatus;
  price?: number;
  responsibleStaffId?: number | null;
  source?: BookingSource;
  startTime: string;
  startsOn: string;
  status?: Exclude<BookingStatus, 'canceled'>;
  userId?: number;
  weekday: number;
}

export interface BookingSeriesCreateResult {
  bookings: Booking[];
  preview: BookingSeriesPreview;
  series: BookingSeries;
}

export interface BookingAnalyticsBucket {
  activeCount: number;
  bookedHours: number;
  bookedMinutes: number;
  canceledCount: number;
  capacityHours: number;
  court?: Court;
  date?: string;
  id: number | string;
  label: string;
  occupancyPercent: number;
  paidAmount: number;
  plannedAmount: number;
  totalCount: number;
  unpaidAmount: number;
}

export interface BookingAnalyticsDistribution {
  count: number;
  key: string;
  label: string;
  plannedAmount: number;
}

export interface BookingAnalytics {
  byCourt: BookingAnalyticsBucket[];
  byDate: BookingAnalyticsBucket[];
  byPaymentStatus: BookingAnalyticsDistribution[];
  bySource: BookingAnalyticsDistribution[];
  byStatus: BookingAnalyticsDistribution[];
  range: {
    days: number;
    from: string;
    to: string;
  };
  total: BookingAnalyticsBucket;
}

export interface BookingSettingsPayload {
  cancellationDeadlineHours?: number;
  maxDurationMinutes?: number;
  minDurationMinutes?: number;
  rescheduleDeadlineHours?: number;
  slotStepMinutes?: number;
  workingHoursEnd?: string;
  workingHoursStart?: string;
}

export interface BookingPriceRulePayload {
  courtType?: BookingCourtType;
  endTime?: string;
  name: string;
  pricePerHour: number;
  priority?: number;
  startTime?: string;
  status?: BookingRuleStatus;
  weekdays?: number[];
}

export interface CourtBlockPayload {
  courtId: number;
  endsAt: string;
  reason: string;
  startsAt: string;
  status?: BookingRuleStatus;
}

export interface BookingExceptionPayload {
  date: string;
  isClosed?: boolean;
  reason?: string;
  status?: BookingRuleStatus;
  workingHoursEnd?: string;
  workingHoursStart?: string;
}

export async function getBookingSchedule(date: string) {
  return apiRequest<BookingSchedule>(
    `/api/bookings/schedule?date=${encodeURIComponent(date)}`,
    {},
    'Не удалось получить расписание',
  );
}

export async function listBookingResponsibles() {
  return apiRequest<BookingResponsibleStaff[]>(
    '/api/bookings/responsibles',
    {},
    'Не удалось получить ответственных сотрудников',
  );
}

export async function listBookingResources(status: BookingRuleStatus | 'all' = 'active') {
  return apiRequest<Court[]>(
    `/api/bookings/courts?status=${encodeURIComponent(status)}`,
    {},
    'Не удалось получить колонки бронирования',
  );
}

export async function createBookingResource(payload: BookingResourcePayload) {
  return apiRequest<Court>('/api/bookings/courts', {
    body: JSON.stringify(payload),
    method: 'POST',
  }, 'Не удалось создать колонку бронирования');
}

export async function updateBookingResource(id: number, payload: Partial<BookingResourcePayload>) {
  return apiRequest<Court>(`/api/bookings/courts/${id}`, {
    body: JSON.stringify(payload),
    method: 'PUT',
  }, 'Не удалось обновить колонку бронирования');
}

export async function archiveBookingResource(id: number) {
  return apiRequest<Court>(`/api/bookings/courts/${id}`, {
    method: 'DELETE',
  }, 'Не удалось выключить колонку бронирования');
}

export async function createBooking(payload: BookingPayload) {
  return apiRequest<Booking>('/api/bookings', {
    body: JSON.stringify(payload),
    method: 'POST',
  }, 'Не удалось создать бронь');
}

export async function getBookingSettings() {
  return apiRequest<BookingSettings>('/api/bookings/settings', {}, 'Не удалось получить настройки бронирования');
}

export async function updateBookingSettings(payload: BookingSettingsPayload) {
  return apiRequest<BookingSettings>('/api/bookings/settings', {
    body: JSON.stringify(payload),
    method: 'PUT',
  }, 'Не удалось сохранить настройки бронирования');
}

export async function getBookingQuote(payload: {
  courtId: number;
  durationMinutes: number;
  startsAt: string;
}) {
  const params = new URLSearchParams({
    courtId: String(payload.courtId),
    durationMinutes: String(payload.durationMinutes),
    startsAt: payload.startsAt,
  });
  return apiRequest<BookingQuote>(`/api/bookings/quote?${params.toString()}`, {}, 'Не удалось рассчитать цену брони');
}

export async function listBookingPriceRules(status: BookingRuleStatus | 'all' = 'active') {
  return apiRequest<BookingPriceRule[]>(
    `/api/bookings/price-rules?status=${encodeURIComponent(status)}`,
    {},
    'Не удалось получить тарифы',
  );
}

export async function createBookingPriceRule(payload: BookingPriceRulePayload) {
  return apiRequest<BookingPriceRule>('/api/bookings/price-rules', {
    body: JSON.stringify(payload),
    method: 'POST',
  }, 'Не удалось создать тариф');
}

export async function updateBookingPriceRule(id: number, payload: Partial<BookingPriceRulePayload>) {
  return apiRequest<BookingPriceRule>(`/api/bookings/price-rules/${id}`, {
    body: JSON.stringify(payload),
    method: 'PUT',
  }, 'Не удалось обновить тариф');
}

export async function archiveBookingPriceRule(id: number) {
  return apiRequest<BookingPriceRule>(`/api/bookings/price-rules/${id}`, {
    method: 'DELETE',
  }, 'Не удалось архивировать тариф');
}

export async function listCourtBlocks(date: string, status: BookingRuleStatus | 'all' = 'active') {
  return apiRequest<CourtBlock[]>(
    `/api/bookings/blocks?date=${encodeURIComponent(date)}&status=${encodeURIComponent(status)}`,
    {},
    'Не удалось получить блокировки ресурсов',
  );
}

export async function createCourtBlock(payload: CourtBlockPayload) {
  return apiRequest<CourtBlock>('/api/bookings/blocks', {
    body: JSON.stringify(payload),
    method: 'POST',
  }, 'Не удалось создать блокировку');
}

export async function updateCourtBlock(id: number, payload: Partial<CourtBlockPayload>) {
  return apiRequest<CourtBlock>(`/api/bookings/blocks/${id}`, {
    body: JSON.stringify(payload),
    method: 'PUT',
  }, 'Не удалось обновить блокировку');
}

export async function archiveCourtBlock(id: number) {
  return apiRequest<CourtBlock>(`/api/bookings/blocks/${id}`, {
    method: 'DELETE',
  }, 'Не удалось архивировать блокировку');
}

export async function listBookingExceptions(status: BookingRuleStatus | 'all' = 'active') {
  return apiRequest<BookingScheduleException[]>(
    `/api/bookings/exceptions?status=${encodeURIComponent(status)}`,
    {},
    'Не удалось получить исключения расписания',
  );
}

export async function createBookingException(payload: BookingExceptionPayload) {
  return apiRequest<BookingScheduleException>('/api/bookings/exceptions', {
    body: JSON.stringify(payload),
    method: 'POST',
  }, 'Не удалось создать исключение расписания');
}

export async function updateBookingException(id: number, payload: Partial<BookingExceptionPayload>) {
  return apiRequest<BookingScheduleException>(`/api/bookings/exceptions/${id}`, {
    body: JSON.stringify(payload),
    method: 'PUT',
  }, 'Не удалось обновить исключение расписания');
}

export async function archiveBookingException(id: number) {
  return apiRequest<BookingScheduleException>(`/api/bookings/exceptions/${id}`, {
    method: 'DELETE',
  }, 'Не удалось архивировать исключение');
}

export async function updateBooking(id: number, payload: Partial<BookingPayload>) {
  return apiRequest<Booking>(`/api/bookings/${id}`, {
    body: JSON.stringify(payload),
    method: 'PUT',
  }, 'Не удалось обновить бронь');
}

export async function updateBookingStatus(
  id: number,
  payload: { reason?: string; status: BookingStatus },
) {
  return apiRequest<Booking>(`/api/bookings/${id}/status`, {
    body: JSON.stringify(payload),
    method: 'PATCH',
  }, 'Не удалось изменить статус брони');
}

export async function listBookingHistory(id: number) {
  return apiRequest<BookingChangeLog[]>(
    `/api/bookings/${id}/history`,
    {},
    'Не удалось получить историю брони',
  );
}

export async function listBookingSeries(status: BookingRuleStatus | 'all' = 'active') {
  return apiRequest<BookingSeries[]>(
    `/api/bookings/series?status=${encodeURIComponent(status)}`,
    {},
    'Не удалось получить постоянные брони',
  );
}

export async function previewBookingSeries(payload: BookingSeriesPayload) {
  return apiRequest<BookingSeriesPreview>('/api/bookings/series/preview', {
    body: JSON.stringify(payload),
    method: 'POST',
  }, 'Не удалось проверить постоянную бронь');
}

export async function createBookingSeries(payload: BookingSeriesPayload) {
  return apiRequest<BookingSeriesCreateResult>('/api/bookings/series', {
    body: JSON.stringify(payload),
    method: 'POST',
  }, 'Не удалось создать постоянную бронь');
}

export async function archiveBookingSeries(
  id: number,
  payload: { cancelFuture?: boolean; reason?: string },
) {
  return apiRequest<{ canceledBookingsCount: number; series: BookingSeries }>(
    `/api/bookings/series/${id}/archive`,
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
    'Не удалось архивировать постоянную бронь',
  );
}

export async function getBookingAnalytics(params: { from: string; to: string }) {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  return apiRequest<BookingAnalytics>(
    `/api/bookings/analytics?${query.toString()}`,
    {},
    'Не удалось получить отчет по бронированиям',
  );
}
