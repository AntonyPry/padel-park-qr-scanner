type ReceiptPaymentMethod = 'cash' | 'cashless' | 'mixed' | 'unknown';
type ReceiptPaymentSource = 'cash' | 'cashless' | 'unknown';

interface StoredReceiptLike {
  cash?: number | string | null;
  cashless?: number | string | null;
  paymentSource?: string | null;
  totalAmount?: number | string | null;
  type?: string | null;
}

interface ResolvedReceiptPayments {
  cash: number;
  cashless: number;
  paymentMethod: ReceiptPaymentMethod;
  paymentSource: ReceiptPaymentSource;
  total: number;
}

function normalizeReceiptPaymentSource(value: unknown): ReceiptPaymentSource {
  const source = String(value || '').trim().toUpperCase();

  if (['CASH', 'PAY_CASH', 'TYPE_CASH', '0'].includes(source)) return 'cash';
  if (
    [
      'CARD',
      'CASHLESS',
      'ELECTRON',
      'ELECTRONIC',
      'PAY_CARD',
      'PAY_BY_CREDIT',
      'TYPE_CARD',
      '1',
    ].includes(source)
  ) {
    return 'cashless';
  }

  return 'unknown';
}

function resolveStoredReceiptPayments(
  receipt: StoredReceiptLike,
): ResolvedReceiptPayments {
  const multiplier = receipt.type === 'PAYBACK' ? -1 : 1;
  const total = Math.abs(Number(receipt.totalAmount) || 0) * multiplier;
  let cash = Math.abs(Number(receipt.cash) || 0) * multiplier;
  let cashless = Math.abs(Number(receipt.cashless) || 0) * multiplier;
  const paymentSource = normalizeReceiptPaymentSource(receipt.paymentSource);

  if (paymentSource === 'cash' && cash === 0 && total !== 0) {
    cash = total;
    cashless = 0;
  } else if (paymentSource === 'cashless' && cashless === 0 && total !== 0) {
    cash = 0;
    cashless = total;
  } else if (cash === 0 && cashless === 0 && total !== 0) {
    cashless = total;
  }

  return {
    cash,
    cashless,
    paymentMethod:
      cash !== 0 && cashless !== 0
        ? 'mixed'
        : cash !== 0
          ? 'cash'
          : cashless !== 0
            ? 'cashless'
            : 'unknown',
    paymentSource,
    total,
  };
}

module.exports = {
  normalizeReceiptPaymentSource,
  resolveStoredReceiptPayments,
};
