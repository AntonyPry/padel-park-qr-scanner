import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { format } from 'date-fns';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Pencil,
  Percent,
  Play,
  Plus,
  Save,
  Square,
  Tags,
  Trash2,
  Trophy,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import { DataTable } from '@/components/data-table';
import { ErrorState } from '@/components/error-state';
import { toast } from '@/components/ui/toast';
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
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import {
  calculateBasePay,
  formatRuleValue,
  formatThreshold,
  getThresholdLabel,
  rulesToMap,
  type MotivationBonusRule,
  type MotivationCategory,
  type MotivationRule,
  type MotivationRulesMap,
  type MotivationThresholdType,
} from '@/lib/motivation';
import { canManageMotivation } from '@/lib/permissions';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useAuth } from '@/lib/useAuth';

interface FinanceRecord {
  categoryId?: number | null;
  category: string;
  amount: number;
  type: 'income' | 'expense' | string;
  source: string;
  date: string;
  comment?: string;
  paymentCash?: number;
  paymentCashless?: number;
  paymentMethod?: 'cash' | 'cashless' | 'mixed' | 'unknown' | string;
  paymentSource?: string | null;
  receiptId?: number;
  qty?: number;
}

interface PaymentSummary {
  cash: number;
  cashless: number;
  total: number;
}

interface CurrentSalesResponse {
  paymentSummary?: Partial<PaymentSummary>;
  records: FinanceRecord[];
}

type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<boolean | void> | boolean | void;
};

interface BonusRecord extends FinanceRecord {
  bonusRuleIds: number[];
  bonusRuleNames: string[];
  earned: number;
  qty: number;
  rate: number;
  value: number;
}

interface ShiftSession {
  id: number;
  date: string;
  staffId?: number | null;
  adminName: string;
  startedAt: string;
  endedAt?: string | null;
  status: 'active' | 'closed' | 'draft' | 'approved';
  Staff?: {
    id: number;
    name: string;
    role: string;
  } | null;
}

interface RuleBreakdown {
  bonus: number;
  bonusPercent: number;
  categoryNames: string[];
  quantity: number;
  revenue: number;
  ruleId: number;
  ruleName: string;
  thresholdPassed: boolean;
  thresholdType: MotivationThresholdType;
  thresholdValue: number;
}

interface ShiftStats {
  basePay: number;
  categoryStats: Array<{
    category: string;
    bonus: number;
    count: number;
    revenue: number;
  }>;
  durationHours: number;
  grossRevenue: number;
  paymentSummary: PaymentSummary;
  ruleBreakdown: RuleBreakdown[];
  totalReturns: number;
  totalBonus: number;
  totalPay: number;
  salesList: BonusRecord[];
  totalRevenue: number;
}

interface BonusRuleDraft {
  bonusPercent: string;
  categoryIds: number[];
  description: string;
  isActive: boolean;
  name: string;
  thresholdType: MotivationThresholdType;
  thresholdValue: string;
}

const parseQuantity = (comment?: string) => {
  const match = String(comment || '').match(/\(([-\d.]+)\s*шт\)/i);
  return match ? Number(match[1]) || 1 : 1;
};

const formatMoney = (value: number) =>
  `${Math.round(value).toLocaleString('ru-RU')} ₽`;

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Нал',
  cashless: 'Безнал',
  mixed: 'Смешанная',
  unknown: 'Не указано',
};

function formatPaymentMethod(method?: string) {
  return PAYMENT_METHOD_LABELS[method || 'unknown'] || method || 'Не указано';
}

const formatDuration = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

const formatDateTime = (value?: string | null) =>
  value ? format(new Date(value), 'dd.MM.yyyy HH:mm') : '-';

const emptyPaymentSummary: PaymentSummary = {
  cash: 0,
  cashless: 0,
  total: 0,
};

function normalizePaymentSummary(
  summary?: Partial<PaymentSummary>,
): PaymentSummary {
  const cash = Number(summary?.cash) || 0;
  const cashless = Number(summary?.cashless) || 0;
  const total = Number.isFinite(Number(summary?.total))
    ? Number(summary?.total)
    : cash + cashless;

  return {
    cash,
    cashless,
    total,
  };
}

const emptyBonusDraft: BonusRuleDraft = {
  bonusPercent: '',
  categoryIds: [],
  description: '',
  isActive: true,
  name: '',
  thresholdType: 'none',
  thresholdValue: '',
};

function toBonusDraft(rule: MotivationBonusRule): BonusRuleDraft {
  return {
    bonusPercent: String(Number(rule.bonusPercent)),
    categoryIds: rule.categoryIds || rule.categories.map((category) => category.id),
    description: rule.description || '',
    isActive: rule.isActive,
    name: rule.name,
    thresholdType: rule.thresholdType,
    thresholdValue: String(Number(rule.thresholdValue)),
  };
}

