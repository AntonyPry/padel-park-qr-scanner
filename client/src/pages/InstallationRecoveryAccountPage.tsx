import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Pencil,
  ShieldCheck,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import { BrandMark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { API_URL } from '@/config';

const TOKEN_KEY = 'setly_installation_operator_token';

type Account = {
  displayName: string;
  email: string;
  id: number;
  phone?: string | null;
  role: string;
  twoFactorActive: boolean;
};

type OrganizationDetail = {
  clubs: Array<{ id: number; name: string }>;
  id: number;
  name: string;
};

type RequestStatus = 'created' | 'issued' | 'used' | 'revoked' | 'expired';

type RecoveryRequest = {
  account: Account | null;
  createdAt: string;
  id: string;
  initiatedBy: string;
  status: RequestStatus;
};

const roleLabels: Record<string, string> = {
  accountant: 'Бухгалтер',
  admin: 'Администратор',
  manager: 'Менеджер',
  owner: 'Владелец клуба',
  trainer: 'Тренер',
  viewer: 'Наблюдатель',
};

const statusLabels: Record<RequestStatus, string> = {
  created: 'Создана',
  expired: 'Истекла',
  issued: 'Ожидает использования',
  revoked: 'Отозвана',
  used: 'Использована',
};

function useScope(pathname: string) {
  const parts = pathname.split('/');
  return {
    accountId: parts[8] || '',
    clubId: parts[5] || '',
    organizationId: parts[3] || '',
  };
}

function syntheticEmail(account: Account | null) {
  if (!account) return 'Аккаунт недоступен';
  return /[*•]|@f9-rc\.test$/u.test(account.email)
    ? `${account.role || 'user'}@example.test`
    : account.email;
}

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
    let message = 'Операция восстановления не выполнена';
    try {
      message = ((await response.json()) as { error?: string }).error || message;
    } catch {
      // Keep the bounded fallback.
    }
    throw new Error(message);
  }
  return response.json();
}

export default function InstallationRecoveryAccountPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { accountId, clubId, organizationId } = useScope(pathname);
  const base = useMemo(
    () => `/organizations/${organizationId}/clubs/${clubId}/recovery`,
    [clubId, organizationId],
  );
  const routeBase = `/installation${base}`;
  const [account, setAccount] = useState<Account | null>(null);
  const [organization, setOrganization] = useState<OrganizationDetail | null>(null);
  const [requests, setRequests] = useState<RecoveryRequest[]>([]);
  const [profile, setProfile] = useState({
    displayName: '',
    email: '',
    phone: '',
  });
  const [resetLink, setResetLink] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setError('');
    const [detail, requestResult, organizationResult] = await Promise.all([
      call(`${base}/accounts/${accountId}`),
      call(`${base}/requests?accountId=${accountId}`),
      call(`/organizations/${organizationId}`),
    ]);
    setAccount(detail);
    setOrganization(organizationResult);
    setProfile({
      displayName: detail.displayName,
      email: detail.email,
      phone: detail.phone || '',
    });
    setRequests(requestResult.requests || []);
  }

  useEffect(() => {
    void reload()
      .catch((caught) => setError(
        caught instanceof Error ? caught.message : 'Не удалось открыть аккаунт',
      ))
      .finally(() => setLoading(false));
  }, [accountId, base, organizationId]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await call(`${base}/accounts/${accountId}`, {
        body: JSON.stringify(profile),
        method: 'PUT',
      });
      await reload();
      setSuccess('Данные профиля сохранены.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить данные');
    } finally {
      setBusy(false);
    }
  }

  async function issueReset() {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const created = await call(`${base}/requests`, {
        body: JSON.stringify({ accountId: Number(accountId) }),
        method: 'POST',
      });
      const issued = await call(`${base}/requests/${created.id}/issue`, {
        body: '{}',
        method: 'POST',
      });
      setResetLink(issued.resetLink);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось выдать ссылку');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(request: RecoveryRequest) {
    setBusy(true);
    setError('');
    try {
      await call(`${base}/requests/${request.id}/revoke`, {
        body: '{}',
        method: 'POST',
      });
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось отозвать ссылку');
    } finally {
      setBusy(false);
    }
  }

  async function resetOwnerTwoFactor() {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await call(`${base}/accounts/${accountId}/two-factor/reset`, {
        body: '{}',
        method: 'POST',
      });
      setConfirmation(null);
      await reload();
      setSuccess(
        'Двухфакторная аутентификация сброшена. Все сессии владельца завершены.',
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось восстановить двухфакторную аутентификацию',
      );
    } finally {
      setBusy(false);
    }
  }

  const club = organization?.clubs.find(
    (candidate) => Number(candidate.id) === Number(clubId),
  );
  const copyAndHide = () => {
    void navigator.clipboard?.writeText(resetLink);
    setResetLink('');
  };

  return (
    <main className="min-h-screen bg-muted/35 p-4 sm:p-8">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <button
          className="flex items-center gap-3 text-left"
          onClick={() => navigate(`/installation/organizations/${organizationId}`)}
          type="button"
        >
          <BrandMark className="size-10" decorative />
          <span className="font-semibold text-primary">Setly · Восстановление</span>
        </button>
        <ThemeToggle />
      </div>

      <div className="mx-auto max-w-5xl space-y-6 py-8">
        <Button variant="ghost" onClick={() => navigate(routeBase)}>
          <ArrowLeft />
          К списку аккаунтов
        </Button>

        {loading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
            {success}
          </div>
        ) : null}

        {account ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold">
                {account.displayName || syntheticEmail(account)}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {roleLabels[account.role] || 'Пользователь'} · {syntheticEmail(account)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Организация {organization?.name || organizationId}
                {' · '}
                клуб {club?.name || clubId}
              </p>
            </div>

            {resetLink ? (
              <Card className="border-emerald-500/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Check className="size-5 text-emerald-600" />
                    Ссылка выдана один раз
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input aria-label="Одноразовая ссылка" readOnly value={resetLink} />
                  <Button onClick={copyAndHide}>
                    <Copy />
                    Скопировать и скрыть
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Ссылка действует 30 минут и становится недействительной после
                    первого использования.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-5" />
                  Данные профиля
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveProfile}>
                  <div className="space-y-2">
                    <Label htmlFor="recovery-display-name">Отображаемое имя</Label>
                    <Input
                      id="recovery-display-name"
                      value={profile.displayName}
                      onChange={(event) => setProfile({
                        ...profile,
                        displayName: event.target.value,
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="recovery-email">Email аккаунта</Label>
                    <Input
                      id="recovery-email"
                      type="email"
                      value={profile.email}
                      onChange={(event) => setProfile({
                        ...profile,
                        email: event.target.value,
                      })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="recovery-phone">Телефон профиля</Label>
                    <Input
                      id="recovery-phone"
                      value={profile.phone}
                      onChange={(event) => setProfile({
                        ...profile,
                        phone: event.target.value,
                      })}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button disabled={busy} type="submit" variant="outline">
                      <Pencil />
                      Сохранить данные профиля
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Смена пароля</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Оператор не задаёт пароль. Пользователь сам задаёт новый пароль
                  по одноразовой ссылке.
                </p>
              </CardHeader>
              <CardContent>
                <Button disabled={busy} onClick={() => void issueReset()}>
                  <KeyRound />
                  Выпустить ссылку
                </Button>
              </CardContent>
            </Card>

            {account.role === 'owner' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Двухфакторная аутентификация</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Сброс завершит все активные сессии владельца. Пароль и права
                    доступа не изменятся.
                  </p>
                </CardHeader>
                <CardContent>
                  <Button
                    disabled={busy || !account.twoFactorActive}
                    variant="destructive"
                    onClick={() => setConfirmation({
                      confirmLabel: 'Сбросить и завершить сессии',
                      description:
                        'Двухфакторная аутентификация будет отключена, а все активные сессии пользователя завершатся. Пароль и права доступа не изменятся.',
                      isDestructive: true,
                      title: 'Сбросить двухфакторную аутентификацию?',
                    })}
                  >
                    Сбросить двухфакторную аутентификацию
                  </Button>
                  {!account.twoFactorActive ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Двухфакторная аутентификация не подключена.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>История ссылок смены пароля</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {requests.length === 0 ? (
                  <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    Ссылки для смены пароля ещё не выпускались.
                  </p>
                ) : requests.map((request) => (
                  <div className="rounded-xl border p-4" key={request.id}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{statusLabels[request.status]}</p>
                      <span className="text-xs text-muted-foreground">
                        {new Date(request.createdAt).toLocaleString('ru-RU')}
                      </span>
                    </div>
                    {request.status === 'issued' || request.status === 'created' ? (
                      <Button
                        className="mt-3"
                        disabled={busy}
                        size="sm"
                        variant="outline"
                        onClick={() => void revoke(request)}
                      >
                        Отозвать ссылку
                      </Button>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>

      <ConfirmActionDialog
        action={confirmation}
        loading={busy}
        onCancel={() => setConfirmation(null)}
        onConfirm={resetOwnerTwoFactor}
      />
    </main>
  );
}
