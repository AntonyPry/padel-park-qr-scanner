const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const db = require('../../models');
const certificatesService = require('../../src/services/certificates.service');
const corporateClientsService = require('../../src/services/corporate-clients.service');
const pendingSaleService = require('../../src/services/pending-sale.service');
const prepaymentsDashboardService = require('../../src/services/prepayments-dashboard.service');

const originalModels = {
  Certificate: db.Certificate,
  ClientSubscription: db.ClientSubscription,
  SubscriptionType: db.SubscriptionType,
  User: db.User,
};
const originalServices = {
  listCorporateClients: corporateClientsService.listCorporateClients,
  listPendingSales: pendingSaleService.listPendingSales,
};

afterEach(() => {
  Object.assign(db, originalModels);
  Object.assign(corporateClientsService, {
    listCorporateClients: originalServices.listCorporateClients,
  });
  Object.assign(pendingSaleService, {
    listPendingSales: originalServices.listPendingSales,
  });
});

function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function row(data) {
  return {
    ...data,
    toJSON() {
      return { ...this };
    },
  };
}

test('dashboard hides domain sections that current role cannot view', async () => {
  let pendingCalls = 0;
  let subscriptionCalls = 0;
  let certificateCalls = 0;
  let corporateCalls = 0;

  pendingSaleService.listPendingSales = async () => {
    pendingCalls += 1;
    return [];
  };
  db.ClientSubscription = {
    async findAll() {
      subscriptionCalls += 1;
      return [];
    },
  };
  db.Certificate = {
    async findAll() {
      certificateCalls += 1;
      return [];
    },
  };
  corporateClientsService.listCorporateClients = async (_query, account) => {
    corporateCalls += 1;
    assert.equal(account.role, 'accountant');
    return [
      {
        balance: 12000,
        id: 1,
        name: 'ООО Ракетка',
        status: 'active',
      },
    ];
  };

  const dashboard = await prepaymentsDashboardService.getDashboard(
    {},
    { role: 'accountant' },
  );

  assert.equal(dashboard.permissions.pendingSales, false);
  assert.equal(dashboard.permissions.subscriptions, false);
  assert.equal(dashboard.permissions.certificates, false);
  assert.equal(dashboard.permissions.corporateBalances, true);
  assert.equal(dashboard.sections.pendingSales.available, false);
  assert.equal(dashboard.sections.corporateBalances.available, true);
  assert.equal(dashboard.summary.corporateBalances.count, 1);
  assert.equal(pendingCalls, 0);
  assert.equal(subscriptionCalls, 0);
  assert.equal(certificateCalls, 0);
  assert.equal(corporateCalls, 1);
});

test('dashboard aggregates visible modules and filters expiring subscriptions', async () => {
  pendingSaleService.listPendingSales = async () => [
    {
      amount: 5200,
      category: 'Абонементы',
      client: null,
      evotorId: 'receipt-1',
      id: 10,
      itemName: 'Абонемент 4 тренировки',
      saleIntent: 'subscription',
      status: 'pending',
    },
  ];
  db.ClientSubscription = {
    async findAll() {
      return [
        row({
          client: { id: 20, name: 'Анна Петрова', phone: '+70000000001', status: 'active' },
          clientId: 20,
          expiresAt: daysFromNow(7),
          id: 30,
          isUnlimited: false,
          saleAmount: 5200,
          sessionsTotal: 4,
          sessionsUsed: 3,
          startsAt: daysFromNow(-10),
          status: 'active',
          typeName: 'Групповые 4',
        }),
        row({
          client: { id: 21, name: 'Борис', phone: '+70000000002', status: 'active' },
          clientId: 21,
          expiresAt: daysFromNow(60),
          id: 31,
          isUnlimited: false,
          saleAmount: 9600,
          sessionsTotal: 8,
          sessionsUsed: 1,
          startsAt: daysFromNow(-1),
          status: 'active',
          typeName: 'Групповые 8',
        }),
      ];
    },
  };
  db.Certificate = {
    async findAll() {
      return [
        row({
          amountTotal: 5000,
          amountUsed: 0,
          certificateType: 'money',
          client: { id: 20, name: 'Анна Петрова', phone: '+70000000001', status: 'active' },
          clientId: 20,
          code: 'CERT-1',
          expiresAt: daysFromNow(30),
          id: 40,
          saleAmount: 5000,
          startsAt: daysFromNow(-1),
          status: 'active',
          title: 'Сертификат 5000',
          unitsUsed: 0,
        }),
      ];
    },
  };
  corporateClientsService.listCorporateClients = async () => [
    {
      balance: 3000,
      id: 50,
      name: 'ООО Ракетка',
      status: 'active',
    },
  ];

  const dashboard = await prepaymentsDashboardService.getDashboard(
    {
      expiry: 'expiring_soon',
      q: 'анна',
      type: 'subscriptions',
    },
    { role: 'manager' },
  );

  assert.equal(dashboard.summary.pendingSales.count, 1);
  assert.equal(dashboard.summary.activeSubscriptions.count, 2);
  assert.equal(dashboard.summary.activeSubscriptions.expiringSoon, 1);
  assert.equal(dashboard.summary.activeSubscriptions.lowRemaining, 1);
  assert.equal(dashboard.summary.activeCertificates.count, 1);
  assert.equal(dashboard.summary.corporateBalances.lowBalance, 1);
  assert.equal(dashboard.sections.subscriptions.total, 1);
  assert.equal(dashboard.sections.subscriptions.items[0].client.name, 'Анна Петрова');
  assert.equal(dashboard.sections.subscriptions.items[0].flags.expiringSoon, true);
  assert.equal(dashboard.sections.pendingSales.total, 0);
});
