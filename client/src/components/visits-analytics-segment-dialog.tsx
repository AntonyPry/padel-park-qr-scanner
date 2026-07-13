import { useEffect, useState } from 'react';
import { PhoneCall, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  createVisitsAnalyticsClientBase,
  previewVisitsAnalyticsSegment,
  type VisitsAnalyticsSegmentPreview,
  type VisitsAnalyticsSegmentSelection,
} from '@/api/visits-analytics';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { getApiErrorMessage } from '@/lib/api';

interface CreatedBase {
  id: number;
  name: string;
}

function formatAsOf(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}

export function VisitsAnalyticsSegmentDialog({
  onOpenChange,
  selection,
}: {
  onOpenChange: (open: boolean) => void;
  selection: VisitsAnalyticsSegmentSelection | null;
}) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<VisitsAnalyticsSegmentPreview | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdBase, setCreatedBase] = useState<CreatedBase | null>(null);

  useEffect(() => {
    if (!selection) return;
    let active = true;
    setLoading(true);
    setError('');
    setPreview(null);
    setCreatedBase(null);
    void previewVisitsAnalyticsSegment(selection)
      .then((result) => {
        if (!active) return;
        setPreview(result);
        setName(result.name);
        setDescription(result.description);
      })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, 'Не удалось рассчитать сегмент'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selection]);

  const createBase = async () => {
    if (!selection || !preview || preview.count <= 0 || name.trim().length < 2) return;
    setSaving(true);
    setError('');
    try {
      const base = await createVisitsAnalyticsClientBase(selection, {
        description: description.trim(),
        name: name.trim(),
      });
      setCreatedBase(base);
      toast.success('Клиентская база создана');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Не удалось создать базу'));
    } finally {
      setSaving(false);
    }
  };

  const navigateToBase = (createCallTask = false) => {
    if (!createdBase) return;
    const params = new URLSearchParams({ baseId: String(createdBase.id) });
    if (createCallTask) params.set('createCallTask', '1');
    navigate(`/admin/client-bases?${params}`);
  };

  return (
    <Dialog open={Boolean(selection)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto p-4 sm:max-w-[680px] sm:p-6">
        <DialogHeader>
          <DialogTitle>{createdBase ? 'База создана' : 'Создать базу из аналитики'}</DialogTitle>
          <DialogDescription>
            {createdBase
              ? `«${createdBase.name}» сохранена как динамический фильтр существующей CRM-базы.`
              : 'Состав повторно рассчитывается по тем же canonical, source и asOf-правилам, что и аналитика.'}
          </DialogDescription>
        </DialogHeader>

        {createdBase ? (
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <Button variant="outline" onClick={() => navigateToBase(false)}>
              <Users className="mr-2 h-4 w-4" /> Открыть базу
            </Button>
            <Button onClick={() => navigateToBase(true)}>
              <PhoneCall className="mr-2 h-4 w-4" /> Создать задачу обзвона
            </Button>
          </div>
        ) : loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Рассчитываем состав базы…</div>
        ) : error && !preview ? (
          <ErrorState title="Сегмент не рассчитан" message={error} />
        ) : preview ? (
          <div className="min-w-0 space-y-4 pt-2">
            <div>
              <label htmlFor="visits-analytics-base-name" className="mb-1 block text-xs font-medium">Название базы</label>
              <Input id="visits-analytics-base-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <label htmlFor="visits-analytics-base-description" className="mb-1 block text-xs font-medium">Описание сегмента</label>
              <textarea
                id="visits-analytics-base-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="min-h-[96px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <dl className="grid min-w-0 gap-3 rounded-xl border bg-muted/30 p-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Период</dt><dd className="mt-1 break-words">{preview.period.from} — {preview.period.to}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Срез asOf</dt><dd className="mt-1 break-words">{formatAsOf(preview.asOf)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Источники</dt><dd className="mt-1 break-words">{preview.sourceLabels.join(', ') || 'Все источники'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Часовой пояс</dt><dd className="mt-1">{preview.timeZone}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Клиентов в базе</dt><dd className="mt-1 text-2xl font-semibold">{preview.count.toLocaleString('ru-RU')}</dd></div>
            </dl>
            {selection?.expectedCount !== undefined && selection.expectedCount !== preview.count && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                Аналитика обновилась: было {selection.expectedCount}, сейчас подходит {preview.count}. Будет сохранён актуальный состав.
              </div>
            )}
            {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            <Button className="w-full" disabled={saving || preview.count <= 0 || name.trim().length < 2} onClick={() => void createBase()}>
              <Users className="mr-2 h-4 w-4" />
              {saving ? 'Создаём…' : preview.count <= 0 ? 'Пустой сегмент нельзя создать' : 'Создать базу'}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
