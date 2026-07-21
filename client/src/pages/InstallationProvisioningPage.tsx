import {
  ArrowLeft,
  ArrowRight,
  Archive,
  ArchiveRestore,
  AlertTriangle,
  Bot,
  Building2,
  Cable,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  ChevronRight,
  CircleCheckBig,
  Clipboard,
  ExternalLink,
  KeyRound,
  MapPin,
  MessageCircle,
  PhoneCall,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ThemeToggle } from '@/components/theme-toggle';
import { BrandMark } from '@/components/brand-mark';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { API_URL } from '@/config';
import { formatRussianPhone, russianPhoneE164 } from '@/lib/russian-phone';
import { cn } from '@/lib/utils';

const TOKEN_KEY = 'setly_installation_operator_token';
const DEFAULT_TIMEZONE = 'Europe/Moscow';

type ClubDraft = { name: string; timezone: string };
type ActivationState = 'pending' | 'consumed' | 'expired' | 'invalidated' | null;
type OwnerState = 'active' | 'inactive' | 'missing' | 'pending_activation';
type IntegrationProvider = 'beeline' | 'evotor' | 'telegram' | 'vk';
type IntegrationCommand =
  | 'activate'
  | 'check'
  | 'cutover'
  | 'disable'
  | 'renew'
  | 'restart'
  | 'revoke'
  | 'validate';
type IntegrationState = {
  configured: boolean;
  lastActivityAt: string | null;
  lastValidatedAt: string | null;
  provider: IntegrationProvider;
  proxyConfigured: boolean;
  safeCallbackUrl: string | null;
  safeIdentity: string | null;
  secretUpdatedAt: string | null;
  settings: Record<string, unknown>;
  status: 'active' | 'disabled' | 'revoked' | 'not_configured';
  validationStatus: 'verified' | 'pending_event' | 'failed' | 'not_tested';
  updatedAt: string | null;
};
type InstallationOrganization = {
  clubs: Array<{
    id: number;
    integrations: IntegrationState[];
    name: string;
    status: 'active' | 'inactive' | 'archived';
    timezone: string;
    updatedAt: string;
  }>;
  createdAt: string;
  id: number;
  name: string;
  status: 'active' | 'inactive' | 'archived';
  updatedAt: string;
};
type InstallationSnapshot = {
  audits: Array<{
    action: string;
    createdAt: string;
    id: number;
    organizationId: number;
    statusCode: number;
    summary: string | null;
  }>;
  foundation: { state: 'initialized' };
  organizations: Array<{
    clubCount: number;
    createdAt: string;
    id: number;
    name: string;
    ownerState: OwnerState;
    slug: string;
    status: 'active' | 'inactive' | 'archived';
    updatedAt: string;
  }>;
};
type ProvisioningResult = {
  activation: { expiresAt: string; link: string | null; state: Exclude<ActivationState, null> };
  audit: { action: string; createdAt: string; id: number };
  clubs: Array<{ id: number; name: string; slug: string; timezone: string }>;
  idempotency: { operationId: number; replayed: boolean };
  organization: { id: number; name: string; slug: string };
  owner: { accountId: number; email: string; name: string };
};
type ApiFailure = { code: string; message: string };
type OperatorError = { description: string; title: string };

const providerCopy: Record<IntegrationProvider, { description: string; label: string }> = {
  beeline: {
    description: 'Телефония и события звонков',
    label: 'Билайн',
  },
  evotor: {
    description: 'Приём чеков',
    label: 'Эвотор',
  },
  telegram: {
    description: 'Бот регистрации клиентов',
    label: 'Telegram',
  },
  vk: {
    description: 'Бот сообщества',
    label: 'VK',
  },
};

const providerValues = new Set<IntegrationProvider>([
  'beeline',
  'evotor',
  'telegram',
  'vk',
]);

function integrationCommandCopy(
  provider: IntegrationProvider,
  command: IntegrationCommand,
): ConfirmAction {
  const providerName = providerCopy[provider].label;
  const copies: Record<IntegrationCommand, ConfirmAction> = {
    activate: {
      confirmLabel: 'Включить',
      description: `Setly проверит сохранённые данные и возобновит работу интеграции ${providerName} только для этого клуба. Новые события снова начнут обрабатываться.`,
      title: `Включить ${providerName}?`,
    },
    check: {
      confirmLabel: 'Проверить подписку',
      description: 'Setly запросит текущее состояние подписки Билайна. Настройки, callback и учётные данные не изменятся.',
      title: 'Проверить подписку Билайна?',
    },
    cutover: {
      confirmLabel: 'Переключить callback',
      description: 'Setly выпустит новый защищённый callback и пересоздаст подписку у Билайна. После успешного переключения прежний callback перестанет принимать события.',
      isDestructive: true,
      title: 'Переключить callback Билайна?',
    },
    disable: {
      confirmLabel: 'Отключить',
      description: `Интеграция ${providerName} перестанет принимать и обрабатывать новые события для этого клуба. Зашифрованные учётные данные сохранятся, поэтому подключение можно будет включить снова.`,
      isDestructive: true,
      title: `Отключить ${providerName}?`,
    },
    renew: {
      confirmLabel: 'Продлить подписку',
      description: 'Setly принудительно продлит подписку Билайна с текущим callback. Во время переподключения возможна короткая пауза в доставке событий.',
      title: 'Продлить подписку Билайна?',
    },
    restart: {
      confirmLabel: 'Перезапустить бота',
      description: `Setly перезапустит бота ${providerName} для этого клуба. Возможна короткая пауза в ответах; настройки и учётные данные не изменятся.`,
      title: `Перезапустить ${providerName}?`,
    },
    revoke: {
      confirmLabel: 'Отозвать доступ',
      description: `Интеграция ${providerName} немедленно остановится, а текущий доступ будет отозван. Для повторного подключения потребуется указать новые учётные данные.`,
      isDestructive: true,
      title: `Отозвать доступ ${providerName}?`,
    },
    validate: {
      confirmLabel: 'Проверить подключение',
      description: provider === 'evotor'
        ? 'Setly проверит локальную конфигурацию Эвотора. Окончательное подтверждение появится после следующего события от кассы.'
        : `Setly выполнит безопасный запрос к ${providerName} с сохранёнными данными и обновит результат проверки. Настройки не изменятся.`,
      title: `Проверить ${providerName}?`,
    },
  };
  return copies[command];
}

function integrationSaveCopy(
  provider: IntegrationProvider,
  mode: 'configure' | 'edit' | 'rotate',
): ConfirmAction {
  const providerName = providerCopy[provider].label;
  if (mode === 'rotate') {
    return {
      confirmLabel: 'Проверить и заменить',
      description: 'Setly сначала проверит новые учётные данные. Текущие данные будут заменены только после успешной проверки; при ошибке действующее подключение продолжит работать.',
      title: `Обновить учётные данные ${providerName}?`,
    };
  }
  if (mode === 'edit') {
    return {
      confirmLabel: 'Проверить и сохранить',
      description: `Новые настройки ${providerName} будут проверены и применены только к этому клубу. Следующие запросы интеграции пойдут с обновлённой конфигурацией.`,
      title: `Сохранить настройки ${providerName}?`,
    };
  }
  return {
    confirmLabel: 'Проверить и подключить',
    description: `Setly проверит введённые данные и создаст подключение ${providerName} только для этого клуба. Ничего не сохранится, если проверка завершится ошибкой.`,
    title: `Подключить ${providerName}?`,
  };
}

function ProviderIcon({ provider }: { provider: IntegrationProvider }) {
  if (provider === 'beeline') return <PhoneCall className="size-5" />;
  if (provider === 'evotor') return <ReceiptText className="size-5" />;
  if (provider === 'telegram') return <Bot className="size-5" />;
  return <MessageCircle className="size-5" />;
}

