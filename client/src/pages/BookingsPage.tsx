import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { type ColumnDef } from '@tanstack/react-table';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Columns3,
  Dumbbell,
  ExternalLink,
  Eye,
  History,
  ListFilter,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  Settings,
  Trash2,
  UserX,
  UsersRound,
  XCircle,
} from 'lucide-react';
import { addDays, format, startOfMonth, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  createBooking,
  createBookingTrainingPlan,
  archiveBookingResource,
  archiveBookingSeries,
  archiveBookingException,
  archiveBookingPriceRule,
  archiveCourtBlock,
  createBookingException,
  createBookingPriceRule,
  createBookingResource,
  createBookingSeries,
  createCourtBlock,
  getBookingAnalytics,
  getBookingTrainingPlan,
  getBookingQuote,
  getBookingSchedule,
  getBookingSettings,
  listBookingResources,
  listBookingResponsibles,
  listBookingHistory,
  listBookingExceptions,
  listBookingPriceRules,
  listBookingSeries,
  previewBookingSeries,
  updateBookingException,
  updateBookingPriceRule,
  updateBookingResource,
  updateBookingSettings,
  updateCourtBlock,
  updateBooking,
  updateBookingStatus,
  type Booking,
  type BookingAnalytics,
  type BookingChangeLog,
  type BookingCourtType,
  type BookingDurationMinutes,
  type BookingExceptionPayload,
  type BookingParticipant,
  type BookingPaymentMethod,
  type BookingPaymentStatus,
  type BookingPriceRulePayload,
  type BookingResponsibleStaff,
  type BookingResourcePayload,
  type BookingSeries,
  type BookingSeriesPayload,
  type BookingSeriesPreview,
  type BookingSource,
  type BookingStatus,
  type BookingSettingsPayload,
  type BookingType,
  type CourtBlock,
  type CourtBlockPayload,
} from '@/api/bookings';
import { searchClients, type ClientListItem } from '@/api/clients';
import {
  quickCompleteTrainingPlan,
  type TrainingPlan,
} from '@/api/training-plans';
import { queryKeys } from '@/api/query-keys';
import { Badge } from '@/components/ui/badge';
import { ClientProfileDialog } from '@/components/client-profile-dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import { DataTable } from '@/components/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { HelpTooltip, MetricLabel } from '@/components/dashboard-metric';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import {
  canManageBookingResources,
  canManageBookings,
  canManageTrainingNotes,
  canViewCertificates,
  canViewClientSubscriptions,
} from '@/lib/permissions';
import { formatClientPhone, getPhoneDigits } from '@/lib/phone';
import { cn } from '@/lib/utils';
import { useAuthorizationRole } from '@/lib/useAuth';

const SLOT_HEIGHT = 38;
const DEFAULT_DAY_START_MINUTES = 8 * 60;
const DEFAULT_DAY_END_MINUTES = 24 * 60;
const DEFAULT_STEP_MINUTES = 30;
const DEFAULT_MIN_BOOKING_DURATION_MINUTES = 60;
const DEFAULT_MAX_BOOKING_DURATION_MINUTES = 240;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type BookingDurationValue = string;

const STATUS_LABELS: Record<BookingStatus, string> = {
  arrived: 'Пришел',
  canceled: 'Отменена',
  confirmed: 'Подтверждена',
  new: 'Новая',
  no_show: 'Не пришел',
};

const PAYMENT_STATUS_LABELS: Record<BookingPaymentStatus, string> = {
  paid: 'Оплачено',
  partial: 'Частично',
  refunded: 'Возврат',
  unpaid: 'Не оплачено',
};

const PAYMENT_METHOD_LABELS: Record<BookingPaymentMethod, string> = {
  cash: 'Наличные',
  cashless: 'Безнал',
  mixed: 'Смешанная',
  unknown: 'Не указано',
};
const HISTORY_ACTION_LABELS: Record<BookingChangeLog['action'], string> = {
  canceled: 'Отмена',
  created: 'Создание',
  rescheduled: 'Перенос',
  status_changed: 'Статус',
  updated: 'Изменение',
};

const SOURCE_LABELS: Record<BookingSource, string> = {
  admin: 'Админ',
  other: 'Другое',
  phone: 'Телефон',
  walk_in: 'На месте',
};
const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  corporate: 'Корпоративный клиент',
  game: 'Игра',
  group_training: 'Групповая тренировка',
  master_class: 'Мастер-класс',
  personal_training: 'Персональная тренировка',
  tournament: 'Турнир',
};
const BOOKING_TYPE_SHORT_LABELS: Record<BookingType, string> = {
  corporate: 'Корпоратив',
  game: 'Игра',
  group_training: 'Группа',
  master_class: 'Мастер-класс',
  personal_training: 'Тренировка',
  tournament: 'Турнир',
};
const TRAINING_BOOKING_TYPES = new Set<BookingType>([
  'group_training',
  'personal_training',
]);
const COURT_TYPE_LABELS: Record<BookingCourtType, string> = {
  all: 'Все ресурсы',
  other: 'Другой ресурс',
  padel_double: 'Падел 2x2',
  padel_single: 'Падел 1x1',
};
const WEEKDAYS = [
  { label: 'Пн', value: 1 },
  { label: 'Вт', value: 2 },
  { label: 'Ср', value: 3 },
  { label: 'Чт', value: 4 },
  { label: 'Пт', value: 5 },
  { label: 'Сб', value: 6 },
  { label: 'Вс', value: 7 },
];

const bookingFormSchema = z
  .object({
    bookingType: z.enum([
      'game',
      'tournament',
      'personal_training',
      'master_class',
      'group_training',
      'corporate',
    ]),
    cancellationReason: z.string(),
    clientName: z.string(),
    comment: z.string(),
    courtId: z.string().min(1, 'Выберите колонку календаря'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Укажите дату'),
    durationMinutes: z.string().regex(/^[1-9]\d*$/, 'Укажите длительность'),
    paidAmount: z.string().refine((value) => !value || Number(value) >= 0, {
      message: 'Оплата не может быть отрицательной',
    }),
    paymentMethod: z.enum(['unknown', 'cash', 'cashless', 'mixed']),
    paymentStatus: z.enum(['unpaid', 'partial', 'paid', 'refunded']),
    phone: z.string().refine((value) => getPhoneDigits(value).length === 10, {
      message: 'Введите телефон клиента',
    }),
    price: z.string().refine((value) => !value || Number(value) >= 0, {
      message: 'Цена не может быть отрицательной',
    }),
    responsibleStaffId: z.string(),
    source: z.enum(['phone', 'admin', 'walk_in', 'other']),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Укажите время'),
    status: z.enum(['new', 'confirmed', 'canceled', 'arrived', 'no_show']),
    userId: z.string(),
  })
  .superRefine((value, ctx) => {
    if (!value.userId && value.clientName.trim().length < 2) {
      ctx.addIssue({
        code: 'custom',
        message: 'Введите имя нового клиента',
        path: ['clientName'],
      });
    }
    if (value.status === 'canceled' && !value.cancellationReason.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Укажите причину отмены',
        path: ['cancellationReason'],
      });
    }
    const price = Number(value.price || 0);
    const paidAmount = Number(value.paidAmount || 0);
    if (price > 0 && paidAmount > price) {
      ctx.addIssue({
        code: 'custom',
        message: 'Оплата не может быть больше цены',
        path: ['paidAmount'],
      });
    }
    if (value.paymentStatus === 'paid' && price > 0 && paidAmount < price) {
      ctx.addIssue({
        code: 'custom',
        message: 'Для полной оплаты внесите всю сумму',
        path: ['paidAmount'],
      });
    }
    if (value.paymentStatus === 'unpaid' && paidAmount > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Для статуса «Не оплачено» сумма должна быть 0',
        path: ['paidAmount'],
      });
    }
  });

type BookingFormValues = z.infer<typeof bookingFormSchema>;

interface LookupClient {
  id: number;
  name: string;
  phone: string;
  prepaymentSummary?: ClientPrepaymentSummary;
  status: 'active' | 'archived';
}

interface LookupResponse {
  client: LookupClient | null;
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

interface BookingClientDetails {
  prepaymentSummary?: ClientPrepaymentSummary;
}

interface GroupParticipantDraft {
  client: {
    id: number;
    name: string;
    phone?: string | null;
    status?: 'active' | 'archived';
  };
  clientId: number;
  id?: number;
}

type ClientLookupState = 'idle' | 'loading' | 'not_found' | 'archived' | 'error';

interface SelectionDraft {
  columnTop: number;
  courtId: number;
  endIndex: number;
  startIndex: number;
}

interface DragTarget {
  courtId: number;
  slotIndex: number;
}

type BookingStatusFilter = BookingStatus | 'active' | 'all';
type BookingPaymentFilter = BookingPaymentStatus | 'needs_payment' | 'all';
type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<boolean | void> | boolean | void;
};
type BookingNoticeLevel = 'danger' | 'info' | 'warning';

interface BookingOperationNotice {
  actionHref?: string;
  actionLabel?: string;
  description?: string;
  id: string;
  level: BookingNoticeLevel;
  title: string;
}

interface BookingHistoryRow {
  details: string[];
  item: BookingChangeLog;
}

interface SettingsDraft {
  cancellationDeadlineHours: string;
  maxDurationMinutes: string;
  minDurationMinutes: string;
  rescheduleDeadlineHours: string;
  workingHoursEnd: string;
  workingHoursStart: string;
}

interface PriceRuleDraft {
  courtType: BookingCourtType;
  endTime: string;
  name: string;
  pricePerHour: string;
  priority: string;
  startTime: string;
  weekdays: number[];
}

interface ResourceDraft {
  id?: number;
  isActive: boolean;
  name: string;
  sortOrder: string;
  type: 'padel_double' | 'padel_single' | 'other';
}

interface BlockDraft {
  courtId: string;
  date: string;
  endTime: string;
  reason: string;
  startTime: string;
}

interface ExceptionDraft {
  date: string;
  isClosed: boolean;
  reason: string;
  workingHoursEnd: string;
  workingHoursStart: string;
}

interface SeriesDraft {
  bookingType: BookingType;
  clientName: string;
  comment: string;
  courtId: string;
  durationMinutes: BookingDurationValue;
  endsOn: string;
  name: string;
  paymentMethod: BookingPaymentMethod;
  paymentStatus: BookingPaymentStatus;
  phone: string;
  price: string;
  responsibleStaffId: string;
  source: BookingSource;
  startTime: string;
  startsOn: string;
  status: Exclude<BookingStatus, 'canceled'>;
  userId: string;
  weekday: string;
}

function getEmptyForm(
  date: string,
  courtId = '',
  startTime = '10:00',
  durationMinutes: BookingDurationValue = '60',
): BookingFormValues {
  return {
    bookingType: 'game',
    cancellationReason: '',
    clientName: '',
    comment: '',
    courtId,
    date,
    durationMinutes,
    paidAmount: '',
    paymentMethod: 'unknown',
    paymentStatus: 'unpaid',
    phone: '',
    price: '',
    responsibleStaffId: 'none',
    source: 'phone',
    startTime,
    status: 'new',
    userId: '',
  };
}

function getEmptyPriceRuleDraft(): PriceRuleDraft {
  return {
    courtType: 'padel_double',
    endTime: '24:00',
    name: '',
    pricePerHour: '',
    priority: '100',
    startTime: '08:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  };
}

function getEmptyResourceDraft(nextSortOrder = 10): ResourceDraft {
  return {
    isActive: true,
    name: '',
    sortOrder: String(nextSortOrder),
    type: 'other',
  };
}

function getEmptyBlockDraft(date: string, courtId = ''): BlockDraft {
  return {
    courtId,
    date,
    endTime: '11:00',
    reason: '',
    startTime: '10:00',
  };
}

function getEmptyExceptionDraft(date: string): ExceptionDraft {
  return {
    date,
    isClosed: false,
    reason: '',
    workingHoursEnd: '24:00',
    workingHoursStart: '08:00',
  };
}

function getEmptySeriesDraft(
  date: string,
  courtId = '',
  durationMinutes: BookingDurationValue = '60',
): SeriesDraft {
  const endsOn = format(addDays(new Date(`${date}T00:00:00`), 28), 'yyyy-MM-dd');
  const weekday = String(getIsoWeekdayFromDate(date));
  return {
    bookingType: 'game',
    clientName: '',
    comment: '',
    courtId,
    durationMinutes,
    endsOn,
    name: '',
    paymentMethod: 'unknown',
    paymentStatus: 'unpaid',
    phone: '',
    price: '',
    responsibleStaffId: 'none',
    source: 'phone',
    startTime: '10:00',
    startsOn: date,
    status: 'confirmed',
    userId: '',
    weekday,
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
    style: 'currency',
    currency: 'RUB',
  }).format(value || 0);
}

