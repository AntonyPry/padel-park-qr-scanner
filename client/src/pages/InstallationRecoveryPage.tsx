import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '@/components/theme-toggle';
import { BrandMark } from '@/components/brand-mark';
import { API_URL } from '@/config';

const TOKEN_KEY = 'setly_installation_operator_token';
type Account = { id: number; email: string; role: string; displayName: string; staffId: number | null };
const roleLabels: Record<string, string> = { owner: 'Владелец клуба', manager: 'Менеджер', admin: 'Администратор', accountant: 'Бухгалтер', trainer: 'Тренер', viewer: 'Наблюдатель' };

function useScope(pathname: string) { const parts = pathname.split('/'); return { organizationId: parts[3] || '', clubId: parts[5] || '' }; }
function syntheticEmail(account: Account) { return /[*•]|@f9-rc\.test$/u.test(account.email) ? `${account.role || 'user'}@example.test` : account.email; }
async function call(path: string) {
  const operatorToken = window.sessionStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${API_URL}/api/installation/provisioning${path}`, { headers: { Authorization: `Bearer ${operatorToken || ''}` } });
  if (!response.ok) throw new Error('Не удалось загрузить аккаунты');
  return response.json();
}

export default function InstallationRecoveryPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { organizationId, clubId } = useScope(pathname);
  const base = useMemo(() => `/organizations/${organizationId}/clubs/${clubId}/recovery`, [organizationId, clubId]);
  const routeBase = `/installation${base}`;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try { setAccounts((await call(`${base}/accounts`)).accounts || []); }
      catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить аккаунты'); }
      finally { setLoading(false); }
    })();
  }, [base]);

  return <main className="min-h-screen bg-muted/35 p-4 sm:p-8"><div className="mx-auto flex max-w-6xl items-center justify-between"><button className="flex items-center gap-3 text-left" onClick={() => navigate(`/installation/organizations/${organizationId}`)} type="button"><BrandMark className="size-10" decorative /><span className="font-semibold text-primary">Setly · Восстановление</span></button><ThemeToggle /></div><div className="mx-auto max-w-6xl space-y-6 py-8"><div><Button variant="ghost" onClick={() => navigate(`/installation/organizations/${organizationId}`)}><ArrowLeft className="mr-2 size-4" />К организации</Button><h1 className="mt-4 text-2xl font-semibold">Восстановление доступа</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Выберите аккаунт, чтобы открыть отдельную страницу профиля, запросов смены пароля и одноразовых ссылок.</p></div>{error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}<Card><CardHeader><CardTitle>Аккаунты организации</CardTitle><p className="text-sm text-muted-foreground">Статусы и действия восстановления открываются на странице выбранного аккаунта.</p></CardHeader><CardContent>{loading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : accounts.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">В этом клубе нет активных аккаунтов.</p> : <div className="grid gap-2 sm:grid-cols-2">{accounts.map((account) => <button className="flex items-center justify-between rounded-xl border p-4 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" key={account.id} onClick={() => navigate(`${routeBase}/accounts/${account.id}`)} type="button"><span><p className="font-medium">{account.displayName || syntheticEmail(account)}</p><p className="mt-1 text-sm text-muted-foreground">{roleLabels[account.role] || 'Пользователь'} · {syntheticEmail(account)}</p></span><ChevronRight className="size-4 text-muted-foreground" /></button>)}</div>}</CardContent></Card></div></main>;
}
