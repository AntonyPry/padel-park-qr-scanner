const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const db = require('../../models');
const bookingsService = require('../../src/services/bookings.service');
const callTasksService = require('../../src/services/call-tasks.service');
const corporateClientsService = require('../../src/services/corporate-clients.service');
const pendingSaleService = require('../../src/services/pending-sale.service');
const managerControlDashboardService = require('../../src/services/manager-control-dashboard.service');

const originalModels = {
  Certificate: db.Certificate,
  ClientSubscription: db.ClientSubscription,
  TelephonyCall: db.TelephonyCall,
};
const originalServices = {
  getSchedule: bookingsService.getSchedule,
  listCallTasks: callTasksService.list,
  listCorporateClients: corporateClientsService.listCorporateClients,
  listPendingSales: pendingSaleService.listPendingSales,
};

afterEach(() => {
  Object.assign(db, originalModels);
  bookingsService.getSchedule = originalServices.getSchedule;
  callTasksService.list = originalServices.listCallTasks;
  corporateClientsService.listCorporateClients = originalServices.listCorporateClients;
  pendingSaleService.listPendingSales = originalServices.listPendingSales;
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

function booking(overrides = {}) {
  return {
    client: { id: 10, name: 'Анна', phone: '+70000000001', status: 'active' },
    clientName: 'Анна',
    court: { id: 1, name: 'Корт 1' },
    courtId: 1,
    endsAt: '2026-06-20T11:00:00.000Z',
    id: 1,
    paidAmount: 0,
    paymentStatus: 'unpaid',
    price: 2000,
    startsAt: '2026-06-20T10:00:00.000Z',
    status: 'confirmed',
    ...overrides,
  };
}

test('manager control dashboard aggregates actionable queues', async () => {
  const account = { id: 1, role: 'manager' };

  pendingSaleService.listPendingSales = async () => [
    {
      amount: 5200,
      client: null,
      clientId: null,
      id: 10,
      itemName: 'Абонемент 4 тренировки',
      receiptDateTime: daysFromNow(-1),
      saleIntent: 'subscription',
      status: 'pending',
    },
    {
      amount: 5000,
      client: { id: 2, name: 'Клиент' },
      clientId: 2,
      id: 11,
      itemName: 'Сертификат',
      saleIntent: 'certificate',
      status: 'pending',
    },
  ];
  db.ClientSubscription = {
    async findAll({ where }) {
      assert.equal(where.status, 'active');
      return [
        row({
          client: { id: 20, name: 'Анна Петрова', phone: '+70000000002', status: 'active' },
          clientId: 20,
          expiresAt: daysFromNow(3),
          id: 30,
          isUnlimited: false,
          saleAmount: 5200,
          sessionsTotal: 4,
          sessionsUsed: 1,
          startsAt: daysFromNow(-10),
          status: 'active',
          typeName: 'Групповые 4',
        }),
      ];
    },
  };
  db.Certificate = {
    async findAll({ where }) {
      assert.equal(where.status, 'active');
      return [
        row({
          amountTotal: 5000,
          amountUsed: 1000,
          certificateType: 'money',
          client: { id: 21, name: 'Борис', phone: '+70000000003', status: 'active' },
          clientId: 21,
          code: 'CERT-1',
          expiresAt: daysFromNow(5),
          id: 40,
          saleAmount: 5000,
          startsAt: daysFromNow(-1),
          status: 'active',
          title: 'Сертификат 5000',
        }),
      ];
    },
  };
  corporateClientsService.listCorporateClients = async (_query, receivedAccount) => {
    assert.equal(receivedAccount, account);
    return [
      { balance: 2500, id: 50, name: 'ООО Низкий баланс', status: 'active' },
      { balance: 12000, id: 51, name: 'ООО Нормальный баланс', status: 'active' },
    ];
  };
  callTasksService.list = async (receivedAccount, query) => {
    assert.equal(receivedAccount, account);
    assert.equal(query.status, 'active');
    return [
      {
        dueAt: daysFromNow(-1),
        id: 60,
        overdueCount: 3,
        status: 'in_progress',
        title: 'Вернуть клиентов',
      },
      {
        dueAt: daysFromNow(1),
        id: 61,
        overdueCount: 0,
        status: 'backlog',
        title: 'Будущий обзвон',
      },
    ];
  };
  db.TelephonyCall = {
    async count() {
      return 1;
    },
    async findAll() {
      return [
        row({
          callStatus: 'missed',
          client: null,
          clientPhone: '+7 (999) 111-22-33',
          createdAt: daysFromNow(-1),
          id: 70,
          processingStatus: 'new',
          result: null,
          staff: { id: 1, name: 'Менеджер' },
        }),
      ];
    },
  };
  bookingsService.getSchedule = async () => ({
    bookings: [
      booking({ id: 80 }),
      booking({
        cancellationReason: 'Клиент отменил',
        id: 81,
        paymentStatus: 'unpaid',
        price: 0,
        status: 'canceled',
      }),
      booking({
        clientName: 'Виктор',
        endsAt: '2026-06-20T13:00:00.000Z',
        id: 82,
        paymentStatus: 'paid',
        price: 2000,
        startsAt: '2026-06-20T12:00:00.000Z',
      }),
      booking({
        clientName: 'Глеб',
        endsAt: '2026-06-20T13:30:00.000Z',
        id: 83,
        paymentStatus: 'paid',
        price: 2000,
        startsAt: '2026-06-20T12:30:00.000Z',
      }),
    ],
  });

  const dashboard = await managerControlDashboardService.getDashboard(
    { date: '2026-06-20', expiringDays: 14, lowBalanceThreshold: 5000 },
    account,
  );

  assert.equal(dashboard.sections.pendingSales.total, 1);
  assert.equal(dashboard.sections.expiringSubscriptions.total, 1);
  assert.equal(dashboard.sections.expiringCertificates.total, 1);
  assert.equal(dashboard.sections.lowCorporateBalances.total, 1);
  assert.equal(dashboard.sections.overdueCallTasks.total, 1);
  assert.equal(dashboard.sections.missedCalls.total, 1);
  assert.equal(dashboard.sections.problemBookings.total, 4);
  assert.equal(dashboard.summary.attentionTotal, 10);
  assert.equal(
    dashboard.sections.pendingSales.items[0].actionHref,
    '/admin/catalog?tab=pending',
  );
  assert.equal(
    dashboard.sections.expiringSubscriptions.items[0].actionHref,
    '/admin/clients?clientId=20',
  );
  assert.equal(
    dashboard.sections.problemBookings.items.some((item) =>
      item.problemTypes.includes('conflict'),
    ),
    true,
  );
});

test('booking problem detector marks unpaid, canceled and overlapping bookings', () => {
  const items = managerControlDashboardService.__testing.buildProblemBookings([
    booking({ id: 1 }),
    booking({ id: 2, price: 0, status: 'canceled' }),
    booking({
      endsAt: '2026-06-20T15:00:00.000Z',
      id: 3,
      paymentStatus: 'paid',
      startsAt: '2026-06-20T14:00:00.000Z',
    }),
    booking({
      endsAt: '2026-06-20T15:30:00.000Z',
      id: 4,
      paymentStatus: 'paid',
      startsAt: '2026-06-20T14:30:00.000Z',
    }),
  ]);

  assert.equal(items.length, 4);
  assert.equal(items.find((item) => item.id === 1).problemTypes.includes('unpaid'), true);
  assert.equal(items.find((item) => item.id === 2).problemTypes.includes('canceled'), true);
  assert.equal(items.find((item) => item.id === 3).problemTypes.includes('conflict'), true);
  assert.equal(items.find((item) => item.id === 4).problemTypes.includes('conflict'), true);
});
