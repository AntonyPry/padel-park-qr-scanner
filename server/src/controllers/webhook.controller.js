// src/controllers/webhook.controller.js
const evotorService = require('../services/evotor.service');
const {
  isTenantProviderIntegrationsEnabled,
} = require('../tenant-context/capabilities');
const {
  withProviderConnectionLock,
} = require('../provider-integrations/locks');
const {
  isProviderCredentialKey,
} = require('../provider-integrations/credential-keys');

const SENSITIVE_LOG_KEYS = new Set([
  'client_email',
  'client_phone',
  'email',
  'phone',
]);
const PAYMENT_LOG_KEY_PATTERN =
  /(payment|pay|cash|cashless|card|electron|sbp|amount|sum|total)/i;
const RAW_PAYLOAD_LOG_LIMIT = 20000;

function sanitizeForLog(value, key = '', depth = 0) {
  const normalizedKey = String(key).toLowerCase();
  if (SENSITIVE_LOG_KEYS.has(normalizedKey) || isProviderCredentialKey(key)) {
    return '[redacted]';
  }
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > 300 ? `${value.slice(0, 300)}...` : value;
  }
  if (typeof value !== 'object') return value;
  if (depth >= 4) {
    return Array.isArray(value)
      ? `[array:${value.length}]`
      : `[object:${Object.keys(value).length} keys]`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeForLog(item, key, depth + 1));
  }

  return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
    acc[entryKey] = sanitizeForLog(entryValue, entryKey, depth + 1);
    return acc;
  }, {});
}

function summarizeValue(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      sample: sanitizeForLog(value[0]),
    };
  }
  if (typeof value === 'object') {
    return {
      type: 'object',
      keys: Object.keys(value),
    };
  }
  return sanitizeForLog(value);
}

function collectPaymentCandidates(value, path = 'payload', result = []) {
  if (!value || typeof value !== 'object' || result.length >= 50) return result;

  Object.entries(value).forEach(([key, child]) => {
    if (result.length >= 50) return;
    const childPath = `${path}.${key}`;
    if (PAYMENT_LOG_KEY_PATTERN.test(key)) {
      result.push({
        path: childPath,
        value: summarizeValue(child),
      });
    }

    if (child && typeof child === 'object') {
      collectPaymentCandidates(child, childPath, result);
    }
  });

  return result;
}

function getReceiptData(payload) {
  return payload?.data && payload.type?.toLowerCase?.().includes('receipt')
    ? payload.data
    : payload;
}

function parseEvotorBody(body) {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  try {
    const parsed = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed;
  } catch {
    const error = new Error('Invalid provider payload');
    error.code = 'PROVIDER_PAYLOAD_INVALID';
    error.statusCode = 400;
    throw error;
  }
}

function logEvotorPaymentDiagnostic({ payload, receipt }) {
  const receiptData = getReceiptData(payload);
  const diagnostic = {
    evotorId: receipt.evotorId,
    parsed: {
      cash: Number(receipt.cash) || 0,
      cashless: Number(receipt.cashless) || 0,
      totalAmount: Number(receipt.totalAmount) || 0,
      paymentSource: receipt.paymentSource || null,
      paymentParseStatus: receipt.paymentParseStatus || null,
      paymentDetails: sanitizeForLog(receipt.paymentDetails || null),
    },
    shape: {
      payloadTopKeys: Object.keys(payload || {}),
      receiptTopKeys: Object.keys(receiptData || {}),
      nestedReceiptKeys: Object.keys(receiptData?.receipt || {}),
      nestedDataKeys: Object.keys(receiptData?.data || {}),
    },
    paymentCandidates: collectPaymentCandidates(payload || {}),
  };

  console.log(`🧾 [EVOTOR PAYMENT DIAGNOSTIC] ${JSON.stringify(diagnostic)}`);

  if (process.env.EVOTOR_WEBHOOK_LOG_RAW === 'true') {
    const rawPayload = JSON.stringify(sanitizeForLog(payload || {}));
    console.log(
      `🧾 [EVOTOR RAW PAYLOAD SANITIZED] ${rawPayload.slice(0, RAW_PAYLOAD_LOG_LIMIT)}`,
    );
  }
}

class WebhookController {
  async handleEvotor(req, res) {
    try {
      if (isTenantProviderIntegrationsEnabled()) {
        const connection = req.providerConnection;
        if (!connection) {
          const error = new Error('Provider connection was not found');
          error.code = 'PROVIDER_CONNECTION_REJECTED';
          error.statusCode = 404;
          throw error;
        }
        const payload = parseEvotorBody(req.body);
        const result = await withProviderConnectionLock(
          connection,
          () => evotorService.processReceipt(payload, { connection }),
        );
        if (result.alreadyProcessed) return res.status(200).send('Already processed');
        return res.status(200).send('OK');
      }

      const secret = process.env.EVOTOR_WEBHOOK_SECRET || '';
      const token =
        req.headers['x-evotor-token'] || req.headers['authorization'] || '';

      if (secret && token.replace(/^Bearer\s+/i, '').trim() !== secret) {
        return res.status(401).send('Unauthorized');
      }

      // Вся тяжелая логика парсинга и сохранения ушла в сервис
      const payload = parseEvotorBody(req.body);
      const result = await evotorService.processReceipt(payload);

      if (result.alreadyProcessed) {
        return res.status(200).send('Already processed');
      }

      console.log(
        `✅ [NEW] Сохранен чек Эвотор: ${result.receipt.evotorId} на сумму ${result.receipt.totalAmount} ₽`,
      );
      logEvotorPaymentDiagnostic({
        payload,
        receipt: result.receipt,
      });

      res.status(200).send('OK');
    } catch (error) {
      console.error('EVOTOR_INGRESS_FAILED', error.code || 'PROVIDER_REQUEST_FAILED');
      res.status(Number(error.statusCode) || 500).send(
        error.statusCode && error.statusCode < 500 ? 'Rejected' : 'Server Error',
      );
    }
  }
}

module.exports = new WebhookController();
