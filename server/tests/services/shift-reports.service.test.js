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
        helperText: 'Сделайте фото',
        id: 100,
        isRequired: true,
        itemType: 'checkbox_with_photo',
        label: 'Санитарная зона проверена',
        photoRequired: true,
        sortOrder: 10,
        status: 'active',
      }),
      makeModel({
        id: 101,
        isRequired: true,
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

test('createTemplate normalizes daily report times', async () => {
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
      name: 'Контроль смены',
      scheduleConfig: { times: ['15:00', '09:00', '09:00'] },
      scheduleType: 'daily_times',
    },
    { id: 1, role: 'owner' },
  );

  assert.equal(createdPayload.scheduleType, 'daily_times');
  assert.deepEqual(createdPayload.scheduleConfig.times, ['09:00', '15:00']);
  assert.deepEqual(template.scheduleConfig.times, ['09:00', '15:00']);
});

test('archiving a template item updates status and bumps template version', async () => {
  const item = makeModel({
    helperText: '',
    id: 20,
    isRequired: true,
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

test('submit does not require a comment for required checkbox answers', async () => {
  const answer = makeModel({
    attachments: [],
    booleanValue: null,
    id: 7,
    isRequired: true,
    itemLabel: 'Входная зона проверена',
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
    { answers: [{ booleanValue: true, comment: '', id: answer.id }] },
    { id: 5, role: 'owner', staffId: 11 },
    { submit: true },
  );

  assert.equal(answer.booleanValue, true);
  assert.equal(answer.comment, null);
  assert.equal(saved.computedStatus, 'submitted');
});

test('submit rejects required photo answers without attachments', async () => {
  const answer = makeModel({
    attachments: [],
    id: 7,
    isRequired: true,
    itemLabel: 'Фото санитарной зоны',
    itemSnapshot: { sortOrder: 10 },
    itemType: 'photo',
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

  await assert.rejects(
    () =>
      shiftReportsService.saveReport(
        report.id,
        { answers: [{ id: answer.id }] },
        { id: 5, role: 'admin', staffId: 11 },
        { submit: true },
      ),
    /Фото санитарной зоны: фото/,
  );
});

test('uploadAttachment rejects more than 10 photos per answer', async () => {
  const answer = makeModel({
    attachments: Array.from({ length: 10 }, (_, index) => ({
      id: `photo-${index}`,
      relativePath: `3/photo-${index}.png`,
    })),
    id: 8,
    itemType: 'photo',
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