function calculateShiftStatsSnapshot({
  bonusRules,
  now,
  paymentSummary,
  records,
  rulesMap,
  shiftStart,
}: {
  bonusRules: MotivationBonusRule[];
  now: number;
  paymentSummary: PaymentSummary;
  records: FinanceRecord[];
  rulesMap: MotivationRulesMap;
  shiftStart: number;
}): ShiftStats {
  const activeBonusRules = bonusRules.filter((rule) => rule.isActive);
  const durationHours = Math.max(0, (now - shiftStart) / 3600000);
  let totalRevenue = 0;
  let grossRevenue = 0;
  let totalReturns = 0;
  const rulesByCategoryId = new Map<number, MotivationBonusRule[]>();
  const rulesByCategoryName = new Map<string, MotivationBonusRule[]>();
  const breakdownByRule = new Map<number, RuleBreakdown>();

  activeBonusRules.forEach((rule) => {
    breakdownByRule.set(rule.id, {
      bonus: 0,
      bonusPercent: Number(rule.bonusPercent),
      categoryNames: rule.categories.map((category) => category.name),
      quantity: 0,
      revenue: 0,
      ruleId: rule.id,
      ruleName: rule.name,
      thresholdPassed: false,
      thresholdType: rule.thresholdType,
      thresholdValue: Number(rule.thresholdValue),
    });

    rule.categories.forEach((category) => {
      const byId = rulesByCategoryId.get(category.id) || [];
      byId.push(rule);
      rulesByCategoryId.set(category.id, byId);

      const key = category.name.toLowerCase().trim();
      const byName = rulesByCategoryName.get(key) || [];
      byName.push(rule);
      rulesByCategoryName.set(key, byName);
    });
  });

  const rawSales = records
    .filter((record) => {
      const recordTime = new Date(record.date).getTime();
      return recordTime >= shiftStart && record.source === 'evotor';
    })
    .map((record) => ({
      ...record,
      qty:
        Number.isFinite(Number(record.qty)) && Number(record.qty) !== 0
          ? Number(record.qty)
          : parseQuantity(record.comment),
      value: Number(record.amount) || 0,
    }))
    .filter((record) => record.value !== 0);

  rawSales.forEach((sale) => {
    totalRevenue += sale.value;
    if (sale.value > 0) grossRevenue += sale.value;
    if (sale.value < 0) totalReturns += Math.abs(sale.value);
    const matchedRules =
      (sale.categoryId ? rulesByCategoryId.get(sale.categoryId) : undefined) ||
      rulesByCategoryName.get(sale.category.toLowerCase().trim()) ||
      [];

    matchedRules.forEach((rule) => {
      const breakdown = breakdownByRule.get(rule.id);
      if (!breakdown) return;

      breakdown.revenue += sale.value;
      breakdown.quantity += sale.qty;
    });
  });

  breakdownByRule.forEach((breakdown) => {
    breakdown.thresholdPassed =
      breakdown.thresholdType === 'none' ||
      (breakdown.thresholdType === 'revenue' &&
        breakdown.revenue >= breakdown.thresholdValue) ||
      (breakdown.thresholdType === 'quantity' &&
        breakdown.quantity >= breakdown.thresholdValue);

    breakdown.bonus = breakdown.thresholdPassed
      ? breakdown.revenue * (breakdown.bonusPercent / 100)
      : 0;
  });

  const salesList = rawSales.map<BonusRecord>((sale) => {
    const matchedRules =
      (sale.categoryId ? rulesByCategoryId.get(sale.categoryId) : undefined) ||
      rulesByCategoryName.get(sale.category.toLowerCase().trim()) ||
      [];
    const appliedRules = matchedRules.filter(
      (rule) => breakdownByRule.get(rule.id)?.thresholdPassed,
    );
    const earned = appliedRules.reduce(
      (sum, rule) => sum + sale.value * (Number(rule.bonusPercent) / 100),
      0,
    );
    const rate = appliedRules.reduce(
      (sum, rule) => sum + Number(rule.bonusPercent),
      0,
    );

    return {
      ...sale,
      bonusRuleIds: appliedRules.map((rule) => rule.id),
      bonusRuleNames: appliedRules.map((rule) => rule.name),
      earned,
      rate,
    };
  });

  const categoryStats = Array.from(
    salesList
      .reduce(
        (acc, sale) => {
          const current = acc.get(sale.category) || {
            category: sale.category,
            bonus: 0,
            count: 0,
            revenue: 0,
          };

          current.count += 1;
          current.revenue += sale.value;
          current.bonus += sale.earned;
          acc.set(sale.category, current);

          return acc;
        },
        new Map<
          string,
          {
            category: string;
            bonus: number;
            count: number;
            revenue: number;
          }
        >(),
      )
      .values(),
  ).sort((a, b) => b.revenue - a.revenue);

  salesList.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  const ruleBreakdown = Array.from(breakdownByRule.values()).sort(
    (a, b) => b.bonus - a.bonus,
  );
  const totalBonus = ruleBreakdown.reduce((sum, rule) => sum + rule.bonus, 0);
  const basePay = calculateBasePay(durationHours, rulesMap);

  return {
    basePay,
    categoryStats,
    durationHours,
    grossRevenue,
    paymentSummary,
    ruleBreakdown,
    totalReturns,
    totalBonus,
    totalPay: basePay + totalBonus,
    totalRevenue,
    salesList,
  };
}

function buildShiftReport(shift: ShiftSession, stats: ShiftStats) {
  const bonusLines = stats.ruleBreakdown
    .filter((rule) => rule.revenue !== 0 || rule.quantity !== 0 || rule.bonus !== 0)
    .map((rule) => {
      const threshold =
        rule.thresholdType === 'none'
          ? 'без порога'
          : `${getThresholdLabel(rule.thresholdType).toLowerCase()} ${rule.thresholdValue.toLocaleString('ru-RU')}`;

      return `- ${rule.ruleName}: продажи ${formatMoney(rule.revenue)}, ${rule.quantity.toLocaleString('ru-RU')} шт, ставка ${rule.bonusPercent}%, ${threshold}, бонус ${formatMoney(rule.bonus)}`;
    });

  return [
    'Отчет по смене',
    `Администратор: ${shift.adminName}`,
    `Дата: ${shift.date}`,
    `Начало: ${formatDateTime(shift.startedAt)}`,
    `Завершение: ${formatDateTime(shift.endedAt)}`,
    `Длительность: ${stats.durationHours.toFixed(1)} ч`,
    '',
    `Продажи: ${stats.salesList.length} позиций`,
    `Выручка до возвратов: ${formatMoney(stats.grossRevenue)}`,
    `Возвраты: ${formatMoney(stats.totalReturns)}`,
    `Итого после возвратов: ${formatMoney(stats.totalRevenue)}`,
    'Оплаты:',
    `- Нал: ${formatMoney(stats.paymentSummary.cash)}`,
    `- Безнал: ${formatMoney(stats.paymentSummary.cashless)}`,
    `- Всего по оплатам: ${formatMoney(stats.paymentSummary.total)}`,
    'По категориям:',
    ...stats.categoryStats.map(
      (item) =>
        `- ${item.category}: ${item.count} поз., ${formatMoney(item.revenue)}, бонус ${formatMoney(item.bonus)}`,
    ),
    '',
    'Бонусные правила:',
    ...(bonusLines.length > 0 ? bonusLines : ['- Нет начислений по бонусным правилам']),
    '',
    `База: ${formatMoney(stats.basePay)}`,
    `Бонусы: ${formatMoney(stats.totalBonus)}`,
    `Итого: ${formatMoney(stats.totalPay)}`,
    '',
    `Операций в расчете: ${stats.salesList.length}`,
  ].join('\n');
}