function integrationStatus(state: IntegrationState) {
  if (!state.configured) return { label: 'Не настроено', tone: 'bg-muted text-muted-foreground' };
  if (state.status === 'disabled') return { label: 'Отключено', tone: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' };
  if (state.status === 'revoked') return { label: 'Доступ отозван', tone: 'bg-destructive/10 text-destructive' };
  if (state.validationStatus === 'verified') return { label: 'Работает', tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' };
  if (state.validationStatus === 'failed') return { label: 'Нужна проверка', tone: 'bg-amber-500/10 text-amber-800 dark:text-amber-300' };
  if (state.validationStatus === 'pending_event') return { label: 'Ожидает событие', tone: 'bg-sky-500/10 text-sky-800 dark:text-sky-300' };
  return { label: 'Настроено', tone: 'bg-primary/10 text-primary' };
}

function validationDescription(state: IntegrationState) {
  if (!state.configured) return null;
  if (state.provider === 'evotor' && state.validationStatus === 'pending_event') {
    return 'Ожидается первое событие Эвотора.';
  }
  if (state.validationStatus === 'verified' && state.lastValidatedAt) {
    return `Последняя проверка: ${formatDate(state.lastValidatedAt)}`;
  }
  if (state.validationStatus === 'failed') {
    return 'Последняя проверка не прошла. Проверьте настройки подключения.';
  }
  if (state.status === 'disabled') return 'Новые события не принимаются.';
  return 'Проверка ещё не запускалась.';
}

const timezones = [
  { city: 'Калининград', region: 'Россия', value: 'Europe/Kaliningrad' },
  { city: 'Москва', region: 'Россия', value: 'Europe/Moscow' },
  { city: 'Самара', region: 'Россия', value: 'Europe/Samara' },
  { city: 'Екатеринбург', region: 'Россия', value: 'Asia/Yekaterinburg' },
  { city: 'Омск', region: 'Россия', value: 'Asia/Omsk' },
  { city: 'Новосибирск', region: 'Россия', value: 'Asia/Novosibirsk' },
  { city: 'Красноярск', region: 'Россия', value: 'Asia/Krasnoyarsk' },
  { city: 'Иркутск', region: 'Россия', value: 'Asia/Irkutsk' },
  { city: 'Якутск', region: 'Россия', value: 'Asia/Yakutsk' },
  { city: 'Владивосток', region: 'Россия', value: 'Asia/Vladivostok' },
  { city: 'Магадан', region: 'Россия', value: 'Asia/Magadan' },
  { city: 'Камчатка', region: 'Россия', value: 'Asia/Kamchatka' },
] as const;

const steps = [
  { icon: Building2, label: 'Организация' },
  { icon: MapPin, label: 'Клубы' },
  { icon: UserRound, label: 'Владелец' },
  { icon: CircleCheckBig, label: 'Проверка' },
] as const;

function freshOrganization() {
  return { name: '' };
}

function freshClubs(): ClubDraft[] {
  return [{ name: '', timezone: DEFAULT_TIMEZONE }];
}

function freshOwner() {
  return { email: '', name: '', phone: '' };
}

async function readError(response: Response, fallback: string): Promise<ApiFailure> {
  try {
    const body = (await response.json()) as { code?: string; error?: string };
    return { code: body.code || '', message: body.error || fallback };
  } catch {
    return { code: '', message: fallback };
  }
}

function createErrorMessage(failure: ApiFailure): OperatorError {
  if (['ORGANIZATION_NAME_EXISTS', 'ORGANIZATION_NAME_CONFLICT'].includes(failure.code)) {
    return {
      description: 'Используйте другое название или проверьте список существующих организаций.',
      title: 'Организация уже существует',
    };
  }
  if (failure.code === 'OWNER_EMAIL_EXISTS') {
    return {
      description: 'Укажите другой email или проверьте, не создан ли аккаунт владельца ранее.',
      title: 'Email уже используется',
    };
  }
  if (failure.code === 'VALIDATION_ERROR') {
    return {
      description: 'Заполните обязательные поля и проверьте email, телефон и выбранные города.',
      title: 'Проверьте заполненные данные',
    };
  }
  if (failure.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
    return {
      description: 'Обновите страницу и повторите создание организации.',
      title: 'Данные формы изменились',
    };
  }
  return {
    description: failure.message || 'Проверьте соединение и попробуйте ещё раз.',
    title: 'Не удалось создать организацию',
  };
}

async function installationFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = window.sessionStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return fetch(`${API_URL}/api/installation/provisioning${path}`, { ...init, headers });
}

async function operatorMutation(path: string, body: Record<string, unknown>, method = 'POST') {
  const response = await installationFetch(path, {
    body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID() }),
    method,
  });
  if (response.status === 401) {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.location.assign('/installation');
    throw new Error('Сессия оператора завершена. Войдите снова.');
  }
  if (!response.ok) throw new Error((await readError(response, 'Операция не выполнена')).message);
  return response.json();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function currentOffset(timezone: string) {
  const offset = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value || '';
  return offset.replace('GMT', 'UTC').replace(':00', '');
}

function timezoneLabel(value: string) {
  const timezone = timezones.find((item) => item.value === value);
  return timezone ? `${timezone.city} (${currentOffset(timezone.value)})` : value;
}

function ownerStateLabel(state: OwnerState) {
  if (state === 'active') return 'Владелец активен';
  if (state === 'pending_activation') return 'Ожидает активации владельца';
  if (state === 'inactive') return 'Владелец неактивен';
  return 'Владелец не назначен';
}

