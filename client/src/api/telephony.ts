import { apiRequest } from '@/lib/api';

export type TelephonyCallStatus =
  | 'new'
  | 'ringing'
  | 'answered'
  | 'completed'
  | 'missed'
  | 'failed'
  | 'unknown';
export type TelephonyProcessingStatus =
  | 'new'
  | 'in_progress'
  | 'processed'
  | 'ignored';
export type TelephonyDirection = 'inbound' | 'outbound' | 'unknown';
export type TelephonyTranscriptionStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';
export type TelephonyTranscriptSpeaker = 'administrator' | 'client' | 'unknown';
export type TelephonyResult =
  | 'booked'
  | 'refused'
  | 'thinking'
  | 'callback'
  | 'complaint'
  | 'corporate'
  | 'no_answer'
  | 'other';
export type TelephonyInterest =
  | 'game'
  | 'training'
  | 'tournament'
  | 'master_class'
  | 'corporate'
  | 'other';

export interface TelephonyTranscriptSegment {
  channel?: string | null;
  confidence?: number | null;
  endMs?: number | null;
  id: number;
  sortOrder: number;
  speaker: TelephonyTranscriptSpeaker;
  startMs?: number | null;
  text: string;
}

export interface TelephonyAiTranscriptSegment {
  channel?: string | null;
  changes?: string[];
  confidence?: 'high' | 'medium' | 'low' | number | null;
  editedText?: string | null;
  endMs?: number | null;
  segmentId: string;
  sortOrder: number;
  sourceText?: string | null;
  speaker: TelephonyTranscriptSpeaker;
  startMs?: number | null;
  text: string;
  warnings?: string[];
}

export interface TelephonyTranscriptionQualityWarning {
  code: string;
  count?: number;
  message: string;
  severity?: 'info' | 'warning' | 'error';
}

export interface TelephonyTranscriptionMetadata {
  qualityWarnings?: TelephonyTranscriptionQualityWarning[];
  [key: string]: unknown;
}

export interface TelephonyAiTranscriptionMetadata {
  enabled?: boolean;
  error?: string;
  ignoredUnknownSegmentIds?: string[];
  missingSegmentIds?: string[];
  model?: string;
  provider?: string;
  rejectedSegmentIds?: string[];
  status?: 'completed' | 'disabled' | 'failed' | 'skipped' | string;
  warnings?: string[];
  [key: string]: unknown;
}

export interface TelephonyTranscription {
  attemptCount: number;
  claimedAt?: string | null;
  aiCorrections?: Record<string, unknown>[];
  aiMetadata?: TelephonyAiTranscriptionMetadata | null;
  aiTranscriptSegments?: TelephonyAiTranscriptSegment[];
  aiTranscriptText?: string | null;
  completedAt?: string | null;
  corrections?: Record<string, unknown>[];
  createdAt?: string;
  errorMessage?: string | null;
  failedAt?: string | null;
  id: number;
  language?: string | null;
  metadata?: TelephonyTranscriptionMetadata | null;
  rawTranscriptText?: string | null;
  segments?: TelephonyTranscriptSegment[];
  status: TelephonyTranscriptionStatus;
  telephonyCallId: number;
  transcriptText?: string | null;
  updatedAt?: string;
}

export interface TelephonyTranscriptionJob extends TelephonyTranscription {
  call?: {
    callStatus: TelephonyCallStatus;
    client?: {
      id: number;
      name: string;
      phone: string;
      status: string;
    } | null;
    clientPhone?: string | null;
    direction: TelephonyDirection;
    durationSeconds?: number | null;
    id: number;
    recordingStatus: TelephonyCall['recordingStatus'];
    staff?: {
      id: number;
      name: string;
      role: string;
    } | null;
    startedAt?: string | null;
  } | null;
}

export interface TelephonyCall {
  answeredAt?: string | null;
  callStatus: TelephonyCallStatus;
  client?: {
    id: number;
    name: string;
    phone: string;
    source?: string | null;
    status: string;
  } | null;
  clientPhone?: string | null;
  direction: TelephonyDirection;
  durationSeconds?: number | null;
  endedAt?: string | null;
  followUpCallTask?: {
    dueAt?: string | null;
    id: number;
    status: string;
    title: string;
  } | null;
  id: number;
  interest?: TelephonyInterest | null;
  isNewClient?: boolean;
  nextActionAt?: string | null;
  nextActionText?: string | null;
  processedAt?: string | null;
  processedByAccount?: {
    id: number;
    name: string;
    role: string;
  } | null;
  processingStatus: TelephonyProcessingStatus;
  recordingStatus: 'unknown' | 'pending' | 'available' | 'missing';
  recordingExpiresAt?: string | null;
  recordingFileSize?: number | null;
  recordingFileType?: string | null;
  recordingSyncedAt?: string | null;
  recordingUrl?: string | null;
  result?: TelephonyResult | null;
  staff?: {
    id: number;
    name: string;
    role: string;
  } | null;
  startedAt?: string | null;
  summary?: string | null;
  transcription?: TelephonyTranscription | null;
}

