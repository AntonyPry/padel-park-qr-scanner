import { ArrowLeft, ArrowRight, Building2, Check, ChevronRight, CircleCheckBig, KeyRound, MapPin, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
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
type InstallationSnapshot = {
  foundation: { state: 'initialized' };
  organizations: Array<{
    clubCount: number;
    id: number;
    name: string;
    ownerCount: number;
  }>;
};

const steps = [
  { icon: Building2, label: 'Организация' },
  { icon: MapPin, label: 'Клубы' },
  { icon: UserRound, label: 'Владелец' },
  { icon: CircleCheckBig, label: 'Проверка' },
] as const;

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9а-яё]+/giu, '-').replace(/^-+|-+$/g, '');
}

async function readError(response: Response, fallback: string) {
  try {
    return ((await response.json()) as { error?: string }).error || fallback;
  } catch {
    return fallback;
  }
}

async function installationFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = window.sessionStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return fetch(`${API_URL}/api/installation/provisioning${path}`, { ...init, headers });
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
      const response = await installationFetch('/session', { body: JSON.stringify(credentials), method: 'POST' });
      if (!response.ok) throw new Error(await readError(response, 'Не удалось войти'));
      window.sessionStorage.setItem(TOKEN_KEY, ((await response.json()) as { token: string }).token);
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
          <h1 className="max-w-xl text-4xl font-semibold tracking-tight">Управление организациями на уровне установки</h1>
          <p className="max-w-lg leading-7 text-muted-foreground">Изолированный контур для оператора Setly. CRM-роли и выбранный клуб не дают доступ к этому разделу.</p>
          <div className="grid max-w-lg gap-3 text-sm">
            {['Отдельная operator-сессия', 'Проверка tenant foundation', 'Одна атомарная операция создания'].map((item) => <div key={item} className="flex items-center gap-3 rounded-xl border bg-background/70 px-4 py-3"><Check className="size-4 text-primary" />{item}</div>)}
          </div>
        </section>
        <Card className="mx-auto w-full max-w-md rounded-2xl shadow-lg shadow-foreground/5">
          <CardHeader className="space-y-4">
            <div className="flex items-center gap-3 lg:hidden"><img src="/setly-mark.png?v=20260714" alt="" className="size-10 rounded-xl border" /><span className="font-semibold text-primary">Setly</span></div>
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><KeyRound className="size-5" /></div>
            <div><CardTitle>Вход оператора</CardTitle><p className="mt-2 text-sm leading-6 text-muted-foreground">Используйте installation-level учётные данные. Аккаунты CRM здесь не подходят.</p></div>
          </CardHeader>
          <CardContent><form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2"><Label htmlFor="operator-username">Логин оператора</Label><Input id="operator-username" autoComplete="username" value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} required /></div>
            <div className="space-y-2"><Label htmlFor="operator-password">Пароль</Label><Input id="operator-password" type="password" autoComplete="current-password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required /></div>
            {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
            <Button className="w-full" disabled={submitting} type="submit">{submitting ? 'Проверяем…' : 'Войти в контур установки'}</Button>
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
  const [step, setStep] = useState(0);
  const [organization, setOrganization] = useState({ name: 'Setly Ракетка', slug: 'setly-raketka' });
  const [clubs, setClubs] = useState<ClubDraft[]>([
    { name: 'Ракетка — Сокольники', slug: 'sokolniki', timezone: 'Europe/Moscow' },
    { name: 'Ракетка — Лужники', slug: 'luzhniki', timezone: 'Europe/Moscow' },
  ]);
  const [owner, setOwner] = useState({ email: 'owner@raketka.example', name: 'Алексей Воронцов', password: 'PreviewOnly123!', phone: '+7 999 555-18-24' });

  async function loadSnapshot() {
    const response = await installationFetch('/snapshot');
    if (response.status === 401) {
      window.sessionStorage.removeItem(TOKEN_KEY);
      setSnapshot(null);
      throw new Error('Сессия оператора истекла. Войдите снова.');
    }
    if (!response.ok) throw new Error(await readError(response, 'Не удалось загрузить установку'));
    setSnapshot((await response.json()) as InstallationSnapshot);
    setError('');
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await installationFetch('/status');
        const status = (await response.json()) as { enabled: boolean };
        setEnabled(status.enabled);
        if (status.enabled && window.sessionStorage.getItem(TOKEN_KEY)) await loadSnapshot();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Не удалось открыть provisioning');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const canContinue = useMemo(() => {
    if (step === 0) return Boolean(organization.name.trim() && organization.slug.trim());
    if (step === 1) return clubs.length > 0 && clubs.every((club) => club.name && club.slug && club.timezone);
    if (step === 2) return Boolean(owner.name && owner.email && owner.password);
    return true;
  }, [clubs, organization, owner, step]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Проверяем installation contract…</div>;
  if (!enabled) return <div className="flex min-h-screen items-center justify-center bg-muted/35 p-4"><Card className="w-full max-w-lg rounded-2xl"><CardHeader><CardTitle>Provisioning отключён</CardTitle></CardHeader><CardContent className="text-sm leading-6 text-muted-foreground">Installation-level workflow не включён в этой среде. Это не влияет на обычную CRM.</CardContent></Card></div>;
  if (!snapshot) return <ProvisioningLogin onReady={loadSnapshot} />;
  const CurrentIcon = steps[step].icon;

  return (
    <main className="min-h-screen bg-muted/35 p-3 sm:p-5 xl:p-7">
      <div className="mx-auto max-w-[1500px] overflow-hidden rounded-2xl border bg-background shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3"><img src="/setly-mark.png?v=20260714" alt="" className="size-10 rounded-xl border" /><div className="min-w-0"><div className="flex items-center gap-2"><span className="font-semibold text-primary">Setly</span><span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Structure preview</span></div><p className="truncate text-xs text-muted-foreground">Контур установки · Provisioning</p></div></div>
          <div className="flex items-center gap-2"><ThemeToggle /><Button variant="outline" onClick={() => { window.sessionStorage.removeItem(TOKEN_KEY); setSnapshot(null); }}>Выйти</Button></div>
        </header>
        <div className="grid min-h-[calc(100vh-8rem)] lg:grid-cols-[290px_1fr]">
          <aside className="border-b bg-muted/20 p-4 lg:border-b-0 lg:border-r lg:p-5">
            <div className="rounded-xl border bg-background p-4"><div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-emerald-600" />Foundation: {snapshot.foundation.state}</div><p className="mt-2 text-xs text-muted-foreground">{snapshot.organizations.length} организац. · {snapshot.organizations.reduce((sum, item) => sum + item.clubCount, 0)} клубов</p></div>
            <nav className="mt-4 grid grid-cols-4 gap-2 lg:grid-cols-1" aria-label="Этапы provisioning">
              {steps.map((item, index) => { const Icon = item.icon; return <button key={item.label} type="button" onClick={() => index <= step && setStep(index)} className={cn('flex min-w-0 flex-col items-center gap-2 rounded-xl border px-2 py-3 text-center text-xs transition lg:flex-row lg:px-3 lg:text-left lg:text-sm', index === step && 'border-primary/35 bg-primary/10 text-primary', index < step && 'border-emerald-500/25 bg-emerald-500/5', index > step && 'cursor-default opacity-55')}><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background">{index < step ? <Check className="size-4 text-emerald-600" /> : <Icon className="size-4" />}</span><span className="truncate">{item.label}</span></button>; })}
            </nav>
            <div className="mt-5 hidden lg:block"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Сейчас в установке</p><div className="mt-2 space-y-2">{snapshot.organizations.map((item) => <div key={item.id} className="rounded-xl border bg-background px-3 py-2.5 text-sm"><div className="truncate font-medium">{item.name}</div><div className="mt-1 text-xs text-muted-foreground">{item.clubCount} клуб · {item.ownerCount} владелец</div></div>)}</div></div>
          </aside>
          <section className="min-w-0 p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-4xl">
            <div className="mb-6 flex items-start gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><CurrentIcon className="size-5" /></div><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Шаг {step + 1} из {steps.length}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{steps[step].label}</h1></div></div>

            {step === 0 ? <Card className="rounded-2xl"><CardHeader><CardTitle className="text-lg">Карточка новой организации</CardTitle><p className="text-sm text-muted-foreground">Организация объединяет клубы, владельцев и общие CRM-справочники.</p></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="org-name">Название</Label><Input id="org-name" value={organization.name} onChange={(event) => setOrganization({ name: event.target.value, slug: organization.slug || slugify(event.target.value) })} /></div><div className="space-y-2"><Label htmlFor="org-slug">Системный slug</Label><Input id="org-slug" value={organization.slug} onChange={(event) => setOrganization({ ...organization, slug: slugify(event.target.value) })} /><p className="text-xs text-muted-foreground">Уникальный, после создания не меняется.</p></div></CardContent></Card> : null}

            {step === 1 ? <div className="space-y-4">{clubs.map((club, index) => <Card key={index} className="rounded-2xl"><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-base">Клуб {index + 1}</CardTitle><Button size="icon" variant="ghost" aria-label={`Удалить клуб ${index + 1}`} disabled={clubs.length === 1} onClick={() => setClubs(clubs.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4" /></Button></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3"><div className="space-y-2 sm:col-span-2"><Label>Название</Label><Input value={club.name} onChange={(event) => setClubs(clubs.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /></div><div className="space-y-2"><Label>Slug</Label><Input value={club.slug} onChange={(event) => setClubs(clubs.map((item, itemIndex) => itemIndex === index ? { ...item, slug: slugify(event.target.value) } : item))} /></div><div className="space-y-2 sm:col-span-3"><Label>Часовой пояс</Label><Input value={club.timezone} onChange={(event) => setClubs(clubs.map((item, itemIndex) => itemIndex === index ? { ...item, timezone: event.target.value } : item))} /></div></CardContent></Card>)}<Button variant="outline" onClick={() => setClubs([...clubs, { name: '', slug: '', timezone: 'Europe/Moscow' }])}><Plus className="mr-2 size-4" />Добавить клуб</Button></div> : null}

            {step === 2 ? <Card className="rounded-2xl"><CardHeader><CardTitle className="text-lg">Первый владелец</CardTitle><p className="text-sm text-muted-foreground">Получит owner Membership во всей организации и доступ ко всем её клубам.</p></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label>Имя</Label><Input value={owner.name} onChange={(event) => setOwner({ ...owner, name: event.target.value })} /></div><div className="space-y-2"><Label>Телефон</Label><Input value={owner.phone} onChange={(event) => setOwner({ ...owner, phone: event.target.value })} /></div><div className="space-y-2"><Label>Email</Label><Input type="email" value={owner.email} onChange={(event) => setOwner({ ...owner, email: event.target.value })} /></div><div className="space-y-2"><Label>Временный пароль</Label><Input type="password" value={owner.password} onChange={(event) => setOwner({ ...owner, password: event.target.value })} /></div></CardContent></Card> : null}

            {step === 3 ? <div className="space-y-4"><Card className="rounded-2xl"><CardHeader><CardTitle className="text-lg">Проверьте tenant graph</CardTitle><p className="text-sm text-muted-foreground">После подтверждения всё должно создаваться одной транзакцией.</p></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center"><div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Организация</p><p className="mt-1 font-medium">{organization.name}</p><p className="text-xs text-muted-foreground">{organization.slug}</p></div><ChevronRight className="mx-auto hidden size-4 text-muted-foreground sm:block" /><div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Клубы</p><p className="mt-1 font-medium">{clubs.length}</p><p className="truncate text-xs text-muted-foreground">{clubs.map((club) => club.name).join(' · ')}</p></div><ChevronRight className="mx-auto hidden size-4 text-muted-foreground sm:block" /><div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Owner</p><p className="mt-1 truncate font-medium">{owner.name}</p><p className="truncate text-xs text-muted-foreground">{owner.email}</p></div></div><div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">Structure preview: создающая операция появится после подтверждения информационной архитектуры. Сейчас данные не записываются.</div></CardContent></Card><Button className="w-full sm:w-auto" disabled><ShieldCheck className="mr-2 size-4" />Создать организацию атомарно</Button></div> : null}
            {error ? <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
            <div className="mt-8 flex items-center justify-between border-t pt-5"><Button variant="outline" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}><ArrowLeft className="mr-2 size-4" />Назад</Button>{step < steps.length - 1 ? <Button disabled={!canContinue} onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}>Продолжить<ArrowRight className="ml-2 size-4" /></Button> : null}</div>
          </div></section>
        </div>
      </div>
    </main>
  );
}
