import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Loader2, Pencil, UserRound } from 'lucide-react';
import { apiFetch, getApiErrorMessage, readApiError } from '@/lib/api';
import { fetchReferences, type ReferenceItem } from '@/lib/references';
import { formatClientPhone } from '@/lib/phone';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toast';

interface ClientProfile {
  birthDate?: string | null;
  id: number;
  name: string;
  note?: string | null;
  phone: string;
  source: string;
  sourceId?: number | null;
  stats?: {
    lastVisitAt?: string | null;
    visitCount: number;
  };
}

interface ClientProfileResponse {
  client: ClientProfile;
}

function formatDate(value?: string | null) {
  if (!value) return 'Не указана';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Не указана';
  return new Intl.DateTimeFormat('ru-RU').format(date);
}

export function ClientProfileDialog({
  clientId,
  onOpenChange,
}: {
  clientId: number | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [sources, setSources] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    birthDate: '',
    name: '',
    note: '',
    phone: '',
    sourceId: '',
  });

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError('');
    try {
      const [response, referenceItems] = await Promise.all([
        apiFetch(`/api/clients/${clientId}`),
        fetchReferences('client-sources'),
      ]);
      if (!response.ok) {
        const apiError = await readApiError(response, 'Не удалось открыть карточку клиента');
        setError(apiError.message);
        return;
      }
      const data = (await response.json()) as ClientProfileResponse;
      setProfile(data.client);
      setSources(referenceItems);
      setForm({
        birthDate: data.client.birthDate || '',
        name: data.client.name,
        note: data.client.note || '',
        phone: data.client.phone,
        sourceId: data.client.sourceId ? String(data.client.sourceId) : '',
      });
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, 'Не удалось открыть карточку клиента'));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (!clientId) {
      setProfile(null);
      setEditing(false);
      return;
    }
    void load();
  }, [clientId, load]);

  const save = async () => {
    if (!clientId || form.name.trim().length < 2) return;
    setSaving(true);
    try {
      const response = await apiFetch(`/api/clients/${clientId}`, {
        body: JSON.stringify({
          birthDate: form.birthDate || null,
          name: form.name.trim(),
          note: form.note.trim(),
          phone: form.phone,
          sourceId: form.sourceId ? Number(form.sourceId) : undefined,
        }),
        method: 'PUT',
      });
      if (!response.ok) {
        const apiError = await readApiError(response, 'Не удалось сохранить клиента');
        toast.error(apiError.message);
        return;
      }
      const data = (await response.json()) as ClientProfileResponse;
      setProfile(data.client);
      setEditing(false);
      toast.success('Карточка клиента обновлена');
    } catch (saveError) {
      toast.error(getApiErrorMessage(saveError, 'Не удалось сохранить клиента'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(clientId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5 text-primary" />
            Карточка клиента
          </DialogTitle>
          <DialogDescription>
            Контактные данные и история входов клиента.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Загрузка...
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : profile && editing ? (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="monitor-client-name">Имя и фамилия</Label>
                <Input
                  id="monitor-client-name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="monitor-client-phone">Телефон</Label>
                <Input
                  id="monitor-client-phone"
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    phone: formatClientPhone(event.target.value),
                  }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="monitor-client-birth-date">Дата рождения</Label>
                <Input
                  id="monitor-client-birth-date"
                  max={new Date().toISOString().slice(0, 10)}
                  type="date"
                  value={form.birthDate}
                  onChange={(event) => setForm((current) => ({ ...current, birthDate: event.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Откуда о нас узнал клиент</Label>
                <Select
                  value={form.sourceId}
                  onValueChange={(sourceId) => setForm((current) => ({ ...current, sourceId }))}
                >
                  <SelectTrigger><SelectValue placeholder="Выберите источник" /></SelectTrigger>
                  <SelectContent>
                    {sources.map((source) => (
                      <SelectItem key={source.id} value={String(source.id)}>
                        {source.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="monitor-client-note">Заметка</Label>
              <textarea
                id="monitor-client-note"
                className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={form.note}
                onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
              />
            </div>
          </div>
        ) : profile ? (
          <div className="grid gap-4">
            <div className="rounded-xl border p-4">
              <div className="text-lg font-semibold">{profile.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">{profile.phone}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Дата рождения</div>
                <div className="mt-1 font-medium">{formatDate(profile.birthDate)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Откуда о нас узнал клиент</div>
                <div className="mt-1 font-medium">{profile.source || '-'}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Визитов</div>
                <div className="mt-1 flex items-center gap-2 font-medium">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  {profile.stats?.visitCount || 0}
                </div>
              </div>
              <div className="rounded-lg border p-3 sm:col-span-2">
                <div className="text-xs text-muted-foreground">Заметка</div>
                <div className="mt-1 whitespace-pre-wrap text-sm">{profile.note || 'Нет заметки'}</div>
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          {profile && !editing ? (
            <Button type="button" onClick={() => setEditing(true)}>
              <Pencil className="mr-2 h-4 w-4" /> Редактировать
            </Button>
          ) : profile && editing ? (
            <>
              <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(false)}>
                Отмена
              </Button>
              <Button type="button" disabled={saving || form.name.trim().length < 2} onClick={() => void save()}>
                {saving ? 'Сохраняем...' : 'Сохранить'}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
