const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const db = require('../../models');
const shiftReportsService = require('../../src/services/shift-reports.service');

const originalModels = {
  Account: db.Account,
  Sequelize: db.Sequelize,
  Shift: db.Shift,
  ShiftReport: db.ShiftReport,
  ShiftReportAnswer: db.ShiftReportAnswer,
  ShiftReportTemplate: db.ShiftReportTemplate,
  ShiftReportTemplateItem: db.ShiftReportTemplateItem,
  Staff: db.Staff,
  sequelize: db.sequelize,
};

afterEach(() => {
  Object.assign(db, originalModels);
});

function makeModel(payload) {
  return {
    ...payload,
    async update(next) {
      Object.assign(this, next);
      return this;
    },
    toJSON() {
      return { ...this };
    },
  };
}

test('ensureReportsForShift creates scheduled reports with item snapshots', async () => {
  const createdReports = [];
  const createdAnswers = [];
  const template = makeModel({
    gracePeriodMinutes: 20,
    id: 10,
    items: [
      makeModel({
        id: 100,
        itemType: 'checkbox',
        label: 'Санитарная зона проверена',
        photoRequired: true,
        sortOrder: 10,
        status: 'active',
      }),
      makeModel({
        id: 101,
        itemType: 'text',
        label: 'Старый пункт',
        photoRequired: false,
        sortOrder: 20,
        status: 'archived',
      }),
    ],
    name: 'Промежуточный отчет',
    scheduleConfig: { times: ['12:00', '15:00'] },
    scheduleType: 'daily_times',
    sortOrder: 1,
    status: 'active',
    version: 3,
  });

  db.sequelize = {
    async transaction(callback) {
      return callback({ id: 'transaction' });
    },
  };
  db.ShiftReportTemplate = {
    async findAll() {
      return [template];
    },
  };
  db.ShiftReport = {
    async create(payload) {
      const report = makeModel({ id: createdReports.length + 1, ...payload });
      createdReports.push(payload);
      return report;
    },
    async findOne() {
      return null;
    },
  };
  db.ShiftReportAnswer = {
    async bulkCreate(payload) {
      createdAnswers.push(...payload);
    },
  };

  await shiftReportsService.ensureReportsForShift({
    date: '2026-07-04',
    id: 5,
    status: 'active',
  });

  assert.equal(createdReports.length, 2);
  assert.equal(createdReports[0].scheduledSlotKey, 'time:12:00');
  assert.equal(createdReports[0].templateVersion, 3);
  assert.equal(createdReports[0].itemsSnapshot.length, 1);
  assert.equal(createdReports[0].itemsSnapshot[0].label, 'Санитарная зона проверена');
  assert.equal(createdAnswers.length, 2);
  assert.equal(createdAnswers[0].itemLabel, 'Санитарная зона проверена');
  assert.equal(createdAnswers[0].photoRequired, true);
});

test('createTemplate normalizes daily report times and ignores legacy scope keys', async () => {
  let createdPayload = null;
  db.ShiftReportTemplate = {
    async create(payload) {
      createdPayload = payload;
      return makeModel({ id: 31, ...payload });
    },
    async findByPk(id) {
      assert.equal(Number(id), 31);
      return makeModel({ id: 31, items: [], ...createdPayload });
    },
  };

  const template = await shiftReportsService.createTemplate(
    {
      appliesToRole: 'admin',
      appliesToShiftType: 'day',
      name: 'Контроль смены',
      scheduleConfig: { times: ['15:00', '09:00', '09:00'] },
      scheduleType: 'daily_times',
    },
    { id: 1, role: 'owner' },
  );

  assert.equal(createdPayload.scheduleType, 'daily_times');
  assert.deepEqual(createdPayload.scheduleConfig.times, ['09:00', '15:00']);
  assert.equal(Object.hasOwn(createdPayload, 'appliesToRole'), false);
  assert.equal(Object.hasOwn(createdPayload, 'appliesToShiftType'), false);
  assert.deepEqual(template.scheduleConfig.times, ['09:00', '15:00']);
  assert.equal(Object.hasOwn(template, 'appliesToRole'), false);
  assert.equal(Object.hasOwn(template, 'appliesToShiftType'), false);
});

test('deleting a template item soft-deletes it and bumps template version', async () => {
  const item = makeModel({
    id: 20,
    itemType: 'checkbox',
    label: 'Проверить вход',
    photoRequired: false,
    sortOrder: 10,
    status: 'active',
    templateId: 8,
  });
  const template = makeModel({
    id: 8,
    version: 4,
  });

  db.sequelize = {
    async transaction(callback) {
      return callback({ id: 'transaction' });
    },
  };
  db.ShiftReportTemplateItem = {
    async findByPk(id) {
      assert.equal(Number(id), item.id);
      return item;
    },
  };
  db.ShiftReportTemplate = {
    async findByPk(id) {
      assert.equal(Number(id), template.id);
      return template;
    },
  };

  await shiftReportsService.setTemplateItemStatus(item.id, 'archived', {
    id: 1,
    role: 'owner',
  });

  assert.equal(item.status, 'archived');
  assert.ok(item.archivedAt instanceof Date);
  assert.equal(template.version, 5);
});

