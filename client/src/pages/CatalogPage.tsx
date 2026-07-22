import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { ErrorState } from '@/components/error-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Link2,
  Search,
  Ticket,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import { DataTable } from '@/components/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PermissionActionButton,
  PermissionHint,
} from '@/components/permission-feedback';
import {
  permissionMessages,
  showPermissionDenied,
} from '@/lib/permission-feedback';
import { Label } from '@/components/ui/label';
import type { MotivationBonusRule } from '@/lib/motivation';
import {
  canManageCatalog,
  canManageMotivation,
  canManagePrepaymentSales,
  canManagePrepaymentSettings,
  canManageSubscriptionTypes,
} from '@/lib/permissions';
import { useAuthorizationRole } from '@/lib/useAuth';
import { useRealtimeRefresh } from '@/lib/realtime';

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

type SaleIntent = 'normal' | 'subscription' | 'certificate';
type PendingSaleStatus = 'pending' | 'linked' | 'ignored' | 'canceled' | 'all';
type SubscriptionTypeStatus = 'active' | 'archived';
type SubscriptionTrainingKind = 'group' | 'personal';
type SubscriptionTimeSegment = 'all' | 'off_peak' | 'single' | 'standard';

interface SaleSetting {
  id: number;
  itemName: string;
  saleIntent: SaleIntent;
  saleSettings?: {
    certificateType?: 'money' | 'service';
    serviceName?: string | null;
    serviceType?: string | null;
    subscriptionTypeId?: number | null;
    unitsTotal?: number | null;
    validityDays?: number | null;
    [key: string]: unknown;
  } | null;
}

interface PendingSaleHistory {
  id: number;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  reason?: string | null;
  role?: string | null;
  createdAt: string;
}

interface PendingSale {
  id: number;
  receiptId: number;
  receiptItemId: number;
  itemName: string;
  saleIntent: Exclude<SaleIntent, 'normal'>;
  status: Exclude<PendingSaleStatus, 'all'>;
  category?: string | null;
  quantity: number;
  price: number;
  amount: number;
  evotorId?: string | null;
  receiptDateTime?: string | null;
  clientId?: number | null;
  client?: {
    id: number;
    name: string;
    phone: string;
    status: string;
  } | null;
  statusReason?: string | null;
  history?: PendingSaleHistory[];
  createdAt: string;
}

interface ClientCandidate {
  id: number;
  name: string;
  phone: string;
  status: 'active' | 'archived';
}

interface SubscriptionType {
  id: number;
  name: string;
  serviceType: 'training' | string;
  trainingKind: SubscriptionTrainingKind;
  timeSegment?: SubscriptionTimeSegment | null;
  sessionsTotal: number | null;
  isUnlimited: boolean;
  validityDays: number;
  price: number;
  bonusPersonalSessions: number;
  status: SubscriptionTypeStatus;
  description?: string | null;
}

interface SubscriptionTypeFormState {
  bonusPersonalSessions: string;
  description: string;
  isUnlimited: 'false' | 'true';
  name: string;
  price: string;
  sessionsTotal: string;
  timeSegment: SubscriptionTimeSegment;
  trainingKind: SubscriptionTrainingKind;
  validityDays: string;
}

interface UnmappedItemFormState {
  category: string;
  saleIntent: SaleIntent;
  subscriptionTypeId: string;
}

interface CertificateLinkFormState {
  amountTotal: string;
  certificateType: 'money' | 'service';
  code: string;
  serviceName: string;
  unitsTotal: string;
  validityDays: string;
}

type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<void>;
};

const SALE_INTENT_OPTIONS: Array<{ label: string; value: SaleIntent }> = [
  { value: 'normal', label: 'Обычная' },
  { value: 'subscription', label: 'Абонемент' },
  { value: 'certificate', label: 'Сертификат' },
];

const SALE_INTENT_LABELS: Record<SaleIntent, string> = {
  certificate: 'Сертификат',
  normal: 'Обычная',
  subscription: 'Абонемент',
};
const UNMAPPED_PAGE_SIZE = 24;

const EMPTY_UNMAPPED_ITEM_FORM: UnmappedItemFormState = {
  category: '',
  saleIntent: 'normal',
  subscriptionTypeId: 'none',
};

const PENDING_STATUS_LABELS: Record<PendingSaleStatus, string> = {
  all: 'Все',
  canceled: 'Отменены',
  ignored: 'Игнор',
  linked: 'Привязаны',
  pending: 'В ожидании',
};

const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionTypeStatus, string> = {
  active: 'Активные',
  archived: 'Архив',
};

const TRAINING_KIND_LABELS: Record<SubscriptionTrainingKind, string> = {
  group: 'Групповые',
  personal: 'Персональные',
};

const TIME_SEGMENT_LABELS: Record<SubscriptionTimeSegment, string> = {
  all: 'Любое время',
  off_peak: 'Будни 10:00-17:00',
  single: 'Разовое',
  standard: 'День/вечер/выходные',
};

const EMPTY_SUBSCRIPTION_TYPE_FORM: SubscriptionTypeFormState = {
  bonusPersonalSessions: '0',
  description: '',
  isUnlimited: 'false',
  name: '',
  price: '',
  sessionsTotal: '4',
  timeSegment: 'all',
  trainingKind: 'group',
  validityDays: '30',
};

const EMPTY_CERTIFICATE_LINK_FORM: CertificateLinkFormState = {
  amountTotal: '',
  certificateType: 'money',
  code: '',
  serviceName: '',
  unitsTotal: '1',
  validityDays: '365',
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

function normalizeItemKey(value: string) {
  return value.trim().toLowerCase();
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
    style: 'currency',
    currency: 'RUB',
  }).format(Number(value) || 0);
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

