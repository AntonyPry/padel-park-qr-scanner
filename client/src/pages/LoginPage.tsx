import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/useAuth';

interface LoginPageProps {
  mode: 'login' | 'setup';
}

export default function LoginPage({ mode }: LoginPageProps) {
  const { login, bootstrap } = useAuth();
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isSetup = mode === 'setup';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (isSetup) {
        await bootstrap(form);
      } else {
        await login({ email: form.email, password: form.password });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка входа');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <div className="mb-2 flex items-center gap-3">
            <img
              src="/setly-mark.png?v=20260714"
              alt=""
              className="size-11 rounded-xl border border-border object-cover shadow-sm"
            />
            <span className="text-base font-semibold text-foreground">Setly</span>
          </div>
          <CardTitle>
            {isSetup ? 'Первичная настройка' : 'Вход в панель'}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {isSetup
              ? 'Создайте первый аккаунт владельца клуба.'
              : 'Введите данные аккаунта сотрудника.'}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSetup && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="owner-name">Имя</Label>
                  <Input
                    id="owner-name"
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner-phone">Телефон</Label>
                  <Input
                    id="owner-phone"
                    value={form.phone}
                    onChange={(event) =>
                      setForm({ ...form, phone: event.target.value })
                    }
                  />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                autoComplete={isSetup ? 'new-password' : 'current-password'}
                value={form.password}
                onChange={(event) =>
                  setForm({ ...form, password: event.target.value })
                }
                minLength={6}
                required
              />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting
                ? 'Подождите...'
                : isSetup
                  ? 'Создать аккаунт'
                  : 'Войти'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
