import {
  Camera,
  ChevronLeft,
  ChevronRight,
  FileImage,
  Loader2,
  Plus,
  ReceiptText,
  Trash2,
  WalletCards,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  cancelShiftCashExpense,
  createShiftCashExpense,
  fetchShiftCashAttachmentBlobUrl,
  getActiveShiftCash,
  removeShiftCashAttachment,
  saveShiftCashOpening,
  uploadShiftCashAttachment,
  type ShiftCashAttachment,
  type ShiftCashBalancePayload,
  type ShiftCashExpense,
  type ShiftCashSummary,
} from '@/api/shift-cash';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import { Badge } from '@/components/ui/badge';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { ErrorState } from '@/components/error-state';
import { canManageShifts } from '@/lib/permissions';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useAuth } from '@/lib/useAuth';
import { cn } from '@/lib/utils';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif';
const IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const IMAGE_EXTENSIONS_TO_MIME = new Map([
  ['gif', 'image/gif'],
  ['heic', 'image/heic'],
  ['heif', 'image/heif'],
  ['jpeg', 'image/jpeg'],
  ['jpg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]);

function formatMoney(value: number) {
  return `${Number(value || 0).toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })} ₽`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(new Date(value));
}

function parseMoney(value: string, label: string) {
  const amount = Number(value.replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label}: укажите сумму от 0 ₽`);
  }
  return Number(amount.toFixed(2));
}

function getImageMimeType(file: File) {
  const mime = file.type.trim().toLowerCase();
  if (IMAGE_MIME_TYPES.has(mime)) return mime;
  return IMAGE_EXTENSIONS_TO_MIME.get(
    file.name.split('.').pop()?.trim().toLowerCase() || '',
  ) || mime;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать фото'));
    reader.readAsDataURL(file);
  });
}

function validateFiles(files: File[]) {
  if (files.length > MAX_ATTACHMENTS) {
    throw new Error(`К одному расходу можно прикрепить до ${MAX_ATTACHMENTS} фото`);
  }
  files.forEach((file) => {
    if (!IMAGE_MIME_TYPES.has(getImageMimeType(file))) {
      throw new Error(`${file.name}: только JPEG, PNG, WEBP, GIF или HEIC`);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${file.name}: фото больше 5 МБ`);
    }
  });
}

