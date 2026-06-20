import {
  type ComponentProps,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CalendarClock,
  CalendarDays,
  Copy,
  Dumbbell,
  Eye,
  Gift,
  GitMerge,
  History,
  MessageSquareText,
  PackageCheck,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Ticket,
  Trash2,
  UserRoundCheck,
  Users,
  WalletCards,
  Repeat2,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import {
  ClientSkillMap,
  type ClientSkillMapItem,
  type ClientSkillMapPayload,
} from '@/components/client-skill-map';
import {
  TrainingNoteExerciseEditor,
  TrainingNoteExerciseList,
} from '@/components/training-note-exercises';
import { TrainingRecommendationPanel } from '@/components/training-recommendation-panel';
import {
  createExerciseFormResult,
  type TrainingNoteExerciseFormResult,
  type TrainingNoteExerciseResult,
  toExerciseResultPayload,
} from '@/lib/training-note-exercises';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataTable } from '@/components/data-table';
import { ErrorState } from '@/components/error-state';
import { Input } from '@/components/ui/input';
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  HelpTooltip,
  MetricLabel,
} from '@/components/dashboard-metric';
import { listMethodologyExercises } from '@/api/methodology';
import { queryKeys } from '@/api/query-keys';
import { apiFetch } from '@/lib/api';
import {
  canManageClients,
  canManageCallTasks,
  canManageTrainingNotes,
  canMergeClients,
  canRedeemCertificates,
  canRedeemClientSubscriptions,
  canViewCertificates,
  canViewClientSubscriptions,
  canViewTrainingNotes,
} from '@/lib/permissions';
import type { ReferenceItem } from '@/lib/references';
import { fetchReferences } from '@/lib/references';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';

type ClientStatus = 'active' | 'archived';
type ClientSegment = 'all' | 'new' | 'regular' | 'inactive' | 'no_visits';
type CallTaskClientStatus =
  | 'new'
  | 'no_answer'
  | 'callback'
  | 'doubting'
  | 'booked'
  | 'refused';

interface ClientStats {
  firstVisitAt?: string | null;
  lastVisitAt?: string | null;
  visitCount: number;
}

interface ClientTrainingSummary {
  latestAt?: string | null;
  latestLevel?: TrainingLevel | null;
  notesCount: number;
}

interface Client {
  id: number;
  telegramId?: string | null;
  vkId?: string | null;
  webId?: string | null;
  name: string;
  phone: string;
  phoneNormalized?: string | null;
  source: string;
  sourceId?: number | null;
  note?: string | null;
  status: ClientStatus;
  statusLabel: string;
  segment: string;
  mergedIntoUserId?: number | null;
  createdAt: string;
  updatedAt: string;
  stats: ClientStats;
  training?: ClientTrainingSummary;
}

interface ClientVisit {
  id: number;
  scannedAt: string;
  keyNumber?: string | null;
  category?: string | null;
  categoryIds?: number[];
  categories?: Array<{
    id: number;
    name: string;
  }>;
  createdAt: string;
}

type ClientSubscriptionStatus = 'active' | 'canceled' | 'expired' | 'used';
type ClientSubscriptionRedemptionStatus = 'active' | 'reversed';
type ClientCertificateType = 'money' | 'service';
type ClientCertificateStatus = 'active' | 'canceled' | 'expired' | 'redeemed';
type ClientCertificateRedemptionStatus = 'active' | 'reversed';

interface ClientSubscriptionActor {
  email?: string | null;
  id: number;
  name?: string | null;
  role?: string | null;
}

interface ClientSubscriptionRedemption {
  clientId: number;
  clientSubscriptionId: number;
  comment?: string | null;
  createdAt?: string;
  id: number;
  quantity: number;
  redeemedAt: string;
  redeemedBy?: ClientSubscriptionActor | null;
  redeemedByAccountId?: number | null;
  reversalReason?: string | null;
  reversedAt?: string | null;
  reversedBy?: ClientSubscriptionActor | null;
  reversedByAccountId?: number | null;
  serviceType: string;
  status: ClientSubscriptionRedemptionStatus;
  trainingKind?: 'group' | 'personal' | string | null;
}

interface ClientSubscription {
  id: number;
  bonusPersonalSessions: number;
  expiresAt?: string | null;
  isUnlimited: boolean;
  pricePaid: number;
  remainingSessions: number | null;
  saleAmount: number;
  sessionsTotal: number | null;
  sessionsUsed: number;
  startsAt: string;
  status: ClientSubscriptionStatus;
  timeSegment?: string | null;
  trainingKind?: 'group' | 'personal' | string | null;
  typeName: string;
  redemptions?: ClientSubscriptionRedemption[];
}

interface ClientCertificateRedemption {
  amount?: number | null;
  certificateId: number;
  clientId: number;
  comment?: string | null;
  createdAt?: string;
  id: number;
  quantity?: number | null;
  redeemedAt: string;
  redeemedBy?: ClientSubscriptionActor | null;
  redemptionReason?: string | null;
  reversalReason?: string | null;
  reversedAt?: string | null;
  reversedBy?: ClientSubscriptionActor | null;
  serviceName?: string | null;
  serviceType?: string | null;
  status: ClientCertificateRedemptionStatus;
}

interface ClientCertificate {
  amountRemaining?: number | null;
  amountTotal?: number | null;
  amountUsed: number;
  certificateType: ClientCertificateType;
  code: string;
  createdAt: string;
  expiresAt?: string | null;
  id: number;
  redemptions?: ClientCertificateRedemption[];
  saleAmount: number;
  serviceName?: string | null;
  serviceType?: string | null;
  startsAt: string;
  status: ClientCertificateStatus;
  title: string;
  unitsRemaining?: number | null;
  unitsTotal?: number | null;
  unitsUsed: number;
}

interface ClientPrepaymentWarning {
  id: string;
  level: 'danger' | 'muted' | 'warning';
  text: string;
  type: string;
}

interface ClientPrepaymentSummary {
  activeCertificatesCount: number;
  activeSubscriptionsCount: number;
  certificateWarnings: ClientPrepaymentWarning[];
  hasActiveCertificate: boolean;
  hasActiveSubscription: boolean;
  subscriptionWarnings: ClientPrepaymentWarning[];
}

interface ClientsResponse {
  items: Client[];
  page: number;
  pageSize: number;
  sources: string[];
  total: number;
  totalPages: number;
}

interface ClientDetails {
  activeCallTasks: ClientActiveCallTask[];
  bookingSeries: ClientBookingSeries[];
  bookingStats: ClientBookingStats;
  bookings: ClientBooking[];
  client: Client;
  clientCertificates?: ClientCertificate[];
  clientSubscriptions?: ClientSubscription[];
  duplicateCandidates: Client[];
  mergedInto?: Client | null;
  prepaymentSummary?: ClientPrepaymentSummary;
  skillMap: ClientSkillMapItem[];
  telephonyCalls: ClientTelephonyCall[];
  timeline: ClientTimelineItem[];
  trainingNotes: TrainingNote[];
  visits: ClientVisit[];
}

interface ClientActiveCallTask {
  assignedTo?: {
    email?: string;
    id: number;
    name: string;
    role?: string;
  } | null;
  clientBase?: {
    id: number;
    name: string;
  } | null;
  contactedAt?: string | null;
  deadlineAt?: string | null;
  description?: string;
  id: number;
  status: CallTaskClientStatus;
  summary?: string;
  taskClientId: number;
  taskStatus?: 'backlog' | 'in_progress' | string | null;
  title: string;
  updatedAt?: string | null;
}

type ClientTelephonyDirection = 'inbound' | 'outbound' | 'unknown';
type ClientTelephonyCallStatus =
  | 'answered'
  | 'completed'
  | 'failed'
  | 'missed'
  | 'new'
  | 'ringing'
  | 'unknown';
type ClientTelephonyProcessingStatus =
  | 'ignored'
  | 'in_progress'
  | 'new'
  | 'processed';
type ClientTelephonyResult =
  | 'booked'
  | 'callback'
  | 'complaint'
  | 'corporate'
  | 'no_answer'
  | 'other'
  | 'refused'
  | 'thinking';

interface ClientTelephonyCall {
  callStatus: ClientTelephonyCallStatus;
  createdAt?: string | null;
  direction: ClientTelephonyDirection;
  durationSeconds?: number | null;
  endedAt?: string | null;
  followUpCallTask?: {
    dueAt?: string | null;
    id: number;
    status: string;
    title: string;
  } | null;
  id: number;
  interest?: string | null;
  nextActionAt?: string | null;
  nextActionText?: string | null;
  processedAt?: string | null;
  processedByAccount?: {
    id: number;
    name: string;
    role: string;
  } | null;
  processingStatus: ClientTelephonyProcessingStatus;
  recordingFileSize?: number | null;
  recordingStatus: 'available' | 'missing' | 'pending' | 'unknown';
  result?: ClientTelephonyResult | null;
  staff?: {
    id: number;
    name: string;
    role: string;
    status: string;
  } | null;
  startedAt?: string | null;
  summary?: string | null;
}

type ClientTimelineType =
  | 'booking'
  | 'booking_series'
  | 'call_attempt'
  | 'call_task'
  | 'client_change'
  | 'prepayment_link'
  | 'prepayment_redemption'
  | 'prepayment_reversal'
  | 'prepayment_sale'
  | 'telephony_call'
  | 'training'
  | 'visit';

interface ClientTimelineItem {
  actor?: {
    id: number;
    email?: string;
    name: string;
    role?: string;
  } | null;
  description: string;
  id: string;
  meta?: Record<string, unknown>;
  occurredAt: string;
  title: string;
  type: ClientTimelineType;
}

interface ClientSavedView {
  createdAt: string;
  filters: ClientSavedViewFilters;
  id: number;
  name: string;
  updatedAt: string;
}

interface ClientSavedViewFilters {
  lastVisitDaysFrom?: number;
  lastVisitDaysTo?: number;
  lastVisitFrom?: string;
  lastVisitTo?: string;
  q?: string;
  segment?: ClientSegment;
  source?: string;
  sourceId?: number | string;
  status?: 'active' | 'archived' | 'all';
  trainingLevel?: TrainingLevel | 'all';
  visitCategory?: string;
  visitCategoryId?: number;
  visitCountMax?: number;
  visitCountMin?: number;
}

interface ClientBookingCourt {
  id: number;
  name: string;
  type: string;
}

interface ClientBookingSeries {
  archiveReason?: string | null;
  archivedAt?: string | null;
  comment?: string | null;
  court?: ClientBookingCourt | null;
  courtId: number;
  createdAt: string;
  durationMinutes: number;
  endsOn: string;
  id: number;
  name: string;
  paymentMethod: string;
  paymentStatus: string;
  price?: number | null;
  startTime: string;
  startsOn: string;
  status: 'active' | 'archived';
  updatedAt: string;
  weekday: number;
}

interface ClientBooking {
  bookingSeriesId?: number | null;
  cancellationReason?: string | null;
  canceledAt?: string | null;
  comment?: string | null;
  court?: ClientBookingCourt | null;
  courtId: number;
  createdAt: string;
  durationMinutes: number;
  endsAt: string;
  id: number;
  paidAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  price: number;
  series?: {
    id: number;
    name: string;
    status: string;
  } | null;
  source: string;
  startsAt: string;
  status: string;
  updatedAt: string;
}

interface ClientBookingStats {
  activeCount: number;
  canceledCount: number;
  nextBookingAt?: string | null;
  paidAmount: number;
  plannedAmount: number;
  totalCount: number;
  upcomingCount: number;
}

interface TrainingNote {
  id: number;
  trainedAt: string;
  level: TrainingLevel;
  exercises: string;
  exerciseResults: TrainingNoteExerciseResult[];
  note: string;
  trainer?: {
    id: number;
    name: string;
    role?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

type TrainingLevel = 'D' | 'D+' | 'C' | 'C+' | 'B' | 'B+' | 'A';

interface TrainingFormState {
  exerciseResults: TrainingNoteExerciseFormResult[];
  level: TrainingLevel;
  note: string;
  trainedAt: string;
}

interface DuplicateGroup {
  field?: string;
  key?: string;
  label?: string;
  phoneNormalized?: string;
  count: number;
  type?: 'phone' | 'telegram' | 'vk' | 'web' | string;
  value?: string;
  clients: Client[];
}

interface DuplicateGroupSelection {
  primaryId: number | null;
  duplicateIds: number[];
}

interface ClientFormState {
  name: string;
  phone: string;
  sourceId: string;
  source: string;
  telegramId: string;
  vkId: string;
  webId: string;
  note: string;
  status: 'active' | 'archived';
}

interface ClientPayload {
  name: string;
  note: string;
  phone: string;
  source: string;
  sourceId?: number;
  status: 'active' | 'archived';
  telegramId?: string;
  vkId?: string;
  webId?: string;
}

interface ClientCallTaskFormState {
  description: string;
  dueAt: string;
  title: string;
}

type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<void>;
};

const EMPTY_FORM: ClientFormState = {
  name: '',
  phone: '',
  sourceId: '',
  source: 'Ресепшн (Админ)',
  telegramId: '',
  vkId: '',
  webId: '',
  note: '',
  status: 'active',
};

const TRAINING_LEVELS: TrainingLevel[] = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_TRAINING_FORM: TrainingFormState = {
  exerciseResults: [],
  level: 'D',
  note: '',
  trainedAt: getTodayDate(),
};

const EMPTY_CALL_TASK_FORM: ClientCallTaskFormState = {
  description: '',
  dueAt: '',
  title: '',
};
const clientFormSchema = z.object({
  name: z.string().trim().min(2, 'Введите имя клиента'),
  note: z.string(),
  phone: z.string().refine((value) => getPhoneDigits(value).length === 10, {
    message: 'Введите полный номер телефона',
  }),
  source: z.string(),
  sourceId: z.string().min(1, 'Выберите источник'),
  status: z.enum(['active', 'archived']),
  telegramId: z.string(),
  vkId: z.string(),
  webId: z.string(),
});
const clientCallTaskFormSchema = z.object({
  description: z.string(),
  dueAt: z.string(),
  title: z.string().trim().min(2, 'Введите название задачи'),
});

const CLIENT_SEGMENT_OPTIONS: Array<{
  value: ClientSegment;
  label: string;
  condition: string;
}> = [
  {
    value: 'all',
    label: 'Все сегменты',
    condition: 'Показываются все клиенты без фильтра по активности.',
  },
  {
    value: 'new',
    label: 'Новые',
    condition: 'Клиенты, у которых ровно один визит.',
  },
  {
    value: 'regular',
    label: 'Постоянные',
    condition: 'Клиенты, у которых три или больше визитов.',
  },
  {
    value: 'inactive',
    label: 'Давно не были',
    condition: 'Клиенты с визитами, у которых последний визит был 60 или больше дней назад.',
  },
  {
    value: 'no_visits',
    label: 'Без визитов',
    condition: 'Клиенты, у которых еще нет ни одного визита.',
  },
];

const TIMELINE_TYPE_LABELS: Record<ClientTimelineType, string> = {
  booking: 'Бронь',
  booking_series: 'Постоянка',
  call_attempt: 'Попытка',
  call_task: 'Обзвон',
  client_change: 'Изменение',
  prepayment_link: 'Привязка',
  prepayment_redemption: 'Списание',
  prepayment_reversal: 'Отмена',
  prepayment_sale: 'Продажа',
  telephony_call: 'Звонок',
  training: 'Тренировка',
  visit: 'Визит',
};

const TELEPHONY_DIRECTION_LABELS: Record<ClientTelephonyDirection, string> = {
  inbound: 'Входящий',
  outbound: 'Исходящий',
  unknown: 'Неизвестно',
};

const TELEPHONY_CALL_STATUS_LABELS: Record<ClientTelephonyCallStatus, string> = {
  answered: 'Принят',
  completed: 'Завершен',
  failed: 'Ошибка',
  missed: 'Пропущен',
  new: 'Новый',
  ringing: 'Звонит',
  unknown: 'Неизвестно',
};

const TELEPHONY_PROCESSING_STATUS_LABELS: Record<ClientTelephonyProcessingStatus, string> = {
  ignored: 'Скрыт',
  in_progress: 'В обработке',
  new: 'Новый',
  processed: 'Обработан',
};

const TELEPHONY_RESULT_LABELS: Record<ClientTelephonyResult, string> = {
  booked: 'Записался',
  callback: 'Перезвонить',
  complaint: 'Жалоба',
  corporate: 'Корпоратив',
  no_answer: 'Не взял трубку',
  other: 'Другое',
  refused: 'Отказ',
  thinking: 'Думает',
};

const TELEPHONY_RECORDING_LABELS: Record<ClientTelephonyCall['recordingStatus'], string> = {
  available: 'Запись есть',
  missing: 'Без записи',
  pending: 'Готовится',
  unknown: 'Запись неизвестна',
};

const BOOKING_STATUS_LABELS: Record<string, string> = {
  arrived: 'Клиент пришел',
  canceled: 'Отменена',
  confirmed: 'Подтверждена',
  new: 'Новая',
  no_show: 'Не пришел',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: 'Оплачено',
  partial: 'Частично',
  refunded: 'Возврат',
  unpaid: 'Не оплачено',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные',
  cashless: 'Безнал',
  mixed: 'Смешанная',
  unknown: 'Не указан',
};

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Пн',
  2: 'Вт',
  3: 'Ср',
  4: 'Чт',
  5: 'Пт',
  6: 'Сб',
  7: 'Вс',
};

