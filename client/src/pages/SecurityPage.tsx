import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Check,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react';
import {
  OtpCodeInput,
  OTP_CODE_LENGTH,
} from '@/components/otp-code-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiFetch } from '@/lib/api';

type TwoFactorStatus = {
  active: boolean;
  enrolledAt?: string | null;
  enrollmentPending: boolean;
  recoveryCodesRemaining: number;
};

type Enrollment = {
  expiresAt: string;
  manualKey: string;
  otpAuthUri: string;
};

type ProtectedAction = 'disable' | 'regenerate' | 'replace';

async function responseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

async function responseFailure(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { code?: string; error?: string };
    return { code: body.code, message: body.error || fallback };
  } catch {
    return { code: undefined, message: fallback };
  }
}

export default function SecurityPage() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryCodesCopied, setRecoveryCodesCopied] = useState(false);
  const [manualKeyCopied, setManualKeyCopied] = useState(false);
  const [protectedAction, setProtectedAction] =
    useState<ProtectedAction | null>(null);
  const [stepUpCode, setStepUpCode] = useState('');
  const [disableConfirmationOpen, setDisableConfirmationOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const response = await apiFetch('/api/auth/me/two-factor');
    if (!response.ok) {
      throw new Error(await responseError(
        response,
        'Не удалось загрузить настройки безопасности',
      ));
    }
    setStatus((await response.json()) as TwoFactorStatus);
  };

  useEffect(() => {
    void load().catch((caught) => {
      setError(caught instanceof Error ? caught.message : 'Ошибка загрузки');
    });
  }, []);

  const beginEnrollment = async (allowStepUp = true) => {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch('/api/auth/me/two-factor/enrollment', {
        body: '{}',
        method: 'POST',
      });
      if (!response.ok) {
        const failure = await responseFailure(
          response,
          'Не удалось начать подключение',
        );
        if (
          allowStepUp &&
          failure.code === 'TWO_FACTOR_RECENT_CONFIRMATION_REQUIRED'
        ) {
          setProtectedAction('replace');
          setStepUpCode('');
          return;
        }
        throw new Error(failure.message);
      }
      setEnrollment((await response.json()) as Enrollment);
      setRecoveryCodes(null);
      setManualKeyCopied(false);
      setCode('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка подключения');
    } finally {
      setBusy(false);
    }
  };

  const regenerateRecoveryCodes = async (allowStepUp = true) => {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(
        '/api/auth/me/two-factor/recovery-codes',
        { body: '{}', method: 'POST' },
      );
      if (!response.ok) {
        const failure = await responseFailure(
          response,
          'Не удалось выпустить новые резервные коды',
        );
        if (
          allowStepUp &&
          failure.code === 'TWO_FACTOR_RECENT_CONFIRMATION_REQUIRED'
        ) {
          setProtectedAction('regenerate');
          setStepUpCode('');
          return;
        }
        throw new Error(failure.message);
      }
      const result = (await response.json()) as { recoveryCodes: string[] };
      setRecoveryCodes(result.recoveryCodes);
      setRecoveryCodesCopied(false);
      setStatus((current) => current ? {
        ...current,
        recoveryCodesRemaining: result.recoveryCodes.length,
      } : current);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось выпустить новые резервные коды',
      );
    } finally {
      setBusy(false);
    }
  };

  const disableTwoFactor = async (allowStepUp = true) => {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(
        '/api/auth/me/two-factor/disable',
        { body: '{}', method: 'POST' },
      );
      if (!response.ok) {
        const failure = await responseFailure(
          response,
          'Не удалось отключить двухфакторную аутентификацию',
        );
        if (
          allowStepUp &&
          failure.code === 'TWO_FACTOR_RECENT_CONFIRMATION_REQUIRED'
        ) {
          setProtectedAction('disable');
          setStepUpCode('');
          return;
        }
        throw new Error(failure.message);
      }
      window.location.assign('/login');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось отключить двухфакторную аутентификацию',
      );
    } finally {
      setBusy(false);
      setDisableConfirmationOpen(false);
    }
  };

  const confirmStepUp = async () => {
    if (!protectedAction || !/^\d{6}$/u.test(stepUpCode)) return;
    const action = protectedAction;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(
        '/api/auth/me/two-factor/step-up',
        {
          body: JSON.stringify({ code: stepUpCode }),
          method: 'POST',
        },
        { preserveAuthOnUnauthorized: true },
      );
      if (!response.ok) {
        throw new Error(await responseError(
          response,
          'Не удалось подтвердить действие',
        ));
      }
      setProtectedAction(null);
      setStepUpCode('');
      if (action === 'regenerate') {
        await regenerateRecoveryCodes(false);
      } else if (action === 'replace') {
        await beginEnrollment(false);
      } else {
        await disableTwoFactor(false);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось подтвердить действие',
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmEnrollment = async () => {
    if (!/^\d{6}$/u.test(code)) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(
        '/api/auth/me/two-factor/enrollment/confirm',
        {
          body: JSON.stringify({ code }),
          method: 'POST',
        },
        { preserveAuthOnUnauthorized: true },
      );
      if (!response.ok) {
        throw new Error(await responseError(
          response,
          'Не удалось проверить код',
        ));
      }
      const result = (await response.json()) as { recoveryCodes: string[] };
      setRecoveryCodes(result.recoveryCodes);
      setRecoveryCodesCopied(false);
      setEnrollment(null);
      setCode('');
      setStatus((current) => ({
        ...current,
        active: true,
        enrollmentPending: false,
        recoveryCodesRemaining: result.recoveryCodes.length,
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка подтверждения');
    } finally {
      setBusy(false);
    }
  };

  const copyManualKey = async () => {
    if (!enrollment) return;
    await navigator.clipboard.writeText(enrollment.manualKey);
    setManualKeyCopied(true);
  };

  const copyRecoveryCodes = async () => {
    if (!recoveryCodes) return;
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setRecoveryCodesCopied(true);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Безопасность аккаунта
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Управляйте двухфакторной аутентификацией.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {recoveryCodes ? (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-primary" />
              Сохраните резервные коды
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Они показаны только сейчас. Каждый код можно использовать один раз.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 rounded-xl bg-muted p-4 font-mono text-sm sm:grid-cols-2">
              {recoveryCodes.map((recoveryCode) => (
                <div key={recoveryCode}>{recoveryCode}</div>
              ))}
            </div>
            <Button type="button" onClick={() => void copyRecoveryCodes()}>
              {recoveryCodesCopied ? <Check /> : <Copy />}
              {recoveryCodesCopied ? 'Скопировано' : 'Скопировать коды'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            Двухфакторная аутентификация
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            После пароля Setly запросит свежий код из приложения-аутентификатора.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div>
              <p className="font-medium">
                {status?.active ? 'Подключена' : 'Не подключена'}
              </p>
              <p className="text-sm text-muted-foreground">
                {status?.active
                  ? `Осталось резервных кодов: ${status.recoveryCodesRemaining}`
                  : 'Вход сейчас защищён только паролем.'}
              </p>
            </div>
            {!status?.active && !enrollment ? (
              <Button onClick={() => void beginEnrollment()} disabled={busy}>
                <Smartphone />
                Подключить
              </Button>
            ) : null}
          </div>

          {enrollment ? (
            <div className="space-y-5 rounded-xl border border-primary/25 p-4">
              <div>
                <h2 className="font-semibold">Добавьте аккаунт в приложение</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Отсканируйте QR-код и подтвердите подключение свежим кодом.
                </p>
              </div>
              <div className="flex flex-col gap-5 sm:flex-row">
                <div className="w-fit rounded-xl bg-white p-3">
                  <QRCodeSVG value={enrollment.otpAuthUri} size={168} />
                </div>
                <div className="min-w-0 flex-1 space-y-4">
                  <div>
                    <p className="text-sm font-medium">Ключ для ручного ввода</p>
                    <div className="mt-1 flex items-start gap-2">
                      <div className="min-w-0 flex-1 break-all rounded-lg bg-muted p-3 font-mono text-sm">
                        {enrollment.manualKey}
                      </div>
                      <Button
                        aria-label="Скопировать ключ"
                        size="icon"
                        variant="outline"
                        onClick={() => void copyManualKey()}
                      >
                        {manualKeyCopied ? <Check /> : <Copy />}
                      </Button>
                    </div>
                    {manualKeyCopied ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Ключ скопирован.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium">Код подтверждения</p>
                    <OtpCodeInput
                      autoFocus
                      disabled={busy}
                      idPrefix="enrollment-code"
                      onChange={setCode}
                      value={code}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => void confirmEnrollment()}
                      disabled={busy || code.length !== OTP_CODE_LENGTH}
                    >
                      Подтвердить
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEnrollment(null);
                        setCode('');
                      }}
                    >
                      Отмена
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {status?.active ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void regenerateRecoveryCodes()}
              >
                <RefreshCw />
                Выпустить новые резервные коды
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void beginEnrollment()}
              >
                Заменить приложение
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setDisableConfirmationOpen(true)}
              >
                <Trash2 />
                Отключить
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={disableConfirmationOpen}
        onOpenChange={(open) => {
          if (!busy) setDisableConfirmationOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Отключить двухфакторную аутентификацию?</DialogTitle>
            <DialogDescription>
              Все ваши активные сессии завершатся. Пароль и права доступа не
              изменятся.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={busy}
              type="button"
              variant="outline"
              onClick={() => setDisableConfirmationOpen(false)}
            >
              Отмена
            </Button>
            <Button
              disabled={busy}
              type="button"
              variant="destructive"
              onClick={() => void disableTwoFactor()}
            >
              Отключить и выйти
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(protectedAction)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setProtectedAction(null);
            setStepUpCode('');
          }
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Подтвердите действие</DialogTitle>
            <DialogDescription>
              Введите свежий код из приложения-аутентификатора.
            </DialogDescription>
          </DialogHeader>
          <OtpCodeInput
            autoFocus
            disabled={busy}
            idPrefix="security-step-up-code"
            onChange={setStepUpCode}
            value={stepUpCode}
          />
          <DialogFooter>
            <Button
              disabled={busy}
              type="button"
              variant="outline"
              onClick={() => {
                setProtectedAction(null);
                setStepUpCode('');
              }}
            >
              Отмена
            </Button>
            <Button
              disabled={busy || stepUpCode.length !== OTP_CODE_LENGTH}
              type="button"
              onClick={() => void confirmStepUp()}
            >
              Подтвердить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
