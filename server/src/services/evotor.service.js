// src/services/evotor.service.js
const db = require('../../models');
const pendingSaleService = require('./pending-sale.service');
const {
  buildProviderIdempotencyKey,
} = require('../provider-integrations/idempotency');
const {
  resolveLegacyProviderContext,
} = require('../provider-integrations/rollout');
const {
  isTenantProviderIntegrationsEnabled,
} = require('../tenant-context/capabilities');

function normalizePaymentType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (['0', 'TYPE_CASH', 'PAY_CASH', 'CASH_PAYMENT'].includes(normalized)) {
    return 'CASH';
  }
  if (
    [
      '1',
      'TYPE_CARD',
      'PAY_CARD',
      'CARD',
      'CASHLESS',
      'ELECTRON',
      'ELECTRONIC',
      'CARD_PAYMENT',
      'PAY_BY_CREDIT',
    ].includes(normalized)
  ) {
    return 'CASHLESS';
  }
  return normalized;
}

function getPaymentAmount(payment) {
  return (
    Number(payment.amount) ||
    Number(payment.sum) ||
    Number(payment.value) ||
    Number(payment.paymentAmount) ||
    Number(payment.total) ||
    Number(payment.totalAmount) ||
    Number(payment.sumPrice) ||
    0
  );
}

function getKnownNumeric(payment, keys) {
  for (const key of keys) {
    const value = Number(payment?.[key]);
    if (Number.isFinite(value) && value !== 0) return value;
  }
  return 0;
}

function getExplicitCash(payment) {
  return getKnownNumeric(payment, [
    'cash',
    'cashAmount',
    'cash_amount',
    'cashPayment',
    'cash_payment',
  ]);
}

function getExplicitCashless(payment) {
  return getKnownNumeric(payment, [
    'cashless',
    'cashlessAmount',
    'cashless_amount',
    'card',
    'cardAmount',
    'card_amount',
    'electronic',
    'electronicAmount',
    'electronic_amount',
  ]);
}

function getReceiptTotalAmount(receiptData) {
  return (
    Number(receiptData.totalAmount) ||
    Number(receiptData.total_amount) ||
    Number(receiptData.total) ||
    Number(receiptData.sum) ||
    Number(receiptData.amount) ||
    Number(receiptData.resultSum) ||
    Number(receiptData.receipt?.totalAmount) ||
    Number(receiptData.receipt?.total) ||
    0
  );
}

function getPaymentType(payment) {
  return normalizePaymentType(
    payment.type ||
      payment.paymentType ||
      payment.payment_type ||
      payment.paymentSource ||
      payment.payment_source ||
      payment.paymentMethod ||
      payment.method ||
      payment.kind ||
      payment.name,
  );
}

