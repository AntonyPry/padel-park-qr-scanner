import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleCheckBig,
  Clipboard,
  ExternalLink,
  KeyRound,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/theme-toggle';
import { API_URL } from '@/config';
import { cn } from '@/lib/utils';

const TOKEN_KEY = 'setly_installation_operator_token';
type ClubDraft = { name: string; slug: string; timezone: string };
type ActivationState = 'pending' | 'consumed' | 'expired' | 'invalidated' | null;
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
    activationState: ActivationState;
    clubCount: number;
    createdAt: string;
    id: number;
    name: string;
    ownerCount: number;
    slug: string;
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

const steps = [
  { icon: Building2, label: 'Организация' },
  { icon: MapPin, label: 'Клубы' },
  { icon: UserRound, label: 'Владелец' },
  { icon: CircleCheckBig, label: 'Проверка' },
] as const;

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { code?: string; error?: string };
    return { code: body.code || '', message: body.error || fallback };
  } catch {
    return { code: '', message: fallback };
  }
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

function activationLabel(state: ActivationState) {
  if (state === 'pending') return 'Ожидает активации';
  if (state === 'consumed') return 'Активирован';
  if (state === 'expired') return 'Срок истёк';
  if (state === 'invalidated') return 'Ссылка заменена';
  return null;
}

function maskedActivationLink(link: string) {
  const url = new URL(link);
  return `${url.origin}${url.pathname}#token=••••••••••••`;
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
      <div className="mx-auto grid min-h-[calc(100vh-7rem)] max-w-5xl items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="hidden space-y-5 lg:block">
          <div className="flex items-center gap-3"><img src="/setly-mark.png?v=20260714" alt="" className="size-12 rounded-xl border shadow-sm" /><span className="text-xl font-semibold text-primary">Setly</span></div>
          <h1 className="max-w-xl text-4xl font-semibold tracking-tight">Создание организаций</h1>
          <p className="max-w-lg leading-7 text-muted-foreground">Изолированный контур установки для внутреннего оператора Setly. Владельцы организаций и CRM-роли не имеют доступа к этому разделу.</p>
          <div className="grid max-w-lg gap-3 text-sm">
            {['Отдельная сессия оператора', 'Проверка готовности системы', 'Единая транзакция без частичных данных'].map((item) => <div key={item} className="flex items-center gap-3 rounded-xl border bg-background/70 px-4 py-3"><Check className="size-4 text-primary" />{item}</div>)}
          </div>
        </section>
        <Card className="mx-auto w-full max-w-md rounded-2xl shadow-lg shadow-foreground/5">
          <CardHeader className="space-y-4">
            <div className="flex items-center gap-3 lg:hidden"><img src="/setly-mark.png?v=20260714" alt="" className="size-10 rounded-xl border" /><span className="font-semibold text-primary">Setly</span></div>
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><KeyRound className="size-5" /></div>
            <div><CardTitle>Вход оператора</CardTitle><p className="mt-2 text-sm leading-6 text-muted-foreground">Используйте учётные данные уровня установки. Аккаунты обычной CRM здесь не подходят.</p></div>
          </CardHeader>
          <CardContent><form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2"><Label htmlFor="operator-username">Логин оператора</Label><Input id="operator-username" autoComplete="username" value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} required /></div>
            <div className="space-y-2"><Label htmlFor="operator-password">Пароль</Label><Input id="operator-password" type="password" autoComplete="current-password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required /></div>
            {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
            <Button className="w-full" disabled={submitting} type="submit">{submitting ? 'Проверяем…' : 'Войти'}</Button>
          </form></CardContent>
        </Card>
      </div>
    </main>
  );
}