test('deleting a template soft-deletes it so it no longer creates new reports', async () => {
  const template = makeModel({
    archivedAt: null,
    gracePeriodMinutes: 30,
    id: 8,
    items: [],
    name: 'Контроль смены',
    scheduleConfig: { times: ['09:00'] },
    scheduleType: 'daily_times',
    sortOrder: 1,
    status: 'active',
    version: 2,
  });

  db.ShiftReportTemplate = {
    async findByPk(id) {
      assert.equal(Number(id), template.id);
      return template;
    },
  };

  await shiftReportsService.setTemplateStatus(template.id, 'archived', {
    id: 1,
    role: 'owner',
  });

  assert.equal(template.status, 'archived');
  assert.ok(template.archivedAt instanceof Date);
});

test('ensureReportsForShift asks only for active templates', async () => {
  let where = null;
  db.ShiftReportTemplate = {
    async findAll(options) {
      where = options.where;
      return [];
    },
  };

  const reports = await shiftReportsService.ensureReportsForShift({
    date: '2026-07-04',
    id: 5,
    status: 'active',
  });

  assert.deepEqual(reports, []);
  assert.deepEqual(where, { status: 'active' });
});

test('ensureReportsForShift applies every active template without legacy role or type filtering', async () => {
  const createdReports = [];
  const templates = [
    makeModel({
      appliesToRole: 'admin',
      appliesToShiftType: 'day',
      gracePeriodMinutes: 10,
      id: 41,
      items: [
        makeModel({
          id: 401,
          itemType: 'checkbox',
          label: 'Открытие',
          photoRequired: false,
          sortOrder: 10,
          status: 'active',
        }),
      ],
      name: 'Открытие',
      scheduleConfig: { times: ['09:00'] },
      scheduleType: 'daily_times',
      sortOrder: 10,
      status: 'active',
      version: 1,
    }),
    makeModel({
      appliesToRole: 'manager',
      appliesToShiftType: 'night',
      gracePeriodMinutes: 10,
      id: 42,
      items: [
        makeModel({
          id: 402,
          itemType: 'text',
          label: 'Передача смены',
          photoRequired: false,
          sortOrder: 10,
          status: 'active',
        }),
      ],
      name: 'Передача смены',
      scheduleConfig: { times: ['18:00'] },
      scheduleType: 'daily_times',
      sortOrder: 20,
      status: 'active',
      version: 1,
    }),
  ];

  db.ShiftReportTemplate = {
    async findAll(options) {
      assert.deepEqual(options.where, { status: 'active' });
      return templates;
    },
  };
  db.ShiftReport = {
    async create(payload) {
      createdReports.push(payload);
      return makeModel({ id: createdReports.length, ...payload });
    },
    async findOne() {
      return null;
    },
  };
  db.ShiftReportAnswer = { async bulkCreate() {} };
  db.sequelize = {
    async transaction(callback) {
      return callback({ id: 'transaction' });
    },
  };

  await shiftReportsService.ensureReportsForShift({
    date: '2026-07-17',
    id: 9,
    staffRole: 'trainer',
    status: 'active',
  });

  assert.equal(createdReports.length, 2);
  assert.deepEqual(
    createdReports.map((report) => report.templateId),
    [41, 42],
  );
  for (const report of createdReports) {
    assert.equal(Object.hasOwn(report.templateSnapshot, 'appliesToRole'), false);
    assert.equal(Object.hasOwn(report.templateSnapshot, 'appliesToShiftType'), false);
  }
});

test('submit saves a report comment separately from item answers', async () => {
  const answer = makeModel({
    attachments: [],
    booleanValue: null,
    id: 7,
    itemLabel: 'Входная зона проверена',
    itemSnapshot: { sortOrder: 10 },
    itemType: 'checkbox',
    photoRequired: false,
    reportId: 3,
  });
  const report = makeModel({
    answers: [answer],
    id: 3,
    comment: null,
    scheduledAt: new Date('2026-07-04T09:00:00+03:00'),
    shift: { id: 2, staffId: 11, status: 'active' },
    status: 'draft',
    templateSnapshot: { gracePeriodMinutes: 30, name: 'Открытие' },
  });

  db.ShiftReport = {
    async findByPk(id) {
      assert.equal(Number(id), report.id);
      return report;
    },
  };
  db.sequelize = {
    async transaction(callback) {
      return callback({ id: 'transaction' });
    },
  };

  const saved = await shiftReportsService.saveReport(
    report.id,
    { answers: [{ booleanValue: true, id: answer.id }], comment: 'Все спокойно' },
    { id: 5, role: 'owner', staffId: 11 },
    { submit: true },
  );

  assert.equal(answer.booleanValue, true);
  assert.equal(report.comment, 'Все спокойно');
  assert.equal(saved.comment, 'Все спокойно');
  assert.equal(saved.computedStatus, 'submitted');
});