function tenantStatus(status: 'active' | 'inactive' | 'archived') {
  if (status === 'active') {
    return { label: 'Активна', tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' };
  }
  if (status === 'archived') {
    return { label: 'В архиве', tone: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' };
  }
  return { label: 'Неактивна', tone: 'bg-amber-500/10 text-amber-800 dark:text-amber-300' };
}

function TenantStatusBadge({ status }: { status: 'active' | 'inactive' | 'archived' }) {
  const copy = tenantStatus(status);
  return <span className={cn('inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', copy.tone)}>{copy.label}</span>;
}

function maskedActivationLink(link: string) {
  const url = new URL(link);
  return `${url.origin}${url.pathname}#token=••••••••••••`;
}

function countLabel(count: number, forms: [string, string, string]) {
  const lastTwo = count % 100;
  const last = count % 10;
  const form = lastTwo >= 11 && lastTwo <= 14
    ? forms[2]
    : last === 1
      ? forms[0]
      : last >= 2 && last <= 4
        ? forms[1]
        : forms[2];
  return `${count} ${form}`;
}

function TimezoneSelect({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = timezones.filter((item) => {
    const haystack = `${item.city} ${item.region} ${item.value} ${currentOffset(item.value)}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          className="w-full justify-between bg-background font-normal"
          role="combobox"
          variant="outline"
        >
          <span className="truncate">{timezoneLabel(value)}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(360px,calc(100vw-2rem))] p-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Поиск города или региона"
            autoFocus
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти город или регион"
            value={query}
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.map((item) => (
            <button
              className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-muted"
              key={item.value}
              onClick={() => {
                onChange(item.value);
                setOpen(false);
                setQuery('');
              }}
              type="button"
            >
              <span><span className="font-medium">{item.city}</span><span className="ml-2 text-xs text-muted-foreground">{item.region}</span></span>
              <span className="shrink-0 text-xs text-muted-foreground">{currentOffset(item.value)}</span>
            </button>
          ))}
          {filtered.length === 0 ? <p className="px-3 py-4 text-center text-sm text-muted-foreground">Город не найден</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProvisioningLogin({ onReady }: { onReady: () => Promise<void> }) {
  const [credentials, setCredentials] = useState({ password: '', username: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await installationFetch('/session', {
        body: JSON.stringify(credentials),
        method: 'POST',
      });
      if (!response.ok) throw new Error((await readError(response, 'Не удалось войти')).message);
      window.sessionStorage.setItem(
        TOKEN_KEY,
        ((await response.json()) as { token: string }).token,
      );
      await onReady();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось войти');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-muted/35 p-4 sm:p-8">
      <div className="mx-auto flex max-w-5xl justify-end"><ThemeToggle /></div>
      <div className="mx-auto grid min-h-[calc(100vh-7rem)] max-w-5xl items-center gap-10 lg:grid-cols-[1fr_0.82fr]">
        <section className="hidden space-y-5 lg:block">
          <div className="flex items-center gap-3"><BrandMark className="size-12" decorative /><span className="text-xl font-semibold text-primary">Setly</span></div>
          <h1 className="max-w-xl text-4xl font-semibold tracking-tight">Управление организациями</h1>
        </section>
        <Card className="mx-auto w-full max-w-md rounded-2xl shadow-lg shadow-foreground/5">
          <CardHeader className="space-y-4">
            <div className="flex items-center gap-3 lg:hidden"><BrandMark className="size-10" decorative /><span className="font-semibold text-primary">Setly</span></div>
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><KeyRound className="size-5" /></div>
            <CardTitle>Вход оператора</CardTitle>
          </CardHeader>
          <CardContent><form autoComplete="off" className="space-y-4" onSubmit={submit}>
            <div className="space-y-2"><Label htmlFor="operator-username">Логин</Label><Input id="operator-username" autoComplete="off" name="installationOperatorUsername" value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} required /></div>
            <div className="space-y-2"><Label htmlFor="operator-password">Пароль</Label><Input id="operator-password" type="password" autoComplete="new-password" name="installationOperatorPassword" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required /></div>
            {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
            <Button className="w-full" disabled={submitting} type="submit">{submitting ? 'Входим…' : 'Войти'}</Button>
            <Button asChild className="w-full" variant="ghost">
              <a href="https://setly.tech/login">
                <ArrowLeft className="mr-2 size-4" />
                Вернуться к обычному входу
              </a>
            </Button>
          </form></CardContent>
        </Card>
      </div>
    </main>
  );
}

type BeelineFormSettings = {
  apiBaseUrl: string;
  apiTimeoutMs: number;
  callbackBaseUrl: string;
  recordsPath: string;
  statisticsPath: string;
  subscriptionAutoRenewEnabled: boolean;
  subscriptionExpiresSeconds: number;
  subscriptionPath: string;
  subscriptionPattern: string | null;
  subscriptionRenewBeforeSeconds: number;
  subscriptionType: 'BASIC_CALL' | 'ADVANCED_CALL';
};

function beelineFormSettings(state: IntegrationState): BeelineFormSettings {
  const value = state.settings;
  return {
    apiBaseUrl: String(value.apiBaseUrl || 'https://cloudpbx.beeline.ru/apis/portal'),
    apiTimeoutMs: Number(value.apiTimeoutMs || 15000),
    callbackBaseUrl: String(value.callbackBaseUrl || 'https://api.setly.tech/api/integrations/beeline/events'),
    recordsPath: String(value.recordsPath || '/records'),
    statisticsPath: String(value.statisticsPath || '/v2/statistics'),
    subscriptionAutoRenewEnabled: value.subscriptionAutoRenewEnabled === true,
    subscriptionExpiresSeconds: Number(value.subscriptionExpiresSeconds || 3600),
    subscriptionPath: String(value.subscriptionPath || '/subscription'),
    subscriptionPattern: typeof value.subscriptionPattern === 'string' ? value.subscriptionPattern : null,
    subscriptionRenewBeforeSeconds: Number(value.subscriptionRenewBeforeSeconds || 1200),
    subscriptionType: value.subscriptionType === 'ADVANCED_CALL' ? 'ADVANCED_CALL' : 'BASIC_CALL',
  };
}

function ConnectionForm({
  mode,
  onClose,
  onSave,
  provider,
  state,
}: {
  mode: 'configure' | 'edit' | 'rotate';
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  provider: IntegrationProvider;
  state: IntegrationState;
}) {
  const [credential, setCredential] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [removeProxy, setRemoveProxy] = useState(false);
  const [settings, setSettings] = useState(() => beelineFormSettings(state));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const copy = providerCopy[provider];
  const secretLabel = provider === 'beeline'
    ? 'Токен API'
    : provider === 'evotor'
      ? 'Секрет webhook'
      : 'Токен бота';
  const showSecretFields = mode !== 'edit';
  const showSettingsFields = mode !== 'rotate';
  const title = mode === 'rotate'
    ? 'Заменить учётные данные'
    : mode === 'edit'
      ? 'Настройки подключения'
      : 'Новое подключение';

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const payload: Record<string, unknown> = {};
    if (credential) payload.credential = credential;
    if (provider === 'beeline' && mode !== 'rotate') payload.settings = settings;
    if (provider === 'telegram' && mode !== 'edit') {
      if (removeProxy) payload.proxyUrl = null;
      else if (proxyUrl) payload.proxyUrl = proxyUrl;
    }
    setPendingPayload(payload);
  }

  async function confirmSave() {
    if (!pendingPayload) return;
    setSaving(true);
    setError('');
    try {
      await onSave(pendingPayload);
      setCredential('');
      setProxyUrl('');
      setPendingPayload(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить подключение');
      setPendingPayload(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <Card className="mt-6 rounded-2xl border-primary/25" id="integration-form-preview">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">{title} · {copy.label}</CardTitle>
          </div>
          <Button onClick={onClose} type="button" variant="ghost">Закрыть</Button>
        </div>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5 sm:grid-cols-2" onSubmit={submit}>
          {state.configured ? (
            <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm sm:col-span-2 sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Подключение</p><p className="mt-1 font-medium">{state.safeIdentity || 'Настроено'}</p></div>
              <div><p className="text-xs text-muted-foreground">Последняя проверка</p><p className="mt-1 font-medium">{state.lastValidatedAt ? formatDate(state.lastValidatedAt) : 'Ещё не запускалась'}</p></div>
              <div><p className="text-xs text-muted-foreground">Последнее событие</p><p className="mt-1 font-medium">{state.lastActivityAt ? formatDate(state.lastActivityAt) : 'Событий пока нет'}</p></div>
            </div>
          ) : null}
          {showSettingsFields && provider === 'beeline' ? (
            <>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="beeline-api">Адрес API Билайна</Label><Input required value={settings.apiBaseUrl} onChange={(event) => setSettings({ ...settings, apiBaseUrl: event.target.value })} id="beeline-api" type="url" /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="beeline-callback-base">Базовый адрес callback</Label><Input required value={settings.callbackBaseUrl} onChange={(event) => setSettings({ ...settings, callbackBaseUrl: event.target.value })} id="beeline-callback-base" type="url" /></div>
              <div className="space-y-2"><Label htmlFor="beeline-records">Путь к записям</Label><Input required value={settings.recordsPath} onChange={(event) => setSettings({ ...settings, recordsPath: event.target.value })} id="beeline-records" /></div>
              <div className="space-y-2"><Label htmlFor="beeline-statistics">Путь к статистике</Label><Input required value={settings.statisticsPath} onChange={(event) => setSettings({ ...settings, statisticsPath: event.target.value })} id="beeline-statistics" /></div>
              <div className="space-y-2"><Label htmlFor="beeline-subscription">Путь к подписке</Label><Input required value={settings.subscriptionPath} onChange={(event) => setSettings({ ...settings, subscriptionPath: event.target.value })} id="beeline-subscription" /></div>
              <div className="space-y-2"><Label htmlFor="beeline-pattern">Шаблон событий</Label><Input value={settings.subscriptionPattern || ''} onChange={(event) => setSettings({ ...settings, subscriptionPattern: event.target.value || null })} id="beeline-pattern" /></div>
              <div className="space-y-2"><Label htmlFor="beeline-type">Тип подписки</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" id="beeline-type" value={settings.subscriptionType} onChange={(event) => setSettings({ ...settings, subscriptionType: event.target.value as BeelineFormSettings['subscriptionType'] })}><option value="BASIC_CALL">BASIC_CALL</option><option value="ADVANCED_CALL">ADVANCED_CALL</option></select></div>
              <div className="space-y-2"><Label htmlFor="beeline-timeout">Таймаут API, мс</Label><Input required value={settings.apiTimeoutMs} onChange={(event) => setSettings({ ...settings, apiTimeoutMs: Number(event.target.value) })} id="beeline-timeout" inputMode="numeric" type="number" /></div>
              <div className="space-y-2"><Label htmlFor="beeline-expiry">Срок подписки, сек.</Label><Input required value={settings.subscriptionExpiresSeconds} onChange={(event) => setSettings({ ...settings, subscriptionExpiresSeconds: Number(event.target.value) })} id="beeline-expiry" inputMode="numeric" type="number" /></div>
              <div className="space-y-2"><Label htmlFor="beeline-renew-before">Продлевать заранее, сек.</Label><Input required value={settings.subscriptionRenewBeforeSeconds} onChange={(event) => setSettings({ ...settings, subscriptionRenewBeforeSeconds: Number(event.target.value) })} id="beeline-renew-before" inputMode="numeric" type="number" /></div>
              <label className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm sm:col-span-2"><input checked={settings.subscriptionAutoRenewEnabled} onChange={(event) => setSettings({ ...settings, subscriptionAutoRenewEnabled: event.target.checked })} type="checkbox" />Автоматически продлевать подписку</label>
            </>
          ) : null}
          {showSettingsFields && provider === 'evotor' ? (
            <div className="rounded-xl border bg-muted/25 p-4 text-sm sm:col-span-2">
              <p className="text-xs text-muted-foreground">Callback URL</p>
              <p className="mt-1 break-all font-mono text-xs">{state.safeCallbackUrl || 'Адрес появится после создания подключения'}</p>
              <p className="mt-3 text-muted-foreground">Проверка конфигурации — локальная. Подключение подтвердится после первого события Эвотора.</p>
            </div>
          ) : null}
          {showSecretFields ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${provider}-secret`}>{secretLabel} · только запись</Label>
              <Input autoComplete="new-password" id={`${provider}-secret`} onChange={(event) => setCredential(event.target.value)} placeholder={mode === 'rotate' ? 'Введите новое значение' : 'Введите значение'} required type="password" value={credential} />
            </div>
          ) : null}
          {showSecretFields && provider === 'telegram' ? (
            <div className="space-y-3 sm:col-span-2"><div className="space-y-2"><Label htmlFor="telegram-proxy">Прокси · только запись</Label><Input autoComplete="new-password" disabled={removeProxy} id="telegram-proxy" onChange={(event) => setProxyUrl(event.target.value)} placeholder="Оставьте пустым, если прокси не меняется" type="password" value={proxyUrl} /></div>{state.proxyConfigured ? <label className="flex items-center gap-3 text-sm"><input checked={removeProxy} onChange={(event) => setRemoveProxy(event.target.checked)} type="checkbox" />Удалить текущий прокси</label> : null}</div>
          ) : null}
          {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive sm:col-span-2">{error}</div> : null}
          <div className="sm:col-span-2">
            <Button disabled={saving} type="submit">
              {mode === 'rotate'
                ? 'Обновить учётные данные'
                : mode === 'edit'
                  ? 'Сохранить настройки'
                  : 'Подключить'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
    <ConfirmActionDialog
      action={pendingPayload ? integrationSaveCopy(provider, mode) : null}
      loading={saving}
      onCancel={() => setPendingPayload(null)}
      onConfirm={confirmSave}
    />
    </>
  );
}

function LifecycleImpactPreview({
  entity,
  onClose,
  onConfirm,
  status,
}: {
  entity: 'club' | 'organization';
  onClose: () => void;
  onConfirm: () => Promise<void>;
  status: 'active' | 'inactive' | 'archived';
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isActive = status === 'active';
  const isOrganization = entity === 'organization';
  const noun = isOrganization ? 'организацию' : 'клуб';
  const title = isActive
    ? `Архивировать ${noun}?`
    : `Восстановить ${noun}?`;
  const description = isActive
    ? isOrganization
      ? 'Архивирование не удаляет клубы, историю, файлы и подключения организации. Организация и её клубы исчезнут из CRM, интеграции перестанут принимать новые события.'
      : 'Архивирование не удаляет историю, файлы и подключения клуба. Клуб исчезнет из CRM, интеграции перестанут принимать новые события.'
    : isOrganization
      ? 'Перед восстановлением Setly проверит владельца, клубы и доступы. Организация вернётся в CRM только когда вся структура готова к работе.'
      : 'Перед восстановлением Setly проверит организацию и доступы. Клуб вернётся в CRM только когда вся структура готова к работе.';

  async function confirm() {
    setSaving(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Операция не выполнена');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={saving} onClick={confirm} type="button" variant={isActive ? 'destructive' : 'default'}>
              {isActive ? <Archive className="mr-2 size-4" /> : <ArchiveRestore className="mr-2 size-4" />}
              {saving ? 'Выполняем…' : isActive ? 'Подтвердить архивирование' : 'Подтвердить восстановление'}
            </Button>
            <Button disabled={saving} onClick={onClose} type="button" variant="ghost">Отмена</Button>
          </div>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

function OrganizationSettings({
  onLifecycle,
  onSave,
  organization,
}: {
  onLifecycle: () => Promise<void>;
  onSave: (name: string) => Promise<void>;
  organization: InstallationOrganization;
}) {
  const [showImpact, setShowImpact] = useState(false);
  const [name, setName] = useState(organization.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isActive = organization.status === 'active';

  async function save() {
    setSaving(true);
    setError('');
    try {
      await onSave(name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить организацию');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-lg">Основные данные</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="organization-settings-name">Название организации</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} id="organization-settings-name" />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button disabled={saving || name.trim() === organization.name} onClick={save} type="button">{saving ? 'Сохраняем…' : 'Сохранить изменения'}</Button>
        </CardContent>
      </Card>
      <Card className="rounded-2xl">
        <CardHeader><div className="flex items-center justify-between gap-3"><CardTitle className="text-lg">Состояние</CardTitle><TenantStatusBadge status={organization.status} /></div></CardHeader>
        <CardContent>
          <Button onClick={() => setShowImpact(true)} type="button" variant={isActive ? 'destructive' : 'outline'}>
            {isActive ? <Archive className="mr-2 size-4" /> : <ArchiveRestore className="mr-2 size-4" />}
            {isActive ? 'Архивировать организацию' : 'Восстановить организацию'}
          </Button>
        </CardContent>
      </Card>
      {showImpact ? <div className="lg:col-span-2"><LifecycleImpactPreview entity="organization" onClose={() => setShowImpact(false)} onConfirm={onLifecycle} status={organization.status} /></div> : null}
    </div>
  );
}

function ClubSettings({
  club,
  onLifecycle,
  onSave,
}: {
  club: InstallationOrganization['clubs'][number];
  onLifecycle: () => Promise<void>;
  onSave: (input: { name: string; timezone: string }) => Promise<void>;
}) {
  const [timezone, setTimezone] = useState(club.timezone);
  const [name, setName] = useState(club.name);
  const [showImpact, setShowImpact] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isActive = club.status === 'active';

  async function save() {
    setSaving(true);
    setError('');
    try {
      await onSave({ name, timezone });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить клуб');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-lg">Основные данные</CardTitle></CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="club-settings-name">Название клуба</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} id="club-settings-name" />
          </div>
          <div className="space-y-2">
            <Label>Город и часовой пояс</Label>
            <TimezoneSelect onChange={setTimezone} value={timezone} />
          </div>
          {error ? <p className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
          <Button className="sm:col-span-2 sm:w-fit" disabled={saving || (name.trim() === club.name && timezone === club.timezone)} onClick={save} type="button">{saving ? 'Сохраняем…' : 'Сохранить изменения'}</Button>
        </CardContent>
      </Card>
      <Card className="rounded-2xl">
        <CardHeader><div className="flex items-center justify-between gap-3"><CardTitle className="text-lg">Состояние</CardTitle><TenantStatusBadge status={club.status} /></div></CardHeader>
        <CardContent>
          <Button onClick={() => setShowImpact(true)} type="button" variant={isActive ? 'destructive' : 'outline'}>
            {isActive ? <Archive className="mr-2 size-4" /> : <ArchiveRestore className="mr-2 size-4" />}
            {isActive ? 'Архивировать клуб' : 'Восстановить клуб'}
          </Button>
        </CardContent>
      </Card>
      {showImpact ? <div className="lg:col-span-2"><LifecycleImpactPreview entity="club" onClose={() => setShowImpact(false)} onConfirm={onLifecycle} status={club.status} /></div> : null}
    </div>
  );
}

export default function InstallationProvisioningPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const isCreateRoute = location.pathname === '/installation/provisioning';
  const organizationRoute = location.pathname.match(
    /^\/installation\/organizations\/(\d+)(?:\/(settings)|\/clubs\/(\d+)\/(integrations|settings)(?:\/(beeline|evotor|telegram|vk))?)?$/u,
  );
  const organizationId = organizationRoute ? Number(organizationRoute[1]) : null;
  const isOrganizationSettingsRoute = organizationRoute?.[2] === 'settings';
  const clubId = organizationRoute?.[3] ? Number(organizationRoute[3]) : null;
  const clubSection = organizationRoute?.[4] || null;
  const providerSegment = organizationRoute?.[5] as IntegrationProvider | undefined;
  const selectedProvider = providerSegment && providerValues.has(providerSegment)
    ? providerSegment
    : null;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [managementEnabled, setManagementEnabled] = useState(false);
  const [provisioningEnabled, setProvisioningEnabled] = useState(false);
  const [snapshot, setSnapshot] = useState<InstallationSnapshot | null>(null);
  const [organizationDetail, setOrganizationDetail] = useState<InstallationOrganization | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState<OperatorError | null>(null);
  const [ownerPhoneError, setOwnerPhoneError] = useState('');
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [result, setResult] = useState<ProvisioningResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [organization, setOrganization] = useState(freshOrganization);
  const [clubs, setClubs] = useState<ClubDraft[]>(freshClubs);
  const [owner, setOwner] = useState(freshOwner);
  const [connectionFormMode, setConnectionFormMode] = useState<'configure' | 'edit' | 'rotate' | null>(null);
  const [integrationAction, setIntegrationAction] = useState('');
  const [pendingIntegrationAction, setPendingIntegrationAction] = useState<{
    command: IntegrationCommand;
    confirmation: ConfirmAction;
    provider: IntegrationProvider;
  } | null>(null);

  async function loadSnapshot() {
    const response = await installationFetch('/snapshot');
    if (response.status === 401) {
      window.sessionStorage.removeItem(TOKEN_KEY);
      setSnapshot(null);
      throw new Error('Сессия истекла. Войдите снова.');
    }
    if (!response.ok) throw new Error((await readError(response, 'Не удалось загрузить организации')).message);
    setSnapshot((await response.json()) as InstallationSnapshot);
    setPageError('');
  }

  async function loadOrganization(id: number) {
    setDetailLoading(true);
    try {
      const response = await installationFetch(`/organizations/${id}`);
      if (response.status === 401) {
        window.sessionStorage.removeItem(TOKEN_KEY);
        setSnapshot(null);
        setOrganizationDetail(null);
        throw new Error('Сессия истекла. Войдите снова.');
      }
      if (!response.ok) {
        throw new Error((await readError(response, 'Не удалось загрузить организацию')).message);
      }
      setOrganizationDetail((await response.json()) as InstallationOrganization);
      setPageError('');
    } catch (caught) {
      setPageError(caught instanceof Error ? caught.message : 'Не удалось загрузить организацию');
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await installationFetch('/status');
        const status = (await response.json()) as {
          enabled: boolean;
          managementEnabled: boolean;
          provisioningEnabled: boolean;
        };
        setEnabled(status.enabled);
        setManagementEnabled(status.managementEnabled);
        setProvisioningEnabled(status.provisioningEnabled);
        if (status.enabled && window.sessionStorage.getItem(TOKEN_KEY)) await loadSnapshot();
      } catch (caught) {
        setPageError(caught instanceof Error ? caught.message : 'Не удалось открыть рабочее место оператора');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    setConnectionFormMode(null);
    setPendingIntegrationAction(null);
    if (!snapshot || !organizationId || !managementEnabled) {
      setOrganizationDetail(null);
      return;
    }
    void loadOrganization(organizationId);
  }, [location.pathname, managementEnabled, organizationId, snapshot]);

  const canContinue = useMemo(() => {
    if (step === 0) return Boolean(organization.name.trim());
    if (step === 1) return clubs.length > 0 && clubs.every((club) => club.name.trim() && club.timezone);
    if (step === 2) return Boolean(owner.name.trim() && owner.email.trim() && owner.phone.trim());
    return true;
  }, [clubs, organization, owner, step]);

  function resetForm() {
    setOrganization(freshOrganization());
    setClubs(freshClubs());
    setOwner(freshOwner());
    setResult(null);
    setStep(0);
    setIdempotencyKey(crypto.randomUUID());
    setCopyDone(false);
    setFormError(null);
    setOwnerPhoneError('');
  }

  function openCreate() {
    resetForm();
    navigate('/installation/provisioning');
  }

  async function logout() {
    try {
      if (window.sessionStorage.getItem(TOKEN_KEY)) {
        await installationFetch('/session/revoke', { method: 'POST' });
      }
    } catch {
      // Local session removal remains fail-closed when the network is unavailable.
    }
    window.sessionStorage.removeItem(TOKEN_KEY);
    setSnapshot(null);
    setOrganizationDetail(null);
    resetForm();
    navigate('/installation', { replace: true });
  }

  async function refreshOrganization() {
    if (!organizationId) return;
    await Promise.all([loadOrganization(organizationId), loadSnapshot()]);
  }

  async function saveOrganizationName(name: string) {
    if (!organizationDetail) return;
    await operatorMutation(`/organizations/${organizationDetail.id}`, {
      expectedUpdatedAt: organizationDetail.updatedAt,
      name,
    }, 'PUT');
    await refreshOrganization();
  }

  async function changeOrganizationLifecycle() {
    if (!organizationDetail) return;
    const action = organizationDetail.status === 'active' ? 'archive' : 'reactivate';
    await operatorMutation(`/organizations/${organizationDetail.id}/${action}`, {
      confirmImpact: action === 'archive',
      expectedUpdatedAt: organizationDetail.updatedAt,
    });
    await refreshOrganization();
  }

  async function saveClubSettings(input: { name: string; timezone: string }) {
    if (!organizationDetail || !selectedClub) return;
    await operatorMutation(
      `/organizations/${organizationDetail.id}/clubs/${selectedClub.id}`,
      { ...input, expectedUpdatedAt: selectedClub.updatedAt },
      'PUT',
    );
    await refreshOrganization();
  }

  async function changeClubLifecycle() {
    if (!organizationDetail || !selectedClub) return;
    const action = selectedClub.status === 'active' ? 'archive' : 'reactivate';
    await operatorMutation(
      `/organizations/${organizationDetail.id}/clubs/${selectedClub.id}/${action}`,
      {
        confirmImpact: action === 'archive',
        expectedUpdatedAt: selectedClub.updatedAt,
      },
    );
    await refreshOrganization();
  }

  async function saveIntegration(payload: Record<string, unknown>) {
    if (!organizationDetail || !selectedClub || !selectedIntegration || !selectedProvider || !connectionFormMode) return;
    const path = `/organizations/${organizationDetail.id}/clubs/${selectedClub.id}/integrations/${selectedProvider}`;
    await operatorMutation(
      connectionFormMode === 'rotate' ? `${path}/credentials` : path,
      {
        ...payload,
        expectedUpdatedAt: selectedIntegration.updatedAt,
      },
      connectionFormMode === 'rotate' ? 'POST' : 'PUT',
    );
    setConnectionFormMode(null);
    await refreshOrganization();
  }

  async function runIntegrationAction(provider: IntegrationProvider, action: IntegrationCommand) {
    if (!organizationDetail || !selectedClub) return;
    const integration = selectedClub.integrations.find((item) => item.provider === provider);
    if (!integration?.updatedAt) return;
    const actionKey = `${provider}:${action}`;
    setIntegrationAction(actionKey);
    setPageError('');
    try {
      await operatorMutation(
        `/organizations/${organizationDetail.id}/clubs/${selectedClub.id}/integrations/${provider}/${action}`,
        { expectedUpdatedAt: integration.updatedAt },
      );
      await refreshOrganization();
    } catch (caught) {
      setPageError(caught instanceof Error ? caught.message : 'Операция не выполнена');
    } finally {
      setIntegrationAction('');
    }
  }

  function requestIntegrationAction(
    provider: IntegrationProvider,
    command: IntegrationCommand,
  ) {
    setPendingIntegrationAction({
      command,
      confirmation: integrationCommandCopy(provider, command),
      provider,
    });
  }

  async function confirmIntegrationAction() {
    if (!pendingIntegrationAction) return;
    const { command, provider } = pendingIntegrationAction;
    await runIntegrationAction(provider, command);
    setPendingIntegrationAction(null);
  }

  async function createOrganization() {
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await installationFetch('/organizations', {
        body: JSON.stringify({
          clubs,
          idempotencyKey,
          organization,
          owner: { ...owner, phone: russianPhoneE164(owner.phone) },
        }),
        method: 'POST',
      });
      if (!response.ok) throw createErrorMessage(await readError(response, 'Не удалось создать организацию'));
      setResult((await response.json()) as ProvisioningResult);
      await loadSnapshot();
    } catch (caught) {
      if (caught && typeof caught === 'object' && 'title' in caught && 'description' in caught) {
        setFormError(caught as OperatorError);
      } else {
        setFormError({ description: 'Проверьте соединение и попробуйте ещё раз.', title: 'Не удалось создать организацию' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function reissueActivation() {
    if (!result) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await installationFetch(`/organizations/${result.organization.id}/activation/reissue`, { method: 'POST' });
      if (!response.ok) throw new Error((await readError(response, 'Не удалось выпустить новую ссылку')).message);
      const reissued = (await response.json()) as Pick<ProvisioningResult, 'activation' | 'audit'>;
      setResult({ ...result, ...reissued });
      setCopyDone(false);
      await loadSnapshot();
    } catch (caught) {
      setFormError({
        description: caught instanceof Error ? caught.message : 'Попробуйте ещё раз.',
        title: 'Не удалось выпустить новую ссылку',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function copyActivation() {
    if (!result?.activation.link) return;
    await navigator.clipboard.writeText(result.activation.link);
    setCopyDone(true);
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Загрузка…</div>;
  if (!enabled) return <div className="flex min-h-screen items-center justify-center bg-muted/35 p-4"><Card className="w-full max-w-lg rounded-2xl"><CardHeader><CardTitle>Рабочее место оператора недоступно</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Обратитесь к администратору Setly.</CardContent></Card></div>;
  if (!snapshot) return <ProvisioningLogin onReady={async () => { await loadSnapshot(); navigate('/installation', { replace: true }); }} />;

  const totalClubs = snapshot.organizations.reduce((sum, item) => sum + item.clubCount, 0);
  const CurrentIcon = steps[step].icon;
  const selectedClub = clubId
    ? organizationDetail?.clubs.find((club) => club.id === clubId) || null
    : null;
  const integrationMutationsEnabled = Boolean(
    selectedClub?.status === 'active' && organizationDetail?.status === 'active',
  );
  const selectedIntegration = selectedProvider && selectedClub
    ? selectedClub.integrations.find((item) => item.provider === selectedProvider) || null
    : null;
  const canShowCreateRoute = isCreateRoute && provisioningEnabled;

  return (
    <main className="min-h-screen bg-muted/35 p-3 sm:p-5 xl:p-7">
      <div className="mx-auto min-h-[calc(100vh-1.5rem)] max-w-[1500px] overflow-hidden rounded-2xl border bg-background shadow-sm sm:min-h-[calc(100vh-2.5rem)] xl:min-h-[calc(100vh-3.5rem)]">
        <header className="flex flex-col items-stretch gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
          <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => navigate('/installation')} type="button">
            <BrandMark className="size-10" decorative />
            <div className="min-w-0"><span className="font-semibold text-primary">Setly</span><p className="truncate text-xs text-muted-foreground">Для операторов</p></div>
          </button>
          <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end"><Button variant="ghost" onClick={() => navigate('/installation')}>Организации</Button><div className="flex items-center gap-2"><ThemeToggle /><Button variant="outline" onClick={logout}>Выйти</Button></div></div>
        </header>

        {!canShowCreateRoute ? (
          <section className="p-3 sm:p-7 lg:p-10">
            <div className="mx-auto max-w-6xl">
              {detailLoading ? (
                <div className="py-20 text-center text-sm text-muted-foreground">Загружаем организацию…</div>
              ) : isOrganizationSettingsRoute && organizationDetail ? (
                <>
                  <nav aria-label="Навигация" className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
                    <button className="rounded-md px-2 py-1 hover:bg-muted hover:text-foreground" onClick={() => navigate('/installation')} type="button">Организации</button>
                    <ChevronRight className="size-4" />
                    <button className="max-w-[140px] truncate rounded-md px-2 py-1 hover:bg-muted hover:text-foreground sm:max-w-[240px]" onClick={() => navigate(`/installation/organizations/${organizationDetail.id}`)} type="button">{organizationDetail.name}</button>
                    <ChevronRight className="size-4" />
                    <span className="px-2 py-1 text-foreground">Настройки</span>
                  </nav>
                  <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Settings2 className="size-6" /></div>
                    <div className="min-w-0"><p className="text-sm text-muted-foreground">Организация</p><h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">Настройки · {organizationDetail.name}</h1></div>
                  </div>
                  <OrganizationSettings key={`${organizationDetail.id}-${organizationDetail.updatedAt}`} onLifecycle={changeOrganizationLifecycle} onSave={saveOrganizationName} organization={organizationDetail} />
                </>
              ) : selectedClub && organizationDetail && clubSection === 'settings' ? (
                <>
                  <nav aria-label="Навигация" className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
                    <button className="rounded-md px-2 py-1 hover:bg-muted hover:text-foreground" onClick={() => navigate('/installation')} type="button">Организации</button>
                    <ChevronRight className="size-4" />
                    <button className="max-w-[140px] truncate rounded-md px-2 py-1 hover:bg-muted hover:text-foreground sm:max-w-[240px]" onClick={() => navigate(`/installation/organizations/${organizationDetail.id}`)} type="button">{organizationDetail.name}</button>
                    <ChevronRight className="size-4" />
                    <span className="max-w-[240px] truncate px-2 py-1 text-foreground">{selectedClub.name}</span>
                  </nav>
                  <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Settings2 className="size-6" /></div>
                    <div className="min-w-0"><p className="break-words text-sm text-muted-foreground">{organizationDetail.name}</p><h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">Настройки · {selectedClub.name}</h1></div>
                  </div>
                  <ClubSettings club={selectedClub} key={`${selectedClub.id}-${selectedClub.updatedAt}`} onLifecycle={changeClubLifecycle} onSave={saveClubSettings} />
                </>
              ) : selectedClub && organizationDetail && selectedProvider && selectedIntegration && clubSection === 'integrations' ? (
                <>
                  <nav aria-label="Навигация" className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
                    <button className="rounded-md px-2 py-1 hover:bg-muted hover:text-foreground" onClick={() => navigate('/installation')} type="button">Организации</button>
                    <ChevronRight className="size-4" />
                    <button className="max-w-[140px] truncate rounded-md px-2 py-1 hover:bg-muted hover:text-foreground sm:max-w-[240px]" onClick={() => navigate(`/installation/organizations/${organizationDetail.id}`)} type="button">{organizationDetail.name}</button>
                    <ChevronRight className="size-4" />
                    <button className="max-w-[140px] truncate rounded-md px-2 py-1 hover:bg-muted hover:text-foreground sm:max-w-[220px]" onClick={() => navigate(`/installation/organizations/${organizationDetail.id}/clubs/${selectedClub.id}/integrations`)} type="button">{selectedClub.name}</button>
                    <ChevronRight className="size-4" />
                    <span className="px-2 py-1 text-foreground">{providerCopy[selectedProvider].label}</span>
                  </nav>
                  <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ProviderIcon provider={selectedProvider} /></div>
                      <div className="min-w-0">
                        <p className="break-words text-sm text-muted-foreground">{selectedClub.name} · {providerCopy[selectedProvider].description}</p>
                        <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{providerCopy[selectedProvider].label}</h1>
                      </div>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-3 py-1.5 text-sm font-medium', integrationStatus(selectedIntegration).tone)}>{integrationStatus(selectedIntegration).label}</span>
                  </div>
                  {pageError ? <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{pageError}</div> : null}
                  <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.62fr)]">
                    <Card className="rounded-2xl">
                      <CardHeader><CardTitle className="text-lg">Состояние подключения</CardTitle></CardHeader>
                      <CardContent className="grid gap-5 sm:grid-cols-2">
                        <div><p className="text-xs text-muted-foreground">Проверка</p><p className="mt-1 text-sm font-medium">{validationDescription(selectedIntegration) || 'Подключение ещё не настроено.'}</p></div>
                        <div><p className="text-xs text-muted-foreground">Идентификатор</p><p className="mt-1 break-all text-sm font-medium">{selectedIntegration.safeIdentity || 'Появится после настройки'}</p></div>
                        <div><p className="text-xs text-muted-foreground">Последнее событие</p><p className="mt-1 text-sm font-medium">{selectedIntegration.lastActivityAt ? formatDate(selectedIntegration.lastActivityAt) : 'Событий пока нет'}</p></div>
                        <div><p className="text-xs text-muted-foreground">Учётные данные</p><p className="mt-1 text-sm font-medium">{selectedIntegration.secretUpdatedAt ? `Обновлены ${formatDate(selectedIntegration.secretUpdatedAt)}` : 'Не сохранены'}</p></div>
                        {selectedIntegration.safeCallbackUrl ? <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Callback URL</p><p className="mt-1 break-all font-mono text-xs">{selectedIntegration.safeCallbackUrl}</p></div> : null}
                      </CardContent>
                    </Card>
                    <Card className="rounded-2xl">
                      <CardHeader><CardTitle className="text-lg">Управление</CardTitle></CardHeader>
                      <CardContent className="space-y-3">
                        {selectedIntegration.status !== 'revoked' && !selectedIntegration.configured ? <Button className="w-full justify-start" disabled={!integrationMutationsEnabled} onClick={() => setConnectionFormMode('configure')} type="button"><Settings2 className="mr-2 size-4" />Настроить подключение</Button> : null}
                        {selectedIntegration.configured && selectedProvider === 'beeline' && selectedIntegration.status !== 'revoked' ? <Button className="w-full justify-start" disabled={!integrationMutationsEnabled} onClick={() => setConnectionFormMode('edit')} type="button" variant="outline"><Settings2 className="mr-2 size-4" />Изменить настройки</Button> : null}
                        {selectedIntegration.configured ? <Button className="w-full justify-start" disabled={!integrationMutationsEnabled} onClick={() => setConnectionFormMode('rotate')} type="button" variant="outline"><KeyRound className="mr-2 size-4" />Обновить учётные данные</Button> : null}
                        {selectedIntegration.configured && selectedIntegration.status !== 'revoked' ? <Button className="w-full justify-start" disabled={!integrationMutationsEnabled || Boolean(integrationAction)} onClick={() => requestIntegrationAction(selectedProvider, 'validate')} type="button" variant="outline"><ShieldCheck className="mr-2 size-4" />Проверить подключение</Button> : null}
                        {selectedIntegration.configured && selectedIntegration.status !== 'revoked' ? <Button className="w-full justify-start" disabled={!integrationMutationsEnabled || Boolean(integrationAction)} onClick={() => requestIntegrationAction(selectedProvider, selectedIntegration.status === 'active' ? 'disable' : 'activate')} type="button" variant={selectedIntegration.status === 'active' ? 'destructive' : 'default'}>{selectedIntegration.status === 'active' ? 'Отключить' : 'Включить'}</Button> : null}
                      </CardContent>
                    </Card>
                  </div>

                  {selectedIntegration.configured && selectedIntegration.status === 'active' && (selectedProvider === 'telegram' || selectedProvider === 'vk' || selectedProvider === 'beeline') ? (
                    <section className="mt-7 border-t pt-7">
                      <h2 className="text-lg font-semibold">Операции провайдера</h2>
                      <p className="mt-1 text-sm text-muted-foreground">Используйте их для обслуживания уже работающего подключения.</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {selectedProvider === 'telegram' || selectedProvider === 'vk' ? <Button disabled={!integrationMutationsEnabled || Boolean(integrationAction)} onClick={() => requestIntegrationAction(selectedProvider, 'restart')} type="button" variant="outline"><RefreshCw className="mr-2 size-4" />Перезапустить бота</Button> : null}
                        {selectedProvider === 'beeline' ? <><Button disabled={!integrationMutationsEnabled || Boolean(integrationAction)} onClick={() => requestIntegrationAction('beeline', 'check')} type="button" variant="outline">Проверить подписку</Button><Button disabled={!integrationMutationsEnabled || Boolean(integrationAction)} onClick={() => requestIntegrationAction('beeline', 'renew')} type="button" variant="outline"><RefreshCw className="mr-2 size-4" />Продлить подписку</Button><Button disabled={!integrationMutationsEnabled || Boolean(integrationAction)} onClick={() => requestIntegrationAction('beeline', 'cutover')} type="button" variant="destructive">Переключить callback</Button></> : null}
                      </div>
                    </section>
                  ) : null}

                  {selectedIntegration.configured && selectedIntegration.status !== 'revoked' ? (
                    <section className="mt-7 border-t pt-7">
                      <h2 className="text-lg font-semibold text-destructive">Опасная зона</h2>
                      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Отзыв доступа останавливает подключение и требует новых учётных данных для восстановления.</p>
                      <Button className="mt-4" disabled={!integrationMutationsEnabled || Boolean(integrationAction)} onClick={() => requestIntegrationAction(selectedProvider, 'revoke')} type="button" variant="destructive"><Trash2 className="mr-2 size-4" />Отозвать доступ</Button>
                    </section>
                  ) : null}

                  {connectionFormMode ? <ConnectionForm key={`${selectedProvider}-${connectionFormMode}-${selectedIntegration.updatedAt}`} mode={connectionFormMode} onClose={() => setConnectionFormMode(null)} onSave={saveIntegration} provider={selectedProvider} state={selectedIntegration} /> : null}
                  <ConfirmActionDialog action={pendingIntegrationAction?.confirmation || null} loading={Boolean(integrationAction)} onCancel={() => setPendingIntegrationAction(null)} onConfirm={confirmIntegrationAction} />
                </>
              ) : selectedClub && organizationDetail && clubSection === 'integrations' ? (
                <>
                  <nav aria-label="Навигация" className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
                    <button className="rounded-md px-2 py-1 hover:bg-muted hover:text-foreground" onClick={() => navigate('/installation')} type="button">Организации</button>
                    <ChevronRight className="size-4" />
                    <button className="max-w-[140px] truncate rounded-md px-2 py-1 hover:bg-muted hover:text-foreground sm:max-w-[240px]" onClick={() => navigate(`/installation/organizations/${organizationDetail.id}`)} type="button">{organizationDetail.name}</button>
                    <ChevronRight className="size-4" />
                    <span className="max-w-[240px] truncate px-2 py-1 text-foreground">{selectedClub.name}</span>
                  </nav>
                  <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Cable className="size-6" /></div>
                    <div className="min-w-0"><p className="break-words text-sm text-muted-foreground">{organizationDetail.name}</p><h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">Интеграции · {selectedClub.name}</h1></div>
                  </div>
                  {pageError ? <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{pageError}</div> : null}
                  <div className="mt-7 grid gap-4 md:grid-cols-2">
                    {selectedClub.integrations.map((integration) => {
                      const status = integrationStatus(integration);
                      const copy = providerCopy[integration.provider];
                      return (
                        <Card className="rounded-2xl" key={integration.provider}>
                          <CardHeader className="space-y-4">
                            <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between"><div className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground"><ProviderIcon provider={integration.provider} /></span><div className="min-w-0"><CardTitle className="text-lg">{copy.label}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{copy.description}</p></div></div><span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', status.tone)}>{status.label}</span></div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {validationDescription(integration) ? <p className="text-sm text-muted-foreground">{validationDescription(integration)}</p> : null}
                            {integration.safeIdentity ? <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">Подключено</p><p className="mt-1 text-sm font-medium">{integration.safeIdentity}</p></div> : null}
                            {integration.lastActivityAt ? <p className="text-xs text-muted-foreground">Последнее успешное событие {formatDate(integration.lastActivityAt)}</p> : null}
                            {integration.secretUpdatedAt ? <p className="text-xs text-muted-foreground">Данные обновлены {formatDate(integration.secretUpdatedAt)}</p> : null}
                            <Button className="w-full sm:w-auto" onClick={() => navigate(`/installation/organizations/${organizationDetail.id}/clubs/${selectedClub.id}/integrations/${integration.provider}`)} type="button" variant="outline">Открыть<ArrowRight className="ml-2 size-4" /></Button>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </>
              ) : organizationId && organizationDetail ? (
                <>
                  <Button className="-ml-3" onClick={() => navigate('/installation')} type="button" variant="ghost"><ArrowLeft className="mr-2 size-4" />К организациям</Button>
                  <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><p className="text-sm text-muted-foreground">Организация</p><TenantStatusBadge status={organizationDetail.status} /></div><h1 className="mt-1 max-w-4xl break-words text-2xl font-semibold tracking-tight sm:text-3xl">{organizationDetail.name}</h1></div>
                    <Button className="shrink-0" onClick={() => navigate(`/installation/organizations/${organizationDetail.id}/settings`)} type="button" variant="outline"><Settings2 className="mr-2 size-4" />Настройки организации</Button>
                  </div>
                  {pageError ? <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{pageError}</div> : null}
                  <div className="mt-7 grid gap-4 lg:grid-cols-2">
                    {organizationDetail.clubs.map((club) => {
                      const configured = club.integrations.filter((item) => item.configured).length;
                      return <Card className="rounded-2xl" key={club.id}><CardHeader><div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><CardTitle className="break-words text-lg">{club.name}</CardTitle><TenantStatusBadge status={club.status} /></div><p className="mt-1 text-xs text-muted-foreground">{timezoneLabel(club.timezone)}</p></div><span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{configured} из 4</span></div></CardHeader><CardContent><div className="flex flex-col gap-2 sm:flex-row"><Button className="w-full sm:w-auto" onClick={() => navigate(`/installation/organizations/${organizationDetail.id}/clubs/${club.id}/settings`)} type="button" variant="outline"><Settings2 className="mr-2 size-4" />Настройки клуба</Button><Button className="w-full sm:w-auto" onClick={() => navigate(`/installation/organizations/${organizationDetail.id}/clubs/${club.id}/integrations`)} type="button" variant="outline"><Cable className="mr-2 size-4" />Интеграции</Button></div></CardContent></Card>;
                    })}
                  </div>
                </>
              ) : organizationId ? (
                <div className="py-20 text-center"><p className="text-sm text-muted-foreground">Организация недоступна</p><Button className="mt-4" onClick={() => navigate('/installation')} variant="outline">К списку</Button></div>
              ) : (
                <>
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div><p className="text-sm text-muted-foreground">{countLabel(snapshot.organizations.length, ['организация', 'организации', 'организаций'])} · {countLabel(totalClubs, ['клуб', 'клуба', 'клубов'])}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Организации</h1></div>
                    {provisioningEnabled ? <Button size="lg" onClick={openCreate}><Plus className="mr-2 size-4" />Создать организацию</Button> : null}
                  </div>
                  {pageError ? <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{pageError}</div> : null}
                  <div className="mt-7 overflow-hidden rounded-2xl border">
                    <div className="hidden grid-cols-[minmax(0,1fr)_100px_120px_150px_140px] gap-4 border-b bg-muted/30 px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid"><span>Организация</span><span>Состояние</span><span>Клубы</span><span>Владелец</span><span>Создана</span></div>
                    {snapshot.organizations.map((item) => (
                      <button className="grid w-full gap-3 border-b px-5 py-4 text-left transition last:border-b-0 enabled:hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default md:grid-cols-[minmax(0,1fr)_100px_120px_150px_140px] md:items-center" disabled={!managementEnabled} key={item.id} onClick={() => navigate(`/installation/organizations/${item.id}`)} type="button">
                        <div className="min-w-0"><p className="break-words font-medium">{item.name}</p></div>
                        <div><TenantStatusBadge status={item.status} /></div>
                        <div><span className="text-xs text-muted-foreground md:hidden">Клубы · </span><span className="text-sm">{item.clubCount}</span></div>
                        <div><span className={cn('text-sm', item.ownerState === 'active' && 'text-emerald-700 dark:text-emerald-300', item.ownerState === 'pending_activation' && 'text-amber-700 dark:text-amber-300')}>{ownerStateLabel(item.ownerState)}</span></div>
                        <div><span className="text-xs text-muted-foreground md:hidden">Создана · </span><span className="text-sm text-muted-foreground">{formatDate(item.createdAt)}</span></div>
                      </button>
                    ))}
                    {snapshot.organizations.length === 0 ? <div className="px-5 py-12 text-center text-sm text-muted-foreground">Организаций пока нет</div> : null}
                  </div>
                </>
              )}
            </div>
          </section>
        ) : (
          <div className="grid min-h-[calc(100vh-8rem)] lg:grid-cols-[280px_1fr]">
            <aside className="border-b bg-muted/20 p-4 lg:border-b-0 lg:border-r lg:p-5">
              <Button className="mb-4 w-full justify-start" variant="ghost" onClick={() => navigate('/installation')}><ArrowLeft className="mr-2 size-4" />К организациям</Button>
              <div className="rounded-xl border bg-background p-4"><div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-emerald-600" />Система готова</div></div>
              <nav className="mt-4 grid grid-cols-4 gap-2 lg:grid-cols-1" aria-label="Этапы создания организации">
                {steps.map((item, index) => {
                  const Icon = item.icon;
                  return <button key={item.label} type="button" onClick={() => !result && index <= step && setStep(index)} className={cn('flex min-w-0 flex-col items-center gap-2 rounded-xl border px-2 py-3 text-center text-xs transition lg:flex-row lg:px-3 lg:text-left lg:text-sm', index === step && 'border-primary/35 bg-primary/10 text-primary', index < step && 'border-emerald-500/25 bg-emerald-500/5', (index > step || result) && 'cursor-default opacity-55')}><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background">{index < step ? <Check className="size-4 text-emerald-600" /> : <Icon className="size-4" />}</span><span className="truncate">{item.label}</span></button>;
                })}
              </nav>
            </aside>

            <section className="min-w-0 p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-4xl">
              {result ? (
                <div className="space-y-5">
                  <div className="flex items-start gap-3"><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-6" /></div><div><h1 className="text-2xl font-semibold tracking-tight">Организация создана</h1><p className="mt-1 text-sm text-muted-foreground">{formatDate(result.audit.createdAt)}</p></div></div>
                  <Card className="rounded-2xl border-emerald-500/25"><CardHeader><CardTitle className="text-lg">Передайте владельцу ссылку активации</CardTitle><p className="text-sm text-muted-foreground">Ссылка действует до {formatDate(result.activation.expiresAt)}.</p></CardHeader><CardContent className="space-y-4">
                    {result.activation.link ? <><div className="rounded-xl border bg-muted/30 p-3"><p className="break-all font-mono text-xs">{maskedActivationLink(result.activation.link)}</p></div><div className="flex flex-wrap gap-2"><Button onClick={copyActivation}>{copyDone ? <Check className="mr-2 size-4" /> : <Clipboard className="mr-2 size-4" />}{copyDone ? 'Ссылка скопирована' : 'Скопировать ссылку'}</Button><Button variant="outline" asChild><a href={result.activation.link} target="_blank" rel="noreferrer">Открыть активацию<ExternalLink className="ml-2 size-4" /></a></Button><Button variant="ghost" disabled={submitting} onClick={reissueActivation}><RefreshCw className="mr-2 size-4" />Выпустить новую</Button></div></> : <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm"><p className="font-medium">Ссылка уже была выдана</p><p className="mt-1 text-muted-foreground">Если владелец потерял ссылку, выпустите новую.</p><Button className="mt-3" variant="outline" disabled={submitting} onClick={reissueActivation}><RefreshCw className="mr-2 size-4" />Выпустить новую ссылку</Button></div>}
                  </CardContent></Card>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{result.organization.name}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div><span className="text-muted-foreground">Клубы</span>{result.clubs.map((club) => <div key={club.id} className="mt-2"><p className="font-medium">{club.name}</p><p className="text-xs text-muted-foreground">{timezoneLabel(club.timezone)}</p></div>)}</div></CardContent></Card>
                    <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">Владелец</CardTitle></CardHeader><CardContent className="space-y-4 text-sm"><div><p className="font-medium">{result.owner.name}</p><p className="text-muted-foreground">{result.owner.email}</p></div><div className="rounded-xl border bg-muted/25 p-3"><p className="font-medium">Ожидает активации</p><p className="mt-1 text-xs text-muted-foreground">Записано в журнал действий · {formatDate(result.audit.createdAt)}</p></div></CardContent></Card>
                  </div>
                  {formError ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"><p className="font-medium">{formError.title}</p><p className="mt-1 text-xs opacity-80">{formError.description}</p></div> : null}
                  <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={openCreate}>Создать ещё одну</Button><Button variant="ghost" onClick={() => navigate('/installation')}>К списку организаций</Button></div>
                </div>
              ) : (
                <>
                  <div className="mb-6 flex items-start gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><CurrentIcon className="size-5" /></div><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Шаг {step + 1} из {steps.length}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{steps[step].label}</h1></div></div>

                  {step === 0 ? <Card className="rounded-2xl"><CardHeader><CardTitle className="text-lg">Новая организация</CardTitle></CardHeader><CardContent><div className="max-w-xl space-y-2"><Label htmlFor="org-name">Название организации</Label><Input id="org-name" autoFocus value={organization.name} onChange={(event) => { setFormError(null); setOrganization({ name: event.target.value }); }} placeholder="Введите название" /></div></CardContent></Card> : null}

                  {step === 1 ? <div className="space-y-4">{clubs.map((club, index) => <Card key={index} className="rounded-2xl"><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-base">Клуб {index + 1}</CardTitle><Button size="icon" variant="ghost" aria-label={`Удалить клуб ${index + 1}`} disabled={clubs.length === 1} onClick={() => { setFormError(null); setClubs(clubs.filter((_, itemIndex) => itemIndex !== index)); }}><Trash2 className="size-4" /></Button></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`club-name-${index}`}>Название клуба</Label><Input id={`club-name-${index}`} value={club.name} onChange={(event) => { setFormError(null); setClubs(clubs.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item)); }} placeholder="Введите название" /></div><div className="space-y-2"><Label>Город и часовой пояс</Label><TimezoneSelect value={club.timezone} onChange={(timezone) => { setFormError(null); setClubs(clubs.map((item, itemIndex) => itemIndex === index ? { ...item, timezone } : item)); }} /></div></CardContent></Card>)}<Button variant="outline" onClick={() => { setFormError(null); setClubs([...clubs, { name: '', timezone: DEFAULT_TIMEZONE }]); }}><Plus className="mr-2 size-4" />Добавить клуб</Button></div> : null}

                  {step === 2 ? <Card className="rounded-2xl"><CardHeader><CardTitle className="text-lg">Первый владелец</CardTitle></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="owner-name">Имя</Label><Input id="owner-name" value={owner.name} onChange={(event) => { setFormError(null); setOwner({ ...owner, name: event.target.value }); }} /></div><div className="space-y-2"><Label htmlFor="owner-phone">Телефон</Label><Input id="owner-phone" aria-describedby={ownerPhoneError ? 'owner-phone-error' : undefined} aria-invalid={Boolean(ownerPhoneError)} autoComplete="tel" inputMode="tel" maxLength={18} placeholder="+7 (___) ___-__-__" type="tel" value={owner.phone} onChange={(event) => { setFormError(null); setOwnerPhoneError(''); setOwner({ ...owner, phone: formatRussianPhone(event.target.value) }); }} onPaste={(event) => { event.preventDefault(); setFormError(null); setOwnerPhoneError(''); setOwner({ ...owner, phone: formatRussianPhone(event.clipboardData.getData('text')) }); }} />{ownerPhoneError ? <p className="text-xs text-destructive" id="owner-phone-error">{ownerPhoneError}</p> : null}</div><div className="space-y-2 sm:col-span-2"><Label htmlFor="owner-email">Email</Label><Input id="owner-email" type="email" value={owner.email} onChange={(event) => { setFormError(null); setOwner({ ...owner, email: event.target.value }); }} /></div></CardContent></Card> : null}

                  {step === 3 ? <div className="space-y-4"><Card className="rounded-2xl"><CardHeader><CardTitle className="text-lg">Проверьте данные организации</CardTitle></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center"><div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Организация</p><p className="mt-1 font-medium">{organization.name}</p></div><ChevronRight className="mx-auto hidden size-4 text-muted-foreground sm:block" /><div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Клубы</p><p className="mt-1 font-medium">{clubs.length}</p><div className="mt-1 space-y-1">{clubs.map((club, index) => <p className="text-xs text-muted-foreground" key={`${club.name}-${index}`}>{club.name} · {timezoneLabel(club.timezone)}</p>)}</div></div><ChevronRight className="mx-auto hidden size-4 text-muted-foreground sm:block" /><div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Владелец</p><p className="mt-1 truncate font-medium">{owner.name}</p><p className="truncate text-xs text-muted-foreground">{owner.email}</p></div></div><p className="text-sm text-muted-foreground">После создания передайте владельцу ссылку для задания пароля.</p></CardContent></Card><Button className="w-full sm:w-auto" disabled={submitting} onClick={createOrganization}>{submitting ? 'Создаём…' : 'Создать организацию'}</Button></div> : null}

                  {formError ? <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"><p className="font-medium">{formError.title}</p><p className="mt-1 text-xs opacity-80">{formError.description}</p></div> : null}
                  <div className="mt-8 flex items-center justify-between border-t pt-5"><Button variant="outline" disabled={step === 0 || submitting} onClick={() => setStep((current) => Math.max(0, current - 1))}><ArrowLeft className="mr-2 size-4" />Назад</Button>{step < steps.length - 1 ? <Button disabled={!canContinue} onClick={() => { if (step === 2 && !russianPhoneE164(owner.phone)) { setOwnerPhoneError('Введите полный номер в формате +7 (999) 123-45-67'); return; } setStep((current) => Math.min(steps.length - 1, current + 1)); }}>Продолжить<ArrowRight className="ml-2 size-4" /></Button> : null}</div>
                </>
              )}
            </div></section>
          </div>
        )}
      </div>
    </main>
  );
}
