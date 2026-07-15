const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../../models');
const shiftCashService = require('../../src/services/shift-cash.service');
const attachmentStorage = require('../../src/services/shift-cash-attachments');
const shiftsService = require('../../src/services/shifts.service');

test('DB-backed shift cash lifecycle closes cash and shift atomically after rollback-safe variance validation', async () => {
  await db.sequelize.authenticate();

  const suffix = `${Date.now()}`;
  const receiptIds = [];
  let account;
  let category;
  let expenseId;
  let financeId;
  let shift;
  let staff;
  const originalDeleteAttachmentFile = attachmentStorage.deleteAttachmentFile;
  const originalStoreAttachment = attachmentStorage.storeAttachment;

  try {
    staff = await db.Staff.create({
      name: `Shift cash lifecycle ${suffix}`,
      role: 'Администратор',
      status: 'active',
    });
    account = await db.Account.create({
      email: `shift-cash-lifecycle-${suffix}@example.test`,
      passwordHash: 'not-used-in-test',
      role: 'admin',
      staffId: staff.id,
      status: 'active',
    });
    category = await db.Category.create({
      group: 'OPEX',
      isActive: true,
      name: `Shift cash lifecycle expense ${suffix}`,
      type: 'expense',
    });

    const startedAt = new Date(Date.now() - 1000);
    shift = await db.Shift.create({
      actualHours: null,
      adminName: staff.name,
      date: '2099-12-31',
      hours: 0,
      manualAdjustment: 0,
      staffId: staff.id,
      startedAt,
      status: 'active',
    });

    const receipts = await db.Receipt.bulkCreate([
      {
        cash: 1200,
        cashless: 300,
        dateTime: new Date(startedAt.getTime() + 100),
        evotorId: `shift-cash-sell-cash-${suffix}`,
        totalAmount: 1500,
        type: 'SELL',
      },
      {
        cash: 0,
        cashless: 500,
        dateTime: new Date(startedAt.getTime() + 200),
        evotorId: `shift-cash-sell-cashless-${suffix}`,
        totalAmount: 500,
        type: 'SELL',
      },
      {
        cash: 200,
        cashless: 0,
        dateTime: new Date(startedAt.getTime() + 300),
        evotorId: `shift-cash-payback-${suffix}`,
        totalAmount: 200,
        type: 'PAYBACK',
      },
    ]);
    receiptIds.push(...receipts.map((receipt) => receipt.id));

    const openingSummary = await shiftCashService.saveOpening(
      {
        banknotes: 3000,
        coins: 200,
        comment: 'DB-backed lifecycle opening',
      },
      account,
    );
    assert.equal(openingSummary.cashSales, 1000);
    assert.equal(openingSummary.expectedClosingCash, 4200);
    assert.equal(openingSummary.session.openingTotal, 3200);

    const expenseSummary = await shiftCashService.createExpense(
      {
        amount: 900,
        categoryId: category.id,
        description: 'DB-backed linked cash expense',
        spentAt: new Date(),
      },
      account,
    );
    expenseId = expenseSummary.createdExpenseId;
    const expense = await db.ShiftCashExpense.findByPk(expenseId);
    financeId = expense.financeId;

    assert.equal(expenseSummary.activeExpensesTotal, 900);
    assert.equal(expenseSummary.expectedClosingCash, 3300);
    assert.ok(financeId);
    assert.equal(
      await db.OnboardingEvent.count({
        where: {
          accountId: account.id,
          eventKey: 'shift_cash.attachment_uploaded',
        },
      }),
      0,
    );
    attachmentStorage.storeAttachment = async () => ({
      id: `lifecycle-attachment-${suffix}`,
      mimeType: 'image/png',
      originalName: 'lifecycle-receipt.png',
      relativePath: `lifecycle/${suffix}.png`,
      size: 123,
      uploadedAt: new Date().toISOString(),
      uploadedByAccountId: account.id,
    });
    attachmentStorage.deleteAttachmentFile = async () => true;
    const expenseWithAttachment = await shiftCashService.uploadAttachment(
      expenseId,
      {
        data: Buffer.from('lifecycle attachment').toString('base64'),
        fileName: 'lifecycle-receipt.png',
        mimeType: 'image/png',
      },
      account,
    );
    assert.equal(expenseWithAttachment.attachments.length, 1);
    const attachmentEvents = await db.OnboardingEvent.findAll({
      where: {
        accountId: account.id,
        eventKey: 'shift_cash.attachment_uploaded',
      },
    });
    assert.equal(attachmentEvents.length, 1);
    const attachmentEventPayload = typeof attachmentEvents[0].payload === 'string'
      ? JSON.parse(attachmentEvents[0].payload)
      : attachmentEvents[0].payload;
    assert.deepEqual(attachmentEventPayload, {
      attachmentId: `lifecycle-attachment-${suffix}`,
      expenseId,
      shiftId: shift.id,
    });
    await shiftCashService.removeAttachment(
      expenseId,
      `lifecycle-attachment-${suffix}`,
      account,
    );
    const linkedFinance = await db.Finance.findByPk(financeId);
    assert.equal(linkedFinance.type, 'expense');
    assert.equal(Number(linkedFinance.amount), 900);
    assert.match(linkedFinance.comment, new RegExp(`Касса смены #${shift.id}`));

    const canceledSummary = await shiftCashService.cancelExpense(
      expenseId,
      { reason: 'DB-backed soft cancel' },
      account,
    );
    const canceledExpense = await db.ShiftCashExpense.findByPk(expenseId);
    assert.equal(canceledSummary.activeExpensesTotal, 0);
    assert.equal(canceledSummary.expectedClosingCash, 4200);
    assert.equal(canceledExpense.status, 'canceled');
    assert.equal(canceledExpense.cancelReason, 'DB-backed soft cancel');
    assert.equal(canceledExpense.financeId, null);
    assert.equal(await db.Finance.findByPk(financeId), null);

    await assert.rejects(
      () => shiftsService.endActive(account, {
        cash: { banknotes: 4000, coins: 0, comment: null },
      }),
      /При расхождении укажите комментарий/,
    );

    const shiftAfterRejectedClose = await db.Shift.findByPk(shift.id);
    const sessionAfterRejectedClose = await db.ShiftCashSession.findOne({
      where: { contextKey: 'production', shiftId: shift.id },
    });
    assert.equal(shiftAfterRejectedClose.status, 'active');
    assert.equal(shiftAfterRejectedClose.endedAt, null);
    assert.equal(sessionAfterRejectedClose.status, 'open');
    assert.equal(sessionAfterRejectedClose.closingRecordedAt, null);
    assert.equal(sessionAfterRejectedClose.expectedClosingCash, null);
    assert.equal(sessionAfterRejectedClose.variance, null);

    const closed = await shiftsService.endActive(account, {
      cash: { banknotes: 4000, coins: 200, comment: null },
    });
    assert.equal(closed.shift.id, shift.id);
    assert.equal(closed.shift.status, 'closed');
    assert.ok(closed.shift.endedAt);
    assert.equal(closed.cash.status, 'closed');
    assert.equal(closed.cash.cashSalesSnapshot, 1000);
    assert.equal(closed.cash.expensesSnapshot, 0);
    assert.equal(closed.cash.expectedClosingCash, 4200);
    assert.equal(closed.cash.closingTotal, 4200);
    assert.equal(closed.cash.variance, 0);

    const [persistedShift, persistedSession] = await Promise.all([
      db.Shift.findByPk(shift.id),
      db.ShiftCashSession.findOne({
        where: { contextKey: 'production', shiftId: shift.id },
      }),
    ]);
    assert.equal(persistedShift.status, 'closed');
    assert.ok(persistedShift.endedAt);
    assert.equal(persistedSession.status, 'closed');
    assert.ok(persistedSession.closingRecordedAt);
    assert.equal(Number(persistedSession.expectedClosingCash), 4200);
    assert.equal(Number(persistedSession.variance), 0);
  } finally {
    attachmentStorage.deleteAttachmentFile = originalDeleteAttachmentFile;
    attachmentStorage.storeAttachment = originalStoreAttachment;
    if (shift?.id) {
      const reports = await db.ShiftReport.findAll({
        attributes: ['id'],
        where: { shiftId: shift.id },
      });
      const reportIds = reports.map((report) => report.id);
      if (reportIds.length > 0) {
        await db.ShiftReportAnswer.destroy({ where: { reportId: reportIds } });
        await db.ShiftReport.destroy({ where: { id: reportIds } });
      }
      await db.ShiftCashExpense.destroy({ where: { shiftId: shift.id } });
      await db.ShiftCashSession.destroy({ where: { shiftId: shift.id } });
    }
    if (account?.id) {
      await db.OnboardingProgress.destroy({ where: { accountId: account.id } });
      await db.OnboardingEvent.destroy({ where: { accountId: account.id } });
      await db.FinanceChangeLog.destroy({ where: { accountId: account.id } });
      await db.Finance.destroy({ where: { createdByAccountId: account.id } });
    }
    if (receiptIds.length > 0) {
      await db.Receipt.destroy({ where: { id: receiptIds } });
    }
    if (shift?.id) await db.Shift.destroy({ where: { id: shift.id } });
    if (account?.id) await db.Account.destroy({ force: true, where: { id: account.id } });
    if (staff?.id) await db.Staff.destroy({ where: { id: staff.id } });
    if (category?.id) await db.Category.destroy({ where: { id: category.id } });
  }
});