export interface TelephonyListResponse {
  items: TelephonyCall[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TelephonyTranscriptionJobsResponse {
  items: TelephonyTranscriptionJob[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TelephonyTranscriptionStats {
  generatedAt: string;
  totals: Record<TelephonyTranscriptionStatus | 'total', number>;
}

export interface TelephonyStats {
  active: number;
  ignored: number;
  missed: number;
  processed: number;
  recordingsAvailable: number;
  total: number;
  unknownClients: number;
}

export interface TelephonyReportBucket {
  count: number;
  key: string;
  label: string;
}

export interface TelephonyReportOperator {
  account?: {
    id: number;
    name: string;
    role: string;
  } | null;
  booked: number;
  bookingConversion: number;
  count: number;
  key: string;
  label: string;
  processed: number;
}

export interface TelephonyReport {
  byInterest: TelephonyReportBucket[];
  byOperator: TelephonyReportOperator[];
  byProcessing: TelephonyReportBucket[];
  byResult: TelephonyReportBucket[];
  generatedAt: string;
  range: {
    from: string;
    to: string;
  };
  totals: {
    active: number;
    averageDurationSeconds: number;
    booked: number;
    bookingConversion: number;
    ignored: number;
    inbound: number;
    missed: number;
    outbound: number;
    overdueNextActions: number;
    processed: number;
    processingRate: number;
    recordingCoverage: number;
    recordingsAvailable: number;
    total: number;
    unknownClientRate: number;
    unknownClients: number;
  };
}

export interface TelephonyReportQuery {
  callStatus?: string;
  direction?: string;
  from?: string;
  recordingStatus?: string;
  status?: string;
  to?: string;
}

export interface TelephonyConfig {
  apiBaseUrl: string | null;
  apiTokenConfigured: boolean;
  callbackUrl: string | null;
  latestSubscription?: {
    callbackUrl: string;
    createdAt?: string;
    expiresAt?: string | null;
    expiresSeconds?: number | null;
    id: number;
    lastCheckedAt?: string | null;
    lastError?: string | null;
    pattern?: string | null;
    status: 'unknown' | 'active' | 'disabled' | 'expired' | 'failed';
    subscriptionId?: string | null;
    subscriptionType: 'BASIC_CALL' | 'ADVANCED_CALL';
    updatedAt?: string;
  } | null;
  recordsPath: string;
  statisticsPath: string;
  subscriptionAutoRenewEnabled: boolean;
  subscriptionPath: string;
  subscriptionRenewBeforeSeconds: number;
  webhookSecretRequired: boolean;
  webhookSecretConfigured: boolean;
}

export interface TelephonyRawEvent {
  call?: {
    callStatus: TelephonyCallStatus;
    id: number;
  } | null;
  createdAt?: string;
  eventType?: string | null;
  externalEventId?: string | null;
  id: number;
  payload: unknown;
  processingError?: string | null;
  processingStatus: 'new' | 'processed' | 'failed';
  receivedAt: string;
  sourceIp?: string | null;
}

export interface TelephonyRawEventsResponse {
  items: TelephonyRawEvent[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TelephonyCallsQuery {
  callStatus?: string;
  direction?: string;
  page?: number;
  pageSize?: number;
  q?: string;
  recordingStatus?: string;
  status?: string;
}

export interface TelephonyTranscriptionJobsQuery {
  callId?: number;
  page?: number;
  pageSize?: number;
  status?: TelephonyTranscriptionStatus | 'all';
}

export interface CompleteTelephonyCallPayload {
  interest?: TelephonyInterest | null;
  nextActionAt?: string | null;
  nextActionText?: string | null;
  result: TelephonyResult;
  summary?: string | null;
}

export interface CreateTelephonyClientPayload {
  name: string;
  note?: string | null;
  source?: string | null;
  sourceId?: number;
}

function toQueryString(params: object) {
  const searchParams = new URLSearchParams();
  Object.entries(params as Record<string, unknown>).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    searchParams.set(key, String(value));
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export function getTelephonyCalls(params: TelephonyCallsQuery) {
  return apiRequest<TelephonyListResponse>(
    `/api/telephony/calls${toQueryString(params)}`,
    {},
    'Не удалось получить звонки',
  );
}

export function getTelephonyCall(id: number) {
  return apiRequest<TelephonyCall>(
    `/api/telephony/calls/${id}`,
    {},
    'Не удалось получить звонок',
  );
}

export function getTelephonyCallTranscriptionJobs(
  callId: number,
  params: TelephonyTranscriptionJobsQuery = {},
) {
  return apiRequest<TelephonyTranscriptionJobsResponse>(
    `/api/telephony/calls/${callId}/transcription-jobs${toQueryString(params)}`,
    {},
    'Не удалось получить задачи транскрибации звонка',
  );
}

export function getTelephonyTranscriptionJobs(
  params: TelephonyTranscriptionJobsQuery = {},
) {
  return apiRequest<TelephonyTranscriptionJobsResponse>(
    `/api/telephony/transcription-jobs${toQueryString(params)}`,
    {},
    'Не удалось получить задачи транскрибации',
  );
}

export function getTelephonyTranscriptionJob(jobId: number) {
  return apiRequest<{ job: TelephonyTranscriptionJob }>(
    `/api/telephony/transcription-jobs/${jobId}`,
    {},
    'Не удалось получить задачу транскрибации',
  );
}

export function getTelephonyTranscriptionStats() {
  return apiRequest<TelephonyTranscriptionStats>(
    '/api/telephony/transcription-jobs/stats',
    {},
    'Не удалось получить статистику транскрибации',
  );
}

export function getTelephonyStats() {
  return apiRequest<TelephonyStats>(
    '/api/telephony/stats',
    {},
    'Не удалось получить статистику телефонии',
  );
}

export function getTelephonyReport(params: TelephonyReportQuery) {
  return apiRequest<TelephonyReport>(
    `/api/telephony/report${toQueryString(params)}`,
    {},
    'Не удалось получить отчет телефонии',
  );
}

export function getTelephonyConfig() {
  return apiRequest<TelephonyConfig>(
    '/api/telephony/config',
    {},
    'Не удалось получить настройки телефонии',
  );
}

export function getTelephonyRawEvents(params: {
  page?: number;
  pageSize?: number;
  status?: string;
}) {
  return apiRequest<TelephonyRawEventsResponse>(
    `/api/telephony/raw-events${toQueryString(params)}`,
    {},
    'Не удалось получить события телефонии',
  );
}

export function reprocessTelephonyRawEvent(eventId: number) {
  return apiRequest<{ item?: TelephonyRawEvent }>(
    `/api/telephony/raw-events/${eventId}/reprocess`,
    { method: 'POST' },
    'Не удалось повторно обработать событие телефонии',
  );
}

export function startTelephonyCallProcessing(callId: number) {
  return apiRequest<TelephonyCall>(
    `/api/telephony/calls/${callId}/start`,
    { method: 'POST' },
    'Не удалось начать обработку звонка',
  );
}

export function linkTelephonyCallClient(callId: number, clientId: number) {
  return apiRequest<TelephonyCall>(
    `/api/telephony/calls/${callId}/client`,
    {
      body: JSON.stringify({ clientId }),
      method: 'POST',
    },
    'Не удалось привязать клиента к звонку',
  );
}

export function createTelephonyCallClient(
  callId: number,
  payload: CreateTelephonyClientPayload,
) {
  return apiRequest<TelephonyCall>(
    `/api/telephony/calls/${callId}/client/create`,
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
    'Не удалось создать клиента из звонка',
  );
}

export function completeTelephonyCall(
  callId: number,
  payload: CompleteTelephonyCallPayload,
) {
  return apiRequest<TelephonyCall>(
    `/api/telephony/calls/${callId}/complete`,
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
    'Не удалось завершить обработку звонка',
  );
}

export function ignoreTelephonyCall(callId: number, summary?: string) {
  return apiRequest<TelephonyCall>(
    `/api/telephony/calls/${callId}/ignore`,
    {
      body: JSON.stringify({ summary }),
      method: 'POST',
    },
    'Не удалось скрыть звонок',
  );
}

export function syncBeelineStatistics(payload: {
  dateFrom?: string;
  dateTo?: string;
}) {
  return apiRequest<{ dateFrom: string; dateTo: string; imported: number }>(
    '/api/telephony/beeline/sync',
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
    'Не удалось синхронизировать статистику Билайна',
  );
}

export function syncBeelineRecordings(payload: {
  dateFrom?: string;
  dateTo?: string;
} = {}) {
  return apiRequest<{ dateFrom: string; dateTo: string; imported: number; linked: number }>(
    '/api/telephony/beeline/records/sync',
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
    'Не удалось синхронизировать записи Билайна',
  );
}

export function refreshTelephonyRecordingReference(callId: number) {
  return apiRequest<TelephonyCall>(
    `/api/telephony/calls/${callId}/recording-reference`,
    { method: 'POST' },
    'Не удалось получить ссылку на запись звонка',
  );
}

export function createTelephonyTranscriptionJob(callId: number) {
  return apiRequest<TelephonyCall>(
    `/api/telephony/calls/${callId}/transcription-jobs`,
    { method: 'POST' },
    'Не удалось поставить звонок на транскрибацию',
  );
}

export function retryTelephonyTranscriptionJob(jobId: number) {
  return apiRequest<TelephonyCall>(
    `/api/telephony/transcription-jobs/${jobId}/retry`,
    { method: 'POST' },
    'Не удалось повторить транскрибацию',
  );
}

export function subscribeBeelineEvents(payload: { url?: string } = {}) {
  return apiRequest<unknown>(
    '/api/telephony/beeline/subscribe',
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
    'Не удалось создать подписку Билайна',
  );
}

export function checkBeelineSubscription() {
  return apiRequest<unknown>(
    '/api/telephony/beeline/subscription/check',
    { method: 'POST' },
    'Не удалось проверить подписку Билайна',
  );
}