export default function InstallationProvisioningPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [snapshot, setSnapshot] = useState<InstallationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [result, setResult] = useState<ProvisioningResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [organization, setOrganization] = useState({ name: 'Setly Ракетка', slug: 'setly-raketka' });
  const [clubs, setClubs] = useState<ClubDraft[]>([
    { name: 'Ракетка — Сокольники', slug: 'sokolniki', timezone: 'Europe/Moscow' },
    { name: 'Ракетка — Лужники', slug: 'luzhniki', timezone: 'Europe/Moscow' },
  ]);
  const [owner, setOwner] = useState({ email: 'owner@raketka.example', name: 'Алексей Воронцов', phone: '+7 999 555-18-24' });

  async function loadSnapshot() {
    const response = await installationFetch('/snapshot');
    if (response.status === 401) {
      window.sessionStorage.removeItem(TOKEN_KEY);
      setSnapshot(null);
      throw new Error('Сессия оператора истекла. Войдите снова.');
    }
    if (!response.ok) throw new Error((await readError(response, 'Не удалось загрузить установку')).message);
    setSnapshot((await response.json()) as InstallationSnapshot);
    setError('');
    setErrorCode('');
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await installationFetch('/status');
        const status = (await response.json()) as { enabled: boolean };
        setEnabled(status.enabled);
        if (status.enabled && window.sessionStorage.getItem(TOKEN_KEY)) await loadSnapshot();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Не удалось открыть создание организаций');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const canContinue = useMemo(() => {
    if (step === 0) return Boolean(organization.name.trim() && organization.slug.trim());
    if (step === 1) return clubs.length > 0 && clubs.every((club) => club.name && club.slug && club.timezone);
    if (step === 2) return Boolean(owner.name && owner.email && owner.phone);
    return true;
  }, [clubs, organization, owner, step]);

  async function createOrganization() {
    setSubmitting(true);
    setError('');
    setErrorCode('');
    try {
      const response = await installationFetch('/organizations', {
        body: JSON.stringify({ clubs, idempotencyKey, organization, owner }),
        method: 'POST',
      });
      if (!response.ok) {
        const failure = await readError(response, 'Не удалось создать организацию');
        setErrorCode(failure.code);
        throw new Error(failure.message);
      }
      const created = (await response.json()) as ProvisioningResult;
      setResult(created);
      await loadSnapshot();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать организацию');
    } finally {
      setSubmitting(false);
    }
  }

  async function reissueActivation() {
    if (!result) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await installationFetch(`/organizations/${result.organization.id}/activation/reissue`, { method: 'POST' });
      if (!response.ok) throw new Error((await readError(response, 'Не удалось перевыпустить ссылку')).message);
      const reissued = (await response.json()) as Pick<ProvisioningResult, 'activation' | 'audit'>;
      setResult({ ...result, ...reissued });
      setCopyDone(false);
      await loadSnapshot();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось перевыпустить ссылку');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyActivation() {
    if (!result?.activation.link) return;
    await navigator.clipboard.writeText(result.activation.link);
    setCopyDone(true);
  }

  function startAnother() {
    setResult(null);
    setStep(0);
    setIdempotencyKey(crypto.randomUUID());
    setCopyDone(false);
    setError('');
    setErrorCode('');
  }

  function clearFailure() {
    setError('');
    setErrorCode('');
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Проверяем готовность системы…</div>;
  if (!enabled) return <div className="flex min-h-screen items-center justify-center bg-muted/35 p-4"><Card className="w-full max-w-lg rounded-2xl"><CardHeader><CardTitle>Создание организаций отключено</CardTitle></CardHeader><CardContent className="text-sm leading-6 text-muted-foreground">Контур установки не включён в этой среде. Это не влияет на обычную CRM.</CardContent></Card></div>;
  if (!snapshot) return <ProvisioningLogin onReady={loadSnapshot} />;
  const CurrentIcon = steps[step].icon;

  return (
    <main className="min-h-screen bg-muted/35 p-3 sm:p-5 xl:p-7">
      <div className="mx-auto max-w-[1500px] overflow-hidden rounded-2xl border bg-background shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3"><img src="/setly-mark.png?v=20260714" alt="" className="size-10 rounded-xl border" /><div className="min-w-0"><div className="flex items-center gap-2"><span className="font-semibold text-primary">Setly</span><span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Контур установки</span></div><p className="truncate text-xs text-muted-foreground">Создание организаций</p></div></div>
          <div className="flex items-center gap-2"><ThemeToggle /><Button variant="outline" onClick={() => { window.sessionStorage.removeItem(TOKEN_KEY); setSnapshot(null); }}>Выйти</Button></div>
        </header>
        <div className="grid min-h-[calc(100vh-8rem)] lg:grid-cols-[310px_1fr]">
          <aside className="border-b bg-muted/20 p-4 lg:border-b-0 lg:border-r lg:p-5">
            <div className="rounded-xl border bg-background p-4"><div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-emerald-600" />Система готова</div><p className="mt-2 text-xs text-muted-foreground">{snapshot.organizations.length} организац. · {snapshot.organizations.reduce((sum, item) => sum + item.clubCount, 0)} клубов</p></div>
            <nav className="mt-4 grid grid-cols-4 gap-2 lg:grid-cols-1" aria-label="Этапы создания организации">
              {steps.map((item, index) => { const Icon = item.icon; return <button key={item.label} type="button" onClick={() => !result && index <= step && setStep(index)} className={cn('flex min-w-0 flex-col items-center gap-2 rounded-xl border px-2 py-3 text-center text-xs transition lg:flex-row lg:px-3 lg:text-left lg:text-sm', index === step && 'border-primary/35 bg-primary/10 text-primary', index < step && 'border-emerald-500/25 bg-emerald-500/5', (index > step || result) && 'cursor-default opacity-55')}><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background">{index < step ? <Check className="size-4 text-emerald-600" /> : <Icon className="size-4" />}</span><span className="truncate">{item.label}</span></button>; })}
            </nav>
            <div className="mt-5 hidden lg:block"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Сейчас в установке</p><div className="mt-2 space-y-2">{snapshot.organizations.map((item) => <div key={item.id} className="rounded-xl border bg-background px-3 py-2.5 text-sm"><div className="truncate font-medium">{item.name}</div><div className="mt-1 text-xs text-muted-foreground">{item.clubCount} клуб. · {item.ownerCount} влад.</div>{activationLabel(item.activationState) ? <div className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">{activationLabel(item.activationState)}</div> : null}</div>)}</div></div>
          </aside>
          <section className="min-w-0 p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-4xl">
            {result ? (
              <div className="space-y-5">
                <div className="flex items-start gap-3"><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-6" /></div><div><p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Операция завершена</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Организация создана без частичных данных</h1><p className="mt-2 text-sm text-muted-foreground">Организация, точный набор клубов и права первого владельца сохранены одной транзакцией.</p></div></div>
                <Card className="rounded-2xl border-emerald-500/25"><CardHeader><CardTitle className="text-lg">Передайте владельцу ссылку активации</CardTitle><p className="text-sm text-muted-foreground">Оператор не задаёт и не узнаёт пароль. Ссылка одноразовая и действует до {formatDate(result.activation.expiresAt)}.</p></CardHeader><CardContent className="space-y-4">
                  {result.activation.link ? <><div className="rounded-xl border bg-muted/30 p-3"><p className="break-all font-mono text-xs">{maskedActivationLink(result.activation.link)}</p><p className="mt-2 text-xs text-muted-foreground">Одноразовый секрет скрыт на экране. Используйте кнопку копирования для передачи полной ссылки.</p></div><div className="flex flex-wrap gap-2"><Button onClick={copyActivation}>{copyDone ? <Check className="mr-2 size-4" /> : <Clipboard className="mr-2 size-4" />}{copyDone ? 'Ссылка скопирована' : 'Скопировать ссылку'}</Button><Button variant="outline" asChild><a href={result.activation.link} target="_blank" rel="noreferrer">Открыть активацию<ExternalLink className="ml-2 size-4" /></a></Button><Button variant="ghost" disabled={submitting} onClick={reissueActivation}><RefreshCw className="mr-2 size-4" />Перевыпустить</Button></div></> : <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm"><p className="font-medium">Повторная отправка подтверждена</p><p className="mt-1 text-muted-foreground">Граф уже был создан ранее. Исходная ссылка не хранится в открытом виде — перевыпустите её для безопасной передачи владельцу.</p><Button className="mt-3" variant="outline" disabled={submitting} onClick={reissueActivation}><RefreshCw className="mr-2 size-4" />Выпустить новую ссылку</Button></div>}
                </CardContent></Card>
                <div className="grid gap-4 md:grid-cols-2"><Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">Созданная структура</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div><span className="text-muted-foreground">Организация</span><p className="font-medium">{result.organization.name}</p><p className="text-xs text-muted-foreground">{result.organization.slug}</p></div><div><span className="text-muted-foreground">Клубы ({result.clubs.length})</span>{result.clubs.map((club) => <p key={club.id} className="mt-1 font-medium">{club.name} <span className="font-normal text-muted-foreground">· {club.slug}</span></p>)}</div><div><span className="text-muted-foreground">Владелец</span><p className="font-medium">{result.owner.name}</p><p className="text-xs text-muted-foreground">{result.owner.email}</p></div></CardContent></Card><Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">Подтверждение и аудит</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="rounded-xl border bg-muted/25 p-3"><p className="text-xs text-muted-foreground">Операция #{result.idempotency.operationId}</p><p className="mt-1 font-medium">{result.idempotency.replayed ? 'Безопасный повтор без дублей' : 'Первичное создание'}</p></div><div className="rounded-xl border bg-muted/25 p-3"><p className="text-xs text-muted-foreground">Запись аудита #{result.audit.id}</p><p className="mt-1 font-medium">{result.audit.action}</p><p className="text-xs text-muted-foreground">{formatDate(result.audit.createdAt)}</p></div></CardContent></Card></div>
                {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
                <Button variant="outline" onClick={startAnother}>Создать ещё одну организацию</Button>
              </div>
            ) : (
              <>
                <div className="mb-6 flex items-start gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><CurrentIcon className="size-5" /></div><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Шаг {step + 1} из {steps.length}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{steps[step].label}</h1></div></div>

                {step === 0 ? <Card className="rounded-2xl"><CardHeader><CardTitle className="text-lg">Карточка новой организации</CardTitle><p className="text-sm text-muted-foreground">Организация объединяет клубы, владельцев и общие CRM-справочники.</p></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="org-name">Название</Label><Input id="org-name" value={organization.name} onChange={(event) => { clearFailure(); setOrganization({ name: event.target.value, slug: slugify(event.target.value) }); }} /></div><div className="space-y-2"><Label htmlFor="org-slug">Системный slug</Label><Input id="org-slug" value={organization.slug} onChange={(event) => { clearFailure(); setOrganization({ ...organization, slug: slugify(event.target.value) }); }} /><p className="text-xs text-muted-foreground">Уникальный, после создания не меняется.</p></div></CardContent></Card> : null}

                {step === 1 ? <div className="space-y-4">{clubs.map((club, index) => <Card key={index} className="rounded-2xl"><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-base">Клуб {index + 1}</CardTitle><Button size="icon" variant="ghost" aria-label={`Удалить клуб ${index + 1}`} disabled={clubs.length === 1} onClick={() => { clearFailure(); setClubs(clubs.filter((_, itemIndex) => itemIndex !== index)); }}><Trash2 className="size-4" /></Button></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3"><div className="space-y-2 sm:col-span-2"><Label>Название</Label><Input value={club.name} onChange={(event) => { clearFailure(); setClubs(clubs.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item)); }} /></div><div className="space-y-2"><Label>Slug</Label><Input value={club.slug} onChange={(event) => { clearFailure(); setClubs(clubs.map((item, itemIndex) => itemIndex === index ? { ...item, slug: slugify(event.target.value) } : item)); }} /></div><div className="space-y-2 sm:col-span-3"><Label>Часовой пояс</Label><Input value={club.timezone} onChange={(event) => { clearFailure(); setClubs(clubs.map((item, itemIndex) => itemIndex === index ? { ...item, timezone: event.target.value } : item)); }} /></div></CardContent></Card>)}<Button variant="outline" onClick={() => { clearFailure(); setClubs([...clubs, { name: '', slug: '', timezone: 'Europe/Moscow' }]); }}><Plus className="mr-2 size-4" />Добавить клуб</Button></div> : null}

                {step === 2 ? <Card className="rounded-2xl"><CardHeader><CardTitle className="text-lg">Первый владелец</CardTitle><p className="text-sm text-muted-foreground">Получит права владельца во всей организации и доступ ко всем её клубам. Пароль владелец задаст самостоятельно по одноразовой ссылке.</p></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label>Имя</Label><Input value={owner.name} onChange={(event) => { clearFailure(); setOwner({ ...owner, name: event.target.value }); }} /></div><div className="space-y-2"><Label>Телефон</Label><Input type="tel" value={owner.phone} onChange={(event) => { clearFailure(); setOwner({ ...owner, phone: event.target.value }); }} /></div><div className="space-y-2 sm:col-span-2"><Label>Email</Label><Input type="email" value={owner.email} onChange={(event) => { clearFailure(); setOwner({ ...owner, email: event.target.value }); }} /></div></CardContent></Card> : null}

                {step === 3 ? <div className="space-y-4"><Card className="rounded-2xl"><CardHeader><CardTitle className="text-lg">Проверьте структуру организации</CardTitle><p className="text-sm text-muted-foreground">После подтверждения вся структура будет создана одной транзакцией. При ошибке изменения откатятся целиком, а повтор с тем же ключом не создаст дубли.</p></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center"><div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Организация</p><p className="mt-1 font-medium">{organization.name}</p><p className="text-xs text-muted-foreground">{organization.slug}</p></div><ChevronRight className="mx-auto hidden size-4 text-muted-foreground sm:block" /><div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Клубы</p><p className="mt-1 font-medium">{clubs.length}</p><p className="truncate text-xs text-muted-foreground">{clubs.map((club) => club.name).join(' · ')}</p></div><ChevronRight className="mx-auto hidden size-4 text-muted-foreground sm:block" /><div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Владелец</p><p className="mt-1 truncate font-medium">{owner.name}</p><p className="truncate text-xs text-muted-foreground">{owner.email}</p></div></div><div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm"><p className="font-medium">Безопасная активация</p><p className="mt-1 text-muted-foreground">После создания Setly покажет одноразовую ссылку. Оператор передаст её владельцу, но никогда не увидит его пароль.</p></div></CardContent></Card><Button className="w-full sm:w-auto" disabled={submitting} onClick={createOrganization}><ShieldCheck className="mr-2 size-4" />{submitting ? 'Создаём…' : 'Создать организацию'}</Button></div> : null}
                {error ? <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"><p className="font-medium">{error}</p><p className="mt-1 text-xs opacity-80">Частичная структура не сохранена. Исправьте данные и повторите операцию с тем же ключом.</p>{errorCode ? <p className="mt-2 font-mono text-[11px] opacity-70">{errorCode}</p> : null}</div> : null}
                <div className="mt-8 flex items-center justify-between border-t pt-5"><Button variant="outline" disabled={step === 0 || submitting} onClick={() => setStep((current) => Math.max(0, current - 1))}><ArrowLeft className="mr-2 size-4" />Назад</Button>{step < steps.length - 1 ? <Button disabled={!canContinue} onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}>Продолжить<ArrowRight className="ml-2 size-4" /></Button> : null}</div>
              </>
            )}
          </div></section>
        </div>
      </div>
    </main>
  );
}