export default function CatalogPage() {
  const organizationRole = useAuthorizationRole('organization');
  const clubRole = useAuthorizationRole('club');
  const [searchParams] = useSearchParams();
  const canEditCategories = canManageCatalog(organizationRole);
  const canEditRules = canManageCatalog(clubRole);
  const canEditMotivation = canManageMotivation(organizationRole);
  const canEditSaleSettings = canManagePrepaymentSettings(clubRole);
  const canEditPendingSales = canManagePrepaymentSales(clubRole);
  const canEditSubscriptionTypes = canManageSubscriptionTypes(organizationRole);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [rules, setRules] = useState<CatalogRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bonusRules, setBonusRules] = useState<MotivationBonusRule[]>([]);
  const [saleSettings, setSaleSettings] = useState<SaleSetting[]>([]);
  const [pendingSales, setPendingSales] = useState<PendingSale[]>([]);
  const [subscriptionTypes, setSubscriptionTypes] = useState<SubscriptionType[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');

  const [activeTab, setActiveTab] = useState<
    'unmapped' | 'rules' | 'categories' | 'pending' | 'subscriptions'
  >('unmapped');
  const [catalogStatus, setCatalogStatus] = useState<'active' | 'archived'>(
    'active',
  );
  const [subscriptionTypeStatus, setSubscriptionTypeStatus] =
    useState<SubscriptionTypeStatus>('active');
  const [pendingStatus, setPendingStatus] =
    useState<PendingSaleStatus>('pending');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [unmappedPage, setUnmappedPage] = useState(0);
  const [saleSettingSavingKey, setSaleSettingSavingKey] = useState('');
  const [unmappedDialogItem, setUnmappedDialogItem] = useState<string | null>(null);
  const [unmappedItemForm, setUnmappedItemForm] =
    useState<UnmappedItemFormState>(EMPTY_UNMAPPED_ITEM_FORM);
  const [unmappedItemSaving, setUnmappedItemSaving] = useState(false);
  const [mobileCategoryPath, setMobileCategoryPath] = useState<number[]>([]);

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);
  const [linkDialogSale, setLinkDialogSale] = useState<PendingSale | null>(null);
  const [clientSearchInput, setClientSearchInput] = useState('');
  const [clientCandidates, setClientCandidates] = useState<ClientCandidate[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [clientSearchError, setClientSearchError] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [linkComment, setLinkComment] = useState('');
  const [certificateLinkForm, setCertificateLinkForm] =
    useState<CertificateLinkFormState>(EMPTY_CERTIFICATE_LINK_FORM);
  const [linkLoading, setLinkLoading] = useState(false);
  const [subscriptionDialogOpen, setSubscriptionDialogOpen] = useState(false);
  const [editingSubscriptionType, setEditingSubscriptionType] =
    useState<SubscriptionType | null>(null);
  const [subscriptionForm, setSubscriptionForm] =
    useState<SubscriptionTypeFormState>(EMPTY_SUBSCRIPTION_TYPE_FORM);
  const [subscriptionSaving, setSubscriptionSaving] = useState(false);
  const categoryForm = useForm<CategoryFormValues>({
    defaultValues: EMPTY_CATEGORY_FORM,
    resolver: zodResolver(categoryFormSchema),
  });
  const newCatParentId = categoryForm.watch('parentId');
  const newCatGroup = categoryForm.watch('group');

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (
      tab === 'unmapped' ||
      tab === 'rules' ||
      tab === 'categories' ||
      tab === 'pending' ||
      tab === 'subscriptions'
    ) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const fetchData = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const pendingQuery = new URLSearchParams({ status: pendingStatus });
      const [
        unmappedRes,
        rulesRes,
        catRes,
        bonusRulesRes,
        saleSettingsRes,
        pendingSalesRes,
        subscriptionTypesRes,
      ] = await Promise.all([
        apiFetch('/api/catalog/unmapped'),
        apiFetch(`/api/catalog/rules?status=${catalogStatus}`),
        apiFetch(`/api/catalog/categories?status=${catalogStatus}`),
        canEditMotivation
          ? apiFetch('/api/motivation/bonus-rules')
          : Promise.resolve(null),
        apiFetch('/api/catalog/sale-settings'),
        canEditPendingSales
          ? apiFetch(`/api/catalog/pending-sales?${pendingQuery.toString()}`)
          : Promise.resolve(null),
        canEditSubscriptionTypes
          ? apiFetch('/api/subscriptions/types?status=all')
          : Promise.resolve(null),
      ]);

      const errors: string[] = [];
      if (unmappedRes.ok) {
        setUnmapped(await unmappedRes.json());
      } else {
        errors.push(await readError(unmappedRes, 'Не удалось загрузить товары без правил'));
      }

      if (rulesRes.ok) {
        setRules(await rulesRes.json());
      } else {
        errors.push(await readError(rulesRes, 'Не удалось загрузить правила товаров'));
      }

      if (catRes.ok) {
        setCategories(await catRes.json());
      } else {
        errors.push(await readError(catRes, 'Не удалось загрузить категории'));
      }

      if (bonusRulesRes?.ok) {
        setBonusRules((await bonusRulesRes.json()) as MotivationBonusRule[]);
      } else if (bonusRulesRes) {
        errors.push(await readError(bonusRulesRes, 'Не удалось загрузить мотивации категорий'));
      } else {
        setBonusRules([]);
      }

      if (saleSettingsRes.ok) {
        setSaleSettings((await saleSettingsRes.json()) as SaleSetting[]);
      } else {
        errors.push(await readError(saleSettingsRes, 'Не удалось загрузить настройки продаж'));
      }

      if (pendingSalesRes?.ok) {
        setPendingSales((await pendingSalesRes.json()) as PendingSale[]);
      } else if (pendingSalesRes) {
        errors.push(await readError(pendingSalesRes, 'Не удалось загрузить очередь продаж'));
      } else {
        setPendingSales([]);
      }

      if (subscriptionTypesRes?.ok) {
        setSubscriptionTypes((await subscriptionTypesRes.json()) as SubscriptionType[]);
      } else if (subscriptionTypesRes) {
        errors.push(
          await readError(
            subscriptionTypesRes,
            'Не удалось загрузить типы абонементов',
          ),
        );
      } else {
        setSubscriptionTypes([]);
      }

      if (errors.length > 0) {
        setCatalogError(errors.join('. '));
      }
    } catch (e) {
      console.error('Fetch error:', e);
      setCatalogError(getApiErrorMessage(e, 'Не удалось загрузить справочник товаров'));
    } finally {
      setCatalogLoading(false);
    }
  }, [
    canEditMotivation,
    canEditPendingSales,
    canEditSubscriptionTypes,
    catalogStatus,
    pendingStatus,
  ]);

  useRealtimeRefresh(
    [
      'catalog',
      'prepaymentSales',
      'prepaymentSettings',
      'subscriptionTypes',
      'finance',
      'motivation',
    ],
    () => {
      void fetchData();
    },
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (activeTab === 'pending' && !canEditPendingSales) {
      setActiveTab('rules');
    }
    if (activeTab === 'subscriptions' && !canEditSubscriptionTypes) {
      setActiveTab('rules');
    }
  }, [activeTab, canEditPendingSales, canEditSubscriptionTypes]);

  const motivationByCategoryId = useMemo(() => {
    const map = new Map<number, MotivationBonusRule>();
    bonusRules.forEach((rule) => {
      rule.categories.forEach((category) => {
        map.set(category.id, rule);
      });
    });
    return map;
  }, [bonusRules]);
  const saleSettingByItemName = useMemo(() => {
    const map = new Map<string, SaleSetting>();
    saleSettings.forEach((setting) => {
      map.set(normalizeItemKey(setting.itemName), setting);
    });
    return map;
  }, [saleSettings]);
  const activeSubscriptionTypes = useMemo(
    () => subscriptionTypes.filter((type) => type.status === 'active'),
    [subscriptionTypes],
  );
  const subscriptionTypeById = useMemo(() => {
    const map = new Map<number, SubscriptionType>();
    subscriptionTypes.forEach((type) => {
      map.set(type.id, type);
    });
    return map;
  }, [subscriptionTypes]);
  const getSaleIntent = useCallback(
    (itemName: string): SaleIntent =>
      saleSettingByItemName.get(normalizeItemKey(itemName))?.saleIntent ||
      'normal',
    [saleSettingByItemName],
  );
  const getSubscriptionTypeId = useCallback(
    (itemName: string): number | null => {
      const id = saleSettingByItemName.get(
        normalizeItemKey(itemName),
      )?.saleSettings?.subscriptionTypeId;
      return typeof id === 'number' && Number.isFinite(id) ? id : null;
    },
    [saleSettingByItemName],
  );
  const normalizedCatalogSearch = catalogSearch.trim().toLowerCase();
  const filteredUnmapped = useMemo(() => {
    if (!normalizedCatalogSearch) return unmapped;
    return unmapped.filter((itemName) => {
      const intent = getSaleIntent(itemName);
      const subscriptionTypeName =
        subscriptionTypeById.get(getSubscriptionTypeId(itemName) || 0)?.name ||
        '';
      return [itemName, SALE_INTENT_LABELS[intent], subscriptionTypeName].some((value) =>
        value.toLowerCase().includes(normalizedCatalogSearch),
      );
    });
  }, [
    getSaleIntent,
    getSubscriptionTypeId,
    normalizedCatalogSearch,
    subscriptionTypeById,
    unmapped,
  ]);
  const unmappedPageCount = Math.max(
    1,
    Math.ceil(filteredUnmapped.length / UNMAPPED_PAGE_SIZE),
  );
  const effectiveUnmappedPage = Math.min(unmappedPage, unmappedPageCount - 1);
  const pagedUnmapped = filteredUnmapped.slice(
    effectiveUnmappedPage * UNMAPPED_PAGE_SIZE,
    (effectiveUnmappedPage + 1) * UNMAPPED_PAGE_SIZE,
  );
  const filteredRules = useMemo(() => {
    if (!normalizedCatalogSearch) return rules;
    return rules.filter((rule) =>
      [
        rule.itemName,
        rule.category,
        SALE_INTENT_LABELS[getSaleIntent(rule.itemName)],
        subscriptionTypeById.get(getSubscriptionTypeId(rule.itemName) || 0)
          ?.name || '',
      ].some((value) =>
        value.toLowerCase().includes(normalizedCatalogSearch),
      ),
    );
  }, [
    getSaleIntent,
    getSubscriptionTypeId,
    normalizedCatalogSearch,
    rules,
    subscriptionTypeById,
  ]);
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
  const filteredPendingSales = useMemo(() => {
    if (!normalizedCatalogSearch) return pendingSales;
    return pendingSales.filter((sale) =>
      [
        sale.itemName,
        sale.category || '',
        sale.client?.name || '',
        sale.client?.phone || '',
        sale.evotorId || '',
        SALE_INTENT_LABELS[sale.saleIntent],
        PENDING_STATUS_LABELS[sale.status],
      ].some((value) => value.toLowerCase().includes(normalizedCatalogSearch)),
    );
  }, [normalizedCatalogSearch, pendingSales]);
  const filteredSubscriptionTypes = useMemo(() => {
    const byStatus = subscriptionTypes.filter(
      (type) => type.status === subscriptionTypeStatus,
    );
    if (!normalizedCatalogSearch) return byStatus;
    return byStatus.filter((type) =>
      [
        type.name,
        TRAINING_KIND_LABELS[type.trainingKind],
        TIME_SEGMENT_LABELS[type.timeSegment || 'all'],
        String(type.price),
        type.isUnlimited ? 'безлимит' : `${type.sessionsTotal} занятий`,
      ].some((value) => value.toLowerCase().includes(normalizedCatalogSearch)),
    );
  }, [normalizedCatalogSearch, subscriptionTypeStatus, subscriptionTypes]);

  const handleSaveSaleSetting = async (
    itemName: string,
    saleIntent: SaleIntent,
    saleSettings?: SaleSetting['saleSettings'],
  ) => {
    const savingKey = `${itemName}:${saleIntent}`;
    setSaleSettingSavingKey(savingKey);
    try {
      const payload = {
        itemName,
        saleIntent,
        saleSettings:
          saleIntent === 'subscription' && saleSettings
            ? saleSettings
            : null,
      };
      const res = await apiFetch('/api/catalog/sale-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось сохранить тип продажи'));
        return;
      }

      const setting = (await res.json()) as SaleSetting;
      setSaleSettings((prev) => {
        const next = prev.filter(
          (item) => normalizeItemKey(item.itemName) !== normalizeItemKey(itemName),
        );
        next.push(setting);
        return next.sort((a, b) => a.itemName.localeCompare(b.itemName, 'ru'));
      });
      await fetchData();
      toast.success('Тип продажи сохранен');
    } finally {
      setSaleSettingSavingKey('');
    }
  };

  const openUnmappedItemDialog = (itemName: string) => {
    const subscriptionTypeId = getSubscriptionTypeId(itemName);
    setMobileCategoryPath([]);
    setUnmappedDialogItem(itemName);
    setUnmappedItemForm({
      category: '',
      saleIntent: getSaleIntent(itemName),
      subscriptionTypeId: subscriptionTypeId
        ? String(subscriptionTypeId)
        : 'none',
    });
  };

  const handleSaveUnmappedItem = async () => {
    if (!unmappedDialogItem || !unmappedItemForm.category) return;
    if (!canEditRules) {
      showPermissionDenied(permissionMessages.catalogManage);
      return;
    }

    setUnmappedItemSaving(true);
    try {
      const saleSettings =
        unmappedItemForm.saleIntent === 'subscription' &&
        unmappedItemForm.subscriptionTypeId !== 'none'
          ? { subscriptionTypeId: Number(unmappedItemForm.subscriptionTypeId) }
          : null;
      if (canEditSaleSettings) {
        const saleSettingRes = await apiFetch('/api/catalog/sale-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemName: unmappedDialogItem,
            saleIntent: unmappedItemForm.saleIntent,
            saleSettings,
          }),
        });
        if (!saleSettingRes.ok) {
          toast.error(
            await readError(saleSettingRes, 'Не удалось сохранить тип продажи'),
          );
          return;
        }
      }

      const ruleRes = await apiFetch('/api/catalog/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemName: unmappedDialogItem,
          category: unmappedItemForm.category,
        }),
      });
      if (!ruleRes.ok) {
        toast.error(await readError(ruleRes, 'Не удалось сохранить правило товара'));
        return;
      }

      setUnmappedDialogItem(null);
      setUnmappedItemForm(EMPTY_UNMAPPED_ITEM_FORM);
      await fetchData();
      toast.success('Позиция распределена');
    } finally {
      setUnmappedItemSaving(false);
    }
  };

  const openLinkDialog = (sale: PendingSale) => {
    const saleSettings =
      saleSettingByItemName.get(normalizeItemKey(sale.itemName))?.saleSettings ||
      {};
    setLinkDialogSale(sale);
    setClientSearchInput('');
    setClientCandidates([]);
    setClientSearchError('');
    setSelectedClientId(null);
    setLinkComment('');
    setCertificateLinkForm({
      amountTotal:
        sale.saleIntent === 'certificate'
          ? String(Number(sale.amount || 0) || '')
          : '',
      certificateType:
        saleSettings.certificateType === 'service' ? 'service' : 'money',
      code: '',
      serviceName:
        typeof saleSettings.serviceName === 'string'
          ? saleSettings.serviceName
          : sale.itemName,
      unitsTotal: typeof saleSettings.unitsTotal === 'number'
        ? String(saleSettings.unitsTotal)
        : String(Math.max(1, Math.round(Number(sale.quantity || 1)))),
      validityDays: typeof saleSettings.validityDays === 'number'
        ? String(saleSettings.validityDays)
        : '365',
    });
  };

  const updateCertificateLinkForm = (
    field: keyof CertificateLinkFormState,
    value: string,
  ) => {
    setCertificateLinkForm((prev) => ({ ...prev, [field]: value }));
  };

  const loadClientCandidates = useCallback(async (query: string) => {
    const search = query.trim();
    if (search.length < 2) {
      setClientCandidates([]);
      setClientSearchError('');
      setClientSearchLoading(false);
      return;
    }

    setClientSearchLoading(true);
    setClientSearchError('');
    try {
      const params = new URLSearchParams({
        pageSize: '10',
        q: search,
        status: 'active',
      });
      const res = await apiFetch(`/api/clients?${params.toString()}`);
      if (!res.ok) {
        setClientCandidates([]);
        setClientSearchError(await readError(res, 'Не удалось найти клиентов'));
        return;
      }

      const data = (await res.json()) as { items?: ClientCandidate[] };
      setClientCandidates(data.items || []);
    } catch (error) {
      setClientCandidates([]);
      setClientSearchError(getApiErrorMessage(error, 'Не удалось найти клиентов'));
    } finally {
      setClientSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!linkDialogSale) return;
    const timeout = window.setTimeout(() => {
      void loadClientCandidates(clientSearchInput);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [clientSearchInput, linkDialogSale, loadClientCandidates]);

  const handleLinkPendingSale = async () => {
    if (!linkDialogSale || !selectedClientId) return;
    const certificatePayload =
      linkDialogSale.saleIntent === 'certificate'
        ? {
            amountTotal:
              certificateLinkForm.certificateType === 'money'
                ? certificateLinkForm.amountTotal
                : undefined,
            certificateType: certificateLinkForm.certificateType,
            code: certificateLinkForm.code,
            serviceName:
              certificateLinkForm.certificateType === 'service'
                ? certificateLinkForm.serviceName
                : undefined,
            unitsTotal:
              certificateLinkForm.certificateType === 'service'
                ? certificateLinkForm.unitsTotal
                : undefined,
            validityDays: certificateLinkForm.validityDays,
          }
        : undefined;

    setLinkLoading(true);
    try {
      const res = await apiFetch(
        `/api/catalog/pending-sales/${linkDialogSale.id}/link`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            certificate: certificatePayload,
            clientId: selectedClientId,
            comment: linkComment,
          }),
        },
      );

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось привязать продажу'));
        return;
      }

      setLinkDialogSale(null);
      await fetchData();
      toast.success('Продажа привязана к клиенту');
    } finally {
      setLinkLoading(false);
    }
  };

  const executeIgnorePendingSale = async (sale: PendingSale) => {
    const res = await apiFetch(`/api/catalog/pending-sales/${sale.id}/ignore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Игнорировано вручную' }),
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось игнорировать продажу'));
      return;
    }

    await fetchData();
    toast.success('Продажа убрана из очереди');
  };

  const executeCancelPendingSale = async (sale: PendingSale) => {
    const res = await apiFetch(`/api/catalog/pending-sales/${sale.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Отменено вручную' }),
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось отменить продажу'));
      return;
    }

    await fetchData();
    toast.success('Продажа отменена');
  };

  const requestIgnorePendingSale = (sale: PendingSale) => {
    setPendingAction({
      confirmLabel: 'Игнорировать',
      description: `Строка «${sale.itemName}» останется в истории, но исчезнет из рабочей очереди.`,
      isDestructive: true,
      onConfirm: () => executeIgnorePendingSale(sale),
      title: 'Игнорировать продажу?',
    });
  };

  const requestCancelPendingSale = (sale: PendingSale) => {
    setPendingAction({
      confirmLabel: 'Отменить',
      description: `Строка «${sale.itemName}» получит статус отмены. Источник из чека и история сохранятся.`,
      isDestructive: true,
      onConfirm: () => executeCancelPendingSale(sale),
      title: 'Отменить продажу?',
    });
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

  const openCreateSubscriptionType = () => {
    setEditingSubscriptionType(null);
    setSubscriptionForm(EMPTY_SUBSCRIPTION_TYPE_FORM);
    setSubscriptionDialogOpen(true);
  };

  const openEditSubscriptionType = (type: SubscriptionType) => {
    setEditingSubscriptionType(type);
    setSubscriptionForm({
      bonusPersonalSessions: String(type.bonusPersonalSessions || 0),
      description: type.description || '',
      isUnlimited: type.isUnlimited ? 'true' : 'false',
      name: type.name,
      price: String(type.price || ''),
      sessionsTotal: type.sessionsTotal === null ? '' : String(type.sessionsTotal),
      timeSegment: type.timeSegment || 'all',
      trainingKind: type.trainingKind,
      validityDays: String(type.validityDays || 30),
    });
    setSubscriptionDialogOpen(true);
  };

  const updateSubscriptionForm = (
    key: keyof SubscriptionTypeFormState,
    value: string,
  ) => {
    setSubscriptionForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const buildSubscriptionPayload = () => ({
    bonusPersonalSessions: subscriptionForm.bonusPersonalSessions || '0',
    description: subscriptionForm.description,
    isUnlimited: subscriptionForm.isUnlimited === 'true',
    name: subscriptionForm.name,
    price: subscriptionForm.price,
    serviceType: 'training',
    sessionsTotal:
      subscriptionForm.isUnlimited === 'true'
        ? null
        : subscriptionForm.sessionsTotal,
    timeSegment: subscriptionForm.timeSegment,
    trainingKind: subscriptionForm.trainingKind,
    validityDays: subscriptionForm.validityDays,
  });

  const handleSaveSubscriptionType = async () => {
    setSubscriptionSaving(true);
    try {
      const endpoint = editingSubscriptionType
        ? `/api/subscriptions/types/${editingSubscriptionType.id}`
        : '/api/subscriptions/types';
      const res = await apiFetch(endpoint, {
        method: editingSubscriptionType ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSubscriptionPayload()),
      });

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось сохранить тип абонемента'));
        return;
      }

      setSubscriptionDialogOpen(false);
      setEditingSubscriptionType(null);
      await fetchData();
      toast.success(
        editingSubscriptionType
          ? 'Тип абонемента обновлен'
          : 'Тип абонемента создан',
      );
    } finally {
      setSubscriptionSaving(false);
    }
  };

  const executeArchiveSubscriptionType = async (type: SubscriptionType) => {
    const res = await apiFetch(`/api/subscriptions/types/${type.id}/archive`, {
      method: 'POST',
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось архивировать тип абонемента'));
      return;
    }

    await fetchData();
    toast.success('Тип абонемента отправлен в архив');
  };

  const executeRestoreSubscriptionType = async (type: SubscriptionType) => {
    const res = await apiFetch(`/api/subscriptions/types/${type.id}/restore`, {
      method: 'POST',
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось восстановить тип абонемента'));
      return;
    }

    await fetchData();
    toast.success('Тип абонемента восстановлен');
  };

  const executePermanentDeleteSubscriptionType = async (
    type: SubscriptionType,
  ) => {
    const res = await apiFetch(`/api/subscriptions/types/${type.id}/permanent`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось удалить тип абонемента'));
      return;
    }

    await fetchData();
    toast.success('Тип абонемента удален из архива');
  };

  const requestArchiveSubscriptionType = (type: SubscriptionType) => {
    setPendingAction({
      confirmLabel: 'В архив',
      description: `Тип «${type.name}» исчезнет из активных настроек продаж. Уже купленные клиентские абонементы сохранят условия.`,
      isDestructive: true,
      onConfirm: () => executeArchiveSubscriptionType(type),
      title: 'Архивировать тип абонемента?',
    });
  };

  const requestRestoreSubscriptionType = (type: SubscriptionType) => {
    setPendingAction({
      confirmLabel: 'Восстановить',
      description: `Тип «${type.name}» снова можно будет выбрать в настройках продаж Эвотора.`,
      onConfirm: () => executeRestoreSubscriptionType(type),
      title: 'Восстановить тип абонемента?',
    });
  };

  const requestPermanentDeleteSubscriptionType = (type: SubscriptionType) => {
    setPendingAction({
      confirmLabel: 'Удалить навсегда',
      description: `Тип «${type.name}» будет удален без возможности восстановления. Сервер не даст удалить тип, если по нему уже есть клиентские абонементы.`,
      isDestructive: true,
      onConfirm: () => executePermanentDeleteSubscriptionType(type),
      title: 'Удалить тип абонемента из архива?',
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
    if (!canEditCategories) {
      showPermissionDenied(permissionMessages.catalogManage);
      return;
    }

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
    pending: 'очереди продаж',
    rules: 'правилам',
    subscriptions: 'типам абонементов',
    unmapped: 'товарам без правил',
  }[activeTab];
  const hasCatalogData =
    unmapped.length > 0 ||
    rules.length > 0 ||
    categories.length > 0 ||
    pendingSales.length > 0 ||
    subscriptionTypes.length > 0;

  // ФУНКЦИЯ ДЛЯ ОБНОВЛЕНИЯ РОДИТЕЛЯ ИЗ ТАБЛИЦЫ
  const handleUpdateParent = async (
    categoryId: number,
    newParentId: string,
  ) => {
    if (!canEditCategories) {
      showPermissionDenied(permissionMessages.catalogManage);
      return;
    }

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
    if (!canEditMotivation) {
      showPermissionDenied(permissionMessages.motivationManage);
      return;
    }

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
  const renderSaleIntentSelect = (itemName: string) => {
    const value = getSaleIntent(itemName);
    const saving = saleSettingSavingKey.startsWith(`${itemName}:`);

    return (
      <Select
        value={value}
        disabled={!canEditSaleSettings || saving}
        onValueChange={(nextValue) =>
          handleSaveSaleSetting(itemName, nextValue as SaleIntent)
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SALE_INTENT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };
  const renderSubscriptionTypeSelect = (itemName: string) => {
    const intent = getSaleIntent(itemName);
    if (intent !== 'subscription') {
      return <span className="text-sm text-muted-foreground">-</span>;
    }

    const value = getSubscriptionTypeId(itemName);
    const saving = saleSettingSavingKey.startsWith(`${itemName}:`);

    return (
      <Select
        value={value ? String(value) : 'none'}
        disabled={!canEditSaleSettings || saving || activeSubscriptionTypes.length === 0}
        onValueChange={(nextValue) =>
          handleSaveSaleSetting(
            itemName,
            'subscription',
            nextValue === 'none'
              ? null
              : { subscriptionTypeId: Number(nextValue) },
          )
        }
      >
        <SelectTrigger className="w-[260px]">
          <SelectValue
            placeholder={
              activeSubscriptionTypes.length === 0
                ? 'Нет активных типов'
                : 'Выберите тип'
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Тип не выбран</SelectItem>
          {activeSubscriptionTypes.map((type) => (
            <SelectItem key={type.id} value={String(type.id)}>
              {type.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };
  const renderSaleIntentBadge = (intent: SaleIntent) => {
    if (intent === 'subscription') {
      return (
        <Badge variant="secondary" className="gap-1">
          <Ticket className="h-3 w-3" />
          {SALE_INTENT_LABELS[intent]}
        </Badge>
      );
    }
    if (intent === 'certificate') {
      return (
        <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
          <Ticket className="h-3 w-3" />
          {SALE_INTENT_LABELS[intent]}
        </Badge>
      );
    }
    return <Badge variant="outline">{SALE_INTENT_LABELS[intent]}</Badge>;
  };
  const formatSubscriptionSessions = (type: SubscriptionType) => {
    if (type.isUnlimited) return 'Безлимит';
    return `${type.sessionsTotal || 0} занятий`;
  };
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
      id: 'saleIntent',
      header: 'Тип продажи',
      size: 210,
      cell: ({ row }) => renderSaleIntentSelect(row.original.itemName),
    },
    {
      id: 'subscriptionType',
      header: 'Тип абонемента',
      size: 290,
      cell: ({ row }) => renderSubscriptionTypeSelect(row.original.itemName),
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
            <PermissionActionButton
              allowed={canEditRules}
              variant="ghost"
              size="icon"
              onClick={() => requestRestoreRule(rule)}
              deniedMessage={permissionMessages.catalogManage}
              aria-label={`Восстановить правило для ${rule.itemName}`}
              title="Восстановить"
            >
              <ArchiveRestore className="h-4 w-4" />
            </PermissionActionButton>
            <PermissionActionButton
              allowed={canEditRules}
              variant="ghost"
              size="icon"
              onClick={() => requestPermanentDeleteRule(rule)}
              deniedMessage={permissionMessages.catalogManage}
              aria-label={`Удалить навсегда правило для ${rule.itemName}`}
              title="Удалить навсегда"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </PermissionActionButton>
          </div>
        ) : (
          <PermissionActionButton
            allowed={canEditRules}
            variant="ghost"
            size="icon"
            onClick={() => requestArchiveRule(rule)}
            deniedMessage={permissionMessages.catalogManage}
            aria-label={`Архивировать правило для ${rule.itemName}`}
            title="В архив"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </PermissionActionButton>
        );
      },
    },
  ];
  const pendingSaleColumns: ColumnDef<PendingSale>[] = [
    {
      accessorKey: 'itemName',
      header: 'Строка Эвотора',
      size: 220,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.original.itemName}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {row.original.category || 'P&L: неразобрано'}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'saleIntent',
      header: 'Тип',
      size: 140,
      cell: ({ row }) => renderSaleIntentBadge(row.original.saleIntent),
    },
    {
      accessorKey: 'amount',
      header: 'Сумма',
      size: 120,
      cell: ({ row }) => (
        <span className="font-medium">{formatMoney(row.original.amount)}</span>
      ),
    },
    {
      id: 'receipt',
      header: 'Чек',
      size: 180,
      cell: ({ row }) => (
        <div className="min-w-0 text-sm">
          <div className="truncate">{row.original.evotorId || '-'}</div>
          <div className="text-xs text-muted-foreground">
            {formatDateTime(row.original.receiptDateTime)}
          </div>
        </div>
      ),
    },
    {
      id: 'client',
      header: 'Клиент',
      size: 180,
      cell: ({ row }) =>
        row.original.client ? (
          <div className="min-w-0 text-sm">
            <div className="truncate font-medium">{row.original.client.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.client.phone}
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground">Не привязан</span>
        ),
    },
    {
      accessorKey: 'status',
      header: 'Статус',
      size: 130,
      cell: ({ row }) => (
        <Badge
          variant={row.original.status === 'pending' ? 'default' : 'outline'}
        >
          {PENDING_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: '',
      size: 150,
      meta: {
        cellClassName: 'text-right',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => {
        const sale = row.original;
        if (!canEditPendingSales) return null;

        if (sale.status === 'pending') {
          return (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => openLinkDialog(sale)}
                aria-label={`Привязать продажу ${sale.itemName}`}
                title="Привязать"
              >
                <Link2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => requestIgnorePendingSale(sale)}
                aria-label={`Игнорировать продажу ${sale.itemName}`}
                title="Игнорировать"
              >
                <Ban className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => requestCancelPendingSale(sale)}
                aria-label={`Отменить продажу ${sale.itemName}`}
                title="Отменить"
              >
                <XCircle className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          );
        }

        if (sale.status === 'linked') {
          return (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => requestCancelPendingSale(sale)}
              aria-label={`Отменить привязанную продажу ${sale.itemName}`}
              title="Отменить"
            >
              <XCircle className="h-4 w-4 text-destructive" />
            </Button>
          );
        }

        return null;
      },
    },
  ];
  const subscriptionTypeColumns: ColumnDef<SubscriptionType>[] = [
    {
      accessorKey: 'name',
      header: 'Тип абонемента',
      size: 260,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.original.name}</div>
          {row.original.description && (
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {row.original.description}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'kind',
      header: 'Формат',
      size: 190,
      cell: ({ row }) => (
        <div className="space-y-1">
          <Badge variant="outline">
            {TRAINING_KIND_LABELS[row.original.trainingKind]}
          </Badge>
          <div className="text-xs text-muted-foreground">
            {TIME_SEGMENT_LABELS[row.original.timeSegment || 'all']}
          </div>
        </div>
      ),
    },
    {
      id: 'limits',
      header: 'Остаток и срок',
      size: 180,
      cell: ({ row }) => (
        <div className="text-sm">
          <div className="font-medium">
            {formatSubscriptionSessions(row.original)}
          </div>
          <div className="text-xs text-muted-foreground">
            {row.original.validityDays} дней
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'price',
      header: 'Цена',
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium">{formatMoney(row.original.price)}</span>
      ),
    },
    {
      id: 'bonus',
      header: 'Бонус',
      size: 130,
      cell: ({ row }) =>
        row.original.bonusPersonalSessions > 0 ? (
          <Badge variant="secondary">
            +{row.original.bonusPersonalSessions} перс.
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
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
            <SelectTrigger
              aria-label={
                canEditMotivation
                  ? undefined
                  : `Мотивация: ${permissionMessages.motivationManage}`
              }
              className="w-full border-dashed bg-transparent"
              title={
                canEditMotivation
                  ? undefined
                  : permissionMessages.motivationManage
              }
            >
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
            disabled={!canEditCategories}
            onValueChange={(val) => handleUpdateParent(category.id, val)}
          >
            <SelectTrigger
              className="w-full border-dashed bg-transparent"
              title={!canEditCategories ? permissionMessages.catalogManage : undefined}
            >
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

        if (!canEditCategories || category.isSystem) return null;

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

  const getCategoryPath = (categoryName: string) => {
    const category = categories.find((item) => item.name === categoryName);
    if (!category) return categoryName;

    const path = [category.name];
    const visited = new Set<number>([category.id]);
    let parentId = category.parentId;
    while (parentId) {
      if (visited.has(parentId)) break;
      visited.add(parentId);
      const parent = categories.find((item) => item.id === parentId);
      if (!parent) break;
      path.unshift(parent.name);
      parentId = parent.parentId;
    }
    return path.join(' → ');
  };

  const renderCategoryMenuLevel = (
    parentId: number | null,
    ancestors = new Set<number>(),
  ): ReactNode =>
    categories
      .filter((category) => category.parentId === parentId)
      .toSorted((left, right) => left.name.localeCompare(right.name, 'ru'))
      .map((category) => {
        if (ancestors.has(category.id)) return null;
        const children = categories.filter(
          (candidate) => candidate.parentId === category.id,
        );
        if (children.length === 0) {
          return (
            <DropdownMenuItem
              key={category.id}
              onSelect={() =>
                setUnmappedItemForm((current) => ({
                  ...current,
                  category: category.name,
                }))
              }
            >
              {category.name}
            </DropdownMenuItem>
          );
        }

        const nextAncestors = new Set(ancestors);
        nextAncestors.add(category.id);
        return (
          <DropdownMenuSub key={category.id}>
            <DropdownMenuSubTrigger>{category.name}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-w-[min(18rem,calc(100vw-2rem))]">
              <DropdownMenuLabel className="break-words">
                {category.name}
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() =>
                  setUnmappedItemForm((current) => ({
                    ...current,
                    category: category.name,
                  }))
                }
              >
                Выбрать эту категорию
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {renderCategoryMenuLevel(category.id, nextAncestors)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        );
      });
  const mobileCategoryParentId = mobileCategoryPath.at(-1) ?? null;
  const mobileCategoryParent = mobileCategoryParentId
    ? categories.find((category) => category.id === mobileCategoryParentId) || null
    : null;
  const mobileCategoryOptions = categories
    .filter((category) => category.parentId === mobileCategoryParentId)
    .toSorted((left, right) => left.name.localeCompare(right.name, 'ru'));

  const certificateLinkInvalid =
    linkDialogSale?.saleIntent === 'certificate' &&
    (Number(certificateLinkForm.validityDays) <= 0 ||
      (certificateLinkForm.certificateType === 'money' &&
        Number(certificateLinkForm.amountTotal) <= 0) ||
      (certificateLinkForm.certificateType === 'service' &&
        (Number(certificateLinkForm.unitsTotal) <= 0 ||
          !certificateLinkForm.serviceName.trim())));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-xl border bg-card/60 p-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {activeTab !== 'pending' && activeTab !== 'subscriptions' && (
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
          )}
          {activeTab === 'subscriptions' && (
            <Select
              value={subscriptionTypeStatus}
              onValueChange={(value) =>
                setSubscriptionTypeStatus(value as SubscriptionTypeStatus)
              }
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Активные</SelectItem>
                <SelectItem value="archived">Архив</SelectItem>
              </SelectContent>
            </Select>
          )}
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
            {canEditPendingSales && (
              <Button
                variant={activeTab === 'pending' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('pending')}
              >
                Очередь ({pendingSales.length})
              </Button>
            )}
            {canEditSubscriptionTypes && (
              <Button
                variant={activeTab === 'subscriptions' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('subscriptions')}
              >
                Абонементы ({subscriptionTypes.length})
              </Button>
            )}
            <Button
              variant={activeTab === 'categories' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('categories')}
            >
              Категории ({categories.length})
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center xl:justify-end">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={catalogSearch}
              onChange={(event) => {
                setCatalogSearch(event.target.value);
                setUnmappedPage(0);
              }}
              placeholder={`Поиск по ${activeTabLabel}`}
              className="pl-9"
            />
          </div>
          <div className="whitespace-nowrap text-sm text-muted-foreground">
            {activeTab === 'unmapped' &&
              `${filteredUnmapped.length} из ${unmapped.length}`}
            {activeTab === 'rules' && `${filteredRules.length} из ${rules.length}`}
            {activeTab === 'categories' &&
              `${filteredCategories.length} из ${categories.length}`}
            {activeTab === 'pending' &&
              `${filteredPendingSales.length} из ${pendingSales.length}`}
            {activeTab === 'subscriptions' &&
              `${filteredSubscriptionTypes.length} из ${
                subscriptionTypes.filter((type) => type.status === subscriptionTypeStatus)
                  .length
              }`}
          </div>
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
            {!canEditRules && (
              <PermissionHint className="mb-4">
                {permissionMessages.catalogManage}
              </PermissionHint>
            )}
            {catalogLoading && unmapped.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Загрузка товаров...
              </div>
            ) : filteredUnmapped.length > 0 ? (
              <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {pagedUnmapped.map((itemName) => {
                  const saleIntent = getSaleIntent(itemName);
                  const subscriptionType = subscriptionTypeById.get(
                    getSubscriptionTypeId(itemName) || 0,
                  );

                  return (
                    <button
                      key={itemName}
                      type="button"
                      className="min-w-0 rounded-xl border bg-card p-4 text-left shadow-sm transition enabled:hover:border-primary/40 enabled:hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                      disabled={!canEditRules}
                      onClick={() => openUnmappedItemDialog(itemName)}
                    >
                      <div className="break-words font-semibold">{itemName}</div>
                      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
                        {renderSaleIntentBadge(saleIntent)}
                        {subscriptionType && (
                          <span className="min-w-0 break-words text-xs text-muted-foreground">
                            {subscriptionType.name}
                          </span>
                        )}
                      </div>
                      {canEditRules && (
                        <div className="mt-3 text-xs font-medium text-primary">
                          Разобрать позицию
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : unmapped.length > 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                По текущему поиску товаров не найдено.
              </div>
            ) : null}
            {filteredUnmapped.length > UNMAPPED_PAGE_SIZE && (
              <div className="mt-4 flex flex-col gap-3 border-t pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="text-muted-foreground">
                  Показано{' '}
                  {effectiveUnmappedPage * UNMAPPED_PAGE_SIZE + 1}-
                  {Math.min(
                    filteredUnmapped.length,
                    (effectiveUnmappedPage + 1) * UNMAPPED_PAGE_SIZE,
                  )}{' '}
                  из {filteredUnmapped.length}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={effectiveUnmappedPage === 0}
                    onClick={() =>
                      setUnmappedPage(Math.max(0, effectiveUnmappedPage - 1))
                    }
                  >
                    Назад
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={effectiveUnmappedPage >= unmappedPageCount - 1}
                    onClick={() =>
                      setUnmappedPage(
                        Math.min(unmappedPageCount - 1, effectiveUnmappedPage + 1),
                      )
                    }
                  >
                    Далее
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(!catalogError || hasCatalogData) && activeTab === 'rules' && (
        <Card>
          <CardHeader>
            <CardTitle>Сохраненные правила</CardTitle>
          </CardHeader>
          <CardContent>
            {!canEditRules && (
              <PermissionHint className="mb-4">
                {permissionMessages.catalogManage}
              </PermissionHint>
            )}
            <DataTable
              columns={ruleColumns}
              data={filteredRules}
              emptyText="Сохраненных правил пока нет."
              loading={catalogLoading && filteredRules.length === 0}
              loadingText="Загрузка правил..."
              minWidthClassName="min-w-[1100px]"
              pageSize={25}
            />
          </CardContent>
        </Card>
      )}

      {(!catalogError || hasCatalogData) &&
        activeTab === 'pending' &&
        canEditPendingSales && (
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>Очередь привязки продаж</CardTitle>
              <Select
                value={pendingStatus}
                onValueChange={(value) => setPendingStatus(value as PendingSaleStatus)}
              >
                <SelectTrigger className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    [
                      'pending',
                      'linked',
                      'ignored',
                      'canceled',
                      'all',
                    ] as PendingSaleStatus[]
                  ).map((status) => (
                    <SelectItem key={status} value={status}>
                      {PENDING_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={pendingSaleColumns}
                data={filteredPendingSales}
                emptyText="В очереди нет продаж по текущему фильтру."
                loading={catalogLoading && filteredPendingSales.length === 0}
                loadingText="Загрузка очереди..."
                minWidthClassName="min-w-[1020px]"
                pageSize={25}
              />
            </CardContent>
          </Card>
        )}

      {(!catalogError || hasCatalogData) &&
        activeTab === 'subscriptions' &&
        canEditSubscriptionTypes && (
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>Типы абонементов</CardTitle>
              <Button
                type="button"
                size="sm"
                onClick={openCreateSubscriptionType}
                disabled={!canEditSubscriptionTypes}
              >
                <Plus className="mr-2 h-4 w-4" />
                Тип
              </Button>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={subscriptionTypeColumns}
                data={filteredSubscriptionTypes}
                emptyText="Типы абонементов не найдены."
                loading={catalogLoading && filteredSubscriptionTypes.length === 0}
                loadingText="Загрузка типов абонементов..."
                pageSize={25}
                getRowProps={(row) => ({
                  className:
                    'cursor-pointer hover:bg-muted/50 focus-within:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  onClick: () => openEditSubscriptionType(row.original),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openEditSubscriptionType(row.original);
                    }
                  },
                  role: 'button',
                  tabIndex: 0,
                })}
                tableClassName="table-fixed"
                renderMobileCard={(row) => {
                  const type = row.original;

                  return (
                    <button
                      type="button"
                      className="w-full min-w-0 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => openEditSubscriptionType(type)}
                    >
                      <div className="break-words font-semibold">{type.name}</div>
                      {type.description && (
                        <div className="mt-1 break-words text-xs text-muted-foreground">
                          {type.description}
                        </div>
                      )}
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">Формат</div>
                          <div className="mt-1">
                            {TRAINING_KIND_LABELS[type.trainingKind]}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {TIME_SEGMENT_LABELS[type.timeSegment || 'all']}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Цена</div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(type.price)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Лимит</div>
                          <div className="mt-1">{formatSubscriptionSessions(type)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Срок</div>
                          <div className="mt-1">{type.validityDays} дней</div>
                        </div>
                      </div>
                      <div className="mt-3 text-xs font-medium text-primary">
                        Открыть настройки и действия
                      </div>
                    </button>
                  );
                }}
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
            {!canEditCategories && (
              <PermissionHint>{permissionMessages.catalogManage}</PermissionHint>
            )}
            {canEditCategories && catalogStatus === 'active' && (
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
                loading={catalogLoading && filteredCategories.length === 0}
                loadingText="Загрузка категорий..."
                minWidthClassName="min-w-[860px] table-fixed"
                pageSize={25}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={Boolean(unmappedDialogItem)}
        onOpenChange={(open) => {
          if (!open && !unmappedItemSaving) {
            setUnmappedDialogItem(null);
            setUnmappedItemForm(EMPTY_UNMAPPED_ITEM_FORM);
            setMobileCategoryPath([]);
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Разобрать позицию</DialogTitle>
            <DialogDescription className="break-words">
              {unmappedDialogItem || ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Категория P&amp;L</Label>
              <DropdownMenu
                onOpenChange={(open) => {
                  if (!open) setMobileCategoryPath([]);
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-9 w-full min-w-0 justify-between whitespace-normal text-left font-normal"
                    disabled={unmappedItemSaving}
                  >
                    <span className="min-w-0 break-words">
                      {unmappedItemForm.category
                        ? getCategoryPath(unmappedItemForm.category)
                        : 'Выберите категорию'}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-[min(24rem,70dvh)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto"
                >
                  <div className="md:hidden">
                    {mobileCategoryParent && (
                      <>
                        <DropdownMenuItem
                          onSelect={(event) => {
                            event.preventDefault();
                            setMobileCategoryPath((current) => current.slice(0, -1));
                          }}
                        >
                          <ChevronLeft className="h-4 w-4" />
                          Назад
                        </DropdownMenuItem>
                        <DropdownMenuLabel className="break-words">
                          {getCategoryPath(mobileCategoryParent.name)}
                        </DropdownMenuLabel>
                        <DropdownMenuItem
                          onSelect={() =>
                            setUnmappedItemForm((current) => ({
                              ...current,
                              category: mobileCategoryParent.name,
                            }))
                          }
                        >
                          Выбрать эту категорию
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    {!mobileCategoryParent && (
                      <>
                        <DropdownMenuLabel>
                          Категории верхнего уровня
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    {mobileCategoryOptions.map((category) => {
                      const hasChildren = categories.some(
                        (candidate) => candidate.parentId === category.id,
                      );

                      return (
                        <DropdownMenuItem
                          key={category.id}
                          onSelect={(event) => {
                            if (hasChildren) {
                              event.preventDefault();
                              setMobileCategoryPath((current) => [
                                ...current,
                                category.id,
                              ]);
                              return;
                            }
                            setUnmappedItemForm((current) => ({
                              ...current,
                              category: category.name,
                            }));
                          }}
                        >
                          <span className="min-w-0 flex-1 break-words">
                            {category.name}
                          </span>
                          {hasChildren && (
                            <ChevronRight className="ml-auto h-4 w-4 shrink-0" />
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                  <div className="hidden md:block">
                    <DropdownMenuLabel>Категории верхнего уровня</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {renderCategoryMenuLevel(null)}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
              <p className="text-xs text-muted-foreground">
                Категории с дочерними пунктами раскрываются во вложенное меню.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Тип продажи</Label>
              <Select
                value={unmappedItemForm.saleIntent}
                disabled={!canEditSaleSettings || unmappedItemSaving}
                onValueChange={(value) =>
                  setUnmappedItemForm((current) => ({
                    ...current,
                    saleIntent: value as SaleIntent,
                    subscriptionTypeId:
                      value === 'subscription'
                        ? current.subscriptionTypeId
                        : 'none',
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SALE_INTENT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!canEditSaleSettings && (
                <p className="text-xs text-muted-foreground">
                  Тип продажи доступен только для просмотра по вашей роли.
                </p>
              )}
            </div>

            {unmappedItemForm.saleIntent === 'subscription' && (
              <div className="space-y-2">
                <Label>Тип абонемента</Label>
                <Select
                  value={unmappedItemForm.subscriptionTypeId}
                  disabled={
                    !canEditSaleSettings ||
                    unmappedItemSaving ||
                    activeSubscriptionTypes.length === 0
                  }
                  onValueChange={(value) =>
                    setUnmappedItemForm((current) => ({
                      ...current,
                      subscriptionTypeId: value,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={
                        activeSubscriptionTypes.length === 0
                          ? 'Нет активных типов'
                          : 'Выберите тип абонемента'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Тип не выбран</SelectItem>
                    {activeSubscriptionTypes.map((type) => (
                      <SelectItem key={type.id} value={String(type.id)}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={unmappedItemSaving}
              onClick={() => {
                setUnmappedDialogItem(null);
                setUnmappedItemForm(EMPTY_UNMAPPED_ITEM_FORM);
                setMobileCategoryPath([]);
              }}
            >
              Отмена
            </Button>
            <Button
              type="button"
              disabled={
                unmappedItemSaving ||
                !unmappedItemForm.category ||
                (canEditSaleSettings &&
                  unmappedItemForm.saleIntent === 'subscription' &&
                  unmappedItemForm.subscriptionTypeId === 'none')
              }
              onClick={() => void handleSaveUnmappedItem()}
            >
              {unmappedItemSaving ? 'Сохраняем...' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(linkDialogSale)}
        onOpenChange={(open) => {
          if (!open && !linkLoading) setLinkDialogSale(null);
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Привязать продажу</DialogTitle>
            <DialogDescription>
              {linkDialogSale
                ? `${linkDialogSale.itemName} · ${formatMoney(linkDialogSale.amount)}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pending-sale-client-search">Клиент</Label>
              <Input
                id="pending-sale-client-search"
                value={clientSearchInput}
                onChange={(event) => {
                  setClientSearchInput(event.target.value);
                  setSelectedClientId(null);
                }}
                placeholder="Имя или телефон"
              />
            </div>

            <div className="min-h-[120px] rounded-md border">
              {clientSearchLoading && (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Поиск клиентов...
                </div>
              )}
              {!clientSearchLoading && clientSearchError && (
                <div className="p-3 text-sm text-destructive">
                  {clientSearchError}
                </div>
              )}
              {!clientSearchLoading &&
                !clientSearchError &&
                clientSearchInput.trim().length < 2 && (
                  <div className="p-3 text-sm text-muted-foreground">
                    Введите минимум 2 символа.
                  </div>
                )}
              {!clientSearchLoading &&
                !clientSearchError &&
                clientSearchInput.trim().length >= 2 &&
                clientCandidates.length === 0 && (
                  <div className="p-3 text-sm text-muted-foreground">
                    Клиенты не найдены.
                  </div>
                )}
              {!clientSearchLoading &&
                !clientSearchError &&
                clientCandidates.length > 0 && (
                  <div className="divide-y">
                    {clientCandidates.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        className={
                          selectedClientId === client.id
                            ? 'flex w-full items-center justify-between gap-3 bg-primary/10 px-3 py-2 text-left'
                            : 'flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted'
                        }
                        onClick={() => setSelectedClientId(client.id)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {client.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {client.phone}
                          </span>
                        </span>
                        {selectedClientId === client.id && (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
            </div>

            {linkDialogSale?.saleIntent === 'certificate' && (
              <div className="grid grid-cols-1 gap-4 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Тип сертификата</Label>
                  <Select
                    value={certificateLinkForm.certificateType}
                    onValueChange={(value) =>
                      updateCertificateLinkForm(
                        'certificateType',
                        value as CertificateLinkFormState['certificateType'],
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="money">Денежный</SelectItem>
                      <SelectItem value="service">Услуга/пакет</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pending-sale-certificate-code">Код</Label>
                  <Input
                    id="pending-sale-certificate-code"
                    value={certificateLinkForm.code}
                    onChange={(event) =>
                      updateCertificateLinkForm('code', event.target.value)
                    }
                    placeholder="Авто"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pending-sale-certificate-validity">
                    Срок, дней
                  </Label>
                  <Input
                    id="pending-sale-certificate-validity"
                    type="number"
                    min="1"
                    value={certificateLinkForm.validityDays}
                    onChange={(event) =>
                      updateCertificateLinkForm('validityDays', event.target.value)
                    }
                  />
                </div>
                {certificateLinkForm.certificateType === 'money' ? (
                  <div className="space-y-2">
                    <Label htmlFor="pending-sale-certificate-amount">
                      Номинал
                    </Label>
                    <Input
                      id="pending-sale-certificate-amount"
                      type="number"
                      min="1"
                      step="1"
                      value={certificateLinkForm.amountTotal}
                      onChange={(event) =>
                        updateCertificateLinkForm('amountTotal', event.target.value)
                      }
                    />
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="pending-sale-certificate-units">
                        Количество
                      </Label>
                      <Input
                        id="pending-sale-certificate-units"
                        type="number"
                        min="1"
                        step="1"
                        value={certificateLinkForm.unitsTotal}
                        onChange={(event) =>
                          updateCertificateLinkForm('unitsTotal', event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="pending-sale-certificate-service">
                        Услуга
                      </Label>
                      <Input
                        id="pending-sale-certificate-service"
                        value={certificateLinkForm.serviceName}
                        onChange={(event) =>
                          updateCertificateLinkForm(
                            'serviceName',
                            event.target.value,
                          )
                        }
                        placeholder={linkDialogSale.itemName}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="pending-sale-link-comment">Комментарий</Label>
              <Input
                id="pending-sale-link-comment"
                value={linkComment}
                onChange={(event) => setLinkComment(event.target.value)}
                placeholder="Опционально"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLinkDialogSale(null)}
              disabled={linkLoading}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => void handleLinkPendingSale()}
              disabled={!selectedClientId || linkLoading || Boolean(certificateLinkInvalid)}
            >
              {linkLoading ? 'Привязываем...' : 'Привязать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={subscriptionDialogOpen}
        onOpenChange={(open) => {
          if (!open && !subscriptionSaving) {
            setSubscriptionDialogOpen(false);
            setEditingSubscriptionType(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>
              {editingSubscriptionType
                ? 'Изменить тип абонемента'
                : 'Новый тип абонемента'}
            </DialogTitle>
            <DialogDescription>
              Тариф для продаж Эвотора и будущих клиентских абонементов.
            </DialogDescription>
            {editingSubscriptionType && (
              <Badge variant="outline">
                {SUBSCRIPTION_STATUS_LABELS[editingSubscriptionType.status]}
              </Badge>
            )}
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="subscription-type-name">Название</Label>
              <Input
                id="subscription-type-name"
                value={subscriptionForm.name}
                onChange={(event) =>
                  updateSubscriptionForm('name', event.target.value)
                }
                placeholder="Например: Групповые 4 занятия"
              />
            </div>
            <div className="space-y-2">
              <Label>Формат</Label>
              <Select
                value={subscriptionForm.trainingKind}
                onValueChange={(value) =>
                  updateSubscriptionForm(
                    'trainingKind',
                    value as SubscriptionTrainingKind,
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="group">Групповые</SelectItem>
                  <SelectItem value="personal">Персональные</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Период</Label>
              <Select
                value={subscriptionForm.timeSegment}
                onValueChange={(value) =>
                  updateSubscriptionForm(
                    'timeSegment',
                    value as SubscriptionTimeSegment,
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Любое время</SelectItem>
                  <SelectItem value="off_peak">Будни 10:00-17:00</SelectItem>
                  <SelectItem value="standard">
                    День/вечер/выходные
                  </SelectItem>
                  <SelectItem value="single">Разовое</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Занятия</Label>
              <Select
                value={subscriptionForm.isUnlimited}
                onValueChange={(value) =>
                  updateSubscriptionForm('isUnlimited', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">Фиксированно</SelectItem>
                  <SelectItem value="true">Безлимит</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-type-sessions">Количество</Label>
              <Input
                id="subscription-type-sessions"
                type="number"
                min="1"
                value={subscriptionForm.sessionsTotal}
                onChange={(event) =>
                  updateSubscriptionForm('sessionsTotal', event.target.value)
                }
                disabled={subscriptionForm.isUnlimited === 'true'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-type-validity">Срок, дней</Label>
              <Input
                id="subscription-type-validity"
                type="number"
                min="1"
                value={subscriptionForm.validityDays}
                onChange={(event) =>
                  updateSubscriptionForm('validityDays', event.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-type-price">Цена</Label>
              <Input
                id="subscription-type-price"
                type="number"
                min="0"
                step="1"
                value={subscriptionForm.price}
                onChange={(event) =>
                  updateSubscriptionForm('price', event.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-type-bonus">Бонус перс.</Label>
              <Input
                id="subscription-type-bonus"
                type="number"
                min="0"
                value={subscriptionForm.bonusPersonalSessions}
                onChange={(event) =>
                  updateSubscriptionForm(
                    'bonusPersonalSessions',
                    event.target.value,
                  )
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="subscription-type-description">Описание</Label>
              <Input
                id="subscription-type-description"
                value={subscriptionForm.description}
                onChange={(event) =>
                  updateSubscriptionForm('description', event.target.value)
                }
                placeholder="Опционально"
              />
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {editingSubscriptionType?.status === 'active' && (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={subscriptionSaving}
                  onClick={() => {
                    const target = editingSubscriptionType;
                    setSubscriptionDialogOpen(false);
                    setEditingSubscriptionType(null);
                    requestArchiveSubscriptionType(target);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  В архив
                </Button>
              )}
              {editingSubscriptionType?.status === 'archived' && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={subscriptionSaving}
                    onClick={() => {
                      const target = editingSubscriptionType;
                      setSubscriptionDialogOpen(false);
                      setEditingSubscriptionType(null);
                      requestRestoreSubscriptionType(target);
                    }}
                  >
                    <ArchiveRestore className="mr-2 h-4 w-4" />
                    Восстановить
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={subscriptionSaving}
                    onClick={() => {
                      const target = editingSubscriptionType;
                      setSubscriptionDialogOpen(false);
                      setEditingSubscriptionType(null);
                      requestPermanentDeleteSubscriptionType(target);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Удалить
                  </Button>
                </>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSubscriptionDialogOpen(false);
                  setEditingSubscriptionType(null);
                }}
                disabled={subscriptionSaving}
              >
                Отмена
              </Button>
              <Button
                type="button"
                onClick={() => void handleSaveSubscriptionType()}
                disabled={
                  subscriptionSaving ||
                  !subscriptionForm.name.trim() ||
                  !subscriptionForm.price ||
                  !subscriptionForm.validityDays ||
                  (subscriptionForm.isUnlimited === 'false' &&
                    !subscriptionForm.sessionsTotal)
                }
              >
                {subscriptionSaving ? 'Сохраняем...' : 'Сохранить'}
              </Button>
            </div>
          </DialogFooter>
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
