import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useSearchParams } from 'react-router-dom';
import {
  BadgeCheck,
  Gift,
  PackageCheck,
  RotateCcw,
  Search,
  WalletCards,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ModuleSwitch } from '@/components/module-switch';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable } from '@/components/data-table';
import { ConfirmActionDialog, type ConfirmAction } from '@/components/confirm-action-dialog';
import { toast } from '@/components/ui/toast';
import { apiFetch, getApiErrorMessage, readApiError } from '@/lib/api';
import { canRedeemCertificates } from '@/lib/permissions';
import { useAuth } from '@/lib/useAuth';

type CertificateType = 'money' | 'service';
type CertificateStatus = 'active' | 'canceled' | 'expired' | 'redeemed';
type RedemptionStatus = 'active' | 'reversed';

const BILLING_SWITCH_ITEMS = [
  { label: 'Предоплаты', to: '/admin/prepayments' },
  { label: 'Сертификаты', to: '/admin/certificates' },
  { label: 'Корпоративные', to: '/admin/corporate-clients' },
];

interface CertificateActor {
  email?: string | null;
  id: number;
  name?: string | null;
  role?: string | null;
}

interface CertificateClient {
  id: number;
  name: string;
  phone: string;
  status: string;
}

interface CertificateRedemption {
  amount?: number | null;
  certificateId: number;
  clientId: number;
  comment?: string | null;
  createdAt?: string;
  id: number;
  quantity?: number | null;
  redeemedAt: string;
  redeemedBy?: CertificateActor | null;
  reversedAt?: string | null;
  reversedBy?: CertificateActor | null;
  reversalReason?: string | null;
  serviceName?: string | null;
  serviceType?: string | null;
  status: RedemptionStatus;
}

interface Certificate {
  amountRemaining?: number | null;
  amountTotal?: number | null;
  amountUsed: number;
  canceledAt?: string | null;
  cancelReason?: string | null;
  certificateType: CertificateType;
  client?: CertificateClient | null;
  clientId: number;
  code: string;
  createdAt: string;
  expiresAt?: string | null;
  id: number;
  pendingSaleId?: number | null;
  redemptions?: CertificateRedemption[];
  saleAmount: number;
  serviceName?: string | null;
  serviceType?: string | null;
  startsAt: string;
  status: CertificateStatus;
  storedStatus?: string;
  title: string;
  unitsRemaining?: number | null;
  unitsTotal?: number | null;
  unitsUsed: number;
}

type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<void>;
};

const STATUS_LABELS: Record<CertificateStatus | 'all', string> = {
  active: 'Активные',
  all: 'Все',
  canceled: 'Отменены',
  expired: 'Истекли',
  redeemed: 'Погашены',
};

const TYPE_LABELS: Record<CertificateType | 'all', string> = {
  all: 'Все типы',
  money: 'Денежный',
  service: 'Услуга/пакет',
};

const REDEMPTION_STATUS_LABELS: Record<RedemptionStatus, string> = {
  active: 'Списано',
  reversed: 'Отменено',
};

function formatMoney(value?: number | null) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
    style: 'currency',
    currency: 'RUB',
  }).format(amount);
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ru-RU').format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatActor(actor?: CertificateActor | null) {
  if (!actor) return 'CRM';
  return actor.name || actor.email || actor.role || `#${actor.id}`;
}

function getStatusVariant(status: CertificateStatus) {
  if (status === 'active') return 'default';
  if (status === 'redeemed') return 'secondary';
  return 'outline';
}

async function readError(response: Response, fallback: string) {
  const error = await readApiError(response, fallback);
  return error.message;
}

function certificateBalanceText(certificate: Certificate) {
  if (certificate.certificateType === 'money') {
    return `${formatMoney(certificate.amountRemaining)} из ${formatMoney(
      certificate.amountTotal,
    )}`;
  }
  return `${certificate.unitsRemaining ?? 0} из ${certificate.unitsTotal ?? 0}`;
}

function redemptionValueText(redemption: CertificateRedemption, type: CertificateType) {
  if (type === 'money') return formatMoney(redemption.amount);
  return `${redemption.quantity || 0} ед.`;
}