async function readError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

function toggleCategory(categoryIds: number[], categoryId: number) {
  if (categoryIds.includes(categoryId)) {
    return categoryIds.filter((id) => id !== categoryId);
  }

  return [...categoryIds, categoryId];
}

function buildBonusPayload(draft: BonusRuleDraft) {
  const bonusPercent = Number(draft.bonusPercent);
  const thresholdValue =
    draft.thresholdType === 'none' ? 0 : Number(draft.thresholdValue);

  if (!draft.name.trim()) throw new Error('Укажите название правила');
  if (!Number.isFinite(bonusPercent) || bonusPercent < 0) {
    throw new Error('Процент бонуса должен быть неотрицательным числом');
  }
  if (!Number.isFinite(thresholdValue) || thresholdValue < 0) {
    throw new Error('Порог должен быть неотрицательным числом');
  }
  if (draft.categoryIds.length === 0) {
    throw new Error('Выберите хотя бы одну категорию');
  }

  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    bonusPercent,
    thresholdType: draft.thresholdType,
    thresholdValue,
    isActive: draft.isActive,
    categoryIds: draft.categoryIds,
  };
}

function getRuleProgress(rule: RuleBreakdown) {
  if (rule.thresholdType === 'none') return 100;
  if (rule.thresholdValue <= 0) return 100;

  const current =
    rule.thresholdType === 'quantity' ? rule.quantity : rule.revenue;
  return Math.min(100, Math.max(0, (current / rule.thresholdValue) * 100));
}

function getRuleConditionText(rule: RuleBreakdown) {
  if (rule.thresholdType === 'none') return 'Бонус включен с первой продажи.';
  if (rule.thresholdPassed) return 'Условие выполнено, бонус уже начисляется.';

  const remaining = Math.max(
    0,
    rule.thresholdValue -
      (rule.thresholdType === 'quantity' ? rule.quantity : rule.revenue),
  );

  if (rule.thresholdType === 'quantity') {
    return `До включения осталось продать ${remaining.toLocaleString('ru-RU')} шт.`;
  }

  return `До включения осталось продать на ${formatMoney(remaining)}.`;
}

function getPotentialBonus(rule: RuleBreakdown) {
  return rule.revenue * (rule.bonusPercent / 100);
}

