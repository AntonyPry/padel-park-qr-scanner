const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../../models');
const sourceMigration = require('../../migrations/20260704100000-create-shift-report-templates-and-reports');
const simplifyMigration = require('../../migrations/20260705120000-simplify-shift-report-schema');
const scopeMigration = require('../../migrations/20260717100000-remove-shift-report-template-scope-fields');

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function getCounts(sequelize) {
  const [rows] = await sequelize.query(`
    SELECT
      (SELECT COUNT(*) FROM ShiftReportTemplates) AS templates,
      (SELECT COUNT(*) FROM ShiftReports) AS reports,
      (SELECT COUNT(*) FROM ShiftReportAnswers) AS answers
  `);
  return {
    answers: Number(rows[0].answers),
    reports: Number(rows[0].reports),
    templates: Number(rows[0].templates),
  };
}

async function assertFixturePreserved(sequelize, expectedCounts, ids) {
  assert.deepEqual(await getCounts(sequelize), expectedCounts);

  const [templates] = await sequelize.query(
    'SELECT id, name FROM ShiftReportTemplates WHERE id = :id',
    { replacements: { id: ids.templateId } },
  );
  assert.deepEqual(templates, [
    { id: ids.templateId, name: 'Утренний отчет об открытии' },
  ]);

  const [reports] = await sequelize.query(
    'SELECT id, shiftId, templateId, templateSnapshot FROM ShiftReports WHERE id = :id',
    { replacements: { id: ids.reportId } },
  );
  assert.equal(reports.length, 1);
  assert.equal(Number(reports[0].shiftId), ids.shiftId);
  assert.equal(Number(reports[0].templateId), ids.templateId);
  const snapshot = parseJson(reports[0].templateSnapshot);
  assert.equal(snapshot.appliesToRole, 'admin');
  assert.equal(snapshot.appliesToShiftType, 'day');

  const [answers] = await sequelize.query(
    'SELECT id, reportId, attachments FROM ShiftReportAnswers WHERE id = :id',
    { replacements: { id: ids.answerId } },
  );
  assert.equal(answers.length, 1);
  assert.equal(Number(answers[0].reportId), ids.reportId);
  assert.deepEqual(parseJson(answers[0].attachments), [
    { id: 'receipt-photo', relativePath: 'reports/receipt-photo.png' },
  ]);
}

test('DB-backed forward migration removes template scope columns without losing report data', async () => {
  await db.sequelize.authenticate();

  const databaseName = `shift_report_scope_${process.pid}_${Date.now()}`;
  let databaseCreated = false;
  let isolatedSequelize = null;

  try {
    await db.sequelize.query(
      `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    databaseCreated = true;

    const config = db.sequelize.config;
    isolatedSequelize = new db.Sequelize(
      databaseName,
      config.username,
      config.password,
      {
        dialect: 'mysql',
        host: config.host,
        logging: false,
        port: config.port,
      },
    );
    await isolatedSequelize.authenticate();
    const queryInterface = isolatedSequelize.getQueryInterface();

    for (const table of ['Accounts', 'Shifts']) {
      await queryInterface.createTable(table, {
        id: {
          allowNull: false,
          primaryKey: true,
          type: db.Sequelize.INTEGER,
        },
      });
    }

    await sourceMigration.up(queryInterface, db.Sequelize);
    await simplifyMigration.up(queryInterface, db.Sequelize);

    const [seedTemplates] = await isolatedSequelize.query(
      'SELECT id FROM ShiftReportTemplates ORDER BY id ASC LIMIT 1',
    );
    const templateId = Number(seedTemplates[0].id);
    const shiftId = 901;
    const now = new Date('2026-07-17T09:00:00+03:00');

    await queryInterface.bulkInsert('Shifts', [{ id: shiftId }]);
    await isolatedSequelize.query(
      `
        UPDATE ShiftReportTemplates
        SET appliesToRole = 'admin', appliesToShiftType = 'day'
        WHERE id = :templateId
      `,
      { replacements: { templateId } },
    );
    await queryInterface.bulkInsert('ShiftReports', [
      {
        comment: 'Связанный отчет должен сохраниться',
        createdAt: now,
        itemsSnapshot: JSON.stringify([]),
        scheduledAt: now,
        scheduledSlotKey: 'migration-regression',
        shiftId,
        status: 'draft',
        templateId,
        templateSnapshot: JSON.stringify({
          appliesToRole: 'admin',
          appliesToShiftType: 'day',
          gracePeriodMinutes: 30,
          id: templateId,
          name: 'Утренний отчет об открытии',
        }),
        templateVersion: 1,
        updatedAt: now,
      },
    ]);
    const [reportRows] = await isolatedSequelize.query(
      'SELECT id FROM ShiftReports WHERE scheduledSlotKey = :slot',
      { replacements: { slot: 'migration-regression' } },
    );
    const reportId = Number(reportRows[0].id);
    await queryInterface.bulkInsert('ShiftReportAnswers', [
      {
        attachments: JSON.stringify([
          { id: 'receipt-photo', relativePath: 'reports/receipt-photo.png' },
        ]),
        booleanValue: true,
        createdAt: now,
        itemLabel: 'Проверить ресепшен',
        itemSnapshot: JSON.stringify({ label: 'Проверить ресепшен', sortOrder: 10 }),
        itemType: 'checkbox',
        photoRequired: true,
        reportId,
        templateItemId: null,
        updatedAt: now,
      },
    ]);
    const [answerRows] = await isolatedSequelize.query(
      'SELECT id FROM ShiftReportAnswers WHERE reportId = :reportId',
      { replacements: { reportId } },
    );
    const ids = {
      answerId: Number(answerRows[0].id),
      reportId,
      shiftId,
      templateId,
    };
    const countsBefore = await getCounts(isolatedSequelize);

    await scopeMigration.up(queryInterface);
    let columns = await queryInterface.describeTable('ShiftReportTemplates');
    assert.equal(columns.appliesToRole, undefined);
    assert.equal(columns.appliesToShiftType, undefined);
    await assertFixturePreserved(isolatedSequelize, countsBefore, ids);

    await scopeMigration.down(queryInterface, db.Sequelize);
    columns = await queryInterface.describeTable('ShiftReportTemplates');
    assert.ok(columns.appliesToRole);
    assert.ok(columns.appliesToShiftType);
    assert.equal(columns.appliesToRole.allowNull, true);
    assert.equal(columns.appliesToShiftType.allowNull, true);
    await assertFixturePreserved(isolatedSequelize, countsBefore, ids);

    await scopeMigration.up(queryInterface);
    columns = await queryInterface.describeTable('ShiftReportTemplates');
    assert.equal(columns.appliesToRole, undefined);
    assert.equal(columns.appliesToShiftType, undefined);
    await assertFixturePreserved(isolatedSequelize, countsBefore, ids);
  } finally {
    if (isolatedSequelize) await isolatedSequelize.close();
    if (databaseCreated) {
      await db.sequelize.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    }
  }
});
