import {
  Archive,
  Clock3,
  CopyPlus,
  Eye,
  FileCheck2,
  ListChecks,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createShiftReportTemplate,
  createShiftReportTemplateItem,
  listShiftReports,
  listShiftReportTemplates,
  updateShiftReportTemplate,
  updateShiftReportTemplateItem,
  updateShiftReportTemplateItemStatus,
  updateShiftReportTemplateStatus,
  type ShiftReport,
  type ShiftReportItemType,
  type ShiftReportTemplate,
  type ShiftReportTemplateItem,
  type ShiftReportTemplateItemPayload,
  type ShiftReportTemplatePayload,
  type ShiftReportStatus,
} from '@/api/shift-reports';
import { ShiftReportDialog } from '@/components/shift-report-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { ErrorState } from '@/components/error-state';
import { EmptyState } from '@/components/empty-state';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useAuth } from '@/lib/useAuth';
import { cn } from '@/lib/utils';

const statusLabels: Record<ShiftReportStatus | 'all', string> = {
  all: 'Все',
  draft: 'Черновики',
  overdue: 'Просрочены',
  pending: 'Ожидаются',
  submitted: 'Сданы',
};

const statusVariants: Record<ShiftReportStatus, 'default' | 'destructive' | 'outline' | 'secondary'> = {
  draft: 'secondary',
  overdue: 'destructive',
  pending: 'outline',
  submitted: 'default',
};

const itemTypeLabels: Record<ShiftReportItemType, string> = {
  checkbox: 'Чекбокс',
  checkbox_with_photo: 'Чекбокс + фото',
  number: 'Число',
  photo: 'Фото',
  text: 'Текст',
};

interface TemplateDraft {
  description: string;
  gracePeriodMinutes: string;
  name: string;
  scheduleTimes: string[];
  sortOrder: string;
  status: 'active' | 'archived';
}

interface ItemDraft {
  helperText: string;
  isRequired: boolean;
  itemType: ShiftReportItemType;
  label: string;
  photoRequired: boolean;
  sortOrder: string;
  status: 'active' | 'archived';
}

const emptyItemDraft: ItemDraft = {
  helperText: '',
  isRequired: false,
  itemType: 'checkbox',
  label: '',
  photoRequired: false,
  sortOrder: '100',
  status: 'active',
};

function todayDate() {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
    year: 'numeric',
  }).format(new Date());
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(new Date(value));
}

function normalizeTimeValue(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error('Время должно быть в формате HH:mm');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('Время должно быть от 00:00 до 23:59');
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function sortTimes(times: string[]) {
  return [...times].sort((left, right) => left.localeCompare(right));
}

function normalizeTimeList(times: string[]) {
  const normalized = sortTimes(Array.from(new Set(times.map(normalizeTimeValue))));
  if (normalized.length === 0) throw new Error('Добавьте хотя бы одно время отчета');
  return normalized;
}

function addHours(time: string, hours: number) {
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute));
  date.setUTCHours(date.getUTCHours() + hours);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function expandIntervalTimes(startTime = '09:00', endTime = '21:00', everyHours = 3) {
  const times: string[] = [];
  let time = normalizeTimeValue(startTime);
  const end = normalizeTimeValue(endTime);
  let guard = 0;
  while (time <= end && guard < 24) {
    times.push(time);
    const nextTime = addHours(time, Number(everyHours) || 3);
    if (nextTime <= time) break;
    time = nextTime;
    guard += 1;
  }
  return times;
}

function getTemplateTimes(template: ShiftReportTemplate) {
  const config = template.scheduleConfig || {};
  if (template.scheduleType === 'daily_times') {
    return normalizeTimeList(config.times || []);
  }
  if (template.scheduleType === 'once_daily') {
    return normalizeTimeList([config.time || config.times?.[0] || '09:00']);
  }
  if (template.scheduleType === 'interval_hours') {
    return normalizeTimeList(
      expandIntervalTimes(
        config.startTime || '09:00',
        config.endTime || '21:00',
        Number(config.everyHours) || 3,
      ),
    );
  }
  if (template.scheduleType === 'shift_end') return ['21:30'];
  return ['09:00'];
}

