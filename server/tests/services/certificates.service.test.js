const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const db = require('../../models');
const certificatesService = require('../../src/services/certificates.service');

const originalModels = {
  Certificate: db.Certificate,
  CertificateRedemption: db.CertificateRedemption,
  PendingSale: db.PendingSale,
  User: db.User,
  sequelize: db.sequelize,
};

afterEach(() => {
  Object.assign(db, originalModels);
});

test('certificate status and balances are calculated safely', () => {
  assert.equal(
    certificatesService.calculateStatus(
      {
        amountTotal: 5000,
        amountUsed: 1500,
        certificateType: 'money',
        expiresAt: new Date('2026-07-01T00:00:00.000Z'),
        status: 'active',
      },
      new Date('2026-06-15T00:00:00.000Z'),
    ),
    'active',
  );
  assert.equal(
    certificatesService.calculateMoneyBalance({
      amountTotal: 5000,
      amountUsed: 6200,
    }),
    0,
  );
  assert.equal(
    certificatesService.calculateUnitsRemaining({
      unitsTotal: 4,
      unitsUsed: 2,
    }),
    2,
  );
  assert.equal(
    certificatesService.calculateStatus(
      {
        certificateType: 'service',
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        status: 'active',
        unitsTotal: 4,
        unitsUsed: 0,
      },
      new Date('2026-06-15T00:00:00.000Z'),
    ),
    'expired',
  );
  assert.equal(
    certificatesService.calculateStatus({
      amountTotal: 5000,
      amountUsed: 5000,
      certificateType: 'money',
      status: 'active',
    }),
    'redeemed',
  );
});

test('createFromPendingSale creates money certificate with unique manual code', async () => {
  const pendingSale = {
    clientId: 20,
    id: 10,
    itemName: 'Сертификат 5000',
    linkedAt: new Date('2026-06-05T10:00:00.000Z'),
    linkedByAccountId: 7,
    metadata: {
      amount: 5000,
    },
    receipt: {
      dateTime: new Date('2026-06-05T09:00:00.000Z'),
      evotorId: 'receipt-1',
      id: 40,
      type: 'SELL',
    },
    receiptId: 40,
    receiptItem: {
      id: 50,
      name: 'Сертификат 5000',
      quantity: 1,
      sum: 5000,
    },
    receiptItemId: 50,
    saleIntent: 'certificate',
    saleSetting: {
      saleSettings: null,
    },
    status: 'linked',
    toJSON() {
      return { ...this };
    },
  };
  const createdRows = [];

  db.PendingSale = {
    async findByPk(id) {
      assert.equal(Number(id), pendingSale.id);
      return pendingSale;
    },
  };
  db.Certificate = {
    async create(payload) {
      createdRows.push(payload);
      return { id: 99, ...payload };
    },
    async findByPk(id) {
      assert.equal(Number(id), 99);
      return {
        id,
        ...createdRows[0],
        client: { id: 20, name: 'Клиент', phone: '+7', status: 'active' },
      };
    },
    async findOne({ where }) {
      if (where.code) {
        assert.equal(where.code, 'GIFT-5000');
      }
      return null;
    },
  };

  const result = await certificatesService.createFromPendingSale(pendingSale, {
    account: { id: 7, role: 'manager' },
    certificate: { code: 'gift-5000', validityDays: 180 },
  });

  assert.equal(result.created, true);
  assert.equal(result.certificate.code, 'GIFT-5000');
  assert.equal(result.certificate.clientId, 20);
  assert.equal(result.certificate.amountTotal, 5000);
  assert.equal(result.certificate.amountRemaining, 5000);
  assert.equal(createdRows.length, 1);
  assert.equal(createdRows[0].pendingSaleId, pendingSale.id);
  assert.equal(createdRows[0].sourceReceiptItemId, pendingSale.receiptItemId);
});

test('createFromPendingSale validates manual certificate code uniqueness', async () => {
  const pendingSale = {
    clientId: 20,
    id: 10,
    itemName: 'Сертификат',
    receiptItemId: 50,
    saleIntent: 'certificate',
    status: 'linked',
    toJSON() {
      return { ...this };
    },
  };

  db.PendingSale = {
    async findByPk(id) {
      assert.equal(Number(id), pendingSale.id);
      return pendingSale;
    },
  };
  db.Certificate = {
    async create() {
      throw new Error('create should not be called');
    },
    async findOne({ where }) {
      if (where.code) return { id: 1, code: where.code };
      return null;
    },
  };

  await assert.rejects(
    () =>
      certificatesService.createFromPendingSale(pendingSale, {
        certificate: { code: 'DUPLICATE' },
      }),
    /уже существует/,
  );
});