const CALL_CLIENT_STATUS_LABELS: Record<string, string> = {
  booked: 'Записался',
  callback: 'Перезвонить',
  doubting: 'Сомневается',
  new: 'Новый',
  no_answer: 'Не взял трубку',
  refused: 'Отказ',
};

const CLIENT_SUBSCRIPTION_STATUS_LABELS: Record<ClientSubscriptionStatus, string> = {
  active: 'Активен',
  canceled: 'Отменен',
  expired: 'Истек',
  used: 'Использован',
};

const CLIENT_SUBSCRIPTION_REDEMPTION_STATUS_LABELS: Record<
  ClientSubscriptionRedemptionStatus,
  string
> = {
  active: 'Списано',
  reversed: 'Отменено',
};

const CLIENT_CERTIFICATE_STATUS_LABELS: Record<ClientCertificateStatus, string> = {
  active: 'Активен',
  canceled: 'Отменен',
  expired: 'Истек',
  redeemed: 'Погашен',
};

const CLIENT_CERTIFICATE_TYPE_LABELS: Record<ClientCertificateType, string> = {
  money: 'Денежный',
  service: 'Услуга/пакет',
};

const CLIENT_CERTIFICATE_REDEMPTION_STATUS_LABELS: Record<
  ClientCertificateRedemptionStatus,
  string
> = {
  active: 'Списано',
  reversed: 'Отменено',
};

const PREPAYMENT_KIND_LABELS: Record<string, string> = {
  certificate: 'Сертификат',
  subscription: 'Абонемент',
};

const SUBSCRIPTION_TRAINING_KIND_LABELS: Record<string, string> = {
  group: 'Групповой',
  personal: 'Персональный',
};

const SUBSCRIPTION_TIME_SEGMENT_LABELS: Record<string, string> = {
  all: 'Любое время',
  off_peak: 'Будни 10:00-17:00',
  single: 'Разовое',
  standard: 'День/вечер/выходные',
};

function getPhoneDigits(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function formatClientPhone(value: string) {
  let digits = value.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (!digits.startsWith('7')) digits = `7${digits}`;

  const local = digits.slice(1, 11);
  let formatted = '+7';

  if (local.length > 0) formatted += ` (${local.slice(0, 3)}`;
  if (local.length >= 3) formatted += ')';
  if (local.length > 3) formatted += ` ${local.slice(3, 6)}`;
  if (local.length > 6) formatted += `-${local.slice(6, 8)}`;
  if (local.length > 8) formatted += `-${local.slice(8, 10)}`;

  return formatted;
}

function getPhoneHref(value: string) {
  const digits = getPhoneDigits(value);
  return digits.length === 10 ? `tel:+7${digits}` : undefined;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
  }).format(new Date(value));
}