function formatSchedule(template: ShiftReportTemplate) {
  try {
    return getTemplateTimes(template).join(', ');
  } catch {
    return '-';
  }
}

function getEditableTemplateTimes(template: ShiftReportTemplate) {
  try {
    return getTemplateTimes(template);
  } catch {
    return ['09:00'];
  }
}

function templateToDraft(template: ShiftReportTemplate): TemplateDraft {
  return {
    description: template.description || '',
    gracePeriodMinutes: String(template.gracePeriodMinutes ?? 30),
    name: template.name,
    scheduleTimes: getEditableTemplateTimes(template),
    sortOrder: String(template.sortOrder ?? 0),
    status: template.status,
  };
}

function itemToDraft(item: ShiftReportTemplateItem): ItemDraft {
  return {
    helperText: item.helperText || '',
    isRequired: item.isRequired,
    itemType: item.itemType,
    label: item.label,
    photoRequired: item.photoRequired,
    sortOrder: String(item.sortOrder ?? 0),
    status: item.status,
  };
}

function draftToPayload(draft: TemplateDraft): ShiftReportTemplatePayload {
  return {
    description: draft.description || null,
    gracePeriodMinutes: draft.gracePeriodMinutes || 0,
    name: draft.name,
    scheduleConfig: { times: normalizeTimeList(draft.scheduleTimes) },
    scheduleType: 'daily_times',
    sortOrder: draft.sortOrder || 0,
    status: draft.status,
  };
}

function itemDraftToPayload(draft: ItemDraft): ShiftReportTemplateItemPayload {
  return {
    helperText: draft.helperText || null,
    isRequired: draft.isRequired,
    itemType: draft.itemType,
    label: draft.label,
    photoRequired: draft.photoRequired || draft.itemType === 'photo',
    sortOrder: draft.sortOrder || 0,
    status: draft.status,
  };
}

