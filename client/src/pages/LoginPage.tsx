import { useState } from 'react';
import {
  OtpCodeInput,
  OTP_CODE_LENGTH,
} from '@/components/otp-code-input';
import { OperatorLogoShortcut } from '@/components/operator-logo-shortcut';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/useAuth';
import type { TwoFactorLoginChallenge } from '@/lib/auth-context';
import { BrandMark } from '@/components/brand-mark';

interface LoginPageProps {
  mode: 'login' | 'setup';
}

export default function LoginPage({ mode }: LoginPageProps) {
  const { login, bootstrap, completeTwoFactorLogin } = useAuth();
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState<TwoFactorLoginChallenge | null>(null);
  const [code, setCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const isSetup = mode === 'setup';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (isSetup) {
        await bootstrap(form);
      } else if (challenge) {
        await completeTwoFactorLogin(challenge, code);
      } else {
        const nextChallenge = await login({
          email: form.email,
          password: form.password,
        });
        if (nextChallenge) {
          setChallenge(nextChallenge);
          setCode('');
          setUseRecoveryCode(false);
        }
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
          {isSetup ? (
            <div className="mb-2 flex items-center gap-3">
              <BrandMark className="size-11" decorative />
              <span className="text-base font-semibold text-foreground">Setly</span>
            </div>
          ) : <OperatorLogoShortcut />}
          <CardTitle>
            {isSetup
              ? 'Первичная настройка'
              : challenge
                ? 'Подтвердите вход'
                : 'Вход в панель'}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {isSetup
              ? 'Создайте первый аккаунт владельца клуба.'
              : challenge
                ? 'Вход завершится только после проверки двухфакторной аутентификации.'
                : 'Введите данные аккаунта сотрудника.'}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSetup && !challenge && (
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
            {!challenge ? <div className="space-y-2">
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
            </div> : null}
            {!challenge ? <div className="space-y-2">
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
            </div> : (
              <div className="space-y-3">
                {useRecoveryCode ? (
                  <>
                    <Label htmlFor="two-factor-recovery-code">Резервный код</Label>
                    <Input
                      id="two-factor-recovery-code"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="Введите сохранённый резервный код"
                      required
                      autoFocus
                    />
                    <p className="text-sm text-muted-foreground">
                      Каждый резервный код можно использовать только один раз.
                    </p>
                  </>
                ) : (
                  <>
                    <Label>Код из приложения</Label>
                    <OtpCodeInput
                      autoFocus
                      idPrefix="login-two-factor-code"
                      onChange={setCode}
                      value={code}
                    />
                    <p className="text-sm text-muted-foreground">
                      Введите свежий шестизначный код из приложения-аутентификатора.
                    </p>
                  </>
                )}
                <Button
                  className="h-auto px-0"
                  type="button"
                  variant="link"
                  onClick={() => {
                    setCode('');
                    setError('');
                    setUseRecoveryCode((current) => !current);
                  }}
                >
                  {useRecoveryCode
                    ? 'Ввести код из приложения'
                    : 'Использовать резервный код'}
                </Button>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={
                submitting ||
                Boolean(
                  challenge &&
                  (useRecoveryCode
                    ? !code.trim()
                    : code.length !== OTP_CODE_LENGTH),
                )
              }
            >
              {submitting
                ? 'Подождите...'
                : isSetup
                  ? 'Создать аккаунт'
                  : challenge
                    ? 'Подтвердить и войти'
                  : 'Войти'}
            </Button>
            {challenge ? (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setChallenge(null);
                  setCode('');
                  setError('');
                  setUseRecoveryCode(false);
                }}
              >
                Вернуться к вводу пароля
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
