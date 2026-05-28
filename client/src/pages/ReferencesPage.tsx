import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Archive,
  ArchiveRestore,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import { DataTable } from '@/components/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  createReference,
  deleteArchivedReference,
  listReferences,
  updateReference,
  updateReferenceStatus,
} from '@/api/references';
import { queryKeys } from '@/api/query-keys';
import { getApiErrorMessage } from '@/lib/api';
import { canManageReferences } from '@/lib/permissions';
import type {
  ReferenceItem,
  ReferenceStatus,
  ReferenceType,
} from '@/lib/references';
import { useAuth } from '@/lib/useAuth';

const REFERENCE_TABS: Array<{
  type: ReferenceType;
  title: string;
  description: string;
  createLabel: string;
}> = [
  {
    type: 'client-sources',
    title: 'Источники клиентов',
    description: 'Откуда клиент пришел: ресепшн, рекомендации, соцсети, сайт.',
    createLabel: 'Источник',
  },
  {
    type: 'visit-categories',
    title: 'Категории визитов',
    description: 'Цели визита, которые администратор отмечает при входе.',
    createLabel: 'Категория',
  },
];

type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<void>;
};

const referenceFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Название должно быть не короче 2 символов'),
  sortOrder: z
    .string()
    .trim()
    .refine((value) => !value || /^\d+$/.test(value), {
      message: 'Порядок должен быть целым числом',
    }),
});

type ReferenceFormValues = z.infer<typeof referenceFormSchema>;

const EMPTY_FORM: ReferenceFormValues = {
  name: '',
  sortOrder: '',
};

function getStatusBadgeClass(status: ReferenceStatus) {
  if (status === 'active') {
    return 'bg-green-100 text-green-800 border-transparent dark:bg-green-900/30 dark:text-green-300';
  }
  return 'bg-muted text-muted-foreground';
}

