import { CheckCircle2, KeyRound, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/theme-toggle';
import { BrandMark } from '@/components/brand-mark';
import { apiFetch } from '@/lib/api';

function readToken() {
  return new URLSearchParams(window.location.hash.replace(/^#/u, '')).get('token') || '';
}

async function genericError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || 'Ссылка недействительна или устарела';
  } catch {
    return 'Ссылка недействительна или устарела';
  }
}

export default function PasswordResetPage() {
  const [token] = useState(readToken);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!token) { setAvailable(false); return; }
      try {
        const response = await apiFetch('/api/auth/recovery/status', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const body = (await response.json()) as { available?: boolean };
        setAvailable(response.ok && Boolean(body.available));
      } catch { setAvailable(false); }
    })();
  }, [token]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (password !== confirmation) { setError('Пароли не совпадают'); return; }
    setSubmitting(true);
    try {
      const response = await apiFetch('/api/auth/recovery/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!response.ok) throw new Error(await genericError(response));
      setDone(true); setPassword(''); setConfirmation('');
      window.history.replaceState(null, '', '/reset-password');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось установить пароль');
    } finally { setSubmitting(false); }
  }

  return (
    <main className="min-h-screen bg-muted/35 p-4 sm:p-8">
      <div className="mx-auto flex max-w-5xl justify-between"><div className="flex items-center gap-3"><BrandMark className="size-10" decorative /><span className="font-semibold text-primary">Setly</span></div><ThemeToggle /></div>
      <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-5xl items-center justify-center py-8">
        <Card className="w-full max-w-lg rounded-2xl shadow-lg shadow-foreground/5">
          {available === null ? <CardContent className="p-8 text-center text-sm text-muted-foreground">Проверяем ссылку…</CardContent> : null}
          {available === false ? <><CardHeader className="space-y-4"><div className="flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300"><ShieldAlert className="size-6" /></div><div><CardTitle>Ссылка недоступна</CardTitle><p className="mt-2 text-sm leading-6 text-muted-foreground">Ссылка недействительна или устарела. Попросите оператора Setly оформить восстановление заново.</p></div></CardHeader><CardContent><Button className="w-full" variant="outline" asChild><a href="/">Перейти ко входу</a></Button></CardContent></> : null}
          {available && done ? <><CardHeader className="space-y-4"><div className="flex size-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-6" /></div><div><CardTitle>Пароль изменён</CardTitle><p className="mt-2 text-sm leading-6 text-muted-foreground">Все прежние сессии завершены. Войдите в Setly с новым паролем.</p></div></CardHeader><CardContent><Button className="w-full" asChild><a href="/">Перейти ко входу</a></Button></CardContent></> : null}
          {available && !done ? <><CardHeader className="space-y-4"><div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><KeyRound className="size-6" /></div><div><CardTitle>Задайте новый пароль</CardTitle><p className="mt-2 text-sm leading-6 text-muted-foreground">Пароль будет применён к вашему аккаунту, а прежние сессии завершены.</p></div></CardHeader><CardContent><form className="space-y-4" onSubmit={submit}><div className="space-y-2"><Label htmlFor="recovery-password">Новый пароль</Label><Input id="recovery-password" type="password" autoComplete="new-password" minLength={6} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} required /><p className="text-xs text-muted-foreground">Не менее 6 символов.</p></div><div className="space-y-2"><Label htmlFor="recovery-confirmation">Повторите пароль</Label><Input id="recovery-confirmation" type="password" autoComplete="new-password" minLength={6} maxLength={200} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></div>{error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}<Button className="w-full" disabled={submitting} type="submit">{submitting ? 'Сохраняем…' : 'Изменить пароль'}</Button></form></CardContent></> : null}
        </Card>
      </div>
    </main>
  );
}