function normalizePayment(payment) {
  const type = getPaymentType(payment);
  return {
    amount: getPaymentAmount(payment),
    originalType:
      payment.type ||
      payment.paymentType ||
      payment.payment_type ||
      payment.paymentSource ||
      payment.payment_source ||
      payment.paymentMethod ||
      payment.method ||
      payment.kind ||
      payment.name ||
      null,
    type,
  };
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function extractPayments(receiptData) {
  return [
    ...asArray(receiptData.payments),
    ...asArray(receiptData.payment),
    ...asArray(receiptData.paymentDetails),
    ...asArray(receiptData.payment_details),
    ...asArray(receiptData.receipt?.payments),
    ...asArray(receiptData.receipt?.payment),
    ...asArray(receiptData.receipt?.paymentDetails),
    ...asArray(receiptData.receipt?.payment_details),
    ...asArray(receiptData.data?.payments),
    ...asArray(receiptData.data?.payment),
    ...asArray(receiptData.data?.paymentDetails),
    ...asArray(receiptData.data?.payment_details),
  ].filter(Boolean);
}

function getRootPaymentSource(receiptData) {
  return normalizePaymentType(
    receiptData.paymentSource ||
      receiptData.payment_source ||
      receiptData.paymentType ||
      receiptData.payment_type ||
      receiptData.paymentMethod ||
      receiptData.method,
  );
}

function splitPayments(receiptData, totalAmount, multiplier) {
  let cash = 0;
  let cashless = 0;
  const paymentSource = getRootPaymentSource(receiptData);
  const detectedPayments = extractPayments(receiptData).map(normalizePayment);
  const unknownPayments = [];
  const explicitCash =
    getExplicitCash(receiptData) ||
    getExplicitCash(receiptData.receipt) ||
    getExplicitCash(receiptData.data);
  const explicitCashless =
    getExplicitCashless(receiptData) ||
    getExplicitCashless(receiptData.receipt) ||
    getExplicitCashless(receiptData.data);

  if (detectedPayments.length === 0 && (explicitCash || explicitCashless)) {
    cash += explicitCash * multiplier;
    cashless += explicitCashless * multiplier;
  }

  detectedPayments.forEach((payment) => {
    const amount = payment.amount * multiplier;
    if (payment.type === 'CASH') {
      cash += amount;
      return;
    }
    if (payment.type === 'CASHLESS') {
      cashless += amount;
      return;
    }
    unknownPayments.push(payment);
  });

  if (cash === 0 && cashless === 0) {
    if (paymentSource === 'CASHLESS') {
      cashless = totalAmount * multiplier;
    } else if (paymentSource === 'CASH') {
      cash = totalAmount * multiplier;
    }
  }

  const recognizedTotal = Math.abs(cash) + Math.abs(cashless);
  if (cash === 0 && cashless === 0 && totalAmount !== 0) {
    cashless = totalAmount * multiplier;
  }

  return {
    cash,
    cashless,
    paymentDetails: {
      detectedPayments,
      paymentSource: paymentSource || null,
      rawPaymentKeys: Object.keys(receiptData).filter((key) =>
        key.toLowerCase().includes('payment') ||
        ['cash', 'cashless', 'card'].includes(key.toLowerCase()),
      ),
      unknownPayments,
    },
    paymentParseStatus:
      unknownPayments.length > 0
        ? 'unknown_payment_type'
        : recognizedTotal > 0
          ? 'parsed'
          : paymentSource
            ? 'parsed_from_root'
            : 'fallback_cashless',
  };
}

class EvotorService {
  /**
   * Главный метод обработки входящего вебхука
   * @param {Object} payload - req.body от Эвотора
   * @returns {Object} { alreadyProcessed: boolean, receipt: Object }
   */
  async processReceipt(payload, { connection } = {}) {
    if (isTenantProviderIntegrationsEnabled() && !connection) {
      const error = new Error('Provider connection is not configured');
      error.code = 'PROVIDER_CONNECTION_REQUIRED';
      error.statusCode = 503;
      throw error;
    }
    const writeContext = connection || await resolveLegacyProviderContext('evotor');
    // 1. Извлекаем данные чека
    const receiptData =
      payload.data && payload.type?.toLowerCase().includes('receipt')
        ? payload.data
        : payload;

    // Уникальный ID чека
    const evotorId = String(
      receiptData.id || receiptData.receiptId || receiptData.uuid || Date.now(),
    );
    const idempotencyKey = buildProviderIdempotencyKey(writeContext, evotorId);

    // 2. Проверяем дубликаты
    const existing = await db.Receipt.findOne({
      where: { idempotencyKey },
    });
    if (existing) {
      return { alreadyProcessed: true, receipt: existing };
    }

    return db.sequelize.transaction(async (transaction) => {
      // 3. Считаем суммы и определяем тип оплаты
      const totalAmt = getReceiptTotalAmount(receiptData);
      const isPayback = receiptData.type === 'PAYBACK';
      const multiplier = isPayback ? -1 : 1;

      const { cash, cashless, paymentDetails, paymentParseStatus } = splitPayments(
        receiptData,
        totalAmt,
        multiplier,
      );

      // 4. Сохраняем заголовок чека
      const newReceipt = await db.Receipt.create(
        {
          organizationId: writeContext.organizationId,
          clubId: writeContext.clubId,
          integrationConnectionId: writeContext.connectionId || null,
          idempotencyKey,
          evotorId,
          dateTime: receiptData.dateTime || receiptData.closeDate || new Date(),
          type: receiptData.type || 'SELL',
          totalAmount: totalAmt * multiplier,
          cash,
          cashless,
          // Новые поля
          employeeId: receiptData.employeeId || null,
          shiftId: receiptData.shiftId || null,
          totalTax: (Number(receiptData.totalTax) || 0) * multiplier,
          totalDiscount: (Number(receiptData.totalDiscount) || 0) * multiplier,
          paymentDetails,
          paymentParseStatus,
          paymentSource:
            receiptData.paymentSource ||
            receiptData.payment_source ||
            receiptData.paymentType ||
            receiptData.payment_type ||
            receiptData.paymentMethod ||
            'UNKNOWN',
        },
        { transaction },
      );

      // 5. Парсим и сохраняем позиции (items)
      const positions = receiptData.positions || receiptData.items || [];

      if (positions.length > 0) {
        const itemsToInsert = positions.map((pos) => {
          // Базовые поля
          const quantity = Number(pos.quantity) || 1;
          const price = Number(pos.price) || 0;

          // В Эвоторе sumPrice - это обычно итоговая сумма позиции со всеми скидками
          // Если её нет, считаем по старинке
          let finalSum = Number(pos.sumPrice);
          if (isNaN(finalSum)) {
            finalSum = Number(pos.resultPrice || pos.sum || quantity * price);
          }

          return {
            receiptId: newReceipt.id,
            name: pos.name || 'Неизвестный товар',
            quantity: quantity * multiplier,
            price: price,
            sum: finalSum * multiplier,

            // Новые поля
            itemType: pos.itemType || null,
            measureName: pos.measureName || null,
            costPrice: Number(pos.costPrice) || 0,
            sumPrice: finalSum * multiplier,
            tax: (Number(pos.tax) || 0) * multiplier,
            taxPercent: Number(pos.taxPercent) || 0,
            discount: (Number(pos.discount) || 0) * multiplier,
          };
        });

        await db.ReceiptItem.bulkCreate(itemsToInsert, { transaction });
      }

      const pendingSales = await pendingSaleService.createPendingSalesForReceipt(
        newReceipt.id,
        { transaction },
      );

      return {
        alreadyProcessed: false,
        pendingSales,
        receipt: newReceipt,
      };
    });
  }
}

module.exports = new EvotorService();
