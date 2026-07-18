import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CheckCircle2,
  Copy,
  CopyPlus,
  FileCheck2,
  ListChecks,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createShiftReportTemplate,
  createShiftReportTemplateItem,
  deleteShiftReportTemplate,
  deleteShiftReportTemplateItem,
  listShiftReports,
  listShiftReportTemplates,
  updateShiftReportTemplate,
  updateShiftReportTemplateItem,
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
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useAuthorizationRole } from '@/lib/useAuth';
import { canManageShiftReportTemplates } from '@/lib/permissions';
import { loadCompletedShiftReport } from '@/lib/completed-shift-report';
import { ru } from 'date-fns/locale';

const statusLabels: Record<ShiftReportStatus | 'all', string> = {
  all: 'Все',
  draft: 'Черновики',
  overdue: 'Просрочены',
  pending: 'Ожидаются',
  submitted: 'Сданы',
};

const reportStatusLabels: Record<ShiftReportStatus, string> = {
  draft: 'Черновик',
  overdue: 'Просрочен',
  pending: 'Ожидается',
  submitted: 'Сдан',
};

const statusVariants: Record<ShiftReportStatus, 'default' | 'destructive' | 'outline' | 'secondary'> = {
  draft: 'secondary',
  overdue: 'destructive',
  pending: 'outline',
  submitted: 'default',
};

function showSuccessToast(title: string) {
  toast.show({ title, variant: 'success' });
}

const editableItemTypes: Array<{ label: string; value: ShiftReportItemType }> = [
  { label: 'Чекбокс', value: 'checkbox' },
  { label: 'Текст', value: 'text' },
  { label: 'Число', value: 'number' },
];

interface TemplateDraft {
  description: string;
  gracePeriodMinutes: string;
  name: string;
  scheduleTimes: string[];
  sortOrder: string;
}

interface ItemDraft {
  itemType: ShiftReportItemType;
  label: string;
  photoRequired: boolean;
}

interface EditableItemDraft {
  draft: ItemDraft;
  id?: number;
  isNew: boolean;
  key: string;
  originalDraft?: ItemDraft;
  sortOrder: number;
}

const emptyItemDraft: ItemDraft = {
  itemType: 'checkbox',
  label: '',
  photoRequired: false,
};

function createEmptyItemDraft(): ItemDraft {
  return { ...emptyItemDraft };
}

function todayDate() {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
    year: 'numeric',
  }).format(new Date());
}