export default function CertificatesPage() {
  const { account } = useAuth();
  const [searchParams] = useSearchParams();
  const canRedeem = canRedeemCertificates(account?.role);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [selectedCertificate, setSelectedCertificate] =
    useState<Certificate | null>(null);
  const [selectedCertificateId, setSelectedCertificateId] = useState<number | null>(
    null,
  );
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<CertificateStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<CertificateType | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const [redeemSaving, setRedeemSaving] = useState(false);
  const [redeemAmount, setRedeemAmount] = useState('');
  const [redeemQuantity, setRedeemQuantity] = useState('1');
  const [redeemComment, setRedeemComment] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);

  const selectedCanRedeem =
    canRedeem && selectedCertificate?.status === 'active';

  const loadCertificates = useCallback(async () => {
    setLoading(true);
    setErrorText('');
    try {
      const params = new URLSearchParams();
      if (searchInput.trim()) params.set('q', searchInput.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter !== 'all') params.set('certificateType', typeFilter);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const response = await apiFetch(`/api/certificates${suffix}`);
      if (!response.ok) {
        const message = await readError(response, 'Не удалось загрузить сертификаты');
        setErrorText(message);
        return;
      }

      const data = (await response.json()) as Certificate[];
      const requestedCertificateId = Number(searchParams.get('certificateId') || 0);
      setCertificates(data);
      setSelectedCertificateId((currentId) => {
        if (
          requestedCertificateId &&
          data.some((item) => item.id === requestedCertificateId)
        ) {
          return requestedCertificateId;
        }
        if (currentId && data.some((item) => item.id === currentId)) return currentId;
        return data[0]?.id || null;
      });
      if (data.length === 0) setSelectedCertificate(null);
    } catch (error) {
      setErrorText(getApiErrorMessage(error, 'Не удалось загрузить сертификаты'));
    } finally {
      setLoading(false);
    }
  }, [searchInput, searchParams, statusFilter, typeFilter]);

  const loadCertificateDetail = useCallback(async (certificateId: number) => {
    setDetailLoading(true);
    try {
      const response = await apiFetch(`/api/certificates/${certificateId}`);
      if (!response.ok) {
        toast.error(await readError(response, 'Не удалось загрузить сертификат'));
        return;
      }
      setSelectedCertificate((await response.json()) as Certificate);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось загрузить сертификат'));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCertificates();
  }, [loadCertificates]);

  useEffect(() => {
    if (!selectedCertificateId) return;
    void loadCertificateDetail(selectedCertificateId);
  }, [loadCertificateDetail, selectedCertificateId]);

  const openRedeemDialog = () => {
    if (!selectedCertificate) return;
    setRedeemAmount('');
    setRedeemQuantity('1');
    setRedeemComment('');
    setRedeemDialogOpen(true);
  };

  const handleRedeem = async () => {
    if (!selectedCertificate) return;
    setRedeemSaving(true);
    try {
      const body =
        selectedCertificate.certificateType === 'money'
          ? {
              amount: redeemAmount,
              comment: redeemComment,
            }
          : {
              comment: redeemComment,
              quantity: redeemQuantity,
            };
      const response = await apiFetch(
        `/api/certificates/${selectedCertificate.id}/redemptions`,
        {
          body: JSON.stringify(body),
          method: 'POST',
        },
      );
      if (!response.ok) {
        toast.error(await readError(response, 'Не удалось списать сертификат'));
        return;
      }

      const data = (await response.json()) as { certificate: Certificate };
      setSelectedCertificate(data.certificate);
      setRedeemDialogOpen(false);
      await loadCertificates();
      toast.success('Сертификат списан');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось списать сертификат'));
    } finally {
      setRedeemSaving(false);
    }
  };

  const requestReverseRedemption = (redemption: CertificateRedemption) => {
    if (!selectedCertificate) return;
    setPendingAction({
      confirmLabel: 'Отменить',
      description: `${formatDateTime(redemption.redeemedAt)} · ${redemptionValueText(
        redemption,
        selectedCertificate.certificateType,
      )}`,
      title: 'Отменить списание сертификата?',
      onConfirm: async () => {
        const response = await apiFetch(
          `/api/certificates/${selectedCertificate.id}/redemptions/${redemption.id}/reverse`,
          {
            body: JSON.stringify({ reason: 'Отменено вручную' }),
            method: 'POST',
          },
        );
        if (!response.ok) {
          toast.error(await readError(response, 'Не удалось отменить списание'));
          return;
        }

        const data = (await response.json()) as { certificate: Certificate };
        setSelectedCertificate(data.certificate);
        await loadCertificates();
        toast.success('Списание отменено');
      },
    });
  };

  const columns = useMemo<ColumnDef<Certificate>[]>(
    () => [
      {
        accessorKey: 'code',
        header: 'Код',
        size: 160,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.code}</div>
            <div className="truncate text-xs text-muted-foreground">
              {row.original.title}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'certificateType',
        header: 'Тип',
        size: 130,
        cell: ({ row }) => (
          <Badge variant="outline">
            {TYPE_LABELS[row.original.certificateType]}
          </Badge>
        ),
      },
      {
        id: 'client',
        header: 'Клиент',
        size: 180,
        cell: ({ row }) => (
          <div className="min-w-0 text-sm">
            <div className="truncate font-medium">
              {row.original.client?.name || `#${row.original.clientId}`}
            </div>
            <div className="text-xs text-muted-foreground">
              {row.original.client?.phone || '-'}
            </div>
          </div>
        ),
      },
      {
        id: 'balance',
        header: 'Остаток',
        size: 150,
        cell: ({ row }) => (
          <span className="font-medium">
            {certificateBalanceText(row.original)}
          </span>
        ),
      },
      {
        accessorKey: 'expiresAt',
        header: 'Срок',
        size: 120,
        cell: ({ row }) => formatDate(row.original.expiresAt),
      },
      {
        accessorKey: 'status',
        header: 'Статус',
        size: 120,
        cell: ({ row }) => (
          <Badge variant={getStatusVariant(row.original.status)}>
            {STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      },
    ],
    [],
  );

  const redemptions = selectedCertificate?.redemptions || [];
  const canSubmitRedeem =
    selectedCertificate?.certificateType === 'money'
      ? Number(redeemAmount) > 0
      : Number(redeemQuantity) > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-xl border bg-card/60 p-3 sm:flex-row sm:items-center">
        <ModuleSwitch items={BILLING_SWITCH_ITEMS} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader className="gap-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gift className="h-5 w-5" />
              Реестр
            </CardTitle>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Код, клиент, телефон"
                  className="pl-9"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(value) =>
                  setStatusFilter(value as CertificateStatus | 'all')
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={typeFilter}
                onValueChange={(value) =>
                  setTypeFilter(value as CertificateType | 'all')
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={certificates}
              emptyText="Сертификатов пока нет."
              errorText={errorText}
              getRowClassName={(row) =>
                row.original.id === selectedCertificateId
                  ? 'bg-primary/5'
                  : undefined
              }
              getRowProps={(row) => ({
                className: 'cursor-pointer',
                onClick: () => setSelectedCertificateId(row.original.id),
              })}
              loading={loading}
              minWidthClassName="min-w-[820px]"
              onRetry={() => void loadCertificates()}
              pageSize={10}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BadgeCheck className="h-5 w-5" />
              Карточка
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {!selectedCertificate && !detailLoading && (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                Сертификат не выбран.
              </div>
            )}
            {detailLoading && (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                Загрузка...
              </div>
            )}
            {selectedCertificate && !detailLoading && (
              <>
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-semibold">
                        {selectedCertificate.code}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {selectedCertificate.title}
                      </div>
                    </div>
                    <Badge variant={getStatusVariant(selectedCertificate.status)}>
                      {STATUS_LABELS[selectedCertificate.status]}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Остаток</div>
                      <div className="mt-1 font-semibold">
                        {certificateBalanceText(selectedCertificate)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Срок</div>
                      <div className="mt-1 font-semibold">
                        {formatDate(selectedCertificate.expiresAt)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Тип</div>
                      <div className="mt-1 font-semibold">
                        {TYPE_LABELS[selectedCertificate.certificateType]}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Продажа</div>
                      <div className="mt-1 font-semibold">
                        {formatMoney(selectedCertificate.saleAmount)}
                      </div>
                    </div>
                  </div>
                  {selectedCertificate.client && (
                    <div className="rounded-md border p-3 text-sm">
                      <div className="font-medium">
                        {selectedCertificate.client.name}
                      </div>
                      <div className="text-muted-foreground">
                        {selectedCertificate.client.phone}
                      </div>
                    </div>
                  )}
                  {selectedCertificate.certificateType === 'service' && (
                    <div className="rounded-md border p-3 text-sm">
                      <div className="font-medium">
                        {selectedCertificate.serviceName || 'Пакет услуг'}
                      </div>
                      <div className="text-muted-foreground">
                        {selectedCertificate.serviceType || 'service'}
                      </div>
                    </div>
                  )}
                </div>

                <Button
                  type="button"
                  onClick={openRedeemDialog}
                  disabled={!selectedCanRedeem}
                  className="w-full"
                >
                  {selectedCertificate.certificateType === 'money' ? (
                    <WalletCards className="mr-2 h-4 w-4" />
                  ) : (
                    <PackageCheck className="mr-2 h-4 w-4" />
                  )}
                  Списать
                </Button>

                <div className="space-y-3">
                  <div className="text-sm font-medium">История</div>
                  {redemptions.length === 0 && (
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      Истории пока нет.
                    </div>
                  )}
                  {redemptions.map((redemption) => (
                    <div
                      key={redemption.id}
                      className="rounded-md border p-3 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">
                            {redemptionValueText(
                              redemption,
                              selectedCertificate.certificateType,
                            )}
                          </div>
                          <div className="text-muted-foreground">
                            {formatDateTime(redemption.redeemedAt)} ·{' '}
                            {formatActor(redemption.redeemedBy)}
                          </div>
                        </div>
                        <Badge
                          variant={
                            redemption.status === 'active'
                              ? 'secondary'
                              : 'outline'
                          }
                        >
                          {REDEMPTION_STATUS_LABELS[redemption.status]}
                        </Badge>
                      </div>
                      {redemption.comment && (
                        <div className="mt-2 text-muted-foreground">
                          {redemption.comment}
                        </div>
                      )}
                      {redemption.reversalReason && (
                        <div className="mt-2 text-muted-foreground">
                          {redemption.reversalReason}
                        </div>
                      )}
                      {canRedeem && redemption.status === 'active' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-3"
                          onClick={() => requestReverseRedemption(redemption)}
                        >
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Отменить
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={redeemDialogOpen}
        onOpenChange={(open) => {
          if (!open && !redeemSaving) setRedeemDialogOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Списать сертификат</DialogTitle>
            <DialogDescription>
              {selectedCertificate?.code}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selectedCertificate?.certificateType === 'money' ? (
              <div className="space-y-2">
                <Label htmlFor="certificate-redeem-amount">Сумма</Label>
                <Input
                  id="certificate-redeem-amount"
                  type="number"
                  min="1"
                  step="1"
                  value={redeemAmount}
                  onChange={(event) => setRedeemAmount(event.target.value)}
                  placeholder={formatMoney(selectedCertificate.amountRemaining)}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="certificate-redeem-quantity">Количество</Label>
                <Input
                  id="certificate-redeem-quantity"
                  type="number"
                  min="1"
                  step="1"
                  value={redeemQuantity}
                  onChange={(event) => setRedeemQuantity(event.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="certificate-redeem-comment">Комментарий</Label>
              <Input
                id="certificate-redeem-comment"
                value={redeemComment}
                onChange={(event) => setRedeemComment(event.target.value)}
                placeholder="Опционально"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRedeemDialogOpen(false)}
              disabled={redeemSaving}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => void handleRedeem()}
              disabled={!canSubmitRedeem || redeemSaving}
            >
              {redeemSaving ? 'Списываем...' : 'Списать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        action={pendingAction}
        loading={pendingActionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={async () => {
          if (!pendingAction) return;
          setPendingActionLoading(true);
          try {
            await pendingAction.onConfirm();
            setPendingAction(null);
          } finally {
            setPendingActionLoading(false);
          }
        }}
      />
    </div>
  );
}