test('submit does not require photos for photo-enabled answers', async () => {
  const answer = makeModel({
    attachments: [],
    booleanValue: true,
    id: 7,
    itemLabel: 'Фото санитарной зоны',
    itemSnapshot: { sortOrder: 10 },
    itemType: 'checkbox',
    photoRequired: true,
    reportId: 3,
  });
  const report = makeModel({
    answers: [answer],
    id: 3,
    scheduledAt: new Date('2026-07-04T09:00:00+03:00'),
    shift: { id: 2, staffId: 11, status: 'active' },
    status: 'draft',
    templateSnapshot: { gracePeriodMinutes: 30, name: 'Фото' },
  });

  db.ShiftReport = {
    async findByPk(id) {
      assert.equal(Number(id), report.id);
      return report;
    },
  };
  db.sequelize = {
    async transaction(callback) {
      return callback({ id: 'transaction' });
    },
  };

  const saved = await shiftReportsService.saveReport(
    report.id,
    { answers: [{ booleanValue: true, id: answer.id }] },
    { id: 5, role: 'admin', staffId: 11 },
    { submit: true },
  );

  assert.equal(saved.computedStatus, 'submitted');
});

test('historical report opens from snapshot when template was deleted', async () => {
  const answer = makeModel({
    attachments: [],
    booleanValue: true,
    id: 7,
    itemLabel: 'Входная зона',
    itemSnapshot: { sortOrder: 10 },
    itemType: 'checkbox',
    photoRequired: false,
    reportId: 3,
  });
  const report = makeModel({
    answers: [answer],
    id: 3,
    scheduledAt: new Date('2026-07-04T09:00:00+03:00'),
    shift: { id: 2, staffId: 11, status: 'active' },
    status: 'submitted',
    template: null,
    templateSnapshot: {
      appliesToRole: 'admin',
      appliesToShiftType: 'day',
      gracePeriodMinutes: 30,
      name: 'Удаленный шаблон',
    },
  });

  db.ShiftReport = {
    async findByPk(id) {
      assert.equal(Number(id), report.id);
      return report;
    },
  };

  const saved = await shiftReportsService.getReport(report.id, {
    id: 5,
    role: 'owner',
  });

  assert.equal(saved.templateSnapshot.name, 'Удаленный шаблон');
  assert.equal(Object.hasOwn(saved.templateSnapshot, 'appliesToRole'), false);
  assert.equal(Object.hasOwn(saved.templateSnapshot, 'appliesToShiftType'), false);
  assert.equal(report.templateSnapshot.appliesToRole, 'admin');
  assert.equal(report.templateSnapshot.appliesToShiftType, 'day');
  assert.equal(saved.answers[0].itemLabel, 'Входная зона');
});

test('ShiftReportTemplate model does not expose removed scope attributes', () => {
  assert.equal(Object.hasOwn(db.ShiftReportTemplate.rawAttributes, 'appliesToRole'), false);
  assert.equal(
    Object.hasOwn(db.ShiftReportTemplate.rawAttributes, 'appliesToShiftType'),
    false,
  );
});

test('uploadAttachment rejects more than 10 photos per answer', async () => {
  const answer = makeModel({
    attachments: Array.from({ length: 10 }, (_, index) => ({
      id: `photo-${index}`,
      relativePath: `3/photo-${index}.png`,
    })),
    id: 8,
    itemType: 'checkbox',
    photoRequired: true,
    reportId: 3,
  });
  const report = makeModel({
    answers: [answer],
    id: 3,
    shift: { id: 2, status: 'active' },
    status: 'draft',
  });

  db.ShiftReport = {
    async findByPk(id) {
      assert.equal(Number(id), report.id);
      return report;
    },
  };

  await assert.rejects(
    () =>
      shiftReportsService.uploadAttachment(
        report.id,
        answer.id,
        {
          data: 'data:image/png;base64,aGVsbG8=',
          fileName: 'extra.png',
          mimeType: 'image/png',
        },
        { id: 1, role: 'owner' },
      ),
    /до 10 фото/,
  );
});

test('admin report list is limited to active shift scope', async () => {
  db.Shift = {
    async findOne() {
      return null;
    },
  };

  const reports = await shiftReportsService.listReports(
    { status: 'all' },
    { id: 7, role: 'admin', staffId: 99 },
  );

  assert.deepEqual(reports, []);
});

test('active shift reports hide reports an admin cannot operate', async () => {
  const shift = makeModel({
    id: 2,
    staffId: 11,
    status: 'active',
  });
  const report = makeModel({
    answers: [],
    id: 3,
    scheduledAt: new Date('2026-07-04T09:00:00+03:00'),
    shift,
    status: 'pending',
    templateSnapshot: { gracePeriodMinutes: 30, name: 'Чужая смена' },
  });

  db.Shift = {
    async findOne() {
      return shift;
    },
  };
  db.ShiftReportTemplate = {
    async findAll() {
      return [];
    },
  };
  db.ShiftReport = {
    async findAll() {
      return [report];
    },
  };

  const result = await shiftReportsService.getActiveShiftReports({
    id: 7,
    role: 'admin',
    staffId: 99,
  });

  assert.deepEqual(result.reports, []);
  assert.equal(result.shift.id, shift.id);
});
