import { useState, useEffect, useCallback, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { ErrorState } from '@/components/error-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  AlertCircle,
  CheckCircle2,
  Trash2,
  Plus,
  Tag,
  Percent,
  ArchiveRestore,
  Search,
  RefreshCw,
} from 'lucide-react';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import { DataTable } from '@/components/data-table';
import { Label } from '@/components/ui/label';
import type { MotivationBonusRule } from '@/lib/motivation';
import {
  canManageCatalog,
  canManageMotivation,
} from '@/lib/permissions';
import { useAuth } from '@/lib/useAuth';

const PNL_GROUPS = [
  { value: 'REVENUE_POS', label: 'Касса (Эвотор)', type: 'income' },
  { value: 'REVENUE_EXT', label: 'Выручка вне кассы', type: 'income' },
  { value: 'COGS', label: 'Себестоимость (Закупы)', type: 'expense' },
  { value: 'FEES', label: 'Комиссии и Эквайринг', type: 'expense' },
  { value: 'OPEX', label: 'Операционные расходы (OPEX)', type: 'expense' },
];

interface Category {
  id: number;
  name: string;
  type: 'income' | 'expense' | string;
  group: string;
  commissionPercent: number | string;
  parentId: number | null;
  isSystem?: boolean;
  status?: 'active' | 'archived';
}

interface CatalogRule {
  id: number;
  itemName: string;
  category: string;
  status?: 'active' | 'archived';
}

type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<void>;
};

const categoryFormSchema = z.object({
  commissionPercent: z
    .string()
    .refine((value) => value === '' || Number.isFinite(Number(value)), {
      message: 'Введите число',
    })
    .refine((value) => value === '' || Number(value) >= 0, {
      message: 'Не меньше 0',
    })
    .refine((value) => value === '' || Number(value) <= 100, {
      message: 'Не больше 100',
    }),
  group: z.string().min(1, 'Выберите группу'),
  name: z.string().trim().min(2, 'Минимум 2 символа'),
  parentId: z.string(),
});
type CategoryFormValues = z.infer<typeof categoryFormSchema>;

const EMPTY_CATEGORY_FORM: CategoryFormValues = {
  commissionPercent: '',
  group: 'OPEX',
  name: '',
  parentId: 'none',
};

async function readError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

