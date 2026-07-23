import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, KeyRound, Pencil, ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/theme-toggle';
import { BrandMark } from '@/components/brand-mark';
import { API_URL } from '@/config';

const TOKEN_KEY = 'setly_installation_operator_token';
type Account = { id: number; email: string; role: string; displayName: string; phone?: string | null };
type RequestStatus = 'created' | 'issued' | 'used' | 'revoked' | 'expired';
type Request = { id: string; account: Account | null; status: RequestStatus; initiatedBy: string; createdAt: string };
const roleLabels: Record<string, string> = { owner: 'Владелец клуба', manager: 'Менеджер', admin: 'Администратор', accountant: 'Бухгалтер', trainer: 'Тренер', viewer: 'Наблюдатель' };
const statusLabels: Record<RequestStatus, string> = { created: 'Создана', issued: 'Ожидает использования', used: 'Использована', revoked: 'Отозвана', expired: 'Истекла' };

function useScope(pathname: string) { const parts = pathname.split('/'); return { organizationId: parts[3] || '', clubId: parts[5] || '', accountId: parts[8] || '' }; }
function syntheticEmail(account: Account | null) { if (!account) return 'Аккаунт недоступен'; return /[*•]|@f9-rc\.test$/u.test(account.email) ? `${account.role || 'user'}@example.test` : account.email; }
async function call(path: string, init: RequestInit = {}) {
  const operatorToken = window.sessionStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${API_URL}/api/installation/provisioning${path}`, { ...init, headers: { Authorization: `Bearer ${operatorToken || ''}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!response.ok) throw new Error('Операция восстановления не выполнена');
  return response.json();
}

export default function InstallationRecoveryAccountPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { organizationId, clubId, accountId } = useScope(pathname);
  const base = useMemo(() => `/organizations/${organizationId}/clubs/${clubId}/recovery`, [organizationId, clubId]);
  const routeBase = `/installation${base}`;
  const [account, setAccount] = useState<Account | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [profile, setProfile] = useState({ email: '', displayName: '', phone: '' });
  const [resetLink, setResetLink] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setError('');
    const [detail, requestResult] = await Promise.all([call(`${base}/accounts/${accountId}`), call(`${base}/requests?accountId=${accountId}`)]);
    setAccount(detail); setProfile({ email: detail.email, displayName: detail.displayName, phone: detail.phone || '' }); setRequests(requestResult.requests || []);
  }
  useEffect(() => { void reload().catch((caught) => setError(caught instanceof Error ? caught.message : 'Не удалось открыть аккаунт')).finally(() => setLoading(false)); }, [base, accountId]);
  async function saveProfile(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await call(`${base}/accounts/${accountId}`, { method: 'PUT', body: JSON.stringify(profile) }); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось сохранить данные'); } finally { setBusy(false); } }
  async function issueReset() { setBusy(true); setError(''); try { const created = await call(`${base}/requests`, { method: 'POST', body: JSON.stringify({ accountId: Number(accountId) }) }); const issued = await call(`${base}/requests/${created.id}/issue`, { method: 'POST', body: '{}' }); setResetLink(issued.resetLink); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось выдать ссылку'); } finally { setBusy(false); } }
  async function revoke(request: Request) { setBusy(true); setError(''); try { await call(`${base}/requests/${request.id}/revoke`, { method: 'POST', body: '{}' }); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось отозвать ссылку'); } finally { setBusy(false); } }
  const copyAndHide = () => { void navigator.clipboard?.writeText(resetLink); setResetLink(''); };

 return <main className="min-h-screen bg-muted/35 p-4 sm:p-8"><div className="mx-auto flex max-w-5xl items-center justify-between"><button className="flex items-center gap-3 text-left" onClick={() => navigate(`/installation/organizations/${organizationId}`)} type="button"><BrandMark className="size-10" decorative /><span className="font-semibold text-primary">Setly · Восстановление</span></button><ThemeToggle /></div><div className="mx-auto max-w-5xl space-y-6 py-8"><Button variant="ghost" onClick={() => navigate(routeBase)}><ArrowLeft className="mr-2 size-4" />К списку аккаунтов</Button>{loading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}{error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}{account ? <><div><h1 className="mt-4 text-2xl font-semibold">{account.displayName || syntheticEmail(account)}</h1><p className="mt-2 text-sm text-muted-foreground">{roleLabels[account.role] || 'Пользователь'} · {syntheticEmail(account)}</p></div>{resetLink ? <Card className="border-emerald-500/40"><CardHeader><CardTitle className="flex items-center gap-2"><Check className="size-5 text-emerald-600" />Ссылка выдана один раз</CardTitle></CardHeader><CardContent className="space-y-3"><Input aria-label="Одноразовая ссылка" readOnly value={resetLink} /><Button onClick={copyAndHide}><Copy className="mr-2 size-4" />Скопировать и скрыть</Button><p className="text-xs text-muted-foreground">Ссылка действует 30 минут и становится недействительной после первого использования.</p></CardContent></Card> : null}<Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" />Данные профиля</CardTitle></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-2" onSubmit={saveProfile}><div className="space-y-2"><Label htmlFor="recovery-display-name">Отображаемое имя</Label><Input id="recovery-display-name" value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="recovery-email">Email аккаунта</Label><Input id="recovery-email" type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} required /></div><div className="space-y-2"><Label htmlFor="recovery-phone">Телефон профиля</Label><Input id="recovery-phone" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></div><div className="flex items-end"><Button disabled={busy} type="submit" variant="outline"><Pencil className="mr-2 size-4" />Сохранить данные профиля</Button></div></form></CardContent></Card><Card><CardHeader><CardTitle>Смена пароля</CardTitle><p className="text-sm text-muted-foreground">Оператор не задаёт пароль. Пользователь сам задаёт новый пароль по одноразовой ссылке.</p></CardHeader><CardContent><Button disabled={busy} onClick={() => void issueReset()}><KeyRound className="mr-2 size-4" />Выпустить ссылку</Button></CardContent></Card><Card><CardHeader><CardTitle>История ссылок смены пароля</CardTitle></CardHeader><CardContent className="space-y-3">{requests.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Ссылки для смены пароля ещё не выпускались.</p> : requests.map((request) => <div className="rounded-xl border p-4" key={request.id}><div className="flex items-center justify-between gap-3"><p className="font-medium">{statusLabels[request.status]}</p><span className="text-xs text-muted-foreground">{new Date(request.createdAt).toLocaleString('ru-RU')}</span></div>{request.status === 'issued' || request.status === 'created' ? <Button disabled={busy} size="sm" variant="outline" className="mt-3" onClick={() => void revoke(request)}>Отозвать ссылку</Button> : null}</div>)}</CardContent></Card></> : null}</div></main>;
}
