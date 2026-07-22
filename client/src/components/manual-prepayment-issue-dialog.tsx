import { useEffect, useMemo, useState } from 'react';
import { Gift, Loader2, Search, WalletCards } from 'lucide-react';
import { searchClients, type ClientListItem } from '@/api/clients';
import { apiFetch, readApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { toast } from '@/components/ui/toast';
import type { AccountRole } from '@/lib/roles';

interface SubscriptionType {
  id: number;
  isUnlimited: boolean;
  name: string;
  price: number;
  sessionsTotal?: number | null;
  validityDays: number;
}

type IssueKind = 'subscription' | 'certificate';
type PaymentMethod = 'cash' | 'cashless' | 'mixed' | 'unknown';

const today = () => new Date().toISOString().slice(0, 10);

export function ManualPrepaymentIssueDialog({
  authorizationRole,
  onIssued,
}: {
  authorizationRole: AccountRole | null;
  onIssued: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<IssueKind>('subscription');
  const [clientQuery, setClientQuery] = useState('');
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientListItem | null>(null);
  const [searching, setSearching] = useState(false);
  const [types, setTypes] = useState<SubscriptionType[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [subscriptionTypeId, setSubscriptionTypeId] = useState('');
  const [certificateType, setCertificateType] = useState<'money' | 'service'>('money');
  const [title, setTitle] = useState('Подарочный сертификат');
  const [code, setCode] = useState('');
  const [amountTotal, setAmountTotal] = useState('');
  const [unitsTotal, setUnitsTotal] = useState('1');
  const [serviceName, setServiceName] = useState('');
  const [validityDays, setValidityDays] = useState('365');
  const [saleAmount, setSaleAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cashless');
  const [startsAt, setStartsAt] = useState(today);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTypesLoading(true);
    void apiFetch('/api/subscriptions/types?status=active')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error((await readApiError(response, 'Не удалось загрузить типы абонементов')).message);
        }
        return response.json() as Promise<SubscriptionType[]>;
      })
      .then(setTypes)
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Не удалось загрузить типы абонементов'))
      .finally(() => setTypesLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open || selectedClient || clientQuery.trim().length < 2) {
      setClients([]);
      return;
    }
    const timeout = window.setTimeout(() => {
      setSearching(true);
      void searchClients({ page: 1, pageSize: 8, q: clientQuery.trim(), status: 'active' })
        .then((response) => setClients(response.items))
        .catch((error) => toast.error(error instanceof Error ? error.message : 'Не удалось найти клиента'))
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [clientQuery, open, selectedClient]);

  const selectedType = useMemo(
    () => types.find((type) => String(type.id) === subscriptionTypeId) || null,
    [subscriptionTypeId, types],
  );

  const reset = () => {
    setKind('subscription');
    setClientQuery('');
    setClients([]);
    setSelectedClient(null);
    setSubscriptionTypeId('');
    setCertificateType('money');
    setTitle('Подарочный сертификат');
    setCode('');
    setAmountTotal('');
    setUnitsTotal('1');
    setServiceName('');
    setValidityDays('365');
    setSaleAmount('');
    setPaymentMethod('cashless');
    setStartsAt(today());
    setComment('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) reset();
  };

  const save = async () => {
    if (!selectedClient) return;
    setSaving(true);
    try {
      const isSubscription = kind === 'subscription';
      const response = await apiFetch(
        `/api/clients/${selectedClient.id}/${isSubscription ? 'subscriptions' : 'certificates'}`,
        {
          method: 'POST',
          body: JSON.stringify(
            isSubscription
              ? {
                  comment: comment.trim() || undefined,
                  paymentMethod,
                  saleAmount: Number(saleAmount || 0),
                  startsAt,
                  subscriptionTypeId: Number(subscriptionTypeId),
                }
              : {
                  amountTotal: certificateType === 'money' ? Number(amountTotal) : undefined,
                  certificateType,
                  code: code.trim() || undefined,
                  comment: comment.trim() || undefined,
                  paymentMethod,
                  saleAmount: Number(saleAmount || 0),
                  serviceName: certificateType === 'service' ? serviceName.trim() : undefined,
                  startsAt,
                  title: title.trim(),
                  unitsTotal: certificateType === 'service' ? Number(unitsTotal) : undefined,
                  validityDays: Number(validityDays),
                },
          ),
        },
      );
      if (!response.ok) {
        const apiError = await readApiError(response, 'Не удалось выдать предоплату');
        throw new Error(apiError.message);
      }
      toast.success(isSubscription ? 'Абонемент выдан клиенту' : 'Сертификат создан');
      onIssued();
      handleOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось выдать предоплату');
    } finally {
      setSaving(false);
    }
  };

  const valid = Boolean(
    selectedClient &&
      startsAt &&
      saleAmount !== '' &&
      (kind === 'subscription'
        ? subscriptionTypeId
        : title.trim() &&
          Number(validityDays) > 0 &&
          (certificateType === 'money'
            ? Number(amountTotal) > 0
            : serviceName.trim() && Number(unitsTotal) > 0)),
  );

  if (!['owner', 'manager', 'admin'].includes(authorizationRole || '')) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button">
          <Gift className="mr-2 h-4 w-4" /> Выдать вручную
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Ручная выдача клиенту</DialogTitle>
          <DialogDescription>
            Зафиксируйте абонемент или сертификат и фактическую оплату без создания нового типа продукта.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
            <Button type="button" variant={kind === 'subscription' ? 'secondary' : 'ghost'} onClick={() => setKind('subscription')}>
              <WalletCards className="mr-2 h-4 w-4" /> Абонемент
            </Button>
            <Button type="button" variant={kind === 'certificate' ? 'secondary' : 'ghost'} onClick={() => setKind('certificate')}>
              <Gift className="mr-2 h-4 w-4" /> Сертификат
            </Button>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="manual-issue-client">Клиент</Label>
            {selectedClient ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div><div className="font-medium">{selectedClient.name}</div><div className="text-sm text-muted-foreground">{selectedClient.phone}</div></div>
                <Button type="button" variant="outline" size="sm" onClick={() => { setSelectedClient(null); setClientQuery(''); }}>Изменить</Button>
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="manual-issue-client" className="pl-9" placeholder="Имя или телефон" value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} />
                {(searching || clients.length > 0) && (
                  <div className="mt-2 divide-y rounded-lg border">
                    {searching ? <div className="p-3 text-sm text-muted-foreground">Ищем...</div> : clients.map((client) => (
                      <button key={client.id} type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted" onClick={() => { setSelectedClient(client); setClientQuery(client.name); setClients([]); }}>
                        <span className="font-medium">{client.name}</span><span className="text-sm text-muted-foreground">{client.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {kind === 'subscription' ? (
            <div className="grid gap-1.5">
              <Label>Тип абонемента</Label>
              <Select value={subscriptionTypeId} onValueChange={(value) => { setSubscriptionTypeId(value); const type = types.find((item) => String(item.id) === value); if (type) setSaleAmount(String(type.price)); }}>
                <SelectTrigger aria-label="Тип абонемента"><SelectValue placeholder={typesLoading ? 'Загрузка...' : 'Выберите тип'} /></SelectTrigger>
                <SelectContent>{types.map((type) => <SelectItem key={type.id} value={String(type.id)}>{type.name} · {type.isUnlimited ? 'безлимит' : `${type.sessionsTotal || 0} занятий`} · {type.price.toLocaleString('ru-RU')} ₽</SelectItem>)}</SelectContent>
              </Select>
              {selectedType && <div className="text-xs text-muted-foreground">Срок действия: {selectedType.validityDays} дней</div>}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2"><Label>Тип сертификата</Label><Select value={certificateType} onValueChange={(value) => setCertificateType(value as 'money' | 'service')}><SelectTrigger aria-label="Тип сертификата"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="money">Денежный номинал</SelectItem><SelectItem value="service">На услугу</SelectItem></SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>Название</Label><Input aria-label="Название сертификата" value={title} onChange={(event) => setTitle(event.target.value)} /></div>
              <div className="grid gap-1.5"><Label>Код · необязательно</Label><Input aria-label="Код сертификата" placeholder="Сгенерируется автоматически" value={code} onChange={(event) => setCode(event.target.value)} /></div>
              {certificateType === 'money' ? <div className="grid gap-1.5"><Label>Номинал, ₽</Label><Input aria-label="Номинал сертификата" type="number" min="0.01" step="0.01" value={amountTotal} onChange={(event) => setAmountTotal(event.target.value)} /></div> : <><div className="grid gap-1.5"><Label>Услуга</Label><Input aria-label="Услуга сертификата" value={serviceName} onChange={(event) => setServiceName(event.target.value)} /></div><div className="grid gap-1.5"><Label>Количество услуг</Label><Input aria-label="Количество услуг" type="number" min="1" value={unitsTotal} onChange={(event) => setUnitsTotal(event.target.value)} /></div></>}
              <div className="grid gap-1.5"><Label>Срок действия, дней</Label><Input aria-label="Срок действия сертификата" type="number" min="1" value={validityDays} onChange={(event) => setValidityDays(event.target.value)} /></div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label>Дата начала</Label><Input aria-label="Дата начала" type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Фактически оплачено, ₽</Label><Input aria-label="Фактически оплачено" type="number" min="0" step="0.01" value={saleAmount} onChange={(event) => setSaleAmount(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Способ оплаты</Label><Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}><SelectTrigger aria-label="Способ оплаты"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Наличные</SelectItem><SelectItem value="cashless">Безналичные</SelectItem><SelectItem value="mixed">Смешанная</SelectItem><SelectItem value="unknown">Не указан</SelectItem></SelectContent></Select></div>
          </div>
          <div className="grid gap-1.5"><Label>Комментарий · необязательно</Label><textarea aria-label="Комментарий" className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm" value={comment} onChange={(event) => setComment(event.target.value)} /></div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => handleOpenChange(false)}>Отмена</Button>
          <Button type="button" disabled={!valid || saving} onClick={() => void save()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{kind === 'subscription' ? 'Выдать абонемент' : 'Создать сертификат'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