function TimeEditor({
  disabled,
  onChange,
  times,
}: {
  disabled?: boolean;
  onChange: (times: string[]) => void;
  times: string[];
}) {
  const [nextTime, setNextTime] = useState('');
  const [error, setError] = useState('');

  const addTime = () => {
    try {
      const normalized = normalizeTimeValue(nextTime);
      if (times.includes(normalized)) {
        setError('Такое время уже добавлено');
        return;
      }
      onChange(sortTimes([...times, normalized]));
      setNextTime('');
      setError('');
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Проверьте время');
    }
  };

  const removeTime = (time: string) => {
    onChange(times.filter((item) => item !== time));
    setError('');
  };

  return (
    <div className="grid gap-2">
      <Label>Времена отчетов</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          className="sm:max-w-44"
          disabled={disabled}
          type="time"
          value={nextTime}
          onChange={(event) => {
            setNextTime(event.target.value);
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addTime();
            }
          }}
        />
        <Button
          className="sm:w-auto"
          disabled={disabled}
          type="button"
          variant="outline"
          onClick={addTime}
        >
          <Plus className="mr-2 h-4 w-4" />
          Добавить время
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {times.length === 0 ? (
        <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
          Добавьте хотя бы одно время отчета.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {times.map((time) => (
            <Badge key={time} className="gap-1 pl-3" variant="secondary">
              {time}
              <button
                className="rounded-full p-0.5 hover:bg-background/70 disabled:pointer-events-none disabled:opacity-50"
                disabled={disabled}
                type="button"
                onClick={() => removeTime(time)}
              >
                <X className="h-3 w-3" />
                <span className="sr-only">Удалить время {time}</span>
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateItemEditor({
  item,
  onSaved,
}: {
  item: ShiftReportTemplateItem;
  onSaved: (template: ShiftReportTemplate) => void;
}) {
  const [draft, setDraft] = useState<ItemDraft>(() => itemToDraft(item));
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(itemToDraft(item)), [item]);

  const save = async () => {
    setSaving(true);
    try {
      onSaved(await updateShiftReportTemplateItem(item.id, itemDraftToPayload(draft)));
      toast.success('Пункт сохранен');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить пункт');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async () => {
    setSaving(true);
    try {
      onSaved(
        await updateShiftReportTemplateItemStatus(
          item.id,
          item.status === 'active' ? 'archived' : 'active',
        ),
      );
      toast.success(item.status === 'active' ? 'Пункт архивирован' : 'Пункт восстановлен');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось изменить пункт');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_90px]">
        <div className="min-w-0">
          <Label>Пункт</Label>
          <Input
            value={draft.label}
            onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
          />
        </div>
        <div>
          <Label>Тип</Label>
          <Select
            value={draft.itemType}
            onValueChange={(value) =>
              setDraft((current) => ({
                ...current,
                itemType: value as ShiftReportItemType,
                photoRequired:
                  value === 'photo' ? true : current.photoRequired,
              }))
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(itemTypeLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Порядок</Label>
          <Input
            inputMode="numeric"
            value={draft.sortOrder}
            onChange={(event) =>
              setDraft((current) => ({ ...current, sortOrder: event.target.value }))
            }
          />
        </div>
      </div>
      <div className="mt-3">
        <Label>Инструкция</Label>
        <textarea
          className="mt-1 min-h-16 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={draft.helperText}
          onChange={(event) =>
            setDraft((current) => ({ ...current, helperText: event.target.value }))
          }
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Label className="flex items-center gap-2">
          <input
            checked={draft.isRequired}
            className="h-4 w-4 accent-primary"
            type="checkbox"
            onChange={(event) =>
              setDraft((current) => ({ ...current, isRequired: event.target.checked }))
            }
          />
          Обязательный
        </Label>
        <Label className="flex items-center gap-2">
          <input
            checked={draft.photoRequired}
            className="h-4 w-4 accent-primary"
            disabled={draft.itemType === 'photo'}
            type="checkbox"
            onChange={(event) =>
              setDraft((current) => ({ ...current, photoRequired: event.target.checked }))
            }
          />
          Требует фото
        </Label>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" disabled={saving} onClick={() => void toggleStatus()}>
            {item.status === 'active' ? (
              <Archive className="mr-2 h-4 w-4" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            {item.status === 'active' ? 'Архив' : 'Вернуть'}
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            <Save className="mr-2 h-4 w-4" />
            Сохранить
          </Button>
        </div>
      </div>
    </div>
  );
}

function TemplateEditor({
  onSaved,
  template,
}: {
  onSaved: (template: ShiftReportTemplate) => void;
  template: ShiftReportTemplate | null;
}) {
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [newItem, setNewItem] = useState<ItemDraft>(emptyItemDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(template ? templateToDraft(template) : null);
    setNewItem(emptyItemDraft);
  }, [template]);

  if (!template || !draft) {
    return (
      <Card className="min-h-80">
        <CardContent className="flex flex-1 items-center justify-center py-12">
          <EmptyState
            icon={<ListChecks className="h-4 w-4" />}
            title="Выберите шаблон"
            description="Шаблоны меняются владельцем и применяются к новым сменам."
          />
        </CardContent>
      </Card>
    );
  }

  const saveTemplate = async () => {
    setSaving(true);
    try {
      onSaved(await updateShiftReportTemplate(template.id, draftToPayload(draft)));
      toast.success('Шаблон сохранен');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить шаблон');
    } finally {
      setSaving(false);
    }
  };

  const toggleTemplateStatus = async () => {
    setSaving(true);
    try {
      onSaved(
        await updateShiftReportTemplateStatus(
          template.id,
          template.status === 'active' ? 'archived' : 'active',
        ),
      );
      toast.success(
        template.status === 'active' ? 'Шаблон архивирован' : 'Шаблон включен',
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось изменить шаблон');
    } finally {
      setSaving(false);
    }
  };

  const addItem = async () => {
    setSaving(true);
    try {
      const updated = await createShiftReportTemplateItem(
        template.id,
        itemDraftToPayload(newItem),
      );
      onSaved(updated);
      setNewItem(emptyItemDraft);
      toast.success('Пункт добавлен');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось добавить пункт');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Настройки отчета</CardTitle>
          <CardDescription>
            Версия {template.version} • {template.status === 'active' ? 'активен' : 'архив'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_150px]">
            <div className="min-w-0">
              <Label>Название</Label>
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
              />
            </div>
            <div>
              <Label>Опоздание, мин</Label>
              <Input
                inputMode="numeric"
                value={draft.gracePeriodMinutes}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, gracePeriodMinutes: event.target.value }
                      : current,
                  )
                }
              />
            </div>
          </div>
          <div>
            <Label>Описание</Label>
            <textarea
              className="mt-1 min-h-20 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={draft.description}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, description: event.target.value } : current,
                )
              }
            />
          </div>
          <TimeEditor
            times={draft.scheduleTimes}
            onChange={(scheduleTimes) =>
              setDraft((current) => (current ? { ...current, scheduleTimes } : current))
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={saving} onClick={() => void saveTemplate()}>
              <Save className="mr-2 h-4 w-4" />
              Сохранить
            </Button>
            <Button
              disabled={saving}
              variant="outline"
              onClick={() => void toggleTemplateStatus()}
            >
              {template.status === 'active' ? (
                <Archive className="mr-2 h-4 w-4" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              {template.status === 'active' ? 'Выключить' : 'Включить'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Пункты отчета</CardTitle>
          <CardDescription>
            Активные пункты попадут в новые отчеты как snapshot.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {template.items.length === 0 ? (
            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              Пункты еще не добавлены.
            </div>
          ) : (
            template.items.map((item) => (
              <TemplateItemEditor key={item.id} item={item} onSaved={onSaved} />
            ))
          )}
          <div className="rounded-lg border border-dashed p-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_120px]">
              <div className="min-w-0">
                <Label>Новый пункт</Label>
                <Input
                  value={newItem.label}
                  onChange={(event) =>
                    setNewItem((current) => ({ ...current, label: event.target.value }))
                  }
                />
              </div>
              <div>
                <Label>Тип</Label>
                <Select
                  value={newItem.itemType}
                  onValueChange={(value) =>
                    setNewItem((current) => ({
                      ...current,
                      itemType: value as ShiftReportItemType,
                      photoRequired: value === 'photo' ? true : current.photoRequired,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(itemTypeLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Порядок</Label>
                <Input
                  inputMode="numeric"
                  value={newItem.sortOrder}
                  onChange={(event) =>
                    setNewItem((current) => ({
                      ...current,
                      sortOrder: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="mt-3">
              <Label>Инструкция</Label>
              <textarea
                className="mt-1 min-h-16 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                value={newItem.helperText}
                onChange={(event) =>
                  setNewItem((current) => ({
                    ...current,
                    helperText: event.target.value,
                  }))
                }
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Label className="flex items-center gap-2">
                <input
                  checked={newItem.isRequired}
                  className="h-4 w-4 accent-primary"
                  type="checkbox"
                  onChange={(event) =>
                    setNewItem((current) => ({
                      ...current,
                      isRequired: event.target.checked,
                    }))
                  }
                />
                Обязательный
              </Label>
              <Label className="flex items-center gap-2">
                <input
                  checked={newItem.photoRequired}
                  className="h-4 w-4 accent-primary"
                  disabled={newItem.itemType === 'photo'}
                  type="checkbox"
                  onChange={(event) =>
                    setNewItem((current) => ({
                      ...current,
                      photoRequired: event.target.checked,
                    }))
                  }
                />
                Требует фото
              </Label>
              <Button className="ml-auto" disabled={saving} onClick={() => void addItem()}>
                <Plus className="mr-2 h-4 w-4" />
                Добавить
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ShiftReportsPage() {
  const { account } = useAuth();
  const canManageTemplates = account?.role === 'owner';
  const [activeTab, setActiveTab] = useState<'reports' | 'templates'>('reports');
  const [reports, setReports] = useState<ShiftReport[]>([]);
  const [templates, setTemplates] = useState<ShiftReportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [selectedReport, setSelectedReport] = useState<ShiftReport | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [status, setStatus] = useState<ShiftReportStatus | 'all'>('all');
  const [date, setDate] = useState(todayDate());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId, templates],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextReports, nextTemplates] = await Promise.all([
        listShiftReports({ date, status }),
        listShiftReportTemplates('all'),
      ]);
      setReports(nextReports);
      setTemplates(nextTemplates);
      setSelectedTemplateId((current) =>
        current && nextTemplates.some((template) => template.id === current)
          ? current
          : nextTemplates[0]?.id || null,
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Не удалось загрузить отчеты смен',
      );
    } finally {
      setLoading(false);
    }
  }, [date, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useRealtimeRefresh(['shiftReports', 'shifts'], () => {
    void refresh();
  });

  const createTemplate = async () => {
    try {
      const template = await createShiftReportTemplate({
        description: '',
        gracePeriodMinutes: 30,
        name: 'Новый отчет смены',
        scheduleConfig: { times: ['09:00'] },
        scheduleType: 'daily_times',
        sortOrder: templates.length * 10 + 10,
        status: 'active',
      });
      setTemplates((current) => [...current, template]);
      setSelectedTemplateId(template.id);
      setActiveTab('templates');
      toast.success('Шаблон создан');
    } catch (createError) {
      toast.error(
        createError instanceof Error ? createError.message : 'Не удалось создать шаблон',
      );
    }
  };

  const handleTemplateSaved = (template: ShiftReportTemplate) => {
    setTemplates((current) =>
      current.map((item) => (item.id === template.id ? template : item)),
    );
  };

  const handleReportUpdated = (report: ShiftReport) => {
    setReports((current) =>
      current.map((item) => (item.id === report.id ? report : item)),
    );
    setSelectedReport(report);
  };

  const openReport = (report: ShiftReport) => {
    setSelectedReport(report);
    setReportDialogOpen(true);
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Отчеты смены</h1>
          <p className="text-sm text-muted-foreground">
            Контроль ожидаемых отчетов, статусов и шаблонов смены.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={activeTab === 'reports' ? 'default' : 'outline'}
            onClick={() => setActiveTab('reports')}
          >
            <FileCheck2 className="mr-2 h-4 w-4" />
            Отчеты
          </Button>
          <Button
            variant={activeTab === 'templates' ? 'default' : 'outline'}
            onClick={() => setActiveTab('templates')}
          >
            <ListChecks className="mr-2 h-4 w-4" />
            Шаблоны
          </Button>
          {canManageTemplates && (
            <Button variant="outline" onClick={() => void createTemplate()}>
              <CopyPlus className="mr-2 h-4 w-4" />
              Создать
            </Button>
          )}
        </div>
      </div>

      {error && (
        <ErrorState
          compact
          message={error}
          onRetry={() => void refresh()}
          title="Отчеты смены не загрузились"
        />
      )}

      {activeTab === 'reports' ? (
        <div className="grid gap-4">
          <Card>
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-end">
              <div className="sm:w-48">
                <Label>Дата</Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
              <div className="sm:w-52">
                <Label>Статус</Label>
                <Select
                  value={status}
                  onValueChange={(value) => setStatus(value as ShiftReportStatus | 'all')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" disabled={loading} onClick={() => void refresh()}>
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Обновить
              </Button>
            </CardContent>
          </Card>

          {loading && reports.length === 0 ? (
            <div className="rounded-lg border py-12 text-center text-sm text-muted-foreground">
              Загрузка отчетов...
            </div>
          ) : reports.length === 0 ? (
            <EmptyState
              icon={<FileCheck2 className="h-4 w-4" />}
              title="Отчетов за выбранный период нет"
              description="Новые смены получают отчеты из активных шаблонов."
            />
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {reports.map((report) => (
                <Card key={report.id} size="sm">
                  <CardContent className="grid gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">
                          {report.templateSnapshot.name}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>Смена #{report.shiftId}</span>
                          <span>{report.shift?.adminName}</span>
                          <span>{formatDateTime(report.scheduledAt)}</span>
                        </div>
                      </div>
                      <Badge variant={statusVariants[report.computedStatus]}>
                        {statusLabels[report.computedStatus]}
                      </Badge>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg bg-muted/40 p-2">
                        <div className="text-xs text-muted-foreground">Пунктов</div>
                        <div className="font-semibold">{report.answers.length}</div>
                      </div>
                      <div className="rounded-lg bg-muted/40 p-2">
                        <div className="text-xs text-muted-foreground">Дедлайн</div>
                        <div className="font-semibold">{formatDateTime(report.deadlineAt)}</div>
                      </div>
                      <div className="rounded-lg bg-muted/40 p-2">
                        <div className="text-xs text-muted-foreground">Сдан</div>
                        <div className="font-semibold">{formatDateTime(report.submittedAt)}</div>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button size="sm" variant="outline" onClick={() => openReport(report)}>
                        <Eye className="mr-2 h-4 w-4" />
                        Открыть
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <Card className="self-start">
            <CardHeader>
              <CardTitle>Шаблоны</CardTitle>
              <CardDescription>
                {canManageTemplates ? 'Редактируемые настройки' : 'Доступен просмотр'}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {templates.map((template) => (
                <button
                  key={template.id}
                  className={cn(
                    'min-w-0 rounded-lg border p-3 text-left transition hover:bg-muted/50',
                    selectedTemplateId === template.id && 'border-primary bg-primary/5',
                  )}
                  type="button"
                  onClick={() => setSelectedTemplateId(template.id)}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{template.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatSchedule(template)}
                      </div>
                    </div>
                    <Badge variant={template.status === 'active' ? 'default' : 'outline'}>
                      {template.status === 'active' ? 'Вкл' : 'Архив'}
                    </Badge>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          {canManageTemplates ? (
            <TemplateEditor template={selectedTemplate} onSaved={handleTemplateSaved} />
          ) : (
            <Card>
              <CardContent className="grid gap-3 py-4">
                {selectedTemplate ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle>{selectedTemplate.name}</CardTitle>
                        <CardDescription>{formatSchedule(selectedTemplate)}</CardDescription>
                      </div>
                      <Badge variant={selectedTemplate.status === 'active' ? 'default' : 'outline'}>
                        {selectedTemplate.status === 'active' ? 'Активен' : 'Архив'}
                      </Badge>
                    </div>
                    <div className="grid gap-2">
                      {selectedTemplate.items.map((item) => (
                        <div key={item.id} className="rounded-lg border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{item.label}</span>
                            {item.isRequired && <Badge variant="outline">Обязательно</Badge>}
                            {item.photoRequired && <Badge variant="outline">Фото</Badge>}
                          </div>
                          {item.helperText && (
                            <p className="mt-1 text-sm text-muted-foreground">
                              {item.helperText}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyState icon={<Clock3 className="h-4 w-4" />} title="Шаблон не выбран" />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <ShiftReportDialog
        onOpenChange={setReportDialogOpen}
        onUpdated={handleReportUpdated}
        open={reportDialogOpen}
        report={selectedReport}
      />
    </div>
  );
}
