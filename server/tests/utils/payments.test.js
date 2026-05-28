const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeReceiptPaymentSource,
  resolveStoredReceiptPayments,
} = require('../../src/utils/payments');

test('normalizes known Evotor-style payment source aliases', () => {
  assert.equal(normalizeReceiptPaymentSource('CASH'), 'cash');
  assert.equal(normalizeReceiptPaymentSource('PAY_CASH'), 'cash');
  assert.equal(normalizeReceiptPaymentSource('0'), 'cash');
  assert.equal(normalizeReceiptPaymentSource('CARD'), 'cashless');
  assert.equal(normalizeReceiptPaymentSource('ELECTRON'), 'cashless');
  assert.equal(normalizeReceiptPaymentSource('PAY_BY_CREDIT'), 'cashless');
  assert.equal(normalizeReceiptPaymentSource('unexpected'), 'unknown');
});

test('resolves stored receipt payments without double counting totals', () => {
  assert.deepEqual(
    resolveStoredReceiptPayments({
      cash: 300,
      cashless: 700,
      paymentSource: 'unknown',
      totalAmount: 1000,
      type: 'SELL',
    }),
    {
      cash: 300,
      cashless: 700,
      paymentMethod: 'mixed',
      paymentSource: 'unknown',
      total: 1000,
    },
  );
});

test('falls back to payment source when explicit cash fields are empty', () => {
  assert.deepEqual(
    resolveStoredReceiptPayments({
      cash: 0,
      cashless: 0,
      paymentSource: 'PAY_CASH',
      totalAmount: 1000,
      type: 'SELL',
    }),
    {
      cash: 1000,
      cashless: 0,
      paymentMethod: 'cash',
      paymentSource: 'cash',
      total: 1000,
    },
  );
});

test('keeps payback receipts negative', () => {
  assert.deepEqual(
    resolveStoredReceiptPayments({
      cash: 0,
      cashless: 500,
      paymentSource: 'CARD',
      totalAmount: 500,
      type: 'PAYBACK',
    }),
    {
      cash: -0,
      cashless: -500,
      paymentMethod: 'cashless',
      paymentSource: 'cashless',
      total: -500,
    },
  );
});
