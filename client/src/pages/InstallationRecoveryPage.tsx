import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, KeyRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { API_URL } from '@/config';

const TOKEN_KEY = 'setly_installation_operator_token';

type RecoveryAccount = {
  displayName: string;
  email: string;
  id: number;
  role: string;
};

type OrganizationDetail = {
  clubs: Array<{ id: number; name: string }>;
  id: number;
  name: string;
};

const roleLabels: Record<string, string> = {
  accountant: 'Бухгалтер',
  admin: 'Администратор',
  manager: 'Менеджер',
  owner: 'Владелец клуба',
  trainer: 'Тренер',
  viewer: 'Наблюдатель',
};

function useScope(pathname: string) {
  const parts = pathname.split('/');
  return {
    clubId: parts[5] || '',
    organizationId: parts[3] || '',
  };
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

export default function InstallationRecoveryPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { organizationId, clubId } = useScope(pathname);
  const base = useMemo(
    () => `/organizations/${organizationId}/clubs/${clubId}/recovery`,
    [clubId, organizationId],
  );
  const [accounts, setAccounts] = useState<RecoveryAccount[]>([]);
  const [organization, setOrganization] = useState<OrganizationDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      call(`${base}/accounts`),
      call(`/organizations/${organizationId}`),
    ])
      .then(([accountResult, organizationResult]) => {
        setAccounts(accountResult.accounts || []);
        setOrganization(organizationResult);
      })
      .catch((caught) => {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Не удалось загрузить восстановление доступа',
        );
      })
      .finally(() => setLoading(false));
  }, [base, organizationId]);

  const club = organization?.clubs.find(
    (candidate) => Number(candidate.id) === Number(clubId),
  );

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
        <Button
          variant="ghost"
          onClick={() => navigate(`/installation/organizations/${organizationId}`)}
        >
          <ArrowLeft />
          К организации
        </Button>

        <div>
          <h1 className="text-2xl font-semibold">Восстановление доступа</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Организация {organization?.name || organizationId}
            {' · '}
            клуб {club?.name || clubId}
          </p>
        </div>

        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-primary" />
              Аккаунты клуба
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Загрузка…</p>
            ) : null}
            {!loading && accounts.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                Аккаунтов в клубе нет.
              </p>
            ) : null}
            {accounts.map((account) => (
              <button
                className="flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition-colors hover:bg-muted/50"
                key={account.id}
                onClick={() => navigate(
                  `/installation/organizations/${organizationId}/clubs/${clubId}/recovery/accounts/${account.id}`,
                )}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {account.displayName}
                  </span>
                  <span className="mt-1 block truncate text-sm text-muted-foreground">
                    {roleLabels[account.role] || 'Пользователь'} · {account.email}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