function formatCurrency(value?: number | null) {
  return `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
}

function formatSubscriptionRemaining(subscription: ClientSubscription) {
  if (subscription.isUnlimited) return 'Безлимит';
  return `${subscription.remainingSessions ?? 0} из ${
    subscription.sessionsTotal ?? 0
  }`;
}

function formatSubscriptionActor(actor?: ClientSubscriptionActor | null) {
  if (!actor) return 'Система';
  return actor.name || actor.email || 'Система';
}

function formatSubscriptionRedemptionService(redemption: ClientSubscriptionRedemption) {
  if (redemption.serviceType !== 'training') return redemption.serviceType;
  if (redemption.trainingKind) {
    return SUBSCRIPTION_TRAINING_KIND_LABELS[redemption.trainingKind] || redemption.trainingKind;
  }
  return 'Тренировка';
}

function formatCertificateBalance(certificate: ClientCertificate) {
  if (certificate.certificateType === 'money') {
    return `${formatCurrency(certificate.amountRemaining)} из ${formatCurrency(
      certificate.amountTotal,
    )}`;
  }
  return `${certificate.unitsRemaining ?? 0} из ${certificate.unitsTotal ?? 0}`;
}

function formatCertificateRedemptionValue(
  redemption: ClientCertificateRedemption,
  certificate: ClientCertificate,
) {
  if (certificate.certificateType === 'money') {
    return formatCurrency(redemption.amount);
  }
  return `${redemption.quantity || 0} услуг`;
}

function getDaysUntil(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function getSubscriptionWarning(subscription: ClientSubscription) {
  if (subscription.status === 'expired') return 'Истекший абонемент';
  if (subscription.status === 'used') return 'Абонемент закончился';
  if (subscription.status === 'canceled') return 'Абонемент отменен';
  const daysLeft = getDaysUntil(subscription.expiresAt);
  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14) {
    return `Скоро истекает: ${daysLeft} дн.`;
  }
  if (
    !subscription.isUnlimited &&
    subscription.remainingSessions !== null &&
    subscription.remainingSessions <= 1
  ) {
    return `Заканчивается: ${subscription.remainingSessions} занятий`;
  }
  return '';
}

function getCertificateWarning(certificate: ClientCertificate) {
  if (certificate.status === 'expired') return 'Сертификат истек';
  if (certificate.status === 'redeemed') return 'Сертификат погашен';
  if (certificate.status === 'canceled') return 'Сертификат отменен';
  const daysLeft = getDaysUntil(certificate.expiresAt);
  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14) {
    return `Скоро истекает: ${daysLeft} дн.`;
  }
  return '';
}

function formatDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return 'Длительность неизвестна';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function getLocalDateOnly(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

async function readError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

async function readApiError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as {
      client?: Client;
      code?: string;
      error?: string;
    };
    return {
      client: data.client,
      code: data.code,
      error: data.error || fallback,
    };
  } catch {
    return { error: fallback };
  }
}

function getStatusBadgeClass(status: ClientStatus) {
  if (status === 'active') {
    return 'bg-green-100 text-green-800 border-transparent dark:bg-green-900/30 dark:text-green-300';
  }
  return 'bg-muted text-muted-foreground';
}

function getPaginationItems(currentPage: number, pageCount: number) {
  const pages: Array<number | 'ellipsis'> = [];
  const total = Math.max(1, pageCount);

  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  pages.push(1);

  if (currentPage > 4) {
    pages.push('ellipsis');
  }

  const start = Math.max(2, currentPage - 1);
  const end = Math.min(total - 1, currentPage + 1);

  for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
    pages.push(pageNumber);
  }

  if (currentPage < total - 3) {
    pages.push('ellipsis');
  }

  pages.push(total);
  return pages;
}

function getDefaultPrimaryClientId(clients: Client[]) {
  const [primary] = [...clients].sort((a, b) => {
    const visitDiff = b.stats.visitCount - a.stats.visitCount;
    if (visitDiff !== 0) return visitDiff;

    const lastVisitDiff =
      new Date(b.stats.lastVisitAt || 0).getTime() -
      new Date(a.stats.lastVisitAt || 0).getTime();
    if (lastVisitDiff !== 0) return lastVisitDiff;

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return primary?.id ?? null;
}

function buildDuplicateSelections(groups: DuplicateGroup[]) {
  return groups.reduce<Record<string, DuplicateGroupSelection>>((acc, group) => {
    const primaryId = getDefaultPrimaryClientId(group.clients);
    acc[getDuplicateGroupKey(group)] = {
      primaryId,
      duplicateIds: [],
    };
    return acc;
  }, {});
}

function formatVisitCategories(visit: ClientVisit) {
  const names = visit.categories?.map((category) => category.name).filter(Boolean);
  return names && names.length > 0 ? names.join(', ') : visit.category || '-';
}

function getDuplicateGroupKey(group: DuplicateGroup) {
  return group.key || group.phoneNormalized || `${group.type}:${group.value}`;
}

function getDuplicateGroupLabel(group: DuplicateGroup) {
  if (group.label && group.value) return `${group.label}: ${group.value}`;
  return `Телефон: ${group.clients[0]?.phone || group.phoneNormalized || '-'}`;
}

function getTimelineIcon(type: ClientTimelineType) {
  if (type === 'booking') return CalendarClock;
  if (type === 'booking_series') return Repeat2;
  if (type === 'visit') return CalendarDays;
  if (type === 'training') return Dumbbell;
  if (type === 'telephony_call') return PhoneCall;
  if (type === 'call_task' || type === 'call_attempt') return MessageSquareText;
  if (type.startsWith('prepayment_')) return Ticket;
  return History;
}

function getTimelineMeta(item: ClientTimelineItem) {
  const meta = item.meta || {};
  const parts: string[] = [];
  const status = typeof meta.status === 'string' ? meta.status : '';
  const deadlineAt =
    typeof meta.deadlineAt === 'string' ? meta.deadlineAt : null;
  const keyNumber =
    typeof meta.keyNumber === 'string' || typeof meta.keyNumber === 'number'
      ? String(meta.keyNumber)
      : '';
  const level = typeof meta.level === 'string' ? meta.level : '';
  const courtName = typeof meta.courtName === 'string' ? meta.courtName : '';
  const paymentStatus =
    typeof meta.paymentStatus === 'string' ? meta.paymentStatus : '';
  const durationMinutes =
    typeof meta.durationMinutes === 'number' ? meta.durationMinutes : null;
  const durationSeconds =
    typeof meta.durationSeconds === 'number' ? meta.durationSeconds : null;
  const direction = typeof meta.direction === 'string' ? meta.direction : '';
  const callStatus = typeof meta.callStatus === 'string' ? meta.callStatus : '';
  const processingStatus =
    typeof meta.processingStatus === 'string' ? meta.processingStatus : '';
  const result = typeof meta.result === 'string' ? meta.result : '';
  const recordingStatus =
    typeof meta.recordingStatus === 'string' ? meta.recordingStatus : '';
  const prepaymentKind =
    typeof meta.prepaymentKind === 'string' ? meta.prepaymentKind : '';

  if (item.type === 'telephony_call') {
    if (direction) {
      parts.push(
        TELEPHONY_DIRECTION_LABELS[direction as ClientTelephonyDirection] ||
          direction,
      );
    }
    if (callStatus) {
      parts.push(
        TELEPHONY_CALL_STATUS_LABELS[callStatus as ClientTelephonyCallStatus] ||
          callStatus,
      );
    }
    if (processingStatus) {
      parts.push(
        TELEPHONY_PROCESSING_STATUS_LABELS[
          processingStatus as ClientTelephonyProcessingStatus
        ] || processingStatus,
      );
    }
    if (result) {
      parts.push(
        TELEPHONY_RESULT_LABELS[result as ClientTelephonyResult] || result,
      );
    }
    if (durationSeconds !== null) parts.push(formatDuration(durationSeconds));
    if (recordingStatus) {
      parts.push(
        TELEPHONY_RECORDING_LABELS[
          recordingStatus as ClientTelephonyCall['recordingStatus']
        ] || recordingStatus,
      );
    }

    return parts.join(' · ');
  }

  if (item.type.startsWith('prepayment_')) {
    if (prepaymentKind) {
      parts.push(PREPAYMENT_KIND_LABELS[prepaymentKind] || prepaymentKind);
    }
    if (status) {
      const isRedemptionEvent =
        item.type === 'prepayment_redemption' ||
        item.type === 'prepayment_reversal';
      parts.push(
        isRedemptionEvent
          ? CLIENT_SUBSCRIPTION_REDEMPTION_STATUS_LABELS[
              status as ClientSubscriptionRedemptionStatus
            ] || status
          : CLIENT_SUBSCRIPTION_STATUS_LABELS[
              status as ClientSubscriptionStatus
            ] ||
              CLIENT_CERTIFICATE_STATUS_LABELS[
                status as ClientCertificateStatus
              ] ||
              status,
      );
    }
    return parts.join(' · ');
  }

  if (status) {
    parts.push(
      item.type === 'booking'
        ? BOOKING_STATUS_LABELS[status] || status
        : item.type === 'booking_series'
          ? status === 'active'
            ? 'Активна'
            : status === 'archived'
              ? 'Архив'
              : status
        : CALL_CLIENT_STATUS_LABELS[status] || status,
    );
  }
  if (courtName) parts.push(courtName);
  if (durationMinutes) parts.push(`${durationMinutes} мин`);
  if (paymentStatus) {
    parts.push(PAYMENT_STATUS_LABELS[paymentStatus] || paymentStatus);
  }
  if (deadlineAt) parts.push(`дедлайн ${formatDateTime(deadlineAt)}`);
  if (keyNumber) parts.push(`ключ ${keyNumber}`);
  if (level) parts.push(`уровень ${level}`);

  return parts.join(' · ');
}

function normalizeSavedFilterValue(value?: string | number) {
  if (value === undefined || value === null || value === '') return 'all';
  return String(value);
}

function normalizeNumericFilterInput(value?: string | number) {
  if (value === undefined || value === null || value === '') return '';
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? String(numberValue) : '';
}

function appendNumericFilter(
  params: URLSearchParams,
  key: string,
  value: string,
) {
  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && numberValue >= 0) {
    params.set(key, String(numberValue));
  }
}

function getQueryEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  allowedValues: readonly T[],
  fallback: T,
) {
  const value = params.get(key);
  return value && (allowedValues as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function getQueryPositiveInteger(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getQueryNumericInput(params: URLSearchParams, key: string) {
  return normalizeNumericFilterInput(params.get(key) || undefined);
}

function getQuerySelectId(params: URLSearchParams, key: string) {
  const id = getQueryPositiveInteger(params.get(key));
  return id ? String(id) : 'all';
}

function getQueryText(params: URLSearchParams, key: string) {
  return params.get(key)?.trim() || '';
}

function getComparableSavedFilters(filters: ClientSavedViewFilters) {
  return {
    lastVisitDaysFrom: normalizeNumericFilterInput(filters.lastVisitDaysFrom),
    lastVisitDaysTo: normalizeNumericFilterInput(filters.lastVisitDaysTo),
    q: filters.q || '',
    segment: filters.segment || 'all',
    sourceId: normalizeSavedFilterValue(filters.sourceId),
    status: filters.status || 'active',
    trainingLevel: filters.trainingLevel || 'all',
    visitCategoryId: normalizeSavedFilterValue(filters.visitCategoryId),
    visitCountMax: normalizeNumericFilterInput(filters.visitCountMax),
    visitCountMin: normalizeNumericFilterInput(filters.visitCountMin),
  };
}

function areSavedFiltersEqual(
  left: ClientSavedViewFilters,
  right: ClientSavedViewFilters,
) {
  return (
    JSON.stringify(getComparableSavedFilters(left)) ===
    JSON.stringify(getComparableSavedFilters(right))
  );
}

function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <div className="mt-1 text-xs text-destructive">{children}</div>;
}

function isPrepaymentWarning(
  value: ClientPrepaymentWarning | null,
): value is ClientPrepaymentWarning {
  return Boolean(value);
}

function TooltipIconButton({
  children,
  label,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} title={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export default function ClientsPage() {
  const { account } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canEdit = canManageClients(account?.role);
  const canCreateCallTask = canManageCallTasks(account?.role);
  const canMerge = canMergeClients(account?.role);
  const canViewTraining = canViewTrainingNotes(account?.role);
  const canEditTraining = canManageTrainingNotes(account?.role);
  const canViewSubscriptions = canViewClientSubscriptions(account?.role);
  const canRedeemSubscriptions = canRedeemClientSubscriptions(account?.role);
  const canViewClientCertificates = canViewCertificates(account?.role);
  const canRedeemClientCertificates = canRedeemCertificates(account?.role);
  const canViewClientTelephony = ['owner', 'manager', 'admin', 'viewer'].includes(
    account?.role || '',
  );
  const isTrainerAccount = account?.role === 'trainer';

  const [viewMode, setViewMode] = useState<'list' | 'duplicates'>('list');
  const [clients, setClients] = useState<Client[]>([]);
  const [sources, setSources] = useState<ReferenceItem[]>([]);
  const [visitCategories, setVisitCategories] = useState<ReferenceItem[]>([]);
  const [savedViews, setSavedViews] = useState<ClientSavedView[]>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState('none');
  const [savedViewDialogOpen, setSavedViewDialogOpen] = useState(false);
  const [savedViewName, setSavedViewName] = useState('');
  const [savedViewSaving, setSavedViewSaving] = useState(false);
  const [callTaskDialogOpen, setCallTaskDialogOpen] = useState(false);
  const [callTaskSaving, setCallTaskSaving] = useState(false);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(() => getQueryText(searchParams, 'q'));
  const [sourceId, setSourceId] = useState(() =>
    getQuerySelectId(searchParams, 'sourceId'),
  );
  const [segment, setSegment] = useState<ClientSegment>(() =>
    getQueryEnum(
      searchParams,
      'segment',
      CLIENT_SEGMENT_OPTIONS.map((option) => option.value),
      'all',
    ),
  );
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>(() =>
    getQueryEnum(searchParams, 'status', ['active', 'archived', 'all'], 'active'),
  );
  const [trainingLevel, setTrainingLevel] = useState<TrainingLevel | 'all'>(() =>
    getQueryEnum(
      searchParams,
      'trainingLevel',
      ['all', ...TRAINING_LEVELS],
      'all',
    ),
  );
  const [visitCategoryId, setVisitCategoryId] = useState(() =>
    getQuerySelectId(searchParams, 'visitCategoryId'),
  );
  const [visitCountMin, setVisitCountMin] = useState(() =>
    getQueryNumericInput(searchParams, 'visitCountMin'),
  );
  const [visitCountMax, setVisitCountMax] = useState(() =>
    getQueryNumericInput(searchParams, 'visitCountMax'),
  );
  const [lastVisitDaysFrom, setLastVisitDaysFrom] = useState(() =>
    getQueryNumericInput(searchParams, 'lastVisitDaysFrom'),
  );
  const [lastVisitDaysTo, setLastVisitDaysTo] = useState(() =>
    getQueryNumericInput(searchParams, 'lastVisitDaysTo'),
  );
  const [page, setPage] = useState(() => getQueryPositiveInteger(searchParams.get('page')) || 1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [details, setDetails] = useState<ClientDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<Client | null>(null);
  const [duplicateWarningMessage, setDuplicateWarningMessage] = useState<
    string | null
  >(null);
  const [trainingForm, setTrainingForm] = useState<TrainingFormState>({
    ...EMPTY_TRAINING_FORM,
    trainedAt: getTodayDate(),
  });
  const [trainingSaving, setTrainingSaving] = useState(false);
  const [redemptionDialogSubscription, setRedemptionDialogSubscription] =
    useState<ClientSubscription | null>(null);
  const [redemptionForm, setRedemptionForm] = useState({
    comment: '',
    redeemedAt: getTodayDate(),
    trainingKind: 'group',
  });
  const [redemptionSaving, setRedemptionSaving] = useState(false);
  const [reverseRedemptionDialog, setReverseRedemptionDialog] =
    useState<{
      redemption: ClientSubscriptionRedemption;
      subscription: ClientSubscription;
    } | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseSaving, setReverseSaving] = useState(false);
  const [certificateRedemptionDialog, setCertificateRedemptionDialog] =
    useState<ClientCertificate | null>(null);
  const [certificateRedemptionForm, setCertificateRedemptionForm] = useState({
    amount: '',
    comment: '',
    quantity: '1',
    redeemedAt: getTodayDate(),
  });
  const [certificateRedemptionSaving, setCertificateRedemptionSaving] =
    useState(false);
  const [certificateReverseDialog, setCertificateReverseDialog] =
    useState<{
      certificate: ClientCertificate;
      redemption: ClientCertificateRedemption;
    } | null>(null);
  const [certificateReverseReason, setCertificateReverseReason] = useState('');
  const [certificateReverseSaving, setCertificateReverseSaving] = useState(false);
  const approvedExerciseFilters = useMemo(() => ({ status: 'approved' as const }), []);
  const exercisesQuery = useQuery({
    enabled: Boolean(
      canEditTraining &&
        details?.client &&
        details.client.status !== 'archived',
    ),
    queryFn: () => listMethodologyExercises(approvedExerciseFilters),
    queryKey: queryKeys.methodology.exercises(approvedExerciseFilters),
  });
  const methodologyExercises = exercisesQuery.data || [];
  const clientSubscriptions = details?.clientSubscriptions || [];
  const activeClientSubscriptions = clientSubscriptions.filter(
    (subscription) => subscription.status === 'active',
  );
  const historicalClientSubscriptions = clientSubscriptions.filter(
    (subscription) => subscription.status !== 'active',
  );
  const clientCertificates = details?.clientCertificates || [];
  const activeClientCertificates = clientCertificates.filter(
    (certificate) => certificate.status === 'active',
  );
  const historicalClientCertificates = clientCertificates.filter(
    (certificate) => certificate.status !== 'active',
  );
  const prepaymentSummary = details?.prepaymentSummary;
  const fallbackSubscriptionWarnings: ClientPrepaymentWarning[] =
    clientSubscriptions
      .map((subscription): ClientPrepaymentWarning | null => {
        const text = getSubscriptionWarning(subscription);
        return text
          ? {
              id: `subscription-${subscription.id}`,
              level: subscription.status === 'active' ? 'warning' : 'danger',
              text: `${subscription.typeName}: ${text}`,
              type: subscription.status,
            }
          : null;
      })
      .filter(isPrepaymentWarning);
  const fallbackCertificateWarnings: ClientPrepaymentWarning[] =
    clientCertificates
      .map((certificate): ClientPrepaymentWarning | null => {
        const text = getCertificateWarning(certificate);
        return text
          ? {
              id: `certificate-${certificate.id}`,
              level: certificate.status === 'active' ? 'warning' : 'danger',
              text: `${certificate.code}: ${text}`,
              type: certificate.status,
            }
          : null;
      })
      .filter(isPrepaymentWarning);
  const subscriptionWarnings =
    prepaymentSummary?.subscriptionWarnings || fallbackSubscriptionWarnings;
  const certificateWarnings =
    prepaymentSummary?.certificateWarnings || fallbackCertificateWarnings;
  const canMutateSubscriptions =
    canRedeemSubscriptions && details?.client.status !== 'archived';
  const canMutateCertificates =
    canRedeemClientCertificates && details?.client.status !== 'archived';
  const [selectedMergeIds, setSelectedMergeIds] = useState<number[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState<string | null>(null);
  const [groupSelections, setGroupSelections] = useState<
    Record<string, DuplicateGroupSelection>
  >({});
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);
  const clientsRequestIdRef = useRef(0);
  const detailsRequestIdRef = useRef(0);
  const previousFilterResetKeyRef = useRef<string | null>(null);
  const clientForm = useForm<ClientFormState>({
    defaultValues: EMPTY_FORM,
    resolver: zodResolver(clientFormSchema),
  });
  const clientCallTaskForm = useForm<ClientCallTaskFormState>({
    defaultValues: EMPTY_CALL_TASK_FORM,
    resolver: zodResolver(clientCallTaskFormSchema),
  });
  const form = clientForm.watch();
  const callTaskForm = clientCallTaskForm.watch();
  const setForm = (nextForm: ClientFormState) => {
    clientForm.reset(nextForm, {
      keepDirty: true,
      keepErrors: true,
      keepTouched: true,
    });
  };
  const setCallTaskForm = (nextForm: ClientCallTaskFormState) => {
    clientCallTaskForm.reset(nextForm, {
      keepDirty: true,
      keepErrors: true,
      keepTouched: true,
    });
  };

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '10',
      segment,
      status,
    });

    if (q.trim()) params.set('q', q.trim());
    if (sourceId !== 'all') params.set('sourceId', sourceId);
    if (visitCategoryId !== 'all') params.set('visitCategoryId', visitCategoryId);
    if (trainingLevel !== 'all') params.set('trainingLevel', trainingLevel);
    appendNumericFilter(params, 'visitCountMin', visitCountMin);
    appendNumericFilter(params, 'visitCountMax', visitCountMax);
    appendNumericFilter(params, 'lastVisitDaysFrom', lastVisitDaysFrom);
    appendNumericFilter(params, 'lastVisitDaysTo', lastVisitDaysTo);

    return params.toString();
  }, [
    lastVisitDaysFrom,
    lastVisitDaysTo,
    page,
    q,
    segment,
    sourceId,
    status,
    trainingLevel,
    visitCategoryId,
    visitCountMax,
    visitCountMin,
  ]);

  const currentSavedViewFilters = useMemo<ClientSavedViewFilters>(() => {
    const filters: ClientSavedViewFilters = {
      segment,
      status,
    };

    if (q.trim()) filters.q = q.trim();
    if (sourceId !== 'all') filters.sourceId = Number(sourceId);
    if (visitCategoryId !== 'all') filters.visitCategoryId = Number(visitCategoryId);
    if (trainingLevel !== 'all') filters.trainingLevel = trainingLevel;
    if (visitCountMin) filters.visitCountMin = Number(visitCountMin);
    if (visitCountMax) filters.visitCountMax = Number(visitCountMax);
    if (lastVisitDaysFrom) filters.lastVisitDaysFrom = Number(lastVisitDaysFrom);
    if (lastVisitDaysTo) filters.lastVisitDaysTo = Number(lastVisitDaysTo);

    return filters;
  }, [
    lastVisitDaysFrom,
    lastVisitDaysTo,
    q,
    segment,
    sourceId,
    status,
    trainingLevel,
    visitCategoryId,
    visitCountMax,
    visitCountMin,
  ]);

  const selectedSavedView = useMemo(
    () =>
      savedViews.find((view) => String(view.id) === selectedSavedViewId) ||
      null,
    [savedViews, selectedSavedViewId],
  );
  const selectedSavedViewDirty = useMemo(
    () =>
      Boolean(
        selectedSavedView &&
          !areSavedFiltersEqual(selectedSavedView.filters, currentSavedViewFilters),
      ),
    [currentSavedViewFilters, selectedSavedView],
  );
  const filterResetKey = useMemo(
    () =>
      JSON.stringify({
        lastVisitDaysFrom,
        lastVisitDaysTo,
        q,
        segment,
        sourceId,
        status,
        trainingLevel,
        visitCategoryId,
        visitCountMax,
        visitCountMin,
      }),
    [
      lastVisitDaysFrom,
      lastVisitDaysTo,
      q,
      segment,
      sourceId,
      status,
      trainingLevel,
      visitCategoryId,
      visitCountMax,
      visitCountMin,
    ],
  );

  const fetchClients = useCallback(async () => {
    const requestId = clientsRequestIdRef.current + 1;
    clientsRequestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/clients?${queryString}`);
      if (requestId !== clientsRequestIdRef.current) return;
      if (!res.ok) {
        setError(await readError(res, 'Не удалось загрузить клиентов'));
        return;
      }

      const data = (await res.json()) as ClientsResponse;
      if (requestId !== clientsRequestIdRef.current) return;
      setClients(data.items);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      if (requestId !== clientsRequestIdRef.current) return;
      setError('Не удалось загрузить клиентов. Проверьте подключение к серверу.');
    } finally {
      if (requestId === clientsRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [queryString]);

  const fetchClientSources = useCallback(async () => {
    setReferencesLoading(true);
    try {
      const [nextSources, nextVisitCategories] = await Promise.all([
        fetchReferences('client-sources', 'all'),
        fetchReferences('visit-categories', 'all'),
      ]);
      setSources(nextSources);
      setVisitCategories(nextVisitCategories);
    } catch {
      setSources([]);
      setVisitCategories([]);
    } finally {
      setReferencesLoading(false);
    }
  }, []);

  const fetchSavedViews = useCallback(async () => {
    try {
      const res = await apiFetch('/api/clients/views');
      if (!res.ok) return;
      setSavedViews((await res.json()) as ClientSavedView[]);
    } catch {
      setSavedViews([]);
    }
  }, []);

  const fetchDuplicateGroups = useCallback(async () => {
    if (!canMerge) return;

    setDuplicatesLoading(true);
    setDuplicatesError(null);
    try {
      const res = await apiFetch('/api/clients/duplicates');
      if (!res.ok) {
        setDuplicatesError(await readError(res, 'Не удалось загрузить дубли'));
        return;
      }

      const data = (await res.json()) as DuplicateGroup[];
      setDuplicateGroups(data);
      setGroupSelections(buildDuplicateSelections(data));
    } catch {
      setDuplicatesError('Не удалось загрузить дубли. Проверьте подключение к серверу.');
    } finally {
      setDuplicatesLoading(false);
    }
  }, [canMerge]);

  useEffect(() => {
    void fetchClientSources();
    void fetchSavedViews();
  }, [fetchClientSources, fetchSavedViews]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchClients();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [fetchClients]);

  useEffect(() => {
    if (viewMode !== 'duplicates') return;
    if (!canMerge) {
      setViewMode('list');
      return;
    }

    void fetchDuplicateGroups();
  }, [canMerge, fetchDuplicateGroups, viewMode]);

  useEffect(() => {
    if (previousFilterResetKeyRef.current === null) {
      previousFilterResetKeyRef.current = filterResetKey;
      return;
    }
    if (previousFilterResetKeyRef.current === filterResetKey) return;

    previousFilterResetKeyRef.current = filterResetKey;
    setPage(1);
  }, [filterResetKey]);

  useEffect(() => {
    const digits = getPhoneDigits(form.phone);
    if (!formOpen || digits.length !== 10) {
      setDuplicateWarning(null);
      setDuplicateWarningMessage(null);
      return;
    }

    let cancelled = false;
    const checkedPhoneDigits = digits;

    const timeout = window.setTimeout(async () => {
      const params = new URLSearchParams({ phone: form.phone });
      params.set('includeArchived', 'true');
      if (editingClient) {
        params.set('excludeClientId', String(editingClient.id));
      }

      const res = await apiFetch(`/api/clients/lookup?${params.toString()}`);
      if (cancelled || getPhoneDigits(form.phone) !== checkedPhoneDigits) {
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { client: Client | null };
      if (cancelled || getPhoneDigits(form.phone) !== checkedPhoneDigits) {
        return;
      }
      setDuplicateWarning(data.client);
      setDuplicateWarningMessage(null);
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [editingClient, form.phone, formOpen]);

  const isInitialLoading = loading && clients.length === 0;
  const paginationItems = useMemo(
    () => getPaginationItems(page, totalPages),
    [page, totalPages],
  );
  const activeSources = useMemo(
    () => sources.filter((source) => source.status === 'active'),
    [sources],
  );
  const formSourceOptions = useMemo(() => {
    const currentSource = sources.find(
      (source) => String(source.id) === form.sourceId,
    );
    if (
      currentSource &&
      currentSource.status === 'archived' &&
      !activeSources.some((source) => source.id === currentSource.id)
    ) {
      return [...activeSources, currentSource];
    }

    return activeSources;
  }, [activeSources, form.sourceId, sources]);

  const getEmptyClientForm = useCallback(() => {
    const defaultSource =
      activeSources.find((item) => item.name === 'Ресепшн (Админ)') ||
      activeSources[0];

    return {
      ...EMPTY_FORM,
      sourceId: defaultSource ? String(defaultSource.id) : '',
      source: defaultSource?.name || EMPTY_FORM.source,
    };
  }, [activeSources]);

  const openCreate = () => {
    setEditingClient(null);
    clientForm.reset(getEmptyClientForm());
    setDuplicateWarning(null);
    setDuplicateWarningMessage(null);
    setFormOpen(true);
  };

  const openEdit = (client: Client) => {
    setEditingClient(client);
    clientForm.reset({
      name: client.name,
      phone: client.phone,
      sourceId: client.sourceId
        ? String(client.sourceId)
        : String(sources.find((item) => item.name === client.source)?.id || ''),
      source: client.source,
      telegramId: client.telegramId || '',
      vkId: client.vkId || '',
      webId: client.webId || '',
      note: client.note || '',
      status: client.status === 'archived' ? 'archived' : 'active',
    });
    setDuplicateWarning(null);
    setDuplicateWarningMessage(null);
    setFormOpen(true);
  };

  const openRestoreFromArchive = (client: Client) => {
    setEditingClient(client);
    clientForm.reset({
      name: client.name,
      phone: client.phone,
      sourceId: client.sourceId
        ? String(client.sourceId)
        : String(sources.find((item) => item.name === client.source)?.id || ''),
      source: client.source,
      telegramId: client.telegramId || '',
      vkId: client.vkId || '',
      webId: client.webId || '',
      note: client.note || '',
      status: 'active',
    });
    setDuplicateWarning(null);
    setDuplicateWarningMessage(null);
    setFormOpen(true);
  };

  const applySavedView = (view: ClientSavedView) => {
    const filters = view.filters || {};
    setQ(filters.q || '');
    setSourceId(normalizeSavedFilterValue(filters.sourceId));
    setSegment((filters.segment || 'all') as ClientSegment);
    setStatus((filters.status || 'active') as 'active' | 'archived' | 'all');
    setTrainingLevel((filters.trainingLevel || 'all') as TrainingLevel | 'all');
    setVisitCategoryId(normalizeSavedFilterValue(filters.visitCategoryId));
    setVisitCountMin(normalizeNumericFilterInput(filters.visitCountMin));
    setVisitCountMax(normalizeNumericFilterInput(filters.visitCountMax));
    setLastVisitDaysFrom(normalizeNumericFilterInput(filters.lastVisitDaysFrom));
    setLastVisitDaysTo(normalizeNumericFilterInput(filters.lastVisitDaysTo));
    setPage(1);
  };

  const handleSavedViewChange = (value: string) => {
    setSelectedSavedViewId(value);
    if (value === 'none') return;

    const view = savedViews.find((item) => String(item.id) === value);
    if (view) applySavedView(view);
  };

  const resetClientFilters = () => {
    setQ('');
    setSourceId('all');
    setSegment('all');
    setStatus('active');
    setTrainingLevel('all');
    setVisitCategoryId('all');
    setVisitCountMin('');
    setVisitCountMax('');
    setLastVisitDaysFrom('');
    setLastVisitDaysTo('');
    setSelectedSavedViewId('none');
    setPage(1);
  };

  const openSavedViewDialog = () => {
    setSavedViewName(selectedSavedView?.name || '');
    setSavedViewDialogOpen(true);
  };

  const openCallTaskDialog = () => {
    if (!details?.client) return;
    clientCallTaskForm.reset({
      description: '',
      dueAt: '',
      title: `Обзвон: ${details.client.name}`,
    });
    setCallTaskDialogOpen(true);
  };

  const saveCurrentView = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavedViewSaving(true);
    try {
      const res = await apiFetch('/api/clients/views', {
        method: 'POST',
        body: JSON.stringify({
          filters: currentSavedViewFilters,
          name: savedViewName,
        }),
      });

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось сохранить фильтр'));
        return;
      }

      const view = (await res.json()) as ClientSavedView;
      setSavedViews((prev) =>
        [...prev, view].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setSelectedSavedViewId(String(view.id));
      setSavedViewDialogOpen(false);
      toast.success('Фильтр сохранен');
    } finally {
      setSavedViewSaving(false);
    }
  };

  const executeDeleteSavedView = async (view: ClientSavedView) => {
    const res = await apiFetch(`/api/clients/views/${view.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось удалить фильтр'));
      return;
    }

    setSavedViews((prev) => prev.filter((item) => item.id !== view.id));
    setSelectedSavedViewId('none');
    toast.success('Фильтр удален');
  };

  const updateSelectedSavedView = async (view: ClientSavedView) => {
    const res = await apiFetch(`/api/clients/views/${view.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        filters: currentSavedViewFilters,
        name: view.name,
      }),
    });

    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось обновить фильтр'));
      return;
    }

    const updated = (await res.json()) as ClientSavedView;
    setSavedViews((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
    toast.success('Фильтр обновлен');
  };

  const requestUpdateSavedView = (view: ClientSavedView) => {
    setPendingAction({
      confirmLabel: 'Обновить',
      description: `Фильтр «${view.name}» будет перезаписан текущими условиями списка клиентов.`,
      isDestructive: false,
      onConfirm: () => updateSelectedSavedView(view),
      title: 'Обновить сохраненный фильтр?',
    });
  };

  const requestDeleteSavedView = (view: ClientSavedView) => {
    setPendingAction({
      confirmLabel: 'Удалить',
      description: `Сохраненный фильтр «${view.name}» исчезнет только у вашего аккаунта. Клиенты и базы не изменятся.`,
      isDestructive: true,
      onConfirm: () => executeDeleteSavedView(view),
      title: 'Удалить сохраненный фильтр?',
    });
  };

  const loadDetails = useCallback(async (clientId: number) => {
    const requestId = detailsRequestIdRef.current + 1;
    detailsRequestIdRef.current = requestId;
    setDetailsLoading(true);
    try {
      const res = await apiFetch(`/api/clients/${clientId}`);
      if (requestId !== detailsRequestIdRef.current) return;
      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось открыть клиента'));
        return;
      }

      const data = (await res.json()) as ClientDetails;
      if (requestId !== detailsRequestIdRef.current) return;
      setDetails({
        ...data,
        activeCallTasks: data.activeCallTasks || [],
        bookingSeries: data.bookingSeries || [],
        bookingStats: data.bookingStats || {
          activeCount: 0,
          canceledCount: 0,
          nextBookingAt: null,
          paidAmount: 0,
          plannedAmount: 0,
          totalCount: 0,
          upcomingCount: 0,
        },
        bookings: data.bookings || [],
        clientCertificates: data.clientCertificates || [],
        clientSubscriptions: data.clientSubscriptions || [],
        duplicateCandidates: data.duplicateCandidates || [],
        prepaymentSummary: data.prepaymentSummary || {
          activeCertificatesCount: 0,
          activeSubscriptionsCount: 0,
          certificateWarnings: [],
          hasActiveCertificate: false,
          hasActiveSubscription: false,
          subscriptionWarnings: [],
        },
        telephonyCalls: data.telephonyCalls || [],
        timeline: data.timeline || [],
        skillMap: data.skillMap || [],
        trainingNotes: data.trainingNotes || [],
        visits: data.visits || [],
      });
      setTrainingForm({ ...EMPTY_TRAINING_FORM, trainedAt: getTodayDate() });
      setSelectedMergeIds([]);
    } finally {
      if (requestId === detailsRequestIdRef.current) {
        setDetailsLoading(false);
      }
    }
  }, []);

  const closeDetails = () => {
    detailsRequestIdRef.current += 1;
    setDetailsLoading(false);
    setDetails(null);
    setSelectedMergeIds([]);
    setRedemptionDialogSubscription(null);
    setReverseRedemptionDialog(null);
    setCertificateRedemptionDialog(null);
    setCertificateReverseDialog(null);
    if (searchParams.has('clientId')) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete('clientId');
      setSearchParams(nextSearchParams, { replace: true });
    }
  };

  const updateClientSubscriptionInDetails = (subscription: ClientSubscription) => {
    setDetails((current) => {
      if (!current) return current;
      const items = current.clientSubscriptions || [];
      return {
        ...current,
        clientSubscriptions: items.map((item) =>
          item.id === subscription.id ? subscription : item,
        ),
      };
    });
  };

  const updateClientCertificateInDetails = (certificate: ClientCertificate) => {
    setDetails((current) => {
      if (!current) return current;
      const items = current.clientCertificates || [];
      return {
        ...current,
        clientCertificates: items.map((item) =>
          item.id === certificate.id ? certificate : item,
        ),
      };
    });
  };

  const refreshOpenDetails = () => {
    if (details?.client.id) void loadDetails(details.client.id);
  };

  const openRedemptionDialog = (subscription: ClientSubscription) => {
    setRedemptionDialogSubscription(subscription);
    setRedemptionForm({
      comment: '',
      redeemedAt: getTodayDate(),
      trainingKind: subscription.trainingKind === 'personal' ? 'personal' : 'group',
    });
  };

  const handleRedemptionSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!redemptionDialogSubscription) return;

    setRedemptionSaving(true);
    try {
      const res = await apiFetch(
        `/api/client-subscriptions/${redemptionDialogSubscription.id}/redemptions`,
        {
          method: 'POST',
          body: JSON.stringify({
            comment: redemptionForm.comment.trim(),
            quantity: 1,
            redeemedAt: redemptionForm.redeemedAt,
            serviceType: 'training',
            trainingKind: redemptionForm.trainingKind,
          }),
        },
      );

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось списать абонемент'));
        return;
      }

      const data = (await res.json()) as {
        redemption: ClientSubscriptionRedemption;
        subscription: ClientSubscription;
      };
      updateClientSubscriptionInDetails(data.subscription);
      setRedemptionDialogSubscription(null);
      refreshOpenDetails();
      toast.success('Тренировка списана');
    } finally {
      setRedemptionSaving(false);
    }
  };

  const openReverseRedemptionDialog = (
    subscription: ClientSubscription,
    redemption: ClientSubscriptionRedemption,
  ) => {
    setReverseRedemptionDialog({ redemption, subscription });
    setReverseReason('');
  };

  const handleReverseRedemption = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reverseRedemptionDialog) return;

    setReverseSaving(true);
    try {
      const { redemption, subscription } = reverseRedemptionDialog;
      const res = await apiFetch(
        `/api/client-subscriptions/${subscription.id}/redemptions/${redemption.id}/reverse`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: reverseReason.trim() }),
        },
      );

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось отменить списание'));
        return;
      }

      const data = (await res.json()) as {
        redemption: ClientSubscriptionRedemption;
        subscription: ClientSubscription;
      };
      updateClientSubscriptionInDetails(data.subscription);
      setReverseRedemptionDialog(null);
      refreshOpenDetails();
      toast.success('Списание отменено');
    } finally {
      setReverseSaving(false);
    }
  };

  const openCertificateRedemptionDialog = (certificate: ClientCertificate) => {
    setCertificateRedemptionDialog(certificate);
    setCertificateRedemptionForm({
      amount: '',
      comment: '',
      quantity: '1',
      redeemedAt: getTodayDate(),
    });
  };

  const handleCertificateRedemptionSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!certificateRedemptionDialog) return;

    setCertificateRedemptionSaving(true);
    try {
      const body =
        certificateRedemptionDialog.certificateType === 'money'
          ? {
              amount: certificateRedemptionForm.amount,
              comment: certificateRedemptionForm.comment.trim(),
              redeemedAt: certificateRedemptionForm.redeemedAt,
            }
          : {
              comment: certificateRedemptionForm.comment.trim(),
              quantity: certificateRedemptionForm.quantity,
              redeemedAt: certificateRedemptionForm.redeemedAt,
            };
      const res = await apiFetch(
        `/api/certificates/${certificateRedemptionDialog.id}/redemptions`,
        {
          body: JSON.stringify(body),
          method: 'POST',
        },
      );

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось списать сертификат'));
        return;
      }

      const data = (await res.json()) as {
        certificate: ClientCertificate;
        redemption: ClientCertificateRedemption;
      };
      updateClientCertificateInDetails(data.certificate);
      setCertificateRedemptionDialog(null);
      refreshOpenDetails();
      toast.success('Сертификат списан');
    } finally {
      setCertificateRedemptionSaving(false);
    }
  };

  const openCertificateReverseDialog = (
    certificate: ClientCertificate,
    redemption: ClientCertificateRedemption,
  ) => {
    setCertificateReverseDialog({ certificate, redemption });
    setCertificateReverseReason('');
  };

  const handleCertificateReverse = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!certificateReverseDialog) return;

    setCertificateReverseSaving(true);
    try {
      const { certificate, redemption } = certificateReverseDialog;
      const res = await apiFetch(
        `/api/certificates/${certificate.id}/redemptions/${redemption.id}/reverse`,
        {
          body: JSON.stringify({ reason: certificateReverseReason.trim() }),
          method: 'POST',
        },
      );

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось отменить списание сертификата'));
        return;
      }

      const data = (await res.json()) as {
        certificate: ClientCertificate;
        redemption: ClientCertificateRedemption;
      };
      updateClientCertificateInDetails(data.certificate);
      setCertificateReverseDialog(null);
      refreshOpenDetails();
      toast.success('Списание сертификата отменено');
    } finally {
      setCertificateReverseSaving(false);
    }
  };

  const deepLinkedClientId = getQueryPositiveInteger(searchParams.get('clientId'));

  useEffect(() => {
    if (!deepLinkedClientId) return;
    void loadDetails(deepLinkedClientId);
  }, [deepLinkedClientId, loadDetails]);

  const saveClient = async (payload: ClientPayload) => {
    const res = await apiFetch(
      editingClient ? `/api/clients/${editingClient.id}` : '/api/clients',
      {
        method: editingClient ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const apiError = await readApiError(res, 'Не удалось сохранить клиента');
      if (
        apiError.code === 'CLIENT_ARCHIVED_CONFLICT' &&
        apiError.client &&
        !editingClient
      ) {
        setDuplicateWarning(apiError.client);
        setDuplicateWarningMessage(apiError.error);
        return;
      }

      toast.error(apiError.error);
      return;
    }

    const saved = (await res.json()) as ClientDetails;
    setFormOpen(false);
    setDetails(saved);
    toast.success(editingClient ? 'Клиент обновлен' : 'Клиент создан');
    void fetchClients();
  };

  const handleSave = clientForm.handleSubmit(async (values) => {
    const payload: ClientPayload = {
      name: values.name.trim(),
      phone: values.phone,
      sourceId: values.sourceId ? Number(values.sourceId) : undefined,
      source: values.source.trim(),
      telegramId: values.telegramId.trim(),
      vkId: values.vkId.trim(),
      webId: values.webId.trim(),
      note: values.note.trim(),
      status: values.status,
    };

    if (editingClient && editingClient.status !== payload.status) {
      const isArchiving = payload.status === 'archived';
      const clientName = payload.name || editingClient.name;

      setPendingAction({
        confirmLabel: isArchiving ? 'В архив' : 'Восстановить',
        description: isArchiving
          ? `Клиент «${clientName}» исчезнет из активной базы, но история визитов, заметки и задачи сохранятся.`
          : `Клиент «${clientName}» будет восстановлен в активную базу с обновленными данными из формы.`,
        isDestructive: isArchiving,
        onConfirm: () => saveClient(payload),
        title: isArchiving
          ? 'Сохранить и отправить клиента в архив?'
          : 'Сохранить и восстановить клиента?',
      });
      return;
    }

    await saveClient(payload);
  }, (errors) => {
    const firstError = Object.values(errors)[0];
    toast.error(firstError?.message || 'Проверьте поля клиента');
  });

  const executeClientStatusUpdate = async (
    client: Client,
    nextStatus: ClientStatus,
  ) => {
    const isArchiving = nextStatus === 'archived';
    const res = await apiFetch(`/api/clients/${client.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus }),
    });

    if (!res.ok) {
      toast.error(
        await readError(
          res,
          isArchiving
            ? 'Не удалось отправить клиента в архив'
            : 'Не удалось восстановить клиента',
        ),
      );
      return;
    }

    const saved = (await res.json()) as ClientDetails;
    setDetails((current) =>
      current?.client.id === client.id ? saved : current,
    );
    void fetchClients();
    toast.success(isArchiving ? 'Клиент отправлен в архив' : 'Клиент восстановлен');
  };

  const requestClientStatusUpdate = (
    client: Client,
    nextStatus: ClientStatus,
  ) => {
    const isArchiving = nextStatus === 'archived';

    setPendingAction({
      confirmLabel: isArchiving ? 'В архив' : 'Восстановить',
      description: isArchiving
        ? `Клиент «${client.name}» исчезнет из активной базы, но история визитов, заметки и задачи сохранятся. Восстановить можно из фильтра «Архив».`
        : `Клиент «${client.name}» вернется в активную базу. После восстановления проверьте телефон, источник и заметки.`,
      isDestructive: isArchiving,
      onConfirm: () => executeClientStatusUpdate(client, nextStatus),
      title: isArchiving ? 'Отправить клиента в архив?' : 'Восстановить клиента?',
    });
  };

  const executePermanentDelete = async (client: Client) => {
    const res = await apiFetch(`/api/clients/${client.id}/permanent`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось удалить клиента из архива'));
      return;
    }

    if (details?.client.id === client.id) {
      setDetails(null);
    }
    await fetchClients();
    toast.success('Клиент удален из архива');
  };

  const requestPermanentDelete = (client: Client) => {
    setPendingAction({
      confirmLabel: 'Удалить навсегда',
      description: `Клиент «${client.name}» будет удален из архива без возможности восстановления. Сервер разрешит это только если у клиента нет визитов, дневника тренировок, задач обзвона и связанных дублей.`,
      isDestructive: true,
      onConfirm: () => executePermanentDelete(client),
      title: 'Удалить клиента из архива?',
    });
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;

    setPendingActionLoading(true);
    try {
      await pendingAction.onConfirm();
      setPendingAction(null);
    } finally {
      setPendingActionLoading(false);
    }
  };

  const handleTrainingSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!details?.client) return;

    setTrainingSaving(true);
    try {
      const res = await apiFetch(
        `/api/clients/${details.client.id}/training-notes`,
        {
          method: 'POST',
          body: JSON.stringify({
            exerciseResults: toExerciseResultPayload(trainingForm.exerciseResults),
            level: trainingForm.level,
            note: trainingForm.note,
            trainedAt: trainingForm.trainedAt,
          }),
        },
      );

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось сохранить запись тренировки'));
        return;
      }

      const trainingNotes = (await res.json()) as TrainingNote[];
      setDetails({ ...details, trainingNotes });
      setTrainingForm({ ...EMPTY_TRAINING_FORM, trainedAt: getTodayDate() });
      void loadDetails(details.client.id);
      toast.success('Запись тренировки сохранена');
    } finally {
      setTrainingSaving(false);
    }
  };

  const handleSkillMapSave = async (
    skillId: number,
    payload: ClientSkillMapPayload,
  ) => {
    if (!details?.client) return;

    const res = await apiFetch(
      `/api/clients/${details.client.id}/skill-map/${skillId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const message = await readError(res, 'Не удалось сохранить карту навыков');
      toast.error(message);
      throw new Error(message);
    }

    const skillMap = (await res.json()) as ClientSkillMapItem[];
    setDetails((current) =>
      current?.client.id === details.client.id
        ? { ...current, skillMap }
        : current,
    );
    toast.success('Карта навыков обновлена');
  };

  const applyRecommendedExercises = (exerciseIds: number[]) => {
    setTrainingForm((current) => ({
      ...current,
      exerciseResults: exerciseIds.map(createExerciseFormResult),
    }));
  };

  const createClientCallTask = clientCallTaskForm.handleSubmit(async (values) => {
    if (!details?.client) return;

    setCallTaskSaving(true);
    try {
      const res = await apiFetch(
        `/api/clients/${details.client.id}/call-tasks`,
        {
          method: 'POST',
          body: JSON.stringify({
            description: values.description,
            dueAt: values.dueAt || null,
            title: values.title,
          }),
        },
      );

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось создать задачу обзвона'));
        return;
      }

      setCallTaskDialogOpen(false);
      clientCallTaskForm.reset({ ...EMPTY_CALL_TASK_FORM });
      void loadDetails(details.client.id);
      toast.success('Задача обзвона создана');
    } finally {
      setCallTaskSaving(false);
    }
  }, (errors) => {
    const firstError = Object.values(errors)[0];
    toast.error(firstError?.message || 'Проверьте поля задачи');
  });

  const openBookingDay = (startsAt?: string | null) => {
    const date = getLocalDateOnly(startsAt);
    if (!date) return;
    closeDetails();
    navigate(`/admin/bookings?date=${date}`);
  };

  const copyClientPhone = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      toast.success('Телефон скопирован');
    } catch {
      toast.error('Не удалось скопировать телефон');
    }
  };

  const toggleMergeCandidate = (clientId: number) => {
    setSelectedMergeIds((prev) =>
      prev.includes(clientId)
        ? prev.filter((id) => id !== clientId)
        : [...prev, clientId],
    );
  };

  const setDuplicateGroupPrimary = (group: DuplicateGroup, primaryId: number) => {
    const groupKey = getDuplicateGroupKey(group);
    setGroupSelections((prev) => ({
      ...prev,
      [groupKey]: {
        primaryId,
        duplicateIds: [],
      },
    }));
  };

  const toggleDuplicateGroupClient = (group: DuplicateGroup, clientId: number) => {
    const groupKey = getDuplicateGroupKey(group);
    setGroupSelections((prev) => {
      const current = prev[groupKey] || {
        primaryId: getDefaultPrimaryClientId(group.clients),
        duplicateIds: [],
      };

      if (current.primaryId === clientId) return prev;

      const duplicateIds = current.duplicateIds.includes(clientId)
        ? current.duplicateIds.filter((id) => id !== clientId)
        : [...current.duplicateIds, clientId];

      return {
        ...prev,
        [groupKey]: {
          ...current,
          duplicateIds,
        },
      };
    });
  };

  const executeSelectedMerge = async (
    primaryClient: Client,
    duplicateClientIds: number[],
  ) => {
    const res = await apiFetch(`/api/clients/${primaryClient.id}/merge`, {
      method: 'POST',
      body: JSON.stringify({ duplicateClientIds }),
    });

    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось объединить клиентов'));
      return;
    }

    const mergedDetails = (await res.json()) as ClientDetails;
    if (details?.client.id === primaryClient.id) {
      setDetails(mergedDetails);
    }
    setSelectedMergeIds([]);
    void fetchClients();
    if (viewMode === 'duplicates') void fetchDuplicateGroups();
    toast.success('Клиенты объединены');
  };

  const handleMerge = () => {
    if (!details?.client || selectedMergeIds.length === 0) return;

    const primaryClient = details.client;
    const duplicateClientIds = [...selectedMergeIds];
    setPendingAction({
      confirmLabel: 'Объединить',
      description: `Выбранные дубли будут объединены с клиентом «${primaryClient.name}». История визитов будет перенесена, а дубль уйдет в архивную техническую запись.`,
      isDestructive: true,
      onConfirm: () => executeSelectedMerge(primaryClient, duplicateClientIds),
      title: 'Объединить клиентов?',
    });
  };

  const handleMergeDuplicateGroup = (group: DuplicateGroup) => {
    const selection = groupSelections[getDuplicateGroupKey(group)];
    if (!selection?.primaryId || selection.duplicateIds.length === 0) {
      toast.error('Выберите основного клиента и хотя бы один дубль');
      return;
    }

    const primary = group.clients.find(
      (client) => client.id === selection.primaryId,
    );
    if (!primary) return;

    const duplicateClientIds = [...selection.duplicateIds];
    setPendingAction({
      confirmLabel: 'Объединить',
      description: `${duplicateClientIds.length} дубл. будут объединены с клиентом «${primary.name}». История визитов будет перенесена, а дубли уйдут в архивные технические записи.`,
      isDestructive: true,
      onConfirm: async () => {
        await executeSelectedMerge(primary, duplicateClientIds);
        await fetchDuplicateGroups();
      },
      title: 'Объединить группу дублей?',
    });
  };

  const renderSubscriptionHistory = (subscription: ClientSubscription) => {
    const redemptions = subscription.redemptions || [];

    return (
      <div className="mt-3 border-t pt-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          История списаний
        </div>
        {redemptions.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Списаний пока нет.
          </div>
        ) : (
          <div className="space-y-2">
            {redemptions.map((redemption) => (
              <div
                key={redemption.id}
                className="rounded-md border bg-muted/20 p-2 text-xs"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge
                        variant={
                          redemption.status === 'reversed'
                            ? 'outline'
                            : 'default'
                        }
                      >
                        {
                          CLIENT_SUBSCRIPTION_REDEMPTION_STATUS_LABELS[
                            redemption.status
                          ]
                        }
                      </Badge>
                      <span className="text-muted-foreground">
                        {formatDate(redemption.redeemedAt)}
                      </span>
                      <span className="text-muted-foreground">
                        {formatSubscriptionRedemptionService(redemption)}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {formatSubscriptionActor(redemption.redeemedBy)}
                      {redemption.quantity > 1 ? ` · ${redemption.quantity} занятий` : ''}
                    </div>
                    {redemption.comment && (
                      <div className="mt-1 break-words text-foreground">
                        {redemption.comment}
                      </div>
                    )}
                    {redemption.status === 'reversed' && (
                      <div className="mt-1 text-muted-foreground">
                        Отменено:{' '}
                        {formatDateTime(redemption.reversedAt)} ·{' '}
                        {formatSubscriptionActor(redemption.reversedBy)}
                        {redemption.reversalReason
                          ? ` · ${redemption.reversalReason}`
                          : ''}
                      </div>
                    )}
                  </div>
                  {canMutateSubscriptions && redemption.status === 'active' && (
                    <TooltipIconButton
                      type="button"
                      label="Отменить списание"
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        openReverseRedemptionDialog(subscription, redemption)
                      }
                      disabled={reverseSaving}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </TooltipIconButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderPrepaymentWarnings = (warnings: ClientPrepaymentWarning[]) => {
    if (warnings.length === 0) return null;

    return (
      <div className="space-y-2">
        {warnings.map((warning) => (
          <div
            key={warning.id}
            className={cn(
              'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
              warning.level === 'danger'
                ? 'border-destructive/40 bg-destructive/5 text-destructive'
                : warning.level === 'warning'
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'bg-muted/40 text-muted-foreground',
            )}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{warning.text}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderCertificateHistory = (certificate: ClientCertificate) => {
    const redemptions = certificate.redemptions || [];

    return (
      <div className="mt-3 border-t pt-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          История списаний
        </div>
        {redemptions.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Списаний пока нет.
          </div>
        ) : (
          <div className="space-y-2">
            {redemptions.map((redemption) => (
              <div
                key={redemption.id}
                className="rounded-md border bg-muted/20 p-2 text-xs"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge
                        variant={
                          redemption.status === 'reversed'
                            ? 'outline'
                            : 'default'
                        }
                      >
                        {
                          CLIENT_CERTIFICATE_REDEMPTION_STATUS_LABELS[
                            redemption.status
                          ]
                        }
                      </Badge>
                      <span className="text-muted-foreground">
                        {formatDate(redemption.redeemedAt)}
                      </span>
                      <span className="text-muted-foreground">
                        {formatCertificateRedemptionValue(
                          redemption,
                          certificate,
                        )}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {formatSubscriptionActor(redemption.redeemedBy)}
                    </div>
                    {redemption.comment && (
                      <div className="mt-1 break-words text-foreground">
                        {redemption.comment}
                      </div>
                    )}
                    {redemption.status === 'reversed' && (
                      <div className="mt-1 text-muted-foreground">
                        Отменено: {formatDateTime(redemption.reversedAt)} ·{' '}
                        {formatSubscriptionActor(redemption.reversedBy)}
                        {redemption.reversalReason
                          ? ` · ${redemption.reversalReason}`
                          : ''}
                      </div>
                    )}
                  </div>
                  {canMutateCertificates && redemption.status === 'active' && (
                    <TooltipIconButton
                      type="button"
                      label="Отменить списание сертификата"
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        openCertificateReverseDialog(certificate, redemption)
                      }
                      disabled={certificateReverseSaving}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </TooltipIconButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const clientColumns: ColumnDef<Client>[] = [
    {
      accessorKey: 'name',
      header: 'Клиент',
      size: 230,
      cell: ({ row }) => {
        const client = row.original;

        return (
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <UserRoundCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{client.name}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge
                variant="outline"
                className={getStatusBadgeClass(client.status)}
              >
                {client.statusLabel}
              </Badge>
              {client.note && <Badge variant="outline">Есть заметка</Badge>}
            </div>
          </div>
        );
      },
    },
    ...(!isTrainerAccount
      ? ([
          {
            accessorKey: 'phone',
            header: 'Телефон',
            size: 170,
            meta: {
              cellClassName: 'truncate text-muted-foreground',
            },
          },
        ] satisfies ColumnDef<Client>[])
      : []),
    {
      accessorKey: 'source',
      header: 'Источник',
      size: 160,
      meta: {
        cellClassName: 'truncate text-muted-foreground',
      },
    },
    {
      accessorKey: 'segment',
      header: 'Сегмент',
      size: 140,
      cell: ({ row }) => <Badge variant="outline">{row.original.segment}</Badge>,
    },
    {
      id: 'visitCount',
      header: 'Визиты',
      size: 90,
      meta: {
        cellClassName: 'text-right font-medium',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => row.original.stats.visitCount,
    },
    {
      id: 'lastVisit',
      header: 'Последний визит',
      size: 130,
      meta: {
        cellClassName: 'text-muted-foreground',
      },
      cell: ({ row }) => formatDate(row.original.stats.lastVisitAt),
    },
    {
      id: 'actions',
      header: '',
      size: 120,
      meta: {
        cellClassName: 'text-right',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => {
        const client = row.original;

        return (
          <div className="flex justify-end gap-1">
            <TooltipIconButton
              label="Открыть карточку"
              variant="ghost"
              size="icon-sm"
              onClick={() => void loadDetails(client.id)}
            >
              <Eye className="h-4 w-4" />
            </TooltipIconButton>
            {canEdit && !client.mergedIntoUserId && (
              <>
                <TooltipIconButton
                  label="Редактировать клиента"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openEdit(client)}
                >
                  <Pencil className="h-4 w-4" />
                </TooltipIconButton>
                {client.status === 'archived' ? (
                  <>
                    <TooltipIconButton
                      label="Восстановить из архива"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        requestClientStatusUpdate(client, 'active')
                      }
                    >
                      <ArchiveRestore className="h-4 w-4" />
                    </TooltipIconButton>
                    <TooltipIconButton
                      label="Удалить навсегда"
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => requestPermanentDelete(client)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </TooltipIconButton>
                  </>
                ) : (
                  <TooltipIconButton
                    label="Отправить в архив"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      requestClientStatusUpdate(client, 'archived')
                    }
                  >
                    <Archive className="h-4 w-4" />
                  </TooltipIconButton>
                )}
              </>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="min-w-0 space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Клиенты</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Клиентская база, история визитов, заметки и объединение дублей.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={viewMode === 'list' ? 'default' : 'outline'}
            onClick={() => setViewMode('list')}
          >
            Список
          </Button>
          {canMerge && (
            <Button
              variant={viewMode === 'duplicates' ? 'default' : 'outline'}
              onClick={() => setViewMode('duplicates')}
            >
              <GitMerge className="mr-2 h-4 w-4" /> Дубли
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={() =>
              viewMode === 'duplicates'
                ? void fetchDuplicateGroups()
                : void fetchClients()
            }
            disabled={viewMode === 'duplicates' ? duplicatesLoading : loading}
            aria-label="Обновить список клиентов"
            title="Обновить"
          >
            <RefreshCw
              className={`h-4 w-4 ${
                (viewMode === 'duplicates' ? duplicatesLoading : loading)
                  ? 'animate-spin'
                  : ''
              }`}
            />
          </Button>
          {canEdit && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Клиент
            </Button>
          )}
        </div>
      </div>

      {viewMode === 'list' ? (
        <>
          <div className="rounded-md border bg-card p-3">
            <div className="mb-3 flex flex-col gap-2 border-b pb-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  Представление
                  <HelpTooltip>
                    Сохраненный фильтр запоминает текущие условия списка только
                    для вашего аккаунта.
                  </HelpTooltip>
                </div>
                <Select
                  value={selectedSavedViewId}
                  onValueChange={handleSavedViewChange}
                >
                  <SelectTrigger className="w-full sm:w-[280px]">
                    <SelectValue placeholder="Выберите сохраненный фильтр" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без сохраненного фильтра</SelectItem>
                    {savedViews.map((view) => (
                      <SelectItem key={view.id} value={String(view.id)}>
                        {view.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedSavedViewDirty && (
                  <Badge variant="outline" className="w-fit">
                    Изменено
                  </Badge>
                )}
                <div className="text-sm text-muted-foreground">
                  Найдено: {total.toLocaleString('ru-RU')}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={openSavedViewDialog}
                >
                  <Save className="mr-2 h-4 w-4" />
                  Сохранить фильтр
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetClientFilters}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Сбросить
                </Button>
                {selectedSavedView && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => requestUpdateSavedView(selectedSavedView)}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {selectedSavedViewDirty ? 'Обновить текущими' : 'Обновить'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => requestDeleteSavedView(selectedSavedView)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Удалить
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_180px_180px_160px]">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Поиск
                  <HelpTooltip>
                    Ищет по имени, а для обычных ролей еще по телефону и
                    нормализованным цифрам номера.
                  </HelpTooltip>
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={q}
                    onChange={(event) => setQ(event.target.value)}
                    placeholder={isTrainerAccount ? 'Имя клиента' : 'Имя или телефон'}
                    className="pl-9"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Источник
                  <HelpTooltip>
                    Откуда клиент пришел в базу: ресепшн, Instagram, сайт,
                    рекомендация и другие справочные источники.
                  </HelpTooltip>
                </label>
                <Select value={sourceId} onValueChange={setSourceId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все источники</SelectItem>
                    {sources.map((item) => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {item.status === 'archived'
                          ? `${item.name} (архив)`
                          : item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Сегмент
                  <HelpTooltip>
                    {CLIENT_SEGMENT_OPTIONS.map((option) => (
                      <div key={option.value}>
                        <span className="font-medium">{option.label}:</span>{' '}
                        {option.condition}
                      </div>
                    ))}
                  </HelpTooltip>
                </label>
                <Select
                  value={segment}
                  onValueChange={(value) => setSegment(value as ClientSegment)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLIENT_SEGMENT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Статус
                  <HelpTooltip>
                    Активные участвуют в рабочей базе. Архивные хранят историю,
                    но скрыты из операционной работы до восстановления.
                  </HelpTooltip>
                </label>
                <Select
                  value={status}
                  onValueChange={(value) =>
                    setStatus(value as 'active' | 'archived' | 'all')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Активные</SelectItem>
                    <SelectItem value="archived">Архив</SelectItem>
                    <SelectItem value="all">Все статусы</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Визитов от
                  <HelpTooltip>
                    Минимальное количество визитов за всю историю клиента.
                  </HelpTooltip>
                </label>
                <Input
                  min="0"
                  type="number"
                  value={visitCountMin}
                  onChange={(event) => setVisitCountMin(event.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Визитов до
                  <HelpTooltip>
                    Максимальное количество визитов. Удобно для выборок “были
                    1-2 раза”.
                  </HelpTooltip>
                </label>
                <Input
                  min="0"
                  type="number"
                  value={visitCountMax}
                  onChange={(event) => setVisitCountMax(event.target.value)}
                  placeholder="10"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Не были от, дней
                  <HelpTooltip>
                    Показывает клиентов, чей последний визит был не позже
                    указанного количества дней назад.
                  </HelpTooltip>
                </label>
                <Input
                  min="0"
                  type="number"
                  value={lastVisitDaysFrom}
                  onChange={(event) => setLastVisitDaysFrom(event.target.value)}
                  placeholder="7"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Не были до, дней
                  <HelpTooltip>
                    Верхняя граница давности последнего визита. Например, 7-14
                    дней даст клиентов, которые не были примерно одну-две недели.
                  </HelpTooltip>
                </label>
                <Input
                  min="0"
                  type="number"
                  value={lastVisitDaysTo}
                  onChange={(event) => setLastVisitDaysTo(event.target.value)}
                  placeholder="14"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Уровень
                  <HelpTooltip>
                    Последняя оценка тренера в дневнике тренировок клиента.
                  </HelpTooltip>
                </label>
                <Select
                  value={trainingLevel}
                  onValueChange={(value) =>
                    setTrainingLevel(value as TrainingLevel | 'all')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Любой</SelectItem>
                    {TRAINING_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Цель визита
                  <HelpTooltip>
                    Категория визита из справочника: тренировка, игра, мастер
                    класс и другие цели, которые выбирает администратор.
                  </HelpTooltip>
                </label>
                <Select
                  value={visitCategoryId}
                  onValueChange={setVisitCategoryId}
                  disabled={referencesLoading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Любая</SelectItem>
                    {visitCategories.map((item) => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {item.status === 'archived'
                          ? `${item.name} (архив)`
                          : item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="hidden overflow-x-auto rounded-md border bg-card lg:block">
            <DataTable
              columns={clientColumns}
              data={clients}
              emptyText="Клиенты не найдены"
              errorText={error || undefined}
              loading={isInitialLoading}
              loadingText="Загрузка клиентов..."
              minWidthClassName="min-w-[960px] table-fixed"
              onRetry={() => void fetchClients()}
            />
          </div>

          <div className="space-y-3 lg:hidden">
            {isInitialLoading && (
              <div className="rounded-md border bg-card p-6 text-center text-muted-foreground">
                Загрузка клиентов...
              </div>
            )}
            {!isInitialLoading && error && (
              <ErrorState
                compact
                title="Клиенты не загрузились"
                message={error}
                onRetry={() => void fetchClients()}
              />
            )}
            {!isInitialLoading && !error && clients.length === 0 && (
              <div className="rounded-md border bg-card p-6 text-center text-muted-foreground">
                Клиенты не найдены
              </div>
            )}
            {clients.map((client) => (
              <div key={client.id} className="rounded-md border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <UserRoundCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{client.name}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge
                        variant="outline"
                        className={getStatusBadgeClass(client.status)}
                      >
                        {client.statusLabel}
                      </Badge>
                      <Badge variant="outline">{client.segment}</Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void loadDetails(client.id)}
                      aria-label={`Открыть клиента ${client.name}`}
                      title="Открыть"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {canEdit && !client.mergedIntoUserId && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEdit(client)}
                          aria-label={`Редактировать клиента ${client.name}`}
                          title="Редактировать"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {client.status === 'archived' ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() =>
                                requestClientStatusUpdate(client, 'active')
                              }
                              aria-label={`Восстановить клиента ${client.name}`}
                              title="Восстановить"
                            >
                              <ArchiveRestore className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => requestPermanentDelete(client)}
                              aria-label={`Удалить навсегда клиента ${client.name}`}
                              title="Удалить навсегда"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() =>
                              requestClientStatusUpdate(client, 'archived')
                            }
                            aria-label={`Архивировать клиента ${client.name}`}
                            title="Архивировать"
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 text-sm">
                  {!isTrainerAccount && (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Телефон</span>
                      <span className="text-right font-medium">{client.phone}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Источник</span>
                    <span className="text-right">{client.source}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Визиты</span>
                    <span className="font-medium">{client.stats.visitCount}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Последний визит</span>
                    <span>{formatDate(client.stats.lastVisitAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Pagination className="justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                />
              </PaginationItem>
              {paginationItems.map((item, index) => (
                <PaginationItem key={`${item}-${index}`}>
                  {item === 'ellipsis' ? (
                    <PaginationEllipsis />
                  ) : (
                    <PaginationButton
                      isActive={item === page}
                      onClick={() => setPage(item)}
                    >
                      {item}
                    </PaginationButton>
                  )}
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  disabled={page >= totalPages}
                  onClick={() =>
                    setPage((value) => Math.min(totalPages, value + 1))
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </>
      ) : (
        <div className="rounded-md border bg-card">
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">Дубликаты клиентов</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Группы строятся по одинаковому телефону, Telegram, VK или WEB ID.
                Основная запись остается, выбранные дубли переносят в нее историю.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => void fetchDuplicateGroups()}
              disabled={duplicatesLoading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${
                  duplicatesLoading ? 'animate-spin' : ''
                }`}
              />
              Обновить
            </Button>
          </div>

          {duplicatesLoading && duplicateGroups.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              Загрузка дублей...
            </div>
          )}

          {duplicatesError && (
            <div className="p-8 text-center text-destructive">
              {duplicatesError}
            </div>
          )}

          {!duplicatesLoading && !duplicatesError && duplicateGroups.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              Дублей по телефону, Telegram, VK или WEB ID не найдено.
            </div>
          )}

          {duplicateGroups.map((group) => {
            const groupKey = getDuplicateGroupKey(group);
            const selection = groupSelections[groupKey] || {
              primaryId: getDefaultPrimaryClientId(group.clients),
              duplicateIds: [],
            };

            return (
              <div key={groupKey} className="border-t p-4">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium">
                      {getDuplicateGroupLabel(group)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {group.count} записи с одинаковым идентификатором
                    </div>
                  </div>
                  <Button
                    onClick={() => void handleMergeDuplicateGroup(group)}
                    disabled={!selection.primaryId || selection.duplicateIds.length === 0}
                  >
                    <GitMerge className="mr-2 h-4 w-4" />
                    Объединить выбранные
                  </Button>
                </div>

                <div className="overflow-x-auto rounded-md border">
                  <Table className="min-w-[880px] table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[90px]">Основной</TableHead>
                        <TableHead className="w-[100px]">Слить</TableHead>
                        <TableHead className="w-[24%]">Клиент</TableHead>
                        <TableHead className="w-[11%] text-right">
                          Визиты
                        </TableHead>
                        <TableHead className="w-[16%]">Последний визит</TableHead>
                        <TableHead className="w-[18%]">Источник</TableHead>
                        <TableHead className="w-[90px] text-right"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.clients.map((client) => {
                        const isPrimary = selection.primaryId === client.id;
                        const isSelectedDuplicate =
                          selection.duplicateIds.includes(client.id);

                        return (
                          <TableRow key={client.id}>
                            <TableCell>
                              <input
                                type="radio"
                                name={`primary-${groupKey}`}
                                checked={isPrimary}
                                onChange={() =>
                                  setDuplicateGroupPrimary(group, client.id)
                                }
                                className="h-4 w-4"
                              />
                            </TableCell>
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={isSelectedDuplicate}
                                disabled={isPrimary}
                                onChange={() =>
                                  toggleDuplicateGroupClient(group, client.id)
                                }
                                className="h-4 w-4"
                              />
                            </TableCell>
                            <TableCell>
                              <div className="min-w-0">
                                <div className="truncate font-medium">
                                  {client.name}
                                </div>
                                <div className="truncate text-sm text-muted-foreground">
                                  {client.phone}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <Badge
                                    variant="outline"
                                    className={getStatusBadgeClass(client.status)}
                                  >
                                    {client.statusLabel}
                                  </Badge>
                                  {client.note && (
                                    <Badge variant="outline">Есть заметка</Badge>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {client.stats.visitCount}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDate(client.stats.lastVisitAt)}
                            </TableCell>
                            <TableCell className="truncate text-muted-foreground">
                              {client.source}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => void loadDetails(client.id)}
                                aria-label={`Открыть клиента ${client.name}`}
                                title="Открыть"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>
              {editingClient?.status === 'archived' && form.status === 'active'
                ? 'Восстановить клиента'
                : editingClient
                  ? 'Редактировать клиента'
                  : 'Новый клиент'}
            </DialogTitle>
            <DialogDescription>
              {editingClient?.status === 'archived' && form.status === 'active'
                ? 'Проверьте и обновите данные перед возвращением клиента в актуальную базу.'
                : 'Телефон проверяется на дубли и хранится в едином формате.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Имя</label>
                <Input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
                <FieldError>{clientForm.formState.errors.name?.message}</FieldError>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Телефон
                </label>
                <Input
                  required
                  inputMode="tel"
                  value={form.phone}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      phone: formatClientPhone(event.target.value),
                    })
                  }
                  placeholder="+7 (999) 000-00-00"
                />
                <FieldError>{clientForm.formState.errors.phone?.message}</FieldError>
              </div>
            </div>

            {duplicateWarning && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <div className="font-medium text-amber-700 dark:text-amber-300">
                  {duplicateWarningMessage ||
                    (duplicateWarning.status === 'archived'
                      ? 'Клиент с таким телефоном уже есть в архиве'
                      : 'Клиент с таким телефоном уже есть')}
                </div>
                <div className="mt-1 text-muted-foreground">
                  {duplicateWarning.name} · {duplicateWarning.phone}
                </div>
                {duplicateWarning.status === 'archived' && !editingClient ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 w-full"
                    onClick={() => openRestoreFromArchive(duplicateWarning)}
                  >
                    <ArchiveRestore className="mr-2 h-4 w-4" />
                    Восстановить и отредактировать
                  </Button>
                ) : (
                  <button
                    type="button"
                    className="mt-2 text-left text-muted-foreground underline"
                    onClick={() => {
                      setFormOpen(false);
                      void loadDetails(duplicateWarning.id);
                    }}
                  >
                    Открыть карточку
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Источник
                </label>
                <Select
                  value={form.sourceId}
                  onValueChange={(sourceId) => {
                    const source = sources.find(
                      (item) => String(item.id) === sourceId,
                    );
                    setForm({
                      ...form,
                      sourceId,
                      source: source?.name || form.source,
                    });
                  }}
                  disabled={referencesLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите источник" />
                  </SelectTrigger>
                  <SelectContent>
                    {formSourceOptions.map((source) => (
                      <SelectItem key={source.id} value={String(source.id)}>
                        {source.status === 'archived'
                          ? `${source.name} (архив)`
                          : source.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError>{clientForm.formState.errors.sourceId?.message}</FieldError>
              </div>
              {editingClient && (
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    Статус
                  </label>
                  <Select
                    value={form.status}
                    onValueChange={(value) =>
                      setForm({
                        ...form,
                        status: value as 'active' | 'archived',
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Активен</SelectItem>
                      <SelectItem value="archived">В архиве</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="rounded-md border p-3">
              <div className="text-sm font-medium">Внешние идентификаторы</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Необязательно. Используются для поиска дублей по Telegram, VK и
                web-коду клиента.
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    Telegram ID
                  </label>
                  <Input
                    value={form.telegramId}
                    onChange={(event) =>
                      setForm({ ...form, telegramId: event.target.value })
                    }
                    placeholder="@username или id"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    VK ID
                  </label>
                  <Input
                    value={form.vkId}
                    onChange={(event) =>
                      setForm({ ...form, vkId: event.target.value })
                    }
                    placeholder="vk id"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    WEB ID
                  </label>
                  <Input
                    value={form.webId}
                    onChange={(event) =>
                      setForm({ ...form, webId: event.target.value })
                    }
                    placeholder="web id"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">
                Заметка
              </label>
              <textarea
                value={form.note}
                onChange={(event) =>
                  setForm({ ...form, note: event.target.value })
                }
                className="min-h-[120px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Что важно знать администраторам и менеджеру"
              />
            </div>

            <Button type="submit" className="w-full">
              Сохранить
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={savedViewDialogOpen} onOpenChange={setSavedViewDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Сохранить фильтр клиентов</DialogTitle>
            <DialogDescription>
              Представление сохранится только для вашего аккаунта и не изменит
              клиентскую базу.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveCurrentView} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium">
                Название
              </label>
              <Input
                required
                value={savedViewName}
                onChange={(event) => setSavedViewName(event.target.value)}
                placeholder="Например: Новые с ресепшена"
              />
            </div>
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              Текущие условия: сегмент{' '}
              {
                CLIENT_SEGMENT_OPTIONS.find((item) => item.value === segment)
                  ?.label
              }
              , статус{' '}
              {status === 'active'
                ? 'активные'
                : status === 'archived'
                  ? 'архив'
                  : 'все'}
              {q.trim() ? `, поиск «${q.trim()}»` : ''}
              {sourceId !== 'all'
                ? `, источник ${
                    sources.find((source) => String(source.id) === sourceId)
                      ?.name || sourceId
                  }`
                : ''}
              {visitCategoryId !== 'all'
                ? `, цель визита ${
                    visitCategories.find(
                      (category) => String(category.id) === visitCategoryId,
                    )?.name || visitCategoryId
                  }`
                : ''}
              {trainingLevel !== 'all' ? `, уровень ${trainingLevel}` : ''}
              {visitCountMin ? `, визитов от ${visitCountMin}` : ''}
              {visitCountMax ? `, визитов до ${visitCountMax}` : ''}
              {lastVisitDaysFrom ? `, не были от ${lastVisitDaysFrom} дн.` : ''}
              {lastVisitDaysTo ? `, не были до ${lastVisitDaysTo} дн.` : ''}
              .
            </div>
            <Button type="submit" className="w-full" disabled={savedViewSaving}>
              <Save className="mr-2 h-4 w-4" />
              {savedViewSaving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={callTaskDialogOpen} onOpenChange={setCallTaskDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Создать задачу обзвона</DialogTitle>
            <DialogDescription>
              В задачу попадет только текущий клиент. Дальше она появится в
              разделе задач обзвона.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createClientCallTask} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium">
                Название
              </label>
              <Input
                required
                value={callTaskForm.title}
                onChange={(event) =>
                  setCallTaskForm({
                    ...callTaskForm,
                    title: event.target.value,
                  })
                }
              />
              <FieldError>
                {clientCallTaskForm.formState.errors.title?.message}
              </FieldError>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Дедлайн
              </label>
              <Input
                type="datetime-local"
                value={callTaskForm.dueAt}
                onChange={(event) =>
                  setCallTaskForm({
                    ...callTaskForm,
                    dueAt: event.target.value,
                  })
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Комментарий
              </label>
              <textarea
                value={callTaskForm.description}
                onChange={(event) =>
                  setCallTaskForm({
                    ...callTaskForm,
                    description: event.target.value,
                  })
                }
                className="min-h-[110px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Что нужно выяснить или предложить клиенту"
              />
            </div>
            <Button type="submit" className="w-full" disabled={callTaskSaving}>
              <MessageSquareText className="mr-2 h-4 w-4" />
              {callTaskSaving ? 'Создание...' : 'Создать задачу'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(redemptionDialogSubscription)}
        onOpenChange={(open) => !open && setRedemptionDialogSubscription(null)}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Списать тренировку</DialogTitle>
            <DialogDescription>
              {redemptionDialogSubscription?.typeName || 'Абонемент клиента'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRedemptionSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Дата
                </label>
                <Input
                  type="date"
                  value={redemptionForm.redeemedAt}
                  onChange={(event) =>
                    setRedemptionForm((prev) => ({
                      ...prev,
                      redeemedAt: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Тренировка
                </label>
                <Select
                  value={redemptionForm.trainingKind}
                  onValueChange={(value) =>
                    setRedemptionForm((prev) => ({
                      ...prev,
                      trainingKind: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="group">Групповая</SelectItem>
                    <SelectItem value="personal">Персональная</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Остаток</span>
                <span className="font-medium">
                  {redemptionDialogSubscription
                    ? formatSubscriptionRemaining(redemptionDialogSubscription)
                    : '-'}
                </span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-muted-foreground">Действует до</span>
                <span>
                  {formatDate(redemptionDialogSubscription?.expiresAt)}
                </span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Комментарий
              </label>
              <textarea
                value={redemptionForm.comment}
                onChange={(event) =>
                  setRedemptionForm((prev) => ({
                    ...prev,
                    comment: event.target.value,
                  }))
                }
                className="min-h-[96px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Услуга, тренер, бронь или причина ручного списания"
              />
            </div>
            <Button type="submit" className="w-full" disabled={redemptionSaving}>
              <Dumbbell className="mr-2 h-4 w-4" />
              {redemptionSaving ? 'Списание...' : 'Списать 1 тренировку'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(reverseRedemptionDialog)}
        onOpenChange={(open) => !open && setReverseRedemptionDialog(null)}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Отменить списание</DialogTitle>
            <DialogDescription>
              {reverseRedemptionDialog
                ? `${formatDate(reverseRedemptionDialog.redemption.redeemedAt)} · ${reverseRedemptionDialog.subscription.typeName}`
                : 'Абонемент клиента'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleReverseRedemption} className="space-y-4">
            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Списал</span>
                <span className="min-w-0 break-words text-right">
                  {formatSubscriptionActor(
                    reverseRedemptionDialog?.redemption.redeemedBy,
                  )}
                </span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-muted-foreground">Услуга</span>
                <span>
                  {reverseRedemptionDialog
                    ? formatSubscriptionRedemptionService(
                        reverseRedemptionDialog.redemption,
                      )
                    : '-'}
                </span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Причина
              </label>
              <textarea
                value={reverseReason}
                onChange={(event) => setReverseReason(event.target.value)}
                className="min-h-[96px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Например: списали не того клиента"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              variant="outline"
              disabled={reverseSaving}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {reverseSaving ? 'Отмена...' : 'Отменить списание'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(certificateRedemptionDialog)}
        onOpenChange={(open) => !open && setCertificateRedemptionDialog(null)}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Списать сертификат</DialogTitle>
            <DialogDescription>
              {certificateRedemptionDialog
                ? `${certificateRedemptionDialog.code} · ${certificateRedemptionDialog.title}`
                : 'Сертификат клиента'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCertificateRedemptionSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Дата
                </label>
                <Input
                  type="date"
                  value={certificateRedemptionForm.redeemedAt}
                  onChange={(event) =>
                    setCertificateRedemptionForm((prev) => ({
                      ...prev,
                      redeemedAt: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              {certificateRedemptionDialog?.certificateType === 'money' ? (
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    Сумма
                  </label>
                  <Input
                    inputMode="decimal"
                    min="1"
                    type="number"
                    value={certificateRedemptionForm.amount}
                    onChange={(event) =>
                      setCertificateRedemptionForm((prev) => ({
                        ...prev,
                        amount: event.target.value,
                      }))
                    }
                    placeholder={formatCurrency(
                      certificateRedemptionDialog.amountRemaining,
                    )}
                    required
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    Количество
                  </label>
                  <Input
                    inputMode="numeric"
                    min="1"
                    step="1"
                    type="number"
                    value={certificateRedemptionForm.quantity}
                    onChange={(event) =>
                      setCertificateRedemptionForm((prev) => ({
                        ...prev,
                        quantity: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
              )}
            </div>
            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Остаток</span>
                <span className="font-medium">
                  {certificateRedemptionDialog
                    ? formatCertificateBalance(certificateRedemptionDialog)
                    : '-'}
                </span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-muted-foreground">Действует до</span>
                <span>{formatDate(certificateRedemptionDialog?.expiresAt)}</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Комментарий
              </label>
              <textarea
                value={certificateRedemptionForm.comment}
                onChange={(event) =>
                  setCertificateRedemptionForm((prev) => ({
                    ...prev,
                    comment: event.target.value,
                  }))
                }
                className="min-h-[96px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Что оплатили сертификатом или какая услуга списана"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={
                certificateRedemptionSaving ||
                (certificateRedemptionDialog?.certificateType === 'money'
                  ? Number(certificateRedemptionForm.amount) <= 0
                  : Number(certificateRedemptionForm.quantity) <= 0)
              }
            >
              {certificateRedemptionDialog?.certificateType === 'money' ? (
                <WalletCards className="mr-2 h-4 w-4" />
              ) : (
                <PackageCheck className="mr-2 h-4 w-4" />
              )}
              {certificateRedemptionSaving ? 'Списание...' : 'Списать сертификат'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(certificateReverseDialog)}
        onOpenChange={(open) => !open && setCertificateReverseDialog(null)}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Отменить списание сертификата</DialogTitle>
            <DialogDescription>
              {certificateReverseDialog
                ? `${formatDate(certificateReverseDialog.redemption.redeemedAt)} · ${certificateReverseDialog.certificate.code}`
                : 'Сертификат клиента'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCertificateReverse} className="space-y-4">
            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Списал</span>
                <span className="min-w-0 break-words text-right">
                  {formatSubscriptionActor(
                    certificateReverseDialog?.redemption.redeemedBy,
                  )}
                </span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-muted-foreground">Списание</span>
                <span>
                  {certificateReverseDialog
                    ? formatCertificateRedemptionValue(
                        certificateReverseDialog.redemption,
                        certificateReverseDialog.certificate,
                      )
                    : '-'}
                </span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Причина
              </label>
              <textarea
                value={certificateReverseReason}
                onChange={(event) => setCertificateReverseReason(event.target.value)}
                className="min-h-[96px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Например: ошибочно выбрали сертификат"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              variant="outline"
              disabled={certificateReverseSaving}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {certificateReverseSaving ? 'Отмена...' : 'Отменить списание'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(details)} onOpenChange={(open) => !open && closeDetails()}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto p-3 sm:max-w-[980px] sm:p-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-8">
              <Users className="h-5 w-5 text-muted-foreground" />
              {details?.client.name || 'Клиент'}
            </DialogTitle>
            <DialogDescription>
              Карточка клиента, бронирования, история визитов и возможные дубли.
            </DialogDescription>
          </DialogHeader>

          {detailsLoading && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Загрузка...
            </div>
          )}

          {details && !detailsLoading && (
            <div className="space-y-5">
              <div className="sticky top-0 z-20 -mx-3 flex flex-col gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur sm:-mx-4 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={getStatusBadgeClass(details.client.status)}
                    >
                      {details.client.statusLabel}
                    </Badge>
                    <span className="truncate text-sm text-muted-foreground">
                      {details.client.segment}
                    </span>
                    {details.client.training?.latestLevel && (
                      <Badge variant="outline">
                        Уровень {details.client.training.latestLevel}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!isTrainerAccount && getPhoneHref(details.client.phone) && (
                    <Button asChild variant="outline" size="sm">
                      <a href={getPhoneHref(details.client.phone)}>
                        <PhoneCall className="mr-2 h-4 w-4" />
                        Позвонить
                      </a>
                    </Button>
                  )}
                  {!isTrainerAccount && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void copyClientPhone(details.client.phone)}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Скопировать
                    </Button>
                  )}
                  {canEdit &&
                    canCreateCallTask &&
                    details.client.status !== 'archived' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={openCallTaskDialog}
                      >
                        <MessageSquareText className="mr-2 h-4 w-4" />
                        Задача
                      </Button>
                    )}
                  {canEdit && !details.client.mergedIntoUserId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(details.client)}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Изменить
                    </Button>
                  )}
                </div>
              </div>
              {details.client.mergedIntoUserId && details.mergedInto ? (
                <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-4 text-sm">
                  Этот клиент уже объединен с{' '}
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={() => void loadDetails(details.mergedInto!.id)}
                  >
                    {details.mergedInto.name}
                  </button>
                  .
                </div>
              ) : (
                <>
                  <div
                    className={`grid grid-cols-1 gap-4 ${
                      isTrainerAccount ? 'md:grid-cols-2' : 'md:grid-cols-3'
                    }`}
                  >
                    {!isTrainerAccount && (
                      <div className="min-w-0 rounded-md border p-4">
                        <div className="text-xs text-muted-foreground">
                          Телефон
                        </div>
                        <div className="mt-1 flex items-center gap-2 font-medium">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          {details.client.phone}
                        </div>
                      </div>
                    )}
                    <div className="min-w-0 rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">
                        Визитов
                      </div>
                      <div className="mt-1 text-2xl font-bold">
                        {details.client.stats.visitCount}
                      </div>
                    </div>
                    <div className="min-w-0 rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">
                        Последний визит
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-2 font-medium">
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                        <span className="min-w-0 break-words">
                          {formatDateTime(details.client.stats.lastVisitAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="min-w-0 rounded-md border p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="font-medium">Данные клиента</div>
                        {canEdit && (
                          <div className="flex flex-wrap justify-end gap-2">
                            {canCreateCallTask &&
                              details.client.status !== 'archived' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={openCallTaskDialog}
                                >
                                  <MessageSquareText className="mr-2 h-4 w-4" />
                                  Задача
                                </Button>
                              )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEdit(details.client)}
                            >
                              <Pencil className="mr-2 h-4 w-4" /> Изменить
                            </Button>
                            {details.client.status === 'archived' ? (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    requestClientStatusUpdate(
                                      details.client,
                                      'active',
                                    )
                                  }
                                >
                                  <ArchiveRestore className="mr-2 h-4 w-4" />
                                  Восстановить
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() =>
                                    requestPermanentDelete(details.client)
                                  }
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Удалить
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  requestClientStatusUpdate(
                                    details.client,
                                    'archived',
                                  )
                                }
                              >
                                <Archive className="mr-2 h-4 w-4" />
                                В архив
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">
                            Источник
                          </span>
                          <span className="min-w-0 break-words text-right">
                            {details.client.source}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">
                            Первый визит
                          </span>
                          <span className="min-w-0 break-words text-right">
                            {formatDateTime(
                              details.client.stats.firstVisitAt,
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">
                            Создан
                          </span>
                          <span className="min-w-0 break-words text-right">
                            {formatDateTime(details.client.createdAt)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">
                            Внешние ID
                          </span>
                          <span className="min-w-0 break-all text-right text-xs">
                            {[
                              details.client.telegramId &&
                                `TG: ${details.client.telegramId}`,
                              details.client.vkId &&
                                `VK: ${details.client.vkId}`,
                              details.client.webId &&
                                `WEB: ${details.client.webId}`,
                            ]
                              .filter(Boolean)
                              .join(' · ') || '-'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0 rounded-md border p-4">
                      <div className="mb-2 font-medium">Заметка</div>
                      <div className="min-h-[112px] whitespace-pre-wrap text-sm text-muted-foreground">
                        {details.client.note || 'Заметка пока не заполнена.'}
                      </div>
                    </div>
                  </div>

                  {canViewSubscriptions && (
                    <div className="rounded-md border">
                      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 font-medium">
                            <Ticket className="h-4 w-4 text-muted-foreground" />
                            Абонементы
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            Остаток занятий, срок действия и история списаний.
                          </div>
                        </div>
                        <Badge variant="outline">
                          {activeClientSubscriptions.length} активных
                        </Badge>
                      </div>
                      <div className="space-y-4 p-4">
                        {renderPrepaymentWarnings(subscriptionWarnings)}
                        {clientSubscriptions.length === 0 ? (
                          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                            Абонементов по клиенту пока нет.
                          </div>
                        ) : (
                          <>
                            {activeClientSubscriptions.length > 0 && (
                              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                {activeClientSubscriptions.map((subscription) => (
                                  <div
                                    key={subscription.id}
                                    className="rounded-md border p-3 text-sm"
                                  >
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="min-w-0">
                                        <div className="break-words font-medium">
                                          {subscription.typeName}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                          <Badge variant="default">
                                            {
                                              CLIENT_SUBSCRIPTION_STATUS_LABELS[
                                                subscription.status
                                              ]
                                            }
                                          </Badge>
                                          {subscription.trainingKind && (
                                            <Badge variant="outline">
                                              {SUBSCRIPTION_TRAINING_KIND_LABELS[
                                                subscription.trainingKind
                                              ] || subscription.trainingKind}
                                            </Badge>
                                          )}
                                          {subscription.timeSegment && (
                                            <Badge variant="outline">
                                              {SUBSCRIPTION_TIME_SEGMENT_LABELS[
                                                subscription.timeSegment
                                              ] || subscription.timeSegment}
                                            </Badge>
                                          )}
                                          {getSubscriptionWarning(subscription) && (
                                            <Badge variant="secondary">
                                              {getSubscriptionWarning(subscription)}
                                            </Badge>
                                          )}
                                        </div>
                                      </div>
                                      <div className="shrink-0 text-right">
                                        <div className="text-lg font-semibold">
                                          {formatSubscriptionRemaining(
                                            subscription,
                                          )}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                          осталось
                                        </div>
                                        {canMutateSubscriptions && (
                                          <Button
                                            type="button"
                                            size="sm"
                                            className="mt-2"
                                            onClick={() =>
                                              openRedemptionDialog(subscription)
                                            }
                                          >
                                            <Dumbbell className="mr-2 h-4 w-4" />
                                            Списать
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                                      <div>
                                        Начало: {formatDate(subscription.startsAt)}
                                      </div>
                                      <div>
                                        До: {formatDate(subscription.expiresAt)}
                                      </div>
                                      <div>
                                        Использовано: {subscription.sessionsUsed}
                                      </div>
                                      <div>
                                        Оплата:{' '}
                                        {formatCurrency(subscription.saleAmount)}
                                      </div>
                                    </div>
                                    {subscription.bonusPersonalSessions > 0 && (
                                      <div className="mt-2 text-xs text-muted-foreground">
                                        Бонусные персональные:{' '}
                                        {subscription.bonusPersonalSessions}
                                      </div>
                                    )}
                                    {renderSubscriptionHistory(subscription)}
                                  </div>
                                ))}
                              </div>
                            )}

                            {historicalClientSubscriptions.length > 0 && (
                              <div className="overflow-x-auto rounded-md border">
                                <Table className="min-w-[720px] table-fixed">
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Тип</TableHead>
                                      <TableHead className="w-[130px]">
                                        Статус
                                      </TableHead>
                                      <TableHead className="w-[150px]">
                                        Остаток
                                      </TableHead>
                                      <TableHead className="w-[140px]">
                                        Срок
                                      </TableHead>
                                      <TableHead className="w-[130px]">
                                        Оплата
                                      </TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {historicalClientSubscriptions.map(
                                      (subscription) => (
                                        <Fragment key={subscription.id}>
                                          <TableRow>
                                            <TableCell className="truncate font-medium">
                                              {subscription.typeName}
                                            </TableCell>
                                            <TableCell>
                                              <Badge variant="outline">
                                                {
                                                  CLIENT_SUBSCRIPTION_STATUS_LABELS[
                                                    subscription.status
                                                  ]
                                                }
                                              </Badge>
                                            </TableCell>
                                            <TableCell>
                                              {formatSubscriptionRemaining(
                                                subscription,
                                              )}
                                            </TableCell>
                                            <TableCell>
                                              {formatDate(subscription.expiresAt)}
                                            </TableCell>
                                            <TableCell>
                                              {formatCurrency(
                                                subscription.saleAmount,
                                              )}
                                            </TableCell>
                                          </TableRow>
                                          <TableRow>
                                            <TableCell colSpan={5}>
                                              {renderSubscriptionHistory(
                                                subscription,
                                              )}
                                            </TableCell>
                                          </TableRow>
                                        </Fragment>
                                      ),
                                    )}
                                  </TableBody>
                                </Table>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {canViewClientCertificates && (
                    <div className="rounded-md border">
                      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 font-medium">
                            <Gift className="h-4 w-4 text-muted-foreground" />
                            Сертификаты
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            Остаток номинала или услуг, срок действия и списания.
                          </div>
                        </div>
                        <Badge variant="outline">
                          {activeClientCertificates.length} активных
                        </Badge>
                      </div>
                      <div className="space-y-4 p-4">
                        {renderPrepaymentWarnings(certificateWarnings)}
                        {clientCertificates.length === 0 ? (
                          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                            Сертификатов по клиенту пока нет.
                          </div>
                        ) : (
                          <>
                            {activeClientCertificates.length > 0 && (
                              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                {activeClientCertificates.map((certificate) => (
                                  <div
                                    key={certificate.id}
                                    className="rounded-md border p-3 text-sm"
                                  >
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="min-w-0">
                                        <div className="break-words font-medium">
                                          {certificate.code}
                                        </div>
                                        <div className="mt-0.5 break-words text-xs text-muted-foreground">
                                          {certificate.title}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                          <Badge variant="default">
                                            {
                                              CLIENT_CERTIFICATE_STATUS_LABELS[
                                                certificate.status
                                              ]
                                            }
                                          </Badge>
                                          <Badge variant="outline">
                                            {
                                              CLIENT_CERTIFICATE_TYPE_LABELS[
                                                certificate.certificateType
                                              ]
                                            }
                                          </Badge>
                                          {getCertificateWarning(certificate) && (
                                            <Badge variant="secondary">
                                              {getCertificateWarning(certificate)}
                                            </Badge>
                                          )}
                                        </div>
                                      </div>
                                      <div className="shrink-0 text-right">
                                        <div className="text-lg font-semibold">
                                          {formatCertificateBalance(certificate)}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                          остаток
                                        </div>
                                        {canMutateCertificates && (
                                          <Button
                                            type="button"
                                            size="sm"
                                            className="mt-2"
                                            onClick={() =>
                                              openCertificateRedemptionDialog(
                                                certificate,
                                              )
                                            }
                                          >
                                            {certificate.certificateType === 'money' ? (
                                              <WalletCards className="mr-2 h-4 w-4" />
                                            ) : (
                                              <PackageCheck className="mr-2 h-4 w-4" />
                                            )}
                                            Списать
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                                      <div>
                                        Начало: {formatDate(certificate.startsAt)}
                                      </div>
                                      <div>
                                        До: {formatDate(certificate.expiresAt)}
                                      </div>
                                      <div>
                                        Использовано:{' '}
                                        {certificate.certificateType === 'money'
                                          ? formatCurrency(certificate.amountUsed)
                                          : certificate.unitsUsed}
                                      </div>
                                      <div>
                                        Продажа:{' '}
                                        {formatCurrency(certificate.saleAmount)}
                                      </div>
                                    </div>
                                    {certificate.certificateType === 'service' && (
                                      <div className="mt-2 text-xs text-muted-foreground">
                                        Услуга:{' '}
                                        {certificate.serviceName ||
                                          certificate.serviceType ||
                                          'пакет'}
                                      </div>
                                    )}
                                    {renderCertificateHistory(certificate)}
                                  </div>
                                ))}
                              </div>
                            )}

                            {historicalClientCertificates.length > 0 && (
                              <div className="overflow-x-auto rounded-md border">
                                <Table className="min-w-[720px] table-fixed">
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Код</TableHead>
                                      <TableHead className="w-[130px]">
                                        Статус
                                      </TableHead>
                                      <TableHead className="w-[170px]">
                                        Остаток
                                      </TableHead>
                                      <TableHead className="w-[140px]">
                                        Срок
                                      </TableHead>
                                      <TableHead className="w-[130px]">
                                        Продажа
                                      </TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {historicalClientCertificates.map(
                                      (certificate) => (
                                        <Fragment key={certificate.id}>
                                          <TableRow>
                                            <TableCell className="truncate font-medium">
                                              {certificate.code}
                                            </TableCell>
                                            <TableCell>
                                              <Badge variant="outline">
                                                {
                                                  CLIENT_CERTIFICATE_STATUS_LABELS[
                                                    certificate.status
                                                  ]
                                                }
                                              </Badge>
                                            </TableCell>
                                            <TableCell>
                                              {formatCertificateBalance(
                                                certificate,
                                              )}
                                            </TableCell>
                                            <TableCell>
                                              {formatDate(certificate.expiresAt)}
                                            </TableCell>
                                            <TableCell>
                                              {formatCurrency(
                                                certificate.saleAmount,
                                              )}
                                            </TableCell>
                                          </TableRow>
                                          <TableRow>
                                            <TableCell colSpan={5}>
                                              {renderCertificateHistory(
                                                certificate,
                                              )}
                                            </TableCell>
                                          </TableRow>
                                        </Fragment>
                                      ),
                                    )}
                                  </TableBody>
                                </Table>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {canViewClientTelephony && (
                    <div className="rounded-md border">
                      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 font-medium">
                            <MessageSquareText className="h-4 w-4 text-muted-foreground" />
                            Следующие действия
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {canCreateCallTask &&
                            details.client.status !== 'archived' && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={openCallTaskDialog}
                              >
                                <Plus className="mr-2 h-4 w-4" />
                                Задача
                              </Button>
                            )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              closeDetails();
                              navigate('/admin/call-tasks');
                            }}
                          >
                            Все задачи
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-[1fr_280px]">
                        <div className="space-y-2">
                          {details.activeCallTasks.length === 0 ? (
                            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                              Активных задач по клиенту сейчас нет.
                            </div>
                          ) : (
                            details.activeCallTasks.map((task) => (
                              <div
                                key={`${task.id}-${task.taskClientId}`}
                                className="rounded-md border p-3 text-sm"
                              >
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <div className="break-words font-medium">
                                      {task.title}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      <Badge variant="outline">
                                        {CALL_CLIENT_STATUS_LABELS[task.status] ||
                                          task.status}
                                      </Badge>
                                      {task.clientBase && (
                                        <Badge variant="outline">
                                          {task.clientBase.name}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-muted-foreground">
                                    {task.deadlineAt
                                      ? formatDateTime(task.deadlineAt)
                                      : 'Без дедлайна'}
                                  </div>
                                </div>
                                {task.summary && (
                                  <div className="mt-2 whitespace-pre-wrap text-muted-foreground">
                                    {task.summary}
                                  </div>
                                )}
                                {task.assignedTo && (
                                  <div className="mt-2 text-xs text-muted-foreground">
                                    Исполнитель: {task.assignedTo.name}
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                        <div className="rounded-md border p-3">
                          <MetricLabel
                            tooltip="Ближайшая будущая бронь клиента без отмененных записей."
                          >
                            Ближайшая бронь
                          </MetricLabel>
                          <div className="mt-2 text-sm font-medium">
                            {formatDateTime(details.bookingStats.nextBookingAt)}
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            Всего будущих: {details.bookingStats.upcomingCount}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!isTrainerAccount && (
                    <div className="rounded-md border">
                      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 font-medium">
                            <PhoneCall className="h-4 w-4 text-muted-foreground" />
                            Звонки
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            История телефонии, итоги обработки и связанные задачи.
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">
                            {details.telephonyCalls.length} всего
                          </Badge>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              closeDetails();
                              navigate(
                                `/admin/telephony?q=${encodeURIComponent(
                                  details.client.phone,
                                )}`,
                              );
                            }}
                          >
                            Все звонки
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-3 p-4">
                        {details.telephonyCalls.length === 0 ? (
                          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                            Звонков по клиенту пока нет.
                          </div>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                              <div className="rounded-md border p-3">
                                <MetricLabel tooltip="Все звонки, которые сейчас привязаны к этому клиенту.">
                                  Всего
                                </MetricLabel>
                                <div className="mt-1 text-xl font-semibold">
                                  {details.telephonyCalls.length}
                                </div>
                              </div>
                              <div className="rounded-md border p-3">
                                <MetricLabel tooltip="Звонки со статусом «Пропущен»: клиент или сотрудник не дозвонились.">
                                  Пропущено
                                </MetricLabel>
                                <div className="mt-1 text-xl font-semibold">
                                  {
                                    details.telephonyCalls.filter(
                                      (call) => call.callStatus === 'missed',
                                    ).length
                                  }
                                </div>
                              </div>
                              <div className="rounded-md border p-3">
                                <MetricLabel tooltip="Звонки, по которым оператор уже нажал завершение обработки и заполнил итог.">
                                  Обработано
                                </MetricLabel>
                                <div className="mt-1 text-xl font-semibold">
                                  {
                                    details.telephonyCalls.filter(
                                      (call) =>
                                        call.processingStatus === 'processed',
                                    ).length
                                  }
                                </div>
                              </div>
                              <div className="rounded-md border p-3">
                                <MetricLabel tooltip="Звонки, для которых Билайн вернул доступную запись разговора.">
                                  С записью
                                </MetricLabel>
                                <div className="mt-1 text-xl font-semibold">
                                  {
                                    details.telephonyCalls.filter(
                                      (call) =>
                                        call.recordingStatus === 'available',
                                    ).length
                                  }
                                </div>
                              </div>
                            </div>

                            <div className="space-y-2">
                              {details.telephonyCalls.slice(0, 8).map((call) => (
                                <div
                                  key={call.id}
                                  className="rounded-md border p-3 text-sm"
                                >
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline">
                                          {
                                            TELEPHONY_DIRECTION_LABELS[
                                              call.direction
                                            ]
                                          }
                                        </Badge>
                                        <Badge
                                          variant={
                                            call.callStatus === 'missed'
                                              ? 'destructive'
                                              : 'secondary'
                                          }
                                        >
                                          {
                                            TELEPHONY_CALL_STATUS_LABELS[
                                              call.callStatus
                                            ]
                                          }
                                        </Badge>
                                        <Badge variant="outline">
                                          {
                                            TELEPHONY_PROCESSING_STATUS_LABELS[
                                              call.processingStatus
                                            ]
                                          }
                                        </Badge>
                                        {call.result && (
                                          <Badge variant="outline">
                                            {TELEPHONY_RESULT_LABELS[call.result]}
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="mt-2 text-muted-foreground">
                                        {formatDateTime(
                                          call.startedAt ||
                                            call.processedAt ||
                                            call.createdAt,
                                        )}{' '}
                                        ·{' '}
                                        {formatDuration(call.durationSeconds)} ·{' '}
                                        {
                                          TELEPHONY_RECORDING_LABELS[
                                            call.recordingStatus
                                          ]
                                        }
                                      </div>
                                      {(call.staff || call.processedByAccount) && (
                                        <div className="mt-1 text-xs text-muted-foreground">
                                          Ответственный:{' '}
                                          {call.staff?.name ||
                                            call.processedByAccount?.name}
                                        </div>
                                      )}
                                    </div>
                                    {call.followUpCallTask && (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          closeDetails();
                                          navigate('/admin/call-tasks');
                                        }}
                                      >
                                        Задача
                                      </Button>
                                    )}
                                  </div>
                                  {call.summary && (
                                    <div className="mt-2 whitespace-pre-wrap break-words">
                                      {call.summary}
                                    </div>
                                  )}
                                  {call.nextActionText && (
                                    <div className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                                      Следующий шаг: {call.nextActionText}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {!isTrainerAccount && (
                    <div className="rounded-md border">
                      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 font-medium">
                            <CalendarClock className="h-4 w-4 text-muted-foreground" />
                            Бронирования
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            Обычные брони, постоянки и деньги по броням клиента.
                          </div>
                        </div>
                        <Badge variant="outline">
                          {details.bookingStats.totalCount} всего ·{' '}
                          {details.bookingStats.upcomingCount} будущих
                        </Badge>
                      </div>

                      <div className="space-y-4 p-4">
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">
                              Активных
                            </div>
                            <div className="mt-1 text-xl font-semibold">
                              {details.bookingStats.activeCount}
                            </div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">
                              Следующая
                            </div>
                            <div className="mt-1 truncate text-sm font-medium">
                              {formatDateTime(details.bookingStats.nextBookingAt)}
                            </div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">
                              План
                            </div>
                            <div className="mt-1 text-xl font-semibold">
                              {formatCurrency(details.bookingStats.plannedAmount)}
                            </div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">
                              Оплачено
                            </div>
                            <div className="mt-1 text-xl font-semibold">
                              {formatCurrency(details.bookingStats.paidAmount)}
                            </div>
                          </div>
                        </div>

                        {details.bookingSeries.length > 0 && (
                          <div className="rounded-md border">
                            <div className="border-b px-3 py-2 text-sm font-medium">
                              Постоянки клиента
                            </div>
                            <div className="divide-y">
                              {details.bookingSeries.slice(0, 5).map((series) => (
                                <div
                                  key={series.id}
                                  className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <div className="min-w-0">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <Repeat2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                                      <span className="truncate font-medium">
                                        {series.name}
                                      </span>
                                      <Badge variant="outline">
                                        {series.status === 'active'
                                          ? 'Активна'
                                          : 'Архив'}
                                      </Badge>
                                    </div>
                                    <div className="mt-1 text-muted-foreground">
                                      {series.court?.name || 'Корт не указан'} ·{' '}
                                      {WEEKDAY_LABELS[series.weekday] ||
                                        series.weekday}{' '}
                                      {series.startTime} · {series.durationMinutes}{' '}
                                      мин · {formatDate(series.startsOn)} -{' '}
                                      {formatDate(series.endsOn)}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-muted-foreground">
                                    {series.price !== null && series.price !== undefined
                                      ? formatCurrency(series.price)
                                      : 'По тарифам'}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="overflow-x-auto rounded-md border">
                          <Table className="min-w-[760px] table-fixed">
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[170px]">Дата</TableHead>
                                <TableHead className="w-[140px]">Корт</TableHead>
                                <TableHead className="w-[140px]">Статус</TableHead>
                                <TableHead className="w-[170px]">Оплата</TableHead>
                                <TableHead>Комментарий</TableHead>
                                <TableHead className="w-[90px] text-right"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {details.bookings.length === 0 && (
                                <TableRow>
                                  <TableCell
                                    colSpan={6}
                                    className="py-8 text-center text-muted-foreground"
                                  >
                                    Бронирований пока нет
                                  </TableCell>
                                </TableRow>
                              )}
                              {details.bookings.slice(0, 12).map((booking) => (
                                <TableRow key={booking.id}>
                                  <TableCell>
                                    <div className="font-medium">
                                      {formatDateTime(booking.startsAt)}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {booking.durationMinutes} мин
                                    </div>
                                  </TableCell>
                                  <TableCell className="truncate">
                                    {booking.court?.name || '-'}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex flex-wrap gap-1">
                                      <Badge variant="outline">
                                        {BOOKING_STATUS_LABELS[booking.status] ||
                                          booking.status}
                                      </Badge>
                                      {booking.bookingSeriesId && (
                                        <Badge variant="outline">
                                          Постоянка
                                        </Badge>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="text-sm">
                                      {PAYMENT_STATUS_LABELS[
                                        booking.paymentStatus
                                      ] || booking.paymentStatus}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {formatCurrency(booking.paidAmount)} из{' '}
                                      {formatCurrency(booking.price)} ·{' '}
                                      {PAYMENT_METHOD_LABELS[
                                        booking.paymentMethod
                                      ] || booking.paymentMethod}
                                    </div>
                                  </TableCell>
                                  <TableCell className="truncate text-muted-foreground">
                                    {booking.comment ||
                                      booking.cancellationReason ||
                                      '-'}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        openBookingDay(booking.startsAt)
                                      }
                                    >
                                      День
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-md border">
                    <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2 font-medium">
                          <Activity className="h-4 w-4 text-muted-foreground" />
                          Лента клиента
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          Визиты, брони, обзвоны, тренировки и изменения карточки.
                        </div>
                      </div>
                      <Badge variant="outline">
                        {details.timeline.length} событий
                      </Badge>
                    </div>
                    <div className="max-h-[420px] overflow-y-auto p-3">
                      {details.timeline.length === 0 ? (
                        <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                          История клиента пока пустая.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {details.timeline.map((item) => {
                            const Icon = getTimelineIcon(item.type);
                            const meta = getTimelineMeta(item);

                            return (
                              <div
                                key={item.id}
                                className="grid grid-cols-[32px_1fr] gap-3 rounded-md border p-3"
                              >
                                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                                  <Icon className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline">
                                          {TIMELINE_TYPE_LABELS[item.type]}
                                        </Badge>
                                        <span className="break-words font-medium">
                                          {item.title}
                                        </span>
                                      </div>
                                      {item.actor && (
                                        <div className="mt-1 text-xs text-muted-foreground">
                                          {item.actor.name}
                                        </div>
                                      )}
                                    </div>
                                    <div className="shrink-0 text-sm text-muted-foreground">
                                      {formatDateTime(item.occurredAt)}
                                    </div>
                                  </div>
                                  {meta && (
                                    <div className="mt-2 text-sm text-muted-foreground">
                                      {meta}
                                    </div>
                                  )}
                                  {item.description && (
                                    <div className="mt-2 whitespace-pre-wrap break-words text-sm">
                                      {item.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {canViewTraining && (
                    <ClientSkillMap
                      canEdit={canEditTraining && details.client.status !== 'archived'}
                      disabledReason={
                        details.client.status === 'archived'
                          ? 'Клиент в архиве, карта навыков доступна только для просмотра.'
                          : undefined
                      }
                      items={details.skillMap || []}
                      onSave={handleSkillMapSave}
                    />
                  )}

                  {canViewTraining && (
                    <div className="rounded-md border">
                      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 font-medium">
                            <Dumbbell className="h-4 w-4 text-muted-foreground" />
                            Дневник тренировок
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            Уровень, упражнения и заметки тренера по клиенту.
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4 p-4">
                        {canEditTraining && details.client.status === 'archived' && (
                          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                            Клиент в архиве, дневник тренировок доступен только
                            для просмотра.
                          </div>
                        )}

                        {canEditTraining && details.client.status !== 'archived' && (
                          <TrainingRecommendationPanel
                            clientId={details.client.id}
                            disabled={trainingSaving}
                            onApplyExercises={applyRecommendedExercises}
                          />
                        )}

                        {canEditTraining && details.client.status !== 'archived' && (
                          <form
                            onSubmit={handleTrainingSave}
                            className="rounded-md border p-3"
                          >
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_140px]">
                              <div>
                                <label className="mb-1 block text-xs font-medium">
                                  Дата
                                </label>
                                <Input
                                  type="date"
                                  required
                                  value={trainingForm.trainedAt}
                                  onChange={(event) =>
                                    setTrainingForm({
                                      ...trainingForm,
                                      trainedAt: event.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-medium">
                                  Уровень
                                </label>
                                <Select
                                  value={trainingForm.level}
                                  onValueChange={(value) =>
                                    setTrainingForm({
                                      ...trainingForm,
                                      level: value as TrainingLevel,
                                    })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {TRAINING_LEVELS.map((level) => (
                                      <SelectItem key={level} value={level}>
                                        {level}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div className="mt-3">
                              <TrainingNoteExerciseEditor
                                disabled={trainingSaving}
                                exercises={methodologyExercises}
                                value={trainingForm.exerciseResults}
                                onChange={(exerciseResults) =>
                                  setTrainingForm({
                                    ...trainingForm,
                                    exerciseResults,
                                  })
                                }
                              />
                              {exercisesQuery.isError && (
                                <div className="mt-2 text-sm text-destructive">
                                  Не удалось загрузить упражнения методической базы.
                                </div>
                              )}
                            </div>
                            <div className="mt-3">
                              <label className="mb-1 block text-xs font-medium">
                                Общая заметка
                              </label>
                              <textarea
                                value={trainingForm.note}
                                onChange={(event) =>
                                  setTrainingForm({
                                    ...trainingForm,
                                    note: event.target.value,
                                  })
                                }
                                className="min-h-[90px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                placeholder="Свободное поле для дневника тренировок"
                              />
                            </div>
                            <Button
                              type="submit"
                              className="mt-3 w-full sm:w-auto"
                              disabled={trainingSaving}
                            >
                              <Save className="mr-2 h-4 w-4" />
                              {trainingSaving ? 'Сохранение...' : 'Добавить запись'}
                            </Button>
                          </form>
                        )}

                        {details.trainingNotes.length === 0 ? (
                          <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                            Записей тренера пока нет.
                          </div>
                        ) : (
                          <div className="divide-y rounded-md border">
                            {details.trainingNotes.map((entry) => (
                              <div key={entry.id} className="p-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline">{entry.level}</Badge>
                                    <span className="font-medium">
                                      {formatDate(entry.trainedAt)}
                                    </span>
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {entry.trainer?.name || 'Тренер'}
                                  </div>
                                </div>
                                {entry.exerciseResults?.length > 0 ? (
                                  <TrainingNoteExerciseList results={entry.exerciseResults} />
                                ) : entry.exercises ? (
                                  <div className="mt-3 text-sm">
                                    <span className="text-muted-foreground">
                                      Упражнения:{' '}
                                    </span>
                                    {entry.exercises}
                                  </div>
                                ) : null}
                                {entry.note && (
                                  <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                                    {entry.note}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {canMerge && details.duplicateCandidates.length > 0 && (
                    <div className="rounded-md border border-amber-500/30 p-4">
                      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-medium">Возможные дубли</div>
                          <div className="text-sm text-muted-foreground">
                            Совпадает телефон, Telegram, VK или WEB ID. Активные
                            записи можно объединить, архивные показаны как
                            предупреждение.
                          </div>
                        </div>
                        <Button
                          onClick={handleMerge}
                          disabled={selectedMergeIds.length === 0}
                        >
                          <GitMerge className="mr-2 h-4 w-4" /> Объединить
                        </Button>
                      </div>
                      <div className="divide-y rounded-md border">
                        {details.duplicateCandidates.map((client) => (
                          <label
                            key={client.id}
                            className={`flex flex-col gap-3 p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
                              client.status === 'active'
                                ? 'cursor-pointer hover:bg-muted'
                                : 'bg-muted/30'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-3 self-stretch">
                              <input
                                type="checkbox"
                                checked={selectedMergeIds.includes(client.id)}
                                disabled={client.status !== 'active'}
                                onChange={() => toggleMergeCandidate(client.id)}
                                className="h-4 w-4 shrink-0"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block break-words font-medium">
                                  {client.name}
                                </span>
                                <span className="block break-words text-muted-foreground">
                                  {client.phone} · {client.stats.visitCount} визитов
                                </span>
                                {client.status === 'archived' && (
                                  <span className="mt-1 block text-xs text-muted-foreground">
                                    Архивная запись не объединяется напрямую.
                                    Сначала восстановите ее при необходимости.
                                  </span>
                                )}
                              </span>
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="self-end sm:self-auto"
                              onClick={(event) => {
                                event.preventDefault();
                                void loadDetails(client.id);
                              }}
                            >
                              Открыть
                            </Button>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-md border">
                    <div className="border-b px-4 py-3 font-medium">
                      История визитов
                    </div>
                    <div className="space-y-3 p-3 sm:hidden">
                      {details.visits.length === 0 && (
                        <div className="py-5 text-center text-muted-foreground">
                          Визитов пока нет
                        </div>
                      )}
                      {details.visits.map((visit) => (
                        <div key={visit.id} className="rounded-md border p-3 text-sm">
                          <div className="font-medium">
                            {formatDateTime(visit.scannedAt)}
                          </div>
                          <div className="mt-2 text-muted-foreground">
                            {formatVisitCategories(visit)}
                          </div>
                          <div className="mt-2">
                            {visit.keyNumber ? (
                              <Badge variant="outline">
                                №{visit.keyNumber}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">Без ключа</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden overflow-x-auto sm:block">
                      <Table className="min-w-[620px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Дата</TableHead>
                            <TableHead>Цель визита</TableHead>
                            <TableHead>Ключ</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {details.visits.length === 0 && (
                            <TableRow>
                              <TableCell
                                colSpan={3}
                                className="py-8 text-center text-muted-foreground"
                              >
                                Визитов пока нет
                              </TableCell>
                            </TableRow>
                          )}
                          {details.visits.map((visit) => (
                            <TableRow key={visit.id}>
                              <TableCell>
                                {formatDateTime(visit.scannedAt)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {formatVisitCategories(visit)}
                              </TableCell>
                              <TableCell>
                                {visit.keyNumber ? (
                                  <Badge variant="outline">
                                    №{visit.keyNumber}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        action={pendingAction}
        loading={pendingActionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />
    </div>
  );
}
