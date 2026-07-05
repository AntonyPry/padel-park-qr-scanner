import {
  CheckCircle2,
  Download,
  FileImage,
  Loader2,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchShiftReportAttachmentBlobUrl,
  removeShiftReportAttachment,
  saveShiftReportDraft,
  submitShiftReport,
  uploadShiftReportAttachment,
  type ShiftReport,
  type ShiftReportAnswer,
  type ShiftReportSaveAnswer,
} from '@/api/shift-reports';
import { Badge } from '@/components/ui/badge';
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
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const statusLabels: Record<string, string> = {
  draft: 'Черновик',
  overdue: 'Просрочен',
  pending: 'Ожидается',
  submitted: 'Сдан',
};

const statusVariants: Record<string, 'default' | 'destructive' | 'outline' | 'secondary'> = {
  draft: 'secondary',
  overdue: 'destructive',
  pending: 'outline',
  submitted: 'default',
};
const MAX_ATTACHMENTS_PER_ANSWER = 10;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function showSuccessToast(title: string) {
  toast.show({ title, variant: 'success' });
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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

function answerToPayload(answer: ShiftReportAnswer): ShiftReportSaveAnswer {
  return {
    booleanValue: answer.booleanValue,
    id: answer.id,
    numberValue: answer.numberValue,
    textValue: answer.textValue || '',
  };
}

function AttachmentPreview({
  attachment,
  canEdit,
  onOpen,
  onRemove,
}: {
  attachment: ShiftReportAnswer['attachments'][number];
  canEdit: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let revokedUrl = '';
    let mounted = true;
    fetchShiftReportAttachmentBlobUrl(attachment.url)
      .then((blobUrl) => {
        if (!mounted) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        revokedUrl = blobUrl;
        setUrl(blobUrl);
      })
      .catch(() => setUrl(''));

    return () => {
      mounted = false;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [attachment.url]);

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-muted/30 p-2">
      <button
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        onClick={onOpen}
      >
        {url ? (
          <img
            alt={attachment.originalName}
            className="h-16 w-16 shrink-0 rounded-md object-cover"
            src={url}
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
            <FileImage className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{attachment.originalName}</div>
          <div className="text-xs text-muted-foreground">
            {(attachment.size / 1024).toFixed(0)} КБ
          </div>
        </div>
      </button>
      {canEdit && (
        <Button size="icon-sm" variant="ghost" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Удалить фото</span>
        </Button>
      )}
    </div>
  );
}

function AttachmentLightbox({
  attachment,
  onClose,
}: {
  attachment: ShiftReportAnswer['attachments'][number] | null;
  onClose: () => void;
}) {
  const [blob, setBlob] = useState<{ attachmentId: string; url: string } | null>(null);

  useEffect(() => {
    if (!attachment) return;

    let revokedUrl = '';
    let mounted = true;
    fetchShiftReportAttachmentBlobUrl(attachment.url)
      .then((blobUrl) => {
        if (!mounted) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        revokedUrl = blobUrl;
        setBlob({ attachmentId: attachment.id, url: blobUrl });
      })
      .catch(() => {});

    return () => {
      mounted = false;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [attachment]);

  if (!attachment) return null;
  const url = blob?.attachmentId === attachment.id ? blob.url : '';

  const download = () => {
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.originalName || 'shift-report-photo';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <Dialog
      open={Boolean(attachment)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-[min(1280px,calc(100vw-2rem))] gap-3 p-2 sm:max-w-[min(1280px,calc(100vw-2rem))]">
        <DialogTitle className="sr-only">
          {attachment.originalName || 'Фото отчета смены'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Увеличенное фото, прикрепленное к пункту отчета смены.
        </DialogDescription>
        <div className="flex justify-end pr-9">
          <Button
            disabled={!url}
            size="sm"
            type="button"
            variant="secondary"
            onClick={download}
          >
            <Download className="mr-2 h-4 w-4" />
            Скачать
          </Button>
        </div>
        {url ? (
          <div className="max-h-[calc(100dvh-7rem)] overflow-auto rounded-lg">
            <img
              alt={attachment.originalName}
              className="w-full min-w-[720px] max-w-none rounded-lg object-contain md:min-w-0"
              src={url}
            />
          </div>
        ) : (
          <div className="flex min-h-48 items-center justify-center gap-2 rounded-lg bg-muted/30 px-4 py-3 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка фото...
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function canAttachPhoto(answer: ShiftReportAnswer) {
  return Boolean(answer.photoRequired);
}

export function ShiftReportDialog({
  onOpenChange,
  onUpdated,
  open,
  report,
}: {
  onOpenChange: (open: boolean) => void;
  onUpdated: (report: ShiftReport) => void;
  open: boolean;
  report: ShiftReport | null;
}) {
  const [answers, setAnswers] = useState<ShiftReportAnswer[]>([]);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingAnswerId, setUploadingAnswerId] = useState<number | null>(null);
  const [draggingAnswerId, setDraggingAnswerId] = useState<number | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<number, string>>({});
  const [selectedAttachment, setSelectedAttachment] = useState<
    ShiftReportAnswer['attachments'][number] | null
  >(null);
  const canEdit = Boolean(report && report.computedStatus !== 'submitted');

  useEffect(() => {
    setAnswers(report?.answers || []);
    setComment(report?.comment || '');
    setSelectedAttachment(null);
  }, [report]);

  useEffect(() => {
    if (!open) setSelectedAttachment(null);
  }, [open]);

  const payload = useMemo(() => answers.map(answerToPayload), [answers]);

  if (!report) return null;
  const reportCommentInputId = `shift-report-${report.id}-comment`;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setSelectedAttachment(null);
    onOpenChange(nextOpen);
  };

  const updateAnswer = (answerId: number, patch: Partial<ShiftReportAnswer>) => {
    setAnswers((current) =>
      current.map((answer) =>
        answer.id === answerId ? { ...answer, ...patch } : answer,
      ),
    );
  };

  const replaceAnswer = (nextAnswer: ShiftReportAnswer) => {
    setAnswers((current) =>
      current.map((answer) =>
        answer.id === nextAnswer.id
          ? { ...answer, attachments: nextAnswer.attachments }
          : answer,
      ),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await saveShiftReportDraft(report.id, payload, comment);
      onUpdated(updated);
      showSuccessToast('Черновик сохранен');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить отчет');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const updated = await submitShiftReport(report.id, payload, comment);
      onUpdated(updated);
      showSuccessToast('Отчет сдан');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сдать отчет');
    } finally {
      setSaving(false);
    }
  };

  const validateFiles = (answer: ShiftReportAnswer, files: File[]) => {
    const errors: string[] = [];
    if (answer.attachments.length + files.length > MAX_ATTACHMENTS_PER_ANSWER) {
      return {
        errors: [`Можно прикрепить до ${MAX_ATTACHMENTS_PER_ANSWER} фото к одному пункту`],
        files: [],
      };
    }

    const validFiles = files.filter((file) => {
      if (!IMAGE_MIME_TYPES.has(file.type)) {
        errors.push(`${file.name}: только JPEG, PNG, WEBP или GIF`);
        return false;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        errors.push(`${file.name}: файл больше 5 МБ`);
        return false;
      }
      return true;
    });

    return { errors, files: validFiles };
  };

  const handleFiles = async (answer: ShiftReportAnswer, selectedFiles: File[]) => {
    if (selectedFiles.length === 0) return;
    const validation = validateFiles(answer, selectedFiles);
    setUploadErrors((current) => ({
      ...current,
      [answer.id]: validation.errors.join('\n'),
    }));
    if (validation.files.length === 0) return;

    setUploadingAnswerId(answer.id);
    try {
      for (const file of validation.files) {
        const data = await readFileAsDataUrl(file);
        const updatedAnswer = await uploadShiftReportAttachment(report.id, answer.id, {
          data,
          fileName: file.name,
          mimeType: file.type,
        });
        replaceAnswer(updatedAnswer);
      }
      showSuccessToast(
        validation.files.length === 1 ? 'Фото загружено' : 'Фото загружены',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить фото';
      setUploadErrors((current) => ({ ...current, [answer.id]: message }));
      toast.error(message);
    } finally {
      setUploadingAnswerId(null);
    }
  };

  const handleRemoveAttachment = async (answerId: number, attachmentId: string) => {
    try {
      const updatedAnswer = await removeShiftReportAttachment(
        report.id,
        answerId,
        attachmentId,
      );
      replaceAnswer(updatedAnswer);
      showSuccessToast('Фото удалено');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось удалить фото');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:max-w-[880px] sm:p-6"
        onEscapeKeyDown={(event) => {
          if (selectedAttachment) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (selectedAttachment) event.preventDefault();
        }}
      >
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-xl">
                {report.templateSnapshot.name}
              </DialogTitle>
              <DialogDescription className="mt-1">
                Дедлайн: {formatDateTime(report.deadlineAt)}
                {report.submittedAt ? ` • сдан: ${formatDateTime(report.submittedAt)}` : ''}
              </DialogDescription>
            </div>
            <Badge variant={statusVariants[report.computedStatus] || 'outline'}>
              {statusLabels[report.computedStatus] || report.computedStatus}
            </Badge>
          </div>
        </DialogHeader>

        {report.templateSnapshot.description && (
          <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm text-foreground">
            {report.templateSnapshot.description}
          </div>
        )}

        <div className="grid gap-3">
          {answers.map((answer) => {
            const isUploading = uploadingAnswerId === answer.id;
            const isDragging = draggingAnswerId === answer.id;
            const uploadError = uploadErrors[answer.id] || '';
            const canUploadMore = answer.attachments.length < MAX_ATTACHMENTS_PER_ANSWER;
            const textValue = answer.textValue?.trim();
            const numberValue =
              answer.numberValue === null || answer.numberValue === undefined
                ? ''
                : String(answer.numberValue);

            return (
              <section
                key={answer.id}
                className="rounded-lg border bg-background p-3"
              >
                {answer.itemType === 'checkbox' ? (
                  canEdit ? (
                    <Label className="flex min-h-10 items-start gap-3 rounded-md border px-3 py-2 text-sm font-medium">
                      <input
                        checked={Boolean(answer.booleanValue)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                        type="checkbox"
                        onChange={(event) =>
                          updateAnswer(answer.id, {
                            booleanValue: event.currentTarget.checked,
                          })
                        }
                      />
                      <span>{answer.itemLabel}</span>
                    </Label>
                  ) : (
                    <div className="flex min-h-10 items-start gap-3 rounded-md border px-3 py-2 text-sm font-medium">
                      <span
                        className={cn(
                          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                          answer.booleanValue
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/50',
                        )}
                      >
                        {answer.booleanValue && <CheckCircle2 className="h-3 w-3" />}
                      </span>
                      <span>{answer.itemLabel}</span>
                    </div>
                  )
                ) : (
                  <div className="grid gap-2">
                    <div className="font-medium">{answer.itemLabel}</div>
                    {answer.itemType === 'number' ? (
                      canEdit ? (
                        <Input
                          inputMode="decimal"
                          value={answer.numberValue ?? ''}
                          onChange={(event) =>
                            updateAnswer(answer.id, {
                              numberValue:
                                event.currentTarget.value === ''
                                  ? null
                                  : Number(event.currentTarget.value),
                            })
                          }
                        />
                      ) : (
                        <div className="min-h-10 rounded-md border px-3 py-2 text-sm text-foreground">
                          {numberValue || 'Не заполнено'}
                        </div>
                      )
                    ) : canEdit ? (
                      <textarea
                        className="min-h-24 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        value={answer.textValue || ''}
                        onChange={(event) =>
                          updateAnswer(answer.id, {
                            textValue: event.currentTarget.value,
                          })
                        }
                      />
                    ) : (
                      <div className="min-h-16 whitespace-pre-wrap rounded-md border px-3 py-2 text-sm text-foreground">
                        {textValue || 'Не заполнено'}
                      </div>
                    )}
                  </div>
                )}

                {canAttachPhoto(answer) && (
                  <div className="mt-3 grid gap-2">
                    {(canEdit || answer.attachments.length > 0) && (
                      <Label className="text-xs text-muted-foreground">
                        Фото · {answer.attachments.length}/{MAX_ATTACHMENTS_PER_ANSWER}
                      </Label>
                    )}
                    {canEdit && (
                      <label
                        className={cn(
                          'flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 px-4 py-5 text-center text-sm transition-colors',
                          'hover:border-primary/60 hover:bg-primary/5',
                          isDragging && 'border-primary bg-primary/10',
                          (isUploading || !canUploadMore) && 'pointer-events-none opacity-60',
                        )}
                        onDragEnter={(event) => {
                          event.preventDefault();
                          if (canUploadMore) setDraggingAnswerId(answer.id);
                        }}
                        onDragLeave={(event) => {
                          event.preventDefault();
                          setDraggingAnswerId((current) =>
                            current === answer.id ? null : current,
                          );
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          setDraggingAnswerId(null);
                          if (!canUploadMore) return;
                          void handleFiles(answer, Array.from(event.dataTransfer.files));
                        }}
                      >
                        {isUploading ? (
                          <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        ) : (
                          <FileImage className="h-5 w-5 text-muted-foreground" />
                        )}
                        <span className="font-medium">
                          {isUploading
                            ? 'Загрузка...'
                            : canUploadMore
                              ? 'Перетащите фото сюда или выберите файл'
                              : 'Достигнут лимит фото'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          JPEG, PNG, WEBP или GIF, до 5 МБ каждое
                        </span>
                        <input
                          multiple
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          className="sr-only"
                          disabled={isUploading || !canUploadMore}
                          type="file"
                          onChange={(event) => {
                            void handleFiles(
                              answer,
                              Array.from(event.currentTarget.files || []),
                            );
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>
                    )}
                    {uploadError && (
                      <div className="whitespace-pre-line rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {uploadError}
                      </div>
                    )}
                    {answer.attachments.length > 0 && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {answer.attachments.map((attachment) => (
                          <AttachmentPreview
                            key={attachment.id}
                            attachment={attachment}
                            canEdit={canEdit}
                            onOpen={() => setSelectedAttachment(attachment)}
                            onRemove={() =>
                              void handleRemoveAttachment(answer.id, attachment.id)
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {(canEdit || comment.trim()) && (
          <div className="grid gap-2">
            <Label htmlFor={reportCommentInputId}>Комментарий к отчету</Label>
            {canEdit ? (
              <textarea
                id={reportCommentInputId}
                className="min-h-20 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                placeholder="Необязательный комментарий по смене"
                value={comment}
                onChange={(event) => setComment(event.currentTarget.value)}
              />
            ) : (
              <div className="min-h-12 whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm text-foreground">
                {comment}
              </div>
            )}
          </div>
        )}

        {report.submittedAt && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Сдан: {formatDateTime(report.submittedAt)}
          </div>
        )}

        <DialogFooter>
          {canEdit ? (
            <>
              <Button variant="outline" disabled={saving} onClick={() => void handleSave()}>
                <Save className="mr-2 h-4 w-4" />
                Черновик
              </Button>
              <Button disabled={saving} onClick={() => void handleSubmit()}>
                <Send className="mr-2 h-4 w-4" />
                Сдать
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      {selectedAttachment && (
        <AttachmentLightbox
          attachment={selectedAttachment}
          onClose={() => setSelectedAttachment(null)}
        />
      )}
    </Dialog>
  );
}