test('redeemCertificate partially spends money certificate and marks final spend redeemed', async () => {
  const redemptions = [];
  const updates = [];
  const certificate = {
    amountTotal: 5000,
    amountUsed: 3000,
    certificateType: 'money',
    clientId: 20,
    code: 'CERT-1',
    id: 91,
    status: 'active',
    title: 'Сертификат',
    async update(payload) {
      updates.push(payload);
      Object.assign(this, payload);
      return this;
    },
    toJSON() {
      return { ...this };
    },
  };

  db.sequelize = {
    async transaction(callback) {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    },
  };
  db.Certificate = {
    async findByPk(id) {
      assert.equal(Number(id), certificate.id);
      return certificate;
    },
  };
  db.CertificateRedemption = {
    async create(payload) {
      redemptions.push(payload);
      return { id: 501, ...payload };
    },
    async findByPk(id) {
      assert.equal(Number(id), 501);
      return {
        id,
        ...redemptions[0],
        redeemedBy: { email: 'admin@example.com', id: 7, role: 'admin' },
      };
    },
  };

  const result = await certificatesService.redeemCertificate(
    certificate.id,
    { amount: 2000, comment: 'Оплата тренировки' },
    { id: 7, role: 'admin' },
  );

  assert.equal(redemptions.length, 1);
  assert.equal(redemptions[0].amount, 2000);
  assert.equal(redemptions[0].redeemedByAccountId, 7);
  assert.equal(updates[0].amountUsed, 5000);
  assert.equal(updates[0].status, 'redeemed');
  assert.equal(result.certificate.amountRemaining, 0);
  assert.equal(result.certificate.status, 'redeemed');
  assert.equal(result.redemption.status, 'active');
});

test('reverseCertificateRedemption restores service package units', async () => {
  const certificateUpdates = [];
  const redemptionUpdates = [];
  const certificate = {
    certificateType: 'service',
    clientId: 20,
    code: 'PKG-1',
    id: 92,
    status: 'redeemed',
    title: 'Пакет тренировок',
    unitsTotal: 4,
    unitsUsed: 4,
    async update(payload) {
      certificateUpdates.push(payload);
      Object.assign(this, payload);
      return this;
    },
    toJSON() {
      return { ...this };
    },
  };
  const redemption = {
    certificateId: certificate.id,
    clientId: 20,
    id: 601,
    quantity: 1,
    redeemedAt: new Date('2026-06-10T00:00:00.000Z'),
    status: 'active',
    async update(payload) {
      redemptionUpdates.push(payload);
      Object.assign(this, payload);
      return this;
    },
    toJSON() {
      return { ...this };
    },
  };

  db.sequelize = {
    async transaction(callback) {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    },
  };
  db.Certificate = {
    async findByPk(id) {
      assert.equal(Number(id), certificate.id);
      return certificate;
    },
  };
  db.CertificateRedemption = {
    async findOne({ where }) {
      assert.equal(Number(where.id), redemption.id);
      assert.equal(Number(where.certificateId), certificate.id);
      return redemption;
    },
    async findByPk(id) {
      assert.equal(Number(id), redemption.id);
      return {
        ...redemption,
        reversedBy: { email: 'manager@example.com', id: 8, role: 'manager' },
      };
    },
  };

  const result = await certificatesService.reverseCertificateRedemption(
    certificate.id,
    redemption.id,
    { reason: 'Ошибочное списание' },
    { id: 8, role: 'manager' },
  );

  assert.equal(certificateUpdates[0].unitsUsed, 3);
  assert.equal(certificateUpdates[0].status, 'active');
  assert.equal(redemptionUpdates[0].status, 'reversed');
  assert.equal(redemptionUpdates[0].reversedByAccountId, 8);
  assert.equal(result.certificate.unitsRemaining, 1);
  assert.equal(result.certificate.status, 'active');
  assert.equal(result.redemption.status, 'reversed');
});