export default function ReferencesPage() {
  const { account } = useAuth();
  const queryClient = useQueryClient();
  const canEditReferences = canManageReferences(account?.role);
  const [activeType, setActiveType] = useState<ReferenceType>('client-sources');
  const [status, setStatus] = useState<ReferenceStatus>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ReferenceItem | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);
  const referenceForm = useForm<ReferenceFormValues>({
    defaultValues: EMPTY_FORM,
    resolver: zodResolver(referenceFormSchema),
  });

  const currentTab = REFERENCE_TABS.find((tab) => tab.type === activeType)!;
  const referencesQuery = useQuery({
    queryFn: () => listReferences(activeType, status),
    queryKey: queryKeys.references.list(activeType, status),
  });
  const items = referencesQuery.data || [];
  const loading = referencesQuery.isLoading || referencesQuery.isFetching;
  const referenceErrorMessage = referencesQuery.isError
    ? getApiErrorMessage(referencesQuery.error, 'Не удалось загрузить справочник')
    : null;
  const refreshReferences = () => referencesQuery.refetch();
  const invalidateReferences = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.references.all });
  const saveReferenceMutation = useMutation({
    mutationFn: (payload: {
      id?: number;
      type: ReferenceType;
      values: { name: string; sortOrder?: number };
    }) =>
      payload.id
        ? updateReference(payload.type, payload.id, payload.values)
        : createReference(payload.type, payload.values),
    onSuccess: invalidateReferences,
  });
  const statusMutation = useMutation({
    mutationFn: (payload: {
      id: number;
      status: ReferenceStatus;
      type: ReferenceType;
    }) => updateReferenceStatus(payload.type, payload.id, payload.status),
    onSuccess: invalidateReferences,
  });
  const permanentDeleteMutation = useMutation({
    mutationFn: (payload: { id: number; type: ReferenceType }) =>
      deleteArchivedReference(payload.type, payload.id),
    onSuccess: invalidateReferences,
  });

  const openCreate = () => {
    setEditingItem(null);
    referenceForm.reset(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (item: ReferenceItem) => {
    setEditingItem(item);
    referenceForm.reset({
      name: item.name,
      sortOrder: String(item.sortOrder || ''),
    });
    setFormOpen(true);
  };

  const handleSave = referenceForm.handleSubmit(async (values) => {
    const payload = {
      name: values.name,
      sortOrder: values.sortOrder ? Number(values.sortOrder) : undefined,
    };
    try {
      await saveReferenceMutation.mutateAsync({
        id: editingItem?.id,
        type: activeType,
        values: payload,
      });
      setFormOpen(false);
      toast.success(editingItem ? 'Значение обновлено' : 'Значение создано');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сохранить значение'));
    }
  });

  const executeStatusChange = async (
    item: ReferenceItem,
    nextStatus: ReferenceStatus,
  ) => {
    try {
      await statusMutation.mutateAsync({
        id: item.id,
        status: nextStatus,
        type: activeType,
      });
      toast.success(
        nextStatus === 'archived'
          ? 'Значение отправлено в архив'
          : 'Значение восстановлено',
      );
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось изменить статус'));
    }
  };

  const requestStatusChange = (
    item: ReferenceItem,
    nextStatus: ReferenceStatus,
  ) => {
    const isArchive = nextStatus === 'archived';

    setPendingAction({
      confirmLabel: isArchive ? 'В архив' : 'Восстановить',
      description: isArchive
        ? `«${item.name}» пропадет из активных списков выбора, но старые клиенты и визиты сохранят прежние данные. Восстановить можно из фильтра «Архив».`
        : `«${item.name}» снова появится в списках выбора для новых клиентов и визитов.`,
      isDestructive: isArchive,
      onConfirm: () => executeStatusChange(item, nextStatus),
      title: isArchive
        ? 'Архивировать значение справочника?'
        : 'Восстановить значение справочника?',
    });
  };

  const executePermanentDelete = async (item: ReferenceItem) => {
    try {
      await permanentDeleteMutation.mutateAsync({
        id: item.id,
        type: activeType,
      });
      toast.success('Значение удалено из архива');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось удалить значение из архива'));
    }
  };

  const requestPermanentDelete = (item: ReferenceItem) => {
    setPendingAction({
      confirmLabel: 'Удалить навсегда',
      description: `«${item.name}» будет удалено из справочника без возможности восстановления. Сервер не даст удалить значение, если оно используется в клиентах, визитах или базах.`,
      isDestructive: true,
      onConfirm: () => executePermanentDelete(item),
      title: 'Удалить значение из архива?',
    });
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;

    setPendingActionLoading(true);
    try {
      await pendingAction.onConfirm();
      setPendingAction(null);
    } finally {
      setPendingActionLoading(false);
    }
  };

  const referenceColumns: ColumnDef<ReferenceItem>[] = [
      {
        accessorKey: 'name',
        cell: ({ row }) => (
          <div className="truncate font-medium">{row.original.name}</div>
        ),
        header: 'Название',
        size: 320,
      },
      {
        accessorKey: 'status',
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className={getStatusBadgeClass(row.original.status)}
          >
            {row.original.status === 'active' ? 'Активен' : 'Архив'}
          </Badge>
        ),
        header: 'Статус',
        size: 140,
      },
      {
        accessorKey: 'sortOrder',
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground">
            {row.original.sortOrder || '-'}
          </div>
        ),
        header: () => <div className="text-right">Порядок</div>,
        size: 140,
      },
      {
        id: 'actions',
        cell: ({ row }) => {
          const item = row.original;

          return (
            <div className="flex justify-end gap-1">
              {canEditReferences ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openEdit(item)}
                    aria-label={`Редактировать ${item.name}`}
                    title="Редактировать"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {item.status === 'active' ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => requestStatusChange(item, 'archived')}
                      aria-label={`Архивировать ${item.name}`}
                      title="Архивировать"
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => requestStatusChange(item, 'active')}
                        aria-label={`Восстановить ${item.name}`}
                        title="Восстановить"
                      >
                        <ArchiveRestore className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => requestPermanentDelete(item)}
                        aria-label={`Удалить навсегда ${item.name}`}
                        title="Удалить навсегда"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Только просмотр
                </span>
              )}
            </div>
          );
        },
        header: '',
        size: 180,
      },
    ];

  return (
    <div className="min-w-0 space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Справочники CRM</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Управление списками, из которых выбираются источники клиентов и цели
            визитов.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => void refreshReferences()}
            disabled={loading}
            aria-label="Обновить справочник"
            title="Обновить"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {canEditReferences && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              {currentTab.createLabel}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-md border bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {REFERENCE_TABS.map((tab) => (
            <Button
              key={tab.type}
              variant={activeType === tab.type ? 'default' : 'outline'}
              onClick={() => setActiveType(tab.type)}
            >
              {tab.title}
            </Button>
          ))}
        </div>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as ReferenceStatus)}
        >
          <SelectTrigger className="w-full lg:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="archived">Архив</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border bg-card">
        <div className="flex flex-col gap-1 border-b px-4 py-3">
          <div className="font-medium">{currentTab.title}</div>
          <div className="text-sm text-muted-foreground">
            {currentTab.description}
          </div>
        </div>
        <DataTable
          columns={referenceColumns}
          data={items}
          emptyText="Значений пока нет."
          errorText={referenceErrorMessage || undefined}
          loading={loading}
          loadingText="Загрузка справочника..."
          minWidthClassName="min-w-[680px]"
          onRetry={() => void refreshReferences()}
          tableClassName="table-fixed"
        />
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? 'Редактировать значение' : 'Новое значение'}
            </DialogTitle>
            <DialogDescription>
              Переименование не удаляет старые клиентские данные и историю визитов.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            <div>
              <Label className="mb-1 text-xs">Название</Label>
              <Input
                aria-invalid={Boolean(referenceForm.formState.errors.name)}
                {...referenceForm.register('name')}
              />
              {referenceForm.formState.errors.name && (
                <div className="mt-1 text-xs text-destructive">
                  {referenceForm.formState.errors.name.message}
                </div>
              )}
            </div>
            <div>
              <Label className="mb-1 text-xs">
                Порядок
              </Label>
              <Input
                inputMode="numeric"
                aria-invalid={Boolean(referenceForm.formState.errors.sortOrder)}
                placeholder="Чем меньше число, тем выше в списке"
                {...referenceForm.register('sortOrder')}
              />
              {referenceForm.formState.errors.sortOrder && (
                <div className="mt-1 text-xs text-destructive">
                  {referenceForm.formState.errors.sortOrder.message}
                </div>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={saveReferenceMutation.isPending}
            >
              <Save className="mr-2 h-4 w-4" />
              Сохранить
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        action={pendingAction}
        loading={pendingActionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />
    </div>
  );
}