function CategoryPicker({
  assignedRuleByCategoryId,
  categories,
  currentRuleId,
  error,
  selectedIds,
  onChange,
}: {
  assignedRuleByCategoryId?: Map<number, MotivationBonusRule>;
  categories: MotivationCategory[];
  currentRuleId?: number | null;
  error?: string;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLowerCase();
  const visibleCategories = normalizedSearch
    ? categories.filter((category) =>
        category.name.toLowerCase().includes(normalizedSearch),
      )
    : categories;

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            Категории
          </div>
          <div className="text-xs text-muted-foreground">
            Выбрано: {selectedIds.length}
          </div>
        </div>
        {categories.length > 8 && (
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Найти категорию"
            className="sm:max-w-[280px]"
          />
        )}
      </div>
      <div className="max-h-[320px] overflow-y-auto rounded-md border">
        <div className="divide-y">
          {visibleCategories.map((category) => {
            const assignedRule = assignedRuleByCategoryId?.get(category.id);
            const isLocked = Boolean(
              assignedRule && assignedRule.id !== currentRuleId,
            );

            return (
              <label
                key={category.id}
                title={
                  isLocked && assignedRule
                    ? `Уже в мотивации «${assignedRule.name}»`
                    : category.name
                }
                className={`flex min-w-0 items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted ${
                  isLocked ? 'opacity-60' : ''
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(category.id)}
                    disabled={isLocked}
                    onChange={() =>
                      !isLocked &&
                      onChange(toggleCategory(selectedIds, category.id))
                    }
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="truncate">{category.name}</span>
                </span>
                {isLocked && assignedRule && (
                  <Badge variant="outline" className="shrink-0">
                    {assignedRule.name}
                  </Badge>
                )}
              </label>
            );
          })}
          {categories.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">
              Сначала создайте доходные категории в справочнике товаров.
            </div>
          )}
          {categories.length > 0 && visibleCategories.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">
              Ничего не найдено.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BonusRuleForm({
  assignedRuleByCategoryId,
  categories,
  categoriesError,
  currentRuleId,
  draft,
  onChange,
  onDelete,
  onSave,
  saveLabel,
  title,
}: {
  assignedRuleByCategoryId?: Map<number, MotivationBonusRule>;
  categories: MotivationCategory[];
  categoriesError?: string;
  currentRuleId?: number | null;
  draft: BonusRuleDraft;
  onChange: (draft: BonusRuleDraft) => void;
  onDelete?: () => void;
  onSave: () => void;
  saveLabel: string;
  title: string;
}) {
  const canSave = draft.name.trim().length > 0 && draft.categoryIds.length > 0;

  return (
    <div className="rounded-md border p-4 sm:p-5 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">
            Категории можно собрать из справочника товаров, процент и порог
            применяются ко всей группе.
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(event) =>
              onChange({ ...draft, isActive: event.target.checked })
            }
            className="h-4 w-4"
          />
          Активно
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Название
          </label>
          <Input
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            placeholder="Например: Бар"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Процент
          </label>
          <div className="relative">
            <Input
              type="number"
              min="0"
              step="0.1"
              value={draft.bonusPercent}
              onChange={(event) =>
                onChange({ ...draft, bonusPercent: event.target.value })
              }
              placeholder="5"
            />
            <Percent className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Тип порога
          </label>
          <Select
            value={draft.thresholdType}
            onValueChange={(value) =>
              onChange({
                ...draft,
                thresholdType: value as MotivationThresholdType,
                thresholdValue: value === 'none' ? '0' : draft.thresholdValue,
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Без порога</SelectItem>
              <SelectItem value="revenue">По сумме</SelectItem>
              <SelectItem value="quantity">По количеству</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Значение порога
          </label>
          <Input
            type="number"
            min="0"
            step="0.1"
            value={draft.thresholdValue}
            disabled={draft.thresholdType === 'none'}
            onChange={(event) =>
              onChange({ ...draft, thresholdValue: event.target.value })
            }
            placeholder="0"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Описание
        </label>
        <Input
          value={draft.description}
          onChange={(event) =>
            onChange({ ...draft, description: event.target.value })
          }
          placeholder="Коротко, за что начисляется бонус"
        />
      </div>

      <CategoryPicker
        assignedRuleByCategoryId={assignedRuleByCategoryId}
        categories={categories}
        currentRuleId={currentRuleId}
        error={categoriesError}
        selectedIds={draft.categoryIds}
        onChange={(categoryIds) => onChange({ ...draft, categoryIds })}
      />

      {draft.categoryIds.length === 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          Выберите категории, иначе правило не сможет начислять бонусы.
        </div>
      )}

      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        {onDelete && (
          <Button type="button" variant="outline" onClick={onDelete}>
            <Trash2 className="h-4 w-4 mr-2" /> Удалить
          </Button>
        )}
        <Button type="button" onClick={onSave} disabled={!canSave}>
          <Save className="h-4 w-4 mr-2" /> {saveLabel}
        </Button>
      </div>
    </div>
  );
}

export default function AdminMotivationPage() {
  const { account } = useAuth();
  const canEditMotivation = canManageMotivation(account?.role);

  const [records, setRecords] = useState<FinanceRecord[]>([]);
  const [paymentSummary, setPaymentSummary] =
    useState<PaymentSummary>(emptyPaymentSummary);
  const [rules, setRules] = useState<MotivationRule[]>([]);
  const [bonusRules, setBonusRules] = useState<MotivationBonusRule[]>([]);
  const [categories, setCategories] = useState<MotivationCategory[]>([]);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, string>>({});
  const [settingsError, setSettingsError] = useState('');
  const [hourlyRulesError, setHourlyRulesError] = useState('');
  const [salesError, setSalesError] = useState('');
  const [shiftStatusError, setShiftStatusError] = useState('');
  const [bonusDrafts, setBonusDrafts] = useState<Record<number, BonusRuleDraft>>(
    {},
  );
  const [newBonusDraft, setNewBonusDraft] = useState<BonusRuleDraft>({
    ...emptyBonusDraft,
  });
  const [bonusModalMode, setBonusModalMode] = useState<
    'create' | 'edit' | null
  >(null);
  const [editingBonusRuleId, setEditingBonusRuleId] = useState<number | null>(
    null,
  );
  const [activeShift, setActiveShift] = useState<ShiftSession | null>(null);
  const [shiftReport, setShiftReport] = useState('');
  const [reportCopied, setReportCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);

  const rulesMap = useMemo(() => rulesToMap(rules), [rules]);
  const assignedRuleByCategoryId = useMemo(() => {
    const map = new Map<number, MotivationBonusRule>();
    bonusRules.forEach((rule) => {
      rule.categories.forEach((category) => {
        map.set(category.id, rule);
      });
    });
    return map;
  }, [bonusRules]);
  const editingBonusRule = useMemo(
    () => bonusRules.find((rule) => rule.id === editingBonusRuleId) || null,
    [bonusRules, editingBonusRuleId],
  );
  const isShiftActive = activeShift?.status === 'active';
  const shiftStart = activeShift?.startedAt
    ? new Date(activeShift.startedAt).getTime()
    : null;
  const shiftDurationMs = shiftStart ? now - shiftStart : 0;
  const isLongShift = isShiftActive && shiftDurationMs > 16 * 3600000;

  const fetchCurrentSalesSnapshot = useCallback(async () => {
    const res = await apiFetch(
      '/api/motivation/current-sales?includePaymentSummary=true',
    );
    if (!res.ok) {
      throw new Error(await readError(res, 'Не удалось загрузить продажи смены'));
    }

    const data = (await res.json()) as CurrentSalesResponse | FinanceRecord[];
    if (Array.isArray(data)) {
      return {
        paymentSummary: emptyPaymentSummary,
        records: data,
      };
    }

    return {
      paymentSummary: normalizePaymentSummary(data.paymentSummary),
      records: data.records || [],
    };
  }, []);

  const fetchFinances = useCallback(async () => {
    setLoading(true);
    try {
      const snapshot = await fetchCurrentSalesSnapshot();
      setRecords(snapshot.records);
      setPaymentSummary(snapshot.paymentSummary);
      setSalesError('');
    } catch (e) {
      console.error(e);
      setRecords([]);
      setPaymentSummary(emptyPaymentSummary);
      setSalesError(getApiErrorMessage(e, 'Не удалось загрузить продажи смены'));
    } finally {
      setLoading(false);
    }
  }, [fetchCurrentSalesSnapshot]);

  const fetchActiveShift = useCallback(async () => {
    try {
      const res = await apiFetch('/api/shifts/active');
      if (res.ok) {
        const data = (await res.json()) as { shift: ShiftSession | null };
        setActiveShift(data.shift);
        setShiftStatusError('');
      } else {
        setShiftStatusError(await readError(res, 'Не удалось проверить активную смену'));
      }
    } catch (e) {
      console.error(e);
      setShiftStatusError(getApiErrorMessage(e, 'Не удалось проверить активную смену'));
    }
  }, []);

  const fetchMotivationSettings = useCallback(async () => {
    setRulesLoading(true);
    setHourlyRulesError('');
    setSettingsError('');
    try {
      const [rulesRes, bonusRulesRes, categoriesRes] = await Promise.all([
        apiFetch('/api/motivation/rules'),
        apiFetch('/api/motivation/bonus-rules'),
        apiFetch('/api/motivation/categories'),
      ]);
      const settingsErrors: string[] = [];

      if (rulesRes.ok) {
        const data = (await rulesRes.json()) as MotivationRule[];
        setRules(data);
        setRuleDrafts(
          data.reduce<Record<string, string>>((acc, rule) => {
            acc[rule.key] = String(Number(rule.value));
            return acc;
          }, {}),
        );
      } else {
        setHourlyRulesError(
          await readError(rulesRes, 'Не удалось загрузить правила почасовой оплаты'),
        );
      }

      if (bonusRulesRes.ok) {
        const data = (await bonusRulesRes.json()) as MotivationBonusRule[];
        setBonusRules(data);
        setBonusDrafts(
          data.reduce<Record<number, BonusRuleDraft>>((acc, rule) => {
            acc[rule.id] = toBonusDraft(rule);
            return acc;
          }, {}),
        );
      } else {
        settingsErrors.push(
          await readError(
            bonusRulesRes,
            'Не удалось загрузить бонусные правила. Проверьте, что backend перезапущен после обновления.',
          ),
        );
      }

      if (categoriesRes.ok) {
        setCategories((await categoriesRes.json()) as MotivationCategory[]);
      } else {
        settingsErrors.push(
          await readError(
            categoriesRes,
            'Не удалось загрузить категории мотивации. Проверьте, что backend перезапущен после обновления.',
          ),
        );
      }

      if (settingsErrors.length > 0) {
        setSettingsError(settingsErrors.join(' '));
      }
    } catch (e) {
      console.error(e);
      const message = getApiErrorMessage(e, 'Не удалось загрузить правила мотивации');
      setHourlyRulesError(message);
      setSettingsError(message);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMotivationSettings();
    void fetchActiveShift();
    void fetchFinances();
  }, [fetchActiveShift, fetchFinances, fetchMotivationSettings]);

  useRealtimeRefresh(['motivation', 'shifts', 'finance', 'catalog'], () => {
    void fetchMotivationSettings();
    void fetchActiveShift();
    void fetchFinances();
  });

  useEffect(() => {
    if (!isShiftActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isShiftActive]);

  useEffect(() => {
    if (!isShiftActive) return;
    const interval = setInterval(() => {
      void fetchFinances();
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchFinances, isShiftActive]);

  const shiftStats = useMemo<ShiftStats | null>(() => {
    if (!shiftStart) return null;

    return calculateShiftStatsSnapshot({
      bonusRules,
      now,
      paymentSummary,
      records,
      rulesMap,
      shiftStart,
    });
  }, [bonusRules, now, paymentSummary, records, rulesMap, shiftStart]);

  const handleStartShift = async () => {
    try {
      const res = await apiFetch('/api/shifts/start', { method: 'POST' });

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось начать смену'));
        return;
      }

      const data = (await res.json()) as { shift: ShiftSession };
      setActiveShift(data.shift);
      setPaymentSummary(emptyPaymentSummary);
      setShiftReport('');
      setReportCopied(false);
      toast.success('Смена начата');
      void fetchFinances();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось начать смену'));
    }
  };

  const executeEndShift = async () => {
    if (!activeShift || !shiftStart) return false;

    let latestStats = shiftStats;
    try {
      const snapshot = await fetchCurrentSalesSnapshot();
      setRecords(snapshot.records);
      setPaymentSummary(snapshot.paymentSummary);
      latestStats = calculateShiftStatsSnapshot({
        bonusRules,
        now: Date.now(),
        paymentSummary: snapshot.paymentSummary,
        records: snapshot.records,
        rulesMap,
        shiftStart,
      });
    } catch (error) {
      console.error(error);
      toast.error(getApiErrorMessage(error, 'Не удалось обновить продажи перед закрытием смены'));
      return false;
    }

    if (!latestStats) return false;

    try {
      const res = await apiFetch('/api/shifts/end', { method: 'POST' });
      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось завершить смену'));
        return false;
      }

      const data = (await res.json()) as { shift: ShiftSession };
      setShiftReport(buildShiftReport(data.shift, latestStats));
      setReportCopied(false);
      setActiveShift(null);
      toast.success('Смена завершена, отчет сформирован');
      void fetchFinances();
      return true;
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось завершить смену'));
      return false;
    }
  };

  const handleEndShift = async () => {
    if (!activeShift || !shiftStart) return;

    setPendingAction({
      confirmLabel: 'Завершить смену',
      description:
        'Перед закрытием CRM обновит продажи смены, рассчитает мотивацию и сформирует текстовый отчет для копирования.',
      isDestructive: true,
      onConfirm: executeEndShift,
      title: 'Завершить текущую смену?',
    });
  };

  const handleSaveRule = async (rule: MotivationRule) => {
    const value = Number(ruleDrafts[rule.key]);
    if (!Number.isFinite(value) || value < 0) {
      toast.error('Укажите корректное значение правила');
      return;
    }

    try {
      const res = await apiFetch(`/api/motivation/rules/${rule.key}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось сохранить правило'));
        return;
      }

      const updated = (await res.json()) as MotivationRule;
      setRules((prev) =>
        prev.map((item) => (item.key === updated.key ? updated : item)),
      );
      toast.success('Правило сохранено');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сохранить правило'));
    }
  };

  const openCreateBonusRule = () => {
    setNewBonusDraft({ ...emptyBonusDraft });
    setEditingBonusRuleId(null);
    setBonusModalMode('create');
  };

  const openEditBonusRule = (rule: MotivationBonusRule) => {
    setBonusDrafts((prev) => ({ ...prev, [rule.id]: toBonusDraft(rule) }));
    setEditingBonusRuleId(rule.id);
    setBonusModalMode('edit');
  };

  const closeBonusModal = () => {
    setBonusModalMode(null);
    setEditingBonusRuleId(null);
  };

  const handleCreateBonusRule = async (event?: FormEvent) => {
    event?.preventDefault();
    let payload: ReturnType<typeof buildBonusPayload>;
    try {
      payload = buildBonusPayload(newBonusDraft);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Проверьте правило'));
      return;
    }

    try {
      const res = await apiFetch('/api/motivation/bonus-rules', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось создать правило'));
        return;
      }

      const created = (await res.json()) as MotivationBonusRule;
      setBonusRules((prev) => [...prev, created]);
      setBonusDrafts((prev) => ({ ...prev, [created.id]: toBonusDraft(created) }));
      setNewBonusDraft({ ...emptyBonusDraft });
      closeBonusModal();
      toast.success('Мотивация создана');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось создать правило'));
    }
  };

  const handleSaveBonusRule = async (rule: MotivationBonusRule) => {
    const draft = bonusDrafts[rule.id];
    if (!draft) return;

    let payload: ReturnType<typeof buildBonusPayload>;
    try {
      payload = buildBonusPayload(draft);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Проверьте правило'));
      return;
    }

    try {
      const res = await apiFetch(`/api/motivation/bonus-rules/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось сохранить правило'));
        return;
      }

      const updated = (await res.json()) as MotivationBonusRule;
      setBonusRules((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      setBonusDrafts((prev) => ({ ...prev, [updated.id]: toBonusDraft(updated) }));
      closeBonusModal();
      toast.success('Мотивация сохранена');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сохранить правило'));
    }
  };

  const executeDeleteBonusRule = async (rule: MotivationBonusRule) => {
    try {
      const res = await apiFetch(`/api/motivation/bonus-rules/${rule.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось удалить правило'));
        return false;
      }

      setBonusRules((prev) => prev.filter((item) => item.id !== rule.id));
      setBonusDrafts((prev) => {
        const next = { ...prev };
        delete next[rule.id];
        return next;
      });
      toast.success('Мотивация удалена');
      return true;
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось удалить правило'));
      return false;
    }
  };

  const handleDeleteBonusRule = async (rule: MotivationBonusRule) => {
    setPendingAction({
      confirmLabel: 'Удалить',
      description: `Правило «${rule.name}» будет удалено из списка мотиваций и перестанет участвовать в новых расчетах.`,
      isDestructive: true,
      onConfirm: () => executeDeleteBonusRule(rule),
      title: 'Удалить мотивацию?',
    });
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;

    setPendingActionLoading(true);
    try {
      const shouldClose = await pendingAction.onConfirm();
      if (shouldClose !== false) setPendingAction(null);
    } finally {
      setPendingActionLoading(false);
    }
  };

  const handleCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(shiftReport);
      setReportCopied(true);
      toast.success('Отчет скопирован');
      window.setTimeout(() => setReportCopied(false), 1500);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось скопировать отчет'));
    }
  };
  const hourlyRuleColumns: ColumnDef<MotivationRule>[] = [
    {
      accessorKey: 'label',
      header: 'Правило',
      cell: ({ row }) => (
        <div className="font-medium">
          <div>{row.original.label}</div>
          <div className="text-xs text-muted-foreground">
            Сейчас: {formatRuleValue(row.original)}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: 'Описание',
      meta: {
        cellClassName: 'whitespace-normal text-sm text-muted-foreground',
      },
    },
    {
      id: 'value',
      header: 'Значение',
      size: 160,
      cell: ({ row }) => {
        const rule = row.original;

        return (
          <Input
            type="number"
            step="0.1"
            min="0"
            value={ruleDrafts[rule.key] || ''}
            onChange={(event) =>
              setRuleDrafts({
                ...ruleDrafts,
                [rule.key]: event.target.value,
              })
            }
          />
        );
      },
    },
    {
      id: 'actions',
      header: '',
      size: 110,
      cell: ({ row }) => {
        const rule = row.original;

        return (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleSaveRule(rule)}
            disabled={Number(ruleDrafts[rule.key]) === rule.value}
          >
            Сохранить
          </Button>
        );
      },
    },
  ];
  const salesColumns: ColumnDef<BonusRecord>[] = [
    {
      accessorKey: 'date',
      header: 'Время',
      meta: {
        cellClassName: 'text-sm text-muted-foreground',
      },
      cell: ({ row }) => format(new Date(row.original.date), 'HH:mm:ss'),
    },
    {
      accessorKey: 'category',
      header: 'Категория',
      meta: {
        cellClassName: 'font-medium',
      },
    },
    {
      id: 'type',
      header: 'Тип',
      cell: ({ row }) =>
        row.original.value < 0 ? (
          <Badge variant="outline" className="text-destructive">
            Возврат
          </Badge>
        ) : (
          <Badge variant="outline">Продажа</Badge>
        ),
    },
    {
      id: 'payment',
      header: 'Оплата',
      cell: ({ row }) => {
        const sale = row.original;

        return (
          <div className="flex flex-col gap-1">
            <Badge variant="outline">{formatPaymentMethod(sale.paymentMethod)}</Badge>
            {sale.paymentMethod === 'mixed' && (
              <span className="text-xs text-muted-foreground">
                нал {formatMoney(Number(sale.paymentCash) || 0)} · безнал{' '}
                {formatMoney(Number(sale.paymentCashless) || 0)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'rules',
      header: 'Правило',
      cell: ({ row }) =>
        row.original.bonusRuleNames.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.original.bonusRuleNames.map((name) => (
              <Badge key={name} variant="outline">
                {name}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      accessorKey: 'value',
      header: 'Сумма',
      meta: {
        cellClassName: 'text-right',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => (
        <span className={row.original.value < 0 ? 'text-destructive' : ''}>
          {row.original.value > 0 ? '+' : ''}
          {formatMoney(row.original.value)}
        </span>
      ),
    },
    {
      accessorKey: 'earned',
      header: 'Бонус',
      meta: {
        cellClassName: 'text-right font-bold',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => {
        const sale = row.original;

        return (
          <span
            className={
              sale.earned > 0 ? 'text-green-500' : 'text-muted-foreground'
            }
          >
            {sale.rate > 0 && (
              <span className="mr-2 rounded bg-green-500/10 px-1.5 py-0.5 text-xs text-green-600">
                {sale.rate}%
              </span>
            )}
            {sale.earned > 0 ? '+' : ''}
            {formatMoney(sale.earned)}
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <div
          className={`flex w-full items-center gap-4 rounded-lg border bg-card p-2 sm:w-auto ${
            isLongShift ? 'border-amber-500/40 bg-amber-500/5' : ''
          }`}
        >
          {isShiftActive ? (
            <>
              <div className="flex flex-col px-2">
                <span className="text-xs text-muted-foreground">
                  {activeShift?.adminName}
                </span>
                <span
                  className={`flex items-center gap-2 font-mono text-lg tracking-widest ${
                    isLongShift ? 'text-amber-500' : 'text-primary'
                  }`}
                >
                  {isLongShift ? (
                    <AlertTriangle className="h-5 w-5" />
                  ) : (
                    <Clock className="h-5 w-5 animate-pulse" />
                  )}
                  {shiftStart ? formatDuration(shiftDurationMs) : '00:00:00'}
                </span>
                {isLongShift && (
                  <span className="text-xs text-amber-500">
                    Смена длится больше 16 часов
                  </span>
                )}
              </div>
              <Button
                onClick={() => void handleEndShift()}
                variant="destructive"
                className="w-full sm:w-auto"
              >
                <Square className="w-4 h-4 mr-2 fill-current" /> Завершить
              </Button>
            </>
          ) : (
            <Button
              onClick={() => void handleStartShift()}
              className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white"
            >
              <Play className="w-4 h-4 mr-2 fill-current" /> Начать смену
            </Button>
          )}
        </div>
      </div>

      {shiftStatusError && (
        <ErrorState
          compact
          message={shiftStatusError}
          onRetry={() => void fetchActiveShift()}
          title="Статус смены не загрузился"
        />
      )}

      {canEditMotivation && (
        <>
          <Card>
            {rulesLoading && (
              <div className="border-b px-4 py-2 text-sm text-muted-foreground">
                Обновление...
              </div>
            )}
            <CardContent className="pt-0 px-0">
              <div className="overflow-x-auto">
                <DataTable
                  columns={hourlyRuleColumns}
                  data={rules}
                  errorText={hourlyRulesError || undefined}
                  emptyText="Правила почасовой оплаты не настроены."
                  loading={rulesLoading}
                  loadingText="Загрузка правил почасовой оплаты..."
                  minWidthClassName="min-w-[760px]"
                  onRetry={() => void fetchMotivationSettings()}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2 border-b">
              <div>
                <CardTitle className="text-lg">Бонусные правила</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Каждое правило состоит из выбранных категорий каталога и своих
                  параметров начисления.
                </p>
              </div>
              <Button onClick={openCreateBonusRule}>
                <Plus className="h-4 w-4 mr-2" /> Создать
              </Button>
            </CardHeader>
            <CardContent className="pt-4">
              {settingsError && (
                <ErrorState
                  compact
                  className="mb-4"
                  message={settingsError}
                  onRetry={() => void fetchMotivationSettings()}
                  title="Настройки мотивации не загрузились"
                />
              )}

              {bonusRules.length === 0 ? (
                <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                  Бонусные правила еще не созданы.
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {bonusRules.map((rule) => (
                    <div key={rule.id} className="rounded-md border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-lg truncate">
                              {rule.name}
                            </h3>
                            <Badge variant={rule.isActive ? 'default' : 'outline'}>
                              {rule.isActive ? 'Активно' : 'Выключено'}
                            </Badge>
                          </div>
                          {rule.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {rule.description}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditBonusRule(rule)}
                          >
                            <Pencil className="h-4 w-4 mr-2" /> Изменить
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleDeleteBonusRule(rule)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Удалить
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                        <div>
                          <div className="text-xs text-muted-foreground">
                            Процент
                          </div>
                          <div className="font-semibold">
                            {Number(rule.bonusPercent).toLocaleString('ru-RU')}%
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">
                            Порог
                          </div>
                          <div className="font-semibold">
                            {formatThreshold(rule)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">
                            Категории
                          </div>
                          <div className="font-semibold">
                            {rule.categories.length}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {rule.categories.map((category) => (
                          <Badge key={category.id} variant="outline">
                            {category.name}
                          </Badge>
                        ))}
                        {rule.categories.length === 0 && (
                          <span className="text-sm text-muted-foreground">
                            Категории не выбраны
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Dialog
            open={bonusModalMode === 'create'}
            onOpenChange={(open) => !open && closeBonusModal()}
          >
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:max-w-[1040px] sm:p-6">
              <DialogHeader>
                <DialogTitle className="text-2xl">Создать мотивацию</DialogTitle>
                <DialogDescription>
                  Выберите категории, задайте процент и условие включения
                  бонуса.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={(event) => void handleCreateBonusRule(event)}>
                <BonusRuleForm
                  assignedRuleByCategoryId={assignedRuleByCategoryId}
                  categories={categories}
                  categoriesError={settingsError}
                  draft={newBonusDraft}
                  onChange={setNewBonusDraft}
                  onSave={() => void handleCreateBonusRule()}
                  saveLabel="Добавить"
                  title="Новое правило"
                />
              </form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={bonusModalMode === 'edit' && Boolean(editingBonusRule)}
            onOpenChange={(open) => !open && closeBonusModal()}
          >
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:max-w-[1040px] sm:p-6">
              <DialogHeader>
                <DialogTitle className="text-2xl">
                  Редактировать мотивацию
                </DialogTitle>
                <DialogDescription>
                  Измените категории, процент или порог начисления.
                </DialogDescription>
              </DialogHeader>
              {editingBonusRule && bonusDrafts[editingBonusRule.id] && (
                <BonusRuleForm
                  assignedRuleByCategoryId={assignedRuleByCategoryId}
                  categories={categories}
                  categoriesError={settingsError}
                  currentRuleId={editingBonusRule.id}
                  draft={bonusDrafts[editingBonusRule.id]}
                  onChange={(nextDraft) =>
                    setBonusDrafts((prev) => ({
                      ...prev,
                      [editingBonusRule.id]: nextDraft,
                    }))
                  }
                  onSave={() => void handleSaveBonusRule(editingBonusRule)}
                  saveLabel="Сохранить"
                  title={editingBonusRule.name}
                />
              )}
            </DialogContent>
          </Dialog>
        </>
      )}

      {shiftReport && (
        <Card className="border-primary/30">
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
            <CardTitle className="text-lg">Отчет по завершенной смене</CardTitle>
            <Button variant="outline" size="sm" onClick={handleCopyReport}>
              {reportCopied ? (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              ) : (
                <Copy className="w-4 h-4 mr-2" />
              )}
              {reportCopied ? 'Скопировано' : 'Скопировать'}
            </Button>
          </CardHeader>
          <CardContent className="pt-4">
            <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm font-mono">
              {shiftReport}
            </pre>
          </CardContent>
        </Card>
      )}

      {!isShiftActive ? (
        <Card className="border-dashed border-2 bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center space-y-3">
            <div className="p-3 rounded-full bg-primary/10">
              <Wallet className="w-10 h-10 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Смена не начата</h2>
              <p className="text-muted-foreground max-w-[400px] mt-2">
                Нажмите кнопку «Начать смену». Если в клубе уже идет смена,
                система не даст открыть вторую.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-primary/30 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Trophy className="w-16 h-16" />
              </div>
              <CardContent className="pt-6 relative z-10">
                <div className="text-sm font-medium">Заработано за смену</div>
                <div className="text-3xl font-bold mt-1 text-primary">
                  {formatMoney(shiftStats?.totalPay || 0)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Почасовая база + бонусы
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Продажи</div>
                <div className="text-2xl font-bold mt-1">
                  {formatMoney(shiftStats?.totalRevenue || 0)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {(shiftStats?.salesList.length || 0).toLocaleString('ru-RU')}{' '}
                  позиций
                  {shiftStats && shiftStats.totalReturns > 0
                    ? `, возвраты ${formatMoney(shiftStats.totalReturns)}`
                    : ''}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Percent className="w-4 h-4 text-emerald-500" /> Бонусы
                </div>
                <div className="text-2xl font-bold mt-1">
                  {formatMoney(shiftStats?.totalBonus || 0)}
                </div>
                <div className="text-xs text-green-500 mt-1">
                  По кастомным правилам
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Tags className="w-4 h-4 text-blue-500" /> Активные правила
                </div>
                <div className="text-2xl font-bold mt-1">
                  {bonusRules.filter((rule) => rule.isActive).length}
                </div>
                <div className="text-xs text-blue-500 mt-1">
                  Настройки бонусов
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
              <div>
                <CardTitle className="text-lg">Прогресс мотиваций</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Что уже продано, какой бонус начислится и что осталось сделать
                  до включения порога.
                </p>
              </div>
              <div className="text-sm text-muted-foreground">
                {loading && <span className="animate-pulse">Обновление...</span>}
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              {salesError && (
                <ErrorState
                  compact
                  message={salesError}
                  onRetry={() => void fetchFinances()}
                  title="Продажи смены не загрузились"
                />
              )}
              {salesError ? null : shiftStats?.ruleBreakdown.length === 0 ? (
                <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                  Активные мотивации не настроены.
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {shiftStats?.ruleBreakdown.map((rule) => {
                    const progress = getRuleProgress(rule);
                    const potentialBonus = getPotentialBonus(rule);

                    return (
                      <div key={rule.ruleId} className="rounded-md border p-4">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold text-lg">
                                {rule.ruleName}
                              </h3>
                              <Badge
                                variant={
                                  rule.thresholdPassed ? 'default' : 'outline'
                                }
                              >
                                {rule.thresholdPassed ? 'Начисляется' : 'Ждет порог'}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {rule.categoryNames.length > 0
                                ? rule.categoryNames.join(', ')
                                : 'Категории не выбраны'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">
                              Бонус сейчас
                            </div>
                            <div className="text-xl font-bold text-green-600">
                              {formatMoney(rule.bonus)}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                          <div>
                            <div className="text-xs text-muted-foreground">
                              Продано
                            </div>
                            <div className="font-semibold">
                              {formatMoney(rule.revenue)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">
                              Кол-во
                            </div>
                            <div className="font-semibold">
                              {rule.quantity.toLocaleString('ru-RU')} шт
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">
                              Ставка
                            </div>
                            <div className="font-semibold">
                              {rule.bonusPercent}%
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">
                              При пороге
                            </div>
                            <div className="font-semibold">
                              {formatMoney(potentialBonus)}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 space-y-2">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-muted-foreground">
                              {getRuleConditionText(rule)}
                            </span>
                            <span className="shrink-0 font-medium">
                              {Math.round(progress)}%
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {shiftStats && shiftStats.categoryStats.length > 0 && (
                <div className="rounded-md border">
                  <div className="px-4 py-3 border-b font-medium">
                    Продажи по категориям
                  </div>
                  <div className="divide-y">
                    {shiftStats.categoryStats.map((category) => (
                      <div
                        key={category.category}
                        className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 text-sm"
                      >
                        <div className="col-span-2 md:col-span-1 font-medium">
                          {category.category}
                        </div>
                        <div className="text-muted-foreground">
                          {category.count} поз.
                        </div>
                        <div>{formatMoney(category.revenue)}</div>
                        <div
                          className={
                            category.bonus > 0
                              ? 'font-medium text-green-600'
                              : 'text-muted-foreground'
                          }
                        >
                          {category.bonus > 0 ? '+' : ''}
                          {formatMoney(category.bonus)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
              <CardTitle className="text-lg">Операции смены</CardTitle>
              <div className="text-sm text-muted-foreground">
                {loading && (
                  <span className="animate-pulse">Обновление...</span>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-0">
              {salesError && (
                <div className="p-4">
                  <ErrorState
                    compact
                    message={salesError}
                    onRetry={() => void fetchFinances()}
                    title="Операции смены не загрузились"
                  />
                </div>
              )}
              {!salesError && shiftStats?.salesList.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                  В эту смену продаж пока не было.
                </div>
              ) : !salesError ? (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <DataTable
                    columns={salesColumns}
                    data={shiftStats?.salesList || []}
                    emptyText="В эту смену продаж пока не было."
                    minWidthClassName="min-w-[900px]"
                    getRowClassName={() => 'hover:bg-muted/50'}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>

        </>
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
