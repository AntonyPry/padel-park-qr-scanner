import { useCallback, useEffect, useState } from 'react';
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
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { canManageReferences } from '@/lib/permissions';
import type {
  ReferenceItem,
  ReferenceStatus,
  ReferenceType,
} from '@/lib/references';
import { fetchReferences } from '@/lib/references';
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

interface FormState {
  name: string;
  sortOrder: string;
}

type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<void>;
};

const EMPTY_FORM: FormState = {
  name: '',
  sortOrder: '',
};

async function readError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

function getStatusBadgeClass(status: ReferenceStatus) {
  if (status === 'active') {
    return 'bg-green-100 text-green-800 border-transparent dark:bg-green-900/30 dark:text-green-300';
  }
  return 'bg-muted text-muted-foreground';
}

export default function ReferencesPage() {
  const { account } = useAuth();
  const canEditReferences = canManageReferences(account?.role);
  const [activeType, setActiveType] = useState<ReferenceType>('client-sources');
  const [status, setStatus] = useState<ReferenceStatus>('active');
  const [items, setItems] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ReferenceItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);

  const currentTab = REFERENCE_TABS.find((tab) => tab.type === activeType)!;

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchReferences(activeType, status));
    } catch {
      alert('Не удалось загрузить справочник');
    } finally {
      setLoading(false);
    }
  }, [activeType, status]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const openCreate = () => {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (item: ReferenceItem) => {
    setEditingItem(item);
    setForm({
      name: item.name,
      sortOrder: String(item.sortOrder || ''),
    });
    setFormOpen(true);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

    const payload = {
      name: form.name.trim(),
      sortOrder: form.sortOrder.trim() ? Number(form.sortOrder) : undefined,
    };
    const res = await apiFetch(
      editingItem
        ? `/api/references/${activeType}/${editingItem.id}`
        : `/api/references/${activeType}`,
      {
        method: editingItem ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      alert(await readError(res, 'Не удалось сохранить значение'));
      return;
    }

    setFormOpen(false);
    await loadItems();
  };

  const executeStatusChange = async (
    item: ReferenceItem,
    nextStatus: ReferenceStatus,
  ) => {
    const action = nextStatus === 'archived' ? 'archive' : 'restore';

    const res = await apiFetch(`/api/references/${activeType}/${item.id}/${action}`, {
      method: 'POST',
    });

    if (!res.ok) {
      alert(await readError(res, 'Не удалось изменить статус'));
      return;
    }

    await loadItems();
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
    const res = await apiFetch(
      `/api/references/${activeType}/${item.id}/permanent`,
      {
        method: 'DELETE',
      },
    );

    if (!res.ok) {
      alert(await readError(res, 'Не удалось удалить значение из архива'));
      return;
    }

    await loadItems();
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
            onClick={() => void loadItems()}
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
        <div className="overflow-x-auto">
          <Table className="min-w-[680px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[45%]">Название</TableHead>
                <TableHead className="w-[16%]">Статус</TableHead>
                <TableHead className="w-[16%] text-right">Порядок</TableHead>
                <TableHead className="w-[23%] text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Загрузка справочника...
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Значений пока нет.
                  </TableCell>
                </TableRow>
              )}
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="truncate font-medium">
                    {item.name}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={getStatusBadgeClass(item.status)}
                    >
                      {item.status === 'active' ? 'Активен' : 'Архив'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {item.sortOrder || '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEditReferences ? (
                      <div className="flex justify-end gap-1">
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
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Только просмотр
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
              <label className="mb-1 block text-xs font-medium">Название</label>
              <Input
                required
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Порядок
              </label>
              <Input
                inputMode="numeric"
                value={form.sortOrder}
                onChange={(event) =>
                  setForm({ ...form, sortOrder: event.target.value })
                }
                placeholder="Чем меньше число, тем выше в списке"
              />
            </div>
            <Button type="submit" className="w-full">
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