export default function CatalogPage() {
  const { account } = useAuth();
  const canEditCatalog = canManageCatalog(account?.role);
  const canEditMotivation = canManageMotivation(account?.role);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [rules, setRules] = useState<CatalogRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bonusRules, setBonusRules] = useState<MotivationBonusRule[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');

  const [activeTab, setActiveTab] = useState<
    'unmapped' | 'rules' | 'categories'
  >('unmapped');
  const [catalogStatus, setCatalogStatus] = useState<'active' | 'archived'>(
    'active',
  );
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selections, setSelections] = useState<Record<string, string>>({});

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);
  const categoryForm = useForm<CategoryFormValues>({
    defaultValues: EMPTY_CATEGORY_FORM,
    resolver: zodResolver(categoryFormSchema),
  });
  const newCatParentId = categoryForm.watch('parentId');
  const newCatGroup = categoryForm.watch('group');

  const fetchData = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const [unmappedRes, rulesRes, catRes, bonusRulesRes] = await Promise.all([
        apiFetch('/api/catalog/unmapped'),
        apiFetch(`/api/catalog/rules?status=${catalogStatus}`),
        apiFetch(`/api/catalog/categories?status=${catalogStatus}`),
        apiFetch('/api/motivation/bonus-rules'),
      ]);

      const errors: string[] = [];
      if (unmappedRes.ok) {
        setUnmapped(await unmappedRes.json());
      } else {
        setUnmapped([]);
        errors.push(await readError(unmappedRes, 'Не удалось загрузить товары без правил'));
      }

      if (rulesRes.ok) {
        setRules(await rulesRes.json());
      } else {
        setRules([]);
        errors.push(await readError(rulesRes, 'Не удалось загрузить правила товаров'));
      }

      if (catRes.ok) {
        setCategories(await catRes.json());
      } else {
        setCategories([]);
        errors.push(await readError(catRes, 'Не удалось загрузить категории'));
      }

      if (bonusRulesRes.ok) {
        setBonusRules((await bonusRulesRes.json()) as MotivationBonusRule[]);
      } else {
        setBonusRules([]);
        errors.push(await readError(bonusRulesRes, 'Не удалось загрузить мотивации категорий'));
      }

      if (errors.length > 0) {
        setCatalogError(errors.join('. '));
      }
    } catch (e) {
      console.error('Fetch error:', e);
      setUnmapped([]);
      setRules([]);
      setCategories([]);
      setBonusRules([]);
      setCatalogError(getApiErrorMessage(e, 'Не удалось загрузить справочник товаров'));
    } finally {
      setCatalogLoading(false);
    }
  }, [catalogStatus]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const motivationByCategoryId = useMemo(() => {
    const map = new Map<number, MotivationBonusRule>();
    bonusRules.forEach((rule) => {
      rule.categories.forEach((category) => {
        map.set(category.id, rule);
      });
    });
    return map;
  }, [bonusRules]);
  const normalizedCatalogSearch = catalogSearch.trim().toLowerCase();
  const filteredUnmapped = useMemo(() => {
    if (!normalizedCatalogSearch) return unmapped;
    return unmapped.filter((itemName) =>
      itemName.toLowerCase().includes(normalizedCatalogSearch),
    );
  }, [normalizedCatalogSearch, unmapped]);
  const filteredRules = useMemo(() => {
    if (!normalizedCatalogSearch) return rules;
    return rules.filter((rule) =>
      [rule.itemName, rule.category].some((value) =>
        value.toLowerCase().includes(normalizedCatalogSearch),
      ),
    );
  }, [normalizedCatalogSearch, rules]);
  const filteredCategories = useMemo(() => {
    if (!normalizedCatalogSearch) return categories;
    return categories.filter((category) =>
      [
        category.name,
        category.group,
        PNL_GROUPS.find((group) => group.value === category.group)?.label || '',
        motivationByCategoryId.get(category.id)?.name || '',
      ].some((value) => value.toLowerCase().includes(normalizedCatalogSearch)),
    );
  }, [categories, motivationByCategoryId, normalizedCatalogSearch]);

  const handleSaveRule = async (itemName: string) => {
    const category = selections[itemName];
    if (!category) return;

    const res = await apiFetch('/api/catalog/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemName, category }),
    });

    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось сохранить правило товара'));
      return;
    }

    setSelections((prev) => {
      const next = { ...prev };
      delete next[itemName];
      return next;
    });
    await fetchData();
    toast.success('Правило товара сохранено');
  };

  const executeArchiveRule = async (rule: CatalogRule) => {
    const res = await apiFetch(`/api/catalog/rules/${rule.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось архивировать правило'));
      return;
    }

    await fetchData();
    toast.success('Правило отправлено в архив');
  };

  const executeRestoreRule = async (rule: CatalogRule) => {
    const res = await apiFetch(`/api/catalog/rules/${rule.id}/restore`, {
      method: 'POST',
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось восстановить правило'));
      return;
    }

    await fetchData();
    toast.success('Правило восстановлено');
  };

  const executePermanentDeleteRule = async (rule: CatalogRule) => {
    const res = await apiFetch(`/api/catalog/rules/${rule.id}/permanent`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось удалить правило из архива'));
      return;
    }

    await fetchData();
    toast.success('Правило удалено из архива');
  };

  const requestArchiveRule = (rule: CatalogRule) => {
    setPendingAction({
      confirmLabel: 'В архив',
      description: `Правило для «${rule.itemName}» перестанет распределять новые чеки по категории «${rule.category}». История чеков не удаляется.`,
      isDestructive: true,
      onConfirm: () => executeArchiveRule(rule),
      title: 'Архивировать правило товара?',
    });
  };

  const requestRestoreRule = (rule: CatalogRule) => {
    setPendingAction({
      confirmLabel: 'Восстановить',
      description: `Правило для «${rule.itemName}» снова будет распределять чеки по категории «${rule.category}».`,
      onConfirm: () => executeRestoreRule(rule),
      title: 'Восстановить правило товара?',
    });
  };

  const requestPermanentDeleteRule = (rule: CatalogRule) => {
    setPendingAction({
      confirmLabel: 'Удалить навсегда',
      description: `Правило для «${rule.itemName}» будет удалено без возможности восстановления. Используйте это только для случайно созданных правил без истории.`,
      isDestructive: true,
      onConfirm: () => executePermanentDeleteRule(rule),
      title: 'Удалить правило из архива?',
    });
  };

  const handleParentChange = (val: string) => {
    categoryForm.setValue('parentId', val, {
      shouldDirty: true,
      shouldValidate: true,
    });
    if (val !== 'none') {
      const parentCat = categories.find((c) => String(c.id) === val);
      if (parentCat) {
        categoryForm.setValue('group', parentCat.group, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    }
  };

  const handleAddCategory = categoryForm.handleSubmit(async (values) => {
    const selectedGroupDef = PNL_GROUPS.find((g) => g.value === values.group);
    const type = selectedGroupDef ? selectedGroupDef.type : 'expense';

    const res = await apiFetch('/api/catalog/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: values.name.trim(),
        type: type,
        group: values.group,
        commissionPercent: values.commissionPercent
          ? Number(values.commissionPercent)
          : 0,
        parentId: values.parentId === 'none' ? null : Number(values.parentId),
      }),
    });

    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось создать категорию'));
      return;
    }

    categoryForm.reset(EMPTY_CATEGORY_FORM);
    await fetchData();
    toast.success('Категория создана');
  });

  const executeArchiveCategory = async (category: Category) => {
    const res = await apiFetch(`/api/catalog/categories/${category.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось архивировать категорию'));
      return;
    }

    await fetchData();
    toast.success('Категория отправлена в архив');
  };

  const executeRestoreCategory = async (category: Category) => {
    const res = await apiFetch(`/api/catalog/categories/${category.id}/restore`, {
      method: 'POST',
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось восстановить категорию'));
      return;
    }

    await fetchData();
    toast.success('Категория восстановлена');
  };

  const executePermanentDeleteCategory = async (category: Category) => {
    const res = await apiFetch(`/api/catalog/categories/${category.id}/permanent`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось удалить категорию из архива'));
      return;
    }

    await fetchData();
    toast.success('Категория удалена из архива');
  };

  const requestArchiveCategory = (category: Category) => {
    setPendingAction({
      confirmLabel: 'В архив',
      description: `Категория «${category.name}» и ее подкатегории исчезнут из активных списков. Связанные правила товаров тоже уйдут в архив. История чеков и финансов не удаляется.`,
      isDestructive: true,
      onConfirm: () => executeArchiveCategory(category),
      title: 'Архивировать категорию?',
    });
  };

  const requestRestoreCategory = (category: Category) => {
    setPendingAction({
      confirmLabel: 'Восстановить',
      description: `Категория «${category.name}» снова появится в активном справочнике. Если она была архивирована веткой, связанные правила этой ветки тоже восстановятся.`,
      onConfirm: () => executeRestoreCategory(category),
      title: 'Восстановить категорию?',
    });
  };

  const requestPermanentDeleteCategory = (category: Category) => {
    setPendingAction({
      confirmLabel: 'Удалить навсегда',
      description: `Категория «${category.name}» будет удалена без возможности восстановления. Сервер не даст удалить ее, если есть мотивация, финансовая история или использованные в чеках правила.`,
      isDestructive: true,
      onConfirm: () => executePermanentDeleteCategory(category),
      title: 'Удалить категорию из архива?',
    });
  };

  const getGroupLabel = (groupVal: string) => {
    return PNL_GROUPS.find((g) => g.value === groupVal)?.label || groupVal;
  };
  const activeTabLabel = {
    categories: 'категориям',
    rules: 'правилам',
    unmapped: 'товарам без правил',
  }[activeTab];
  const hasCatalogData = unmapped.length > 0 || rules.length > 0 || categories.length > 0;

  // ФУНКЦИЯ ДЛЯ ОБНОВЛЕНИЯ РОДИТЕЛЯ ИЗ ТАБЛИЦЫ
  const handleUpdateParent = async (
    categoryId: number,
    newParentId: string,
  ) => {
    try {
      const res = await apiFetch(`/api/catalog/categories/${categoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId: newParentId === 'none' ? null : Number(newParentId),
        }),
      });
      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось обновить родителя категории'));
        return;
      }

      await fetchData();
      toast.success('Родитель категории обновлен');
    } catch (e) {
      console.error('Update error:', e);
      toast.error('Не удалось обновить родителя категории');
    }
  };

  const handleUpdateMotivation = async (
    categoryId: number,
    bonusRuleId: string,
  ) => {
    const res = await apiFetch(`/api/motivation/categories/${categoryId}/rule`, {
      method: 'PUT',
      body: JSON.stringify({
        bonusRuleId: bonusRuleId === 'none' ? null : Number(bonusRuleId),
      }),
    });

    if (!res.ok) {
      try {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error || 'Не удалось обновить мотивацию категории');
      } catch {
        toast.error('Не удалось обновить мотивацию категории');
      }
      return;
    }

    setBonusRules((await res.json()) as MotivationBonusRule[]);
    toast.success('Мотивация категории обновлена');
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

  // ФУНКЦИИ ЗАЩИТЫ ОТ ЦИКЛОВ НА КЛИЕНТЕ
  // Проверяет, является ли potentialChild потомком категории categoryId
  const isDescendant = (potentialChildId: number, categoryId: number) => {
    let current = categories.find((c) => c.id === potentialChildId);
    while (current) {
      if (current.parentId === categoryId) return true;
      const parentId = current.parentId;
      if (!parentId) return false;
      current = categories.find((c) => c.id === parentId);
    }
    return false;
  };

  // Получает список доступных родителей (исключая саму себя и всех своих потомков)
  const getAvailableParents = (catId: number) => {
    return categories.filter(
      (c) => c.id !== catId && !isDescendant(c.id, catId),
    );
  };
  const unmappedColumns: ColumnDef<string>[] = [
    {
      id: 'itemName',
      header: 'Название в кассе Эвотор',
      cell: ({ row }) => (
        <span className="font-medium">{row.original}</span>
      ),
    },
    {
      id: 'category',
      header: 'Категория P&L',
      size: 280,
      cell: ({ row }) => {
        const itemName = row.original;

        return (
          <Select
            onValueChange={(val) =>
              setSelections({ ...selections, [itemName]: val })
            }
          >
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="Выберите категорию..." />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.name}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      size: 120,
      meta: {
        cellClassName: 'text-right',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => {
        const itemName = row.original;
        const canSaveRule = canEditCatalog && Boolean(selections[itemName]);

        return (
          <Button
            size="sm"
            variant={canSaveRule ? 'default' : 'outline'}
            disabled={!canSaveRule}
            aria-label={`Сохранить правило для ${itemName}`}
            title={
              !canEditCatalog
                ? 'Недостаточно прав для изменения справочника'
                : !selections[itemName]
                  ? 'Сначала выберите категорию'
                  : 'Сохранить правило'
            }
            onClick={() => handleSaveRule(itemName)}
          >
            Сохранить
          </Button>
        );
      },
    },
  ];
  const ruleColumns: ColumnDef<CatalogRule>[] = [
    {
      accessorKey: 'itemName',
      header: 'Товар из Эвотора',
      cell: ({ row }) => (
        <span className="font-medium">{row.original.itemName}</span>
      ),
    },
    {
      accessorKey: 'category',
      header: 'Категория',
      meta: {
        cellClassName: 'text-muted-foreground',
      },
    },
    {
      id: 'actions',
      header: '',
      size: 90,
      meta: {
        cellClassName: 'text-right',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => {
        const rule = row.original;

        return catalogStatus === 'archived' ? (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => requestRestoreRule(rule)}
              disabled={!canEditCatalog}
              aria-label={`Восстановить правило для ${rule.itemName}`}
              title="Восстановить"
            >
              <ArchiveRestore className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => requestPermanentDeleteRule(rule)}
              disabled={!canEditCatalog}
              aria-label={`Удалить навсегда правило для ${rule.itemName}`}
              title="Удалить навсегда"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => requestArchiveRule(rule)}
            disabled={!canEditCatalog}
            aria-label={`Архивировать правило для ${rule.itemName}`}
            title="В архив"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        );
      },
    },
  ];
  const categoryColumns: ColumnDef<Category>[] = [
    {
      accessorKey: 'name',
      header: 'Название',
      size: 190,
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" />
          <span className="truncate font-medium">{row.original.name}</span>
        </div>
      ),
    },
    {
      accessorKey: 'group',
      header: 'Группа отчета',
      size: 180,
      meta: {
        cellClassName: 'truncate text-muted-foreground',
      },
      cell: ({ row }) => getGroupLabel(row.original.group),
    },
    {
      accessorKey: 'commissionPercent',
      header: 'Комиссия',
      size: 120,
      cell: ({ row }) =>
        Number(row.original.commissionPercent) > 0 ? (
          <span className="rounded-md bg-destructive/10 px-2 py-1 text-sm font-medium text-destructive">
            {row.original.commissionPercent}%
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      id: 'motivation',
      header: 'Мотивация',
      size: 180,
      cell: ({ row }) => {
        const category = row.original;

        return category.type === 'income' ? (
          <Select
            value={
              motivationByCategoryId.get(category.id)
                ? String(motivationByCategoryId.get(category.id)?.id)
                : 'none'
            }
            disabled={!canEditMotivation}
            onValueChange={(val) => handleUpdateMotivation(category.id, val)}
          >
            <SelectTrigger className="w-full border-dashed bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-muted-foreground">
                Без мотивации
              </SelectItem>
              {bonusRules.map((rule) => (
                <SelectItem key={rule.id} value={String(rule.id)}>
                  {rule.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    {
      id: 'parent',
      header: 'Родитель',
      size: 180,
      cell: ({ row }) => {
        const category = row.original;

        return (
          <Select
            value={category.parentId ? String(category.parentId) : 'none'}
            disabled={!canEditCatalog}
            onValueChange={(val) => handleUpdateParent(category.id, val)}
          >
            <SelectTrigger className="w-full border-dashed bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-muted-foreground">
                Нет (Корневая)
              </SelectItem>
              {getAvailableParents(category.id).map((parent) => (
                <SelectItem key={parent.id} value={String(parent.id)}>
                  {parent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      size: 80,
      meta: {
        cellClassName: 'text-right',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => {
        const category = row.original;

        if (!canEditCatalog || category.isSystem) return null;

        return (
          <div className="flex justify-end gap-1">
            {catalogStatus === 'archived' ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => requestRestoreCategory(category)}
                  aria-label={`Восстановить категорию ${category.name}`}
                  title="Восстановить"
                >
                  <ArchiveRestore className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => requestPermanentDeleteCategory(category)}
                  aria-label={`Удалить навсегда категорию ${category.name}`}
                  title="Удалить навсегда"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => requestArchiveCategory(category)}
                aria-label={`Архивировать категорию ${category.name}`}
                title="В архив"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Справочник товаров
          </h1>
          <p className="text-muted-foreground mt-1">
            Распределение номенклатуры Эвотор по категориям P&L
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={catalogStatus}
            onValueChange={(value) => {
              const nextStatus = value as 'active' | 'archived';
              setCatalogStatus(nextStatus);
              if (nextStatus === 'archived' && activeTab === 'unmapped') {
                setActiveTab('rules');
              }
            }}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Активные</SelectItem>
              <SelectItem value="archived">Архив</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex bg-muted p-1 rounded-md">
            <Button
              variant={activeTab === 'unmapped' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('unmapped')}
              disabled={catalogStatus === 'archived'}
              title={
                catalogStatus === 'archived'
                  ? 'Неразобранные товары доступны только в активном справочнике'
                  : 'Показать товары без правила'
              }
            >
              Неразобранные
              {unmapped.length > 0 && (
                <span className="ml-2 bg-destructive text-white text-xs px-2 py-0.5 rounded-full">
                  {unmapped.length}
                </span>
              )}
            </Button>
            <Button
              variant={activeTab === 'rules' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('rules')}
            >
              Правила ({rules.length})
            </Button>
            <Button
              variant={activeTab === 'categories' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('categories')}
            >
              Категории ({categories.length})
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-md border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={catalogSearch}
            onChange={(event) => setCatalogSearch(event.target.value)}
            placeholder={`Поиск по ${activeTabLabel}`}
            className="pl-9"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {activeTab === 'unmapped' &&
            `Показано ${filteredUnmapped.length} из ${unmapped.length}`}
          {activeTab === 'rules' &&
            `Показано ${filteredRules.length} из ${rules.length}`}
          {activeTab === 'categories' &&
            `Показано ${filteredCategories.length} из ${categories.length}`}
        </div>
      </div>

      {catalogError && (
        <ErrorState
          message={catalogError}
          onRetry={() => void fetchData()}
          title="Справочник товаров не загрузился полностью"
        />
      )}

      {/* ОСТАЛЬНАЯ ЧАСТЬ ИНТЕРФЕЙСА */}
      {(!catalogError || hasCatalogData) && activeTab === 'unmapped' && (
        <Card
          className={
            catalogLoading && unmapped.length === 0
              ? 'border-border'
              : unmapped.length === 0
              ? 'bg-green-500/5 border-green-500/20'
              : 'border-orange-500/20'
          }
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {catalogLoading && unmapped.length === 0 ? (
                <RefreshCw className="animate-spin text-muted-foreground" />
              ) : unmapped.length === 0 ? (
                <CheckCircle2 className="text-green-500" />
              ) : (
                <AlertCircle className="text-orange-500" />
              )}
              {catalogLoading && unmapped.length === 0
                ? 'Загрузка товаров из чеков'
                : unmapped.length === 0
                ? 'Все товары распределены'
                : 'Найдены новые товары в чеках'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(catalogLoading && unmapped.length === 0) || unmapped.length > 0 ? (
              <DataTable
                columns={unmappedColumns}
                data={filteredUnmapped}
                emptyText="По текущему поиску товаров не найдено."
                loading={catalogLoading}
                loadingText="Загрузка товаров..."
                minWidthClassName="min-w-[680px]"
                pageSize={25}
              />
            ) : null}
          </CardContent>
        </Card>
      )}

      {(!catalogError || hasCatalogData) && activeTab === 'rules' && (
        <Card>
          <CardHeader>
            <CardTitle>Сохраненные правила</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={ruleColumns}
              data={filteredRules}
              emptyText="Сохраненных правил пока нет."
              loading={catalogLoading}
              loadingText="Загрузка правил..."
              minWidthClassName="min-w-[640px]"
              pageSize={25}
            />
          </CardContent>
        </Card>
      )}

      {(!catalogError || hasCatalogData) && activeTab === 'categories' && (
        <Card>
          <CardHeader>
            <CardTitle>Управление категориями P&L</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {canEditCatalog && catalogStatus === 'active' && (
              <form
                onSubmit={handleAddCategory}
                className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end bg-muted/30 p-4 rounded-lg border"
              >
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Название категории
                  </Label>
                  <Input
                    placeholder="Например: Лунда"
                    {...categoryForm.register('name')}
                    aria-invalid={Boolean(categoryForm.formState.errors.name)}
                  />
                  {categoryForm.formState.errors.name && (
                    <p className="text-xs text-destructive">
                      {categoryForm.formState.errors.name.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Группа в отчете</Label>
                  <Select
                    value={newCatGroup}
                    onValueChange={(value) =>
                      categoryForm.setValue('group', value, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                    disabled={newCatParentId !== 'none'}
                  >
                    <SelectTrigger
                      className={newCatParentId !== 'none' ? 'bg-muted' : ''}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PNL_GROUPS.map((g) => (
                        <SelectItem key={g.value} value={g.value}>
                          {g.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {newCatParentId !== 'none' && (
                    <p className="text-[10px] text-muted-foreground absolute mt-0.5">
                      Наследуется от родителя
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Авто-комиссия (%)
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      placeholder="0"
                      {...categoryForm.register('commissionPercent')}
                      aria-invalid={Boolean(
                        categoryForm.formState.errors.commissionPercent,
                      )}
                    />
                    <Percent className="w-4 h-4 text-muted-foreground absolute right-3 top-3" />
                  </div>
                  {categoryForm.formState.errors.commissionPercent && (
                    <p className="text-xs text-destructive">
                      {categoryForm.formState.errors.commissionPercent.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Родитель</Label>
                  <Select
                    value={newCatParentId}
                    onValueChange={handleParentChange}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Нет (Корневая)</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full">
                  <Plus className="w-4 h-4 mr-2" /> Добавить
                </Button>
              </form>
            )}

            <div className="rounded-md border overflow-x-auto">
              <DataTable
                columns={categoryColumns}
                data={filteredCategories}
                emptyText="Нет созданных категорий"
                loading={catalogLoading}
                loadingText="Загрузка категорий..."
                minWidthClassName="min-w-[860px] table-fixed"
                pageSize={25}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmActionDialog
        action={pendingAction}
        loading={pendingActionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />
    </div>
  );
}