function formatTime(value: string | Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function RulesFieldLabel({
  children,
  tooltip,
}: {
  children: ReactNode;
  tooltip: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-sm font-medium leading-none">
      <span>{children}</span>
      <HelpTooltip>{tooltip}</HelpTooltip>
    </div>
  );
}

function RulesSectionTitle({
  children,
  tooltip,
}: {
  children: ReactNode;
  tooltip: ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-1.5 font-semibold">
      <span>{children}</span>
      <HelpTooltip>{tooltip}</HelpTooltip>
    </h3>
  );
}

function toTimeInput(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getIsoWeekdayFromDate(value: string) {
  const day = new Date(`${value}T00:00:00`).getDay();
  return day === 0 ? 7 : day;
}

function getMinutesFromDayStart(value: string, dayStartMinutes: number) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes() - dayStartMinutes;
}

function parseTimeToMinutes(value?: string) {
  if (!value) return null;
  if (value === '24:00') return 24 * 60;
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function getSlotTimes(
  startMinutes = DEFAULT_DAY_START_MINUTES,
  endMinutes = DEFAULT_DAY_END_MINUTES,
  stepMinutes = DEFAULT_STEP_MINUTES,
) {
  const slots: string[] = [];
  for (let minutes = startMinutes; minutes < endMinutes; minutes += stepMinutes) {
    slots.push(minutesToTime(minutes));
  }
  return slots;
}

function minutesToTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function getSlotTimeByIndex(index: number, startMinutes: number, stepMinutes: number) {
  return minutesToTime(startMinutes + index * stepMinutes);
}

function getSlotIndexFromY(clientY: number, columnTop: number, slotCount: number) {
  return Math.max(
    0,
    Math.min(slotCount - 1, Math.floor((clientY - columnTop) / SLOT_HEIGHT)),
  );
}

function clampSlotIndexForDuration(
  slotIndex: number,
  durationMinutes: number,
  slotCount: number,
  stepMinutes: number,
) {
  const requiredSlots = Math.max(1, Math.ceil(durationMinutes / stepMinutes));
  return Math.max(0, Math.min(slotIndex, Math.max(0, slotCount - requiredSlots)));
}

function toDurationValue(
  minutes: number,
  minDurationMinutes = DEFAULT_MIN_BOOKING_DURATION_MINUTES,
  maxDurationMinutes = DEFAULT_MAX_BOOKING_DURATION_MINUTES,
  stepMinutes = DEFAULT_STEP_MINUTES,
): BookingDurationValue {
  const rounded = Math.round(minutes / stepMinutes) * stepMinutes;
  const clamped = Math.max(
    minDurationMinutes,
    Math.min(maxDurationMinutes, rounded),
  );
  return String(clamped);
}

function normalizeSelection(
  startIndex: number,
  endIndex: number,
  slotCount: number,
  stepMinutes: number,
  minDurationMinutes: number,
  maxDurationMinutes: number,
) {
  const minSelectionSlots = Math.max(1, minDurationMinutes / stepMinutes);
  const maxSelectionSlots = Math.max(minSelectionSlots, maxDurationMinutes / stepMinutes);
  let firstIndex = Math.min(startIndex, endIndex);
  const lastIndex = Math.max(startIndex, endIndex);
  const selectedSlots = Math.max(
    minSelectionSlots,
    Math.min(maxSelectionSlots, lastIndex - firstIndex + 1),
  );
  if (firstIndex + selectedSlots > slotCount) {
    firstIndex = Math.max(0, slotCount - selectedSlots);
  }

  return {
    durationMinutes: selectedSlots * stepMinutes,
    slotCount: selectedSlots,
    startIndex: firstIndex,
  };
}

function getBookingCardHeight(durationMinutes: number, stepMinutes: number) {
  return Math.max(SLOT_HEIGHT, (durationMinutes / stepMinutes) * SLOT_HEIGHT - 4);
}

function buildStartsAtIso(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

function getPriceQuoteKey(
  date?: string,
  startTime?: string,
  courtId?: string,
  durationMinutes?: string,
) {
  return [date || '', startTime || '', courtId || '', durationMinutes || ''].join('|');
}

function getStatusClass(status: BookingStatus) {
  if (status === 'confirmed') return 'border-blue-300/80 bg-blue-100/90 text-blue-950 dark:border-blue-700/60 dark:bg-blue-950/70 dark:text-blue-100';
  if (status === 'arrived') return 'border-emerald-300/80 bg-emerald-100/90 text-emerald-950 dark:border-emerald-700/60 dark:bg-emerald-950/70 dark:text-emerald-100';
  if (status === 'canceled') return 'border-muted bg-muted/30 text-muted-foreground';
  if (status === 'no_show') return 'border-rose-300/80 bg-rose-100/90 text-rose-950 dark:border-rose-700/60 dark:bg-rose-950/70 dark:text-rose-100';
  return 'border-violet-300/80 bg-violet-100/90 text-violet-950 dark:border-violet-700/60 dark:bg-violet-950/70 dark:text-violet-100';
}

function getPaymentBadgeClass(status: BookingPaymentStatus) {
  if (status === 'paid') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  if (status === 'partial') return 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300';
  if (status === 'refunded') return 'bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-300';
  return 'bg-muted text-muted-foreground';
}

function formatResponsibleStaff(staff?: BookingResponsibleStaff | null) {
  if (!staff) return 'Не выбран';
  return staff.position ? `${staff.name} · ${staff.position}` : staff.name;
}

function isTrainingBookingType(type?: BookingType | null) {
  return Boolean(type && TRAINING_BOOKING_TYPES.has(type));
}

function mapBookingParticipantToDraft(
  participant: BookingParticipant,
): GroupParticipantDraft | null {
  if (!participant.client) return null;
  return {
    client: participant.client,
    clientId: participant.clientId,
    id: participant.id,
  };
}

function mapClientListItemToDraft(client: ClientListItem): GroupParticipantDraft {
  return {
    client,
    clientId: client.id,
  };
}

function getTrainingPlanStatusLabel(plan?: { status?: string } | null) {
  if (!plan) return 'План не создан';
  return plan.status === 'completed' ? 'Completed' : 'Planned';
}

function isBookingActive(booking: Booking) {
  return booking.status !== 'canceled';
}

function isBookingNeedsPayment(booking: Booking) {
  return (
    isBookingActive(booking) &&
    booking.paymentStatus !== 'paid' &&
    booking.paymentStatus !== 'refunded' &&
    Number(booking.price || 0) > Number(booking.paidAmount || 0)
  );
}

function getDateTime(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function safeFormatTime(value?: string | null) {
  return getDateTime(value) === null ? '-' : formatTime(value as string);
}

function formatBookingTimeWindow(booking: Booking) {
  const startsAt = safeFormatTime(booking.startsAt);
  const endsAt = safeFormatTime(booking.endsAt);
  if (startsAt === '-' && endsAt === '-') return 'Время не сохранено';
  return `${startsAt}-${endsAt}`;
}

function formatBookingPaymentSummary(booking: Booking) {
  const paymentStatus = booking.paymentStatus
    ? PAYMENT_STATUS_LABELS[booking.paymentStatus] || booking.paymentStatus
    : 'Оплата не сохранена';
  return `${paymentStatus} · ${formatCurrency(
    booking.paidAmount,
  )} из ${formatCurrency(booking.price)}`;
}

function formatBookingLocation(booking: Booking) {
  if (!booking.court && !booking.courtId) return 'Ресурс не сохранен';
  return booking.court?.name || `Ресурс #${booking.courtId}`;
}

function getBookingParticipantNames(booking: Booking) {
  const participantNames = (booking.participants || [])
    .map((participant) => participant.client?.name)
    .filter((name): name is string => Boolean(name));
  const names = [booking.clientName, ...participantNames];
  return Array.from(new Set(names)).filter(Boolean);
}

function getBookingParticipantCount(booking: Booking) {
  if (booking.bookingType !== 'group_training') return 1;
  return Math.max(1, getBookingParticipantNames(booking).length);
}

function getBookingClientHref(clientId?: number | null) {
  return clientId ? `/admin/clients?clientId=${clientId}` : '';
}

function formatBookingClientSummary(booking: Booking) {
  return [booking.clientName || 'Клиент не сохранен', booking.clientPhone]
    .filter(Boolean)
    .join(' · ');
}

function formatHistoryReason(reason?: string | null) {
  return String(reason || '').trim();
}

function getBookingHistoryDetails(
  item: BookingChangeLog,
  previousSnapshot?: Booking | null,
) {
  const current = item.snapshot;
  const details: string[] = [];
  const reason = formatHistoryReason(item.reason);

  if (!current) {
    if (reason) details.push(`Причина: ${reason}`);
    return details;
  }

  if (!previousSnapshot) {
    details.push(
      `${formatBookingLocation(current)} · ${formatBookingTimeWindow(current)}`,
      `Клиент: ${formatBookingClientSummary(current)}`,
      `Оплата: ${formatBookingPaymentSummary(current)}`,
    );
  } else {
    const previousStart = getDateTime(previousSnapshot.startsAt);
    const previousEnd = getDateTime(previousSnapshot.endsAt);
    const currentStart = getDateTime(current.startsAt);
    const currentEnd = getDateTime(current.endsAt);
    const timeChanged =
      previousStart !== currentStart ||
      previousEnd !== currentEnd ||
      previousSnapshot.courtId !== current.courtId;
    if (timeChanged) {
      details.push(
        `Время/ресурс: ${formatBookingLocation(previousSnapshot)} ${formatBookingTimeWindow(previousSnapshot)} -> ${formatBookingLocation(current)} ${formatBookingTimeWindow(current)}`,
      );
    }

    if (
      previousSnapshot.clientName !== current.clientName ||
      previousSnapshot.clientPhone !== current.clientPhone
    ) {
      details.push(
        `Клиент: ${formatBookingClientSummary(previousSnapshot)} -> ${formatBookingClientSummary(current)}`,
      );
    }

    if (previousSnapshot.bookingType !== current.bookingType) {
      details.push(
        `Тип: ${BOOKING_TYPE_LABELS[previousSnapshot.bookingType]} -> ${BOOKING_TYPE_LABELS[current.bookingType]}`,
      );
    }

    if (previousSnapshot.status !== current.status) {
      details.push(
        `Статус: ${STATUS_LABELS[previousSnapshot.status]} -> ${STATUS_LABELS[current.status]}`,
      );
    }

    const paymentChanged =
      previousSnapshot.paymentStatus !== current.paymentStatus ||
      previousSnapshot.paymentMethod !== current.paymentMethod ||
      Number(previousSnapshot.paidAmount || 0) !== Number(current.paidAmount || 0) ||
      Number(previousSnapshot.price || 0) !== Number(current.price || 0);
    if (paymentChanged) {
      details.push(
        `Оплата: ${formatBookingPaymentSummary(previousSnapshot)} -> ${formatBookingPaymentSummary(current)}`,
      );
    }

    if (previousSnapshot.responsibleStaffId !== current.responsibleStaffId) {
      details.push(
        `Ответственный: ${formatResponsibleStaff(previousSnapshot.responsibleStaff)} -> ${formatResponsibleStaff(current.responsibleStaff)}`,
      );
    }

    const beforeParticipants = getBookingParticipantNames(previousSnapshot).join(', ');
    const afterParticipants = getBookingParticipantNames(current).join(', ');
    if (
      current.bookingType === 'group_training' &&
      beforeParticipants !== afterParticipants
    ) {
      details.push(`Участники: ${beforeParticipants || '-'} -> ${afterParticipants || '-'}`);
    }

    if (previousSnapshot.comment !== current.comment) {
      details.push('Комментарий администратора изменен');
    }
  }

  if (current.status === 'canceled' && current.cancellationReason) {
    details.push(`Отмена: ${current.cancellationReason}`);
  } else if (reason) {
    details.push(`Причина: ${reason}`);
  }

  return details.slice(0, 6);
}

function buildBookingHistoryRows(items: BookingChangeLog[] = []): BookingHistoryRow[] {
  return items.map((item, index) => ({
    details: getBookingHistoryDetails(item, items[index + 1]?.snapshot),
    item,
  }));
}

function rangesOverlap(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date,
) {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function buildBookingConflictNotice({
  blocks,
  bookings,
  courtId,
  date,
  durationMinutes,
  editingBookingId,
  selectedDate,
  startTime,
}: {
  blocks: CourtBlock[];
  bookings: Booking[];
  courtId?: number | null;
  date?: string;
  durationMinutes?: number | null;
  editingBookingId?: number | null;
  selectedDate: string;
  startTime?: string;
}): BookingOperationNotice | null {
  if (!courtId || !date || !startTime || !durationMinutes) return null;
  if (date !== selectedDate) {
    return {
      description: 'Откройте выбранную дату в расписании, чтобы увидеть соседние брони до сохранения.',
      id: 'date-not-loaded',
      level: 'info',
      title: 'Конфликт времени будет проверен сервером при сохранении',
    };
  }

  const startsAt = new Date(buildStartsAtIso(date, startTime));
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;

  const conflictingBooking = bookings.find((booking) => {
    if (booking.status === 'canceled') return false;
    if (booking.id === editingBookingId) return false;
    if (Number(booking.courtId) !== Number(courtId)) return false;
    return rangesOverlap(
      startsAt,
      endsAt,
      new Date(booking.startsAt),
      new Date(booking.endsAt),
    );
  });

  if (conflictingBooking) {
    return {
      description: `${formatBookingTimeWindow(conflictingBooking)} · ${conflictingBooking.clientName}`,
      id: `booking-conflict-${conflictingBooking.id}`,
      level: 'danger',
      title: `Конфликт: ${formatBookingLocation(conflictingBooking)} уже занят`,
    };
  }

  const conflictingBlock = blocks.find((block) => {
    if (Number(block.courtId) !== Number(courtId)) return false;
    return rangesOverlap(
      startsAt,
      endsAt,
      new Date(block.startsAt),
      new Date(block.endsAt),
    );
  });

  if (conflictingBlock) {
    return {
      description: `${formatTime(conflictingBlock.startsAt)}-${formatTime(conflictingBlock.endsAt)} · ${conflictingBlock.reason}`,
      id: `block-conflict-${conflictingBlock.id}`,
      level: 'danger',
      title: 'Конфликт: на это время стоит блокировка',
    };
  }

  return null;
}

function getBookingSearchText(booking: Booking) {
  return [
    booking.clientName,
    booking.clientPhone,
    booking.court?.name,
    STATUS_LABELS[booking.status],
    PAYMENT_STATUS_LABELS[booking.paymentStatus],
    PAYMENT_METHOD_LABELS[booking.paymentMethod],
    BOOKING_TYPE_LABELS[booking.bookingType],
    booking.responsibleStaff?.name,
    booking.responsibleStaff?.position,
    booking.comment,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isDateOnly(value: string | null) {
  return Boolean(value && DATE_ONLY_PATTERN.test(value));
}

function buildAnalyticsCsv(report: BookingAnalytics) {
  const rows = [
    ['Период', report.range.from, report.range.to],
    [],
    ['Итого'],
    ['Броней', 'Активных', 'Отмен', 'Часы', 'Емкость', 'Загрузка %', 'План', 'Оплачено', 'К оплате'],
    [
      report.total.totalCount,
      report.total.activeCount,
      report.total.canceledCount,
      report.total.bookedHours,
      report.total.capacityHours,
      report.total.occupancyPercent,
      report.total.plannedAmount,
      report.total.paidAmount,
      report.total.unpaidAmount,
    ],
    [],
    ['По ресурсам'],
    ['Ресурс', 'Броней', 'Часы', 'Емкость', 'Загрузка %', 'План', 'Оплачено'],
    ...report.byCourt.map((row) => [
      row.label,
      row.activeCount,
      row.bookedHours,
      row.capacityHours,
      row.occupancyPercent,
      row.plannedAmount,
      row.paidAmount,
    ]),
    [],
    ['По дням'],
    ['Дата', 'Броней', 'Часы', 'Загрузка %', 'План', 'Оплачено'],
    ...report.byDate.map((row) => [
      row.date || row.label,
      row.activeCount,
      row.bookedHours,
      row.occupancyPercent,
      row.plannedAmount,
      row.paidAmount,
    ]),
  ];

  return rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`)
        .join(';'),
    )
    .join('\n');
}

export default function BookingsPage() {
  const clubRole = useAuthorizationRole('club');
  const queryClient = useQueryClient();
  const canEditBookings = canManageBookings(clubRole);
  const canEditBookingResources = canManageBookingResources(clubRole);
  const canCloseTrainingPlans = canManageTrainingNotes(clubRole);
  const canViewBookingCertificates = canViewCertificates(clubRole);
  const canViewBookingSubscriptions = canViewClientSubscriptions(clubRole);
  const [searchParams, setSearchParams] = useSearchParams();
  const priceManuallyEditedRef = useRef(false);
  const priceQuoteBaselineRef = useRef('');
  const lastAutoPriceRef = useRef('');
  const openedBookingIdRef = useRef<number | null>(null);
  const dateFromUrl = searchParams.get('date');
  const requestedBookingId = Number(searchParams.get('bookingId') || 0);
  const [selectedDate, setSelectedDate] = useState(
    isDateOnly(dateFromUrl) ? dateFromUrl! : format(new Date(), 'yyyy-MM-dd'),
  );
  const [formOpen, setFormOpen] = useState(false);
  const [profileClientId, setProfileClientId] = useState<number | null>(null);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [draggingBookingId, setDraggingBookingId] = useState<number | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsFrom, setAnalyticsFrom] = useState(
    format(startOfMonth(new Date()), 'yyyy-MM-dd'),
  );
  const [analyticsTo, setAnalyticsTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [editingPriceRuleId, setEditingPriceRuleId] = useState<number | null>(null);
  const [editingResourceId, setEditingResourceId] = useState<number | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [editingExceptionId, setEditingExceptionId] = useState<number | null>(null);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [seriesDraft, setSeriesDraft] = useState<SeriesDraft>(() => getEmptySeriesDraft(selectedDate));
  const [seriesPreview, setSeriesPreview] = useState<BookingSeriesPreview | null>(null);
  const [seriesLookupClient, setSeriesLookupClient] = useState<LookupClient | null>(null);
  const [seriesLookupState, setSeriesLookupState] = useState<ClientLookupState>('idle');
  const [seriesLookupError, setSeriesLookupError] = useState('');
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookingStatusFilter, setBookingStatusFilter] = useState<BookingStatusFilter>('active');
  const [bookingPaymentFilter, setBookingPaymentFilter] = useState<BookingPaymentFilter>('all');
  const [bookingCourtFilter, setBookingCourtFilter] = useState('all');
  const [paymentBooking, setPaymentBooking] = useState<Booking | null>(null);
  const [paymentMethodDraft, setPaymentMethodDraft] = useState<BookingPaymentMethod>('cashless');
  const [cancelBooking, setCancelBooking] = useState<Booking | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  const [seriesArchiveTarget, setSeriesArchiveTarget] = useState<BookingSeries | null>(null);
  const [seriesArchiveCancelFuture, setSeriesArchiveCancelFuture] = useState(true);
  const [seriesArchiveReason, setSeriesArchiveReason] = useState('Постоянная бронь завершена');
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({
    cancellationDeadlineHours: '0',
    maxDurationMinutes: '240',
    minDurationMinutes: '60',
    rescheduleDeadlineHours: '0',
    workingHoursEnd: '24:00',
    workingHoursStart: '08:00',
  });
  const [priceRuleDraft, setPriceRuleDraft] = useState<PriceRuleDraft>(getEmptyPriceRuleDraft);
  const [resourceDraft, setResourceDraft] = useState<ResourceDraft>(() => getEmptyResourceDraft());
  const [blockDraft, setBlockDraft] = useState<BlockDraft>(() => getEmptyBlockDraft(selectedDate));
  const [exceptionDraft, setExceptionDraft] = useState<ExceptionDraft>(() => getEmptyExceptionDraft(selectedDate));
  const [lookupClient, setLookupClient] = useState<LookupClient | null>(null);
  const [lookupState, setLookupState] = useState<ClientLookupState>('idle');
  const [lookupError, setLookupError] = useState('');
  const [groupParticipants, setGroupParticipants] = useState<GroupParticipantDraft[]>([]);
  const [groupParticipantSearch, setGroupParticipantSearch] = useState('');
  const [trainingPlanBooking, setTrainingPlanBooking] = useState<Booking | null>(null);
  const [trainingPlan, setTrainingPlan] = useState<TrainingPlan | null>(null);
  const [trainingPlanError, setTrainingPlanError] = useState('');
  const [trainingPlanLoading, setTrainingPlanLoading] = useState(false);

  const setBookingDate = useCallback(
    (date: string) => {
      if (!isDateOnly(date)) return;
      setSelectedDate(date);
      setSearchParams({ date }, { replace: true });
    },
    [setSearchParams],
  );

  const bookingForm = useForm<BookingFormValues>({
    defaultValues: getEmptyForm(selectedDate),
    resolver: zodResolver(bookingFormSchema),
  });
  const resetAutoPricing = useCallback((baselineKey = '') => {
    priceManuallyEditedRef.current = false;
    priceQuoteBaselineRef.current = baselineKey;
    lastAutoPriceRef.current = '';
    setPriceManuallyEdited(false);
  }, []);
  const markPriceManuallyEdited = useCallback((value: string) => {
    const isEmpty = value.trim() === '';
    priceManuallyEditedRef.current = !isEmpty;
    if (isEmpty) {
      lastAutoPriceRef.current = '';
    }
    setPriceManuallyEdited(!isEmpty);
  }, []);

  const scheduleQuery = useQuery({
    queryFn: () => getBookingSchedule(selectedDate),
    queryKey: queryKeys.bookings.schedule(selectedDate),
    placeholderData: keepPreviousData,
  });
  const analyticsQuery = useQuery({
    enabled: analyticsOpen,
    queryFn: () => getBookingAnalytics({ from: analyticsFrom, to: analyticsTo }),
    queryKey: queryKeys.bookings.analytics({ from: analyticsFrom, to: analyticsTo }),
    placeholderData: keepPreviousData,
  });
  const responsiblesQuery = useQuery({
    queryFn: listBookingResponsibles,
    queryKey: queryKeys.bookings.responsibles(),
  });
  const resourcesQuery = useQuery({
    enabled: rulesOpen,
    queryFn: () => listBookingResources('all'),
    queryKey: queryKeys.bookings.resources(),
    placeholderData: keepPreviousData,
  });
  const schedule = scheduleQuery.data;
  const analytics = analyticsQuery.data;
  const responsibles = useMemo(
    () => responsiblesQuery.data ?? [],
    [responsiblesQuery.data],
  );
  const bookings = useMemo(() => schedule?.bookings ?? [], [schedule?.bookings]);
  const courts = useMemo(() => schedule?.courts ?? [], [schedule?.courts]);
  const bookingResources = useMemo(
    () => resourcesQuery.data ?? courts,
    [courts, resourcesQuery.data],
  );
  const workingHours = schedule?.workingHours;
  const isScheduleClosed = Boolean(workingHours?.isClosed);
  const stepMinutes = workingHours?.stepMinutes || DEFAULT_STEP_MINUTES;
  const minDurationMinutes =
    workingHours?.minDurationMinutes || DEFAULT_MIN_BOOKING_DURATION_MINUTES;
  const maxDurationMinutes =
    workingHours?.maxDurationMinutes || DEFAULT_MAX_BOOKING_DURATION_MINUTES;
  const dayStartMinutes =
    parseTimeToMinutes(workingHours?.start) ?? DEFAULT_DAY_START_MINUTES;
  const dayEndMinutes =
    parseTimeToMinutes(workingHours?.end) ?? DEFAULT_DAY_END_MINUTES;
  const slots = useMemo(
    () => getSlotTimes(dayStartMinutes, dayEndMinutes, stepMinutes),
    [dayEndMinutes, dayStartMinutes, stepMinutes],
  );
  const durationOptions = useMemo(() => {
    const options: string[] = [];
    for (
      let minutes = minDurationMinutes;
      minutes <= maxDurationMinutes;
      minutes += stepMinutes
    ) {
      options.push(String(minutes));
    }
    return options.length ? options : [String(DEFAULT_MIN_BOOKING_DURATION_MINUTES)];
  }, [maxDurationMinutes, minDurationMinutes, stepMinutes]);
  const bookingDurationOptions = useMemo(() => {
    const options = [...durationOptions];
    if (editingBooking && !options.includes(String(editingBooking.durationMinutes))) {
      options.unshift(String(editingBooking.durationMinutes));
    }
    return options;
  }, [durationOptions, editingBooking]);
  const draggingBooking = useMemo(
    () => bookings.find((booking) => booking.id === draggingBookingId) || null,
    [bookings, draggingBookingId],
  );
  const activeBookings = useMemo(
    () => bookings.filter(isBookingActive),
    [bookings],
  );
  const needsConfirmationCount = useMemo(
    () => activeBookings.filter((booking) => booking.status === 'new').length,
    [activeBookings],
  );
  const needsPaymentBookings = useMemo(
    () => bookings.filter(isBookingNeedsPayment),
    [bookings],
  );
  const upcomingBooking = useMemo(() => (
    [...activeBookings]
      .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())[0] || null
  ), [activeBookings]);
  const filteredBookings = useMemo(() => {
    const search = bookingSearch.trim().toLowerCase();
    const searchDigits = getPhoneDigits(search);

    return bookings.filter((booking) => {
      if (bookingStatusFilter === 'active' && !isBookingActive(booking)) return false;
      if (
        bookingStatusFilter !== 'active' &&
        bookingStatusFilter !== 'all' &&
        booking.status !== bookingStatusFilter
      ) {
        return false;
      }
      if (bookingPaymentFilter === 'needs_payment' && !isBookingNeedsPayment(booking)) return false;
      if (
        bookingPaymentFilter !== 'needs_payment' &&
        bookingPaymentFilter !== 'all' &&
        booking.paymentStatus !== bookingPaymentFilter
      ) {
        return false;
      }
      if (bookingCourtFilter !== 'all' && String(booking.courtId) !== bookingCourtFilter) return false;
      if (!search) return true;

      const haystack = getBookingSearchText(booking);
      const phoneDigits = getPhoneDigits(booking.clientPhone);
      return haystack.includes(search) || (searchDigits.length > 0 && phoneDigits.includes(searchDigits));
    });
  }, [bookingCourtFilter, bookingPaymentFilter, bookingSearch, bookingStatusFilter, bookings]);
  const phoneValue = useWatch({
    control: bookingForm.control,
    name: 'phone',
  });
  const durationValue = useWatch({
    control: bookingForm.control,
    name: 'durationMinutes',
  });
  const dateValue = useWatch({
    control: bookingForm.control,
    name: 'date',
  });
  const startTimeValue = useWatch({
    control: bookingForm.control,
    name: 'startTime',
  });
  const courtIdValue = useWatch({
    control: bookingForm.control,
    name: 'courtId',
  });
  const statusValue = useWatch({
    control: bookingForm.control,
    name: 'status',
  });
  const sourceValue = useWatch({
    control: bookingForm.control,
    name: 'source',
  });
  const bookingTypeValue = useWatch({
    control: bookingForm.control,
    name: 'bookingType',
  });
  const responsibleStaffIdValue = useWatch({
    control: bookingForm.control,
    name: 'responsibleStaffId',
  });
  const paymentStatusValue = useWatch({
    control: bookingForm.control,
    name: 'paymentStatus',
  });
  const paymentMethodValue = useWatch({
    control: bookingForm.control,
    name: 'paymentMethod',
  });
  const priceValue = useWatch({
    control: bookingForm.control,
    name: 'price',
  });
  const paidAmountValue = useWatch({
    control: bookingForm.control,
    name: 'paidAmount',
  });
  const userIdValue = useWatch({
    control: bookingForm.control,
    name: 'userId',
  });
  const clientNameValue = useWatch({
    control: bookingForm.control,
    name: 'clientName',
  });
  const priceQuoteKey = useMemo(
    () => getPriceQuoteKey(dateValue, startTimeValue, courtIdValue, durationValue),
    [courtIdValue, dateValue, durationValue, startTimeValue],
  );
  const selectedBookingId = editingBooking?.id || null;

  const historyQuery = useQuery({
    enabled: Boolean(selectedBookingId),
    queryFn: () => listBookingHistory(selectedBookingId as number),
    queryKey: queryKeys.bookings.history(selectedBookingId),
  });
  const priceRulesQuery = useQuery({
    enabled: rulesOpen,
    queryFn: () => listBookingPriceRules('active'),
    queryKey: queryKeys.bookings.priceRules(),
  });
  const exceptionsQuery = useQuery({
    enabled: rulesOpen,
    queryFn: () => listBookingExceptions('active'),
    queryKey: queryKeys.bookings.exceptions(),
  });
  const seriesQuery = useQuery({
    enabled: seriesOpen,
    queryFn: () => listBookingSeries('active'),
    queryKey: queryKeys.bookings.series(),
    placeholderData: keepPreviousData,
  });
  const groupParticipantSearchQuery = useQuery({
    enabled:
      formOpen &&
      bookingTypeValue === 'group_training' &&
      groupParticipantSearch.trim().length >= 2,
    queryFn: () =>
      searchClients({
        page: 1,
        pageSize: 8,
        q: groupParticipantSearch.trim(),
        status: 'active',
      }),
    queryKey: queryKeys.clients.list({
      bookingGroupParticipants: true,
      q: groupParticipantSearch.trim(),
    }),
  });
  const groupParticipantResults = groupParticipantSearchQuery.data?.items ?? [];
  const selectedGroupParticipantIds = useMemo(
    () => new Set(groupParticipants.map((participant) => participant.clientId)),
    [groupParticipants],
  );
  const primaryGroupClientId = userIdValue ? Number(userIdValue) : null;
  const primaryGroupClientName =
    lookupClient?.name || clientNameValue.trim() || editingBooking?.clientName || '';
  const selectedClientIdForPrepayments = userIdValue ? Number(userIdValue) : null;
  const shouldLoadBookingPrepayments =
    formOpen &&
    Boolean(selectedClientIdForPrepayments) &&
    (canViewBookingCertificates || canViewBookingSubscriptions);
  const bookingClientDetailsQuery = useQuery({
    enabled: shouldLoadBookingPrepayments,
    queryFn: () =>
      apiRequest<BookingClientDetails>(
        `/api/clients/${selectedClientIdForPrepayments}`,
        {},
        'Не удалось загрузить предоплаты клиента',
      ),
    queryKey: queryKeys.clients.detail(selectedClientIdForPrepayments),
  });
  const bookingPrepaymentSummary =
    bookingClientDetailsQuery.data?.prepaymentSummary ||
    lookupClient?.prepaymentSummary ||
    null;
  const selectedBookingClientId =
    selectedClientIdForPrepayments || editingBooking?.userId || null;
  const selectedBookingClientHref =
    clubRole === 'admin' ? '' : getBookingClientHref(selectedBookingClientId);
  const bookingHistoryRows = useMemo(
    () => buildBookingHistoryRows(historyQuery.data || []),
    [historyQuery.data],
  );
  const bookingOperationNotices = useMemo(() => {
    const notices: BookingOperationNotice[] = [];
    const conflictNotice = buildBookingConflictNotice({
      blocks: schedule?.blocks || [],
      bookings,
      courtId: courtIdValue ? Number(courtIdValue) : null,
      date: dateValue,
      durationMinutes: durationValue ? Number(durationValue) : null,
      editingBookingId: editingBooking?.id || null,
      selectedDate,
      startTime: startTimeValue,
    });
    if (conflictNotice) notices.push(conflictNotice);

    const price = Number(priceValue || 0);
    const paidAmount = Number(paidAmountValue || 0);
    const activePaymentStatus =
      statusValue !== 'canceled' &&
      paymentStatusValue !== 'paid' &&
      paymentStatusValue !== 'refunded';
    if (activePaymentStatus && price > paidAmount) {
      notices.push({
        description: `${formatCurrency(Math.max(0, price - paidAmount))} осталось из ${formatCurrency(price)}`,
        id: 'payment-missing',
        level: 'warning',
        title: 'Бронь не закрыта по оплате',
      });
    }

    const hasActiveSubscription =
      canViewBookingSubscriptions && bookingPrepaymentSummary?.hasActiveSubscription;
    const hasActiveCertificate =
      canViewBookingCertificates && bookingPrepaymentSummary?.hasActiveCertificate;
    if (hasActiveSubscription || hasActiveCertificate) {
      const labels = [
        hasActiveSubscription &&
          `${bookingPrepaymentSummary?.activeSubscriptionsCount || 0} абонем.`,
        hasActiveCertificate &&
          `${bookingPrepaymentSummary?.activeCertificatesCount || 0} серт.`,
      ].filter(Boolean);
      notices.push({
        actionHref: selectedBookingClientHref,
        actionLabel: 'Открыть клиента',
        description: `${labels.join(' · ')} Проверьте, нужно ли списать занятие или сертификат.`,
        id: 'active-prepayment',
        level: 'info',
        title: 'У клиента есть активная предоплата',
      });
    }

    if (bookingTypeValue === 'group_training') {
      const total = 1 + groupParticipants.length;
      notices.push({
        description: [
          primaryGroupClientName || 'Основной клиент',
          ...groupParticipants.map((participant) => participant.client.name),
        ].join(', '),
        id: 'group-participants',
        level: total > 1 ? 'info' : 'warning',
        title: `Групповая тренировка: ${total} участн.`,
      });
    }

    return notices;
  }, [
    bookingPrepaymentSummary,
    bookingTypeValue,
    bookings,
    canViewBookingCertificates,
    canViewBookingSubscriptions,
    courtIdValue,
    dateValue,
    durationValue,
    editingBooking?.id,
    groupParticipants,
    paidAmountValue,
    paymentStatusValue,
    priceValue,
    primaryGroupClientName,
    schedule?.blocks,
    selectedBookingClientHref,
    selectedDate,
    startTimeValue,
    statusValue,
  ]);

  const invalidateSchedule = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
  const createMutation = useMutation({
    mutationFn: createBooking,
    onSuccess: invalidateSchedule,
  });
  const updateMutation = useMutation({
    mutationFn: (payload: { id: number; values: Parameters<typeof updateBooking>[1] }) =>
      updateBooking(payload.id, payload.values),
    onSuccess: invalidateSchedule,
  });
  const statusMutation = useMutation({
    mutationFn: (payload: { id: number; reason?: string; status: BookingStatus }) =>
      updateBookingStatus(payload.id, {
        reason: payload.reason,
        status: payload.status,
      }),
    onSuccess: invalidateSchedule,
  });
  const settingsMutation = useMutation({
    mutationFn: updateBookingSettings,
    onSuccess: invalidateSchedule,
  });
  const resourceMutation = useMutation({
    mutationFn: (payload: { id?: number; values: BookingResourcePayload }) =>
      payload.id
        ? updateBookingResource(payload.id, payload.values)
        : createBookingResource(payload.values),
    onSuccess: invalidateSchedule,
  });
  const archiveResourceMutation = useMutation({
    mutationFn: archiveBookingResource,
    onSuccess: invalidateSchedule,
  });
  const priceRuleMutation = useMutation({
    mutationFn: (payload: { id?: number; values: BookingPriceRulePayload }) =>
      payload.id
        ? updateBookingPriceRule(payload.id, payload.values)
        : createBookingPriceRule(payload.values),
    onSuccess: invalidateSchedule,
  });
  const archivePriceRuleMutation = useMutation({
    mutationFn: archiveBookingPriceRule,
    onSuccess: invalidateSchedule,
  });
  const blockMutation = useMutation({
    mutationFn: (payload: { id?: number; values: CourtBlockPayload }) =>
      payload.id ? updateCourtBlock(payload.id, payload.values) : createCourtBlock(payload.values),
    onSuccess: invalidateSchedule,
  });
  const archiveBlockMutation = useMutation({
    mutationFn: archiveCourtBlock,
    onSuccess: invalidateSchedule,
  });
  const exceptionMutation = useMutation({
    mutationFn: (payload: { id?: number; values: BookingExceptionPayload }) =>
      payload.id
        ? updateBookingException(payload.id, payload.values)
        : createBookingException(payload.values),
    onSuccess: invalidateSchedule,
  });
  const archiveExceptionMutation = useMutation({
    mutationFn: archiveBookingException,
    onSuccess: invalidateSchedule,
  });
  const previewSeriesMutation = useMutation({
    mutationFn: previewBookingSeries,
  });
  const createSeriesMutation = useMutation({
    mutationFn: createBookingSeries,
    onSuccess: invalidateSchedule,
  });
  const archiveSeriesMutation = useMutation({
    mutationFn: (payload: { cancelFuture?: boolean; id: number; reason?: string }) =>
      archiveBookingSeries(payload.id, {
        cancelFuture: payload.cancelFuture,
        reason: payload.reason,
      }),
    onSuccess: invalidateSchedule,
  });

  useEffect(() => {
    if (!formOpen) return;
    const digits = getPhoneDigits(phoneValue || '');

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      if (digits.length !== 10) {
        if (cancelled) return;
        setLookupClient(null);
        setLookupState('idle');
        setLookupError('');
        bookingForm.setValue('userId', '');
        return;
      }

      setLookupState('loading');
      setLookupError('');
      try {
        const response = await apiRequest<LookupResponse>(
          `/api/clients/lookup?phone=${encodeURIComponent(phoneValue)}&includeArchived=true`,
          {},
          'Не удалось проверить клиента',
        );
        if (cancelled) return;
        if (!response.client) {
          setLookupClient(null);
          setLookupState('not_found');
          bookingForm.setValue('userId', '');
          return;
        }
        if (response.client.status === 'archived') {
          setLookupClient(response.client);
          setLookupState('archived');
          bookingForm.setValue('userId', '');
          return;
        }

        setLookupClient(response.client);
        setLookupState('idle');
        bookingForm.setValue('userId', String(response.client.id));
        bookingForm.setValue('clientName', response.client.name);
      } catch (error) {
        if (!cancelled) {
          const shouldKeepExistingBookingClient = Boolean(
            editingBooking &&
              getPhoneDigits(editingBooking.clientPhone) === digits,
          );
          setLookupClient(null);
          setLookupState('error');
          setLookupError(getApiErrorMessage(error, 'Не удалось проверить клиента'));
          if (shouldKeepExistingBookingClient && editingBooking) {
            bookingForm.setValue('userId', String(editingBooking.userId));
          } else {
            bookingForm.setValue('userId', '');
          }
        }
      }
    }, digits.length === 10 ? 250 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [bookingForm, editingBooking, formOpen, phoneValue]);

  useEffect(() => {
    if (!seriesOpen) return undefined;
    const digits = getPhoneDigits(seriesDraft.phone || '');

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      if (digits.length !== 10) {
        if (cancelled) return;
        setSeriesLookupClient(null);
        setSeriesLookupState('idle');
        setSeriesLookupError('');
        setSeriesDraft((current) => ({ ...current, userId: '' }));
        return;
      }

      setSeriesLookupState('loading');
      setSeriesLookupError('');
      try {
        const response = await apiRequest<LookupResponse>(
          `/api/clients/lookup?phone=${encodeURIComponent(seriesDraft.phone)}&includeArchived=true`,
          {},
          'Не удалось проверить клиента',
        );
        if (cancelled) return;
        if (!response.client) {
          setSeriesLookupClient(null);
          setSeriesLookupState('not_found');
          setSeriesDraft((current) => ({ ...current, userId: '' }));
          return;
        }
        if (response.client.status === 'archived') {
          setSeriesLookupClient(response.client);
          setSeriesLookupState('archived');
          setSeriesDraft((current) => ({ ...current, userId: '' }));
          return;
        }

        setSeriesLookupClient(response.client);
        setSeriesLookupState('idle');
        setSeriesDraft((current) => ({
          ...current,
          clientName: response.client?.name || current.clientName,
          userId: response.client ? String(response.client.id) : '',
        }));
      } catch (error) {
        if (!cancelled) {
          setSeriesLookupClient(null);
          setSeriesLookupState('error');
          setSeriesLookupError(getApiErrorMessage(error, 'Не удалось проверить клиента'));
          setSeriesDraft((current) => ({ ...current, userId: '' }));
        }
      }
    }, digits.length === 10 ? 250 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [seriesDraft.phone, seriesOpen]);

  useEffect(() => {
    if (bookingTypeValue !== 'group_training') {
      setGroupParticipants([]);
      setGroupParticipantSearch('');
    }
  }, [bookingTypeValue]);

  useEffect(() => {
    if (!primaryGroupClientId) return;
    setGroupParticipants((current) =>
      current.filter((participant) => participant.clientId !== primaryGroupClientId),
    );
  }, [primaryGroupClientId]);

  useEffect(() => {
    if (!formOpen || !canEditBookings || !courtIdValue || !durationValue || !dateValue || !startTimeValue) return undefined;
    if (priceManuallyEdited) return undefined;
    if (
      editingBooking &&
      priceQuoteKey === priceQuoteBaselineRef.current &&
      bookingForm.getValues('price')
    ) {
      return undefined;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        const quote = await getBookingQuote({
          courtId: Number(courtIdValue),
          durationMinutes: Number(durationValue),
          startsAt: buildStartsAtIso(dateValue, startTimeValue),
        });
        if (!cancelled && !priceManuallyEditedRef.current) {
          const nextPrice = quote.price ? String(quote.price) : '';
          lastAutoPriceRef.current = nextPrice;
          bookingForm.setValue('price', nextPrice, {
            shouldDirty: Boolean(nextPrice),
            shouldValidate: true,
          });
        }
      } catch {
        // The server still validates price and rules on save; quote errors should not block editing.
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    bookingForm,
    canEditBookings,
    courtIdValue,
    dateValue,
    durationValue,
    editingBooking,
    formOpen,
    priceManuallyEdited,
    priceQuoteKey,
    startTimeValue,
  ]);

  const openCreate = useCallback((
    courtId = '',
    startTime = '10:00',
    durationMinutes?: BookingDurationValue,
  ) => {
    if (isScheduleClosed || courts.length === 0) return;
    resetAutoPricing('');
    setEditingBooking(null);
    setLookupClient(null);
    setLookupState('idle');
    setLookupError('');
    setGroupParticipants([]);
    setGroupParticipantSearch('');
    bookingForm.reset(
      getEmptyForm(
        selectedDate,
        courtId,
        startTime,
        durationMinutes || String(minDurationMinutes),
      ),
    );
    setFormOpen(true);
  }, [bookingForm, courts.length, isScheduleClosed, minDurationMinutes, resetAutoPricing, selectedDate]);

  const openEdit = useCallback((booking: Booking) => {
    const durationValueForForm = String(booking.durationMinutes);
    resetAutoPricing(getPriceQuoteKey(
      format(new Date(booking.startsAt), 'yyyy-MM-dd'),
      toTimeInput(booking.startsAt),
      String(booking.courtId),
      durationValueForForm,
    ));
    setEditingBooking(booking);
    setLookupClient(booking.client || null);
    setLookupState('idle');
    setLookupError('');
    setGroupParticipants(
      booking.bookingType === 'group_training'
        ? (booking.participants || [])
            .filter((participant) => participant.clientId !== booking.userId)
            .map(mapBookingParticipantToDraft)
            .filter((participant): participant is GroupParticipantDraft => Boolean(participant))
        : [],
    );
    setGroupParticipantSearch('');
    bookingForm.reset({
      bookingType: booking.bookingType || 'game',
      cancellationReason: booking.cancellationReason || '',
      clientName: booking.clientName,
      comment: booking.comment || '',
      courtId: String(booking.courtId),
      date: format(new Date(booking.startsAt), 'yyyy-MM-dd'),
      durationMinutes: durationValueForForm,
      paidAmount: booking.paidAmount ? String(booking.paidAmount) : '',
      paymentMethod: booking.paymentMethod,
      paymentStatus: booking.paymentStatus,
      phone: booking.clientPhone,
      price: booking.price ? String(booking.price) : '',
      responsibleStaffId: booking.responsibleStaffId ? String(booking.responsibleStaffId) : 'none',
      source: booking.source,
      startTime: toTimeInput(booking.startsAt),
      status: booking.status,
      userId: String(booking.userId),
    });
    setFormOpen(true);
  }, [bookingForm, resetAutoPricing]);

  useEffect(() => {
    if (!requestedBookingId || editingBooking?.id === requestedBookingId) return;
    if (openedBookingIdRef.current === requestedBookingId) return;
    const booking = bookings.find((item) => item.id === requestedBookingId);
    if (booking) {
      openedBookingIdRef.current = requestedBookingId;
      openEdit(booking);
    }
  }, [bookings, editingBooking?.id, openEdit, requestedBookingId]);

  const addGroupParticipant = useCallback((client: ClientListItem) => {
    if (primaryGroupClientId && client.id === primaryGroupClientId) return;
    setGroupParticipants((current) => {
      if (current.some((participant) => participant.clientId === client.id)) {
        return current;
      }
      return [...current, mapClientListItemToDraft(client)];
    });
    setGroupParticipantSearch('');
  }, [primaryGroupClientId]);

  const removeGroupParticipant = useCallback((clientId: number) => {
    setGroupParticipants((current) =>
      current.filter((participant) => participant.clientId !== clientId),
    );
  }, []);

  const submitBooking = bookingForm.handleSubmit(async (values) => {
    const startsAt = buildStartsAtIso(values.date, values.startTime);
    const payload = {
      bookingType: values.bookingType,
      cancellationReason: values.cancellationReason.trim() || undefined,
      client: values.userId
        ? undefined
        : {
            name: values.clientName.trim(),
            phone: values.phone,
            source: 'Ресепшн (Админ)',
          },
      comment: values.comment.trim() || undefined,
      courtId: Number(values.courtId),
      durationMinutes: Number(values.durationMinutes) as BookingDurationMinutes,
      groupParticipantIds:
        values.bookingType === 'group_training'
          ? groupParticipants.map((participant) => participant.clientId)
          : undefined,
      paidAmount: values.paidAmount ? Number(values.paidAmount) : 0,
      paymentMethod: values.paymentMethod,
      paymentStatus: values.paymentStatus,
      price: values.price ? Number(values.price) : undefined,
      responsibleStaffId:
        values.responsibleStaffId && values.responsibleStaffId !== 'none'
          ? Number(values.responsibleStaffId)
          : null,
      source: values.source,
      startsAt,
      status: values.status,
      userId: values.userId ? Number(values.userId) : undefined,
    };

    try {
      if (editingBooking) {
        await updateMutation.mutateAsync({ id: editingBooking.id, values: payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      setFormOpen(false);
      toast.success(editingBooking ? 'Бронь обновлена' : 'Бронь создана');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сохранить бронь'));
    }
  });

  const quickStatus = useCallback(async (booking: Booking, status: BookingStatus) => {
    if (status === 'canceled') {
      setCancelBooking(booking);
      setCancelReason(booking.cancellationReason || '');
      return;
    }

    try {
      await statusMutation.mutateAsync({ id: booking.id, status });
      toast.success('Статус брони обновлен');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось изменить статус'));
    }
  }, [statusMutation]);

  const openPaymentDialog = useCallback((booking: Booking) => {
    setPaymentBooking(booking);
    setPaymentMethodDraft(
      booking.paymentMethod === 'unknown' ? 'cashless' : booking.paymentMethod,
    );
  }, []);

  const confirmPayment = async () => {
    if (!paymentBooking) return;
    try {
      await updateMutation.mutateAsync({
        id: paymentBooking.id,
        values: {
          paidAmount: paymentBooking.price,
          paymentMethod: paymentMethodDraft,
          paymentStatus: 'paid',
        },
      });
      setPaymentBooking(null);
      toast.success('Оплата отмечена');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось отметить оплату'));
    }
  };

  const openBookingTrainingPlan = useCallback(async (booking: Booking) => {
    if (!isTrainingBookingType(booking.bookingType)) return;

    setTrainingPlanBooking(booking);
    setTrainingPlan(null);
    setTrainingPlanError('');
    setTrainingPlanLoading(true);
    try {
      const plan = booking.trainingPlan
        ? await getBookingTrainingPlan(booking.id)
        : await createBookingTrainingPlan(booking.id);
      setTrainingPlan(plan);
      await queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
      if (!booking.trainingPlan && plan) {
        toast.success('План тренировки создан из брони');
      }
    } catch (error) {
      const message = getApiErrorMessage(error, 'Не удалось открыть план тренировки');
      setTrainingPlanError(message);
      toast.error(message);
    } finally {
      setTrainingPlanLoading(false);
    }
  }, [queryClient]);

  const quickCompleteBookingTrainingPlan = useCallback(async () => {
    if (!trainingPlan) return;

    setTrainingPlanLoading(true);
    setTrainingPlanError('');
    try {
      const completed = await quickCompleteTrainingPlan(trainingPlan.id, {
        trainedAt: trainingPlan.plannedAt,
      });
      setTrainingPlan(completed);
      await queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
      toast.success('План закрыт как completed');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Не удалось закрыть план');
      setTrainingPlanError(message);
      toast.error(message);
    } finally {
      setTrainingPlanLoading(false);
    }
  }, [queryClient, trainingPlan]);

  const confirmCancel = async () => {
    if (!cancelBooking) return;
    if (!cancelReason.trim()) {
      toast.error('Укажите причину отмены');
      return;
    }
    try {
      await statusMutation.mutateAsync({
        id: cancelBooking.id,
        reason: cancelReason.trim(),
        status: 'canceled',
      });
      setCancelBooking(null);
      setCancelReason('');
      if (editingBooking?.id === cancelBooking.id) {
        setFormOpen(false);
      }
      toast.success('Бронь отменена');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось отменить бронь'));
    }
  };

  const startSlotSelection = (
    event: ReactPointerEvent<HTMLDivElement>,
    courtId: number,
  ) => {
    if (
      !canEditBookings ||
      isScheduleClosed ||
      courts.length === 0 ||
      event.button !== 0 ||
      event.pointerType === 'touch'
    ) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('[data-booking-card="true"]')) return;
    if (target.closest('[data-court-block="true"]')) return;

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const rawIndex = getSlotIndexFromY(event.clientY, rect.top, slots.length);
    const minSelectionSlots = Math.max(1, minDurationMinutes / stepMinutes);
    const startIndex = Math.min(rawIndex, Math.max(0, slots.length - minSelectionSlots));
    const draft: SelectionDraft = {
      columnTop: rect.top,
      courtId,
      endIndex: startIndex,
      startIndex,
    };
    const handlePointerMove = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      setSelectionDraft({
        ...draft,
        endIndex: getSlotIndexFromY(pointerEvent.clientY, rect.top, slots.length),
      });
    };

    const handlePointerUp = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      const endIndex = getSlotIndexFromY(pointerEvent.clientY, rect.top, slots.length);
      setSelectionDraft(null);
      const selection = normalizeSelection(
        draft.startIndex,
        endIndex,
        slots.length,
        stepMinutes,
        minDurationMinutes,
        maxDurationMinutes,
      );
      openCreate(
        String(draft.courtId),
        getSlotTimeByIndex(selection.startIndex, dayStartMinutes, stepMinutes),
        toDurationValue(selection.durationMinutes, minDurationMinutes, maxDurationMinutes, stepMinutes),
      );
    };

    setSelectionDraft(draft);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const moveBooking = useCallback(async (
    booking: Booking,
    courtId: number,
    slotIndex: number,
  ) => {
    const safeSlotIndex = clampSlotIndexForDuration(
      slotIndex,
      booking.durationMinutes,
      slots.length,
      stepMinutes,
    );
    const startTime = getSlotTimeByIndex(safeSlotIndex, dayStartMinutes, stepMinutes);
    const startsAt = buildStartsAtIso(selectedDate, startTime);
    if (
      booking.courtId === courtId &&
      new Date(booking.startsAt).getTime() === new Date(startsAt).getTime()
    ) {
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: booking.id,
        values: {
          changeReason: 'Перенос в расписании',
          courtId,
          durationMinutes: booking.durationMinutes,
          paidAmount: booking.paidAmount,
          paymentMethod: booking.paymentMethod,
          paymentStatus: booking.paymentStatus,
          price: booking.price,
          startsAt,
        },
      });
      toast.success('Бронь перенесена');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось перенести бронь'));
    }
  }, [dayStartMinutes, selectedDate, slots.length, stepMinutes, updateMutation]);

  const handleBookingDragStart = (
    event: ReactPointerEvent<HTMLElement>,
    booking: Booking,
  ) => {
    if (
      !canEditBookingResources ||
      isScheduleClosed ||
      booking.status === 'canceled' ||
      event.button !== 0 ||
      event.pointerType === 'touch'
    ) {
      return;
    }

    const pointerStart = { x: event.clientX, y: event.clientY };
    let moved = false;

    const getTarget = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      const column = element?.closest<HTMLElement>('[data-court-column="true"]');
      if (!column) return null;
      const courtId = Number(column.dataset.courtId);
      if (!courtId) return null;
      const rect = column.getBoundingClientRect();
      return {
        courtId,
        slotIndex: clampSlotIndexForDuration(
          getSlotIndexFromY(clientY, rect.top, slots.length),
          booking.durationMinutes,
          slots.length,
          stepMinutes,
        ),
      };
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const distance = Math.hypot(
        pointerEvent.clientX - pointerStart.x,
        pointerEvent.clientY - pointerStart.y,
      );
      if (distance < 6) return;
      pointerEvent.preventDefault();
      moved = true;
      setDraggingBookingId(booking.id);
      setDragTarget(getTarget(pointerEvent.clientX, pointerEvent.clientY));
    };

    const handlePointerUp = async (pointerEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      const target = getTarget(pointerEvent.clientX, pointerEvent.clientY);
      setDraggingBookingId(null);
      setDragTarget(null);
      if (!moved || !target) {
        return;
      }
      pointerEvent.preventDefault();
      await moveBooking(booking, target.courtId, target.slotIndex);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const openSeries = () => {
    setSeriesDraft(getEmptySeriesDraft(
      selectedDate,
      String(courts[0]?.id || ''),
      String(minDurationMinutes),
    ));
    setSeriesPreview(null);
    setSeriesLookupClient(null);
    setSeriesLookupState('idle');
    setSeriesLookupError('');
    setSeriesOpen(true);
  };

  const buildSeriesPayload = (): BookingSeriesPayload => ({
    bookingType: seriesDraft.bookingType,
    client: seriesDraft.userId
      ? undefined
      : {
          name: seriesDraft.clientName.trim(),
          phone: seriesDraft.phone,
          source: 'Ресепшн (Админ)',
        },
    comment: seriesDraft.comment.trim() || undefined,
    courtId: Number(seriesDraft.courtId),
    durationMinutes: Number(seriesDraft.durationMinutes) as BookingDurationMinutes,
    endsOn: seriesDraft.endsOn,
    name: seriesDraft.name.trim() || `Постоянка ${seriesDraft.clientName.trim()}`,
    paymentMethod: seriesDraft.paymentMethod,
    paymentStatus: seriesDraft.paymentStatus,
    price:
      canEditBookingResources && seriesDraft.price
        ? Number(seriesDraft.price)
        : undefined,
    responsibleStaffId:
      seriesDraft.responsibleStaffId && seriesDraft.responsibleStaffId !== 'none'
        ? Number(seriesDraft.responsibleStaffId)
        : null,
    source: seriesDraft.source,
    startTime: seriesDraft.startTime,
    startsOn: seriesDraft.startsOn,
    status: seriesDraft.status,
    userId: seriesDraft.userId ? Number(seriesDraft.userId) : undefined,
    weekday: Number(seriesDraft.weekday),
  });

  const previewSeries = async () => {
    try {
      const preview = await previewSeriesMutation.mutateAsync(buildSeriesPayload());
      setSeriesPreview(preview);
      toast.success('Постоянная бронь проверена');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось проверить постоянную бронь'));
    }
  };

  const saveSeries = async () => {
    try {
      const result = await createSeriesMutation.mutateAsync(buildSeriesPayload());
      setSeriesPreview(result.preview);
      setSeriesDraft(getEmptySeriesDraft(selectedDate, String(courts[0]?.id || ''), String(minDurationMinutes)));
      await seriesQuery.refetch();
      toast.success('Постоянная бронь создана');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось создать постоянную бронь'));
    }
  };

  const requestArchiveSeries = (series: BookingSeries) => {
    setSeriesArchiveTarget(series);
    setSeriesArchiveCancelFuture(true);
    setSeriesArchiveReason(series.archiveReason || 'Постоянная бронь завершена');
  };

  const confirmArchiveSeries = async () => {
    if (!seriesArchiveTarget) return;
    try {
      await archiveSeriesMutation.mutateAsync({
        cancelFuture: seriesArchiveCancelFuture,
        id: seriesArchiveTarget.id,
        reason: seriesArchiveReason.trim() || 'Постоянная бронь завершена',
      });
      await seriesQuery.refetch();
      setSeriesArchiveTarget(null);
      toast.success('Постоянная бронь архивирована');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось архивировать постоянную бронь'));
    }
  };

  const requestArchivePriceRule = (rule: NonNullable<typeof priceRulesQuery.data>[number]) => {
    setPendingAction({
      confirmLabel: 'Архивировать',
      description: `Тариф «${rule.name}» перестанет участвовать в новом расчете цен. Уже созданные брони не изменятся.`,
      isDestructive: true,
      title: 'Архивировать тариф?',
      onConfirm: async () => {
        try {
          await archivePriceRuleMutation.mutateAsync(rule.id);
          toast.success('Тариф архивирован');
        } catch (error) {
          toast.error(getApiErrorMessage(error, 'Не удалось архивировать тариф'));
          return false;
        }
      },
    });
  };

  const requestArchiveResource = (resource: NonNullable<typeof resourcesQuery.data>[number]) => {
    setPendingAction({
      confirmLabel: 'Выключить',
      description: `Колонка «${resource.name}» исчезнет из календаря. Если на ней есть будущие брони, постоянные брони или блокировки, CRM не даст ее выключить.`,
      isDestructive: true,
      title: 'Выключить колонку?',
      onConfirm: async () => {
        try {
          await archiveResourceMutation.mutateAsync(resource.id);
          if (editingResourceId === resource.id) {
            setEditingResourceId(null);
            setResourceDraft(getEmptyResourceDraft());
          }
          toast.success('Колонка выключена');
        } catch (error) {
          toast.error(getApiErrorMessage(error, 'Не удалось выключить колонку'));
          return false;
        }
      },
    });
  };

  const requestArchiveBlock = (block: NonNullable<typeof schedule>['blocks'][number]) => {
    setPendingAction({
      confirmLabel: 'Архивировать',
      description: `Блокировка «${block.reason}» будет снята с расписания, и этот слот снова станет доступен для бронирования.`,
      isDestructive: true,
      title: 'Архивировать блокировку?',
      onConfirm: async () => {
        try {
          await archiveBlockMutation.mutateAsync(block.id);
          toast.success('Блокировка архивирована');
        } catch (error) {
          toast.error(getApiErrorMessage(error, 'Не удалось архивировать блокировку'));
          return false;
        }
      },
    });
  };

  const requestArchiveException = (item: NonNullable<typeof exceptionsQuery.data>[number]) => {
    setPendingAction({
      confirmLabel: 'Архивировать',
      description: `Исключение на ${item.date} перестанет влиять на рабочие часы. День вернется к обычным правилам.`,
      isDestructive: true,
      title: 'Архивировать исключение?',
      onConfirm: async () => {
        try {
          await archiveExceptionMutation.mutateAsync(item.id);
          toast.success('Исключение архивировано');
        } catch (error) {
          toast.error(getApiErrorMessage(error, 'Не удалось архивировать исключение'));
          return false;
        }
      },
    });
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    setPendingActionLoading(true);
    try {
      const shouldClose = await pendingAction.onConfirm();
      if (shouldClose !== false) setPendingAction(null);
    } finally {
      setPendingActionLoading(false);
    }
  };

  const openRules = async () => {
    setRulesOpen(true);
    setBlockDraft(getEmptyBlockDraft(selectedDate, String(courts[0]?.id || '')));
    setExceptionDraft(getEmptyExceptionDraft(selectedDate));
    setResourceDraft(getEmptyResourceDraft(Math.max(10, (courts.length + 1) * 10)));
    setEditingResourceId(null);
    try {
      const settings = await queryClient.fetchQuery({
        queryFn: getBookingSettings,
        queryKey: queryKeys.bookings.settings(),
      });
      setSettingsDraft({
        cancellationDeadlineHours: String(settings.cancellationDeadlineHours),
        maxDurationMinutes: String(settings.maxDurationMinutes),
        minDurationMinutes: String(settings.minDurationMinutes),
        rescheduleDeadlineHours: String(settings.rescheduleDeadlineHours),
        workingHoursEnd: settings.workingHoursEnd,
        workingHoursStart: settings.workingHoursStart,
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось загрузить настройки расписания'));
    }
  };

  const copyAnalyticsCsv = async () => {
    if (!analytics) return;
    try {
      await navigator.clipboard.writeText(buildAnalyticsCsv(analytics));
      toast.success('Отчет скопирован');
    } catch {
      toast.error('Не удалось скопировать отчет. Проверьте разрешения браузера.');
    }
  };

  const saveSettings = async () => {
    const payload: BookingSettingsPayload = {
      cancellationDeadlineHours: Number(settingsDraft.cancellationDeadlineHours || 0),
      maxDurationMinutes: Number(settingsDraft.maxDurationMinutes || 240),
      minDurationMinutes: Number(settingsDraft.minDurationMinutes || 60),
      rescheduleDeadlineHours: Number(settingsDraft.rescheduleDeadlineHours || 0),
      slotStepMinutes: stepMinutes,
      workingHoursEnd: settingsDraft.workingHoursEnd,
      workingHoursStart: settingsDraft.workingHoursStart,
    };
    try {
      await settingsMutation.mutateAsync(payload);
      toast.success('Настройки расписания сохранены');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сохранить настройки расписания'));
    }
  };

  const toggleWeekday = (weekday: number) => {
    setPriceRuleDraft((current) => {
      const hasWeekday = current.weekdays.includes(weekday);
      const weekdays = hasWeekday
        ? current.weekdays.filter((value) => value !== weekday)
        : [...current.weekdays, weekday].sort((a, b) => a - b);
      return { ...current, weekdays };
    });
  };

  const saveResource = async () => {
    const sortOrder = Number(resourceDraft.sortOrder || 10);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
      toast.error('Порядок колонки должен быть целым числом от 0 до 10000');
      return;
    }

    try {
      await resourceMutation.mutateAsync({
        id: editingResourceId || undefined,
        values: {
          isActive: resourceDraft.isActive,
          name: resourceDraft.name,
          sortOrder,
          type: resourceDraft.type,
        },
      });
      setEditingResourceId(null);
      setResourceDraft(getEmptyResourceDraft(Math.max(10, (bookingResources.length + 1) * 10)));
      toast.success('Колонка бронирования сохранена');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сохранить колонку'));
    }
  };

  const editResource = (resource: NonNullable<typeof resourcesQuery.data>[number]) => {
    setEditingResourceId(resource.id);
    setResourceDraft({
      id: resource.id,
      isActive: resource.isActive,
      name: resource.name,
      sortOrder: String(resource.sortOrder || 0),
      type: resource.type,
    });
  };

  const savePriceRule = async () => {
    try {
      await priceRuleMutation.mutateAsync({
        id: editingPriceRuleId || undefined,
        values: {
          courtType: priceRuleDraft.courtType,
          endTime: priceRuleDraft.endTime,
          name: priceRuleDraft.name,
          pricePerHour: Number(priceRuleDraft.pricePerHour || 0),
          priority: Number(priceRuleDraft.priority || 100),
          startTime: priceRuleDraft.startTime,
          weekdays: priceRuleDraft.weekdays,
        },
      });
      setEditingPriceRuleId(null);
      setPriceRuleDraft(getEmptyPriceRuleDraft());
      toast.success('Тариф сохранен');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сохранить тариф'));
    }
  };

  const editPriceRule = (rule: NonNullable<typeof priceRulesQuery.data>[number]) => {
    setEditingPriceRuleId(rule.id);
    setPriceRuleDraft({
      courtType: rule.courtType,
      endTime: rule.endTime,
      name: rule.name,
      pricePerHour: String(rule.pricePerHour),
      priority: String(rule.priority),
      startTime: rule.startTime,
      weekdays: rule.weekdays,
    });
  };

  const saveBlock = async () => {
    try {
      await blockMutation.mutateAsync({
        id: editingBlockId || undefined,
        values: {
          courtId: Number(blockDraft.courtId || courts[0]?.id),
          endsAt: buildStartsAtIso(blockDraft.date, blockDraft.endTime),
          reason: blockDraft.reason,
          startsAt: buildStartsAtIso(blockDraft.date, blockDraft.startTime),
        },
      });
      setEditingBlockId(null);
      setBlockDraft(getEmptyBlockDraft(selectedDate, String(courts[0]?.id || '')));
      toast.success('Блокировка сохранена');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сохранить блокировку'));
    }
  };

  const editBlock = (block: NonNullable<typeof schedule>['blocks'][number]) => {
    setEditingBlockId(block.id);
    setBlockDraft({
      courtId: String(block.courtId),
      date: format(new Date(block.startsAt), 'yyyy-MM-dd'),
      endTime: toTimeInput(block.endsAt),
      reason: block.reason,
      startTime: toTimeInput(block.startsAt),
    });
  };

  const saveException = async () => {
    try {
      await exceptionMutation.mutateAsync({
        id: editingExceptionId || undefined,
        values: {
          date: exceptionDraft.date,
          isClosed: exceptionDraft.isClosed,
          reason: exceptionDraft.reason || undefined,
          workingHoursEnd: exceptionDraft.isClosed ? undefined : exceptionDraft.workingHoursEnd,
          workingHoursStart: exceptionDraft.isClosed ? undefined : exceptionDraft.workingHoursStart,
        },
      });
      setEditingExceptionId(null);
      setExceptionDraft(getEmptyExceptionDraft(selectedDate));
      toast.success('Исключение сохранено');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сохранить исключение'));
    }
  };

  const editException = (item: NonNullable<typeof exceptionsQuery.data>[number]) => {
    setEditingExceptionId(item.id);
    setExceptionDraft({
      date: item.date,
      isClosed: item.isClosed,
      reason: item.reason || '',
      workingHoursEnd: item.workingHoursEnd || '24:00',
      workingHoursStart: item.workingHoursStart || '08:00',
    });
  };

  const columns = useMemo<ColumnDef<Booking>[]>(
    () => [
      {
        header: 'Время',
        cell: ({ row }) => (
          <span className="font-medium">
            {formatTime(row.original.startsAt)}-{formatTime(row.original.endsAt)}
          </span>
        ),
      },
      {
        header: 'Ресурс',
        cell: ({ row }) => row.original.court?.name || '-',
      },
      {
        header: 'Клиент',
        cell: ({ row }) => (
          <div>
            <div className="flex flex-wrap items-center gap-1.5 font-medium">
              {row.original.clientName}
              {row.original.isFirstBooking && (
                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                  Впервые
                </Badge>
              )}
              {row.original.bookingSeriesId && (
                <Badge variant="outline" className="text-[10px]">
                  Постоянка
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{row.original.clientPhone}</div>
          </div>
        ),
      },
      {
        header: 'Тип',
        cell: ({ row }) => (
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {BOOKING_TYPE_LABELS[row.original.bookingType] || 'Игра'}
            </div>
            {row.original.trainingPlan && (
              <Badge variant="outline" className="text-[10px]">
                {getTrainingPlanStatusLabel(row.original.trainingPlan)}
              </Badge>
            )}
            {row.original.responsibleStaff && (
              <div className="text-xs text-muted-foreground">
                {formatResponsibleStaff(row.original.responsibleStaff)}
              </div>
            )}
            {row.original.bookingType === 'group_training' && (
              <div className="text-xs text-muted-foreground">
                {getBookingParticipantCount(row.original)} участн.:{' '}
                {getBookingParticipantNames(row.original).slice(0, 3).join(', ')}
                {getBookingParticipantCount(row.original) > 3 ? '...' : ''}
              </div>
            )}
          </div>
        ),
      },
      {
        header: 'Статус',
        cell: ({ row }) => (
          <Badge variant="outline">
            {STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      },
      {
        header: 'Оплата',
        cell: ({ row }) => {
          const booking = row.original;
          return (
            <div className="space-y-1">
              <Badge className={getPaymentBadgeClass(booking.paymentStatus)}>
                {PAYMENT_STATUS_LABELS[booking.paymentStatus]}
              </Badge>
              <div className="text-xs text-muted-foreground">
                {formatCurrency(booking.paidAmount)} из {formatCurrency(booking.price)}
              </div>
            </div>
          );
        },
      },
      {
        header: 'Сумма',
        cell: ({ row }) => formatCurrency(row.original.price),
      },
      {
        id: 'actions',
        header: '',
        meta: {
          cellClassName: 'w-[220px]',
        },
        cell: ({ row }) => {
          const booking = row.original;
          const canQuickEdit = canEditBookings && booking.status !== 'canceled';
          return (
            <div className="flex flex-wrap justify-end gap-1">
              {canQuickEdit && booking.status !== 'no_show' && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void quickStatus(booking, 'no_show')}
                  title="Клиент не пришел"
                >
                  <UserX className="size-4" />
                </Button>
              )}
              {canQuickEdit && isBookingNeedsPayment(booking) && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => openPaymentDialog(booking)}
                  title="Отметить полную оплату"
                >
                  <Banknote className="size-4" />
                </Button>
              )}
              {canEditBookings && isTrainingBookingType(booking.bookingType) && (
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={booking.status === 'canceled' && !booking.trainingPlan}
                  onClick={() => void openBookingTrainingPlan(booking)}
                  title={
                    booking.trainingPlan
                      ? 'Открыть план тренировки'
                      : 'Создать план тренировки'
                  }
                >
                  <ClipboardList className="size-4" />
                </Button>
              )}
              {canQuickEdit && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void quickStatus(booking, 'canceled')}
                  title="Отменить бронь"
                >
                  <XCircle className="size-4" />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => openEdit(booking)}
                title={canEditBookings ? 'Редактировать' : 'Открыть'}
              >
                {canEditBookings ? <Pencil className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          );
        },
      },
    ],
    [canEditBookings, openBookingTrainingPlan, openEdit, openPaymentDialog, quickStatus],
  );

  const gridHeight = slots.length * SLOT_HEIGHT;
  const bookingSummaryItems = [
    {
      label: 'Активных',
      tooltip:
        'Все брони выбранного дня, кроме отмененных. Именно они участвуют в плане и загрузке дня.',
      value: schedule?.stats.activeCount || 0,
    },
    {
      label: 'К подтверждению',
      tooltip:
        'Новые брони, которые еще не переведены в статус «Подтверждена».',
      value: needsConfirmationCount,
    },
    {
      label: 'Первая',
      tooltip:
        'Первая по времени активная бронь выбранного дня. Помогает быстро увидеть старт операционного дня.',
      value: upcomingBooking ? formatTime(upcomingBooking.startsAt) : '-',
    },
    {
      label: 'План',
      tooltip: 'Сумма всех активных броней за день по сохраненной цене брони.',
      value: formatCurrency(schedule?.stats.plannedAmount || 0),
    },
    {
      label: 'Оплачено',
      tooltip: 'Сумма внесенной оплаты по активным броням выбранного дня.',
      value: formatCurrency(schedule?.stats.paidAmount || 0),
    },
    {
      label: 'Не оплачено',
      tooltip:
        'Остаток к оплате по активным броням. В скобках в списке ниже можно быстро найти такие брони фильтром «Нужно оплатить».',
      value: formatCurrency(schedule?.stats.unpaidAmount || 0),
      valueClassName: 'text-amber-500',
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only">Бронирование</h1>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-end">
        <div className="flex flex-wrap items-center justify-end gap-2 xl:flex-nowrap">
          <Button
            variant="outline"
            size="icon"
            onClick={() =>
              setBookingDate(format(subDays(new Date(selectedDate), 1), 'yyyy-MM-dd'))
            }
            title="Предыдущий день"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Input
            className="w-[160px]"
            type="date"
            value={selectedDate}
            onChange={(event) => setBookingDate(event.target.value)}
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() =>
              setBookingDate(format(addDays(new Date(selectedDate), 1), 'yyyy-MM-dd'))
            }
            title="Следующий день"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" onClick={() => setAnalyticsOpen(true)}>
            <BarChart3 className="mr-2 size-4" />
            Отчет
          </Button>
          {canEditBookingResources && (
            <Button variant="outline" onClick={openRules}>
              <Settings className="mr-2 size-4" />
              Правила
            </Button>
          )}
          {canEditBookings && (
            <Button variant="outline" onClick={openSeries}>
              <Repeat2 className="mr-2 size-4" />
              Постоянка
            </Button>
          )}
          {canEditBookings && (
            <Button
              onClick={() => openCreate()}
              disabled={isScheduleClosed || courts.length === 0}
              title={isScheduleClosed ? 'В этот день клуб закрыт для бронирований' : undefined}
            >
              <Plus className="mr-2 size-4" />
              Бронь
            </Button>
          )}
        </div>
      </div>

      {scheduleQuery.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {getApiErrorMessage(scheduleQuery.error, 'Не удалось загрузить расписание бронирований')}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>
              {format(new Date(selectedDate), 'd MMMM, EEEE', { locale: ru })}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Свободное время выделяется прямо в сетке, существующие брони можно переносить.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {isScheduleClosed && (
              <Badge variant="destructive">
                Клуб закрыт
              </Badge>
            )}
            {scheduleQuery.isFetching && (
              <Badge variant="outline">
                <RefreshCw className="mr-1 size-3 animate-spin" />
                Обновление
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isScheduleClosed && (
            <div className="mb-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              В этот день бронирование закрыто
              {workingHours?.exception?.reason ? `: ${workingHours.exception.reason}` : '.'}
            </div>
          )}
          <div className="overflow-x-auto rounded-md border">
            <div
              className="grid"
              style={{
                gridTemplateColumns: `72px repeat(${Math.max(courts.length, 1)}, minmax(136px, 1fr))`,
                minWidth: 72 + Math.max(courts.length, 1) * 136,
              }}
            >
              <div className="sticky left-0 z-20 border-b border-r bg-background p-3 text-sm font-medium">
                Время
              </div>
              {courts.map((court) => (
                <div key={court.id} className="border-b border-r p-3 text-sm font-medium">
                  <div>{court.name}</div>
                  <div className="text-xs font-normal text-muted-foreground">
                    {COURT_TYPE_LABELS[court.type]}
                  </div>
                </div>
              ))}

              <div className="sticky left-0 z-10 border-r bg-background" style={{ height: gridHeight }}>
                {slots.map((slot, index) => (
                  <div
                    key={slot}
                    className="border-b px-2 pt-1 text-xs text-muted-foreground"
                    style={{ height: SLOT_HEIGHT, top: index * SLOT_HEIGHT }}
                  >
                    {slot}
                  </div>
                ))}
              </div>

              {courts.map((court) => {
                const courtBookings = activeBookings.filter((booking) => booking.courtId === court.id);
                const courtBlocks = (schedule?.blocks || []).filter((block) => block.courtId === court.id);
                return (
                  <div
                    key={court.id}
                    className={cn(
                      'relative select-none border-r bg-muted/10',
                      canEditBookings && !isScheduleClosed && 'cursor-crosshair',
                    )}
                    data-court-column="true"
                    data-court-id={court.id}
                    onPointerDown={(event) => startSlotSelection(event, court.id)}
                    style={{ height: gridHeight }}
                  >
                    {slots.map((slot, index) => (
                      <div
                        key={`${court.id}-${slot}`}
                        className={cn(
                          'absolute left-0 right-0 border-b transition-colors',
                          canEditBookings && !isScheduleClosed && 'hover:bg-primary/10',
                        )}
                        style={{ height: SLOT_HEIGHT, top: index * SLOT_HEIGHT }}
                        title={`Создать бронь ${court.name} ${slot}`}
                      />
                    ))}
                    {selectionDraft?.courtId === court.id && (() => {
                      const selection = normalizeSelection(
                        selectionDraft.startIndex,
                        selectionDraft.endIndex,
                        slots.length,
                        stepMinutes,
                        minDurationMinutes,
                        maxDurationMinutes,
                      );
                      return (
                        <div
                          className="pointer-events-none absolute left-1 right-1 z-30 rounded-md border border-primary bg-primary/20 p-2 text-xs font-medium text-primary-foreground shadow-sm ring-2 ring-primary/25"
                          style={{
                            height: selection.slotCount * SLOT_HEIGHT - 4,
                            top: selection.startIndex * SLOT_HEIGHT + 2,
                          }}
                        >
                          {getSlotTimeByIndex(selection.startIndex, dayStartMinutes, stepMinutes)} · {selection.durationMinutes} мин
                        </div>
                      );
                    })()}
                    {dragTarget?.courtId === court.id && draggingBooking && (
                      <div
                        className="pointer-events-none absolute left-1 right-1 z-20 rounded-md border-2 border-dashed border-primary bg-primary/10"
                        style={{
                          height: getBookingCardHeight(draggingBooking.durationMinutes, stepMinutes),
                          top: dragTarget.slotIndex * SLOT_HEIGHT + 2,
                        }}
                      />
                    )}
                    {courtBlocks.map((block) => {
                      const top = Math.max(
                        0,
                        (getMinutesFromDayStart(block.startsAt, dayStartMinutes) / stepMinutes) * SLOT_HEIGHT,
                      );
                      const height = getBookingCardHeight(
                        Math.max(30, (new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime()) / 60000),
                        stepMinutes,
                      );
                      return (
                        <div
                          key={block.id}
                          data-court-block="true"
                          className="absolute left-1 right-1 z-10 overflow-hidden rounded-md border border-dashed border-muted-foreground/40 bg-muted/70 p-2 text-left text-xs text-muted-foreground shadow-sm"
                          style={{ height, top: top + 2 }}
                          title={block.reason}
                        >
                          <div className="font-medium">Блокировка</div>
                          <div className="truncate">{block.reason}</div>
                          {height > 72 && (
                            <div className="truncate">
                              {formatTime(block.startsAt)}-{formatTime(block.endsAt)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {courtBookings.map((booking) => {
                      const top = Math.max(
                        0,
                        (getMinutesFromDayStart(booking.startsAt, dayStartMinutes) / stepMinutes) * SLOT_HEIGHT,
                      );
                      const height = getBookingCardHeight(booking.durationMinutes, stepMinutes);
                      const needsPayment = isBookingNeedsPayment(booking);
                      const participantCount = getBookingParticipantCount(booking);
                      const participantNames = getBookingParticipantNames(booking);
                      return (
                        <div
                          key={booking.id}
                          data-booking-card="true"
                          role="button"
                          tabIndex={0}
                          className={cn(
                            'absolute left-1 right-1 z-20 overflow-hidden rounded-md border p-1 text-left text-xs shadow-sm transition-transform hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            canEditBookingResources && booking.status !== 'canceled'
                              ? 'cursor-grab active:cursor-grabbing'
                              : 'cursor-pointer',
                            draggingBookingId === booking.id && 'opacity-45',
                            getStatusClass(booking.status),
                          )}
                          style={{ height, top: top + 2 }}
                          title={[
                            `${formatTime(booking.startsAt)}-${formatTime(booking.endsAt)}`,
                            booking.clientName,
                            BOOKING_TYPE_LABELS[booking.bookingType] || 'Игра',
                            booking.isFirstBooking ? 'Первый визит' : null,
                            booking.responsibleStaff
                              ? `Ответственный: ${formatResponsibleStaff(booking.responsibleStaff)}`
                              : null,
                            booking.bookingType === 'group_training'
                              ? `Участники: ${participantNames.join(', ')}`
                              : null,
                            needsPayment
                              ? `К оплате: ${formatCurrency(Math.max(0, booking.price - booking.paidAmount))}`
                              : null,
                          ].filter(Boolean).join('\n')}
                          onClick={() => openEdit(booking)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            openEdit(booking);
                          }}
                          onPointerDown={(event) => handleBookingDragStart(event, booking)}
                        >
                          <div className="flex h-full min-w-0 flex-col justify-center gap-0.5">
                            <div className="truncate text-[11px] font-semibold leading-3">
                              {booking.clientName}
                            </div>
                            <div className="flex flex-wrap gap-0.5 overflow-hidden">
                              <span className="max-w-full truncate rounded-sm bg-background/20 px-1 py-0.5 text-[9px] font-semibold leading-3">
                                {BOOKING_TYPE_SHORT_LABELS[booking.bookingType] || 'Игра'}
                              </span>
                              {needsPayment && (
                                <span className="max-w-full truncate rounded-sm bg-amber-500/25 px-1 py-0.5 text-[9px] font-semibold leading-3">
                                  К оплате
                                </span>
                              )}
                              {booking.isFirstBooking && (
                                <span className="rounded-sm bg-emerald-500/20 px-1 py-0.5 text-[9px] font-semibold leading-3 text-emerald-50">
                                  Впервые
                                </span>
                              )}
                              {booking.trainingPlan && (
                                <span className="max-w-full truncate rounded-sm bg-background/20 px-1 py-0.5 text-[9px] font-semibold leading-3">
                                  {getTrainingPlanStatusLabel(booking.trainingPlan)}
                                </span>
                              )}
                              {booking.bookingSeriesId && (
                                <span className="max-w-full truncate rounded-sm bg-background/20 px-1 py-0.5 text-[9px] font-semibold leading-3">
                                  Постоянка
                                </span>
                              )}
                              {booking.bookingType === 'group_training' && (
                                <span className="max-w-full truncate rounded-sm bg-background/20 px-1 py-0.5 text-[9px] font-semibold leading-3">
                                  {participantCount} участн.
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-2xl border bg-card/70 p-2 shadow-sm shadow-foreground/5">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {bookingSummaryItems.map((item) => (
            <div
              key={item.label}
              className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-muted/25 px-3 py-2"
            >
              <MetricLabel tooltip={item.tooltip}>{item.label}</MetricLabel>
              <div
                className={cn(
                  'shrink-0 text-sm font-semibold text-foreground',
                  item.valueClassName,
                )}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Брони дня</CardTitle>
            </div>
            <Badge variant="outline">
              <ListFilter className="mr-1 size-3" />
              {filteredBookings.length} из {bookings.length}
            </Badge>
          </div>
          <div className="grid gap-2 xl:grid-cols-[minmax(220px,1fr)_180px_190px_180px_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={bookingSearch}
                onChange={(event) => setBookingSearch(event.target.value)}
                placeholder="Клиент, телефон, ресурс, комментарий"
              />
            </div>
            <Select
              value={bookingStatusFilter}
              onValueChange={(value) => setBookingStatusFilter(value as BookingStatusFilter)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Активные</SelectItem>
                <SelectItem value="all">Все статусы</SelectItem>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={bookingPaymentFilter}
              onValueChange={(value) => setBookingPaymentFilter(value as BookingPaymentFilter)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Любая оплата</SelectItem>
                <SelectItem value="needs_payment">
                  Нужно оплатить ({needsPaymentBookings.length})
                </SelectItem>
                {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={bookingCourtFilter}
              onValueChange={setBookingCourtFilter}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все ресурсы</SelectItem>
                {courts.map((court) => (
                  <SelectItem key={court.id} value={String(court.id)}>
                    {court.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setBookingSearch('');
                setBookingStatusFilter('active');
                setBookingPaymentFilter('all');
                setBookingCourtFilter('all');
              }}
            >
              Сбросить
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={filteredBookings}
            emptyText="По выбранным фильтрам броней нет."
            getRowClassName={(row) =>
              row.original.id === upcomingBooking?.id
                ? 'bg-primary/5'
                : undefined
            }
            loading={scheduleQuery.isLoading}
            pageSize={10}
          />
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {editingBooking ? 'Редактировать бронь' : 'Создать бронь'}
            </DialogTitle>
            <DialogDescription>
              Заполните телефон, выберите клиента или создайте нового прямо из формы.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-5" onSubmit={submitBooking}>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label>Дата</Label>
                <Input type="date" disabled={!canEditBookings} {...bookingForm.register('date')} />
                <FormError message={bookingForm.formState.errors.date?.message} />
              </div>
              <div className="space-y-2">
                <Label>Время</Label>
                  <Input
                    type="time"
                    step={1800}
                    disabled={!canEditBookings}
                    {...bookingForm.register('startTime')}
                  />
                <FormError message={bookingForm.formState.errors.startTime?.message} />
              </div>
              <div className="space-y-2">
                <Label>Длительность</Label>
                <Select
                  value={durationValue}
                  disabled={!canEditBookings}
                  onValueChange={(value) =>
                    bookingForm.setValue('durationMinutes', value as BookingDurationValue)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {bookingDurationOptions.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value} минут
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ресурс</Label>
                <Select
                  value={courtIdValue}
                  disabled={!canEditBookings}
                  onValueChange={(value) => bookingForm.setValue('courtId', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите" />
                  </SelectTrigger>
                  <SelectContent>
                    {courts.map((court) => (
                      <SelectItem key={court.id} value={String(court.id)}>
                        {court.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormError message={bookingForm.formState.errors.courtId?.message} />
              </div>
            </div>

            <BookingOperationNotices notices={bookingOperationNotices} />

            <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>Телефон клиента</Label>
                  {selectedBookingClientId && clubRole === 'admin' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => setProfileClientId(selectedBookingClientId)}
                    >
                      Карточка клиента
                    </Button>
                  ) : selectedBookingClientHref ? (
                    <Button asChild type="button" variant="outline" size="xs">
                      <Link to={selectedBookingClientHref}>
                        <ExternalLink className="size-3" />
                        Карточка клиента
                      </Link>
                    </Button>
                  ) : null}
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    disabled={!canEditBookings}
                    value={phoneValue}
                    onChange={(event) =>
                      bookingForm.setValue('phone', formatClientPhone(event.target.value), {
                        shouldValidate: true,
                      })
                    }
                    placeholder="+7 (999) 000-00-00"
                  />
                </div>
                <FormError message={bookingForm.formState.errors.phone?.message} />
                <ClientLookupHint
                  client={lookupClient}
                  errorMessage={lookupError}
                  state={lookupState}
                />
                <BookingPrepaymentHint
                  canViewCertificates={canViewBookingCertificates}
                  canViewSubscriptions={canViewBookingSubscriptions}
                  errorMessage={
                    bookingClientDetailsQuery.isError
                      ? getApiErrorMessage(
                          bookingClientDetailsQuery.error,
                          'Не удалось загрузить предоплаты клиента',
                        )
                      : ''
                  }
                  loading={bookingClientDetailsQuery.isLoading}
                  summary={bookingPrepaymentSummary}
                />
              </div>
              <div className="space-y-2">
                <Label>Имя клиента</Label>
                <Input
                  {...bookingForm.register('clientName')}
                  disabled={!canEditBookings || Boolean(userIdValue)}
                  placeholder="Имя нового клиента"
                />
                <FormError message={bookingForm.formState.errors.clientName?.message} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
              <div className="space-y-2">
                <Label>Тип брони</Label>
                <Select
                  value={bookingTypeValue}
                  disabled={!canEditBookings}
                  onValueChange={(value) =>
                    bookingForm.setValue('bookingType', value as BookingType)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(BOOKING_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ответственный сотрудник</Label>
                <Select
                  value={responsibleStaffIdValue}
                  disabled={!canEditBookings || responsiblesQuery.isLoading}
                  onValueChange={(value) => bookingForm.setValue('responsibleStaffId', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Не выбран" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не выбран</SelectItem>
                    {responsibles.map((staff) => (
                      <SelectItem key={staff.id} value={String(staff.id)}>
                        {formatResponsibleStaff(staff)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {responsiblesQuery.isError && (
                  <div className="text-xs text-destructive">
                    {getApiErrorMessage(responsiblesQuery.error, 'Не удалось загрузить сотрудников')}
                  </div>
                )}
              </div>
            </div>

            {bookingTypeValue === 'group_training' && (
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium">
                    <UsersRound className="size-4 text-muted-foreground" />
                    Участники группы
                  </div>
                  <Badge variant="outline">
                    {1 + groupParticipants.length}
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border bg-background p-2 text-sm">
                    <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">
                      Основной
                    </div>
                    <div className="truncate font-medium">
                      {primaryGroupClientName || 'Основной клиент'}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {phoneValue || 'Телефон не указан'}
                    </div>
                  </div>
                  {groupParticipants.map((participant) => (
                    <div
                      key={participant.clientId}
                      className="flex min-w-0 items-start justify-between gap-2 rounded-md border bg-background p-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">
                          Участник
                        </div>
                        <div className="truncate font-medium">{participant.client.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {participant.client.phone || 'Телефон не указан'}
                        </div>
                      </div>
                      {canEditBookings && (
                        <button
                          type="button"
                          className="mt-0.5 text-muted-foreground hover:text-foreground"
                          onClick={() => removeGroupParticipant(participant.clientId)}
                          title="Убрать участника"
                        >
                          <XCircle className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {canEditBookings && (
                  <div className="mt-3 space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        value={groupParticipantSearch}
                        onChange={(event) => setGroupParticipantSearch(event.target.value)}
                        placeholder="Найти клиента для группы"
                      />
                    </div>
                    {groupParticipantSearchQuery.isLoading && (
                      <div className="text-xs text-muted-foreground">
                        Ищем участников...
                      </div>
                    )}
                    {groupParticipantSearchQuery.isError && (
                      <div className="text-xs text-destructive">
                        {getApiErrorMessage(
                          groupParticipantSearchQuery.error,
                          'Не удалось найти клиентов',
                        )}
                      </div>
                    )}
                    {groupParticipantSearch.trim().length >= 2 &&
                      groupParticipantResults.length > 0 && (
                        <div className="divide-y rounded-md border bg-background">
                          {groupParticipantResults
                            .filter(
                              (client) =>
                                client.id !== primaryGroupClientId &&
                                !selectedGroupParticipantIds.has(client.id),
                            )
                            .map((client) => (
                              <button
                                key={client.id}
                                type="button"
                                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60"
                                onClick={() => addGroupParticipant(client)}
                              >
                                <span>
                                  <span className="font-medium">{client.name}</span>
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {client.phone}
                                  </span>
                                </span>
                                <Plus className="size-4 text-muted-foreground" />
                              </button>
                            ))}
                        </div>
                      )}
                    {groupParticipantSearch.trim().length >= 2 &&
                      !groupParticipantSearchQuery.isLoading &&
                      groupParticipantResults.length === 0 && (
                        <div className="text-xs text-muted-foreground">
                          Активные клиенты не найдены.
                        </div>
                      )}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-5">
              <div className="space-y-2">
                <Label>Статус</Label>
                <Select
                  value={statusValue}
                  disabled={!canEditBookings}
                  onValueChange={(value) =>
                    bookingForm.setValue('status', value as BookingStatus, {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Источник</Label>
                <Select
                  value={sourceValue}
                  disabled={!canEditBookings}
                  onValueChange={(value) =>
                    bookingForm.setValue('source', value as BookingSource)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Цена</Label>
                <Input
                  inputMode="decimal"
                  disabled={!canEditBookingResources}
                  {...bookingForm.register('price', {
                    onChange: (event) => {
                      if (canEditBookingResources) {
                        markPriceManuallyEdited(event.target.value);
                      }
                    },
                  })}
                />
                <FormError message={bookingForm.formState.errors.price?.message} />
              </div>
              <div className="space-y-2">
                <Label>Оплачено</Label>
                <Input
                  inputMode="decimal"
                  disabled={!canEditBookings}
                  {...bookingForm.register('paidAmount')}
                />
                <FormError message={bookingForm.formState.errors.paidAmount?.message} />
              </div>
              <div className="space-y-2">
                <Label>Оплата</Label>
                <Select
                  value={paymentStatusValue}
                  disabled={!canEditBookings}
                  onValueChange={(value) =>
                    bookingForm.setValue('paymentStatus', value as BookingPaymentStatus)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[220px_1fr]">
              <div className="space-y-2">
                <Label>Способ оплаты</Label>
                <Select
                  value={paymentMethodValue}
                  disabled={!canEditBookings}
                  onValueChange={(value) =>
                    bookingForm.setValue('paymentMethod', value as BookingPaymentMethod)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Комментарий администратора</Label>
                <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={!canEditBookings}
                  {...bookingForm.register('comment')}
                  placeholder="Например: клиент просил ракетки, будет с ребенком, перезвонить за час"
                />
              </div>
            </div>

            {statusValue === 'canceled' && (
              <div className="space-y-2">
                <Label>Причина отмены</Label>
                <Input
                  disabled={!canEditBookings}
                  {...bookingForm.register('cancellationReason')}
                />
                <FormError message={bookingForm.formState.errors.cancellationReason?.message} />
              </div>
            )}

            {editingBooking && (
              <div className="rounded-md border bg-muted/20 p-3">
                {canEditBookings && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {editingBooking.status !== 'no_show' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => quickStatus(editingBooking, 'no_show')}
                      >
                        <UserX className="mr-2 size-4" />
                        Не пришел
                      </Button>
                    )}
                    {isBookingNeedsPayment(editingBooking) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openPaymentDialog(editingBooking)}
                      >
                        <Banknote className="mr-2 size-4" />
                        Отметить оплату
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        bookingForm.setValue('status', 'canceled', {
                          shouldValidate: true,
                        })
                      }
                    >
                      <XCircle className="mr-2 size-4" />
                      Подготовить отмену
                    </Button>
                    {isTrainingBookingType(editingBooking.bookingType) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={editingBooking.status === 'canceled' && !editingBooking.trainingPlan}
                        onClick={() => void openBookingTrainingPlan(editingBooking)}
                      >
                        <ClipboardList className="mr-2 size-4" />
                        {editingBooking.trainingPlan ? 'Открыть план' : 'Создать план'}
                      </Button>
                    )}
                  </div>
                )}
	                <div className="space-y-2 text-sm">
	                  <div className="flex items-center gap-2 font-medium">
                      <History className="size-4 text-muted-foreground" />
                      История изменений
                    </div>
	                  {historyQuery.isLoading && (
	                    <div className="text-muted-foreground">Загрузка истории...</div>
	                  )}
	                  {historyQuery.isError && (
	                    <InlineQueryError
	                      error={historyQuery.error}
	                      fallback="Не удалось загрузить историю брони"
	                      onRetry={() => void historyQuery.refetch()}
	                    />
	                  )}
	                  {!historyQuery.isError && bookingHistoryRows.slice(0, 8).map((row) => (
                      <BookingHistoryItem key={row.item.id} row={row} />
	                  ))}
	                  {!historyQuery.isLoading && !historyQuery.isError && !bookingHistoryRows.length && (
	                    <div className="text-muted-foreground">Истории пока нет.</div>
	                  )}
	                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Закрыть
              </Button>
              {canEditBookings && (
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {editingBooking ? 'Сохранить' : 'Создать бронь'}
                </Button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(trainingPlanBooking)}
        onOpenChange={(open) => {
          if (!open) {
            setTrainingPlanBooking(null);
            setTrainingPlan(null);
            setTrainingPlanError('');
          }
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>План тренировки</DialogTitle>
            <DialogDescription>
              {trainingPlanBooking
                ? `${BOOKING_TYPE_LABELS[trainingPlanBooking.bookingType]} · ${formatDateTime(trainingPlanBooking.startsAt)}`
                : 'Связанный план брони'}
            </DialogDescription>
          </DialogHeader>

          {trainingPlanLoading && (
            <div className="rounded-md border py-8 text-center text-sm text-muted-foreground">
              Загружаем план тренировки...
            </div>
          )}

          {trainingPlanError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {trainingPlanError}
            </div>
          )}

          {!trainingPlanLoading && trainingPlan && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{getTrainingPlanStatusLabel(trainingPlan)}</Badge>
                <Badge variant="outline">
                  {trainingPlan.kind === 'group' ? 'group' : 'personal'}
                </Badge>
                <Badge variant="outline">
                  {trainingPlan.plannedExercises.length} упр.
                </Badge>
              </div>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    Бронь
                  </div>
                  <div className="mt-1 font-medium">
                    {trainingPlan.booking?.court?.name || trainingPlanBooking?.court?.name || 'Ресурс не указан'}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {trainingPlan.booking?.startsAt
                      ? `${formatDateTime(trainingPlan.booking.startsAt)} - ${formatTime(trainingPlan.booking.endsAt)}`
                      : formatDate(trainingPlan.plannedAt)}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    Тренер
                  </div>
                  <div className="mt-1 font-medium">
                    {trainingPlan.trainer?.name || trainingPlanBooking?.responsibleStaff?.name || 'Не выбран'}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {trainingPlan.completedAt
                      ? `Completed ${formatDateTime(trainingPlan.completedAt)}`
                      : 'Ожидает занятия'}
                  </div>
                </div>
              </div>

              {trainingPlan.goal && (
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Цель</div>
                  <div className="mt-1">{trainingPlan.goal}</div>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <UsersRound className="size-4 text-muted-foreground" />
                  Участники
                </div>
                <div className="flex flex-wrap gap-2">
                  {trainingPlan.participants.map((participant) => (
                    <Badge key={participant.id} variant="outline">
                      {participant.client?.name || `Клиент ${participant.clientId}`}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <Dumbbell className="size-4 text-muted-foreground" />
                  Упражнения
                </div>
                <div className="divide-y rounded-md border">
                  {trainingPlan.plannedExercises.map((exercise) => (
                    <div key={exercise.id} className="p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        {exercise.blockTitle && (
                          <Badge variant="outline">{exercise.blockTitle}</Badge>
                        )}
                        {exercise.exercise?.eLevel && (
                          <Badge>{exercise.exercise.eLevel}</Badge>
                        )}
                        <span className="font-medium">
                          {exercise.exercise?.name || exercise.exerciseName}
                        </span>
                      </div>
                      {exercise.reasonSnapshot && (
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {exercise.reasonSnapshot}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTrainingPlanBooking(null);
                setTrainingPlan(null);
                setTrainingPlanError('');
              }}
            >
              Закрыть
            </Button>
            {trainingPlan?.status === 'planned' && canCloseTrainingPlans && (
              <Button
                type="button"
                disabled={trainingPlanLoading}
                onClick={() => void quickCompleteBookingTrainingPlan()}
              >
                <CheckCircle2 className="mr-2 size-4" />
                Закрыть completed
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={analyticsOpen} onOpenChange={setAnalyticsOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Отчет по бронированиям</DialogTitle>
            <DialogDescription>
              Загрузка ресурсов, деньги, статусы и источники по выбранному периоду.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-md border p-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>С</Label>
                  <Input
                    type="date"
                    value={analyticsFrom}
                    onChange={(event) => setAnalyticsFrom(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>По</Label>
                  <Input
                    type="date"
                    value={analyticsTo}
                    onChange={(event) => setAnalyticsTo(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={copyAnalyticsCsv}
                  disabled={!analytics}
                >
                  Копировать CSV
                </Button>
              </div>
            </div>

            {analyticsQuery.isLoading && (
              <div className="rounded-md border border-dashed py-10 text-center text-muted-foreground">
                Считаю отчет...
              </div>
            )}

            {analyticsQuery.error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                {getApiErrorMessage(analyticsQuery.error, 'Не удалось получить отчет')}
              </div>
            )}

            {analytics && (
              <>
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle>
                        <MetricLabel tooltip="Все брони в периоде, включая отмененные.">
                          Броней
                        </MetricLabel>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-2xl font-semibold">
                      {analytics.total.totalCount}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle>
                        <MetricLabel tooltip="Брони в статусах новая, подтверждена, пришел и не пришел. Отмены не входят.">
                          Активных
                        </MetricLabel>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-2xl font-semibold">
                      {analytics.total.activeCount}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle>
                        <MetricLabel tooltip="Доля занятого времени от доступной емкости активных ресурсов по рабочим часам и исключениям.">
                          Загрузка
                        </MetricLabel>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-2xl font-semibold">
                      {analytics.total.occupancyPercent}%
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle>
                        <MetricLabel tooltip="Сумма цен активных броней за период.">
                          План
                        </MetricLabel>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-2xl font-semibold">
                      {formatCurrency(analytics.total.plannedAmount)}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle>
                        <MetricLabel tooltip="Сумма внесенных оплат по активным броням.">
                          Оплачено
                        </MetricLabel>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-2xl font-semibold">
                      {formatCurrency(analytics.total.paidAmount)}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle>
                        <MetricLabel tooltip="План минус оплачено по активным броням.">
                          К оплате
                        </MetricLabel>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-2xl font-semibold">
                      {formatCurrency(analytics.total.unpaidAmount)}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                  <section className="rounded-md border">
                    <div className="border-b px-4 py-3">
                      <div className="font-medium">Загрузка ресурсов</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        По активным броням без отмен.
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <Table className="min-w-[760px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Ресурс</TableHead>
                            <TableHead className="text-right">Броней</TableHead>
                            <TableHead className="text-right">Часы</TableHead>
                            <TableHead className="text-right">Загрузка</TableHead>
                            <TableHead className="text-right">План</TableHead>
                            <TableHead className="text-right">Оплачено</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {analytics.byCourt.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="font-medium">{row.label}</TableCell>
                              <TableCell className="text-right">{row.activeCount}</TableCell>
                              <TableCell className="text-right">
                                {row.bookedHours} / {row.capacityHours}
                              </TableCell>
                              <TableCell className="text-right">
                                {row.occupancyPercent}%
                              </TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(row.plannedAmount)}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(row.paidAmount)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </section>

                  <section className="rounded-md border">
                    <div className="border-b px-4 py-3">
                      <div className="font-medium">Разрезы</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Статусы, оплата и источник бронирования.
                      </div>
                    </div>
                    <div className="space-y-4 p-4">
                      {[
                        ['Статусы', analytics.byStatus],
                        ['Оплата', analytics.byPaymentStatus],
                        ['Источники', analytics.bySource],
                      ].map(([title, rows]) => (
                        <div key={title as string}>
                          <div className="mb-2 text-sm font-medium">{title as string}</div>
                          <div className="space-y-2">
                            {(rows as BookingAnalytics['byStatus']).map((row) => (
                              <div
                                key={row.key}
                                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                              >
                                <span className="truncate">{row.label}</span>
                                <span className="shrink-0 text-muted-foreground">
                                  {row.count} · {formatCurrency(row.plannedAmount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <section className="rounded-md border">
                  <div className="border-b px-4 py-3">
                    <div className="font-medium">Динамика по дням</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Нужна для проверки просадок, пустых дней и качества расписания.
                    </div>
                  </div>
                  <div className="max-h-[360px] overflow-auto">
                    <Table className="min-w-[760px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Дата</TableHead>
                          <TableHead className="text-right">Активных</TableHead>
                          <TableHead className="text-right">Отмен</TableHead>
                          <TableHead className="text-right">Часы</TableHead>
                          <TableHead className="text-right">Загрузка</TableHead>
                          <TableHead className="text-right">План</TableHead>
                          <TableHead className="text-right">Оплачено</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {analytics.byDate.map((row) => (
                          <TableRow key={row.date || row.id}>
                            <TableCell className="font-medium">
                              {formatDate(row.date)}
                            </TableCell>
                            <TableCell className="text-right">{row.activeCount}</TableCell>
                            <TableCell className="text-right">{row.canceledCount}</TableCell>
                            <TableCell className="text-right">{row.bookedHours}</TableCell>
                            <TableCell className="text-right">
                              {row.occupancyPercent}%
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(row.plannedAmount)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(row.paidAmount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={seriesOpen} onOpenChange={setSeriesOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Постоянные брони</DialogTitle>
            <DialogDescription>
              Создайте серию повторяющихся броней на один и тот же день недели, время и ресурс.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <section className="space-y-4 rounded-md border p-4">
              <div>
                <h3 className="font-semibold">Новая постоянка</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Перед созданием можно проверить серию: система покажет конфликты с бронями, блокировками и правилами расписания.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Название</Label>
                  <Input
                    value={seriesDraft.name}
                    onChange={(event) => setSeriesDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Например: Иванов по вторникам"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Телефон клиента</Label>
                  <Input
                    value={seriesDraft.phone}
                    onChange={(event) => setSeriesDraft((current) => ({
                      ...current,
                      phone: formatClientPhone(event.target.value),
                    }))}
                    placeholder="+7 (999) 000-00-00"
                  />
                  <ClientLookupHint
                    client={seriesLookupClient}
                    errorMessage={seriesLookupError}
                    state={seriesLookupState}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Имя клиента</Label>
                  <Input
                    value={seriesDraft.clientName}
                    disabled={Boolean(seriesDraft.userId)}
                    onChange={(event) => setSeriesDraft((current) => ({ ...current, clientName: event.target.value }))}
                    placeholder="Имя нового клиента"
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-2">
                  <Label>Тип брони</Label>
                  <Select
                    value={seriesDraft.bookingType}
                    onValueChange={(value) => setSeriesDraft((current) => ({
                      ...current,
                      bookingType: value as BookingType,
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(BOOKING_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ответственный</Label>
                  <Select
                    value={seriesDraft.responsibleStaffId}
                    disabled={responsiblesQuery.isLoading}
                    onValueChange={(value) => setSeriesDraft((current) => ({
                      ...current,
                      responsibleStaffId: value,
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Не выбран</SelectItem>
                      {responsibles.map((staff) => (
                        <SelectItem key={staff.id} value={String(staff.id)}>
                          {formatResponsibleStaff(staff)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ресурс</Label>
                  <Select
                    value={seriesDraft.courtId}
                    onValueChange={(value) => setSeriesDraft((current) => ({ ...current, courtId: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите" />
                    </SelectTrigger>
                    <SelectContent>
                      {courts.map((court) => (
                        <SelectItem key={court.id} value={String(court.id)}>
                          {court.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>День недели</Label>
                  <Select
                    value={seriesDraft.weekday}
                    onValueChange={(value) => setSeriesDraft((current) => ({ ...current, weekday: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((day) => (
                        <SelectItem key={day.value} value={String(day.value)}>
                          {day.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-2">
                  <Label>Время</Label>
                  <Input
                    type="time"
                    step={1800}
                    value={seriesDraft.startTime}
                    onChange={(event) => setSeriesDraft((current) => ({ ...current, startTime: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Длительность</Label>
                  <Select
                    value={seriesDraft.durationMinutes}
                    onValueChange={(value) => setSeriesDraft((current) => ({ ...current, durationMinutes: value as BookingDurationValue }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {durationOptions.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value} минут
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Начало</Label>
                  <Input
                    type="date"
                    value={seriesDraft.startsOn}
                    onChange={(event) => setSeriesDraft((current) => ({
                      ...current,
                      startsOn: event.target.value,
                      weekday: String(getIsoWeekdayFromDate(event.target.value)),
                    }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Окончание</Label>
                  <Input
                    type="date"
                    value={seriesDraft.endsOn}
                    onChange={(event) => setSeriesDraft((current) => ({ ...current, endsOn: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Цена за бронь</Label>
                  <Input
                    inputMode="decimal"
                    disabled={!canEditBookingResources}
                    value={seriesDraft.price}
                    onChange={(event) => setSeriesDraft((current) => ({ ...current, price: event.target.value }))}
                    placeholder="Авто"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Статус броней</Label>
                  <Select
                    value={seriesDraft.status}
                    onValueChange={(value) => setSeriesDraft((current) => ({
                      ...current,
                      status: value as Exclude<BookingStatus, 'canceled'>,
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="confirmed">Подтверждена</SelectItem>
                      <SelectItem value="new">Новая</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[220px_220px_1fr]">
                <div className="space-y-2">
                  <Label>Оплата</Label>
                  <Select
                    value={seriesDraft.paymentStatus}
                    onValueChange={(value) => setSeriesDraft((current) => ({
                      ...current,
                      paymentStatus: value as BookingPaymentStatus,
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unpaid">Не оплачено</SelectItem>
                      <SelectItem value="paid">Оплачено</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Способ оплаты</Label>
                  <Select
                    value={seriesDraft.paymentMethod}
                    onValueChange={(value) => setSeriesDraft((current) => ({
                      ...current,
                      paymentMethod: value as BookingPaymentMethod,
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Комментарий</Label>
                  <Input
                    value={seriesDraft.comment}
                    onChange={(event) => setSeriesDraft((current) => ({ ...current, comment: event.target.value }))}
                    placeholder="Например: постоянный клиент, звонить при переносе"
                  />
                </div>
              </div>

              {seriesPreview && (
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <div className="grid gap-2 md:grid-cols-4">
                    <div>
                      <div className="text-muted-foreground">Всего броней</div>
                      <div className="text-lg font-semibold">{seriesPreview.occurrenceCount}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Можно создать</div>
                      <div className="text-lg font-semibold">{seriesPreview.availableCount}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Конфликты</div>
                      <div className={cn('text-lg font-semibold', seriesPreview.conflictCount > 0 && 'text-destructive')}>
                        {seriesPreview.conflictCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">План</div>
                      <div className="text-lg font-semibold">{formatCurrency(seriesPreview.totalPrice)}</div>
                    </div>
                  </div>
                  {seriesPreview.conflicts.length > 0 && (
                    <div className="mt-3 space-y-1 text-destructive">
                      {seriesPreview.conflicts.slice(0, 4).map((item) => (
                        <div key={`${item.date}-${item.startsAt}`}>
                          {item.date}: {item.reason}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void previewSeries()}
                  disabled={previewSeriesMutation.isPending}
                >
                  Проверить
                </Button>
                <Button
                  type="button"
                  onClick={() => void saveSeries()}
                  disabled={createSeriesMutation.isPending || Boolean(seriesPreview && seriesPreview.conflictCount > 0)}
                >
                  <Repeat2 className="mr-2 size-4" />
                  Создать серию
                </Button>
              </div>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <div>
                <h3 className="font-semibold">Активные постоянки</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Архивирование серии не удаляет историю. Можно отдельно отменить будущие брони.
                </p>
	              </div>
	              <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
	                {seriesQuery.isError && (
	                  <InlineQueryError
	                    error={seriesQuery.error}
	                    fallback="Не удалось загрузить постоянные брони"
	                    onRetry={() => void seriesQuery.refetch()}
	                  />
	                )}
	                {!seriesQuery.isError && (seriesQuery.data || []).map((series) => (
	                  <div key={series.id} className="rounded-md border p-3 text-sm">
	                    <div className="flex items-start justify-between gap-3">
	                      <div>
                        <div className="font-medium">{series.name}</div>
                        <div className="text-muted-foreground">
                          {series.clientName} · {series.court?.name || `Ресурс #${series.courtId}`}
                        </div>
                      </div>
                      <Badge variant="outline">
                        {WEEKDAYS.find((day) => day.value === series.weekday)?.label} {series.startTime}
                      </Badge>
                    </div>
                    <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
                      <div>{series.startsOn} - {series.endsOn}</div>
                      <div>{series.durationMinutes} мин · {series.generatedBookingsCount || 0} броней</div>
                      <div>{BOOKING_TYPE_LABELS[series.bookingType] || 'Игра'}</div>
                      <div>{formatResponsibleStaff(series.responsibleStaff)}</div>
                      <div>{formatCurrency(series.price || 0)} {series.price ? '' : 'по тарифам'}</div>
                      <div>Будущих активных: {series.futureActiveBookingsCount || 0}</div>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => requestArchiveSeries(series)}
                        disabled={archiveSeriesMutation.isPending}
                      >
                        Архивировать
                      </Button>
                    </div>
                  </div>
                ))}
	                {seriesQuery.isLoading && (
	                  <div className="rounded-md border p-4 text-sm text-muted-foreground">Загрузка постоянок...</div>
	                )}
	                {!seriesQuery.isLoading && !seriesQuery.isError && !seriesQuery.data?.length && (
	                  <div className="rounded-md border p-4 text-sm text-muted-foreground">
	                    Активных постоянных броней пока нет.
	                  </div>
                )}
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
        <DialogContent
          className="max-h-[92vh] overflow-y-auto sm:max-w-5xl"
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const dialogContent = event.currentTarget as HTMLElement | null;
            dialogContent?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle>Правила бронирования</DialogTitle>
	            <DialogDescription>
	              Колонки календаря, рабочее время, тарифы, блокировки и исключения по датам.
	            </DialogDescription>
          </DialogHeader>

	          <div className="space-y-6">
	            <section className="rounded-md border p-4">
	              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
	                <div>
	                  <RulesSectionTitle tooltip="Колонки календаря - это любые ресурсы, которые можно бронировать: корты, теннисный стол, пушка для мячей или другая зона. Активные колонки показываются в расписании.">
	                    Колонки календаря
	                  </RulesSectionTitle>
	                  <p className="text-sm text-muted-foreground">
	                    Названия колонок задают owner и manager. Тип нужен только для тарифов.
	                  </p>
	                </div>
	                {!canEditBookingResources && (
	                  <Badge variant="secondary">Только owner / manager</Badge>
	                )}
	              </div>

	              {canEditBookingResources && (
	                <div className="grid gap-3 md:grid-cols-[1.4fr_170px_110px_120px_auto]">
	                  <div className="space-y-2">
	                    <RulesFieldLabel tooltip="Название, которое администратор увидит заголовком колонки в календаре. Например: Корт 1, Теннисный стол, Пушка для мячей.">
	                      Название
	                    </RulesFieldLabel>
	                    <Input
	                      value={resourceDraft.name}
	                      onChange={(event) =>
	                        setResourceDraft((current) => ({ ...current, name: event.target.value }))
	                      }
	                      placeholder="Например: Корт 1"
	                    />
	                  </div>
	                  <div className="space-y-2">
	                    <RulesFieldLabel tooltip="Группа для автоматического расчета цены. Для нестандартных ресурсов выберите «Другой ресурс» и создайте тариф для этого типа.">
	                      Тип тарифа
	                    </RulesFieldLabel>
	                    <Select
	                      value={resourceDraft.type}
	                      onValueChange={(value) =>
	                        setResourceDraft((current) => ({
	                          ...current,
	                          type: value as ResourceDraft['type'],
	                        }))
	                      }
	                    >
	                      <SelectTrigger><SelectValue /></SelectTrigger>
	                      <SelectContent>
	                        <SelectItem value="padel_double">Падел 2x2</SelectItem>
	                        <SelectItem value="padel_single">Падел 1x1</SelectItem>
	                        <SelectItem value="other">Другой ресурс</SelectItem>
	                      </SelectContent>
	                    </Select>
	                  </div>
	                  <div className="space-y-2">
	                    <RulesFieldLabel tooltip="Чем меньше число, тем левее колонка стоит в календаре. Обычно удобно использовать 10, 20, 30, чтобы между ними можно было вставить новую колонку.">
	                      Порядок
	                    </RulesFieldLabel>
	                    <Input
	                      inputMode="numeric"
	                      value={resourceDraft.sortOrder}
	                      onChange={(event) =>
	                        setResourceDraft((current) => ({ ...current, sortOrder: event.target.value }))
	                      }
	                    />
	                  </div>
	                  <label className="flex items-end gap-2 pb-2 text-sm">
	                    <input
	                      type="checkbox"
	                      checked={resourceDraft.isActive}
	                      onChange={(event) =>
	                        setResourceDraft((current) => ({ ...current, isActive: event.target.checked }))
	                      }
	                    />
	                    Активна
	                  </label>
	                  <div className="flex items-end gap-2">
	                    {editingResourceId && (
	                      <Button
	                        type="button"
	                        variant="outline"
	                        onClick={() => {
	                          setEditingResourceId(null);
	                          setResourceDraft(getEmptyResourceDraft(Math.max(10, (bookingResources.length + 1) * 10)));
	                        }}
	                      >
	                        Сбросить
	                      </Button>
	                    )}
	                    <Button
	                      type="button"
	                      onClick={() => void saveResource()}
	                      disabled={resourceMutation.isPending}
	                    >
	                      <Columns3 className="mr-2 size-4" />
	                      {editingResourceId ? 'Сохранить' : 'Добавить'}
	                    </Button>
	                  </div>
	                </div>
	              )}

	              <div className="mt-4 divide-y rounded-md border">
	                {resourcesQuery.isLoading && (
	                  <div className="p-4 text-sm text-muted-foreground">Загрузка колонок...</div>
	                )}
	                {resourcesQuery.isError && (
	                  <div className="p-3">
	                    <InlineQueryError
	                      error={resourcesQuery.error}
	                      fallback="Не удалось загрузить колонки календаря"
	                      onRetry={() => void resourcesQuery.refetch()}
	                    />
	                  </div>
	                )}
	                {!resourcesQuery.isError && bookingResources.map((resource) => (
	                  <div key={resource.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
	                    <div className="min-w-[220px] flex-1">
	                      <div className="font-medium">{resource.name}</div>
	                      <div className="text-muted-foreground">
	                        {COURT_TYPE_LABELS[resource.type]} · порядок {resource.sortOrder}
	                      </div>
	                    </div>
	                    <Badge variant={resource.isActive ? 'outline' : 'secondary'}>
	                      {resource.isActive ? 'Активна' : 'Выключена'}
	                    </Badge>
	                    {canEditBookingResources && (
	                      <>
	                        <Button size="sm" variant="outline" onClick={() => editResource(resource)}>
	                          <Pencil className="mr-2 size-4" />
	                          Изменить
	                        </Button>
	                        <Button
	                          size="icon"
	                          variant="ghost"
	                          onClick={() => requestArchiveResource(resource)}
	                          disabled={!resource.isActive}
	                          title="Выключить колонку"
	                        >
	                          <Trash2 className="size-4" />
	                        </Button>
	                      </>
	                    )}
	                  </div>
	                ))}
	                {!resourcesQuery.isLoading && !resourcesQuery.isError && bookingResources.length === 0 && (
	                  <div className="p-4 text-sm text-muted-foreground">Колонки календаря еще не созданы.</div>
	                )}
	              </div>
	            </section>

	            <section className="rounded-md border p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <RulesSectionTitle tooltip="Базовые правила клуба для обычного дня. Они определяют доступные интервалы в расписании и ограничения на действия с бронью.">
                    Рабочее время и ограничения
                  </RulesSectionTitle>
                  <p className="text-sm text-muted-foreground">
                    Эти правила применяются при создании, переносе и отмене брони.
                  </p>
                </div>
                <Button size="sm" onClick={saveSettings} disabled={settingsMutation.isPending}>
                  Сохранить
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-6">
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="С этого времени начинается обычный рабочий день клуба. Сетка расписания и новые брони ориентируются на него, если на дату нет отдельного исключения.">
                    Открытие
                  </RulesFieldLabel>
                  <Input
                    type="time"
                    value={settingsDraft.workingHoursStart}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({ ...current, workingHoursStart: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="До этого времени можно бронировать ресурсы в обычный день. Значение 24:00 означает конец календарного дня.">
                    Закрытие
                  </RulesFieldLabel>
                  <Input
                    value={settingsDraft.workingHoursEnd}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({ ...current, workingHoursEnd: event.target.value }))
                    }
                    placeholder="24:00"
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Минимальная длительность одной брони в минутах. Более короткий интервал нельзя будет создать через расписание или форму.">
                    Мин., мин
                  </RulesFieldLabel>
                  <Input
                    inputMode="numeric"
                    value={settingsDraft.minDurationMinutes}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({ ...current, minDurationMinutes: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Максимальная длительность одной брони в минутах. Ограничивает случайные слишком длинные бронирования.">
                    Макс., мин
                  </RulesFieldLabel>
                  <Input
                    inputMode="numeric"
                    value={settingsDraft.maxDurationMinutes}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({ ...current, maxDurationMinutes: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="За сколько часов до начала бронь еще можно отменить. 0 означает, что ограничение по времени сейчас не применяется.">
                    Отмена, ч
                  </RulesFieldLabel>
                  <Input
                    inputMode="numeric"
                    value={settingsDraft.cancellationDeadlineHours}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({ ...current, cancellationDeadlineHours: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="За сколько часов до начала бронь еще можно перенести на другое время или ресурс. 0 означает, что ограничение по времени сейчас не применяется.">
                    Перенос, ч
                  </RulesFieldLabel>
                  <Input
                    inputMode="numeric"
                    value={settingsDraft.rescheduleDeadlineHours}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({ ...current, rescheduleDeadlineHours: event.target.value }))
                    }
                  />
                </div>
              </div>
            </section>

            <section className="rounded-md border p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <RulesSectionTitle tooltip="Тарифы нужны для автоматического расчета цены брони. Если бронь пересекает несколько тарифных интервалов, сумма считается по частям.">
                    Тарифы
                  </RulesSectionTitle>
                  <p className="text-sm text-muted-foreground">
                    Цена считается по сегментам времени и типу ресурса.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingPriceRuleId(null);
                    setPriceRuleDraft(getEmptyPriceRuleDraft());
                  }}
                >
                  Сбросить
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-[1.3fr_150px_110px_110px_130px_90px]">
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Внутреннее название тарифа: например, будни утром, вечерний прайм или выходной день.">
                    Название
                  </RulesFieldLabel>
                  <Input
                    value={priceRuleDraft.name}
                    onChange={(event) => setPriceRuleDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Название тарифа"
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="К каким ресурсам применяется тариф. «Все ресурсы» работает как общее правило, если нет более точного тарифа.">
                    Тип ресурса
                  </RulesFieldLabel>
                  <Select
                    value={priceRuleDraft.courtType}
                    onValueChange={(value) =>
                      setPriceRuleDraft((current) => ({ ...current, courtType: value as BookingCourtType }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(COURT_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Время начала действия тарифа в выбранные дни недели.">
                    С
                  </RulesFieldLabel>
                  <Input
                    value={priceRuleDraft.startTime}
                    onChange={(event) => setPriceRuleDraft((current) => ({ ...current, startTime: event.target.value }))}
                    placeholder="08:00"
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Время окончания действия тарифа. Значение 24:00 означает конец дня.">
                    По
                  </RulesFieldLabel>
                  <Input
                    value={priceRuleDraft.endTime}
                    onChange={(event) => setPriceRuleDraft((current) => ({ ...current, endTime: event.target.value }))}
                    placeholder="24:00"
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Стоимость одного часа в этом тарифе. Итоговая цена брони считается пропорционально длительности.">
                    Цена/час
                  </RulesFieldLabel>
                  <Input
                    inputMode="decimal"
                    value={priceRuleDraft.pricePerHour}
                    onChange={(event) => setPriceRuleDraft((current) => ({ ...current, pricePerHour: event.target.value }))}
                    placeholder="₽ / час"
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Если под бронь подходит несколько тарифов, применяется правило с большим приоритетом.">
                    Приоритет
                  </RulesFieldLabel>
                  <Input
                    inputMode="numeric"
                    value={priceRuleDraft.priority}
                    onChange={(event) => setPriceRuleDraft((current) => ({ ...current, priority: event.target.value }))}
                    placeholder="Приоритет"
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-sm font-medium">
                <span>Дни недели</span>
                <HelpTooltip>
                  Выберите дни, когда тариф активен. Для разных дней и часов можно создать отдельные тарифы с разными ценами.
                </HelpTooltip>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => (
                  <Button
                    key={day.value}
                    type="button"
                    size="sm"
                    variant={priceRuleDraft.weekdays.includes(day.value) ? 'default' : 'outline'}
                    onClick={() => toggleWeekday(day.value)}
                  >
                    {day.label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  onClick={savePriceRule}
                  disabled={priceRuleMutation.isPending}
                  className="ml-auto"
                >
                  {editingPriceRuleId ? 'Сохранить тариф' : 'Добавить тариф'}
                </Button>
	              </div>
	              <div className="mt-4 divide-y rounded-md border">
	                {priceRulesQuery.isLoading && (
	                  <div className="p-4 text-sm text-muted-foreground">Загрузка тарифов...</div>
	                )}
	                {priceRulesQuery.isError && (
	                  <div className="p-3">
	                    <InlineQueryError
	                      error={priceRulesQuery.error}
	                      fallback="Не удалось загрузить тарифы"
	                      onRetry={() => void priceRulesQuery.refetch()}
	                    />
	                  </div>
	                )}
	                {!priceRulesQuery.isError && (priceRulesQuery.data || []).map((rule) => (
	                  <div key={rule.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
	                    <div className="min-w-[220px] flex-1">
	                      <div className="font-medium">{rule.name}</div>
                      <div className="text-muted-foreground">
                        {COURT_TYPE_LABELS[rule.courtType]} · {rule.startTime}-{rule.endTime} · {rule.weekdays.map((day) => WEEKDAYS.find((item) => item.value === day)?.label).join(', ')}
                      </div>
                    </div>
                    <div className="font-medium">{formatCurrency(rule.pricePerHour)} / час</div>
                    <Button size="sm" variant="outline" onClick={() => editPriceRule(rule)}>
                      <Pencil className="mr-2 size-4" />
                      Изменить
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => requestArchivePriceRule(rule)}>
	                      <Trash2 className="size-4" />
	                    </Button>
	                  </div>
	                ))}
	                {!priceRulesQuery.isLoading && !priceRulesQuery.isError && !priceRulesQuery.data?.length && (
	                  <div className="p-4 text-sm text-muted-foreground">Тарифы еще не настроены.</div>
	                )}
	              </div>
            </section>

            <section className="rounded-md border p-4">
              <RulesSectionTitle tooltip="Блокировка закрывает конкретный ресурс на точный интервал: ремонт, турнир, уборка или внутренняя тренировка. На это время нельзя создать или перенести бронь.">
                Блокировки ресурсов
              </RulesSectionTitle>
              <div className="mt-3 grid gap-3 md:grid-cols-[150px_150px_110px_110px_1fr_auto]">
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Дата, на которую закрывается слот. Блокировка действует только в этот день.">
                    Дата
                  </RulesFieldLabel>
                  <Input
                    type="date"
                    value={blockDraft.date}
                    onChange={(event) => setBlockDraft((current) => ({ ...current, date: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Ресурс, который временно недоступен для бронирования. Остальные ресурсы продолжают работать по обычным правилам.">
                    Ресурс
                  </RulesFieldLabel>
                  <Select
                    value={blockDraft.courtId || String(courts[0]?.id || '')}
                    onValueChange={(value) => setBlockDraft((current) => ({ ...current, courtId: value }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Ресурс" /></SelectTrigger>
                    <SelectContent>
                      {courts.map((court) => (
                        <SelectItem key={court.id} value={String(court.id)}>{court.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Время начала недоступности ресурса.">
                    Начало
                  </RulesFieldLabel>
                  <Input
                    type="time"
                    value={blockDraft.startTime}
                    onChange={(event) => setBlockDraft((current) => ({ ...current, startTime: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Время, с которого ресурс снова доступен для бронирования.">
                    Окончание
                  </RulesFieldLabel>
                  <Input
                    type="time"
                    value={blockDraft.endTime}
                    onChange={(event) => setBlockDraft((current) => ({ ...current, endTime: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Короткий комментарий для администраторов: ремонт, мероприятие, уборка, турнир.">
                    Причина
                  </RulesFieldLabel>
                  <Input
                    value={blockDraft.reason}
                    onChange={(event) => setBlockDraft((current) => ({ ...current, reason: event.target.value }))}
                    placeholder="Причина"
                  />
                </div>
                <Button className="self-end" onClick={saveBlock} disabled={blockMutation.isPending}>
                  {editingBlockId ? 'Сохранить' : 'Добавить'}
	                </Button>
	              </div>
	              <div className="mt-4 divide-y rounded-md border">
	                {scheduleQuery.isError && (
	                  <div className="p-3">
	                    <InlineQueryError
	                      error={scheduleQuery.error}
	                      fallback="Не удалось загрузить блокировки на выбранный день"
	                      onRetry={() => void scheduleQuery.refetch()}
	                    />
	                  </div>
	                )}
	                {!scheduleQuery.isError && (schedule?.blocks || []).map((block) => (
	                  <div key={block.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
	                    <div className="min-w-[220px] flex-1">
	                      <div className="font-medium">{block.court?.name || `Ресурс #${block.courtId}`}</div>
                      <div className="text-muted-foreground">
                        {formatDateTime(block.startsAt)}-{formatTime(block.endsAt)} · {block.reason}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => editBlock(block)}>
                      <Pencil className="mr-2 size-4" />
                      Изменить
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => requestArchiveBlock(block)}>
	                      <Trash2 className="size-4" />
	                    </Button>
	                  </div>
	                ))}
	                {!scheduleQuery.isLoading && !scheduleQuery.isError && !schedule?.blocks?.length && (
	                  <div className="p-4 text-sm text-muted-foreground">На выбранный день блокировок нет.</div>
	                )}
	              </div>
            </section>

            <section className="rounded-md border p-4">
              <RulesSectionTitle tooltip="Исключение меняет обычные часы работы на конкретную дату: праздник, сокращенный день или полный выходной. Оно важнее стандартного расписания.">
                Исключения по датам
              </RulesSectionTitle>
              <div className="mt-3 grid gap-3 md:grid-cols-[150px_120px_110px_110px_1fr_auto]">
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Дата, для которой задается особое расписание.">
                    Дата
                  </RulesFieldLabel>
                  <Input
                    type="date"
                    value={exceptionDraft.date}
                    onChange={(event) => setExceptionDraft((current) => ({ ...current, date: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Если включено, клуб полностью закрыт в выбранную дату, а бронирование на этот день запрещено.">
                    Статус
                  </RulesFieldLabel>
                  <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm">
                    <input
                      type="checkbox"
                      checked={exceptionDraft.isClosed}
                      onChange={(event) =>
                        setExceptionDraft((current) => ({ ...current, isClosed: event.target.checked }))
                      }
                    />
                    Закрыто
                  </label>
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Время открытия только для этой даты. Поле игнорируется, если включено «Закрыто».">
                    С
                  </RulesFieldLabel>
                  <Input
                    value={exceptionDraft.workingHoursStart}
                    disabled={exceptionDraft.isClosed}
                    onChange={(event) => setExceptionDraft((current) => ({ ...current, workingHoursStart: event.target.value }))}
                    placeholder="08:00"
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Время закрытия только для этой даты. Например, можно сделать сокращенный рабочий день.">
                    По
                  </RulesFieldLabel>
                  <Input
                    value={exceptionDraft.workingHoursEnd}
                    disabled={exceptionDraft.isClosed}
                    onChange={(event) => setExceptionDraft((current) => ({ ...current, workingHoursEnd: event.target.value }))}
                    placeholder="24:00"
                  />
                </div>
                <div className="space-y-2">
                  <RulesFieldLabel tooltip="Комментарий для администраторов: праздник, санитарный день, мероприятие или другая причина.">
                    Причина
                  </RulesFieldLabel>
                  <Input
                    value={exceptionDraft.reason}
                    onChange={(event) => setExceptionDraft((current) => ({ ...current, reason: event.target.value }))}
                    placeholder="Причина"
                  />
                </div>
                <Button className="self-end" onClick={saveException} disabled={exceptionMutation.isPending}>
                  {editingExceptionId ? 'Сохранить' : 'Добавить'}
	                </Button>
	              </div>
	              <div className="mt-4 divide-y rounded-md border">
	                {exceptionsQuery.isLoading && (
	                  <div className="p-4 text-sm text-muted-foreground">Загрузка исключений...</div>
	                )}
	                {exceptionsQuery.isError && (
	                  <div className="p-3">
	                    <InlineQueryError
	                      error={exceptionsQuery.error}
	                      fallback="Не удалось загрузить исключения"
	                      onRetry={() => void exceptionsQuery.refetch()}
	                    />
	                  </div>
	                )}
	                {!exceptionsQuery.isError && (exceptionsQuery.data || []).map((item) => (
	                  <div key={item.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
	                    <div className="min-w-[220px] flex-1">
	                      <div className="font-medium">{item.date}</div>
                      <div className="text-muted-foreground">
                        {item.isClosed ? 'Клуб закрыт' : `${item.workingHoursStart}-${item.workingHoursEnd}`} · {item.reason || 'без комментария'}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => editException(item)}>
                      <Pencil className="mr-2 size-4" />
                      Изменить
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => requestArchiveException(item)}>
	                      <Trash2 className="size-4" />
	                    </Button>
	                  </div>
	                ))}
	                {!exceptionsQuery.isLoading && !exceptionsQuery.isError && !exceptionsQuery.data?.length && (
	                  <div className="p-4 text-sm text-muted-foreground">Исключений пока нет.</div>
	                )}
	              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(seriesArchiveTarget)}
        onOpenChange={(open) => !open && !archiveSeriesMutation.isPending && setSeriesArchiveTarget(null)}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Архивировать постоянную бронь?</DialogTitle>
            <DialogDescription>
              Серия больше не будет считаться активной. Уже созданные брони останутся в расписании, если не отменить будущие.
            </DialogDescription>
          </DialogHeader>
          {seriesArchiveTarget && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="font-medium">{seriesArchiveTarget.name}</div>
                <div className="text-muted-foreground">
                  {seriesArchiveTarget.clientName} · {seriesArchiveTarget.court?.name || `Ресурс #${seriesArchiveTarget.courtId}`} · {seriesArchiveTarget.startTime}
                </div>
                <div className="mt-1 text-muted-foreground">
                  Будущих активных броней: {seriesArchiveTarget.futureActiveBookingsCount || 0}
                </div>
              </div>
              <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={seriesArchiveCancelFuture}
                  onChange={(event) => setSeriesArchiveCancelFuture(event.target.checked)}
                />
                <span>
                  Отменить будущие брони этой серии
                  <span className="block text-muted-foreground">
                    Если выключить, будущие брони останутся обычными бронями в расписании.
                  </span>
                </span>
              </label>
              <div className="space-y-2">
                <Label>Причина</Label>
                <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  value={seriesArchiveReason}
                  onChange={(event) => setSeriesArchiveReason(event.target.value)}
                  placeholder="Например: клиент завершил постоянку"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSeriesArchiveTarget(null)}
              disabled={archiveSeriesMutation.isPending}
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmArchiveSeries()}
              disabled={archiveSeriesMutation.isPending || !seriesArchiveTarget}
            >
              {archiveSeriesMutation.isPending ? 'Архивируем...' : 'Архивировать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(paymentBooking)} onOpenChange={(open) => !open && setPaymentBooking(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Отметить оплату</DialogTitle>
            <DialogDescription>
              Бронь будет отмечена как полностью оплаченная, сумма оплаты станет равна цене брони.
            </DialogDescription>
          </DialogHeader>
          {paymentBooking && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="font-medium">{paymentBooking.clientName}</div>
                <div className="text-muted-foreground">
                  {paymentBooking.court?.name || `Ресурс #${paymentBooking.courtId}`} · {formatTime(paymentBooking.startsAt)}-{formatTime(paymentBooking.endsAt)}
                </div>
                <div className="mt-2">
                  К оплате: <span className="font-semibold">{formatCurrency(paymentBooking.price)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Способ оплаты</Label>
                <Select
                  value={paymentMethodDraft}
                  onValueChange={(value) => setPaymentMethodDraft(value as BookingPaymentMethod)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cashless">Безнал</SelectItem>
                    <SelectItem value="cash">Наличные</SelectItem>
                    <SelectItem value="mixed">Смешанная</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPaymentBooking(null)}
              disabled={updateMutation.isPending}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => void confirmPayment()}
              disabled={updateMutation.isPending || !paymentBooking}
            >
              <Banknote className="mr-2 size-4" />
              Отметить оплату
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cancelBooking)} onOpenChange={(open) => !open && setCancelBooking(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Отменить бронь</DialogTitle>
            <DialogDescription>
              Причина сохранится в истории брони и будет видна при последующих проверках.
            </DialogDescription>
          </DialogHeader>
          {cancelBooking && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="font-medium">{cancelBooking.clientName}</div>
                <div className="text-muted-foreground">
                  {cancelBooking.court?.name || `Ресурс #${cancelBooking.courtId}`} · {formatTime(cancelBooking.startsAt)}-{formatTime(cancelBooking.endsAt)}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Причина отмены</Label>
                <textarea
                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  placeholder="Например: клиент отменил по телефону"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelBooking(null)}
              disabled={statusMutation.isPending}
            >
              Закрыть
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmCancel()}
              disabled={statusMutation.isPending || !cancelReason.trim()}
            >
              Отменить бронь
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        action={pendingAction}
        loading={pendingActionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />
      <ClientProfileDialog
        clientId={profileClientId}
        onOpenChange={(open) => {
          if (!open) setProfileClientId(null);
        }}
      />
    </div>
  );
}

function getNoticeClass(level: BookingNoticeLevel) {
  if (level === 'danger') {
    return 'border-destructive/40 bg-destructive/10 text-destructive';
  }
  if (level === 'warning') {
    return 'border-amber-300/50 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200';
  }
  return 'border-sky-300/50 bg-sky-50 text-sky-900 dark:border-sky-500/40 dark:bg-sky-950/30 dark:text-sky-200';
}

function BookingOperationNotices({ notices }: { notices: BookingOperationNotice[] }) {
  if (!notices.length) return null;

  return (
    <div className="grid gap-2 md:grid-cols-2">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={cn('rounded-md border p-3 text-sm', getNoticeClass(notice.level))}
        >
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="break-words font-medium">{notice.title}</div>
              {notice.description && (
                <div className="mt-1 break-words text-xs opacity-85">
                  {notice.description}
                </div>
              )}
            </div>
            {notice.actionHref && notice.actionLabel && (
              <Button asChild type="button" variant="outline" size="xs" className="shrink-0 bg-background/70">
                <Link to={notice.actionHref}>
                  <ExternalLink className="size-3" />
                  {notice.actionLabel}
                </Link>
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function BookingHistoryItem({ row }: { row: BookingHistoryRow }) {
  const { item } = row;
  const actor = item.actor?.name || item.actor?.email || 'Система';

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={item.action === 'canceled' ? 'destructive' : 'outline'}>
          {HISTORY_ACTION_LABELS[item.action] || item.action}
        </Badge>
        <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
        <span className="text-xs text-muted-foreground">{actor}</span>
      </div>
      {row.details.length > 0 && (
        <div className="mt-2 space-y-1">
          {row.details.map((detail) => (
            <div key={detail} className="break-words text-xs text-muted-foreground">
              {detail}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="text-xs text-destructive">{message}</div>;
}

function InlineQueryError({
  error,
  fallback,
  onRetry,
}: {
  error: unknown;
  fallback: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <span>{getApiErrorMessage(error, fallback)}</span>
      {onRetry && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRetry}
        >
          <RefreshCw className="mr-2 size-4" />
          Повторить
        </Button>
      )}
    </div>
  );
}

function ClientLookupHint({
  client,
  errorMessage,
  state,
}: {
  client: LookupClient | null;
  errorMessage?: string;
  state: ClientLookupState;
}) {
  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Search className="size-3 animate-pulse" />
        Ищем клиента...
      </div>
    );
  }
  if (state === 'archived' && client) {
    return (
      <div className="text-xs text-amber-500">
        Клиент найден в архиве: {client.name}. Сначала восстановите его в разделе клиентов.
      </div>
    );
  }
  if (client) {
    return (
      <div className="text-xs text-green-500">
        Найден клиент: {client.name} · {client.phone}
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="text-xs text-destructive">
        {errorMessage || 'Не удалось проверить клиента. Попробуйте еще раз или создайте бронь позже.'}
      </div>
    );
  }
  if (state === 'not_found') {
    return (
      <div className="text-xs text-muted-foreground">
        Клиент не найден. Заполните имя, и он будет создан вместе с бронью.
      </div>
    );
  }
  return null;
}

function BookingPrepaymentHint({
  canViewCertificates,
  canViewSubscriptions,
  errorMessage,
  loading,
  summary,
}: {
  canViewCertificates: boolean;
  canViewSubscriptions: boolean;
  errorMessage?: string;
  loading: boolean;
  summary: ClientPrepaymentSummary | null;
}) {
  if (!canViewCertificates && !canViewSubscriptions) return null;
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Search className="size-3 animate-pulse" />
        Проверяем абонементы и сертификаты...
      </div>
    );
  }
  if (errorMessage) {
    return <div className="text-xs text-destructive">{errorMessage}</div>;
  }
  if (!summary) return null;

  const warnings = [
    ...(summary.subscriptionWarnings || []),
    ...(summary.certificateWarnings || []),
  ].slice(0, 2);
  const hasActive =
    (canViewSubscriptions && summary.hasActiveSubscription) ||
    (canViewCertificates && summary.hasActiveCertificate);

  return (
    <div className="rounded-md border bg-muted/20 p-2 text-xs">
      <div className="flex flex-wrap gap-1">
        {canViewSubscriptions && (
          <Badge variant={summary.hasActiveSubscription ? 'default' : 'outline'}>
            Абонементы: {summary.activeSubscriptionsCount}
          </Badge>
        )}
        {canViewCertificates && (
          <Badge variant={summary.hasActiveCertificate ? 'default' : 'outline'}>
            Сертификаты: {summary.activeCertificatesCount}
          </Badge>
        )}
        {!hasActive && <Badge variant="secondary">Активных предоплат нет</Badge>}
      </div>
      {warnings.length > 0 && (
        <div className="mt-2 space-y-1 text-amber-600">
          {warnings.map((warning) => (
            <div key={warning.id} className="break-words">
              {warning.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
