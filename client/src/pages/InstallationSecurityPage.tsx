import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BrandMark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
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
import { Label } from '@/components/ui/label';
import { API_URL } from '@/config';

const TOKEN_KEY = 'setly_installation_operator_token';

async function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set(
    'Authorization',
    `Bearer ${window.sessionStorage.getItem(TOKEN_KEY) || ''}`,
  );
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(
    `${API_URL}/api/installation/provisioning${path}`,
    { ...init, headers },
  );
  if (!response.ok) {
    let message = 'Операция недоступна';
    let code: string | undefined;
    try {
      const body = (await response.json()) as {
        code?: string;
        error?: string;
      };
      message = body.error || message;
      code = body.code;
    } catch {
      // Use the bounded public fallback.
    }
    const error = new Error(message) as Error & { code?: string };
    error.code = code;
    throw error;
  }
  return response.json();
}

export default function InstallationSecurityPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<{
    active: boolean;
    available: boolean;
    enrollmentPending: boolean;
    recoveryCodesRemaining: number;
  } | null>(null);
  const [enrollment, setEnrollment] = useState<{
    manualKey: string;
    otpAuthUri: string;
  } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [manualKeyCopied, setManualKeyCopied] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpCode, setStepUpCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.sessionStorage.getItem(TOKEN_KEY)) {
      navigate('/installation', { replace: true });
      return;
    }
    void call('/two-factor')
      .then(setStatus)
      .catch((caught) => setError(
        caught instanceof Error ? caught.message : 'Ошибка загрузки',
      ));
  }, [navigate]);

  const begin = async () => {
    setBusy(true);
    setError('');
    try {
      setEnrollment(await call('/two-factor/enrollment', {
        method: 'POST',
        body: '{}',
      }));
      setManualKeyCopied(false);
      setCode('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка подключения');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!/^\d{6}$/u.test(code)) return;
    setBusy(true);
    setError('');
    try {
      const result = await call('/two-factor/enrollment/confirm', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }) as { recoveryCodes: string[] };
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
      window.sessionStorage.removeItem(TOKEN_KEY);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка подтверждения');
    } finally {
      setBusy(false);
    }
  };

  const applyRegeneratedCodes = (result: { recoveryCodes: string[] }) => {
    setRecoveryCodes(result.recoveryCodes);
    setCopied(false);
    window.sessionStorage.removeItem(TOKEN_KEY);
  };

  const regenerate = async (allowStepUp = true) => {
    setBusy(true);
    setError('');
    try {
      const result = await call('/two-factor/recovery-codes', {
        body: '{}',
        method: 'POST',
      }) as { recoveryCodes: string[] };
      applyRegeneratedCodes(result);
    } catch (caught) {
      if (
        allowStepUp &&
        (caught as { code?: string })?.code ===
          'TWO_FACTOR_RECENT_CONFIRMATION_REQUIRED'
      ) {
        setStepUpOpen(true);
        setStepUpCode('');
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось выпустить новые резервные коды',
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmStepUp = async () => {
    if (!/^\d{6}$/u.test(stepUpCode)) return;
    setBusy(true);
    setError('');
    try {
      await call('/two-factor/step-up', {
        body: JSON.stringify({ code: stepUpCode }),
        method: 'POST',
      });
      setStepUpOpen(false);
      setStepUpCode('');
      await regenerate(false);
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

  return (
    <main className="min-h-screen bg-muted/35 p-4 sm:p-8">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <button
          className="flex items-center gap-3 text-left"
          onClick={() => navigate('/installation')}
          type="button"
        >
          <BrandMark className="size-10" decorative />
          <span className="font-semibold text-primary">Setly · Операторы</span>
        </button>
        <ThemeToggle />
      </div>
      <div className="mx-auto max-w-5xl space-y-6 py-8">
        <div>
          <Button variant="ghost" onClick={() => navigate('/installation')}>
            <ArrowLeft />
            К организациям
          </Button>
          <h1 className="mt-4 text-2xl font-semibold">Безопасность оператора</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Двухфакторная аутентификация привязана к вашей отдельной учётной записи
            оператора. Самостоятельный сброс через кабинет недоступен.
          </p>
        </div>

        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {recoveryCodes ? (
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle>Сохраните резервные коды</CardTitle>
              <p className="text-sm text-muted-foreground">
                Это единственный показ. После сохранения войдите заново.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 rounded-xl bg-muted p-4 font-mono text-sm sm:grid-cols-2">
                {recoveryCodes.map((item) => <div key={item}>{item}</div>)}
              </div>
              <Button onClick={() => {
                void navigator.clipboard.writeText(recoveryCodes.join('\n'));
                setCopied(true);
              }}>
                {copied ? <Check /> : <Copy />}
                {copied ? 'Скопировано' : 'Скопировать'}
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
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-xl border p-4">
              <p className="font-medium">
                {status?.active
                  ? 'Подключена'
                  : status?.available === false
                    ? 'Недоступна для этой учётной записи'
                    : 'Не подключена'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {status?.active
                  ? `Резервных кодов: ${status.recoveryCodesRemaining}`
                  : 'После подключения вход будет подтверждаться кодом из приложения.'}
              </p>
            </div>
            {!status?.active && status?.available !== false && !enrollment ? (
              <Button onClick={() => void begin()} disabled={busy}>
                <KeyRound />
                Подключить
              </Button>
            ) : null}
            {status?.active ? (
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => void regenerate()}
              >
                <RefreshCw />
                Выпустить новые резервные коды
              </Button>
            ) : null}
            {enrollment ? (
              <div className="flex flex-col gap-5 rounded-xl border p-4 sm:flex-row">
                <div className="h-fit w-fit rounded-xl bg-white p-3">
                  <QRCodeSVG value={enrollment.otpAuthUri} size={168} />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
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
                        onClick={() => {
                          void navigator.clipboard.writeText(enrollment.manualKey);
                          setManualKeyCopied(true);
                        }}
                      >
                        {manualKeyCopied ? <Check /> : <Copy />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label>Код подтверждения</Label>
                    <OtpCodeInput
                      className="mt-2"
                      disabled={busy}
                      idPrefix="operator-enrollment-code"
                      onChange={setCode}
                      value={code}
                    />
                  </div>
                  <Button
                    onClick={() => void confirm()}
                    disabled={busy || code.length !== OTP_CODE_LENGTH}
                  >
                    Подтвердить
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={stepUpOpen}
        onOpenChange={(open) => {
          if (!busy) {
            setStepUpOpen(open);
            if (!open) setStepUpCode('');
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
            idPrefix="operator-step-up-code"
            onChange={setStepUpCode}
            value={stepUpCode}
          />
          <DialogFooter>
            <Button
              disabled={busy}
              type="button"
              variant="outline"
              onClick={() => {
                setStepUpOpen(false);
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
    </main>
  );
}
