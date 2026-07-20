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
type IntegrationState = {
  configured: boolean;
  lastActivityAt: string | null;
  lastValidatedAt: string | null;
  provider: IntegrationProvider;
  safeCallbackUrl: string | null;
  safeIdentity: string | null;
  secretUpdatedAt: string | null;
  status: 'active' | 'disabled' | 'revoked' | 'not_configured';
  validationStatus: 'verified' | 'pending_event' | 'failed' | 'not_tested';
};
type InstallationOrganization = {
  clubs: Array<{
    id: number;
    integrations: IntegrationState[];
    name: string;
    status: 'active' | 'inactive' | 'archived';
    timezone: string;
  }>;
  createdAt: string;
  id: number;
  name: string;
  status: 'active' | 'inactive' | 'archived';
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
          <div className="flex items-center gap-3"><img src="/setly-mark.png?v=20260714" alt="" className="size-12 rounded-xl border shadow-sm" /><span className="text-xl font-semibold text-primary">Setly</span></div>
          <h1 className="max-w-xl text-4xl font-semibold tracking-tight">Управление организациями</h1>
        </section>
        <Card className="mx-auto w-full max-w-md rounded-2xl shadow-lg shadow-foreground/5">
          <CardHeader className="space-y-4">
            <div className="flex items-center gap-3 lg:hidden"><img src="/setly-mark.png?v=20260714" alt="" className="size-10 rounded-xl border" /><span className="font-semibold text-primary">Setly</span></div>
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><KeyRound className="size-5" /></div>
            <CardTitle>Вход оператора</CardTitle>
          </CardHeader>
          <CardContent><form autoComplete="off" className="space-y-4" onSubmit={submit}>
            <div className="space-y-2"><Label htmlFor="operator-username">Логин</Label><Input id="operator-username" autoComplete="off" name="installationOperatorUsername" value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} required /></div>
            <div className="space-y-2"><Label htmlFor="operator-password">Пароль</Label><Input id="operator-password" type="password" autoComplete="new-password" name="installationOperatorPassword" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required /></div>
            {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
            <Button className="w-full" disabled={submitting} type="submit">{submitting ? 'Входим…' : 'Войти'}</Button>
          </form></CardContent>
        </Card>
      </div>
    </main>
  );
}

