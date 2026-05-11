import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { format } from 'date-fns';
import {
  CheckCircle2,
  Clock,
  Copy,
  Percent,
  Play,
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
import {
  calculateBasePay,
  formatRuleValue,
  formatThreshold,
  getThresholdLabel,
  rulesToMap,
  type MotivationBonusRule,
  type MotivationCategory,
  type MotivationRule,
  type MotivationThresholdType,
} from '@/lib/motivation';
import { useAuth } from '@/lib/useAuth';

interface FinanceRecord {
  categoryId?: number | null;
  category: string;
  amount: number;
  type: 'income' | 'expense' | string;
  source: string;
  date: string;
  comment?: string;
}

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
  ruleBreakdown: RuleBreakdown[];
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

const formatDuration = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

const formatDateTime = (value?: string | null) =>
  value ? format(new Date(value), 'dd.MM.yyyy HH:mm') : '-';

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
    `Продажи: ${stats.salesList.length} позиций на ${formatMoney(stats.totalRevenue)}`,
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

function CategoryPicker({
  categories,
  selectedIds,
  onChange,
}: {
  categories: MotivationCategory[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-44 overflow-y-auto rounded-md border p-3">
      {categories.map((category) => (
        <label
          key={category.id}
          className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted"
        >
          <input
            type="checkbox"
            checked={selectedIds.includes(category.id)}
            onChange={() => onChange(toggleCategory(selectedIds, category.id))}
            className="h-4 w-4 shrink-0"
          />
          <span className="truncate">{category.name}</span>
        </label>
      ))}
      {categories.length === 0 && (
        <div className="text-sm text-muted-foreground">
          Сначала создайте доходные категории в справочнике товаров.
        </div>
      )}
    </div>
  );
}

function BonusRuleForm({
  categories,
  draft,
  onChange,
  onDelete,
  onSave,
  saveLabel,
  title,
}: {
  categories: MotivationCategory[];
  draft: BonusRuleDraft;
  onChange: (draft: BonusRuleDraft) => void;
  onDelete?: () => void;
  onSave: () => void;
  saveLabel: string;
  title: string;
}) {
  return (
    <div className="rounded-md border p-4 space-y-4">
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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
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
        categories={categories}
        selectedIds={draft.categoryIds}
        onChange={(categoryIds) => onChange({ ...draft, categoryIds })}
      />

      <div className="flex flex-col sm:flex-row justify-end gap-2">
        {onDelete && (
          <Button type="button" variant="outline" onClick={onDelete}>
            <Trash2 className="h-4 w-4 mr-2" /> Удалить
          </Button>
        )}
        <Button type="button" onClick={onSave}>
          <Save className="h-4 w-4 mr-2" /> {saveLabel}
        </Button>
      </div>
    </div>
  );
}

export default function AdminMotivationPage() {
  const { account } = useAuth();
  const canManageMotivation =
    account?.role === 'owner' || account?.role === 'manager';

  const [records, setRecords] = useState<FinanceRecord[]>([]);
  const [rules, setRules] = useState<MotivationRule[]>([]);
  const [bonusRules, setBonusRules] = useState<MotivationBonusRule[]>([]);
  const [categories, setCategories] = useState<MotivationCategory[]>([]);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, string>>({});
  const [bonusDrafts, setBonusDrafts] = useState<Record<number, BonusRuleDraft>>(
    {},
  );
  const [newBonusDraft, setNewBonusDraft] = useState<BonusRuleDraft>({
    ...emptyBonusDraft,
  });
  const [activeShift, setActiveShift] = useState<ShiftSession | null>(null);
  const [shiftReport, setShiftReport] = useState('');
  const [reportCopied, setReportCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  const rulesMap = useMemo(() => rulesToMap(rules), [rules]);
  const isShiftActive = activeShift?.status === 'active';
  const shiftStart = activeShift?.startedAt
    ? new Date(activeShift.startedAt).getTime()
    : null;

  const fetchFinances = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/motivation/current-sales');
      if (res.ok) {
        setRecords((await res.json()) as FinanceRecord[]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchActiveShift = useCallback(async () => {
    try {
      const res = await apiFetch('/api/shifts/active');
      if (res.ok) {
        const data = (await res.json()) as { shift: ShiftSession | null };
        setActiveShift(data.shift);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchMotivationSettings = useCallback(async () => {
    setRulesLoading(true);
    try {
      const [rulesRes, bonusRulesRes, categoriesRes] = await Promise.all([
        apiFetch('/api/motivation/rules'),
        apiFetch('/api/motivation/bonus-rules'),
        apiFetch('/api/motivation/categories'),
      ]);

      if (rulesRes.ok) {
        const data = (await rulesRes.json()) as MotivationRule[];
        setRules(data);
        setRuleDrafts(
          data.reduce<Record<string, string>>((acc, rule) => {
            acc[rule.key] = String(Number(rule.value));
            return acc;
          }, {}),
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
      }

      if (categoriesRes.ok) {
        setCategories((await categoriesRes.json()) as MotivationCategory[]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMotivationSettings();
    void fetchActiveShift();
    void fetchFinances();
  }, [fetchActiveShift, fetchFinances, fetchMotivationSettings]);

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

    const activeBonusRules = bonusRules.filter((rule) => rule.isActive);
    const durationHours = Math.max(0, (now - shiftStart) / 3600000);
    let totalRevenue = 0;
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
        return (
          recordTime >= shiftStart &&
          record.type === 'income' &&
          record.source === 'evotor'
        );
      })
      .map((record) => ({
        ...record,
        qty: parseQuantity(record.comment),
        value: Math.abs(Number(record.amount)),
      }));

    rawSales.forEach((sale) => {
      totalRevenue += sale.value;
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
      ruleBreakdown,
      totalBonus,
      totalPay: basePay + totalBonus,
      totalRevenue,
      salesList,
    };
  }, [bonusRules, now, records, rulesMap, shiftStart]);

  const handleStartShift = async () => {
    const res = await apiFetch('/api/shifts/start', { method: 'POST' });

    if (!res.ok) {
      alert(await readError(res, 'Не удалось начать смену'));
      return;
    }

    const data = (await res.json()) as { shift: ShiftSession };
    setActiveShift(data.shift);
    setShiftReport('');
    setReportCopied(false);
    void fetchFinances();
  };

  const handleEndShift = async () => {
    if (!activeShift || !shiftStats) return;
    if (!confirm('Уверены, что хотите завершить смену?')) return;

    const res = await apiFetch('/api/shifts/end', { method: 'POST' });
    if (!res.ok) {
      alert(await readError(res, 'Не удалось завершить смену'));
      return;
    }

    const data = (await res.json()) as { shift: ShiftSession };
    setShiftReport(buildShiftReport(data.shift, shiftStats));
    setReportCopied(false);
    setActiveShift(null);
    void fetchFinances();
  };

  const handleSaveRule = async (rule: MotivationRule) => {
    const value = Number(ruleDrafts[rule.key]);
    if (!Number.isFinite(value) || value < 0) return;

    const res = await apiFetch(`/api/motivation/rules/${rule.key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });

    if (!res.ok) {
      alert(await readError(res, 'Не удалось сохранить правило'));
      return;
    }

    const updated = (await res.json()) as MotivationRule;
    setRules((prev) =>
      prev.map((item) => (item.key === updated.key ? updated : item)),
    );
  };

  const handleCreateBonusRule = async (event?: FormEvent) => {
    event?.preventDefault();
    let payload: ReturnType<typeof buildBonusPayload>;
    try {
      payload = buildBonusPayload(newBonusDraft);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Проверьте правило');
      return;
    }

    const res = await apiFetch('/api/motivation/bonus-rules', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      alert(await readError(res, 'Не удалось создать правило'));
      return;
    }

    const created = (await res.json()) as MotivationBonusRule;
    setBonusRules((prev) => [...prev, created]);
    setBonusDrafts((prev) => ({ ...prev, [created.id]: toBonusDraft(created) }));
    setNewBonusDraft({ ...emptyBonusDraft });
  };

  const handleSaveBonusRule = async (rule: MotivationBonusRule) => {
    const draft = bonusDrafts[rule.id];
    if (!draft) return;

    let payload: ReturnType<typeof buildBonusPayload>;
    try {
      payload = buildBonusPayload(draft);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Проверьте правило');
      return;
    }

    const res = await apiFetch(`/api/motivation/bonus-rules/${rule.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      alert(await readError(res, 'Не удалось сохранить правило'));
      return;
    }

    const updated = (await res.json()) as MotivationBonusRule;
    setBonusRules((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
    setBonusDrafts((prev) => ({ ...prev, [updated.id]: toBonusDraft(updated) }));
  };

  const handleDeleteBonusRule = async (rule: MotivationBonusRule) => {
    if (!confirm(`Удалить правило «${rule.name}»?`)) return;

    const res = await apiFetch(`/api/motivation/bonus-rules/${rule.id}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      alert(await readError(res, 'Не удалось удалить правило'));
      return;
    }

    setBonusRules((prev) => prev.filter((item) => item.id !== rule.id));
    setBonusDrafts((prev) => {
      const next = { ...prev };
      delete next[rule.id];
      return next;
    });
  };

  const handleCopyReport = async () => {
    await navigator.clipboard.writeText(shiftReport);
    setReportCopied(true);
    window.setTimeout(() => setReportCopied(false), 1500);
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-[1200px] mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Моя смена</h1>
          <p className="text-muted-foreground mt-1">
            Старт, завершение и отчет по текущей смене администратора
          </p>
        </div>

        <div className="flex items-center gap-4 w-full sm:w-auto bg-card border rounded-lg p-2">
          {isShiftActive ? (
            <>
              <div className="flex flex-col px-2">
                <span className="text-xs text-muted-foreground">
                  {activeShift?.adminName}
                </span>
                <span className="flex items-center gap-2 text-lg font-mono tracking-widest text-primary">
                  <Clock className="w-5 h-5 animate-pulse" />
                  {shiftStart ? formatDuration(now - shiftStart) : '00:00:00'}
                </span>
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

      {canManageMotivation && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
              <div>
                <CardTitle className="text-lg">Почасовая оплата</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  База для payroll: обычные часы, переработка и порог часов.
                </p>
              </div>
              {rulesLoading && (
                <span className="text-sm text-muted-foreground animate-pulse">
                  Обновление...
                </span>
              )}
            </CardHeader>
            <CardContent className="pt-0 px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Правило</TableHead>
                      <TableHead>Описание</TableHead>
                      <TableHead className="w-[160px]">Значение</TableHead>
                      <TableHead className="w-[110px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((rule) => (
                      <TableRow key={rule.key}>
                        <TableCell className="font-medium">
                          <div>{rule.label}</div>
                          <div className="text-xs text-muted-foreground">
                            Сейчас: {formatRuleValue(rule)}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-normal">
                          {rule.description}
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleSaveRule(rule)}
                            disabled={
                              Number(ruleDrafts[rule.key]) === rule.value
                            }
                          >
                            Сохранить
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 border-b">
              <CardTitle className="text-lg">Бонусные правила</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Каждое правило состоит из выбранных категорий каталога и своих
                параметров начисления.
              </p>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <form onSubmit={(event) => void handleCreateBonusRule(event)}>
                <BonusRuleForm
                  categories={categories}
                  draft={newBonusDraft}
                  onChange={setNewBonusDraft}
                  onSave={() => void handleCreateBonusRule()}
                  saveLabel="Добавить"
                  title="Новое правило"
                />
              </form>

              <div className="space-y-4">
                {bonusRules.map((rule) => {
                  const draft = bonusDrafts[rule.id];
                  if (!draft) return null;

                  return (
                    <BonusRuleForm
                      key={rule.id}
                      categories={categories}
                      draft={draft}
                      onChange={(nextDraft) =>
                        setBonusDrafts((prev) => ({
                          ...prev,
                          [rule.id]: nextDraft,
                        }))
                      }
                      onDelete={() => void handleDeleteBonusRule(rule)}
                      onSave={() => void handleSaveBonusRule(rule)}
                      saveLabel="Сохранить"
                      title={rule.name}
                    />
                  );
                })}
                {bonusRules.length === 0 && (
                  <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                    Бонусные правила еще не созданы.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
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
          <CardContent className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <div className="p-4 rounded-full bg-primary/10">
              <Wallet className="w-12 h-12 text-primary" />
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
                  {shiftStats?.salesList.length || 0} позиций
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
                  Категории задаются владельцем
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
              <CardTitle className="text-lg">За что начислены бонусы</CardTitle>
              <div className="text-sm text-muted-foreground">
                {loading && (
                  <span className="animate-pulse">Обновление...</span>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-0">
              {shiftStats?.salesList.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                  В эту смену продаж пока не было.
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead>Время</TableHead>
                        <TableHead>Категория</TableHead>
                        <TableHead>Правило</TableHead>
                        <TableHead className="text-right">Сумма</TableHead>
                        <TableHead className="text-right">Бонус</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shiftStats?.salesList.map((sale, idx) => (
                        <TableRow key={idx} className="hover:bg-muted/50">
                          <TableCell className="text-muted-foreground text-sm">
                            {format(new Date(sale.date), 'HH:mm:ss')}
                          </TableCell>
                          <TableCell className="font-medium">
                            {sale.category}
                          </TableCell>
                          <TableCell>
                            {sale.bonusRuleNames.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {sale.bonusRuleNames.map((name) => (
                                  <Badge key={name} variant="outline">
                                    {name}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMoney(Math.abs(Number(sale.amount)))}
                          </TableCell>
                          <TableCell className="text-right font-bold text-green-500">
                            {sale.rate > 0 && (
                              <span className="text-xs bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded mr-2">
                                {sale.rate}%
                              </span>
                            )}
                            +{formatMoney(sale.earned)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 border-b">
              <CardTitle className="text-lg">Сводка правил</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Правило</TableHead>
                      <TableHead>Категории</TableHead>
                      <TableHead>Порог</TableHead>
                      <TableHead className="text-right">Продажи</TableHead>
                      <TableHead className="text-right">Кол-во</TableHead>
                      <TableHead className="text-right">Бонус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shiftStats?.ruleBreakdown.map((rule) => (
                      <TableRow key={rule.ruleId}>
                        <TableCell className="font-medium">
                          {rule.ruleName}
                          <div className="text-xs text-muted-foreground">
                            {rule.bonusPercent}%
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {rule.categoryNames.length > 0
                            ? rule.categoryNames.join(', ')
                            : 'Категории не выбраны'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              rule.thresholdPassed ? 'default' : 'outline'
                            }
                          >
                            {formatThreshold({
                              id: rule.ruleId,
                              name: rule.ruleName,
                              bonusPercent: rule.bonusPercent,
                              thresholdType: rule.thresholdType,
                              thresholdValue: rule.thresholdValue,
                              sortOrder: 0,
                              isActive: true,
                              categories: [],
                              categoryIds: [],
                            })}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(rule.revenue)}
                        </TableCell>
                        <TableCell className="text-right">
                          {rule.quantity.toLocaleString('ru-RU')}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoney(rule.bonus)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
