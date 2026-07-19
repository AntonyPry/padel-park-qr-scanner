import { CheckCircle2, KeyRound, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/theme-toggle';
import { API_URL } from '@/config';

type ActivationStatus = {
  expiresAt?: string;
  organization?: { id: number; name: string; slug: string };
  owner?: { email: string; name: string };
  state: 'pending' | 'consumed' | 'expired' | 'invalidated' | 'invalid';
};

async function readError(response: Response, fallback: string) {
  try {
    return ((await response.json()) as { error?: string }).error || fallback;
  } catch {
    return fallback;
  }
}

function activationTokenFromFragment() {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/u, ''));
  return fragment.get('token') || '';
}

export default function OwnerActivationPage() {
  const [token] = useState(activationTokenFromFragment);
  const [status, setStatus] = useState<ActivationStatus | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activatedEmail, setActivatedEmail] = useState('');

  useEffect(() => {
    void (async () => {
      if (!token) {
        setStatus({ state: 'invalid' });
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`${API_URL}/api/installation/provisioning/activation/status`, {
          body: JSON.stringify({ token }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });
        if (!response.ok) throw new Error(await readError(response, 'Не удалось проверить ссылку'));
        setStatus((await response.json()) as ActivationStatus);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Не удалось проверить ссылку');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function activate(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setError('Пароли не совпадают');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/installation/provisioning/activation/consume`, {
        body: JSON.stringify({ password, token }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) throw new Error(await readError(response, 'Не удалось активировать аккаунт'));
      const result = (await response.json()) as { email: string; success: true };
      setActivatedEmail(result.email);
      setStatus({ state: 'consumed' });
      setPassword('');
      setConfirmation('');
      window.history.replaceState(null, '', '/activate-owner');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось активировать аккаунт');
    } finally {
      setSubmitting(false);
    }
  }

  const unavailable = status && status.state !== 'pending' && !activatedEmail;
  const unavailableCopy = status?.state === 'expired'
    ? 'Срок действия ссылки истёк. Попросите оператора Setly выпустить новую.'
    : status?.state === 'invalidated'
      ? 'Эта ссылка была заменена новой. Используйте последнюю ссылку от оператора Setly.'
      : status?.state === 'consumed'
        ? 'Эта ссылка уже использована. Войдите в Setly с установленным паролем.'
        : 'Ссылка активации недействительна.';

  return (
    <main className="min-h-screen bg-muted/35 p-4 sm:p-8">
      <div className="mx-auto flex max-w-5xl justify-between"><div className="flex items-center gap-3"><img src="/setly-mark.png?v=20260714" alt="" className="size-10 rounded-xl border" /><span className="font-semibold text-primary">Setly</span></div><ThemeToggle /></div>
      <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-5xl items-center justify-center py-8">
        <Card className="w-full max-w-lg rounded-2xl shadow-lg shadow-foreground/5">
          {loading ? <CardContent className="p-8 text-center text-sm text-muted-foreground">Проверяем ссылку активации…</CardContent> : null}
          {!loading && activatedEmail ? <><CardHeader className="space-y-4"><div className="flex size-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-6" /></div><div><CardTitle>Аккаунт владельца активирован</CardTitle><p className="mt-2 text-sm leading-6 text-muted-foreground">Пароль сохранён безопасно. Теперь войдите в обычный Setly как <span className="font-medium text-foreground">{activatedEmail}</span>.</p></div></CardHeader><CardContent><Button className="w-full" asChild><a href="/">Перейти ко входу в Setly</a></Button></CardContent></> : null}
          {!loading && unavailable ? <><CardHeader className="space-y-4"><div className="flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300"><KeyRound className="size-6" /></div><div><CardTitle>Активация недоступна</CardTitle><p className="mt-2 text-sm leading-6 text-muted-foreground">{unavailableCopy}</p></div></CardHeader><CardContent><Button className="w-full" variant="outline" asChild><a href="/">Перейти ко входу в Setly</a></Button></CardContent></> : null}
          {!loading && status?.state === 'pending' ? <><CardHeader className="space-y-4"><div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="size-6" /></div><div><p className="text-xs font-medium uppercase tracking-wide text-primary">Безопасная активация</p><CardTitle className="mt-1">Задайте пароль владельца</CardTitle><p className="mt-2 text-sm leading-6 text-muted-foreground">{status.owner?.name}, активируйте доступ к организации «{status.organization?.name}». Оператор Setly не увидит ваш пароль.</p></div></CardHeader><CardContent><form className="space-y-4" onSubmit={activate}><div className="rounded-xl border bg-muted/25 p-3 text-sm"><p className="text-xs text-muted-foreground">Аккаунт</p><p className="mt-1 font-medium">{status.owner?.email}</p>{status.expiresAt ? <p className="mt-1 text-xs text-muted-foreground">Ссылка действует до {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(status.expiresAt))}</p> : null}</div><div className="space-y-2"><Label htmlFor="activation-password">Новый пароль</Label><Input id="activation-password" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required /><p className="text-xs text-muted-foreground">Не менее 10 символов.</p></div><div className="space-y-2"><Label htmlFor="activation-confirmation">Повторите пароль</Label><Input id="activation-confirmation" type="password" autoComplete="new-password" minLength={10} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></div>{error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}<Button className="w-full" disabled={submitting} type="submit">{submitting ? 'Активируем…' : 'Активировать аккаунт'}</Button></form></CardContent></> : null}
          {!loading && !status && error ? <CardContent className="p-8 text-center text-sm text-destructive">{error}</CardContent> : null}
        </Card>
      </div>
    </main>
  );
}