function ConnectionFormPreview({
  mode,
  onClose,
  provider,
  state,
}: {
  mode: 'configure' | 'edit' | 'rotate';
  onClose: () => void;
  provider: IntegrationProvider;
  state: IntegrationState;
}) {
  const [showRotationConfirmation, setShowRotationConfirmation] = useState(false);
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

  return (
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
        <form className="grid gap-5 sm:grid-cols-2" onSubmit={(event) => event.preventDefault()}>
          {state.configured ? (
            <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm sm:col-span-2 sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Подключение</p><p className="mt-1 font-medium">{state.safeIdentity || 'Настроено'}</p></div>
              <div><p className="text-xs text-muted-foreground">Последняя проверка</p><p className="mt-1 font-medium">{state.lastValidatedAt ? formatDate(state.lastValidatedAt) : 'Ещё не запускалась'}</p></div>
              <div><p className="text-xs text-muted-foreground">Последнее событие</p><p className="mt-1 font-medium">{state.lastActivityAt ? formatDate(state.lastActivityAt) : 'Событий пока нет'}</p></div>
            </div>
          ) : null}
          {showSettingsFields && provider === 'beeline' ? (
            <>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="preview-beeline-api">Адрес API Билайна</Label><Input defaultValue="https://cloudpbx.beeline.ru/apis/portal" id="preview-beeline-api" type="url" /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="preview-beeline-callback-base">Базовый адрес callback</Label><Input defaultValue="https://api.setly.tech/api/integrations/beeline/events" id="preview-beeline-callback-base" type="url" /></div>
              <div className="space-y-2"><Label htmlFor="preview-beeline-records">Путь к записям</Label><Input defaultValue="/records" id="preview-beeline-records" /></div>
              <div className="space-y-2"><Label htmlFor="preview-beeline-statistics">Путь к статистике</Label><Input defaultValue="/statistics" id="preview-beeline-statistics" /></div>
              <div className="space-y-2"><Label htmlFor="preview-beeline-subscription">Путь к подписке</Label><Input defaultValue="/subscription" id="preview-beeline-subscription" /></div>
              <div className="space-y-2"><Label htmlFor="preview-beeline-pattern">Шаблон событий</Label><Input defaultValue="CALL.*" id="preview-beeline-pattern" /></div>
              <div className="space-y-2"><Label htmlFor="preview-beeline-type">Тип подписки</Label><Input defaultValue="CALL_EVENTS" id="preview-beeline-type" /></div>
              <div className="space-y-2"><Label htmlFor="preview-beeline-timeout">Таймаут API, мс</Label><Input defaultValue="10000" id="preview-beeline-timeout" inputMode="numeric" /></div>
              <div className="space-y-2"><Label htmlFor="preview-beeline-expiry">Срок подписки, сек.</Label><Input defaultValue="86400" id="preview-beeline-expiry" inputMode="numeric" /></div>
              <div className="space-y-2"><Label htmlFor="preview-beeline-renew-before">Продлевать заранее, сек.</Label><Input defaultValue="3600" id="preview-beeline-renew-before" inputMode="numeric" /></div>
              <label className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm sm:col-span-2"><input defaultChecked type="checkbox" />Автоматически продлевать подписку</label>
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
              <Label htmlFor={`preview-${provider}-secret`}>{secretLabel} · только запись</Label>
              <Input autoComplete="new-password" id={`preview-${provider}-secret`} placeholder={mode === 'rotate' ? 'Введите новое значение' : 'Введите значение'} type="password" />
            </div>
          ) : null}
          {showSecretFields && provider === 'telegram' ? (
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="preview-telegram-proxy">Прокси · только запись</Label><Input autoComplete="new-password" id="preview-telegram-proxy" placeholder="Оставьте пустым, если прокси не меняется" type="password" /></div>
          ) : null}
          {mode === 'rotate' && !showRotationConfirmation ? (
            <div className="sm:col-span-2"><Button onClick={() => setShowRotationConfirmation(true)} type="button">Продолжить</Button></div>
          ) : mode === 'rotate' && showRotationConfirmation ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 sm:col-span-2"><p className="font-medium">Подтвердите замену учётных данных</p><p className="mt-2 text-sm text-muted-foreground">Новые данные будут проверены до замены. При ошибке текущее подключение продолжит работать.</p><div className="mt-4 flex flex-wrap gap-2"><Button disabled type="submit">Проверить и заменить</Button><Button onClick={() => setShowRotationConfirmation(false)} type="button" variant="ghost">Назад</Button></div></div>
          ) : mode !== 'rotate' ? (
            <div className="sm:col-span-2"><Button disabled type="submit">{mode === 'edit' ? 'Проверить и сохранить' : 'Проверить и подключить'}</Button></div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function LifecycleImpactPreview({
  entity,
  onClose,
  status,
}: {
  entity: 'club' | 'organization';
  onClose: () => void;
  status: 'active' | 'inactive' | 'archived';
}) {
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

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled type="button" variant={isActive ? 'destructive' : 'default'}>
              {isActive ? <Archive className="mr-2 size-4" /> : <ArchiveRestore className="mr-2 size-4" />}
              {isActive ? 'Подтвердить архивирование' : 'Подтвердить восстановление'}
            </Button>
            <Button onClick={onClose} type="button" variant="ghost">Отмена</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrganizationSettingsPreview({ organization }: { organization: InstallationOrganization }) {
  const [showImpact, setShowImpact] = useState(false);
  const isActive = organization.status === 'active';

  return (
    <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-lg">Основные данные</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="organization-settings-name">Название организации</Label>
            <Input defaultValue={organization.name} id="organization-settings-name" />
          </div>
          <Button disabled type="button">Сохранить изменения</Button>
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
      {showImpact ? <div className="lg:col-span-2"><LifecycleImpactPreview entity="organization" onClose={() => setShowImpact(false)} status={organization.status} /></div> : null}
    </div>
  );
}

function ClubSettingsPreview({ club }: { club: InstallationOrganization['clubs'][number] }) {
  const [timezone, setTimezone] = useState(club.timezone);
  const [showImpact, setShowImpact] = useState(false);
  const isActive = club.status === 'active';

  return (
    <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-lg">Основные данные</CardTitle></CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="club-settings-name">Название клуба</Label>
            <Input defaultValue={club.name} id="club-settings-name" />
          </div>
          <div className="space-y-2">
            <Label>Город и часовой пояс</Label>
            <TimezoneSelect onChange={setTimezone} value={timezone} />
          </div>
          <Button className="sm:col-span-2 sm:w-fit" disabled type="button">Сохранить изменения</Button>
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
      {showImpact ? <div className="lg:col-span-2"><LifecycleImpactPreview entity="club" onClose={() => setShowImpact(false)} status={club.status} /></div> : null}
    </div>
  );
}

export default function InstallationProvisioningPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const isCreateRoute = location.pathname === '/installation/provisioning';
  const organizationRoute = location.pathname.match(
    /^\/installation\/organizations\/(\d+)(?:\/(settings)|\/clubs\/(\d+)\/(integrations|settings))?$/u,
  );
  const organizationId = organizationRoute ? Number(organizationRoute[1]) : null;
  const isOrganizationSettingsRoute = organizationRoute?.[2] === 'settings';
  const clubId = organizationRoute?.[3] ? Number(organizationRoute[3]) : null;
  const clubSection = organizationRoute?.[4] || null;
  const [enabled, setEnabled] = useState<boolean | null>(null);
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
  const [selectedProvider, setSelectedProvider] = useState<IntegrationProvider | null>(null);
  const [connectionFormMode, setConnectionFormMode] = useState<'configure' | 'edit' | 'rotate'>('configure');

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
        const status = (await response.json()) as { enabled: boolean };
        setEnabled(status.enabled);
        if (status.enabled && window.sessionStorage.getItem(TOKEN_KEY)) await loadSnapshot();
      } catch (caught) {
        setPageError(caught instanceof Error ? caught.message : 'Не удалось открыть рабочее место оператора');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    setSelectedProvider(null);
    if (!snapshot || !organizationId) {
      setOrganizationDetail(null);
      return;
    }
    void loadOrganization(organizationId);
  }, [location.pathname, organizationId, snapshot]);

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

  function logout() {
    window.sessionStorage.removeItem(TOKEN_KEY);
    setSnapshot(null);
    setOrganizationDetail(null);
    resetForm();
    navigate('/installation', { replace: true });
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
  const selectedIntegration = selectedProvider && selectedClub
    ? selectedClub.integrations.find((item) => item.provider === selectedProvider) || null
    : null;

  return (
    <main className="min-h-screen bg-muted/35 p-3 sm:p-5 xl:p-7">
      <div className="mx-auto min-h-[calc(100vh-1.5rem)] max-w-[1500px] overflow-hidden rounded-2xl border bg-background shadow-sm sm:min-h-[calc(100vh-2.5rem)] xl:min-h-[calc(100vh-3.5rem)]">
        <header className="flex flex-col items-stretch gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
          <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => navigate('/installation')} type="button">
            <img src="/setly-mark.png?v=20260714" alt="" className="size-10 rounded-xl border" />
            <div className="min-w-0"><span className="font-semibold text-primary">Setly</span><p className="truncate text-xs text-muted-foreground">Для операторов</p></div>
          </button>
          <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end"><Button variant="ghost" onClick={() => navigate('/installation')}>Организации</Button><div className="flex items-center gap-2"><ThemeToggle /><Button variant="outline" onClick={logout}>Выйти</Button></div></div>
        </header>

        {!isCreateRoute ? (
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
                  <OrganizationSettingsPreview key={organizationDetail.id} organization={organizationDetail} />
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
                  <ClubSettingsPreview club={selectedClub} key={selectedClub.id} />
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
                            <div className="flex flex-wrap gap-2">
                              <Button onClick={() => { setConnectionFormMode(integration.configured ? 'edit' : 'configure'); setSelectedProvider(integration.provider); }} type="button" variant={integration.configured ? 'outline' : 'default'}>{integration.configured ? 'Открыть настройки' : 'Настроить'}</Button>
                              {integration.configured ? <Button onClick={() => { setConnectionFormMode('rotate'); setSelectedProvider(integration.provider); }} type="button" variant="ghost">Заменить данные</Button> : null}
                              {integration.configured ? <Button disabled type="button" variant="ghost">{integration.status === 'active' ? 'Отключить' : 'Активировать'}</Button> : null}
                              {integration.configured && integration.status !== 'revoked' ? <Button disabled type="button" variant="ghost">Отозвать</Button> : null}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                  {selectedProvider && selectedIntegration ? <ConnectionFormPreview key={`${selectedProvider}-${connectionFormMode}`} mode={connectionFormMode} onClose={() => setSelectedProvider(null)} provider={selectedProvider} state={selectedIntegration} /> : null}
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
                    <Button size="lg" onClick={openCreate}><Plus className="mr-2 size-4" />Создать организацию</Button>
                  </div>
                  {pageError ? <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{pageError}</div> : null}
                  <div className="mt-7 overflow-hidden rounded-2xl border">
                    <div className="hidden grid-cols-[minmax(0,1fr)_100px_120px_150px_140px] gap-4 border-b bg-muted/30 px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid"><span>Организация</span><span>Состояние</span><span>Клубы</span><span>Владелец</span><span>Создана</span></div>
                    {snapshot.organizations.map((item) => (
                      <button className="grid w-full gap-3 border-b px-5 py-4 text-left transition last:border-b-0 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[minmax(0,1fr)_100px_120px_150px_140px] md:items-center" key={item.id} onClick={() => navigate(`/installation/organizations/${item.id}`)} type="button">
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