function parseDateValue(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function formatDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function formatDateLabel(value: string) {
  const date = parseDateValue(value);
  if (!date) return 'Выберите дату';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
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

function isAnswerCompleted(answer: ShiftReport['answers'][number]) {
  if (answer.itemType === 'checkbox') return answer.booleanValue === true;
  if (answer.itemType === 'text') return Boolean(answer.textValue?.trim());
  if (answer.itemType === 'number') {
    return answer.numberValue !== null && answer.numberValue !== undefined;
  }
  return false;
}

function isReportComplete(report: ShiftReport) {
  return report.answers.length > 0 && report.answers.every(isAnswerCompleted);
}

function getCompletionBadge(report: ShiftReport) {
  const total = report.answers.length;
  const completed = report.answers.filter(isAnswerCompleted).length;
  const isComplete = isReportComplete(report);

  return {
    className: isComplete
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : undefined,
    label: `${completed}/${total} пунктов`,
    variant: isComplete ? ('outline' as const) : ('destructive' as const),
  };
}

function getDeadlineBadge(report: ShiftReport) {
  const deadlineTime = new Date(report.deadlineAt).getTime();
  const submittedTime = report.submittedAt
    ? new Date(report.submittedAt).getTime()
    : null;

  if (submittedTime) {
    return submittedTime <= deadlineTime
      ? { label: 'Сдано в дедлайн', variant: 'default' as const }
      : { label: 'Сдано позже дедлайна', variant: 'destructive' as const };
  }

  if (report.computedStatus === 'overdue') {
    return { label: 'Дедлайн прошел', variant: 'destructive' as const };
  }

  return { label: 'Дедлайн впереди', variant: 'outline' as const };
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
  };
}

function itemToDraft(item: ShiftReportTemplateItem): ItemDraft {
  const rawItemType = String(item.itemType);
  const itemType: ShiftReportItemType =
    rawItemType === 'text' || rawItemType === 'number' ? rawItemType : 'checkbox';

  return {
    itemType,
    label: item.label,
    photoRequired:
      item.photoRequired || rawItemType === 'photo' || rawItemType === 'checkbox_with_photo',
  };
}

function draftToPayload(draft: TemplateDraft): ShiftReportTemplatePayload {
  return {
    description: draft.description.trim() || null,
    gracePeriodMinutes: draft.gracePeriodMinutes || 0,
    name: draft.name.trim(),
    scheduleConfig: { times: normalizeTimeList(draft.scheduleTimes) },
    scheduleType: 'daily_times',
    sortOrder: draft.sortOrder || 0,
    status: 'active',
  };
}

function itemDraftToPayload(
  draft: ItemDraft,
  options: { sortOrder: number | string },
): ShiftReportTemplateItemPayload {
  return {
    itemType: draft.itemType,
    label: draft.label.trim(),
    photoRequired: draft.photoRequired,
    sortOrder: options.sortOrder,
    status: 'active',
  };
}

function areTemplateDraftsEqual(left: TemplateDraft, right: TemplateDraft) {
  return (
    left.description === right.description &&
    left.gracePeriodMinutes === right.gracePeriodMinutes &&
    left.name === right.name &&
    left.sortOrder === right.sortOrder &&
    left.scheduleTimes.join('|') === right.scheduleTimes.join('|')
  );
}

function areItemDraftsEqual(left: ItemDraft, right: ItemDraft) {
  return (
    left.itemType === right.itemType &&
    left.label === right.label &&
    left.photoRequired === right.photoRequired
  );
}

function templateItemsToDrafts(template: ShiftReportTemplate): EditableItemDraft[] {
  return template.items.map((item, index) => {
    const draft = itemToDraft(item);

    return {
      draft,
      id: item.id,
      isNew: false,
      key: `item-${item.id}`,
      originalDraft: draft,
      sortOrder: Number(item.sortOrder ?? (index + 1) * 10),
    };
  });
}

function getNextItemSortOrder(items: EditableItemDraft[]) {
  return Math.max(0, ...items.map((item) => Number(item.sortOrder) || 0)) + 10;
}

function hasDirtyItems(items: EditableItemDraft[], deletedItemIds: number[]) {
  return (
    deletedItemIds.length > 0 ||
    items.some(
      (item) =>
        item.isNew ||
        !item.originalDraft ||
        !areItemDraftsEqual(item.draft, item.originalDraft),
    )
  );
}

function validateTemplateDraft(draft: TemplateDraft, items: EditableItemDraft[]) {
  if (!draft.name.trim()) throw new Error('Введите название шаблона');
  normalizeTimeList(draft.scheduleTimes);
  if (items.length === 0) {
    throw new Error('Добавьте хотя бы один пункт');
  }
  if (items.some((item) => !item.draft.label.trim())) {
    throw new Error('Заполните текст каждого пункта');
  }
}

function isTemplateDraftValid(draft: TemplateDraft | null, items: EditableItemDraft[]) {
  if (!draft?.name.trim()) return false;
  if (draft.scheduleTimes.length === 0) return false;
  if (items.length === 0) return false;
  return items.every((item) => item.draft.label.trim());
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

function ShiftReportDatePicker({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  const selectedDate = parseDateValue(value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          className={cn(
            'h-8 w-full justify-start bg-card text-left font-normal',
            !selectedDate && 'text-muted-foreground',
          )}
          size="sm"
          variant="outline"
        >
          <CalendarDays className="mr-2 h-4 w-4" />
          {formatDateLabel(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          initialFocus
          mode="single"
          locale={ru}
          selected={selectedDate}
          onSelect={(nextDate) => {
            if (nextDate) onChange(formatDateValue(nextDate));
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function ItemTypeControl({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (value: ShiftReportItemType) => void;
  value: ShiftReportItemType;
}) {
  return (
    <Select
      disabled={disabled}
      value={value}
      onValueChange={(nextValue) => onChange(nextValue as ShiftReportItemType)}
    >
      <SelectTrigger className="h-10 w-full rounded-lg bg-background">
        <SelectValue placeholder="Выберите тип" />
      </SelectTrigger>
      <SelectContent
        align="start"
        className="w-[var(--radix-select-trigger-width)]"
        position="popper"
        side="bottom"
      >
        {editableItemTypes.map((type) => (
          <SelectItem key={type.value} value={type.value}>
            {type.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TemplateItemEditor({
  disabled,
  invalid,
  item,
  onDeleted,
  onDraftChange,
}: {
  disabled?: boolean;
  invalid?: boolean;
  item: EditableItemDraft;
  onDeleted: () => void;
  onDraftChange: (draft: ItemDraft) => void;
}) {
  const labelInputId = `shift-report-item-${item.key}-label`;
  const photoInputId = `shift-report-item-${item.key}-photo`;
  const updateDraft = (patch: Partial<ItemDraft>) => {
    onDraftChange({ ...item.draft, ...patch });
  };

  return (
    <div
      className={cn(
        'rounded-lg border bg-background p-4',
        invalid && 'border-destructive/70',
      )}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={labelInputId}>Пункт</Label>
          <Input
            disabled={disabled}
            id={labelInputId}
            placeholder="Например: Проверить ресепшен"
            value={item.draft.label}
            onChange={(event) => updateDraft({ label: event.target.value })}
          />
          {invalid && (
            <p className="text-sm text-destructive">Заполните текст пункта.</p>
          )}
        </div>
        <div className="grid gap-2">
          <Label>Тип</Label>
          <ItemTypeControl
            disabled={disabled}
            value={item.draft.itemType}
            onChange={(value) =>
              onDraftChange({
                ...item.draft,
                itemType: value,
              })
            }
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Label className="flex items-center gap-2 text-sm" htmlFor={photoInputId}>
          <input
            id={photoInputId}
            checked={item.draft.photoRequired}
            className="h-4 w-4 accent-primary"
            disabled={disabled}
            type="checkbox"
            onChange={(event) =>
              updateDraft({
                photoRequired: event.target.checked,
              })
            }
          />
          Фото
        </Label>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button
            disabled={disabled}
            size="sm"
            type="button"
            variant="destructive"
            onClick={onDeleted}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Удалить
          </Button>
        </div>
      </div>
    </div>
  );
}

function TemplateEditorDialog({
  initialSortOrder,
  mode,
  onCreated,
  onOpenChange,
  onSaved,
  onStatusChanged,
  open,
  template,
}: {
  initialSortOrder: number;
  mode: 'create' | 'edit';
  onCreated: (template: ShiftReportTemplate) => void;
  onOpenChange: (open: boolean) => void;
  onSaved: (template: ShiftReportTemplate) => void;
  onStatusChanged: (template: ShiftReportTemplate) => void;
  open: boolean;
  template: ShiftReportTemplate | null;
}) {
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [items, setItems] = useState<EditableItemDraft[]>([]);
  const [deletedItemIds, setDeletedItemIds] = useState<number[]>([]);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const originalDraft = useMemo(
    () =>
      mode === 'edit' && template
        ? templateToDraft(template)
        : {
            description: '',
            gracePeriodMinutes: '30',
            name: 'Новый отчет смены',
            scheduleTimes: ['09:00'],
            sortOrder: String(initialSortOrder),
          },
    [initialSortOrder, mode, template],
  );
  const templateDirty = Boolean(
    draft && originalDraft && !areTemplateDraftsEqual(draft, originalDraft),
  );
  const itemsDirty = hasDirtyItems(items, deletedItemIds);
  const isDirty = mode === 'create' || templateDirty || itemsDirty;
  const hasInvalidItems = items.some((item) => !item.draft.label.trim());
  const isArchivedTemplate = mode === 'edit' && template?.status === 'archived';
  const formDisabled = saving || deleting || isArchivedTemplate;
  const canSubmit =
    isTemplateDraftValid(draft, items) && !formDisabled;

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && template) {
      setDraft(templateToDraft(template));
      setItems(templateItemsToDrafts(template));
      setDeletedItemIds([]);
      setSubmitAttempted(false);
      return;
    }
    if (mode === 'create') {
      setDraft({
        description: '',
        gracePeriodMinutes: '30',
        name: 'Новый отчет смены',
        scheduleTimes: ['09:00'],
        sortOrder: String(initialSortOrder),
      });
      setItems([]);
      setDeletedItemIds([]);
      setSubmitAttempted(false);
    }
  }, [initialSortOrder, mode, open, template]);

  if ((mode === 'edit' && !template) || !draft) return null;

  const persistTemplate = async () => {
    if (!draft) return;
    if (mode === 'edit' && !template) return;
    if (isArchivedTemplate) return;
    if (mode === 'edit' && !isDirty) return;
    setSubmitAttempted(true);
    setSaving(true);
    try {
      validateTemplateDraft(draft, items);

      if (mode === 'create') {
        let updated = await createShiftReportTemplate(draftToPayload(draft));
        for (const item of items) {
          updated = await createShiftReportTemplateItem(
            updated.id,
            itemDraftToPayload(item.draft, {
              sortOrder: item.sortOrder,
            }),
          );
        }
        onCreated(updated);
        onOpenChange(false);
        showSuccessToast('Шаблон создан');
        return;
      }

      const existingTemplate = template;
      if (!existingTemplate) return;
      let updated: ShiftReportTemplate | null = null;
      if (templateDirty) {
        updated = await updateShiftReportTemplate(existingTemplate.id, draftToPayload(draft));
      }

      for (const itemId of deletedItemIds) {
        updated = await deleteShiftReportTemplateItem(itemId);
      }

      for (const item of items) {
        if (item.isNew) {
          updated = await createShiftReportTemplateItem(
            existingTemplate.id,
            itemDraftToPayload(item.draft, {
              sortOrder: item.sortOrder,
            }),
          );
          continue;
        }
        if (item.id && item.originalDraft && !areItemDraftsEqual(item.draft, item.originalDraft)) {
          updated = await updateShiftReportTemplateItem(
            item.id,
            itemDraftToPayload(item.draft, {
              sortOrder: item.sortOrder,
            }),
          );
        }
      }

      const nextTemplate = updated || existingTemplate;
      onSaved(nextTemplate);
      setDraft(templateToDraft(nextTemplate));
      setItems(templateItemsToDrafts(nextTemplate));
      setDeletedItemIds([]);
      showSuccessToast('Шаблон сохранен');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : mode === 'create'
            ? 'Не удалось создать шаблон'
            : 'Не удалось сохранить шаблон',
      );
    } finally {
      setSaving(false);
    }
  };

  const changeTemplateStatus = async () => {
    if (!template) return;
    setDeleting(true);
    try {
      const nextStatus = template.status === 'active' ? 'archived' : 'active';
      const updated =
        nextStatus === 'archived'
          ? await deleteShiftReportTemplate(template.id)
          : await updateShiftReportTemplateStatus(template.id, nextStatus);
      onStatusChanged(updated);
      onOpenChange(false);
      showSuccessToast(
        nextStatus === 'archived' ? 'Шаблон архивирован' : 'Шаблон восстановлен',
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : template.status === 'active'
            ? 'Не удалось архивировать шаблон'
            : 'Не удалось восстановить шаблон',
      );
    } finally {
      setDeleting(false);
    }
  };

  const addItem = () => {
    setItems((current) => [
      ...current,
      {
        draft: createEmptyItemDraft(),
        isNew: true,
        key: `new-${Date.now()}-${current.length}`,
        sortOrder: getNextItemSortOrder(current),
      },
    ]);
  };

  const updateItemDraft = (key: string, nextDraft: ItemDraft) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, draft: nextDraft } : item)),
    );
  };

  const removeItem = (item: EditableItemDraft) => {
    setItems((current) => current.filter((currentItem) => currentItem.key !== item.key));
    if (!item.isNew && item.id) {
      setDeletedItemIds((current) =>
        current.includes(item.id as number) ? current : [...current, item.id as number],
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:max-w-[980px] sm:p-6">
        <DialogHeader className="sr-only">
          <DialogTitle>
            {mode === 'create' ? 'Создание шаблона' : 'Настройки шаблона'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Заполните настройки нового шаблона отчета смены.'
              : 'Измените настройки шаблона отчета смены.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <section className="rounded-lg border p-4">
            <div className="mb-4">
              <h3 className="font-medium">Основное</h3>
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_150px]">
              <div className="grid min-w-0 gap-2">
                <Label>Название</Label>
                <Input
                  disabled={formDisabled}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    )
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Опоздание, минут</Label>
                <Input
                  disabled={formDisabled}
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
            <div className="mt-4 grid gap-2">
              <Label>Описание</Label>
              <textarea
                className="min-h-20 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                disabled={formDisabled}
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, description: event.target.value } : current,
                  )
                }
              />
            </div>
          </section>

          <section className="rounded-lg border p-4">
            <div className="mb-4">
              <h3 className="font-medium">Расписание</h3>
            </div>
            <TimeEditor
              disabled={formDisabled}
              times={draft.scheduleTimes}
              onChange={(scheduleTimes) =>
                setDraft((current) => (current ? { ...current, scheduleTimes } : current))
              }
            />
          </section>

          <section className="rounded-lg border p-4">
            <div className="mb-4">
              <h3 className="font-medium">Пункты отчета</h3>
            </div>
            <div className="grid gap-3">
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                  Пункты еще не добавлены.
                </div>
              ) : (
                items.map((item) => (
                  <TemplateItemEditor
                    key={item.key}
                    disabled={formDisabled}
                    invalid={(submitAttempted || hasInvalidItems) && !item.draft.label.trim()}
                    item={item}
                    onDeleted={() => removeItem(item)}
                    onDraftChange={(nextDraft) => updateItemDraft(item.key, nextDraft)}
                  />
                ))
              )}
              <Button
                className="justify-self-start"
                disabled={formDisabled}
                type="button"
                variant="outline"
                onClick={addItem}
              >
                <Plus className="mr-2 h-4 w-4" />
                Добавить пункт
              </Button>
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {mode === 'edit' ? (
            <Button
              disabled={deleting || saving}
              type="button"
              variant={template?.status === 'active' ? 'destructive' : 'outline'}
              onClick={() => void changeTemplateStatus()}
            >
              {template?.status === 'active' ? (
                <Archive className="mr-2 h-4 w-4" />
              ) : (
                <ArchiveRestore className="mr-2 h-4 w-4" />
              )}
              {template?.status === 'active'
                ? 'Архивировать шаблон'
                : 'Восстановить шаблон'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Закрыть
              </Button>
            </DialogClose>
            <Button
              disabled={
                !canSubmit || isArchivedTemplate || (mode === 'edit' && !isDirty)
              }
              onClick={() => void persistTemplate()}
            >
              {mode === 'create' ? (
                <CopyPlus className="mr-2 h-4 w-4" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {mode === 'create' ? 'Создать' : 'Сохранить'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ShiftReportsPageProps = {
  view?: 'operations' | 'settings';
};

export default function ShiftReportsPage({
  view = 'operations',
}: ShiftReportsPageProps) {
  const organizationRole = useAuthorizationRole('organization');
  const canManageTemplates = canManageShiftReportTemplates(organizationRole);
  const isSettingsView = view === 'settings';
  const [reports, setReports] = useState<ShiftReport[]>([]);
  const [templates, setTemplates] = useState<ShiftReportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateDialogMode, setTemplateDialogMode] = useState<'create' | 'edit'>('edit');
  const [selectedReport, setSelectedReport] = useState<ShiftReport | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [status, setStatus] = useState<ShiftReportStatus | 'all'>('all');
  const [date, setDate] = useState(todayDate());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [completedReport] = useState(loadCompletedShiftReport);
  const [reportCopied, setReportCopied] = useState(false);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId, templates],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (isSettingsView) {
        const nextTemplates = await listShiftReportTemplates('all');
        setTemplates(nextTemplates);
        setSelectedTemplateId((current) =>
          current && nextTemplates.some((template) => template.id === current)
            ? current
            : null,
        );
      } else {
        setReports(await listShiftReports({ date, status }));
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Не удалось загрузить отчеты смен',
      );
    } finally {
      setLoading(false);
    }
  }, [date, isSettingsView, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useRealtimeRefresh(['shiftReports', 'shifts'], () => {
    void refresh();
  });

  const openCreateTemplate = () => {
    setSelectedTemplateId(null);
    setTemplateDialogMode('create');
    setTemplateDialogOpen(true);
  };

  const handleTemplateCreated = (template: ShiftReportTemplate) => {
    setTemplates((current) =>
      current.some((item) => item.id === template.id)
        ? current.map((item) => (item.id === template.id ? template : item))
        : [...current, template],
    );
    setSelectedTemplateId(template.id);
  };

  const handleTemplateSaved = (template: ShiftReportTemplate) => {
    setTemplates((current) =>
      current.map((item) => (item.id === template.id ? template : item)),
    );
  };

  const handleTemplateStatusChanged = (template: ShiftReportTemplate) => {
    setTemplates((current) =>
      current.map((item) => (item.id === template.id ? template : item)),
    );
    setSelectedTemplateId(null);
  };

  const openTemplate = (template: ShiftReportTemplate) => {
    setSelectedTemplateId(template.id);
    setTemplateDialogMode('edit');
    setTemplateDialogOpen(true);
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

  const copyCompletedReport = async () => {
    if (!completedReport) return;
    try {
      await navigator.clipboard.writeText(completedReport.text);
      setReportCopied(true);
      showSuccessToast('Отчет скопирован');
      window.setTimeout(() => setReportCopied(false), 1500);
    } catch {
      toast.error('Не удалось скопировать отчет');
    }
  };

  return (
    <div aria-busy={loading} className="grid min-w-0 gap-5">
      <Tabs value={isSettingsView ? 'templates' : 'reports'}>
        {isSettingsView && canManageTemplates && (
          <div className="flex justify-end">
            <Button variant="outline" onClick={openCreateTemplate}>
              <CopyPlus className="mr-2 h-4 w-4" />
              Создать шаблон
            </Button>
          </div>
        )}

        {error && (
          <ErrorState
            compact
            message={error}
            onRetry={() => void refresh()}
            title={
              isSettingsView
                ? 'Шаблоны отчетов не загрузились'
                : 'Отчеты смены не загрузились'
            }
          />
        )}

        <TabsContent value="reports">
          <div className="grid gap-4">
            {completedReport && (
              <Card className="min-w-0 border-primary/30">
                <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <CardTitle className="text-lg">Отчет по завершенной смене</CardTitle>
                    <CardDescription>Смена #{completedReport.shiftId}</CardDescription>
                  </div>
                  <Button size="sm" type="button" variant="outline" onClick={() => void copyCompletedReport()}>
                    {reportCopied ? (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    {reportCopied ? 'Скопировано' : 'Скопировать'}
                  </Button>
                </CardHeader>
                <CardContent className="pt-4">
                  <pre className="max-w-full whitespace-pre-wrap break-words rounded-lg bg-muted p-4 font-mono text-sm">
                    {completedReport.text}
                  </pre>
                </CardContent>
              </Card>
            )}
            <Card className="rounded-xl" size="sm">
              <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div
                  className="grid min-w-0 grid-cols-[48px_minmax(0,1fr)] items-center gap-2 sm:w-64"
                  data-testid="shift-report-date-filter"
                >
                  <Label className="text-xs text-muted-foreground">Дата</Label>
                  <ShiftReportDatePicker value={date} onChange={setDate} />
                </div>
                <div
                  className="grid min-w-0 grid-cols-[48px_minmax(0,1fr)] items-center gap-2 sm:w-48"
                  data-testid="shift-report-status-filter"
                >
                  <Label className="text-xs text-muted-foreground">Статус</Label>
                  <Select
                    value={status}
                    onValueChange={(value) => setStatus(value as ShiftReportStatus | 'all')}
                  >
                    <SelectTrigger className="w-full" size="sm">
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
                {reports.map((report) => {
                  const completionBadge = getCompletionBadge(report);
                  const deadlineBadge = getDeadlineBadge(report);

                  return (
                    <Card
                      key={report.id}
                      className="min-w-0 cursor-pointer transition hover:border-primary/50 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      role="button"
                      size="sm"
                      tabIndex={0}
                      onClick={() => openReport(report)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openReport(report);
                        }
                      }}
                    >
                      <CardContent className="grid gap-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="break-words font-semibold">
                              {report.templateSnapshot.name}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span>Смена #{report.shiftId}</span>
                              {report.shift?.adminName && (
                                <span>{report.shift.adminName}</span>
                              )}
                            </div>
                          </div>
                          <Badge variant={statusVariants[report.computedStatus]}>
                            {reportStatusLabels[report.computedStatus]}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge
                            className={completionBadge.className}
                            variant={completionBadge.variant}
                          >
                            {completionBadge.label}
                          </Badge>
                          <Badge variant={deadlineBadge.variant}>
                            {deadlineBadge.label}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="templates">
          <Card>
            <CardHeader>
              <CardTitle>Шаблоны</CardTitle>
            </CardHeader>
            <CardContent>
              {templates.length === 0 ? (
                <EmptyState
                  icon={<ListChecks className="h-4 w-4" />}
                  title="Шаблонов пока нет"
                  description="Создайте первый шаблон и добавьте времена отчетов."
                />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {templates.map((template) => (
                    <Card
                      key={template.id}
                      aria-label={
                        canManageTemplates
                          ? `Открыть шаблон «${template.name}»`
                          : undefined
                      }
                      className={cn(
                        'min-w-0',
                        canManageTemplates &&
                          'cursor-pointer transition hover:border-primary/50 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      )}
                      role={canManageTemplates ? 'button' : undefined}
                      size="sm"
                      tabIndex={canManageTemplates ? 0 : undefined}
                      onClick={() => {
                        if (canManageTemplates) openTemplate(template);
                      }}
                      onKeyDown={(event) => {
                        if (
                          canManageTemplates &&
                          (event.key === 'Enter' || event.key === ' ')
                        ) {
                          event.preventDefault();
                          openTemplate(template);
                        }
                      }}
                    >
                      <CardContent className="grid gap-3">
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <div className="min-w-0 break-words font-semibold">
                              {template.name}
                            </div>
                            <Badge
                              variant={template.status === 'active' ? 'default' : 'outline'}
                            >
                              {template.status === 'active' ? 'Активен' : 'В архиве'}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {getEditableTemplateTimes(template).map((time) => (
                              <Badge key={time} variant="secondary">
                                {time}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        {template.description && (
                          <p className="line-clamp-3 text-sm text-muted-foreground">
                            {template.description}
                          </p>
                        )}
                        {!canManageTemplates ? (
                          <div className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
                            Доступен просмотр настроек.
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <TemplateEditorDialog
        initialSortOrder={templates.length * 10 + 10}
        mode={templateDialogMode}
        onCreated={handleTemplateCreated}
        onOpenChange={setTemplateDialogOpen}
        onSaved={handleTemplateSaved}
        onStatusChanged={handleTemplateStatusChanged}
        open={isSettingsView && templateDialogOpen}
        template={templateDialogMode === 'edit' ? selectedTemplate : null}
      />

      <ShiftReportDialog
        onOpenChange={setReportDialogOpen}
        onUpdated={handleReportUpdated}
        open={!isSettingsView && reportDialogOpen}
        report={selectedReport}
      />
    </div>
  );
}

export function ShiftReportTemplatesSettings() {
  return <ShiftReportsPage view="settings" />;
}