function ReceiptThumbnail({
  attachment,
  canRemove,
  onOpen,
  onRemove,
}: {
  attachment: ShiftCashAttachment;
  canRemove: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    void fetchShiftCashAttachmentBlobUrl(attachment.url)
      .then((nextUrl) => {
        if (!active) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        objectUrl = nextUrl;
        setUrl(nextUrl);
      })
      .catch(() => setUrl(''));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.url]);

  return (
    <div className="relative size-20 shrink-0 overflow-hidden rounded-lg border bg-muted/20 sm:size-24">
      <button
        className="block size-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        onClick={onOpen}
      >
        {url ? (
          <img
            alt={attachment.originalName}
            className="h-full w-full object-cover"
            src={url}
            onError={() => setUrl('')}
          />
        ) : (
          <span className="flex h-full items-center justify-center text-muted-foreground">
            <FileImage className="h-5 w-5" />
          </span>
        )}
      </button>
      {canRemove && (
        <Button
          aria-label="Удалить фото чека"
          className="absolute right-1 top-1 bg-background/90"
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function ReceiptLightbox({
  attachments,
  index,
  onClose,
  onIndexChange,
}: {
  attachments: ShiftCashAttachment[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const attachment = attachments[index] || null;
  const [url, setUrl] = useState('');
  const [imageError, setImageError] = useState(false);
  useEffect(() => {
    if (!attachment) return;
    let active = true;
    let objectUrl = '';
    void fetchShiftCashAttachmentBlobUrl(attachment.url)
      .then((nextUrl) => {
        if (!active) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        objectUrl = nextUrl;
        setUrl(nextUrl);
      })
      .catch(() => setImageError(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment]);

  useEffect(() => {
    if (!attachment) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
      if (event.key === 'ArrowRight' && index < attachments.length - 1) {
        onIndexChange(index + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [attachment, attachments.length, index, onIndexChange]);

  return (
    <Dialog open={Boolean(attachment)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden p-2 sm:max-w-[min(960px,calc(100vw-2rem))]">
        <DialogTitle className="sr-only">Фото кассового чека</DialogTitle>
        <DialogDescription className="sr-only">
          Увеличенное фото чека кассового расхода.
        </DialogDescription>
        <div className="relative flex min-h-64 items-center justify-center overflow-hidden rounded-lg bg-black/90">
        {url && !imageError ? (
          <img
            alt={attachment?.originalName || 'Фото чека'}
            className="max-h-[calc(100dvh-5rem)] w-full max-w-full object-contain"
            src={url}
            onError={() => setImageError(true)}
          />
        ) : imageError ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-2 px-12 text-center text-sm text-white/75">
            <FileImage className="h-8 w-8" />
            Это фото не удалось открыть. Остальные снимки доступны.
          </div>
        ) : (
          <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-white/75">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка фото...
          </div>
        )}
        {index > 0 && (
          <Button
            aria-label="Предыдущее фото"
            className="absolute left-2 size-12 rounded-full bg-background/90 shadow-lg sm:left-4"
            size="icon"
            type="button"
            variant="outline"
            onClick={() => onIndexChange(index - 1)}
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
        )}
        {index < attachments.length - 1 && (
          <Button
            aria-label="Следующее фото"
            className="absolute right-2 size-12 rounded-full bg-background/90 shadow-lg sm:right-4"
            size="icon"
            type="button"
            variant="outline"
            onClick={() => onIndexChange(index + 1)}
          >
            <ChevronRight className="h-6 w-6" />
          </Button>
        )}
        <div className="absolute bottom-3 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
          {index + 1} из {attachments.length}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CashMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'negative';
}) {
  return (
    <div className="flex h-full min-h-24 min-w-0 flex-col rounded-lg border bg-background p-3">
      <div className="min-h-8 break-words text-xs leading-4 text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-auto break-words text-lg font-semibold leading-tight tabular-nums',
          tone === 'positive' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'negative' && 'text-destructive',
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function ShiftCashPanel() {
  const { account } = useAuth();
  const [summary, setSummary] = useState<ShiftCashSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingEditing, setOpeningEditing] = useState(false);
  const [openingBanknotes, setOpeningBanknotes] = useState('');
  const [openingCoins, setOpeningCoins] = useState('');
  const [openingComment, setOpeningComment] = useState('');
  const [openingSaving, setOpeningSaving] = useState(false);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseFiles, setExpenseFiles] = useState<File[]>([]);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [cancelExpense, setCancelExpense] = useState<ShiftCashExpense | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [canceling, setCanceling] = useState(false);
  const [selectedGallery, setSelectedGallery] = useState<{
    attachments: ShiftCashAttachment[];
    index: number;
  } | null>(null);
  const [removeAttachmentTarget, setRemoveAttachmentTarget] = useState<{
    attachment: ShiftCashAttachment;
    expenseId: number;
  } | null>(null);
  const [removingAttachment, setRemovingAttachment] = useState(false);

  const applySummary = useCallback((next: ShiftCashSummary) => {
    setSummary(next);
    setError('');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      applySummary(await getActiveShiftCash());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить кассу смены');
    } finally {
      setLoading(false);
    }
  }, [applySummary]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh(['shiftCash', 'shifts', 'finance'], () => {
    void load();
  });

  useEffect(() => {
    const session = summary?.session;
    if (!session?.openingRecordedAt) {
      if (!loading && summary) setOpeningEditing(true);
      return;
    }
    if (!openingEditing) {
      setOpeningBanknotes(String(session.openingBanknotes ?? ''));
      setOpeningCoins(String(session.openingCoins ?? ''));
      setOpeningComment(session.openingComment || '');
    }
  }, [loading, openingEditing, summary]);

  const openingRecorded = Boolean(summary?.session?.openingRecordedAt);
  const canManageAnyExpense = canManageShifts(account?.role);

  const handleOpeningSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setOpeningSaving(true);
    try {
      const next = await saveShiftCashOpening({
        banknotes: parseMoney(openingBanknotes, 'Купюры'),
        coins: parseMoney(openingCoins, 'Мелочь'),
        comment: openingComment.trim() || null,
      });
      applySummary(next);
      setOpeningEditing(false);
      toast.success('Начальный остаток сохранен');
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Не удалось сохранить остаток');
    } finally {
      setOpeningSaving(false);
    }
  };

  const handleExpenseSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setUploadError('');
    setExpenseSaving(true);
    try {
      const amount = parseMoney(expenseAmount, 'Сумма');
      if (amount <= 0) throw new Error('Сумма расхода должна быть больше 0 ₽');
      if (!expenseDescription.trim()) throw new Error('Добавьте описание расхода');
      validateFiles(expenseFiles);
      let next = await createShiftCashExpense({
        amount,
        description: expenseDescription.trim(),
      });
      applySummary(next);

      const expenseId = next.createdExpenseId;
      let failedUpload = false;
      if (expenseFiles.length > 0 && expenseId) {
        for (const file of expenseFiles) {
          try {
            const uploaded = await uploadShiftCashAttachment(expenseId, {
              data: await readFileAsDataUrl(file),
              fileName: file.name,
              mimeType: getImageMimeType(file) as
                | 'image/gif'
                | 'image/heic'
                | 'image/heif'
                | 'image/jpeg'
                | 'image/png'
                | 'image/webp',
            });
            next = {
              ...next,
              expenses: next.expenses.map((expense) =>
                expense.id === uploaded.id ? uploaded : expense,
              ),
            };
            applySummary(next);
          } catch (photoError) {
            const message = photoError instanceof Error
              ? photoError.message
              : 'Расход сохранен, но фото не загрузилось';
            setUploadError(`Расход сохранен. Фото «${file.name}» не загрузилось: ${message}`);
            toast.error('Расход сохранен, но часть фото не загрузилась');
            failedUpload = true;
            break;
          }
        }
      }

      setExpenseAmount('');
      setExpenseDescription('');
      setExpenseFiles([]);
      toast.success('Расход добавлен в кассу и P&L');
      if (!failedUpload) setExpenseDialogOpen(false);
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Не удалось добавить расход');
    } finally {
      setExpenseSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelExpense || !cancelReason.trim()) return;
    setCanceling(true);
    try {
      applySummary(await cancelShiftCashExpense(cancelExpense.id, cancelReason.trim()));
      setCancelExpense(null);
      setCancelReason('');
      toast.success('Расход отменен, история сохранена');
    } catch (cancelError) {
      toast.error(cancelError instanceof Error ? cancelError.message : 'Не удалось отменить расход');
    } finally {
      setCanceling(false);
    }
  };

  const handleRemoveAttachment = async () => {
    if (!removeAttachmentTarget) return;
    setRemovingAttachment(true);
    try {
      const updated = await removeShiftCashAttachment(
        removeAttachmentTarget.expenseId,
        removeAttachmentTarget.attachment.id,
      );
      if (summary) {
        applySummary({
          ...summary,
          expenses: summary.expenses.map((expense) =>
            expense.id === updated.id ? updated : expense,
          ),
        });
      }
      setRemoveAttachmentTarget(null);
      toast.success('Фото удалено');
    } catch (removeError) {
      toast.error(removeError instanceof Error ? removeError.message : 'Не удалось удалить фото');
    } finally {
      setRemovingAttachment(false);
    }
  };

  const removeAttachmentAction: ConfirmAction | null = removeAttachmentTarget
    ? {
        confirmLabel: 'Удалить фото',
        description: `Фото «${removeAttachmentTarget.attachment.originalName}» будет удалено без возможности восстановления.`,
        isDestructive: true,
        title: 'Удалить фото чека?',
      }
    : null;

  const sortedExpenses = useMemo(
    () => [...(summary?.expenses || [])].sort(
      (left, right) => new Date(right.spentAt).getTime() - new Date(left.spentAt).getTime(),
    ),
    [summary?.expenses],
  );

  if (loading && !summary) {
    return (
      <Card className="min-h-[320px]">
        <CardHeader><Skeleton className="h-7 w-48" /></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-20" />)}
        </CardContent>
      </Card>
    );
  }

  if (error && !summary) {
    return (
      <Card>
        <CardContent className="pt-6">
          <ErrorState
            compact
            message={error}
            onRetry={() => void load()}
            title="Касса смены не загрузилась"
          />
        </CardContent>
      </Card>
    );
  }

  if (summary && !summary.shift) {
    return (
      <Card className="min-h-64 border-dashed">
        <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 px-4 text-center">
          <WalletCards className="h-9 w-9 text-muted-foreground" />
          <div>
            <h2 className="font-semibold">Активной смены нет</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Начните смену в разделе «Мотивация», чтобы открыть кассу.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card aria-busy={loading} className="min-w-0 overflow-hidden border-primary/25">
        <CardHeader className="border-b pb-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-xl">
              <WalletCards className="h-5 w-5 text-primary" /> Касса
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Купюры, мелочь, наличная выручка и расходы текущей смены.
            </p>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 pt-5">
          {error && (
            <ErrorState compact message={error} onRetry={() => void load()} title="Не удалось обновить кассу" />
          )}

          <div className="grid auto-rows-fr grid-cols-2 gap-2 lg:grid-cols-5">
            <CashMetric label="На начало" value={formatMoney(summary?.session?.openingTotal || 0)} />
            <CashMetric label="Наличная выручка" value={formatMoney(summary?.cashSales || 0)} tone="positive" />
            <CashMetric label="Расходы" value={formatMoney(summary?.activeExpensesTotal || 0)} tone="negative" />
            <CashMetric label="Ожидаемый остаток" value={formatMoney(summary?.expectedClosingCash || 0)} />
            <CashMetric
              label="Факт / расхождение"
              value={summary?.session?.closingTotal == null
                ? 'При закрытии'
                : `${formatMoney(summary.session.closingTotal)} / ${formatMoney(summary.session.variance || 0)}`}
              tone={(summary?.session?.variance || 0) === 0 ? 'default' : 'negative'}
            />
          </div>

          <section className="rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Остаток на начало смены</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Купюры и мелочь считаются отдельно, затем складываются в общий остаток.
                </p>
              </div>
              {openingRecorded && !openingEditing && (
                <Button size="sm" type="button" variant="outline" onClick={() => setOpeningEditing(true)}>
                  Изменить
                </Button>
              )}
            </div>

            {openingRecorded && !openingEditing ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <CashMetric label="Купюры" value={formatMoney(summary?.session?.openingBanknotes || 0)} />
                <CashMetric label="Мелочь" value={formatMoney(summary?.session?.openingCoins || 0)} />
                <div className="rounded-lg border p-3 text-sm">
                  <div className="text-xs text-muted-foreground">Зафиксировал</div>
                  <div className="mt-1 font-medium">
                    {summary?.session?.openingRecordedBy?.name || 'Сотрудник'} · {formatDateTime(summary?.session?.openingRecordedAt)}
                  </div>
                  {summary?.session?.openingComment && (
                    <div className="mt-1 break-words text-muted-foreground">
                      {summary.session.openingComment}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <form className="mt-4 grid gap-3" onSubmit={(event) => void handleOpeningSubmit(event)}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="shift-cash-opening-banknotes">Купюры, ₽</Label>
                    <Input
                      id="shift-cash-opening-banknotes"
                      inputMode="decimal"
                      min="0"
                      placeholder="34 000"
                      step="0.01"
                      type="number"
                      value={openingBanknotes}
                      onChange={(event) => setOpeningBanknotes(event.currentTarget.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="shift-cash-opening-coins">Мелочь, ₽</Label>
                    <Input
                      id="shift-cash-opening-coins"
                      inputMode="decimal"
                      min="0"
                      placeholder="850"
                      step="0.01"
                      type="number"
                      value={openingCoins}
                      onChange={(event) => setOpeningCoins(event.currentTarget.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="shift-cash-opening-comment">Комментарий по мелочи</Label>
                  <textarea
                    id="shift-cash-opening-comment"
                    className="min-h-20 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    maxLength={1000}
                    placeholder="Например: пересчитана разменная монета"
                    value={openingComment}
                    onChange={(event) => setOpeningComment(event.currentTarget.value)}
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  {openingRecorded && (
                    <Button type="button" variant="outline" onClick={() => setOpeningEditing(false)}>
                      Отмена
                    </Button>
                  )}
                  <Button disabled={openingSaving} type="submit">
                    {openingSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Зафиксировать остаток
                  </Button>
                </div>
              </form>
            )}
          </section>

          <section className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="font-semibold">Добавить расход из кассы</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Расход сразу попадет в P&amp;L. Фото чека можно снять камерой телефона.
              </p>
            </div>
            <div className="shrink-0">
              <Button
                className="w-full sm:w-auto"
                disabled={!openingRecorded}
                type="button"
                onClick={() => {
                  setUploadError('');
                  setExpenseDialogOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Добавить расход
              </Button>
              {!openingRecorded && (
                <p className="mt-2 max-w-64 text-xs text-muted-foreground sm:text-right">
                  Сначала зафиксируйте остаток на начало смены.
                </p>
              )}
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">Расходы смены</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Активные расходы: {formatMoney(summary?.activeExpensesTotal || 0)}
                </p>
              </div>
              <Badge variant="outline">{sortedExpenses.length} записей</Badge>
            </div>
            {sortedExpenses.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                Расходов из кассы пока нет.
              </div>
            ) : (
              <div className="mt-3 grid gap-3">
                {sortedExpenses.map((expense) => {
                  const isCanceled = expense.status === 'canceled';
                  const canChange = !isCanceled && (
                    canManageAnyExpense || Number(expense.createdByAccountId) === Number(account?.id)
                  );
                  return (
                    <article
                      className={cn(
                        'min-w-0 rounded-xl border p-4',
                        isCanceled && 'bg-muted/40 opacity-75',
                      )}
                      key={expense.id}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <ReceiptText className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className={cn('break-words font-medium', isCanceled && 'line-through')}>
                              {expense.description}
                            </span>
                            {isCanceled && <Badge variant="secondary">Отменен</Badge>}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{formatDateTime(expense.spentAt)}</span>
                            <span>{expense.createdBy?.name || 'Сотрудник'}</span>
                          </div>
                          {isCanceled && (
                            <div className="mt-2 break-words text-sm text-muted-foreground">
                              Причина: {expense.cancelReason} · {expense.canceledBy?.name || 'Сотрудник'}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end">
                          <div className={cn('text-xl font-bold tabular-nums', !isCanceled && 'text-destructive')}>
                            −{formatMoney(expense.amount)}
                          </div>
                          {canChange && (
                            <Button
                              size="sm"
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setCancelReason('');
                                setCancelExpense(expense);
                              }}
                            >
                              Отменить
                            </Button>
                          )}
                        </div>
                      </div>
                      {expense.attachments.length > 0 && (
                        <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                          {expense.attachments.map((attachment, attachmentIndex) => (
                            <ReceiptThumbnail
                              attachment={attachment}
                              canRemove={canChange}
                              key={attachment.id}
                              onOpen={() => setSelectedGallery({
                                attachments: expense.attachments,
                                index: attachmentIndex,
                              })}
                              onRemove={() => setRemoveAttachmentTarget({ attachment, expenseId: expense.id })}
                            />
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </CardContent>
      </Card>

      <Dialog
        open={expenseDialogOpen}
        onOpenChange={(open) => {
          if (!expenseSaving) setExpenseDialogOpen(open);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
          <DialogHeader>
            <DialogTitle>Добавить расход из кассы</DialogTitle>
            <DialogDescription>
              Укажите сумму и назначение. Связанный расход P&amp;L создастся
              автоматически.
            </DialogDescription>
          </DialogHeader>
          <form
            aria-busy={expenseSaving}
            className="grid min-w-0 gap-4"
            onSubmit={(event) => void handleExpenseSubmit(event)}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="shift-cash-expense-amount">Сумма, ₽</Label>
              <Input
                id="shift-cash-expense-amount"
                disabled={expenseSaving}
                inputMode="decimal"
                min="0.01"
                placeholder="900"
                step="0.01"
                type="number"
                value={expenseAmount}
                onChange={(event) => setExpenseAmount(event.currentTarget.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="shift-cash-expense-description">Описание</Label>
              <textarea
                id="shift-cash-expense-description"
                className="min-h-24 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                disabled={expenseSaving}
                maxLength={1000}
                placeholder="Например: сборка подставки на ресепшене"
                value={expenseDescription}
                onChange={(event) => setExpenseDescription(event.currentTarget.value)}
              />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label>Фото чеков · {expenseFiles.length}/{MAX_ATTACHMENTS}</Label>
              <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/20 px-4 py-5 text-center text-sm transition-colors hover:border-primary/60 hover:bg-primary/5">
                <Camera className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium">Снять фото или выбрать файлы</span>
                <span className="text-xs text-muted-foreground">
                  JPEG, PNG, WEBP, GIF или HEIC, до 5 МБ каждое
                </span>
                <input
                  accept={IMAGE_ACCEPT}
                  capture="environment"
                  className="sr-only"
                  disabled={expenseSaving}
                  multiple
                  type="file"
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files || []);
                    try {
                      validateFiles(files);
                      setExpenseFiles(files);
                    } catch (validationError) {
                      toast.error(
                        validationError instanceof Error
                          ? validationError.message
                          : 'Проверьте фото',
                      );
                    }
                    event.currentTarget.value = '';
                  }}
                />
              </label>
              {expenseFiles.length > 0 && (
                <div className="flex min-w-0 flex-wrap gap-2">
                  {expenseFiles.map((file) => (
                    <Badge
                      className="max-w-full"
                      key={`${file.name}-${file.size}`}
                      variant="outline"
                    >
                      <span className="max-w-[min(240px,70vw)] truncate">{file.name}</span>
                    </Badge>
                  ))}
                </div>
              )}
              {uploadError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {uploadError}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                disabled={expenseSaving}
                type="button"
                variant="outline"
                onClick={() => setExpenseDialogOpen(false)}
              >
                Отмена
              </Button>
              <Button disabled={expenseSaving} type="submit">
                {expenseSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Добавить расход
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cancelExpense)} onOpenChange={(open) => !open && setCancelExpense(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Отменить кассовый расход?</DialogTitle>
            <DialogDescription>
              Запись останется в истории, а связанный расход будет исключен из P&amp;L.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="shift-cash-cancel-reason">Причина отмены</Label>
            <textarea
              id="shift-cash-cancel-reason"
              className="min-h-24 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              maxLength={1000}
              placeholder="Почему расход нужно отменить"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.currentTarget.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelExpense(null)}>
              Не отменять
            </Button>
            <Button disabled={!cancelReason.trim() || canceling} type="button" variant="destructive" onClick={() => void handleCancel()}>
              {canceling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Отменить расход
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiptLightbox
        attachments={selectedGallery?.attachments || []}
        index={selectedGallery?.index || 0}
        key={selectedGallery?.attachments[selectedGallery.index]?.id || 'closed'}
        onClose={() => setSelectedGallery(null)}
        onIndexChange={(index) => {
          setSelectedGallery((current) => (current ? { ...current, index } : current));
        }}
      />

      <ConfirmActionDialog
        action={removeAttachmentAction}
        loading={removingAttachment}
        onCancel={() => setRemoveAttachmentTarget(null)}
        onConfirm={handleRemoveAttachment}
      />
    </>
  );
}

export function ShiftCashCloseDialog({
  loading: closing,
  onClose,
  onConfirm,
  open,
}: {
  loading: boolean;
  onClose: () => void;
  onConfirm: (payload: ShiftCashBalancePayload, summary: ShiftCashSummary) => Promise<boolean>;
  open: boolean;
}) {
  const [summary, setSummary] = useState<ShiftCashSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [banknotes, setBanknotes] = useState('');
  const [coins, setCoins] = useState('');
  const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSummary(await getActiveShiftCash());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось обновить кассу');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setBanknotes('');
    setCoins('');
    setComment('');
    void load();
  }, [load, open]);

  const hasActualCash = banknotes !== '' && coins !== '';
  const actualTotal = (Number(banknotes.replace(',', '.')) || 0) +
    (Number(coins.replace(',', '.')) || 0);
  const variance = hasActualCash
    ? Number((actualTotal - Number(summary?.expectedClosingCash || 0)).toFixed(2))
    : null;
  const needsComment = variance !== null && Math.abs(variance) >= 0.01;
  const canSubmit = Boolean(
    summary?.session?.openingRecordedAt &&
    hasActualCash &&
    (!needsComment || comment.trim()),
  );

  const handleConfirm = async () => {
    if (!summary || !canSubmit) return;
    try {
      const success = await onConfirm(
        {
          banknotes: parseMoney(banknotes, 'Купюры'),
          coins: parseMoney(coins, 'Мелочь'),
          comment: comment.trim() || null,
        },
        summary,
      );
      if (success) onClose();
    } catch (confirmError) {
      toast.error(confirmError instanceof Error ? confirmError.message : 'Не удалось закрыть смену');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !closing && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:max-w-[720px] sm:p-6">
        <DialogHeader>
          <DialogTitle>Кассовая сверка перед закрытием</DialogTitle>
          <DialogDescription>
            Пересчитайте купюры и мелочь. Setly сравнит факт с ожидаемым остатком.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid min-h-52 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => <Skeleton className="h-20" key={index} />)}
          </div>
        ) : error ? (
          <ErrorState compact message={error} onRetry={() => void load()} title="Касса не обновилась" />
        ) : !summary?.session?.openingRecordedAt ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
            Сначала закройте окно и зафиксируйте остаток на начало смены.
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <CashMetric label="Начало" value={formatMoney(summary.session.openingTotal || 0)} />
              <CashMetric label="Наличные продажи" value={formatMoney(summary.cashSales)} tone="positive" />
              <CashMetric label="Расходы" value={formatMoney(summary.activeExpensesTotal)} tone="negative" />
              <CashMetric label="Ожидается" value={formatMoney(summary.expectedClosingCash)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="shift-cash-closing-banknotes">Фактические купюры, ₽</Label>
                <Input
                  id="shift-cash-closing-banknotes"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  type="number"
                  value={banknotes}
                  onChange={(event) => setBanknotes(event.currentTarget.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="shift-cash-closing-coins">Фактическая мелочь, ₽</Label>
                <Input
                  id="shift-cash-closing-coins"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  type="number"
                  value={coins}
                  onChange={(event) => setCoins(event.currentTarget.value)}
                />
              </div>
            </div>
            {hasActualCash ? (
              <div className={cn(
                'rounded-lg border p-4',
                needsComment ? 'border-destructive/40 bg-destructive/5' : 'border-emerald-500/30 bg-emerald-500/5',
              )}>
                <div className="text-xs text-muted-foreground">Расхождение</div>
                <div className={cn('mt-1 text-2xl font-bold tabular-nums', needsComment ? 'text-destructive' : 'text-emerald-600')}>
                  {Number(variance) > 0 ? '+' : ''}{formatMoney(Number(variance))}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {needsComment ? 'Объясните недостачу или излишек перед закрытием.' : 'Фактический остаток совпадает с ожидаемым.'}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Заполните купюры и мелочь, чтобы увидеть сверку.
              </div>
            )}
            {hasActualCash && (
              <div className="grid gap-1.5">
                <Label htmlFor="shift-cash-closing-comment">
                  Комментарий {needsComment ? '· обязательно' : '· необязательно'}
                </Label>
                <textarea
                  id="shift-cash-closing-comment"
                  className="min-h-24 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  maxLength={1000}
                  placeholder={needsComment ? 'Укажите причину расхождения' : 'Комментарий по кассе'}
                  value={comment}
                  onChange={(event) => setComment(event.currentTarget.value)}
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button disabled={closing} type="button" variant="outline" onClick={onClose}>
            Вернуться к смене
          </Button>
          <Button disabled={!canSubmit || closing || loading || Boolean(error)} type="button" variant="destructive" onClick={() => void handleConfirm()}>
            {closing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Сверить кассу и завершить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
